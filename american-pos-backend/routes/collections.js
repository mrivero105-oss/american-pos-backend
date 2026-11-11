const express = require('express');
const router = express.Router();
const CollectionIntelligenceService = require('../services/CollectionIntelligenceService');

// Matriz de Antigüedad de Saldos (Aging Analysis)
router.get('/aging', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const includeZero = req.query.includeZero === 'true' || req.query.includeZero === '1';
        const data = await CollectionIntelligenceService.getAgingAnalysis(companyId, includeZero);
        res.json({ success: true, ok: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// Bloquear o rehabilitar línea de crédito de un cliente en el POS
router.post('/toggle-block/:customerId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || null;
        const { customerId } = req.params;
        const { isBlocked } = req.body || {};
        const result = await CollectionIntelligenceService.toggleCreditBlock(customerId, isBlocked, companyId, userId);
        res.json({ success: true, ok: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

// Perfil de crédito y semáforo para el POS
router.get('/customer-profile/:customerId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { customerId } = req.params;
        const profile = await CollectionIntelligenceService.getCustomerCreditProfile(customerId, companyId);
        res.json({ success: true, ok: true, profile });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// Generar mensaje personalizado de WhatsApp
router.get('/whatsapp-message/:customerId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { customerId } = req.params;
        let exchangeRate = parseFloat(req.query.exchangeRate || req.query.rate);
        if (isNaN(exchangeRate) || exchangeRate <= 1) {
            const { readJson, getUserSettings } = require('../utils/helpers');
            const { SETTINGS_FILE } = require('../config/paths');
            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const sysRate = parseFloat(userSettings.exchangeRate);
            if (!isNaN(sysRate) && sysRate > 0) {
                exchangeRate = sysRate;
            }
        }
        const result = await CollectionIntelligenceService.generateWhatsAppMessage(customerId, exchangeRate, companyId);
        res.json({ success: true, ok: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// Registrar gestión de cobranza o promesa de pago
router.post('/log', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || null;
        const log = await CollectionIntelligenceService.logAction({
            companyId,
            userId,
            ...req.body
        });
        res.json({ success: true, ok: true, log });
    } catch (err) {
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

// Historial de gestiones de cobro de un cliente
router.get('/history/:customerId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { customerId } = req.params;
        const history = await CollectionIntelligenceService.getCustomerActionsHistory(customerId, companyId);
        res.json({ success: true, ok: true, history, logs: history });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

module.exports = router;
