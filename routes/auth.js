const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const auditController = require('../controllers/audit');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be defined. Refusing to start.');
}

router.post('/login', async (req, res) => {
    const { email, username, password } = req.body;

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
                }
            });
        } catch (dbErr) {
            console.warn(`[LOGIN] Initial lookup failed: ${dbErr.message}. Retrying fallback...`);
            // FALLBACK: If 'username' column doesn't exist yet, query by email only
            if (dbErr.message.includes('no such column') || dbErr.message.includes('username')) {
                authenticatedUser = await User.findOne({
                    where: { email: sanitizedEmail }
                });
            } else {
                throw dbErr; // Re-throw if it's a different DB error
            }
        }

        if (authenticatedUser) {
            console.log(`[LOGIN-DEBUG] User found: ${authenticatedUser.email}`);
            let isMatch = false;
            const currentPassword = authenticatedUser.password || '';

            if (currentPassword.startsWith('$2') || currentPassword.length > 30) {
                isMatch = await bcrypt.compare(password, currentPassword);
            } else {
                // Legacy plaintext password check
                if (password === currentPassword) {
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

            if (isMatch) {
                const { password: _, ...userWithoutPassword } = authenticatedUser.toJSON();

                const licenseUtils = require('../utils/licenseUtils');
                const machineId = await licenseUtils.getMachineId();

                const secret = JWT_SECRET;

                // For SQLite (local mode), always use 'default' as companyId
                // to ensure data visibility regardless of what's stored in the DB.
                const { sequelize: seqInstance } = require('../database/connection');
                const isSQLite = seqInstance.getDialect() === 'sqlite';
                const tokenCompanyId = isSQLite
                    ? 'default'
                    : (authenticatedUser.companyId || (authenticatedUser.role === 'superadmin' ? authenticatedUser.id : null));

                const token = jwt.sign(
                    {
                        id: authenticatedUser.id,
                        email: authenticatedUser.email,
                        role: authenticatedUser.role,
                        companyId: tokenCompanyId,
                        mid: machineId // Bind token to this specific hardware
                    },
                    secret,
                    { expiresIn: '24h' } // Reducido a 24 horas por seguridad
                );

                console.log(`[LOGIN] Success for user: ${authenticatedUser.email} (ID: ${authenticatedUser.id})`);
                
                res.cookie('authToken', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 24 * 60 * 60 * 1000, // 24 hours in ms
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
                
                // Generar alerta de seguridad
                auditController.createAlert(
                    'security_risk',
                    'high',
                    `Intento de inicio de sesión fallido para el usuario: ${sanitizedEmail}`,
                    authenticatedUser.id,
                    authenticatedUser.companyId,
                    { ip: req.ip }
                );

                res.status(401).json({ error: 'Credenciales inválidas' });
            }
        } else {
            console.warn(`[LOGIN] Failed for user: ${sanitizedEmail} - User not found`);
            
            auditController.createAlert(
                'security_risk',
                'medium',
                `Intento de inicio de sesión fallido. Usuario no encontrado: ${sanitizedEmail}`,
                null,
                null,
                { ip: req.ip }
            );

            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error('[LOGIN] Internal error stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error interno del servidor'
        });
    }
});

// POST /auth/logout - Limpiar la cookie HttpOnly
router.post('/logout', (req, res) => {
    res.clearCookie('authToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    });
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
});

// GET /auth/me - Refresh current user data
router.get('/me', async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.json({ authenticated: false, user: null });
    }
    try {
        const user = await require('../database/models').User.findByPk(req.user.id);
        if (!user) return res.json({ authenticated: false, user: null });
        const { password: _, ...userWithoutPassword } = user.toJSON();
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
router.post('/change-pin', require('../middleware/auth').verifyToken, async (req, res) => {
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

// POST /supervisor-authorize - Validate supervisor PIN and log approval
router.post('/supervisor-authorize', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const approval = await require('../services/AuthorizationService').authorizeAction(req.user, req.body);
        res.json(approval);
    } catch (error) {
        res.status(401).json({ message: error.message });
    }
});

module.exports = router;
