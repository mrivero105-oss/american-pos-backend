/**
 * Motor Central Determinista de Evaluación de Promociones y Combos (Fuente Única de Verdad Backend/Frontend)
 */

function matchesPaymentMethod(targetMethods = [], methodIdOrName = '') {
    if (!Array.isArray(targetMethods) || targetMethods.length === 0) return true;
    if (!methodIdOrName) return false;

    const query = String(methodIdOrName).toLowerCase().trim();
    return targetMethods.some(target => {
        const t = String(target).toLowerCase().trim();
        if (t === query) return true;
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

function getCurrentlyActivePromotions(promotions = []) {
    if (!Array.isArray(promotions) || promotions.length === 0) return [];

    const now = new Date();
    const currentDay = now.getDay();
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

function evaluateCartPromotions(cartItems = [], promotions = [], selectedPaymentMethod = null) {
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        return {
            itemsWithPromotions: [],
            itemsWithDiscounts: [],
            appliedPromotions: [],
            totalPromoSavings: 0,
            totalSavings: 0,
            finalCartSubtotal: 0,
            newSubtotal: 0
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
                originalPrice: price,
                finalPrice: price,
                finalUnitPrice: price,
                finalSubtotal: sub,
                promoDiscount: 0,
                appliedPromoName: null
            };
        });
        const roundedTotal = Math.round(rawTotal * 100) / 100;
        return {
            itemsWithPromotions: items,
            itemsWithDiscounts: items,
            appliedPromotions: [],
            totalPromoSavings: 0,
            totalSavings: 0,
            finalCartSubtotal: roundedTotal,
            newSubtotal: roundedTotal
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
            if (promo.type === 'PAYMENT_METHOD_DISCOUNT') {
                if (!selectedPaymentMethod) continue;
                const matchMethod = matchesPaymentMethod(promo.targetPaymentMethods, selectedPaymentMethod);
                if (!matchMethod) continue;
            }

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
                continue;
            }

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
            } else if (promo.type === 'VOLUME_DISCOUNT') {
                const minQ = parseFloat(promo.minUnits || promo.buyQuantity) || 1;
                const itemBaseUnits = qty * (parseFloat(item.factorConversion) || 1);
                if (totalBaseUnitsInCart >= minQ || itemBaseUnits >= minQ) {
                    let discount = 0;
                    if (promo.discountPercentage > 0) {
                        discount = originalSubtotal * (parseFloat(promo.discountPercentage) / 100);
                    } else if (promo.fixedPrice !== null && promo.fixedPrice !== undefined && promo.fixedPrice < price) {
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
            } else if (promo.type === 'CATEGORY_DISCOUNT') {
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
            } else if (promo.type === 'PAYMENT_METHOD_DISCOUNT' || promo.type === 'COMBO') {
                if (promo.type === 'COMBO' && Array.isArray(promo.targetProductIds) && promo.targetProductIds.length > 1) {
                    const allComboItemsInCart = promo.targetProductIds.every(reqId =>
                        cartItems.some(ci => String(ci.productId || ci.id || '') === reqId || String(ci.id || '').startsWith(reqId))
                    );
                    if (!allComboItemsInCart) continue;
                }
                let discount = 0;
                if (promo.discountPercentage > 0) {
                    discount = originalSubtotal * (parseFloat(promo.discountPercentage) / 100);
                } else if (promo.fixedPrice !== null && promo.fixedPrice !== undefined && promo.fixedPrice < price) {
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
            finalPrice: finalUnitPrice,
            finalUnitPrice,
            finalSubtotal,
            promoDiscount: itemDiscount,
            appliedPromoName
        };
    });

    const finalCartSubtotal = itemsWithPromotions.reduce((acc, it) => acc + it.finalSubtotal, 0);
    const roundedSavings = Math.round(totalPromoSavings * 100) / 100;
    const roundedSubtotal = Math.round(finalCartSubtotal * 100) / 100;

    return {
        itemsWithPromotions,
        itemsWithDiscounts: itemsWithPromotions,
        appliedPromotions: Array.from(appliedPromotionsMap.values()),
        totalPromoSavings: roundedSavings,
        totalSavings: roundedSavings,
        finalCartSubtotal: roundedSubtotal,
        newSubtotal: roundedSubtotal
    };
}

module.exports = {
    matchesPaymentMethod,
    getCurrentlyActivePromotions,
    evaluateCartPromotions
};
