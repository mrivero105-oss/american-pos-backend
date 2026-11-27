import { create } from 'zustand';

/**
 * Store atómico de Zustand para todos los modales y overlays de Isaac POS Mobile.
 * Reemplaza ~28 useState booleanos/payloads sueltos en MobilePOSSimulator.jsx
 * y centraliza el cierre en orden LIFO para el botón Atrás de Android/PWA.
 */
const INITIAL_MODAL_STATE = {
  isBiometricsModalOpen: false,
  isSideNavOpen: false,
  showServerModal: false,
  isMobileCartOpen: false,
  isCheckoutOpen: false,
  isScannerOpen: false,
  printedReceipt: null,
  supervisorAuthRequest: null,
  isHeldSalesModalOpen: false,
  isManualItemModalOpen: false,
  isQuickProductModalOpen: false,
  previewProductImage: null,
  isImageSearchModalOpen: false,
  isThermalPrinterModalOpen: false,
  isExchangeRateModalOpen: false,
  scannerTarget: 'cart',
  unregisteredBarcodeNotice: null,
  priceCheckerProduct: null,
  isPriceCheckerModalOpen: false,
  preSaleSentModal: null,
  isTableSelectModalOpen: false,
  whatsAppModalData: null,
  selectedProductForVariant: null,
  selectedProductForControlledMed: null,
  selectedProductForBulk: null,
  isCustomerSelectModalOpen: false,
  isQuantityModalOpen: false,
  quantityModalItem: null
};

const resolveUpdater = (updater, current) =>
  typeof updater === 'function' ? updater(current) : updater;

export const selectHasActiveOverlay = (s) => Boolean(
  s.supervisorAuthRequest ||
  s.printedReceipt ||
  s.isScannerOpen ||
  s.isCheckoutOpen ||
  s.isCustomerSelectModalOpen ||
  s.isQuantityModalOpen ||
  s.priceCheckerProduct ||
  s.isPriceCheckerModalOpen ||
  s.isHeldSalesModalOpen ||
  s.isManualItemModalOpen ||
  s.isQuickProductModalOpen ||
  s.isThermalPrinterModalOpen ||
  s.isExchangeRateModalOpen ||
  s.isImageSearchModalOpen ||
  s.previewProductImage ||
  s.selectedProductForVariant ||
  s.selectedProductForControlledMed ||
  s.selectedProductForBulk ||
  s.whatsAppModalData ||
  s.preSaleSentModal ||
  s.showServerModal ||
  s.isSideNavOpen ||
  s.isMobileCartOpen ||
  s.isBiometricsModalOpen ||
  s.isTableSelectModalOpen
);

export const useMobileModalStore = create((set, get) => ({
  ...INITIAL_MODAL_STATE,

  setModalField: (field, updater) =>
    set((state) => {
      const next = resolveUpdater(updater, state[field]);
      if (Object.is(next, state[field])) return state;
      return { [field]: next };
    }),

  /**
   * Cierra el overlay superior en orden LIFO estricto.
   * Devuelve true si cerró algún modal, false si no había ninguno abierto.
   */
  closeTopOverlay: () => {
    const s = get();
    if (s.supervisorAuthRequest) { set({ supervisorAuthRequest: null }); return true; }
    if (s.printedReceipt) { set({ printedReceipt: null }); return true; }
    if (s.isScannerOpen) { set({ isScannerOpen: false }); return true; }
    if (s.isCheckoutOpen) { set({ isCheckoutOpen: false }); return true; }
    if (s.isCustomerSelectModalOpen) { set({ isCustomerSelectModalOpen: false }); return true; }
    if (s.isQuantityModalOpen) { set({ isQuantityModalOpen: false }); return true; }
    if (s.priceCheckerProduct) { set({ priceCheckerProduct: null }); return true; }
    if (s.isPriceCheckerModalOpen) { set({ isPriceCheckerModalOpen: false }); return true; }
    if (s.isHeldSalesModalOpen) { set({ isHeldSalesModalOpen: false }); return true; }
    if (s.isManualItemModalOpen) { set({ isManualItemModalOpen: false }); return true; }
    if (s.isQuickProductModalOpen) { set({ isQuickProductModalOpen: false }); return true; }
    if (s.isThermalPrinterModalOpen) { set({ isThermalPrinterModalOpen: false }); return true; }
    if (s.isExchangeRateModalOpen) { set({ isExchangeRateModalOpen: false }); return true; }
    if (s.isImageSearchModalOpen) { set({ isImageSearchModalOpen: false }); return true; }
    if (s.previewProductImage) { set({ previewProductImage: null }); return true; }
    if (s.selectedProductForVariant) { set({ selectedProductForVariant: null }); return true; }
    if (s.selectedProductForControlledMed) { set({ selectedProductForControlledMed: null }); return true; }
    if (s.selectedProductForBulk) { set({ selectedProductForBulk: null }); return true; }
    if (s.whatsAppModalData) { set({ whatsAppModalData: null }); return true; }
    if (s.preSaleSentModal) { set({ preSaleSentModal: null }); return true; }
    if (s.isTableSelectModalOpen) { set({ isTableSelectModalOpen: false }); return true; }
    if (s.isBiometricsModalOpen) { set({ isBiometricsModalOpen: false }); return true; }
    if (s.showServerModal) { set({ showServerModal: false }); return true; }
    if (s.isSideNavOpen) { set({ isSideNavOpen: false }); return true; }
    if (s.isMobileCartOpen) { set({ isMobileCartOpen: false }); return true; }
    return false;
  },

  resetAllModals: () => set({ ...INITIAL_MODAL_STATE })
}));

export default useMobileModalStore;
