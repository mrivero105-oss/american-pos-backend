/**
 * Motor de Evaluación de Promociones y Combos en Tiempo Real (Offline-First 0ms)
 * Permite que el terminal POS calcule descuentos automáticos al instante sin congelar la interfaz.
 */

/**
 * Normaliza y compara identificadores de métodos de pago con flexibilidad
 */
const stripDiacritics = (str) => String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export function matchesPaymentMethod(targetMethods = [], methodIdOrName = '') {
    if (!Array.isArray(targetMethods) || targetMethods.length === 0) return true;
    if (!methodIdOrName) return false;

    const query = stripDiacritics(methodIdOrName);
    return targetMethods.some(target => {
        const t = stripDiacritics(target);
        if (t === query) return true;
        // Mapeos comunes
        if (t === 'cash_usd' && (query === 'cash' || query === 'efectivo_usd' || query.includes('usd') || query.includes('divisa'))) return true;
        if (t === 'cash_bs' && (query === 'efectivo_bs' || query.includes('efectivo bs') || query.includes('cash_bs'))) return true;
        if (t === 'pago_movil' && (query.includes('movil') || query.includes('pago_movil'))) return true;
        if (t === 'debit' && (query.includes('punto') || query.includes('tarjeta') || query.includes('debit') || query.includes('card'))) return true;
        if (t === 'zelle' && query.includes('zelle')) return true;
        if (t === 'transfer' && (query.includes('transfer') || query.includes('banco'))) return true;
        if (t === 'biopago' && query.includes('bio')) return true;
        return query.includes(t) || t.includes(query);
    });
}

/**
 * Filtra únicamente promociones vigentes por fecha, día de la semana y horario
 */
export function getCurrentlyActivePromotions(promotions = []) {
    if (!Array.isArray(promotions) || promotions.length === 0) return [];

    const now = new Date();
    const currentDay = now.getDay(); // 0 = Domingo, 6 = Sábado
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    return promotions.filter(p => {
        if (!p.isActive) return false;
        if (p.startDate && new Date(p.startDate) > now) return false;
        if (p.endDate && new Date(p.endDate) < now) return false;
        if (Array.isArray(p.daysOfWeek) && p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(currentDay)) return false;
        if (p.startTime && currentTimeStr < p.startTime) return false;
        if (p.endTime && currentTimeStr > p.endTime) return false;
        return true;
    }).sort((a, b) => (b.priority || 1) - (a.priority || 1));
}

/**
 * Evalúa las promociones activas contra los ítems en el carrito de compras.
 * @param {Array} cartItems - Lista de productos en el carrito: [{ id, name, price, quantity, category, ... }]
 * @param {Array} promotions - Lista de promociones activas obtenidas del backend o cache local
 * @param {string|null} selectedPaymentMethod - Método de pago seleccionado en Checkout (opcional)
 * @returns {Object} { itemsWithPromotions, appliedPromotions, totalPromoSavings, finalCartSubtotal }
 */
