import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import api from '../services/api';
import { toast } from 'react-hot-toast';
import {
    Cloud,
    Lock,
    Unlock,
    Ban,
    RefreshCw,
    CheckCircle2,
    AlertTriangle,
    Plus,
    LogOut,
    Search,
    Save,
    Radio,
    ShieldCheck,
    Clock
} from 'lucide-react';

const PROVIDER_SESSION_KEY = 'isaac_pos_provider_gateway_session';

function readProviderSession() {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(PROVIDER_SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function writeProviderSession(sessionObj) {
    if (typeof sessionStorage === 'undefined') return;
    try {
        if (!sessionObj) {
            sessionStorage.removeItem(PROVIDER_SESSION_KEY);
            return;
        }
        sessionStorage.setItem(PROVIDER_SESSION_KEY, JSON.stringify(sessionObj));
    } catch (err) {
        console.warn('[OnlineLicenseControl] Error guardando sesión de proveedor en sessionStorage:', err?.message);
    }
}

function formatDateTime(value) {
    if (!value) return 'Nunca';
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return String(value);
    return new Date(ts).toLocaleString();
}

function getStatusBadge(status) {
    const norm = String(status || '').toLowerCase();
    if (norm === 'active') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 size={12} /> Activa
            </span>
        );
    }
    if (norm === 'suspended') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                <Ban size={12} /> Suspendida
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            <AlertTriangle size={12} /> {norm === 'revoked' ? 'Revocada' : norm || 'Desconocido'}
        </span>
    );
}

