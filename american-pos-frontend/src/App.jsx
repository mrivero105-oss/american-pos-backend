import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import toast, { Toaster, ToastBar } from 'react-hot-toast';
import ProtectedRoute from './components/ProtectedRoute';
const DashboardLayout = lazy(() => import('./components/DashboardLayout'));
const Login = lazy(() => import('./pages/Login'));
const POS = lazy(() => import('./pages/POS'));

// Lazy-loaded secondary pages (reduces initial mobile bundle by over 90%)
const InventoryDashboard = lazy(() => import('./pages/InventoryDashboard'));
const Customers = lazy(() => import('./pages/Customers'));
const Settings = lazy(() => import('./pages/Settings'));
const Users = lazy(() => import('./pages/Users'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reports = lazy(() => import('./pages/Reports'));
const CashRegister = lazy(() => import('./pages/CashRegister'));
const CashierAuditCenter = lazy(() => import('./pages/CashierAuditCenter'));
const AuditPanel = lazy(() => import('./pages/AuditPanel'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const Branches = lazy(() => import('./pages/Branches'));
const SalesManager = lazy(() => import('./pages/SalesManager'));
const PurchaseReceipts = lazy(() => import('./pages/PurchaseReceipts'));
const Licenses = lazy(() => import('./pages/Licenses'));
const AccountsReceivable = lazy(() => import('./pages/AccountsReceivable'));
const AccountsPayable = lazy(() => import('./pages/AccountsPayable'));
const CatalogImporter = lazy(() => import('./pages/CatalogImporter'));
const PublicStore = lazy(() => import('./pages/PublicStore'));
const FiscalManager = lazy(() => import('./pages/FiscalManager'));
const ExecutiveBI = lazy(() => import('./pages/ExecutiveBI'));
const AccountingGeneral = lazy(() => import('./pages/AccountingGeneral'));
const PayrollManager = lazy(() => import('./pages/PayrollManager'));
const PromotionsManager = lazy(() => import('./pages/PromotionsManager'));
const WarehousesManager = lazy(() => import('./pages/WarehousesManager'));
const LotsTraceability = lazy(() => import('./pages/LotsTraceability'));
const AssetsAndCollections = lazy(() => import('./pages/AssetsAndCollections'));
const MobilePOSSimulator = lazy(() => import('./pages/MobilePOSSimulator'));
const CustomerDisplay = lazy(() => import('./pages/CustomerDisplay'));
import { syncManager } from './services/syncManager';
const LockScreen = lazy(() => import('./components/LockScreen'));
const ActivationPortal = lazy(() => import('./components/ActivationPortal'));
const SetupWizard = lazy(() => import('./components/SetupWizard'));
import SplashScreen from './components/SplashScreen';
const MobileInitialSyncWizard = lazy(() => import('./components/MobileInitialSyncWizard'));
import { useAuth } from './hooks/AuthContext';
import { useTheme } from './hooks/ThemeContext';
import { useWin7Zoom } from './hooks/useWin7Zoom';
import api from './services/api';
import { otaUpdateService } from './services/otaUpdateService';
import { cloudRateSyncService } from './services/cloudRateSyncService';
import lanSyncService from './services/lanSyncService';

const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  // 1. If running on desktop OS (Windows, macOS, Linux desktop) or Electron, it is NEVER a mobile device
  const ua = navigator.userAgent || '';
  const isDesktopOS = /Windows NT|Macintosh|Linux x86_64|Win64|WOW64/i.test(ua) && !/Android/i.test(ua);
  if (isDesktopOS && !window.Capacitor && window.location.protocol !== 'capacitor:') {
    return false;
  }
  // 2. Real Native Capacitor on Android/iOS
  const isCapacitorNative = Boolean(
    (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) ||
    window.location.protocol === 'capacitor:'
  );
  if (isCapacitorNative) return true;

  // 3. Mobile operating systems user agent (smartphones / tablets)
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
};

const RouteLoader = () => (
  <div className="flex-1 h-full min-h-[60vh] flex flex-col items-center justify-center gap-3">
    <RefreshCw className="animate-spin text-primary-500" size={32} />
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cargando Módulo...</span>
  </div>
);

// Componente para asegurar que toda alerta se cierre automáticamente sin quedarse congelada en pantallas táctiles
function AutoDismissToast({ toast: t }) {
  useEffect(() => {
    const dur = t.duration || (t.type === 'error' ? 4000 : 3000);
    if (dur !== Infinity) {
      const timer = setTimeout(() => {
        toast.dismiss(t.id);
        setTimeout(() => toast.remove(t.id), 350);
      }, dur);
      return () => clearTimeout(timer);
    }
  }, [t.id, t.duration, t.type]);

  const handleDismiss = (e) => {
    if (e) e.stopPropagation();
    toast.dismiss(t.id);
    setTimeout(() => toast.remove(t.id), 250);
  };

  return (
    <ToastBar toast={t} style={{ ...t.style }}>
      {({ icon, message }) => (
        <div
          className="flex items-center gap-2.5 w-full cursor-pointer select-none"
          onClick={handleDismiss}
          title="Toca para descartar"
        >
          <div className="shrink-0">{icon}</div>
          <div className="flex-1 text-xs font-bold leading-snug">{message}</div>
          {t.type !== 'loading' && (
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 active:scale-90 transition-all cursor-pointer shrink-0"
              title="Cerrar notificación"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
    </ToastBar>
  );
}

function App() {
  useWin7Zoom();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || theme === '2025' || theme === 'glass' || theme === 'oled' || theme === 'titanium';
  const { isLocked, user, appUnlock, logout, appLock, isActivated, machineId, licenseInfo, licenseLoading, setIsActivated, checkLicense } = useAuth();
  const [isSetup, setIsSetup] = useState(true);
  const [setupLoading, setSetupLoading] = useState(false);
  const [hasCheckedSetup, setHasCheckedSetup] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('isaac_pos_is_setup') === 'true';
    } catch {
      return false;
    }
  });
  // Electron ya muestra splash.html nativo al iniciar; evitar segundo splash bloqueante de 1s en desktop
  const [showSplash, setShowSplash] = useState(() => !(typeof window !== 'undefined' && window.electronAPI));
  
  // Mandatory Initial Mobile Sync State
  const [isInitialSyncDone, setIsInitialSyncDone] = useState(() => {
    const isMobile = isMobileDevice();
    if (!isMobile) return true;
    return (
      localStorage.getItem('isaac_pos_initial_sync_done') === 'true' || 
      localStorage.getItem('initial_mobile_sync_completed') === 'true'
    );
  });

  const [currentHash, setCurrentHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));

  useEffect(() => {
    otaUpdateService.init();
    cloudRateSyncService.init();
    if (!isMobileDevice()) {
      // En PC de escritorio, purgar cualquier residuo de modo offline accidental
      if (localStorage.getItem('isaac_pos_is_offline_mode') === 'true') {
        localStorage.removeItem('isaac_pos_is_offline_mode');
      }
      localStorage.setItem('isaac_pos_initial_sync_done', 'true');
    }
    const handleHashChange = () => {
      setCurrentHash(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      cloudRateSyncService.destroy();
    };
  }, []);

  const isPublicRoute = (() => {
    if (typeof window === 'undefined') return false;
    const hash = (currentHash || window.location.hash || '').toLowerCase();
    const path = (window.location.pathname || '').toLowerCase();
    return (
      hash.includes('/display') ||
      hash.includes('/customer-display') ||
      hash.includes('/store') ||
      path.includes('/display') ||
      path.includes('/customer-display') ||
      path.includes('/store')
    );
  })();

  const checkSetup = useCallback(async () => {
    if (!user) {
      setSetupLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/settings/is-setup');
      const setupDone = data.isSetup !== false;
      setIsSetup(setupDone);
      try {
        localStorage.setItem('isaac_pos_is_setup', setupDone ? 'true' : 'false');
      } catch (storageErr) {
        console.warn('[App] No se pudo persistir is_setup en localStorage:', storageErr?.message);
      }
    } catch (e) {
      console.warn('Notice checking setup:', e.message);
      setIsSetup(true);
    } finally {
      setHasCheckedSetup(true);
      setSetupLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      checkSetup();
      try {
        lanSyncService.init();
      } catch (err) {
        console.warn('[App] Error al inicializar lanSyncService:', err);
      }
    } else {
      setSetupLoading(false);
      try {
        lanSyncService.stop();
      } catch (err) {
        console.warn('[App] Error al detener lanSyncService:', err);
      }
    }
  }, [user, checkSetup]);

  useEffect(() => {
    // Global Shortcuts
    const handleGlobalShortcuts = (e) => {
      // Manual Lock with Ctrl+L or F1
      if (((e.ctrlKey && e.key === 'l') || e.key === 'F1') && !isLocked) {
        e.preventDefault();
        appLock();
        return;
      }

      // Calculator with F10
      if (e.key === 'F10' && !isLocked) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-calculator'));
        return;
      }

      if (isLocked) return;
      
      const overlays = Array.from(document.querySelectorAll('.fixed.inset-0, .fixed.inset-y-0.inset-x-0'));
      if (overlays.length === 0) return;

      const topOverlay = overlays.sort((a, b) => {
        const zA = parseInt(window.getComputedStyle(a).zIndex) || 0;
        const zB = parseInt(window.getComputedStyle(b).zIndex) || 0;
        return zB - zA;
      })[0];

      if (!topOverlay) return;

      if (e.key === 'Escape') {
        const xButton = topOverlay.querySelector('button svg.lucide-x')?.closest('button');
        if (xButton) { xButton.click(); return; }
        const closeLabels = ['cerrar', 'cancelar', 'close', 'cancel'];
        const closeBtn = Array.from(topOverlay.querySelectorAll('button')).find(b => {
          const text = b.innerText?.toLowerCase().trim() || '';
          return closeLabels.some(label => text.includes(label));
        });
        if (closeBtn) { closeBtn.click(); return; }
      }

      if (e.key === 'Enter') {
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
        const confirmBtn = Array.from(topOverlay.querySelectorAll('button')).find(b => {
          const text = b.innerText?.toLowerCase().trim() || '';
          return text.includes('[enter]') || text.includes('confirmar') || text.includes('aceptar');
        });
        if (confirmBtn) { e.preventDefault(); confirmBtn.click(); }
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);

    const handleOfflineSalesSynced = (e) => {
      const count = e.detail?.count || 1;
      toast.success(`⚡ ¡${count} venta(s) fuera de línea sincronizada(s) con éxito!`, {
        id: 'offline-synced-toast',
        duration: 4500
      });
    };
    window.addEventListener('offline-sales-synced', handleOfflineSalesSynced);

    let stopSync = () => {};
    if (!isLocked) {
      stopSync = syncManager.startAutoSync(20000);
    }

    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
      window.removeEventListener('offline-sales-synced', handleOfflineSalesSynced);
      stopSync();
    };
  }, [isLocked, appLock]);

  return (
    <>
      <Toaster
        position={typeof window !== 'undefined' && window.innerWidth <= 768 ? "top-center" : "top-right"}
        containerStyle={{
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          left: 12,
          right: 12,
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          zIndex: 2147483647
        }}
        toastOptions={{
          duration: 3500,
          success: {
            duration: 3000
          },
          error: {
            duration: 4000
          },
          style: {
            background: isDark ? '#1e293b' : '#ffffff',
            color: isDark ? '#ffffff' : '#0f172a',
            borderRadius: '1rem',
            border: isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid #e2e8f0',
            fontSize: '13px',
            fontWeight: '600',
            boxShadow: isDark
              ? '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3)'
              : '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            maxWidth: '420px',
            cursor: 'pointer'
          }
        }}
      >
        {(t) => <AutoDismissToast toast={t} />}
      </Toaster>
      {showSplash && !isPublicRoute && <SplashScreen onFinished={() => setShowSplash(false)} minDuration={1000} />}
      {isPublicRoute ? (
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/display" element={<CustomerDisplay />} />
            <Route path="/customer-display" element={<CustomerDisplay />} />
            <Route path="/store/:companyId" element={<PublicStore />} />
            <Route path="*" element={<CustomerDisplay />} />
          </Routes>
        </Suspense>
      ) : licenseLoading ? (
        <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center gap-4">
          <RefreshCw className="animate-spin text-blue-500" size={40} />
          <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px]">Verificando Licencia...</p>
        </div>
      ) : !isActivated ? (
        <Suspense fallback={<RouteLoader />}>
          <ActivationPortal 
            machineId={machineId} 
            licenseInfo={licenseInfo}
            onActivated={async () => {
              setIsActivated(true);
              if (checkLicense) await checkLicense();
            }} 
          />
        </Suspense>
      ) : (!isInitialSyncDone && isMobileDevice()) ? (
        <Suspense fallback={<RouteLoader />}>
          <MobileInitialSyncWizard onComplete={() => setIsInitialSyncDone(true)} />
        </Suspense>
      ) : isLocked && user ? (
        <Suspense fallback={<RouteLoader />}>
          <LockScreen 
            user={user} 
            onUnlock={appUnlock} 
            onLogout={logout} 
          />
        </Suspense>
      ) : setupLoading || (user && !hasCheckedSetup) ? (
        <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center gap-4">
          <RefreshCw className="animate-spin text-blue-500" size={40} />
          <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px]">Cargando Configuración...</p>
        </div>
      ) : user && !isSetup ? (
        <Suspense fallback={<RouteLoader />}>
          <SetupWizard onComplete={() => setIsSetup(true)} />
        </Suspense>
      ) : (
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/mobile" element={<MobilePOSSimulator />} />
            <Route path="/mobile-pos" element={<MobilePOSSimulator />} />
            <Route path="/login" element={<Login />} />
            <Route path="/display" element={<CustomerDisplay />} />
            <Route path="/customer-display" element={<CustomerDisplay />} />
            <Route path="/store/:companyId" element={<PublicStore />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                {/* 1. Base POS & Cashier Operations */}
                <Route element={<ProtectedRoute requiredPermission="canAccessPOS" />}>
                  <Route path="/pos" element={<POS />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageCashShift" />}>
                  <Route path="/cash-register" element={<CashRegister />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageCustomers" />}>
                  <Route path="/customers" element={<Customers />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canViewSalesHistory" />}>
                  <Route path="/sales-history" element={<SalesManager />} />
                  <Route path="/sales-manager" element={<SalesManager />} />
                  <Route path="/quotations" element={<SalesManager />} />
                  <Route path="/delivery-notes" element={<SalesManager />} />
                </Route>

                {/* 2. Inventory & Warehouse Routes */}
                <Route element={<ProtectedRoute requiredPermission="canManageInventory" />}>
                  <Route path="/inventory" element={<InventoryDashboard />} />
                  <Route path="/lots" element={<LotsTraceability />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageWarehouses" />}>
                  <Route path="/warehouses" element={<WarehousesManager />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canImportCatalog" />}>
                  <Route path="/catalog-importer" element={<CatalogImporter />} />
                </Route>
                <Route path="/production" element={<Navigate to="/inventory" replace />} />
                <Route element={<ProtectedRoute requiredPermission="canManagePromotions" />}>
                  <Route path="/promotions" element={<PromotionsManager />} />
                </Route>

                {/* 3. Purchases & Suppliers */}
                <Route element={<ProtectedRoute requiredPermission="canManageSuppliers" />}>
                  <Route path="/suppliers" element={<Suppliers />} />
                  <Route path="/purchase-orders" element={<PurchaseOrders />} />
                  <Route path="/purchase-receipts" element={<PurchaseReceipts />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManagePayables" />}>
                  <Route path="/accounts-payable" element={<AccountsPayable />} />
                </Route>

                {/* 4. Treasury & Receivables */}
                <Route element={<ProtectedRoute requiredPermission="canManageReceivables" />}>
                  <Route path="/accounts-receivable" element={<AccountsReceivable />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageExpenses" />}>
                  <Route path="/expenses" element={<Expenses />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageFiscal" />}>
                  <Route path="/fiscal" element={<FiscalManager />} />
                </Route>

                {/* 5. Reports & Management */}
                <Route element={<ProtectedRoute requiredPermission="canAccessBI" />}>
                  <Route path="/bi" element={<ExecutiveBI />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canViewReports" />}>
                  <Route path="/dashboard" element={<Reports />} />
                  <Route path="/reports" element={<Reports />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageAccounting" />}>
                  <Route path="/accounting" element={<AccountingGeneral />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManagePayroll" />}>
                  <Route path="/payroll" element={<PayrollManager />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission={['canManageAssets', 'canAccessCollections']} />}>
                  <Route path="/assets-collections" element={<AssetsAndCollections />} />
                </Route>

                {/* 6. Audit & Monitoring Routes */}
                <Route element={<ProtectedRoute requiredPermission="canAccessAudit" />}>
                  <Route path="/audit" element={<AuditPanel />} />
                  <Route path="/audit-alerts" element={<Navigate to="/audit?tab=alerts" replace />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canMonitorCashiers" />}>
                  <Route path="/admin/cash-monitoring" element={<CashierAuditCenter />} />
                </Route>

                {/* 7. Administration Routes */}
                <Route element={<ProtectedRoute requiredPermission="canManageBranches" />}>
                  <Route path="/branches" element={<Branches />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageUsers" />}>
                  <Route path="/users" element={<Users />} />
                </Route>
                <Route element={<ProtectedRoute requiredPermission="canManageSettings" />}>
                  <Route path="/settings" element={<Settings />} />
                </Route>

                {/* Master-only routes */}
                <Route element={<ProtectedRoute masterOnly={true} />}>
                  <Route path="/licenses" element={<Licenses />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to={isMobileDevice() ? "/mobile" : "/pos"} replace />} />
          </Routes>
        </Suspense>
      )}
    </>
  );
}

export default App;
