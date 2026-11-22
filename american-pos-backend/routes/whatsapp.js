const express = require('express');
const router = express.Router();
const WhatsappBotService = require('../services/WhatsappBotService');
const { Supplier, PurchaseOrder } = require('../database/models');
const { getUserSettings } = require('../utils/helpers');
const { verifyToken, isAdmin, requirePermission } = require('../middleware/auth');

// 🔒 SEGURIDAD: Requerir autenticación de sesión activa para todas las operaciones de WhatsApp
router.use(verifyToken);

// GET /api/whatsapp/status
router.get('/status', (req, res) => {
    try {
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        const data = WhatsappBotService.getStatus();
        res.json(data);
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error get status:', error);
        res.status(500).json({ error: 'Error al obtener estado' });
    }
});

// POST /api/whatsapp/start - Administradores o usuarios con permiso de configuración pueden iniciar el bot
router.post('/start', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || '2';
        const forceRestart = Boolean(req.body?.forceRestart);
        const current = await WhatsappBotService.init(companyId, { forceRestart });
        if (current?.status === 'DISCONNECTED' && current?.lastError) {
            return res.status(500).json({ success: false, error: current.lastError, ...current });
        }
        res.json({ success: true, message: 'Inicializando WhatsApp Bot...', ...current });
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error start:', error);
        res.status(500).json({ error: 'Error al iniciar bot' });
    }
});

// POST /api/whatsapp/logout - Administradores o usuarios con permiso de configuración pueden desconectar el bot
router.post('/logout', requirePermission('canManageSettings'), async (req, res) => {
    try {
        await WhatsappBotService.logout();
        res.json({ success: true, message: 'Bot desconectado' });
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error logout:', error);
        res.status(500).json({ error: 'Error al desconectar bot' });
    }
});

// POST /api/whatsapp/send-order
router.post('/send-order', requirePermission(['canManagePurchases', 'canManageSuppliers']), async (req, res) => {
    try {
        const { supplierId, orderId, phone, items, notes, total, referenceNumber } = req.body || {};
        
        let targetPhone = phone;
        let supplierName = req.body?.supplierName || '';
        let supplierContact = req.body?.supplierContact || '';

        if (supplierId) {
            const companyId = req.user?.companyId || 'default';
            const supplier = await Supplier.findOne({ where: { id: supplierId, companyId } });
            if (supplier) {
                targetPhone = targetPhone || supplier.phone;
                supplierName = supplierName || supplier.name;
                supplierContact = supplierContact || supplier.contact;
            }
        }

        if (!targetPhone) {
            return res.status(400).json({ error: 'El proveedor no tiene un número telefónico configurado para WhatsApp.' });
        }

        const settings = getUserSettings(undefined, req.user?.companyId);
        const businessName = settings?.business?.name || 'Isaac POS';

        let parsedItems = items;
        if (typeof items === 'string') {
            try { parsedItems = JSON.parse(items); } catch(e) { parsedItems = []; }
        }

        const formattedText = WhatsappBotService.formatPurchaseOrderMessage({
            orderId,
            businessName,
            supplierName,
            supplierContact,
            orderDate: new Date().toLocaleDateString('es-VE'),
            items: parsedItems,
            total,
            notes,
            referenceNumber
        });

        const sendResult = await WhatsappBotService.sendDirectMessage(targetPhone, formattedText);

        res.json({
            ...sendResult,
            formattedText,
            supplierName,
            businessName
        });
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error send-order:', error);
        res.status(500).json({ error: error.message || 'Error al enviar orden por WhatsApp' });
    }
});

// POST /api/whatsapp/send-direct - Solo administradores pueden enviar mensajes directos libres
router.post('/send-direct', isAdmin, async (req, res) => {
    try {
        const { phone, message } = req.body || {};
        if (!phone || !message) {
            return res.status(400).json({ error: 'Se requiere teléfono y mensaje' });
        }
        const result = await WhatsappBotService.sendDirectMessage(phone, message);
        res.json(result);
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error send-direct:', error);
        res.status(500).json({ error: error.message || 'Error al enviar mensaje' });
    }
});

// POST /api/whatsapp/send-media
router.post('/send-media', requirePermission('canAccessPOS'), express.json({ limit: '15mb' }), async (req, res) => {
    try {
        const { phone, imageBase64, mimeType = 'image/png', caption = '', filename = 'factura.png' } = req.body || {};
        if (!phone || !imageBase64) {
            return res.status(400).json({ error: 'Se requiere el número de teléfono y la imagen de la factura' });
        }
        const result = await WhatsappBotService.sendMediaMessage(phone, imageBase64, mimeType, caption, filename);
        res.json(result);
    } catch (error) {
        console.error('[WHATSAPP_ROUTE] Error send-media:', error);
        res.status(500).json({ error: error.message || 'Error al enviar imagen por WhatsApp' });
    }
});

module.exports = router;
