const express = require('express');
const router = express.Router();
const PromotionService = require('../services/PromotionService');
const { requirePermission } = require('../middleware/auth');

/**
 * GET / - Listar todas las promociones
 */
router.get('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const promotions = await PromotionService.getAllPromotions(companyId);
        res.json({ success: true, promotions });
    } catch (err) {
        console.error('Error fetching promotions:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /active - Listar promociones activas para el terminal POS
 */
router.get('/active', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const activePromotions = await PromotionService.getActivePromotions(companyId);
        res.json({ success: true, promotions: activePromotions });
    } catch (err) {
        console.error('Error fetching active promotions:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /evaluate - Evaluar el carrito de compras contra las promociones activas
 */
router.post('/evaluate', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { items, paymentMethod } = req.body || {};
        const evaluation = await PromotionService.evaluateCart(items || [], companyId, paymentMethod);
        res.json({ success: true, ...evaluation });
    } catch (err) {
        console.error('Error evaluating promotions on cart:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST / - Crear nueva promoción
 */
router.post('/', requirePermission('canManagePromotions'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const promo = await PromotionService.createPromotion(req.body, companyId);
        
        // Emitir cambio vía sockets si está disponible
        const io = req.app.get('io');
        if (io) io.to(companyId).emit('promotions_updated');
        
        res.status(201).json({ success: true, promotion: promo });
    } catch (err) {
        console.error('Error creating promotion:', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * PUT /:id - Actualizar promoción
 */
router.put('/:id', requirePermission('canManagePromotions'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const promo = await PromotionService.updatePromotion(req.params.id, req.body, companyId);
        
        const io = req.app.get('io');
        if (io) io.to(companyId).emit('promotions_updated');
        
        res.json({ success: true, promotion: promo });
    } catch (err) {
        console.error('Error updating promotion:', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /:id - Eliminar promoción
 */
router.delete('/:id', requirePermission('canManagePromotions'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const result = await PromotionService.deletePromotion(req.params.id, companyId);
        
        const io = req.app.get('io');
        if (io) io.to(companyId).emit('promotions_updated');
        
        res.json(result);
    } catch (err) {
        console.error('Error deleting promotion:', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = router;
