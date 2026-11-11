import { useState, useEffect, useRef, useCallback } from 'react';
import { Lock, Unlock, KeyRound, AlertCircle, RefreshCw, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function InactivityLockModal() {
    const { user, logout } = useAuth();
    const [isLocked, setIsLocked] = useState(false);
    const [pin, setPin] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [shake, setShake] = useState(false);
    const lastActivityRef = useRef(Date.now());
    const inputRef = useRef(null);

    // Configurable timeout: default 10 minutes. If 0 or disabled, doesn't lock.
    const getTimeoutMs = useCallback(() => {
        const saved = localStorage.getItem('pos_inactivity_timeout_mins');
        if (saved !== null && !isNaN(Number(saved))) {
            const mins = Number(saved);
            return mins > 0 ? mins * 60 * 1000 : null; // null means disabled
        }
        return 10 * 60 * 1000; // default 10 minutes
    }, []);

    // Activity tracker
    useEffect(() => {
        if (!user) {
            setIsLocked(false);
            return;
        }

        const handleActivity = () => {
            lastActivityRef.current = Date.now();
        };

        const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
        events.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }));

        const interval = setInterval(() => {
            const timeoutMs = getTimeoutMs();
            if (!timeoutMs) return; // Feature disabled

            if (!isLocked && (Date.now() - lastActivityRef.current) > timeoutMs) {
                setIsLocked(true);
                setPin('');
                setErrorMsg('');
            }
        }, 10000); // Check every 10 seconds

        return () => {
            events.forEach(evt => window.removeEventListener(evt, handleActivity));
            clearInterval(interval);
        };
    }, [user, isLocked, getTimeoutMs]);

    // Auto-focus input when locked
    useEffect(() => {
        if (isLocked) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isLocked]);

    const handleUnlock = async (e) => {
        if (e) e.preventDefault();
        if (!pin.trim()) {
            setErrorMsg('Ingrese su PIN o contraseña');
            return;
        }

        try {
            setVerifying(true);
            setErrorMsg('');

            const { data } = await api.post('/auth/quick-unlock', { pinOrPassword: pin.trim() });
            if (data.success) {
                setIsLocked(false);
                setPin('');
                lastActivityRef.current = Date.now();
                toast.success('Terminal desbloqueado', { icon: '🔓', id: 'unlock-toast' });
            } else {
                triggerShake(data.error || 'PIN incorrecto');
            }
        } catch (err) {
            const msg = err.response?.data?.error || 'PIN o contraseña incorrectos';
            triggerShake(msg);
        } finally {
            setVerifying(false);
        }
    };

    const triggerShake = (msg) => {
        setErrorMsg(msg);
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setPin('');
        inputRef.current?.focus();
    };

    const handleNumpadPress = (digit) => {
        if (pin.length < 12) {
            setPin(prev => prev + digit);
        }
    };

    const handleNumpadDelete = () => {
        setPin(prev => prev.slice(0, -1));
    };

    if (!isLocked || !user) return null;

    const userInitial = (user.name || user.username || 'U')[0].toUpperCase();

    return (
        <div className="fixed inset-0 z-[999999] bg-slate-950/85 flex items-center justify-center p-4 select-none animate-in fade-in duration-300">
            <div className="w-full max-w-sm sm:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6 sm:p-8 flex flex-col items-center text-center relative overflow-hidden animate-in zoom-in-95 duration-200">
                
                {/* Lock Badge */}
                <div className="w-14 h-14 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-4 shadow-sm">
                    <Lock size={28} className="animate-pulse" />
                </div>

                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-bold uppercase tracking-wider mb-3">
                    <ShieldCheck size={12} />
                    <span>Bloqueo de Inactividad</span>
                </div>

                {/* User Info */}
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-full mb-4">
                    <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0">
                        {userInitial}
                    </div>
                    <div className="text-left min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {user.name || user.username}
                        </h3>
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 capitalize">
                            {user.role || 'Cajero'} • Caja Activa
                        </p>
                    </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mb-4">
                    Ingrese su PIN de 4 dígitos o contraseña para reanudar la sesión sin perder las ventas en curso.
                </p>

                {/* Form & PIN Input */}
                <form onSubmit={handleUnlock} className="w-full space-y-3">
                    <div className={`relative ${shake ? 'animate-shake' : ''}`}>
                        <KeyRound size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            ref={inputRef}
                            type="password"
                            inputMode="numeric"
                            value={pin}
                            onChange={e => setPin(e.target.value)}
                            placeholder="PIN o Contraseña"
                            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center text-base font-bold tracking-widest text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-primary-500"
                        />
                    </div>

                    {errorMsg && (
                        <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-rose-500 bg-rose-500/10 border border-rose-500/20 py-1.5 px-3 rounded-lg animate-in fade-in">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>{errorMsg}</span>
                        </div>
                    )}

                    {/* Touchscreen Numpad */}
                    <div className="grid grid-cols-3 gap-2 py-1">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                            <button
                                key={num}
                                type="button"
                                onClick={() => handleNumpadPress(num)}
                                className="h-10 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-base transition-colors cursor-pointer"
                            >
                                {num}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setPin('')}
                            className="h-10 rounded-lg bg-slate-100 hover:bg-rose-500/20 text-rose-500 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                        >
                            C
                        </button>
                        <button
                            type="button"
                            onClick={() => handleNumpadPress(0)}
                            className="h-10 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-base transition-colors cursor-pointer"
                        >
                            0
                        </button>
                        <button
                            type="button"
                            onClick={handleNumpadDelete}
                            className="h-10 rounded-lg bg-slate-100 hover:bg-amber-500/20 text-amber-500 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                        >
                            ⌫
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={verifying || !pin.trim()}
                        className="w-full h-11 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-semibold text-xs uppercase tracking-wider transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {verifying ? (
                            <>
                                <RefreshCw size={16} className="animate-spin" />
                                <span>Verificando...</span>
                            </>
                        ) : (
                            <>
                                <Unlock size={16} />
                                <span>Desbloquear Terminal</span>
                            </>
                        )}
                    </button>
                </form>

                {/* Switch User / Logout Option */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5 w-full">
                    <button
                        type="button"
                        onClick={() => {
                            if (window.confirm('¿Cerrar sesión y cambiar de usuario? Asegúrese de que no haya ventas pendientes en otra caja.')) {
                                logout();
                            }
                        }}
                        className="w-full py-2 flex items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 transition-colors cursor-pointer"
                    >
                        <LogOut size={14} />
                        <span>Cerrar sesión / Cambiar usuario</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
