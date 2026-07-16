const { License } = require('../database/models');
const licenseUtils = require('../utils/licenseUtils');

// Memory Cache for License
let licenseCache = null;
let lastCheckTime = 0;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutos

/**
 * Middleware to verify license status
 * Blocks API requests if license is missing, invalid or expired
 * Features: Regex-based strict exemption and TTL Memoization.
 */
const verifyLicense = async (req, res, next) => {
    // Exempt routes (activation, health check, and mobile sync)
    const isExactExempt = ['/license/status', '/license/activate', '/license/force-activate', '/hello'].includes(req.path);
    const isAuthRoute = req.path.startsWith('/auth/'); 
    // Strict regex to prevent spoofing with `/public-something` anywhere in the path
    const isPublicSync = /^\/[a-zA-Z0-9_-]+\/public-/.test(req.path);

    if (isExactExempt || isAuthRoute || isPublicSync) {
        return next();
    }

    try {
        const now = Date.now();
        // Return immediately if cache is valid to save I/O and CPU
        if (licenseCache && (now - lastCheckTime) < CACHE_TTL) {
            req.license = licenseCache;
            return next();
        }

        const activeLicense = await License.findOne({
            where: { status: 'active' }
        });

        if (!activeLicense) {
            licenseCache = null;
            return res.status(403).json({
                error: 'licencia_requerida',
                message: 'El sistema no cuenta con una licencia activa.',
                machineId: await licenseUtils.getMachineId()
            });
        }

        const validation = await licenseUtils.validateKey(activeLicense.licenseKey);

        if (!validation.valid) {
            licenseCache = null;
            return res.status(403).json({
                error: 'licencia_invalida',
                message: validation.message,
                machineId: await licenseUtils.getMachineId()
            });
        }

        // Update Cache
        licenseCache = activeLicense;
        lastCheckTime = now;

        // License is valid, proceed
        req.license = activeLicense;
        next();
    } catch (error) {
        console.error('LicenseMiddleware Error:', error);
        res.status(500).json({ error: 'error_interno_licencia', message: 'Error al verificar la licencia' });
    }
};

module.exports = { verifyLicense };
