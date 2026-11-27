/**
 * BiometricService v2 - Isaac POS (Hardware-Backed ECDSA P-256)
 * Arquitectura Zero-Trust:
 * - La llave privada ECDSA P-256 vive exclusivamente en AndroidKeyStore (TEE/StrongBox)
 *   vinculada a BIOMETRIC_STRONG + CryptoObject (nunca se exporta ni toca localStorage).
 * - El inicio de sesión solicita un reto criptográfico de un solo uso (/auth/biometrics/challenge),
 *   lo firma dentro del hardware biométrico y el backend verifica la firma ECDSA contra la clave pública SPKI.
 * - La biometría v1 basada en token estático en localStorage queda retirada de inmediato.
 */

import api from './api';

const BIOMETRIC_CREDENTIAL_KEY = 'isaac_pos_biometric_credential';
const BIOMETRIC_VERSION = 2;

const buildBiometricKeyAlias = (userObj) => {
    const rawId = String(userObj?.id || userObj?.username || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
    return `isaac_pos_bio_v2_${rawId || 'default'}`;
};

class BiometricService {
    constructor() {
        this.isSupported = false;
        this.checkSupport();
    }

    isNativeHardwareBiometricAvailable() {
        return (
            typeof window !== 'undefined' &&
            Boolean(window.Capacitor?.isNativePlatform?.()) &&
            Boolean(window.Capacitor?.Plugins?.PosNativeHardware?.registerBiometricKey) &&
            Boolean(window.Capacitor?.Plugins?.PosNativeHardware?.signBiometricChallenge)
        );
    }

    /**
     * Verifica si el hardware nativo soporta biometría criptográfica fuerte (BIOMETRIC_STRONG + AndroidKeyStore).
     */
    async checkSupport() {
        try {
            if (typeof window === 'undefined') return false;

            if (this.isNativeHardwareBiometricAvailable()) {
                const res = await window.Capacitor.Plugins.PosNativeHardware.isBiometricAvailable();
                this.isSupported = Boolean(res?.available);
                return this.isSupported;
            }

            this.isSupported = false;
            return false;
        } catch (_e) {
            this.isSupported = false;
            return false;
        }
    }

    /**
     * Retroalimentación háptica en dispositivos táctiles.
     */
    triggerHaptic(type = 'success') {
        try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                if (type === 'success') {
                    navigator.vibrate([35]);
                } else if (type === 'error') {
                    navigator.vibrate([60, 50, 60]);
                }
            }
        } catch {
            /* Vibración háptica opcional no soportada */
        }
    }

    /**
     * Obtiene los metadatos NO secretos de la credencial biométrica v2 vinculada a esta terminal.
     * Purga automáticamente credenciales legacy v1 con tokens estáticos en texto plano.
     */
    getEnrolledCredential() {
        try {
            if (typeof localStorage === 'undefined') return null;
            const raw = localStorage.getItem(BIOMETRIC_CREDENTIAL_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);

            // Corte inmediato de v1: eliminar cualquier credencial legacy con biometricToken plano
            if (parsed?.biometricToken || parsed?.version !== BIOMETRIC_VERSION || !parsed?.keyAlias) {
                localStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
                return null;
            }
            if (!parsed?.userId && !parsed?.username) {
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    /**
     * Solicita verificación biométrica fuerte directa al sensor nativo (sin bypass WebAuthn).
     */
    async authenticate(options = {}) {
        const title = options.title || 'Autorización Biométrica';
        const subtitle = options.subtitle || 'Coloca tu huella digital en el sensor';

        if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.authenticateBiometric) {
            try {
                const result = await window.Capacitor.Plugins.PosNativeHardware.authenticateBiometric({
                    title,
                    subtitle,
                    cancelText: 'Cancelar'
                });

                if (result && result.success) {
                    this.triggerHaptic('success');
                    return {
                        success: true,
                        method: 'BIOMETRIC_STRONG_HARDWARE',
                        timestamp: Date.now()
                    };
                }
                throw new Error('Verificación biométrica rechazada');
            } catch (nativeErr) {
                this.triggerHaptic('error');
                throw new Error(nativeErr?.message || 'Autenticación biométrica no completada');
            }
        }

        this.triggerHaptic('error');
        throw new Error('El sensor biométrico de hardware seguro solo está disponible en la app Android instalada con BIOMETRIC_STRONG.');
    }

    /**
     * Enrolar / Registrar par ECDSA P-256 en AndroidKeyStore protegido por huella fuerte.
     * En localStorage solo se almacenan metadatos públicos (nunca secretos ni llaves privadas).
     */
    async registerBiometrics(currentUser, deviceName = '') {
        if (!currentUser || (!currentUser.id && !currentUser.username)) {
            throw new Error('Debes tener una sesión activa para vincular tu huella dactilar.');
        }

        if (!this.isNativeHardwareBiometricAvailable()) {
            throw new Error('La biometría criptográfica v2 requiere la aplicación Android nativa con sensor biométrico fuerte (Clase 3).');
        }

        const keyAlias = buildBiometricKeyAlias(currentUser);
        const resolvedDevice = (deviceName || 'Terminal Móvil Android').trim();

        // 1. Generar par ECDSA P-256 en AndroidKeyStore y exigir huella física vía CryptoObject
        const keyResult = await window.Capacitor.Plugins.PosNativeHardware.registerBiometricKey({
            alias: keyAlias,
            title: 'Vincular Huella Dactilar',
            subtitle: `Coloca tu huella digital para vincular el hardware seguro a ${currentUser.name || currentUser.username}`,
            cancelText: 'Cancelar'
        });

        const publicKeySpki = keyResult?.publicKeySpki;
        if (!publicKeySpki) {
            throw new Error('El hardware seguro no devolvió una clave pública ECDSA válida.');
        }

        // 2. Registrar únicamente la clave pública SPKI en el backend
        const { data } = await api.post('/auth/biometrics/register', {
            publicKeySpki,
            deviceName: resolvedDevice
        });

        // 3. Guardar solo metadatos no secretos en localStorage (sin llaves ni tokens)
        const effectiveAlias = keyResult?.alias || keyAlias;
        const credential = {
            version: BIOMETRIC_VERSION,
            keyAlias: effectiveAlias,
            userId: currentUser.id,
            username: currentUser.username || currentUser.email,
            name: currentUser.name || currentUser.username,
            role: currentUser.role,
            enrolledAt: data.enrolledAt || new Date().toISOString(),
            deviceName: resolvedDevice
        };
        localStorage.setItem(BIOMETRIC_CREDENTIAL_KEY, JSON.stringify(credential));
        this.triggerHaptic('success');

        return {
            success: true,
            credential,
            message: data.message || 'Huella registrada exitosamente'
        };
    }

    /**
     * Iniciar sesión mediante reto de un solo uso firmado por ECDSA P-256 dentro de AndroidKeyStore.
     */
    async loginWithBiometrics() {
        const cred = this.getEnrolledCredential();
        if (!cred || !cred.keyAlias || (!cred.userId && !cred.username)) {
            throw new Error('No hay huella biométrica v2 registrada en este dispositivo. Inicia sesión con contraseña para vincularla.');
        }

        if (!this.isNativeHardwareBiometricAvailable()) {
            throw new Error('Este entorno no soporta firma biométrica en hardware seguro (AndroidKeyStore). Ingresa con tu contraseña.');
        }

        // 1. Solicitar reto criptográfico de un solo uso al backend
        const challengeRes = await api.post('/auth/biometrics/challenge', {
            userId: cred.userId,
            username: cred.username
        }, { timeout: 5000 });

        const { challengeId, challenge } = challengeRes.data || {};
        if (!challengeId || !challenge) {
            throw new Error('El servidor no pudo generar el reto biométrico.');
        }

        // 2. Desbloquear llave privada en AndroidKeyStore vía BiometricPrompt + CryptoObject y firmar el reto
        let signRes;
        try {
            signRes = await window.Capacitor.Plugins.PosNativeHardware.signBiometricChallenge({
                alias: cred.keyAlias,
                challenge,
                title: 'Iniciar Sesión',
                subtitle: `Coloca tu huella digital para acceder como ${cred.name || cred.username}`,
                cancelText: 'Cancelar'
            });
        } catch (nativeErr) {
            this.triggerHaptic('error');
            const errCode = String(nativeErr?.code || '');
            const errMsg = String(nativeErr?.message || '');
            if (errCode.includes('BIOMETRIC_KEY_INVALIDATED') || errMsg.includes('BIOMETRIC_KEY_INVALIDATED')) {
                localStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
                throw new Error('Las huellas del teléfono cambiaron y la clave segura fue invalidada. Inicia sesión con contraseña para volver a vincularla.');
            }
            throw new Error(errMsg || 'Autenticación biométrica cancelada o rechazada.');
        }

        const signature = signRes?.signature;
        if (!signature) {
            this.triggerHaptic('error');
            throw new Error('No se obtuvo firma criptográfica del hardware biométrico.');
        }

        // 3. Enviar firma ECDSA al backend para validación criptográfica y emisión de JWT
        try {
            const response = await api.post('/auth/biometrics/login', {
                userId: cred.userId,
                username: cred.username,
                challengeId,
                signature
            });
            this.triggerHaptic('success');
            return response.data;
        } catch (loginErr) {
            this.triggerHaptic('error');
            if (loginErr?.response?.data?.code === 'BIOMETRIC_V2_REQUIRED') {
                localStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
            }
            throw loginErr;
        }
    }

    /**
     * Firma un reto criptográfico de un solo uso con la clave ECDSA P-256 en AndroidKeyStore
     * para autorización de acciones sensibles por parte del supervisor titular de la sesión.
     */
    async signSupervisorBiometricChallenge(supervisorObj, options = {}) {
        const cred = this.getEnrolledCredential();
        const targetId = supervisorObj?.id;
        if (!cred || !cred.keyAlias || !targetId || String(cred.userId) !== String(targetId)) {
            throw new Error('No hay una huella ECDSA v2 vinculada en este dispositivo para el supervisor seleccionado. Usa tu PIN.');
        }

        if (!this.isNativeHardwareBiometricAvailable()) {
            throw new Error('La autorización biométrica ECDSA v2 requiere la app Android nativa con sensor biométrico fuerte.');
        }

        const challengeRes = await api.post('/auth/biometrics/challenge', {
            userId: cred.userId,
            username: cred.username
        }, { timeout: 5000 });

        const { challengeId, challenge } = challengeRes.data || {};
        if (!challengeId || !challenge) {
            throw new Error('El servidor no pudo emitir un reto criptográfico biométrico.');
        }

        const supervisorName = supervisorObj?.name || supervisorObj?.username || 'Supervisor';
        let signRes;
        try {
            signRes = await window.Capacitor.Plugins.PosNativeHardware.signBiometricChallenge({
                alias: cred.keyAlias,
                challenge,
                title: options.title || 'Autorización de Supervisor',
                subtitle: options.subtitle || `Coloca tu huella para autorizar como ${supervisorName}`,
                cancelText: 'Usar PIN'
            });
        } catch (nativeErr) {
            this.triggerHaptic('error');
            const errCode = String(nativeErr?.code || '');
            const errMsg = String(nativeErr?.message || '');
            if (errCode.includes('BIOMETRIC_KEY_INVALIDATED') || errMsg.includes('BIOMETRIC_KEY_INVALIDATED')) {
                localStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
                throw new Error('Las huellas del dispositivo cambiaron y la llave biométrica fue invalidada. Usa tu PIN y vuelve a vincularla.');
            }
            throw new Error(errMsg || 'Verificación biométrica cancelada o rechazada.');
        }

        const signature = signRes?.signature;
        if (!signature) {
            this.triggerHaptic('error');
            throw new Error('No se recibió firma criptográfica válida del hardware biométrico.');
        }

        this.triggerHaptic('success');
        return { challengeId, signature };
    }

    /**
     * Desvincular huella dactilar del usuario en el backend, borrar clave del Keystore y limpiar metadatos.
     */
    async revokeBiometrics() {
        const cred = this.getEnrolledCredential();
        try {
            await api.delete('/auth/biometrics/revoke');
        } catch (err) {
            console.warn('[Biometric] Error revocando en servidor (se limpia localmente):', err?.message);
        }
        try {
            if (cred?.keyAlias && typeof window !== 'undefined' && window.Capacitor?.Plugins?.PosNativeHardware?.deleteBiometricKey) {
                await window.Capacitor.Plugins.PosNativeHardware.deleteBiometricKey({ alias: cred.keyAlias }).catch(() => {});
            }
        } catch (_e) { /* limpieza best-effort */ }
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
        }
        return { success: true };
    }

    /**
     * Consulta el estado de enrolamiento biométrico v2 del usuario actual en el servidor.
     */
    async getServerStatus() {
        try {
            const { data } = await api.get('/auth/biometrics/status');
            return data;
        } catch {
            return { enrolled: false, version: null, enrolledAt: null, deviceName: null };
        }
    }
}

const biometricService = new BiometricService();
export default biometricService;
