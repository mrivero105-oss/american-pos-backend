const { Op } = require('sequelize');
const { Refund, Sale, SaleItem, Product, BranchStock, StockMovement, AuditLog, Customer, CreditHistory, CashShift, CashMovement, Branch, ProductLot, SupervisorApproval } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, getUserSettings, readJson } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const precision = require('../utils/precision');
const AccountingEngineService = require('./AccountingEngineService');
const FiscalService = require('./FiscalService');

const isCreditMethod = (m) => ['fiado', 'credit', 'credit_usd', 'credito'].includes(String(m || '').toLowerCase().trim());

const isVesMethodOrCurrency = (methodName, explicitCurrency = '') => {
    const cur = String(explicitCurrency || '').toUpperCase().trim();
    if (cur === 'VES' || cur === 'BS') return true;
    if (cur === 'USD' || cur === 'USDT') return false;
    const m = String(methodName || '').toLowerCase().trim();
    return (
        m.includes('ves') ||
        m.includes('_bs') ||
        m.endsWith('bs') ||
        m.includes('bolivar') ||
        m.includes('pago_movil') ||
        m.includes('pagomovil') ||
        m.includes('biopago') ||
        m === 'debit' ||
        m.includes('punto') ||
        m.includes('tarjeta') ||
        m.includes('debito')
    );
};

class RefundService {
    /**
     * Procesa una devolución con integridad financiera y auditoría estricta.
     */
    async processRefund(reqUser, refundData) {
        const { saleId, items, reason, paymentMethods, supervisorApprovalId } = refundData;
        const companyId = reqUser.companyId;
        const userId = reqUser.id;

        if (!saleId) throw new Error('ID de venta requerido para procesar devolución.');
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Debes especificar al menos un producto para devolver.');
        }

        // Find or create default branch if none exists for the company
        let dbBranch = null;
        if (reqUser.activeBranchId && reqUser.activeBranchId !== '1' && reqUser.activeBranchId !== 'null' && reqUser.activeBranchId !== 'undefined') {
            dbBranch = await Branch.findOne({ where: { id: reqUser.activeBranchId, companyId } });
        }
        if (!dbBranch) {
            dbBranch = await Branch.findOne({ where: { companyId } });
        }
        if (!dbBranch) {
            dbBranch = await Branch.findOne({ where: { isMain: true } }) || await Branch.findOne();
        }
        if (!dbBranch) {
            dbBranch = await Branch.create({
                id: generateRobustId(),
                userId,
                companyId,
                name: 'Principal',
                isMain: true,
                isActive: true
            });
        }
        const branchId = dbBranch.id;

        // 1. INICIAR TRANSACCIÓN ATÓMICA DE INMEDIATO
        const t = await sequelize.transaction({
            isolationLevel: sequelize.constructor.Transaction.ISOLATION_LEVELS.READ_COMMITTED
        });

