const { User, SupervisorApproval } = require('../database/models');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { generateRobustId, safeSecretEqual } = require('../utils/helpers');
const { verifyEcdsaBiometricChallenge } = require('../utils/biometricChallengeStore');

const failedPinAttempts = new Map(); // key: `${companyId}:${supervisorId}:${reqUser.id}`, value: { count, lockedUntil }

class AuthorizationService {
    /**
     * Valida un PIN de supervisor o firma biométrica ECDSA P-256 v2 y registra la autorización.
     */
    async authorizeAction(reqUser, authData) {
        if (!reqUser || !reqUser.id || reqUser.role === 'public_guest' || reqUser.isPublicContext) {
            throw new Error('ACCESO_DENEGADO: Se requiere un usuario autenticado para realizar autorizaciones.');
        }

        const { supervisorId, pin, actionType, referenceId, metadata = {} } = authData || {};
        const companyId = reqUser.companyId || 'default';

        // 0. Protección contra Fuerza Bruta en memoria por pareja (cajero -> supervisor)
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

        if (supervisor.status && supervisor.status !== 'active') {
            throw new Error('La cuenta del supervisor está inactiva o suspendida.');
        }

        // 1b. Protección persistente en BD contra Fuerza Bruta (sobrevive a reinicios del proceso)
        if (supervisor.lockUntil && new Date(supervisor.lockUntil).getTime() > Date.now()) {
            const waitMinutes = Math.max(1, Math.ceil((new Date(supervisor.lockUntil).getTime() - Date.now()) / 60000));
            throw new Error(`BLOQUEO_SEGURIDAD: Supervisor bloqueado temporalmente por intentos fallidos. Intenta en ${waitMinutes} minuto(s).`);
        }

        // 2. Validar rol (Solo Supervisor, Admin, Owner o Superadmin pueden autorizar)
        const allowedRoles = ['supervisor', 'admin', 'owner', 'superadmin'];
        if (!allowedRoles.includes(String(supervisor.role || '').toLowerCase())) {
            throw new Error('El usuario seleccionado no tiene rango de supervisor.');
        }

        // 3. Validar PIN o Biometría criptográfica ECDSA P-256 v2
        let isValid = false;

        if (authData.isBiometric) {
            // Regla Zero-Trust: La huella solo puede autorizar cuando el titular de la sesión
            // ES el propio supervisor seleccionado Y presenta una firma ECDSA P-256 v2 sobre reto one-time.
            const reqRole = String(reqUser.role || '').toLowerCase();
            if (String(reqUser.id) !== String(supervisor.id) || !allowedRoles.includes(reqRole)) {
                throw new Error('Por seguridad, cuando la sesión activa pertenece a un cajero, el supervisor debe autorizar ingresando su PIN secreto.');
            }

            const { challengeId, signature } = authData;
            if (!challengeId || !signature) {
                throw new Error('BIOMETRIC_V2_REQUIRED: La autorización biométrica requiere firma criptográfica ECDSA P-256 v2 sobre reto de un solo uso.');
            }

            const bioCheck = verifyEcdsaBiometricChallenge({
                challengeId,
                userId: supervisor.id,
                signature,
                storedBiometricTokenHash: supervisor.biometricTokenHash
            });

            if (!bioCheck.valid) {
                if (bioCheck.code === 'BIOMETRIC_NOT_ENROLLED' || bioCheck.code === 'BIOMETRIC_V2_REQUIRED' || bioCheck.code === 'BIOMETRIC_CHALLENGE_EXPIRED') {
                    throw new Error(bioCheck.error);
                }
                isValid = false;
            } else {
                isValid = true;
            }
        } else {
            if (!supervisor.supervisorPin) {
                throw new Error('El supervisor no tiene un PIN configurado.');
            }
            if (!pin || String(pin).trim().length === 0) {
                throw new Error('Debe ingresar el PIN del supervisor.');
            }

            if (supervisor.supervisorPin.startsWith('$2') || supervisor.supervisorPin.length > 30) {
                isValid = await bcrypt.compare(String(pin), supervisor.supervisorPin);
                if (!isValid) {
                    const sha256Pin = crypto.createHash('sha256').update(String(pin)).digest('hex');
                    isValid = await bcrypt.compare(sha256Pin, supervisor.supervisorPin);
                }
            } else {
                // Soporte de PIN legacy plano con auto-migración (tiempo constante)
                if (safeSecretEqual(String(pin), supervisor.supervisorPin)) {
                    isValid = true;
                    supervisor.supervisorPin = await bcrypt.hash(crypto.createHash('sha256').update(String(pin)).digest('hex'), 10);
                    await supervisor.save().catch(() => {});
                }
            }
        }

        if (!isValid) {
            const currentCount = (attemptInfo ? attemptInfo.count : 0) + 1;
            const dbAttempts = (Number(supervisor.failedLoginAttempts) || 0) + 1;
            const shouldLock = currentCount >= 5 || dbAttempts >= 5;
            const lockUntilDate = shouldLock ? new Date(Date.now() + 10 * 60 * 1000) : null;

            if (typeof supervisor.update === 'function') {
                await supervisor.update({
                    failedLoginAttempts: dbAttempts,
                    ...(lockUntilDate ? { lockUntil: lockUntilDate } : {})
                }).catch(() => {});
            }

            if (shouldLock) {
                failedPinAttempts.set(attemptKey, { count: currentCount, lockedUntil: Date.now() + 10 * 60 * 1000 });
                try {
                    const AlertService = require('./AlertService');
                    if (typeof AlertService.triggerAlert === 'function') {
                        AlertService.triggerAlert({
                            companyId,
                            userId: reqUser.id,
                            type: 'SECURITY_BRUTE_FORCE',
                            severity: 'high',
                            message: `El usuario ${reqUser.username || reqUser.id} ha fallado 5 intentos de autorización contra el supervisor ${supervisor.username}. Bloqueado 10 min.`,
                            metadata: {
                                title: 'Alerta de Seguridad: Intentos de PIN excedidos',
                                referenceId: supervisor.id,
                                supervisorUsername: supervisor.username,
                                actionType: actionType || 'GENERAL_ACTION'
                            }
                        }).catch(() => {});
                    }
                } catch (_alertErr) {}
                throw new Error('BLOQUEO_SEGURIDAD: Has excedido el límite de 5 intentos de PIN. El acceso ha sido bloqueado por 10 minutos.');
            } else {
                failedPinAttempts.set(attemptKey, { count: currentCount, lockedUntil: null });
                const remaining = Math.max(1, 5 - Math.max(currentCount, dbAttempts));
                throw new Error(`PIN de autorización incorrecto. Te quedan ${remaining} intento(s) antes del bloqueo de seguridad.`);
            }
        }

        // Éxito: Limpiar historial de intentos fallidos en memoria y BD
        failedPinAttempts.delete(attemptKey);
        if ((Number(supervisor.failedLoginAttempts) || 0) > 0 || supervisor.lockUntil) {
            if (typeof supervisor.update === 'function') {
                await supervisor.update({ failedLoginAttempts: 0, lockUntil: null }).catch(() => {});
            }
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
                authMethod: authData.isBiometric ? 'BIOMETRIC_HARDWARE_ECDSA_V2' : 'SUPERVISOR_PIN',
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
