import { Suspense, lazy, useEffect, useRef } from 'react';
import {
  Settings, X, RefreshCw, Tag, CreditCard, DollarSign,
  FileText, ArrowLeft, Users, Truck, ShieldCheck, Coins, TrendingUp,
  Scale, Shield, Store, FileSpreadsheet, Building2, PieChart, UserCog
} from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import { db as primaryDb } from '../../services/db';
import { useMobilePosStore } from '../../store/useMobilePosStore';
import { getCleanProductId, getProductUnitsMultiplier } from '../../hooks/mobile/useMobileCatalogAndSync';

// Módulos móviles nativos (Lazy)
const MobileInventoryView = lazy(() => import('./MobileInventoryView'));
const MobileSalesView = lazy(() => import('./MobileSalesView'));
const MobileCustomersView = lazy(() => import('./MobileCustomersView'));
const MobileCashView = lazy(() => import('./MobileCashView'));
const MobileExpensesView = lazy(() => import('./MobileExpensesView'));
const MobileSyncCenterView = lazy(() => import('./MobileSyncCenterView'));

// Módulos ERP embebidos (Lazy)
const AccountsReceivablePage = lazy(() => import('../../pages/AccountsReceivable'));
const AccountsPayablePage = lazy(() => import('../../pages/AccountsPayable'));
const AssetsAndCollectionsPage = lazy(() => import('../../pages/AssetsAndCollections'));
const PromotionsManagerPage = lazy(() => import('../../pages/PromotionsManager'));
const CatalogImporterPage = lazy(() => import('../../pages/CatalogImporter'));
const SuppliersPage = lazy(() => import('../../pages/Suppliers'));
const FiscalManagerPage = lazy(() => import('../../pages/FiscalManager'));
const ExecutiveBIPage = lazy(() => import('../../pages/ExecutiveBI'));
const ReportsPage = lazy(() => import('../../pages/Reports'));
const AccountingGeneralPage = lazy(() => import('../../pages/AccountingGeneral'));
const PayrollManagerPage = lazy(() => import('../../pages/PayrollManager'));
const AuditPanelPage = lazy(() => import('../../pages/AuditPanel'));
const CashierAuditCenterPage = lazy(() => import('../../pages/CashierAuditCenter'));
const BranchesPage = lazy(() => import('../../pages/Branches'));
const UsersPage = lazy(() => import('../../pages/Users'));
const SettingsPage = lazy(() => import('../../pages/Settings'));

