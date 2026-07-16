const { Refund, Sale, SaleItem, Product, BranchStock, StockMovement, AuditLog, Customer, CreditHistory, CashShift, CashMovement, Branch, ProductLot } = require('../database/models');
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

        // 1. VALIDAR VENTA ORIGINAL
        const sale = await Sale.findOne({
            where: { id: saleId, companyId },
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });

        if (!sale) throw new Error('Venta no encontrada.');
        if (sale.status === 'refunded') throw new Error('Esta venta ya fue devuelta en su totalidad.');

        // --- REGLA DE NEGOCIO: AUTORIZACIÓN DE DEVOLUCIONES ---
        if (!supervisorApprovalId) {
            throw new Error('AUTH_REQUIRED: Todas las devoluciones requieren la aprobación de un supervisor.');
        }

        // 2. VALIDAR CANTIDADES Y MONTOS (INTEGER MATH)
        let totalToRefund = 0;
        const itemsToProcess = [];

        for (const item of items) {
            const originalItem = sale.SaleItems.find(si => si.productId === item.productId || si.id === item.productId);
            if (!originalItem) throw new Error(`El producto ${item.name} no pertenece a esta venta.`);
            
            if (item.quantity > originalItem.quantity) {
                throw new Error(`Cantidad a devolver (${item.quantity}) mayor a la vendida (${originalItem.quantity}).`);
            }

            const itemRefundAmount = precision.multiply(item.price, item.quantity);
            totalToRefund = precision.add([totalToRefund, itemRefundAmount]);
            itemsToProcess.push({ ...item, originalItem });
        }

        // 3. INICIAR TRANSACCIÓN ATÓMICA
        const t = await sequelize.transaction();

        try {
            // 4. CREAR REGISTRO DE DEVOLUCIÓN
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

            // 5. REVERTIR STOCK E INVENTARIO
            for (const item of itemsToProcess) {
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

                            const stockBefore = Number(branchStock.quantity) || 0;
                            const stockAfter = precision.add([stockBefore, item.quantity]);

                            await branchStock.increment('quantity', { by: item.quantity, transaction: t });
                            await product.increment('stockQuantity', { by: item.quantity, transaction: t });

                            await StockMovement.create({
                                id: generateRobustId(),
                                productId: product.id,
                                userId,
                                companyId,
                                type: 'IN',
                                quantity: item.quantity,
                                stockBefore,
                                stockAfter,
                                reason: `Devolución Venta #${saleId.split('-').pop()}`,
                                referenceId: refund.id,
                                timestamp: new Date()
                            }, { transaction: t });
                        }
                    }
                }
            }

            // 6. REVERTIR LEDGER (DINERO)
            // Si hubo crédito (Fiado), reducir la deuda del cliente
            const isFiado = sale.paymentMethods.some(pm => pm.method === 'fiado');
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
                        timestamp: new Date()
                    }, { transaction: t });

                    await customer.update({ creditBalance: newBalance }, { transaction: t });
                }
            } else {
                // Si fue pago en efectivo/digital, registrar movimiento de salida de caja
                const currentShift = await CashShift.findOne({
                    where: { userId, status: 'open', companyId },
                    transaction: t
                });

                if (currentShift) {
                    await CashMovement.create({
                        id: generateRobustId(),
                        shiftId: currentShift.id,
                        userId,
                        companyId,
                        type: 'out',
                        amount: totalToRefund,
                        reason: `Devolución Sug: ${saleId.split('-').pop()}`,
                        timestamp: new Date()
                    }, { transaction: t });
                }
            }

            // 7. ACTUALIZAR ESTADO DE LA VENTA
            // Si se devolvió todo el monto, marcar como refunded
            const newSaleStatus = precision.subtract(sale.total, totalToRefund) <= 0.01 ? 'refunded' : 'partially_refunded';
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

            await t.commit();
            return refund;

        } catch (error) {
            await t.rollback();
            throw error;
        }
    }
}

module.exports = new RefundService();
