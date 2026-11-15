const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { License, User } = require('../database/models');
const { Op } = require('sequelize');
const licenseUtils = require('../utils/licenseUtils');
const { verifyToken, verifyJwtResilient, isMaster } = require('../middleware/auth');
const { clearLicenseCache } = require('../middleware/licenseMiddleware');
const path = require('path');
const fs = require('fs');

const activateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Demasiados intentos de activación de licencia desde esta IP. Espera 15 minutos.'
    }
});

const safeEqualSecret = (candidate, secret) => {
    if (typeof candidate !== 'string' || typeof secret !== 'string' || !candidate || !secret) {
        return false;
    }
    const hA = crypto.createHash('sha256').update(candidate, 'utf8').digest();
    const hB = crypto.createHash('sha256').update(secret, 'utf8').digest();
    return crypto.timingSafeEqual(hA, hB);
};

const isLoopbackRequest = (req) => {
    const rawIp = String(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim();
    const cleanIp = rawIp.replace('::ffff:', '');
    return cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost';
};

async function resolveOptionalLicenseOperator(req) {
    try {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        let token = null;
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        } else if (req.cookies && req.cookies.authToken) {
            token = req.cookies.authToken;
        }
        if (!token) return null;

        const decoded = verifyJwtResilient(token);
        if (!decoded || decoded.isSyncNode) return null;

        const dbUser = await User.findByPk(decoded.id, {
            attributes: ['id', 'role', 'status', 'companyId', 'currentSessionId', 'email']
        });
        if (!dbUser || dbUser.status !== 'active') return null;
        if (dbUser.currentSessionId && (!decoded.sessionId || dbUser.currentSessionId !== decoded.sessionId)) {
            return null;
        }

        const role = String(dbUser.role || '').toLowerCase();
        const isMasterUser = ['superadmin', 'owner', 'dueño'].includes(role);
        const isAdminUser = isMasterUser || role === 'admin';
        return { user: dbUser, isMasterUser, isAdminUser };
    } catch (_) {
        return null;
    }
}

/**
 * GET /license/generator or /license/pocket or /license/generador
 * Serves the Mobile Pocket Generator (Restricted to Master / Superadmin)
 */
router.get(['/generator', '/pocket', '/generador'], verifyToken, isMaster, (req, res) => {
    const candidates = [
        path.join(__dirname, '../private/pocket-license.html'),
        path.join(__dirname, 'private/pocket-license.html')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return res.sendFile(p);
        }
    }
    res.status(404).send('Generador no encontrado');
});

/**
 * GET /license/download-apk or /license/Generador-Licencias.apk
 * Serves the native Android APK installer (Restricted to Master / Superadmin)
 */
router.get(['/download-apk', '/Generador-Licencias.apk', '/apk'], verifyToken, isMaster, (req, res) => {
    const candidates = [
        path.join(__dirname, '../public/Generador-Licencias.apk'),
        path.join(__dirname, 'public/Generador-Licencias.apk'),
        path.join(__dirname, '../../Generador-Licencias.apk'),
        path.join(process.cwd(), 'Generador-Licencias.apk')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return res.download(p, 'Generador-Licencias.apk');
        }
    }
    res.status(404).send('APK no encontrado');
});

/**
 * GET /license/isaac-pos-apk or /license/Isaac-POS-Mobile.apk or /license/pos-apk
 * Serves the official Isaac POS Mobile Android APK installer
 */
router.get(['/isaac-pos-mobile-apk', '/Isaac-POS-Mobile.apk', '/isaac-pos-apk', '/Isaac-POS.apk', '/pos-apk', '/Isaac%20POS%20Mobile.apk'], (req, res) => {
    const candidates = [
        path.join(__dirname, '../public/Isaac-POS-Mobile.apk'),
        path.join(__dirname, '../public/Isaac-POS.apk'),
        path.join(__dirname, 'public/Isaac-POS-Mobile.apk'),
        path.join(__dirname, 'public/Isaac-POS.apk'),
        path.join(__dirname, '../../Isaac-POS-Mobile.apk'),
        path.join(__dirname, '../../Isaac-POS.apk'),
        path.join(process.cwd(), 'Isaac-POS-Mobile.apk'),
        path.join(process.cwd(), 'Isaac-POS.apk'),
        path.join(process.cwd(), 'dist_apk/Isaac-POS-Mobile.apk'),
        path.join(process.cwd(), 'dist_apk/Isaac-POS.apk')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return res.download(p, 'Isaac-POS-Mobile.apk');
        }
    }
    res.status(404).send('APK no encontrado');
});

