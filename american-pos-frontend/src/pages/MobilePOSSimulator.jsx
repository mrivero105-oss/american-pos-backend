import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense, lazy } from 'react';
import { 
  Settings, X, Smartphone,
  RefreshCw, Tag, CreditCard, DollarSign, Wallet,
  FileText, ArrowLeft, Box, Users, Truck,
  ShieldCheck, Coins, TrendingUp, Scale, Shield, Store,
  FileSpreadsheet, Building2, PieChart, UserCog, Banknote
} from 'lucide-react';
import { playScanSound, playSuccessSound, playErrorSound, playDeleteSound, isSoundMuted, toggleSoundMute } from '../utils/sounds';
import api, { updateApiBaseUrl, checkServerHealth, formatServerUrl, autoDiscoverServer } from '../services/api';
import localDb from '../db/localDb';
import { db as primaryDb } from '../services/db';
import lanSyncService from '../services/lanSyncService';
import syncManager from '../services/syncManager';
import { useAuth } from '../hooks/AuthContext';
import { useTheme } from '../hooks/ThemeContext';
import { useSocket } from '../hooks/SocketContext';
import { isDollarOnlyCountry } from '../utils/format';
import { evaluateCartPromotions } from '../utils/promotionsEngine';
import { getImageUrl } from '../utils/imageUtils';
import { cacheAllProductImages } from '../services/imageCache';
import { triggerHaptic } from '../utils/haptics';
import cloudRateSyncService from '../services/cloudRateSyncService';

const stripAccents = (str = '') => String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Módulos Nativos Adaptados para Móvil (Ultra-rápidos con Carga Diferida / Lazy)
const MobileInventoryView = lazy(() => import('../components/mobile/MobileInventoryView'));
const MobileSalesView = lazy(() => import('../components/mobile/MobileSalesView'));
const MobileCustomersView = lazy(() => import('../components/mobile/MobileCustomersView'));
const MobileCashView = lazy(() => import('../components/mobile/MobileCashView'));
const MobileExpensesView = lazy(() => import('../components/mobile/MobileExpensesView'));
const MobileSyncCenterView = lazy(() => import('../components/mobile/MobileSyncCenterView'));
import MobilePOSHeader from '../components/mobile/MobilePOSHeader';
import MobilePOSLoginScreen from '../components/mobile/MobilePOSLoginScreen';
import MobilePOSCatalogSection from '../components/mobile/MobilePOSCatalogSection';
import MobilePOSBottomDock from '../components/mobile/MobilePOSBottomDock';
import MobileTabletCartPanel from '../components/mobile/MobileTabletCartPanel';
import MobileCartSheet from '../components/mobile/MobileCartSheet';
import MobileSimulatorModals from '../components/mobile/MobileSimulatorModals';
import { useVirtualCatalogGrid } from '../hooks/useVirtualCatalogGrid';
import { getTerminalId } from '../utils/terminalIdentity';

import biometricService from '../services/biometricService';
import mobilePrinterService from '../services/mobilePrinterService';
import { useMobilePosStore, normalizeMobileCartItems } from '../store/useMobilePosStore';
import { getSupabaseHeaders, getSupabaseRestUrl, hasSupabaseConfig } from '../config/supabaseConfig';
import ErrorBoundary from '../components/ErrorBoundary';

// Carga bajo demanda (Lazy) de todos los módulos del sistema principal para la versión móvil
const AccountsReceivablePage = lazy(() => import('./AccountsReceivable'));
const AccountsPayablePage = lazy(() => import('./AccountsPayable'));
const AssetsAndCollectionsPage = lazy(() => import('./AssetsAndCollections'));
const PromotionsManagerPage = lazy(() => import('./PromotionsManager'));
const CatalogImporterPage = lazy(() => import('./CatalogImporter'));
const SuppliersPage = lazy(() => import('./Suppliers'));
const FiscalManagerPage = lazy(() => import('./FiscalManager'));
const ExecutiveBIPage = lazy(() => import('./ExecutiveBI'));
const ReportsPage = lazy(() => import('./Reports'));
const AccountingGeneralPage = lazy(() => import('./AccountingGeneral'));
const PayrollManagerPage = lazy(() => import('./PayrollManager'));
const AuditPanelPage = lazy(() => import('./AuditPanel'));
const CashierAuditCenterPage = lazy(() => import('./CashierAuditCenter'));
const BranchesPage = lazy(() => import('./Branches'));
const UsersPage = lazy(() => import('./Users'));
const SettingsPage = lazy(() => import('./Settings'));

