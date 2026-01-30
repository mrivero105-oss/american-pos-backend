const express = require('express');
const router = express.Router();
const { readJson, writeJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE, PAYMENT_METHODS_FILE } = require('../config/paths');

router.get('/rate', async (req, res) => {
    try {
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.id);
        res.json({ rate: userSettings.exchangeRate || 1.0 });
    } catch (error) {
        console.error('Get rate error:', error);
        res.status(500).json({ error: 'Error al obtener tasa' });
    }
});

router.post('/rate', async (req, res) => {
    try {
        const { rate } = req.body;
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = allSettings[req.user.id] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.exchangeRate = parseFloat(rate);
        allSettings[req.user.id] = userSettings;
        writeJson(SETTINGS_FILE, allSettings);
        res.json({ success: true, rate });
    } catch (error) {
        console.error('Update rate error:', error);
        res.status(500).json({ error: 'Error al actualizar tasa' });
    }
});

router.get('/business', async (req, res) => {
    try {
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.id);
        res.json(userSettings.businessInfo || {});
    } catch (error) {
        console.error('Get business info error:', error);
        res.status(500).json({ error: 'Error al obtener info de negocio' });
    }
});

router.post('/business', async (req, res) => {
    try {
        const info = req.body;
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = allSettings[req.user.id] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.businessInfo = info;
        allSettings[req.user.id] = userSettings;
        writeJson(SETTINGS_FILE, allSettings);
        res.json({ success: true, businessInfo: info });
    } catch (error) {
        console.error('Update business info error:', error);
        res.status(500).json({ error: 'Error al actualizar info de negocio' });
    }
});

router.get('/payment-methods', async (req, res) => {
    try {
        const methods = readJson(PAYMENT_METHODS_FILE);
        res.json(methods);
    } catch (error) {
        console.error('Get payment methods error:', error);
        res.status(500).json({ error: 'Error al obtener métodos de pago' });
    }
});

router.post('/payment-methods', async (req, res) => {
    try {
        const { paymentMethods } = req.body;
        writeJson(PAYMENT_METHODS_FILE, paymentMethods);
        res.json({ success: true, paymentMethods });
    } catch (error) {
        console.error('Update payment methods error:', error);
        res.status(500).json({ error: 'Error al actualizar métodos de pago' });
    }
});

module.exports = router;
