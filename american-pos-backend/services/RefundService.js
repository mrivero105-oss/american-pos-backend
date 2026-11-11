const { Refund, Sale, SaleItem, Product, BranchStock, StockMovement, AuditLog, Customer, CreditHistory, CashShift, CashMovement, Branch, ProductLot, SupervisorApproval } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const precision = require('../utils/precision');

class RefundService {
    /**
     * Procesa una devolución con integridad financiera y auditoría estricta.
     */
    async processRefund(reqUser, refundData) {
        const { saleId, items, reason, paymentMethods, supervisorApprovalId } = refundData;
        const companyId = reqUser.companyId;
        const userId = reqUser.id;

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
            const canVoidDirectly = reqUser.role === 'superadmin' || reqUser.role === 'admin' || reqUser.permissions?.canVoidSales === true;
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

            // 4. VALIDAR CANTIDADES Y MONTOS (INTEGER MATH)
            let totalToRefund = 0;
            const itemsToProcess = [];

            for (const item of items) {
                const matchingSaleItems = sale.SaleItems.filter(si => String(si.productId) === String(item.productId) || String(si.id) === String(item.productId));
                const originalItem = matchingSaleItems.find(si => String(si.id) === String(item.id)) || matchingSaleItems[0];
                if (!originalItem) throw new Error(`El producto ${item.name} no pertenece a esta venta.`);
                
                const pId = String(item.productId || originalItem.productId);
                const prevRefundedQty = previouslyRefundedQtyMap[pId] || 0;
                const totalOriginalQtyForProduct = matchingSaleItems.reduce((acc, si) => precision.add([acc, Number(si.quantity) || 0]), 0);
                const availableToRefund = precision.subtract(totalOriginalQtyForProduct, prevRefundedQty);

                if (Number(item.quantity) > availableToRefund) {
                    throw new Error(`Cantidad a devolver (${item.quantity}) excede la cantidad disponible para reembolso (${availableToRefund}).`);
                }

                const itemRefundAmount = precision.multiply(item.price, item.quantity);
                totalToRefund = precision.add([totalToRefund, itemRefundAmount]);
                itemsToProcess.push({ ...item, originalItem });
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
                paymentMethods,
                supervisorApprovalId,
                status: 'completed'
            }, { transaction: t });

            // Consumir aprobación de supervisor (anti-replay)
            if (approval) {
                await approval.update({
                    used: true,
                    usedAt: new Date(),
                    referenceId: refund.id
                }, { transaction: t });
            }

