const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { runWithTenantContext } = require('../database/tenantContext');
const {
    isPlatformSuperAdminRole,
    isCompanyOwnerRole,
    isCompanyAdminRole
} = require('../constants/roles');
const { isSessionValid } = require('../utils/sessionRegistry');

// 🔒 SECURITY: Strict JWT_SECRET validation
const FINAL_SECRET = process.env.JWT_SECRET;
if (!FINAL_SECRET) {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be defined in environment. Refusing to start.');
}

const safeSecretEqual = (a, b) => {
    if (!a || !b) return false;
    const hashA = crypto.createHash('sha256').update(String(a), 'utf8').digest();
    const hashB = crypto.createHash('sha256').update(String(b), 'utf8').digest();
    return crypto.timingSafeEqual(hashA, hashB);
};

const wrapTenantNext = (req, next) => {
    return runWithTenantContext({
        companyId: req.user?.companyId || '',
        userId: req.user?.id || '',
        isSuperAdmin: isPlatformSuperAdminRole(req.user?.role)
    }, () => next());
};

const extractBearerToken = (authHeader) => {
    if (!authHeader || typeof authHeader !== 'string') return null;
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
        return parts[1];
    }
    return null;
};

const verifyJwtResilient = (tokenToVerify) => {
    const secrets = [
        FINAL_SECRET,
        process.env.LEGACY_HMAC_SECRET
    ].filter(Boolean);

    for (const sec of secrets) {
        try {
            return jwt.verify(tokenToVerify, sec, { algorithms: ['HS256'] });
        } catch (_) {}
    }
    throw new Error('Invalid token signature across all known secrets');
};

// ⚡ ULTRA FAST-PATH: In-Memory Authentication Cache (TTL 60s)
// Avoids hammering PostgreSQL / SQLite on every single API request.
const userAuthFastCache = new Map();
const AUTH_CACHE_TTL_MS = 60 * 1000; // 60 seconds

const getCachedUserStatus = (userId) => {
    const entry = userAuthFastCache.get(String(userId));
    if (!entry) return null;
    if (Date.now() - entry.timestamp > AUTH_CACHE_TTL_MS) {
        userAuthFastCache.delete(String(userId));
        return null;
    }
    return entry.data;
};

const setCachedUserStatus = (userId, data) => {
    if (userAuthFastCache.size > 1000) {
        const oldestKey = userAuthFastCache.keys().next().value;
        userAuthFastCache.delete(oldestKey);
    }
    userAuthFastCache.set(String(userId), { timestamp: Date.now(), data });
};

const invalidateUserAuthCache = (userId) => {
    if (userId) {
        userAuthFastCache.delete(String(userId));
    } else {
        userAuthFastCache.clear();
    }
};

