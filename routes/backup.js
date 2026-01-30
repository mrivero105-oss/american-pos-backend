const express = require('express');
const router = express.Router();
const { User, Product, Customer, Sale, Refund, CreditHistory, Supplier, PurchaseOrder, CashShift, sequelize } = require('../database/models');
const { readJson, writeJson } = require('../utils/helpers');
const { SETTINGS_FILE, PAYMENT_METHODS_FILE } = require('../config/paths');

router.get('/export', async (req, res) => {
    try {
        const data = {
            users: await User.findAll(),
            products: await Product.findAll(),
            customers: await Customer.findAll(),
            sales: await Sale.findAll(),
            refunds: await Refund.findAll(),
            creditHistory: await CreditHistory.findAll(),
            suppliers: await Supplier.findAll(),
            purchaseOrders: await PurchaseOrder.findAll(),
            cashShifts: await CashShift.findAll(),
            settings: readJson(SETTINGS_FILE),
            paymentMethods: readJson(PAYMENT_METHODS_FILE)
        };
        res.json(data);
    } catch (error) {
        console.error('Backup export error:', error);
        res.status(500).json({ error: 'Error al exportar respaldo' });
    }
});

router.post('/import', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const data = req.body;

        // Caution: This is a full restore, might want to be more selective in production
        if (data.users) {
            await User.destroy({ where: {}, transaction: t });
            await User.bulkCreate(data.users, { transaction: t });
        }
        if (data.products) {
            await Product.destroy({ where: {}, transaction: t });
            await Product.bulkCreate(data.products, { transaction: t });
        }
        if (data.customers) {
            await Customer.destroy({ where: {}, transaction: t });
            await Customer.bulkCreate(data.customers, { transaction: t });
        }
        // ... more models as needed

        if (data.settings) writeJson(SETTINGS_FILE, data.settings);
        if (data.paymentMethods) writeJson(PAYMENT_METHODS_FILE, data.paymentMethods);

        await t.commit();
        res.json({ success: true, message: 'Respaldo restaurado exitosamente' });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Backup import error:', error);
        res.status(500).json({ error: 'Error al restaurar respaldo: ' + error.message });
    }
});

module.exports = router;
