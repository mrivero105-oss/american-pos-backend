const express = require('express');
const router = express.Router();
const ScannerService = require('../services/ScannerService');
const { verifyToken } = require('../middleware/auth');

router.get('/devices', verifyToken, async (req, res) => {
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

router.post('/scan', verifyToken, async (req, res) => {
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
