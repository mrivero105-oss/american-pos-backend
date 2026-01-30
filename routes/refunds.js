const express = require('express');
const router = express.Router();
const { Refund, Sale, Product, sequelize } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

router.get('/', async (req, res) => {
    try {
        const refunds = await Refund.findAll({
            where: { userId: req.user.id },
            order: [['timestamp', 'DESC']],
            limit: 50
        });
        res.json(refunds);
    } catch (error) {
        console.error('Get refunds error:', error);
        res.status(500).json({ error: 'Error al obtener devoluciones' });
    }
});

router.post('/', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { saleId, reason, items } = req.body;

        const sale = await Sale.findOne({
            where: { id: saleId, userId: req.user.id },
            transaction: t
        });

        if (!sale) {
            await t.rollback();
            return res.status(404).json({ message: 'Venta no encontrada' });
        }

        const refundTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const newRefund = await Refund.create({
            id: generateRobustId(),
            userId: req.user.id,
            saleId,
            amount: refundTotal,
            reason: reason || 'Devolución de cliente',
            date: new Date().toISOString(),
            items: JSON.stringify(items)
        }, { transaction: t });

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

        await t.commit();
        res.status(201).json(newRefund);
    } catch (error) {
        if (t) await t.rollback();
        console.error('Create refund error:', error);
        res.status(500).json({ error: 'Error al procesar devolución: ' + error.message });
    }
});

module.exports = router;
