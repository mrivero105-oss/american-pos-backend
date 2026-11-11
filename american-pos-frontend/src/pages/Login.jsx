import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    Lock,
    User,
    AlertCircle,
    Eye,
    EyeOff,
    Wifi,
    WifiOff,
    Check,
    Fingerprint
} from 'lucide-react';
import Logo from '../components/Logo';
import ServerConfigModal from '../components/ServerConfigModal';
import { updateApiBaseUrl, checkServerHealth, autoDiscoverServer } from '../services/api';
import syncService from '../services/syncService';
import biometricService from '../services/biometricService';

const REMEMBERED_USER_KEY = 'isaac_pos_remembered_user';

export default function Login() {
    // Form state - Recordatorio opcional exclusivo de usuario (jamás almacena contraseñas)
    const [rememberUser, setRememberUser] = useState(() => {
        try {
            const saved = localStorage.getItem(REMEMBERED_USER_KEY);
            return Boolean(saved && saved.trim());
        } catch {
            return false;
        }
    });
    const [username, setUsername] = useState(() => {
        try {
            return (localStorage.getItem(REMEMBERED_USER_KEY) || '').trim();
        } catch {
            return '';
        }
    });
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [syncMessage] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const usernameInputRef = useRef(null);
    const passwordInputRef = useRef(null);
    const techTapRef = useRef({ count: 0, timer: null });

    // Server IP Config Modal & Health
    const [showConfig, setShowConfig] = useState(false);
    const isDesktopPC = typeof window !== 'undefined' && (/Windows NT|Macintosh|Linux x86_64/i.test(navigator.userAgent) || window.electronAPI);

    const [nodeRole, setNodeRole] = useState(() => {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('isaac_pos_node_role') : null;
        if (stored === 'client' || stored === 'server') return stored;
        return isDesktopPC ? 'server' : 'client';
    });

    const [serverIp, setServerIp] = useState(() => {
        const saved = localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip');
        if (saved) return saved;
        return isDesktopPC ? '127.0.0.1:3005' : '';
    });

    const [isConnected, setIsConnected] = useState(null); // null = checking/connecting, true = ok, false = offline
    const [currentTime, setCurrentTime] = useState(() => new Date());

    const businessName = useMemo(() => {
        try {
            const raw = localStorage.getItem('pos_business_settings');
            if (!raw) return '';
            const parsed = JSON.parse(raw);
            const name = String(parsed?.name || parsed?.businessName || '').trim();
            return name;
        } catch {
            return '';
        }
    }, []);

    const { login, loginWithBiometrics, machineId } = useAuth();
    const navigate = useNavigate();

    // Biometric authentication state
    const [enrolledBioUser, setEnrolledBioUser] = useState(() => biometricService.getEnrolledCredential());
    const [hasBioHardware, setHasBioHardware] = useState(false);
    const [isBioScanning, setIsBioScanning] = useState(false);

    useEffect(() => {
        let isMounted = true;
        biometricService.checkSupport().then((supported) => {
            if (isMounted) setHasBioHardware(supported);
        }).catch(() => {});
        setEnrolledBioUser(biometricService.getEnrolledCredential());
        return () => { isMounted = false; };
    }, []);

    const handleBiometricLogin = async () => {
        setError('');
        setIsBioScanning(true);
        try {
            const res = await loginWithBiometrics();
            if (res && (res === true || res.success)) {
                try {
                    localStorage.setItem('isaac_pos_initial_sync_done', 'true');
                } catch (_) {}
                const isMobileClient = (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') || (typeof window !== 'undefined' && window.innerWidth < 768));
                if (isMobileClient) {
                    navigate('/mobile');
                } else {
                    navigate('/pos');
                }
            } else {
                setError(res?.message || 'No se pudo verificar la huella dactilar.');
            }
        } catch (err) {
            console.error('Biometric login failure:', err);
            setError(err.message || 'Error en autenticación biométrica');
        } finally {
            setIsBioScanning(false);
        }
    };

    // Live clock ticker
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Protected Technical Access Shortcuts (F10 or Ctrl+Shift+S / Ctrl+Alt+S)
    useEffect(() => {
        const handleTechShortcut = (e) => {
            const isF10 = e.key === 'F10';
            const isCtrlCombo = (e.ctrlKey || e.metaKey) && (e.shiftKey || e.altKey) && e.key?.toLowerCase() === 's';
            if (isF10 || isCtrlCombo) {
                e.preventDefault();
                setShowConfig((prev) => !prev);
            }
        };
        window.addEventListener('keydown', handleTechShortcut);
        return () => {
            window.removeEventListener('keydown', handleTechShortcut);
            clearTimeout(techTapRef.current.timer);
        };
    }, []);

    const handleFooterTechTap = () => {
        clearTimeout(techTapRef.current.timer);
        techTapRef.current.count += 1;
        if (techTapRef.current.count >= 5) {
            techTapRef.current.count = 0;
            setShowConfig(true);
            return;
        }
        techTapRef.current.timer = setTimeout(() => {
            techTapRef.current.count = 0;
        }, 2200);
    };

    // Resilient Auto-Reconnect Engine, Native Electron Role Sync & Heartbeat Loop
    useEffect(() => {
        let isMounted = true;
        let pollTimer = null;
        let consecutiveFailures = 0;
        let nativeConfigSynced = false;

        const syncNativeDesktopRole = async () => {
            if (nativeConfigSynced) return;
            nativeConfigSynced = true;
            if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getDbConfig) {
                try {
                    const cfg = await window.electronAPI.getDbConfig();
                    if (!isMounted || !cfg) return;
                    if (cfg.mode === 'client' || cfg.mode === 'server') {
                        localStorage.setItem('isaac_pos_node_role', cfg.mode);
                        setNodeRole(cfg.mode);
                    }
                    if (cfg.mode === 'client') {
                        const currentSaved = localStorage.getItem('isaac_pos_server_ip') || '';
                        if (cfg.host && cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
                            if (!currentSaved || currentSaved.includes('127.0.0.1') || currentSaved.includes('localhost')) {
                                updateApiBaseUrl(cfg.host);
                                setServerIp(cfg.host);
                            }
                        } else if (!currentSaved || currentSaved.includes('127.0.0.1') || currentSaved.includes('localhost')) {
                            setServerIp('');
                        }
                    }
                } catch (_err) {}
            }
        };

        const checkConn = async () => {
            await syncNativeDesktopRole();
            if (!isMounted) return;

            const isCleared = localStorage.getItem('isaac_pos_server_ip_explicitly_cleared') === 'true';
            let role = localStorage.getItem('isaac_pos_node_role');
            if (!role && isDesktopPC) {
                role = 'server';
                localStorage.setItem('isaac_pos_node_role', 'server');
            }
            if (role === 'client' || role === 'server') {
                setNodeRole(role);
            }
            const savedIp = localStorage.getItem('isaac_pos_server_ip');

            if (isCleared || (role === 'client' && !savedIp && !isDesktopPC)) {
                if (isMounted) setIsConnected(false);
                return;
            }

            const isClientWithoutRemoteIp = role === 'client' && (!savedIp || savedIp.includes('127.0.0.1') || savedIp.includes('localhost'));
            const healthy = isClientWithoutRemoteIp
                ? false
                : await checkServerHealth(null, { requireMasterHost: role === 'client' });
            if (!isMounted) return;

            if (healthy) {
                consecutiveFailures = 0;
                setIsConnected(true);
                clearTimeout(pollTimer);
                pollTimer = setTimeout(checkConn, 20000);
            } else {
                consecutiveFailures++;

                if ((isClientWithoutRemoteIp || consecutiveFailures >= 2) && (!savedIp || role === 'client')) {
                    try {
                        const found = await autoDiscoverServer();
                        if (isMounted && found) {
                            setIsConnected(true);
                            setServerIp(localStorage.getItem('isaac_pos_server_ip') || found);
                            consecutiveFailures = 0;
                            clearTimeout(pollTimer);
                            pollTimer = setTimeout(checkConn, 20000);
                            return;
                        }
                    } catch (_discErr) {}
                }

                if (isClientWithoutRemoteIp || consecutiveFailures >= 3) {
                    setIsConnected(false);
                }

                clearTimeout(pollTimer);
                pollTimer = setTimeout(checkConn, 2500);
            }
        };

        checkConn();

        const handleOnline = () => {
            if (isMounted) {
                consecutiveFailures = 0;
                checkConn();
            }
        };
        const handleFocus = () => {
            if (isMounted && isConnected !== true) {
                checkConn();
            }
        };
        const handleServerDiscovered = (e) => {
            if (isMounted) {
                consecutiveFailures = 0;
                setIsConnected(true);
                setServerIp(e.detail?.url || '');
            }
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('focus', handleFocus);
        window.addEventListener('server-discovered', handleServerDiscovered);

        return () => {
            isMounted = false;
            clearTimeout(pollTimer);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('server-discovered', handleServerDiscovered);
        };
    }, [isDesktopPC]);

    // Purgar residuos de listas antiguas y enfocar inteligentemente usuario o contraseña
    useEffect(() => {
        try {
            localStorage.removeItem('isaac_pos_saved_user');
            localStorage.removeItem('isaac_pos_saved_users');
            localStorage.removeItem('american_pos_saved_user');
            localStorage.removeItem('american_pos_saved_users');
        } catch (_e) {}

        if (username) {
            passwordInputRef.current?.focus();
        } else {
            usernameInputRef.current?.focus();
        }
    }, []);

    const handleToggleRemember = (checked) => {
        setRememberUser(checked);
        try {
            if (!checked) {
                localStorage.removeItem(REMEMBERED_USER_KEY);
            } else if (username.trim()) {
                localStorage.setItem(REMEMBERED_USER_KEY, username.trim());
            }
        } catch (_e) {}
    };

    // Handle standard credentials login (solo persiste el usuario si el operador marcó la opción)
    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            if (!username || !password) {
                setError('Por favor completa tu usuario y contraseña.');
                setIsSubmitting(false);
                return;
            }

            const cleanUsername = username.trim();
            const shouldPreferOffline = isConnected === false || (typeof navigator !== 'undefined' && !navigator.onLine);
            const res = await login(cleanUsername, password, { preferOffline: shouldPreferOffline });

            if (res && (res === true || res.success)) {
                try {
                    localStorage.removeItem('isaac_pos_saved_user');
                    localStorage.removeItem('isaac_pos_saved_users');
                    localStorage.removeItem('american_pos_saved_user');
                    localStorage.removeItem('american_pos_saved_users');
                    if (!res.isOffline) {
                        localStorage.removeItem('isaac_pos_is_offline_mode');
                    }
                    localStorage.setItem('isaac_pos_initial_sync_done', 'true');
                    if (rememberUser && cleanUsername) {
                        localStorage.setItem(REMEMBERED_USER_KEY, cleanUsername);
                    } else {
                        localStorage.removeItem(REMEMBERED_USER_KEY);
                    }
                } catch (_e) {}

                if (!res.isOffline) {
                    syncService.autoSyncOnLogin().catch((_syncErr) => {
                        console.warn('Auto-sync notice on login:', _syncErr);
                    });
                }

                const isMobileClient = (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') || (typeof window !== 'undefined' && window.innerWidth < 768));
                if (isMobileClient) {
                    navigate('/mobile');
                } else {
                    navigate('/pos');
                }
            } else {
                setError(res?.message || 'Credenciales inválidas. Verifica tu usuario y contraseña.');
            }
        } catch (err) {
            console.error('Login error:', err);
            const msg = err.response?.data?.error || err.response?.data?.message || 'No fue posible iniciar sesión.';
            setError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Formatted operational clock & editorial date
    const rawHours = currentTime.getHours();
    const displayHours = String(rawHours % 12 || 12).padStart(2, '0');
    const displayMinutes = String(currentTime.getMinutes()).padStart(2, '0');
    const displaySeconds = String(currentTime.getSeconds()).padStart(2, '0');
    const dayPeriod = rawHours >= 12 ? 'PM' : 'AM';

    const formattedDate = useMemo(() => {
        try {
            const raw = new Intl.DateTimeFormat('es-ES', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            }).format(currentTime);
            return raw.charAt(0).toUpperCase() + raw.slice(1);
        } catch {
            return currentTime.toLocaleDateString();
        }
    }, [currentTime.getDate(), currentTime.getMonth(), currentTime.getFullYear()]);

    const shortStationId = machineId ? machineId.substring(0, 14) : 'ESTACIÓN LOCAL';
    const roleLabel = nodeRole === 'client' ? 'Terminal en Red' : 'Servidor Principal';

    return (
        <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-12 bg-[#F8FAFC] font-sans antialiased selection:bg-[#0284C7] selection:text-white overflow-x-hidden">

            {/* =====================================================================
                LEFT ARCHITECTURAL CHAMBER (DESKTOP >= LG)
                Swiss Industrial Design: Anodized Carbon, Precision Rules, Live Time
               ===================================================================== */}
            <aside
                className="hidden lg:flex lg:col-span-7 bg-[#0A0D12] text-white flex-col justify-between relative overflow-hidden border-r border-slate-900"
                style={{
                    backgroundImage: 'radial-gradient(95% 65% at 0% 0%, rgba(14, 165, 233, 0.065) 0%, transparent 60%)'
                }}
            >
                {/* Top Structural Bar */}
                <header className="px-10 xl:px-14 py-6 xl:py-7 border-b border-white/[0.07] flex items-center justify-between">
                    <div className="flex items-center">
                        <Logo variant="dark" size="hero" imgClassName="h-16 sm:h-20 lg:h-24 w-auto max-w-[360px] sm:max-w-[440px] lg:max-w-[500px]" />
                    </div>

                    <div className="text-right">
                        <span className="font-mono text-[11px] font-medium tracking-[0.16em] text-slate-400 uppercase">
                            SERIE 24.04
                        </span>
                    </div>
                </header>

                {/* Central Operational Stage */}
                <div className="px-10 xl:px-14 py-12 flex-1 flex flex-col justify-center">
                    <div className="max-w-xl">
                        <div className="inline-flex items-center gap-2.5 mb-5">
                            <span className="w-2 h-2 rounded-xs bg-[#0284C7]"></span>
                            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                {businessName ? `SEDE OPERATIVA • ${businessName}` : 'ESTACIÓN DE OPERACIONES & CAJA'}
                            </span>
                        </div>

                        {/* Precision Tabular Horology */}
                        <div className="flex items-baseline select-none">
                            <span className="text-[76px] xl:text-[92px] font-light tracking-[-0.05em] leading-none text-white tabular-nums">
                                {displayHours}:{displayMinutes}
                            </span>
                            <span className="text-[28px] xl:text-[34px] font-light tracking-[-0.03em] text-slate-500 tabular-nums ml-1.5">
                                :{displaySeconds}
                            </span>
                            <span className="text-xs font-bold tracking-[0.2em] text-[#38BDF8] uppercase ml-3.5">
                                {dayPeriod}
                            </span>
                        </div>

                        {/* Editorial Date & Hairline Accent */}
                        <div className="w-11 h-[2px] bg-[#0284C7] my-6"></div>

                        <p className="text-xl xl:text-[22px] font-normal text-slate-200 tracking-[-0.015em]">
                            {formattedDate}
                        </p>
                        <p className="text-[13.5px] text-slate-500 mt-2.5 max-w-md leading-relaxed">
                            Facturación, inventario multicaja y conciliación de turno sincronizados en tiempo real.
                        </p>
                    </div>
                </div>

                {/* Bottom Orthogonal Telemetry Plinth (3 Architectural Cells) */}
                <footer className="grid grid-cols-3 border-t border-white/[0.07] divide-x divide-white/[0.07] bg-[#07090D]">
                    {/* Cell 1: Link Status (Protected 5-tap tech trigger when online, direct button when offline) */}
                    <div
                        onClick={isConnected === false ? () => setShowConfig(true) : handleFooterTechTap}
                        className={`px-6 xl:px-10 py-5 flex flex-col justify-center ${isConnected === false ? 'cursor-pointer hover:bg-rose-950/30 transition-colors' : 'cursor-default'}`}
                    >
                        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                            Estado de Enlace
                        </span>
                        <div className="mt-1.5 flex items-center gap-2">
                            {isConnected === true ? (
                                <>
                                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                                    <span className="text-[13px] font-semibold text-emerald-400">
                                        En Línea
                                    </span>
                                </>
                            ) : isConnected === false ? (
                                <>
                                    <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
                                    <span className="text-[13px] font-semibold text-rose-400 underline underline-offset-4">
                                        Sin Conexión • Revisar
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                                    <span className="text-[13px] font-semibold text-amber-400">
                                        Verificando...
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Cell 2: Node Architecture */}
                    <div className="px-6 xl:px-8 py-5 flex flex-col justify-center">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                            Modo de Estación
                        </span>
                        <span className="mt-1.5 text-[13px] font-medium text-slate-200 truncate">
                            {roleLabel}
                        </span>
                    </div>

                    {/* Cell 3: Hardware Terminal ID */}
                    <div className="px-6 xl:px-8 py-5 flex flex-col justify-center">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                            ID de Equipo
                        </span>
                        <code className="mt-1.5 font-mono text-[12px] text-slate-300 truncate">
                            {shortStationId}
                        </code>
                    </div>
                </footer>
            </aside>

            {/* =====================================================================
                RIGHT AUTHENTICATION CHAMBER (CRISP PORCELAIN SURFACE)
                High-Contrast Ergonomic Touch & Keyboard Form
               ===================================================================== */}
            <section className="lg:col-span-5 min-h-screen flex flex-col justify-between bg-[#F8FAFC] text-slate-900 relative">

                {/* Compact Top Bar for Mobile / Tablet (< LG) */}
                <div className="lg:hidden bg-[#0A0D12] text-white px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <Logo variant="dark" size="md" imgClassName="h-9 sm:h-10 w-auto max-w-[210px]" />
                        <span className="text-[10px] text-slate-400 font-medium pl-2.5 border-l border-slate-800">
                            v24.04
                        </span>
                    </div>

                    <div
                        onClick={isConnected === false ? () => setShowConfig(true) : handleFooterTechTap}
                        className="text-right"
                    >
                        <div className="font-mono text-xs font-semibold text-white tabular-nums">
                            {displayHours}:{displayMinutes} {dayPeriod}
                        </div>
                        <div className="flex items-center justify-end gap-1.5 mt-0.5">
                            {isConnected === true ? (
                                <>
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                    <span className="text-[10px] font-semibold text-emerald-400">En Línea</span>
                                </>
                            ) : isConnected === false ? (
                                <>
                                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                                    <span className="text-[10px] font-semibold text-rose-400 underline">Configurar Red</span>
                                </>
                            ) : (
                                <>
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                                    <span className="text-[10px] font-semibold text-amber-400">Conectando...</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Reactive Top Alert Strip (Only shown if offline or connecting) */}
                <div className="px-6 sm:px-10 pt-6">
                    {isConnected === false && (
                        <div className="max-w-[380px] mx-auto rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-2xs">
                            <div className="flex items-center gap-2 min-w-0">
                                <WifiOff size={15} className="text-rose-600 shrink-0" />
                                <span className="text-xs font-semibold text-rose-900 truncate">
                                    Sin conexión con el servidor
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowConfig(true)}
                                className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                            >
                                Configurar red
                            </button>
                        </div>
                    )}
                    {isConnected === null && (
                        <div className="max-w-[380px] mx-auto rounded-lg bg-amber-50/80 border border-amber-200/80 px-3.5 py-2 flex items-center gap-2 text-amber-900">
                            <Wifi size={14} className="text-amber-600 animate-pulse shrink-0" />
                            <span className="text-xs font-medium">Verificando enlace con el servidor...</span>
                        </div>
                    )}
                </div>

                {/* Main Form Container */}
                <main className="w-full max-w-[380px] mx-auto px-6 sm:px-0 my-auto py-8">
                    {/* Editorial Left-Aligned Header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-2">
                            <span className="w-0.5 h-3.5 bg-[#0284C7]"></span>
                            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
                                Acceso de Operador
                            </span>
                        </div>
                        <h1 className="text-[28px] sm:text-[30px] font-bold tracking-[-0.03em] text-slate-900 mt-2.5 leading-tight">
                            Iniciar sesión
                        </h1>
                        <p className="text-[13.5px] text-slate-500 mt-1.5 leading-relaxed">
                            Ingresa tus credenciales asignadas para operar en caja o administración.
                        </p>
                    </div>

                    {/* Error Alert */}
                    {error && (
                        <div className="mb-6 bg-rose-50 border-l-4 border-rose-600 text-rose-950 px-3.5 py-3 rounded-r-md flex items-start gap-2.5 text-xs font-medium shadow-2xs">
                            <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-600" />
                            <span className="leading-relaxed whitespace-pre-wrap">{error}</span>
                        </div>
                    )}

                    {/* Biometric Quick Fingerprint Access (Zero-Trust Hardware TEE) */}
                    {enrolledBioUser && (
                        <div className="mb-6">
                            <button
                                type="button"
                                onClick={handleBiometricLogin}
                                disabled={isBioScanning || isSubmitting}
                                className="w-full min-h-[56px] px-4 py-3 rounded-xl bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 hover:from-black hover:via-sky-900 hover:to-black text-white border border-sky-500/30 font-semibold text-sm shadow-md hover:shadow-sky-500/10 transition-all flex items-center justify-between cursor-pointer group disabled:opacity-50"
                            >
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <div className="w-10 h-10 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                        <Fingerprint size={24} className={isBioScanning ? 'animate-pulse text-sky-300' : 'text-sky-400'} />
                                    </div>
                                    <div className="text-left min-w-0">
                                        <div className="text-xs font-bold leading-tight truncate text-white">
                                            {isBioScanning ? 'Leyendo huella digital...' : 'Entrar con Huella Dactilar'}
                                        </div>
                                        <div className="text-[11px] text-slate-300 leading-tight truncate mt-1">
                                            Operador: <span className="font-semibold text-white">{enrolledBioUser.name || enrolledBioUser.username}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 group-hover:text-sky-300">
                                        Tocar
                                    </span>
                                    <ArrowRight size={15} className="text-sky-400 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                                </div>
                            </button>

                            <div className="relative my-6 text-center">
                                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                                <span className="relative bg-[#F8FAFC] px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    o ingresa con tu contraseña
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Credentials Form (100% Privado: Anti-Autofill) */}
                    <form
                        onSubmit={handleSubmit}
                        className="space-y-5"
                        autoComplete="off"
                        noValidate
                        data-form-type="other"
                    >
                        {/* Campos señuelo invisibles para neutralizar el autocompletado nativo de Chromium/Electron */}
                        <input type="text" name="anti_autofill_cashier_dummy" tabIndex={-1} autoComplete="off" className="sr-only" aria-hidden="true" />
                        <input type="password" name="anti_autofill_pin_dummy" tabIndex={-1} autoComplete="off" className="sr-only" aria-hidden="true" />

                        {/* Username */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="pos_terminal_cashier"
                                className="block text-xs font-semibold text-slate-700"
                            >
                                Usuario
                            </label>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-[#0284C7] transition-colors">
                                    <User size={16} strokeWidth={2} />
                                </div>
                                <input
                                    ref={usernameInputRef}
                                    type="text"
                                    name="pos_terminal_cashier"
                                    id="pos_terminal_cashier"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full h-12 pl-10 pr-3.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus:outline-none focus:border-[#0284C7] focus:ring-4 focus:ring-[#0284C7]/12 transition-all"
                                    placeholder="Nombre de usuario"
                                    autoComplete="one-time-code"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    data-lpignore="true"
                                    data-form-type="other"
                                    required
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="pos_terminal_credential"
                                className="block text-xs font-semibold text-slate-700"
                            >
                                Contraseña
                            </label>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-[#0284C7] transition-colors">
                                    <Lock size={16} strokeWidth={2} />
                                </div>
                                <input
                                    ref={passwordInputRef}
                                    type={showPassword ? 'text' : 'password'}
                                    name="pos_terminal_credential"
                                    id="pos_terminal_credential"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full h-12 pl-10 pr-11 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus:outline-none focus:border-[#0284C7] focus:ring-4 focus:ring-[#0284C7]/12 transition-all [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                                    placeholder="••••••••"
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    data-lpignore="true"
                                    data-form-type="other"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer flex items-center justify-center"
                                    title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Optional Remember Username Control (Zero-Password Persistence) */}
                        <div className="flex items-center justify-between pt-0.5">
                            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none group">
                                <input
                                    type="checkbox"
                                    checked={rememberUser}
                                    onChange={(e) => handleToggleRemember(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <span
                                    className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[#0284C7]/40 peer-focus-visible:ring-offset-1 ${
                                        rememberUser
                                            ? 'bg-[#0B111E] border-[#0B111E] text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)]'
                                            : 'bg-white border-slate-300 group-hover:border-slate-400 text-transparent'
                                    }`}
                                >
                                    <Check size={11} strokeWidth={3} />
                                </span>
                                <span className="text-xs font-medium text-slate-600 group-hover:text-slate-900 transition-colors">
                                    Recordar mi usuario
                                </span>
                            </label>
                        </div>

                        {/* Primary Authoritative Submit Button */}
                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full h-12 px-5 rounded-lg bg-[#0B111E] hover:bg-[#162033] active:bg-[#070B14] text-white font-semibold text-sm tracking-[-0.01em] shadow-[0_1px_2px_rgba(15,23,42,0.14)] transition-all flex items-center justify-between disabled:opacity-55 cursor-pointer group"
                            >
                                {isSubmitting ? (
                                    <div className="w-full flex items-center justify-center gap-2.5">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        <span>{syncMessage || 'Verificando acceso...'}</span>
                                    </div>
                                ) : (
                                    <>
                                        <span>Entrar al sistema</span>
                                        <ArrowRight size={17} className="text-slate-300 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </main>

                {/* Right Chamber Discreet Security Footer */}
                <footer className="px-6 sm:px-10 py-5 border-t border-slate-200/80">
                    <div className="max-w-[380px] mx-auto flex items-center justify-between text-[11px] text-slate-400 select-none">
                        <span>Sesión auditada por estación</span>
                    </div>
                </footer>
            </section>

            {/* ENTERPRISE SERVER IP & LAN CLUSTER CONFIG MODAL */}
            <ServerConfigModal
                isOpen={showConfig}
                initialIp={serverIp}
                onClose={() => setShowConfig(false)}
                onConfigSaved={(newIp) => {
                    setServerIp(newIp);
                    const activeRole = localStorage.getItem('isaac_pos_node_role');
                    if (activeRole === 'client' || activeRole === 'server') {
                        setNodeRole(activeRole);
                    }
                    checkServerHealth(null, { requireMasterHost: activeRole === 'client' }).then((ok) => setIsConnected(ok));
                }}
            />
        </div>
    );
}
