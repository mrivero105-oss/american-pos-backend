const { User, SupervisorApproval } = require('../database/models');
const bcrypt = require('bcryptjs');
const { generateRobustId } = require('../utils/helpers');

class AuthorizationService {
    /**
     * Valida un PIN de supervisor y registra la autorización.
     */
    async authorizeAction(reqUser, authData) {
        const { supervisorId, pin, actionType, referenceId, metadata = {} } = authData;
        const { companyId } = reqUser;

        // 1. Buscar al supervisor
        const supervisor = await User.findOne({
            where: { id: supervisorId, companyId }
        });

        if (!supervisor) {
            throw new Error('Supervisor no encontrado.');
        }

        // 2. Validar rol (Solo Supervisor, Admin, Owner o Superadmin pueden autorizar)
        const allowedRoles = ['supervisor', 'admin', 'owner', 'superadmin'];
        if (!allowedRoles.includes(supervisor.role)) {
            throw new Error('El usuario seleccionado no tiene rango de supervisor.');
        }

        // 3. Validar PIN
        if (!supervisor.supervisorPin) {
            throw new Error('El supervisor no tiene un PIN configurado.');
        }

        const crypto = require('crypto');
        let isValid = await bcrypt.compare(String(pin), supervisor.supervisorPin);

        // Si el frontend envió el PIN como hash SHA-256 por seguridad en LAN (64 caracteres hex)
        if (!isValid && typeof pin === 'string' && pin.length === 64 && /^[a-f0-9]{64}$/i.test(pin)) {
            for (let i = 0; i <= 999999; i++) {
                const candidate = String(i).padStart(4, '0');
                const candidateHash = crypto.createHash('sha256').update(candidate).digest('hex');
                if (candidateHash === pin) {
                    if (await bcrypt.compare(candidate, supervisor.supervisorPin)) {
                        isValid = true;
                        // Migración automática transparente a SHA-256 + Bcrypt
                        supervisor.supervisorPin = await bcrypt.hash(pin, 10);
                        await supervisor.save();
                        break;
                    }
                }
            }
        } else if (!isValid && typeof pin === 'string' && pin.length <= 6) {
            // Si enviaron el PIN crudo pero la base ya estaba migrada a SHA-256
            const sha256Pin = crypto.createHash('sha256').update(String(pin)).digest('hex');
            isValid = await bcrypt.compare(sha256Pin, supervisor.supervisorPin);
        }

        if (!isValid) {
            throw new Error('PIN de autorización incorrecto.');
        }

        // 4. Registrar la aprobación
        const approval = await SupervisorApproval.create({
            id: generateRobustId(),
            actionType,
            performedBy: reqUser.id,
            approvedBy: supervisor.id,
            referenceId,
            companyId,
            metadata: {
                ...metadata,
                performerName: reqUser.name || reqUser.username,
                approverName: supervisor.name || supervisor.username
            },
            timestamp: new Date()
        });

        console.log(`[AUTH] Acción ${actionType} autorizada por ${supervisor.username} para ${reqUser.username}`);

        return approval;
    }

    /**
     * Obtiene la lista de supervisores/admins disponibles para autorizar.
     */
    async getAvailableSupervisors(companyId) {
        return await User.findAll({
            where: { 
                companyId,
                role: ['supervisor', 'admin', 'owner', 'superadmin'],
                status: 'active'
            },
            attributes: ['id', 'name', 'username', 'role']
        });
    }
}

module.exports = new AuthorizationService();
