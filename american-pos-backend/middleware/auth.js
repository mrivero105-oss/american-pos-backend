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

const verifyJwtResilient = (tokenToVerify) => {
    const secrets = [
        FINAL_SECRET,
        process.env.LEGACY_HMAC_SECRET
    ].filter(Boolean);

    for (const sec of secrets) {
        try {
            return jwt.verify(tokenToVerify, sec);
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

const verifyToken = async (req, res, next) => {
    // 0. Browser Navigation (F5 / Direct URL in address bar) -> Serve SPA HTML immediately
    const spaRoutes = [
        '/', '/dashboard', '/pos', '/inventory', '/customers',
        '/sales-history', '/settings', '/users', '/expenses',
        '/reports', '/audit', '/suppliers', '/purchase-orders',
        '/branches', '/quotations', '/history', '/recibo', '/login',
        '/banking', '/accounting', '/payroll', '/mobile', '/store',
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
    const extractedToken = extractBearerToken(authHeader) || (req.cookies && req.cookies.authToken) || (req.query && req.query.token);
    if (extractedToken) {
        try {
            const decoded = verifyJwtResilient(extractedToken);
            req.user = decoded;
            if (!req.user.companyId || req.user.companyId === 'default' || req.user.companyId === 'admin') {
                req.user.companyId = (req.headers && req.headers['x-company-id']) || (req.query && req.query.companyId) || '2';
            }
            if (decoded.id && decoded.role !== 'anonymous_sync') {
                let cachedUser = getCachedUserStatus(decoded.id);
                if (!cachedUser) {
                    const { User } = require('../database/models');
                    const dbUser = await User.findByPk(decoded.id, { attributes: ['status', 'permissions', 'role', 'companyId'] });
                    if (!dbUser || dbUser.status !== 'active') {
                        invalidateUserAuthCache(decoded.id);
                        return res.status(401).json({ error: 'Tu cuenta ha sido desactivada o eliminada' });
                    }
                    let userPerms = dbUser.permissions || decoded.permissions || {};
                    if (typeof userPerms === 'string') {
                        try { userPerms = JSON.parse(userPerms); } catch (e) { userPerms = {}; }
                    }
                    cachedUser = {
                        permissions: userPerms,
                        role: dbUser.role || decoded.role,
                        companyId: dbUser.companyId
                    };
                    setCachedUserStatus(decoded.id, cachedUser);
                }
                req.user.permissions = cachedUser.permissions;
                req.user.role = cachedUser.role;
                if (cachedUser.companyId && cachedUser.companyId !== 'default' && cachedUser.companyId !== 'admin' && cachedUser.role !== 'superadmin') {
                    req.user.companyId = String(cachedUser.companyId);
                }
            } else {
                req.user.permissions = decoded.permissions || {};
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

            return next();
        } catch (tokenErr) {
            // Si el token falló o expiró, continuar a los mecanismos de sincronización LAN o públicos
        }
    }

    // 0b. Sincronización Segura LAN / Terminal Móvil mediante clave de sincronización (Principio de Mínimo Privilegio)
    const syncKey = (req.headers && (req.headers['x-sync-key'] || req.headers['X-Sync-Key'])) || (req.query && req.query.sync_key);
    const expectedSyncKey = process.env.SYNC_SECRET_KEY;
    if (syncKey && expectedSyncKey && syncKey === expectedSyncKey) {
        // DEFENSE-IN-DEPTH: Prohibir de raíz accesos a módulos administrativos o destructivos mediante clave LAN
        const fullPath = (req.baseUrl || '') + (req.path || '');
        const pathLower = fullPath.toLowerCase();
        const method = req.method.toUpperCase();

        const forbiddenPrefixes = [
            '/users', '/api/users',
            '/backup', '/api/backup',
            '/license', '/api/license',
            '/audit', '/api/audit',
            '/accounting', '/api/accounting',
            '/executive-bi', '/api/executive-bi',
            '/debug', '/api/debug'
        ];

        const isForbiddenRoute = forbiddenPrefixes.some(prefix => pathLower.startsWith(prefix) || pathLower.includes(prefix));
        const isForbiddenSettingMutation = (pathLower.includes('/settings') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method));
        const isDestructiveMutation = (method === 'DELETE' && !pathLower.includes('/held-sales'));

        if (isForbiddenRoute || isForbiddenSettingMutation || isDestructiveMutation) {
            console.warn(`[SECURITY] 403 Forbidden: Terminal móvil/LAN intentó acceder a ruta no autorizada: ${method} ${fullPath} (IP: ${req.ip})`);
            return res.status(403).json({
                error: 'terminal_no_autorizada',
                message: 'Operación denegada: Las terminales móviles y nodos LAN solo tienen autorización para preventas, ventas y consulta de catálogo.'
            });
        }

        // Resolver ID de usuario real respetando cajero móvil o cuenta de bajo privilegio para Foreign Keys
        let validSyncUserId = '2';
        let validSyncCompanyId = (req.headers && req.headers['x-company-id']) || (req.query && req.query.companyId) || '2';
        let terminalUserName = (req.headers && (req.headers['x-terminal-name'] || req.headers['x-cashier-name'])) || 'Terminal Móvil Preventa';

        try {
            const { User } = require('../database/models');
            const requestedCashierId = (req.headers && (req.headers['x-cashier-id'] || req.headers['x-user-id'])) || (req.query && req.query.userId);

            let matchedUser = null;
            if (requestedCashierId) {
                matchedUser = await User.findByPk(String(requestedCashierId));
            }

            if (!matchedUser) {
                // Priorizar cajero o vendedor antes que superadmin para evitar suplantación de identidad
                matchedUser = await User.findOne({
                    where: { 
                        role: ['cajero', 'cashier', 'vendedor']
                    },
                    order: [['id', 'ASC']]
                });
            }

            if (!matchedUser) {
                matchedUser = await User.findOne({ order: [['id', 'ASC']] });
            }

            if (matchedUser) {
                validSyncUserId = String(matchedUser.id);
                validSyncCompanyId = req.headers['x-company-id'] || (matchedUser.companyId !== 'default' && matchedUser.companyId !== 'admin' ? matchedUser.companyId : '2');
                if (requestedCashierId && matchedUser.name) {
                    terminalUserName = matchedUser.name;
                }
            }
        } catch (e) {}

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
        return next();
    }

    // Permitir lectura de catálogo y selector de cajeros desde la red local WiFi / LAN de la tienda
    const isLocalOrLanIp = (ip) => {
        if (!ip) return false;
        const cleanIp = ip.replace('::ffff:', '');
        return cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost' ||
            /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(cleanIp);
    };
    if (req.method === 'GET' && isLocalOrLanIp(req.ip)) {
        const hasTerminalContext = Boolean(req.headers['x-terminal-id'] || req.headers['x-company-id'] || req.query.companyId);
        if (req.path.startsWith('/auth/public-cashiers') || (req.path.startsWith('/products') && hasTerminalContext)) {
            req.user = {
                id: 'lan-mobile-node',
                role: 'cashier',
                isUnauthenticatedLan: true,
                companyId: req.headers['x-company-id'] || req.query.companyId || '2'
            };
            return next();
        }
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

    // DEBUG: Log path for debugging 401 issues
    console.log(`[AUTH-DEBUG] Path: ${req.path}, Method: ${req.method}`);

    // RULE B: Public Assets & Explicit Public API Endpoints -> Skip Token but Set Identity
    const isStaticAsset = req.path.startsWith('/assets/') && /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|map|webp)$/i.test(req.path);
    if (req.path === '/dist.zip' ||
        req.path === '/version.json' ||
        req.path.startsWith('/api/app-update-info') ||
        req.path.endsWith('.apk') ||
        req.path === '/index.html' ||
        req.path === '/sw.js' ||
        req.path === '/manifest.json' ||
        isStaticAsset ||
        req.path.startsWith('/js/') ||
        req.path.startsWith('/css/') ||
        req.path.startsWith('/fonts/') ||
        req.path.startsWith('/product_images/') ||
        req.path.startsWith('/invoices/') ||
        req.path.startsWith('/supplier_logos/') ||
        req.path.startsWith('/img/') ||
        req.path === '/hello' ||
        req.path === '/auth/login' ||
        req.path === '/auth/me' ||
        req.path === '/settings/business' ||
        req.path === '/api/settings/business' ||
        (req.method === 'GET' && (req.path === '/settings/rate' || req.path === '/api/settings/rate')) ||
        (req.method === 'GET' && (req.path === '/settings/payment-methods' || req.path === '/api/settings/payment-methods')) ||
        (req.method === 'GET' && (req.path === '/settings/pago-movil' || req.path === '/api/settings/pago-movil')) ||
        (req.method === 'GET' && (req.path === '/settings/binance' || req.path === '/api/settings/binance' || req.path === '/settings/binance/rate' || req.path === '/api/settings/binance/rate')) ||
        req.path === '/settings/is-setup' ||
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
                const decoded = verifyJwtResilient(extractedToken);
                req.user = decoded;
                if (!req.user.companyId || req.user.companyId === 'default' || req.user.companyId === 'admin') {
                    req.user.companyId = companyIdHeader || '2';
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

        return next();
    }

    // RULE C: Everything else (including API calls to SPA paths) -> Strict Token Check
    let token = extractedToken;
    if (!token) {
        if (req.cookies && req.cookies.authToken) {
            token = req.cookies.authToken;
        } else if (req.query && req.query.token) {
            token = req.query.token;
        }
    }

    if (!token) {
        console.warn(`[AUTH] 401 Unauthorized: No token provided for path ${req.path}`);
        return res.status(401).json({ error: 'No autenticado o token inválido' });
    }

    // 3. Verify Token
    try {
        const decoded = verifyJwtResilient(token);
        req.user = decoded;
        if (!req.user.companyId || req.user.companyId === 'default' || req.user.companyId === 'admin') {
            req.user.companyId = (req.headers && req.headers['x-company-id']) || (req.query && req.query.companyId) || '2';
        }

        // REAL-TIME CHECK WITH FAST-PATH CACHING: Ensure user is still active in DB without hammering it
        if (decoded.id && decoded.role !== 'anonymous_sync') {
            let cachedUser = getCachedUserStatus(decoded.id);

            if (!cachedUser) {
                const { User } = require('../database/models');
                const dbUser = await User.findByPk(decoded.id, { attributes: ['status', 'permissions', 'role', 'companyId'] });
                if (!dbUser || dbUser.status !== 'active') {
                    console.warn(`[AUTH] 401 Unauthorized: User ${decoded.id} is deleted or inactive.`);
                    invalidateUserAuthCache(decoded.id);
                    return res.status(401).json({ error: 'Tu cuenta ha sido desactivada o eliminada' });
                }

                let userPerms = dbUser.permissions || decoded.permissions || {};
                if (typeof userPerms === 'string') {
                    try { userPerms = JSON.parse(userPerms); } catch (e) { userPerms = {}; }
                }

                cachedUser = {
                    permissions: userPerms,
                    role: dbUser.role || decoded.role,
                    companyId: dbUser.companyId
                };
                setCachedUserStatus(decoded.id, cachedUser);
            }

            req.user.permissions = cachedUser.permissions;
            req.user.role = cachedUser.role;
            if (cachedUser.companyId && cachedUser.companyId !== 'default' && cachedUser.companyId !== 'admin' && cachedUser.role !== 'superadmin') {
                req.user.companyId = String(cachedUser.companyId);
            }
        } else {
            req.user.permissions = decoded.permissions || {};
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
    if (req.user?.isSyncNode || req.user?.role === 'terminal_presale' || req.user?.role === 'anonymous_sync' || req.user?.isPublicContext) {
        console.warn(`[SECURITY] Admin access blocked for sync node / terminal: ${req.user?.name || req.user?.id} (IP: ${req.ip})`);
        return res.status(403).json({ 
            error: 'terminal_no_autorizada', 
            message: 'Acceso denegado: Las terminales móviles y nodos de sincronización no tienen autorización para ejecutar acciones administrativas.' 
        });
    }
    const role = req.user?.role?.toLowerCase();
    if (req.user && (role === 'admin' || role === 'superadmin' || role === 'owner' || role === 'dueño')) {
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
    const role = req.user?.role?.toLowerCase();
    if (req.user && (role === 'superadmin' || role === 'owner' || role === 'dueño')) {
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
    const role = req.user?.role?.toLowerCase();
    if (req.user && (role === 'superadmin' || role === 'owner' || role === 'dueño')) {
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
const requirePermission = (permissionKey) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        if (req.user?.isSyncNode && ['canAccessAudit', 'canMonitorCashiers', 'canModifySettings', 'canManageUsers', 'canDeleteProducts', 'canBackup'].includes(permissionKey)) {
            return res.status(403).json({ 
                error: 'forbidden', 
                message: `Acceso denegado para terminal móvil: El permiso '${permissionKey}' requiere inicio de sesión en consola fija.` 
            });
        }
        const role = String(req.user.role || '').toLowerCase();
        // Bypass absoluto para Dueño / Superadmin / Owner
        if (role === 'superadmin' || role === 'owner' || role === 'dueño') {
            return next();
        }

        // Auditoría y Monitoreo: Dueño, Administrador y Supervisor tienen acceso directo
        if ((permissionKey === 'canAccessAudit' || permissionKey === 'canMonitorCashiers') && (role === 'admin' || role === 'supervisor')) {
            return next();
        }

        // Verificar si el usuario tiene el permiso granular activo
        const permissions = req.user.permissions || {};
        if (permissions[permissionKey] === true) {
            return next();
        }

        // Si el usuario es administrador y el permiso no fue explícitamente revocado (false)
        if (role === 'admin' && permissions[permissionKey] !== false) {
            return next();
        }

        // Autorización delegada mediante PIN de Supervisor (SupervisorApproval)
        const approvalId = req.body?.supervisorApprovalId || req.query?.supervisorApprovalId || req.headers['x-supervisor-approval-id'];
        if (approvalId) {
            try {
                const { SupervisorApproval } = require('../database/models');
                const approval = await SupervisorApproval.findOne({
                    where: { 
                        id: String(approvalId),
                        companyId: req.user.companyId || 'default'
                    }
                });
                if (approval && !approval.used && (!approval.expiresAt || new Date(approval.expiresAt) >= new Date())) {
                    await approval.update({ used: true });
                    return next();
                }
            } catch (err) {
                console.error('[AUTH] Error verificando aprobación de supervisor:', err.message);
            }
        }

        console.warn(`[SECURITY] Forbidden: User ${req.user.email || req.user.id} lacks permission '${permissionKey}' (Role: ${role})`);
        return res.status(403).json({ 
            error: 'forbidden', 
            message: `Acceso denegado: No cuentas con el permiso requerido (${permissionKey}). Se requiere autorización de supervisor con PIN.` 
        });
    };
};

module.exports = {
    verifyToken,
    isAdmin,
    isSuperAdmin,
    isMaster,
    requirePermission,
    invalidateUserAuthCache
};
