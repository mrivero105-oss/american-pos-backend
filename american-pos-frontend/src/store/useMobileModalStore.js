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
  quantityModalItem: null,
  overlayStack: []
};

const OVERLAY_CLOSED_VALUES = {
  supervisorAuthRequest: null,
  printedReceipt: null,
  unregisteredBarcodeNotice: null,
  isScannerOpen: false,
  isCheckoutOpen: false,
  isCustomerSelectModalOpen: false,
  isQuantityModalOpen: false,
  priceCheckerProduct: null,
  isPriceCheckerModalOpen: false,
  isHeldSalesModalOpen: false,
  isManualItemModalOpen: false,
  isQuickProductModalOpen: false,
  isThermalPrinterModalOpen: false,
  isExchangeRateModalOpen: false,
  isImageSearchModalOpen: false,
  previewProductImage: null,
  selectedProductForVariant: null,
  selectedProductForControlledMed: null,
  selectedProductForBulk: null,
  whatsAppModalData: null,
  preSaleSentModal: null,
  isTableSelectModalOpen: false,
  isBiometricsModalOpen: false,
  showServerModal: false,
  isSideNavOpen: false,
  isMobileCartOpen: false
};

const FALLBACK_OVERLAY_PRIORITY = Object.keys(OVERLAY_CLOSED_VALUES);

const resolveUpdater = (updater, current) =>
  typeof updater === 'function' ? updater(current) : updater;

export const selectHasActiveOverlay = (s) => Boolean(
  (Array.isArray(s.overlayStack) && s.overlayStack.length > 0) ||
  s.supervisorAuthRequest ||
  s.printedReceipt ||
  s.unregisteredBarcodeNotice ||
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

function buildClosePatchForOverlay(field) {
  const patch = { [field]: OVERLAY_CLOSED_VALUES[field] };
  if (field === 'isQuantityModalOpen') {
    patch.quantityModalItem = null;
  } else if (field === 'isPriceCheckerModalOpen' || field === 'priceCheckerProduct') {
    patch.isPriceCheckerModalOpen = false;
    patch.priceCheckerProduct = null;
  }
  return patch;
}

export const useMobileModalStore = create((set, get) => ({
  ...INITIAL_MODAL_STATE,

  setModalField: (field, updater) =>
    set((state) => {
      const next = resolveUpdater(updater, state[field]);
      if (Object.is(next, state[field])) return state;

      const patch = { [field]: next };
      if (field === 'isQuantityModalOpen' && !next) {
        patch.quantityModalItem = null;
      }

      if (Object.prototype.hasOwnProperty.call(OVERLAY_CLOSED_VALUES, field)) {
        const currentStack = Array.isArray(state.overlayStack) ? state.overlayStack : [];
        const withoutField = currentStack.filter((item) => item !== field);
        patch.overlayStack = next ? [...withoutField, field] : withoutField;
      }

      return patch;
    }),

  /**
   * Cierra el overlay superior respetando el orden LIFO real de apertura (`overlayStack`).
   * Devuelve true si cerró algún modal, false si no había ninguno abierto.
   */
  closeTopOverlay: () => {
    const s = get();
    const stack = Array.isArray(s.overlayStack) ? [...s.overlayStack] : [];

    // 1. Pop real del stack LIFO descartando entradas que ya estuvieran cerradas
    while (stack.length > 0) {
      const topField = stack.pop();
      if (s[topField]) {
        const closePatch = buildClosePatchForOverlay(topField);
        const remainingStack = stack.filter((f) => !(f in closePatch));
        set({ ...closePatch, overlayStack: remainingStack });
        return true;
      }
    }

    // 2. Fallback seguro por prioridad si algún overlay quedó activo fuera del stack
    for (const field of FALLBACK_OVERLAY_PRIORITY) {
      if (s[field]) {
        const closePatch = buildClosePatchForOverlay(field);
        set({ ...closePatch, overlayStack: [] });
        return true;
      }
    }

    return false;
  },

  resetAllModals: () => set({ ...INITIAL_MODAL_STATE, overlayStack: [] })
}));

export default useMobileModalStore;
