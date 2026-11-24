import { useEffect } from 'react';
import {
    AlertCircle,
    Fingerprint,
    Lock,
    RefreshCw,
    Settings,
    User,
    Wifi
} from 'lucide-react';
import IsaacWebLogo from '../IsaacWebLogo';

export default function MobilePOSLoginScreen({
    T,
    isLight,
    businessInfo,
    serverHealth,
    mobileServerIp,
    setShowServerModal,
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
    setLoginPassword
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

    const displayServerHost = String(mobileServerIp || '').replace(/^https?:\/\//i, '').trim();

    return (
        <div
            className={`flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center p-4 ${T.appBg}`}
            style={{
                paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
                paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))'
            }}
        >
            <div className={`w-full max-w-sm my-auto ${T.modalCard} rounded-xl p-6 sm:p-7 shadow-2xl space-y-4`}>
                <div className="text-center space-y-2">
                    <div className="flex justify-center py-2 sm:py-3">
                        <IsaacWebLogo
                            isLight={isLight}
                            height="h-16 sm:h-20"
                            imgClassName="max-w-[270px] sm:max-w-[310px] drop-shadow-xs"
                            className="justify-center"
                        />
                    </div>
                    <h2 className={`text-sm font-extrabold ${T.textPrimary}`}>{businessInfo.name || 'Isaac POS'}</h2>

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
                                    ? (displayServerHost ? `PC Conectada (${displayServerHost})` : 'PC Conectada (LAN)')
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
                            className={`text-[11px] font-bold ${T.textMuted} hover:opacity-100 flex items-center justify-center gap-1.5 mx-auto cursor-pointer py-1.5`}
                        >
                            <Wifi size={13} />
                            <span>Configurar IP de Servidor PC</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