export default function OnlineLicenseControlTab({ localMachineId = '' }) {
    const [gatewayUrl, setGatewayUrl] = useState('');
    const [graceDaysDefault, setGraceDaysDefault] = useState(7);
    const [savingGateway, setSavingGateway] = useState(false);
    const [testingHeartbeat, setTestingHeartbeat] = useState(false);

    // Sesión del proveedor (solo en sessionStorage, nunca en código o .env cliente)
    const [providerSession, setProviderSession] = useState(() => readProviderSession());
    const [loginMode, setLoginMode] = useState('credentials'); // 'credentials' | 'secret'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [adminSecretInput, setAdminSecretInput] = useState('');
    const [authenticating, setAuthenticating] = useState(false);

    // Datos remotos
    const [remoteLicenses, setRemoteLicenses] = useState([]);
    const [loadingList, setLoadingList] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Formulario de registro/actualización remota
    const [newMachineId, setNewMachineId] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newGraceDays, setNewGraceDays] = useState(7);
    const [newNotes, setNewNotes] = useState('');
    const [submittingLicense, setSubmittingLicense] = useState(false);

    // Modal inline para motivo de suspensión
    const [suspendTarget, setSuspendTarget] = useState(null);
    const [suspendReason, setSuspendReason] = useState('Licencia suspendida por falta de pago.');
    const [updatingStatusId, setUpdatingStatusId] = useState(null);

    const buildAuthHeaders = useCallback((session) => {
        if (!session) return {};
        if (session.mode === 'secret' && session.secret) {
            return { 'x-admin-secret': session.secret };
        }
        if (session.token) {
            return { Authorization: `Bearer ${session.token}` };
        }
        return {};
    }, []);

    const activeGatewayBase = String(providerSession?.gatewayUrl || gatewayUrl || '').trim().replace(/\/+$/, '');

    useEffect(() => {
        let mounted = true;
        const loadOnlineConfig = async () => {
            try {
                const { data } = await api.get('/license/online-config');
                if (!mounted) return;
                if (data?.gatewayUrl) setGatewayUrl(data.gatewayUrl);
                if (data?.graceDays !== undefined && data?.graceDays !== null) {
                    setGraceDaysDefault(Number(data.graceDays));
                    setNewGraceDays(Number(data.graceDays));
                }
            } catch (_) {
                // Silencioso si todavía no se ha configurado
            }
        };
        loadOnlineConfig();
        return () => {
            mounted = false;
        };
    }, []);

    const fetchRemoteLicenses = useCallback(async (sessionOverride = null) => {
        const activeSession = sessionOverride || providerSession;
        const base = String(activeSession?.gatewayUrl || gatewayUrl || '').trim().replace(/\/+$/, '');
        if (!activeSession || !base) return;

        setLoadingList(true);
        try {
            const { data } = await axios.get(`${base}/admin/licenses`, {
                headers: buildAuthHeaders(activeSession),
                timeout: 10000
            });
            setRemoteLicenses(Array.isArray(data?.licenses) ? data.licenses : []);
        } catch (err) {
            const status = err?.response?.status;
            if (status === 401 || status === 403) {
                toast.error('Sesión del proveedor expirada o credenciales inválidas.');
                setProviderSession(null);
                writeProviderSession(null);
            } else {
                toast.error(err?.response?.data?.error || 'No se pudo consultar el Gateway remoto.');
            }
        } finally {
            setLoadingList(false);
        }
    }, [providerSession, gatewayUrl, buildAuthHeaders]);

    useEffect(() => {
        if (providerSession) {
            fetchRemoteLicenses(providerSession);
        }
    }, [providerSession, fetchRemoteLicenses]);

    const handleSaveGateway = async (e) => {
        e.preventDefault();
        setSavingGateway(true);
        try {
            const { data } = await api.post('/license/online-config', { gatewayUrl: gatewayUrl.trim() });
            setGatewayUrl(data.gatewayUrl || '');
            toast.success(data.message || 'Configuración de Gateway guardada.');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Error guardando la URL del Gateway.');
        } finally {
            setSavingGateway(false);
        }
    };

    const handleTestLocalHeartbeat = async () => {
        setTestingHeartbeat(true);
        try {
            const { data } = await api.post('/license/sync-online', { machineId: localMachineId });
            if (data?.skipped) {
                toast('Configura primero una URL de Gateway en este equipo.', { icon: 'ℹ️' });
            } else if (data?.offline) {
                toast.error(data.error || 'No se pudo conectar al Gateway desde este equipo.');
            } else if (data?.tampered) {
                toast.error('Firma RSA del Gateway rechazada (llave pública/privada no coincide).');
            } else if (data?.suspended) {
                toast.error(`Estado remoto: ${data.status}. Motivo: ${data.reason || 'Sin detalle'}`);
            } else if (data?.success) {
                toast.success(`Heartbeat verificado (${data.status}). Gracia hasta: ${formatDateTime(data.graceUntil)}`);
            } else {
                toast.error(data?.error || 'Respuesta inesperada del Gateway.');
            }
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Error ejecutando heartbeat local.');
        } finally {
            setTestingHeartbeat(false);
        }
    };

    const handleProviderLogin = async (e) => {
        e.preventDefault();
        const base = gatewayUrl.trim().replace(/\/+$/, '');
        if (!base) {
            toast.error('Ingresa primero la URL del Gateway central.');
            return;
        }

        setAuthenticating(true);
        try {
            if (loginMode === 'secret') {
                if (!adminSecretInput.trim()) {
                    toast.error('Ingresa el secreto administrativo del Gateway.');
                    setAuthenticating(false);
                    return;
                }
                const candidateSession = {
                    gatewayUrl: base,
                    mode: 'secret',
                    secret: adminSecretInput.trim(),
                    email: 'Proveedor (API Secret)'
                };
                await axios.get(`${base}/admin/licenses`, {
                    headers: buildAuthHeaders(candidateSession),
                    timeout: 10000
                });
                setProviderSession(candidateSession);
                writeProviderSession(candidateSession);
                setAdminSecretInput('');
                toast.success('Conectado al panel central de licencias.');
            } else {
                const { data } = await axios.post(`${base}/admin/login`, {
                    email: email.trim(),
                    password
                }, { timeout: 10000 });

                if (!data?.token) {
                    throw new Error(data?.error || 'El Gateway no devolvió token de sesión.');
                }
                const nextSession = {
                    gatewayUrl: base,
                    mode: 'token',
                    token: data.token,
                    email: data.email || email.trim()
                };
                setProviderSession(nextSession);
                writeProviderSession(nextSession);
                setPassword('');
                toast.success(`Sesión de proveedor iniciada (${nextSession.email}).`);
            }
        } catch (err) {
            toast.error(err?.response?.data?.error || err.message || 'Autenticación rechazada por el Gateway.');
        } finally {
            setAuthenticating(false);
        }
    };

    const handleProviderLogout = () => {
        setProviderSession(null);
        writeProviderSession(null);
        setRemoteLicenses([]);
        toast('Sesión del proveedor cerrada.');
    };

    const handleCreateOrUpdateLicense = async (e) => {
        e.preventDefault();
        if (!newMachineId.trim()) {
            toast.error('Ingresa el Machine ID (HWID) del cliente.');
            return;
        }
        setSubmittingLicense(true);
        const parsedGrace = String(newGraceDays).trim() !== '' ? Number.parseInt(newGraceDays, 10) : NaN;
        const safeGraceDays = Number.isFinite(parsedGrace)
            ? Math.max(0, Math.min(365, parsedGrace))
            : (Number.isFinite(Number(graceDaysDefault)) ? Number(graceDaysDefault) : 7);
        try {
            await axios.post(`${activeGatewayBase}/admin/licenses`, {
                machineId: newMachineId.trim(),
                customerName: newCustomerName.trim() || null,
                graceDays: safeGraceDays,
                notes: newNotes.trim() || null,
                status: 'active'
            }, {
                headers: buildAuthHeaders(providerSession),
                timeout: 10000
            });
            toast.success(`Licencia en línea registrada/actualizada para ${newMachineId.trim()}.`);
            setNewMachineId('');
            setNewCustomerName('');
            setNewNotes('');
            await fetchRemoteLicenses();
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Error registrando licencia en el Gateway.');
        } finally {
            setSubmittingLicense(false);
        }
    };

    const handleChangeRemoteStatus = async (machineId, status, reason = null) => {
        setUpdatingStatusId(machineId);
        try {
            await axios.post(`${activeGatewayBase}/admin/licenses/${encodeURIComponent(machineId)}/status`, {
                status,
                reason
            }, {
                headers: buildAuthHeaders(providerSession),
                timeout: 10000
            });
            toast.success(
                status === 'suspended'
                    ? `Licencia ${machineId} suspendida remotamente.`
                    : status === 'revoked'
                        ? `Licencia ${machineId} revocada.`
                        : `Licencia ${machineId} reactivada.`
            );
            setSuspendTarget(null);
            await fetchRemoteLicenses();
        } catch (err) {
            toast.error(err?.response?.data?.error || 'No se pudo actualizar el estado remoto.');
        } finally {
            setUpdatingStatusId(null);
        }
    };

    const filteredLicenses = remoteLicenses.filter((item) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
            String(item.machine_id || item.machineId || '').toLowerCase().includes(q) ||
            String(item.customer_name || item.customerName || '').toLowerCase().includes(q) ||
            String(item.status || '').toLowerCase().includes(q) ||
            String(item.suspend_reason || item.reason || '').toLowerCase().includes(q)
        );
    });

    return (
        <div className="space-y-6">
            {/* 1. Configuración del Gateway Local en este Servidor POS */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                            <Cloud size={19} />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                                Gateway de Licencias en Línea (Configuración de este POS)
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Sin URL configurada, el sistema opera 100% offline. Con URL configurada, valida heartbeat RSA con {graceDaysDefault} días de gracia offline.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleTestLocalHeartbeat}
                        disabled={testingHeartbeat}
                        className="h-9 px-3.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                        <Radio size={14} className={testingHeartbeat ? 'animate-pulse text-indigo-500' : ''} />
                        <span>{testingHeartbeat ? 'Verificando...' : 'Probar Heartbeat Local'}</span>
                    </button>
                </div>

                <form onSubmit={handleSaveGateway} className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="url"
                        value={gatewayUrl}
                        onChange={(e) => setGatewayUrl(e.target.value)}
                        placeholder="https://tu-gateway.supabase.co/functions/v1/license-gateway  (deja vacío para modo offline)"
                        className="flex-1 h-10 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                    />
                    <button
                        type="submit"
                        disabled={savingGateway}
                        className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                        <Save size={15} />
                        <span>{savingGateway ? 'Guardando...' : 'Guardar Gateway'}</span>
                    </button>
                </form>
            </div>

            {/* 2. Panel Administrativo del Proveedor */}
            {!providerSession ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs max-w-2xl">
                    <div className="flex items-start gap-3 mb-5">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                            <Lock size={19} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                Acceso de Proveedor al Control Remoto
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Inicia sesión contra tu servidor Gateway para listar clientes, suspender licencias remotamente o reactivar terminales. Las credenciales solo permanecen en esta sesión del navegador.
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-4">
                        <button
                            type="button"
                            onClick={() => setLoginMode('credentials')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                                loginMode === 'credentials'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                            }`}
                        >
                            Email y Contraseña
                        </button>
                        <button
                            type="button"
                            onClick={() => setLoginMode('secret')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                                loginMode === 'secret'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                            }`}
                        >
                            Admin API Secret
                        </button>
                    </div>

                    <form onSubmit={handleProviderLogin} className="space-y-4">
                        {loginMode === 'credentials' ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                                        Correo de Proveedor
                                    </label>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="proveedor@tudominio.com"
                                        className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                                        Contraseña
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                                    Secreto Administrativo (x-admin-secret)
                                </label>
                                <input
                                    type="password"
                                    required
                                    value={adminSecretInput}
                                    onChange={(e) => setAdminSecretInput(e.target.value)}
                                    placeholder="Pega tu ADMIN_API_SECRET del servidor"
                                    className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                />
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={authenticating}
                            className="h-10 px-5 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            <ShieldCheck size={16} />
                            <span>{authenticating ? 'Conectando...' : 'Conectar al Gateway Remoto'}</span>
                        </button>
                    </form>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* Columna Izquierda: Registrar/Autorizar Cliente en la Nube */}
                    <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide flex items-center gap-1.5">
                                    <Plus size={15} className="text-indigo-500" />
                                    Registrar Equipo en Nube
                                </span>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[220px]">
                                    Sesión: {providerSession.email}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleProviderLogout}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                title="Cerrar sesión del proveedor"
                            >
                                <LogOut size={13} /> Salir
                            </button>
                        </div>

                        <form onSubmit={handleCreateOrUpdateLicense} className="space-y-3.5">
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                                        Machine ID (HWID)
                                    </label>
                                    {localMachineId && (
                                        <button
                                            type="button"
                                            onClick={() => setNewMachineId(localMachineId)}
                                            className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                        >
                                            Usar HWID local
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="text"
                                    required
                                    value={newMachineId}
                                    onChange={(e) => setNewMachineId(e.target.value)}
                                    placeholder="Ej: WIN-8A3F..."
                                    className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                                    Comercio / Cliente
                                </label>
                                <input
                                    type="text"
                                    value={newCustomerName}
                                    onChange={(e) => setNewCustomerName(e.target.value)}
                                    placeholder="Ej: Bodegón Central CA"
                                    className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                                    Días de Gracia Offline
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    max={365}
                                    value={newGraceDays}
                                    onChange={(e) => setNewGraceDays(e.target.value)}
                                    className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                                    Notas Internas
                                </label>
                                <input
                                    type="text"
                                    value={newNotes}
                                    onChange={(e) => setNewNotes(e.target.value)}
                                    placeholder="Plan mensual / Contacto"
                                    className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submittingLicense}
                                className="w-full h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                <Plus size={15} />
                                <span>{submittingLicense ? 'Guardando...' : 'Autorizar / Guardar en Nube'}</span>
                            </button>
                        </form>
                    </div>

                    {/* Columna Derecha: Lista de Clientes y Acciones de Suspensión */}
                    <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                    Clientes en Línea ({filteredLicenses.length})
                                </h3>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Control remoto de suspensión, reactivación y última señal (heartbeat)
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Buscar HWID o cliente..."
                                        className="h-9 pl-8 pr-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => fetchRemoteLicenses()}
                                    disabled={loadingList}
                                    className="h-9 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    <RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} />
                                    <span>Refrescar</span>
                                </button>
                            </div>
                        </div>

                        {suspendTarget && (
                            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-rose-700 dark:text-rose-300">
                                        Suspender licencia: <code className="font-mono">{suspendTarget}</code>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setSuspendTarget(null)}
                                        className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="text"
                                        value={suspendReason}
                                        onChange={(e) => setSuspendReason(e.target.value)}
                                        placeholder="Motivo visible para el cliente..."
                                        className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-slate-950 border border-rose-300 dark:border-rose-700 text-xs text-slate-800 dark:text-slate-200 outline-none"
                                    />
                                    <button
                                        type="button"
                                        disabled={updatingStatusId === suspendTarget}
                                        onClick={() => handleChangeRemoteStatus(suspendTarget, 'suspended', suspendReason.trim() || 'Licencia suspendida por el proveedor.')}
                                        className="h-9 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                                    >
                                        Confirmar Suspensión
                                    </button>
                                </div>
                            </div>
                        )}

                        {filteredLicenses.length === 0 ? (
                            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                                {loadingList ? 'Consultando licencias remotas...' : 'No hay licencias registradas en el Gateway o no coinciden con la búsqueda.'}
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                                {filteredLicenses.map((item) => {
                                    const mId = item.machine_id || item.machineId;
                                    const customer = item.customer_name || item.customerName;
                                    const reason = item.suspend_reason || item.reason;
                                    const graceDays = item.grace_days ?? item.graceDays ?? 7;
                                    const lastSeen = item.last_seen_at || item.lastSeenAt;
                                    const isBusy = updatingStatusId === mId;

                                    return (
                                        <div
                                            key={mId}
                                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                        >
                                            <div className="space-y-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-white break-all">
                                                        {mId}
                                                    </span>
                                                    {getStatusBadge(item.status)}
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                                        <Clock size={11} /> Gracia {graceDays}d
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                                                    {customer || 'Sin nombre de comercio'} {item.notes ? `• ${item.notes}` : ''}
                                                </p>
                                                <p className="text-[11px] text-slate-400">
                                                    Último heartbeat: {formatDateTime(lastSeen)}
                                                </p>
                                                {reason && item.status !== 'active' && (
                                                    <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                                        Motivo: {reason}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                                {item.status !== 'suspended' && (
                                                    <button
                                                        type="button"
                                                        disabled={isBusy}
                                                        onClick={() => {
                                                            setSuspendTarget(mId);
                                                            setSuspendReason('Licencia suspendida por falta de pago.');
                                                        }}
                                                        className="h-8 px-3 rounded-lg bg-rose-600/10 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                                    >
                                                        <Ban size={13} /> Suspender
                                                    </button>
                                                )}
                                                {item.status !== 'active' && (
                                                    <button
                                                        type="button"
                                                        disabled={isBusy}
                                                        onClick={() => handleChangeRemoteStatus(mId, 'active', null)}
                                                        className="h-8 px-3 rounded-lg bg-emerald-600/10 hover:bg-emerald-600 text-emerald-600 hover:text-white border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                                    >
                                                        <Unlock size={13} /> Reactivar
                                                    </button>
                                                )}
                                                {item.status !== 'revoked' && (
                                                    <button
                                                        type="button"
                                                        disabled={isBusy}
                                                        onClick={() => {
                                                            if (window.confirm(`¿Revocar permanentemente la licencia de ${mId}?`)) {
                                                                handleChangeRemoteStatus(mId, 'revoked', 'Licencia revocada por el proveedor.');
                                                            }
                                                        }}
                                                        className="h-8 px-2.5 rounded-lg bg-slate-200/70 hover:bg-slate-700 text-slate-700 hover:text-white dark:bg-slate-800 dark:text-slate-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
                                                    >
                                                        Revocar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
