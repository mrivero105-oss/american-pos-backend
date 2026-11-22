const express = require('express');
const router = express.Router();
const ScannerService = require('../services/ScannerService');
const { verifyToken, requirePermission } = require('../middleware/auth');

const requireScannerAccess = requirePermission('canManageInventory', 'canManagePurchases', 'canCreateProducts', 'canManageSettings');

router.get('/devices', verifyToken, requireScannerAccess, async (req, res) => {
    try {
        const devices = await ScannerService.getConnectedScanners();
        res.json({
            success: true,
            devices
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message || 'Error al consultar dispositivos de escáner'
        });
    }
});

router.post('/scan', verifyToken, requireScannerAccess, async (req, res) => {
    try {
        const result = await ScannerService.scanDocument(req.body);
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message || 'Error durante el escaneo del documento'
        });
    }
});

module.exports = router;