function MobileSubViewWrapper({ moduleId, title, subtitle, icon: IconComponent, onBack, children, T }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !moduleId) return;
    const saved = useMobilePosStore.getState().getModuleScrollPosition(moduleId);
    if (saved > 0) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = saved;
      });
    }
    const onScroll = () => {
      if (scrollRef.current) {
        useMobilePosStore.getState().setModuleScrollPosition(moduleId, scrollRef.current.scrollTop);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      useMobilePosStore.getState().setModuleScrollPosition(moduleId, el.scrollTop);
      el.removeEventListener('scroll', onScroll);
    };
  }, [moduleId]);

  return (
    <div className={`flex-1 min-h-0 flex flex-col overflow-hidden w-full ${T.appBg} animate-fadeIn`}>
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
              <h2 className={`font-black text-xs sm:text-sm ${T.textPrimary} truncate leading-tight`}>{title}</h2>
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

      <div
        ref={scrollRef}
        className="mobile-embedded-module flex-1 min-h-0 overflow-y-auto overflow-x-auto p-2.5 sm:p-4 w-full overscroll-contain touch-pan-x touch-pan-y custom-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
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

function NativeViewContainer({ loadingLabel, children }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
      <ErrorBoundary>
        <Suspense fallback={
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
            <RefreshCw className="animate-spin text-blue-500" size={32} />
            <span className="text-xs font-bold text-slate-400">{loadingLabel}</span>
          </div>
        }>
          {children}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

const ERP_MODULE_MAP = {
  receivables: { title: 'Por Cobrar', subtitle: 'Saldos pendientes y cobranzas', icon: DollarSign, render: () => <AccountsReceivablePage /> },
  collections: { title: 'Cobranza', subtitle: 'Control de cartera y morosidad', icon: Coins, render: () => <AssetsAndCollectionsPage initialTab="collections" /> },
  promotions: { title: 'Promociones', subtitle: 'Descuentos automáticos y ofertas', icon: Tag, render: () => <PromotionsManagerPage /> },
  importer: { title: 'Importar', subtitle: 'Carga masiva por Excel / CSV', icon: FileSpreadsheet, render: () => <CatalogImporterPage /> },
  suppliers: { title: 'Proveedores', subtitle: 'Directorio y compras', icon: Truck, render: () => <SuppliersPage /> },
  payables: { title: 'Por Pagar', subtitle: 'Facturas pendientes de pago', icon: CreditCard, render: () => <AccountsPayablePage /> },
  fiscal: { title: 'Fiscal SENIAT', subtitle: 'Libros de compra/venta e IGTF', icon: FileText, render: () => <FiscalManagerPage /> },
  bi: { title: 'P&L Gerencial', subtitle: 'Rentabilidad y estado de resultados', icon: TrendingUp, render: () => <ExecutiveBIPage /> },
  reports: { title: 'Reportes', subtitle: 'Estadísticas de ventas y finanzas', icon: PieChart, render: () => <ReportsPage /> },
  accounting: { title: 'Contabilidad', subtitle: 'Plan de cuentas y asientos PUC', icon: Scale, render: () => <AccountingGeneralPage /> },
  payroll: { title: 'Nómina', subtitle: 'Personal y pagos de nómina', icon: Users, render: () => <PayrollManagerPage /> },
  assets: { title: 'Activos Fijos', subtitle: 'Bienes y cálculo de depreciación', icon: Building2, render: () => <AssetsAndCollectionsPage initialTab="assets" /> },
  audit: { title: 'Auditoría', subtitle: 'Bitácora y eventos del sistema', icon: ShieldCheck, render: () => <AuditPanelPage /> },
  'cash-monitoring': { title: 'Monitor Cajas', subtitle: 'Control en vivo de cajeros', icon: Shield, render: () => <CashierAuditCenterPage /> },
  branches: { title: 'Sucursales', subtitle: 'Tiendas y sedes del negocio', icon: Store, render: () => <BranchesPage /> },
  users: { title: 'Usuarios', subtitle: 'Cajeros, roles y permisos', icon: UserCog, render: () => <UsersPage /> },
  settings: { title: 'Ajustes', subtitle: 'Tienda, moneda e impresoras', icon: Settings, render: () => <SettingsPage /> }
};

export default function MobileEmbeddedModuleHost({
  activeModule,
  setActiveModule,
  T,
  isLight,
  user,
  products,
  setProducts,
  normalizedCategories,
  exchangeRate,
  businessInfo,
  salesHistory,
  setSalesHistory,
  pendingSalesCount,
  setPendingSalesCount,
  isSyncingSales,
  isOnline,
  socketConnected,
  syncOfflineSalesQueue,
  loadSalesHistory,
  loadProducts,
  setPrintedReceipt,
  shareReceiptWhatsApp,
  handlePrintBluetoothReceipt,
  setSelectedCustomer,
  setCustomerName,
  setCustomerDoc,
  setCustomerPhone,
  setShowServerModal,
  canCreateProductsMobile,
  canEditCatalogMobile,
  canDeleteProductsMobile,
  canAdjustStockMobile,
  canViewCostsMobile,
  canManageSettingsMobile,
  showToast
}) {
  if (activeModule === 'inventory') {
    return (
      <NativeViewContainer loadingLabel="Cargando inventario...">
        <MobileInventoryView
          products={products}
          categories={normalizedCategories}
          exchangeRate={exchangeRate}
          businessInfo={businessInfo}
          T={T}
          isLight={isLight}
          user={user}
          canCreateProducts={canCreateProductsMobile}
          canManageInventory={canEditCatalogMobile}
          canDeleteProducts={canDeleteProductsMobile}
          canAdjustStock={canAdjustStockMobile}
          canViewCosts={canViewCostsMobile}
          onBackToPOS={() => setActiveModule('pos')}
          onOpenSyncCenter={() => setActiveModule('sync')}
          onProductUpdated={(upd) => setProducts((prev) => prev.map((p) => (String(p.id) === String(upd.id) ? { ...p, ...upd } : p)))}
          onProductCreated={(newProd) => setProducts((prev) => [newProd, ...prev])}
          onProductDeleted={(delId) => setProducts((prev) => prev.filter((p) => String(p.id) !== String(delId)))}
          showToast={showToast}
        />
      </NativeViewContainer>
    );
  }

  if (activeModule === 'sales') {
    return (
      <NativeViewContainer loadingLabel="Cargando ventas...">
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
            const prevSale = salesHistory.find((s) => String(s.id) === String(saleId));
            const wasPendingOffline = Boolean(prevSale?.isOffline || prevSale?.status === 'pending_sync');
            setSalesHistory((prev) => prev.map((s) => (String(s.id) === String(saleId) ? { ...s, ...updatedSale } : s)));
            const itemsList = updatedSale?.items || updatedSale?.SaleItems;
            if (Array.isArray(itemsList) && itemsList.length > 0) {
              const returnedByCleanId = new Map();
              for (const it of itemsList) {
                const cleanId = getCleanProductId(it.productId || it.product?.productId || it.product?.id || it.id);
                if (!cleanId) continue;
                const mult = getProductUnitsMultiplier(it.product || it);
                returnedByCleanId.set(cleanId, (returnedByCleanId.get(cleanId) || 0) + (Number(it.quantity || 1) * mult));
              }
              setProducts((prev) => prev.map((p) => {
                const returnUnits = returnedByCleanId.get(String(p.id)) || 0;
                if (returnUnits > 0) {
                  const newStock = Number(p.stockQuantity ?? p.stock ?? 0) + returnUnits;
                  primaryDb.put('products', { ...p, stockQuantity: newStock, stock: newStock }).catch(() => {});
                  return { ...p, stockQuantity: newStock, stock: newStock };
                }
                return p;
              }));
            }
            if (wasPendingOffline) setPendingSalesCount((prev) => Math.max(0, prev - 1));
          }}
          user={user}
          showToast={showToast}
          T={T}
          isLight={isLight}
          exchangeRate={exchangeRate}
          onBackToPOS={() => setActiveModule('pos')}
        />
      </NativeViewContainer>
    );
  }

  if (activeModule === 'customers') {
    return (
      <NativeViewContainer loadingLabel="Cargando clientes...">
        <MobileCustomersView
          onSelectCustomerForSale={(c) => {
            setSelectedCustomer(c || null);
            setCustomerName(c?.name || 'Consumidor Final');
            setCustomerDoc(c?.idDocument || c?.doc || c?.identification || '');
            setCustomerPhone(c?.phone || '');
            showToast(`Cliente seleccionado: ${c?.name || 'Consumidor Final'}`);
          }}
          T={T}
          isLight={isLight}
          user={user}
          onBackToPOS={() => setActiveModule('pos')}
          onOpenSyncCenter={() => setActiveModule('sync')}
          showToast={showToast}
        />
      </NativeViewContainer>
    );
  }

  if (activeModule === 'cash') {
    return (
      <NativeViewContainer loadingLabel="Cargando control de caja...">
        <MobileCashView
          sales={salesHistory}
          user={user}
          exchangeRate={exchangeRate}
          businessInfo={businessInfo}
          T={T}
          isLight={isLight}
          onBackToPOS={() => setActiveModule('pos')}
          onOpenSyncCenter={() => setActiveModule('sync')}
          showToast={showToast}
        />
      </NativeViewContainer>
    );
  }

  if (activeModule === 'expenses') {
    return (
      <NativeViewContainer loadingLabel="Cargando gastos...">
        <MobileExpensesView
          exchangeRate={exchangeRate}
          user={user}
          T={T}
          isLight={isLight}
          onBackToPOS={() => setActiveModule('pos')}
          onOpenSyncCenter={() => setActiveModule('sync')}
          showToast={showToast}
        />
      </NativeViewContainer>
    );
  }

  if (activeModule === 'sync') {
    return (
      <NativeViewContainer loadingLabel="Cargando centro de sincronización...">
        <MobileSyncCenterView
          isOnline={isOnline}
          socketConnected={socketConnected}
          pendingSalesCount={pendingSalesCount}
          productsCount={products.length}
          exchangeRate={exchangeRate}
          isSyncing={isSyncingSales}
          onSyncNow={syncOfflineSalesQueue}
          onRefreshCatalog={() => loadProducts(false, true)}
          T={T}
          isLight={isLight}
          onBackToPOS={() => setActiveModule('pos')}
          showToast={showToast}
          onOpenServerConfig={() => setShowServerModal(true)}
          canManageSettings={canManageSettingsMobile}
        />
      </NativeViewContainer>
    );
  }

  const erpCfg = ERP_MODULE_MAP[activeModule];
  if (erpCfg) {
    return (
      <MobileSubViewWrapper
        moduleId={activeModule}
        title={erpCfg.title}
        subtitle={erpCfg.subtitle}
        icon={erpCfg.icon}
        onBack={() => setActiveModule('pos')}
        T={T}
      >
        {erpCfg.render()}
      </MobileSubViewWrapper>
    );
  }

  return null;
}
