import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { playScanSound, playErrorSound, playDeleteSound } from '../../utils/sounds';
import { triggerHaptic } from '../../utils/haptics';
import useScanner from '../useScanner';
import { getCleanProductId, getProductUnitsMultiplier } from './useMobileCatalogAndSync';

/**
 * Hook de dominio de Carrito, Escáner (Cámara + HID) e Ítem Manual para Isaac POS Mobile.
 */
export function useMobileCartAndScanner({
  user,
  products,
  cart,
  setCart,
  setCartDiscountPercent,
  setDiscountSupervisorApprovalId,
  exchangeRate,
  businessMode,
  posMode,
  scannerTarget,
  setScannerTarget,
  setIsScannerOpen,
  setProductFormData,
  setUnregisteredBarcodeNotice,
  setPriceCheckerProduct,
  isPriceCheckerModalOpen,
  setIsPriceCheckerModalOpen,
  setSelectedProductForVariant,
  setSelectedProductForControlledMed,
  setSelectedProductForBulk,
  setPreviewProductImage,
  setQuantityModalItem,
  setIsQuantityModalOpen,
  setIsManualItemModalOpen,
  setIsMobileCartOpen,
  setSearchQuery,
  showToast
}) {
  // Estados de ítem manual rápido
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [manualItemPriceBS, setManualItemPriceBS] = useState('');
  const [manualItemQty, setManualItemQty] = useState('1');
  const [lastHardwareScan, setLastHardwareScan] = useState(null);

  const productsMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(products)) {
      for (const p of products) {
        if (p && p.id != null) map.set(String(p.id), p);
      }
    }
    return map;
  }, [products]);

  const cartCommittedUnitsMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(cart) || cart.length === 0) return map;
    for (const it of cart) {
      const prod = it?.product;
      if (!prod) continue;
      const rawId = String(prod.productId || prod.id || '');
      const baseId = rawId.replace(/__.*$/, '');
      if (!baseId) continue;
      const mult = getProductUnitsMultiplier(prod);
      const qtyUnits = (Number(it.quantity) || 0) * mult;
      map.set(baseId, (map.get(baseId) || 0) + qtyUnits);
    }
    return map;
  }, [cart]);

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

  // Sincronizar stock y precios del carrito si cambia el catálogo
  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0) return;
    setCart((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((item) => {
        if (!item?.product?.id) {
          changed = true;
          return null;
        }
        if (isUnlimitedStockProduct(item.product)) return item;
        const cleanId = getCleanProductId(item.product.productId || item.product.id);
        const latest = products.find((p) => String(p.id) === cleanId);
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

  const addToCart = useCallback((product, forcedQty = 1) => {
    const hasVariants = (Array.isArray(product.Variantes) && product.Variantes.length > 0) ||
                        (Array.isArray(product.variants) && product.variants.length > 0) ||
                        (businessMode === 'CLOTHING' && !product.selectedVariant);
    if (hasVariants && !product.selectedVariant) {
      setSelectedProductForVariant(product);
      return;
    }

    const isControlled = Boolean(
      product.es_controlado ||
      product.controlled ||
      (businessMode === 'PHARMACY' && product.categoria?.toLowerCase()?.includes('controlad'))
    );
    if (isControlled && !product.recipe) {
      setSelectedProductForControlledMed(product);
      return;
    }

    const unlimited = isUnlimitedStockProduct(product);
    const latestProd = (!unlimited && Array.isArray(productsRef.current))
      ? (productsRef.current.find((p) => String(p.id) === String(product.id)) || product)
      : product;
    const maxStock = unlimited ? Infinity : Math.max(0, Number(latestProd.stockQuantity ?? latestProd.stock ?? 0));

    if (!unlimited) {
      if (maxStock <= 0) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Producto agotado (${product.name || product.nombre})`);
        return;
      }

      const alreadyCommittedUnits = (cartRef.current || [])
        .filter((it) => (it.product?.productId === product.id || it.product?.id === product.id || String(it.product?.id).startsWith(`${product.id}__`)))
        .reduce((sum, it) => sum + ((Number(it.quantity) || 0) * getProductUnitsMultiplier(it.product)), 0);

      const availableToCommit = Math.max(0, maxStock - alreadyCommittedUnits);
      if (forcedQty > availableToCommit) {
        triggerHaptic(30);
        playErrorSound();
        showToast(availableToCommit > 0
          ? `⚠️ Solo quedan ${availableToCommit} disponibles (${alreadyCommittedUnits} en ticket)`
          : `⚠️ Stock agotado: ya tienes las ${maxStock} unidades en el ticket`);
        return;
      }
    }

    triggerHaptic(12);
    playScanSound();
    setCart((prev) => {
      const existing = prev.find((item) => String(item.product.id) === String(product.id));
      if (existing) {
        const nextQty = unlimited ? (existing.quantity + forcedQty) : Math.min(maxStock, existing.quantity + forcedQty);
        return prev.map((item) =>
          String(item.product.id) === String(product.id) ? { ...item, product: latestProd, quantity: nextQty } : item
        );
      }
      const initialQty = unlimited ? forcedQty : Math.min(maxStock, forcedQty);
      return [...prev, { product: latestProd, quantity: initialQty }];
    });
    showToast(`+${forcedQty} ${product.name || product.nombre}`);
  }, [businessMode, isUnlimitedStockProduct, setCart, setSelectedProductForVariant, setSelectedProductForControlledMed, showToast]);

  const decrementFromCard = useCallback((product) => {
    if (!product) return;
    triggerHaptic(10);
    setCart((prev) => {
      const pid = String(product.id);
      let targetIdx = prev.findIndex((it) => String(it.product?.id) === pid);
      if (targetIdx === -1) {
        targetIdx = prev.findIndex((it) =>
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
      return prev.map((it, idx) => (idx === targetIdx ? { ...it, quantity: nextQty } : it));
    });
  }, [setCart]);

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
    setCart((prev) => {
      const alreadyInCartUnits = prev
        .filter((it) => (it.product?.productId === product.id || it.product?.id === product.id || String(it.product?.id).startsWith(`${product.id}__`)))
        .reduce((sum, it) => sum + ((Number(it.quantity) || 0) * getProductUnitsMultiplier(it.product)), 0);

      const totalRequestedUnits = alreadyInCartUnits + (quantity * unitsMultiplier);
      if (!unlimited && totalRequestedUnits > currentBaseStock) {
        showToast(`⚠️ Stock insuficiente: solicitado total ${totalRequestedUnits} un., disponible ${currentBaseStock} un.`);
        return prev;
      }

      const existing = prev.find((item) => String(item.product.id) === String(cartItemId));
      if (existing) {
        return prev.map((item) =>
          String(item.product.id) === String(cartItemId) ? { ...item, quantity: item.quantity + quantity } : item
        );
      }
      return [...prev, { product: bulkProductItem, quantity }];
    });
    showToast(`📦 +${quantity} ${displayName}`);
  }, [addToCart, isUnlimitedStockProduct, setCart, showToast]);

  const handleOpenBulkPicker = useCallback((prod) => setSelectedProductForBulk(prod), [setSelectedProductForBulk]);

  const handlePriceCheck = useCallback((product) => {
    setPriceCheckerProduct(product);
    setIsPriceCheckerModalOpen(true);
    triggerHaptic(20);
    playScanSound();
  }, [setPriceCheckerProduct, setIsPriceCheckerModalOpen]);

  const handlePreviewImage = useCallback((imgData) => setPreviewProductImage(imgData), [setPreviewProductImage]);

  const barcodeLookupIndex = useMemo(() => {
    const bulkMap = new Map();
    const midBulkMap = new Map();
    const directMap = new Map();
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (p.bulkBarcode) bulkMap.set(String(p.bulkBarcode).trim().toLowerCase(), p);
      if (p.midBulkBarcode) midBulkMap.set(String(p.midBulkBarcode).trim().toLowerCase(), p);
      const pBarcode = String(p.barcode || p.codigo_barras || '').trim().toLowerCase();
      if (pBarcode) directMap.set(pBarcode, p);
      const pSku = String(p.sku || '').trim().toLowerCase();
      if (pSku) directMap.set(pSku, p);
    }
    return { bulkMap, midBulkMap, directMap };
  }, [products]);

  const handleBarcodeScanned = useCallback((code) => {
    if (!code) return;
    const cleanCode = String(code).trim().toLowerCase();

    if (scannerTarget === 'product_barcode') {
      setProductFormData((prev) => ({ ...prev, barcode: String(code).trim() }));
      setIsScannerOpen(false);
      setScannerTarget('cart');
      triggerHaptic(25);
      playScanSound();
      showToast(`✅ Código asignado al producto: ${code}`);
      return;
    }

    const bulkMatchedProduct = barcodeLookupIndex.bulkMap.get(cleanCode) ||
      products.find((p) => String(p.bulkBarcode || '').trim().toLowerCase() === cleanCode);
    if (bulkMatchedProduct) {
      setUnregisteredBarcodeNotice(null);
      const bUnits = Number(bulkMatchedProduct.unitsPerBulk) || 1;
      const bPrice = Number(bulkMatchedProduct.bulkPrice) > 0
        ? Number(bulkMatchedProduct.bulkPrice)
        : (Number(bulkMatchedProduct.price || bulkMatchedProduct.precio || 0) * bUnits);
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

    const midBulkMatchedProduct = barcodeLookupIndex.midBulkMap.get(cleanCode) ||
      products.find((p) => String(p.midBulkBarcode || '').trim().toLowerCase() === cleanCode);
    if (midBulkMatchedProduct) {
      setUnregisteredBarcodeNotice(null);
      const mUnits = Number(midBulkMatchedProduct.unitsPerMidBulk) || 1;
      const mPrice = Number(midBulkMatchedProduct.midBulkPrice) > 0
        ? Number(midBulkMatchedProduct.midBulkPrice)
        : (Number(midBulkMatchedProduct.price || midBulkMatchedProduct.precio || 0) * mUnits);
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

    let matchedPres = null;
    const presMatchedProduct = products.find((p) => {
      if (Array.isArray(p.Presentations)) {
        const found = p.Presentations.find((pres) => String(pres.barcode || '').trim().toLowerCase() === cleanCode);
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

    const exactProduct = barcodeLookupIndex.directMap.get(cleanCode) || products.find((p) => {
      const pBarcode = String(p.barcode || p.codigo_barras || '').trim().toLowerCase();
      const pSku = String(p.sku || '').trim().toLowerCase();
      return (pBarcode && pBarcode === cleanCode) || (pSku && pSku === cleanCode);
    });

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
  }, [
    scannerTarget, setProductFormData, setIsScannerOpen, setScannerTarget,
    barcodeLookupIndex, products, exchangeRate, handleSelectBulkPresentation,
    posMode, isPriceCheckerModalOpen, setPriceCheckerProduct, setIsPriceCheckerModalOpen,
    addToCart, setSearchQuery, setUnregisteredBarcodeNotice, showToast
  ]);

  const handleBarcodeScannedRef = useRef(handleBarcodeScanned);
  useEffect(() => { handleBarcodeScannedRef.current = handleBarcodeScanned; }, [handleBarcodeScanned]);

  const hardwareScanHudTimerRef = useRef(null);
  const handleHardwareScannerBurst = useCallback((scannedCode) => {
    if (!scannedCode) return;
    handleBarcodeScannedRef.current?.(scannedCode);
    setLastHardwareScan({ code: scannedCode, time: Date.now() });
    if (hardwareScanHudTimerRef.current) clearTimeout(hardwareScanHudTimerRef.current);
    hardwareScanHudTimerRef.current = setTimeout(() => setLastHardwareScan(null), 2500);
  }, []);

  useEffect(() => () => {
    if (hardwareScanHudTimerRef.current) clearTimeout(hardwareScanHudTimerRef.current);
  }, []);

  useScanner(handleHardwareScannerBurst, { enabled: Boolean(user), allowInInputs: false, minLength: 3 });

  const getAvailablePacksExcludingItem = useCallback((cleanProdId, targetCartItemId, targetProd) => {
    const latestProd = products.find((p) => String(p.id) === cleanProdId) || targetProd;
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
  }, [products, cart]);

  const updateQuantity = useCallback((productId, delta) => {
    const targetItem = cart.find((item) => String(item.product.id) === String(productId));
    if (!targetItem) return;

    if (delta > 0 && !isUnlimitedStockProduct(targetItem.product)) {
      const cleanProdId = getCleanProductId(targetItem.product.productId || productId);
      const maxPacksStock = getAvailablePacksExcludingItem(cleanProdId, productId, targetItem.product);
      if (targetItem.quantity + delta > maxPacksStock) {
        triggerHaptic(30);
        playErrorSound();
        if (targetItem.quantity > maxPacksStock && maxPacksStock > 0) {
          setCart((prev) => prev.map((it) =>
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
    if (delta > 0) playScanSound();
    setCart((prev) => prev.map((item) => {
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
  }, [cart, isUnlimitedStockProduct, getAvailablePacksExcludingItem, setCart, showToast]);

  const removeFromCart = useCallback((productId) => {
    triggerHaptic(20);
    playDeleteSound();
    setCart((prev) => prev.filter((item) => String(item.product.id) !== String(productId)));
  }, [setCart]);

  const openQuantityModal = useCallback((item) => {
    triggerHaptic(12);
    const cleanProdId = getCleanProductId(item.product?.productId || item.product?.id || '');
    const latestProd = products.find((p) => String(p.id) === cleanProdId) || item.product;
    setQuantityModalItem({ ...item, product: { ...latestProd, ...item.product } });
    setIsQuantityModalOpen(true);
  }, [products, setQuantityModalItem, setIsQuantityModalOpen]);

  const handleApplyQuantity = useCallback((productId, newQty) => {
    const qty = parseFloat(newQty);
    if (isNaN(qty) || qty <= 0) {
      removeFromCart(productId);
      return;
    }

    const targetItem = cart.find((item) => String(item.product.id) === String(productId));
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

    setCart((prev) => prev.map((item) =>
      String(item.product.id) === String(productId) ? { ...item, quantity: finalQty } : item
    ));
  }, [cart, isUnlimitedStockProduct, getAvailablePacksExcludingItem, removeFromCart, setCart, showToast]);

  const clearCart = useCallback(() => {
    if (cart.length === 0) return;
    triggerHaptic(25);
    playDeleteSound();
    setCart([]);
    setCartDiscountPercent(0);
    setDiscountSupervisorApprovalId(null);
    setIsMobileCartOpen(false);
    showToast('🛒 Carrito vaciado');
  }, [cart.length, setCart, setCartDiscountPercent, setDiscountSupervisorApprovalId, setIsMobileCartOpen, showToast]);

  const handleAddManualItem = useCallback((e) => {
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
    setCart((prev) => [...prev, { product: customProd, quantity: qty }]);
    setManualItemName('');
    setManualItemPrice('');
    setManualItemPriceBS('');
    setManualItemQty('1');
    setIsManualItemModalOpen(false);
    setIsMobileCartOpen(true);
    showToast(`+${qty} ${name} agregado al carrito`);
  }, [manualItemName, manualItemPrice, manualItemPriceBS, manualItemQty, exchangeRate, setCart, setIsManualItemModalOpen, setIsMobileCartOpen, showToast]);

  return {
    productsMap,
    cartCommittedUnitsMap,
    isUnlimitedStockProduct,
    addToCart,
    decrementFromCard,
    handleSelectBulkPresentation,
    handleOpenBulkPicker,
    handlePriceCheck,
    handlePreviewImage,
    handleBarcodeScanned,
    lastHardwareScan,
    updateQuantity,
    removeFromCart,
    openQuantityModal,
    handleApplyQuantity,
    clearCart,
    manualItemName,
    setManualItemName,
    manualItemPrice,
    setManualItemPrice,
    manualItemPriceBS,
    setManualItemPriceBS,
    manualItemQty,
    setManualItemQty,
    handleAddManualItem
  };
}