        try {
            // 2. VALIDAR VENTA ORIGINAL CON BLOQUEO PESIMISTA (FOR UPDATE)
            // Cualquier intento concurrente de reembolso esperará aquí
            const sale = await Sale.findOne({
                where: { id: saleId, companyId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (sale) {
                sale.SaleItems = await SaleItem.findAll({
                    where: { saleId },
                    transaction: t
                });
            }

            if (!sale) throw new Error('Venta no encontrada.');
            if (sale.status === 'refunded') throw new Error('Esta venta ya fue devuelta en su totalidad.');

            // --- REGLA DE NEGOCIO: AUTORIZACIÓN DE DEVOLUCIONES ---
            const { isCompanyAdminRole } = require('../constants/roles');
            const canVoidDirectly = isCompanyAdminRole(reqUser.role) || reqUser.permissions?.canVoidSales === true;
            let approval = null;

            if (!canVoidDirectly && !supervisorApprovalId) {
                throw new Error('AUTH_REQUIRED: No tienes permiso para anular ventas o procesar devoluciones. Se requiere la aprobación de un supervisor.');
            }

            if (supervisorApprovalId) {
                approval = await SupervisorApproval.findOne({
                    where: { id: supervisorApprovalId, companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (!approval) {
                    throw new Error('AUTH_REQUIRED: La aprobación de supervisor provista no existe o no pertenece a esta empresa.');
                }

                if (approval.used) {
                    throw new Error('AUTH_REQUIRED: Esta aprobación de supervisor ya fue utilizada previamente.');
                }

                if (approval.expiresAt && new Date(approval.expiresAt) < new Date()) {
                    throw new Error('AUTH_REQUIRED: La aprobación de supervisor ha expirado.');
                }

                const normalizedActionType = String(approval.actionType || '').trim().toUpperCase();
                const allowedRefundActions = new Set([
                    'SALE_REFUND',
                    'ANULAR / REEMBOLSAR FACTURA',
                    'VOID_SALE',
                    'POS_OVERRIDE',
                    'MOBILE_AUTHORIZATION',
                    'GENERAL_ACTION'
                ]);
                if (!allowedRefundActions.has(normalizedActionType)) {
                    throw new Error(`AUTH_REQUIRED: La aprobación proporcionada (${approval.actionType || 'N/A'}) no corresponde a devoluciones o anulaciones.`);
                }
            }

            // 3. CONSULTAR DEVOLUCIONES PREVIAS PARA VALIDACIÓN ACUMULADA (PROTEGIDO POR TRANSACCIÓN)
            const previousRefunds = await Refund.findAll({
                where: { saleId, companyId, status: 'completed' },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            const previouslyRefundedQtyMap = {};
            let pastRefundedTotalAmount = 0;

            for (const prevRefund of previousRefunds) {
                pastRefundedTotalAmount = precision.add([pastRefundedTotalAmount, Number(prevRefund.amount) || 0]);
                let prevItems = [];
                if (Array.isArray(prevRefund.items)) {
                    prevItems = prevRefund.items;
                } else if (typeof prevRefund.items === 'string') {
                    try { prevItems = JSON.parse(prevRefund.items); } catch(e) {}
                }
                for (const pi of prevItems) {
                    const pId = String(pi.productId || pi.id || '');
                    if (pId) {
                        previouslyRefundedQtyMap[pId] = precision.add([previouslyRefundedQtyMap[pId] || 0, Number(pi.quantity) || 0]);
                    }
                }
            }

            // 4. VALIDAR CANTIDADES Y CALCULAR MONTOS CON PRORRATEO EXACTO (DESCUENTOS + PROMOS + IGTF)
            let returnedGrossSubtotal = 0;
            const itemsToProcess = [];
            const requestedQtyMap = {};

            for (const item of items) {
                const reqQty = Number(item.quantity);
                if (!Number.isFinite(reqQty) || reqQty <= 0) {
                    throw new Error(`Cantidad inválida para el producto ${item.name || item.productId || ''}.`);
                }

                const matchingSaleItems = sale.SaleItems.filter(si => String(si.productId) === String(item.productId) || String(si.id) === String(item.productId));
                const originalItem = matchingSaleItems.find(si => String(si.id) === String(item.id)) || matchingSaleItems[0];
                if (!originalItem) throw new Error(`El producto ${item.name} no pertenece a esta venta.`);

                const pId = String(originalItem.productId || item.productId);
                const prevRefundedQty = previouslyRefundedQtyMap[pId] || 0;
                const alreadyRequestedInTx = requestedQtyMap[pId] || 0;
                const totalOriginalQtyForProduct = matchingSaleItems.reduce((acc, si) => precision.add([acc, Number(si.quantity) || 0]), 0);
                const availableToRefund = precision.subtract(totalOriginalQtyForProduct, precision.add([prevRefundedQty, alreadyRequestedInTx]));

                if (reqQty > availableToRefund + 0.0001) {
                    throw new Error(`Cantidad a devolver (${reqQty}) excede la cantidad disponible para reembolso (${Math.max(0, availableToRefund)}).`);
                }
                requestedQtyMap[pId] = precision.add([alreadyRequestedInTx, reqQty]);

                const origQty = Number(originalItem.quantity) || 1;
                const authoritativeUnitPrice = Number(originalItem.price) > 0
                    ? Number(originalItem.price)
                    : (Number(originalItem.subtotal) > 0 ? precision.divide(Number(originalItem.subtotal), origQty) : (Number(item.price) || 0));
                const itemGrossAmount = precision.multiply(authoritativeUnitPrice, reqQty);
                returnedGrossSubtotal = precision.add([returnedGrossSubtotal, itemGrossAmount]);
                itemsToProcess.push({ ...item, productId: pId, quantity: reqQty, price: authoritativeUnitPrice, originalItem });
            }

            const saleTotalAmount = Number(sale.total) || 0;
            const remainingRefundableAmount = Math.max(0, precision.round(precision.subtract(saleTotalAmount, pastRefundedTotalAmount), 2));
            if (saleTotalAmount > 0 && remainingRefundableAmount <= 0) {
                throw new Error('El monto total de esta venta ya fue reembolsado en devoluciones previas.');
            }

            const originalQtyByProduct = {};
            for (const si of sale.SaleItems) {
                const pId = String(si.productId || si.id);
                originalQtyByProduct[pId] = precision.add([originalQtyByProduct[pId] || 0, Number(si.quantity) || 0]);
            }
            const allItemsNowRefunded = Object.keys(originalQtyByProduct).length > 0 && Object.entries(originalQtyByProduct).every(([pId, origQ]) => {
                const totalReturned = precision.add([previouslyRefundedQtyMap[pId] || 0, requestedQtyMap[pId] || 0]);
                return totalReturned >= (origQ - 0.0001);
            });

            const grossSaleItemsSubtotal = Number(sale.subtotal) > 0
                ? Number(sale.subtotal)
                : sale.SaleItems.reduce((acc, si) => {
                    const lineSub = Number(si.subtotal) > 0
                        ? Number(si.subtotal)
                        : precision.multiply(Number(si.price) || 0, Number(si.quantity) || 1);
                    return precision.add([acc, lineSub]);
                }, 0);

            let totalToRefund = 0;
            if (saleTotalAmount > 0 && allItemsNowRefunded) {
                totalToRefund = remainingRefundableAmount;
            } else if (saleTotalAmount > 0 && grossSaleItemsSubtotal > 0) {
                const grossRatio = Math.min(1, precision.divide(returnedGrossSubtotal, grossSaleItemsSubtotal));
                totalToRefund = precision.round(precision.multiply(saleTotalAmount, grossRatio), 2);
                if (totalToRefund > remainingRefundableAmount) {
                    totalToRefund = remainingRefundableAmount;
                }
            } else {
                totalToRefund = precision.round(returnedGrossSubtotal, 2);
                if (saleTotalAmount > 0 && totalToRefund > remainingRefundableAmount) {
                    totalToRefund = remainingRefundableAmount;
                }
            }

            const saleRate = Number(sale.exchangeRate) > 0 ? Number(sale.exchangeRate) : 1;
            const refundRatioOnSale = saleTotalAmount > 0 ? Math.min(1, precision.divide(totalToRefund, saleTotalAmount)) : 1;
            let taxRefundUsd = Number(sale.tax) > 0 ? precision.round(precision.multiply(Number(sale.tax), refundRatioOnSale), 2) : 0;
            let igtfRefundUsd = Number(sale.igtfAmount) > 0 ? precision.round(precision.multiply(Number(sale.igtfAmount), refundRatioOnSale), 2) : 0;
            if (precision.add([taxRefundUsd, igtfRefundUsd]) > totalToRefund) {
                igtfRefundUsd = Math.min(igtfRefundUsd, totalToRefund);
                taxRefundUsd = Math.min(taxRefundUsd, Math.max(0, precision.round(precision.subtract(totalToRefund, igtfRefundUsd), 2)));
            }

            // 4B. PLANIFICAR DESGLOSE DE DEVOLUCIÓN (FIADO MIXTO + MÉTODO/MONEDA REAL DE VENTA)
            let paymentMethodsList = [];
            if (Array.isArray(sale.paymentMethods)) {
                paymentMethodsList = sale.paymentMethods;
            } else if (typeof sale.paymentMethods === 'string') {
                try {
                    const parsed = JSON.parse(sale.paymentMethods);
                    if (Array.isArray(parsed)) paymentMethodsList = parsed;
                } catch (e) {}
            }

            const pmToUsdEq = (pm) => {
                if (!pm) return 0;
                const conv = Number(pm.convertedAmountUsd);
                if (Number.isFinite(conv) && conv > 0) return conv;
                const amt = Number(pm.amount) || 0;
                const mKey = pm.method || pm.id || '';
                const isVes = isVesMethodOrCurrency(mKey, pm.currency);
                return isVes && saleRate > 0 ? precision.divide(amt, saleRate) : amt;
            };

            const originalFiadoMethods = paymentMethodsList.filter(pm => pm && isCreditMethod(pm.method || pm.id));
            const nonFiadoMethods = paymentMethodsList.filter(pm => pm && !isCreditMethod(pm.method || pm.id));

            let originalFiadoUsd = originalFiadoMethods.reduce((acc, pm) => precision.add([acc, pmToUsdEq(pm)]), 0);
            if (paymentMethodsList.length === 0 && (isCreditMethod(sale.paymentMethod) || ['credit', 'unpaid', 'pending'].includes(String(sale.paymentStatus || '').toLowerCase()))) {
                originalFiadoUsd = saleTotalAmount;
            }

            let previousFiadoAbatedUsd = 0;
            for (const prevRefund of previousRefunds) {
                let prevPms = [];
                if (Array.isArray(prevRefund.paymentMethods)) prevPms = prevRefund.paymentMethods;
                else if (typeof prevRefund.paymentMethods === 'string') {
                    try {
                        const p = JSON.parse(prevRefund.paymentMethods);
                        if (Array.isArray(p)) prevPms = p;
                    } catch (_) {}
                }
                if (prevPms.length > 0) {
                    for (const ppm of prevPms) {
                        if (ppm && isCreditMethod(ppm.method || ppm.id)) {
                            previousFiadoAbatedUsd = precision.add([previousFiadoAbatedUsd, pmToUsdEq(ppm)]);
                        }
                    }
                } else if (nonFiadoMethods.length === 0 && originalFiadoUsd > 0) {
                    previousFiadoAbatedUsd = precision.add([previousFiadoAbatedUsd, Number(prevRefund.amount) || 0]);
                }
            }
            const remainingSaleFiadoUsd = Math.max(0, precision.round(precision.subtract(originalFiadoUsd, previousFiadoAbatedUsd), 2));

            let customer = null;
            if (sale.customerId) {
                customer = await Customer.findOne({
                    where: { id: sale.customerId, companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
            }

            let creditPortionUsd = 0;
            if (remainingSaleFiadoUsd > 0 && customer) {
                const currentCustomerBalance = Math.max(0, Number(customer.creditBalance) || 0);
                creditPortionUsd = precision.round(Math.min(totalToRefund, remainingSaleFiadoUsd, currentCustomerBalance), 2);
            }
            const cashBankPortionUsd = precision.round(precision.subtract(totalToRefund, creditPortionUsd), 2);

            const executedRefundMethods = [];
            if (creditPortionUsd > 0) {
                executedRefundMethods.push({
                    method: 'fiado',
                    amount: creditPortionUsd,
                    currency: 'USD',
                    convertedAmountUsd: creditPortionUsd
                });
            }

            if (cashBankPortionUsd > 0) {
                const explicitNonFiado = Array.isArray(paymentMethods)
                    ? paymentMethods.filter(pm => pm && !isCreditMethod(pm.method || pm.id))
                    : [];

                if (explicitNonFiado.length > 0) {
                    const explicitItems = explicitNonFiado.map(pm => {
                        const mId = String(pm.method || pm.id || 'cash');
                        const isVes = isVesMethodOrCurrency(mId, pm.currency);
                        const cur = isVes ? 'VES' : 'USD';
                        const eqUsd = pmToUsdEq({ ...pm, method: mId, currency: cur });
                        return { method: mId, currency: cur, rawAmt: Number(pm.amount) || 0, eqUsd };
                    });
                    const sumExplicitUsd = explicitItems.reduce((acc, it) => precision.add([acc, it.eqUsd]), 0);
                    const needsRescale = sumExplicitUsd <= 0 || Math.abs(precision.subtract(sumExplicitUsd, cashBankPortionUsd)) > 0.02;

                    if (!needsRescale) {
                        explicitItems.forEach(it => {
                            executedRefundMethods.push({
                                method: it.method,
                                amount: precision.round(it.rawAmt, 2),
                                currency: it.currency,
                                convertedAmountUsd: precision.round(it.eqUsd, 2)
                            });
                        });
                    } else {
                        let assignedUsd = 0;
                        explicitItems.forEach((it, idx) => {
                            const isLast = idx === explicitItems.length - 1;
                            const shareUsd = isLast
                                ? precision.round(precision.subtract(cashBankPortionUsd, assignedUsd), 2)
                                : (sumExplicitUsd > 0
                                    ? precision.round(precision.multiply(cashBankPortionUsd, precision.divide(it.eqUsd, sumExplicitUsd)), 2)
                                    : precision.round(precision.divide(cashBankPortionUsd, explicitItems.length), 2));
                            assignedUsd = precision.add([assignedUsd, shareUsd]);
                            if (shareUsd <= 0) return;
                            const nativeAmt = it.currency === 'VES'
                                ? precision.round(precision.multiply(shareUsd, saleRate), 2)
                                : shareUsd;
                            executedRefundMethods.push({
                                method: it.method,
                                amount: nativeAmt,
                                currency: it.currency,
                                convertedAmountUsd: shareUsd
                            });
                        });
                    }
                } else if (refundData.currency) {
                    const explicitCur = String(refundData.currency).toUpperCase() === 'BS' ? 'VES' : String(refundData.currency).toUpperCase();
                    const fallbackMethod = String(
                        nonFiadoMethods[0]?.method ||
                        nonFiadoMethods[0]?.id ||
                        (!isCreditMethod(sale.paymentMethod) && sale.paymentMethod ? sale.paymentMethod : (explicitCur === 'VES' ? 'cash_bs' : 'cash'))
                    );
                    const nativeAmt = explicitCur === 'VES'
                        ? precision.round(precision.multiply(cashBankPortionUsd, saleRate), 2)
                        : cashBankPortionUsd;
                    executedRefundMethods.push({
                        method: fallbackMethod,
                        amount: nativeAmt,
                        currency: explicitCur,
                        convertedAmountUsd: cashBankPortionUsd
                    });
                } else if (nonFiadoMethods.length > 0) {
                    const mappedNonFiado = nonFiadoMethods.map(pm => {
                        const mId = String(pm.method || pm.id || 'cash');
                        const cur = isVesMethodOrCurrency(mId, pm.currency) ? 'VES' : 'USD';
                        const eqUsd = pmToUsdEq({ ...pm, method: mId, currency: cur });
                        return { method: mId, currency: cur, eqUsd };
                    });
                    const totalPaidNonFiadoUsd = mappedNonFiado.reduce((acc, m) => precision.add([acc, m.eqUsd]), 0);
                    let assignedUsd = 0;
                    mappedNonFiado.forEach((m, idx) => {
                        const isLast = idx === mappedNonFiado.length - 1;
                        const portionUsd = isLast
                            ? precision.round(precision.subtract(cashBankPortionUsd, assignedUsd), 2)
                            : (totalPaidNonFiadoUsd > 0
                                ? precision.round(precision.multiply(cashBankPortionUsd, precision.divide(m.eqUsd, totalPaidNonFiadoUsd)), 2)
                                : precision.round(precision.divide(cashBankPortionUsd, mappedNonFiado.length), 2));
                        assignedUsd = precision.add([assignedUsd, portionUsd]);
                        if (portionUsd <= 0) return;
                        const movAmt = m.currency === 'VES'
                            ? precision.round(precision.multiply(portionUsd, saleRate), 2)
                            : portionUsd;
                        executedRefundMethods.push({
                            method: m.method,
                            amount: movAmt,
                            currency: m.currency,
                            convertedAmountUsd: portionUsd
                        });
                    });
                } else {
                    const fallbackMethod = (!isCreditMethod(sale.paymentMethod) && sale.paymentMethod) ? String(sale.paymentMethod) : 'cash';
                    const isVes = isVesMethodOrCurrency(fallbackMethod);
                    const fallbackCur = isVes ? 'VES' : 'USD';
                    const nativeAmt = isVes
                        ? precision.round(precision.multiply(cashBankPortionUsd, saleRate), 2)
                        : cashBankPortionUsd;
                    executedRefundMethods.push({
                        method: fallbackMethod,
                        amount: nativeAmt,
                        currency: fallbackCur,
                        convertedAmountUsd: cashBankPortionUsd
                    });
                }
            }

            // 5. CREAR REGISTRO DE DEVOLUCIÓN
            const refund = await Refund.create({
                id: generateRobustId(),
                saleId,
                userId,
                companyId,
                date: new Date().toISOString(),
                timestamp: new Date(),
                reason: reason || 'Devolución de cliente',
                amount: totalToRefund,
                items: items,
                paymentMethods: executedRefundMethods,
                supervisorApprovalId,
                status: 'completed'
            }, { transaction: t });

            // Consumir aprobación de supervisor de forma atómica (anti-replay)
            if (approval) {
                const now = new Date();
                const [consumedCount] = await SupervisorApproval.update(
                    {
                        used: true,
                        usedAt: now,
                        referenceId: refund.id
                    },
                    {
                        where: {
                            id: approval.id,
                            companyId,
                            used: false,
                            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                        },
                        transaction: t
                    }
                );
                if (consumedCount !== 1) {
                    throw new Error('AUTH_REQUIRED: Esta aprobación de supervisor ya fue utilizada previamente o ha expirado.');
                }
            }

            // 5B. REVERTIR STOCK E INVENTARIO (EN ORDEN DETERMINÍSTICO ANTI-DEADLOCK)
            let returnedCostUsd = 0;
            let hasQuarantineItems = false;
            let hasNonQuarantineItems = false;

            const sortedItemsToProcess = [...itemsToProcess].sort((a, b) =>
                String(a.productId || '').localeCompare(String(b.productId || ''))
            );
            for (const item of sortedItemsToProcess) {
                const product = await Product.findOne({
                    where: { id: item.productId, companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (product) {
                    const shouldRevertStock = product.category !== 'Servicios' && item.isReturnable !== false;

                    if (shouldRevertStock) {
                        const unitsMultiplier = Number(item.factorConversion) > 0
                            ? Number(item.factorConversion)
                            : (Number(item.originalItem?.factorConversion) > 0
                                ? Number(item.originalItem.factorConversion)
                                : (item.isBulk || item.originalItem?.isBulk
                                    ? (Number(product.unitsPerBulk) || Number(item.originalItem?.unitsPerBulk) || 1)
                                    : (item.isMidBulk || item.originalItem?.isMidBulk
                                        ? (Number(product.unitsPerMidBulk) || Number(item.originalItem?.unitsPerMidBulk) || 1)
                                        : 1)));
                        const unitsToRestore = precision.multiply(item.quantity, unitsMultiplier);
                        const lineUnitCost = Number(item.originalItem?.cost) > 0
                            ? Number(item.originalItem.cost)
                            : precision.multiply(Number(product.cost) || 0, unitsMultiplier);

                        if (refundData.quarantine || refundData.isPharmacyQuarantine || product.es_controlado) {
                            hasQuarantineItems = true;
                            // PROTOCOLO DE CUARENTENA SANITARIA FARMACÉUTICA (EN UNIDADES BASE REALES)
                            await ProductLot.create({
                                id: generateRobustId(),
                                companyId,
                                productId: product.id,
                                lotNumber: `CUARENTENA-${Date.now().toString().slice(-6)}`,
                                quantity: unitsToRestore,
                                expirationDate: item.expirationDate || null,
                                cost: unitsMultiplier > 0 ? precision.divide(lineUnitCost, unitsMultiplier) : lineUnitCost,
                                status: 'quarantine'
                            }, { transaction: t });

                            await StockMovement.create({
                                id: generateRobustId(),
                                productId: product.id,
                                userId,
                                companyId,
                                type: 'IN_QUARANTINE',
                                quantity: unitsToRestore,
                                stockBefore: Number(product.stockQuantity) || 0,
                                stockAfter: Number(product.stockQuantity) || 0,
                                reason: `Cuarentena Sanitaria - Devolución Venta #${saleId.split('-').pop()}`,
                                referenceId: refund.id,
                                date: new Date().toISOString(),
                                timestamp: new Date()
                            }, { transaction: t });
                        } else {
                            hasNonQuarantineItems = true;
                            returnedCostUsd = precision.add([returnedCostUsd, precision.multiply(lineUnitCost, item.quantity)]);

                            const [branchStock] = await BranchStock.findOrCreate({
                                where: { productId: product.id, branchId, companyId },
                                defaults: { quantity: 0 },
                                transaction: t
                            });

                            const stockBefore = Number(product.stockQuantity || product.stock || 0);
                            const stockAfter = precision.add([stockBefore, unitsToRestore]);

                            const updatePayload = { 
                                stockQuantity: String(stockAfter), 
                                stock: String(stockAfter),
                                status: stockAfter > 0 ? 'active' : product.status
                            };
                            if (product.stockUnits !== null && product.stockUnits !== undefined) {
                                const currentUnits = Number(product.stockUnits) || 0;
                                const mayorMatch = String(item.name || item.originalItem?.name || '').match(/\((\d+(?:\.\d+)?)\s+[^)]+Mayor\)/i);
                                const avgPieceWeight = (Number(product.unitsPerBulk) > 0 && Number(product.unitsPerBulk) !== 1)
                                    ? Number(product.unitsPerBulk)
                                    : (stockBefore > 0 && currentUnits > 0 ? (stockBefore / currentUnits) : 0);
                                const restoredPieces = mayorMatch
                                    ? Number(mayorMatch[1])
                                    : (avgPieceWeight > 0 ? (unitsToRestore / avgPieceWeight) : 0);
                                if (restoredPieces > 0) {
                                    updatePayload.stockUnits = Math.round((currentUnits + restoredPieces) * 100) / 100;
                                }
                            }
                            await product.update(updatePayload, { transaction: t });
                            await branchStock.increment('quantity', { by: unitsToRestore, transaction: t });

                            await StockMovement.create({
                                id: generateRobustId(),
                                productId: product.id,
                                userId,
                                companyId,
                                type: 'IN',
                                quantity: unitsToRestore,
                                stockBefore,
                                stockAfter,
                                reason: `Devolución Venta #${saleId.split('-').pop()}`,
                                referenceId: refund.id,
                                date: new Date().toISOString(),
                                timestamp: new Date().toISOString()
                            }, { transaction: t });
                        }
                    }
                }
            }

            // 6. REVERTIR LEDGER (DINERO: FIADO MIXTO + CAJA/BANCOS + LEALTAD)
            const totalCumulativeRefunded = precision.add([pastRefundedTotalAmount, totalToRefund]);
            const isFullRefund = precision.subtract(sale.total, totalCumulativeRefunded) <= 0.01;
            const hasCashAdvanceItem = itemsToProcess.some(it => {
                const nm = String(it.name || it.originalItem?.name || '').toLowerCase();
                const cat = String(it.category || it.originalItem?.category || '').toLowerCase();
                return nm.includes('avance') || cat === 'servicios';
            });

            if (isFullRefund || hasCashAdvanceItem) {
                try {
                    await CashMovement.destroy({
                        where: { id: `ADV-${saleId}`, companyId },
                        transaction: t
                    });
                } catch (advErr) {
                    console.warn('[RefundService] No se pudo revertir movimiento de avance:', advErr.message);
                }
            }

            // 6A. Abonar porción fiado a la deuda del cliente (incluye ventas mixtas)
            if (creditPortionUsd > 0 && customer) {
                const newBalance = precision.round(Math.max(0, precision.subtract(customer.creditBalance || 0, creditPortionUsd)), 2);

                await CreditHistory.create({
                    id: generateRobustId(),
                    userId,
                    companyId,
                    customerId: customer.id,
                    type: 'credit', // Abono por devolución
                    amount: creditPortionUsd,
                    balanceAfter: newBalance,
                    description: `Devolución Factura #${saleId.split('-').pop()}`,
                    saleId: sale.id,
                    timestamp: new Date().toISOString()
                }, { transaction: t });

                await customer.update({ creditBalance: newBalance }, { transaction: t });
            }

            // 6B. Registrar salidas reales de caja/bancos por la porción no fiado
            let currentShift = null;
            if (cashBankPortionUsd > 0) {
                currentShift = await CashShift.findOne({
                    where: { userId, status: 'open', companyId },
                    transaction: t
                });

                if (currentShift) {
                    const nonCreditExecuted = executedRefundMethods.filter(pm => pm && !isCreditMethod(pm.method));

                    // Verificar disponibilidad de efectivo físico cuando haya salidas en efectivo
                    if (!refundData.bypassCashCheck && nonCreditExecuted.some(pm => ['cash', 'efectivo', 'cash_usd', 'cash_ves', 'cash_bs'].some(k => String(pm.method || '').toLowerCase().includes(k)))) {
                        const movements = await CashMovement.findAll({
                            where: { shiftId: currentShift.id, companyId },
                            transaction: t
                        });
                        const initBreakdown = (() => {
                            try {
                                return typeof currentShift.initialBreakdown === 'string'
                                    ? JSON.parse(currentShift.initialBreakdown)
                                    : (currentShift.initialBreakdown || {});
                            } catch (e) {
                                return {};
                            }
                        })();

                        for (const pm of nonCreditExecuted) {
                            const isPhysicalCash = ['cash', 'efectivo', 'cash_usd', 'cash_ves', 'cash_bs'].some(k => String(pm.method || '').toLowerCase().includes(k));
                            if (!isPhysicalCash) continue;
                            const cur = String(pm.currency || 'USD').toUpperCase();
                            let availableCash = cur === 'VES'
                                ? Number(initBreakdown.cash_ves || initBreakdown.efectivo_bs || initBreakdown.cash_bs || 0)
                                : Number(initBreakdown.cash || initBreakdown.cash_usd || initBreakdown.efectivo || currentShift.initialAmount || 0);

                            for (const m of movements) {
                                if (m.id && m.id.startsWith('OPEN-')) continue;
                                const mCur = (m.currency || 'USD').toUpperCase();
                                if (mCur === cur) {
                                    const amt = Number(m.amount || 0);
                                    if (m.type === 'in') availableCash = precision.add([availableCash, amt]);
                                    else if (m.type === 'out') availableCash = precision.subtract(availableCash, amt);
                                }
                            }
                            if (availableCash > 0 && pm.amount > availableCash) {
                                console.warn(`[REFUND-WARNING] Saldo en gaveta (${cur} ${availableCash}) inferior a la devolución solicitada (${pm.amount}). Aprobado por supervisor: ${supervisorApprovalId}`);
                            }
                        }
                    }

                    for (const pm of nonCreditExecuted) {
                        await CashMovement.create({
                            id: generateRobustId(),
                            shiftId: currentShift.id,
                            userId,
                            companyId,
                            type: 'out',
                            category: 'REFUND',
                            amount: pm.amount,
                            currency: pm.currency,
                            paymentMethodId: pm.method,
                            reason: `Devolución Venta #${saleId.split('-').pop()} (${pm.method}): ${reason || 'Reembolso'}`,
                            timestamp: new Date().toISOString()
                        }, { transaction: t });
                    }
                } else {
                    console.warn(`[REFUND-AUDIT] Devolución procesada para la venta ${saleId} sin turno de caja abierto asignado al usuario ${userId}. Se registrará únicamente en auditoría.`);
                }
            }

            // 6C. Revertir proporcionalmente puntos de lealtad otorgados al cliente
            if (customer) {
                const allSettings = readJson(SETTINGS_FILE);
                const userSettings = getUserSettings(allSettings, companyId) || {};
                const loyaltyRate = Number(userSettings.loyaltyPointsRate || refundData.loyaltyPointsRate || 0.10);
                const pointsToDeduct = precision.round(precision.multiply(totalToRefund, loyaltyRate), 0);
                const currentPoints = Math.max(0, Number(customer.loyaltyPoints) || 0);
                const actualPointsDeduct = Math.min(currentPoints, Math.max(0, pointsToDeduct));
                if (actualPointsDeduct > 0) {
                    await customer.update({
                        loyaltyPoints: precision.subtract(currentPoints, actualPointsDeduct)
                    }, { transaction: t });
                }
            }

            // 6D. Emitir Nota de Crédito fiscal y Libro de Ventas en la misma transacción
            const netAfterTaxAndIgtf = Math.max(0, precision.round(precision.subtract(totalToRefund, precision.add([taxRefundUsd, igtfRefundUsd])), 2));
            const taxableBaseUsd = taxRefundUsd > 0
                ? Math.min(netAfterTaxAndIgtf, precision.round(precision.divide(taxRefundUsd, 0.16), 2))
                : 0;
            const exemptUsd = Math.max(0, precision.round(precision.subtract(netAfterTaxAndIgtf, taxableBaseUsd), 2));

            const creditNote = await FiscalService.createCreditNoteInTransaction(companyId, userId, {
                branchId,
                saleId: sale.id,
                affectedInvoiceNumber: sale.invoiceNumber || sale.id,
                customerId: sale.customerId || null,
                customerName: sale.customerName || customer?.name || 'Consumidor Final',
                customerRif: sale.customerRif || customer?.idDocument || 'V-00000000',
                subtotal: taxableBaseUsd,
                taxAmount: taxRefundUsd,
                exemptAmount: exemptUsd,
                totalAmount: totalToRefund,
                currency: 'USD',
                exchangeRate: saleRate,
                reason: 'DEVOLUCION_MERCANCIA',
                reenterStock: hasNonQuarantineItems,
                items: itemsToProcess.map(it => ({
                    productId: it.productId,
                    name: it.name || it.originalItem?.name || 'Producto',
                    quantity: it.quantity,
                    price: it.price
                })),
                date: new Date().toISOString().split('T')[0],
                notes: reason || 'Devolución de cliente'
            }, t);

            // 6E. Asiento Contable Automático Síncrono dentro de la misma transacción
            const allInQuarantine = hasQuarantineItems && !hasNonQuarantineItems;
            await AccountingEngineService.generateRefundEntry({
                id: refund.id,
                saleId: sale.id,
                date: refund.date,
                amount: totalToRefund,
                taxAmount: taxRefundUsd,
                igtfAmount: igtfRefundUsd,
                returnedCost: precision.round(returnedCostUsd, 2),
                isQuarantine: allInQuarantine,
                exchangeRate: saleRate,
                paymentMethods: executedRefundMethods,
                userId
            }, sale, companyId, t);

            // 7. ACTUALIZAR ESTADO DE LA VENTA
            const newSaleStatus = isFullRefund ? 'refunded' : 'partially_refunded';
            await sale.update({ status: newSaleStatus }, { transaction: t });

            // 8. LOG DE AUDITORÍA
            await AuditLog.create({
                id: generateRobustId(),
                userId,
                companyId,
                action: 'SALE_REFUND',
                description: `Devolución procesada para venta ${saleId}. Monto: ${totalToRefund}`,
                entityId: refund.id,
                newValue: JSON.stringify({
                    refundId: refund.id,
                    amount: totalToRefund,
                    paymentMethods: executedRefundMethods,
                    creditNoteNumber: creditNote?.creditNoteNumber || null
                }),
                timestamp: new Date().toISOString()
            }, { transaction: t });

            await t.commit();

            try {
                const DailyRollupService = require('./DailyRollupService');
                DailyRollupService.scheduleDayRefresh(companyId, refund.date || new Date());
                if (sale?.date) DailyRollupService.scheduleDayRefresh(companyId, sale.date);
            } catch (_) {}

            // 📱 Alerta Ejecutiva WhatsApp al Dueño (Devolución / Reembolso)
            try {
                const OwnerNotificationService = require('./OwnerNotificationService');
                OwnerNotificationService.notifySecurityAlert(companyId, 'REFUND', {
                    amount: totalToRefund,
                    userName: reqUser.name || reqUser.username,
                    registerId: currentShift?.registerId || '1',
                    reason: reason || 'Reembolso a cliente',
                    authorizedBy: approval?.supervisorName || null
                });
            } catch (notifErr) {
                console.warn('[NOTIF] Failed to send owner refund alert:', notifErr.message);
            }

            return refund;

        } catch (error) {
            await t.rollback();
            throw error;
        }
    }
}

module.exports = new RefundService();
