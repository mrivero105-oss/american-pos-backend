const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { License, User } = require('../database/models');
const { Op } = require('sequelize');
const licenseUtils = require('../utils/licenseUtils');
const { verifyToken, verifyJwtResilient, isMaster } = require('../middleware/auth');
const { clearLicenseCache } = require('../middleware/licenseMiddleware');
const OnlineLicenseService = require('../services/OnlineLicenseService');
const validate = require('../middleware/validate');
const {
    activateLicenseSchema,
    generateLicenseSchema,
    syncOnlineLicenseSchema,
    onlineConfigSchema
} = require('../schemas/licenseSchema');
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
        const { isSessionValid } = require('../utils/sessionRegistry');
        if (!isSessionValid(dbUser.currentSessionId, decoded.sessionId)) {
            return null;
        }

        const role = String(dbUser.role || '').toLowerCase();
        const isMasterUser = ['superadmin', 'owner', 'dueño', 'master'].includes(role);
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
    const { resolveMobileDistributionFile } = require('../utils/mobileDistributionPaths');
    const resolvedApk = resolveMobileDistributionFile(['Isaac-POS-Mobile.apk', 'Isaac-POS.apk'], {
        baseDir: path.join(__dirname, '..')
    });
    if (resolvedApk) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        return res.download(resolvedApk, 'Isaac-POS-Mobile.apk');
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
 * Resuelve el registro de licencia vigente para una terminal (propia o heredada del servidor),
 * detectando estados suspendidos/revocados y evitando empates de timestamp con licencias antiguas reemplazadas.
 */
