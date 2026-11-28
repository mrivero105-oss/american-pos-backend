import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { playScanSound, toggleSoundMute } from '../utils/sounds';
import { useAuth } from '../hooks/AuthContext';
import { useTheme } from '../hooks/ThemeContext';
import { useSocket } from '../hooks/SocketContext';
import { isDollarOnlyCountry } from '../utils/format';
import { getImageUrl } from '../utils/imageUtils';
import { triggerHaptic } from '../utils/haptics';
import biometricService from '../services/biometricService';

import MobilePOSHeader from '../components/mobile/MobilePOSHeader';
import MobilePOSLoginScreen from '../components/mobile/MobilePOSLoginScreen';
import MobilePOSCatalogSection from '../components/mobile/MobilePOSCatalogSection';
import MobilePOSBottomDock from '../components/mobile/MobilePOSBottomDock';
import MobileTabletCartPanel from '../components/mobile/MobileTabletCartPanel';
import MobileCartSheet from '../components/mobile/MobileCartSheet';
import MobileSimulatorModals from '../components/mobile/MobileSimulatorModals';
import MobileEmbeddedModuleHost from '../components/mobile/MobileEmbeddedModuleHost';
import {
  MOBILE_MODULE_PERMISSIONS,
  buildMobileNavSections
} from '../components/mobile/mobileNavConfig';

import { useFuzzySearch } from '../hooks/useFuzzySearch';
import { useMobilePosStore } from '../store/useMobilePosStore';
import { useMobileModalStore } from '../store/useMobileModalStore';
import { useMobileHeldSales } from '../hooks/mobile/useMobileHeldSales';
import { useMobileCheckoutFlow } from '../hooks/mobile/useMobileCheckoutFlow';
import {
  useMobileCatalogAndSync,
  getCleanProductId,
  getProductUnitsMultiplier
} from '../hooks/mobile/useMobileCatalogAndSync';
import { useMobileCartAndScanner } from '../hooks/mobile/useMobileCartAndScanner';
import { useMobileQuickForms } from '../hooks/mobile/useMobileQuickForms';
import { useMobileBackAndGestures } from '../hooks/mobile/useMobileBackAndGestures';

const INITIAL_SPLIT_PAYMENTS = {
  cash_usd: '',
  cash_eur: '',
  cash_bs: '',
  pago_movil: '',
  tarjeta: '',
  zelle: '',
  binance: '',
  credito: ''
};