// Contenedor responsivo unificado para submódulos embebidos en móvil
function MobileSubViewWrapper({ title, subtitle, icon: IconComponent, onBack, children, T }) {
  return (
    <div className={`flex-1 min-h-0 flex flex-col overflow-hidden w-full ${T.appBg} animate-fadeIn`}>
      {/* Subheader móvil de alta fidelidad con regreso y título conciso */}
      <div className={`px-2.5 sm:px-3 py-2 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <button 
            onClick={onBack}
            className={`px-2.5 py-1.5 rounded-xl ${T.btnGhost} border ${T.border} flex items-center gap-1 text-xs font-black cursor-pointer active:scale-95 shrink-0`}
            title="Volver al Terminal POS"
          >
            <ArrowLeft size={14} />
            <span>POS</span>
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            {IconComponent && (
              <div className="p-1 rounded-lg bg-blue-600/15 text-blue-500 border border-blue-500/20 shrink-0">
                <IconComponent size={14} />
              </div>
            )}
            <div className="min-w-0">
              <h2 className={`font-black text-xs sm:text-sm ${T.textPrimary} truncate leading-tight`}>
                {title}
              </h2>
              <p className={`text-[9.5px] ${T.textMuted} truncate leading-tight mt-0.5 hidden xs:block`}>
                {subtitle || 'Módulo conectado con el servidor'}
              </p>
            </div>
          </div>
        </div>
        <button 
          onClick={onBack}
          className={`p-1.5 rounded-xl ${T.btnGhost} text-slate-400 hover:text-rose-500 transition-colors cursor-pointer shrink-0`}
          title="Cerrar y volver al POS"
        >
          <X size={16} />
        </button>
      </div>

      {/* Contenedor del módulo con scroll bidireccional suave (permite ver tablas anchas sin recortes) */}
      <div className="mobile-embedded-module flex-1 min-h-0 overflow-y-auto overflow-x-auto p-2.5 sm:p-4 w-full overscroll-contain touch-pan-x touch-pan-y custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <Suspense fallback={
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-center">
            <RefreshCw className="animate-spin text-blue-500" size={30} />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cargando {title}...</span>
          </div>
        }>
          <ErrorBoundary inline resetKey={title} moduleName={title}>
            {children}
          </ErrorBoundary>
        </Suspense>
      </div>
    </div>
  );
}

export default function MobilePOSSimulator() {
  const isDollarCountry = isDollarOnlyCountry(localStorage.getItem('pos_country'));
  const { user, login, loginWithBiometrics, logout, hasPermission, refreshUser } = useAuth();
  const { theme, setTheme, isOled } = useTheme();
  const socketContext = useSocket();
  const socket = socketContext?.socket;
  const isRealtimeConnected = Boolean(socketContext?.isConnected || socket?.connected);

  // Estados de Autenticación y Seguridad Biométrica
  const [enrolledBioUser, setEnrolledBioUser] = useState(() => biometricService.getEnrolledCredential());
  const [isBioLoggingIn, setIsBioLoggingIn] = useState(false);
  const [isBiometricsModalOpen, setIsBiometricsModalOpen] = useState(false);

  useEffect(() => {
    setEnrolledBioUser(biometricService.getEnrolledCredential());
  }, [user, isBiometricsModalOpen]);

  const isLight = theme === 'studio' || theme === 'swiss';
  const isOledMode = Boolean(isOled);

  // Módulo Activo en la Experiencia Móvil (Zustand Store): 'pos' | 'inventory' | 'sales' | 'customers' | 'cash' | 'expenses' | 'sync'
  const activeModule = useMobilePosStore((s) => s.activeModule);
  const setActiveModule = useMobilePosStore((s) => s.setActiveModule);

  const hasRefreshedInitialUserRef = useRef(false);
  // Sincronizar permisos del usuario en tiempo real con el servidor
  useEffect(() => {
    if (hasRefreshedInitialUserRef.current) return;
    if (user && refreshUser) {
      hasRefreshedInitialUserRef.current = true;
      refreshUser().catch(() => {});
    }
  }, [user, refreshUser]);

  useEffect(() => {
    const handleUserUpdate = (data) => {
      if (!data) return;
      if (String(data.userId) === String(user?.id) || String(data.user?.id) === String(user?.id)) {
        if (refreshUser) refreshUser();
      }
    };
    if (socketContext?.socket) {
      const handleUsersChanged = () => {
        if (refreshUser) refreshUser();
      };
      socketContext.socket.on('user_updated', handleUserUpdate);
      socketContext.socket.on('users_changed', handleUsersChanged);
      return () => {
        socketContext.socket.off('user_updated', handleUserUpdate);
        socketContext.socket.off('users_changed', handleUsersChanged);
      };
    }
  }, [socketContext?.socket, user?.id, refreshUser]);

  // Guardia de seguridad: si el módulo activo requiere un permiso desactivado en la matriz, regresar a POS
  useEffect(() => {
    const modulePermMap = {
      pos: 'canAccessPOS',
      cash: 'canManageCashShift',
      sales: 'canViewSalesHistory',
      customers: 'canManageCustomers',
      receivables: 'canManageReceivables',
      collections: 'canAccessCollections',
      inventory: 'canManageInventory',
      promotions: 'canManagePromotions',
      importer: 'canImportCatalog',
      suppliers: 'canManageSuppliers',
      payables: 'canManagePayables',
      expenses: 'canManageExpenses',
      fiscal: 'canManageFiscal',
      bi: 'canAccessBI',
      reports: 'canViewReports',
      accounting: 'canManageAccounting',
      payroll: 'canManagePayroll',
      assets: 'canManageAssets',
      audit: 'canAccessAudit',
      'cash-monitoring': 'canMonitorCashiers',
      branches: 'canManageBranches',
      users: 'canManageUsers',
      settings: 'canManageSettings'
    };

    if (activeModule && activeModule !== 'pos' && activeModule !== 'sync' && hasPermission) {
      const requiredPerm = modulePermMap[activeModule];
      if (requiredPerm && !hasPermission(requiredPerm)) {
        setActiveModule('pos');
      }
    }
  }, [activeModule, hasPermission, setActiveModule]);

  // Estado de Red, Socket Espejo y Cola Offline
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [lanSocketConnected, setLanSocketConnected] = useState(() => {
    return Boolean(
      lanSyncService?.socket?.connected || 
      lanSyncService?.status?.state === 'CLOUD_ONLINE' || 
      lanSyncService?.status?.state === 'LAN_P2P_ACTIVE'
    );
  });

  // El sistema está en línea si el socket de tiempo real o el de LAN están conectados
  const socketConnected = Boolean(
    isRealtimeConnected || 
    lanSocketConnected || 
    lanSyncService?.socket?.connected ||
    (lanSyncService?.status?.state && lanSyncService.status.state !== 'OFFLINE_ISOLATED')
  );
  const [pendingSalesCount, setPendingSalesCount] = useState(0);
  const [isSyncingSales, setIsSyncingSales] = useState(false);
  const [salesHistory, setSalesHistory] = useState([]);

  // Control del Menú Lateral (Todas las opciones del sistema)
  const [isSideNavOpen, setIsSideNavOpen] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState('');

  // Estructura de navegación para el Menú Lateral (Filtrada estrictamente por matriz de permisos del usuario)
  const navSections = useMemo(() => {
    const rawSections = [
      {
        title: 'Ventas',
        items: [
          { id: 'pos', moduleId: 'pos', label: 'Punto de Venta', icon: Smartphone, desc: 'Catálogo y cobro rápido', permission: 'canAccessPOS' },
          { id: 'cash', moduleId: 'cash', label: 'Caja y Turno', icon: Wallet, desc: 'Apertura, arqueo y cierre', permission: 'canManageCashShift' },
          { id: 'sales', moduleId: 'sales', label: 'Ventas', icon: FileText, desc: 'Historial y recibos', permission: 'canViewSalesHistory' },
          { id: 'sync', moduleId: 'sync', label: 'Conexión PC', icon: RefreshCw, desc: 'Sincronización con servidor' }
        ]
      },
      {
        title: 'Clientes',
        items: [
          { id: 'customers', moduleId: 'customers', label: 'Clientes', icon: Users, desc: 'Directorio y créditos', permission: 'canManageCustomers' },
          { id: 'receivables', moduleId: 'receivables', label: 'Por Cobrar', icon: DollarSign, desc: 'Saldos y abonos', permission: 'canManageReceivables' },
          { id: 'collections', moduleId: 'collections', label: 'Cobranza', icon: Coins, desc: 'Control de cartera', permission: 'canAccessCollections' }
        ]
      },
      {
        title: 'Inventario',
        items: [
          { id: 'inventory', moduleId: 'inventory', label: 'Inventario', icon: Box, desc: 'Productos, precios y stock', permission: 'canManageInventory' },
          { id: 'promotions', moduleId: 'promotions', label: 'Promociones', icon: Tag, desc: 'Descuentos y ofertas', permission: 'canManagePromotions' },
          { id: 'importer', moduleId: 'importer', label: 'Importar', icon: FileSpreadsheet, desc: 'Carga por Excel o CSV', permission: 'canImportCatalog' }
        ]
      },
      {
        title: 'Compras',
        items: [
          { id: 'suppliers', moduleId: 'suppliers', label: 'Proveedores', icon: Truck, desc: 'Directorio y compras', permission: 'canManageSuppliers' },
          { id: 'payables', moduleId: 'payables', label: 'Por Pagar', icon: CreditCard, desc: 'Facturas pendientes', permission: 'canManagePayables' }
        ]
      },
      {
        title: 'Tesorería',
        items: [
          { id: 'expenses', moduleId: 'expenses', label: 'Gastos', icon: Banknote, desc: 'Caja chica y egresos', permission: 'canManageExpenses' },
          { id: 'fiscal', moduleId: 'fiscal', label: 'Fiscal SENIAT', icon: FileText, desc: 'Libros e impuestos', permission: 'canManageFiscal' }
        ]
      },
      {
        title: 'Gerencia',
        items: [
          { id: 'bi', moduleId: 'bi', label: 'P&L Gerencial', icon: TrendingUp, desc: 'Márgenes y ganancias', permission: 'canAccessBI' },
          { id: 'reports', moduleId: 'reports', label: 'Reportes', icon: PieChart, desc: 'Estadísticas de ventas', permission: 'canViewReports' },
          { id: 'accounting', moduleId: 'accounting', label: 'Contabilidad', icon: Scale, desc: 'Cuentas y asientos', permission: 'canManageAccounting' },
          { id: 'payroll', moduleId: 'payroll', label: 'Nómina', icon: Users, desc: 'Personal y pagos', permission: 'canManagePayroll' },
          { id: 'assets', moduleId: 'assets', label: 'Activos Fijos', icon: Building2, desc: 'Bienes del negocio', permission: 'canManageAssets' }
        ]
      },
      {
        title: 'Seguridad',
        items: [
          { id: 'audit', moduleId: 'audit', label: 'Auditoría', icon: ShieldCheck, desc: 'Registro de actividad', permission: 'canAccessAudit' },
          { id: 'cash-monitoring', moduleId: 'cash-monitoring', label: 'Monitor Cajas', icon: Shield, desc: 'Control de cajeros', permission: 'canMonitorCashiers' }
        ]
      },
      {
        title: 'Sistema',
        items: [
          { id: 'branches', moduleId: 'branches', label: 'Sucursales', icon: Store, desc: 'Tiendas y sedes', permission: 'canManageBranches' },
          { id: 'users', moduleId: 'users', label: 'Usuarios', icon: UserCog, desc: 'Cajeros y permisos', permission: 'canManageUsers' },
          { id: 'settings', moduleId: 'settings', label: 'Ajustes', icon: Settings, desc: 'Tienda, tasa e impresoras', permission: 'canManageSettings' }
        ]
      }
    ];

    if (!hasPermission) return rawSections;

    return rawSections
      .map(sec => ({
        ...sec,
        items: sec.items.filter(item => !item.permission || hasPermission(item.permission))
      }))
      .filter(sec => sec.items.length > 0);
  }, [hasPermission]);

  // Filtrado reactivo en tiempo real para el menú lateral
  const filteredNavSections = useMemo(() => {
    const q = drawerSearch.toLowerCase().trim();
    if (!q) return navSections;
    return navSections
      .map(sec => ({
        ...sec,
        items: sec.items.filter(item => 
          item.label.toLowerCase().includes(q) || 
          item.desc.toLowerCase().includes(q) ||
          sec.title.toLowerCase().includes(q)
        )
      }))
      .filter(sec => sec.items.length > 0);
  }, [navSections, drawerSearch]);

  // Auth form
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Server IP & Connection State
  const [mobileServerIp, setMobileServerIp] = useState(() => 
    localStorage.getItem('isaac_pos_server_ip') || 
    localStorage.getItem('american_pos_server_ip') || 
    ''
  );
  const [serverHealth, setServerHealth] = useState(null);
  const [showServerModal, setShowServerModal] = useState(false);
  const [isTestingServer, setIsTestingServer] = useState(false);
  const [serverFeedback, setServerFeedback] = useState(null);

  // Check server health on mount
  useEffect(() => {
    let isMounted = true;
    checkServerHealth().then(ok => {
      if (isMounted) setServerHealth(ok);
    });
    return () => { isMounted = false; };
  }, []);

  const handleTestAndSaveServer = async (ipToTest) => {
    const target = ipToTest || mobileServerIp;
    setIsTestingServer(true);
    setServerFeedback(null);
    try {
      const formatted = formatServerUrl(target);
      const ok = await checkServerHealth(formatted);
      if (ok) {
        updateApiBaseUrl(target);
        setMobileServerIp(target);
        setServerHealth(true);
        setServerFeedback({ ok: true, msg: '¡Conectado exitosamente al servidor PC!' });
        setTimeout(() => setShowServerModal(false), 1200);
      } else {
        setServerHealth(false);
        setServerFeedback({ ok: false, msg: 'No se pudo conectar. Verifica que la PC esté en la misma red Wi-Fi.' });
      }
    } catch {
      setServerHealth(false);
      setServerFeedback({ ok: false, msg: 'Error de red al conectar.' });
    } finally {
      setIsTestingServer(false);
    }
  };

  const handleAutoDiscoverServer = async () => {
    setIsTestingServer(true);
    setServerFeedback({ ok: true, msg: 'Buscando servidor en la red Wi-Fi...' });
    try {
      const found = await autoDiscoverServer();
      if (found) {
        setMobileServerIp(found);
        setServerHealth(true);
        setServerFeedback({ ok: true, msg: `¡Servidor detectado en ${found}!` });
        setTimeout(() => setShowServerModal(false), 1200);
      } else {
        setServerFeedback({ ok: false, msg: 'No se encontró el servidor automáticamente. Escribe la IP manualmente.' });
      }
    } catch {
      setServerFeedback({ ok: false, msg: 'Error buscando servidor.' });
    } finally {
      setIsTestingServer(false);
    }
  };

  // Business settings (inicializados desde caché local o valores limpios)
  const [businessInfo, setBusinessInfo] = useState(() => {
    try {
      const cached = localStorage.getItem('pos_cached_business_info');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error parseando JSON local:', caughtErr?.message || caughtErr); }
    return {
      name: 'Mi Negocio POS',
      rif: '',
      phone: '',
      address: '',
      pagoMovilBank: '',
      pagoMovilPhone: '',
      pagoMovilId: ''
    };
  });
  const [exchangeRate, setExchangeRate] = useState(() => {
    try {
      const cached = localStorage.getItem('pos_cached_exchange_rate') || localStorage.getItem('pos_exchange_rate');
      const parsed = parseFloat(cached);
      if (parsed && !isNaN(parsed) && parsed > 0) return parsed;
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
    return 1000.00;
  });

  // Catalog state
  const [products, setProducts] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [catalogLayout, setCatalogLayout] = useState(() => {
    try {
      return localStorage.getItem('mobile_catalog_layout') || 'list';
    } catch (_) {
      return 'list';
    }
  });

  const toggleCatalogLayout = useCallback(() => {
    setCatalogLayout(prev => {
      const next = prev === 'list' ? 'grid' : 'list';
      try {
        localStorage.setItem('mobile_catalog_layout', next);
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      triggerHaptic(15);
      return next;
    });
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = React.useDeferredValue(searchQuery);

  // O(1) Fast Product Lookup Map
  const productsMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(products)) {
      for (const p of products) {
        if (p && p.id != null) map.set(String(p.id), p);
      }
    }
    return map;
  }, [products]);

  // Cart & UI state (Persisted Atomic Zustand Store)
  const cart = useMobilePosStore((s) => s.cart);
  const setCart = useMobilePosStore((s) => s.setCart);

  // Mapa reactivo de unidades comprometidas en el ticket actual para descuento en pantalla en tiempo real
  const cartCommittedUnitsMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(cart) || cart.length === 0) return map;

    for (const it of cart) {
      const prod = it?.product;
      if (!prod) continue;
      const rawId = String(prod.productId || prod.id || '');
      const baseId = rawId.replace(/__.*$/, '');
      if (!baseId) continue;

      const mult = Number(prod.factorConversion || prod.unitsMultiplier) > 0
        ? Number(prod.factorConversion || prod.unitsMultiplier)
        : (prod.isBulk ? (Number(prod.unitsPerBulk) || 1) : (prod.isMidBulk ? (Number(prod.unitsPerMidBulk) || 1) : 1));

      const qtyUnits = (Number(it.quantity) || 0) * mult;
      map.set(baseId, (map.get(baseId) || 0) + qtyUnits);
    }
    return map;
  }, [cart]);

  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [printedReceipt, setPrintedReceipt] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);
  const [isProcessingSale, setIsProcessingSale] = useState(false);
  const cartDiscountPercent = useMobilePosStore((s) => s.cartDiscountPercent);
  const setCartDiscountPercent = useMobilePosStore((s) => s.setCartDiscountPercent);
  const discountSupervisorApprovalId = useMobilePosStore((s) => s.discountSupervisorApprovalId);
  const setDiscountSupervisorApprovalId = useMobilePosStore((s) => s.setDiscountSupervisorApprovalId);

  // Referencia al contenedor de catálogo para virtualización DOM Windowing
  const catalogScrollRef = useRef(null);

  // Estado de Autorización de Supervisor (Biometría / PIN)
  const [supervisorAuthRequest, setSupervisorAuthRequest] = useState(null);
  const requestSupervisorAuth = useCallback((title, reason, callback, actionType = 'pos_override', referenceId = null) => {
    setSupervisorAuthRequest({
      title,
      reason,
      actionType,
      referenceId,
      onAuthorized: callback
    });
  }, []);

  // Ventas en Espera (Pausar Venta - Zustand Store)
  const heldSales = useMobilePosStore((s) => s.heldSales);
  const setHeldSales = useMobilePosStore((s) => s.setHeldSales);
  const [isHeldSalesModalOpen, setIsHeldSalesModalOpen] = useState(false);

  // Ítem Rápido / Manual (Sin registrar en catálogo previo)
  const [isManualItemModalOpen, setIsManualItemModalOpen] = useState(false);
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [manualItemPriceBS, setManualItemPriceBS] = useState('');
  const [manualItemQty, setManualItemQty] = useState('1');

  // Edición / Creación Rápida de Productos desde el Móvil
  const [isQuickProductModalOpen, setIsQuickProductModalOpen] = useState(false);
  const [productFormData, setProductFormData] = useState({
    id: null,
    name: '',
    barcode: '',
    category: 'General',
    priceUSD: '',
    priceBS: '',
    costUSD: '',
    stock: '0',
    taxStatus: 'gravable',
    imageUri: '',
    isNew: false
  });
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [previewProductImage, setPreviewProductImage] = useState(null);
  const [isImageSearchModalOpen, setIsImageSearchModalOpen] = useState(false);
  const [isThermalPrinterModalOpen, setIsThermalPrinterModalOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState('cart'); // 'cart' | 'product_barcode'
  const [unregisteredBarcodeNotice, setUnregisteredBarcodeNotice] = useState(null); // { barcode }
  const [posMode, setPosMode] = useState('SALE'); // 'SALE' | 'PRICE_CHECKER'
  const [priceCheckerProduct, setPriceCheckerProduct] = useState(null);
  const [isPriceCheckerModalOpen, setIsPriceCheckerModalOpen] = useState(false);
  const [priceCheckerSearch, setPriceCheckerSearch] = useState('');

  // 1. Preventa Móvil despachada a Caja Principal (Modal de Confirmación)
  const [preSaleSentModal, setPreSaleSentModal] = useState(null);

  // 1.1 Mesa y Notas de Comandera / Restaurante
  const [selectedTable, setSelectedTable] = useState(null);
  const [orderNotes, setOrderNotes] = useState('');
  const [isTableSelectModalOpen, setIsTableSelectModalOpen] = useState(false);

  // 2. Feedback HUD Lector Físico Bluetooth / Pistola Inalámbrica
  const [lastHardwareScan, setLastHardwareScan] = useState(null);

  // 3. Calculadora de Cambio Inteligente: Modo Sumar (+) vs 1-Toque
  const [cashAccumulateMode, setCashAccumulateMode] = useState(false);

  // 4. Recibo Ecológico directo a WhatsApp
  const [whatsAppModalData, setWhatsAppModalData] = useState(null);
  const [whatsAppPhoneInput, setWhatsAppPhoneInput] = useState('');

  // Modo de Negocio Activo ('STANDARD' | 'PHARMACY' | 'CLOTHING')
  const [businessMode, setBusinessMode] = useState(() => 
    (localStorage.getItem('pos_business_mode') || 'STANDARD').toUpperCase()
  );

  // Determina si el tipo de negocio requiere mesas y comandera (Restaurante / Comida rápida)
  const isRestaurantBusiness = useMemo(() => {
    const bizType = String(
      businessInfo?.businessType || 
      businessInfo?.businessMode || 
      businessInfo?.industry || 
      businessMode || 
      localStorage.getItem('pos_business_mode') || 
      ''
    ).toLowerCase();
    const activePreset = String(localStorage.getItem('pos_active_preset') || '').toLowerCase();
    return Boolean(
      bizType.includes('restauran') || 
      bizType.includes('gastronom') || 
      bizType.includes('comida') || 
      bizType.includes('bar') || 
      bizType.includes('cafe') || 
      activePreset === 'restaurant' || 
      businessInfo?.enableTables === true || 
      selectedTable
    );
  }, [businessInfo, businessMode, selectedTable]);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState(null);
  const [selectedProductForControlledMed, setSelectedProductForControlledMed] = useState(null);
  const [selectedProductForBulk, setSelectedProductForBulk] = useState(null);

  // Directorio de Clientes para Venta / Crédito
  const [customers, setCustomers] = useState([]);

  // Checkout inputs & Document Type ('factura' | 'nota_entrega' | 'cotizacion')
  const [documentType, setDocumentType] = useState('factura');
  const [checkoutMode, setCheckoutMode] = useState('express'); // 'express' | 'split'
  const [splitPayments, setSplitPayments] = useState({
    cash_usd: '',
    cash_bs: '',
    pago_movil: '',
    tarjeta: '',
    zelle: '',
    credito: ''
  });
  const [selectedMethod, setSelectedMethod] = useState('Efectivo USD');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerName, setCustomerName] = useState('Consumidor Final');
  const [customerDoc, setCustomerDoc] = useState(isDollarCountry ? '0000000000' : 'V-00000000');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isCustomerSelectModalOpen, setIsCustomerSelectModalOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCreatingCustomerInMobile, setIsCreatingCustomerInMobile] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    idDocument: '',
    phone: '',
    address: '',
    email: '',
    creditLimit: '0'
  });
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [amountPaidUSD, setAmountPaidUSD] = useState('');
  const [amountPaidBS, setAmountPaidBS] = useState('');
  const autoPrint = true;
  const [isAudioMuted, setIsAudioMuted] = useState(isSoundMuted());
  const [quantityModalItem, setQuantityModalItem] = useState(null);
  const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
  const [printerSpoolerStatus, setPrinterSpoolerStatus] = useState(mobilePrinterService.getQueueStatus());

  // 🛡️ Manejador Unificado del Botón Atrás (Android Hardware / Gestos de Navegación / Web PopState)
  // Optimizado con ref estable y barrera en history.pushState para interceptar gestos táctiles de retroceso sin recargar la app.
  const backNavigationHandlerRef = useRef(null);
  const pushedHistoryCountRef = useRef(0);

  // Comprobar de forma reactiva si existe cualquier modal o vista secundaria sobrepuesta
  const isAnyOverlayActive = Boolean(
    supervisorAuthRequest ||
    printedReceipt ||
    isScannerOpen ||
    isCheckoutOpen ||
    isCustomerSelectModalOpen ||
    isQuantityModalOpen ||
    priceCheckerProduct ||
    isPriceCheckerModalOpen ||
    isHeldSalesModalOpen ||
    isManualItemModalOpen ||
    isQuickProductModalOpen ||
    isThermalPrinterModalOpen ||
    isImageSearchModalOpen ||
    previewProductImage ||
    selectedProductForVariant ||
    selectedProductForControlledMed ||
    selectedProductForBulk ||
    whatsAppModalData ||
    preSaleSentModal ||
    showServerModal ||
    isSideNavOpen ||
    isMobileCartOpen ||
    (activeModule && activeModule !== 'pos')
  );

  backNavigationHandlerRef.current = () => {
    // 1. Cerrar modales en orden de pila inversa (LIFO)
    if (supervisorAuthRequest) { setSupervisorAuthRequest(null); return 'handled'; }
    if (printedReceipt) { setPrintedReceipt(null); return 'handled'; }
    if (isScannerOpen) { setIsScannerOpen(false); return 'handled'; }
    if (isCheckoutOpen) { setIsCheckoutOpen(false); return 'handled'; }
    if (isCustomerSelectModalOpen) { setIsCustomerSelectModalOpen(false); return 'handled'; }
    if (isQuantityModalOpen) { setIsQuantityModalOpen(false); return 'handled'; }
    if (priceCheckerProduct) { setPriceCheckerProduct(null); return 'handled'; }
    if (isPriceCheckerModalOpen) { setIsPriceCheckerModalOpen(false); return 'handled'; }
    if (isHeldSalesModalOpen) { setIsHeldSalesModalOpen(false); return 'handled'; }
    if (isManualItemModalOpen) { setIsManualItemModalOpen(false); return 'handled'; }
    if (isQuickProductModalOpen) { setIsQuickProductModalOpen(false); return 'handled'; }
    if (isThermalPrinterModalOpen) { setIsThermalPrinterModalOpen(false); return 'handled'; }
    if (isImageSearchModalOpen) { setIsImageSearchModalOpen(false); return 'handled'; }
    if (previewProductImage) { setPreviewProductImage(null); return 'handled'; }
    if (selectedProductForVariant) { setSelectedProductForVariant(null); return 'handled'; }
    if (selectedProductForControlledMed) { setSelectedProductForControlledMed(null); return 'handled'; }
    if (selectedProductForBulk) { setSelectedProductForBulk(null); return 'handled'; }
    if (whatsAppModalData) { setWhatsAppModalData(null); return 'handled'; }
    if (preSaleSentModal) { setPreSaleSentModal(null); return 'handled'; }
    if (showServerModal) { setShowServerModal(false); return 'handled'; }
    if (isSideNavOpen) { setIsSideNavOpen(false); return 'handled'; }
    if (isMobileCartOpen) { setIsMobileCartOpen(false); return 'handled'; }

    // 2. Si algún submódulo embebido tiene un modal abierto en el DOM, cerrarlo primero
    if (typeof document !== 'undefined') {
      const subOverlays = Array.from(document.querySelectorAll('.fixed.inset-0, [role="dialog"]'));
      if (subOverlays.length > 0) {
        const topOverlay = subOverlays[subOverlays.length - 1];
        const closeBtn = topOverlay.querySelector('button svg.lucide-x')?.closest('button');
        if (closeBtn) {
          closeBtn.click();
          return 'handled';
        }
      }
    }

    // 3. Si el usuario se encuentra navegando en un submódulo (inventario, caja, etc.), regresar al POS
    if (activeModule !== 'pos') {
      setActiveModule('pos');
      return 'handled';
    }

    return 'unhandled';
  };

  // Barrera reactiva en el historial para atrapar el gesto 'Atrás' en Android y PWA
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isAnyOverlayActive) {
      if (pushedHistoryCountRef.current === 0) {
        window.history.pushState({ isaacModalBarrier: true }, '');
        pushedHistoryCountRef.current = 1;
      }
    } else {
      pushedHistoryCountRef.current = 0;
    }
  }, [isAnyOverlayActive]);

  useEffect(() => {
    const invokeBackNavigation = () => backNavigationHandlerRef.current?.() || 'unhandled';

    if (typeof window !== 'undefined') {
      window.__handleMobileBackButton = invokeBackNavigation;
    }

    // Listener Capacitor nativo Android
    let capacitorListener = null;
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.App) {
      try {
        capacitorListener = window.Capacitor.Plugins.App.addListener('backButton', () => {
          invokeBackNavigation();
        });
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
    }

    // Listener de navegación en PWA / Web Mobile
    const onPopState = () => {
      pushedHistoryCountRef.current = 0;
      const res = invokeBackNavigation();
      if (res === 'handled') {
        // Si aún queda otro modal abierto en la pila, reactivamos la barrera de retroceso
        setTimeout(() => {
          if (backNavigationHandlerRef.current && pushedHistoryCountRef.current === 0) {
            window.history.pushState({ isaacModalBarrier: true }, '');
            pushedHistoryCountRef.current = 1;
          }
        }, 60);
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      if (typeof window !== 'undefined' && window.__handleMobileBackButton === invokeBackNavigation) {
        delete window.__handleMobileBackButton;
      }
      if (capacitorListener?.remove) capacitorListener.remove();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // 🔆 Screen WakeLock API + Auto-Healing de IP cuando el servidor cambia por DHCP
  useEffect(() => {
    let wakeLockSentinel = null;

    const requestWakeLock = async () => {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
        } catch { /* Screen Wake Lock opcional no soportado o bloqueado */ }
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    const handleServerDiscovered = (e) => {
      const discoveredUrl = e?.detail?.url;
      if (discoveredUrl) {
        const cleanIp = discoveredUrl.replace(/^https?:\/\//, '');
        setMobileServerIp(cleanIp);
        setServerHealth(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('server-discovered', handleServerDiscovered);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('server-discovered', handleServerDiscovered);
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, []);

  const searchInputRef = useRef(null);

  // Gestos Móviles Avanzados (Pull-to-Refresh, Swipe, Long-Press, Edge Swipe)
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const pullDistanceRef = useRef(0);
  const pullIndicatorRef = useRef(null);
  const pullThresholdHapticRef = useRef(false);
  const pullStartYRef = useRef(0);
  const edgeSwipeStartXRef = useRef(null);
  const edgeSwipeStartYRef = useRef(null);

  const canEditCatalogMobile = useMemo(() => {
    const role = String(user?.role || '').toLowerCase();
    return Boolean(
      hasPermission('canManageInventory') ||
      hasPermission('canEditProducts') ||
      ['superadmin', 'owner', 'dueño', 'dueno', 'admin', 'supervisor', 'master'].includes(role)
    );
  }, [user?.role, hasPermission]);

  // Manejadores de Gesto de Presión Prolongada (Long-Press / Haptic Touch)



  const pullRafIdRef = useRef(null);

  // Manejadores de Pull-To-Refresh de Alto Rendimiento en Catálogo (0 Re-renders en Drag)
  const handleCatalogTouchStart = (e) => {
    const target = e.currentTarget;
    if (target.scrollTop <= 0) {
      pullStartYRef.current = e.touches[0].clientY;
      pullDistanceRef.current = 0;
      pullThresholdHapticRef.current = false;
    } else {
      pullStartYRef.current = 0;
    }
  };

  const handleCatalogTouchMove = (e) => {
    if (pullStartYRef.current <= 0 || isPullRefreshing) return;
    const target = e.currentTarget;
    if (target.scrollTop <= 0) {
      const currentY = e.touches[0].clientY;
      const diff = (currentY - pullStartYRef.current) * 0.45; // Resistencia elástica
      if (diff > 0) {
        const clamped = Math.min(diff, 85);
        pullDistanceRef.current = clamped;
        if (!pullRafIdRef.current) {
          pullRafIdRef.current = requestAnimationFrame(() => {
            if (pullIndicatorRef.current) {
              pullIndicatorRef.current.style.height = `${clamped}px`;
              pullIndicatorRef.current.style.opacity = `${Math.min(1, clamped / 35)}`;
            }
            pullRafIdRef.current = null;
          });
        }
        if (clamped >= 60 && !pullThresholdHapticRef.current) {
          pullThresholdHapticRef.current = true;
          triggerHaptic(15);
        } else if (clamped < 60) {
          pullThresholdHapticRef.current = false;
        }
      }
    }
  };

  const handleCatalogTouchEnd = async () => {
    if (pullRafIdRef.current) {
      cancelAnimationFrame(pullRafIdRef.current);
      pullRafIdRef.current = null;
    }
    const currentPull = pullDistanceRef.current;
    pullDistanceRef.current = 0;
    pullThresholdHapticRef.current = false;
    pullStartYRef.current = 0;

    if (currentPull >= 60 && !isPullRefreshing) {
      setIsPullRefreshing(true);
      if (pullIndicatorRef.current) {
        pullIndicatorRef.current.style.height = '44px';
        pullIndicatorRef.current.style.opacity = '1';
      }
      triggerHaptic(25);
      try {
        await Promise.all([loadProducts(), loadSettings(), loadPromotions()]);
        showToast('✅ Catálogo y tasas actualizados');
      } catch (_) {
        showToast('Catálogo actualizado');
      } finally {
        setTimeout(() => {
          if (pullIndicatorRef.current) {
            pullIndicatorRef.current.style.height = '0px';
            pullIndicatorRef.current.style.opacity = '0';
          }
          setIsPullRefreshing(false);
        }, 400);
      }
    } else {
      if (pullIndicatorRef.current) {
        pullIndicatorRef.current.style.height = '0px';
        pullIndicatorRef.current.style.opacity = '0';
      }
    }
  };

  const activeModuleRef = useRef(activeModule);
  useEffect(() => {
    activeModuleRef.current = activeModule;
  }, [activeModule]);

  const loadProductsRef = useRef(null);
  const loadSettingsRef = useRef(null);
  const loadCustomersRef = useRef(null);
  const loadPromotionsRef = useRef(null);
  const loadSalesHistoryRef = useRef(null);
  const syncOfflineSalesQueueRef = useRef(null);

  const countPendingOfflineSales = async () => {
    try {
      const counts = await syncManager.getPendingCount();
      setPendingSalesCount(counts.total);
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
  };

  const loadSalesHistory = async () => {
    let localItems = [];
    try {
      if (localDb && localDb.sales) {
        const orderedLocal = await localDb.sales.orderBy('created_at').reverse().limit(100).toArray();
        localItems = Array.isArray(orderedLocal) ? orderedLocal : [];
      }
    } catch (localErr) {
      console.warn('[MobilePOS] Error ordenando ventas locales, usando respaldo:', localErr?.message || localErr);
      try {
        const rawLocal = await localDb.sales.toArray();
        const sortedFallback = Array.isArray(rawLocal)
          ? [...rawLocal].sort((a, b) => {
            const ta = new Date(a?.created_at || a?.createdAt || a?.date || 0).getTime() || 0;
            const tb = new Date(b?.created_at || b?.createdAt || b?.date || 0).getTime() || 0;
            return tb - ta;
          })
          : [];
        localItems = sortedFallback.slice(0, 100);
      } catch (fallbackErr) {
        console.warn('[MobilePOS] Error leyendo ventas locales:', fallbackErr?.message || fallbackErr);
      }
    }

    let remoteItems = [];
    try {
      const res = await api.get('/sales?limit=100', { timeout: 8000 });
      const rawList = Array.isArray(res.data) 
        ? res.data 
        : (res.data?.data || res.data?.sales || res.data?.rows || []);
      remoteItems = Array.isArray(rawList) ? rawList : [];
    } catch (_e) {
      console.warn('[MobilePOS] Error al cargar ventas del servidor:', _e);
    }

    const map = new Map();
    localItems.forEach(s => map.set(String(s.id), s));
    remoteItems.forEach(s => {
      if (!map.has(String(s.id))) {
        map.set(String(s.id), { ...s, status: s.status || 'synced', isOffline: false });
      }
    });

    const getSortableTime = (saleObj) => {
      const candidate = saleObj?.created_at || saleObj?.createdAt || saleObj?.timestamp || saleObj?.date;
      const ms = candidate ? new Date(candidate).getTime() : 0;
      return Number.isFinite(ms) ? ms : 0;
    };

    const merged = Array.from(map.values()).sort((a, b) => getSortableTime(b) - getSortableTime(a));
    setSalesHistory(merged);

    await countPendingOfflineSales();
  };

  const syncOfflineSalesQueue = async () => {
    if (isSyncingSales || syncManager.isSyncing || window.__posOfflineSalesSyncLock) return;

    try {
      const countsBefore = await syncManager.getPendingCount();
      if (countsBefore.total === 0) {
        if (pendingSalesCount !== 0) setPendingSalesCount(0);
        return;
      }

      setIsSyncingSales(true);
      const result = await syncManager.executeBatchSync();
      const totalSynced = (result?.syncedSales || 0) + (result?.syncedQueue || 0);

      await countPendingOfflineSales();

      if (totalSynced > 0) {
        showToast(`✅ ${totalSynced} operación(es) offline sincronizada(s) con el servidor PC`);
        loadSalesHistory();
        loadProducts();
        loadCustomers();

        if (lanSyncService && lanSyncService.socket) {
          lanSyncService.socket.emit('inventory_changed', { timestamp: Date.now() });
        }
      }
    } catch (syncErr) {
      console.warn('[MOBILE SYNC] Servidor PC no respondió durante sincronización:', syncErr.message);
    } finally {
      setIsSyncingSales(false);
    }
  };


  const loadSettings = async () => {
    // 1. Restaurar de inmediato configuración y tasa desde la caché local (0 ms)
    try {
      const cachedBiz = localStorage.getItem('pos_cached_business_info');
      if (cachedBiz) {
        setBusinessInfo(prev => ({ ...prev, ...JSON.parse(cachedBiz) }));
      }
      const cachedRate = localStorage.getItem('pos_cached_exchange_rate');
      if (cachedRate) {
        const parsedRate = parseFloat(cachedRate);
        if (parsedRate && !isNaN(parsedRate)) {
          setExchangeRate(parsedRate);
        }
      }
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error parseando JSON local:', caughtErr?.message || caughtErr); }

    // 2. Revalidar en segundo plano contra el servidor PC si está disponible
    try {
      const [bizRes, rateRes] = await Promise.allSettled([
        api.get('/settings/business', { timeout: 3500 }),
        api.get('/settings/rate', { timeout: 3500 })
      ]);

      if (bizRes.status === 'fulfilled' && bizRes.value.data) {
        setBusinessInfo(prev => {
          const updated = { ...prev, ...bizRes.value.data };
          try { localStorage.setItem('pos_cached_business_info', JSON.stringify(updated)); } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
          return updated;
        });
        if (bizRes.value.data.businessMode) {
          setBusinessMode(bizRes.value.data.businessMode.toUpperCase());
          localStorage.setItem('pos_business_mode', bizRes.value.data.businessMode.toUpperCase());
        }
      }

      let rateLoaded = false;
      if (rateRes.status === 'fulfilled' && rateRes.value.data?.rate) {
        const rateVal = parseFloat(rateRes.value.data.rate);
        if (rateVal && !isNaN(rateVal)) {
          setExchangeRate(rateVal);
          try { localStorage.setItem('pos_cached_exchange_rate', String(rateVal)); } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
          rateLoaded = true;
        }
      }

      // Si la PC local no respondió (Ej: fuera del local con datos móviles), consultar Supabase Cloud 24/7
      if (!rateLoaded && hasSupabaseConfig()) {
        try {
          const cloudRes = await fetch(getSupabaseRestUrl('cloud_configuracion?id=eq.general&select=*'), {
            headers: getSupabaseHeaders()
          });
          if (cloudRes.ok) {
            const rows = await cloudRes.json();
            if (Array.isArray(rows) && rows.length > 0 && rows[0].tasa_cambio) {
              const cloudRate = parseFloat(rows[0].tasa_cambio);
              if (cloudRate && !isNaN(cloudRate) && cloudRate > 0) {
                setExchangeRate(prev => {
                  if (prev !== cloudRate) {
                    showToast('💱 Tasa oficial desde la Nube: Bs. ' + cloudRate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                  }
                  return cloudRate;
                });
                try {
                  localStorage.setItem('pos_cached_exchange_rate', String(cloudRate));
                  localStorage.setItem('pos_exchange_rate', String(cloudRate));
                } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
                console.log('[MobilePOSSimulator] ☁️ Tasa actualizada desde Supabase Cloud:', cloudRate);
              }
            }
          }
        } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      }
    } catch (e) {
      console.warn('Notice loading business settings:', e);
    }
  };

  const loadPromotions = async () => {
    try {
      if (localDb && localDb.promotions) {
        const cachedPromos = await localDb.promotions.toArray();
        if (Array.isArray(cachedPromos) && cachedPromos.length > 0) {
          setPromotions(cachedPromos.filter(p => p.isActive));
        }
      }
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

    try {
      const res = await api.get('/promotions', { timeout: 3500 });
      const raw = Array.isArray(res.data) ? res.data : (res.data?.promotions || []);
      const active = raw.filter(p => p.isActive);
      setPromotions(active);
      if (localDb && localDb.promotions) {
        localDb.promotions.clear().then(() => localDb.promotions.bulkPut(active)).catch((err) => console.warn('[MobilePOS] Error actualizando promociones en IDB:', err?.message || err));
      }
    } catch (_e) {
      // Preservar promociones locales en modo offline
    }
  };

  const catalogSignatureRef = useRef('');
  const computeCatalogSignature = (list) => {
    if (!Array.isArray(list) || list.length === 0) return '0';
    let sum = 0;
    const len = list.length;
    for (let i = 0; i < len; i++) {
      const p = list[i];
      sum += (Number(p.price || p.precio || 0) * 100) + Number(p.stockQuantity ?? p.stock ?? 0);
    }
    const first = list[0];
    const last = list[len - 1];
    return `${len}:${Math.round(sum)}:${first?.id || ''}:${last?.id || ''}:${last?.updatedAt || ''}`;
  };

  const loadProductsRetryTimerRef = useRef(null);
  const loadProducts = async (isRetry = false) => {
    // 1. Rendimiento Instantáneo: Cargar de inmediato desde la base de datos local (5 ms)
    let localCount = 0;
    try {
      let localItems = [];
      if (localDb && localDb.products) {
        localItems = await localDb.products.toArray();
      }
      if ((!localItems || localItems.length === 0) && primaryDb) {
        localItems = await primaryDb.getAll('products');
      }
      if (localItems && localItems.length > 0) {
        localCount = localItems.length;
        const localSig = computeCatalogSignature(localItems);
        if (catalogSignatureRef.current !== localSig) {
          catalogSignatureRef.current = localSig;
          setProducts(localItems);
        }
      }
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }


    // 2. Revalidación completa en segundo plano contra el servidor PC (incluyendo activos y agotados/inactivos)
    try {
      const [activeRes, inactiveRes] = await Promise.allSettled([
        api.get('/products?minimal=true&limit=0', { timeout: 15000 }),
        api.get('/products?minimal=true&limit=0&status=inactive', { timeout: 15000 })
      ]);

      const extractList = (settled) => {
        if (settled.status !== 'fulfilled' || !settled.value?.data) return [];
        const d = settled.value.data;
        return Array.isArray(d) ? d : (d.products || []);
      };

      const activeList = extractList(activeRes);
      const inactiveList = extractList(inactiveRes);

      const mergedMap = new Map();
      activeList.forEach(p => { if (p && p.id != null) mergedMap.set(String(p.id), p); });
      inactiveList.forEach(p => {
        if (p && p.id != null && !mergedMap.has(String(p.id))) {
          mergedMap.set(String(p.id), p);
        }
      });
      const raw = Array.from(mergedMap.values());

      if (raw.length > 0) {
        if (loadProductsRetryTimerRef.current) {
          clearTimeout(loadProductsRetryTimerRef.current);
          loadProductsRetryTimerRef.current = null;
        }

        // Preservar descuentos de stock de ventas offline aún pendientes (pending_sync) multiplicados por presentación
        let pendingDeductions = new Map();
        try {
          if (localDb && localDb.sales) {
            const pendSales = await localDb.sales.where('status').equals('pending_sync').toArray();
            for (const s of pendSales) {
              const items = Array.isArray(s.items) ? s.items : [];
              for (const it of items) {
                const pid = getCleanProductId(it.productId || it.id || '');
                const qty = Number(it.quantity || 0);
                const mult = Math.max(1, Number(it.factorConversion || it.unitsMultiplier || (it.isBulk ? it.unitsPerBulk : (it.isMidBulk ? it.unitsPerMidBulk : 1)) || 1));
                if (pid && qty > 0) {
                  pendingDeductions.set(pid, (pendingDeductions.get(pid) || 0) + (qty * mult));
                }
              }
            }
          }
        } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

        const adjustedRaw = pendingDeductions.size === 0
          ? raw
          : raw.map(p => {
              const deduct = pendingDeductions.get(String(p.id).trim()) || 0;
              if (deduct <= 0) return p;
              const curStock = Number(p.stockQuantity ?? p.stock ?? 0);
              const nextStock = Math.max(0, Number((curStock - deduct).toFixed(3)));
              return { ...p, stockQuantity: nextStock, stock: nextStock };
            });

        const remoteSig = computeCatalogSignature(adjustedRaw);
        if (catalogSignatureRef.current !== remoteSig || adjustedRaw.length !== localCount) {
          catalogSignatureRef.current = remoteSig;
          setProducts(adjustedRaw);
          setTimeout(async () => {
            try {
              await primaryDb.replaceAllAtomic('products', adjustedRaw, 'id').catch((err) => console.warn('[MobilePOS] Error sincronizando catalogo en primaryDb:', err?.message || err));
              if (localDb && localDb.products) {
                await localDb.transaction('rw', localDb.products, async () => {
                  const incomingIds = new Set(adjustedRaw.map(p => p.id).filter(Boolean));
                  const existingKeys = await localDb.products.toCollection().primaryKeys();
                  const keysToDelete = existingKeys.filter(
                    k => !incomingIds.has(k) && !String(k).startsWith('off_prod_')
                  );
                  if (keysToDelete.length > 0) {
                    await localDb.products.bulkDelete(keysToDelete);
                  }
                  await localDb.products.bulkPut(adjustedRaw);
                });
              }
              // Precacheo incremental en segundo plano de imágenes nuevas para disponibilidad 100% offline
              cacheAllProductImages(adjustedRaw, { concurrency: 2, yieldMs: 25 }).catch(() => {});
            } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
          }, 400);
        }
      } else if (!isRetry) {
        loadProductsRetryTimerRef.current = setTimeout(() => {
          loadProducts(true);
        }, 2200);
      }
    } catch (netErr) {
      console.warn('[MobilePOSSimulator] Error capturado en operación:', netErr?.message || netErr);
      // Si el servidor aún estaba siendo descubierto en la LAN al arrancar, reintentar una vez
      if (!isRetry) {
        loadProductsRetryTimerRef.current = setTimeout(() => {
          loadProducts(true);
        }, 2200);
      }
    }
  };

  const loadCustomers = async () => {
    // 1. Carga inmediata desde almacenamiento local en 0 ms
    if (localDb && localDb.customers) {
      try {
        const localC = await localDb.customers.toArray();
        if (localC && localC.length > 0) {
          setCustomers(localC);
        }
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
    }

    // 2. Revalidación en background si hay conexión con el servidor
    try {
      const res = await api.get('/customers?limit=100', { timeout: 3500 });
      const raw = Array.isArray(res.data) ? res.data : (res.data?.customers || []);
      if (raw.length > 0) {
        setCustomers(raw);
        if (localDb && localDb.customers) {
          localDb.customers.bulkPut(raw).catch((err) => console.warn('[MobilePOS] Error guardando clientes en IDB:', err?.message || err));
        }
      }
    } catch (_err) {
      // Modo offline: los clientes locales ya están en pantalla
    }
  };

  useEffect(() => {
    loadProductsRef.current = loadProducts;
    loadSettingsRef.current = loadSettings;
    loadCustomersRef.current = loadCustomers;
    loadPromotionsRef.current = loadPromotions;
    loadSalesHistoryRef.current = loadSalesHistory;
    syncOfflineSalesQueueRef.current = syncOfflineSalesQueue;
  });

  // Recargar ventas automáticamente al ingresar a Ventas o Caja
  useEffect(() => {
    if (activeModule === 'sales' || activeModule === 'cash') {
      loadSalesHistoryRef.current?.();
    }
  }, [activeModule]);

  // Carga inicial escalonada y Enlace Espejo WebSockets / LAN Sync (Cero bloqueo de UI en el arranque)
  useEffect(() => {
    if (!user) return;

    // Prioridad 0 (Inmediata): Catálogo y Tasa para que la terminal responda en 0 ms
    loadSettingsRef.current?.();
    loadProductsRef.current?.();

    // Prioridad 1 (Diferida 800ms): Datos secundarios sin bloquear el render inicial
    const secondaryInitTimer = setTimeout(() => {
      loadCustomersRef.current?.();
      loadPromotionsRef.current?.();
      countPendingOfflineSales();
    }, 800);

    // 1. Iniciar servicio LAN y WebSockets para efecto Espejo
    lanSyncService.init();

    // Verificación inmediata de socket LAN si ya estaba conectado
    if (lanSyncService.socket?.connected || lanSyncService.status?.state === 'CLOUD_ONLINE' || lanSyncService.status?.state === 'LAN_P2P_ACTIVE') {
      setLanSocketConnected(true);
      setIsOnline(true);
    }

    // Suscripción reactiva a cambios de topología LAN
    const unsubscribeLAN = lanSyncService.subscribe((status) => {
      const isLive = status?.state === 'CLOUD_ONLINE' || status?.state === 'LAN_P2P_ACTIVE' || Boolean(lanSyncService?.socket?.connected);
      setLanSocketConnected(isLive);
      if (isLive) setIsOnline(true);
    });

    const handleConnect = () => {
      setLanSocketConnected(true);
      setIsOnline(true);
      loadProductsRef.current?.();
      loadSettingsRef.current?.();
      syncOfflineSalesQueueRef.current?.();
    };

    const handleDisconnect = () => {
      setLanSocketConnected(false);
    };

    const handleNetworkOnline = () => {
      setIsOnline(true);
      loadProductsRef.current?.();
      loadSettingsRef.current?.();
      syncOfflineSalesQueueRef.current?.();
    };

    const handleNetworkOffline = () => {
      setIsOnline(false);
      setLanSocketConnected(false);
    };

    const handleRemoteInventoryChange = () => {
      console.log('[ESPEJO] Cambio de inventario en PC detectado vía Socket.IO');
      loadProductsRef.current?.();
    };

    const handleRemoteProductUpdate = (updatedProduct) => {
      if (!updatedProduct) return;
      console.log('[ESPEJO] Producto modificado en PC en tiempo real:', updatedProduct.name || updatedProduct.nombre);
      setProducts(prev => prev.map(p => String(p.id) === String(updatedProduct.id) ? { ...p, ...updatedProduct } : p));
      if (localDb && localDb.products) {
        localDb.products.put(updatedProduct).catch((err) => console.warn('[MobilePOS] Error persistiendo producto remoto en IDB:', err?.message || err));
      }
    };

    const handleStockUpdate = (evt) => {
      const items = evt.detail || [];
      if (Array.isArray(items) && items.length > 0) {
        setProducts(prev => prev.map(p => {
          const match = items.find(it => String(it.productId || it.id) === String(p.id));
          if (match) {
            const cur = Number(p.stockQuantity ?? p.stock ?? 0);
            const next = Math.max(0, cur - Number(match.quantity || 1));
            return { ...p, stockQuantity: next, stock: next };
          }
          return p;
        }));
      }
    };

    const handleServerDiscovered = () => {
      loadProductsRef.current?.();
      loadSettingsRef.current?.();
      syncOfflineSalesQueueRef.current?.();
      syncManager.executeBatchSync();
    };
    const handleSyncQueueUpdated = () => {
      countPendingOfflineSales();
    };
    const handleLanSyncTrigger = () => {
      syncOfflineSalesQueueRef.current?.();
    };

    window.addEventListener('online', handleNetworkOnline);
    window.addEventListener('offline', handleNetworkOffline);
    window.addEventListener('lan-sync-trigger', handleLanSyncTrigger);
    window.addEventListener('lan-stock-update-received', handleStockUpdate);
    window.addEventListener('server-discovered', handleServerDiscovered);
    window.addEventListener('offline-sales-synced', handleSyncQueueUpdated);
    window.addEventListener('sync-queue-updated', handleSyncQueueUpdated);

    const handleSettingsChanged = (payload) => {
      if (payload?.rate) {
        const newRate = parseFloat(payload.rate);
        if (!isNaN(newRate) && newRate > 0) {
          setExchangeRate(newRate);
          try { localStorage.setItem('pos_cached_exchange_rate', String(newRate)); } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
          showToast(`💱 Tasa oficial actualizada en tiempo real: Bs. ${newRate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        }
      }
      loadSettingsRef.current?.();
    };

    const handleRemoteCustomersChanged = () => {
      loadCustomersRef.current?.();
    };

    const handleRemotePromotionsChanged = () => {
      loadPromotionsRef.current?.();
    };

    const handleRemoteSaleCompleted = () => {
      loadProductsRef.current?.();
      if (activeModuleRef.current === 'sales' || activeModuleRef.current === 'cash') {
        loadSalesHistoryRef.current?.();
      }
    };

    const activeSocket = socketContext?.socket;

    if (lanSyncService.socket) {
      lanSyncService.socket.on('connect', handleConnect);
      lanSyncService.socket.on('disconnect', handleDisconnect);
      lanSyncService.socket.on('inventory_changed', handleRemoteInventoryChange);
      lanSyncService.socket.on('product_updated', handleRemoteProductUpdate);
      lanSyncService.socket.on('settings_changed', handleSettingsChanged);
      lanSyncService.socket.on('customers_changed', handleRemoteCustomersChanged);
      lanSyncService.socket.on('promotions_updated', handleRemotePromotionsChanged);
      lanSyncService.socket.on('promotions_changed', handleRemotePromotionsChanged);
      lanSyncService.socket.on('sale_completed', handleRemoteSaleCompleted);
    }

    if (activeSocket) {
      activeSocket.on('connect', handleConnect);
      activeSocket.on('disconnect', handleDisconnect);
      activeSocket.on('inventory_changed', handleRemoteInventoryChange);
      activeSocket.on('product_updated', handleRemoteProductUpdate);
      activeSocket.on('settings_changed', handleSettingsChanged);
      activeSocket.on('customers_changed', handleRemoteCustomersChanged);
      activeSocket.on('promotions_updated', handleRemotePromotionsChanged);
      activeSocket.on('promotions_changed', handleRemotePromotionsChanged);
      activeSocket.on('sale_completed', handleRemoteSaleCompleted);
    }

    // Iniciar demonio unificado de sincronización con prioridad DAG y Backoff Exponencial
    const stopAutoSyncDaemon = syncManager.startAutoSync(15000);

    // Sincronización en tiempo real 24/7 de Tasa de Cambio desde Supabase
    cloudRateSyncService.init();
    const unsubCloudRate = cloudRateSyncService.subscribe((data) => {
      if (data?.rate && !isNaN(data.rate) && data.rate > 0) {
        setExchangeRate((prev) => {
          if (prev !== data.rate) {
            showToast('⚡ Tasa oficial actualizada: Bs. ' + data.rate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
          }
          return data.rate;
        });
      }
    });

    const handleRateUpdatedEvent = (e) => {
      if (e?.detail?.rate) {
        const val = Number(e.detail.rate);
        if (!isNaN(val) && val > 0) {
          setExchangeRate((prev) => {
            if (prev !== val) {
              showToast('⚡ Tasa oficial actualizada: Bs. ' + val.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            }
            return val;
          });
        }
      }
    };
    window.addEventListener('pos-exchange-rate-updated', handleRateUpdatedEvent);

    // Suscripción al spooler de impresión en segundo plano y audio
    const unsubSpooler = mobilePrinterService.subscribeQueue((status) => {
      setPrinterSpoolerStatus(status);
    });

    const handleMuteChange = (e) => {
      if (e.detail?.muted !== undefined) {
        setIsAudioMuted(e.detail.muted);
      }
    };
    window.addEventListener('pos-sound-mute-changed', handleMuteChange);

    // Auto-sync periódico de respaldo cada 30 segundos
    const syncInterval = setInterval(() => {
      syncOfflineSalesQueueRef.current?.();
    }, 30000);

    return () => {
      if (lanSyncService.socket) {
        lanSyncService.socket.off('connect', handleConnect);
        lanSyncService.socket.off('disconnect', handleDisconnect);
        lanSyncService.socket.off('inventory_changed', handleRemoteInventoryChange);
        lanSyncService.socket.off('product_updated', handleRemoteProductUpdate);
        lanSyncService.socket.off('settings_changed', handleSettingsChanged);
        lanSyncService.socket.off('customers_changed', handleRemoteCustomersChanged);
        lanSyncService.socket.off('promotions_updated', handleRemotePromotionsChanged);
        lanSyncService.socket.off('promotions_changed', handleRemotePromotionsChanged);
        lanSyncService.socket.off('sale_completed', handleRemoteSaleCompleted);
      }
      if (activeSocket) {
        activeSocket.off('connect', handleConnect);
        activeSocket.off('disconnect', handleDisconnect);
        activeSocket.off('inventory_changed', handleRemoteInventoryChange);
        activeSocket.off('product_updated', handleRemoteProductUpdate);
        activeSocket.off('settings_changed', handleSettingsChanged);
        activeSocket.off('customers_changed', handleRemoteCustomersChanged);
        activeSocket.off('promotions_updated', handleRemotePromotionsChanged);
        activeSocket.off('promotions_changed', handleRemotePromotionsChanged);
        activeSocket.off('sale_completed', handleRemoteSaleCompleted);
      }
      if (typeof stopAutoSyncDaemon === 'function') {
        stopAutoSyncDaemon();
      }
      if (typeof unsubCloudRate === 'function') {
        unsubCloudRate();
      }
      window.removeEventListener('pos-exchange-rate-updated', handleRateUpdatedEvent);
      unsubSpooler();
      unsubscribeLAN();
      window.removeEventListener('pos-sound-mute-changed', handleMuteChange);
      window.removeEventListener('online', handleNetworkOnline);
      window.removeEventListener('offline', handleNetworkOffline);
      window.removeEventListener('lan-sync-trigger', handleLanSyncTrigger);
      window.removeEventListener('lan-stock-update-received', handleStockUpdate);
      window.removeEventListener('server-discovered', handleServerDiscovered);
      window.removeEventListener('offline-sales-synced', handleSyncQueueUpdated);
      window.removeEventListener('sync-queue-updated', handleSyncQueueUpdated);
      clearInterval(syncInterval);
      clearTimeout(secondaryInitTimer);
    };
  }, [user, socketContext?.socket, showToast]);

  // Buscador y filtrado dinámico de clientes (60 FPS, tolerante a acentos, puntos, guiones y espacios en Cédula/RIF)
  const filteredCustomers = useMemo(() => {
    const rawQ = customerSearch.trim();
    if (!rawQ) return customers;
    const q = stripAccents(rawQ);
    const qDigits = rawQ.replace(/\D/g, '');
    const qAlphanum = rawQ.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    return customers.filter(c => {
      const name = stripAccents(c.name || c.nombre || '');
      const rawDoc = String(c.identification || c.idDocument || c.doc || c.rif || '');
      const doc = stripAccents(rawDoc);
      const docDigits = rawDoc.replace(/\D/g, '');
      const docAlphanum = rawDoc.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const phone = stripAccents(c.phone || c.telefono || '');
      const phoneDigits = String(c.phone || c.telefono || '').replace(/\D/g, '');

      if (name.includes(q) || doc.includes(q) || phone.includes(q)) return true;
      if (qDigits.length >= 3 && docDigits.includes(qDigits)) return true;
      if (qAlphanum.length >= 3 && docAlphanum.includes(qAlphanum)) return true;
      if (qDigits.length >= 4 && phoneDigits.includes(qDigits)) return true;

      return false;
    });
  }, [customers, customerSearch]);

  // Selección de cliente para la venta actual
  const handleSelectCustomer = (c) => {
    if (!c) {
      setSelectedCustomer(null);
      setCustomerName('Consumidor Final');
      setCustomerDoc(isDollarCountry ? '0000000000' : 'V-00000000');
      setCustomerPhone('');
      showToast('Cliente: Consumidor Final');
    } else {
      setSelectedCustomer(c);
      const name = c.name || c.nombre || 'Cliente';
      const doc = c.identification || c.idDocument || c.doc || c.rif || (isDollarCountry ? '0000000000' : 'V-00000000');
      const phone = c.phone || c.telefono || '';
      setCustomerName(name);
      setCustomerDoc(doc);
      setCustomerPhone(phone);
      if (phone) {
        setWhatsAppPhoneInput(phone);
      }
      showToast(`Cliente: ${name}`);
    }
    triggerHaptic(15);
    playSuccessSound();
    setIsCustomerSelectModalOpen(false);
    setIsCreatingCustomerInMobile(false);
  };

  // Registro y guardado/edición de cliente desde el POS Móvil
  const handleSaveNewCustomer = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanName = newCustomerForm.name.trim();
    if (!cleanName) {
      showToast('⚠️ Ingresa el nombre del cliente');
      return;
    }

    setIsSavingCustomer(true);
    try {
      const cleanDoc = newCustomerForm.idDocument.trim() || (isDollarCountry ? '0000000000' : 'V-00000000');
      const cleanPhone = newCustomerForm.phone.trim();
      const cleanAddress = newCustomerForm.address.trim();
      const cleanCredit = parseFloat(newCustomerForm.creditLimit) || 0;

      const payload = {
        name: cleanName,
        idDocument: cleanDoc,
        phone: cleanPhone,
        address: cleanAddress,
        creditLimit: cleanCredit,
        creditBalance: 0,
        loyaltyPoints: 0,
        isActive: true
      };

      const isEditing = Boolean(newCustomerForm.id);

      if (isEditing) {
        // --- MODO ACTUALIZACIÓN ---
        let updatedCust = null;
        try {
          const res = await api.put(`/customers/${newCustomerForm.id}`, payload, { timeout: 4000 });
          updatedCust = res.data?.customer || res.data;
        } catch (netErr) {
          console.warn('Fallo de red al actualizar cliente online, actualizando en modo local/offline:', netErr);
        }

        const mergedCust = {
          ...payload,
          id: newCustomerForm.id,
          identification: cleanDoc,
          ...(updatedCust || {})
        };

        if (localDb && localDb.customers) {
          await localDb.customers.put(mergedCust).catch((err) => console.warn('[MobilePOS] Error actualizando cliente en IDB:', err?.message || err));
        }
        if (!updatedCust) {
          try {
            await primaryDb.put('syncQueue', {
              id: `cust_update_${newCustomerForm.id}_${Date.now()}`,
              endpoint: `/customers/${newCustomerForm.id}`,
              method: 'PUT',
              payload,
              timestamp: Date.now()
            });
            countPendingOfflineSales();
          } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
        }

        // Actualizar lista en memoria
        setCustomers(prev => prev.map(c => String(c.id) === String(newCustomerForm.id) ? { ...c, ...mergedCust } : c));

        // Si era el cliente activo en la venta, refrescar datos
        if (selectedCustomer && String(selectedCustomer.id) === String(newCustomerForm.id)) {
          setSelectedCustomer(mergedCust);
          setCustomerName(cleanName);
          setCustomerDoc(cleanDoc);
          setCustomerPhone(cleanPhone);
        }

        triggerHaptic(25);
        playSuccessSound();
        showToast(`✅ Cliente "${cleanName}" actualizado con éxito`);
      } else {
        // --- MODO CREACIÓN NUEVO ---
        let createdCust = null;
        try {
          const res = await api.post('/customers', payload, { timeout: 4000 });
          createdCust = res.data?.customer || res.data;
        } catch (netErr) {
          console.warn('Fallo de red al crear cliente online, creando en modo local/offline:', netErr);
        }

        if (!createdCust || !createdCust.id) {
          const tempId = `cust_off_${Date.now()}`;
          createdCust = {
            ...payload,
            id: tempId,
            identification: cleanDoc,
            status: 'pending_sync',
            created_at: new Date().toISOString()
          };

          if (localDb && localDb.customers) {
            await localDb.customers.put(createdCust).catch((err) => console.warn('[MobilePOS] Error guardando nuevo cliente offline en IDB:', err?.message || err));
          }
          try {
            await primaryDb.put('syncQueue', {
              id: `cust_sync_${Date.now()}`,
              tempLocalId: tempId,
              endpoint: '/customers',
              method: 'POST',
              payload,
              timestamp: Date.now()
            });
            countPendingOfflineSales();
          } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
        }

        // Añadir a la lista en memoria
        setCustomers(prev => [createdCust, ...prev]);

        // Seleccionar automáticamente al nuevo cliente en la venta
        setSelectedCustomer(createdCust);
        setCustomerName(createdCust.name || cleanName);
        setCustomerDoc(createdCust.idDocument || createdCust.doc || createdCust.identification || cleanDoc);
        setCustomerPhone(createdCust.phone || cleanPhone);
        if (cleanPhone) {
          setWhatsAppPhoneInput(cleanPhone);
        }

        triggerHaptic(25);
        playSuccessSound();
        showToast(`✅ Cliente "${cleanName}" creado y seleccionado`);
      }

      // Limpiar formulario y cerrar modal
      setNewCustomerForm({
        id: null,
        name: '',
        idDocument: '',
        phone: '',
        address: '',
        email: '',
        creditLimit: '0'
      });
      setIsCreatingCustomerInMobile(false);
      setIsCustomerSelectModalOpen(false);
    } catch (err) {
      console.error('Error al guardar cliente:', err);
      showToast('❌ Error al guardar cliente');
      playErrorSound();
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // Pausar Venta Actual (Venta en Espera)
  const handleHoldSale = () => {
    if (cart.length === 0) return;
    const newHeldSale = {
      id: `held_${Date.now()}`,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      items: [...cart],
      customerName,
      customerDoc,
      totalUSD,
      totalBS,
      itemCount: totalItemsCount
    };
    const updated = [newHeldSale, ...heldSales];
    setHeldSales(updated);
    try { localStorage.setItem('pos_held_sales', JSON.stringify(updated)); } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
    setCart([]);
    setIsMobileCartOpen(false);
    showToast(`⏸️ Venta pausada (${totalItemsCount} productos guardados en espera)`);
  };

  // 📤 Enviar Preventa a Caja Principal (Despacho a PC de Caja para cobro inmediato)
  const handleSendPreSaleToMainRegister = () => {
    if (cart.length === 0) {
      showToast('⚠️ El carrito de venta está vacío');
      return;
    }
    const preSaleCode = `PV-${Math.floor(100 + Math.random() * 900)}`;
    const activeCust = selectedCustomer || (customerName && customerName !== 'Consumidor Final' ? {
      id: selectedCustomer?.id || null,
      name: customerName,
      idDocument: customerDoc,
      doc: customerDoc,
      identification: customerDoc,
      phone: customerPhone
    } : null);

    const preSalePayload = {
      id: `presale_${Date.now()}`,
      code: preSaleCode,
      type: 'remote_preventa',
      source: 'Móvil',
      sellerName: user?.name || user?.username || 'Vendedor Móvil',
      terminalId: getTerminalId() || 'terminal_mobile',
      table: selectedTable || null,
      tableNumber: selectedTable || null,
      orderNotes: orderNotes ? orderNotes.trim() : '',
      note: selectedTable ? `🍽️ ${selectedTable}${orderNotes ? ` - ${orderNotes}` : ''}` : (orderNotes ? orderNotes.trim() : ''),
      customerId: activeCust?.id || null,
      customerName: activeCust?.name || customerName || 'Consumidor Final',
      customerDoc: activeCust?.idDocument || activeCust?.identification || customerDoc || '',
      customerPhone: activeCust?.phone || customerPhone || '',
      customer: activeCust,
      totalUSD,
      totalBS,
      exchangeRate,
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      itemCount: totalItemsCount,
      items: [...cart],
      companyId: user?.companyId || '1'
    };

    // 1. Doble Canal Híbrido: Socket.IO en tiempo real + Fallback REST API
    try {
      if (socket && socket.connected) {
        socket.emit('remote_held_sale', preSalePayload);
      }
      if (lanSyncService.socket && lanSyncService.socket.connected) {
        lanSyncService.socket.emit('remote_held_sale', preSalePayload);
      }
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }

    // Respaldo REST API garantizado (retransmite a todas las cajas y almacena)
    try {
      api.post('/sales/remote-held-sale', preSalePayload, { timeout: 3500 })
        .catch(err => console.warn('Aviso HTTP remote-held-sale:', err?.message || err));
    } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en operación auxiliar:', caughtErr?.message || caughtErr); }

    // 2. Guardar también en ventas pausadas locales como respaldo
    const updated = [preSalePayload, ...heldSales];
    setHeldSales(updated);
    try { localStorage.setItem('pos_held_sales', JSON.stringify(updated)); } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }

    // 3. Limpiar carrito, mesa, notas y cerrar drawer
    setCart([]);
    setSelectedCustomer(null);
    setSelectedTable(null);
    setOrderNotes('');
    setCustomerName('Consumidor Final');
    setCustomerDoc(isDollarCountry ? '0000000000' : 'V-00000000');
    setCustomerPhone('');
    setIsMobileCartOpen(false);
    triggerHaptic(30);
    playSuccessSound();

    // 4. Mostrar modal de confirmación con ticket para el cliente
    setPreSaleSentModal(preSalePayload);
  };

  // Reanudar Venta en Espera (Soporta intercambio automático con venta activa o reemplazo seguro)
  const handleRestoreHeldSale = (saleId, options = {}) => {
    const sale = heldSales.find(s => s.id === saleId);
    if (!sale) return;

    let updatedHeld = heldSales.filter(s => s.id !== saleId);

    // Si el usuario decide intercambiar ('swapCurrent'), guardamos el carrito actual en espera
    if (cart.length > 0 && options.swapCurrent) {
      const currentSnapshot = {
        id: `held_${Date.now()}`,
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        items: [...cart],
        customerName: customerName || 'Consumidor Final',
        customerDoc: customerDoc || '',
        customer: selectedCustomer || null,
        customerId: selectedCustomer?.id || null,
        totalUSD: totalUSD,
        totalBS: totalBS,
        itemCount: cart.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0)
      };
      updatedHeld = [currentSnapshot, ...updatedHeld];
    }

    const normalizedRestoredItems = normalizeMobileCartItems(sale.items, productsMap);
    setCart(normalizedRestoredItems);
    if (sale.customerName) setCustomerName(sale.customerName);
    if (sale.customerDoc) setCustomerDoc(sale.customerDoc);
    if (sale.customer) setSelectedCustomer(sale.customer);
    else if (sale.customerName && sale.customerName !== 'Consumidor Final') {
      setSelectedCustomer({
        id: sale.customerId || null,
        name: sale.customerName,
        idDocument: sale.customerDoc || '',
        doc: sale.customerDoc || ''
      });
    } else {
      setSelectedCustomer(null);
    }

    setHeldSales(updatedHeld);
    try { localStorage.setItem('pos_held_sales', JSON.stringify(updatedHeld)); } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
    setIsHeldSalesModalOpen(false);
    setIsMobileCartOpen(true);
    triggerHaptic(20);
    showToast(`▶️ Venta reanudada (${sale.items?.length || sale.itemCount || 0} ítems en carrito)`);
  };

  // Eliminar Venta en Espera
  const handleDeleteHeldSale = (saleId) => {
    const updated = heldSales.filter(s => s.id !== saleId);
    setHeldSales(updated);
    try { localStorage.setItem('pos_held_sales', JSON.stringify(updated)); } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
    showToast('Venta en espera eliminada');
  };

  // Agregar Ítem Rápido / Manual (Soporta ingreso tanto en USD como en Bs)
  const handleAddManualItem = (e) => {
    e?.preventDefault();
    const name = manualItemName.trim() || 'Ítem Rápido / Varios';
    const rawUsd = parseFloat(manualItemPrice);
    const rawBs = parseFloat(manualItemPriceBS);
    const price = (!isNaN(rawUsd) && rawUsd > 0)
      ? rawUsd
      : ((!isNaN(rawBs) && rawBs > 0 && exchangeRate > 0) ? Number((rawBs / exchangeRate).toFixed(4)) : NaN);
    const qty = parseFloat(manualItemQty) || 1;
    if (isNaN(price) || price <= 0) {
      showToast('Ingresa un precio válido en USD o en Bs');
      return;
    }
    const customProd = {
      id: `manual_${Date.now()}`,
      name,
      nombre: name,
      price,
      precio: price,
      priceBs: (!isNaN(rawBs) && rawBs > 0) ? rawBs : Number((price * exchangeRate).toFixed(2)),
      stockQuantity: 9999,
      stock: 9999,
      isCustom: true,
      category: 'Varios'
    };
    setCart(prev => [...prev, { product: customProd, quantity: qty }]);
    setManualItemName('');
    setManualItemPrice('');
    setManualItemPriceBS('');
    setManualItemQty('1');
    setIsManualItemModalOpen(false);
    setIsMobileCartOpen(true);
    showToast(`+${qty} ${name} agregado al carrito`);
  };

  // Abrir Modal de Edición Rápida de Producto
  const openEditProduct = useCallback((product) => {
    if (!canEditCatalogMobile) {
      showToast('No tienes permisos para editar productos', 'error');
      return;
    }
    const priceU = Number(product.price || product.precio || 0);
    const priceB = Number(product.priceBs) > 0 ? Number(product.priceBs) : (priceU * exchangeRate);
    const costU = Number(product.cost || product.costo || 0);
    const computedMargin = (product.margin !== undefined && product.margin !== null && String(product.margin) !== '')
      ? Number(product.margin).toFixed(1).replace(/\.0$/, '')
      : (costU > 0 && priceU > 0 ? (((priceU - costU) / costU) * 100).toFixed(1).replace(/\.0$/, '') : '');

    const upb = Number(product.unitsPerBulk || 0);
    const bp = Number(product.bulkPrice || 0);
    const upmb = Number(product.unitsPerMidBulk || 0);
    const mbp = Number(product.midBulkPrice || 0);

    setProductFormData({
      id: product.id,
      name: product.name || product.nombre || '',
      barcode: product.barcode || product.codigo_barras || '',
      category: product.category || product.categoria || 'General',
      priceUSD: priceU ? String(priceU) : '',
      priceBS: priceB ? String(priceB.toFixed(2)) : '',
      costUSD: costU > 0 ? String(costU) : '',
      margin: computedMargin,
      stock: String(product.stockQuantity ?? product.stock ?? 0),
      minStock: String(product.minStock ?? 2),
      stockUnit: product.stockUnit || 'und',
      isSoldByWeight: Boolean(product.isSoldByWeight),
      allowNegative: Boolean(product.allowNegative),
      taxStatus: product.taxStatus || 'gravable',
      imageUri: product.imageUrl || product.imageUri || product.image || '',
      // Venta al mayor / empaque
      bulkUnitName: product.bulkUnitName || 'Caja',
      unitsPerBulk: upb > 1 ? String(upb) : '',
      bulkPrice: bp > 0 ? String(bp) : '',
      bulkPriceBs: (product.bulkPriceBs && Number(product.bulkPriceBs) > 0) ? String(product.bulkPriceBs) : (bp > 0 ? String((bp * exchangeRate).toFixed(2)) : ''),
      bulkBarcode: product.bulkBarcode || '',
      bulkCost: product.bulkCost ? String(product.bulkCost) : '',
      // Media caja
      enableMidBulk: Boolean(upmb > 1 || mbp > 0),
      midBulkUnitName: product.midBulkUnitName || 'Media Caja',
      unitsPerMidBulk: upmb > 1 ? String(upmb) : '',
      midBulkPrice: mbp > 0 ? String(mbp) : '',
      midBulkPriceBs: (product.midBulkPriceBs && Number(product.midBulkPriceBs) > 0) ? String(product.midBulkPriceBs) : (mbp > 0 ? String((mbp * exchangeRate).toFixed(2)) : ''),
      midBulkBarcode: product.midBulkBarcode || '',
      // Control y farmacia / lote
      batchNumber: product.batchNumber || '',
      expirationDate: product.expirationDate || '',
      es_controlado: Boolean(product.es_controlado),
      principio_activo: product.principio_activo || '',
      description: product.description || '',
      isNew: false
    });
    setIsCustomCategoryMode(false);
    setIsQuickProductModalOpen(true);
  }, [exchangeRate, canEditCatalogMobile, showToast]);


  const handleOpenBulkPicker = useCallback((prod) => {
    setSelectedProductForBulk(prod);
  }, []);

  // Abrir Modal de Creación Rápida de Producto
  const openCreateProduct = (initialBarcode = '') => {
    const rawBarcode = typeof initialBarcode === 'string' ? initialBarcode.trim() : '';
    setProductFormData({
      id: null,
      name: '',
      barcode: rawBarcode || `750${Math.floor(100000000 + Math.random() * 900000000)}`,
      category: selectedCategory !== 'Todos' ? selectedCategory : 'General',
      priceUSD: '',
      priceBS: '',
      costUSD: '',
      margin: '30',
      stock: '10',
      minStock: '2',
      stockUnit: 'und',
      isSoldByWeight: false,
      allowNegative: false,
      taxStatus: 'gravable',
      imageUri: '',
      // Venta al mayor
      bulkUnitName: 'Caja',
      unitsPerBulk: '',
      bulkPrice: '',
      bulkPriceBs: '',
      bulkBarcode: '',
      bulkCost: '',
      enableMidBulk: false,
      midBulkUnitName: 'Media Caja',
      unitsPerMidBulk: '',
      midBulkPrice: '',
      midBulkPriceBs: '',
      midBulkBarcode: '',
      // Control / Farmacia
      batchNumber: '',
      expirationDate: '',
      es_controlado: false,
      principio_activo: '',
      description: '',
      isNew: true
    });
    setIsCustomCategoryMode(false);
    setUnregisteredBarcodeNotice(null);
    setIsQuickProductModalOpen(true);
  };

  // Copiar Código de Barras al Portapapeles (Nativo + Web)
  const copyBarcodeToClipboard = async (codeToCopy) => {
    const text = String(codeToCopy || '').trim();
    if (!text) return;
    triggerHaptic(15);
    let ok = false;
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.copyToClipboard) {
      try {
        await window.Capacitor.Plugins.PosNativeHardware.copyToClipboard({ text });
        ok = true;
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
    }
    if (!ok) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (_e) {
        try {
          const el = document.createElement('textarea');
          el.value = text;
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
          ok = true;
        } catch { /* Copia fallback legacy bloqueada por políticas del navegador */ }
      }
    }
    showToast(`📋 Código copiado: ${text}`);
  };

  // Generar Código EAN Interno Único para Productos sin Código
  const generateInternalEanBarcode = () => {
    const randomDigits = Math.floor(Math.random() * 90000000000) + 10000000000;
    const code = `99${randomDigits}`;
    setProductFormData(prev => ({ ...prev, barcode: code }));
    triggerHaptic(20);
    showToast('✨ Código interno generado');
  };

  // Subir o Cambiar Foto de Producto en Alta Definición
  const handleProductImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      showToast('⚠️ La imagen es demasiado pesada (máx 15MB)');
      return;
    }

    try {
      setIsUploadingImage(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64 = event.target.result;
          let imgUri = '';
          try {
            const res = await api.post('/products/upload-image', {
              base64,
              productId: productFormData.id || 'new'
            }, { timeout: 6000 });
            imgUri = res.data?.imageUri || '';
            showToast('✅ Foto cargada en Alta Definición');
          } catch (uploadErr) {
            console.warn('Fallback offline para imagen:', uploadErr);
            imgUri = base64;
            showToast('⚡ Foto guardada localmente (Offline)');
          }
          setProductFormData(prev => ({
            ...prev,
            imageUri: imgUri
          }));
        } catch (err) {
          console.error('Error subiendo imagen:', err);
          showToast('❌ Error al procesar imagen');
        } finally {
          setIsUploadingImage(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsUploadingImage(false);
    }
  };

  // Guardar Cambios de Producto (Servidor PC + Espejo + Fallback Offline)
  const handleSaveProduct = async (e) => {
    e?.preventDefault();
    const name = productFormData.name.trim();
    const price = parseFloat(productFormData.priceUSD);
    const stock = parseFloat(productFormData.stock);
    const cost = parseFloat(productFormData.costUSD) || 0;
    const margin = parseFloat(productFormData.margin) || (cost > 0 && price > 0 ? Number((((price - cost) / cost) * 100).toFixed(2)) : 0);
    const barcode = productFormData.barcode.trim();

    if (!name) {
      showToast('El producto debe tener un nombre');
      return;
    }
    if (isNaN(price) || price < 0) {
      showToast('Ingresa un precio válido en USD');
      return;
    }
    if (isNaN(stock) || stock < 0) {
      showToast('Ingresa un stock numérico válido');
      return;
    }

    setIsSavingProduct(true);
    const upb = parseFloat(productFormData.unitsPerBulk) || 1;
    const bp = parseFloat(productFormData.bulkPrice) || (upb > 1 && price > 0 ? Number((price * upb).toFixed(2)) : 0);
    const upmb = productFormData.enableMidBulk ? (parseFloat(productFormData.unitsPerMidBulk) || 0) : 0;
    const mbp = productFormData.enableMidBulk ? (parseFloat(productFormData.midBulkPrice) || 0) : 0;

    const payload = {
      name,
      nombre: name,
      barcode,
      category: productFormData.category || 'General',
      categoria: productFormData.category || 'General',
      price,
      precio: price,
      priceBs: price * exchangeRate,
      cost,
      costo: cost,
      margin,
      stockQuantity: stock,
      stock: stock,
      minStock: parseFloat(productFormData.minStock) || 0,
      stockUnit: productFormData.stockUnit || 'und',
      isSoldByWeight: Boolean(productFormData.isSoldByWeight),
      allowNegative: Boolean(productFormData.allowNegative),
      taxStatus: productFormData.taxStatus || 'gravable',
      imageUri: productFormData.imageUri || null,
      imageUrl: productFormData.imageUri || null,
      // Mayor / Empaque
      bulkUnitName: productFormData.bulkUnitName || 'Caja',
      unitsPerBulk: upb,
      bulkPrice: bp,
      bulkPriceBs: bp > 0 ? (bp * exchangeRate) : 0,
      bulkBarcode: productFormData.bulkBarcode ? productFormData.bulkBarcode.trim() : null,
      bulkCost: parseFloat(productFormData.bulkCost) || (cost * upb),
      // Media caja
      midBulkUnitName: productFormData.midBulkUnitName || 'Media Caja',
      unitsPerMidBulk: upmb,
      midBulkPrice: mbp,
      midBulkPriceBs: mbp > 0 ? (mbp * exchangeRate) : 0,
      midBulkBarcode: productFormData.midBulkBarcode ? productFormData.midBulkBarcode.trim() : null,
      // Farmacia / Trazabilidad
      batchNumber: productFormData.batchNumber ? productFormData.batchNumber.trim() : null,
      expirationDate: productFormData.expirationDate || null,
      es_controlado: Boolean(productFormData.es_controlado),
      principio_activo: productFormData.principio_activo ? productFormData.principio_activo.trim() : null,
      description: productFormData.description ? productFormData.description.trim() : null
    };

    try {
      let savedProd;
      if (productFormData.isNew) {
        const res = await api.post('/products', payload, { timeout: 5000 });
        savedProd = res.data?.product || res.data || { ...payload, id: `p_${Date.now()}` };
        setProducts(prev => [savedProd, ...prev]);
        showToast(`✅ Producto "${name}" creado exitosamente`);
      } else {
        const prodId = productFormData.id;
        const res = await api.put(`/products/${prodId}`, payload, { timeout: 5000 });
        savedProd = res.data?.product || res.data || { ...payload, id: prodId };
        setProducts(prev => prev.map(p => String(p.id) === String(prodId) ? { ...p, ...savedProd } : p));
        showToast(`✅ "${name}" actualizado en el servidor PC`);
      }

      if (localDb && localDb.products) {
        await localDb.products.put(savedProd).catch((err) => console.warn('[MobilePOS] Error guardando producto en IDB:', err?.message || err));
      }

      try {
        if (lanSyncService.socket) {
          lanSyncService.socket.emit('product_updated', savedProd);
          lanSyncService.socket.emit('inventory_changed', { timestamp: Date.now() });
        }
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }

      setIsQuickProductModalOpen(false);
    } catch (err) {
      console.warn('Error al guardar en servidor PC, aplicando fallback local:', err);
      const fallbackId = productFormData.isNew ? `off_prod_${Date.now()}` : productFormData.id;
      const fallbackProd = { ...payload, id: fallbackId };
      
      if (productFormData.isNew) {
        setProducts(prev => [fallbackProd, ...prev]);
      } else {
        setProducts(prev => prev.map(p => String(p.id) === String(fallbackId) ? { ...p, ...fallbackProd } : p));
      }

      if (localDb && localDb.products) {
        await localDb.products.put(fallbackProd).catch((err) => console.warn('[MobilePOS] Error guardando producto fallback en IDB:', err?.message || err));
      }

      try {
        await primaryDb.put('syncQueue', {
          id: `prod_sync_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          tempLocalId: fallbackId,
          endpoint: productFormData.isNew ? '/products' : `/products/${fallbackId}`,
          method: productFormData.isNew ? 'POST' : 'PUT',
          payload,
          createdAt: new Date().toISOString()
        });
        countPendingOfflineSales();
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }

      showToast(`⚡ Guardado localmente en modo offline. Se sincronizará con la PC.`);
      setIsQuickProductModalOpen(false);
    } finally {
      setIsSavingProduct(false);
    }
  };

  // Normalización de Categorías y Conteo por Categoría (Idéntico a ProductGrid de Escritorio)
  const { normalizedCategories, categoryCounts } = useMemo(() => {
    const catMap = new Map();
    let noStockCount = 0;
    products.forEach(p => {
      const stock = Number(p.stockQuantity ?? p.stock ?? 0);
      const isService = Boolean(p.isService || String(p.category || p.categoria || '').trim().toLowerCase() === 'servicios');
      if (!isService && stock <= 0) {
        noStockCount++;
      }
      const rawCat = p.category || p.categoria || 'General';
      const clean = rawCat.trim().toLowerCase();
      const title = clean.charAt(0).toUpperCase() + clean.slice(1);
      catMap.set(title, (catMap.get(title) || 0) + 1);
    });

    const sortedCats = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    const counts = {
      Todos: products.length,
      '🚫 Productos sin stock': noStockCount
    };
    catMap.forEach((val, key) => {
      counts[key] = val;
    });

    const finalCategories = ['Todos', ...sortedCats];
    if (noStockCount > 0) {
      finalCategories.push('🚫 Productos sin stock');
    }

    return {
      normalizedCategories: finalCategories,
      categoryCounts: counts
    };
  }, [products]);

  const selectableCategories = useMemo(() => {
    const base = [
      ...normalizedCategories.filter(c => c !== 'Todos'),
      'General',
      'Alimentos',
      'Bebidas',
      'Charcutería',
      'Golosinas',
      'Limpieza',
      'Cuidado Personal',
      'Farmacia',
      'Varios'
    ];
    if (productFormData.category && productFormData.category.trim()) {
      base.unshift(productFormData.category.trim());
    }
    const seen = new Set();
    const out = [];
    for (const item of base) {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item.trim());
    }
    return out;
  }, [normalizedCategories, productFormData.category]);

  // Índice en memoria pre-normalizado (sin acentos y en minúsculas) para búsqueda multi-token instantánea (< 1ms)
  const searchableProductsIndex = useMemo(() => {
    return products.map(p => {
      const rawName = p.name || p.nombre || '';
      const rawCat = (p.category || p.categoria || 'General').trim();
      const rawBarcode = String(p.barcode || p.codigo_barras || '');
      const rawSku = String(p.sku || p.code || '');
      return {
        product: p,
        catLower: rawCat.toLowerCase(),
        searchBlob: `${stripAccents(rawName)} ${rawBarcode.toLowerCase()} ${rawSku.toLowerCase()} ${stripAccents(rawCat)}`
      };
    });
  }, [products]);

  // Filtrado de Alto Rendimiento: insensible a acentos, multi-token y ordenado con fast-path
  const filteredProducts = useMemo(() => {
    const qClean = stripAccents(deferredSearchQuery || '').trim();
    const tokens = qClean ? qClean.split(/\s+/).filter(Boolean) : [];
    const isAll = selectedCategory === 'Todos';
    const isNoStockCat = selectedCategory === '🚫 Productos sin stock' || selectedCategory.toLowerCase().includes('sin stock');
    const selectedClean = (isAll || isNoStockCat) ? '' : selectedCategory.trim().toLowerCase();

    let list;
    if (isAll && tokens.length === 0) {
      list = products;
    } else {
      const matched = [];
      for (let i = 0; i < searchableProductsIndex.length; i++) {
        const entry = searchableProductsIndex[i];
        const p = entry.product;
        if (isNoStockCat) {
          const st = Number(p.stockQuantity ?? p.stock ?? 0);
          const isService = Boolean(p.isService || entry.catLower === 'servicios');
          if (isService || st > 0) continue;
        } else if (!isAll && entry.catLower !== selectedClean) {
          continue;
        }
        if (tokens.length > 0) {
          let allMatch = true;
          for (let t = 0; t < tokens.length; t++) {
            if (!entry.searchBlob.includes(tokens[t])) {
              allMatch = false;
              break;
            }
          }
          if (!allMatch) continue;
        }
        matched.push(p);
      }
      list = matched;
    }

    // Ordenar siempre priorizando disponibilidad: productos con stock primero y agotados al final
    return [...list].sort((a, b) => {
      const isServiceA = Boolean(a.isService || String(a.category || a.categoria || '').trim().toLowerCase() === 'servicios');
      const isServiceB = Boolean(b.isService || String(b.category || b.categoria || '').trim().toLowerCase() === 'servicios');
      const stockA = Number(a.stockQuantity ?? a.stock ?? 0);
      const stockB = Number(b.stockQuantity ?? b.stock ?? 0);
      const outOfStockA = (!isServiceA && stockA <= 0) ? 1 : 0;
      const outOfStockB = (!isServiceB && stockB <= 0) ? 1 : 0;

      if (outOfStockA !== outOfStockB) {
        return outOfStockA - outOfStockB;
      }
      const nameA = (a.name || a.nombre || '').toLowerCase();
      const nameB = (b.name || b.nombre || '').toLowerCase();
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });
  }, [products, searchableProductsIndex, selectedCategory, deferredSearchQuery]);

  // Reset de scroll al cambiar búsqueda o categoría
  useEffect(() => {
    if (catalogScrollRef.current) {
      catalogScrollRef.current.scrollTop = 0;
    }
  }, [selectedCategory, deferredSearchQuery]);

  // Renderizado Progresivo Fluido: carga bloques automáticamente en scroll sin recortar productos
  const {
    visibleItems: virtualProducts,
    columns: catalogColumns,
    hasMore: catalogHasMore,
    remainingCount: catalogRemainingCount,
    handleScroll: handleCatalogScroll,
    loadMore: loadMoreCatalogItems,
    showAll: showAllCatalogItems
  } = useVirtualCatalogGrid(filteredProducts, {
    containerRef: catalogScrollRef,
    initialBatchSize: 24,
    batchIncrement: 20
  });

  const cartRef = useRef(cart);
  cartRef.current = cart;
  const productsRef = useRef(products);
  productsRef.current = products;

  const isUnlimitedStockProduct = useCallback((prod) => Boolean(
    !prod ||
    prod.isCustom ||
    prod.allowNegative ||
    prod.stockQuantity === '∞' ||
    String(prod.id || '').startsWith('manual_')
  ), []);

  // Sincronizar stock de productos en el carrito si cambia el inventario y ajustar excesos
  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0) return;
    setCart(prev => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map(item => {
        if (!item?.product?.id) {
          changed = true;
          return null;
        }
        if (isUnlimitedStockProduct(item.product)) return item;
        const cleanId = getCleanProductId(item.product.productId || item.product.id);
        const latest = products.find(p => String(p.id) === cleanId);
        if (!latest) return item;
        const baseStock = Math.max(0, Number(latest.stockQuantity ?? latest.stock ?? 0));
        const mult = getProductUnitsMultiplier(item.product);
        const maxStock = mult > 1 ? Math.floor(baseStock / mult) : baseStock;
        if (maxStock <= 0) {
          changed = true;
          return null;
        }
        if (item.quantity > maxStock) {
          changed = true;
          return { ...item, product: { ...latest, ...item.product, stockQuantity: latest.stockQuantity, stock: latest.stock }, quantity: maxStock };
        }
        if (latest.stockQuantity !== item.product.stockQuantity || latest.price !== item.product.price) {
          changed = true;
          return { ...item, product: { ...latest, ...item.product, stockQuantity: latest.stockQuantity, stock: latest.stock } };
        }
        return item;
      }).filter(Boolean);
      return changed ? next : prev;
    });
  }, [products, isUnlimitedStockProduct, setCart]);

  // Manejo de Carrito Inteligente Adaptado a Rubros de Negocio (Memoizado para no invalidar ProductCards)
  const addToCart = useCallback((product, forcedQty = 1) => {
    // 1. Si el producto tiene variantes de moda o estamos en modo ropa y no ha seleccionado variante
    const hasVariants = (Array.isArray(product.Variantes) && product.Variantes.length > 0) ||
                        (Array.isArray(product.variants) && product.variants.length > 0) ||
                        (businessMode === 'CLOTHING' && !product.selectedVariant);
    if (hasVariants && !product.selectedVariant) {
      setSelectedProductForVariant(product);
      return;
    }

    // 2. Si el producto es controlado en farmacia y no tiene récipe asociado
    const isControlled = Boolean(product.es_controlado || product.controlled || (businessMode === 'PHARMACY' && product.categoria?.toLowerCase()?.includes('controlad')));
    if (isControlled && !product.recipe) {
      setSelectedProductForControlledMed(product);
      return;
    }

    // 3. Validación estricta de stock disponible
    const unlimited = isUnlimitedStockProduct(product);
    const latestProd = (!unlimited && Array.isArray(productsRef.current))
      ? (productsRef.current.find(p => String(p.id) === String(product.id)) || product)
      : product;
    const maxStock = unlimited ? Infinity : Math.max(0, Number(latestProd.stockQuantity ?? latestProd.stock ?? 0));

    if (!unlimited) {
      if (maxStock <= 0) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Producto agotado (${product.name || product.nombre})`);
        return;
      }

      // Calcular stock comprometido acumulado de este producto en el carrito (incluyendo cajas, bultos y sueltas)
      const alreadyCommittedUnits = (cartRef.current || [])
        .filter(it => (it.product?.productId === product.id || it.product?.id === product.id || String(it.product?.id).startsWith(`${product.id}__`)))
        .reduce((sum, it) => {
          const mult = Number(it.product?.factorConversion || it.product?.unitsMultiplier) > 0
            ? Number(it.product?.factorConversion || it.product?.unitsMultiplier)
            : (it.product?.isBulk ? (Number(it.product?.unitsPerBulk) || 1) : (it.product?.isMidBulk ? (Number(it.product?.unitsPerMidBulk) || 1) : 1));
          return sum + ((Number(it.quantity) || 0) * mult);
        }, 0);

      const availableToCommit = Math.max(0, maxStock - alreadyCommittedUnits);

      if (forcedQty > availableToCommit) {
        triggerHaptic(30);
        playErrorSound();
        if (availableToCommit > 0) {
          showToast(`⚠️ Solo quedan ${availableToCommit} disponibles (${alreadyCommittedUnits} en ticket)`);
        } else {
          showToast(`⚠️ Stock agotado: ya tienes las ${maxStock} unidades en el ticket`);
        }
        return;
      }
    }

    triggerHaptic(12);
    playScanSound();
    setCart(prev => {
      const existing = prev.find(item => String(item.product.id) === String(product.id));
      if (existing) {
        const nextQty = unlimited ? (existing.quantity + forcedQty) : Math.min(maxStock, existing.quantity + forcedQty);
        return prev.map(item => 
          String(item.product.id) === String(product.id) ? { ...item, product: latestProd, quantity: nextQty } : item
        );
      }
      const initialQty = unlimited ? forcedQty : Math.min(maxStock, forcedQty);
      return [...prev, { product: latestProd, quantity: initialQty }];
    });
    showToast(`+${forcedQty} ${product.name || product.nombre}`);
  }, [businessMode, isUnlimitedStockProduct, setCart, showToast]);

  // Decremento directo desde la tarjeta de producto (1 toque sin abrir carrito)
  const decrementFromCard = useCallback((product) => {
    if (!product) return;
    triggerHaptic(10);
    setCart(prev => {
      const pid = String(product.id);
      let targetIdx = prev.findIndex(it => String(it.product?.id) === pid);
      if (targetIdx === -1) {
        targetIdx = prev.findIndex(it =>
          String(it.product?.productId) === pid || String(it.product?.id || '').startsWith(`${pid}__`)
        );
      }
      if (targetIdx === -1) return prev;
      const targetItem = prev[targetIdx];
      const nextQty = Number(targetItem.quantity || 1) - 1;
      if (nextQty <= 0) {
        playDeleteSound();
        return prev.filter((_, idx) => idx !== targetIdx);
      }
      return prev.map((it, idx) => idx === targetIdx ? { ...it, quantity: nextQty } : it);
    });
  }, [setCart]);

  // Manejo de Venta por Presentación de Empaque (Caja Completa, Media Caja, Bulto, Presentaciones Dinámicas)
  const handleSelectBulkPresentation = useCallback(({ product, type, quantity, priceUSD, priceBS, unitsMultiplier, packName, presentation }) => {
    if (!product) return;

    if (type === 'unit') {
      addToCart(product, quantity);
      return;
    }

    const isPresSale = typeof type === 'string' && type.startsWith('pres_');
    const presId = isPresSale ? type.replace('pres_', '') : null;
    const isBulkSale = type === 'bulk';
    const isMidBulkSale = type === 'mid';
    const cartItemId = isPresSale
      ? `${product.id}__pres_${presId}`
      : (isBulkSale ? `${product.id}__bulk` : `${product.id}__mid`);
    const displayName = `${product.name || product.nombre} (${packName})`;

    // Validar stock base unificado combinando lo que ya está en el carrito
    const currentBaseStock = Number(product.stockQuantity ?? product.stock ?? 0);
    const unlimited = isUnlimitedStockProduct(product);

    const bulkProductItem = {
      ...product,
      id: cartItemId,
      productId: product.id,
      name: displayName,
      originalName: product.name || product.nombre,
      price: priceUSD,
      priceBs: priceBS,
      presentationId: presId || presentation?.id || null,
      presentationName: presentation?.name || (isPresSale ? packName : null),
      factorConversion: unitsMultiplier,
      isBulk: isBulkSale,
      unitsPerBulk: Number(product.unitsPerBulk) || 1,
      bulkPrice: Number(product.bulkPrice) || priceUSD,
      bulkUnitName: product.bulkUnitName || 'Caja',
      isMidBulk: isMidBulkSale,
      unitsPerMidBulk: Number(product.unitsPerMidBulk) || 1,
      midBulkPrice: Number(product.midBulkPrice) || priceUSD,
      midBulkUnitName: product.midBulkUnitName || 'Media Caja',
      unitPrice: Number(product.price || product.precio || 0),
      unitsMultiplier
    };

    triggerHaptic(12);
    playScanSound();

    setCart(prev => {
      // Calcular cuántas unidades base de este producto ya están en el carrito
      const alreadyInCartUnits = prev
        .filter(it => (it.product?.productId === product.id || it.product?.id === product.id || String(it.product?.id).startsWith(`${product.id}__`)))
        .reduce((sum, it) => {
          const mult = Number(it.product?.factorConversion || it.product?.unitsMultiplier) > 0
            ? Number(it.product?.factorConversion || it.product?.unitsMultiplier)
            : (it.product?.isBulk ? (Number(it.product?.unitsPerBulk) || 1) : (it.product?.isMidBulk ? (Number(it.product?.unitsPerMidBulk) || 1) : 1));
          return sum + ((Number(it.quantity) || 0) * mult);
        }, 0);

      const totalRequestedUnits = alreadyInCartUnits + (quantity * unitsMultiplier);
      if (!unlimited && totalRequestedUnits > currentBaseStock) {
        showToast(`⚠️ Stock insuficiente: solicitado total ${totalRequestedUnits} un., disponible ${currentBaseStock} un.`);
        return prev;
      }

      const existing = prev.find(item => String(item.product.id) === String(cartItemId));
      if (existing) {
        const nextQty = existing.quantity + quantity;
        return prev.map(item =>
          String(item.product.id) === String(cartItemId) ? { ...item, quantity: nextQty } : item
        );
      }
      return [...prev, { product: bulkProductItem, quantity }];
    });

    showToast(`📦 +${quantity} ${displayName}`);
  }, [addToCart, isUnlimitedStockProduct, setCart, showToast]);

  const handlePriceCheck = useCallback((product) => {
    setPriceCheckerProduct(product);
    setIsPriceCheckerModalOpen(true);
    triggerHaptic(20);
    playScanSound();
  }, []);

  const handlePreviewImage = useCallback((imgData) => {
    setPreviewProductImage(imgData);
  }, []);

  // Índice O(1) en memoria para escáner ultra-rápido de código de barras
  const barcodeLookupIndex = useMemo(() => {
    const bulkMap = new Map();
    const midBulkMap = new Map();
    const directMap = new Map();

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (p.bulkBarcode) {
        bulkMap.set(String(p.bulkBarcode).trim().toLowerCase(), p);
      }
      if (p.midBulkBarcode) {
        midBulkMap.set(String(p.midBulkBarcode).trim().toLowerCase(), p);
      }
      const pBarcode = String(p.barcode || p.codigo_barras || '').trim().toLowerCase();
      if (pBarcode) {
        directMap.set(pBarcode, p);
      }
      const pSku = String(p.sku || '').trim().toLowerCase();
      if (pSku) {
        directMap.set(pSku, p);
      }
    }
    return { bulkMap, midBulkMap, directMap };
  }, [products]);

  // Manejador del Escáner de Código de Barras con Cámara o Hardware HID
  const handleBarcodeScanned = useCallback((code) => {
    if (!code) return;
    const cleanCode = String(code).trim().toLowerCase();
    
    // Si el escáner fue activado para capturar el código de barras en el formulario del producto:
    if (scannerTarget === 'product_barcode') {
      setProductFormData(prev => ({ ...prev, barcode: String(code).trim() }));
      setIsScannerOpen(false);
      setScannerTarget('cart');
      triggerHaptic(25);
      playScanSound();
      showToast(`✅ Código asignado al producto: ${code}`);
      return;
    }

    // 1. Verificar si coincide exactamente con el código de barras de CAJA/BULTO (bulkBarcode):
    let bulkMatchedProduct = barcodeLookupIndex.bulkMap.get(cleanCode);
    if (!bulkMatchedProduct) {
      bulkMatchedProduct = products.find(p => {
        const bBarcode = String(p.bulkBarcode || '').trim().toLowerCase();
        return bBarcode && bBarcode === cleanCode;
      });
    }

    if (bulkMatchedProduct) {
      setUnregisteredBarcodeNotice(null);
      const bUnits = Number(bulkMatchedProduct.unitsPerBulk) || 1;
      const bPrice = Number(bulkMatchedProduct.bulkPrice) > 0 ? Number(bulkMatchedProduct.bulkPrice) : (Number(bulkMatchedProduct.price || bulkMatchedProduct.precio || 0) * bUnits);
      handleSelectBulkPresentation({
        product: bulkMatchedProduct,
        type: 'bulk',
        quantity: 1,
        priceUSD: bPrice,
        priceBS: Number(bulkMatchedProduct.bulkPriceBs) || (bPrice * exchangeRate),
        unitsMultiplier: bUnits,
        packName: `${bulkMatchedProduct.bulkUnitName || 'Caja'} x${bUnits}`
      });
      return;
    }

    // 2. Verificar si coincide exactamente con el código de barras de MEDIA CAJA (midBulkBarcode):
    let midBulkMatchedProduct = barcodeLookupIndex.midBulkMap.get(cleanCode);
    if (!midBulkMatchedProduct) {
      midBulkMatchedProduct = products.find(p => {
        const mBarcode = String(p.midBulkBarcode || '').trim().toLowerCase();
        return mBarcode && mBarcode === cleanCode;
      });
    }

    if (midBulkMatchedProduct) {
      setUnregisteredBarcodeNotice(null);
      const mUnits = Number(midBulkMatchedProduct.unitsPerMidBulk) || 1;
      const mPrice = Number(midBulkMatchedProduct.midBulkPrice) > 0 ? Number(midBulkMatchedProduct.midBulkPrice) : (Number(midBulkMatchedProduct.price || midBulkMatchedProduct.precio || 0) * mUnits);
      handleSelectBulkPresentation({
        product: midBulkMatchedProduct,
        type: 'mid',
        quantity: 1,
        priceUSD: mPrice,
        priceBS: Number(midBulkMatchedProduct.midBulkPriceBs) || (mPrice * exchangeRate),
        unitsMultiplier: mUnits,
        packName: `${midBulkMatchedProduct.midBulkUnitName || 'Media Caja'} x${mUnits}`
      });
      return;
    }

    // 2.5. Verificar si coincide exactamente con el código de barras de alguna PRESENTACIÓN DINÁMICA (Tier 4 / N Presentaciones)
    let matchedPres = null;
    let presMatchedProduct = products.find(p => {
      if (Array.isArray(p.Presentations)) {
        const found = p.Presentations.find(pres => {
          const pb = String(pres.barcode || '').trim().toLowerCase();
          return pb && pb === cleanCode;
        });
        if (found) {
          matchedPres = found;
          return true;
        }
      }
      return false;
    });

    if (presMatchedProduct && matchedPres) {
      setUnregisteredBarcodeNotice(null);
      const pFactor = Number(matchedPres.factorConversion) || 1;
      const pPriceUSD = Number(matchedPres.price) || 0;
      const pPriceBS = Number(matchedPres.priceBs) || (pPriceUSD * exchangeRate);
      handleSelectBulkPresentation({
        product: presMatchedProduct,
        type: `pres_${matchedPres.id}`,
        quantity: 1,
        priceUSD: pPriceUSD,
        priceBS: pPriceBS,
        unitsMultiplier: pFactor,
        packName: `${matchedPres.name} x${pFactor}`,
        presentation: matchedPres
      });
      return;
    }

    // 3. Buscar en el inventario local completo por coincidencia exacta de código de barras o SKU
    let exactProduct = barcodeLookupIndex.directMap.get(cleanCode);
    if (!exactProduct) {
      exactProduct = products.find(p => {
        const pBarcode = String(p.barcode || p.codigo_barras || '').trim().toLowerCase();
        const pSku = String(p.sku || '').trim().toLowerCase();
        return (pBarcode && pBarcode === cleanCode) || (pSku && pSku === cleanCode);
      });
    }

    if (exactProduct) {
      setUnregisteredBarcodeNotice(null);
      if (posMode === 'PRICE_CHECKER' || isPriceCheckerModalOpen) {
        setPriceCheckerProduct(exactProduct);
        setIsPriceCheckerModalOpen(true);
        triggerHaptic(25);
        playScanSound();
        showToast(`🔍 ${exactProduct.name || exactProduct.nombre}: $${Number(exactProduct.price || exactProduct.precio || 0).toFixed(2)}`);
      } else {
        addToCart(exactProduct);
      }
    } else {
      setSearchQuery(code);
      setUnregisteredBarcodeNotice({ barcode: String(code).trim() });
      triggerHaptic(30);
      playErrorSound();
      showToast(`Código "${code}" no registrado`);
    }
  }, [scannerTarget, barcodeLookupIndex, products, exchangeRate, handleSelectBulkPresentation, posMode, isPriceCheckerModalOpen, addToCart, showToast]);

  const handleBarcodeScannedRef = useRef(handleBarcodeScanned);
  useEffect(() => {
    handleBarcodeScannedRef.current = handleBarcodeScanned;
  }, [handleBarcodeScanned]);

  // 🔫 Listener Global de Escáner Físico de Código de Barras (Pistolas Bluetooth / USB OTG / Lector Inalámbrico)
  useEffect(() => {
    let barcodeBuffer = '';
    let lastKeyTime = 0;
    let scanTimeout = null;
    let hudTimeout = null;

    const handleKeyDown = (e) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isInputFocused = activeTag === 'input' || activeTag === 'textarea';

      const now = Date.now();
      const timeDiff = now - lastKeyTime;
      lastKeyTime = now;

      // 1. Detección de Final de Código (Enter o Tab enviado por el lector)
      if (e.key === 'Enter' || e.key === 'Tab') {
        // Un lector Bluetooth envía los caracteres a < 50ms entre teclas.
        // Si el buffer tiene 3+ caracteres y el flujo fue ultra-rápido (< 65ms) o no había input enfocado:
        if (barcodeBuffer.length >= 3 && (timeDiff < 65 || !isInputFocused)) {
          e.preventDefault();
          e.stopPropagation();
          const scannedCode = barcodeBuffer.trim();
          barcodeBuffer = '';
          
          if (isInputFocused) {
            try { document.activeElement?.blur?.(); } catch { /* El navegador impidió quitar el foco programáticamente */ }
          }

          if (handleBarcodeScannedRef.current) {
            handleBarcodeScannedRef.current(scannedCode);
            // Mostrar HUD flotante de escaneo físico de pistola
            setLastHardwareScan({ code: scannedCode, time: Date.now() });
            if (hudTimeout) clearTimeout(hudTimeout);
            hudTimeout = setTimeout(() => setLastHardwareScan(null), 2500);
          }
        } else {
          barcodeBuffer = '';
        }
        return;
      }

      // 2. Si el usuario está tecleando manualmente despacio en un input (> 75ms), es escritura humana
      if (timeDiff > 75 && isInputFocused) {
        barcodeBuffer = '';
        return;
      }

      // 3. Reiniciar buffer si pasaron más de 140ms sin teclear
      if (timeDiff > 140) {
        barcodeBuffer = '';
      }

      // 4. Acumular caracteres alfanuméricos
      if (e.key && e.key.length === 1) {
        barcodeBuffer += e.key;

        // Auto-limpieza de seguridad si el escáner se trabó
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          barcodeBuffer = '';
        }, 300);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (scanTimeout) clearTimeout(scanTimeout);
      if (hudTimeout) clearTimeout(hudTimeout);
    };
  }, []);

  // Helpers unificados para IDs de producto limpio y multiplicador de unidades (Caja/Bulto/Presentaciones dinámicas)
  const getCleanProductId = (rawId) => String(rawId || '').replace(/__bulk$|__mid$|__pres_.*$/, '');
  const getProductUnitsMultiplier = (prod) => {
    if (!prod) return 1;
    const explicitFactor = Number(prod.factorConversion || prod.unitsMultiplier || 0);
    if (explicitFactor > 1) return explicitFactor;
    if (prod.isBulk) return Math.max(1, Number(prod.unitsPerBulk || prod.unidadesPorBulto) || 1);
    if (prod.isMidBulk) return Math.max(1, Number(prod.unitsPerMidBulk || prod.unidadesPorEmpaque) || 1);
    return 1;
  };

  const getAvailablePacksExcludingItem = (cleanProdId, targetCartItemId, targetProd) => {
    const latestProd = products.find(p => String(p.id) === cleanProdId) || targetProd;
    const baseStock = Math.max(0, Number(latestProd.stockQuantity ?? latestProd.stock ?? 0));
    const otherUnitsUsed = cart.reduce((acc, c) => {
      if (String(c.product.id) === String(targetCartItemId)) return acc;
      const cCleanId = getCleanProductId(c.product.productId || c.product.id);
      if (cCleanId !== cleanProdId) return acc;
      return acc + (Number(c.quantity || 0) * getProductUnitsMultiplier(c.product));
    }, 0);
    const remainingBaseStock = Math.max(0, baseStock - otherUnitsUsed);
    const mult = getProductUnitsMultiplier(targetProd);
    return mult > 1 ? Math.floor(remainingBaseStock / mult) : remainingBaseStock;
  };

  const updateQuantity = (productId, delta) => {
    const targetItem = cart.find(item => String(item.product.id) === String(productId));
    if (!targetItem) return;

    if (delta > 0 && !isUnlimitedStockProduct(targetItem.product)) {
      const cleanProdId = getCleanProductId(targetItem.product.productId || productId);
      const maxPacksStock = getAvailablePacksExcludingItem(cleanProdId, productId, targetItem.product);

      if (targetItem.quantity + delta > maxPacksStock) {
        triggerHaptic(30);
        playErrorSound();
        if (targetItem.quantity > maxPacksStock && maxPacksStock > 0) {
          setCart(prev => prev.map(it =>
            String(it.product.id) === String(productId) ? { ...it, quantity: maxPacksStock } : it
          ));
          showToast(`⚠️ Cantidad ajustada a las existencias disponibles (${maxPacksStock} disp.)`);
        } else {
          showToast(`⚠️ Stock insuficiente: solo quedan ${maxPacksStock} ${targetItem.product.isBulk ? 'cajas' : 'disp.'}`);
        }
        return;
      }
    }

    triggerHaptic(10);
    if (delta > 0) {
      playScanSound();
    }
    setCart(prev => prev.map(item => {
      if (String(item.product.id) === String(productId)) {
        const newQty = item.quantity + delta;
        if (newQty <= 0) {
          playDeleteSound();
          return null;
        }
        return { ...item, quantity: newQty };
      }
      return item;
    }).filter(Boolean));
  };

  const removeFromCart = (productId) => {
    triggerHaptic(20);
    playDeleteSound();
    setCart(prev => prev.filter(item => String(item.product.id) !== String(productId)));
  };

  const openQuantityModal = (item) => {
    triggerHaptic(12);
    const cleanProdId = getCleanProductId(item.product?.productId || item.product?.id || '');
    const latestProd = products.find(p => String(p.id) === cleanProdId) || item.product;
    setQuantityModalItem({ ...item, product: { ...latestProd, ...item.product } });
    setIsQuantityModalOpen(true);
  };

  const handleApplyQuantity = (productId, newQty) => {
    const qty = parseFloat(newQty);
    if (isNaN(qty) || qty <= 0) {
      removeFromCart(productId);
      return;
    }

    const targetItem = cart.find(item => String(item.product.id) === String(productId));
    let finalQty = qty;

    if (targetItem && !isUnlimitedStockProduct(targetItem.product)) {
      const cleanProdId = getCleanProductId(targetItem.product.productId || productId);
      const maxPacksStock = getAvailablePacksExcludingItem(cleanProdId, productId, targetItem.product);

      if (maxPacksStock <= 0) {
        triggerHaptic(30);
        playErrorSound();
        removeFromCart(productId);
        showToast('⚠️ Producto sin existencias en inventario');
        return;
      }
      if (qty > maxPacksStock) {
        finalQty = maxPacksStock;
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Ajustado al stock disponible (${maxPacksStock} ${targetItem.product.isBulk ? 'cajas' : 'disp.'})`);
      } else {
        triggerHaptic(12);
        playScanSound();
      }
    } else {
      triggerHaptic(12);
      playScanSound();
    }

    setCart(prev => prev.map(item => {
      if (String(item.product.id) === String(productId)) {
        return { ...item, quantity: finalQty };
      }
      return item;
    }));
  };

  const clearCart = () => {
    if (cart.length === 0) return;
    triggerHaptic(25);
    playDeleteSound();
    setCart([]);
    setCartDiscountPercent(0);
    setDiscountSupervisorApprovalId(null);
    setIsMobileCartOpen(false);
    showToast('🛒 Carrito vaciado');
  };

  // Cálculos financieros con promociones
  const promoResult = useMemo(() => {
    const safeCart = normalizeMobileCartItems(cart);
    const flattenedItems = safeCart.map(item => ({
      ...item.product,
      id: item.product.id,
      name: item.product.name || item.product.nombre,
      price: Number(item.product.price || item.product.precio || 0),
      quantity: Number(item.quantity) || 1,
      category: item.product.category || item.product.categoria || ''
    }));
    return evaluateCartPromotions(flattenedItems, promotions);
  }, [cart, promotions]);

  const {
    cartDiscountAmountUSD,
    subtotalUSD,
    enrichedCart,
    taxUSD,
    baseImponibleUSD,
    totalUSD,
    totalBS,
    totalItemsCount
  } = useMemo(() => {
    const safeCart = normalizeMobileCartItems(cart);
    const rawSub = safeCart.reduce((acc, item) => acc + ((item.product.price || item.product.precio || 0) * item.quantity), 0);
    const promoSavings = promoResult.totalPromoSavings || 0;
    const subBeforeDisc = promoResult.finalCartSubtotal ?? rawSub;
    const cartDisc = Number((subBeforeDisc * (cartDiscountPercent / 100)).toFixed(2));
    const subUSD = Math.max(0, subBeforeDisc - cartDisc);

    const enriched = safeCart.map(item => {
      const promoItem = (promoResult.itemsWithPromotions || []).find(p => String(p.id) === String(item.product.id));
      return {
        ...item,
        appliedPromoName: promoItem?.appliedPromoName || null,
        promoDiscount: promoItem?.promoDiscount || 0,
        finalSubtotal: promoItem?.finalSubtotal ?? ((item.product.price || item.product.precio || 0) * item.quantity)
      };
    });

    const taxableSubBeforeDisc = enriched.reduce((acc, item) => {
      const isExempt = item.product.taxStatus === 'exento' || Boolean(item.product.isExempt) || Boolean(item.product.is_exempt) || Boolean(item.product.taxExempt);
      return isExempt ? acc : acc + Number(item.finalSubtotal || 0);
    }, 0);

    const discRatio = subBeforeDisc > 0 ? (subUSD / subBeforeDisc) : 1;
    const effTaxable = Number((taxableSubBeforeDisc * discRatio).toFixed(2));

    const configuredIvaPct = Number(businessInfo?.ivaRate ?? businessInfo?.taxRate ?? 16) || 16;
    const ivaDivisor = 1 + (configuredIvaPct / 100);
    const tUSD = Number(Math.max(0, effTaxable - (effTaxable / ivaDivisor)).toFixed(2));
    const baseImp = Number((effTaxable - tUSD).toFixed(2));
    const exUSD = Number(Math.max(0, subUSD - effTaxable).toFixed(2));
    const totUSD = subUSD;
    const totBS = totUSD * exchangeRate;
    const totItems = cart.reduce((acc, item) => acc + item.quantity, 0);

    return {
      rawSubtotalUSD: rawSub,
      totalPromoSavings: promoSavings,
      subtotalBeforeDiscountUSD: subBeforeDisc,
      cartDiscountAmountUSD: cartDisc,
      subtotalUSD: subUSD,
      enrichedCart: enriched,
      taxableSubtotalBeforeDiscountUSD: taxableSubBeforeDisc,
      effectiveTaxableUSD: effTaxable,
      taxUSD: tUSD,
      baseImponibleUSD: baseImp,
      exemptUSD: exUSD,
      totalUSD: totUSD,
      totalBS: totBS,
      totalItemsCount: totItems
    };
  }, [cart, promoResult, cartDiscountPercent, exchangeRate, businessInfo?.ivaRate, businessInfo?.taxRate]);

  const isIgtfEnabled = Boolean(
    businessInfo?.taxConfig?.igtfEnabled !== undefined
      ? businessInfo.taxConfig.igtfEnabled
      : businessInfo?.igtfEnabled
  );
  const igtfRatePct = Number(businessInfo?.taxConfig?.igtfRate ?? businessInfo?.igtfRate ?? 3) || 3;
  const isBinanceIgtfEnabled = Boolean(
    businessInfo?.binanceIgtfEnabled ?? businessInfo?.taxConfig?.binanceIgtfEnabled
  );

  const currentIgtfUSD = useMemo(() => {
    if (!isIgtfEnabled || documentType === 'cotizacion' || totalUSD <= 0) return 0;
    const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
    const factor = 1 + (igtfRatePct / 100);
    if (checkoutMode === 'split') {
      const sUsd = parseFloat(splitPayments.cash_usd) || 0;
      if (sUsd <= 0) return 0;
      const appliedPrincipal = Math.min(totalUSD, sUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    const methodNorm = String(selectedMethod || '').toLowerCase().trim();
    const isCrypto = methodNorm === 'binance' || methodNorm === 'binance_usdt';
    const isExemptUsd = methodNorm === 'zelle' || methodNorm === 'crédito' || methodNorm === 'credito' || methodNorm === 'fiado' || (isCrypto && !isBinanceIgtfEnabled);
    const isVesOnly = ['efectivo bs', 'pago móvil', 'pago movil', 'tarjeta', 'punto de venta', 'biopago', 'cash_bs', 'pago_movil', 'debit'].includes(methodNorm);
    if (isExemptUsd || isVesOnly) return 0;
    if (methodNorm === 'mixto') {
      const enteredUsd = parseFloat(amountPaidUSD) || 0;
      if (enteredUsd <= 0) return 0;
      const appliedPrincipal = Math.min(totalUSD, enteredUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    const enteredUsd = parseFloat(amountPaidUSD) || 0;
    const enteredBs = parseFloat(amountPaidBS) || 0;
    if (enteredBs > 0 && enteredUsd <= 0) return 0;
    if (enteredUsd > 0) {
      const appliedPrincipal = Math.min(totalUSD, enteredUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    return round2(totalUSD * (igtfRatePct / 100));
  }, [isIgtfEnabled, isBinanceIgtfEnabled, igtfRatePct, documentType, totalUSD, checkoutMode, splitPayments.cash_usd, selectedMethod, amountPaidUSD, amountPaidBS]);

  const totalDueUSD = useMemo(() => Number((totalUSD + currentIgtfUSD).toFixed(2)), [totalUSD, currentIgtfUSD]);
  const totalDueBS = useMemo(() => Number((totalDueUSD * exchangeRate).toFixed(2)), [totalDueUSD, exchangeRate]);

  const { paidUSD, paidBS, totalPaidInUSD, changeUSD, changeBS } = useMemo(() => {
    const pUSD = parseFloat(amountPaidUSD) || 0;
    const pBS = parseFloat(amountPaidBS) || 0;
    const totPaidUSD = pUSD + (pBS / (exchangeRate || 1));
    const chUSD = Math.max(0, totPaidUSD - totalDueUSD);
    const chBS = chUSD * (exchangeRate || 1);
    return { paidUSD: pUSD, paidBS: pBS, totalPaidInUSD: totPaidUSD, changeUSD: chUSD, changeBS: chBS };
  }, [amountPaidUSD, amountPaidBS, exchangeRate, totalDueUSD]);

  // Botones de Billetes Sugeridos (Quick Cash Tender Chips)

  // Cálculo de Split Payments en USD y Bolívares
  const splitPaidUSD = useMemo(() => {
    const usdCash = parseFloat(splitPayments.cash_usd) || 0;
    const zelle = parseFloat(splitPayments.zelle) || 0;
    const credit = parseFloat(splitPayments.credito) || 0;
    const bsCash = parseFloat(splitPayments.cash_bs) || 0;
    const pagoMovil = parseFloat(splitPayments.pago_movil) || 0;
    const debit = parseFloat(splitPayments.tarjeta) || 0;
    const bsTotalInUSD = (bsCash + pagoMovil + debit) / (exchangeRate || 1);
    return usdCash + zelle + credit + bsTotalInUSD;
  }, [splitPayments, exchangeRate]);

  const splitRemainingUSD = Math.max(0, totalDueUSD - splitPaidUSD);
  const splitChangeUSD = Math.max(0, splitPaidUSD - totalDueUSD);

  // Manejo de Descuento con Validación Biométrica y PIN de Supervisor
  const handleApplyDiscount = (pct) => {
    if (pct > 10) {
      requestSupervisorAuth(
        'Autorizar Descuento Especial',
        `Descuento del ${pct}% requiere aprobación de supervisor`,
        (approvalData) => {
          setCartDiscountPercent(pct);
          setDiscountSupervisorApprovalId(approvalData?.id || null);
          showToast(`✅ Descuento de ${pct}% autorizado`);
        },
        'discount'
      );
    } else {
      setCartDiscountPercent(pct);
      if (pct === 0) setDiscountSupervisorApprovalId(null);
    }
  };

  // Reactividad al seleccionar método de pago
  const handleSelectPaymentMethod = (method) => {
    setSelectedMethod(method);
    const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
    if (method === 'Efectivo Bs' || method === 'Pago Móvil' || method === 'Tarjeta' || method === 'Punto de Venta') {
      setAmountPaidBS(totalBS.toFixed(2));
      setAmountPaidUSD('');
    } else if (method === 'Efectivo USD') {
      const usdDue = isIgtfEnabled ? round2(totalUSD * (1 + (igtfRatePct / 100))) : totalUSD;
      setAmountPaidUSD(usdDue.toFixed(2));
      setAmountPaidBS('');
    } else if (method === 'Zelle') {
      setAmountPaidUSD(totalUSD.toFixed(2));
      setAmountPaidBS('');
    } else if (method === 'Mixto') {
      const halfUSD = totalUSD / 2;
      const halfIgtf = isIgtfEnabled ? round2(halfUSD * (igtfRatePct / 100)) : 0;
      setAmountPaidUSD((halfUSD + halfIgtf).toFixed(2));
      setAmountPaidBS((halfUSD * exchangeRate).toFixed(2));
    } else if (method === 'Crédito') {
      setAmountPaidUSD('0.00');
      setAmountPaidBS('0.00');
    }
  };

  // Guardar Cotización / Presupuesto Formal (Sin descontar stock ni alterar caja)
  const handleSaveQuotation = async () => {
    if (cart.length === 0) return;
    setIsProcessingSale(true);

    const quotationData = {
      customerId: (Array.isArray(customers) ? customers.find(c => c.name === customerName)?.id : null) || null,
      customerName: customerName || 'Consumidor Final',
      customerDocument: customerDoc || '',
      items: enrichedCart.map(item => ({
        productId: String(item.product.id),
        name: item.product.name || item.product.nombre,
        quantity: Number(item.quantity),
        price: Number(item.product.price || item.product.precio || 0),
        subtotal: Number(item.finalSubtotal || 0)
      })),
      subtotal: Number(subtotalUSD.toFixed(2)),
      discount: Number(cartDiscountAmountUSD.toFixed(2)) || 0,
      discountPercent: Number(cartDiscountPercent) || 0,
      tax: Number(taxUSD.toFixed(2)),
      total: Number(totalUSD.toFixed(2)),
      status: 'pending',
      date: new Date().toISOString()
    };

    try {
      const res = await api.post('/quotations', quotationData, { timeout: 4500 });
      const quote = res.data || {};
      const quoteId = quote.id || `COT-${Date.now().toString().slice(-6)}`;
      showToast('✅ Presupuesto guardado en servidor');

      // Compartir por WhatsApp
      const lines = [
        `📋 *PRESUPUESTO / COTIZACIÓN*`,
        `Comercio: *${businessInfo.name || 'Isaac POS'}*`,
        `Nº Presupuesto: *${quoteId}*`,
        `Fecha: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        `Cliente: *${customerName}* (${customerDoc})`,
        `--------------------------------`,
        ...enrichedCart.map(i => `• ${i.quantity}x ${i.product.name || i.product.nombre} = $${Number(i.finalSubtotal).toFixed(2)}`),
        `--------------------------------`,
        `Subtotal: $${subtotalUSD.toFixed(2)}`,
        `IVA (16%): $${taxUSD.toFixed(2)}`,
        `*TOTAL USD: $${totalUSD.toFixed(2)}*`,
        `*TOTAL BS: Bs. ${totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`,
        `Tasa Oficial: Bs. ${exchangeRate.toFixed(2)}`,
        `--------------------------------`,
        `*Validez de la oferta: 3 días continuos*`,
        `¡Gracias por su consulta!`
      ];
      const encoded = encodeURIComponent(lines.join('\n'));
      window.open(`https://wa.me/?text=${encoded}`, '_blank');

      setCart([]);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
    } catch (_err) {
      showToast('⚡ Cotización generada (modo offline)');
      setCart([]);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
    } finally {
      setIsProcessingSale(false);
    }
  };

  // Imprimir Recibo Térmico mediante Spooler Asíncrono / Bluetooth Nativo ESC/POS
  const activeCurrencyMode = businessInfo?.currencyMode || localStorage.getItem('pos_currency_mode') || (isDollarCountry ? 'USD' : 'BOTH');

  const handlePrintBluetoothReceipt = async (sale) => {
    if (!sale) return;
    try {
      const paperWidth = localStorage.getItem('pos_mobile_paper_width') || '58mm';
      mobilePrinterService.enqueueSalePrint({
        sale,
        businessSettings: {
          ...businessInfo,
          receiptWidth: paperWidth
        },
        exchangeRate,
        currencyMode: activeCurrencyMode
      });
      triggerHaptic(15);
      playScanSound();
      showToast('🖨️ Enviado a la cola de impresión térmica');
    } catch (printErr) {
      alert(`Error al encolar impresión Bluetooth: ${printErr.message}`);
      setIsThermalPrinterModalOpen(true);
    }
  };

  // Confirmar Venta Real en Servidor
  const handleConfirmSale = async () => {
    if (isProcessingSale) return;
    if (cart.length === 0) return;
    if (documentType === 'cotizacion') {
      await handleSaveQuotation();
      return;
    }

    if (checkoutMode === 'split') {
      if (splitPaidUSD < totalDueUSD - 0.02) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Pago incompleto: faltan $${Math.max(0, totalDueUSD - splitPaidUSD).toFixed(2)}`);
        return;
      }
    } else if (selectedMethod !== 'Crédito' && selectedMethod !== 'fiado') {
      const hasEnteredTender = String(amountPaidUSD || '').trim() !== '' || String(amountPaidBS || '').trim() !== '';
      if (hasEnteredTender && totalPaidInUSD < totalDueUSD - 0.02) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Monto recibido insuficiente: faltan $${Math.max(0, totalDueUSD - totalPaidInUSD).toFixed(2)}`);
        return;
      }
    }

    const isRefRequired = checkoutMode === 'express'
      ? ['pago móvil', 'pago movil', 'tarjeta', 'punto de venta', 'zelle', 'transferencia', 'biopago'].some(m => String(selectedMethod || '').toLowerCase().includes(m))
      : ((parseFloat(splitPayments.pago_movil) || 0) > 0 || (parseFloat(splitPayments.tarjeta) || 0) > 0 || (parseFloat(splitPayments.zelle) || 0) > 0);

    if (isRefRequired && !String(paymentReference || '').trim()) {
      triggerHaptic(30);
      playErrorSound();
      showToast('⚠️ Ingrese el número de referencia para liquidar este pago');
      return;
    }

    setIsProcessingSale(true);

    // IDEMPOTENCIA CRÍTICA: Generar UUID inmutable ANTES de cualquier intento de transporte.
    const persistentTransactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const effectiveMethod = checkoutMode === 'split'
      ? 'Mixto / Dividido'
      : ((selectedMethod === 'Efectivo USD' && paidBS > 0 && paidUSD <= 0) ? 'Efectivo Bs' : selectedMethod);
    const finalChangeUSD = checkoutMode === 'split' ? splitChangeUSD : changeUSD;
    const finalChangeBS = finalChangeUSD * exchangeRate;

    const isVesMethod = ['Pago Móvil', 'Efectivo Bs', 'Punto de Venta', 'Tarjeta', 'Biopago', 'pago_movil', 'cash_bs', 'debit', 'biopago'].includes(effectiveMethod);

    let normalizedPaymentMethods = [];
    if (checkoutMode === 'split') {
      const sUsd = parseFloat(splitPayments.cash_usd) || 0;
      const sBs = parseFloat(splitPayments.cash_bs) || 0;
      const sPm = parseFloat(splitPayments.pago_movil) || 0;
      const sCard = parseFloat(splitPayments.tarjeta) || 0;
      const sZelle = parseFloat(splitPayments.zelle) || 0;
      const sCred = parseFloat(splitPayments.credito) || 0;

      if (sUsd > 0) {
        normalizedPaymentMethods.push({
          method: 'cash_usd',
          amount: sUsd,
          currency: 'USD',
          convertedAmountUsd: sUsd,
          reference: ''
        });
      }
      if (sBs > 0) {
        normalizedPaymentMethods.push({
          method: 'cash_bs',
          amount: sBs,
          currency: 'VES',
          convertedAmountUsd: Number((sBs / (exchangeRate || 1)).toFixed(2)),
          reference: ''
        });
      }
      if (sPm > 0) {
        normalizedPaymentMethods.push({
          method: 'pago_movil',
          amount: sPm,
          currency: 'VES',
          convertedAmountUsd: Number((sPm / (exchangeRate || 1)).toFixed(2)),
          reference: paymentReference ? String(paymentReference).trim() : ''
        });
      }
      if (sCard > 0) {
        normalizedPaymentMethods.push({
          method: 'debit',
          amount: sCard,
          currency: 'VES',
          convertedAmountUsd: Number((sCard / (exchangeRate || 1)).toFixed(2)),
          reference: paymentReference ? String(paymentReference).trim() : ''
        });
      }
      if (sZelle > 0) {
        normalizedPaymentMethods.push({
          method: 'zelle',
          amount: sZelle,
          currency: 'USD',
          convertedAmountUsd: sZelle,
          reference: paymentReference ? String(paymentReference).trim() : ''
        });
      }
      if (sCred > 0) {
        normalizedPaymentMethods.push({
          method: 'fiado',
          amount: sCred,
          currency: 'USD',
          convertedAmountUsd: sCred,
          reference: ''
        });
      }
      if (normalizedPaymentMethods.length === 0) {
        normalizedPaymentMethods.push({
          method: 'cash_usd',
          amount: Number(totalDueUSD.toFixed(2)),
          currency: 'USD',
          convertedAmountUsd: Number(totalDueUSD.toFixed(2)),
          reference: ''
        });
      }
    } else if (effectiveMethod === 'Mixto') {
      const mUsd = paidUSD > 0 ? paidUSD : 0;
      const mBs = paidBS > 0 ? paidBS : 0;
      if (mUsd > 0) {
        normalizedPaymentMethods.push({
          method: 'cash_usd',
          amount: Number(mUsd.toFixed(2)),
          currency: 'USD',
          convertedAmountUsd: Number(mUsd.toFixed(2)),
          reference: ''
        });
      }
      if (mBs > 0) {
        normalizedPaymentMethods.push({
          method: 'cash_bs',
          amount: Number(mBs.toFixed(2)),
          currency: 'VES',
          convertedAmountUsd: Number((mBs / (exchangeRate || 1)).toFixed(2)),
          reference: ''
        });
      }
      if (normalizedPaymentMethods.length === 0) {
        normalizedPaymentMethods.push({
          method: 'cash_usd',
          amount: Number(totalDueUSD.toFixed(2)),
          currency: 'USD',
          convertedAmountUsd: Number(totalDueUSD.toFixed(2)),
          reference: ''
        });
      }
    } else {
      normalizedPaymentMethods = [{
        method: effectiveMethod === 'Crédito' ? 'fiado' : effectiveMethod,
        amount: isVesMethod ? Number(totalDueBS.toFixed(2)) : Number(totalDueUSD.toFixed(2)),
        currency: isVesMethod ? 'VES' : 'USD',
        convertedAmountUsd: Number(totalDueUSD.toFixed(2)),
        reference: paymentReference ? String(paymentReference).trim() : ''
      }];
    }

    const salePayload = {
      id: persistentTransactionId,
      clientTransactionId: persistentTransactionId,
      items: enrichedCart.map(item => ({
        productId: String(item.product.productId || item.product.id).replace(/__bulk$|__mid$|__pres_.*$/, ''),
        name: item.product.name || item.product.nombre,
        quantity: Number(item.quantity),
        price: Number(item.product.price || item.product.precio || 0),
        subtotal: Number(item.finalSubtotal || 0),
        isCustom: Boolean(item.product.isCustom),
        selectedVariant: item.product.selectedVariant || null,
        recipe: item.product.recipe || null,
        presentationId: item.product.presentationId || null,
        presentationName: item.product.presentationName || null,
        factorConversion: Number(item.product.factorConversion || item.product.unitsMultiplier) || 1,
        isBulk: Boolean(item.product.isBulk),
        unitsPerBulk: Number(item.product.unitsPerBulk) || 1,
        bulkPrice: Number(item.product.bulkPrice) || 0,
        bulkUnitName: item.product.bulkUnitName || '',
        isMidBulk: Boolean(item.product.isMidBulk),
        unitsPerMidBulk: Number(item.product.unitsPerMidBulk) || 1,
        midBulkPrice: Number(item.product.midBulkPrice) || 0,
        midBulkUnitName: item.product.midBulkUnitName || ''
      })),
      subtotal: Number(subtotalUSD.toFixed(2)),
      discount: Number(cartDiscountAmountUSD.toFixed(2)) || 0,
      discountPercent: Number(cartDiscountPercent) || 0,
      supervisorApprovalId: discountSupervisorApprovalId || null,
      tax: Number(taxUSD.toFixed(2)),
      igtf: Number(currentIgtfUSD.toFixed(2)),
      igtfAmount: Number(currentIgtfUSD.toFixed(2)),
      total: Number(totalDueUSD.toFixed(2)),
      exchangeRate: Number(exchangeRate),
      paymentMethod: effectiveMethod === 'Crédito' ? 'fiado' : effectiveMethod,
      paymentReference: paymentReference ? String(paymentReference).trim() : null,
      paymentMethods: normalizedPaymentMethods,
      receivedAmount: Number((totalPaidInUSD > 0 ? totalPaidInUSD : totalDueUSD).toFixed(2)),
      changeAmount: Number(finalChangeUSD.toFixed(2)),
      changeUSD: Number(finalChangeUSD.toFixed(2)),
      changeBS: Number(finalChangeBS.toFixed(2)),
      documentType: documentType || 'factura',
      splitDetails: checkoutMode === 'split' ? splitPayments : null,
      customerName: customerName || 'Consumidor Final',
      customerDoc: customerDoc || (isDollarCountry ? '0000000000' : 'V-00000000'),
      registerId: 'Caja Móvil',
      terminalId: getTerminalId(),
      notes: paymentReference ? `Ref: ${paymentReference}` : (documentType === 'nota_entrega' ? 'Nota de Entrega' : 'Venta Terminal Móvil')
    };

    try {
      const res = await api.post('/sales', salePayload, { timeout: 4500 });
      const createdSale = res.data?.sale || res.data || {};
      const invoiceNum = createdSale.invoiceNumber || (documentType === 'nota_entrega' ? `NE-${Math.floor(100000 + Math.random() * 900000)}` : `FAC-${Math.floor(100000 + Math.random() * 900000)}`);

      const now = new Date();
      const nowIso = now.toISOString();
      const completedSaleRecord = {
        ...salePayload,
        id: String(createdSale.id || Date.now().toString()),
        invoiceNumber: invoiceNum,
        date: nowIso,
        displayTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        created_at: createdSale.createdAt || nowIso,
        items: [...enrichedCart],
        subtotalUSD,
        taxUSD,
        igtfUSD: currentIgtfUSD,
        baseImponibleUSD,
        totalUSD: totalDueUSD,
        totalBS: totalDueBS,
        method: effectiveMethod,
        changeUSD: finalChangeUSD,
        changeBS: finalChangeBS,
        status: 'synced',
        isOffline: false
      };

      // Guardar también en base de datos local
      try {
        if (localDb && localDb.sales) {
          await localDb.sales.put(completedSaleRecord);
        }
        await primaryDb.put('sales', completedSaleRecord);
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

      // Descontar inventario local inmediatamente considerando multiplicadores de empaque y presentaciones dinámicas
      setProducts(prev => prev.map(p => {
        const cartItemsForProd = cart.filter(c => getCleanProductId(c.product.productId || c.product.id) === String(p.id));
        if (cartItemsForProd.length > 0) {
          const totalUnitsToDeduct = cartItemsForProd.reduce((sum, item) => {
            const mult = getProductUnitsMultiplier(item.product);
            return sum + (item.quantity * mult);
          }, 0);
          const currentStock = Number(p.stockQuantity ?? p.stock ?? 0);
          const nextStock = Math.max(0, currentStock - totalUnitsToDeduct);
          return { 
            ...p, 
            stockQuantity: nextStock,
            stock: nextStock
          };
        }
        return p;
      }));

      // Persistir también el nuevo stock en IndexedDB local acumulando múltiples presentaciones del mismo producto
      try {
        if (localDb && localDb.products) {
          localDb.transaction('rw', localDb.products, async () => {
            const deductedByCleanId = new Map();
            for (const item of enrichedCart) {
              const cleanId = getCleanProductId(item.product.productId || item.product.id);
              const mult = getProductUnitsMultiplier(item.product);
              const unitsToDeduct = Number(item.quantity) * mult;
              deductedByCleanId.set(cleanId, (deductedByCleanId.get(cleanId) || 0) + unitsToDeduct);
            }
            for (const [cleanId, totalUnitsToDeduct] of deductedByCleanId.entries()) {
              const currentProd = productsMap.get(cleanId) || await localDb.products.get(cleanId);
              if (currentProd) {
                const currentStock = Number(currentProd.stockQuantity ?? currentProd.stock ?? 0);
                const newStock = Math.max(0, currentStock - totalUnitsToDeduct);
                await localDb.products.update(cleanId, { stockQuantity: newStock, stock: newStock });
              }
            }
          }).catch(() => {});
        }
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

      // Propagar por WebSockets a toda la red LAN para reflejo espejo simultáneo
      try {
        lanSyncService.broadcastSale(completedSaleRecord);
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }

      setSalesHistory(prev => [completedSaleRecord, ...prev]);

      if (autoPrint) {
        mobilePrinterService.enqueueSalePrint({
          sale: completedSaleRecord,
          businessSettings: {
            ...businessInfo,
            receiptWidth: localStorage.getItem('pos_mobile_paper_width') || '58mm'
          },
          exchangeRate,
          currencyMode: activeCurrencyMode
        });
        setPrintedReceipt(completedSaleRecord);
      }

      setCart([]);
      setCartDiscountPercent(0);
      setDiscountSupervisorApprovalId(null);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
      setPaymentReference('');
      playSuccessSound();
      showToast(`¡Venta #${invoiceNum} registrada en servidor PC!`);
    } catch (err) {
      console.warn('[MobilePOSSimulator] Error capturado en operación:', err?.message || err);
      const httpStatus = err?.response?.status;
      // Si el servidor PC respondió explícitamente con 4xx (ej. stock insuficiente, caja cerrada, 401/403), NO convertir en venta offline
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        const serverErrMsg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Venta rechazada por el servidor';
        showToast(serverErrMsg, 'error');
        return;
      }

      console.warn('[OFFLINE-ENGINE] Servidor PC no disponible o timeout de red. Persistiendo con ID inmutable:', persistentTransactionId);

      const offlineId = persistentTransactionId;
      const offlineInvoiceNum = `MOV-OFF-${persistentTransactionId.slice(-6).toUpperCase()}`;

      // Firma Criptográfica SHA-256 Antifraude para Auditoría Offline
      let cryptoSig = 'SHA256_LOCAL_STAMP';
      try {
        const rawPayload = `${offlineId}|${offlineInvoiceNum}|${totalDueUSD}|${user?.id || 'movil'}|${Date.now()}`;
        const buffer = new TextEncoder().encode(rawPayload);
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        cryptoSig = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error generando firma criptográfica local:', caughtErr?.message || caughtErr); }

      const nowOffline = new Date();
      const nowOfflineIso = nowOffline.toISOString();
      const offlineSaleRecord = {
        ...salePayload,
        id: String(offlineId),
        clientTransactionId: String(offlineId),
        terminalId: getTerminalId(),
        invoiceNumber: offlineInvoiceNum,
        cryptographicSignature: cryptoSig,
        date: nowOfflineIso,
        displayTime: nowOffline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        // Mantener items planos con productId real para sincronización, protección de stock y P2P; conservar enrichedCart para recibo visual
        items: Array.isArray(salePayload.items) ? [...salePayload.items] : [],
        displayItems: [...enrichedCart],
        subtotalUSD,
        taxUSD,
        igtfUSD: currentIgtfUSD,
        baseImponibleUSD,
        totalUSD: totalDueUSD,
        totalBS: totalDueBS,
        method: effectiveMethod,
        changeUSD: finalChangeUSD,
        changeBS: finalChangeBS,
        status: 'pending_sync',
        isOffline: true,
        created_at: nowOfflineIso
      };

      // Guardar en almacenamiento local (IndexedDB)
      try {
        if (localDb && localDb.sales) {
          await localDb.sales.put(offlineSaleRecord);
        }
        await primaryDb.put('sales', offlineSaleRecord);
      } catch (storeErr) {
        console.warn('Error guardando venta offline en DB:', storeErr);
      }

      // Descontar inventario local en la terminal para que el stock se mantenga exacto
      setProducts(prev => prev.map(p => {
        const cartItemsForProd = cart.filter(c => getCleanProductId(c.product.productId || c.product.id) === String(p.id));
        if (cartItemsForProd.length > 0) {
          const totalUnitsToDeduct = cartItemsForProd.reduce((sum, item) => {
            const mult = getProductUnitsMultiplier(item.product);
            return sum + (item.quantity * mult);
          }, 0);
          const currentStock = Number(p.stockQuantity ?? p.stock ?? 0);
          const nextStock = Math.max(0, currentStock - totalUnitsToDeduct);
          return { 
            ...p, 
            stockQuantity: nextStock,
            stock: nextStock
          };
        }
        return p;
      }));

      // Descontar en IndexedDB local de forma 100% ATÓMICA acumulando múltiples presentaciones del mismo producto
      try {
        if (localDb && localDb.products) {
          await localDb.transaction('rw', localDb.products, async () => {
            const deductedByCleanId = new Map();
            for (const item of enrichedCart) {
              const cleanId = getCleanProductId(item.product.productId || item.product.id);
              const mult = getProductUnitsMultiplier(item.product);
              const unitsToDeduct = Number(item.quantity) * mult;
              deductedByCleanId.set(cleanId, (deductedByCleanId.get(cleanId) || 0) + unitsToDeduct);
            }
            for (const [cleanId, totalUnitsToDeduct] of deductedByCleanId.entries()) {
              const currentProd = productsMap.get(cleanId) || await localDb.products.get(cleanId);
              if (currentProd) {
                const currentStock = Number(currentProd.stockQuantity ?? currentProd.stock ?? 0);
                const newStock = Math.max(0, currentStock - totalUnitsToDeduct);
                await localDb.products.update(cleanId, { stockQuantity: newStock, stock: newStock });
              }
            }
          });
        }
      } catch (_e) {
        console.warn('[OfflineSale] Error en deducción atómica de inventario local:', _e);
      }

      setSalesHistory(prev => [offlineSaleRecord, ...prev]);
      setPendingSalesCount(prev => prev + 1);

      if (autoPrint) {
        mobilePrinterService.enqueueSalePrint({
          sale: offlineSaleRecord,
          businessSettings: {
            ...businessInfo,
            receiptWidth: localStorage.getItem('pos_mobile_paper_width') || '58mm'
          },
          exchangeRate,
          currencyMode: activeCurrencyMode
        });
        setPrintedReceipt(offlineSaleRecord);
      }

      setCart([]);
      setCartDiscountPercent(0);
      setDiscountSupervisorApprovalId(null);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
      setPaymentReference('');
      playSuccessSound();
      showToast(`⚡ Venta #${offlineInvoiceNum} guardada offline. Se sincronizará al conectar con la PC.`);
    } finally {
      setIsProcessingSale(false);
    }
  };

  // 🌿 Formateador de Recibo Ecológico WhatsApp
  const generateEcoReceiptText = useCallback((sale) => {
    if (!sale) return '';
    const company = businessInfo?.name || localStorage.getItem('company_name') || 'Isaac POS';
    const rif = businessInfo?.rif || localStorage.getItem('company_rif') || '';
    const address = businessInfo?.address || localStorage.getItem('company_address') || '';

    const rawSaleDate = sale.created_at || sale.createdAt || sale.date || sale.timestamp;
    const parsedSaleDate = rawSaleDate ? new Date(rawSaleDate) : null;
    const formattedSaleDate = sale.displayTime
      || (parsedSaleDate && !Number.isNaN(parsedSaleDate.getTime())
        ? parsedSaleDate.toLocaleString('es-VE')
        : (rawSaleDate || new Date().toLocaleString('es-VE')));

    const lines = [
      `🧾 *COMPROBANTE DIGITAL DE COMPRA*`,
      `🏢 *${company.toUpperCase()}*`,
      ...(rif ? [`🔖 RIF / NIT: ${rif}`] : []),
      ...(address ? [`📍 ${address}`] : []),
      `--------------------------------`,
      `N° Documento: *${sale.invoiceNumber || sale.code || 'TICKET'}*`,
      `Fecha: ${formattedSaleDate}`,
      `Cliente: *${sale.customerName || 'Consumidor Final'}* ${sale.customerDoc ? `(${sale.customerDoc})` : ''}`,
      `Atendido por: ${user?.name || user?.username || 'Cajero'}`,
      `--------------------------------`,
      `🛒 *DETALLE DE PRODUCTOS:*`,
      ...(Array.isArray(sale.items) ? sale.items.map(item => {
        const q = item.quantity || 1;
        const name = item.product?.name || item.name || item.product?.nombre || 'Producto';
        const price = Number(item.finalSubtotal || (item.price * q) || (item.product?.price * q) || 0).toFixed(2);
        return `• ${q}x ${name} = $${price}`;
      }) : []),
      `--------------------------------`,
      `Subtotal: $${Number(sale.subtotal || sale.totalUSD || sale.total || 0).toFixed(2)}`,
      ...(sale.discount > 0 ? [`Descuento: -$${Number(sale.discount).toFixed(2)}`] : []),
      `*TOTAL USD: $${Number(sale.totalUSD || sale.total || 0).toFixed(2)}*`,
      `*TOTAL BS: Bs. ${Number(sale.totalBS || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`,
      `Tasa Oficial: Bs. ${Number(sale.exchangeRate || exchangeRate).toFixed(2)}`,
      `Forma de Pago: *${sale.method || sale.paymentMethod || 'Efectivo'}*`,
      ...(sale.paymentReference || (Array.isArray(sale.paymentMethods) && sale.paymentMethods[0]?.reference)
        ? [`Ref. Operación: *#${sale.paymentReference || sale.paymentMethods[0]?.reference}*`]
        : []),
      ...(sale.changeUSD > 0 ? [`Cambio Devuelto: $${Number(sale.changeUSD).toFixed(2)} (Bs. ${Number(sale.changeBS).toFixed(2)})`] : []),
      `--------------------------------`,
      `🌱 *Recibo Ecológico - Cuidemos el planeta*`,
      `✨ *¡Gracias por su preferencia!*`
    ];
    return lines.join('\n');
  }, [businessInfo, exchangeRate, user?.name, user?.username]);

  // Normalizador de teléfono internacional / venezolano
  const cleanWhatsAppPhone = (rawPhone) => {
    let clean = String(rawPhone || '').replace(/\D/g, '');
    if (!clean) return '';
    if (clean.startsWith('0') && clean.length === 11) {
      clean = '58' + clean.slice(1);
    } else if (clean.length === 10 && (clean.startsWith('414') || clean.startsWith('424') || clean.startsWith('412') || clean.startsWith('416') || clean.startsWith('426'))) {
      clean = '58' + clean;
    }
    return clean;
  };

  // Abrir Modal de Envío de Recibo Ecológico por WhatsApp
  const shareReceiptWhatsApp = (sale) => {
    if (!sale) return;
    setWhatsAppModalData(sale);
    setWhatsAppPhoneInput(sale.customerPhone || '');
  };

  const whatsAppMessagePreview = useMemo(() => {
    return generateEcoReceiptText(whatsAppModalData);
  }, [whatsAppModalData, generateEcoReceiptText]);

  const handleConfirmSendWhatsApp = () => {
    if (!whatsAppModalData) return;
    const phone = cleanWhatsAppPhone(whatsAppPhoneInput);
    if (!phone) {
      showToast('⚠️ Ingresa un número de WhatsApp válido');
      return;
    }
    const message = generateEcoReceiptText(whatsAppModalData);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    setWhatsAppModalData(null);
    showToast('Recibo digital enviado a WhatsApp');
  };

  const sharePreSaleWhatsApp = (preSale) => {
    if (!preSale) return;
    const text = `*PREVENTA ENVIADA A CAJA*\n🔖 Código: *${preSale.code || preSale.id || ''}*\n👤 Cliente: ${preSale.customerName || 'Consumidor Final'}\n💵 Total Estimado: $${Number(preSale.totalUSD || 0).toFixed(2)}\n\nPuede acercarse a caja para cancelar su pedido.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const printPreSaleBluetoothReceipt = (preSale) => {
    if (!preSale) return;
    mobilePrinterService.enqueueSalePrint({
      sale: preSale,
      businessSettings: { ...businessInfo, receiptWidth: localStorage.getItem('pos_mobile_paper_width') || '58mm' },
      exchangeRate,
      currencyMode: activeCurrencyMode
    });
    showToast('Imprimiendo ticket de preventa...');
  };

  // Manejo de Login Móvil Instantáneo
  const handleMobileLogin = async (e) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError('Introduce usuario y contraseña');
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);
    try {
      // Si el estado local ya detectó que el servidor no está disponible o no hay red, resolver en 0 ms
      const isKnownOffline = serverHealth === false || (typeof navigator !== 'undefined' && !navigator.onLine) || !socketConnected;
      const res = await login(loginUsername.trim(), loginPassword.trim(), { preferOffline: isKnownOffline });
      if (!res.success) {
        setLoginError(res.message || 'Credenciales incorrectas');
      } else {
        try {
          localStorage.setItem('isaac_pos_initial_sync_done', 'true');
          localStorage.setItem('initial_mobile_sync_completed', 'true');
        } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
        showToast(res.isOffline ? '⚡ Modo Autónomo Offline Activado' : '¡Bienvenido!');
        loadProducts();
        loadSettings();
        loadCustomers();
      }
    } catch (err) {
      setLoginError(err.response?.data?.error || err.message || 'Error al iniciar sesión');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Manejo de Login Móvil con Huella Dactilar (Zero-Trust Hardware TEE)
  const handleMobileBiometricLogin = async () => {
    setIsBioLoggingIn(true);
    setLoginError(null);
    try {
      const res = await loginWithBiometrics();
      if (res && (res === true || res.success)) {
        try {
          localStorage.setItem('isaac_pos_initial_sync_done', 'true');
          localStorage.setItem('initial_mobile_sync_completed', 'true');
        } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
        showToast(res.isOffline ? '⚡ Modo Autónomo Offline Activado' : '¡Bienvenido!');
        loadProducts();
        loadSettings();
        loadCustomers();
      } else {
        setLoginError(res?.message || 'No se pudo verificar la huella dactilar');
      }
    } catch (err) {
      console.error('Mobile biometric login error:', err);
      setLoginError(err.message || 'Error en autenticación biométrica');
    } finally {
      setIsBioLoggingIn(false);
    }
  };

  // Tokens de diseño alineados 1:1 con la versión de Escritorio (Memoizados para cero asignaciones en re-renders)
  const T = useMemo(() => ({
    appBg: isLight ? 'bg-[#f3f4f6] text-[#0a0d12]' : isOledMode ? 'bg-[#0b0d10] text-[#f1f5f9]' : 'bg-[#0b0d10] text-[#f1f5f9]',
    headerBg: isLight ? 'bg-white border-b border-[#e2e5eb]' : 'bg-[#0f1216] border-b border-[#1e232b]',
    subPanelBg: isLight ? 'bg-white' : 'bg-[#0f1216]',
    catalogBg: isLight ? 'bg-[#f3f4f6]' : 'bg-[#0b0d10]',
    cardBg: isLight 
      ? 'bg-white border-[#e2e5eb]' 
      : 'bg-[#14181e] border-[#232933]',
    cardExhausted: isLight 
      ? 'opacity-60 bg-[#f8f9fb] border-[#e2e5eb]' 
      : 'opacity-55 bg-[#101318] border-[#1e232b]',
    imgHolder: isLight ? 'bg-[#fafafb] border-[#edf0f4]' : 'bg-[#101318] border-[#1e232b]',
    textPrimary: isLight ? 'text-[#0a0d12]' : 'text-[#f1f5f9]',
    textSecondary: isLight ? 'text-[#475569]' : 'text-[#94a3b8]',
    textMuted: isLight ? 'text-[#64748b]' : 'text-[#64748b]',
    border: isLight ? 'border-[#e2e5eb]' : 'border-[#232933]',
    inputBg: isLight 
      ? 'bg-[#f4f5f7] border-[#d5dae2] text-[#0a0d12] placeholder-[#64748b] focus:bg-white focus:border-[#0a0d12]' 
      : 'bg-[#14181e] border-[#262c36] text-[#f1f5f9] placeholder-[#64748b] focus:bg-[#191e26] focus:border-[#64748b]',
    chipActive: isLight
      ? 'bg-[#0a0d12] text-white border border-[#0a0d12] shadow-xs'
      : 'bg-[#e2e8f0] text-[#090b0e] border border-[#e2e8f0] shadow-xs',
    chipInactive: isLight 
      ? 'bg-white text-[#475569] border border-[#d5dae2] hover:bg-[#f4f5f7] hover:text-[#0a0d12]' 
      : 'bg-[#14181e] text-[#94a3b8] border border-[#232933] hover:text-[#f1f5f9] hover:bg-[#1c222b]',
    btnGhost: isLight 
      ? 'bg-white hover:bg-[#f4f5f7] text-[#0f172a] border border-[#d5dae2] shadow-2xs' 
      : 'bg-[#14181e] hover:bg-[#1c222b] text-[#e2e8f0] border border-[#262c36]',
    ticketSidebar: isLight ? 'bg-[#fafbfc] border-l border-[#e2e5eb]' : 'bg-[#0f1216] border-l border-[#1e232b]',
    ticketItemBg: isLight ? 'bg-white border border-[#e6e8ee]' : 'bg-[#14181e] border border-[#232933]',
    rateBadge: isLight ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-[#14181e] border border-[#232933] text-amber-400',
    modalCard: isLight ? 'bg-white border border-[#e2e5eb] text-[#0a0d12] shadow-2xl' : 'bg-[#0f1216] border border-[#232933] text-[#f1f5f9] shadow-2xl',
    modalSubCard: isLight ? 'bg-[#f8f9fb] border border-[#e2e5eb]' : 'bg-[#14181e] border border-[#232933]'
  }), [isLight, isOledMode]);

  return (
    <div 
      onTouchStart={(e) => {
        if (e.touches && e.touches[0] && e.touches[0].clientX < 28) {
          edgeSwipeStartXRef.current = e.touches[0].clientX;
          edgeSwipeStartYRef.current = e.touches[0].clientY;
        } else {
          edgeSwipeStartXRef.current = null;
        }
      }}
      onTouchMove={(e) => {
        if (edgeSwipeStartXRef.current !== null && !isSideNavOpen && e.touches && e.touches[0]) {
          const dx = e.touches[0].clientX - edgeSwipeStartXRef.current;
          const dy = Math.abs(e.touches[0].clientY - edgeSwipeStartYRef.current);
          if (dx > 45 && dy < 40) {
            triggerHaptic(15);
            setIsSideNavOpen(true);
            edgeSwipeStartXRef.current = null;
          }
        }
      }}
      onTouchEnd={() => {
        edgeSwipeStartXRef.current = null;
      }}
      style={{
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)'
      }}
      className={`h-[100dvh] max-h-[100dvh] w-full ${T.appBg} flex flex-col font-sans antialiased transition-colors overflow-hidden select-none`}
    >
      
      {/* 1. CABECERA TÁCTICA UNIFICADA "ISAAC TACTICAL OS" (Solo visible cuando hay sesión activa de usuario) */}
      {user && (
        <MobilePOSHeader
          T={T}
          isLight={isLight}
          activeModule={activeModule}
          user={user}
          setIsSideNavOpen={setIsSideNavOpen}
          isRestaurantBusiness={isRestaurantBusiness}
          selectedTable={selectedTable}
          setIsTableSelectModalOpen={setIsTableSelectModalOpen}
          posMode={posMode}
          setIsPriceCheckerModalOpen={setIsPriceCheckerModalOpen}
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          setActiveModule={setActiveModule}
          setSearchQuery={setSearchQuery}
          showToast={showToast}
          setIsManualItemModalOpen={setIsManualItemModalOpen}
          openCreateProduct={openCreateProduct}
          heldSales={heldSales}
          setIsHeldSalesModalOpen={setIsHeldSalesModalOpen}
        />
      )}

      {/* 2. PANTALLA DE LOGIN SI NO HAY SESIÓN ACTIVA */}
      {!user ? (
        <MobilePOSLoginScreen
          T={T}
          isLight={isLight}
          businessInfo={businessInfo}
          serverHealth={serverHealth}
          mobileServerIp={mobileServerIp}
          setMobileServerIp={setMobileServerIp}
          showServerModal={showServerModal}
          setShowServerModal={setShowServerModal}
          serverFeedback={serverFeedback}
          setServerFeedback={setServerFeedback}
          loginError={loginError}
          enrolledBioUser={enrolledBioUser}
          handleMobileBiometricLogin={handleMobileBiometricLogin}
          isBioLoggingIn={isBioLoggingIn}
          isLoggingIn={isLoggingIn}
          handleMobileLogin={handleMobileLogin}
          loginUsername={loginUsername}
          setLoginUsername={setLoginUsername}
          loginPassword={loginPassword}
          setLoginPassword={setLoginPassword}
          isTestingServer={isTestingServer}
          handleAutoDiscoverServer={handleAutoDiscoverServer}
          handleTestAndSaveServer={handleTestAndSaveServer}
        />
      ) : activeModule === 'inventory' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
          <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
              <RefreshCw className="animate-spin text-blue-500" size={32} />
              <span className="text-xs font-bold text-slate-400">Cargando inventario...</span>
            </div>
          }>
            <MobileInventoryView 
              products={products}
              categories={normalizedCategories}
              exchangeRate={exchangeRate}
              T={T}
              isLight={isLight}
              user={user}
              onBackToPOS={() => setActiveModule('pos')}
              onProductUpdated={(upd) => {
                setProducts(prev => prev.map(p => String(p.id) === String(upd.id) ? { ...p, ...upd } : p));
              }}
              onProductCreated={(newProd) => {
                setProducts(prev => [newProd, ...prev]);
              }}
              onProductDeleted={(delId) => {
                setProducts(prev => prev.filter(p => String(p.id) !== String(delId)));
              }}
              showToast={showToast}
            />
          </Suspense>
        </div>
      ) : activeModule === 'sales' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
          <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
              <RefreshCw className="animate-spin text-blue-500" size={32} />
              <span className="text-xs font-bold text-slate-400">Cargando ventas...</span>
            </div>
          }>
            <MobileSalesView 
              sales={salesHistory}
              pendingSalesCount={pendingSalesCount}
              isSyncing={isSyncingSales}
              onSyncNow={syncOfflineSalesQueue}
              onRefresh={loadSalesHistory}
              onViewTicket={(sale) => setPrintedReceipt(sale)}
              onShareWhatsApp={(sale) => shareReceiptWhatsApp(sale)}
              onPrintTicket={(sale) => handlePrintBluetoothReceipt(sale)}
              onSaleCancelled={(saleId, updatedSale) => {
                setSalesHistory(prev => prev.map(s => String(s.id) === String(saleId) ? { ...s, ...updatedSale } : s));
                const itemsList = updatedSale?.items || updatedSale?.SaleItems;
                if (Array.isArray(itemsList) && itemsList.length > 0) {
                  setProducts(prev => prev.map(p => {
                    const match = itemsList.find(it => String(it.productId || it.product?.id || it.id) === String(p.id));
                    if (match) {
                      const returnQty = Number(match.quantity || 1);
                      const currentStock = Number(p.stockQuantity ?? p.stock ?? 0);
                      const newStock = currentStock + returnQty;
                      // Persistir en IndexedDB local
                      try {
                        if (localDb && localDb.products) {
                          localDb.products.update(String(p.id), { stockQuantity: newStock, stock: newStock }).catch((err) => console.warn('[MobilePOS] Error revirtiendo stock en IDB:', err?.message || err));
                        }
                        primaryDb.put('products', { ...p, stockQuantity: newStock, stock: newStock }).catch((err) => console.warn('[MobilePOS] Error revirtiendo stock en primaryDb:', err?.message || err));
                      } catch (caughtErr) { console.warn('[MobilePOSSimulator] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
                      return { ...p, stockQuantity: newStock, stock: newStock };
                    }
                    return p;
                  }));
                }
                setPendingSalesCount(prev => Math.max(0, prev - 1));
              }}
              user={user}
              showToast={showToast}
              T={T}
              isLight={isLight}
              exchangeRate={exchangeRate}
              onBackToPOS={() => setActiveModule('pos')}
            />
          </Suspense>
        </div>
      ) : activeModule === 'customers' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
          <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
              <RefreshCw className="animate-spin text-blue-500" size={32} />
              <span className="text-xs font-bold text-slate-400">Cargando clientes...</span>
            </div>
          }>
            <MobileCustomersView 
              onSelectCustomerForSale={(c) => {
                setCustomerName(c.name);
                setCustomerDoc(c.doc);
                showToast(`Cliente seleccionado: ${c.name}`);
              }}
              T={T}
              isLight={isLight}
              user={user}
              onBackToPOS={() => setActiveModule('pos')}
              showToast={showToast}
            />
          </Suspense>
        </div>
      ) : activeModule === 'cash' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
          <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
              <RefreshCw className="animate-spin text-blue-500" size={32} />
              <span className="text-xs font-bold text-slate-400">Cargando control de caja...</span>
            </div>
          }>
            <MobileCashView 
              sales={salesHistory}
              user={user}
              exchangeRate={exchangeRate}
              T={T}
              isLight={isLight}
              onBackToPOS={() => setActiveModule('pos')}
              showToast={showToast}
            />
          </Suspense>
        </div>
      ) : activeModule === 'expenses' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
          <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
              <RefreshCw className="animate-spin text-blue-500" size={32} />
              <span className="text-xs font-bold text-slate-400">Cargando gastos...</span>
            </div>
          }>
            <MobileExpensesView 
              exchangeRate={exchangeRate}
              user={user}
              T={T}
              isLight={isLight}
              onBackToPOS={() => setActiveModule('pos')}
              showToast={showToast}
            />
          </Suspense>
        </div>
      ) : activeModule === 'sync' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
          <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
              <RefreshCw className="animate-spin text-blue-500" size={32} />
              <span className="text-xs font-bold text-slate-400">Cargando centro de sincronización...</span>
            </div>
          }>
            <MobileSyncCenterView 
              isOnline={isOnline}
              socketConnected={socketConnected}
              pendingSalesCount={pendingSalesCount}
              productsCount={products.length}
              isSyncing={isSyncingSales}
              onSyncNow={syncOfflineSalesQueue}
              onRefreshCatalog={loadProducts}
              T={T}
              isLight={isLight}
              onBackToPOS={() => setActiveModule('pos')}
              showToast={showToast}
              onOpenServerConfig={() => setShowServerModal(true)}
            />
          </Suspense>
        </div>
      ) : activeModule === 'receivables' ? (
        <MobileSubViewWrapper title="Por Cobrar" subtitle="Saldos pendientes y cobranzas" icon={DollarSign} onBack={() => setActiveModule('pos')} T={T}>
          <AccountsReceivablePage />
        </MobileSubViewWrapper>
      ) : activeModule === 'collections' ? (
        <MobileSubViewWrapper title="Cobranza" subtitle="Control de cartera y morosidad" icon={Coins} onBack={() => setActiveModule('pos')} T={T}>
          <AssetsAndCollectionsPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'promotions' ? (
        <MobileSubViewWrapper title="Promociones" subtitle="Descuentos automáticos y ofertas" icon={Tag} onBack={() => setActiveModule('pos')} T={T}>
          <PromotionsManagerPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'importer' ? (
        <MobileSubViewWrapper title="Importar" subtitle="Carga masiva por Excel / CSV" icon={FileSpreadsheet} onBack={() => setActiveModule('pos')} T={T}>
          <CatalogImporterPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'suppliers' ? (
        <MobileSubViewWrapper title="Proveedores" subtitle="Directorio y compras" icon={Truck} onBack={() => setActiveModule('pos')} T={T}>
          <SuppliersPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'payables' ? (
        <MobileSubViewWrapper title="Por Pagar" subtitle="Facturas pendientes de pago" icon={CreditCard} onBack={() => setActiveModule('pos')} T={T}>
          <AccountsPayablePage />
        </MobileSubViewWrapper>
      ) : activeModule === 'fiscal' ? (
        <MobileSubViewWrapper title="Fiscal SENIAT" subtitle="Libros de compra/venta e IGTF" icon={FileText} onBack={() => setActiveModule('pos')} T={T}>
          <FiscalManagerPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'bi' ? (
        <MobileSubViewWrapper title="P&L Gerencial" subtitle="Rentabilidad y estado de resultados" icon={TrendingUp} onBack={() => setActiveModule('pos')} T={T}>
          <ExecutiveBIPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'reports' ? (
        <MobileSubViewWrapper title="Reportes" subtitle="Estadísticas de ventas y finanzas" icon={PieChart} onBack={() => setActiveModule('pos')} T={T}>
          <ReportsPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'accounting' ? (
        <MobileSubViewWrapper title="Contabilidad" subtitle="Plan de cuentas y asientos PUC" icon={Scale} onBack={() => setActiveModule('pos')} T={T}>
          <AccountingGeneralPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'payroll' ? (
        <MobileSubViewWrapper title="Nómina" subtitle="Personal y pagos de nómina" icon={Users} onBack={() => setActiveModule('pos')} T={T}>
          <PayrollManagerPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'assets' ? (
        <MobileSubViewWrapper title="Activos Fijos" subtitle="Bienes y cálculo de depreciación" icon={Building2} onBack={() => setActiveModule('pos')} T={T}>
          <AssetsAndCollectionsPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'audit' ? (
        <MobileSubViewWrapper title="Auditoría" subtitle="Bitácora y eventos del sistema" icon={ShieldCheck} onBack={() => setActiveModule('pos')} T={T}>
          <AuditPanelPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'cash-monitoring' ? (
        <MobileSubViewWrapper title="Monitor Cajas" subtitle="Control en vivo de cajeros" icon={Shield} onBack={() => setActiveModule('pos')} T={T}>
          <CashierAuditCenterPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'branches' ? (
        <MobileSubViewWrapper title="Sucursales" subtitle="Tiendas y sedes del negocio" icon={Store} onBack={() => setActiveModule('pos')} T={T}>
          <BranchesPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'users' ? (
        <MobileSubViewWrapper title="Usuarios" subtitle="Cajeros, roles y permisos" icon={UserCog} onBack={() => setActiveModule('pos')} T={T}>
          <UsersPage />
        </MobileSubViewWrapper>
      ) : activeModule === 'settings' ? (
        <MobileSubViewWrapper title="Ajustes" subtitle="Tienda, moneda e impresoras" icon={Settings} onBack={() => setActiveModule('pos')} T={T}>
          <SettingsPage />
        </MobileSubViewWrapper>
      ) : (
        /* 3. TERMINAL POS ACTIVA (100% RESPONSIVA: TELÉFONOS, PLEGABLES Y TABLETS EN PANTALLA DIVIDIDA) */
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden w-full">
          
          {/* COLUMNA IZQUIERDA / PRINCIPAL: CATÁLOGO Y BÚSQUEDA */}
          <div className={`pos-catalog-canvas flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden ${T.catalogBg}`}>
            
            <MobilePOSCatalogSection
              T={T}
              isLight={isLight}
              normalizedCategories={normalizedCategories}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              categoryCounts={categoryCounts}
              toggleCatalogLayout={toggleCatalogLayout}
              catalogLayout={catalogLayout}
              catalogScrollRef={catalogScrollRef}
              handleCatalogScroll={handleCatalogScroll}
              handleCatalogTouchStart={handleCatalogTouchStart}
              handleCatalogTouchMove={handleCatalogTouchMove}
              handleCatalogTouchEnd={handleCatalogTouchEnd}
              pullIndicatorRef={pullIndicatorRef}
              isPullRefreshing={isPullRefreshing}
              filteredProducts={filteredProducts}
              products={products}
              openCreateProduct={openCreateProduct}
              setIsManualItemModalOpen={setIsManualItemModalOpen}
              virtualProducts={virtualProducts}
              cartCommittedUnitsMap={cartCommittedUnitsMap}
              exchangeRate={exchangeRate}
              businessMode={businessMode}
              posMode={posMode}
              addToCart={addToCart}
              decrementFromCard={decrementFromCard}
              handleOpenBulkPicker={handleOpenBulkPicker}
              handlePriceCheck={handlePriceCheck}
              openEditProduct={openEditProduct}
              handlePreviewImage={handlePreviewImage}
              catalogColumns={catalogColumns}
              catalogHasMore={catalogHasMore}
              loadMoreCatalogItems={loadMoreCatalogItems}
              catalogRemainingCount={catalogRemainingCount}
              showAllCatalogItems={showAllCatalogItems}
            />

            <MobilePOSBottomDock
              isLight={isLight}
              cart={cart}
              totalItemsCount={totalItemsCount}
              totalUSD={totalUSD}
              totalBS={totalBS}
              setIsMobileCartOpen={setIsMobileCartOpen}
              handleSelectPaymentMethod={handleSelectPaymentMethod}
              setIsCheckoutOpen={setIsCheckoutOpen}
              activeModule={activeModule}
              setActiveModule={setActiveModule}
              pendingSalesCount={pendingSalesCount}
              setIsScannerOpen={setIsScannerOpen}
            />
          </div>

          {/* COLUMNA DERECHA PERMANENTE EN TABLETS / PANTALLAS GRANDES (lg: >= 1024px) */}
          <MobileTabletCartPanel
            T={T}
            totalItemsCount={totalItemsCount}
            cart={cart}
            enrichedCart={enrichedCart}
            products={products}
            productsMap={productsMap}
            isUnlimitedStockProduct={isUnlimitedStockProduct}
            requestSupervisorAuth={requestSupervisorAuth}
            clearCart={clearCart}
            showToast={showToast}
            customerName={customerName}
            customerDoc={customerDoc}
            onOpenCustomerSelect={() => {
              triggerHaptic(10);
              setCustomerSearch('');
              setIsCreatingCustomerInMobile(false);
              setIsCustomerSelectModalOpen(true);
            }}
            updateQuantity={updateQuantity}
            openQuantityModal={openQuantityModal}
            removeFromCart={removeFromCart}
            cartDiscountPercent={cartDiscountPercent}
            handleApplyDiscount={handleApplyDiscount}
            cartDiscountAmountUSD={cartDiscountAmountUSD}
            taxUSD={taxUSD}
            totalUSD={totalUSD}
            totalBS={totalBS}
            handleHoldSale={handleHoldSale}
            onProceedToCheckout={() => {
              handleSelectPaymentMethod('Efectivo USD');
              setIsCheckoutOpen(true);
            }}
          />
        </div>
      )}

      {/* 4. BOTTOM SHEET DEL CARRITO CON GESTOS TÁCTILES NATIVOS (DRAG TO DISMISS + SWIPE TO DELETE) */}
      <MobileCartSheet
        isOpen={isMobileCartOpen}
        onClose={() => setIsMobileCartOpen(false)}
        T={T}
        triggerHaptic={triggerHaptic}
        totalItemsCount={totalItemsCount}
        cart={cart}
        enrichedCart={enrichedCart}
        products={products}
        productsMap={productsMap}
        isUnlimitedStockProduct={isUnlimitedStockProduct}
        requestSupervisorAuth={requestSupervisorAuth}
        clearCart={clearCart}
        showToast={showToast}
        customerName={customerName}
        customerDoc={customerDoc}
        onOpenCustomerSelect={() => {
          triggerHaptic(10);
          setCustomerSearch('');
          setIsCreatingCustomerInMobile(false);
          setIsCustomerSelectModalOpen(true);
        }}
        onOpenManualItem={() => {
          setIsMobileCartOpen(false);
          setIsManualItemModalOpen(true);
        }}
        heldSales={heldSales}
        onOpenHeldSales={() => {
          setIsMobileCartOpen(false);
          setIsHeldSalesModalOpen(true);
        }}
        updateQuantity={updateQuantity}
        openQuantityModal={openQuantityModal}
        removeFromCart={removeFromCart}
        cartDiscountPercent={cartDiscountPercent}
        handleApplyDiscount={handleApplyDiscount}
        cartDiscountAmountUSD={cartDiscountAmountUSD}
        taxUSD={taxUSD}
        totalUSD={totalUSD}
        totalBS={totalBS}
        handleHoldSale={handleHoldSale}
        handleSendPreSaleToMainRegister={handleSendPreSaleToMainRegister}
        selectedTable={selectedTable}
        orderNotes={orderNotes}
        onOpenTableSelect={() => setIsTableSelectModalOpen(true)}
        onProceedToCheckout={() => {
          handleSelectPaymentMethod('Efectivo USD');
          setIsCheckoutOpen(true);
        }}
      />

      {/* CAPA MODULAR DE MODALES SECUNDARIOS Y OVERLAYS */}
      <MobileSimulatorModals
        T={T}
        isLight={isLight}
        isOledMode={isOledMode}
        exchangeRate={exchangeRate}
        businessInfo={businessInfo}
        user={user}
        isDollarCountry={isDollarCountry}
        triggerHaptic={triggerHaptic}
        playScanSound={playScanSound}
        showToast={showToast}
        getImageUrl={getImageUrl}
        isUnlimitedStockProduct={isUnlimitedStockProduct}
        products={products}
        cart={cart}
        addToCart={addToCart}
        heldSales={heldSales}
        handleDeleteHeldSale={handleDeleteHeldSale}
        handleRestoreHeldSale={handleRestoreHeldSale}
        isCheckoutOpen={isCheckoutOpen}
        setIsCheckoutOpen={setIsCheckoutOpen}
        documentType={documentType}
        setDocumentType={setDocumentType}
        totalUSD={totalDueUSD}
        totalBS={totalDueBS}
        taxUSD={taxUSD}
        currentIgtfUSD={currentIgtfUSD}
        igtfRate={igtfRatePct}
        customerDoc={customerDoc}
        setCustomerDoc={setCustomerDoc}
        customerName={customerName}
        setCustomerName={setCustomerName}
        setCustomerSearch={setCustomerSearch}
        setIsCreatingCustomerInMobile={setIsCreatingCustomerInMobile}
        setIsCustomerSelectModalOpen={setIsCustomerSelectModalOpen}
        isProcessingSale={isProcessingSale}
        handleSaveQuotation={handleSaveQuotation}
        checkoutMode={checkoutMode}
        setCheckoutMode={setCheckoutMode}
        selectedMethod={selectedMethod}
        handleSelectPaymentMethod={handleSelectPaymentMethod}
        cashAccumulateMode={cashAccumulateMode}
        setCashAccumulateMode={setCashAccumulateMode}
        amountPaidUSD={amountPaidUSD}
        setAmountPaidUSD={setAmountPaidUSD}
        amountPaidBS={amountPaidBS}
        setAmountPaidBS={setAmountPaidBS}
        totalPaidInUSD={totalPaidInUSD}
        paidUSD={paidUSD}
        paidBS={paidBS}
        changeUSD={changeUSD}
        changeBS={changeBS}
        splitPayments={splitPayments}
        setSplitPayments={setSplitPayments}
        splitPaidUSD={splitPaidUSD}
        splitRemainingUSD={splitRemainingUSD}
        splitChangeUSD={splitChangeUSD}
        paymentReference={paymentReference}
        setPaymentReference={setPaymentReference}
        handleConfirmSale={handleConfirmSale}
        printedReceipt={printedReceipt}
        setPrintedReceipt={setPrintedReceipt}
        handlePrintBluetoothReceipt={handlePrintBluetoothReceipt}
        setIsThermalPrinterModalOpen={setIsThermalPrinterModalOpen}
        isThermalPrinterModalOpen={isThermalPrinterModalOpen}
        shareReceiptWhatsApp={shareReceiptWhatsApp}
        printerSpoolerStatus={printerSpoolerStatus}
        preSaleSentModal={preSaleSentModal}
        setPreSaleSentModal={setPreSaleSentModal}
        printPreSaleBluetoothReceipt={printPreSaleBluetoothReceipt}
        sharePreSaleWhatsApp={sharePreSaleWhatsApp}
        whatsAppModalData={whatsAppModalData}
        setWhatsAppModalData={setWhatsAppModalData}
        whatsAppPhoneInput={whatsAppPhoneInput}
        setWhatsAppPhoneInput={setWhatsAppPhoneInput}
        handleConfirmSendWhatsApp={handleConfirmSendWhatsApp}
        whatsAppMessagePreview={whatsAppMessagePreview}
        generateEcoReceiptText={generateEcoReceiptText}
        cleanWhatsAppPhone={cleanWhatsAppPhone}
        selectedProductForVariant={selectedProductForVariant}
        setSelectedProductForVariant={setSelectedProductForVariant}
        selectedProductForBulk={selectedProductForBulk}
        setSelectedProductForBulk={setSelectedProductForBulk}
        handleSelectBulkPresentation={handleSelectBulkPresentation}
        selectedProductForControlledMed={selectedProductForControlledMed}
        setSelectedProductForControlledMed={setSelectedProductForControlledMed}
        isQuantityModalOpen={isQuantityModalOpen}
        setIsQuantityModalOpen={setIsQuantityModalOpen}
        quantityModalItem={quantityModalItem}
        setQuantityModalItem={setQuantityModalItem}
        handleApplyQuantity={handleApplyQuantity}
        isScannerOpen={isScannerOpen}
        setIsScannerOpen={setIsScannerOpen}
        scannerTarget={scannerTarget}
        setScannerTarget={setScannerTarget}
        posMode={posMode}
        setPosMode={setPosMode}
        handleBarcodeScanned={handleBarcodeScanned}
        openCreateProduct={openCreateProduct}
        openEditProduct={openEditProduct}
        isQuickProductModalOpen={isQuickProductModalOpen}
        setIsQuickProductModalOpen={setIsQuickProductModalOpen}
        productFormData={productFormData}
        setProductFormData={setProductFormData}
        handleSaveProduct={handleSaveProduct}
        isSavingProduct={isSavingProduct}
        isUploadingImage={isUploadingImage}
        handleProductImageUpload={handleProductImageUpload}
        isImageSearchModalOpen={isImageSearchModalOpen}
        setIsImageSearchModalOpen={setIsImageSearchModalOpen}
        generateInternalEanBarcode={generateInternalEanBarcode}
        isCustomCategoryMode={isCustomCategoryMode}
        setIsCustomCategoryMode={setIsCustomCategoryMode}
        selectableCategories={selectableCategories}
        unregisteredBarcodeNotice={unregisteredBarcodeNotice}
        setUnregisteredBarcodeNotice={setUnregisteredBarcodeNotice}
        copyBarcodeToClipboard={copyBarcodeToClipboard}
        priceCheckerProduct={priceCheckerProduct}
        setPriceCheckerProduct={setPriceCheckerProduct}
        isPriceCheckerModalOpen={isPriceCheckerModalOpen}
        setIsPriceCheckerModalOpen={setIsPriceCheckerModalOpen}
        priceCheckerSearch={priceCheckerSearch}
        setPriceCheckerSearch={setPriceCheckerSearch}
        previewProductImage={previewProductImage}
        setPreviewProductImage={setPreviewProductImage}
        isManualItemModalOpen={isManualItemModalOpen}
        setIsManualItemModalOpen={setIsManualItemModalOpen}
        manualItemName={manualItemName}
        setManualItemName={setManualItemName}
        manualItemPrice={manualItemPrice}
        setManualItemPrice={setManualItemPrice}
        manualItemPriceBS={manualItemPriceBS}
        setManualItemPriceBS={setManualItemPriceBS}
        manualItemQty={manualItemQty}
        setManualItemQty={setManualItemQty}
        handleAddManualItem={handleAddManualItem}
        isHeldSalesModalOpen={isHeldSalesModalOpen}
        setIsHeldSalesModalOpen={setIsHeldSalesModalOpen}
        isSideNavOpen={isSideNavOpen}
        setIsSideNavOpen={setIsSideNavOpen}
        socketConnected={socketConnected}
        pendingSalesCount={pendingSalesCount}
        drawerSearch={drawerSearch}
        setDrawerSearch={setDrawerSearch}
        filteredNavSections={filteredNavSections}
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        setIsBiometricsModalOpen={setIsBiometricsModalOpen}
        isBiometricsModalOpen={isBiometricsModalOpen}
        setEnrolledBioUser={setEnrolledBioUser}
        isAudioMuted={isAudioMuted}
        setIsAudioMuted={setIsAudioMuted}
        toggleSoundMute={toggleSoundMute}
        theme={theme}
        setTheme={setTheme}
        logout={logout}
        toastMsg={toastMsg}
        supervisorAuthRequest={supervisorAuthRequest}
        setSupervisorAuthRequest={setSupervisorAuthRequest}
        lastHardwareScan={lastHardwareScan}
        isTableSelectModalOpen={isTableSelectModalOpen}
        setIsTableSelectModalOpen={setIsTableSelectModalOpen}
        selectedTable={selectedTable}
        setSelectedTable={setSelectedTable}
        orderNotes={orderNotes}
        setOrderNotes={setOrderNotes}
        isCustomerSelectModalOpen={isCustomerSelectModalOpen}
        customers={customers}
        isCreatingCustomerInMobile={isCreatingCustomerInMobile}
        customerSearch={customerSearch}
        filteredCustomers={filteredCustomers}
        handleSelectCustomer={handleSelectCustomer}
        newCustomerForm={newCustomerForm}
        setNewCustomerForm={setNewCustomerForm}
        handleSaveNewCustomer={handleSaveNewCustomer}
        isSavingCustomer={isSavingCustomer}
      />
    </div>
  );
}