const applyUserAuthContext = async (req, decoded) => {
    if (decoded.id && decoded.role !== 'anonymous_sync') {
        let cachedUser = getCachedUserStatus(decoded.id);
        if (!cachedUser) {
            const { User } = require('../database/models');
            const dbUser = await User.findByPk(decoded.id, {
                attributes: ['status', 'permissions', 'role', 'companyId', 'activeBranchId', 'currentSessionId']
            });
            if (!dbUser || dbUser.status !== 'active') {
                invalidateUserAuthCache(decoded.id);
                return { ok: false, status: 401, error: 'Tu cuenta ha sido desactivada o eliminada' };
            }
            let userPerms = dbUser.permissions || decoded.permissions || {};
            if (typeof userPerms === 'string') {
                try { userPerms = JSON.parse(userPerms); } catch (e) { userPerms = {}; }
            }
            cachedUser = {
                status: dbUser.status,
                permissions: userPerms,
                role: dbUser.role || decoded.role,
                companyId: dbUser.companyId,
                activeBranchId: dbUser.activeBranchId || null,
                currentSessionId: dbUser.currentSessionId || null
            };
            setCachedUserStatus(decoded.id, cachedUser);
        }
        if (cachedUser.status !== 'active') {
            invalidateUserAuthCache(decoded.id);
            return { ok: false, status: 401, error: 'Tu cuenta ha sido desactivada o eliminada' };
        }
        const dbSession = cachedUser.currentSessionId ? String(cachedUser.currentSessionId) : '';
        const tokenSession = decoded.sessionId ? String(decoded.sessionId) : '';
        if (!isSessionValid(dbSession, tokenSession)) {
            invalidateUserAuthCache(decoded.id);
            return {
                ok: false,
                status: 401,
                error: dbSession
                    ? 'Sesión revocada o expirada. Inicia sesión nuevamente.'
                    : 'Sesión inválida. Inicia sesión nuevamente.'
            };
        }
        req.user.permissions = cachedUser.permissions;
        req.user.role = cachedUser.role;
        req.user.activeBranchId = cachedUser.activeBranchId || null;
        if (cachedUser.companyId && cachedUser.companyId !== 'default' && cachedUser.companyId !== 'admin' && cachedUser.role !== 'superadmin') {
            req.user.companyId = String(cachedUser.companyId);
        }
    } else {
        req.user.permissions = decoded.permissions || {};
    }
    return { ok: true };
};

const isExplicitPublicRoute = (req) => {
    const reqPath = req.path || '';
    const isStaticAsset = reqPath.startsWith('/assets/') && /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|map|webp)$/i.test(reqPath);
    return (
        reqPath === '/dist.zip' ||
        reqPath === '/version.json' ||
        reqPath.startsWith('/api/app-update-info') ||
        reqPath.endsWith('.apk') ||
        reqPath === '/index.html' ||
        reqPath === '/sw.js' ||
        reqPath === '/manifest.json' ||
        isStaticAsset ||
        reqPath.startsWith('/js/') ||
        reqPath.startsWith('/css/') ||
        reqPath.startsWith('/fonts/') ||
        reqPath.startsWith('/product_images/') ||
        reqPath.startsWith('/supplier_logos/') ||
        reqPath.startsWith('/img/') ||
        reqPath === '/hello' ||
        reqPath === '/auth/login' ||
        reqPath === '/auth/me' ||
        (req.method === 'GET' && (reqPath === '/settings/business' || reqPath === '/api/settings/business')) ||
        (req.method === 'GET' && (reqPath === '/settings/rate' || reqPath === '/api/settings/rate')) ||
        (req.method === 'GET' && (reqPath === '/settings/payment-methods' || reqPath === '/api/settings/payment-methods')) ||
        (req.method === 'GET' && (reqPath === '/settings/pago-movil' || reqPath === '/api/settings/pago-movil')) ||
        (req.method === 'GET' && (reqPath === '/settings/binance' || reqPath === '/api/settings/binance' || reqPath === '/settings/binance/rate' || reqPath === '/api/settings/binance/rate')) ||
        (req.method === 'GET' && (reqPath === '/settings/is-setup' || reqPath === '/api/settings/is-setup')) ||
        reqPath === '/license/status' ||
        reqPath === '/license/activate' ||
        reqPath === '/license/sync-online' ||
        reqPath.startsWith('/reset-password') ||
        reqPath.replace(/\/$/, '') === '/auth/login'
    );
};

