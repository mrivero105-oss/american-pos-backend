const jwt = require('jsonwebtoken');
const path = require('path');

// 🔒 SECURITY: JWT_SECRET stability between dev and production environments
const STABLE_FALLBACK = 'f9921db9-be93-4469-b0ea-b0436a1017d6';
const FINAL_SECRET = process.env.JWT_SECRET || STABLE_FALLBACK;

if (!process.env.JWT_SECRET) {
    console.warn('⚠️ WARNING: JWT_SECRET environment variable is NOT SET. Using stable fallback for production stability.');
}

const verifyToken = async (req, res, next) => {
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
        req.path === '/license/status' ||
        req.path === '/license/activate' ||
        req.path.startsWith('/reset-password') ||
        req.path.endsWith('/public-list') || 
        req.path.endsWith('/public-sync') ||
        req.path.replace(/\/$/, '') === '/auth/login') { 
        
        // --- PUBLIC IDENTITY FAILSAFE ---
        // Even if the route is public, we try to identify the company/user context
        // to prevent 500 errors in downstream services that expect req.user.companyId
        
        const authHeader = req.headers['authorization'];
        const companyIdHeader = req.headers['x-company-id'];
        
        if (authHeader) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, FINAL_SECRET);
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
    if (authHeader) {
        token = authHeader.split(' ')[1];
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
