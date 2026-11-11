import { create } from 'zustand';
import { db } from '../services/db';

const ACTIVE_CART_STORAGE_KEY = 'isaac_mobile_active_cart_v1';
const HELD_SALES_STORAGE_KEY = 'pos_held_sales';

let pendingCartToFlush = null;
let cartFlushTimer = null;
let pendingHeldToFlush = null;
let heldFlushTimer = null;

const flushPendingStorageNow = () => {
  if (cartFlushTimer !== null) {
    clearTimeout(cartFlushTimer);
    cartFlushTimer = null;
    try {
      if (!Array.isArray(pendingCartToFlush) || pendingCartToFlush.length === 0) {
        localStorage.removeItem(ACTIVE_CART_STORAGE_KEY);
      } else {
        localStorage.setItem(ACTIVE_CART_STORAGE_KEY, JSON.stringify(pendingCartToFlush));
      }
    } catch (_) {}
  }
  if (heldFlushTimer !== null) {
    clearTimeout(heldFlushTimer);
    heldFlushTimer = null;
    try {
      localStorage.setItem(
        HELD_SALES_STORAGE_KEY,
        JSON.stringify(Array.isArray(pendingHeldToFlush) ? pendingHeldToFlush : [])
      );
    } catch (_) {}
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingStorageNow);
  window.addEventListener('beforeunload', flushPendingStorageNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingStorageNow();
    }
  });
}

const loadInitialCart = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadInitialHeldSales = () => {
  try {
    const raw = localStorage.getItem(HELD_SALES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persistCartSafe = (cart) => {
  pendingCartToFlush = cart;
  if (cartFlushTimer !== null) {
    clearTimeout(cartFlushTimer);
  }
  cartFlushTimer = setTimeout(() => {
    cartFlushTimer = null;
    try {
      if (!Array.isArray(pendingCartToFlush) || pendingCartToFlush.length === 0) {
        localStorage.removeItem(ACTIVE_CART_STORAGE_KEY);
      } else {
        localStorage.setItem(ACTIVE_CART_STORAGE_KEY, JSON.stringify(pendingCartToFlush));
      }
      db.put('metadata', { key: ACTIVE_CART_STORAGE_KEY, value: pendingCartToFlush || [] }).catch(() => {});
    } catch (_) {}
  }, 120);
};

const persistHeldSalesSafe = (heldSales) => {
  pendingHeldToFlush = heldSales;
  if (heldFlushTimer !== null) {
    clearTimeout(heldFlushTimer);
  }
  heldFlushTimer = setTimeout(() => {
    heldFlushTimer = null;
    const safeList = Array.isArray(pendingHeldToFlush) ? pendingHeldToFlush : [];
    try {
      localStorage.setItem(HELD_SALES_STORAGE_KEY, JSON.stringify(safeList));
      db.put('metadata', { key: HELD_SALES_STORAGE_KEY, value: safeList }).catch(() => {});
    } catch (_) {}
  }, 120);
};

/**
 * Store atómico de Zustand exclusivo para Isaac POS Mobile.
 * Aísla el estado del carrito, descuentos, ventas en espera y navegación móvil,
 * garantizando persistencia ante cierres accidentales o actualizaciones OTA.
 */
export const useMobilePosStore = create((set, get) => ({
  activeModule: 'pos',
  setActiveModule: (mod) =>
    set((state) => ({
      activeModule: typeof mod === 'function' ? mod(state.activeModule) : mod
    })),

  cart: loadInitialCart(),
  setCart: (updater) =>
    set((state) => {
      const nextCart = typeof updater === 'function' ? updater(state.cart) : updater;
      const validCart = Array.isArray(nextCart) ? nextCart : [];
      persistCartSafe(validCart);
      return { cart: validCart };
    }),

  cartDiscountPercent: 0,
  setCartDiscountPercent: (updater) =>
    set((state) => ({
      cartDiscountPercent:
        typeof updater === 'function' ? updater(state.cartDiscountPercent) : updater
    })),

  discountSupervisorApprovalId: null,
  setDiscountSupervisorApprovalId: (updater) =>
    set((state) => ({
      discountSupervisorApprovalId:
        typeof updater === 'function' ? updater(state.discountSupervisorApprovalId) : updater
    })),

  heldSales: loadInitialHeldSales(),
  setHeldSales: (updater) =>
    set((state) => {
      const nextHeld = typeof updater === 'function' ? updater(state.heldSales) : updater;
      const validHeld = Array.isArray(nextHeld) ? nextHeld : [];
      persistHeldSalesSafe(validHeld);
      return { heldSales: validHeld };
    }),

  resetMobileCart: () => {
    persistCartSafe([]);
    set({
      cart: [],
      cartDiscountPercent: 0,
      discountSupervisorApprovalId: null
    });
  }
}));

export default useMobilePosStore;
