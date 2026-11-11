import { useMemo, useCallback } from 'react';
import { useMobilePosStore } from '../store/useMobilePosStore';
import { triggerHaptic } from '../utils/haptics';
import { playScanSound, playErrorSound, playDeleteSound } from '../utils/sounds';
import { evaluateCartPromotions } from '../utils/promotionsEngine';

/**
 * Hook modular para la gestión reactiva del Carrito Móvil.
 * Centraliza cálculos contables (subtotal, IVA, IGTF, descuentos y conversiones multimoneda)
 * y operaciones de despacho (agregado, decremento, variantes y presentaciones de bulto).
 */
export function useMobileCart({
  products = [],
  promotions = [],
  exchangeRate = 1.0,
  businessMode = 'RETAIL',
  showToast = () => {},
  setSelectedProductForVariant = () => {},
  setSelectedProductForControlledMed = () => {}
}) {
  const cart = useMobilePosStore((s) => s.cart);
  const setCart = useMobilePosStore((s) => s.setCart);
  const cartDiscountPercent = useMobilePosStore((s) => s.cartDiscountPercent);
  const setCartDiscountPercent = useMobilePosStore((s) => s.setCartDiscountPercent);
  const discountSupervisorApprovalId = useMobilePosStore((s) => s.discountSupervisorApprovalId);
  const setDiscountSupervisorApprovalId = useMobilePosStore((s) => s.setDiscountSupervisorApprovalId);
  const resetMobileCart = useMobilePosStore((s) => s.resetMobileCart);

  // Verificación de stock ilimitado (servicios, recargas, etc.)
  const isUnlimitedStockProduct = useCallback((product) => {
    if (!product) return false;
    const cat = String(product.category || product.categoria || '').toLowerCase();
    const barcode = String(product.barcode || product.codigo_barras || '').toLowerCase();
    const isService = Boolean(product.isService || product.is_service || product.tipo === 'servicio');
    return isService || cat.includes('servicio') || cat.includes('recarga') || barcode.startsWith('serv_') || barcode.startsWith('rec_');
  }, []);

  // Mapa reactivo de unidades comprometidas en el ticket actual
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

  // Evaluación de promociones activas
  const promoResult = useMemo(() => {
    if (!Array.isArray(cart) || cart.length === 0 || !Array.isArray(promotions) || promotions.length === 0) {
      return { totalPromoSavings: 0, finalCartSubtotal: null, itemsWithPromotions: [] };
    }
    const flattenedItems = cart.map(item => ({
      id: item.product.id,
      name: item.product.name || item.product.nombre,
      price: Number(item.product.price || item.product.precio || 0),
      quantity: Number(item.quantity) || 1,
      category: item.product.category || item.product.categoria || ''
    }));
    return evaluateCartPromotions(flattenedItems, promotions);
  }, [cart, promotions]);

  // Cómputo de totales, impuestos, exentos y conversiones USD/Bs
  const {
    rawSubtotalUSD,
    totalPromoSavings,
    subtotalBeforeDiscountUSD,
    cartDiscountAmountUSD,
    subtotalUSD,
    enrichedCart,
    taxableSubtotalBeforeDiscountUSD,
    effectiveTaxableUSD,
    taxUSD,
    baseImponibleUSD,
    exemptUSD,
    totalUSD,
    totalBS,
    totalItemsCount
  } = useMemo(() => {
    const rawSub = cart.reduce((acc, item) => acc + ((item.product.price || item.product.precio || 0) * item.quantity), 0);
    const promoSavings = promoResult.totalPromoSavings || 0;
    const subBeforeDisc = promoResult.finalCartSubtotal ?? rawSub;
    const cartDisc = Number((subBeforeDisc * (cartDiscountPercent / 100)).toFixed(2));
    const subUSD = Math.max(0, subBeforeDisc - cartDisc);

    const enriched = cart.map(item => {
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

    const tUSD = Number(Math.max(0, effTaxable - (effTaxable / 1.16)).toFixed(2));
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
  }, [cart, promoResult, cartDiscountPercent, exchangeRate]);

  // Agregar al carrito con validación de stock y rubro
  const addToCart = useCallback((product, forcedQty = 1) => {
    if (!product) return;

    // 1. Variantes de moda
    const hasVariants = (Array.isArray(product.Variantes) && product.Variantes.length > 0) ||
                        (Array.isArray(product.variants) && product.variants.length > 0) ||
                        (businessMode === 'CLOTHING' && !product.selectedVariant);
    if (hasVariants && !product.selectedVariant) {
      setSelectedProductForVariant(product);
      return;
    }

    // 2. Controlados en farmacia
    const isControlled = Boolean(product.es_controlado || product.controlled || (businessMode === 'PHARMACY' && product.categoria?.toLowerCase()?.includes('controlad')));
    if (isControlled && !product.recipe) {
      setSelectedProductForControlledMed(product);
      return;
    }

    // 3. Validación de stock disponible
    const unlimited = isUnlimitedStockProduct(product);
    const latestProd = (!unlimited && Array.isArray(products))
      ? (products.find(p => String(p.id) === String(product.id)) || product)
      : product;
    const maxStock = unlimited ? Infinity : Math.max(0, Number(latestProd.stockQuantity ?? latestProd.stock ?? 0));

    if (!unlimited) {
      if (maxStock <= 0) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Producto agotado (${product.name || product.nombre})`);
        return;
      }

      const alreadyCommittedUnits = cart
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
  }, [businessMode, isUnlimitedStockProduct, products, cart, setCart, setSelectedProductForVariant, setSelectedProductForControlledMed, showToast]);

  // Decremento directo desde tarjeta (1 toque)
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

  // Venta por presentación (Caja, Bulto, etc.)
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
        return prev.map(item => String(item.product.id) === String(cartItemId) ? { ...item, quantity: nextQty } : item);
      }
      return [...prev, { product: bulkProductItem, quantity }];
    });
    showToast(`+${quantity} ${displayName}`);
  }, [addToCart, isUnlimitedStockProduct, setCart, showToast]);

  // Actualizar cantidad directa
  const updateQuantity = useCallback((productId, delta) => {
    triggerHaptic(8);
    setCart(prev => {
      const item = prev.find(i => String(i.product.id) === String(productId));
      if (!item) return prev;
      const nextQty = item.quantity + delta;
      if (nextQty <= 0) {
        playDeleteSound();
        return prev.filter(i => String(i.product.id) !== String(productId));
      }
      return prev.map(i => String(i.product.id) === String(productId) ? { ...i, quantity: nextQty } : i);
    });
  }, [setCart]);

  // Eliminar producto individual
  const removeFromCart = useCallback((productId) => {
    triggerHaptic(15);
    playDeleteSound();
    setCart(prev => prev.filter(item => String(item.product.id) !== String(productId)));
  }, [setCart]);

  // Limpiar carrito completo
  const clearCart = useCallback(() => {
    triggerHaptic(20);
    resetMobileCart();
  }, [resetMobileCart]);

  return {
    cart,
    setCart,
    cartDiscountPercent,
    setCartDiscountPercent,
    discountSupervisorApprovalId,
    setDiscountSupervisorApprovalId,
    cartCommittedUnitsMap,
    promoResult,
    rawSubtotalUSD,
    totalPromoSavings,
    subtotalBeforeDiscountUSD,
    cartDiscountAmountUSD,
    subtotalUSD,
    enrichedCart,
    taxableSubtotalBeforeDiscountUSD,
    effectiveTaxableUSD,
    taxUSD,
    baseImponibleUSD,
    exemptUSD,
    totalUSD,
    totalBS,
    totalItemsCount,
    addToCart,
    decrementFromCard,
    handleSelectBulkPresentation,
    updateQuantity,
    removeFromCart,
    clearCart,
    isUnlimitedStockProduct
  };
}

export default useMobileCart;
