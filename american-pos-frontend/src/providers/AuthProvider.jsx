import { useState, useEffect, useCallback, useRef } from 'react';
import { AuthContext } from '../hooks/AuthContext';
import api, { getBaseUrl } from '../services/api';
import syncService from '../services/syncService';
import biometricService from '../services/biometricService';
import secureMobileStorage from '../utils/secureMobileStorage';
import { getTerminalId } from '../utils/terminalIdentity';
import { normalizeTerminalId, validateLicenseKeyLocally } from '../utils/clientLicenseValidator';
import { IDLE_LOCK_CHANGED_EVENT, getIdleLockTimeoutMs } from '../utils/idleLockSettings';

const OFFLINE_VERIFIERS_KEY = 'isaac_pos_offline_verifiers';
const LEGACY_OFFLINE_BIO_HASHES_KEY = 'isaac_pos_offline_bio_hashes';
const OFFLINE_LOGIN_LOCKOUT_KEY = 'isaac_pos_offline_login_attempts';
const MAX_OFFLINE_LOGIN_ATTEMPTS = 5;
const OFFLINE_LOGIN_LOCK_MS = 5 * 60 * 1000;
let memoryOfflineAttempts = { count: 0, lockUntil: 0 };

function getOfflineLoginLockState() {
    let state = { ...memoryOfflineAttempts };
    try {
        if (typeof sessionStorage !== 'undefined') {
            const raw = sessionStorage.getItem(OFFLINE_LOGIN_LOCKOUT_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    state = {
                        count: Math.max(state.count, Number(parsed.count) || 0),
                        lockUntil: Math.max(state.lockUntil, Number(parsed.lockUntil) || 0)
                    };
                }
            }
        }
    } catch (_storageErr) {
        // Ignorar error de acceso a sessionStorage restringido
    }
    if (state.lockUntil > 0 && Date.now() >= state.lockUntil) {
        state = { count: 0, lockUntil: 0 };
        saveOfflineLoginLockState(state);
    }
    return state;
}

function saveOfflineLoginLockState(nextState) {
    memoryOfflineAttempts = { count: Number(nextState?.count) || 0, lockUntil: Number(nextState?.lockUntil) || 0 };
    try {
        if (typeof sessionStorage !== 'undefined') {
            if (memoryOfflineAttempts.count === 0 && memoryOfflineAttempts.lockUntil === 0) {
                sessionStorage.removeItem(OFFLINE_LOGIN_LOCKOUT_KEY);
            } else {
                sessionStorage.setItem(OFFLINE_LOGIN_LOCKOUT_KEY, JSON.stringify(memoryOfflineAttempts));
            }
        }
    } catch (_storageErr) {
        // Ignorar error de escritura en sessionStorage restringido
    }
}

