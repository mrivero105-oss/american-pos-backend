let LicenseModel = null;
const getLicenseModel = () => {
    if (!LicenseModel) {
        LicenseModel = require('../database/models').License;
    }
    return LicenseModel;
};
const { Op } = require('sequelize');
const licenseUtils = require('../utils/licenseUtils');

let OnlineLicenseServiceRef = null;
const getOnlineLicenseService = () => {
    if (!OnlineLicenseServiceRef) {
        OnlineLicenseServiceRef = require('../services/OnlineLicenseService');
    }
    return OnlineLicenseServiceRef;
};

// Memory Cache for Terminal Licenses
const terminalLicenseCache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutos

/**
 * Middleware to verify license status per terminal
 * Blocks API requests if terminal license is missing, invalid or expired
 * Features: Regex-based strict exemption, per-terminal isolation and TTL Memoization.
 */
const verifyLicense = async (req, res, next) => {
    // Exempt routes (activation, health check, business info, OTA artifacts and public catalog read-only)
    const isExactExempt = ['/license/status', '/license/activate', '/license/sync-online', '/hello', '/settings/business', '/settings/is-setup', '/version.json', '/dist.zip', '/api/app-update-info', '/Isaac-POS-Mobile.apk', '/settings/rate', '/sync/cloud-client-config'].includes(req.path);
    const isAuthRoute = req.path.startsWith('/auth/') && !req.path.endsWith('/public-cashiers'); 
    // Allowlist explícita mínima (eliminada exención blanket /*/public-* para que public-sync y pagos respeten la licencia)
    const isExplicitPublicCatalog = req.method === 'GET' && req.path === '/products/public-catalog';

    if (isExactExempt || isAuthRoute || isExplicitPublicCatalog) {
        return next();
    }

    try {
        const now = Date.now();
        const serverMachineId = await licenseUtils.getMachineId();
        const rawIp = req.ip || req.connection?.remoteAddress || '';
        const clientIp = rawIp.replace('::ffff:', '');
        // Nunca confiar en req.hostname (cabecera Host spoofeable desde la LAN); solo IP loopback real
        const isLocalHost = clientIp === '127.0.0.1' || clientIp === '::1';

        let terminalId = req.headers['x-terminal-id'] || req.query.terminalId;
        if (!terminalId) {
            const ipSuffix = clientIp.replace(/[^0-9]/g, '').slice(-4) || 'CLIENT';
            terminalId = isLocalHost ? serverMachineId : `TERM-MOB-${ipSuffix}`;
        }

        // Return immediately only if cache is fresh AND license has not passed expiresAt / offline graceUntil
        const cached = terminalLicenseCache.get(terminalId);
        const cachedExpiresMs = cached?.license?.expiresAt ? new Date(cached.license.expiresAt).getTime() : null;
        const cachedGraceMs = cached?.graceUntilMs || null;
        if (
            cached &&
            (now - cached.cachedAt) < CACHE_TTL &&
            (!cachedExpiresMs || cachedExpiresMs > now) &&
            (!cachedGraceMs || cachedGraceMs > now)
        ) {
            req.license = cached.license;
            req.isInheritedLicense = Boolean(cached.isInherited);
            return next();
        }
        if (cached && ((cachedExpiresMs && cachedExpiresMs <= now) || (cachedGraceMs && cachedGraceMs <= now))) {
            terminalLicenseCache.delete(terminalId);
        }

        const isServerHost = terminalId === serverMachineId;

        // 1. Buscar licencia activa para esta terminal específica
        const License = getLicenseModel();
        let activeLicense = await License.findOne({
            where: { 
                machineId: terminalId,
                status: 'active' 
            },
            order: [['createdAt', 'DESC']]
        });

        // 1b. Antes de permitir herencia del servidor, verificar si ESTA terminal fue suspendida o revocada explícitamente
        if (!activeLicense && !isServerHost) {
            const ownBlockedLicense = await License.findOne({
                where: {
                    machineId: terminalId,
                    status: { [Op.in]: ['suspended', 'revoked'] }
                },
                order: [['updatedAt', 'DESC'], ['createdAt', 'DESC']]
            });
            if (ownBlockedLicense) {
                const suspEval = getOnlineLicenseService().evaluateLocalLicenseWithOnlinePolicy(
                    ownBlockedLicense,
                    ownBlockedLicense.machineId,
                    now
                );
                terminalLicenseCache.delete(terminalId);
                return res.status(403).json({
                    error: 'licencia_suspendida',
                    suspended: true,
                    status: ownBlockedLicense.status,
                    reason: suspEval.reason,
                    message: suspEval.reason,
                    machineId: terminalId,
                    serverMachineId
                });
            }
        }

        // 2. Si la terminal no tiene licencia individual, verificar si el Servidor Principal tiene licencia activa válida
        let isInheritedFromServer = false;
        let validatedClaims = null;
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
                    validatedClaims = serverValidation.claims || null;
                }
            }
        }

        if (!activeLicense) {
            const suspendedLicense = await License.findOne({
                where: {
                    machineId: { [Op.in]: [terminalId, serverMachineId] },
                    status: { [Op.in]: ['suspended', 'revoked'] }
                },
                order: [['createdAt', 'DESC']]
            });
            if (suspendedLicense) {
                const suspEval = getOnlineLicenseService().evaluateLocalLicenseWithOnlinePolicy(
                    suspendedLicense,
                    suspendedLicense.machineId,
                    now
                );
                terminalLicenseCache.delete(terminalId);
                return res.status(403).json({
                    error: 'licencia_suspendida',
                    suspended: true,
                    status: suspendedLicense.status,
                    reason: suspEval.reason,
                    message: suspEval.reason,
                    machineId: terminalId,
                    serverMachineId
                });
            }

            terminalLicenseCache.delete(terminalId);
            return res.status(403).json({
                error: 'licencia_requerida',
                message: isServerHost 
                    ? 'El servidor principal no cuenta con una licencia activa.'
                    : 'Terminal no autorizada. El servidor principal no cuenta con una licencia activa.',
                machineId: terminalId,
                serverMachineId: serverMachineId
            });
        }

        // 3. Validar criptográficamente si la licencia es propia de la terminal
        const effectiveMachineId = isInheritedFromServer ? serverMachineId : terminalId;
        if (!isInheritedFromServer) {
            const targetValidateId = isServerHost ? serverMachineId : terminalId;
            const validation = await licenseUtils.validateKey(activeLicense.licenseKey, targetValidateId);

            if (!validation.valid) {
                terminalLicenseCache.delete(terminalId);
                return res.status(403).json({
                    error: 'licencia_invalida',
                    message: validation.message || 'La licencia actual no es válida para este equipo.',
                    machineId: terminalId,
                    serverMachineId: serverMachineId
                });
            }
            validatedClaims = validation.claims || null;
        }

        // 3b. Enforcement real de plan/tier firmado en la licencia RSA v2 (si la llave define restricciones)
        if (!isServerHost && validatedClaims) {
            const planStr = String(validatedClaims.plan || '').toLowerCase();
            if (validatedClaims.allowMobile === false || planStr === 'pc_only' || planStr === 'single_pc') {
                terminalLicenseCache.delete(terminalId);
                return res.status(403).json({
                    error: 'plan_no_permite_terminales',
                    message: 'Tu plan de licencia actual solo autoriza la caja principal PC. Actualiza tu plan para conectar terminales móviles o cajas LAN.',
                    plan: validatedClaims.plan || 'pc_only',
                    machineId: terminalId,
                    serverMachineId
                });
            }
        }

        // 4. Evaluar política de validación / gracia offline en línea (leases firmados RSA)
        const onlineCheck = getOnlineLicenseService().evaluateLocalLicenseWithOnlinePolicy(
            activeLicense,
            effectiveMachineId,
            now
        );
        if (!onlineCheck.allowed) {
            terminalLicenseCache.delete(terminalId);
            return res.status(403).json({
                error: onlineCheck.code || 'licencia_verificacion_requerida',
                suspended: Boolean(onlineCheck.suspended),
                graceExpired: Boolean(onlineCheck.graceExpired),
                status: onlineCheck.status || 'suspended',
                reason: onlineCheck.reason,
                message: onlineCheck.reason,
                graceUntil: onlineCheck.graceUntil || null,
                machineId: terminalId,
                serverMachineId
            });
        }

        // Update Cache
        terminalLicenseCache.set(terminalId, {
            license: activeLicense,
            isInherited: isInheritedFromServer,
            graceUntilMs: onlineCheck.graceUntil ? Date.parse(onlineCheck.graceUntil) : null,
            cachedAt: now
        });

        // License is valid, proceed
        req.license = activeLicense;
        req.isInheritedLicense = isInheritedFromServer;
        next();
    } catch (error) {
        console.error('LicenseMiddleware Error:', error);
        res.status(500).json({ error: 'error_interno_licencia', message: 'Error al verificar la licencia' });
    }
};

const clearLicenseCache = (terminalId = null) => {
    if (terminalId) {
        terminalLicenseCache.delete(terminalId);
    } else {
        terminalLicenseCache.clear();
    }
};

module.exports = { verifyLicense, clearLicenseCache };
