let LicenseModel = null;
const getLicenseModel = () => {
    if (!LicenseModel) {
        LicenseModel = require('../database/models').License;
    }
    return LicenseModel;
};
const licenseUtils = require('../utils/licenseUtils');

// Memory Cache for Terminal Licenses
const terminalLicenseCache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutos

/**
 * Middleware to verify license status per terminal
 * Blocks API requests if terminal license is missing, invalid or expired
 * Features: Regex-based strict exemption, per-terminal isolation and TTL Memoization.
 */
const verifyLicense = async (req, res, next) => {
    // Exempt routes (activation, health check, business info and mobile sync)
    const isExactExempt = ['/license/status', '/license/activate', '/hello', '/settings/business', '/settings/is-setup', '/version.json', '/dist.zip', '/api/app-update-info', '/Isaac-POS-Mobile.apk', '/settings/rate'].includes(req.path);
    const isAuthRoute = req.path.startsWith('/auth/') && !req.path.endsWith('/public-cashiers'); 
    // Strict regex to prevent spoofing with `/public-something` anywhere in the path
    const isPublicSync = /^\/[a-zA-Z0-9_-]+\/public-/.test(req.path);

    if (isExactExempt || isAuthRoute || isPublicSync) {
        return next();
    }

    try {
        const now = Date.now();
        const serverMachineId = await licenseUtils.getMachineId();
        const rawIp = req.ip || req.connection?.remoteAddress || '';
        const clientIp = rawIp.replace('::ffff:', '');
        const isLocalHost = clientIp === '127.0.0.1' || clientIp === '::1' || req.hostname === 'localhost';

        let terminalId = req.headers['x-terminal-id'] || req.query.terminalId;
        if (!terminalId) {
            const ipSuffix = clientIp.replace(/[^0-9]/g, '').slice(-4) || 'CLIENT';
            terminalId = isLocalHost ? serverMachineId : `TERM-MOB-${ipSuffix}`;
        }

        // Return immediately only if cache is fresh AND license has not passed expiresAt
        const cached = terminalLicenseCache.get(terminalId);
        const cachedExpiresMs = cached?.license?.expiresAt ? new Date(cached.license.expiresAt).getTime() : null;
        if (cached && (now - cached.cachedAt) < CACHE_TTL && (!cachedExpiresMs || cachedExpiresMs > now)) {
            req.license = cached.license;
            req.isInheritedLicense = Boolean(cached.isInherited);
            return next();
        }
        if (cached && cachedExpiresMs && cachedExpiresMs <= now) {
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

        // 2. Si la terminal no tiene licencia individual, verificar si el Servidor Principal tiene licencia activa válida
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

        if (!activeLicense) {
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
        }

        // Update Cache
        terminalLicenseCache.set(terminalId, {
            license: activeLicense,
            isInherited: isInheritedFromServer,
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
