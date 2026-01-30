const express = require('express');
const router = express.Router();
const { Sale, Product, Customer, CreditHistory, sequelize } = require('../database/models');
const { Op } = require('sequelize');
const { generateRobustId, readJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');

router.get('/', async (req, res) => {
    try {
        const sales = await Sale.findAll({
            where: { userId: req.user.id },
            limit: 50,
            order: [['date', 'DESC']]
        });
        res.json(sales);
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({ error: 'Error al obtener ventas: ' + error.message });
    }
});

router.post('/', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { paymentMethod, customerId, total, items } = req.body;

        if (paymentMethod === 'fiado') {
            if (!customerId) {
                await t.rollback();
                return res.status(400).json({ message: 'Se requiere un cliente para venta a crédito' });
            }

            const customer = await Customer.findOne({ where: { id: customerId, userId: req.user.id }, transaction: t });
            if (!customer) {
                await t.rollback();
                return res.status(404).json({ message: 'Cliente no encontrado' });
            }

            const creditLimit = customer.creditLimit || 0;
            const creditBalance = customer.creditBalance || 0;
            const availableCredit = creditLimit - creditBalance;
            const saleTotal = total || 0;

            if (creditLimit > 0 && saleTotal > availableCredit) {
                await t.rollback();
                return res.status(400).json({
                    message: `Crédito insuficiente. Disponible: $${availableCredit.toFixed(2)}, Requerido: $${saleTotal.toFixed(2)}`
                });
            }

            await customer.update({ creditBalance: creditBalance + saleTotal }, { transaction: t });

            await CreditHistory.create({
                id: generateRobustId(),
                userId: req.user.id,
                customerId: customerId,
                type: 'charge',
                amount: saleTotal,
                balanceAfter: creditBalance + saleTotal,
                description: 'Venta (Fiado)',
                paymentMethod: 'fiado',
                timestamp: new Date().toISOString()
            }, { transaction: t });
        }

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.id);
        const currentExchangeRate = userSettings.exchangeRate || 1.0;

        const newSale = await Sale.create({
            id: generateRobustId(),
            userId: req.user.id,
            date: new Date().toISOString(),
            customerName: req.body.customerName || (req.body.customer ? req.body.customer.name : 'Cliente Ocasional'),
            exchangeRate: currentExchangeRate,
            ...req.body
        }, { transaction: t });

        for (const item of items) {
            const pId = item.productId || item.id;
            if (!pId) continue;

            const product = await Product.findOne({
                where: { id: pId, userId: req.user.id },
                transaction: t
            });

            if (product) {
                const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                await product.update({ stockQuantity: currentStock - Number(item.quantity) }, { transaction: t });
            }
        }

        await t.commit();
        res.status(201).json(newSale);

    } catch (error) {
        await t.rollback();
        console.error('Create sale error:', error);
        res.status(500).json({ error: 'Error al registrar venta: ' + error.message });
    }
});

module.exports = router;
