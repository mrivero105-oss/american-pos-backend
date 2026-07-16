const { Sale, SaleItem, Product, ProductLot, BranchStock, StockMovement, AuditLog, Customer, CreditHistory, SupervisorApproval, VarianteProducto } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, getUserSettings, readJson, readJsonAsync } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const { Op, Transaction } = require('sequelize');
const precision = require('../utils/precision');
const cache = require('../utils/cacheService');

const inFlightTransactions = new Set();

class SaleService {
    async getSaleDetails(companyId, saleId, role) {
        const where = { id: String(saleId) };
        // IDOR FIX: Always enforce companyId
        where.companyId = String(companyId);
        return await Sale.findOne({
            where,
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });
    }

    /**
     * Process a complete sale transaction with financial-grade integrity.
     */
    async processSale(reqUser, saleData, options = {}) {
        const companyId = String(reqUser.companyId);
        const userId = String(reqUser.id);
                const userBranchId = String(reqUser.activeBranchId || '1');

        // 1. VERIFICAR CLIENT_TRANSACTION_ID & IDEMPOTENCY LOCK
        const clientTransactionId = saleData.clientTransactionId || saleData.id || generateRobustId();
        saleData.clientTransactionId = clientTransactionId;
        saleData.id = clientTransactionId;

        // 1A. Verificación Persistente en DB (A prueba de caídas o reinicios del servidor Node.js)
        const existingSale = await Sale.findByPk(clientTransactionId, { include: [{ model: SaleItem, as: 'SaleItems' }] });
        if (existingSale) {
            console.warn(`[Idempotency] Venta ya persistida en DB interceptada exitosamente: ${clientTransactionId}`);
            return existingSale;
        }

        // 1B. Verificación en Memoria Volátil (Rebote rápido de UI en milisegundos)
        if (inFlightTransactions.has(clientTransactionId)) {
            console.warn(`[Idempotency] Rebote de UI o doble clic interceptado en memoria para TX: ${clientTransactionId}`);
            throw new Error(`TRANSACCION_DUPLICADA: La venta ${clientTransactionId} ya está en curso.`);
        }
        inFlightTransactions.add(clientTransactionId);
        setTimeout(() => inFlightTransactions.delete(clientTransactionId), 10000);

        const { items, customerId, total, discount, receivedAmount, changeAmount, branchId: clientBranchId } = saleData;
        
        let branchId = null;
        const rawBranchId = clientBranchId || userBranchId;
        if (rawBranchId && String(rawBranchId) !== 'undefined' && String(rawBranchId) !== 'null' && String(rawBranchId) !== '1') {
            branchId = String(rawBranchId);
        }

        // Verify branch actually exists to prevent FOREIGN KEY constraint errors
        let dbBranch = null;
        if (branchId) {
            dbBranch = await sequelize.models.Branch.findOne({ where: { id: branchId, companyId } });
        }
        if (!dbBranch) {
            dbBranch = await sequelize.models.Branch.findOne({ where: { companyId } });
        }
        if (!dbBranch) {
            dbBranch = await sequelize.models.Branch.create({
                id: generateRobustId(),
                userId,
                companyId,
                name: 'Principal',
                isMain: true,
                isActive: true
            });
        }
        branchId = dbBranch.id;

        if (!items || !items.length) {
            throw new Error('INTEGRITY_ERROR: No se pueden procesar ventas sin productos.');
        }

        // 2. INTEGRITY CHECK & ZERO-TRUST PRICE RECALCULATION
        const itemIds = items.map(i => String(i.productId || i.id)).filter(Boolean);
        const dbProducts = await Product.findAll({ where: { id: itemIds, companyId } });
        const dbProductMap = new Map(dbProducts.map(p => [String(p.id), p]));

        let serverCalculatedSubtotal = 0;
        for (const item of items) {
            const itemQty = Number(item.quantity) || 0;
            if (itemQty <= 0) throw new Error(`INTEGRITY_ERROR: Cantidad inválida para producto: ${item.name}`);
            
            const prodId = String(item.productId || item.id);
            const dbProd = dbProductMap.get(prodId);
            const itemPrice = dbProd ? (Number(dbProd.price) || 0) : (Number(item.price) || 0);
            
            const itemSubtotal = precision.multiply(itemPrice, itemQty);
            console.log(`[ZERO-TRUST CALC] Item: ${item.name}, DB Price: ${itemPrice}, Qty: ${itemQty}, Subtotal: ${itemSubtotal}`);
            serverCalculatedSubtotal = precision.add([serverCalculatedSubtotal, itemSubtotal]);
        }

        const discountValue = Number(discount) || 0;
        const settings = await this._getSettings(companyId);
        let recalculatedIgtf = 0;
        
        // --- REGLA DE NEGOCIO: AUTORIZACIÓN DE DESCUENTO ---
        if (discountValue > (serverCalculatedSubtotal * 0.10)) {
            if (!saleData.supervisorApprovalId) {
                throw new Error('AUTH_REQUIRED: Los descuentos mayores al 10% requieren la aprobación de un supervisor.');
            }
            const approval = await SupervisorApproval.findOne({
                where: { id: saleData.supervisorApprovalId, companyId }
            });
            if (!approval) {
                throw new Error('AUTH_REQUIRED: La aprobación de supervisor provista es inválida o no existe.');
            }
        }

        const exchangeRate = Number(settings.exchangeRate) || 1.0;
        console.log(`[SALE-CALC] Subtotal: ${serverCalculatedSubtotal}, Discount: ${discountValue}, Rate: ${exchangeRate}`);

        const foreignCurrencyPayments = (saleData.paymentMethods || []).filter(p => {
            const pmCurrency = (p.currency || '').toUpperCase();
            return (pmCurrency ? pmCurrency === 'USD' : !p.method.includes('_bs')) && p.method !== 'zelle' && p.method !== 'fiado';
        });
        const totalUsdTendered = foreignCurrencyPayments.reduce((sum, p) => precision.add([sum, Number(p.amount) || 0]), 0);

        if (totalUsdTendered > 0 && settings.igtfEnabled) {
            const igtfRate = Number(settings.igtfRate || 3);
            const requiredPrincipal = precision.subtract(serverCalculatedSubtotal, discountValue);
            const maxUsableFromTendered = precision.divide(totalUsdTendered, 1 + (igtfRate / 100));
            const appliedPrincipal = Math.min(requiredPrincipal, maxUsableFromTendered);
            recalculatedIgtf = precision.round(precision.multiply(appliedPrincipal, igtfRate / 100));
        }

        const serverCalculatedTotalExact = precision.add([
            precision.subtract(serverCalculatedSubtotal, discountValue),
            recalculatedIgtf
        ]);
        const serverCalculatedTotalRounded = precision.round(serverCalculatedTotalExact, 2);
        const saleTotal = Number(total) || 0;
        console.log(`[SALE-CALC] Final Total Exact: ${serverCalculatedTotalExact}, Rounded: ${serverCalculatedTotalRounded}, Received: ${saleTotal}`);

        // Tolerancia Inteligente (Zero-Trust Integrity Check)
        // Aceptamos coincidencia exacta de VortexMathEngine o coincidencia redondeada a 2 decimales, o diferencia menor a 0.05 por conversiones de divisas/IGTF.
        const diffExact = Math.abs(precision.subtract(serverCalculatedTotalExact, saleTotal));
        const diffRounded = Math.abs(precision.subtract(serverCalculatedTotalRounded, saleTotal));
        const minDiff = Math.min(diffExact, diffRounded);

        if (minDiff > 0.05 && !options.forceOverridePrice) {
            console.warn(`[ZERO-TRUST INTEGRITY] Total mismatch: Server Exact ${serverCalculatedTotalExact} / Rounded ${serverCalculatedTotalRounded} vs Client ${saleTotal}. Diff: ${minDiff}`);
            throw new Error(`INTEGRITY_ERROR: El total calculado por el servidor (${serverCalculatedTotalRounded}) no coincide con el recibido (${saleTotal}). Diferencia: ${minDiff}`);
        }

        // Usamos el total que sea consistente o del cliente
        const serverCalculatedTotal = minDiff <= 0.05 ? saleTotal : serverCalculatedTotalRounded;

        // 3. NORMALIZE PAYMENTS & CREDIT CHECK
        const normalizedPayments = this._normalizePayments(saleData, saleTotal, exchangeRate);
        const creditTotal = precision.add(
            normalizedPayments
                .filter(p => p.method === 'fiado')
                .map(p => Number(p.amount) || 0)
        );

        if (creditTotal > 0 && !customerId && !saleData.customerName) {
            throw new Error('INTEGRITY_ERROR: Debe seleccionar un cliente para procesar una venta a crédito (Fiado).');
        }

        const saleDate = saleData.date || saleData.timestamp || new Date().toISOString();
        const now = saleDate;
        let saleRecord = null;

        // --- BEGIN TRANSACTION (EXCLUSIVE FOR STRICT RACE CONDITION PREVENTION) ---
        const t = await sequelize.transaction({ type: Transaction.TYPES.EXCLUSIVE });

        try {
            // 4. CREACIÓN EN ESTADO PENDING (GARANTÍA DE IDEMPOTENCIA POR DB)
            const saleRecordData = {
                id: clientTransactionId,
                companyId,
                userId,
                customerId: customerId ? String(customerId) : null,
                branchId,
                paymentMethod: normalizedPayments[0]?.method || saleData.paymentMethod || 'cash',
                paymentMethods: normalizedPayments,
                total: serverCalculatedTotal,
                subtotal: serverCalculatedSubtotal,
                tax: Number(saleData.tax) || 0,
                discount: discountValue,
                receivedAmount: Number(receivedAmount) || 0,
                changeAmount: Number(changeAmount) || 0,
                igtfAmount: recalculatedIgtf,
                taxInfo: saleData.taxInfo || {},
                date: saleDate,
                timestamp: saleDate,
                exchangeRate,
                documentType: saleData.documentType || 'factura',
                customerName: saleData.customerName || 'Cliente Ocasional',
                paymentStatus: creditTotal > 0 ? 'pending' : 'paid',
                status: 'pending', // <--- ESTADO INICIAL SEGURO
                registerId: saleData.registerId || '1',
                registerName: saleData.registerName || saleData.registerDisplayName || 'Caja Principal'
            };

            try {
                saleRecord = await Sale.create(saleRecordData, { transaction: t });
            } catch (createError) {
                // Si la DB lanza error de clave duplicada, significa que la venta YA fue procesada
                if (createError.name === 'SequelizeUniqueConstraintError' || createError.message.includes('UNIQUE constraint failed')) {
                    await t.rollback();
                    console.warn(`[Idempotency] Request duplicado interceptado para TX: ${clientTransactionId}`);
                    return await Sale.findByPk(clientTransactionId, { include: [{ model: SaleItem, as: 'SaleItems' }] });
                }
                throw createError; // Si es otro error de DB, lo dejamos subir
            }

            // 5. PROCESAR INVENTARIO (CON ROW-LEVEL LOCKING)
            for (const item of items) {
                const pId = String(item.productId || item.id);
                if (!pId || pId === 'undefined' || (pId === 'null' && !item.isCustom)) continue;

                let cost = Number(item.cost) || 0;
                let category = item.category || 'General';
                let product = null;

                if (!item.isCustom && pId) {
                    product = await Product.findOne({
                        where: { id: pId, companyId },
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                        transaction: t
                    });

                    // SI EL PRODUCTO FUE BORRADO MIENTRAS ESTABA EN EL CARRITO, ABORTAR
                    if (!product) {
                        if (options.bypassStockCheck) {
                            console.warn(`[SYNC-INTEGRITY] Producto "${item.name}" (ID: ${pId}) no existe en el catálogo de la PC. Se procesa como personalizado en caliente para no bloquear la sincronización.`);
                            cost = Number(item.cost) || 0;
                            category = item.category || category;
                        } else {
                            throw new Error(`INTEGRITY_ERROR: Producto no encontrado o inactivo (${item.name}). Venta abortada.`);
                        }
                    }
                }

                if (product) {
                    cost = Number(product.cost) || 0;
                    category = product.category || category;

                    const itemQty = Number(item.quantity) || 0;
                    const previousStock = Number(product.stockQuantity || 0);
                    const newStock = precision.round(previousStock - itemQty, 6);

                    // VALIDACIÓN FÍSICA ESTRICTA
                    if (newStock < 0) {
                        if (!product.allowNegative && !options.bypassStockCheck) {
                            throw new Error(`STOCK_ERROR: Inventario insuficiente para "${product.name}". Disponible: ${previousStock}`);
                        } else if (options.bypassStockCheck) {
                            console.warn(`[SYNC-WARNING] Venta offline procesada con inventario negativo para "${product.name}". Stock actualizado: ${newStock}`);
                        }
                    }

                    // --- INICIO LÓGICA DE LOTES FIFO ---
                    let remainingQtyToDeduct = itemQty;
                    const activeLots = await ProductLot.findAll({
                        where: { 
                            productId: pId, 
                            companyId, 
                            quantity: { [Op.gt]: 0 }, 
                            status: 'active' 
                        },
                        order: [
                            [sequelize.fn('IFNULL', sequelize.col('expirationDate'), '9999-12-31'), 'ASC'],
                            ['createdAt', 'ASC']
                        ],
                        transaction: t,
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE
                    });

                    for (const lot of activeLots) {
                        if (remainingQtyToDeduct <= 0) break;
                        const deductFromLot = Math.min(Number(lot.quantity), remainingQtyToDeduct);
                        const newLotQty = Number(lot.quantity) - deductFromLot;
                        
                        await lot.update({ 
                            quantity: newLotQty,
                            status: newLotQty <= 0 ? 'exhausted' : 'active' 
                        }, { transaction: t });

                        remainingQtyToDeduct -= deductFromLot;
                    }
                    // --- FIN LÓGICA DE LOTES FIFO ---

                    // DEDUCCIÓN EN SUCURSAL CON TRACKING DE STOCK (KARDEX)
                    if (branchId) {
                        let branchStock, created;
                        try {
                            [branchStock, created] = await BranchStock.findOrCreate({
                                where: { productId: pId, branchId, companyId },
                                defaults: { quantity: Number(product.stockQuantity) || 0 },
                                transaction: t,
                                lock: t.LOCK.UPDATE
                            });
                        } catch (err) {
                            if (err.name === 'SequelizeForeignKeyConstraintError' || (err.message && err.message.includes('FOREIGN KEY'))) {
                                try { await t.rollback(); } catch(e){} // Explicit rollback to release locks immediately
                                throw new Error(`INTEGRITY_ERROR: Producto "${product.name}" o Sucursal no encontrados (Falla de Integridad).`);
                            }
                            throw err;
                        }

                        const stockBefore = Number(branchStock.quantity) || 0;
                        const stockAfter = precision.subtract(stockBefore, itemQty);

                        if (stockAfter < 0) {
                            if (!product.allowNegative && !options.bypassStockCheck) {
                                throw new Error(`STOCK_ERROR: Inventario de sucursal insuficiente para "${product.name}". Disponible: ${stockBefore}`);
                            } else if (options.bypassStockCheck) {
                                console.warn(`[SYNC-WARNING] Venta offline procesada con inventario de sucursal negativo para "${product.name}". Stock actualizado: ${stockAfter}`);
                            }
                        }

                        await branchStock.decrement('quantity', { by: itemQty, transaction: t });
                        await product.decrement('stockQuantity', { by: itemQty, transaction: t });

                        // KARDEX INMUTABLE (TRACKING DETALLADO)
                        await StockMovement.create({
                            id: generateRobustId(),
                            productId: pId,
                            userId,
                            companyId,
                            type: 'OUT',
                            quantity: itemQty,
                            stockBefore,
                            stockAfter,
                            reason: `Venta #${saleRecord.id.split('-').pop()}`,
                            referenceId: saleRecord.id,
                            date: now,
                            timestamp: now
                        }, { transaction: t });
                    } else {
                        // Si no hay branchId (fallback global), al menos descontar del producto
                        await product.decrement('stockQuantity', { by: itemQty, transaction: t });
                    }

                    if (item.variante_id || item.variantId) {
                        const varId = String(item.variante_id || item.variantId);
                        const variant = await VarianteProducto.findByPk(varId, { transaction: t, lock: t.LOCK.UPDATE });
                        if (variant) {
                            await variant.decrement('stock', { by: itemQty, transaction: t });
                        }
                    }
                }

                const itemPrice = Number(item.price !== undefined ? item.price : (item.precio || 0));
                const itemQty = Number(item.quantity || 1);
                await SaleItem.create({
                    saleId: clientTransactionId,
                    productId: pId || `manual-${Date.now()}`,
                    name: item.name || item.nombre || 'Producto',
                    quantity: itemQty,
                    price: itemPrice,
                    cost,
                    subtotal: precision.multiply(itemQty, itemPrice),
                    category,
                    companyId,
                    batchNumber: product ? product.batchNumber : (item.batchNumber || null),
                    expirationDate: product ? product.expirationDate : (item.expirationDate || null),
                    es_controlado: Boolean((product && product.es_controlado) || item.es_controlado),
                    recipe: item.recipe ? (typeof item.recipe === 'object' ? JSON.stringify(item.recipe) : String(item.recipe)) : null
                }, { transaction: t });
            }

            // 6. PROCESAR CRÉDITO / FIADO EN EL LEDGER
            if (creditTotal > 0) {
                let customer;
                if (customerId) {
                    customer = await Customer.findOne({
                        where: { id: String(customerId), companyId },
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                        transaction: t
                    });
                } else if (saleData.customerName) {
                    customer = await Customer.findOne({
                        where: { name: { [Op.iLike]: String(saleData.customerName).trim() }, companyId },
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                        transaction: t
                    });
                }

                if (!customer) {
                    throw new Error(`CREDIT_ERROR: Cliente no encontrado en la base de datos.`);
                }

                const creditLimit = Number(customer.creditLimit) || 0;
                const currentBalance = Number(customer.creditBalance) || 0;
                const available = precision.round(precision.subtract(creditLimit, currentBalance), 6);

                if (creditLimit <= 0 && !options.bypassCreditLimit) {
                    throw new Error(`CREDIT_ERROR: El cliente "${customer.name}" no tiene límite de crédito asignado.`);
                }
                if (creditTotal > available && !options.bypassCreditLimit) {
                    throw new Error(`CREDIT_ERROR: Crédito insuficiente para "${customer.name}". Disponible: ${available.toFixed(2)}`);
                }

                const roundedAmount = precision.round(creditTotal, 2);
                const newBalance = precision.round(precision.add([currentBalance, roundedAmount]), 2);

                // LEDGER FINANCIERO (VERDAD ABSOLUTA)
                await CreditHistory.create({
                    id: generateRobustId(),
                    userId,
                    companyId,
                    customerId: customer.id,
                    type: 'charge', // <-- CLASIFICACIÓN CONTABLE
                    amount: roundedAmount,
                    balanceAfter: newBalance,
                    description: `Factura #CAJA${saleRecordData.registerId}-${clientTransactionId.slice(-6).toUpperCase()}`,
                    paymentMethod: 'fiado',
                    saleId: clientTransactionId,
                    timestamp: now
                }, { transaction: t });

                // CACHÉ DE BALANCE
                customer.creditBalance = newBalance;
                await customer.save({ transaction: t });
            }

            // 7. PUNTOS DE LEALTAD
            if (customerId) {
                const pointsToAward = precision.divide(saleTotal, 10);
                if (pointsToAward > 0) {
                    await Customer.increment('loyaltyPoints', {
                        by: pointsToAward,
                        where: { id: String(customerId), companyId },
                        transaction: t
                    });
                }
            }

            // 8. MARCAR COMO COMPLETED (ÉXITO TOTAL)
            saleRecord.status = 'completed';
            await saleRecord.save({ transaction: t });

            // 9. COMMIT FINANCIERO FINAL
            await t.commit();

            // Auditoría post-commit
            this._logAudit(reqUser, 'CREATE_SALE', `Venta completada: ${clientTransactionId}`, clientTransactionId, null, { total: saleTotal }).catch(() => {});

            // INTEGRACIÓN SRI ECUADOR: Procesar comprobante electrónico asíncronamente
            const bizCountry = settings.businessInfo?.country || settings.country || '';
            if (bizCountry.toLowerCase() === 'ecuador') {
                try {
                    const SriService = require('./SriService');
                    SriService.processInvoice(saleRecord, settings).catch(sriErr => {
                        console.error('[SaleService] Error en procesamiento asíncrono SRI:', sriErr);
                    });
                } catch (sriReqErr) {
                    console.error('[SaleService] No se pudo instanciar SriService:', sriReqErr);
                }
            }

            return await Sale.findOne({
                where: { id: clientTransactionId },
                include: [{ model: SaleItem, as: 'SaleItems' }]
            });

        } catch (error) {
            // ROLLBACK GARANTIZADO
            try { await t.rollback(); } catch(e) {}
            
            console.error(`[TX-ROLLBACK] Transacción fallida ${clientTransactionId}:`, error.message);
            
            // Si la venta logró insertarse pero falló después (ej: error de stock),
            // actualizamos su status a 'failed' fuera de la transacción revertida.
            if (saleRecord && saleRecord.id) {
                try {
                    await Sale.update(
                        { status: 'failed' }, 
                        { where: { id: clientTransactionId, companyId } }
                    );
                } catch (updateErr) {
                    console.error('[SaleService] No se pudo marcar venta como failed en DB:', updateErr.message);
                }
            }

            throw error; // Propagar error al frontend
        }
    }

