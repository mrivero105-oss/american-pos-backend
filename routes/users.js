const express = require('express');
const router = express.Router();
const { User } = require('../database/models');
const { isSuperAdmin } = require('../middleware/auth');
const { generateRobustId } = require('../utils/helpers');

// All user management routes require superadmin role
router.use(isSuperAdmin);

router.get('/', async (req, res) => {
    try {
        const users = await User.findAll({
            where: { companyId: req.user.companyId },
            attributes: { exclude: ['password'] }
        });
        if (users.length > 0) {
            console.log('[DEBUG] First user being sent to frontend:', users[0].toJSON());
        }
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { email, username, password, role, name } = req.body;
        const sanitizedEmail = email ? email.trim().toLowerCase() : '';
        
        // Generate default username if not provided
        let sanitizedUsername = username ? username.trim().toLowerCase() : '';
        if (!sanitizedUsername && sanitizedEmail) {
            sanitizedUsername = sanitizedEmail.split('@')[0];
        }

        // Check if email or username already exists
        const existingUser = await User.findOne({ 
            where: { 
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

        const newUser = await User.create({
            id: newUserId,
            email: sanitizedEmail,
            username: sanitizedUsername,
            password: password,
            role: role || 'user',
            name: name || sanitizedUsername, // Priority to the name field provided
            status: 'active',
            defaultCurrency: req.body.defaultCurrency || 'BOTH',
            // If it's a new superadmin, it gets its own independent companyId
            companyId: isNewCompany ? newUserId : req.user.companyId
        });

        const { password: _, ...safeUser } = newUser.toJSON();
        res.status(201).json(safeUser);
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Error interno al crear usuario' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        
        console.log(`[DEBUG] Updating user ${id} with body:`, req.body);

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
        const fields = ['name', 'password', 'role', 'status', 'email', 'username', 'defaultCurrency', 'activeBranchId'];
        
        fields.forEach(field => {
            if (req.body[field] !== undefined) {
                allowedUpdates[field] = req.body[field];
            }
        });

        const [updated] = await User.update(allowedUpdates, {
            where: { 
                id, 
                companyId: req.user.companyId 
            },
            individualHooks: true // IMPORTANTE: Ejecuta el hook de bcrypt para hashear el password
        });

        if (updated) {
            res.json({ message: 'Usuario actualizado correctamente' });
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
        const { companyId } = req.user;

        const targetUser = await User.findOne({ where: { id, companyId } });
        if (!targetUser) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        if (targetUser.id === req.user.id) {
            return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta' });
        }

        // Si el usuario está activo, el primer clic en eliminar lo desactiva (Soft Delete)
        if (targetUser.status !== 'inactive') {
            await targetUser.update({ status: 'inactive' });
            return res.json({ message: 'Usuario desactivado correctamente' });
        }

        // Si el usuario YA está inactivo, el segundo clic lo ELIMINA DEFINITIVAMENTE (Hard Delete)
        try {
            await targetUser.destroy();
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
            return res.json({ message: 'Usuario eliminado definitivamente (historial reasignado al administrador)' });
        }
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

// POST /:id/supervisor-pin - Update supervisor PIN (Admin only)
router.post('/:id/supervisor-pin', async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;
        const bcrypt = require('bcryptjs');
        const { AuditLog } = require('../database/models');

        // 1. Validaciones de PIN (Soporta SHA-256 en LAN o numérico directo)
        const isSha256 = typeof pin === 'string' && pin.length === 64 && /^[a-f0-9]{64}$/i.test(pin);
        if (!isSha256 && (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin))) {
            return res.status(400).json({ message: 'El PIN debe ser numérico de 4 a 6 dígitos.' });
        }

        // Evitar secuencias simples en texto plano
        const simpleSequences = ['1234', '12345', '123456', '0000', '1111', '2222', '3333', '4444', '5555', '6666'];
        if (!isSha256 && simpleSequences.includes(pin)) {
            return res.status(400).json({ message: 'El PIN es demasiado simple/predecible.' });
        }

        // 2. Hashear PIN con SHA-256 (si viene en plano) y luego con Bcrypt
        const crypto = require('crypto');
        const pinToHash = isSha256 ? pin : crypto.createHash('sha256').update(String(pin)).digest('hex');
        const hashedPin = await bcrypt.hash(pinToHash, 10);

        // 3. Actualizar Usuario
        const user = await User.findOne({ where: { id, companyId: req.user.companyId } });
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });

        await user.update({ supervisorPin: hashedPin });

        // 4. Log de Auditoría Obligatorio
        await AuditLog.create({
            id: generateRobustId(),
            userId: req.user.id,
            companyId: req.user.companyId,
            action: 'USER_PIN_UPDATE',
            details: `PIN de supervisor actualizado para usuario: ${user.username} (${user.id})`,
            timestamp: new Date().toISOString()
        });

        res.json({ success: true, message: 'PIN actualizado correctamente.' });
    } catch (error) {
        console.error('PIN update error:', error);
        res.status(500).json({ message: 'Error interno al actualizar PIN.' });
    }
});

module.exports = router;
