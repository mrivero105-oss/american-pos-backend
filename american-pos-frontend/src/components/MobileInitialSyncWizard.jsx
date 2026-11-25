import { useState, useEffect } from 'react';
import {
    Wifi, 
    RefreshCw, 
    CheckCircle2, 
    AlertCircle, 
    Smartphone, 
    Database, 
    Image, 
    ArrowRight, 
    ShieldCheck, 
    Server, 
    Zap, 
    Check, 
    Lock, 
    Users
} from 'lucide-react';
import { motion } from 'framer-motion';
import { updateApiBaseUrl, checkServerHealth, autoDiscoverServer, formatServerUrl } from '../services/api';
import { syncService } from '../services/syncService';
import { getTerminalId } from '../utils/terminalIdentity';
import IsaacWebLogo from './IsaacWebLogo';
import { useMobileKeyboardViewport } from '../hooks/useMobileKeyboardViewport';

export default function MobileInitialSyncWizard({ onComplete }) {
    const { imeExtraBottomPx, handleFieldFocusCapture } = useMobileKeyboardViewport({ enabled: true });
    const [step, setStep] = useState(1); // 1: Connection, 2: Syncing, 3: Completed
    const [serverIp, setServerIp] = useState(() => 
        localStorage.getItem('isaac_pos_server_ip') || 
        localStorage.getItem('american_pos_server_ip') || 
        ''
    );
    const [isTesting, setIsTesting] = useState(false);
    const [isAutoDetecting, setIsAutoDetecting] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState(null); // null, true, false
    const [pingLatency, setPingLatency] = useState(null);

    // Sync execution state
    const [syncProgress, setSyncProgress] = useState({
        percent: 0,
        message: 'Preparando sincronización inicial...',
        phase: 'init',
        currentImage: null,
        imgCurrent: 0,
        imgTotal: 0
    });
    const [syncSummary, setSyncSummary] = useState(null);
    const [syncError, setSyncError] = useState(null);

    // Initial connection test on mount
    useEffect(() => {
        let isMounted = true;
        const testInitial = async () => {
            const start = Date.now();
            const healthy = await checkServerHealth();
            if (isMounted) {
                setConnectionStatus(healthy);
                if (healthy) setPingLatency(Date.now() - start);
                if (!healthy) {
                    setIsAutoDetecting(true);
                    const found = await autoDiscoverServer();
                    if (isMounted && found) {
                        setServerIp(found);
                        setConnectionStatus(true);
                    }
                    if (isMounted) setIsAutoDetecting(false);
                }
            }
        };
        testInitial();
        return () => { isMounted = false; };
    }, []);

    const handleTestConnection = async () => {
        setIsTesting(true);
        setSyncError(null);
        try {
            const formatted = formatServerUrl(serverIp);
            const start = Date.now();
            const ok = await checkServerHealth(formatted);
            const lat = Date.now() - start;
            setConnectionStatus(ok);
            if (ok) {
                setPingLatency(lat);
                updateApiBaseUrl(serverIp);
            } else {
                setPingLatency(null);
            }
        } catch {
            setConnectionStatus(false);
            setPingLatency(null);
        } finally {
            setIsTesting(false);
        }
    };

    const handleAutoDetect = async () => {
        setIsAutoDetecting(true);
        setSyncError(null);
        try {
            const found = await autoDiscoverServer();
            if (found) {
                setServerIp(found);
                setConnectionStatus(true);
                updateApiBaseUrl(found);
            } else {
                setConnectionStatus(false);
            }
        } catch {
            setConnectionStatus(false);
        } finally {
            setIsAutoDetecting(false);
        }
    };

    const startDeepSync = async () => {
        updateApiBaseUrl(serverIp);
        setStep(2);
        setSyncError(null);
        setSyncProgress({
            percent: 5,
            message: 'Conectando con el servidor principal e iniciando descarga...',
            phase: 'start',
            imgCurrent: 0,
            imgTotal: 0
        });

        try {
            const result = await syncService.performDeepInitialSync({
                onProgress: (prog) => {
                    setSyncProgress(prev => ({
                        ...prev,
                        percent: prog.percent !== undefined ? prog.percent : prev.percent,
                        message: prog.message || prev.message,
                        phase: prog.phase || prev.phase,
                        currentImage: prog.uri || prev.currentImage,
                        imgCurrent: prog.current !== undefined ? prog.current : prev.imgCurrent,
                        imgTotal: prog.total !== undefined ? prog.total : prev.imgTotal
                    }));
                }
            });

            if (result && result.success) {
                setSyncSummary({
                    products: result.results.products?.count || 0,
                    customers: result.results.customers?.count || 0,
                    suppliers: result.results.suppliers?.count || 0,
                    cashiers: result.results.cashiers?.count || 0,
                    images: result.results.images || { total: 0, cached: 0, alreadyCached: 0 }
                });
                setStep(3);
            }
        } catch (err) {
            console.error('Error in deep initial sync:', err);
            setSyncError(err.message || 'Error de conexión durante la descarga. Verifica que la PC esté encendida y en la misma red WiFi.');
        }
    };

    const handleFinish = () => {
        if (onComplete) {
            onComplete();
        } else {
            window.location.reload();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[99999] bg-slate-950 text-white flex flex-col justify-between p-4 sm:p-6 overflow-y-auto font-sans"
            style={{
                paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
                paddingBottom: `calc(max(1rem, env(safe-area-inset-bottom, 0px)) + ${imeExtraBottomPx}px)`
            }}
            onFocusCapture={handleFieldFocusCapture}
        >
            {/* Header */}
            <header className="relative z-10 w-full max-w-xl mx-auto flex items-center justify-between py-2">
                <IsaacWebLogo isLight={false} height="h-7 sm:h-8" />
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300">
                    <Smartphone size={13} className="text-primary-400" />
                    <span>Primer Inicio Móvil</span>
                </div>
            </header>

            {/* Main Content Container */}
            <main className="relative z-10 w-full max-w-xl mx-auto my-auto py-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden relative">
                    <div className="h-1 bg-primary-600"></div>

                    {/* STEP 1: CONEXIÓN CON SERVIDOR PRINCIPAL */}
                    {step === 1 && (
                        <div className="p-6 sm:p-8 space-y-6 animate-in fade-in duration-300">
                            <div className="text-center space-y-2">
                                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-primary-400 mx-auto">
                                    <Database className="w-6 h-6" />
                                </div>
                                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                                    Sincronización Inicial
                                </h1>
                                <p className="text-xs sm:text-sm text-slate-300 font-normal max-w-md mx-auto leading-relaxed">
                                    Para operar de forma autónoma en este dispositivo, se descargará el catálogo de productos, precios e imágenes a la base de datos interna.
                                </p>
                            </div>

                            {/* Server IP Config Card */}
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                                        <span>IP del Servidor Principal</span>
                                        {connectionStatus === true && (
                                            <span className="text-emerald-400 flex items-center gap-1 font-semibold text-[10px]">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                                Conectado {pingLatency ? `(${pingLatency}ms)` : ''}
                                            </span>
                                        )}
                                        {connectionStatus === false && (
                                            <span className="text-rose-400 font-semibold text-[10px]">
                                                Sin conexión
                                            </span>
                                        )}
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                            <Server size={15} />
                                        </div>
                                        <input
                                            type="text"
                                            enterKeyHint="go"
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                            value={serverIp}
                                            onChange={(e) => {
                                                setServerIp(e.target.value);
                                                setConnectionStatus(null);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && serverIp.trim() && !isTesting) {
                                                    e.preventDefault();
                                                    handleTestConnection();
                                                }
                                            }}
                                            placeholder="192.168.1.100"
                                            className="w-full min-h-[44px] pl-9 pr-3 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-base sm:text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
                                        />
                                    </div>
                                </div>

                                {/* Auto-detect Button */}
                                <div className="flex items-center gap-2 pt-0.5">
                                    <button
                                        type="button"
                                        disabled={isAutoDetecting}
                                        onClick={handleAutoDetect}
                                        className="h-9 px-3 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-semibold border border-emerald-500/30 cursor-pointer transition-colors flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        {isAutoDetecting ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                                        <span>{isAutoDetecting ? 'Buscando...' : 'Auto-detectar'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isTesting || !serverIp}
                                        onClick={handleTestConnection}
                                        className="ml-auto h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 cursor-pointer transition-colors flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        {isTesting ? <RefreshCw size={13} className="animate-spin" /> : <Wifi size={13} />}
                                        <span>Probar</span>
                                    </button>
                                </div>
                            </div>

                            {/* Features Preview */}
                            <div className="grid grid-cols-2 gap-3 text-left">
                                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-2.5">
                                    <div className="p-1.5 rounded-md bg-slate-800 text-primary-400 mt-0.5">
                                        <Image size={14} />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-semibold text-white">Catálogo Completo</h4>
                                        <p className="text-[10px] text-slate-400 mt-0.5">Almacenado localmente en el dispositivo</p>
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-2.5">
                                    <div className="p-1.5 rounded-md bg-slate-800 text-emerald-400 mt-0.5">
                                        <ShieldCheck size={14} />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-semibold text-white">Modo Desconectado</h4>
                                        <p className="text-[10px] text-slate-400 mt-0.5">Operación ininterrumpida sin internet</p>
                                    </div>
                                </div>
                            </div>

                            {/* Action Button */}
                            <button
                                type="button"
                                onClick={startDeepSync}
                                className="w-full h-11 px-4 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                            >
                                <span>Iniciar Descarga y Sincronización</span>
                                <ArrowRight size={15} />
                            </button>

                            {/* Offline Bypass Option */}
                            <div className="pt-1 text-center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const termId = getTerminalId();
                                        localStorage.setItem('isaac_pos_initial_sync_done', 'true');
                                        localStorage.setItem('isaac_pos_license_activated', 'true');
                                        if (termId) {
                                            localStorage.setItem('isaac_pos_license_machine_id', termId);
                                        }
                                        localStorage.setItem('isaac_pos_is_offline_mode', 'true');
                                        if (onComplete) onComplete();
                                    }}
                                    className="inline-block py-2 px-3 text-xs text-slate-400 hover:text-slate-200 transition-colors underline font-medium cursor-pointer"
                                >
                                    Omitir y Usar en Modo Offline
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: SINCRONIZACIÓN Y DESCARGA EN PROCESO */}
                    {step === 2 && (
                        <div className="p-6 sm:p-8 space-y-6 animate-in fade-in duration-300">
                            <div className="text-center space-y-2">
                                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-primary-400 mx-auto relative">
                                    <RefreshCw className="w-6 h-6 animate-spin text-primary-400" />
                                </div>
                                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                                    Creando Base de Datos Local
                                </h2>
                                <p className="text-xs text-slate-300 font-normal">
                                    Por favor mantén la aplicación abierta mientras se adoptan los datos e imágenes.
                                </p>
                            </div>

                            {/* Progress Bar Container */}
                            <div className="space-y-2">
                                <div className="w-full bg-slate-950 h-2.5 rounded-full border border-slate-800 overflow-hidden">
                                    <motion.div
                                        className="h-full rounded-full bg-primary-600 transition-all duration-300"
                                        initial={{ width: '5%' }}
                                        animate={{ width: `${Math.max(5, syncProgress.percent)}%` }}
                                        transition={{ duration: 0.3 }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium px-1">
                                    <span className="truncate max-w-[280px]">{syncProgress.message}</span>
                                    <span className="font-mono font-semibold text-white shrink-0 ml-2">{syncProgress.percent}%</span>
                                </div>
                            </div>

                            {/* Step Checklist */}
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-slate-300">
                                        <Database size={14} className={syncProgress.percent >= 30 ? 'text-emerald-400' : 'text-slate-500'} />
                                        <span>1. Catálogo de Productos y Precios</span>
                                    </span>
                                    {syncProgress.percent >= 30 ? (
                                        <span className="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]"><Check size={13} /> Listo</span>
                                    ) : (
                                        <span className="text-slate-500 text-[10px]">Descargando...</span>
                                    )}
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-slate-300">
                                        <Users size={14} className={syncProgress.percent >= 45 ? 'text-emerald-400' : 'text-slate-500'} />
                                        <span>2. Clientes y Proveedores</span>
                                    </span>
                                    {syncProgress.percent >= 45 ? (
                                        <span className="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]"><Check size={13} /> Listo</span>
                                    ) : (
                                        <span className="text-slate-500 text-[10px]">Pendiente</span>
                                    )}
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-slate-300">
                                        <Lock size={14} className={syncProgress.percent >= 70 ? 'text-emerald-400' : 'text-slate-500'} />
                                        <span>3. Monedas, Tasas y Acceso Offline</span>
                                    </span>
                                    {syncProgress.percent >= 70 ? (
                                        <span className="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]"><Check size={13} /> Listo</span>
                                    ) : (
                                        <span className="text-slate-500 text-[10px]">Pendiente</span>
                                    )}
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-slate-300">
                                        <Image size={14} className={syncProgress.percent >= 95 ? 'text-emerald-400' : syncProgress.percent >= 75 ? 'text-primary-400 animate-pulse' : 'text-slate-500'} />
                                        <span>4. Descarga de Imágenes a IndexedDB</span>
                                    </span>
                                    {syncProgress.percent >= 95 ? (
                                        <span className="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]"><Check size={13} /> Completadas</span>
                                    ) : syncProgress.percent >= 75 ? (
                                        <span className="text-primary-400 font-mono font-semibold text-[10px]">
                                            {syncProgress.imgCurrent}/{syncProgress.imgTotal}
                                        </span>
                                    ) : (
                                        <span className="text-slate-500 text-[10px]">En espera</span>
                                    )}
                                </div>
                            </div>

                            {/* Error Retry Banner */}
                            {syncError && (
                                <div className="bg-rose-950/30 border border-rose-800/40 text-rose-200 p-3.5 rounded-xl flex flex-col gap-2.5 text-xs">
                                    <div className="flex items-start gap-2">
                                        <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                                        <p className="leading-snug">{syncError}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={startDeepSync}
                                        className="w-full h-9 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-lg text-xs uppercase tracking-wider transition-colors cursor-pointer"
                                    >
                                        Reintentar Sincronización
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 3: SINCRONIZACIÓN EXITOSA Y ADOPCIÓN COMPLETA */}
                    {step === 3 && (
                        <div className="p-6 sm:p-8 space-y-6 animate-in zoom-in-95 duration-300 text-center">
                            <div className="space-y-3">
                                <div className="w-12 h-12 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
                                    <CheckCircle2 size={28} />
                                </div>
                                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                                    Sincronización Completada
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-300 font-normal max-w-sm mx-auto leading-relaxed">
                                    El dispositivo cuenta con la base de datos local lista. Puedes facturar y consultar inventario de forma autónoma.
                                </p>
                            </div>

                            {/* Stats Grid */}
                            {syncSummary && (
                                <div className="grid grid-cols-2 gap-3 text-left">
                                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Productos</span>
                                        <span className="text-xl font-bold text-primary-400">{syncSummary.products}</span>
                                    </div>
                                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Imágenes Locales</span>
                                        <span className="text-xl font-bold text-emerald-400">
                                            {(syncSummary.images?.cached || 0) + (syncSummary.images?.alreadyCached || 0)}
                                        </span>
                                    </div>
                                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Clientes</span>
                                        <span className="text-xl font-bold text-primary-400">{syncSummary.customers}</span>
                                    </div>
                                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Cajeros Offline</span>
                                        <span className="text-xl font-bold text-primary-400">{syncSummary.cashiers || 'Activos'}</span>
                                    </div>
                                </div>
                            )}

                            {/* Finish Button */}
                            <button
                                type="button"
                                onClick={handleFinish}
                                className="w-full h-11 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                            >
                                <CheckCircle2 size={15} />
                                <span>Comenzar a Facturar</span>
                            </button>
                        </div>
                    )}

                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 w-full max-w-xl mx-auto py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] text-center text-slate-500 text-[11px]">
                Isaac POS System • Base de Datos Local e Imágenes Desconectadas
            </footer>
        </div>
    );
}