export function evaluateCartPromotions(cartItems = [], promotions = [], selectedPaymentMethod = null) {
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        return {
            itemsWithPromotions: [],
            appliedPromotions: [],
            totalPromoSavings: 0,
            finalCartSubtotal: 0
        };
    }

    if (!Array.isArray(promotions) || promotions.length === 0) {
        let rawTotal = 0;
        const items = cartItems.map(item => {
            const qty = parseFloat(item.quantity) || 1;
            const price = parseFloat(item.price) || 0;
            const sub = qty * price;
            rawTotal += sub;
            return {
                ...item,
                promoDiscount: 0,
                finalUnitPrice: price,
                finalSubtotal: sub,
                appliedPromoName: null
            };
        });
        return {
            itemsWithPromotions: items,
            appliedPromotions: [],
            totalPromoSavings: 0,
            finalCartSubtotal: rawTotal
        };
    }

    const validPromos = getCurrentlyActivePromotions(promotions);
    const rawCartSubtotal = cartItems.reduce((sum, it) => sum + ((parseFloat(it.quantity) || 1) * (parseFloat(it.price) || 0)), 0);

    let totalPromoSavings = 0;
    const appliedPromotionsMap = new Map();

    const itemsWithPromotions = cartItems.map(item => {
        const qty = parseFloat(item.quantity) || 1;
        const price = parseFloat(item.price) || 0;
        const originalSubtotal = qty * price;
        let itemDiscount = 0;
        let appliedPromoName = null;

        for (const promo of validPromos) {
            if (parseFloat(promo.minCartTotal) > 0 && rawCartSubtotal < parseFloat(promo.minCartTotal)) {
                continue;
            }
            // Si es oferta por método de pago, sólo aplica si se especificó el método de pago y coincide
            if (promo.type === 'PAYMENT_METHOD_DISCOUNT') {
                if (!selectedPaymentMethod) continue;
                const matchMethod = matchesPaymentMethod(promo.targetPaymentMethods, selectedPaymentMethod);
                if (!matchMethod) continue;
            }

            // Verificar si el ítem califica por producto o categoría
            const realProductId = String(item.productId || item.id || '');
            const rawItemId = String(item.id || '');
            const matchId = Array.isArray(promo.targetProductIds) && promo.targetProductIds.length > 0
                ? promo.targetProductIds.some(tid => tid === realProductId || tid === rawItemId || rawItemId.startsWith(tid))
                : false;

            const matchCat = Array.isArray(promo.targetCategories) && promo.targetCategories.length > 0
                ? promo.targetCategories.some(c => String(c).toLowerCase() === String(item.category || '').toLowerCase())
                : false;

            const isTarget = (!promo.targetProductIds?.length && !promo.targetCategories?.length)
                ? true
                : (matchId || matchCat);

            if (!isTarget) continue;

            // Verificación de Cantidad Mínima / Volumen Requerido (Unidades, Cartones o Cajas)
            const minUnitsReq = parseFloat(promo.minUnits || promo.buyQuantity) || 1;
            const totalBaseUnitsInCart = cartItems
                .filter(it => {
                    const itRealId = String(it.productId || it.id || '');
                    const itRawId = String(it.id || '');
                    if (promo.targetProductIds?.length > 0) {
                        return promo.targetProductIds.some(tid => tid === itRealId || tid === itRawId || itRawId.startsWith(tid));
                    }
                    if (promo.targetCategories?.length > 0) {
                        return promo.targetCategories.some(cat => String(cat).toLowerCase() === String(it.category || '').toLowerCase());
                    }
                    return true;
                })
                .reduce((sum, it) => sum + ((parseFloat(it.quantity) || 1) * (parseFloat(it.factorConversion) || 1)), 0);

            if (minUnitsReq > 1 && totalBaseUnitsInCart < minUnitsReq) {
                continue; // No califica por no alcanzar el volumen mínimo requerido
            }

            // 1. REGLA BUY_X_GET_Y (ej. 2x1, 3x2)
            if (promo.type === 'BUY_X_GET_Y') {
                const buyQ = parseFloat(promo.buyQuantity) || 2;
                const payQ = parseFloat(promo.payQuantity) || 1;

                if (buyQ > payQ && qty >= buyQ) {
                    const sets = Math.floor(qty / buyQ);
                    const freeUnits = sets * (buyQ - payQ);
                    const discount = freeUnits * price;

                    if (discount > itemDiscount) {
                        itemDiscount = discount;
                        appliedPromoName = `${promo.name} (${buyQ}x${payQ})`;
                        appliedPromotionsMap.set(promo.id, {
                            id: promo.id,
                            name: promo.name,
                            type: promo.type,
                            savings: (appliedPromotionsMap.get(promo.id)?.savings || 0) + discount
                        });
                    }
                }
            }

            // 2. REGLA VOLUME_DISCOUNT (Mayorista / Descuento por docena, cartón o caja)
            else if (promo.type === 'VOLUME_DISCOUNT') {
                const minQ = parseFloat(promo.minUnits || promo.buyQuantity) || 1;
                const itemBaseUnits = qty * (parseFloat(item.factorConversion) || 1);
                if (totalBaseUnitsInCart >= minQ || itemBaseUnits >= minQ) {
                    let discount = 0;
                    if (promo.discountPercentage > 0) {
                        discount = originalSubtotal * (parseFloat(promo.discountPercentage) / 100);
                    } else if (promo.fixedPrice !== null && promo.fixedPrice < price) {
                        discount = qty * (price - parseFloat(promo.fixedPrice));
                    }

                    if (discount > itemDiscount) {
                        itemDiscount = discount;
                        appliedPromoName = `${promo.name} (>=${minQ} und)`;
                        appliedPromotionsMap.set(promo.id, {
                            id: promo.id,
                            name: promo.name,
                            type: promo.type,
                            savings: (appliedPromotionsMap.get(promo.id)?.savings || 0) + discount
                        });
                    }
                }
            }

            // 3. REGLA CATEGORY_DISCOUNT
            else if (promo.type === 'CATEGORY_DISCOUNT') {
                if (promo.discountPercentage > 0) {
                    const discount = originalSubtotal * (parseFloat(promo.discountPercentage) / 100);
                    if (discount > itemDiscount) {
                        itemDiscount = discount;
                        appliedPromoName = `${promo.name} (-${promo.discountPercentage}%)`;
                        appliedPromotionsMap.set(promo.id, {
                            id: promo.id,
                            name: promo.name,
                            type: promo.type,
                            savings: (appliedPromotionsMap.get(promo.id)?.savings || 0) + discount
                        });
                    }
                }
            }

            // 4. REGLA PAYMENT_METHOD_DISCOUNT o COMBO
            else if (promo.type === 'PAYMENT_METHOD_DISCOUNT' || promo.type === 'COMBO') {
                if (promo.type === 'COMBO' && Array.isArray(promo.targetProductIds) && promo.targetProductIds.length > 1) {
                    const allComboItemsInCart = promo.targetProductIds.every(reqId => {
                        const reqStr = String(reqId);
                        return cartItems.some(ci => {
                            const ciProdId = String(ci.productId || ci.id || '');
                            const ciRawId = String(ci.id || '');
                            return ciProdId === reqStr || ciRawId === reqStr || ciRawId.startsWith(`${reqStr}_`) || ciRawId.startsWith(`${reqStr}-`);
                        });
                    });
                    if (!allComboItemsInCart) continue;
                }
                let discount = 0;
                if (promo.discountPercentage > 0) {
                    discount = originalSubtotal * (parseFloat(promo.discountPercentage) / 100);
                } else if (promo.fixedPrice !== null && promo.fixedPrice < price) {
                    discount = qty * (price - parseFloat(promo.fixedPrice));
                }

                if (discount > itemDiscount) {
                    itemDiscount = discount;
                    appliedPromoName = `${promo.name} (-${promo.discountPercentage || 0}%)`;
                    appliedPromotionsMap.set(promo.id, {
                        id: promo.id,
                        name: promo.name,
                        type: promo.type,
                        savings: (appliedPromotionsMap.get(promo.id)?.savings || 0) + discount
                    });
                }
            }

            if (itemDiscount > 0 && !promo.allowStacking) {
                break;
            }
        }

        totalPromoSavings += itemDiscount;
        const finalSubtotal = Math.max(0, originalSubtotal - itemDiscount);
        const finalUnitPrice = qty > 0 ? (finalSubtotal / qty) : price;

        return {
            ...item,
            originalPrice: price,
            finalUnitPrice,
            finalSubtotal,
            promoDiscount: itemDiscount,
            appliedPromoName
        };
    });

    const finalCartSubtotal = itemsWithPromotions.reduce((acc, it) => acc + it.finalSubtotal, 0);

    return {
        itemsWithPromotions,
        appliedPromotions: Array.from(appliedPromotionsMap.values()),
        totalPromoSavings: Math.round(totalPromoSavings * 100) / 100,
        finalCartSubtotal: Math.round(finalCartSubtotal * 100) / 100
    };
}