            // 5. REVERTIR STOCK E INVENTARIO (EN ORDEN DETERMINÍSTICO ANTI-DEADLOCK)
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
                        if (refundData.quarantine || refundData.isPharmacyQuarantine || product.es_controlado) {
                            // PROTOCOLO DE CUARENTENA SANITARIA FARMACÉUTICA
                            await ProductLot.create({
                                id: generateRobustId(),
                                companyId,
                                productId: product.id,
                                lotNumber: `CUARENTENA-${Date.now().toString().slice(-6)}`,
                                quantity: item.quantity,
                                expirationDate: item.expirationDate || null,
                                cost: item.cost || product.cost || 0,
                                status: 'quarantine'
                            }, { transaction: t });

                            await StockMovement.create({
                                id: generateRobustId(),
                                productId: product.id,
                                userId,
                                companyId,
                                type: 'IN_QUARANTINE',
                                quantity: item.quantity,
                                stockBefore: Number(product.stockQuantity) || 0,
                                stockAfter: Number(product.stockQuantity) || 0,
                                reason: `Cuarentena Sanitaria - Devolución Venta #${saleId.split('-').pop()}`,
                                referenceId: refund.id,
                                timestamp: new Date()
                            }, { transaction: t });
                        } else {
                            const [branchStock] = await BranchStock.findOrCreate({
                                where: { productId: product.id, branchId, companyId },
                                defaults: { quantity: 0 },
                                transaction: t
                            });

                            const unitsMultiplier = Number(item.factorConversion) > 0 
                                ? Number(item.factorConversion) 
                                : (Number(item.originalItem?.factorConversion) > 0 
                                    ? Number(item.originalItem.factorConversion) 
                                    : (item.isBulk ? (Number(product.unitsPerBulk) || 1) : (item.isMidBulk ? (Number(product.unitsPerMidBulk) || 1) : 1)));
                            const unitsToRestore = precision.multiply(item.quantity, unitsMultiplier);
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
                                timestamp: new Date().toISOString()
                            }, { transaction: t });
                        }
                    }
                }
            }

            // 6. REVERTIR LEDGER (DINERO)
            const totalCumulativeRefunded = precision.add([pastRefundedTotalAmount, totalToRefund]);
            const isFullRefund = precision.subtract(sale.total, totalCumulativeRefunded) <= 0.01;
            const hasCashAdvanceItem = itemsToProcess.some(it => {
                const nm = String(it.name || it.originalItem?.name || '').toLowerCase();
                const cat = String(it.category || it.originalItem?.category || '').toLowerCase();
                return nm.includes('avance') || cat === 'servicios';
            });

            // Si la venta original contenía un Avance de Efectivo (ADV-...) y es devolución total o del ítem de avance, revertir la salida
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
            // Si hubo crédito (Fiado), reducir la deuda del cliente
            let paymentMethodsList = [];
            if (Array.isArray(sale.paymentMethods)) {
                paymentMethodsList = sale.paymentMethods;
            } else if (typeof sale.paymentMethods === 'string') {
                try {
                    const parsed = JSON.parse(sale.paymentMethods);
                    if (Array.isArray(parsed)) paymentMethodsList = parsed;
                } catch (e) {}
            }
            const isFiado = paymentMethodsList.some(pm => pm && pm.method === 'fiado') || sale.paymentMethod === 'fiado';
            let currentShift = null;
            if (isFiado && sale.customerId) {
                const customer = await Customer.findOne({
                    where: { id: sale.customerId, companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (customer) {
                    const refundAmount = precision.round(totalToRefund, 2);
                    const newBalance = precision.round(precision.subtract(customer.creditBalance || 0, refundAmount), 2);

                    await CreditHistory.create({
                        id: generateRobustId(),
                        userId,
                        companyId,
                        customerId: customer.id,
                        type: 'credit', // Abono por devolución
                        amount: refundAmount,
                        balanceAfter: newBalance,
                        description: `Devolución Factura #${saleId.split('-').pop()}`,
                        saleId: sale.id,
                        timestamp: new Date().toISOString()
                    }, { transaction: t });

                    await customer.update({ creditBalance: newBalance }, { transaction: t });
                }
            } else {
                // Si fue pago en efectivo/digital, registrar movimiento de salida de caja
                currentShift = await CashShift.findOne({
                    where: { userId, status: 'open', companyId },
                    transaction: t
                });

                // Detectar moneda y método del reembolso respetando la venta original
                let refundCurrency = 'USD';
                let refundMethodId = 'cash';
                if (refundData.currency) {
                    refundCurrency = String(refundData.currency).toUpperCase();
                } else if (Array.isArray(refundData.paymentMethods) && refundData.paymentMethods[0]?.currency) {
                    refundCurrency = String(refundData.paymentMethods[0].currency).toUpperCase();
                    refundMethodId = refundData.paymentMethods[0].method || refundMethodId;
                } else if (paymentMethodsList.length > 0) {
                    const firstPm = paymentMethodsList[0];
                    if (firstPm?.currency) {
                        refundCurrency = String(firstPm.currency).toUpperCase();
                    } else if (firstPm?.method && (firstPm.method.includes('ves') || firstPm.method.includes('bs'))) {
                        refundCurrency = 'VES';
                    }
                    refundMethodId = firstPm?.method || refundMethodId;
                } else if (sale.paymentMethod && (sale.paymentMethod.includes('ves') || sale.paymentMethod.includes('bs'))) {
                    refundCurrency = 'VES';
                }

                if (currentShift) {
                    // Validar disponibilidad de efectivo físico en gaveta si aplica
                    const isPhysicalCash = ['cash', 'efectivo', 'cash_usd', 'cash_ves', 'cash_bs'].some(k => refundMethodId.toLowerCase().includes(k));
                    if (isPhysicalCash && !refundData.bypassCashCheck) {
                        const movements = await CashMovement.findAll({
                            where: { shiftId: currentShift.id, companyId },
                            transaction: t
                        });
                        let availableCash = 0;
                        try {
                            const initBreakdown = typeof currentShift.initialBreakdown === 'string'
                                ? JSON.parse(currentShift.initialBreakdown)
                                : (currentShift.initialBreakdown || {});
                            if (refundCurrency === 'VES') {
                                availableCash = Number(initBreakdown.cash_ves || initBreakdown.efectivo_bs || initBreakdown.cash_bs || 0);
                            } else {
                                availableCash = Number(initBreakdown.cash || initBreakdown.cash_usd || initBreakdown.efectivo || currentShift.initialAmount || 0);
                            }
                        } catch (e) {
                            availableCash = Number(currentShift.initialAmount || 0);
                        }

                        for (const m of movements) {
                            if (m.id && m.id.startsWith('OPEN-')) continue;
                            const mCur = (m.currency || 'USD').toUpperCase();
                            if (mCur === refundCurrency) {
                                const amt = Number(m.amount || 0);
                                if (m.type === 'in') availableCash = precision.add([availableCash, amt]);
                                else if (m.type === 'out') availableCash = precision.subtract(availableCash, amt);
                            }
                        }

                        if (availableCash > 0 && totalToRefund > availableCash) {
                            console.warn(`[REFUND-WARNING] Saldo en gaveta (${refundCurrency} ${availableCash}) inferior a la devolución solicitada (${totalToRefund}). Aprobado por supervisor: ${supervisorApprovalId}`);
                        }
                    }

                    const hasExplicitMethod = Boolean(refundData.currency) || (Array.isArray(refundData.paymentMethods) && refundData.paymentMethods.length > 0);
                    const nonFiadoMethods = paymentMethodsList.filter(pm => pm && pm.method !== 'fiado');
                    const saleRate = Number(sale.exchangeRate) || 1;

                    if (!hasExplicitMethod && nonFiadoMethods.length > 1) {
                        // Prorratear proporcionalmente entre los métodos originales de pago mixto
                        const methodsWithUsd = nonFiadoMethods.map(pm => {
                            const pmCur = (pm.currency || ((pm.method && (pm.method.includes('ves') || pm.method.includes('bs'))) ? 'VES' : 'USD')).toUpperCase();
                            const rawAmt = Number(pm.amount || 0);
                            const usdEq = Number(pm.convertedAmountUsd) > 0
                                ? Number(pm.convertedAmountUsd)
                                : ((pmCur === 'VES' || pmCur === 'BS') && saleRate > 0 ? precision.divide(rawAmt, saleRate) : rawAmt);
                            return { method: pm.method || 'cash', currency: pmCur === 'BS' ? 'VES' : pmCur, usdEq };
                        });
                        const totalPaidUsd = methodsWithUsd.reduce((acc, m) => precision.add([acc, m.usdEq]), 0);

                        for (const m of methodsWithUsd) {
                            const ratio = totalPaidUsd > 0 ? (m.usdEq / totalPaidUsd) : (1 / methodsWithUsd.length);
                            const portionUsd = precision.round(precision.multiply(totalToRefund, ratio), 2);
                            if (portionUsd <= 0) continue;
                            const movAmt = m.currency === 'VES'
                                ? precision.round(precision.multiply(portionUsd, saleRate), 2)
                                : portionUsd;

                            await CashMovement.create({
                                id: generateRobustId(),
                                shiftId: currentShift.id,
                                userId,
                                companyId,
                                type: 'out',
                                category: 'REFUND',
                                amount: movAmt,
                                currency: m.currency,
                                paymentMethodId: m.method,
                                reason: `Devolución Venta #${saleId.split('-').pop()} (Prorrateo ${m.method}): ${reason || 'Reembolso'}`,
                                timestamp: new Date().toISOString()
                            }, { transaction: t });
                        }
                    } else {
                        const movementAmount = (refundCurrency === 'VES' || refundCurrency === 'BS')
                            ? precision.round(precision.multiply(totalToRefund, saleRate), 2)
                            : totalToRefund;

                        await CashMovement.create({
                            id: generateRobustId(),
                            shiftId: currentShift.id,
                            userId,
                            companyId,
                            type: 'out',
                            category: 'REFUND',
                            amount: movementAmount,
                            currency: refundCurrency,
                            paymentMethodId: refundMethodId,
                            reason: `Devolución Venta #${saleId.split('-').pop()}: ${reason || 'Reembolso'}`,
                            timestamp: new Date().toISOString()
                        }, { transaction: t });
                    }
                } else {
                    console.warn(`[REFUND-AUDIT] Devolución procesada para la venta ${saleId} sin turno de caja abierto asignado al usuario ${userId}. Se registrará únicamente en auditoría.`);
                }
            }

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
                newValue: JSON.stringify({ refundId: refund.id, amount: totalToRefund }),
                timestamp: new Date().toISOString()
            }, { transaction: t });

            if (approval) {
                await approval.update({ used: true, usedAt: new Date().toISOString() }, { transaction: t });
            }

            await t.commit();

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