const isAllowedSyncKeyRequest = (method, rawPath) => {
    const cleanMethod = String(method || 'GET').toUpperCase();
    const normalizedPath = String(rawPath || '').toLowerCase().replace(/^\/api(?=\/|$)/, '') || '/';

    if (cleanMethod === 'GET') {
        return (
            normalizedPath.startsWith('/sync/') ||
            normalizedPath === '/sync' ||
            normalizedPath === '/products' ||
            normalizedPath.startsWith('/products/') ||
            normalizedPath === '/customers' ||
            normalizedPath.startsWith('/customers/') ||
            normalizedPath === '/sales/remote-held-sales' ||
            normalizedPath.startsWith('/cash/active-terminal') ||
            normalizedPath.startsWith('/remote-scan') ||
            normalizedPath === '/auth/me' ||
            normalizedPath === '/branches'
        );
    }
    if (cleanMethod === 'POST') {
        return (
            normalizedPath === '/sync/push' ||
            normalizedPath === '/sync/offline-sales' ||
            normalizedPath === '/sales/public-sync' ||
            normalizedPath === '/sales/remote-held-sale' ||
            normalizedPath === '/customers' ||
            normalizedPath.startsWith('/remote-scan')
        );
    }
    if (cleanMethod === 'DELETE') {
        return normalizedPath === '/sales/remote-held-sale' || normalizedPath.startsWith('/sales/remote-held-sale/');
    }
    return false;
};