/**
 * Calcula qué ofertas por método de pago aplican al carrito actual
 * Retorna un mapa indexado por ID o alias de método de pago para renderizar badges en CheckoutModal
 * @param {Array} cartItems 
 * @param {Array} promotions 
 */
export function calculatePaymentMethodDiscounts(cartItems = [], promotions = []) {
    if (!Array.isArray(cartItems) || cartItems.length === 0 || !Array.isArray(promotions) || promotions.length === 0) {
        return {};
    }

    const validPromos = getCurrentlyActivePromotions(promotions).filter(p => p.type === 'PAYMENT_METHOD_DISCOUNT');
    if (validPromos.length === 0) return {};

    const resultByMethod = {};

    for (const promo of validPromos) {
        const targetMethods = Array.isArray(promo.targetPaymentMethods) ? promo.targetPaymentMethods : [];
        if (targetMethods.length === 0) continue;

        // Verificación de Cantidad Mínima / Volumen Requerido (Unidades, Cartones o Cajas)
        const minUnitsReq = parseFloat(promo.minUnits || promo.buyQuantity) || 1;
        if (minUnitsReq > 1) {
            const totalBaseUnitsInCart = cartItems
                .filter(it => {
                    const itRealId = String(it.productId || it.id || '');
                    const itRawId = String(it.id || '');
                    if (promo.targetProductIds?.length > 0) {
                        return promo.targetProductIds.some(tid => tid === itRealId || tid === itRawId || itRawId.startsWith(tid));
                    }
                    if (promo.targetCategories?.length > 0) {
                        return promo.targetCategories.some(cat => String(cat).toLowerCase() === String(it.category || '').toLowerCase());
                    }
                    return true;
                })
                .reduce((sum, it) => sum + ((parseFloat(it.quantity) || 1) * (parseFloat(it.factorConversion) || 1)), 0);

            if (totalBaseUnitsInCart < minUnitsReq) {
                continue; // No califica para el badge de descuento express
            }
        }

        // Calcular ahorro en los productos del carrito que aplican
        let totalPromoSavings = 0;
        let eligibleProductsCount = 0;

        cartItems.forEach(item => {
            const qty = parseFloat(item.quantity) || 1;
            const price = parseFloat(item.price) || 0;
            const itemSubtotal = qty * price;

            const realProductId = String(item.productId || item.id || '');
            const rawItemId = String(item.id || '');
            const matchId = Array.isArray(promo.targetProductIds) && promo.targetProductIds.length > 0
                ? promo.targetProductIds.some(tid => tid === realProductId || tid === rawItemId || rawItemId.startsWith(tid))
                : false;

            const matchCat = Array.isArray(promo.targetCategories) && promo.targetCategories.length > 0
                ? promo.targetCategories.some(c => String(c).toLowerCase() === String(item.category || '').toLowerCase())
                : false;

            const isTarget = (!promo.targetProductIds?.length && !promo.targetCategories?.length)
                ? true
                : (matchId || matchCat);

            if (isTarget) {
                eligibleProductsCount++;
                let disc = 0;
                if (promo.discountPercentage > 0) {
                    disc = itemSubtotal * (parseFloat(promo.discountPercentage) / 100);
                } else if (promo.fixedPrice !== null && promo.fixedPrice < price) {
                    disc = qty * (price - parseFloat(promo.fixedPrice));
                }
                totalPromoSavings += disc;
            }
        });

        if (totalPromoSavings > 0) {
            targetMethods.forEach(methodKey => {
                const k = String(methodKey).toLowerCase();
                if (!resultByMethod[k] || resultByMethod[k].savings < totalPromoSavings) {
                    resultByMethod[k] = {
                        promoId: promo.id,
                        promoName: promo.name,
                        discountPercentage: parseFloat(promo.discountPercentage) || 0,
                        savings: Math.round(totalPromoSavings * 100) / 100,
                        eligibleProductsCount
                    };
                }
            });
        }
    }

    return resultByMethod;
}
