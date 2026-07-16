const express = require('express');
const router = express.Router();
const WhatsappBotService = require('../services/WhatsappBotService');

// GET /api/whatsapp/status
router.get('/status', (req, res) => {
    try {
        const data = WhatsappBotService.getStatus();
        res.json(data);
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error get status:', error);
        res.status(500).json({ error: 'Error al obtener estado' });
    }
});

// POST /api/whatsapp/start
router.post('/start', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'DEFAULT_COMPANY';
        WhatsappBotService.init(companyId);
        res.json({ success: true, message: 'Inicializando WhatsApp Bot...' });
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error start:', error);
        res.status(500).json({ error: 'Error al iniciar bot' });
    }
});

// POST /api/whatsapp/logout
router.post('/logout', async (req, res) => {
    try {
        await WhatsappBotService.logout();
        res.json({ success: true, message: 'Bot desconectado' });
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error logout:', error);
        res.status(500).json({ error: 'Error al desconectar bot' });
    }
});

module.exports = router;
