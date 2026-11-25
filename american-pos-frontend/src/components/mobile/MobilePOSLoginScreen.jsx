import { useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    Eye,
    EyeOff,
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
    const scrollContainerRef = useRef(null);
    const usernameInputRef = useRef(null);
    const passwordInputRef = useRef(null);
    const submitBtnRef = useRef(null);

    const [showPassword, setShowPassword] = useState(false);
    const [imeExtraBottomPx, setImeExtraBottomPx] = useState(0);
    const [isCompactKeyboardMode, setIsCompactKeyboardMode] = useState(false);

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

    // Adaptación dinámica al teclado virtual (VisualViewport API para Android WebView / iOS / Chrome Mobile)
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const vv = window.visualViewport;
        let baselineHeight = window.innerHeight || 0;

        const handleViewportResize = () => {
            const innerH = window.innerHeight || 0;
            if (innerH > baselineHeight) baselineHeight = innerH;
            const visibleH = vv ? vv.height : innerH;
            const offsetTop = vv ? vv.offsetTop : 0;
            // Si el contenedor nativo no redujo innerHeight (ej. Edge-to-Edge), compensar el alto oculto del teclado
            const occludedBottom = Math.max(0, Math.round(innerH - visibleH - offsetTop));
            const keyboardLikelyOpen = occludedBottom > 90 || (baselineHeight - visibleH > 120) || visibleH < 520;

            setImeExtraBottomPx(occludedBottom);
            setIsCompactKeyboardMode(keyboardLikelyOpen);
        };

        handleViewportResize();
        window.addEventListener('resize', handleViewportResize);
        vv?.addEventListener('resize', handleViewportResize);
        vv?.addEventListener('scroll', handleViewportResize);

        return () => {
            window.removeEventListener('resize', handleViewportResize);
            vv?.removeEventListener('resize', handleViewportResize);
            vv?.removeEventListener('scroll', handleViewportResize);
        };
    }, []);

    const scrollFieldIntoComfortView = (targetEl) => {
        if (!targetEl) return;
        setTimeout(() => {
            try {
                targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } catch {
                targetEl.scrollIntoView();
            }
        }, 120);
    };

    const focusPasswordField = () => {
        const pwdEl = passwordInputRef.current;
        if (!pwdEl) return;
        pwdEl.focus();
        scrollFieldIntoComfortView(submitBtnRef.current || pwdEl);
    };

    const handleUsernameKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === 'Next' || e.keyCode === 13) {
            e.preventDefault();
            e.stopPropagation();
            focusPasswordField();
        }
    };

    const handleFormSubmit = (e) => {
        // Si el teclado móvil dispara submit estando en Usuario o con la clave aún vacía, avanzar a Contraseña
        const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
        if (activeEl === usernameInputRef.current || (String(loginUsername || '').trim() && !String(loginPassword || '').trim())) {
            e.preventDefault();
            focusPasswordField();
            return;
        }
        if (!String(loginUsername || '').trim()) {
            e.preventDefault();
            usernameInputRef.current?.focus();
            scrollFieldIntoComfortView(usernameInputRef.current);
            return;
        }
        handleMobileLogin(e);
    };

    const displayServerHost = String(mobileServerIp || '').replace(/^https?:\/\//i, '').trim();

    return (
        <div
            ref={scrollContainerRef}
            className={`flex-1 min-h-0 w-full overflow-y-auto overscroll-contain flex flex-col items-center px-3 sm:px-5 ${T.appBg}`}
            style={{
                paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))',
                paddingBottom: `calc(max(1rem, env(safe-area-inset-bottom, 0px)) + ${imeExtraBottomPx}px)`
            }}
        >
            <div
                className={`w-full max-w-[380px] ${
                    isCompactKeyboardMode ? 'mt-1 mb-4 p-4 space-y-3' : 'my-auto p-5 sm:p-7 space-y-4'
                } ${T.modalCard} rounded-2xl shadow-2xl border ${T.border} transition-all duration-150`}
            >
                <div className="text-center space-y-1.5">
                    <div className={`flex justify-center ${isCompactKeyboardMode ? 'py-0.5' : 'py-1.5 sm:py-2.5'}`}>
                        <IsaacWebLogo
                            isLight={isLight}
                            height={isCompactKeyboardMode ? 'h-10' : 'h-14 sm:h-18'}
                            imgClassName="max-w-[220px] sm:max-w-[280px] drop-shadow-xs"
                            className="justify-center"
                        />
                    </div>
                    <h2 className={`text-xs sm:text-sm font-extrabold truncate px-2 ${T.textPrimary}`}>
                        {businessInfo.name || 'Isaac POS'}
                    </h2>

                    {/* Indicador interactivo de estado de enlace al servidor PC */}
                    <div className="flex flex-col items-center">
                        <button
                            type="button"
                            onClick={() => {
                                setShowServerModal(true);
                                setServerFeedback(null);
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold cursor-pointer transition-all active:scale-95 max-w-full ${
                                serverHealth === true
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                    : serverHealth === false
                                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25 animate-pulse'
                                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            }`}
                            title="Tocar para cambiar la IP del Servidor PC"
                        >
                            <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                    serverHealth === true ? 'bg-emerald-400' : serverHealth === false ? 'bg-rose-500' : 'bg-amber-400 animate-ping'
                                }`}
                            />
                            <span className="truncate">
                                {serverHealth === true
                                    ? (displayServerHost ? `PC Conectada (${displayServerHost})` : 'PC Conectada (LAN)')
                                    : serverHealth === false
                                        ? 'Sin conexión a PC • Configurar'
                                        : 'Verificando enlace...'}
                            </span>
                            <Settings size={12} className="opacity-70 ml-0.5 shrink-0" />
                        </button>
                    </div>
                </div>

                {loginError && (
                    <div className="bg-rose-500/15 border border-rose-500/30 p-2.5 rounded-xl text-rose-500 dark:text-rose-300 text-xs flex items-center gap-2">
                        <AlertCircle size={15} className="shrink-0" />
                        <span className="leading-snug">{loginError}</span>
                    </div>
                )}

                {/* Acceso Ultrarrápido con Huella Dactilar Móvil (Zero-Trust) */}
                {enrolledBioUser && !isCompactKeyboardMode && (
                    <div className="space-y-2.5 pb-0.5">
                        <button
                            type="button"
                            onClick={handleMobileBiometricLogin}
                            disabled={isBioLoggingIn || isLoggingIn}
                            className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-700 hover:from-sky-500 hover:to-indigo-600 active:scale-[0.98] text-white font-extrabold text-xs uppercase tracking-wider shadow-lg flex items-center justify-between cursor-pointer transition-all disabled:opacity-50"
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

                        <div className="relative text-center my-1.5">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-700/40" /></div>
                            <span className={`relative ${T.modalCard} px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400`}>
                                o ingresa tus datos
                            </span>
                        </div>
                    </div>
                )}

                <form onSubmit={handleFormSubmit} className="space-y-3" noValidate>
                    <div>
                        <label htmlFor="mobile_pos_login_user" className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>
                            Usuario / Cajero
                        </label>
                        <div className="relative">
                            <User size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted} pointer-events-none`} />
                            <input
                                ref={usernameInputRef}
                                id="mobile_pos_login_user"
                                type="text"
                                inputMode="text"
                                enterKeyHint="next"
                                autoComplete="username"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                value={loginUsername}
                                onChange={(e) => setLoginUsername(e.target.value)}
                                onKeyDown={handleUsernameKeyDown}
                                onFocus={() => scrollFieldIntoComfortView(usernameInputRef.current)}
                                placeholder="Ingresa tu usuario"
                                className={`w-full min-h-[46px] ${T.inputBg} border rounded-xl pl-9 pr-3 py-2.5 text-base sm:text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow select-text`}
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="mobile_pos_login_pass" className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>
                            Contraseña
                        </label>
                        <div className="relative">
                            <Lock size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted} pointer-events-none`} />
                            <input
                                ref={passwordInputRef}
                                id="mobile_pos_login_pass"
                                type={showPassword ? 'text' : 'password'}
                                enterKeyHint="go"
                                autoComplete="current-password"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                onFocus={() => scrollFieldIntoComfortView(submitBtnRef.current || passwordInputRef.current)}
                                placeholder="••••••••"
                                className={`w-full min-h-[46px] ${T.inputBg} border rounded-xl pl-9 pr-11 py-2.5 text-base sm:text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow select-text`}
                            />
                            <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => setShowPassword((prev) => !prev)}
                                className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center ${T.textMuted} hover:opacity-100 active:scale-95 cursor-pointer`}
                                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <button
                        ref={submitBtnRef}
                        type="submit"
                        disabled={isLoggingIn}
                        className="w-full min-h-[48px] bg-[#0a0d12] hover:bg-[#161c26] active:scale-[0.99] disabled:opacity-50 text-white border border-[#1e242e] font-extrabold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer mt-2"
                    >
                        {isLoggingIn ? (
                            <RefreshCw size={15} className="animate-spin" />
                        ) : (
                            <span>Ingresar a Terminal Móvil</span>
                        )}
                    </button>

                    <div className="pt-0.5 text-center">
                        <button
                            type="button"
                            onClick={() => {
                                setShowServerModal(true);
                                setServerFeedback(null);
                            }}
                            className={`min-h-[38px] px-3 text-[11px] font-bold ${T.textMuted} hover:opacity-100 inline-flex items-center justify-center gap-1.5 mx-auto cursor-pointer`}
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
