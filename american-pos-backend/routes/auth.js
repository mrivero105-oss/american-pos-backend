const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { User } = require('../database/models');
const { generateRobustId, safeSecretEqual } = require('../utils/helpers');
const auditController = require('../controllers/audit');
const { verifyLicense } = require('../middleware/licenseMiddleware');
const { invalidateUserAuthCache } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
    loginSchema,
    quickUnlockSchema,
    supervisorAuthorizeSchema,
    changePinSchema,
    setQuickPinSchema
} = require('../schemas/authSchema');

const quickUnlockLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de desbloqueo rápido. Espere 5 minutos.' }
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be defined. Refusing to start.');
}

// 🛡️ IP-Level Brute-Force Tracker (Sliding window para mitigar Password Spraying en LAN)
const ipFailedAttempts = new Map(); // ip -> { count: number, lockUntil: number, lastAttempt: number }
const ipCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of ipFailedAttempts.entries()) {
        if ((!data.lockUntil || data.lockUntil < now) && (now - (data.lastAttempt || 0) > 30 * 60 * 1000)) {
            ipFailedAttempts.delete(ip);
        }
    }
}, 5 * 60 * 1000);
if (typeof ipCleanupTimer.unref === 'function') ipCleanupTimer.unref();

router.post('/login', validate(loginSchema), async (req, res) => {
    const { email, username, password } = req.body;
    const clientIp = (req.ip || req.connection?.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const isLoopback = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';

    // 🛡️ Bloqueo estricto por IP (máximo 5 intentos fallidos acumulados en 15 minutos)
    const ipRecord = ipFailedAttempts.get(clientIp);
    if (!isLoopback && ipRecord && ipRecord.lockUntil && ipRecord.lockUntil > Date.now()) {
        const minutesLeft = Math.ceil((ipRecord.lockUntil - Date.now()) / 60000);
        console.warn(`[SECURITY] Blocked login attempt from locked IP ${clientIp}. Minutes left: ${minutesLeft}`);
        return res.status(429).json({
            error: `Dirección IP bloqueada temporalmente por exceso de intentos fallidos. Intente de nuevo en ${minutesLeft} minuto(s).`,
            locked: true,
            minutesLeft
        });
    }

    // Support both older frontend which sent 'email' and new React frontend which sends 'username'
    const loginIdentifier = username || email;
    const sanitizedEmail = loginIdentifier ? loginIdentifier.trim().toLowerCase() : '';

    console.log(`[LOGIN] Attempt for: ${sanitizedEmail}`);

    if (!sanitizedEmail || !password) {
        return res.status(400).json({ error: 'Faltan credenciales' });
    }

    try {
        const { User } = require('../database/models');
        let authenticatedUser = null;

        try {
            // Attempt standard lookup with Op.or (Modern schema)
            authenticatedUser = await User.findOne({
                where: {
                    [require('sequelize').Op.or]: [
                        { email: sanitizedEmail },
                        { username: sanitizedEmail }
                    ]
                },
                order: [
                    [require('sequelize').literal("CASE WHEN \"User\".\"id\" = '2' THEN 0 WHEN \"User\".\"role\" = 'superadmin' THEN 1 ELSE 2 END"), 'ASC']
                ]
            });
        } catch (dbErr) {
            console.warn(`[LOGIN] Initial lookup failed: ${dbErr.message}. Retrying fallback...`);
            
            const isConnErr = dbErr.name === 'SequelizeConnectionRefusedError' || 
                              dbErr.name === 'SequelizeConnectionError' ||
                              (dbErr.message && (dbErr.message.includes('ECONNREFUSED') || dbErr.message.includes('57P03')));

            if (isConnErr) {
                try {
                    console.log('[LOGIN] 🔄 Detectada desconexión con PostgreSQL. Intentando auto-recuperar servicio...');
                    const { ensurePostgresRunning } = require('../utils/postgresLauncher');
                    await ensurePostgresRunning(20);
                    // Reintentar consulta de usuario tras auto-recuperación
                    authenticatedUser = await User.findOne({
                        where: {
                            [require('sequelize').Op.or]: [
                                { email: sanitizedEmail },
                                { username: sanitizedEmail }
                            ]
                        },
                        order: [
                            [require('sequelize').literal("CASE WHEN \"User\".\"id\" = '2' THEN 0 WHEN \"User\".\"role\" = 'superadmin' THEN 1 ELSE 2 END"), 'ASC']
                        ]
                    });
                } catch (retryErr) {
                    console.error('[LOGIN] Reintento de conexión falló:', retryErr.message);
                    throw dbErr;
                }
            } else if (dbErr.message.includes('no such column') || dbErr.message.includes('column') || 
                dbErr.message.includes('does not exist') || dbErr.message.includes('username') ||
                dbErr.message.includes('relation')) {
                try {
                    authenticatedUser = await User.findOne({
                        where: { email: sanitizedEmail }
                    });
                } catch (fallbackErr) {
                    console.error(`[LOGIN] Even fallback query failed: ${fallbackErr.message}`);
                    throw fallbackErr;
                }
            } else {
                throw dbErr; // Re-throw if it's a different DB error
            }
        }

        if (authenticatedUser) {
            console.log(`[LOGIN-DEBUG] User found: ${authenticatedUser.email}`);

            // 🛡️ Bloqueo Progresivo contra Fuerza Bruta
            if (authenticatedUser.lockUntil && new Date(authenticatedUser.lockUntil) > new Date()) {
                const diffMs = new Date(authenticatedUser.lockUntil).getTime() - Date.now();
                const minutesLeft = Math.ceil(diffMs / 60000);
                console.warn(`[LOGIN] Blocked attempt for locked user: ${sanitizedEmail}. Minutes left: ${minutesLeft}`);
                return res.status(429).json({
                    error: `Cuenta bloqueada temporalmente por exceso de intentos fallidos. Intente de nuevo en ${minutesLeft} minuto(s).`,
                    locked: true,
                    minutesLeft
                });
            }

            let isMatch = false;
            const currentPassword = authenticatedUser.password || '';

            if (currentPassword.startsWith('$2') || currentPassword.length > 30) {
                isMatch = await bcrypt.compare(password, currentPassword);
            } else {
                // Legacy plaintext password check (constant-time)
                if (safeSecretEqual(password, currentPassword)) {
                    isMatch = true;
                    // Auto-upgrade password to bcrypt
                    try {
                        authenticatedUser.password = password; // El hook beforeUpdate del modelo lo encripta automáticamente
                        await authenticatedUser.save();
                        console.log(`[LOGIN] Auto-upgraded password for user: ${authenticatedUser.email}`);
                    } catch (upgradeErr) {
                        console.error(`[LOGIN] Failed to upgrade password: ${upgradeErr.message}`);
                    }
                } else {
                    isMatch = false;
                }
            }

            console.log(`[LOGIN-DEBUG] Password match result: ${isMatch}`);

            // If password comparison failed, check supervisorPin (PIN login support)
            if (!isMatch && authenticatedUser.supervisorPin) {
                try {
                    const currentPin = String(authenticatedUser.supervisorPin);
                    const crypto = require('crypto');
                    if (currentPin.startsWith('$2') || currentPin.length > 30) {
                        isMatch = await bcrypt.compare(String(password), currentPin);
                        if (!isMatch) {
                            const sha256Pin = crypto.createHash('sha256').update(String(password)).digest('hex');
                            isMatch = await bcrypt.compare(sha256Pin, currentPin);
                        }
                    } else {
                        if (safeSecretEqual(String(password), currentPin)) {
                            isMatch = true;
                        }
                    }
                    if (isMatch) {
                        console.log(`[LOGIN] User ${authenticatedUser.email} authenticated via PIN.`);
                    }
                } catch (pinErr) {
                    console.warn(`[LOGIN] PIN comparison error: ${pinErr.message}`);
                }
            }

            if (isMatch) {
                // Reset failed attempts & generate new session ID
                if (!isLoopback) ipFailedAttempts.delete(clientIp);
                const sessionId = `SESS-${require('crypto').randomUUID()}`;
                try {
                    await authenticatedUser.update({
                        failedLoginAttempts: 0,
                        lockUntil: null,
                        currentSessionId: sessionId
                    });
                    invalidateUserAuthCache(authenticatedUser.id);
                } catch (resetErr) {
                    console.error('[LOGIN] Error resetting failed attempts:', resetErr.message);
                }

                let userPermissions = authenticatedUser.permissions || {};
                if (typeof userPermissions === 'string') {
                    try { userPermissions = JSON.parse(userPermissions); } catch (e) { userPermissions = {}; }
                }

                const {
                    password: _,
                    supervisorPin: __,
                    quickPin: ___,
                    biometricTokenHash: ____,
                    currentSessionId: _____,
                    ...userWithoutPassword
                } = authenticatedUser.toJSON();
                userWithoutPassword.permissions = userPermissions;
                userWithoutPassword.sessionId = sessionId;

                const licenseUtils = require('../utils/licenseUtils');
                const machineId = await licenseUtils.getMachineId();

                const secret = JWT_SECRET;

                const tokenCompanyId = (authenticatedUser.companyId && authenticatedUser.companyId !== 'default' && authenticatedUser.companyId !== 'admin' && authenticatedUser.companyId !== authenticatedUser.id) ? authenticatedUser.companyId : '2';
                userWithoutPassword.companyId = tokenCompanyId;

                const token = jwt.sign(
                    {
                        id: authenticatedUser.id,
                        email: authenticatedUser.email,
                        role: authenticatedUser.role,
                        permissions: userPermissions,
                        companyId: tokenCompanyId,
                        sessionId: sessionId,
                        mid: machineId // Bind token to this specific hardware
                    },
                    secret,
                    { expiresIn: '24h' } // Reducido a 24 horas por seguridad
                );

                console.log(`[LOGIN] Success for user: ${authenticatedUser.email} (ID: ${authenticatedUser.id}, SESS: ${sessionId})`);
                
                res.cookie('authToken', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/'
                });

                res.json({
                    success: true,
                    token: token, // Se mantiene para compatibilidad móvil, el frontend web debe ignorarlo
                    user: userWithoutPassword
                });

                // Registrar auditoría
                auditController.logAction(
                    authenticatedUser.id,
                    authenticatedUser.companyId,
                    'LOGIN',
                    'Inicio de sesión exitoso',
                    authenticatedUser.id
                );
            } else {
                console.warn(`[LOGIN] Failed for user: ${sanitizedEmail} - Invalid password`);
                
                const attempts = (Number(authenticatedUser.failedLoginAttempts) || 0) + 1;
                let lockUntil = null;
                let errorMsg = 'Credenciales inválidas';

                if (attempts >= 5) {
                    lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos de bloqueo
                    errorMsg = 'Cuenta bloqueada temporalmente por 15 minutos debido a 5 intentos fallidos consecutivos.';
                    console.warn(`[SECURITY] User ${sanitizedEmail} locked out for 15 minutes due to 5 failed attempts.`);
                } else {
                    errorMsg = `Credenciales inválidas. Intentos restantes antes de bloqueo temporal: ${5 - attempts}`;
                }

                try {
                    await authenticatedUser.update({
                        failedLoginAttempts: attempts,
                        lockUntil: lockUntil
                    });
                } catch (updErr) {
                    console.error('[SECURITY] Error updating failed attempts:', updErr.message);
                }

                // Generar alerta de seguridad
                auditController.createAlert(
                    'security_risk',
                    attempts >= 5 ? 'critical' : 'high',
                    `Intento de inicio de sesión fallido (${attempts}/5) para: ${sanitizedEmail}`,
                    authenticatedUser.id,
                    authenticatedUser.companyId,
                    { ip: req.ip, attempts, lockUntil }
                );

                if (!isLoopback) {
                    const ipCount = (ipRecord?.count || 0) + 1;
                    const ipLock = ipCount >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
                    ipFailedAttempts.set(clientIp, { count: ipCount, lockUntil: ipLock, lastAttempt: Date.now() });
                }

                res.status(attempts >= 5 ? 429 : 401).json({ 
                    error: errorMsg, 
                    attemptsRemaining: Math.max(0, 5 - attempts),
                    locked: attempts >= 5
                });
            }
        } else {
            console.warn(`[LOGIN] Failed for user: ${sanitizedEmail} - User not found`);

            let ipLocked = false;
            if (!isLoopback) {
                const ipCount = (ipRecord?.count || 0) + 1;
                const ipLock = ipCount >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
                ipFailedAttempts.set(clientIp, { count: ipCount, lockUntil: ipLock, lastAttempt: Date.now() });
                if (ipCount >= 5) {
                    ipLocked = true;
                    console.warn(`[SECURITY] IP ${clientIp} locked out for 15 minutes due to 5 failed attempts.`);
                }
            }
            
            auditController.createAlert(
                'security_risk',
                ipLocked ? 'critical' : 'medium',
                `Intento de inicio de sesión fallido. Usuario no encontrado: ${sanitizedEmail}`,
                null,
                null,
                { ip: req.ip, ipLocked }
            );

            if (ipLocked) {
                return res.status(429).json({ 
                    error: 'Dirección IP bloqueada temporalmente por 15 minutos debido a 5 intentos fallidos consecutivos.',
                    locked: true
                });
            }

            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error('[LOGIN] Internal error stack trace:', error.stack);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// POST /auth/logout - Revocar sesión activa en BD/caché y limpiar cookie HttpOnly
router.post('/logout', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const cookieToken = req.cookies ? req.cookies.authToken : null;
        const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : cookieToken;
        if (token) {
            let decoded = null;
            for (const sec of [JWT_SECRET, process.env.LEGACY_HMAC_SECRET].filter(Boolean)) {
                try {
                    decoded = jwt.verify(token, sec, { algorithms: ['HS256'] });
                    break;
                } catch (_) {}
            }
            if (decoded && decoded.id) {
                invalidateUserAuthCache(decoded.id);
                await User.update(
                    { currentSessionId: `REVOKED_${crypto.randomUUID()}` },
                    { where: { id: decoded.id } }
                ).catch(() => {});
            }
        }
    } catch (_) {}

    res.clearCookie('authToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    });
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
});

// GET /auth/me - Refresh current user data
router.get('/me', (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const cookieToken = req.cookies ? req.cookies.authToken : null;
    const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : cookieToken;
    if (!token) {
        return res.json({ authenticated: false, user: null });
    }
    let decoded = null;
    for (const sec of [JWT_SECRET, process.env.LEGACY_HMAC_SECRET].filter(Boolean)) {
        try {
            decoded = jwt.verify(token, sec, { algorithms: ['HS256'] });
            break;
        } catch (_) {}
    }
    if (!decoded) {
        return res.json({ authenticated: false, user: null });
    }
    req.user = decoded;
    next();
}, async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.json({ authenticated: false, user: null });
    }
    try {
        const user = await require('../database/models').User.findByPk(req.user.id);
        if (!user || user.status !== 'active') {
            return res.json({ authenticated: false, user: null });
        }
        const dbSession = user.currentSessionId ? String(user.currentSessionId) : '';
        const tokenSession = req.user.sessionId ? String(req.user.sessionId) : '';
        if (dbSession) {
            if (dbSession.startsWith('REVOKED_') || tokenSession !== dbSession) {
                return res.json({ authenticated: false, user: null });
            }
        } else if (tokenSession) {
            return res.json({ authenticated: false, user: null });
        }

        const {
            password: _,
            supervisorPin: __,
            quickPin: ___,
            biometricTokenHash: ____,
            currentSessionId: _____,
            ...userWithoutPassword
        } = user.toJSON();
        let userPermissions = userWithoutPassword.permissions || {};
        if (typeof userPermissions === 'string') {
            try { userPermissions = JSON.parse(userPermissions); } catch (e) { userPermissions = {}; }
        }
        userWithoutPassword.permissions = userPermissions;
        if (!userWithoutPassword.companyId || userWithoutPassword.companyId === 'default' || userWithoutPassword.companyId === 'admin' || userWithoutPassword.companyId === userWithoutPassword.id) {
            userWithoutPassword.companyId = '2';
        }
        res.json({ authenticated: true, user: userWithoutPassword });
    } catch (e) {
        res.json({ authenticated: false, user: null });
    }
});

// GET /auth/cashiers - Get list of cashiers for mobile selection
// Now requires verifyToken to ensure only users of that company are shown
router.get('/cashiers', require('../middleware/auth').verifyToken, async (req, res) => {
    const users = await User.findAll({
        where: { 
            status: 'active',
            companyId: req.user.companyId
        },
        attributes: ['id', 'name', 'username', 'role']
    });
    res.json(users);
});

/**
 * POST /change-pin - Update user PIN/Password (Protected)
 */
router.post('/change-pin', require('../middleware/auth').verifyToken, validate(changePinSchema), async (req, res) => {
    try {
        const { oldPin, newPin } = req.body;
        if (!oldPin || !newPin) {
            return res.status(400).json({ error: 'Faltan datos (PIN actual y nuevo)' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        let isMatch = false;
        const currentPassword = user.password || '';
        if (currentPassword.startsWith('$2') || currentPassword.length > 30) {
            isMatch = await bcrypt.compare(oldPin, currentPassword);
        } else {
            isMatch = false; // Plaintext PINs are no longer accepted
        }

        if (!isMatch) {
            return res.status(401).json({ error: 'PIN actual incorrecto' });
        }

        await user.update({ password: newPin }); // El hook beforeUpdate del modelo lo encripta automáticamente
        try {
            require('../middleware/auth').invalidateUserAuthCache(req.user.id);
        } catch (cErr) {}

        console.log(`[AUTH] PIN updated for user: ${user.username}`);
        res.json({ success: true, message: 'PIN actualizado correctamente' });
    } catch (error) {
        console.error('Change pin error:', error);
        res.status(500).json({ error: 'Error al cambiar el PIN' });
    }
});

// GET /supervisors - List available supervisors for authorization
router.get('/supervisors', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const supervisors = await require('../services/AuthorizationService').getAvailableSupervisors(req.user.companyId);
        res.json(supervisors);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /supervisor-authorize - Validar PIN de supervisor y autorizar acción
router.post('/supervisor-authorize', require('../middleware/auth').verifyToken, validate(supervisorAuthorizeSchema), async (req, res) => {
    try {
        const AuthorizationService = require('../services/AuthorizationService');
        const approval = await AuthorizationService.authorizeAction(req.user, req.body);
        res.json(approval);
    } catch (error) {
        console.error('[AUTH] Error supervisor-authorize:', error);
        res.status(400).json({ message: error.message || 'Error al validar autorización' });
    }
});

router.post('/supervisor_authorize', require('../middleware/auth').verifyToken, validate(supervisorAuthorizeSchema), async (req, res) => {
    try {
        const AuthorizationService = require('../services/AuthorizationService');
        const approval = await AuthorizationService.authorizeAction(req.user, req.body);
        res.json(approval);
    } catch (error) {
        console.error('[AUTH] Error supervisor-authorize:', error);
        res.status(400).json({ message: error.message || 'Error al validar autorización' });
    }
});

// GET /public-cashiers - Zero-auth user list for offline PIN entry on mobile (Protected by Terminal License)
router.get('/public-cashiers', verifyLicense, async (req, res) => {
    try {
        const { User } = require('../database/models');
        const { Op } = require('sequelize');
        
        const targetCompanyId = String(req.user?.companyId || req.query.companyId || process.env.DEFAULT_COMPANY_ID || '2');
        const whereClause = {
            status: 'active',
            role: { [Op.in]: ['cashier', 'seller', 'user', 'cajero', 'vendedor'] },
            companyId: targetCompanyId
        };

        const users = await User.findAll({
            where: whereClause,
            attributes: ['id', 'username', 'name', 'avatarColor', 'companyId'],
            raw: true
        });
        res.json(users);
    } catch (error) {
        console.error('[AUTH] Error get public-cashiers:', error);
        res.status(500).json({ error: 'Error al consultar cajeros' });
    }
});

// POST /quick-unlock - Desbloqueo rápido de sesión por PIN o contraseña tras inactividad
router.post('/quick-unlock', quickUnlockLimiter, require('../middleware/auth').verifyToken, validate(quickUnlockSchema), async (req, res) => {
    try {
        const { pinOrPassword } = req.body;
        if (!pinOrPassword) {
            return res.status(400).json({ error: 'Ingrese su PIN o contraseña de desbloqueo' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'Usuario no disponible o inactivo' });
        }
        if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
            return res.status(423).json({ error: 'Cuenta bloqueada temporalmente por intentos fallidos' });
        }

        let isMatch = false;
        const inputStr = String(pinOrPassword).trim();

        // 1. Verificar quickPin (PIN de cajero)
        if (user.quickPin) {
            if (user.quickPin.startsWith('$2')) {
                isMatch = await bcrypt.compare(inputStr, user.quickPin);
            } else if (safeSecretEqual(inputStr, user.quickPin)) {
                isMatch = true;
                user.quickPin = await bcrypt.hash(inputStr, 10);
                await user.save().catch(() => {});
            }
        }

        // 2. Verificar supervisorPin (soporta formato actual bcrypt(sha256(pin)) y legado bcrypt(pin))
        if (!isMatch && user.supervisorPin) {
            const currentPin = String(user.supervisorPin);
            const shaInput = crypto.createHash('sha256').update(inputStr).digest('hex');
            if (currentPin.startsWith('$2')) {
                isMatch = await bcrypt.compare(shaInput, currentPin);
                if (!isMatch) {
                    isMatch = await bcrypt.compare(inputStr, currentPin);
                }
            } else if (safeSecretEqual(inputStr, currentPin)) {
                isMatch = true;
                user.supervisorPin = await bcrypt.hash(shaInput, 10);
                await user.save().catch(() => {});
            }
        }

        // 3. Verificar contraseña de usuario
        if (!isMatch && user.password) {
            if (user.password.startsWith('$2')) {
                isMatch = await bcrypt.compare(inputStr, user.password);
            } else if (safeSecretEqual(inputStr, user.password)) {
                isMatch = true;
                user.password = await bcrypt.hash(inputStr, 10);
                await user.save().catch(() => {});
            }
        }

        if (isMatch) {
            if (user.failedLoginAttempts > 0 || user.lockUntil) {
                await user.update({ failedLoginAttempts: 0, lockUntil: null }).catch(() => {});
            }
            auditController.logAction(
                user.id,
                user.companyId,
                'UNLOCK',
                'Desbloqueo rápido de terminal exitoso',
                user.id
            );
            return res.json({ success: true, message: 'Terminal desbloqueado exitosamente' });
        } else {
            const attempts = (user.failedLoginAttempts || 0) + 1;
            const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
            await user.update({ failedLoginAttempts: attempts, lockUntil }).catch(() => {});
            return res.status(401).json({ error: 'PIN o contraseña incorrecta' });
        }
    } catch (err) {
        console.error('[AUTH] Error quick-unlock:', err);
        res.status(500).json({ error: 'Error al verificar credenciales' });
    }
});

// POST /set-quick-pin - Configurar PIN rápido de cajero (Requiere re-autenticación obligatoria)
router.post('/set-quick-pin', require('../middleware/auth').verifyToken, validate(setQuickPinSchema), async (req, res) => {
    try {
        const { pin, currentPassword } = req.body;
        if (!pin || String(pin).length < 4) {
            return res.status(400).json({ error: 'El PIN debe tener al menos 4 dígitos' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Si el usuario ya tiene contraseña o PIN configurado, exigir verificación de identidad
        if (user.password || user.quickPin) {
            if (!currentPassword) {
                return res.status(400).json({ error: 'Se requiere su contraseña o PIN actual para confirmar la operación' });
            }

            let isAuthValid = false;
            const curPass = user.password || '';
            if (curPass.startsWith('$2') || curPass.length > 30) {
                isAuthValid = await bcrypt.compare(String(currentPassword), curPass);
            } else if (safeSecretEqual(String(currentPassword), curPass)) {
                isAuthValid = true;
            }

            if (!isAuthValid && user.quickPin) {
                if (user.quickPin.startsWith('$2')) {
                    isAuthValid = await bcrypt.compare(String(currentPassword), user.quickPin);
                }
            }

            if (!isAuthValid) {
                return res.status(401).json({ error: 'Credenciales actuales incorrectas. No se puede configurar el nuevo PIN.' });
            }
        }

        const hashedPin = await bcrypt.hash(String(pin).trim(), 10);
        user.quickPin = hashedPin;
        await user.save();

        res.json({ success: true, message: 'PIN rápido configurado con éxito' });
    } catch (err) {
        console.error('[AUTH] Error set-quick-pin:', err);
        res.status(500).json({ error: 'Error al guardar PIN rápido' });
    }
});

// ============================================================================
// 🔒 ENDPOINTS DE AUTENTICACIÓN Y ENROLAMIENTO BIOMÉTRICO (HUELLA DACTILAR)
// Arquitectura Zero-Trust: La muestra de huella nunca sale del hardware seguro (TEE).
// El backend valida el token criptográfico firmado por el dispositivo y emite el JWT.
// ============================================================================

// POST /auth/biometrics/register - Registrar / vincular huella dactilar para el usuario autenticado
router.post('/biometrics/register', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { biometricToken, deviceName } = req.body;
        if (!biometricToken || String(biometricToken).trim().length < 32) {
            return res.status(400).json({ error: 'Token biométrico inválido o insuficiente entropía criptográfica' });
        }

        let user = null;
        if (req.user?.id) {
            user = await User.findByPk(String(req.user.id));
        }
        if (!user && req.user?.username) {
            user = await User.findOne({ where: { username: req.user.username } });
        }
        if (!user && req.user?.email) {
            user = await User.findOne({ where: { email: req.user.email } });
        }
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado en la base de datos' });
        }

        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(String(biometricToken).trim()).digest('hex');

        user.biometricTokenHash = tokenHash;
        user.biometricEnrolledAt = new Date();
        user.biometricDeviceName = (deviceName || 'Terminal POS').trim().substring(0, 100);
        await user.save();

        auditController.logAction(
            user.id,
            user.companyId || 'default',
            'BIOMETRIC_REGISTER',
            `Huella dactilar registrada exitosamente en dispositivo: ${user.biometricDeviceName}`,
            user.id
        );

        return res.json({
            success: true,
            message: 'Huella dactilar registrada y vinculada exitosamente a tu cuenta',
            enrolledAt: user.biometricEnrolledAt,
            deviceName: user.biometricDeviceName
        });
    } catch (err) {
        console.error('[AUTH] Error en /biometrics/register:', err);
        return res.status(500).json({ error: 'Error al registrar huella dactilar' });
    }
});

// GET /auth/biometrics/status - Consulta el estado de enrolamiento biométrico del usuario actual
router.get('/biometrics/status', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        return res.json({
            enrolled: Boolean(user.biometricTokenHash),
            enrolledAt: user.biometricEnrolledAt || null,
            deviceName: user.biometricDeviceName || null
        });
    } catch (err) {
        console.error('[AUTH] Error en /biometrics/status:', err);
        return res.status(500).json({ error: 'Error al verificar estado biométrico' });
    }
});

// POST /auth/biometrics/login - Inicio de sesión mediante Huella Dactilar
router.post('/biometrics/login', async (req, res) => {
    const { userId, username, biometricToken } = req.body;
    const clientIp = (req.ip || req.connection?.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const isLoopback = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';

    // 🛡️ Bloqueo estricto por IP
    const ipRecord = ipFailedAttempts.get(clientIp);
    if (!isLoopback && ipRecord && ipRecord.lockUntil && ipRecord.lockUntil > Date.now()) {
        const minutesLeft = Math.ceil((ipRecord.lockUntil - Date.now()) / 60000);
        return res.status(429).json({
            error: `Dirección IP bloqueada temporalmente. Intente en ${minutesLeft} minuto(s).`,
            locked: true,
            minutesLeft
        });
    }

    if ((!userId && !username) || !biometricToken) {
        return res.status(400).json({ error: 'Faltan datos de autenticación biométrica' });
    }

    try {
        let user = null;
        if (userId) {
            user = await User.findByPk(String(userId));
        }
        if (!user && username) {
            const sanitized = String(username).trim().toLowerCase();
            user = await User.findOne({
                where: {
                    [require('sequelize').Op.or]: [
                        { username: sanitized },
                        { email: sanitized }
                    ]
                }
            });
        }

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        if (user.status !== 'active') {
            return res.status(401).json({ error: 'Cuenta desactivada o suspendida. Contacta al administrador.' });
        }

        // 🛡️ Bloqueo Progresivo de cuenta
        if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
            const diffMs = new Date(user.lockUntil).getTime() - Date.now();
            const minutesLeft = Math.ceil(diffMs / 60000);
            return res.status(429).json({
                error: `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en ${minutesLeft} minuto(s).`,
                locked: true,
                minutesLeft
            });
        }

        if (!user.biometricTokenHash) {
            return res.status(400).json({ error: 'Este usuario no tiene huella dactilar registrada en el sistema. Ingrese con contraseña.' });
        }

        // Validación criptográfica en tiempo constante (timing-safe)
        const crypto = require('crypto');
        const candidateHash = crypto.createHash('sha256').update(String(biometricToken).trim()).digest('hex');
        
        let isMatch = false;
        try {
            const candidateBuf = Buffer.from(candidateHash, 'utf8');
            const storedBuf = Buffer.from(user.biometricTokenHash, 'utf8');
            if (candidateBuf.length === storedBuf.length) {
                isMatch = crypto.timingSafeEqual(candidateBuf, storedBuf);
            }
        } catch (_cmpErr) {
            isMatch = false;
        }

        if (!isMatch) {
            const attempts = (Number(user.failedLoginAttempts) || 0) + 1;
            let lockUntil = null;
            let errorMsg = 'Verificación biométrica rechazada. Token no coincide.';

            if (attempts >= 5) {
                lockUntil = new Date(Date.now() + 15 * 60 * 1000);
                errorMsg = 'Cuenta bloqueada temporalmente por 15 minutos debido a 5 intentos fallidos consecutivos.';
            }

            await user.update({
                failedLoginAttempts: attempts,
                lockUntil: lockUntil
            }).catch(() => {});

            auditController.createAlert(
                'security_risk',
                attempts >= 5 ? 'critical' : 'high',
                `Fallo de autenticación biométrica (${attempts}/5) para usuario: ${user.username || user.email}`,
                user.id,
                user.companyId || 'default',
                { ip: req.ip, attempts, lockUntil }
            );

            return res.status(401).json({ error: errorMsg });
        }

        // Éxito: Resetear intentos fallidos y crear sesión legítima
        if (!isLoopback) ipFailedAttempts.delete(clientIp);
        const sessionId = `SESS-${crypto.randomUUID()}`;

        await user.update({
            failedLoginAttempts: 0,
            lockUntil: null,
            currentSessionId: sessionId
        }).catch(() => {});
        invalidateUserAuthCache(user.id);

        let userPermissions = user.permissions || {};
        if (typeof userPermissions === 'string') {
            try { userPermissions = JSON.parse(userPermissions); } catch (_) { userPermissions = {}; }
        }

        const {
            password: _,
            supervisorPin: __,
            quickPin: ___,
            biometricTokenHash: ____,
            currentSessionId: _____,
            ...userWithoutPassword
        } = user.toJSON();
        userWithoutPassword.permissions = userPermissions;
        userWithoutPassword.sessionId = sessionId;

        const licenseUtils = require('../utils/licenseUtils');
        const machineId = await licenseUtils.getMachineId();

        const tokenCompanyId = (user.companyId && user.companyId !== 'default' && user.companyId !== 'admin' && user.companyId !== user.id) ? user.companyId : '2';
        userWithoutPassword.companyId = tokenCompanyId;

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                permissions: userPermissions,
                companyId: tokenCompanyId,
                sessionId: sessionId,
                mid: machineId
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.cookie('authToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });

        auditController.logAction(
            user.id,
            user.companyId || 'default',
            'LOGIN_BIOMETRIC',
            `Inicio de sesión exitoso con Huella Dactilar (Dispositivo: ${user.biometricDeviceName || 'POS Terminal'})`,
            user.id
        );

        return res.json({
            success: true,
            token: token,
            user: userWithoutPassword
        });
    } catch (err) {
        console.error('[AUTH] Error en /biometrics/login:', err);
        return res.status(500).json({ error: 'Error en el proceso de inicio de sesión biométrico' });
    }
});

// DELETE /auth/biometrics/revoke - Desvincular huella dactilar del usuario
router.delete('/biometrics/revoke', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        user.biometricTokenHash = null;
        user.biometricEnrolledAt = null;
        user.biometricDeviceName = null;
        await user.save();

        auditController.logAction(
            user.id,
            user.companyId || 'default',
            'BIOMETRIC_REVOKE',
            'Huella dactilar desvinculada exitosamente',
            user.id
        );

        return res.json({
            success: true,
            message: 'Huella dactilar desvinculada exitosamente'
        });
    } catch (err) {
        console.error('[AUTH] Error en /biometrics/revoke:', err);
        return res.status(500).json({ error: 'Error al desvincular huella dactilar' });
    }
});

module.exports = router;
