const express = require('express');
const router = express.Router();
const { License } = require('../database/models');
const { Op } = require('sequelize');
const licenseUtils = require('../utils/licenseUtils');
const { verifyToken, isMaster } = require('../middleware/auth');

/**
 * GET /license/status
 * Returns current HWID and license status
 */
router.get('/status', async (req, res) => {
    try {
        const machineId = await licenseUtils.getMachineId();
        const activeLicense = await License.findOne({ where: { status: 'active' } });

        if (!activeLicense) {
            return res.json({
                activated: false,
                machineId: machineId
            });
        }

        const validation = await licenseUtils.validateKey(activeLicense.licenseKey);
        res.json({
            activated: validation.valid,
            expiresAt: activeLicense.expiresAt,
            machineId: machineId,
            message: validation.message || 'Licencia activa'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /license/activate
 * Activates the system with a key
 */
router.post('/activate', async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'Llave requerida' });

        const validation = await licenseUtils.validateKey(key);
        if (!validation.valid) {
            if (global.logger) global.logger.warn(`[License] Fallo en /activate: ${validation.message}`);
            console.warn(`[License] Fallo en /activate: ${validation.message}`);
            return res.status(400).json({ error: validation.message });
        }

        // Deactivate previous licenses
        await License.update({ status: 'revoked' }, { where: { status: 'active' } });

        // Create new active license
        const newLicense = await License.create({
            id: 'lic_' + Date.now() + '_' + Math.floor(Math.random()*1000),
            machineId: await licenseUtils.getMachineId(),
            licenseKey: key,
            activatedAt: new Date().toISOString(),
            expiresAt: validation.expiresAt,
            status: 'active'
        });

        res.json({
            success: true,
            message: 'Sistema activado correctamente',
            license: newLicense
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /license/generate
 * Generates a key (Master only)
 */
router.post('/generate', verifyToken, isMaster, async (req, res) => {
    try {
        const { machineId, days, duration, unit = 'days' } = req.body;
        if (!machineId) return res.status(400).json({ error: 'Machine ID requerido' });

        const actualDuration = duration !== undefined ? duration : (days || 365);
        const key = licenseUtils.generateKey(machineId, actualDuration, unit);
        
        let expiresAt = null;
        if (actualDuration !== -1) {
            const ms = unit === 'minutes' ? (actualDuration * 60 * 1000) : (actualDuration * 24 * 60 * 60 * 1000);
            expiresAt = new Date(Date.now() + ms).toISOString();
        }

        // Save generated key to history
        await License.create({
            id: 'gen_' + Date.now(),
            machineId: machineId,
            licenseKey: key,
            activatedAt: null,
            expiresAt: expiresAt,
            status: 'generated',
            meta: { generatedBy: req.user.email }
        });

        res.json({
            success: true,
            key: key,
            machineId: machineId,
            expiresAt: expiresAt || 'Vitalicia'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /license/test-generate
 * Master-only key generation (same protection as /generate)
 */
router.post('/test-generate', verifyToken, isMaster, async (req, res) => {
    try {
        const { machineId, duration, unit = 'days' } = req.body;
        if (!machineId) return res.status(400).json({ error: 'Machine ID requerido' });

        const actualDuration = duration !== undefined ? parseInt(duration) : 365;
        const key = licenseUtils.generateKey(machineId, actualDuration, unit);
        
        let expiresAt = null;
        if (actualDuration !== -1) {
            const ms = unit === 'minutes' ? (actualDuration * 60 * 1000) : (actualDuration * 24 * 60 * 60 * 1000);
            expiresAt = new Date(Date.now() + ms).toISOString();
        }

        res.json({
            success: true,
            key: key,
            machineId: machineId,
            expiresAt: expiresAt || 'Vitalicia'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /license/history
 * Returns the history of generated keys (Master only)
 */
router.get('/history', verifyToken, isMaster, async (req, res) => {
    try {
        const history = await License.findAll({
            where: { 
                status: { [Op.ne]: 'active' }
            },
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        res.json({ success: true, history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


/**
 * DELETE /license/cleanup
 * Removes all licenses that are not active (Master only)
 */
router.delete('/cleanup', verifyToken, isMaster, async (req, res) => {
    try {
        const deletedCount = await License.destroy({
            where: {
                status: { [Op.ne]: 'active' }
            }
        });
        
        res.json({ 
            success: true, 
            message: `Limpieza completada. Se eliminaron ${deletedCount} registros.`,
            deletedCount 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