    /**
     * Payment Normalization (USD/VES).
     */
    _normalizePayments(saleData, saleTotal, exchangeRate) {
        if (saleData.paymentMethods?.length > 0) return saleData.paymentMethods;

        const { amountTenderedUsd = 0, amountTenderedVes = 0, paymentMethod = 'cash' } = saleData;
        const tenderedUsd = Number(amountTenderedUsd);
        const tenderedVes = Number(amountTenderedVes);

        if (tenderedUsd === 0 && tenderedVes === 0) {
            return [{ method: paymentMethod, amount: saleTotal, currency: 'USD' }];
        }

        const normalized = [];
        if (tenderedVes > 0) {
            const tenderedVesInUsd = precision.normalizeToUsd(tenderedVes, exchangeRate);
            normalized.push({ 
                method: paymentMethod + '_bs', 
                amount: precision.round(tenderedVes, 2), 
                currency: 'VES', 
                convertedAmountUsd: tenderedVesInUsd 
            });
        }
        if (tenderedUsd > 0) {
            normalized.push({ 
                method: paymentMethod, 
                amount: precision.round(tenderedUsd, 2), 
                currency: 'USD' 
            });
        }

        return normalized.length > 0 ? normalized : [{ method: paymentMethod, amount: saleTotal, currency: 'USD' }];
    }

    async updateOrphanSaleCustomer(saleId, customerId, customerName) {
        return await Sale.update(
            { 
                customerId: customerId ? String(customerId) : null, 
                customerName: customerName || 'Cliente Ocasional' 
            },
            { where: { id: String(saleId) } }
        );
    }

    async _getSettings(companyId) {
        let settings = cache.get('all_settings');
        if (!settings) {
            settings = await readJsonAsync(SETTINGS_FILE);
            cache.set('all_settings', settings, 3600);
        }
        return getUserSettings(settings, companyId);
    }

    async _logAudit(reqUser, action, description, entityId, oldVal, newVal) {
        try {
            await AuditLog.create({
                id: generateRobustId(),
                userId: reqUser.id,
                companyId: reqUser.companyId,
                action,
                description,
                entityId,
                oldValue: oldVal ? JSON.stringify(oldVal) : null,
                newValue: newVal ? JSON.stringify(newVal) : null,
                timestamp: new Date().toISOString()
            });
        } catch (e) { }
    }
}

module.exports = new SaleService();