async function resolveEffectiveLicenseState(terminalId, serverMachineId) {
    const isServerHost = terminalId === serverMachineId;

    const findLatestForMachine = async (targetId) => {
        const activeOrSuspended = await License.findOne({
            where: {
                machineId: targetId,
                status: { [Op.in]: ['active', 'suspended'] }
            },
            order: [['createdAt', 'DESC'], ['updatedAt', 'DESC']]
        });
        if (activeOrSuspended) return activeOrSuspended;

        return License.findOne({
            where: { machineId: targetId },
            order: [['createdAt', 'DESC'], ['updatedAt', 'DESC']]
        });
    };

    const isRemoteBlockedRecord = (record) => {
        if (!record) return false;
        if (record.status === 'suspended') return true;
        return record.status === 'revoked' && record.meta?.onlineLease?.status === 'revoked';
    };

    let invalidMessage = null;
    const terminalRecord = await findLatestForMachine(terminalId);
    if (terminalRecord) {
        if (isRemoteBlockedRecord(terminalRecord)) {
            return {
                record: terminalRecord,
                effectiveMachineId: terminalId,
                isInheritedFromServer: false,
                blockedByStatus: true,
                invalidMessage: null
            };
        }
        if (terminalRecord.status === 'active') {
            const validation = await licenseUtils.validateKey(terminalRecord.licenseKey, terminalId);
            if (validation.valid) {
                return {
                    record: terminalRecord,
                    effectiveMachineId: terminalId,
                    isInheritedFromServer: false,
                    blockedByStatus: false,
                    invalidMessage: null
                };
            }
            invalidMessage = validation.message || 'Licencia inválida o expirada.';
        }
    }

    if (!isServerHost) {
        const serverRecord = await findLatestForMachine(serverMachineId);
        if (serverRecord) {
            if (isRemoteBlockedRecord(serverRecord)) {
                return {
                    record: serverRecord,
                    effectiveMachineId: serverMachineId,
                    isInheritedFromServer: true,
                    blockedByStatus: true,
                    invalidMessage: null
                };
            }
            if (serverRecord.status === 'active') {
                const serverValidation = await licenseUtils.validateKey(serverRecord.licenseKey, serverMachineId);
                if (serverValidation.valid) {
                    return {
                        record: serverRecord,
                        effectiveMachineId: serverMachineId,
                        isInheritedFromServer: true,
                        blockedByStatus: false,
                        invalidMessage: null
                    };
                }
            }
        }
    }

    return {
        record: null,
        effectiveMachineId: isServerHost ? serverMachineId : terminalId,
        isInheritedFromServer: false,
        blockedByStatus: false,
        invalidMessage
    };
}

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
        let resolved = await resolveEffectiveLicenseState(terminalId, serverMachineId);

        if ((req.query.forceSync === '1' || req.query.sync === '1') && OnlineLicenseService.getGatewayUrl()) {
            const syncTargetId = resolved.record ? resolved.effectiveMachineId : serverMachineId;
            await OnlineLicenseService.syncHeartbeat(syncTargetId).catch(() => null);
            resolved = await resolveEffectiveLicenseState(terminalId, serverMachineId);
        }

        if (!resolved.record) {
            return res.json({
                activated: false,
                machineId: terminalId,
                serverMachineId,
                isServerHost,
                isTerminal: !isServerHost,
                gatewayConfigured: Boolean(OnlineLicenseService.getGatewayUrl()),
                message: resolved.invalidMessage || (isServerHost
                    ? 'El servidor central no cuenta con una licencia activa.'
                    : 'Terminal no autorizada. El servidor central requiere una licencia activa.')
            });
        }

        const { record: activeLicense, effectiveMachineId, isInheritedFromServer, blockedByStatus } = resolved;

        if (blockedByStatus) {
            const reason = activeLicense.meta?.onlineLease?.reason
                || activeLicense.meta?.suspendedReason
                || (activeLicense.status === 'revoked'
                    ? 'Licencia revocada por el proveedor.'
                    : 'Licencia suspendida por el proveedor.');
            return res.json({
                activated: false,
                suspended: true,
                revoked: activeLicense.status === 'revoked',
                blockLocalBypass: true,
                status: activeLicense.status,
                reason,
                expiresAt: activeLicense.expiresAt,
                machineId: terminalId,
                serverMachineId,
                isServerHost,
                isTerminal: !isServerHost,
                isInherited: isInheritedFromServer,
                gatewayConfigured: Boolean(OnlineLicenseService.getGatewayUrl()),
                message: reason
            });
        }

        const policy = OnlineLicenseService.evaluateLocalLicenseWithOnlinePolicy(activeLicense, effectiveMachineId);
        if (!policy.allowed) {
            return res.json({
                activated: false,
                suspended: Boolean(policy.suspended),
                revoked: policy.status === 'revoked',
                graceExpired: Boolean(policy.graceExpired),
                clockSkew: Boolean(policy.clockSkew),
                blockLocalBypass: true,
                status: policy.status || 'blocked',
                errorCode: policy.code,
                reason: policy.reason,
                graceUntil: policy.graceUntil || null,
                expiresAt: activeLicense.expiresAt,
                machineId: terminalId,
                serverMachineId,
                isServerHost,
                isTerminal: !isServerHost,
                isInherited: isInheritedFromServer,
                onlinePolicy: policy,
                gatewayConfigured: Boolean(OnlineLicenseService.getGatewayUrl()),
                message: policy.reason || 'Verificación en línea requerida.'
            });
        }

        res.json({
            activated: true,
            expiresAt: activeLicense.expiresAt,
            machineId: terminalId,
            serverMachineId,
            isServerHost,
            isTerminal: !isServerHost,
            isInherited: isInheritedFromServer,
            onlinePolicy: policy,
            gatewayConfigured: Boolean(OnlineLicenseService.getGatewayUrl()),
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
router.post('/activate', activateLimiter, validate(activateLicenseSchema), async (req, res) => {
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
            if (OnlineLicenseService.getGatewayUrl()) {
                OnlineLicenseService.syncHeartbeat(terminalId).catch(() => {});
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

        // Anti-bypass de suspensión remota: impedir re-activar pegando la misma llave (o una más antigua) cuando la terminal está suspendida/revocada remotamente
        const suspendedOrRevokedLic = await License.findOne({
            where: {
                machineId: terminalId,
                status: { [Op.in]: ['suspended', 'revoked'] }
            },
            order: [['updatedAt', 'DESC'], ['createdAt', 'DESC']]
        });
        const existingRemoteStatus = String(existingLicense?.meta?.onlineLease?.status || '').toLowerCase();
        const existingIsRemotelySuspended = existingRemoteStatus === 'suspended' || existingRemoteStatus === 'revoked';
        const candidateBlockedLic = existingIsRemotelySuspended
            ? existingLicense
            : (!existingLicense ? suspendedOrRevokedLic : null);

        if (candidateBlockedLic) {
            const remoteStatus = String(candidateBlockedLic.meta?.onlineLease?.status || '').toLowerCase();
            const isReplacementRevoke = Boolean(candidateBlockedLic.meta?.replacedByActivation) && candidateBlockedLic.status === 'revoked' && remoteStatus !== 'suspended' && remoteStatus !== 'revoked';
            const isLockedStatus = !isReplacementRevoke && (
                candidateBlockedLic.status === 'suspended'
                || candidateBlockedLic.status === 'revoked'
                || remoteStatus === 'suspended'
                || remoteStatus === 'revoked'
            );
            if (isLockedStatus) {
                const sameKeyReuse = String(candidateBlockedLic.licenseKey || '').trim() === key.trim();
                const suspendedAtMs = Number(candidateBlockedLic.meta?.onlineLease?.serverTime)
                    || Date.parse(candidateBlockedLic.updatedAt || 0)
                    || 0;
                const incomingIatMs = Number(validation.claims?.iat || 0);
                const isNewerAuthorizedKey = !sameKeyReuse && incomingIatMs > suspendedAtMs;
                if (sameKeyReuse || !isNewerAuthorizedKey) {
                    return res.status(403).json({
                        error: 'La licencia de esta terminal fue suspendida o revocada. Solicite la reactivación remota al proveedor o ingrese una nueva llave emitida posteriormente.',
                        suspended: true,
                        code: 'licencia_suspendida_reuso'
                    });
                }
            }
        }

        // Deactivate previous active licenses for THIS specific terminal (marcando reemplazo administrativo)
        const prevActives = await License.findAll({
            where: { machineId: terminalId, status: 'active' }
        });
        for (const prev of prevActives) {
            await prev.update({
                status: 'revoked',
                meta: { ...(prev.meta || {}), replacedByActivation: true, replacedAt: new Date().toISOString() }
            });
        }

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
        if (OnlineLicenseService.getGatewayUrl()) {
            OnlineLicenseService.syncHeartbeat(terminalId).catch(() => {});
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
router.post('/generate', verifyToken, isMaster, validate(generateLicenseSchema), async (req, res) => {
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
router.post('/test-generate', verifyToken, isMaster, validate(generateLicenseSchema), async (req, res) => {
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
 * POST /license/sync-online
 * Forces an immediate heartbeat check against the configured remote License Gateway.
 */
router.post('/sync-online', activateLimiter, validate(syncOnlineLicenseSchema), async (req, res) => {
    try {
        const serverMachineId = await licenseUtils.getMachineId();
        const rawTerminalId = req.body?.machineId || req.query?.terminalId || req.headers['x-terminal-id'] || serverMachineId;
        const terminalId = String(rawTerminalId).trim().slice(0, 128) || serverMachineId;

        const gatewayUrl = OnlineLicenseService.getGatewayUrl();
        if (!gatewayUrl) {
            return res.json({
                success: false,
                skipped: true,
                gatewayConfigured: false,
                machineId: terminalId,
                reason: 'Gateway de licencias en línea no configurado.'
            });
        }

        const resolved = await resolveEffectiveLicenseState(terminalId, serverMachineId);
        const targetMachineId = resolved.record ? resolved.effectiveMachineId : serverMachineId;
        const syncResult = await OnlineLicenseService.syncHeartbeat(targetMachineId);
        const refreshed = await resolveEffectiveLicenseState(terminalId, serverMachineId);
        const policy = refreshed.record && refreshed.record.status === 'active'
            ? OnlineLicenseService.evaluateLocalLicenseWithOnlinePolicy(refreshed.record, refreshed.effectiveMachineId)
            : null;

        const effectiveStatus = syncResult.status || refreshed.record?.status || 'unknown';
        const effectiveReason = syncResult.reason || refreshed.record?.meta?.onlineLease?.reason || policy?.reason || null;

        return res.json({
            success: Boolean(syncResult.success),
            offline: Boolean(syncResult.offline),
            tampered: Boolean(syncResult.tampered),
            skipped: Boolean(syncResult.skipped),
            gatewayConfigured: true,
            machineId: terminalId,
            targetMachineId,
            status: effectiveStatus,
            suspended: effectiveStatus === 'suspended' || effectiveStatus === 'revoked' || Boolean(policy?.suspended),
            allowed: Boolean(refreshed.record && !refreshed.blockedByStatus && (policy ? policy.allowed : false)),
            reason: effectiveReason,
            graceUntil: syncResult.graceUntil || policy?.graceUntil || null,
            error: syncResult.error || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /license/online-config
 * Returns current remote License Gateway configuration (Master only)
 */
router.get('/online-config', verifyToken, isMaster, async (req, res) => {
    try {
        const serverMachineId = await licenseUtils.getMachineId();
        res.json({
            success: true,
            gatewayUrl: OnlineLicenseService.getGatewayUrl(),
            graceDays: OnlineLicenseService.getDefaultGraceDays(),
            serverMachineId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /license/online-config
 * Saves remote License Gateway URL in local config (Master only)
 */
router.post('/online-config', verifyToken, isMaster, validate(onlineConfigSchema), async (req, res) => {
    try {
        const rawUrl = typeof req.body?.gatewayUrl === 'string' ? req.body.gatewayUrl.trim() : '';
        const lockedGateway = String(process.env.LOCKED_LICENSE_GATEWAY_URL || '').trim();
        if (lockedGateway && rawUrl !== lockedGateway) {
            const vendorSecret = String(process.env.VENDOR_MASTER_KEY || process.env.OWNER_SECRET_KEY || '').trim();
            const providedSecret = String(req.body?.vendorSecret || req.headers['x-vendor-secret'] || '').trim();
            if (!vendorSecret || !providedSecret || !safeEqualSecret(providedSecret, vendorSecret)) {
                return res.status(403).json({
                    error: 'El Gateway de licencias en línea está fijado por política del proveedor y no puede modificarse ni desactivarse sin autorización del proveedor.'
                });
            }
        }
        if (rawUrl) {
            let parsed;
            try {
                parsed = new URL(rawUrl);
            } catch (_) {
                return res.status(400).json({ error: 'URL de Gateway inválida.' });
            }
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return res.status(400).json({ error: 'El Gateway debe usar protocolo HTTP o HTTPS.' });
            }
        }

        const savedUrl = OnlineLicenseService.saveGatewayUrl(rawUrl);
        if (typeof clearLicenseCache === 'function') {
            clearLicenseCache();
        }

        res.json({
            success: true,
            gatewayUrl: savedUrl,
            message: savedUrl
                ? 'Gateway de licencias en línea guardado correctamente.'
                : 'Gateway en línea desactivado (modo offline puro).'
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

