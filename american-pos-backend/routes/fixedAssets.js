const express = require('express');
const router = express.Router();
const FixedAssetService = require('../services/FixedAssetService');
const { verifyToken, isAdmin, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
    registerAssetSchema,
    depreciateAssetsSchema
} = require('../schemas/fixedAssetsSchema');

router.use(verifyToken);
router.use(requirePermission('canManageAssets'));

// Listar activos fijos
router.get('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const assets = await FixedAssetService.getAssets(companyId);
        res.json({ success: true, assets });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Registrar nuevo activo
router.post('/', validate(registerAssetSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const asset = await FixedAssetService.registerAsset({
            companyId,
            ...req.body
        });
        res.json({ success: true, asset });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Ejecutar corrida mensual de depreciación
router.post('/depreciate', isAdmin, validate(depreciateAssetsSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || null;
        const { period } = req.body;
        const result = await FixedAssetService.runMonthlyDepreciation(companyId, period, userId);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Historial de depreciación de un activo
router.get('/:id/history', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { id } = req.params;
        const history = await FixedAssetService.getAssetDepreciationHistory(id, companyId);
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
