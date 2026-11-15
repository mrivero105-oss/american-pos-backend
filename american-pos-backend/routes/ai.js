const express = require('express');
const router = express.Router();
const AIService = require('../services/AIService');
const { requirePermission } = require('../middleware/auth');

// POST /api/ai/query
router.post('/query', async (req, res) => {
    try {
        const { query, history, context } = req.body;
        const { companyId } = req.user; 

        if (!query) {
            return res.status(400).json({ error: 'La consulta es requerida.' });
        }

        const response = await AIService.ask(companyId, query, req.user, history || [], context || {});
        res.json({ response });
    } catch (error) {
        console.error('[AI_ROUTE_ERROR]', error);
        res.status(500).json({ error: 'Error interno al procesar la IA.' });
    }
});

// POST /api/ai/manager/analyze
router.post('/manager/analyze', requirePermission('canViewReports'), async (req, res) => {
    try {
        const { companyId } = req.user;
        const result = await AIService.runSilentInventoryManager(companyId, req.user);
        res.json(result);
    } catch (error) {
        console.error('[AI_MANAGER_ERROR]', error);
        res.status(500).json({ error: 'Fallo al ejecutar Gerente Silencioso.' });
    }
});

// Ruta publica extraída a publicAi.js

// GET /api/ai/predictive-analytics (Estricto Modo SOLO LECTURA)
router.get('/predictive-analytics', requirePermission('canViewReports'), async (req, res) => {
    try {
        const companyId = String(req.user.companyId);
        const result = await AIService.getPredictiveAnalytics(companyId, req.user, req.query);
        res.json(result);
    } catch (error) {
        console.error('[AI_PREDICTIVE_ERROR]', error);
        res.status(500).json({ error: 'Fallo al ejecutar análisis predictivo con IA.', details: error.message });
    }
});

// POST /api/ai/cross-selling
router.post('/cross-selling', async (req, res) => {
    try {
        const { companyId } = req.user;
        const { cartItems } = req.body;

        if (!cartItems || cartItems.length === 0) {
            return res.json({ speech: '', items: [] });
        }

        const suggestions = await AIService.getCrossSellingSuggestions(companyId, cartItems);
        res.json(suggestions);
    } catch (error) {
        console.error('[AI_CROSS_SELLING_ERROR]', error);
        res.status(500).json({ error: 'Fallo al obtener sugerencias de Cross-Selling.' });
    }
});

module.exports = router;
