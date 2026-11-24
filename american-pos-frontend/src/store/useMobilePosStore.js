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
    } catch (err) {
      console.warn('[MobileStore] Error guardando carrito pendiente:', err?.message);
    }
  }
  if (heldFlushTimer !== null) {
    clearTimeout(heldFlushTimer);
    heldFlushTimer = null;
    try {
      localStorage.setItem(
        HELD_SALES_STORAGE_KEY,
        JSON.stringify(Array.isArray(pendingHeldToFlush) ? pendingHeldToFlush : [])
      );
    } catch (err) {
      console.warn('[MobileStore] Error guardando ventas en espera:', err?.message);
    }
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

/**
 * Normaliza un ítem de carrito o venta en espera (formato móvil `{ product, quantity }`
 * o formato plano Desktop/servidor `{ id, productId, name, price, quantity }`)
 * al contrato canónico `{ product: { id, name, price, ... }, quantity }` que espera Mobile POS.
 */
export const normalizeMobileCartItem = (rawItem, catalogLookup = null) => {
  if (!rawItem || typeof rawItem !== 'object') return null;

  const hasNestedProduct = rawItem.product && typeof rawItem.product === 'object';
  const baseProd = hasNestedProduct ? rawItem.product : rawItem;

  const rawId =
    baseProd.id ??
    baseProd.productId ??
    baseProd.producto_id ??
    rawItem.productId ??
    rawItem.producto_id ??
    rawItem.id;

  if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
    return null;
  }

  const itemId = String(rawId).trim();
  const cleanLookupId = itemId.replace(/__bulk$|__mid$|__pres_.*$/, '');
  let catalogProd = null;
  if (catalogLookup instanceof Map) {
    catalogProd = catalogLookup.get(itemId) || catalogLookup.get(cleanLookupId) || null;
  } else if (Array.isArray(catalogLookup)) {
    catalogProd = catalogLookup.find((p) => p && (String(p.id) === itemId || String(p.id) === cleanLookupId)) || null;
  }

  const resolvedName =
    baseProd.name ||
    baseProd.nombre ||
    rawItem.name ||
    rawItem.nombre ||
    rawItem.productName ||
    catalogProd?.name ||
    catalogProd?.nombre ||
    'Artículo';

  const resolvedPrice = Number(
    baseProd.price ??
    baseProd.precio ??
    rawItem.price ??
    rawItem.precio ??
    rawItem.unitPrice ??
    catalogProd?.price ??
    catalogProd?.precio ??
    0
  );

  const normalizedProduct = {
    ...(catalogProd || {}),
    ...baseProd,
    id: itemId,
    productId: String(baseProd.productId || rawItem.productId || catalogProd?.id || cleanLookupId),
    name: resolvedName,
    nombre: resolvedName,
    price: Number.isFinite(resolvedPrice) ? resolvedPrice : 0
  };

  const qtyRaw = Number(rawItem.quantity ?? rawItem.qty ?? 1);
  const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;

  return {
    ...(hasNestedProduct ? rawItem : {}),
    product: normalizedProduct,
    quantity
  };
};

export const normalizeMobileCartItems = (items, catalogLookup = null) => {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  for (const item of items) {
    const clean = normalizeMobileCartItem(item, catalogLookup);
    if (clean) normalized.push(clean);
  }
  return normalized;
};

const normalizeHeldSalesList = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s === 'object' && s.id)
    .map((s) => ({
      ...s,
      items: normalizeMobileCartItems(s.items)
    }));
};

const loadInitialCart = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeMobileCartItems(parsed);
  } catch {
    return [];
  }
};

const loadInitialHeldSales = () => {
  try {
    const raw = localStorage.getItem(HELD_SALES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeHeldSalesList(parsed);
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
    } catch (err) {
      console.warn('[MobileStore] Error persistiendo carrito:', err?.message);
    }
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
    } catch (err) {
      console.warn('[MobileStore] Error persistiendo ventas en espera:', err?.message);
    }
  }, 120);
};

let hasUserMutatedCart = false;
let hasUserMutatedHeld = false;

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
  setCart: (updater) => {
    hasUserMutatedCart = true;
    return set((state) => {
      const nextCart = typeof updater === 'function' ? updater(state.cart) : updater;
      const validCart = normalizeMobileCartItems(nextCart);
      persistCartSafe(validCart);
      return { cart: validCart };
    });
  },

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
  setHeldSales: (updater) => {
    hasUserMutatedHeld = true;
    return set((state) => {
      const nextHeld = typeof updater === 'function' ? updater(state.heldSales) : updater;
      const validHeld = normalizeHeldSalesList(nextHeld);
      persistHeldSalesSafe(validHeld);
      return { heldSales: validHeld };
    });
  },

  hydrateFromDb: async () => {
    if (typeof db?.getById !== 'function') return;
    try {
      const state = get();
      const updates = {};

      if (!hasUserMutatedCart && (!Array.isArray(state.cart) || state.cart.length === 0)) {
        const savedCartRec = await db.getById('metadata', ACTIVE_CART_STORAGE_KEY).catch(() => null);
        const hydratedCart = normalizeMobileCartItems(savedCartRec?.value);
        if (hydratedCart.length > 0 && !hasUserMutatedCart) {
          updates.cart = hydratedCart;
          try {
            localStorage.setItem(ACTIVE_CART_STORAGE_KEY, JSON.stringify(hydratedCart));
          } catch {
            // Ignorar si localStorage no permite escritura
          }
        }
      }

      if (!hasUserMutatedHeld && (!Array.isArray(state.heldSales) || state.heldSales.length === 0)) {
        const savedHeldRec = await db.getById('metadata', HELD_SALES_STORAGE_KEY).catch(() => null);
        const hydratedHeld = normalizeHeldSalesList(savedHeldRec?.value);
        if (hydratedHeld.length > 0 && !hasUserMutatedHeld) {
          updates.heldSales = hydratedHeld;
          try {
            localStorage.setItem(HELD_SALES_STORAGE_KEY, JSON.stringify(hydratedHeld));
          } catch {
            // Ignorar si localStorage no permite escritura
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        set(updates);
      }
    } catch (err) {
      console.warn('[MobileStore] Error hidratando carrito/ventas en espera desde DB:', err?.message);
    }
  },

  resetMobileCart: () => {
    hasUserMutatedCart = true;
    persistCartSafe([]);
    set({
      cart: [],
      cartDiscountPercent: 0,
      discountSupervisorApprovalId: null
    });
  }
}));

// Hidratación de respaldo desde SQLite/IndexedDB por si WebView purgó localStorage tras OTA/reinicio
if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    useMobilePosStore.getState().hydrateFromDb();
  });
}

export default useMobilePosStore;