function pureSha256Hex(asciiInput) {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const bytes = new TextEncoder().encode(String(asciiInput || ''));
    const bitLen = bytes.length * 8;
    const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 4, bitLen >>> 0, false);
    view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const w = new Uint32Array(64);
    for (let i = 0; i < paddedLen; i += 64) {
        for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
        for (let t = 16; t < 64; t++) {
            const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let t = 0; t < 64; t++) {
            const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const ch = (e & f) ^ ((~e) & g);
            const temp1 = (hh + S1 + ch + k[t] + w[t]) >>> 0;
            const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;
            hh = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    return h.map(v => v.toString(16).padStart(8, '0')).join('');
}

async function computeSha256Hex(input) {
    const str = String(input || '');
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
        try {
            const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (cryptoErr) {
            console.warn('[Auth] crypto.subtle SHA-256 no disponible, usando fallback JS:', cryptoErr?.message);
        }
    }
    return pureSha256Hex(str);
}

const OFFLINE_PBKDF2_ITERATIONS = 100000;

async function computePbkdf2Hex(secret, saltHex, iterations = OFFLINE_PBKDF2_ITERATIONS) {
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
        try {
            const enc = new TextEncoder();
            const keyMaterial = await window.crypto.subtle.importKey(
                'raw',
                enc.encode(String(secret || '')),
                'PBKDF2',
                false,
                ['deriveBits']
            );
            const bits = await window.crypto.subtle.deriveBits(
                {
                    name: 'PBKDF2',
                    salt: enc.encode(String(saltHex || '')),
                    iterations,
                    hash: 'SHA-256'
                },
                keyMaterial,
                256
            );
            return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (cryptoErr) {
            console.warn('[Auth] crypto.subtle PBKDF2 no disponible, usando SHA-256 fallback:', cryptoErr?.message);
        }
    }
    return computeSha256Hex(`${saltHex}:${secret}`);
}

function generateSaltHex() {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const arr = new Uint8Array(16);
        window.crypto.getRandomValues(arr);
        return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

async function saveOfflinePasswordVerifier(userObj, rawPassword) {
    if (!userObj || !rawPassword || typeof localStorage === 'undefined') return;
    try {
        const verifiers = JSON.parse(localStorage.getItem(OFFLINE_VERIFIERS_KEY) || '{}');
        const salt = generateSaltHex();
        const kdf = (typeof window !== 'undefined' && window.crypto?.subtle) ? 'pbkdf2' : 'sha256';
        const hash = kdf === 'pbkdf2'
            ? await computePbkdf2Hex(`${String(userObj.id)}:${rawPassword}`, salt, OFFLINE_PBKDF2_ITERATIONS)
            : await computeSha256Hex(`${salt}:${String(userObj.id)}:${rawPassword}`);
        const entry = {
            ver: kdf === 'pbkdf2' ? 2 : 1,
            kdf,
            iterations: kdf === 'pbkdf2' ? OFFLINE_PBKDF2_ITERATIONS : 1,
            salt,
            hash,
            userId: String(userObj.id),
            updatedAt: Date.now()
        };
        if (userObj.id) verifiers[String(userObj.id)] = entry;
        if (userObj.username) verifiers[`u:${String(userObj.username).toLowerCase()}`] = entry;
        if (userObj.email) verifiers[`e:${String(userObj.email).toLowerCase()}`] = entry;
        localStorage.setItem(OFFLINE_VERIFIERS_KEY, JSON.stringify(verifiers));
    } catch (err) {
        console.warn('[Auth] Error guardando verificador offline:', err?.message);
    }
}

async function verifyOfflinePassword(userObj, rawPassword) {
    if (!userObj || !rawPassword || typeof localStorage === 'undefined') return false;
    try {
        const verifiers = JSON.parse(localStorage.getItem(OFFLINE_VERIFIERS_KEY) || '{}');
        const entry =
            verifiers[String(userObj.id)] ||
            (userObj.username ? verifiers[`u:${String(userObj.username).toLowerCase()}`] : null) ||
            (userObj.email ? verifiers[`e:${String(userObj.email).toLowerCase()}`] : null);
        if (!entry?.salt || !entry?.hash) return false;
        const targetUid = String(entry.userId || userObj.id);
        if (entry.ver === 2 && entry.kdf === 'pbkdf2') {
            const computed = await computePbkdf2Hex(`${targetUid}:${rawPassword}`, entry.salt, Number(entry.iterations || OFFLINE_PBKDF2_ITERATIONS));
            return computed === entry.hash;
        }
        const computedLegacy = await computeSha256Hex(`${entry.salt}:${targetUid}:${rawPassword}`);
        if (computedLegacy === entry.hash) {
            // Auto-migrar en caliente a PBKDF2 v2 si el hash legacy v1 coincidió
            await saveOfflinePasswordVerifier({ ...userObj, id: targetUid }, rawPassword);
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}

const LICENSE_INFO_STORAGE_KEY = 'isaac_pos_license_info';

function readStoredLicenseInfo() {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(LICENSE_INFO_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function writeStoredLicenseInfo(info) {
    if (typeof localStorage === 'undefined') return;
    try {
        if (!info) {
            localStorage.removeItem(LICENSE_INFO_STORAGE_KEY);
            return;
        }
        localStorage.setItem(LICENSE_INFO_STORAGE_KEY, JSON.stringify(info));
    } catch (err) {
        console.warn('[Auth] Error guardando información de licencia:', err?.message);
    }
}

function isStoredLicenseBlocked(info) {
    if (!info || typeof info !== 'object') return false;
    if (info.suspended || info.revoked || info.graceExpired || info.clockSkew || info.blockLocalBypass) {
        return true;
    }
    if (info.graceUntil) {
        const graceUntilMs = Date.parse(info.graceUntil);
        if (Number.isFinite(graceUntilMs) && Date.now() > graceUntilMs) {
            return true;
        }
    }
    return false;
}

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const sessionExpiredRef = useRef(false);
    const [licenseInfo, setLicenseInfo] = useState(() => readStoredLicenseInfo());
    const [isActivated, setIsActivated] = useState(() => {
        if (typeof window === 'undefined') return false;
        const storedInfo = readStoredLicenseInfo();
        if (isStoredLicenseBlocked(storedInfo)) return false;
        return localStorage.getItem('isaac_pos_license_activated') === 'true';
    });
    const [machineId, setMachineId] = useState(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem('isaac_pos_license_machine_id') || '';
    });
    const [licenseLoading, setLicenseLoading] = useState(() => {
        if (typeof window === 'undefined') return false;
        const storedInfo = readStoredLicenseInfo();
        if (isStoredLicenseBlocked(storedInfo)) return true;
        // Rendimiento instantáneo: si ya está activado localmente, NO mostrar pantalla de carga
        return localStorage.getItem('isaac_pos_license_activated') !== 'true';
    });

    const appLock = useCallback(() => {
        if (user) setIsLocked(true);
    }, [user]);

    const appUnlock = async (password, isBiometric = false) => {
        try {
            if (isBiometric) {
                if (!user) {
                    return { success: false, message: 'No hay sesión activa para desbloquear.' };
                }
                try {
                    const bioData = await biometricService.loginWithBiometrics();
                    if (bioData?.user?.id && user?.id && String(bioData.user.id) !== String(user.id)) {
                        return {
                            success: false,
                            message: 'La huella registrada pertenece a otro usuario. Ingresa tu PIN o contraseña.'
                        };
                    }
                    if (bioData?.token) {
                        secureMobileStorage.setToken(bioData.token);
                    }
                    if (bioData?.user) {
                        setUser(bioData.user);
                        secureMobileStorage.setUserProfile(bioData.user);
                    }
                    sessionExpiredRef.current = false;
                    setIsLocked(false);
                    secureMobileStorage.setSessionActive(true);
                    return { success: true };
                } catch (bioErr) {
                    if (bioErr?.response) {
                        return {
                            success: false,
                            message: bioErr.response.data?.error || bioErr.response.data?.message || 'Huella biométrica inválida o revocada.'
                        };
                    }
                    return {
                        success: false,
                        message: bioErr?.message || 'No se pudo validar la huella en el servidor. Ingresa tu PIN o contraseña.'
                    };
                }
            }

            // 1. Si el servidor confirmó 401 (sesión expirada/revocada), omitir /quick-unlock y renovar JWT vía /auth/login
            let isNetworkFailure = false;
            if (!sessionExpiredRef.current) {
                try {
                    const quickRes = await api.post('/auth/quick-unlock', { pinOrPassword: password });
                    if (quickRes.data?.success) {
                        setIsLocked(false);
                        secureMobileStorage.setSessionActive(true);
                        return { success: true };
                    }
                } catch (quickErr) {
                    if (quickErr.response?.status === 429) {
                        return { success: false, message: quickErr.response.data?.error || 'Cuenta bloqueada temporalmente' };
                    }
                    if (quickErr.response?.status === 401) {
                        sessionExpiredRef.current = true;
                    }
                    if (!quickErr.response) {
                        isNetworkFailure = true;
                    }
                }
            }

            // 2. Fallback estándar a /auth/login (si hay red) o verificación PBKDF2 local (si la PC/red está caída)
            if (!isNetworkFailure) {
                const username = user?.username || user?.email;
                const response = await api.post('/auth/login', { username, password });
                if (response.data?.success && response.data?.user) {
                    if (response.data.token) {
                        secureMobileStorage.setToken(response.data.token);
                    }
                    sessionExpiredRef.current = false;
                    secureMobileStorage.setSessionActive(true);
                    setUser(response.data.user);
                    secureMobileStorage.setUserProfile(response.data.user);
                    setIsLocked(false);
                    return { success: true };
                }
                return { success: false, message: 'PIN o contraseña incorrectos' };
            }

            // 3. Fallback offline verificado por PBKDF2 local (solo si NO hubo 401 de servidor con red activa)
            if (user && !sessionExpiredRef.current) {
                const isOfflineValid = await verifyOfflinePassword(user, password);
                if (isOfflineValid) {
                    setIsLocked(false);
                    secureMobileStorage.setSessionActive(true);
                    return { success: true, isOffline: true };
                }
            }
            return {
                success: false,
                message: sessionExpiredRef.current
                    ? 'Tu sesión expiró en el servidor. Conéctate e ingresa tu contraseña para renovarla.'
                    : 'Sin conexión: PIN o contraseña no coinciden con la credencial local verificada.'
            };
        } catch (e) {
            if (!e?.response && user && !sessionExpiredRef.current) {
                const isOfflineValid = await verifyOfflinePassword(user, password);
                if (isOfflineValid) {
                    setIsLocked(false);
                    secureMobileStorage.setSessionActive(true);
                    return { success: true, isOffline: true };
                }
            }
            console.error('Unlock error:', e);
            const errorMsg = e.response?.data?.error || 'PIN o contraseña incorrectos';
            return { success: false, message: errorMsg };
        }
    };

    const logout = useCallback(async (isForced = false) => {
        if (!isForced) {
            try {
                await api.post('/auth/logout');
            } catch (e) {
                console.error('Error during logout:', e);
            }
        }
        sessionStorage.removeItem('isaac_pos_session_active');
        secureMobileStorage.removeToken();
        const isMobileClient = typeof window !== 'undefined' && (
            Boolean(window.Capacitor?.isNativePlatform?.()) ||
            window.location.hash.includes('/mobile') ||
            /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
        );
        if (!isMobileClient) {
            secureMobileStorage.removeUserProfile();
        }
        sessionStorage.removeItem('stockAlertDismissed');
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('auth-logout'));
        }
        setUser(null);
        setIsLocked(false);
        window.location.replace(isMobileClient ? '#/mobile' : '#/login');
    }, []);

    const checkLicense = useCallback(async () => {
        const currentTerminalId = getTerminalId();
        const savedActivated = localStorage.getItem('isaac_pos_license_activated') === 'true';
        const savedMachineId = localStorage.getItem('isaac_pos_license_machine_id');
        const savedKey = localStorage.getItem('isaac_pos_license_key');
        const cachedLicenseInfo = readStoredLicenseInfo();
        const cachedBlocked = isStoredLicenseBlocked(cachedLicenseInfo);

        // Si ya está activado localmente para este terminal y NO tiene bloqueo remoto/gracia vencida, confirmar sin bloquear la UI
        const machineIdMatches = !savedMachineId || (normalizeTerminalId(savedMachineId) === normalizeTerminalId(currentTerminalId));
        if (!cachedBlocked && savedActivated && machineIdMatches) {
            setIsActivated(true);
            setMachineId(savedMachineId || currentTerminalId);
            setLicenseLoading(false);
        } else if (!cachedBlocked && savedKey) {
            // Validación criptográfica offline instantánea (~2ms) antes de esperar timeout de red si la PC está apagada
            try {
                const fastLocalCheck = await validateLicenseKeyLocally(savedKey, currentTerminalId);
                if (fastLocalCheck.valid) {
                    localStorage.setItem('isaac_pos_license_activated', 'true');
                    localStorage.setItem('isaac_pos_license_machine_id', currentTerminalId);
                    setIsActivated(true);
                    setMachineId(currentTerminalId);
                    setLicenseLoading(false);
                } else {
                    setLicenseLoading(true);
                }
            } catch (_) {
                setLicenseLoading(true);
            }
        } else if (!savedActivated || cachedBlocked) {
            setLicenseLoading(true);
        }

        const resolveOfflineFallback = async () => {
            const latestStoredInfo = readStoredLicenseInfo();
            if (isStoredLicenseBlocked(latestStoredInfo)) {
                const blockedState = {
                    ...latestStoredInfo,
                    activated: false,
                    graceExpired: Boolean(
                        latestStoredInfo?.graceExpired ||
                        (latestStoredInfo?.graceUntil && Date.now() > Date.parse(latestStoredInfo.graceUntil))
                    )
                };
                if (blockedState.graceExpired && !blockedState.suspended && !blockedState.reason) {
                    blockedState.reason = 'El periodo de gracia sin conexión ha expirado. Conecta el equipo a internet para validar tu licencia.';
                }
                setLicenseInfo(blockedState);
                writeStoredLicenseInfo(blockedState);
                localStorage.removeItem('isaac_pos_license_activated');
                setIsActivated(false);
                setMachineId(savedMachineId || currentTerminalId);
                setLicenseLoading(false);
                return blockedState;
            }

            const isNativeMobile = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
            const hasOfflineProfile = Boolean(secureMobileStorage.getUserProfile() || localStorage.getItem('isaac_pos_cached_cashiers'));
            const hasInheritedServerActivation = Boolean(savedActivated && latestStoredInfo?.isInherited);

            if (savedKey || hasInheritedServerActivation || (isNativeMobile && hasOfflineProfile)) {
                // Exigir prueba verificable offline (llave RSA válida, herencia registrada del servidor o perfil móvil ya sincronizado);
                // nunca confiar en el booleano `isaac_pos_license_activated=true` desnudo en localStorage
                let isLocallyValid = Boolean(hasInheritedServerActivation || (isNativeMobile && hasOfflineProfile));
                if (savedKey) {
                    try {
                        const localCheck = await validateLicenseKeyLocally(savedKey, currentTerminalId);
                        if (localCheck.valid) {
                            isLocallyValid = true;
                        } else if (localCheck.requiresServerValidation && savedActivated && latestStoredInfo?.activated) {
                            isLocallyValid = true;
                        } else if (hasInheritedServerActivation) {
                            // Terminal autorizada por herencia de la licencia del servidor PC: una llave local antigua no debe bloquear el modo offline
                            localStorage.removeItem('isaac_pos_license_key');
                            isLocallyValid = true;
                        } else {
                            isLocallyValid = false;
                        }
                    } catch (err) {
                        console.warn('[Auth] Error validando clave local durante check offline:', err?.message);
                        if (!hasInheritedServerActivation) isLocallyValid = false;
                    }
                }
                if (isLocallyValid) {
                    const effectiveMid = savedMachineId || currentTerminalId;
                    localStorage.setItem('isaac_pos_license_activated', 'true');
                    localStorage.setItem('isaac_pos_license_machine_id', effectiveMid);
                    setIsActivated(true);
                    setMachineId(effectiveMid);
                    setLicenseLoading(false);
                    return { activated: true, isOffline: true, machineId: effectiveMid };
                }
            }

            setIsActivated(false);
            setMachineId(currentTerminalId);
            setLicenseLoading(false);
            return null;
        };

        const configuredBaseUrl = api.defaults?.baseURL || (typeof getBaseUrl === 'function' ? getBaseUrl() : '');
        if (!configuredBaseUrl) {
            return await resolveOfflineFallback();
        }

        try {
            const { data } = await api.get('/license/status', {
                params: { terminalId: currentTerminalId },
                timeout: 8000
            });
            let activated = data.activated === true;
            const assignedMachineId = data.machineId || currentTerminalId;
            const remoteBlocked = Boolean(
                data.suspended ||
                data.revoked ||
                data.graceExpired ||
                data.clockSkew ||
                data.blockLocalBypass
            );

            // Blindaje de Activación Local / Modo Autónomo:
            // Solo re-sincronizamos la clave local si el servidor NO reportó suspensión, revocación ni vencimiento de gracia.
            if (!activated && !remoteBlocked && savedKey) {
                try {
                    const localCheck = await validateLicenseKeyLocally(savedKey, currentTerminalId);
                    if (localCheck.valid) {
                        activated = true;
                        api.post('/license/activate', { key: savedKey, machineId: currentTerminalId }, { timeout: 4000 }).catch(() => {});
                    }
                } catch (err) {
                    console.warn('[Auth] Error validando clave local durante check online:', err?.message);
                }
            }

            // Si la terminal está autorizada por herencia del servidor PC y quedó una llave local obsoleta/inválida,
            // limpiarla para que no anule el arranque offline cuando la PC esté apagada.
            if (activated && data.isInherited && savedKey) {
                try {
                    const staleKeyCheck = await validateLicenseKeyLocally(savedKey, currentTerminalId);
                    if (!staleKeyCheck.valid) {
                        localStorage.removeItem('isaac_pos_license_key');
                    }
                } catch (_) {
                    localStorage.removeItem('isaac_pos_license_key');
                }
            }

            const nextLicenseInfo = activated
                ? {
                    activated: true,
                    isInherited: Boolean(data.isInherited),
                    suspended: false,
                    revoked: false,
                    graceExpired: false,
                    clockSkew: false,
                    blockLocalBypass: false,
                    status: 'active',
                    reason: null,
                    graceUntil: data.onlinePolicy?.graceUntil || null,
                    gatewayConfigured: Boolean(data.gatewayConfigured),
                    onlinePolicy: data.onlinePolicy || null,
                    expiresAt: data.expiresAt || null,
                    updatedAt: Date.now()
                }
                : {
                    activated: false,
                    isInherited: Boolean(data.isInherited),
                    suspended: Boolean(data.suspended),
                    revoked: Boolean(data.revoked),
                    graceExpired: Boolean(data.graceExpired),
                    clockSkew: Boolean(data.clockSkew),
                    blockLocalBypass: remoteBlocked,
                    status: data.status || null,
                    errorCode: data.errorCode || null,
                    reason: data.reason || data.message || null,
                    graceUntil: data.graceUntil || null,
                    gatewayConfigured: Boolean(data.gatewayConfigured),
                    expiresAt: data.expiresAt || null,
                    updatedAt: Date.now()
                };

            setLicenseInfo(nextLicenseInfo);
            writeStoredLicenseInfo(nextLicenseInfo);
            setIsActivated(activated);
            setMachineId(assignedMachineId);
            if (activated) {
                localStorage.setItem('isaac_pos_license_activated', 'true');
                localStorage.setItem('isaac_pos_license_machine_id', assignedMachineId);
                localStorage.setItem('isaac_pos_license_last_validated', Date.now().toString());
            } else {
                localStorage.removeItem('isaac_pos_license_activated');
            }
            setLicenseLoading(false);
            return data;
        } catch (e) {
            console.warn('License check pending or offline:', e?.message || e);
            return await resolveOfflineFallback();
        }
    }, []);

    // Load user from local storage on mount, then refresh from server
    useEffect(() => {
        const CURRENT_VERSION = '4.647.486';
        const storedVersion = localStorage.getItem('app_version');

        const bootstrap = async () => {
            if (storedVersion !== CURRENT_VERSION) {
                console.log(`[VersionCheck] Actualizando versión de ${storedVersion} a ${CURRENT_VERSION}. Preservando datos locales.`);
                localStorage.setItem('app_version', CURRENT_VERSION);
            }
            // Limpiar restos de biometría v1 offline insegura si existieran
            try {
                localStorage.removeItem(LEGACY_OFFLINE_BIO_HASHES_KEY);
            } catch (_cleanupErr) {
                // Limpieza best-effort en storage restringido
            }

            let isSessionActive = secureMobileStorage.isSessionActive();
            const isNativeCapacitor = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());

            // En Android nativo, restaurar el JWT desde Android Keystore (AES-256-GCM) antes de invalidar la sesión
            if (!isSessionActive && isNativeCapacitor) {
                const restoredNativeToken = await secureMobileStorage.restoreTokenFromNative();
                if (restoredNativeToken) {
                    secureMobileStorage.setSessionActive(true);
                    isSessionActive = true;
                }
            }

            if (!isSessionActive) {
                // Arranque seguro: Al encender la PC o abrir la aplicación, exigir login sin restaurar sesión previa
                console.log('🔒 Inicio de sistema/app detectado sin sesión activa. Solicitando credenciales de acceso.');
                secureMobileStorage.removeToken();
                const isMobileClient = isNativeCapacitor || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || ''));
                if (!isMobileClient) {
                    secureMobileStorage.removeUserProfile();
                }
                setUser(null);
                setLoading(false);
                await checkLicense();
                return;
            }

            const isOfflineMode = localStorage.getItem('isaac_pos_is_offline_mode') === 'true';
            const savedProfileObj = secureMobileStorage.getUserProfile();

            if (isOfflineMode && savedProfileObj) {
                setUser({ ...savedProfileObj, isOfflineMode: true });
            } else {
                try {
                    const res = await api.get('/auth/me', savedProfileObj ? { timeout: 3500 } : undefined);
                    if (res.data?.user) {
                        sessionExpiredRef.current = false;
                        setUser(res.data.user);
                        secureMobileStorage.setUserProfile(res.data.user);
                        if (res.data.user.companyId) {
                            localStorage.setItem('companyId', String(res.data.user.companyId));
                        }
                        syncService.autoSyncOnLogin().catch(err => {
                            console.warn('[AuthContext] Background auto-sync notice:', err);
                        });
                    } else if (res.data?.authenticated === false) {
                        // El servidor respondió explícitamente que el token expiró o fue revocado
                        secureMobileStorage.removeToken();
                        secureMobileStorage.setSessionActive(false);
                        setUser(null);
                    } else if (savedProfileObj) {
                        setUser({ ...savedProfileObj, isOfflineMode: true });
                    } else {
                        setUser(null);
                    }
                } catch {
                    if (savedProfileObj) {
                        setUser({ ...savedProfileObj, isOfflineMode: true });
                    } else {
                        setUser(null);
                    }
                }
            }
            setLoading(false);
            await checkLicense();
        };

        bootstrap();
    }, [checkLicense]);

    // Re-verify session and license whenever a server is auto-discovered or manually configured
    useEffect(() => {
        const handleServerAvailable = async (event) => {
            const configuredUrl = event?.detail?.baseUrl || event?.detail?.url || api.defaults?.baseURL || (typeof getBaseUrl === 'function' ? getBaseUrl() : '');
            if (!configuredUrl) return;
            try {
                await checkLicense();
                const isSessionActive = typeof window !== 'undefined' && sessionStorage.getItem('isaac_pos_session_active') === 'true';
                if (!isSessionActive) return;

                const res = await api.get('/auth/me');
                if (res.data?.user) {
                    setUser(res.data.user);
                    if (res.data.user.companyId) {
                        localStorage.setItem('companyId', String(res.data.user.companyId));
                    }
                    syncService.autoSyncOnLogin().catch((e) => console.warn('[Auth] Auto-sync tras discovery falló:', e?.message || e));
                }
            } catch {
                // Ignore silent refresh error if not logged in
            }
        };
        window.addEventListener('server-discovered', handleServerAvailable);
        window.addEventListener('api-base-url-changed', handleServerAvailable);
        return () => {
            window.removeEventListener('server-discovered', handleServerAvailable);
            window.removeEventListener('api-base-url-changed', handleServerAvailable);
        };
    }, [checkLicense]);

    // Listen to global license requirement / invalidity event
    useEffect(() => {
        const handleLicenseRequired = (e) => {
            const detail = e?.detail || {};
            console.warn('[AuthContext] Requerimiento de licencia detectado:', detail);
            const suspended = Boolean(detail.suspended || detail.error === 'licencia_suspendida');
            const graceExpired = Boolean(detail.graceExpired || detail.error === 'licencia_verificacion_requerida');
            const nextBlockedInfo = {
                activated: false,
                suspended,
                revoked: Boolean(detail.revoked),
                graceExpired,
                clockSkew: Boolean(detail.clockSkew),
                blockLocalBypass: Boolean(suspended || graceExpired),
                status: suspended ? 'suspended' : (graceExpired ? 'grace_expired' : detail.error || 'blocked'),
                errorCode: detail.error || null,
                reason: detail.reason || detail.message || null,
                graceUntil: detail.graceUntil || null,
                updatedAt: Date.now()
            };
            setLicenseInfo(nextBlockedInfo);
            writeStoredLicenseInfo(nextBlockedInfo);
            setIsActivated(false);
            localStorage.removeItem('isaac_pos_license_activated');
        };
        window.addEventListener('license-required', handleLicenseRequired);
        return () => window.removeEventListener('license-required', handleLicenseRequired);
    }, []);

    // Listen to global unauthorized event
    useEffect(() => {
        const handleUnauthorized = () => {
            if (isLocked) return;
            sessionExpiredRef.current = true;
            const token = secureMobileStorage.getToken();
            if (user && token) {
                setIsLocked(true);
            } else if (!token) {
                logout(true);
            }
        };
        window.addEventListener('auth-unauthorized', handleUnauthorized);
        return () => window.removeEventListener('auth-unauthorized', handleUnauthorized);
    }, [isLocked, user, logout]);

    // Idle Detection for Auto-Lock (configurable in Settings)
    useEffect(() => {
        let idleTimer;
        let lastMouseMove = 0;

        const resetIdleTimer = () => {
            if (isLocked || !user) return;
            clearTimeout(idleTimer);

            const timeoutMs = getIdleLockTimeoutMs();
            if (timeoutMs <= 0) return;

            idleTimer = setTimeout(() => {
                appLock();
            }, timeoutMs);
        };

        const onMouseMove = () => {
            const now = Date.now();
            if (now - lastMouseMove < 1000) return;
            lastMouseMove = now;
            resetIdleTimer();
        };

        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        if (user && !isLocked) {
            events.forEach(name => window.addEventListener(name, resetIdleTimer));
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener(IDLE_LOCK_CHANGED_EVENT, resetIdleTimer);
            resetIdleTimer();
        }

        return () => {
            events.forEach(name => window.removeEventListener(name, resetIdleTimer));
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener(IDLE_LOCK_CHANGED_EVENT, resetIdleTimer);
            clearTimeout(idleTimer);
        };
    }, [user, isLocked, appLock]);

    const login = async (username, password, options = {}) => {
        const isDeviceOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const preferOffline = Boolean(options.preferOffline || isDeviceOffline);

        // Helper para resolver inicio de sesión offline estricto con rate-limit progresivo (5 intentos -> 5 min bloqueo)
        const resolveOfflineLogin = async () => {
            const lockState = getOfflineLoginLockState();
            if (lockState.lockUntil > Date.now()) {
                const mins = Math.max(1, Math.ceil((lockState.lockUntil - Date.now()) / 60000));
                return {
                    success: false,
                    message: `Demasiados intentos fallidos sin conexión. Espera ${mins} minuto(s) antes de volver a intentar.`
                };
            }

            const parsedProfile = secureMobileStorage.getUserProfile();
            let offlineUser = null;
            if (parsedProfile && (parsedProfile.username?.toLowerCase() === username.toLowerCase() || parsedProfile.email?.toLowerCase() === username.toLowerCase())) {
                offlineUser = parsedProfile;
            }

            if (!offlineUser) {
                try {
                    const cachedCashiers = JSON.parse(localStorage.getItem('isaac_pos_cached_cashiers') || '[]');
                    if (Array.isArray(cachedCashiers)) {
                        const found = cachedCashiers.find(c => 
                            (c.username && c.username.toLowerCase() === username.toLowerCase()) ||
                            (c.name && c.name.toLowerCase() === username.toLowerCase()) ||
                            (c.email && c.email.toLowerCase() === username.toLowerCase())
                        );
                        if (found) offlineUser = found;
                    }
                } catch (err) {
                    console.warn('[Auth] Error leyendo caché de cajeros:', err?.message);
                }
            }

            if (!offlineUser || offlineUser.status === 'inactive') {
                const nextCount = lockState.count + 1;
                const nextLockUntil = nextCount >= MAX_OFFLINE_LOGIN_ATTEMPTS ? (Date.now() + OFFLINE_LOGIN_LOCK_MS) : 0;
                saveOfflineLoginLockState({ count: nextCount, lockUntil: nextLockUntil });
                return {
                    success: false,
                    message: nextLockUntil
                        ? 'Acceso offline bloqueado temporalmente por 5 minutos tras 5 intentos fallidos.'
                        : 'Usuario no autenticado previamente en este equipo. Inicia sesión con conexión al servidor.'
                };
            }

            const isPasswordValid = await verifyOfflinePassword(offlineUser, password);
            if (!isPasswordValid) {
                const nextCount = lockState.count + 1;
                const nextLockUntil = nextCount >= MAX_OFFLINE_LOGIN_ATTEMPTS ? (Date.now() + OFFLINE_LOGIN_LOCK_MS) : 0;
                saveOfflineLoginLockState({ count: nextCount, lockUntil: nextLockUntil });
                return {
                    success: false,
                    message: nextLockUntil
                        ? 'Acceso offline bloqueado temporalmente por 5 minutos tras 5 intentos fallidos.'
                        : `Contraseña incorrecta o sesión offline no verificada previamente online (${MAX_OFFLINE_LOGIN_ATTEMPTS - nextCount} intento(s) restantes).`
                };
            }

            saveOfflineLoginLockState({ count: 0, lockUntil: 0 });
            console.log('⚡ Acceso verificado MODO OFFLINE:', offlineUser.name);
            const userWithOffline = { ...offlineUser, isOfflineMode: true };
            secureMobileStorage.setSessionActive(true);
            setUser(userWithOffline);
            secureMobileStorage.setUserProfile(userWithOffline);
            localStorage.setItem('isaac_pos_is_offline_mode', 'true');

            return { success: true, isOffline: true };
        };

        // Si ya sabemos que está offline o sin conexión física, entrar verificando hash guardado
        if (preferOffline) {
            return await resolveOfflineLogin();
        }

        try {
            // Intento con timeout ultra-eficiente de 1200ms (en LAN responde en < 40ms)
            const response = await api.post('/auth/login', { username, password }, { timeout: 1200 });

            const { user: userData, token } = response.data;
            if (token) {
                secureMobileStorage.setToken(token);
            }
            sessionExpiredRef.current = false;
            saveOfflineLoginLockState({ count: 0, lockUntil: 0 });
            if (userData) {
                await saveOfflinePasswordVerifier(userData, password);
                secureMobileStorage.setUserProfile(userData);
                if (userData.companyId) {
                    localStorage.setItem('companyId', String(userData.companyId));
                }
                try {
                    const cached = JSON.parse(localStorage.getItem('isaac_pos_cached_cashiers') || '[]');
                    if (Array.isArray(cached)) {
                        const idx = cached.findIndex(c => c.username?.toLowerCase() === userData.username?.toLowerCase());
                        if (idx >= 0) cached[idx] = userData;
                        else cached.push(userData);
                        localStorage.setItem('isaac_pos_cached_cashiers', JSON.stringify(cached));
                    }
                } catch (err) {
                    console.warn('[Auth] Error validando clave local durante check online:', err?.message);
                }
            }
            sessionStorage.setItem('isaac_pos_session_active', 'true');
            localStorage.removeItem('isaac_pos_is_offline_mode');
            setUser(userData);
            return { success: true };
        } catch (error) {
            // Si el servidor devolvió un error HTTP real (401 credenciales incorrectas, etc.)
            if (error.response) {
                const errData = error.response.data;
                const isObject = errData !== null && typeof errData === 'object';
                const message = (isObject && errData.error) ? errData.error : (errData?.message || `Error del servidor (${error.response.status})`);
                return { success: false, message };
            }

            // Fallback offline verificado si el servidor no responde o no hay red
            return await resolveOfflineLogin();
        } finally {
            // No manipular 'loading' aquí — loading es solo del bootstrap inicial.
        }
    };

    const loginWithBiometrics = useCallback(async () => {
        try {
            const data = await biometricService.loginWithBiometrics();
            const { user: userData, token } = data;
            if (token) {
                secureMobileStorage.setToken(token);
            }
            sessionExpiredRef.current = false;
            saveOfflineLoginLockState({ count: 0, lockUntil: 0 });
            if (userData) {
                secureMobileStorage.setUserProfile(userData);
                if (userData.companyId) {
                    localStorage.setItem('companyId', String(userData.companyId));
                }
                try {
                    const cached = JSON.parse(localStorage.getItem('isaac_pos_cached_cashiers') || '[]');
                    if (Array.isArray(cached)) {
                        const idx = cached.findIndex(c => c.username?.toLowerCase() === userData.username?.toLowerCase());
                        if (idx >= 0) cached[idx] = userData;
                        else cached.push(userData);
                        localStorage.setItem('isaac_pos_cached_cashiers', JSON.stringify(cached));
                    }
                } catch (err) {
                    console.warn('[Auth] Error validando clave local durante check online:', err?.message);
                }
            }
            sessionStorage.setItem('isaac_pos_session_active', 'true');
            localStorage.removeItem('isaac_pos_is_offline_mode');
            setUser(userData);
            syncService.autoSyncOnLogin().catch((e) => console.warn('[Auth] Auto-sync biométrico falló:', e?.message || e));
            return { success: true, user: userData };
        } catch (err) {
            console.error('Biometric login error:', err);
            const msg = err.response?.data?.error || err.message || 'Error en inicio de sesión biométrico';
            return { success: false, message: msg };
        }
    }, []);

    const registerBiometrics = useCallback(async (deviceName) => {
        if (!user) throw new Error('No hay usuario autenticado');
        return await biometricService.registerBiometrics(user, deviceName);
    }, [user]);

    const revokeBiometrics = useCallback(async () => {
        return await biometricService.revokeBiometrics();
    }, []);

    const refreshUser = useCallback(async () => {
        try {
            const res = await api.get('/auth/me');
            if (res.data?.user) {
                setUser(res.data.user);
                secureMobileStorage.setUserProfile(res.data.user);
                return res.data.user;
            }
        } catch (e) {
            const isNetworkOffline = !e?.response || e?.code === 'ECONNABORTED';
            if (isNetworkOffline) {
                console.warn('[Auth] Perfil no actualizado (red/offline):', e?.message || e);
            } else {
                console.error('Error refreshing user profile:', e);
            }
        }
        return null;
    }, []);

    const updateCurrentUser = useCallback((newUserData) => {
        setUser(prev => {
            const updated = typeof newUserData === 'function' ? newUserData(prev) : { ...prev, ...newUserData };
            try {
                secureMobileStorage.setUserProfile(updated);
            } catch (e) {
                console.error('Error saving updated profile to storage', e);
            }
            return updated;
        });
    }, []);

    const hasPermission = useCallback((permissionKey) => {
        if (!user) return false;
        const role = (user.role || '').toLowerCase();
        const isMasterOrSuper = role === 'superadmin' || role === 'owner' || role === 'dueño' || role === 'master';

        // Protección contra auto-bloqueo crítico: el superadministrador siempre mantiene acceso a la gestión de usuarios
        if (isMasterOrSuper && permissionKey === 'canManageUsers') {
            return true;
        }

        const permissions = user.permissions || {};
        // 1. Si el permiso está configurado explícitamente en la ficha del usuario (true o false), se respeta SIEMPRE (incluso para superadmin)
        if (permissions[permissionKey] !== undefined) {
            return Boolean(permissions[permissionKey]);
        }

        // 2. Si no está configurado explícitamente en la ficha, superadmin y dueño tienen acceso total por defecto
        if (isMasterOrSuper) {
            return true;
        }

        // 3. Presets por rol para usuarios sin configuración explícita guardada
        const normalizedRole = role === 'cajero' ? 'cashier' : (role === 'mesero' ? 'waiter' : role);
        const ROLE_DEFAULTS = {
            admin: {
                canAccessPOS: true, canVoidSales: true, canApplyDiscounts: true, canModifyPrices: true,
                canOpenDrawer: true, canManageCashShift: true, canViewSalesHistory: true,
                canManageCustomers: true, canManageReceivables: true, canAccessCollections: true,
                canManageInventory: true, canCreateProducts: true, canAdjustStock: true,
                canViewCosts: true, canManageWarehouses: true,
                canManagePromotions: true,
                canManageSuppliers: true, canManagePurchases: true, canManagePayables: true,
                canImportCatalog: true, canManageExpenses: true,
                canManageFiscal: true, canAccessBI: true, canViewReports: true,
                canManageAccounting: true, canManagePayroll: true, canManageAssets: true,
                canAccessAudit: true, canMonitorCashiers: true, canManageBranches: true,
                canManageUsers: true, canManageSettings: true
            },
            supervisor: {
                canAccessPOS: true, canVoidSales: true, canApplyDiscounts: true, canModifyPrices: true,
                canOpenDrawer: true, canManageCashShift: true, canViewSalesHistory: true,
                canManageCustomers: true, canManageReceivables: true, canAccessCollections: true,
                canManageInventory: true, canCreateProducts: true, canAdjustStock: true,
                canViewCosts: true, canManageWarehouses: true, canManageSuppliers: true,
                canManagePurchases: true, canManageExpenses: true, canViewReports: true,
                canAccessAudit: true, canMonitorCashiers: true
            },
            cashier: {
                canAccessPOS: true, canManageCashShift: true, canViewSalesHistory: true,
                canManageCustomers: true
            },
            inventory: {
                canManageInventory: true, canCreateProducts: true, canAdjustStock: true,
                canViewCosts: true, canManageWarehouses: true,
                canManageSuppliers: true, canManagePurchases: true, canImportCatalog: true
            },
            waiter: {
                canAccessPOS: true, canManageCustomers: true
            }
        };

        if (ROLE_DEFAULTS[normalizedRole]) {
            return Boolean(ROLE_DEFAULTS[normalizedRole][permissionKey]);
        }

        return false;
    }, [user]);

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            isLocked,
            isActivated,
            machineId,
            licenseInfo,
            licenseLoading,
            hasPermission,
            updateCurrentUser,
            refreshUser,
            setIsActivated,
            checkLicense,
            login,
            loginWithBiometrics,
            registerBiometrics,
            revokeBiometrics,
            logout,
            appLock,
            appUnlock
        }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
