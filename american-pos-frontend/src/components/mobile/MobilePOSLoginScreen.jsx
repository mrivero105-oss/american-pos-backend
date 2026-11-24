import { useEffect } from 'react';
import {
    AlertCircle,
    Check,
    Fingerprint,
    Lock,
    RefreshCw,
    Settings,
    User,
    Wifi,
    X,
    Zap
} from 'lucide-react';
import IsaacWebLogo from '../IsaacWebLogo';

export default function MobilePOSLoginScreen({
    T,
    isLight,
    businessInfo,
    serverHealth,
    mobileServerIp,
    setMobileServerIp,
    showServerModal,
    setShowServerModal,
    serverFeedback,
    setServerFeedback,
    loginError,
    enrolledBioUser,
    handleMobileBiometricLogin,
    isBioLoggingIn,
    isLoggingIn,
    handleMobileLogin,
    loginUsername,
    setLoginUsername,
    loginPassword,
    setLoginPassword,
    isTestingServer,
    handleAutoDiscoverServer,
    handleTestAndSaveServer
}) {
    // Blindaje anti-captura (FLAG_SECURE) mientras se muestran credenciales de inicio de sesión
    useEffect(() => {
        const plugin = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
            ? window.Capacitor?.Plugins?.PosNativeHardware
            : null;
        if (!plugin?.setScreenSecure) return undefined;
        plugin.setScreenSecure({ secure: true }).catch(() => {});
        return () => {
            plugin.setScreenSecure({ secure: false }).catch(() => {});
        };
    }, []);
    return (
        <div className={`flex-1 flex flex-col items-center justify-center p-4 ${T.appBg}`}>
            <div className={`w-full max-w-sm ${T.modalCard} rounded-xl p-6 sm:p-7 shadow-2xl space-y-4`}>
                <div className="text-center space-y-2">
                    <div className="flex justify-center py-2 sm:py-3">
                        <IsaacWebLogo
                            isLight={isLight}
                            height="h-16 sm:h-20"
                            imgClassName="max-w-[270px] sm:max-w-[310px] drop-shadow-xs"
                            className="justify-center"
                        />
                    </div>
                    <h2 className={`text-sm font-extrabold ${T.textPrimary}`}>{businessInfo.name || 'Bodega Sigfrido y Familia'}</h2>

                    {/* Indicador interactivo de estado de enlace al servidor PC */}
                    <div className="flex flex-col items-center gap-1">
                        <button
                            type="button"
                            onClick={() => {
                                setShowServerModal(true);
                                setServerFeedback(null);
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold cursor-pointer transition-all active:scale-95 ${
                                serverHealth === true
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                    : serverHealth === false
                                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25 animate-pulse'
                                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            }`}
                            title="Tocar para cambiar la IP del Servidor PC"
                        >
                            <span
                                className={`w-2 h-2 rounded-full ${
                                    serverHealth === true ? 'bg-emerald-400' : serverHealth === false ? 'bg-rose-500' : 'bg-amber-400 animate-ping'
                                }`}
                            />
                            <span>
                                {serverHealth === true
                                    ? `PC Conectada (${mobileServerIp.replace(/^https?:\/\//, '')})`
                                    : serverHealth === false
                                        ? 'Sin conexión a PC • Tocar para configurar'
                                        : 'Verificando enlace...'}
                            </span>
                            <Settings size={12} className="opacity-70 ml-0.5" />
                        </button>
                    </div>
                </div>

                {loginError && (
                    <div className="bg-rose-500/15 border border-rose-500/30 p-2.5 rounded-xl text-rose-500 dark:text-rose-300 text-xs flex items-center gap-2">
                        <AlertCircle size={15} className="shrink-0" />
                        <span>{loginError}</span>
                    </div>
                )}

                {/* Acceso Ultrarrápido con Huella Dactilar Móvil (Zero-Trust) */}
                {enrolledBioUser && (
                    <div className="space-y-3 pb-1">
                        <button
                            type="button"
                            onClick={handleMobileBiometricLogin}
                            disabled={isBioLoggingIn || isLoggingIn}
                            className="w-full min-h-[50px] px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-700 hover:from-sky-500 hover:to-indigo-600 active:scale-[0.98] text-white font-extrabold text-xs uppercase tracking-wider shadow-lg flex items-center justify-between cursor-pointer transition-all disabled:opacity-50"
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                                    <Fingerprint size={20} className={isBioLoggingIn ? 'animate-pulse text-sky-200' : 'text-white'} />
                                </div>
                                <div className="text-left min-w-0">
                                    <div className="text-[11px] font-extrabold truncate text-white">
                                        {isBioLoggingIn ? 'Leyendo huella dactilar...' : 'Entrar con Huella Dactilar'}
                                    </div>
                                    <div className="text-[10px] text-white/80 lowercase truncate font-semibold mt-0.5">
                                        Operador: {enrolledBioUser.name || enrolledBioUser.username}
                                    </div>
                                </div>
                            </div>
                            <span className="text-[10px] bg-white/20 hover:bg-white/30 px-2 py-1 rounded font-black shrink-0 tracking-wider">
                                Tocar
                            </span>
                        </button>

                        <div className="relative text-center my-2">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-700/40" /></div>
                            <span className={`relative ${T.modalCard} px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400`}>
                                o ingresa tus datos
                            </span>
                        </div>
                    </div>
                )}

                <form onSubmit={handleMobileLogin} className="space-y-3">
                    <div>
                        <label className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>Usuario / Cajero</label>
                        <div className="relative">
                            <User size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted}`} />
                            <input
                                type="text"
                                value={loginUsername}
                                onChange={(e) => setLoginUsername(e.target.value)}
                                placeholder="Ingresa tu usuario"
                                className={`w-full ${T.inputBg} border rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold outline-none`}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>Contraseña</label>
                        <div className="relative">
                            <Lock size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted}`} />
                            <input
                                type="password"
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                placeholder="••••••••"
                                className={`w-full ${T.inputBg} border rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold outline-none`}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoggingIn}
                        className="w-full min-h-[46px] bg-[#0a0d12] hover:bg-[#161c26] active:scale-[0.99] disabled:opacity-50 text-white border border-[#1e242e] font-extrabold py-2.5 rounded-[8px] text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer mt-2"
                    >
                        {isLoggingIn ? (
                            <RefreshCw size={15} className="animate-spin" />
                        ) : (
                            <span>Ingresar a Terminal Móvil</span>
                        )}
                    </button>

                    <div className="pt-1 text-center">
                        <button
                            type="button"
                            onClick={() => {
                                setShowServerModal(true);
                                setServerFeedback(null);
                            }}
                            className={`text-[11px] font-bold ${T.textMuted} hover:${T.textPrimary} flex items-center justify-center gap-1.5 mx-auto cursor-pointer`}
                        >
                            <Wifi size={13} />
                            <span>Configurar IP de Servidor PC</span>
                        </button>
                    </div>
                </form>
            </div>

            {/* Modal de Configuración Rápida de IP de Servidor en Móvil */}
            {showServerModal && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                    <div className={`w-full max-w-xs ${T.modalCard} rounded-2xl p-5 border ${T.border} shadow-2xl space-y-4`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Wifi className="text-blue-500" size={18} />
                                <h3 className={`text-xs font-black uppercase tracking-wider ${T.textPrimary}`}>IP de la Computadora</h3>
                            </div>
                            <button
                                onClick={() => setShowServerModal(false)}
                                className={`p-1 rounded-lg ${T.btnGhost} text-slate-400`}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <p className={`text-[11px] ${T.textSecondary} leading-relaxed`}>
                            Dirección IP de tu PC principal donde corre el sistema Isaac POS:
                        </p>

                        <div>
                            <label className={`text-[10px] font-bold uppercase tracking-wider ${T.textMuted} block mb-1`}>IP / Puerto</label>
                            <input
                                type="text"
                                value={mobileServerIp}
                                onChange={(e) => setMobileServerIp(e.target.value)}
                                placeholder="192.168.1.30:3005"
                                className={`w-full ${T.inputBg} border rounded-xl px-3 py-2.5 text-xs font-mono font-bold outline-none`}
                            />
                        </div>

                        {serverFeedback && (
                            <div
                                className={`p-2 rounded-xl text-[11px] font-bold flex items-center gap-1.5 ${
                                    serverFeedback.ok ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                }`}
                            >
                                {serverFeedback.ok ? <Check size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
                                <span>{serverFeedback.msg}</span>
                            </div>
                        )}

                        <div className="flex gap-2 pt-1">
                            <button
                                type="button"
                                disabled={isTestingServer}
                                onClick={handleAutoDiscoverServer}
                                className={`flex-1 py-2.5 rounded-xl border ${T.border} ${T.btnGhost} text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer`}
                            >
                                {isTestingServer ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                                <span>Auto-Buscar</span>
                            </button>
                            <button
                                type="button"
                                disabled={isTestingServer}
                                onClick={() => handleTestAndSaveServer(mobileServerIp)}
                                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black uppercase flex items-center justify-center gap-1 shadow-md shadow-blue-600/30 cursor-pointer"
                            >
                                {isTestingServer ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                                <span>Guardar</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
