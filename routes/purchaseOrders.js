const express = require('express');
const router = express.Router();
const { PurchaseOrder, Product, StockMovement, BranchStock } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { verifyToken, isSuperAdmin } = require('../middleware/auth');

router.get('/', async (req, res) => {
    try {
        const { page, limit } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;
        const offset = (pageNum - 1) * limitNum;

        const totalItems = await PurchaseOrder.count({ where: { companyId: req.user.companyId } });
        const totalPages = Math.ceil(totalItems / limitNum);

        const orders = await PurchaseOrder.findAll({
            where: { companyId: req.user.companyId },
            limit: limitNum,
            offset: offset,
            order: [['createdAt', 'DESC']]
        });

        if (page) {
            return res.json({
                data: orders,
                pagination: {
                    totalItems,
                    totalPages,
                    currentPage: pageNum,
                    limit: limitNum
                }
            });
        } else {
            return res.json(orders);
        }
    } catch (error) {
        console.error('Get purchase orders error:', error);
        res.status(500).json({ error: 'Error al obtener órdenes de compra' });
    }
});

// Logic for receiving an order (updating stock, costs, audit, and supplier balance)
async function processOrderReception(orderId, userId, activeBranchId, t) {
    const order = await PurchaseOrder.findOne({
        where: { id: orderId, status: 'pending' },
        transaction: t
    });

    if (!order) {
        throw new Error('Orden no encontrada o ya procesada');
    }

    const items = JSON.parse(order.items || '[]');

    for (const item of items) {
        const product = await Product.findOne({
            where: { id: item.productId, companyId: order.companyId || 'default' },
            transaction: t
        });

        if (product) {
            // Always update the cost based on the new purchase (most recent price becomes base cost)
            await product.update({ cost: item.cost }, { transaction: t });

            if (activeBranchId) {
                // Receive into Branch Stock
                let branchStock = await BranchStock.findOne({ where: { productId: item.productId, branchId: activeBranchId }, transaction: t });
                if (branchStock) {
                    await branchStock.update({ quantity: branchStock.quantity + Number(item.quantity) }, { transaction: t });
                } else {
                    await BranchStock.create({ branchId: activeBranchId, productId: item.productId, quantity: Number(item.quantity) }, { transaction: t });
                }
            } else {
                // Receive globally (Legacy fallback)
                const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                await product.update({ stockQuantity: currentStock + Number(item.quantity) }, { transaction: t });
            }

            // Log Movement (Kardex)
            await StockMovement.create({
                id: generateRobustId(),
                productId: item.productId,
                userId: userId,
                type: 'IN',
                quantity: Number(item.quantity),
                reason: activeBranchId ? `Purchase Receiving (Branch ${activeBranchId})` : 'Purchase Receiving',
                referenceId: order.id,
                date: new Date().toISOString()
            }, { transaction: t });
        }
    }

    await order.update({ status: 'received', receivedAt: new Date().toISOString() }, { transaction: t });

    // Audit Log
    const { AuditLog } = require('../database/models');
    await AuditLog.create({
        id: generateRobustId(),
        userId: userId,
        companyId: order.companyId,
        action: 'PURCHASE_RECEIVE',
        description: `Recibida orden/albarán #${order.id}. Ref: ${order.referenceNumber || 'N/A'}. Total: $${order.total}`,
        timestamp: new Date().toISOString()
    }, { transaction: t });

    // Update Supplier Balance if credit
    if (order.paymentMethod === 'credit' || order.paymentStatus === 'unpaid') {
        const supplier = await require('../database/models').Supplier.findOne({ where: { id: order.supplierId }, transaction: t });
        if (supplier) {
            const newBalance = (supplier.creditBalance || 0) + order.total;
            await supplier.update({ creditBalance: newBalance }, { transaction: t });

            await require('../database/models').SupplierCreditHistory.create({
                id: generateRobustId(),
                supplierId: order.supplierId,
                userId: userId,
                companyId: order.companyId,
                timestamp: new Date().toISOString(),
                type: 'charge',
                amount: order.total,
                balanceAfter: newBalance,
                description: `Recepción Albarán #${order.referenceNumber || order.id}`,
                purchaseOrderId: order.id
            }, { transaction: t });
        }
    } else {
        // If PAID at reception, deduct from cash shift directly (no credit history)
        const { CashShift, CashMovement } = require('../database/models');
        const currentShift = await CashShift.findOne({
            where: { companyId: order.companyId, status: 'open' },
            order: [['openedAt', 'DESC']],
            transaction: t
        });
        if (currentShift) {
            await CashMovement.create({
                id: generateRobustId(),
                shiftId: currentShift.id,
                userId: userId,
                companyId: order.companyId,
                type: 'out',
                amount: parseFloat(order.total),
                currency: 'USD',
                paymentMethodId: 'cash',
                category: 'PURCHASE',
                reason: `Pago contado Albarán #${order.referenceNumber || order.id}`,
                timestamp: new Date().toISOString()
            }, { transaction: t });
        }
    }
}

