import { useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { consolidateLooseUnitsToWholesale } from '../utils/productFamilies';
import { playScanSound, playErrorSound, playDeleteSound } from '../utils/sounds';
import { speakAI } from '../utils/tts';
import { hapticTap } from '../utils/haptics';

/**
 * useCartManager - Enterprise Modular Cart Controller
 * Extracts and isolates all shopping cart operations:
 * - Multi-presentation support (units, bulk packages, mid-bulk, dynamic tiers)
 * - Auto-consolidation to wholesale pricing
 * - Station restrictions & combined stock validation
 * - Optimized local updates avoiding unnecessary re-renders
 */
export function useCartManager({
    cart,
    setCart,
    localCart,
    allProducts,
    stationConfig = {},
    uiHelpers = {}
}) {
    const {
        hasStationRestriction = false,
        isProductAllowedInStation = () => true,
        hasCategoryRestriction = false,
        allowedCategories = []
    } = stationConfig;

    const {
        showNotification = () => {},
        setActionDialog = () => {},
        setLastAddedId = () => {},
        setSelectedIndex = () => {},
        setIsMobileCartOpen = () => {},
        clearPosState = () => {}
    } = uiHelpers;

    const localCartRef = useRef(localCart || cart);
    localCartRef.current = localCart || cart;

    const quantityMultiplierRef = useRef(1);
    const setQuantityMultiplier = useCallback((val) => {
        quantityMultiplierRef.current = val;
    }, []);

    const addToCartOptimistic = useCallback((updater) => {
        setCart(updater);
    }, [setCart]);

    /**
     * Add product to cart with presentation, bulk multiplier and stock checks
     */
    const handleAddToCart = useCallback((product, qtyOffset = 1, isFromPrompt = false, isBulkSale = false, isMidBulkSale = false, presentation = null, options = {}) => {
        if (!product) return;
        hapticTap();

        const currentMultiplier = quantityMultiplierRef.current;

        // 🎯 Modo Estación: Validación de rubro o producto permitido
        if (hasStationRestriction && !isProductAllowedInStation(product)) {
            playErrorSound();
            const stationDesc = hasCategoryRestriction ? allowedCategories.join(', ') : 'productos autorizados para esta estación';
            showNotification(`Estación restringida. Esta caja solo despacha: ${stationDesc}`, 'warning');
            if (currentMultiplier > 1) setQuantityMultiplier(1);
            return;
        }

        const finalQtyOffset = (qtyOffset === 1 && currentMultiplier > 1) ? currentMultiplier : qtyOffset;
        const unitsPerBulk = Number(product.unitsPerBulk || 1);
        const unitsPerMidBulk = Number(product.unitsPerMidBulk || 0);

        const presId = presentation?.id;
        const presFactor = Number(presentation?.factorConversion) || 1;
        const effectiveMultiplier = presId 
            ? presFactor 
            : (isBulkSale 
                ? unitsPerBulk 
                : (isMidBulkSale && unitsPerMidBulk > 0 ? unitsPerMidBulk : 1));
        const unitsNeeded = finalQtyOffset * effectiveMultiplier;

        const isServiceItem = Boolean(product.isService || String(product.category || '').trim().toLowerCase() === 'servicios');
        const isCashAdvanceItem = isServiceItem && /\bavance\b/i.test(String(product.name || ''));

        // Stock Validation
        if (!isServiceItem && product.stockQuantity <= 0 && product.stockQuantity !== '∞') {
            playErrorSound();
            showNotification('Este producto está agotado', 'warning');
            if (currentMultiplier > 1) setQuantityMultiplier(1);
            return;
        }

        // Service / Cash Advance Prompt Support
        if (isServiceItem && !isFromPrompt) {
            setActionDialog({
                isOpen: true,
                type: isCashAdvanceItem ? 'CASH_ADVANCE_PROMPT' : 'SERVICE_PRICE_PROMPT',
                data: { product }
            });
            if (currentMultiplier > 1) setQuantityMultiplier(1);
            return;
        }

        // Weight Support
        if ((product.isSoldByWeight || product.stockUnit === 'kg') && !isFromPrompt) {
            const currentCartRef = localCartRef?.current || [];
            const alreadyInCartUnits = currentCartRef
                .filter(it => (it.productId === product.id || it.id === product.id || String(it.id).startsWith(`${product.id}__`)) && !it.isCustom)
                .reduce((sum, it) => {
                    const mult = Number(it.factorConversion) > 0
                        ? Number(it.factorConversion)
                        : (it.isBulk ? (Number(it.unitsPerBulk) || 1) : (it.isMidBulk ? (Number(it.unitsPerMidBulk) || 1) : 1));
                    return sum + ((Number(it.quantity) || 0) * mult);
                }, 0);
            setActionDialog({
                isOpen: true,
                type: 'WEIGHT_PROMPT',
                data: {
                    product,
                    presentation: presentation || null,
                    isBulkSale: Boolean(isBulkSale),
                    isMidBulkSale: Boolean(isMidBulkSale),
                    alreadyInCartUnits
                }
            });
            if (currentMultiplier > 1) setQuantityMultiplier(1);
            return;
        }

        // Solicitar cantidad solo si la opción 'pos_ask_qty_on_click' está activada en ajustes y no proviene de escaneo
        const askQtyOnClick = !options?.fromScanner && typeof localStorage !== 'undefined' && localStorage.getItem('pos_ask_qty_on_click') === 'true';
        if (askQtyOnClick && !isFromPrompt) {
            const currentCartRef = localCartRef?.current || [];
            const alreadyInCartUnits = currentCartRef
                .filter(it => (it.productId === product.id || it.id === product.id || String(it.id).startsWith(`${product.id}__`)) && !it.isCustom)
                .reduce((sum, it) => {
                    const mult = Number(it.factorConversion) > 0
                        ? Number(it.factorConversion)
                        : (it.isBulk ? (Number(it.unitsPerBulk) || 1) : (it.isMidBulk ? (Number(it.unitsPerMidBulk) || 1) : 1));
                    return sum + ((Number(it.quantity) || 0) * mult);
                }, 0);
            setActionDialog({
                isOpen: true,
                type: 'QUANTITY_PROMPT',
                data: {
                    product,
                    defaultValue: finalQtyOffset > 0 ? finalQtyOffset : 1,
                    isBulkSale: Boolean(isBulkSale),
                    isMidBulkSale: Boolean(isMidBulkSale),
                    presentation: presentation || null,
                    alreadyInCartUnits
                }
            });
            if (currentMultiplier > 1) setQuantityMultiplier(1);
            return;
        }

        const cartItemId = presId 
            ? `${product.id}__pres_${presId}` 
            : (isBulkSale 
                ? `${product.id}__bulk` 
                : (isMidBulkSale ? `${product.id}__mid` : product.id));

        const bulkUnitName = product.bulkUnitName || 'Paquete';
        const bulkPrice = Number(product.bulkPrice) > 0 ? Number(product.bulkPrice) : (Number(product.price) * unitsPerBulk);

        const midBulkUnitName = product.midBulkUnitName || 'Media Presentación';
        const midBulkPrice = Number(product.midBulkPrice) > 0 ? Number(product.midBulkPrice) : (Number(product.price) * (unitsPerMidBulk || 1));

        let itemPrice = Number(product.price);
        let displayName = product.name;
        if (presId) {
            itemPrice = Number(presentation.price);
            const cleanPrName = String(presentation.name || '').trim();
            const hasFactorInName = /\(\d+/.test(cleanPrName) || /x\s*\d+/i.test(cleanPrName);
            displayName = hasFactorInName ? `${product.name} (${cleanPrName})` : `${product.name} (${cleanPrName} x${presFactor})`;
        } else if (isBulkSale) {
            itemPrice = bulkPrice;
            displayName = `${product.name} (${bulkUnitName} x${unitsPerBulk})`;
        } else if (isMidBulkSale) {
            itemPrice = midBulkPrice;
            displayName = `${product.name} (${midBulkUnitName} x${unitsPerMidBulk})`;
        }

        // State Update (Cart)
        setCart(currentCart => {
            const alreadyInCartUnits = currentCart
                .filter(it => (it.productId === product.id || it.id === product.id || String(it.id).startsWith(`${product.id}__`)) && !it.isCustom)
                .reduce((sum, it) => {
                    const mult = Number(it.factorConversion) > 0 
                        ? Number(it.factorConversion) 
                        : (it.isBulk ? (Number(it.unitsPerBulk) || 1) : (it.isMidBulk ? (Number(it.unitsPerMidBulk) || 1) : 1));
                    return sum + ((Number(it.quantity) || 0) * mult);
                }, 0);

            const totalRequestedUnits = alreadyInCartUnits + unitsNeeded;
            if (!isServiceItem && product.stockQuantity !== '∞' && !product.allowNegative && totalRequestedUnits > Number(product.stockQuantity)) {
                playErrorSound();
                showNotification(`Stock insuficiente. Solicitado total: ${totalRequestedUnits} un, disponible: ${product.stockQuantity} un`, 'warning');
                return currentCart;
            }

            const existingIndex = currentCart.findIndex(item => item.id === cartItemId && !item.isCustom);
            let newCart;
            
            if (existingIndex > -1) {
                newCart = [...currentCart];
                const currentQty = newCart[existingIndex].quantity;
                const newQty = Math.max(0, currentQty + finalQtyOffset);

                if (newQty === 0) {
                    newCart.splice(existingIndex, 1);
                } else {
                    newCart[existingIndex] = { ...newCart[existingIndex], quantity: newQty };
                    if (finalQtyOffset > 0 && !product.isCustom) speakAI(`${displayName}, ahora son ${newQty}`);
                }
            } else if (finalQtyOffset > 0) {
                newCart = [...currentCart, { 
                    ...product, 
                    id: cartItemId,
                    productId: product.id,
                    name: displayName,
                    originalName: product.name,
                    price: itemPrice,
                    presentationId: presId || null,
                    presentationName: presentation?.name || null,
                    factorConversion: effectiveMultiplier,
                    isBulk: isBulkSale,
                    unitsPerBulk: unitsPerBulk,
                    bulkPrice: bulkPrice,
                    bulkUnitName: bulkUnitName,
                    isMidBulk: isMidBulkSale,
                    unitsPerMidBulk: unitsPerMidBulk,
                    midBulkPrice: midBulkPrice,
                    midBulkUnitName: midBulkUnitName,
                    unitPrice: Number(product.price),
                    basePrice: Number(product.price),
                    quantity: finalQtyOffset 
                }];
                playScanSound();
                if (!product.isCustom) speakAI(`Agregado: ${displayName}`);
            } else {
                return currentCart;
            }
            
            return consolidateLooseUnitsToWholesale(newCart, product);
        });

        setLastAddedId(cartItemId);
        setTimeout(() => setLastAddedId(null), 1000);
        setSelectedIndex(-1);
        if (currentMultiplier > 1) setQuantityMultiplier(1);
    }, [
        hasStationRestriction, 
        isProductAllowedInStation, 
        hasCategoryRestriction, 
        allowedCategories, 
        showNotification, 
        setQuantityMultiplier, 
        setActionDialog, 
        setCart, 
        setLastAddedId, 
        setSelectedIndex
    ]);

    /**
     * Update quantity of a specific cart row
     */
    const updateQuantity = useCallback((id, quantity) => {
        const item = (localCartRef.current || []).find(p => p.id === id);
        if (!item) return;
        const baseProductId = item.productId || item.id.replace(/__bulk$|__mid$|__pres_.*$/, '');
        const product = allProducts.find(p => p.id === baseProductId) || item;
        
        const unitsMultiplier = Number(item.factorConversion) > 0 
            ? Number(item.factorConversion)
            : (item.isBulk 
                ? (Number(item.unitsPerBulk) || 1) 
                : (item.isMidBulk ? (Number(item.unitsPerMidBulk) || 1) : 1));
        const requiredUnits = Number(quantity) * unitsMultiplier;
        const maxStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? Number(product.stockQuantity) : null;

        const otherUnitsInCart = (localCartRef.current || [])
            .filter(it => it.id !== id && (it.productId === baseProductId || it.id === baseProductId || String(it.id).startsWith(`${baseProductId}__`)) && !it.isCustom)
            .reduce((sum, it) => {
                const mult = Number(it.factorConversion) > 0 
                    ? Number(it.factorConversion) 
                    : (it.isBulk ? (Number(it.unitsPerBulk) || 1) : (it.isMidBulk ? (Number(it.unitsPerMidBulk) || 1) : 1));
                return sum + ((Number(it.quantity) || 0) * mult);
            }, 0);

        const isServiceItem = Boolean(item.isService || product.isService || String(product.category || item.category || '').trim().toLowerCase() === 'servicios');
        if (!isServiceItem && !product.allowNegative && product.stockQuantity !== '∞' && maxStock !== null && !isNaN(maxStock) && (requiredUnits + otherUnitsInCart) > maxStock) {
            playErrorSound();
            const availableForThisRow = Math.max(0, maxStock - otherUnitsInCart);
            const presName = item.presentationName || (item.isBulk ? (product.bulkUnitName || 'paquetes') : (item.isMidBulk ? (product.midBulkUnitName || 'medias') : 'unidades'));
            showNotification(`Máximo disponible: ${Math.floor(availableForThisRow / unitsMultiplier)} ${presName}`, 'warning');
            return;
        }
        if (quantity < 0) return;
        if (quantity === 0) {
            playDeleteSound();
            addToCartOptimistic(prev => prev.filter(p => p.id !== id));
            return;
        }

        addToCartOptimistic(prev => {
            const mapped = prev.map(p => p.id === id ? { ...p, quantity } : p);
            return consolidateLooseUnitsToWholesale(mapped, product);
        });

        const isWeighed = Boolean(product?.isSoldByWeight || product?.stockUnit === 'kg');
        if (product && !product.isCustom) {
            const presName = item.isBulk ? (product.bulkUnitName || 'paquetes') : (item.isMidBulk ? (product.midBulkUnitName || 'medias') : 'unidades');
            speakAI(isWeighed ? `Actualizado a ${quantity} kilos` : `Actualizado a ${quantity} ${presName}`);
        }
    }, [allProducts, showNotification, addToCartOptimistic]);

    /**
     * Cycle between unit, mid-bulk, bulk, or dynamic presentations
     */
    const toggleCartItemPresentation = useCallback((cartItemId) => {
        setCart(currentCart => {
            const itemIndex = currentCart.findIndex(i => i.id === cartItemId);
            if (itemIndex === -1) return currentCart;
            
            const item = currentCart[itemIndex];
            const baseProductId = item.productId || String(item.id).replace(/__bulk$|__mid$|__pres_.*$/, '');
            const product = allProducts.find(p => p.id === baseProductId) || item;

            const rawPresList = (Array.isArray(product.Presentations) && product.Presentations.length > 0)
                ? product.Presentations
                : (Array.isArray(item.Presentations) && item.Presentations.length > 0 ? item.Presentations : []);

            const getPresUnits = (pr) => {
                const fc = Number(pr?.factorConversion);
                if (fc > 0) return fc;
                const match = String(pr?.name || '').match(/(\d+(?:\.\d+)?)\s*(?:un|und|unid|unidades|pza|pzas)/i);
                if (match) return Number(match[1]);
                return Number(pr?.price) || Number(pr?.orderIndex) || 0;
            };

            const presList = [...rawPresList].sort((a, b) => {
                const diff = getPresUnits(a) - getPresUnits(b);
                if (diff !== 0) return diff;
                return (Number(a?.price) || 0) - (Number(b?.price) || 0);
            });

            if (presList.length > 0) {
                const currentPresId = item.presentationId;
                const currentIndex = currentPresId ? presList.findIndex(p => p.id === currentPresId) : -1;
                const nextIndex = currentIndex + 1;
                const isBackToUnit = nextIndex >= presList.length;
                const targetPres = isBackToUnit ? null : presList[nextIndex];

                const baseName = item.originalName || product.name || item.name;
                const newCartItemId = targetPres ? `${baseProductId}__pres_${targetPres.id}` : baseProductId;
                const newPrice = targetPres ? Number(targetPres.price) : Number(product.price);
                const cleanTargetName = String(targetPres?.name || '').trim();
                const hasFactorInTargetName = /\(\d+/.test(cleanTargetName) || /x\s*\d+/i.test(cleanTargetName);
                const newDisplayName = targetPres
                    ? (hasFactorInTargetName ? `${baseName} (${cleanTargetName})` : `${baseName} (${cleanTargetName} x${targetPres.factorConversion})`)
                    : baseName;

                const newCart = [...currentCart];
                newCart[itemIndex] = {
                    ...item,
                    id: newCartItemId,
                    productId: baseProductId,
                    name: newDisplayName,
                    originalName: baseName,
                    presentationId: targetPres?.id || null,
                    presentationName: targetPres?.name || null,
                    factorConversion: targetPres ? (Number(targetPres.factorConversion) || 1) : 1,
                    isBulk: false,
                    isMidBulk: false,
                    isAutoConsolidated: false,
                    price: newPrice,
                    Presentations: presList
                };
                return newCart;
            }

            const unitsPerBulk = Number(product.unitsPerBulk || item.unitsPerBulk || 1);
            const unitsPerMidBulk = Number(product.unitsPerMidBulk || item.unitsPerMidBulk || 0);

            const hasBulk = unitsPerBulk > 1;
            const hasMid = unitsPerMidBulk > 0;

            if (!hasBulk && !hasMid) return currentCart;

            let nextState = 'unit';
            if (hasBulk && hasMid) {
                if (!item.isBulk && !item.isMidBulk) nextState = 'mid';
                else if (item.isMidBulk) nextState = 'bulk';
                else nextState = 'unit';
            } else if (hasMid) {
                nextState = item.isMidBulk ? 'unit' : 'mid';
            } else if (hasBulk) {
                nextState = item.isBulk ? 'unit' : 'bulk';
            }

            const isNextBulk = nextState === 'bulk';
            const isNextMid = nextState === 'mid';

            const baseName = item.originalName || product.name || item.name;
            const bulkUnitName = product.bulkUnitName || item.bulkUnitName || 'Paquete';
            const bulkPrice = Number(product.bulkPrice) > 0 ? Number(product.bulkPrice) : (Number(product.price) * unitsPerBulk);

            const midBulkUnitName = product.midBulkUnitName || item.midBulkUnitName || 'Media Presentación';
            const midBulkPrice = Number(product.midBulkPrice) > 0 ? Number(product.midBulkPrice) : (Number(product.price) * (unitsPerMidBulk || 1));

            const newCartItemId = isNextBulk 
                ? `${baseProductId}__bulk` 
                : (isNextMid ? `${baseProductId}__mid` : baseProductId);

            let newPrice = Number(product.price || item.unitPrice || item.price);
            let newName = baseName;
            let stateLabel = 'Unidad';

            if (isNextBulk) {
                newPrice = bulkPrice;
                newName = `${baseName} (${bulkUnitName} x${unitsPerBulk})`;
                stateLabel = bulkUnitName;
            } else if (isNextMid) {
                newPrice = midBulkPrice;
                newName = `${baseName} (${midBulkUnitName} x${unitsPerMidBulk})`;
                stateLabel = midBulkUnitName;
            }

            const newCart = [...currentCart];
            newCart[itemIndex] = {
                ...item,
                id: newCartItemId,
                productId: baseProductId,
                name: newName,
                originalName: baseName,
                isBulk: isNextBulk,
                isMidBulk: isNextMid,
                price: newPrice,
                unitsPerBulk: unitsPerBulk,
                bulkPrice: bulkPrice,
                bulkUnitName: bulkUnitName,
                unitsPerMidBulk: unitsPerMidBulk,
                midBulkPrice: midBulkPrice,
                midBulkUnitName: midBulkUnitName,
                unitPrice: Number(product.price || item.unitPrice || item.price)
            };
            
            playScanSound();
            if (!product.isCustom) speakAI(`Cambiado a ${stateLabel}`);
            return newCart;
        });
    }, [allProducts, setCart]);

    /**
     * Apply tier wholesale suggestion
     */
    const handleApplyTierSuggestion = useCallback((item, presentation, packs, remainder) => {
        if (!item || !presentation || packs <= 0) return;
        setCart(currentCart => {
            let updated = [...currentCart];
            const baseIndex = updated.findIndex(it => it.id === item.id);
            if (baseIndex === -1) return currentCart;

            if (remainder > 0) {
                updated[baseIndex] = { ...updated[baseIndex], quantity: remainder };
            } else {
                updated.splice(baseIndex, 1);
            }

            const presCartItemId = `${item.productId || item.id}__pres_${presentation.id}`;
            const presIndex = updated.findIndex(it => it.id === presCartItemId);

            if (presIndex > -1) {
                updated[presIndex] = {
                    ...updated[presIndex],
                    quantity: updated[presIndex].quantity + packs
                };
            } else {
                const baseName = item.originalName || item.name;
                updated.push({
                    ...item,
                    id: presCartItemId,
                    productId: item.productId || item.id,
                    name: `${baseName} (${presentation.name})`,
                    originalName: baseName,
                    price: Number(presentation.price),
                    presentationId: presentation.id,
                    presentationName: presentation.name,
                    factorConversion: Number(presentation.factorConversion) || 1,
                    quantity: packs,
                    isBulk: false,
                    isMidBulk: false
                });
            }

            playScanSound();
            toast.success(`Aplicado: ${packs}x ${presentation.name}`, { duration: 2000, icon: '✨' });
            return updated;
        });
    }, [setCart]);

    /**
     * Direct clean cart empty operation without alerts
     */
    const handleClearCartDirect = useCallback(() => {
        clearPosState();
        setCart([]);
        setIsMobileCartOpen(false);
        hapticTap();
        toast.success('Ticket vaciado', { duration: 1500, icon: '🗑️' });
    }, [clearPosState, setCart, setIsMobileCartOpen]);

    return {
        handleAddToCart,
        updateQuantity,
        toggleCartItemPresentation,
        handleApplyTierSuggestion,
        handleClearCartDirect,
        addToCartOptimistic,
        quantityMultiplierRef,
        setQuantityMultiplier,
        localCartRef
    };
}

export default useCartManager;
