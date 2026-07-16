const jwt = require('jsonwebtoken');
const path = require('path');

// 🔒 SECURITY: Strict JWT_SECRET validation
const FINAL_SECRET = process.env.JWT_SECRET;
if (!FINAL_SECRET) {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be defined in environment. Refusing to start.');
}

const extractBearerToken = (authHeader) => {
    if (!authHeader || typeof authHeader !== 'string') return null;
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
        return parts[1];
    }
    return null;
};

const verifyToken = async (req, res, next) => {
    if (req.path.endsWith('/public-sync')) {
        const companyId = req.headers['x-company-id'];
        const branchId = req.headers['x-branch-id'] || companyId || '1';
        const timestamp = req.headers['x-sync-timestamp'];
        const signature = req.headers['x-sync-signature'];

        const authHeader = req.headers['authorization'];
        const extractedToken = extractBearerToken(authHeader);
        if (extractedToken) {
            try {
                const decoded = jwt.verify(extractedToken, FINAL_SECRET);
                req.user = decoded;
                if (!req.user.companyId) {
                    req.user.companyId = companyId || 'default';
                }
                return next();
            } catch (e) {
                return res.status(401).json({ error: 'Token inválido para sincronización' });
            }
        }

        if (!companyId || !timestamp || !signature) {
            return res.status(401).json({ error: 'Sincronización no autorizada: firma HMAC requerida' });
        }

        const SecurityHelper = require('../services/SecurityHelper');
        const isValid = SecurityHelper.verifySignature(
            req.body,
            companyId,
            branchId,
            timestamp,
            signature
        );

        if (!isValid) {
            return res.status(401).json({ error: 'Firma HMAC inválida o expirada' });
        }

        req.user = {
            companyId,
            role: 'anonymous_sync',
            name: `Dispositivo Móvil (Sucursal ${branchId})`,
            activeBranchId: branchId
        };
        return next();
    }

    // Bloquear acceso público a listas
    if (req.path.endsWith('/public-list') && !req.headers.authorization) {
        return res.status(401).json({ error: 'Acceso denegado. Se requiere autenticación.' });
    }

    // 1. Define SPA frontend routes
    const spaRoutes = [
        '/', '/dashboard', '/pos', '/inventory', '/customers',
        '/sales-history', '/settings', '/users', '/expenses',
        '/reports', '/audit', '/suppliers', '/purchase-orders',
        '/branches', '/quotations', '/history', '/recibo', '/login'
    ];

    const isSpaRoute = spaRoutes.includes(req.path);
    const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');

    // DEBUG: Log path for debugging 401 issues
    console.log(`[AUTH-DEBUG] Path: ${req.path}, Method: ${req.method}`);

    // RULE A: Browser Navigation (F5 / Direct URL) -> Serve Frontend
    if (isSpaRoute && acceptsHtml) {
        return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }

    // RULE B: Public Assets & Explicit Public API Endpoints -> Skip Token but Set Identity
    if (req.path === '/index.html' ||
        req.path === '/sw.js' ||
        req.path === '/manifest.json' ||
        req.path.startsWith('/assets/') ||
        req.path.startsWith('/js/') ||
        req.path.startsWith('/css/') ||
        req.path.startsWith('/fonts/') ||
        req.path.startsWith('/product_images/') ||
        req.path.startsWith('/img/') ||
        req.path === '/hello' ||
        req.path === '/auth/login' ||
        req.path === '/auth/me' ||
        (req.method === 'GET' && req.path === '/settings/business') ||
        req.path === '/license/status' ||
        req.path === '/license/activate' ||
        req.path.startsWith('/reset-password') ||
        req.path.replace(/\/$/, '') === '/auth/login') { 
        
        // --- PUBLIC IDENTITY FAILSAFE ---
        // Even if the route is public, we try to identify the company/user context
        // to prevent 500 errors in downstream services that expect req.user.companyId
        
        const authHeader = req.headers['authorization'];
        const extractedToken = extractBearerToken(authHeader) || (req.cookies && req.cookies.authToken) || req.query.token;
        const companyIdHeader = req.headers['x-company-id'];
        
        if (extractedToken) {
            try {
                const decoded = jwt.verify(extractedToken, FINAL_SECRET);
                req.user = decoded;
            } catch (e) { /* ignore invalid tokens on public routes */ }
        }

        // If no token, use the explicit header
        if (!req.user && companyIdHeader) {
            req.user = { companyId: companyIdHeader, role: 'anonymous_sync' };
        }

        // Final fallback to default to avoid crashes
        if (!req.user) {
            req.user = { companyId: 'default' };
        }

        return next();
    }

    // RULE C: Everything else (including API calls to SPA paths) -> Strict Token Check
    let token = null;

    const authHeader = req.headers['authorization'];
    const extractedToken = extractBearerToken(authHeader);
    if (extractedToken) {
        token = extractedToken;
    } else if (req.cookies && req.cookies.authToken) {
        token = req.cookies.authToken;
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        console.warn(`[AUTH] 401 Unauthorized: No token provided for path ${req.path}`);
        return res.status(401).json({ error: 'No autenticado o token inválido' });
    }

    // 3. Verify Token
    try {
        const decoded = jwt.verify(token, FINAL_SECRET);
        req.user = decoded;

        // REAL-TIME DB CHECK: Ensure user is still active in the database
        if (decoded.id && decoded.role !== 'anonymous_sync') {
            const { User } = require('../database/models');
            const dbUser = await User.findByPk(decoded.id, { attributes: ['status'] });
            if (!dbUser || dbUser.status !== 'active') {
                console.warn(`[AUTH] 401 Unauthorized: User ${decoded.id} is deleted or inactive.`);
                return res.status(401).json({ error: 'Tu cuenta ha sido desactivada o eliminada' });
            }
        }

        // RULE D: Hardware ID (Machine ID) Binding
        // If the token has a mid (machineId), it MUST match the current machine
        if (decoded.mid) {
            const licenseUtils = require('../utils/licenseUtils');
            const currentMid = await licenseUtils.getMachineId();
            if (decoded.mid !== currentMid) {
                console.warn(`[AUTH] 401 Unauthorized: Machine ID mismatch. Token MID: ${decoded.mid}, Current MID: ${currentMid}`);
                return res.status(401).json({ 
                    error: 'dispositivo_no_autorizado',
                    message: 'Esta sesión pertenece a otro equipo.' 
                });
            }
        }

        // Failsafe for older tokens or specific cases
        if (!req.user.companyId) {
            req.user.companyId = 'default';
        }

        return next();
    } catch (err) {
        console.error(`[AUTH] 401 Unauthorized: Token verification failed for path ${req.path}. Error: ${err.message}`);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

const isAdmin = (req, res, next) => {
    const role = req.user?.role?.toLowerCase();
    if (req.user && (role === 'admin' || role === 'superadmin')) {
        return next();
    }
    console.warn(`Access denied for user ${req.user?.email} with role: ${req.user?.role}`);
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de administrador' });
};

const isSuperAdmin = (req, res, next) => {
    const role = req.user?.role?.toLowerCase();
    if (req.user && role === 'superadmin') {
        return next();
    }
    console.warn(`SuperAdmin access denied for user ${req.user?.email} with role: ${req.user?.role}`);
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de DUEÑO (Superadmin)' });
};

const isMaster = (req, res, next) => {
    const role = req.user?.role?.toLowerCase();
    if (req.user && role === 'superadmin') {
        return next();
    }
    console.warn(`Master access denied for user ${req.user?.email} with role: ${req.user?.role}`);
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de DUEÑO (Superadmin)' });
};

module.exports = {
    verifyToken,
    isAdmin,
    isSuperAdmin,
    isMaster
};