router.post('/', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { supplierId, items, expectedDate, notes, total, referenceNumber, status, paymentStatus } = req.body;
        const newOrder = await PurchaseOrder.create({
            id: generateRobustId(),
            userId: req.user.id,
            companyId: req.user.companyId,
            status: 'pending', // Create as pending first to allow processOrderReception to work
            supplierId,
            items,
            expectedDate,
            notes,
            total,
            referenceNumber,
            paymentStatus: paymentStatus || 'unpaid'
        }, { transaction: t });

        if (status === 'received') {
            await processOrderReception(newOrder.id, req.user.id, req.user.activeBranchId, t);
        }

        await t.commit();
        res.status(201).json(newOrder);
    } catch (error) {
        if (t) await t.rollback();
        console.error('Create purchase order error:', error);
        res.status(500).json({ error: 'Error al crear orden de compra/albarán: ' + error.message });
    }
});

router.post('/:id/receive', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        await processOrderReception(req.params.id, req.user.id, req.user.activeBranchId, t);
        await t.commit();
        res.json({ success: true, message: 'Orden recibida y stock actualizado' });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Receive purchase order error:', error);
        res.status(500).json({ error: 'Error al recibir orden: ' + error.message });
    }
});

router.post('/:id/cancel', async (req, res) => {
    try {
        const [updated] = await PurchaseOrder.update(
            { status: 'cancelled' },
            { where: { id: req.params.id, companyId: req.user.companyId, status: 'pending' } }
        );
        if (updated) {
            res.json({ success: true, message: 'Orden cancelada' });
        } else {
            res.status(404).json({ error: 'Orden no encontrada o no es cancelable' });
        }
    } catch (error) {
        console.error('Cancel purchase order error:', error);
        res.status(500).json({ error: 'Error al cancelar orden' });
    }
});

router.post('/:id/pay', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, companyId: req.user.companyId, paymentStatus: 'unpaid' },
            transaction: t
        });
        
        if (!order) {
            await t.rollback();
            return res.status(404).json({ error: 'Orden no encontrada o ya estaba pagada' });
        }

        await order.update({ paymentStatus: 'paid' }, { transaction: t });

        // If received, it's on credit, so reduce supplier balance and log payment
        if (order.status === 'received') {
            const supplier = await require('../database/models').Supplier.findOne({ where: { id: order.supplierId }, transaction: t });
            if (supplier) {
                const newBalance = (supplier.creditBalance || 0) - order.total;
                await supplier.update({ creditBalance: newBalance }, { transaction: t });
                
                await require('../database/models').SupplierCreditHistory.create({
                    id: generateRobustId(),
                    supplierId: order.supplierId,
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    timestamp: new Date().toISOString(),
                    type: 'payment',
                    amount: order.total,
                    balanceAfter: newBalance,
                    description: `Pago Albarán #${order.referenceNumber || order.id}`,
                    purchaseOrderId: order.id,
                    paymentMethod: 'cash'
                }, { transaction: t });
            }
        }

        // Deduct from open cash shift
        const { CashShift, CashMovement } = require('../database/models');
        const currentShift = await CashShift.findOne({
            where: { companyId: req.user.companyId, status: 'open' },
            order: [['openedAt', 'DESC']],
            transaction: t
        });
        
        if (currentShift) {
            await CashMovement.create({
                id: generateRobustId(),
                shiftId: currentShift.id,
                userId: String(req.user.id),
                companyId: req.user.companyId,
                type: 'out',
                amount: parseFloat(order.total),
                currency: 'USD',
                paymentMethodId: 'cash',
                category: 'PURCHASE',
                reason: `Pago Albarán #${order.referenceNumber || order.id}`,
                timestamp: new Date().toISOString()
            }, { transaction: t });
        }

        await t.commit();
        res.json({ success: true, message: 'Pago registrado correctamente' });
    } catch (error) {
        console.error('Pay purchase order error:', error);
        res.status(500).json({ error: 'Error al registrar el pago' });
    }
});

router.delete('/:id', verifyToken, isSuperAdmin, async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, companyId: req.user.companyId }
        });

        if (!order) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        if (order.status !== 'cancelled') {
            return res.status(400).json({ error: 'Solo se pueden eliminar órdenes canceladas' });
        }

        await order.destroy();
        res.json({ success: true, message: 'Orden eliminada permanentemente' });
    } catch (error) {
        console.error('Delete purchase order error:', error);
        res.status(500).json({ error: 'Error al eliminar la orden' });
    }
});

module.exports = router;