export default function MobilePOSSimulator() {
  const isDollarCountry = isDollarOnlyCountry(localStorage.getItem('pos_country'));
  const { user, login, loginWithBiometrics, logout, hasPermission, refreshUser } = useAuth();
  const { theme, setTheme, isOled } = useTheme();
  const socketContext = useSocket();
  const isLight = theme === 'studio' || theme === 'swiss';
  const isOledMode = Boolean(isOled);

  // 1. Stores Zustand modulares (Navegación/Carrito/Scroll + Modales LIFO)
  const activeModule = useMobilePosStore((s) => s.activeModule);
  const setActiveModule = useMobilePosStore((s) => s.setActiveModule);
  const cart = useMobilePosStore((s) => s.cart);
  const setCart = useMobilePosStore((s) => s.setCart);
  const cartDiscountPercent = useMobilePosStore((s) => s.cartDiscountPercent);
  const setCartDiscountPercent = useMobilePosStore((s) => s.setCartDiscountPercent);
  const discountSupervisorApprovalId = useMobilePosStore((s) => s.discountSupervisorApprovalId);
  const setDiscountSupervisorApprovalId = useMobilePosStore((s) => s.setDiscountSupervisorApprovalId);
  const heldSales = useMobilePosStore((s) => s.heldSales);
  const setHeldSales = useMobilePosStore((s) => s.setHeldSales);

  const isBiometricsModalOpen = useMobileModalStore((s) => s.isBiometricsModalOpen);
  const isThermalPrinterModalOpen = useMobileModalStore((s) => s.isThermalPrinterModalOpen);
  const isCheckoutOpen = useMobileModalStore((s) => s.isCheckoutOpen);
  const whatsAppModalData = useMobileModalStore((s) => s.whatsAppModalData);
  const scannerTarget = useMobileModalStore((s) => s.scannerTarget);
  const isPriceCheckerModalOpen = useMobileModalStore((s) => s.isPriceCheckerModalOpen);
  const isSideNavOpen = useMobileModalStore((s) => s.isSideNavOpen);
  const showServerModal = useMobileModalStore((s) => s.showServerModal);
  const isMobileCartOpen = useMobileModalStore((s) => s.isMobileCartOpen);
  const setModalField = useMobileModalStore((s) => s.setModalField);
  const modalSetters = useMemo(() => ({
    setIsBiometricsModalOpen: (v) => setModalField('isBiometricsModalOpen', v),
    setIsSideNavOpen: (v) => setModalField('isSideNavOpen', v),
    setShowServerModal: (v) => setModalField('showServerModal', v),
    setIsMobileCartOpen: (v) => setModalField('isMobileCartOpen', v),
    setIsCheckoutOpen: (v) => setModalField('isCheckoutOpen', v),
    setIsScannerOpen: (v) => setModalField('isScannerOpen', v),
    setPrintedReceipt: (v) => setModalField('printedReceipt', v),
    setSupervisorAuthRequest: (v) => setModalField('supervisorAuthRequest', v),
    setIsHeldSalesModalOpen: (v) => setModalField('isHeldSalesModalOpen', v),
    setIsManualItemModalOpen: (v) => setModalField('isManualItemModalOpen', v),
    setIsQuickProductModalOpen: (v) => setModalField('isQuickProductModalOpen', v),
    setPreviewProductImage: (v) => setModalField('previewProductImage', v),
    setIsImageSearchModalOpen: (v) => setModalField('isImageSearchModalOpen', v),
    setIsThermalPrinterModalOpen: (v) => setModalField('isThermalPrinterModalOpen', v),
    setIsExchangeRateModalOpen: (v) => setModalField('isExchangeRateModalOpen', v),
    setScannerTarget: (v) => setModalField('scannerTarget', v),
    setUnregisteredBarcodeNotice: (v) => setModalField('unregisteredBarcodeNotice', v),
    setPriceCheckerProduct: (v) => setModalField('priceCheckerProduct', v),
    setIsPriceCheckerModalOpen: (v) => setModalField('isPriceCheckerModalOpen', v),
    setPreSaleSentModal: (v) => setModalField('preSaleSentModal', v),
    setIsTableSelectModalOpen: (v) => setModalField('isTableSelectModalOpen', v),
    setWhatsAppModalData: (v) => setModalField('whatsAppModalData', v),
    setSelectedProductForVariant: (v) => setModalField('selectedProductForVariant', v),
    setSelectedProductForControlledMed: (v) => setModalField('selectedProductForControlledMed', v),
    setSelectedProductForBulk: (v) => setModalField('selectedProductForBulk', v),
    setIsCustomerSelectModalOpen: (v) => setModalField('isCustomerSelectModalOpen', v),
    setIsQuantityModalOpen: (v) => setModalField('isQuantityModalOpen', v),
    setQuantityModalItem: (v) => setModalField('quantityModalItem', v)
  }), [setModalField]);

  // 2. Toasts unificados en react-hot-toast (evita estado local redundante y re-renders en el padre)
  const showToast = useCallback((msg) => {
    if (!msg) return;
    const text = String(msg);
    if (text.startsWith('❌') || text.startsWith('⛔')) {
      toast.error(text, { id: 'mobile-pos-toast', duration: 2800 });
    } else if (text.startsWith('⚠️')) {
      toast(text, { id: 'mobile-pos-toast', duration: 2600 });
    } else {
      toast.success(text, { id: 'mobile-pos-toast', duration: 2200 });
    }
  }, []);

  const [loginUi, setLoginUi] = useState(() => ({
    username: '',
    password: '',
    error: null,
    isLoggingIn: false,
    isBioLoggingIn: false,
    enrolledBioUser: biometricService.getEnrolledCredential()
  }));

  const [catalogUi, setCatalogUi] = useState(() => {
    let savedLayout = 'list';
    try { savedLayout = localStorage.getItem('mobile_catalog_layout') || 'list'; } catch { /* noop */ }
    return {
      selectedCategory: 'Todos',
      catalogLayout: savedLayout,
      searchQuery: '',
      posMode: 'SALE',
      priceCheckerSearch: '',
      drawerSearch: ''
    };
  });

  const [checkoutUi, setCheckoutUi] = useState(() => {
    let savedAutoPrint = true;
    try {
      const raw = localStorage.getItem('pos_mobile_auto_print');
      savedAutoPrint = raw === null ? true : raw === 'true';
    } catch { /* noop */ }
    return {
      documentType: 'factura',
      checkoutMode: 'express',
      splitPayments: INITIAL_SPLIT_PAYMENTS,
      lockedExchangeRate: null,
      selectedMethod: 'Efectivo USD',
      paymentReference: '',
      amountPaidUSD: '',
      amountPaidBS: '',
      isProcessingSale: false,
      cashAccumulateMode: false,
      autoPrint: savedAutoPrint,
      selectedTable: null,
      orderNotes: ''
    };
  });

  const setCheckoutField = useCallback((field, updater) => {
    setCheckoutUi((prev) => {
      const nextVal = typeof updater === 'function' ? updater(prev[field]) : updater;
      return Object.is(nextVal, prev[field]) ? prev : { ...prev, [field]: nextVal };
    });
  }, []);

  const setCatalogField = useCallback((field, updater) => {
    setCatalogUi((prev) => {
      const nextVal = typeof updater === 'function' ? updater(prev[field]) : updater;
      return Object.is(nextVal, prev[field]) ? prev : { ...prev, [field]: nextVal };
    });
  }, []);

  const deferredSearchQuery = React.useDeferredValue(catalogUi.searchQuery);
  const catalogScrollRef = useRef(null);
  const searchInputRef = useRef(null);

  const requestSupervisorAuth = useCallback((title, reason, callback, actionType = 'pos_override', referenceId = null) => {
    modalSetters.setSupervisorAuthRequest({ title, reason, actionType, referenceId, onAuthorized: callback });
  }, [modalSetters]);

  // Refrescar biometría enrolada y permisos en tiempo real
  useEffect(() => {
    setLoginUi((prev) => ({ ...prev, enrolledBioUser: biometricService.getEnrolledCredential() }));
  }, [user, isBiometricsModalOpen]);

  const hasRefreshedInitialUserRef = useRef(false);
  useEffect(() => {
    if (hasRefreshedInitialUserRef.current) return;
    if (user && refreshUser) {
      hasRefreshedInitialUserRef.current = true;
      refreshUser().catch(() => {});
    }
  }, [user, refreshUser]);

  useEffect(() => {
    const activeSock = socketContext?.socket;
    if (!activeSock || !refreshUser) return;
    const handleUserUpdate = (data) => {
      if (data && (String(data.userId) === String(user?.id) || String(data.user?.id) === String(user?.id))) {
        refreshUser();
      }
    };
    const handleUsersChanged = () => refreshUser();
    activeSock.on('user_updated', handleUserUpdate);
    activeSock.on('users_changed', handleUsersChanged);
    return () => {
      activeSock.off('user_updated', handleUserUpdate);
      activeSock.off('users_changed', handleUsersChanged);
    };
  }, [socketContext?.socket, user?.id, refreshUser]);

  // Guardia RBAC de módulo activo
  useEffect(() => {
    if (activeModule && activeModule !== 'pos' && activeModule !== 'sync' && hasPermission) {
      const requiredPerm = MOBILE_MODULE_PERMISSIONS[activeModule];
      if (requiredPerm && !hasPermission(requiredPerm)) setActiveModule('pos');
    }
  }, [activeModule, hasPermission, setActiveModule]);

  // Sincronizar autoPrint y lockedExchangeRate con sus modales
  useEffect(() => {
    if (!isThermalPrinterModalOpen) {
      try {
        const saved = localStorage.getItem('pos_mobile_auto_print');
        setCheckoutField('autoPrint', saved === null ? true : saved === 'true');
      } catch { /* noop */ }
    }
  }, [isThermalPrinterModalOpen, setCheckoutField]);

  // Escuchar apertura directa del gestor de impresora térmica móvil desde Settings embebido y alertas anti-rogue LAN
  useEffect(() => {
    const openMobilePrinter = () => modalSetters.setIsThermalPrinterModalOpen(true);
    const onRogueServer = (ev) => {
      const host = ev?.detail?.hostname || ev?.detail?.url || 'desconocido';
      toast.error(`Servidor LAN rechazado (${host}): identidad distinta al servidor emparejado.`, { duration: 6000 });
    };
    window.addEventListener('isaac-open-mobile-printer', openMobilePrinter);
    window.addEventListener('rogue-server-detected', onRogueServer);
    return () => {
      window.removeEventListener('isaac-open-mobile-printer', openMobilePrinter);
      window.removeEventListener('rogue-server-detected', onRogueServer);
    };
  }, [modalSetters]);

  // 3. Permisos RBAC móviles derivados
  const roleLower = String(user?.role || '').toLowerCase();
  const isAdminRole = ['superadmin', 'owner', 'dueño', 'dueno', 'admin', 'master'].includes(roleLower);
  const isSupervisorOrAdmin = isAdminRole || roleLower === 'supervisor';
  const canEditCatalogMobile = Boolean(hasPermission('canManageInventory') || hasPermission('canEditProducts') || isSupervisorOrAdmin);
  const canCreateProductsMobile = Boolean(hasPermission('canCreateProducts') || hasPermission('canManageInventory') || isSupervisorOrAdmin);
  const canDeleteProductsMobile = Boolean(hasPermission('canDeleteProducts') || hasPermission('canManageInventory') || isAdminRole);
  const canAdjustStockMobile = Boolean(hasPermission('canAdjustStock') || hasPermission('canManageInventory') || isSupervisorOrAdmin);
  const canViewCostsMobile = Boolean(hasPermission('canViewCosts') || isAdminRole);
  const canManageSettingsMobile = Boolean(hasPermission('canManageSettings') || isAdminRole);
  const canApplyDiscountsMobile = hasPermission('canApplyDiscounts');

  // 4. Hook de Catálogo, Red, Tasas, Clientes y Sync en tiempo real
  const syncDomain = useMobileCatalogAndSync({
    user,
    socketContext,
    activeModule,
    setHeldSales,
    setShowServerModal: modalSetters.setShowServerModal,
    showToast
  });

  useEffect(() => {
    if (isCheckoutOpen) {
      setCheckoutField('lockedExchangeRate', (prev) => (prev && prev > 0 ? prev : syncDomain.exchangeRate));
    } else {
      setCheckoutField('lockedExchangeRate', null);
    }
  }, [isCheckoutOpen, syncDomain.exchangeRate, setCheckoutField]);

  // Categorías y búsqueda difusa off-main-thread
  const { normalizedCategories, categoryCounts } = useMemo(() => {
    const catMap = new Map();
    let noStockCount = 0;
    syncDomain.products.forEach((p) => {
      const stock = Number(p.stockQuantity ?? p.stock ?? 0);
      const isService = Boolean(p.isService || String(p.category || p.categoria || '').trim().toLowerCase() === 'servicios');
      if (!isService && stock <= 0) noStockCount++;
      const clean = (p.category || p.categoria || 'General').trim().toLowerCase();
      const title = clean.charAt(0).toUpperCase() + clean.slice(1);
      catMap.set(title, (catMap.get(title) || 0) + 1);
    });
    const sortedCats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const counts = { Todos: syncDomain.products.length, '🚫 Productos sin stock': noStockCount };
    catMap.forEach((val, key) => { counts[key] = val; });
    const finalCategories = ['Todos', ...sortedCats];
    if (noStockCount > 0) finalCategories.push('🚫 Productos sin stock');
    return { normalizedCategories: finalCategories, categoryCounts: counts };
  }, [syncDomain.products]);

  const isNoStockSelected = catalogUi.selectedCategory === '🚫 Productos sin stock' || catalogUi.selectedCategory.toLowerCase().includes('sin stock');
  const workerCategory = (catalogUi.selectedCategory === 'Todos' || isNoStockSelected) ? '' : catalogUi.selectedCategory;

  const fuzzyMobileProducts = useFuzzySearch(syncDomain.products, deferredSearchQuery, {
    category: workerCategory,
    maxResults: 1000,
    enableSemantic: false
  });

  const filteredProducts = useMemo(() => {
    const baseList = isNoStockSelected
      ? fuzzyMobileProducts.filter((p) => {
          const st = Number(p.stockQuantity ?? p.stock ?? 0);
          const isService = Boolean(p.isService || String(p.category || p.categoria || '').trim().toLowerCase() === 'servicios');
          return !isService && st <= 0;
        })
      : fuzzyMobileProducts;

    const hasQuery = Boolean(deferredSearchQuery && deferredSearchQuery.trim());
    return [...baseList].sort((a, b) => {
      const isServiceA = Boolean(a.isService || String(a.category || a.categoria || '').trim().toLowerCase() === 'servicios');
      const isServiceB = Boolean(b.isService || String(b.category || b.categoria || '').trim().toLowerCase() === 'servicios');
      const outA = (!isServiceA && Number(a.stockQuantity ?? a.stock ?? 0) <= 0) ? 1 : 0;
      const outB = (!isServiceB && Number(b.stockQuantity ?? b.stock ?? 0) <= 0) ? 1 : 0;
      if (outA !== outB) return outA - outB;
      if (hasQuery) return 0;
      const nameA = (a.name || a.nombre || '').toLowerCase();
      const nameB = (b.name || b.nombre || '').toLowerCase();
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });
  }, [fuzzyMobileProducts, isNoStockSelected, deferredSearchQuery]);

  // 5. Hook de Formularios Rápidos (Productos, Clientes y WhatsApp)
  const quickForms = useMobileQuickForms({
    isDollarCountry,
    exchangeRate: syncDomain.exchangeRate,
    businessInfo: syncDomain.businessInfo,
    selectedCategory: catalogUi.selectedCategory,
    normalizedCategories,
    customers: syncDomain.customers,
    setCustomers: syncDomain.setCustomers,
    setProducts: syncDomain.setProducts,
    countPendingOfflineSales: syncDomain.countPendingOfflineSales,
    canEditCatalogMobile,
    canCreateProductsMobile,
    canViewCostsMobile,
    setIsQuickProductModalOpen: modalSetters.setIsQuickProductModalOpen,
    setUnregisteredBarcodeNotice: modalSetters.setUnregisteredBarcodeNotice,
    setIsCustomerSelectModalOpen: modalSetters.setIsCustomerSelectModalOpen,
    whatsAppModalData,
    setWhatsAppModalData: modalSetters.setWhatsAppModalData,
    showToast
  });

  // 6. Hook de Carrito y Escáner (Cámara + HID)
  const cartDomain = useMobileCartAndScanner({
    user,
    products: syncDomain.products,
    cart,
    setCart,
    setCartDiscountPercent,
    setDiscountSupervisorApprovalId,
    exchangeRate: syncDomain.exchangeRate,
    businessMode: syncDomain.businessMode,
    posMode: catalogUi.posMode,
    scannerTarget,
    setScannerTarget: modalSetters.setScannerTarget,
    setIsScannerOpen: modalSetters.setIsScannerOpen,
    setProductFormData: quickForms.setProductFormData,
    setUnregisteredBarcodeNotice: modalSetters.setUnregisteredBarcodeNotice,
    setPriceCheckerProduct: modalSetters.setPriceCheckerProduct,
    isPriceCheckerModalOpen,
    setIsPriceCheckerModalOpen: modalSetters.setIsPriceCheckerModalOpen,
    setSelectedProductForVariant: modalSetters.setSelectedProductForVariant,
    setSelectedProductForControlledMed: modalSetters.setSelectedProductForControlledMed,
    setSelectedProductForBulk: modalSetters.setSelectedProductForBulk,
    setPreviewProductImage: modalSetters.setPreviewProductImage,
    setQuantityModalItem: modalSetters.setQuantityModalItem,
    setIsQuantityModalOpen: modalSetters.setIsQuantityModalOpen,
    setIsManualItemModalOpen: modalSetters.setIsManualItemModalOpen,
    setIsMobileCartOpen: modalSetters.setIsMobileCartOpen,
    setSearchQuery: (v) => setCatalogField('searchQuery', v),
    showToast
  });

  // 7. Hook de Checkout y Ventas en Espera
  const checkoutFlow = useMobileCheckoutFlow({
    cart,
    setCart,
    promotions: syncDomain.promotions,
    cartDiscountPercent,
    setCartDiscountPercent,
    discountSupervisorApprovalId,
    setDiscountSupervisorApprovalId,
    exchangeRate: syncDomain.exchangeRate,
    lockedExchangeRate: checkoutUi.lockedExchangeRate,
    businessInfo: syncDomain.businessInfo,
    documentType: checkoutUi.documentType,
    setDocumentType: (v) => setCheckoutField('documentType', v),
    checkoutMode: checkoutUi.checkoutMode,
    setCheckoutMode: (v) => setCheckoutField('checkoutMode', v),
    splitPayments: checkoutUi.splitPayments,
    setSplitPayments: (v) => setCheckoutField('splitPayments', v),
    selectedMethod: checkoutUi.selectedMethod,
    setSelectedMethod: (v) => setCheckoutField('selectedMethod', v),
    amountPaidUSD: checkoutUi.amountPaidUSD,
    setAmountPaidUSD: (v) => setCheckoutField('amountPaidUSD', v),
    amountPaidBS: checkoutUi.amountPaidBS,
    setAmountPaidBS: (v) => setCheckoutField('amountPaidBS', v),
    paymentReference: checkoutUi.paymentReference,
    setPaymentReference: (v) => setCheckoutField('paymentReference', v),
    isProcessingSale: checkoutUi.isProcessingSale,
    setIsProcessingSale: (v) => setCheckoutField('isProcessingSale', v),
    setIsCheckoutOpen: modalSetters.setIsCheckoutOpen,
    setIsMobileCartOpen: modalSetters.setIsMobileCartOpen,
    setIsThermalPrinterModalOpen: modalSetters.setIsThermalPrinterModalOpen,
    setPrintedReceipt: modalSetters.setPrintedReceipt,
    setSalesHistory: syncDomain.setSalesHistory,
    setPendingSalesCount: syncDomain.setPendingSalesCount,
    setProducts: syncDomain.setProducts,
    productsMap: cartDomain.productsMap,
    getCleanProductId,
    getProductUnitsMultiplier,
    customers: syncDomain.customers,
    selectedCustomer: quickForms.selectedCustomer,
    setSelectedCustomer: quickForms.setSelectedCustomer,
    setSelectedTable: (v) => setCheckoutField('selectedTable', v),
    setOrderNotes: (v) => setCheckoutField('orderNotes', v),
    customerName: quickForms.customerName,
    setCustomerName: quickForms.setCustomerName,
    customerDoc: quickForms.customerDoc,
    setCustomerDoc: quickForms.setCustomerDoc,
    setCustomerPhone: quickForms.setCustomerPhone,
    isDollarCountry,
    autoPrint: checkoutUi.autoPrint,
    canApplyDiscounts: canApplyDiscountsMobile,
    user,
    requestSupervisorAuth,
    showToast
  });

  const heldFlow = useMobileHeldSales({
    cart,
    setCart,
    setCartDiscountPercent,
    setDiscountSupervisorApprovalId,
    heldSales,
    setHeldSales,
    setIsHeldSalesModalOpen: modalSetters.setIsHeldSalesModalOpen,
    setIsMobileCartOpen: modalSetters.setIsMobileCartOpen,
    setPreSaleSentModal: modalSetters.setPreSaleSentModal,
    customerName: quickForms.customerName,
    setCustomerName: quickForms.setCustomerName,
    customerDoc: quickForms.customerDoc,
    setCustomerDoc: quickForms.setCustomerDoc,
    customerPhone: quickForms.customerPhone,
    setCustomerPhone: quickForms.setCustomerPhone,
    selectedCustomer: quickForms.selectedCustomer,
    setSelectedCustomer: quickForms.setSelectedCustomer,
    selectedTable: checkoutUi.selectedTable,
    setSelectedTable: (v) => setCheckoutField('selectedTable', v),
    orderNotes: checkoutUi.orderNotes,
    setOrderNotes: (v) => setCheckoutField('orderNotes', v),
    totalUSD: checkoutFlow.totalUSD,
    totalBS: checkoutFlow.totalBS,
    totalItemsCount: checkoutFlow.totalItemsCount,
    exchangeRate: syncDomain.exchangeRate,
    isDollarCountry,
    user,
    socket: syncDomain.socket,
    productsMap: cartDomain.productsMap,
    showToast
  });

  // 8. Botón Atrás LIFO, Gestos Táctiles y Preservación de Scroll
  const gestures = useMobileBackAndGestures({
    activeModule,
    setActiveModule,
    catalogScrollRef,
    selectedCategory: catalogUi.selectedCategory,
    deferredSearchQuery,
    isSideNavOpen,
    setIsSideNavOpen: modalSetters.setIsSideNavOpen,
    onPullRefresh: () => Promise.all([syncDomain.loadProducts(), syncDomain.loadSettings(), syncDomain.loadPromotions()]),
    showToast
  });

  // Menú lateral filtrado
  const navSections = useMemo(() => buildMobileNavSections(hasPermission), [hasPermission]);
  const filteredNavSections = useMemo(() => {
    const q = catalogUi.drawerSearch.toLowerCase().trim();
    if (!q) return navSections;
    return navSections
      .map((sec) => ({
        ...sec,
        items: sec.items.filter((item) =>
          item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || sec.title.toLowerCase().includes(q)
        )
      }))
      .filter((sec) => sec.items.length > 0);
  }, [navSections, catalogUi.drawerSearch]);

  const isRestaurantBusiness = useMemo(() => {
    const bizType = String(
      syncDomain.businessInfo?.businessType || syncDomain.businessInfo?.businessMode || syncDomain.businessInfo?.industry ||
      syncDomain.businessMode || localStorage.getItem('pos_business_mode') || ''
    ).toLowerCase();
    const activePreset = String(localStorage.getItem('pos_active_preset') || '').toLowerCase();
    return Boolean(
      bizType.includes('restauran') || bizType.includes('gastronom') || bizType.includes('comida') ||
      bizType.includes('bar') || bizType.includes('cafe') || activePreset === 'restaurant' ||
      syncDomain.businessInfo?.enableTables === true || checkoutUi.selectedTable
    );
  }, [syncDomain.businessInfo, syncDomain.businessMode, checkoutUi.selectedTable]);

  const toggleCatalogLayout = useCallback(() => {
    setCatalogField('catalogLayout', (prev) => {
      const next = prev === 'list' ? 'grid' : 'list';
      try { localStorage.setItem('mobile_catalog_layout', next); } catch { /* noop */ }
      triggerHaptic(15);
      return next;
    });
  }, [setCatalogField]);

  const whatsAppMessagePreview = useMemo(
    () => checkoutFlow.generateEcoReceiptText(whatsAppModalData),
    [whatsAppModalData, checkoutFlow]
  );
  const handleConfirmSendWhatsApp = useMemo(
    () => quickForms.createConfirmSendWhatsApp(checkoutFlow.generateEcoReceiptText),
    [quickForms, checkoutFlow.generateEcoReceiptText]
  );
  const printPreSaleBluetoothReceipt = useMemo(
    () => quickForms.createPrintPreSaleBluetooth(checkoutFlow.activeCurrencyMode),
    [quickForms, checkoutFlow.activeCurrencyMode]
  );

  // Handlers de Login
  const handleMobileLogin = async (e) => {
    e.preventDefault();
    if (!loginUi.username.trim() || !loginUi.password.trim()) {
      setLoginUi((prev) => ({ ...prev, error: 'Introduce usuario y contraseña' }));
      return;
    }
    setLoginUi((prev) => ({ ...prev, isLoggingIn: true, error: null }));
    try {
      // El socket requiere JWT autenticado y no conecta antes del login; nunca usarlo como indicador offline aquí
      const isKnownOffline = syncDomain.serverHealth === false || (typeof navigator !== 'undefined' && !navigator.onLine);
      const res = await login(loginUi.username.trim(), loginUi.password.trim(), { preferOffline: isKnownOffline });
      if (!res.success) {
        setLoginUi((prev) => ({ ...prev, error: res.message || 'Credenciales incorrectas' }));
      } else {
        try {
          localStorage.setItem('isaac_pos_initial_sync_done', 'true');
          localStorage.setItem('initial_mobile_sync_completed', 'true');
        } catch { /* noop */ }
        showToast(res.isOffline ? '⚡ Modo Autónomo Offline Activado' : '¡Bienvenido!');
        syncDomain.loadProducts();
        syncDomain.loadSettings();
        syncDomain.loadCustomers();
      }
    } catch (err) {
      setLoginUi((prev) => ({ ...prev, error: err.response?.data?.error || err.message || 'Error al iniciar sesión' }));
    } finally {
      setLoginUi((prev) => ({ ...prev, isLoggingIn: false }));
    }
  };

  const handleMobileBiometricLogin = async () => {
    setLoginUi((prev) => ({ ...prev, isBioLoggingIn: true, error: null }));
    try {
      const res = await loginWithBiometrics();
      if (res && (res === true || res.success)) {
        try {
          localStorage.setItem('isaac_pos_initial_sync_done', 'true');
          localStorage.setItem('initial_mobile_sync_completed', 'true');
        } catch { /* noop */ }
        showToast(res.isOffline ? '⚡ Modo Autónomo Offline Activado' : '¡Bienvenido!');
        syncDomain.loadProducts();
        syncDomain.loadSettings();
        syncDomain.loadCustomers();
      } else {
        setLoginUi((prev) => ({ ...prev, error: res?.message || 'No se pudo verificar la huella dactilar' }));
      }
    } catch (err) {
      setLoginUi((prev) => ({ ...prev, error: err.message || 'Error en autenticación biométrica' }));
    } finally {
      setLoginUi((prev) => ({ ...prev, isBioLoggingIn: false }));
    }
  };

  // Tokens de diseño alineados 1:1 con Escritorio
  const T = useMemo(() => ({
    appBg: isLight ? 'bg-[#f3f4f6] text-[#0a0d12]' : isOledMode ? 'bg-[#0b0d10] text-[#f1f5f9]' : 'bg-[#0b0d10] text-[#f1f5f9]',
    headerBg: isLight ? 'bg-white border-b border-[#e2e5eb]' : 'bg-[#0f1216] border-b border-[#1e232b]',
    subPanelBg: isLight ? 'bg-white' : 'bg-[#0f1216]',
    catalogBg: isLight ? 'bg-[#f3f4f6]' : 'bg-[#0b0d10]',
    cardBg: isLight ? 'bg-white border-[#e2e5eb]' : 'bg-[#14181e] border-[#232933]',
    cardExhausted: isLight ? 'opacity-60 bg-[#f8f9fb] border-[#e2e5eb]' : 'opacity-55 bg-[#101318] border-[#1e232b]',
    imgHolder: isLight ? 'bg-[#fafafb] border-[#edf0f4]' : 'bg-[#101318] border-[#1e232b]',
    textPrimary: isLight ? 'text-[#0a0d12]' : 'text-[#f1f5f9]',
    textSecondary: isLight ? 'text-[#475569]' : 'text-[#94a3b8]',
    textMuted: 'text-[#64748b]',
    border: isLight ? 'border-[#e2e5eb]' : 'border-[#232933]',
    inputBg: isLight ? 'bg-[#f4f5f7] border-[#d5dae2] text-[#0a0d12] placeholder-[#64748b] focus:bg-white focus:border-[#0a0d12]' : 'bg-[#14181e] border-[#262c36] text-[#f1f5f9] placeholder-[#64748b] focus:bg-[#191e26] focus:border-[#64748b]',
    chipActive: isLight ? 'bg-[#0a0d12] text-white border border-[#0a0d12] shadow-xs' : 'bg-[#e2e8f0] text-[#090b0e] border border-[#e2e8f0] shadow-xs',
    chipInactive: isLight ? 'bg-white text-[#475569] border border-[#d5dae2] hover:bg-[#f4f5f7] hover:text-[#0a0d12]' : 'bg-[#14181e] text-[#94a3b8] border border-[#232933] hover:text-[#f1f5f9] hover:bg-[#1c222b]',
    btnGhost: isLight ? 'bg-white hover:bg-[#f4f5f7] text-[#0f172a] border border-[#d5dae2] shadow-2xs' : 'bg-[#14181e] hover:bg-[#1c222b] text-[#e2e8f0] border border-[#262c36]',
    ticketSidebar: isLight ? 'bg-[#fafbfc] border-l border-[#e2e5eb]' : 'bg-[#0f1216] border-l border-[#1e232b]',
    ticketItemBg: isLight ? 'bg-white border border-[#e6e8ee]' : 'bg-[#14181e] border border-[#232933]',
    rateBadge: isLight ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-[#14181e] border border-[#232933] text-amber-400',
    modalCard: isLight ? 'bg-white border border-[#e2e5eb] text-[#0a0d12] shadow-2xl' : 'bg-[#0f1216] border border-[#232933] text-[#f1f5f9] shadow-2xl',
    modalSubCard: isLight ? 'bg-[#f8f9fb] border border-[#e2e5eb]' : 'bg-[#14181e] border border-[#232933]'
  }), [isLight, isOledMode]);

  return (
    <div
      onTouchStart={gestures.handleEdgeTouchStart}
      onTouchMove={gestures.handleEdgeTouchMove}
      onTouchEnd={gestures.handleEdgeTouchEnd}
      style={{
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
        height: 'calc(100dvh - var(--isaac-keyboard-overlap, 0px))',
        maxHeight: 'calc(100dvh - var(--isaac-keyboard-overlap, 0px))'
      }}
      className={`w-full ${T.appBg} flex flex-col font-sans antialiased transition-[height,background-color] duration-150 overflow-hidden select-none`}
    >
      {user && (
        <MobilePOSHeader
          T={T}
          isLight={isLight}
          activeModule={activeModule}
          user={user}
          setIsSideNavOpen={modalSetters.setIsSideNavOpen}
          isRestaurantBusiness={isRestaurantBusiness}
          selectedTable={checkoutUi.selectedTable}
          setIsTableSelectModalOpen={modalSetters.setIsTableSelectModalOpen}
          posMode={catalogUi.posMode}
          setIsPriceCheckerModalOpen={modalSetters.setIsPriceCheckerModalOpen}
          searchInputRef={searchInputRef}
          searchQuery={catalogUi.searchQuery}
          setActiveModule={setActiveModule}
          setSearchQuery={(v) => setCatalogField('searchQuery', v)}
          showToast={showToast}
          setIsManualItemModalOpen={modalSetters.setIsManualItemModalOpen}
          openCreateProduct={quickForms.openCreateProduct}
          canCreateProducts={canCreateProductsMobile}
          heldSales={heldSales}
          setIsHeldSalesModalOpen={modalSetters.setIsHeldSalesModalOpen}
          isOfflineBannerVisible={Boolean(!syncDomain.isOnline || !syncDomain.socketConnected || syncDomain.serverHealth === false)}
          isSearchingServer={syncDomain.isTestingServer}
          onAutoDiscoverServer={syncDomain.handleAutoDiscoverServer}
          onOpenServerConfig={() => modalSetters.setShowServerModal(true)}
          lastSaleReceipt={syncDomain.salesHistory?.[0] || null}
          onReprintLastSale={(sale) => checkoutFlow.handlePrintBluetoothReceipt(sale)}
        />
      )}

      {!user ? (
        <MobilePOSLoginScreen
          T={T}
          isLight={isLight}
          businessInfo={syncDomain.businessInfo}
          serverHealth={syncDomain.serverHealth}
          mobileServerIp={syncDomain.mobileServerIp}
          setMobileServerIp={syncDomain.setMobileServerIp}
          showServerModal={showServerModal}
          setShowServerModal={modalSetters.setShowServerModal}
          serverFeedback={syncDomain.serverFeedback}
          setServerFeedback={syncDomain.setServerFeedback}
          loginError={loginUi.error}
          enrolledBioUser={loginUi.enrolledBioUser}
          handleMobileBiometricLogin={handleMobileBiometricLogin}
          isBioLoggingIn={loginUi.isBioLoggingIn}
          isLoggingIn={loginUi.isLoggingIn}
          handleMobileLogin={handleMobileLogin}
          loginUsername={loginUi.username}
          setLoginUsername={(v) => setLoginUi((prev) => ({ ...prev, username: typeof v === 'function' ? v(prev.username) : v }))}
          loginPassword={loginUi.password}
          setLoginPassword={(v) => setLoginUi((prev) => ({ ...prev, password: typeof v === 'function' ? v(prev.password) : v }))}
          isTestingServer={syncDomain.isTestingServer}
          handleAutoDiscoverServer={syncDomain.handleAutoDiscoverServer}
          handleTestAndSaveServer={syncDomain.handleTestAndSaveServer}
        />
      ) : activeModule !== 'pos' ? (
        <MobileEmbeddedModuleHost
          activeModule={activeModule}
          setActiveModule={setActiveModule}
          T={T}
          isLight={isLight}
          user={user}
          products={syncDomain.products}
          setProducts={syncDomain.setProducts}
          normalizedCategories={normalizedCategories}
          exchangeRate={syncDomain.exchangeRate}
          businessInfo={syncDomain.businessInfo}
          salesHistory={syncDomain.salesHistory}
          setSalesHistory={syncDomain.setSalesHistory}
          pendingSalesCount={syncDomain.pendingSalesCount}
          setPendingSalesCount={syncDomain.setPendingSalesCount}
          isSyncingSales={syncDomain.isSyncingSales}
          isOnline={syncDomain.isOnline}
          socketConnected={syncDomain.socketConnected}
          syncOfflineSalesQueue={syncDomain.syncOfflineSalesQueue}
          loadSalesHistory={syncDomain.loadSalesHistory}
          loadProducts={syncDomain.loadProducts}
          setPrintedReceipt={modalSetters.setPrintedReceipt}
          shareReceiptWhatsApp={quickForms.shareReceiptWhatsApp}
          handlePrintBluetoothReceipt={checkoutFlow.handlePrintBluetoothReceipt}
          setSelectedCustomer={quickForms.setSelectedCustomer}
          setCustomerName={quickForms.setCustomerName}
          setCustomerDoc={quickForms.setCustomerDoc}
          setCustomerPhone={quickForms.setCustomerPhone}
          setShowServerModal={modalSetters.setShowServerModal}
          canCreateProductsMobile={canCreateProductsMobile}
          canEditCatalogMobile={canEditCatalogMobile}
          canDeleteProductsMobile={canDeleteProductsMobile}
          canAdjustStockMobile={canAdjustStockMobile}
          canViewCostsMobile={canViewCostsMobile}
          canManageSettingsMobile={canManageSettingsMobile}
          showToast={showToast}
        />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden w-full">
          <div className={`pos-catalog-canvas flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden ${T.catalogBg}`}>
            <MobilePOSCatalogSection
              T={T}
              isLight={isLight}
              normalizedCategories={normalizedCategories}
              selectedCategory={catalogUi.selectedCategory}
              setSelectedCategory={(v) => setCatalogField('selectedCategory', v)}
              categoryCounts={categoryCounts}
              toggleCatalogLayout={toggleCatalogLayout}
              catalogLayout={catalogUi.catalogLayout}
              catalogScrollRef={catalogScrollRef}
              handleCatalogTouchStart={gestures.handleCatalogTouchStart}
              handleCatalogTouchMove={gestures.handleCatalogTouchMove}
              handleCatalogTouchEnd={gestures.handleCatalogTouchEnd}
              pullIndicatorRef={gestures.pullIndicatorRef}
              isPullRefreshing={gestures.isPullRefreshing}
              filteredProducts={filteredProducts}
              products={syncDomain.products}
              openCreateProduct={quickForms.openCreateProduct}
              setIsManualItemModalOpen={modalSetters.setIsManualItemModalOpen}
              cartCommittedUnitsMap={cartDomain.cartCommittedUnitsMap}
              exchangeRate={syncDomain.exchangeRate}
              businessMode={syncDomain.businessMode}
              posMode={catalogUi.posMode}
              addToCart={cartDomain.addToCart}
              decrementFromCard={cartDomain.decrementFromCard}
              handleOpenBulkPicker={cartDomain.handleOpenBulkPicker}
              handlePriceCheck={cartDomain.handlePriceCheck}
              openEditProduct={quickForms.openEditProduct}
              handlePreviewImage={cartDomain.handlePreviewImage}
            />

            <MobilePOSBottomDock
              isLight={isLight}
              cart={cart}
              totalItemsCount={checkoutFlow.totalItemsCount}
              totalUSD={checkoutFlow.totalUSD}
              totalBS={checkoutFlow.totalBS}
              setIsMobileCartOpen={modalSetters.setIsMobileCartOpen}
              handleSelectPaymentMethod={checkoutFlow.handleSelectPaymentMethod}
              setIsCheckoutOpen={modalSetters.setIsCheckoutOpen}
              activeModule={activeModule}
              setActiveModule={setActiveModule}
              pendingSalesCount={syncDomain.pendingSalesCount}
              setIsScannerOpen={modalSetters.setIsScannerOpen}
            />
          </div>

          <MobileTabletCartPanel
            T={T}
            totalItemsCount={checkoutFlow.totalItemsCount}
            cart={cart}
            enrichedCart={checkoutFlow.enrichedCart}
            products={syncDomain.products}
            productsMap={cartDomain.productsMap}
            isUnlimitedStockProduct={cartDomain.isUnlimitedStockProduct}
            requestSupervisorAuth={requestSupervisorAuth}
            clearCart={cartDomain.clearCart}
            showToast={showToast}
            customerName={quickForms.customerName}
            customerDoc={quickForms.customerDoc}
            onOpenCustomerSelect={() => {
              triggerHaptic(10);
              quickForms.setCustomerSearch('');
              quickForms.setIsCreatingCustomerInMobile(false);
              modalSetters.setIsCustomerSelectModalOpen(true);
            }}
            updateQuantity={cartDomain.updateQuantity}
            openQuantityModal={cartDomain.openQuantityModal}
            removeFromCart={cartDomain.removeFromCart}
            cartDiscountPercent={cartDiscountPercent}
            handleApplyDiscount={checkoutFlow.handleApplyDiscount}
            cartDiscountAmountUSD={checkoutFlow.cartDiscountAmountUSD}
            taxUSD={checkoutFlow.taxUSD}
            taxLabel={checkoutFlow.taxLabel}
            effectiveIvaRate={checkoutFlow.effectiveIvaRate}
            isIvaEnabled={checkoutFlow.isIvaEnabled}
            isDollarCountry={isDollarCountry}
            totalUSD={checkoutFlow.totalUSD}
            totalBS={checkoutFlow.totalBS}
            handleHoldSale={heldFlow.handleHoldSale}
            onProceedToCheckout={() => {
              checkoutFlow.handleSelectPaymentMethod('Efectivo USD');
              modalSetters.setIsCheckoutOpen(true);
            }}
          />
        </div>
      )}

      <MobileCartSheet
        isOpen={isMobileCartOpen}
        onClose={() => modalSetters.setIsMobileCartOpen(false)}
        T={T}
        triggerHaptic={triggerHaptic}
        totalItemsCount={checkoutFlow.totalItemsCount}
        cart={cart}
        enrichedCart={checkoutFlow.enrichedCart}
        products={syncDomain.products}
        productsMap={cartDomain.productsMap}
        isUnlimitedStockProduct={cartDomain.isUnlimitedStockProduct}
        requestSupervisorAuth={requestSupervisorAuth}
        clearCart={cartDomain.clearCart}
        showToast={showToast}
        customerName={quickForms.customerName}
        customerDoc={quickForms.customerDoc}
        onOpenCustomerSelect={() => {
          triggerHaptic(10);
          quickForms.setCustomerSearch('');
          quickForms.setIsCreatingCustomerInMobile(false);
          modalSetters.setIsCustomerSelectModalOpen(true);
        }}
        onOpenManualItem={() => {
          modalSetters.setIsMobileCartOpen(false);
          modalSetters.setIsManualItemModalOpen(true);
        }}
        heldSales={heldSales}
        onOpenHeldSales={() => {
          modalSetters.setIsMobileCartOpen(false);
          modalSetters.setIsHeldSalesModalOpen(true);
        }}
        updateQuantity={cartDomain.updateQuantity}
        openQuantityModal={cartDomain.openQuantityModal}
        removeFromCart={cartDomain.removeFromCart}
        cartDiscountPercent={cartDiscountPercent}
        handleApplyDiscount={checkoutFlow.handleApplyDiscount}
        cartDiscountAmountUSD={checkoutFlow.cartDiscountAmountUSD}
        taxUSD={checkoutFlow.taxUSD}
        taxLabel={checkoutFlow.taxLabel}
        effectiveIvaRate={checkoutFlow.effectiveIvaRate}
        isIvaEnabled={checkoutFlow.isIvaEnabled}
        isDollarCountry={isDollarCountry}
        totalUSD={checkoutFlow.totalUSD}
        totalBS={checkoutFlow.totalBS}
        handleHoldSale={heldFlow.handleHoldSale}
        handleSendPreSaleToMainRegister={heldFlow.handleSendPreSaleToMainRegister}
        selectedTable={checkoutUi.selectedTable}
        orderNotes={checkoutUi.orderNotes}
        onOpenTableSelect={() => modalSetters.setIsTableSelectModalOpen(true)}
        onProceedToCheckout={() => {
          checkoutFlow.handleSelectPaymentMethod('Efectivo USD');
          modalSetters.setIsCheckoutOpen(true);
        }}
      />

      <MobileSimulatorModals
        T={T}
        isLight={isLight}
        isOledMode={isOledMode}
        mobileServerIp={syncDomain.mobileServerIp}
        setMobileServerIp={syncDomain.setMobileServerIp}
        mobileRemoteServerUrl={syncDomain.mobileRemoteServerUrl}
        setMobileRemoteServerUrl={syncDomain.setMobileRemoteServerUrl}
        serverFeedback={syncDomain.serverFeedback}
        isTestingServer={syncDomain.isTestingServer}
        handleAutoDiscoverServer={syncDomain.handleAutoDiscoverServer}
        handleTestAndSaveServer={syncDomain.handleTestAndSaveServer}
        exchangeRate={checkoutFlow.effectiveRate}
        businessInfo={syncDomain.businessInfo}
        user={user}
        isDollarCountry={isDollarCountry}
        triggerHaptic={triggerHaptic}
        playScanSound={playScanSound}
        showToast={showToast}
        getImageUrl={getImageUrl}
        isUnlimitedStockProduct={cartDomain.isUnlimitedStockProduct}
        products={syncDomain.products}
        cart={cart}
        addToCart={cartDomain.addToCart}
        heldSales={heldSales}
        handleDeleteHeldSale={heldFlow.handleDeleteHeldSale}
        handleRestoreHeldSale={heldFlow.handleRestoreHeldSale}
        documentType={checkoutUi.documentType}
        setDocumentType={(v) => setCheckoutField('documentType', v)}
        totalUSD={checkoutFlow.totalDueUSD}
        baseTotalUSD={checkoutFlow.totalUSD}
        totalBS={checkoutFlow.totalDueBS}
        taxUSD={checkoutFlow.taxUSD}
        taxLabel={checkoutFlow.taxLabel}
        effectiveIvaRate={checkoutFlow.effectiveIvaRate}
        isIvaEnabled={checkoutFlow.isIvaEnabled}
        currentIgtfUSD={checkoutFlow.currentIgtfUSD}
        igtfRate={checkoutFlow.igtfRatePct}
        isIgtfEnabled={checkoutFlow.isIgtfEnabled}
        customerDoc={quickForms.customerDoc}
        setCustomerDoc={quickForms.setCustomerDoc}
        customerName={quickForms.customerName}
        setCustomerName={quickForms.setCustomerName}
        setCustomerSearch={quickForms.setCustomerSearch}
        setIsCreatingCustomerInMobile={quickForms.setIsCreatingCustomerInMobile}
        isProcessingSale={checkoutUi.isProcessingSale}
        handleSaveQuotation={checkoutFlow.handleSaveQuotation}
        checkoutMode={checkoutUi.checkoutMode}
        setCheckoutMode={(v) => setCheckoutField('checkoutMode', v)}
        selectedMethod={checkoutUi.selectedMethod}
        handleSelectPaymentMethod={checkoutFlow.handleSelectPaymentMethod}
        cashAccumulateMode={checkoutUi.cashAccumulateMode}
        setCashAccumulateMode={(v) => setCheckoutField('cashAccumulateMode', v)}
        amountPaidUSD={checkoutUi.amountPaidUSD}
        setAmountPaidUSD={(v) => setCheckoutField('amountPaidUSD', v)}
        amountPaidBS={checkoutUi.amountPaidBS}
        setAmountPaidBS={(v) => setCheckoutField('amountPaidBS', v)}
        totalPaidInUSD={checkoutFlow.totalPaidInUSD}
        paidUSD={checkoutFlow.paidUSD}
        paidBS={checkoutFlow.paidBS}
        changeUSD={checkoutFlow.changeUSD}
        changeBS={checkoutFlow.changeBS}
        splitPayments={checkoutUi.splitPayments}
        setSplitPayments={(v) => setCheckoutField('splitPayments', v)}
        splitPaidUSD={checkoutFlow.splitPaidUSD}
        splitRemainingUSD={checkoutFlow.splitRemainingUSD}
        splitChangeUSD={checkoutFlow.splitChangeUSD}
        splitChangeBS={checkoutFlow.splitChangeBS}
        paymentReference={checkoutUi.paymentReference}
        setPaymentReference={(v) => setCheckoutField('paymentReference', v)}
        handleConfirmSale={checkoutFlow.handleConfirmSale}
        handlePrintBluetoothReceipt={checkoutFlow.handlePrintBluetoothReceipt}
        shareReceiptWhatsApp={quickForms.shareReceiptWhatsApp}
        printerSpoolerStatus={syncDomain.printerSpoolerStatus}
        printPreSaleBluetoothReceipt={printPreSaleBluetoothReceipt}
        sharePreSaleWhatsApp={quickForms.sharePreSaleWhatsApp}
        whatsAppPhoneInput={quickForms.whatsAppPhoneInput}
        setWhatsAppPhoneInput={quickForms.setWhatsAppPhoneInput}
        handleConfirmSendWhatsApp={handleConfirmSendWhatsApp}
        whatsAppMessagePreview={whatsAppMessagePreview}
        generateEcoReceiptText={checkoutFlow.generateEcoReceiptText}
        cleanWhatsAppPhone={quickForms.cleanWhatsAppPhone}
        handleSelectBulkPresentation={cartDomain.handleSelectBulkPresentation}
        handleApplyQuantity={cartDomain.handleApplyQuantity}
        posMode={catalogUi.posMode}
        setPosMode={(v) => setCatalogField('posMode', v)}
        handleBarcodeScanned={cartDomain.handleBarcodeScanned}
        openCreateProduct={quickForms.openCreateProduct}
        openEditProduct={quickForms.openEditProduct}
        canCreateProducts={canCreateProductsMobile}
        canViewCosts={canViewCostsMobile}
        productFormData={quickForms.productFormData}
        setProductFormData={quickForms.setProductFormData}
        handleSaveProduct={quickForms.handleSaveProduct}
        isSavingProduct={quickForms.isSavingProduct}
        isUploadingImage={quickForms.isUploadingImage}
        handleProductImageUpload={quickForms.handleProductImageUpload}
        generateInternalEanBarcode={quickForms.generateInternalEanBarcode}
        isCustomCategoryMode={quickForms.isCustomCategoryMode}
        setIsCustomCategoryMode={quickForms.setIsCustomCategoryMode}
        selectableCategories={quickForms.selectableCategories}
        copyBarcodeToClipboard={quickForms.copyBarcodeToClipboard}
        priceCheckerSearch={catalogUi.priceCheckerSearch}
        setPriceCheckerSearch={(v) => setCatalogField('priceCheckerSearch', v)}
        manualItemName={cartDomain.manualItemName}
        setManualItemName={cartDomain.setManualItemName}
        manualItemPrice={cartDomain.manualItemPrice}
        setManualItemPrice={cartDomain.setManualItemPrice}
        manualItemPriceBS={cartDomain.manualItemPriceBS}
        setManualItemPriceBS={cartDomain.setManualItemPriceBS}
        manualItemQty={cartDomain.manualItemQty}
        setManualItemQty={cartDomain.setManualItemQty}
        handleAddManualItem={cartDomain.handleAddManualItem}
        socketConnected={syncDomain.socketConnected}
        pendingSalesCount={syncDomain.pendingSalesCount}
        drawerSearch={catalogUi.drawerSearch}
        setDrawerSearch={(v) => setCatalogField('drawerSearch', v)}
        filteredNavSections={filteredNavSections}
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        canManageSettings={canManageSettingsMobile}
        activeCurrencyMode={checkoutFlow.activeCurrencyMode}
        onExchangeRateUpdated={() => syncDomain.loadSettings()}
        setEnrolledBioUser={(v) => setLoginUi((prev) => ({ ...prev, enrolledBioUser: typeof v === 'function' ? v(prev.enrolledBioUser) : v }))}
        isAudioMuted={syncDomain.isAudioMuted}
        setIsAudioMuted={syncDomain.setIsAudioMuted}
        toggleSoundMute={toggleSoundMute}
        theme={theme}
        setTheme={setTheme}
        logout={logout}
        lastHardwareScan={cartDomain.lastHardwareScan}
        selectedTable={checkoutUi.selectedTable}
        setSelectedTable={(v) => setCheckoutField('selectedTable', v)}
        orderNotes={checkoutUi.orderNotes}
        setOrderNotes={(v) => setCheckoutField('orderNotes', v)}
        customers={syncDomain.customers}
        isCreatingCustomerInMobile={quickForms.isCreatingCustomerInMobile}
        customerSearch={quickForms.customerSearch}
        filteredCustomers={quickForms.filteredCustomers}
        handleSelectCustomer={quickForms.handleSelectCustomer}
        newCustomerForm={quickForms.newCustomerForm}
        setNewCustomerForm={quickForms.setNewCustomerForm}
        handleSaveNewCustomer={quickForms.handleSaveNewCustomer}
        isSavingCustomer={quickForms.isSavingCustomer}
      />
    </div>
  );
}