/**
 * GET /license/manifest.json
 */
router.get('/manifest.json', (req, res) => {
    const candidates = [
        path.join(__dirname, '../public/manifest.json'),
        path.join(__dirname, 'public/manifest.json')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return res.sendFile(p);
    }
    res.json({ name: "Generador POS" });
});

/**
 * GET /license/sw.js
 */
router.get('/sw.js', (req, res) => {
    const candidates = [
        path.join(__dirname, '../public/sw.js'),
        path.join(__dirname, 'public/sw.js')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return res.sendFile(p);
    }
    res.status(404).send('SW no encontrado');
});

/**
 * GET /license/status
 * Returns terminal HWID and license status for the querying terminal
 */
router.get('/status', async (req, res) => {
    try {
        const serverMachineId = await licenseUtils.getMachineId();
        const rawIp = req.ip || req.connection?.remoteAddress || '';
        const clientIp = rawIp.replace('::ffff:', '');
        const isLocalHost = clientIp === '127.0.0.1' || clientIp === '::1' || req.hostname === 'localhost';

        // Read terminalId from query params or header
        let terminalId = req.query.terminalId || req.headers['x-terminal-id'];
        
        if (!terminalId) {
            const ipSuffix = clientIp.replace(/[^0-9]/g, '').slice(-4) || 'CLIENT';
            terminalId = isLocalHost ? serverMachineId : `TERM-MOB-${ipSuffix}`;
        }

        const isServerHost = terminalId === serverMachineId;

        // 1. Buscar licencia activa dedicada para esta terminal
        let activeLicense = await License.findOne({ 
            where: { 
                machineId: terminalId,
                status: 'active' 
            },
            order: [['createdAt', 'DESC']]
        });

        // 2. Si la terminal no tiene licencia individual, verificar la licencia del Servidor
        let isInheritedFromServer = false;
        if (!activeLicense) {
            const serverLicense = await License.findOne({
                where: {
                    machineId: serverMachineId,
                    status: 'active'
                },
                order: [['createdAt', 'DESC']]
            });

            if (serverLicense) {
                const serverValidation = await licenseUtils.validateKey(serverLicense.licenseKey, serverMachineId);
                if (serverValidation.valid) {
                    activeLicense = serverLicense;
                    isInheritedFromServer = true;
                }
            }
        }

        // Si ni la terminal ni el servidor tienen licencia activa
        if (!activeLicense) {
            return res.json({
                activated: false,
                machineId: terminalId,
                serverMachineId: serverMachineId,
                isServerHost,
                isTerminal: !isServerHost,
                message: isServerHost 
                    ? 'El servidor central no cuenta con una licencia activa.'
                    : 'Terminal no autorizada. El servidor central requiere una licencia activa.'
            });
        }

        // 3. Validar criptográficamente si la licencia es individual (no heredada)
        if (!isInheritedFromServer) {
            const targetValidateId = isServerHost ? serverMachineId : terminalId;
            const validation = await licenseUtils.validateKey(activeLicense.licenseKey, targetValidateId);

            if (!validation.valid) {
                return res.json({
                    activated: false,
                    machineId: terminalId,
                    serverMachineId: serverMachineId,
                    isServerHost,
                    isTerminal: !isServerHost,
                    message: validation.message || 'Licencia inválida o expirada.'
                });
            }
        }

        res.json({
            activated: true,
            expiresAt: activeLicense.expiresAt,
            machineId: terminalId,
            serverMachineId: serverMachineId,
            isServerHost,
            isTerminal: !isServerHost,
            isInherited: isInheritedFromServer,
            message: isServerHost 
                ? 'Licencia de Servidor activa' 
                : (isInheritedFromServer 
                    ? 'Terminal autorizada (Licencia de Servidor Principal)' 
                    : 'Licencia de Cajero / Terminal activa')
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /license/activate
 * Activates a specific terminal with a key
 */
router.post('/activate', activateLimiter, async (req, res) => {
    try {
        const { key } = req.body;
        if (!key || typeof key !== 'string' || !key.trim() || key.length > 4096) {
            return res.status(400).json({ error: 'Llave requerida con formato válido' });
        }

        const serverMachineId = await licenseUtils.getMachineId();
        const rawTerminalId = req.body.machineId || req.headers['x-terminal-id'] || serverMachineId;
        const terminalId = String(rawTerminalId).trim().slice(0, 128);
        if (!terminalId) {
            return res.status(400).json({ error: 'Machine ID inválido' });
        }

        const authCtx = await resolveOptionalLicenseOperator(req);
        const isLoopback = isLoopbackRequest(req);

        // Si ya existe una licencia activa y válida en esta terminal, exigir administrador autenticado para reemplazar/revocar
        const existingLicense = await License.findOne({
            where: {
                machineId: terminalId,
                status: 'active'
            },
            order: [['createdAt', 'DESC']]
        });
        if (existingLicense) {
            const existingValidation = await licenseUtils.validateKey(existingLicense.licenseKey, terminalId);
            if (existingValidation.valid && !authCtx?.isAdminUser) {
                return res.status(403).json({
                    error: 'La terminal ya cuenta con una licencia activa válida. Se requiere sesión de Administrador para reemplazarla.'
                });
            }
        }

        // 1. Desbloqueo directo con Clave Maestra de Dueño (protegido contra timing attack, restringido a loopback o Master)
        const ownerSecret = process.env.OWNER_SECRET_KEY ? process.env.OWNER_SECRET_KEY.trim() : null;
        if (ownerSecret && ownerSecret.length >= 8 && safeEqualSecret(key.trim(), ownerSecret)) {
            if (!isLoopback && !authCtx?.isMasterUser) {
                return res.status(403).json({
                    error: 'El desbloqueo directo con clave maestra solo está permitido desde el equipo servidor o sesión Master.'
                });
            }

            let masterKey;
            try {
                masterKey = licenseUtils.generateKey(terminalId, -1);
            } catch (genErr) {
                return res.status(400).json({ error: genErr.message });
            }

            await License.update({ status: 'revoked' }, { 
                where: { 
                    machineId: terminalId,
                    status: 'active' 
                } 
            });
            const newLicense = await License.create({
                id: 'lic_owner_' + Date.now(),
                machineId: terminalId,
                licenseKey: masterKey,
                activatedAt: new Date().toISOString(),
                expiresAt: null,
                status: 'active',
                meta: { activatedBy: authCtx?.user?.email || 'OWNER_SECRET_DIRECT', activatedByIp: req.ip, userAgent: req.headers['user-agent'] }
            });

            if (typeof clearLicenseCache === 'function') {
                clearLicenseCache(terminalId);
            }

            return res.json({
                success: true,
                message: '¡Terminal activada con éxito con tu Clave Maestra de Dueño!',
                license: newLicense
            });
        }

        const validation = await licenseUtils.validateKey(key, terminalId);
        if (!validation.valid) {
            if (global.logger) global.logger.warn(`[License] Fallo en /activate para ${terminalId}: ${validation.message}`);
            console.warn(`[License] Fallo en /activate para ${terminalId}: ${validation.message}`);
            return res.status(400).json({ error: validation.message });
        }

        // Deactivate previous active licenses for THIS specific terminal
        await License.update({ status: 'revoked' }, { 
            where: { 
                machineId: terminalId,
                status: 'active' 
            } 
        });

        // Create new active license for this terminal
        const newLicense = await License.create({
            id: 'lic_' + Date.now() + '_' + Math.floor(Math.random()*1000),
            machineId: terminalId,
            licenseKey: key,
            activatedAt: new Date().toISOString(),
            expiresAt: validation.expiresAt,
            status: 'active',
            meta: { activatedByIp: req.ip, userAgent: req.headers['user-agent'] }
        });

        if (typeof clearLicenseCache === 'function') {
            clearLicenseCache(terminalId);
        }

        res.json({
            success: true,
            message: 'Terminal activada correctamente',
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
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Ruta no disponible en producción' });
    }
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
            order: [['createdAt', 'DESC']],
            limit: 100
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

/**
 * DELETE /license/:id
 * Removes a specific license by ID (Master only)
 */
router.delete('/:id', verifyToken, isMaster, async (req, res) => {
    try {
        const { id } = req.params;
        const license = await License.findByPk(id);
        if (!license) {
            return res.status(404).json({ error: 'Licencia no encontrada' });
        }
        if (license.status === 'active') {
            return res.status(400).json({ error: 'No se puede eliminar la licencia actualmente activa del sistema.' });
        }

        await license.destroy();
        res.json({
            success: true,
            message: 'Licencia eliminada individualmente con éxito.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

