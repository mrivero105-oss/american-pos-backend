const express = require('express');
const router = express.Router();
const BatchTraceabilityService = require('../services/BatchTraceabilityService');
const { requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
    createLotSchema,
    updateLotSchema,
    writeOffLotSchema,
    lotPromoSchema
} = require('../schemas/lotsSchema');

router.use(requirePermission('canManageInventory'));

// GET /lots/dashboard - Obtiene el resumen de KPIs y listado filtrado
router.get('/dashboard', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { search = '', status = 'all', supplierId = '' } = req.query;
        const data = await BatchTraceabilityService.getDashboard(companyId, { search, status, supplierId });
        res.json({ success: true, ok: true, ...data });
    } catch (err) {
        console.error('[Lots Route] Dashboard error:', err);
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// GET /lots/:id/traceability - Trazabilidad completa de un lote
router.get('/:id/traceability', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { id } = req.params;
        const data = await BatchTraceabilityService.getLotTraceability(id, companyId);
        res.json({ success: true, ok: true, ...data });
    } catch (err) {
        console.error('[Lots Route] Traceability error:', err);
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// POST /lots - Crear un nuevo lote
router.post('/', validate(createLotSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const lot = await BatchTraceabilityService.createOrUpdateLot(req.body, companyId);
        res.status(201).json({ success: true, ok: true, lot, message: 'Lote registrado exitosamente.' });
    } catch (err) {
        console.error('[Lots Route] Create lot error:', err);
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

// PUT /lots/:id - Actualizar un lote existente
router.put('/:id', validate(updateLotSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const lot = await BatchTraceabilityService.createOrUpdateLot({ ...req.body, id: req.params.id }, companyId);
        res.json({ success: true, ok: true, lot, message: 'Lote actualizado correctamente.' });
    } catch (err) {
        console.error('[Lots Route] Update lot error:', err);
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

// POST /lots/:id/write-off - Dar de baja un lote por caducidad (Merma Sanitaria)
router.post('/:id/write-off', validate(writeOffLotSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || null;
        const responsibleName = req.user?.name || req.body?.responsibleName || 'Supervisor';
        const { reason = 'Caducidad vencida', notes = '', quantity = null } = req.body || {};

        const result = await BatchTraceabilityService.writeOffLot(req.params.id, {
            companyId,
            userId,
            responsibleName,
            reason,
            notes,
            quantity
        });

        res.json({ success: true, ok: true, ...result });
    } catch (err) {
        console.error('[Lots Route] Write-off error:', err);
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

// POST /lots/:id/send-to-promo - Liquidar lote próximo a vencer en Oferta
router.post('/:id/send-to-promo', validate(lotPromoSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { discountPercentage = 20, promoDays = 15, customName = null } = req.body || {};

        const result = await BatchTraceabilityService.createPromoFromLot(req.params.id, {
            companyId,
            discountPercentage,
            promoDays,
            customName
        });

        res.json({ success: true, ok: true, ...result });
    } catch (err) {
        console.error('[Lots Route] Send to promo error:', err);
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

module.exports = router;
