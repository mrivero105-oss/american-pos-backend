const { sequelize, Product, Sale, SaleItem, VarianteProducto, BranchStock, StockMovement, ProductLot, Customer, CreditHistory, Alert } = require('../database/models');
const { Op } = require('sequelize');
const { generateRobustId } = require('../utils/helpers');
const precision = require('../utils/precision');
const LANClusterService = require('../services/LANClusterService');

exports.syncOfflineSales = async (req, res) => {
    const { sales } = req.body;
    if (!sales || !Array.isArray(sales) || sales.length === 0) {
        return res.status(400).json({ error: 'Lista de ventas para sincronización vacía o inválida.' });
    }

    const syncedIds = [];
    const errors = [];
    const allSyncedItems = [];

    for (const localSale of sales) {
        const t = await sequelize.transaction();
        try {
            const saleId = localSale.id ? String(localSale.id) : generateRobustId();
            
            // 1. Verificación de Idempotencia: Si la venta ya existe, omitir sin descontar stock
            const existing = await Sale.findByPk(saleId, { transaction: t });
            if (existing) {
                console.log(`[SYNC-IDEMPOTENCY] Venta ${saleId} ya procesada. Omitiendo duplicado.`);
                await t.commit();
                syncedIds.push(localSale.id);
                continue;
            }

            // 2. Crear registro de venta principal con campos fiscales y tributarios íntegros
            const saleDate = localSale.created_at || localSale.date || new Date().toISOString();
            const cleanTotal = precision.round(Number(localSale.total || 0), 2);
            const cleanSubtotal = precision.round(Number(localSale.subtotal !== undefined ? localSale.subtotal : (localSale.total || 0)), 2);
            const cleanTax = precision.round(Number(localSale.tax || 0), 2);
            const cleanDiscount = precision.round(Number(localSale.discount || 0), 2);
            const cleanIgtf = precision.round(Number(localSale.igtfAmount || localSale.igtf || 0), 2);
            const customerId = localSale.customerId ? String(localSale.customerId) : null;
            const finalCompanyId = req.user?.companyId || localSale.companyId || 'default';
            const finalBranchId = req.user?.activeBranchId || localSale.branchId || null;

            const newSale = await Sale.create({
                id: saleId,
                companyId: finalCompanyId,
                userId: req.user?.id || localSale.userId || '1',
                branchId: finalBranchId,
                registerId: localSale.registerId || '1',
                total: cleanTotal,
                subtotal: cleanSubtotal,
                tax: cleanTax,
                discount: cleanDiscount,
                igtfAmount: cleanIgtf,
                receivedAmount: cleanTotal,
                changeAmount: 0,
                customerId: customerId,
                customerName: localSale.customerName || 'Cliente Ocasional',
                date: saleDate,
                timestamp: saleDate,
                status: 'completed',
                paymentMethod: localSale.paymentMethod || 'cash',
                paymentMethods: localSale.paymentMethods || null,
                offlineId: localSale.id
            }, { transaction: t });

            // 3. Crear detalles de productos (SaleItems)
            if (localSale.items && localSale.items.length > 0) {
                const itemsData = localSale.items.map(i => {
                    const itemQty = Number(i.quantity || 1);
                    const itemPrice = Number(i.precio !== undefined ? i.precio : (i.price || 0));
                    const itemSubtotal = precision.round(precision.multiply(itemPrice, itemQty), 2);
                    return {
                        saleId: newSale.id,
                        productId: String(i.producto_id || i.productId || i.id),
                        quantity: itemQty,
                        price: itemPrice,
                        subtotal: itemSubtotal,
                        name: i.nombre || i.name || 'Producto'
                    };
                });
                await SaleItem.bulkCreate(itemsData, { transaction: t });
            }

            // 4. Descontar inventario únicamente tras la creación exitosa de la venta
            if (localSale.items && Array.isArray(localSale.items)) {
                for (const item of localSale.items) {
                    const prodId = String(item.producto_id || item.productId || item.id);
                    const itemQty = Number(item.quantity || 1);

                    const product = await Product.findOne({
                        where: { id: prodId, companyId: finalCompanyId },
                        transaction: t,
                        lock: t.LOCK.UPDATE
                    });

                    if (product) {
                        const currentStock = Number(product.stockQuantity || product.stock || 0);
                        const isOversell = currentStock < itemQty;
                        let targetStock;

                        if (isOversell && !product.allowNegative) {
                            // Reconciliación Inteligente Offline:
                            // Preserva la realidad de la venta física ya cobrada, ajusta stock a 0 respetando el trigger de DB
                            // y genera alerta de auditoría para reposición inmediata.
                            targetStock = 0;
                        } else {
                            targetStock = precision.round(precision.subtract(currentStock, itemQty), 6);
                        }

                        await product.update({
                            stockQuantity: String(targetStock),
                            stock: null
                        }, { transaction: t });

                        // Deducción de lotes FIFO/FEFO
                        let remainingQtyToDeduct = itemQty;
                        const activeLots = await ProductLot.findAll({
                            where: {
                                productId: prodId,
                                companyId: finalCompanyId,
                                quantity: { [Op.gt]: 0 },
                                status: 'active'
                            },
                            order: [
                                [sequelize.fn('COALESCE', sequelize.col('expirationDate'), '9999-12-31'), 'ASC'],
                                ['createdAt', 'ASC']
                            ],
                            transaction: t,
                            lock: t.LOCK.UPDATE
                        });

                        for (const lot of activeLots) {
                            if (remainingQtyToDeduct <= 0) break;
                            const deductFromLot = Math.min(Number(lot.quantity), remainingQtyToDeduct);
                            const newLotQty = precision.round(Number(lot.quantity) - deductFromLot, 6);
                            await lot.update({
                                quantity: newLotQty,
                                status: newLotQty <= 0 ? 'exhausted' : 'active'
                            }, { transaction: t });
                            remainingQtyToDeduct -= deductFromLot;
                        }

                        const movementReason = isOversell 
                            ? `Venta Offline Sincronizada #${newSale.id} (Alerta de Sobrevención: solicitadas ${itemQty}, quedaban ${currentStock})`
                            : `Venta Sincronizada #${newSale.id}`;

                        await StockMovement.create({
                            id: generateRobustId(),
                            productId: prodId,
                            userId: req.user?.id || localSale.userId || '1',
                            companyId: finalCompanyId,
                            type: 'OUT',
                            quantity: itemQty,
                            stockBefore: String(currentStock),
                            stockAfter: String(targetStock),
                            reason: movementReason,
                            referenceId: newSale.id,
                            date: saleDate
                        }, { transaction: t });

                        // Disparar Alerta de Auditoría en caso de Sobrevención Concurrente
                        if (isOversell) {
                            try {
                                await sequelize.transaction({ transaction: t }, async (sp) => {
                                    await Alert.create({
                                        id: generateRobustId(),
                                        type: 'inventory_risk',
                                        severity: 'high',
                                        message: `Sobrevención Offline en ${product.name}: Se vendieron ${itemQty} unidades cuando solo quedaban ${currentStock} durante desconexión.`,
                                        companyId: finalCompanyId,
                                        resolved: false
                                    }, { transaction: sp });
                                });
                            } catch (alertErr) {
                                console.warn('[SyncController] No se pudo registrar alerta de sobreventa:', alertErr.message);
                            }
                        }
                    }

                    // Descontar inventario de sucursal si aplica
                    if (finalBranchId) {
                        const bs = await BranchStock.findOne({
                            where: { productId: prodId, branchId: finalBranchId, companyId: finalCompanyId },
                            transaction: t
                        });
                        if (bs) {
                            const currentBsStock = Number(bs.quantity || 0);
                            const newBsStock = precision.round(precision.subtract(currentBsStock, itemQty), 6);
                            await bs.update({ quantity: newBsStock }, { transaction: t });
                        }
                    }

                    if (item.variante_id) {
                        const variant = await VarianteProducto.findOne({
                            where: { id: String(item.variante_id) },
                            transaction: t,
                            lock: t.LOCK.UPDATE
                        });
                        if (variant) {
                            const currentVarStock = Number(variant.stock || 0);
                            const newVarStock = precision.round(precision.subtract(currentVarStock, itemQty), 6);
                            await variant.update({ stock: newVarStock }, { transaction: t });
                        }
                    }
                }
            }

            // 5. Conciliación de crédito / fiado offline
            let paymentMethodsList = [];
            if (Array.isArray(localSale.paymentMethods)) {
                paymentMethodsList = localSale.paymentMethods;
            } else if (typeof localSale.paymentMethods === 'string') {
                try {
                    const parsed = JSON.parse(localSale.paymentMethods);
                    if (Array.isArray(parsed)) paymentMethodsList = parsed;
                } catch (e) {}
            }

            const isFiado = localSale.paymentMethod === 'fiado' || paymentMethodsList.some(pm => pm && (pm.method === 'fiado' || pm.method === 'credit'));
            if (isFiado && (customerId || localSale.customerName)) {
                let customer = null;
                if (customerId) {
                    customer = await Customer.findOne({
                        where: { id: customerId, companyId: finalCompanyId },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                } else if (localSale.customerName) {
                    const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
                    customer = await Customer.findOne({
                        where: { name: { [likeOp]: String(localSale.customerName).trim() }, companyId: finalCompanyId },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                }

                if (customer) {
                    let creditAmount = cleanTotal;
                    if (paymentMethodsList.length > 0) {
                        const fiadoMethods = paymentMethodsList.filter(pm => pm && (pm.method === 'fiado' || pm.method === 'credit'));
                        if (fiadoMethods.length > 0) {
                            creditAmount = fiadoMethods.reduce((acc, pm) => precision.add([acc, Number(pm.amount || 0)]), 0);
                        }
                    }
                    const roundedCredit = precision.round(creditAmount, 2);
                    const currentBal = Number(customer.creditBalance || 0);
                    const newBalance = precision.round(precision.add([currentBal, roundedCredit]), 2);

                    await CreditHistory.create({
                        id: generateRobustId(),
                        userId: req.user?.id || localSale.userId || '1',
                        companyId: finalCompanyId,
                        customerId: customer.id,
                        type: 'charge',
                        amount: roundedCredit,
                        balanceAfter: newBalance,
                        description: `Factura Offline Sincronizada #${newSale.id.slice(-6).toUpperCase()}`,
                        paymentMethod: 'fiado',
                        saleId: newSale.id,
                        timestamp: saleDate
                    }, { transaction: t });

                    await customer.update({ creditBalance: newBalance }, { transaction: t });
                }
            }

            // Puntos de lealtad offline
            if (customerId) {
                const pointsToAward = precision.divide(cleanTotal, 10);
                if (pointsToAward > 0) {
                    await Customer.increment('loyaltyPoints', {
                        by: pointsToAward,
                        where: { id: String(customerId), companyId: finalCompanyId },
                        transaction: t
                    });
                }
            }

            await t.commit();
            syncedIds.push(localSale.id);
            if (Array.isArray(localSale.items)) {
                allSyncedItems.push(...localSale.items);
            }
        } catch (itemErr) {
            await t.rollback();
            console.error(`Error procesando venta offline ID ${localSale.id}:`, itemErr);
            errors.push({ id: localSale.id, error: itemErr.message });
        }
    }

    // Propagate stock deduction events to all LAN peers instantly
    try {
        if (allSyncedItems.length > 0) {
            LANClusterService.broadcastLANEvent('lan_stock_update', { items: allSyncedItems, timestamp: Date.now() });
        }
    } catch (lanErr) {
        console.warn('[SyncController] Aviso difundiendo actualización de stock LAN:', lanErr.message);
    }

    return res.json({ success: true, syncedIds, errors });
};
