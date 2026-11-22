const express = require('express');
const router = express.Router();
const { User } = require('../database/models');
const { isAdmin, isSuperAdmin, invalidateUserAuthCache } = require('../middleware/auth');
const { generateRobustId, safeSecretEqual } = require('../utils/helpers');
const validate = require('../middleware/validate');
const { createUserSchema, updateUserSchema, supervisorPinSchema } = require('../schemas/userSchema');
const { Op } = require('sequelize');

// All user management routes require admin role
router.use(isAdmin);

router.get('/', async (req, res) => {
    try {
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;

        const OWNER_ROLES = ['owner', 'dueño', 'dueno'];
        const normReqRole = String(req.user.role || '').trim().toLowerCase();
        const revealMaster = normReqRole === 'superadmin';
        const revealOwner = revealMaster || OWNER_ROLES.includes(normReqRole);
        const whereCondition = revealMaster
            ? { companyId: companyCondition }
            : revealOwner
                ? { companyId: companyCondition, role: { [Op.ne]: 'superadmin' } }
                : { companyId: companyCondition, role: { [Op.notIn]: ['superadmin', ...OWNER_ROLES] } };
        
        let users;
        try {
            users = await User.findAll({
                where: whereCondition,
                attributes: { exclude: ['password', 'quickPin', 'biometricTokenHash', 'currentSessionId'] }
            });
        } catch (attrErr) {
            console.warn('[Get users] Full attributes query failed, falling back to core attributes:', attrErr.message);
            users = await User.findAll({
                where: whereCondition,
                attributes: ['id', 'username', 'email', 'name', 'role', 'status', 'companyId', 'supervisorPin']
            });
        }

        const safeUsers = users
            .filter(u => revealMaster || String(u.role || '').toLowerCase() !== 'superadmin')
            .map(u => {
                const json = u.toJSON ? u.toJSON() : { ...u };
                const hasSupervisorPin = Boolean(json.supervisorPin);
                delete json.password;
                delete json.quickPin;
                delete json.biometricTokenHash;
                return {
                    ...json,
                    supervisorPin: hasSupervisorPin ? 'CONFIGURED' : null,
                    hasPin: hasSupervisorPin,
                    hasSupervisorPin: hasSupervisorPin
                };
            });

        res.json(safeUsers);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

router.post('/', validate(createUserSchema), async (req, res) => {
    try {
        const { email, username, password, role, name } = req.body;
        const sanitizedEmail = email ? email.trim().toLowerCase() : '';
        
        // Generate default username if not provided
        let sanitizedUsername = username ? username.trim().toLowerCase() : '';
        if (!sanitizedUsername && sanitizedEmail) {
            sanitizedUsername = sanitizedEmail.split('@')[0];
        }

        // Check if email or username already exists within the company
        const existingUser = await User.findOne({ 
            where: { 
                companyId: req.user.companyId,
                [require('sequelize').Op.or]: [
                    { email: sanitizedEmail },
                    { username: sanitizedUsername }
                ]
            } 
        });

        if (existingUser) {
            const field = existingUser.email === sanitizedEmail ? 'correo electrónico' : 'nombre de usuario';
            return res.status(400).json({
                error: 'duplicate_field',
                message: `El ${field} ya está registrado en el sistema.`
            });
        }

        const newUserId = generateRobustId();
        const isNewCompany = (role === 'superadmin');

        const normNewRole = String(role || '').trim().toLowerCase();
        const normActorRole = String(req.user.role || '').trim().toLowerCase();
        if (normNewRole === 'superadmin' && normActorRole !== 'superadmin') {
            return res.status(403).json({
                error: 'forbidden',
                message: 'Solo el Superadministrador principal puede asignar el rol de Superadmin.'
            });
        }
        if (['owner', 'dueño', 'dueno'].includes(normNewRole) && !['superadmin', 'owner', 'dueño', 'dueno'].includes(normActorRole)) {
            return res.status(403).json({
                error: 'forbidden',
                message: 'Solo el Propietario o Superadministrador puede asignar el rol de Propietario.'
            });
        }

        let hashedSupervisorPin = null;
        if (req.body.supervisorPin) {
            const pin = String(req.body.supervisorPin).trim();
            const isSha256 = pin.length === 64 && /^[a-f0-9]{64}$/i.test(pin);
            if (isSha256 || (pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin))) {
                const crypto = require('crypto');
                const bcrypt = require('bcryptjs');
                const pinToHash = isSha256 ? pin : crypto.createHash('sha256').update(pin).digest('hex');
                hashedSupervisorPin = await bcrypt.hash(pinToHash, 10);
            }
        }

        const newUser = await User.create({
            id: newUserId,
            email: sanitizedEmail,
            username: sanitizedUsername,
            password: password,
            supervisorPin: hashedSupervisorPin,
            role: role || 'user',
            name: name || sanitizedUsername, // Priority to the name field provided
            status: req.body.status || 'active',
            defaultCurrency: req.body.defaultCurrency || 'BOTH',
            activeBranchId: req.body.activeBranchId || null,
            phone: req.body.phone || null,
            avatarColor: req.body.avatarColor || null,
            permissions: req.body.permissions || {},
            // If it's a new superadmin, it gets its own independent companyId
            companyId: isNewCompany ? newUserId : req.user.companyId
        });

        const { password: _, supervisorPin: _pin, quickPin: _qpin, biometricTokenHash: _bio, ...safeUser } = newUser.toJSON();
        const safeCreatedUser = {
            ...safeUser,
            hasPin: Boolean(hashedSupervisorPin),
            hasSupervisorPin: Boolean(hashedSupervisorPin),
            supervisorPin: hashedSupervisorPin ? 'CONFIGURED' : null
        };
        res.status(201).json(safeCreatedUser);
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Error interno al crear usuario' });
    }
});

router.put('/:id', validate(updateUserSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        
        const redactedKeys = Object.keys(req.body || {}).filter(
            (k) => !['password', 'supervisorPin', 'quickPin', 'biometricTokenHash'].includes(k)
        );
        console.log(`[AUDIT] Updating user ${id} (fields: ${redactedKeys.join(', ') || 'none'})`);

        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;

        const targetUser = await User.findOne({ where: { id, companyId: companyCondition } });
        if (!targetUser) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const normActorPut = String(req.user.role || '').trim().toLowerCase();
        const normBodyRolePut = String(req.body.role || '').trim().toLowerCase();
        const normTargetPut = String(targetUser.role || '').trim().toLowerCase();
        if (normActorPut !== 'superadmin') {
            if (normBodyRolePut === 'superadmin' || normTargetPut === 'superadmin') {
                return res.status(403).json({
                    error: 'forbidden',
                    message: 'Solo el Superadministrador principal puede asignar o modificar cuentas de Superadmin.'
                });
            }
        }
        if (!['superadmin', 'owner', 'dueño', 'dueno'].includes(normActorPut)) {
            if (['owner', 'dueño', 'dueno'].includes(normBodyRolePut) || ['owner', 'dueño', 'dueno'].includes(normTargetPut)) {
                return res.status(403).json({
                    error: 'forbidden',
                    message: 'Solo el Propietario o Superadministrador puede asignar o modificar cuentas de Propietario.'
                });
            }
        }

        // 1. If email is being changed, check for duplicates
        if (email) {
            const sanitizedEmail = email.trim().toLowerCase();
            const existingUser = await User.findOne({ 
                where: { 
                    email: sanitizedEmail,
                    id: { [require('sequelize').Op.ne]: id } // Not the current user
                } 
            });

            if (existingUser) {
                return res.status(400).json({ 
                    error: 'duplicate_email',
                    message: 'Este correo ya está en uso por otro usuario.' 
                });
            }
            req.body.email = sanitizedEmail;
        }

        // 2. Filtrar campos permitidos y Ejecutar Update
        const allowedUpdates = {};
        const fields = ['name', 'password', 'role', 'status', 'email', 'username', 'defaultCurrency', 'activeBranchId', 'phone', 'avatarColor', 'permissions'];
        
        fields.forEach(field => {
            if (req.body[field] !== undefined) {
                allowedUpdates[field] = req.body[field];
            }
        });

        if (req.body.supervisorPin !== undefined) {
            const rawPin = req.body.supervisorPin;
            if (!rawPin) {
                allowedUpdates.supervisorPin = null;
            } else {
                const targetUser = await User.findOne({ where: { id, companyId: companyCondition } });
                if (targetUser && targetUser.supervisorPin) {
                    const currentPin = req.body.currentPin;
                    if (!currentPin) {
                        return res.status(400).json({ message: 'Por motivos de seguridad, debes ingresar el PIN actual para cambiarlo.' });
                    }
                    const crypto = require('crypto');
                    const bcrypt = require('bcryptjs');
                    const cleanCurrent = String(currentPin).trim();
                    const isCurrentSha256 = cleanCurrent.length === 64 && /^[a-f0-9]{64}$/i.test(cleanCurrent);
                    const currentSha256 = isCurrentSha256 ? cleanCurrent : crypto.createHash('sha256').update(cleanCurrent).digest('hex');

                    let isValidOldPin = false;
                    if (targetUser.supervisorPin.startsWith('$2') || targetUser.supervisorPin.length > 30) {
                        isValidOldPin = await bcrypt.compare(currentSha256, targetUser.supervisorPin);
                        if (!isValidOldPin) {
                            isValidOldPin = await bcrypt.compare(cleanCurrent, targetUser.supervisorPin);
                        }
                    } else {
                        isValidOldPin = (safeSecretEqual(cleanCurrent, targetUser.supervisorPin) || safeSecretEqual(currentSha256, targetUser.supervisorPin));
                    }

                    if (!isValidOldPin) {
                        return res.status(401).json({ message: 'El PIN actual ingresado es incorrecto.' });
                    }
                }

                const cleanPin = String(rawPin).trim();
                const isSha256 = cleanPin.length === 64 && /^[a-f0-9]{64}$/i.test(cleanPin);
                if (isSha256 || (cleanPin.length >= 4 && cleanPin.length <= 6 && /^\d+$/.test(cleanPin))) {
                    const crypto = require('crypto');
                    const bcrypt = require('bcryptjs');
                    const pinToHash = isSha256 ? cleanPin : crypto.createHash('sha256').update(cleanPin).digest('hex');
                    allowedUpdates.supervisorPin = await bcrypt.hash(pinToHash, 10);
                }
            }
        }

        if (allowedUpdates.password || (allowedUpdates.status && allowedUpdates.status !== 'active')) {
            const { revokeSession } = require('../utils/sessionRegistry');
            allowedUpdates.currentSessionId = revokeSession(null, null, { allDevices: true });
        }

        const [updated] = await User.update(allowedUpdates, {
            where: { 
                id, 
                companyId: companyCondition 
            },
            individualHooks: true // IMPORTANTE: Ejecuta el hook de bcrypt para hashear el password
        });

        if (updated) {
            invalidateUserAuthCache(id);
            const freshUser = await User.findOne({
                where: { id, companyId: companyCondition },
                attributes: { exclude: ['password', 'quickPin', 'biometricTokenHash', 'currentSessionId'] }
            });
            let userPermissions = freshUser?.permissions || {};
            if (typeof userPermissions === 'string') {
                try { userPermissions = JSON.parse(userPermissions); } catch (e) { userPermissions = {}; }
            }
            const freshJson = freshUser ? freshUser.toJSON() : {};
            const hasSupervisorPin = Boolean(freshJson.supervisorPin);
            delete freshJson.password;
            delete freshJson.quickPin;
            delete freshJson.biometricTokenHash;
            const cleanUser = {
                ...freshJson,
                permissions: userPermissions,
                hasPin: hasSupervisorPin,
                hasSupervisorPin: hasSupervisorPin,
                supervisorPin: hasSupervisorPin ? 'CONFIGURED' : null
            };

            const io = req.app.get('io') || global.io;
            if (io && req.user?.companyId) {
                io.to(req.user.companyId).emit('user_updated', { userId: id, user: cleanUser });
                io.to(req.user.companyId).emit('users_changed');
            }

            res.json({ message: 'Usuario actualizado correctamente', user: cleanUser });
        } else {
            res.status(404).json({ message: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Update user error:', error);
        // Robust error mapping for Sequelize Unique Constraints
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ 
                error: 'duplicate_field',
                message: 'Uno de los campos (email o username) ya está en uso.' 
            });
        }
        res.status(500).json({ error: 'Error interno al actualizar usuario' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;

        const targetUser = await User.findOne({ where: { id, companyId: companyCondition } });
        if (!targetUser) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        if (targetUser.id === req.user.id) {
            return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta' });
        }

        const normActorDel = String(req.user.role || '').trim().toLowerCase();
        const normTargetDel = String(targetUser.role || '').trim().toLowerCase();
        if (normTargetDel === 'superadmin' && normActorDel !== 'superadmin') {
            return res.status(403).json({
                error: 'forbidden',
                message: 'Solo el Superadministrador principal puede alterar o eliminar cuentas de Superadmin.'
            });
        }
        if (['owner', 'dueño', 'dueno'].includes(normTargetDel) && !['superadmin', 'owner', 'dueño', 'dueno'].includes(normActorDel)) {
            return res.status(403).json({
                error: 'forbidden',
                message: 'Solo el Propietario o Superadministrador puede alterar o eliminar cuentas de Propietario.'
            });
        }

        // Si el usuario está activo, el primer clic en eliminar lo desactiva (Soft Delete)
        if (targetUser.status !== 'inactive') {
            await targetUser.update({ status: 'inactive' });
            invalidateUserAuthCache(id);
            return res.json({ message: 'Usuario desactivado correctamente' });
        }

        // Si el usuario YA está inactivo, el segundo clic lo ELIMINA DEFINITIVAMENTE (Hard Delete)
        try {
            await targetUser.destroy();
            invalidateUserAuthCache(id);
            return res.json({ message: 'Usuario eliminado definitivamente del sistema' });
        } catch (fkError) {
            // Si tiene registros históricos (ventas, turnos, auditoría) que impiden el borrado físico:
            // Reasignamos esos historiales al administrador actual para conservar la integridad contable y permitir eliminar la cuenta.
            const { AuditLog, CashShift, Sale, StockMovement, Alert, SupervisorApproval, Message, Expense, PurchaseOrder, QuarantineSale, Branch, Product, Customer, Supplier, Refund, CreditHistory, SupplierCreditHistory, Quotation, CashMovement, CashDeclaration } = require('../database/models');
            const adminId = req.user.id;

            const modelsWithUserId = [AuditLog, CashShift, Sale, StockMovement, Alert, Expense, PurchaseOrder, QuarantineSale, Branch, Product, Customer, Supplier, Refund, CreditHistory, SupplierCreditHistory, Quotation, CashMovement, CashDeclaration];
            for (const model of modelsWithUserId) {
                if (model && model.rawAttributes && model.rawAttributes.userId) {
                    await model.update({ userId: adminId }, { where: { userId: targetUser.id } }).catch(() => {});
                }
            }
            if (SupervisorApproval) {
                await SupervisorApproval.update({ performedBy: adminId }, { where: { performedBy: targetUser.id } }).catch(() => {});
                await SupervisorApproval.update({ approvedBy: adminId }, { where: { approvedBy: targetUser.id } }).catch(() => {});
            }
            if (Message) {
                await Message.update({ senderId: adminId }, { where: { senderId: targetUser.id } }).catch(() => {});
            }

            await targetUser.destroy();
            invalidateUserAuthCache(targetUser.id);
            return res.json({ message: 'Usuario eliminado definitivamente (historial reasignado al administrador)' });
        }
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

// POST /:id/supervisor-pin - Update supervisor PIN (Admin only)
router.post('/:id/supervisor-pin', validate(supervisorPinSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const { pin, currentPin } = req.body;
        const bcrypt = require('bcryptjs');
        const crypto = require('crypto');
        const { AuditLog } = require('../database/models');

        // 1. Buscar Usuario
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        const user = await User.findOne({ where: { id, companyId: companyCondition } });
        const normActorPin = String(req.user.role || '').trim().toLowerCase();
        const normTargetPin = String(user && user.role || '').trim().toLowerCase();
        if (!user || (normTargetPin === 'superadmin' && normActorPin !== 'superadmin') || (['owner', 'dueño', 'dueno'].includes(normTargetPin) && !['superadmin', 'owner', 'dueño', 'dueno'].includes(normActorPin))) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        // 2. Si el usuario ya tiene un PIN configurado, es OBLIGATORIO validar el PIN actual
        if (user.supervisorPin) {
            if (!currentPin) {
                return res.status(400).json({ message: 'Por motivos de seguridad, debes ingresar el PIN actual para autorizar el cambio.' });
            }

            const cleanCurrent = String(currentPin).trim();
            const isCurrentSha256 = cleanCurrent.length === 64 && /^[a-f0-9]{64}$/i.test(cleanCurrent);
            const currentSha256 = isCurrentSha256 ? cleanCurrent : crypto.createHash('sha256').update(cleanCurrent).digest('hex');

            let isValidOldPin = false;
            if (user.supervisorPin.startsWith('$2') || user.supervisorPin.length > 30) {
                isValidOldPin = await bcrypt.compare(currentSha256, user.supervisorPin);
                if (!isValidOldPin) {
                    isValidOldPin = await bcrypt.compare(cleanCurrent, user.supervisorPin);
                }
            } else {
                isValidOldPin = (safeSecretEqual(cleanCurrent, user.supervisorPin) || safeSecretEqual(currentSha256, user.supervisorPin));
            }

            if (!isValidOldPin) {
                return res.status(401).json({ message: 'El PIN actual ingresado es incorrecto.' });
            }
        }

        // 3. Validaciones de nuevo PIN (Soporta SHA-256 en LAN o numérico directo)
        const isSha256 = typeof pin === 'string' && pin.length === 64 && /^[a-f0-9]{64}$/i.test(pin);
        if (!isSha256 && (!pin || String(pin).length < 4 || String(pin).length > 6 || !/^\d+$/.test(String(pin)))) {
            return res.status(400).json({ message: 'El nuevo PIN debe ser numérico de 4 a 6 dígitos.' });
        }

        // 4. Hashear nuevo PIN con SHA-256 (si viene en plano) y luego con Bcrypt
        const pinToHash = isSha256 ? pin : crypto.createHash('sha256').update(String(pin)).digest('hex');
        const hashedPin = await bcrypt.hash(pinToHash, 10);

        // 5. Actualizar Usuario
        await user.update({ supervisorPin: hashedPin });
        invalidateUserAuthCache(id);

        // 6. Log de Auditoría Obligatorio
        await AuditLog.create({
            id: generateRobustId(),
            userId: req.user.id,
            companyId: req.user.companyId,
            action: 'USER_PIN_UPDATE',
            description: `PIN de supervisor actualizado para usuario: ${user.username} (${user.id}) con verificación de clave anterior`,
            timestamp: new Date().toISOString()
        });

        res.json({ success: true, message: 'PIN actualizado correctamente.', hasPin: true });
    } catch (error) {
        console.error('PIN update error:', error);
        res.status(500).json({ message: 'Error interno al actualizar PIN.' });
    }
});

// PATCH /:id/toggle-status - Fast toggle active/inactive status
router.patch('/:id/toggle-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { companyId } = req.user;

        const targetUser = await User.findOne({ where: { id, companyId } });
        const normActorToggle = String(req.user.role || '').trim().toLowerCase();
        const normTargetToggle = String(targetUser && targetUser.role || '').trim().toLowerCase();
        if (!targetUser || (normTargetToggle === 'superadmin' && normActorToggle !== 'superadmin') || (['owner', 'dueño', 'dueno'].includes(normTargetToggle) && !['superadmin', 'owner', 'dueño', 'dueno'].includes(normActorToggle))) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        if (targetUser.id === req.user.id) {
            return res.status(400).json({ message: 'No puedes desactivar tu propia cuenta' });
        }

        const newStatus = targetUser.status === 'active' ? 'inactive' : 'active';
        await targetUser.update({ status: newStatus });
        invalidateUserAuthCache(targetUser.id);

        res.json({ success: true, status: newStatus, message: `Usuario ${newStatus === 'active' ? 'activado' : 'desactivado'} con éxito.` });
    } catch (error) {
        console.error('Toggle status error:', error);
        res.status(500).json({ error: 'Error al cambiar estado del usuario' });
    }
});

// GET /:id/stats - Operator statistics & activity overview
router.get('/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;
        const { companyId } = req.user;
        const { Sale, CashShift } = require('../database/models');

        const [salesCount, totalSalesResult, shiftCount] = await Promise.all([
            Sale.count({ where: { userId: id, companyId } }).catch(() => 0),
            Sale.sum('total', { where: { userId: id, companyId } }).catch(() => 0),
            CashShift.count({ where: { userId: id, companyId } }).catch(() => 0)
        ]);

        const recentShifts = await CashShift.findAll({
            where: { userId: id, companyId },
            limit: 5,
            order: [['openedAt', 'DESC']],
            attributes: ['id', 'openedAt', 'closedAt', 'finalAmount', 'difference', 'status']
        }).catch(() => []);

        res.json({
            salesCount: salesCount || 0,
            totalSold: totalSalesResult || 0,
            shiftCount: shiftCount || 0,
            recentShifts
        });
    } catch (error) {
        console.error('User stats error:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas del usuario' });
    }
});

module.exports = router;
