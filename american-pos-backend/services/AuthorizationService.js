const { User, SupervisorApproval } = require('../database/models');
const bcrypt = require('bcryptjs');
const { generateRobustId } = require('../utils/helpers');

const failedPinAttempts = new Map(); // key: `${companyId}:${supervisorId}:${reqUser.id}`, value: { count, lockedUntil }

class AuthorizationService {
    /**
     * Valida un PIN de supervisor y registra la autorización.
     */
    async authorizeAction(reqUser, authData) {
        if (!reqUser || !reqUser.id || reqUser.role === 'public_guest' || reqUser.isPublicContext) {
            throw new Error('ACCESO_DENEGADO: Se requiere un usuario autenticado para realizar autorizaciones.');
        }

        const { supervisorId, pin, actionType, referenceId, metadata = {} } = authData || {};
        const companyId = reqUser.companyId || 'default';

        // 0. Protección contra Fuerza Bruta (Brute-Force Lockout)
        const attemptKey = `${companyId}:${supervisorId}:${reqUser.id}`;
        const attemptInfo = failedPinAttempts.get(attemptKey);
        if (attemptInfo && attemptInfo.lockedUntil && attemptInfo.lockedUntil > Date.now()) {
            const waitMinutes = Math.ceil((attemptInfo.lockedUntil - Date.now()) / 60000);
            throw new Error(`BLOQUEO_SEGURIDAD: Demasiados intentos fallidos de PIN. Bloqueado temporalmente por ${waitMinutes} minuto(s).`);
        }

        // 1. Buscar al supervisor
        const { Op } = require('sequelize');
        const compCondition = (!companyId || companyId === '2' || companyId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : companyId;

        const supervisor = await User.findOne({
            where: { id: supervisorId, companyId: compCondition }
        });

        if (!supervisor) {
            throw new Error('Supervisor no encontrado.');
        }

        // 2. Validar rol (Solo Supervisor, Admin, Owner o Superadmin pueden autorizar)
        const allowedRoles = ['supervisor', 'admin', 'owner', 'superadmin'];
        if (!allowedRoles.includes(supervisor.role)) {
            throw new Error('El usuario seleccionado no tiene rango de supervisor.');
        }

        // 3. Validar PIN o Biometría
        let isValid = false;

        if (authData.isBiometric) {
            // Autorización biométrica local validada por hardware (TEE/Keystore/WebAuthn).
            // Regla Zero-Trust: La huella local del dispositivo solo puede autorizar cuando el
            // titular de la sesión activa ES el propio supervisor seleccionado. Si la sesión
            // pertenece a un cajero, el supervisor debe ingresar su PIN secreto.
            if (!reqUser || !reqUser.id || reqUser.role === 'public_guest' || reqUser.isPublicContext) {
                throw new Error('ACCESO_DENEGADO: Se requiere una sesión de usuario válida para autorizaciones.');
            }
            const reqRole = String(reqUser.role || '').toLowerCase();
            if (String(reqUser.id) !== String(supervisor.id) || !allowedRoles.includes(reqRole)) {
                throw new Error('Por seguridad, cuando la sesión activa pertenece a un cajero, el supervisor debe autorizar ingresando su PIN secreto.');
            }
            isValid = true;
        } else {
            if (!supervisor.supervisorPin) {
                throw new Error('El supervisor no tiene un PIN configurado.');
            }

            const crypto = require('crypto');
            if (supervisor.supervisorPin.startsWith('$2') || supervisor.supervisorPin.length > 30) {
                isValid = await bcrypt.compare(String(pin), supervisor.supervisorPin);
                if (!isValid) {
                    const sha256Pin = crypto.createHash('sha256').update(String(pin)).digest('hex');
                    isValid = await bcrypt.compare(sha256Pin, supervisor.supervisorPin);
                }
            } else {
                // Soporte de PIN legacy plano con auto-migración
                if (String(pin) === supervisor.supervisorPin) {
                    isValid = true;
                    supervisor.supervisorPin = await bcrypt.hash(crypto.createHash('sha256').update(String(pin)).digest('hex'), 10);
                    await supervisor.save().catch(() => {});
                }
            }
        }

        if (!isValid) {
            const currentCount = (attemptInfo ? attemptInfo.count : 0) + 1;
            if (currentCount >= 5) {
                failedPinAttempts.set(attemptKey, { count: currentCount, lockedUntil: Date.now() + 10 * 60 * 1000 });
                try {
                    const AlertService = require('./AlertService');
                    AlertService.createAlert({
                        companyId,
                        type: 'SECURITY_BRUTE_FORCE',
                        severity: 'HIGH',
                        title: 'Alerta de Seguridad: Intentos de PIN excedidos',
                        message: `El usuario ${reqUser.username || reqUser.id} ha fallado 5 intentos de PIN contra el supervisor ${supervisor.username}. Bloqueado 10 min.`,
                        referenceId: supervisor.id
                    }).catch(() => {});
                } catch (e) {}
                throw new Error('BLOQUEO_SEGURIDAD: Has excedido el límite de 5 intentos de PIN. El acceso ha sido bloqueado por 10 minutos.');
            } else {
                failedPinAttempts.set(attemptKey, { count: currentCount, lockedUntil: null });
                const remaining = 5 - currentCount;
                throw new Error(`PIN de autorización incorrecto. Te quedan ${remaining} intento(s) antes del bloqueo de seguridad.`);
            }
        }

        // Éxito: Limpiar historial de intentos fallidos
        failedPinAttempts.delete(attemptKey);

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
                authMethod: authData.isBiometric ? 'BIOMETRIC_HARDWARE' : 'SUPERVISOR_PIN',
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
        const { Op } = require('sequelize');
        const compCondition = (!companyId || companyId === '2' || companyId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : companyId;

        return await User.findAll({
            where: { 
                companyId: compCondition,
                role: ['supervisor', 'admin', 'owner', 'superadmin'],
                status: 'active'
            },
            attributes: ['id', 'name', 'username', 'role']
        });
    }
}

module.exports = new AuthorizationService();