const verifyToken = async (req, res, next) => {
    // 0. Browser Navigation (F5 / Direct URL in address bar) -> Serve SPA HTML immediately
    const spaRoutes = [
        '/', '/dashboard', '/pos', '/inventory', '/customers',
        '/sales-history', '/settings', '/users', '/expenses',
        '/reports', '/audit', '/suppliers', '/purchase-orders',
        '/branches', '/quotations', '/history', '/recibo', '/login',
        '/accounting', '/payroll', '/mobile', '/store',
        '/warehouses', '/promotions', '/cash-register', '/catalog-importer'
    ];
    const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
    const hasAuthHeader = Boolean(req.headers && (req.headers['authorization'] || req.headers['Authorization']));
    const isNavigation = req.method === 'GET' && acceptsHtml && !req.xhr && !req.headers['x-requested-with'] && !hasAuthHeader;
    if (isNavigation && spaRoutes.includes(req.path.toLowerCase())) {
        return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }

    // 0a. Priorizar Token de Sesión Real (Bearer) si está presente
    const authHeader = req.headers ? (req.headers['authorization'] || req.headers['Authorization']) : null;
    const bearerToken = extractBearerToken(authHeader);
    const extractedToken = bearerToken || (req.cookies && req.cookies.authToken);
    const isPublicEndpoint = isExplicitPublicRoute(req);
    const isPublicSyncEndpoint = (req.path || '').endsWith('/public-sync');

    if (extractedToken && !isPublicEndpoint && !isPublicSyncEndpoint) {
        try {
            const decoded = verifyJwtResilient(extractedToken);
            req.user = decoded;
            if (!req.user.companyId || req.user.companyId === 'admin') {
                req.user.companyId = 'default';
            }
            const decodedRole = String(req.user.role || '').toLowerCase();
            const headerCompanyId = (req.headers && req.headers['x-company-id']) || (req.query && req.query.companyId);
            if (decodedRole === 'superadmin' && headerCompanyId) {
                req.user.companyId = String(headerCompanyId);
            }
            const ctxRes = await applyUserAuthContext(req, decoded);
            if (!ctxRes.ok) {
                return res.status(ctxRes.status).json({ error: ctxRes.error });
            }

            // RULE D: Hardware ID (Machine ID) Binding
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

            return wrapTenantNext(req, next);
        } catch (tokenErr) {
            if (bearerToken) {
                console.warn(`[AUTH] 401 Unauthorized: Bearer token invalid for path ${req.path}: ${tokenErr.message}`);
                return res.status(401).json({ error: 'Token inválido o expirado' });
            }
        }
    }

    // 0b. Sincronización Segura LAN / Terminal Móvil mediante allowlist estricta (Principio de Mínimo Privilegio)
    const syncKey = req.headers && (req.headers['x-sync-key'] || req.headers['X-Sync-Key']);
    const expectedSyncKey = process.env.SYNC_SECRET_KEY;
    if (syncKey && expectedSyncKey && safeSecretEqual(syncKey, expectedSyncKey)) {
        const fullPath = (req.baseUrl || '') + (req.path || '');
        const method = String(req.method || 'GET').toUpperCase();

        if (!isPublicEndpoint && !isAllowedSyncKeyRequest(method, fullPath)) {
            console.warn(`[SECURITY] 403 Forbidden: Terminal móvil/LAN intentó acceder a ruta no autorizada: ${method} ${fullPath} (IP: ${req.ip})`);
            return res.status(403).json({
                error: 'terminal_no_autorizada',
                message: 'Operación denegada: Las terminales móviles y nodos LAN solo tienen autorización para preventas, ventas y consulta de catálogo.'
            });
        }

        // Resolver ID de usuario real respetando cajero móvil o cuenta de bajo privilegio para Foreign Keys
        let validSyncUserId = '2';
        let validSyncCompanyId = process.env.DEFAULT_COMPANY_ID || '2';
        let terminalUserName = (req.headers && (req.headers['x-terminal-name'] || req.headers['x-cashier-name'])) || 'Terminal Móvil Preventa';

        try {
            const { User } = require('../database/models');
            const requestedCashierId = (req.headers && (req.headers['x-cashier-id'] || req.headers['x-user-id'])) || (req.query && req.query.userId);
            const allowedTerminalRoles = ['cajero', 'cashier', 'vendedor', 'mesero'];

            let matchedUser = null;
            if (requestedCashierId) {
                matchedUser = await User.findOne({
                    where: {
                        id: String(requestedCashierId),
                        companyId: validSyncCompanyId,
                        status: 'active',
                        role: allowedTerminalRoles
                    }
                });
            }

            if (!matchedUser) {
                matchedUser = await User.findOne({
                    where: {
                        companyId: validSyncCompanyId,
                        status: 'active',
                        role: allowedTerminalRoles
                    },
                    order: [['id', 'ASC']]
                });
            }

            if (matchedUser) {
                validSyncUserId = String(matchedUser.id);
                if (requestedCashierId && matchedUser.name) {
                    terminalUserName = matchedUser.name;
                }
            }
        } catch (e) {
            console.warn('[AUTH SyncKey] Aviso consultando usuario en BD:', e.message);
        }

        // ASIGNACIÓN DE IDENTIDAD DE MÍNIMO PRIVILEGIO (ROL RESTRINGIDO: terminal_presale)
        req.user = { 
            id: validSyncUserId, 
            role: 'terminal_presale', // NUNCA 'admin' NI 'superadmin'
            companyId: validSyncCompanyId,
            name: terminalUserName,
            isSyncNode: true,
            permissions: {
                canCreatePresale: true,
                canViewProducts: true,
                canViewCustomers: true,
                canCreateCustomer: true,
                canCreateSale: true,
                // Bloqueos de seguridad Zero-Trust:
                canAccessAudit: false,
                canMonitorCashiers: false,
                canModifyPrices: false,
                canDeleteProducts: false,
                canManageUsers: false,
                canModifySettings: false,
                canVoidSales: false,
                canForceCloseCash: false,
                canBackup: false
            }
        };
        return wrapTenantNext(req, next);
    }

    // Permitir lectura de catálogo y selector de cajeros desde la red local WiFi / LAN de la tienda
    const isLocalOrLanIp = (ip) => {
        if (!ip) return false;
        const cleanIp = ip.replace('::ffff:', '');
        return cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost' ||
            /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(cleanIp);
    };
    if (req.method === 'GET' && isLocalOrLanIp(req.ip) && req.path.startsWith('/auth/public-cashiers')) {
        // Sin JWT autenticado, limitar estrictamente al tenant por defecto para evitar enumeración cross-tenant vía headers/query
        req.user = {
            id: 'lan-mobile-node',
            role: 'cashier',
            isUnauthenticatedLan: true,
            companyId: process.env.DEFAULT_COMPANY_ID || '2'
        };
        return wrapTenantNext(req, next);
    }

    if (req.path.endsWith('/public-sync')) {
        const companyId = req.headers['x-company-id'];
        const branchId = req.headers['x-branch-id'] || companyId || '1';
        const timestamp = req.headers['x-sync-timestamp'];
        const signature = req.headers['x-sync-signature'];

        const authHeader = req.headers['authorization'];
        const extractedToken = extractBearerToken(authHeader);
        if (extractedToken) {
            try {
                const decoded = jwt.verify(extractedToken, FINAL_SECRET, { algorithms: ['HS256'] });
                req.user = decoded;
                if (!req.user.companyId) {
                    req.user.companyId = companyId || 'default';
                }
                return wrapTenantNext(req, next);
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
        return wrapTenantNext(req, next);
    }

    // Bloquear acceso público a listas
    if (req.path.endsWith('/public-list') && !req.headers.authorization) {
        return res.status(401).json({ error: 'Acceso denegado. Se requiere autenticación.' });
    }

    // DEBUG: Log path for debugging 401 issues
    if (process.env.DEBUG_VERBOSE === 'true') {
        console.log(`[AUTH-DEBUG] Path: ${req.path}, Method: ${req.method}`);
    }

    // RULE B: Public Assets & Explicit Public API Endpoints -> Skip Token but Set Identity
    const isInitialBusinessSetupPost = req.method === 'POST' &&
        (req.path === '/settings/business' || req.path === '/api/settings/business') &&
        req.body?.initialSetupCompleted === true;
    if (isExplicitPublicRoute(req) || isInitialBusinessSetupPost) { 
        
        // --- PUBLIC IDENTITY FAILSAFE ---
        // Even if the route is public, we try to identify the company/user context
        // to prevent 500 errors in downstream services that expect req.user.companyId
        
        const authHeader = req.headers['authorization'];
        const extractedToken = extractBearerToken(authHeader) || (req.cookies && req.cookies.authToken);
        const companyIdHeader = req.headers['x-company-id'];
        
        if (extractedToken) {
            try {
                const decoded = verifyJwtResilient(extractedToken);
                req.user = decoded;
                if (!req.user.companyId || req.user.companyId === 'admin') {
                    req.user.companyId = 'default';
                }
                const decodedRole = String(req.user.role || '').toLowerCase();
                if (decodedRole === 'superadmin' && companyIdHeader) {
                    req.user.companyId = String(companyIdHeader);
                }
            } catch (e) { /* ignore invalid tokens on public routes */ }
        }

        // If no token, use the explicit header
        if (!req.user && companyIdHeader) {
            req.user = { companyId: companyIdHeader, role: 'anonymous_sync', isPublicContext: true };
        }

        // Final fallback to company '2' to avoid crashes and preserve store context
        if (!req.user) {
            req.user = { companyId: companyIdHeader || '2', role: 'public_guest', isPublicContext: true };
        }

        return wrapTenantNext(req, next);
    }

    // RULE C: Everything else (including API calls to SPA paths) -> Strict Token Check
    let token = extractedToken;
    if (!token && req.cookies && req.cookies.authToken) {
        token = req.cookies.authToken;
    }

    if (!token) {
        console.warn(`[AUTH] 401 Unauthorized: No token provided for path ${req.path}`);
        return res.status(401).json({ error: 'No autenticado o token inválido' });
    }

    // 3. Verify Token
    try {
        const decoded = verifyJwtResilient(token);
        req.user = decoded;
        if (!req.user.companyId || req.user.companyId === 'admin') {
            req.user.companyId = 'default';
        }
        const decodedRole = String(req.user.role || '').toLowerCase();
        const headerCompanyId = (req.headers && req.headers['x-company-id']) || (req.query && req.query.companyId);
                if (decodedRole === 'superadmin' && headerCompanyId) {
            req.user.companyId = String(headerCompanyId);
        }

        // REAL-TIME CHECK WITH FAST-PATH CACHING: Ensure user is still active in DB without hammering it
        const ctxRes = await applyUserAuthContext(req, decoded);
        if (!ctxRes.ok) {
            return res.status(ctxRes.status).json({ error: ctxRes.error });
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

        return wrapTenantNext(req, next);
    } catch (err) {
        console.error(`[AUTH] 401 Unauthorized: Token verification failed for path ${req.path}. Error: ${err.message}`);
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user?.isSyncNode || req.user?.role === 'terminal_presale' || req.user?.role === 'anonymous_sync' || req.user?.isPublicContext) {
        console.warn(`[SECURITY] Admin access blocked for sync node / terminal: ${req.user?.name || req.user?.id} (IP: ${req.ip})`);
        return res.status(403).json({ 
            error: 'terminal_no_autorizada', 
            message: 'Acceso denegado: Las terminales móviles y nodos de sincronización no tienen autorización para ejecutar acciones administrativas.' 
        });
    }
    if (req.user && isCompanyAdminRole(req.user.role)) {
        return next();
    }
    console.warn(`Access denied for user ${req.user?.email} with role: ${req.user?.role}`);
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de administrador' });
};

const isSuperAdmin = (req, res, next) => {
    if (req.user?.isSyncNode || req.user?.role === 'terminal_presale' || req.user?.role === 'anonymous_sync' || req.user?.isPublicContext) {
        return res.status(403).json({ 
            error: 'terminal_no_autorizada', 
            message: 'Acceso denegado: Se requieren credenciales de Superadmin autenticadas en estación fija.' 
        });
    }
    if (req.user && isCompanyOwnerRole(req.user.role)) {
        return next();
    }
    console.warn(`SuperAdmin access denied for user ${req.user?.email} with role: ${req.user?.role}`);
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de DUEÑO (Superadmin)' });
};

const isMaster = (req, res, next) => {
    if (req.user?.isSyncNode || req.user?.role === 'terminal_presale' || req.user?.role === 'anonymous_sync' || req.user?.isPublicContext) {
        return res.status(403).json({ 
            error: 'terminal_no_autorizada', 
            message: 'Acceso denegado: Se requieren credenciales de DUEÑO (Superadmin) autenticadas en estación fija.' 
        });
    }
    if (req.user && isCompanyOwnerRole(req.user.role)) {
        return next();
    }
    console.warn(`Master access denied for user ${req.user?.email} with role: ${req.user?.role}`);
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de DUEÑO (Superadmin)' });
};

/**
 * Middleware para requerir un permiso granular específico.
 * Superadmin / Dueño tiene bypass automático para garantizar acceso total.
 * Dueño, Administrador y Supervisor tienen acceso automático a canAccessAudit.
 */
const requirePermission = (permissionInput) => {
    const requiredKeys = Array.isArray(permissionInput) ? permissionInput : [permissionInput];
    const permissionLabel = requiredKeys.join(' | ');
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        const restrictedSyncPerms = new Set(['canAccessAudit', 'canMonitorCashiers', 'canModifySettings', 'canManageUsers', 'canDeleteProducts', 'canBackup', 'canManageSettings', 'canManageFiscal', 'canManagePayroll', 'canManageAssets']);
        if (req.user?.isSyncNode && requiredKeys.every(k => restrictedSyncPerms.has(k))) {
            return res.status(403).json({
                error: 'forbidden',
                message: `Acceso denegado para terminal móvil: El permiso '${permissionLabel}' requiere inicio de sesión en consola fija.`
            });
        }
        const role = String(req.user.role || '').toLowerCase();
        // Bypass absoluto para Dueño / Superadmin / Owner
        if (isCompanyOwnerRole(role)) {
            return next();
        }

        // Auditoría y Monitoreo: Dueño, Administrador y Supervisor tienen acceso directo
        if (requiredKeys.some(k => k === 'canAccessAudit' || k === 'canMonitorCashiers') && (role === 'admin' || role === 'supervisor')) {
            return next();
        }

        // Verificar si el usuario tiene el permiso granular activo
        const permissions = req.user.permissions || {};
        if (requiredKeys.some(k => permissions[k] === true)) {
            return next();
        }

        // Si el usuario es administrador y alguno de los permisos requeridos no fue explícitamente revocado (false)
        if (role === 'admin' && requiredKeys.some(k => permissions[k] !== false)) {
            return next();
        }

        // Autorización delegada mediante PIN de Supervisor (SupervisorApproval) con validación de ámbito y consumo atómico
        const isApprovalActionAllowed = (perm, actionType) => {
            const act = String(actionType || '').trim().toUpperCase();
            if (!act) return false;
            switch (perm) {
                case 'canCreateProducts':
                case 'canModifyPrices':
                    return (
                        act === 'MODIFICAR PRODUCTO' ||
                        act === 'ACTUALIZACIÓN MASIVA DE PRECIOS' ||
                        act === 'ACTUALIZACION MASIVA DE PRECIOS' ||
                        act.startsWith('AUTORIZACIÓN: CREACIÓN DE PRODUCTO') ||
                        act.startsWith('AUTORIZACIÓN: MODIFICAR') ||
                        act.startsWith('AUTORIZACION: CREACION DE PRODUCTO') ||
                        act.startsWith('AUTORIZACION: MODIFICAR') ||
                        act === 'CREATE_PRODUCT' ||
                        act === 'MODIFY_PRODUCT'
                    );
                case 'canManageInventory':
                case 'canAdjustStock':
                    return (
                        act.startsWith('AJUSTE DE STOCK') ||
                        act.startsWith('AUTORIZACIÓN: MODIFICAR STOCK') ||
                        act.startsWith('AUTORIZACION: MODIFICAR STOCK') ||
                        act === 'STOCK_ADJUST' ||
                        act === 'INVENTORY_ADJUST'
                    );
                case 'canManageSettings':
                    return (
                        act === 'RECONFIGURE_BUSINESS_RUBRO' ||
                        act === 'MANAGE_SETTINGS'
                    );
                case 'canOpenDrawer':
                    return (
                        act === 'APERTURA MANUAL DE GAVETA' ||
                        act === 'APERTURA DE GAVETA (CONFIGURACIÓN)' ||
                        act === 'APERTURA DE GAVETA (CONFIGURACION)' ||
                        act === 'OPEN_DRAWER'
                    );
                case 'canVoidSales':
                    return (
                        act === 'SALE_REFUND' ||
                        act === 'ANULAR / REEMBOLSAR FACTURA' ||
                        act === 'VOID_SALE'
                    );
                case 'canApplyDiscounts':
                    return (
                        act === 'HIGH_DISCOUNT' ||
                        act === 'SALE_DISCOUNT' ||
                        act === 'POS_OVERRIDE'
                    );
                case 'canManageCashShift':
                    return (
                        act === 'CLOSE_SHIFT' ||
                        act === 'CASH_CLOSE_OVERRIDE' ||
                        act === 'CASH_DISCREPANCY'
                    );
                default:
                    return act === `PERMISSION:${String(perm || '').toUpperCase()}`;
            }
        };

        const approvalId = req.body?.supervisorApprovalId || req.query?.supervisorApprovalId || req.headers['x-supervisor-approval-id'];
        if (approvalId) {
            try {
                const { Op } = require('sequelize');
                const { SupervisorApproval } = require('../database/models');
                const companyId = req.user.companyId || 'default';
                const now = new Date();
                const approval = await SupervisorApproval.findOne({
                    where: {
                        id: String(approvalId),
                        companyId,
                        used: false,
                        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                    }
                });
                if (approval && requiredKeys.some(k => isApprovalActionAllowed(k, approval.actionType))) {
                    const [consumedCount] = await SupervisorApproval.update(
                        { used: true, usedAt: now },
                        {
                            where: {
                                id: approval.id,
                                companyId,
                                used: false,
                                [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                            }
                        }
                    );
                    if (consumedCount === 1) {
                        return next();
                    }
                } else if (approval) {
                    console.warn(`[SECURITY] SupervisorApproval ${approval.id} (${approval.actionType}) rejected for permission '${permissionLabel}'`);
                }
            } catch (err) {
                console.error('[AUTH] Error verificando aprobación de supervisor:', err.message);
            }
        }

        console.warn(`[SECURITY] Forbidden: User ${req.user.email || req.user.id} lacks permission '${permissionLabel}' (Role: ${role})`);
        return res.status(403).json({ 
            error: 'forbidden', 
            message: `Acceso denegado: No cuentas con el permiso requerido (${permissionLabel}). Se requiere autorización de supervisor con PIN.` 
        });
    };
};

const computeDisplayPairingToken = (companyId, registerId = '1') => {
    const key = process.env.SYNC_SECRET_KEY || FINAL_SECRET;
    return crypto
        .createHmac('sha256', String(key))
        .update(`isaac_display:${String(companyId || '2')}:${String(registerId || '1')}`)
        .digest('hex')
        .slice(0, 32);
};

const verifyDisplayPairingToken = (token, companyId, registerId = '1') => {
    if (!token || typeof token !== 'string') return false;
    const expected = computeDisplayPairingToken(companyId, registerId);
    return safeSecretEqual(token.trim(), expected);
};

const verifySocketJwtUser = async (decoded) => {
    if (!decoded || !decoded.id) return { ok: false, error: 'Token sin identificador de usuario' };
    let cachedUser = getCachedUserStatus(decoded.id);
    if (!cachedUser) {
        const { User } = require('../database/models');
        const dbUser = await User.findByPk(decoded.id, {
            attributes: ['status', 'permissions', 'role', 'companyId', 'activeBranchId', 'currentSessionId']
        });
        if (!dbUser || dbUser.status !== 'active') {
            invalidateUserAuthCache(decoded.id);
            return { ok: false, error: 'Usuario inactivo o inexistente' };
        }
        let userPerms = dbUser.permissions || decoded.permissions || {};
        if (typeof userPerms === 'string') {
            try { userPerms = JSON.parse(userPerms); } catch (_) { userPerms = {}; }
        }
        cachedUser = {
            status: dbUser.status,
            permissions: userPerms,
            role: dbUser.role || decoded.role,
            companyId: dbUser.companyId,
            activeBranchId: dbUser.activeBranchId || null,
            currentSessionId: dbUser.currentSessionId || null
        };
        setCachedUserStatus(decoded.id, cachedUser);
    }
    if (cachedUser.status !== 'active') {
        invalidateUserAuthCache(decoded.id);
        return { ok: false, error: 'Usuario inactivo' };
    }
    const dbSession = cachedUser.currentSessionId ? String(cachedUser.currentSessionId) : '';
    const tokenSession = decoded.sessionId ? String(decoded.sessionId) : '';
    if (!isSessionValid(dbSession, tokenSession)) {
        invalidateUserAuthCache(decoded.id);
        return {
            ok: false,
            error: dbSession
                ? 'Sesión WebSocket revocada o expirada'
                : 'Sesión WebSocket inválida'
        };
    }
    return {
        ok: true,
        role: cachedUser.role || decoded.role,
        companyId: (cachedUser.companyId && cachedUser.companyId !== 'default' && cachedUser.companyId !== 'admin' && cachedUser.role !== 'superadmin')
            ? String(cachedUser.companyId)
            : String(decoded.companyId || 'default')
    };
};

module.exports = {
    verifyToken,
    verifyJwtResilient,
    extractBearerToken,
    safeSecretEqual,
    computeDisplayPairingToken,
    verifyDisplayPairingToken,
    verifySocketJwtUser,
    isAdmin,
    isSuperAdmin,
    isMaster,
    requirePermission,
    invalidateUserAuthCache
};
