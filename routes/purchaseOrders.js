const express = require('express');
const router = express.Router();
const { PurchaseOrder, Product, sequelize } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

router.get('/', async (req, res) => {
    try {
        const orders = await PurchaseOrder.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']]
        });
        res.json(orders);
    } catch (error) {
        console.error('Get purchase orders error:', error);
        res.status(500).json({ error: 'Error al obtener órdenes de compra' });
    }
});

router.post('/', async (req, res) => {
    try {
        const newOrder = await PurchaseOrder.create({
            id: generateRobustId(),
            userId: req.user.id,
            status: 'pending',
            ...req.body
        });
        res.status(201).json(newOrder);
    } catch (error) {
        console.error('Create purchase order error:', error);
        res.status(500).json({ error: 'Error al crear orden de compra' });
    }
});

router.post('/:id/receive', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, userId: req.user.id, status: 'pending' },
            transaction: t
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ error: 'Orden no encontrada o ya procesada' });
        }

        const items = JSON.parse(order.items || '[]');
        for (const item of items) {
            const product = await Product.findOne({
                where: { id: item.productId, userId: req.user.id },
                transaction: t
            });
            if (product) {
                const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                await product.update({ stockQuantity: currentStock + item.quantity }, { transaction: t });
            }
        }

        await order.update({ status: 'received', receivedAt: new Date().toISOString() }, { transaction: t });
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
            { where: { id: req.params.id, userId: req.user.id, status: 'pending' } }
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

module.exports = router;
