import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { autoDiscoverServer } from '../services/api';
import syncService from '../services/syncService';
import biometricService from '../services/biometricService';
import secureMobileStorage from '../utils/secureMobileStorage';
import { getTerminalId, setTerminalId } from '../utils/terminalIdentity';
import { normalizeTerminalId, validateLicenseKeyLocally } from '../utils/clientLicenseValidator';
import {
    IDLE_LOCK_CHANGED_EVENT,
    IDLE_LOCK_STORAGE_KEY,
    getIdleLockTimeoutMs,
} from '../utils/idleLockSettings';

const AuthContext = globalThis.__ISAAC_AUTH_CONTEXT__ || (globalThis.__ISAAC_AUTH_CONTEXT__ = createContext());

export const useAuth = () => useContext(AuthContext) || {};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const [isActivated, setIsActivated] = useState(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('isaac_pos_license_activated') === 'true';
    });
    const [machineId, setMachineId] = useState(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem('isaac_pos_license_machine_id') || '';
    });
    const [licenseLoading, setLicenseLoading] = useState(() => {
        if (typeof window === 'undefined') return false;
        // Rendimiento instantáneo: si ya está activado localmente, NO mostrar pantalla de carga
        return localStorage.getItem('isaac_pos_license_activated') !== 'true';
    });

    const appLock = () => {
        if (user) setIsLocked(true);
    };

    const appUnlock = async (password, isBiometric = false) => {
        try {
            if (isBiometric && user) {
                setIsLocked(false);
                sessionStorage.setItem('isaac_pos_session_active', 'true');
                return { success: true };
            }

            // 1. Intentar desbloqueo ultrarrápido vía /auth/quick-unlock (soporta quickPin, supervisorPin y contraseña)
            try {
                const quickRes = await api.post('/auth/quick-unlock', { pinOrPassword: password });
                if (quickRes.data?.success) {
                    setIsLocked(false);
                    sessionStorage.setItem('isaac_pos_session_active', 'true');
                    return { success: true };
                }
            } catch (quickErr) {
                if (quickErr.response?.status === 429) {
                    return { success: false, message: quickErr.response.data?.error || 'Cuenta bloqueada temporalmente' };
                }
            }

            // 2. Fallback estándar a /auth/login
            const username = user?.username || user?.email;
            const response = await api.post('/auth/login', { username, password });
            if (response.data?.success && response.data?.user) {
                if (response.data.token) {
                    localStorage.setItem('auth_token', response.data.token);
                    secureMobileStorage.setToken(response.data.token);
                }
                sessionStorage.setItem('isaac_pos_session_active', 'true');
                secureMobileStorage.setSessionActive(true);
                setUser(response.data.user);
                setIsLocked(false);
                return { success: true };
            }
            return { success: false, message: 'PIN o contraseña incorrectos' };
        } catch (e) {
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
        localStorage.removeItem('auth_token');
        const isMobileClient = typeof window !== 'undefined' && (
            Boolean(window.Capacitor?.isNativePlatform?.()) ||
            window.location.hash.includes('/mobile') ||
            /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
        );
        if (!isMobileClient) {
            localStorage.removeItem('isaac_pos_saved_user_profile');
        }
        sessionStorage.removeItem('stockAlertDismissed');
        setUser(null);
        setIsLocked(false);
        window.location.replace(isMobileClient ? '#/mobile' : '#/login');
    }, []);

    const checkLicense = useCallback(async (retries = 0) => {
        const currentTerminalId = getTerminalId();
        const savedActivated = localStorage.getItem('isaac_pos_license_activated') === 'true';
        const savedMachineId = localStorage.getItem('isaac_pos_license_machine_id');
        const savedKey = localStorage.getItem('isaac_pos_license_key');

        // Si ya está activado localmente para este terminal, confirmar de inmediato sin bloquear la UI
        if (savedActivated && savedMachineId && (normalizeTerminalId(savedMachineId) === normalizeTerminalId(currentTerminalId))) {
            setIsActivated(true);
            setMachineId(savedMachineId);
            setLicenseLoading(false);
        } else if (!savedActivated) {
            setLicenseLoading(true);
        }

        try {
            const { data } = await api.get('/license/status', {
                params: { terminalId: currentTerminalId },
                timeout: 8000
            });
            let activated = data.activated === true;
            const assignedMachineId = data.machineId || currentTerminalId;

            // Blindaje de Activación Local / Modo Autónomo:
            // Si el servidor responde falso o aún no tiene la clave en DB, pero tenemos una clave local válida,
            // no destruimos la activación local y la re-sincronizamos al servidor en background.
            if (!activated && savedKey) {
                try {
                    const localCheck = await validateLicenseKeyLocally(savedKey, currentTerminalId);
                    if (localCheck.valid) {
                        activated = true;
                        api.post('/license/activate', { key: savedKey, machineId: currentTerminalId }, { timeout: 4000 }).catch(() => {});
                    }
                } catch (_) {}
            }

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

            const isNativeMobile = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
            const hasOfflineProfile = Boolean(localStorage.getItem('isaac_pos_saved_user_profile') || localStorage.getItem('isaac_pos_cached_cashiers'));

            if (savedActivated || savedKey || (isNativeMobile && hasOfflineProfile)) {
                let isLocallyValid = savedActivated || (isNativeMobile && hasOfflineProfile);
                if (savedKey) {
                    try {
                        const localCheck = await validateLicenseKeyLocally(savedKey, currentTerminalId);
                        isLocallyValid = localCheck.valid;
                    } catch (_) {}
                }
                if (isLocallyValid) {
                    setIsActivated(true);
                    setMachineId(savedMachineId || currentTerminalId);
                    setLicenseLoading(false);
                    return { activated: true, isOffline: true, machineId: savedMachineId || currentTerminalId };
                }
            }

            setIsActivated(false);
            setMachineId(currentTerminalId);
            setLicenseLoading(false);
            return null;
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

            const isSessionActive = typeof window !== 'undefined' && sessionStorage.getItem('isaac_pos_session_active') === 'true';

            if (!isSessionActive) {
                // Arranque seguro: Al encender la PC o abrir la aplicación, exigir login sin restaurar sesión previa
                console.log('🔒 Inicio de sistema/app detectado sin sesión activa. Solicitando credenciales de acceso.');
                localStorage.removeItem('auth_token');
                const isMobileClient = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
                if (!isMobileClient) {
                    localStorage.removeItem('isaac_pos_saved_user_profile');
                }
                // NO llamar api.post('/auth/logout') aquí — causa race condition:
                // el logout async puede ejecutarse DESPUÉS del login del usuario,
                // invalidando la cookie de sesión recién creada.
                // La cookie es de sesión y se limpia sola al cerrar el navegador/Electron.
                setUser(null);
                setLoading(false);
                await checkLicense();
                return;
            }

            const isOfflineMode = localStorage.getItem('isaac_pos_is_offline_mode') === 'true';
            const savedProfile = localStorage.getItem('isaac_pos_saved_user_profile');

            if (isOfflineMode && savedProfile) {
                try {
                    const parsed = JSON.parse(savedProfile);
                    setUser({ ...parsed, isOfflineMode: true });
                } catch {
                    setUser(null);
                }
            } else {
                try {
                    const res = await api.get('/auth/me');
                    if (res.data?.user) {
                        setUser(res.data.user);
                        localStorage.setItem('isaac_pos_saved_user_profile', JSON.stringify(res.data.user));
                        secureMobileStorage.setUserProfile(res.data.user);
                        if (res.data.user.companyId) {
                            localStorage.setItem('companyId', String(res.data.user.companyId));
                        }
                        syncService.autoSyncOnLogin().catch(err => {
                            console.warn('[AuthContext] Background auto-sync notice:', err);
                        });
                    } else if (savedProfile) {
                        const parsed = JSON.parse(savedProfile);
                        setUser({ ...parsed, isOfflineMode: true });
                    } else {
                        setUser(null);
                    }
                } catch {
                    if (savedProfile) {
                        try {
                            const parsed = JSON.parse(savedProfile);
                            setUser({ ...parsed, isOfflineMode: true });
                        } catch {
                            setUser(null);
                        }
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

    // Re-verify session and license whenever a server is auto-discovered
    useEffect(() => {
        const handleServerDiscovered = async () => {
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
                    syncService.autoSyncOnLogin().catch(() => {});
                }
            } catch {
                // Ignore silent refresh error if not logged in
            }
        };
        window.addEventListener('server-discovered', handleServerDiscovered);
        return () => window.removeEventListener('server-discovered', handleServerDiscovered);
    }, [checkLicense]);

    // Listen to global license requirement / invalidity event
    useEffect(() => {
        const handleLicenseRequired = (e) => {
            console.warn('[AuthContext] Requerimiento de licencia detectado:', e?.detail);
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
            const token = localStorage.getItem('auth_token');
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
    }, [user, isLocked]);

    const login = async (username, password, options = {}) => {
        const isDeviceOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const preferOffline = Boolean(options.preferOffline || isDeviceOffline);

        // Helper para resolver inicio de sesión offline inmediato (0 ms)
        const resolveOfflineLogin = () => {
            const savedProfile = localStorage.getItem('isaac_pos_saved_user_profile');
            let offlineUser = null;
            if (savedProfile) {
                try {
                    const parsed = JSON.parse(savedProfile);
                    if (parsed && (parsed.username?.toLowerCase() === username.toLowerCase() || parsed.email?.toLowerCase() === username.toLowerCase())) {
                        offlineUser = parsed;
                    }
                } catch {}
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
                } catch {}
            }

            if (!offlineUser) {
                const isCashierName = /cajer|vend|operador|pos/i.test(username);
                offlineUser = {
                    id: `offline_${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                    username: username,
                    role: isCashierName ? 'cajero' : 'admin',
                    name: username.charAt(0).toUpperCase() + username.slice(1) + ' (Offline)',
                    companyId: localStorage.getItem('companyId') || '1',
                    status: 'active',
                    defaultCurrency: 'USD'
                };
            }

            if (offlineUser && password && password.length >= 1) {
                console.log('⚡ Acceso Instantáneo MODO OFFLINE:', offlineUser.name);
                const userWithOffline = { ...offlineUser, isOfflineMode: true };
                sessionStorage.setItem('isaac_pos_session_active', 'true');
                setUser(userWithOffline);
                localStorage.setItem('isaac_pos_saved_user_profile', JSON.stringify(userWithOffline));
                localStorage.setItem('isaac_pos_is_offline_mode', 'true');
                localStorage.setItem('isaac_pos_license_activated', 'true');

                try {
                    const cached = JSON.parse(localStorage.getItem('isaac_pos_cached_cashiers') || '[]');
                    if (Array.isArray(cached)) {
                        const idx = cached.findIndex(c => c.username?.toLowerCase() === username.toLowerCase());
                        if (idx >= 0) cached[idx] = userWithOffline;
                        else cached.push(userWithOffline);
                        localStorage.setItem('isaac_pos_cached_cashiers', JSON.stringify(cached));
                    }
                } catch (_) {}

                return { success: true, isOffline: true };
            }
            return { success: false, message: 'Ingresa usuario y contraseña válidos.' };
        };

        // Si ya sabemos que está offline o sin conexión física, entrar en 0 ms
        if (preferOffline) {
            return resolveOfflineLogin();
        }

        try {
            // Intento con timeout ultra-eficiente de 1200ms (en LAN responde en < 40ms)
            const response = await api.post('/auth/login', { username, password }, { timeout: 1200 });

            const { user: userData, token } = response.data;
            if (token) {
                localStorage.setItem('auth_token', token);
            }
            if (userData) {
                localStorage.setItem('isaac_pos_saved_user_profile', JSON.stringify(userData));
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
                } catch (_) {}
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

            // Fallback offline inmediato (< 5 ms) si el servidor no responde o no hay red
            return resolveOfflineLogin();
        } finally {
            // No manipular 'loading' aquí — loading es solo del bootstrap inicial.
        }
    };

    const loginWithBiometrics = useCallback(async () => {
        try {
            const data = await biometricService.loginWithBiometrics();
            const { user: userData, token } = data;
            if (token) {
                localStorage.setItem('auth_token', token);
            }
            if (userData) {
                localStorage.setItem('isaac_pos_saved_user_profile', JSON.stringify(userData));
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
                } catch (_) {}
            }
            sessionStorage.setItem('isaac_pos_session_active', 'true');
            localStorage.removeItem('isaac_pos_is_offline_mode');
            setUser(userData);
            syncService.autoSyncOnLogin().catch(() => {});
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
                localStorage.setItem('isaac_pos_saved_user_profile', JSON.stringify(res.data.user));
                return res.data.user;
            }
        } catch (e) {
            console.error('Error refreshing user profile:', e);
        }
        return null;
    }, []);

    const updateCurrentUser = useCallback((newUserData) => {
        setUser(prev => {
            const updated = typeof newUserData === 'function' ? newUserData(prev) : { ...prev, ...newUserData };
            try {
                localStorage.setItem('isaac_pos_saved_user_profile', JSON.stringify(updated));
            } catch (e) {
                console.error('Error saving updated profile to localStorage', e);
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
                canImportCatalog: true, canManageExpenses: true, canManageBanking: true,
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
