import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Fingerprint, ShieldCheck, CheckCircle2, Trash2, AlertCircle, X, RefreshCw, Smartphone, Laptop } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import biometricService from '../services/biometricService';

export default function BiometricEnrollModal({ isOpen, onClose, onEnrolledChange }) {
    const { user, registerBiometrics, revokeBiometrics } = useAuth();
    const [enrolledCred, setEnrolledCred] = useState(null);
    const [hasHardware, setHasHardware] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [isNativeMobile, setIsNativeMobile] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setError('');
            setSuccessMsg('');
            setLoading(false);
            return;
        }

        const isMobile = Boolean(window.Capacitor?.isNativePlatform?.()) || /Android|iPhone|iPad/i.test(navigator.userAgent || '');
        setIsNativeMobile(isMobile);

        biometricService.checkSupport().then(supported => {
            setHasHardware(supported);
        }).catch(() => setHasHardware(false));

        setEnrolledCred(biometricService.getEnrolledCredential());
    }, [isOpen]);

    if (!isOpen) return null;

    const handleEnroll = async () => {
        setError('');
        setSuccessMsg('');
        setLoading(true);

        try {
            const defaultName = isNativeMobile ? 'Terminal Móvil Android' : 'Estación POS PC';
            const res = await registerBiometrics(defaultName);
            if (res && res.success) {
                setEnrolledCred(res.credential);
                setSuccessMsg('¡Huella dactilar vinculada exitosamente a tu usuario!');
                onEnrolledChange?.(res.credential);
            } else {
                setError(res?.message || 'No se pudo completar el registro biométrico');
            }
        } catch (err) {
            console.error('Enroll error:', err);
            const serverMsg = err.response?.data?.error || err.response?.data?.message;
            setError(serverMsg || err.message || 'Error durante la lectura de la huella dactilar');
        } finally {
            setLoading(false);
        }
    };

    const handleRevoke = async () => {
        if (!window.confirm('¿Seguro que deseas desvincular la huella dactilar de este dispositivo?')) {
            return;
        }

        setError('');
        setSuccessMsg('');
        setLoading(true);

        try {
            await revokeBiometrics();
            setEnrolledCred(null);
            setSuccessMsg('Huella dactilar desvinculada exitosamente.');
            onEnrolledChange?.(null);
        } catch (err) {
            const serverMsg = err.response?.data?.error || err.response?.data?.message;
            setError(serverMsg || err.message || 'Error al desvincular huella');
        } finally {
            setLoading(false);
        }
    };

    const isThisUserEnrolled = enrolledCred && (
        String(enrolledCred.userId) === String(user?.id) ||
        enrolledCred.username?.toLowerCase() === user?.username?.toLowerCase()
    );

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    transition={{ duration: 0.18 }}
                    className="w-full max-w-md bg-white dark:bg-[#0f1216] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="px-6 py-4 bg-slate-50 dark:bg-[#14181f] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400">
                                <Fingerprint size={22} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                    Seguridad Biométrica
                                </h3>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Acceso instantáneo con Huella Dactilar
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-4">
                        {error && (
                            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span className="leading-relaxed">{error}</span>
                            </div>
                        )}

                        {successMsg && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400 text-xs flex items-start gap-2.5">
                                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                                <span className="leading-relaxed font-semibold">{successMsg}</span>
                            </div>
                        )}

                        {/* Status Card */}
                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#151921] border border-slate-200 dark:border-slate-800/80 space-y-3">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Sensor de Hardware:</span>
                                <span className={`font-bold inline-flex items-center gap-1.5 ${hasHardware ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                                    <span className={`w-2 h-2 rounded-full ${hasHardware ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                                    {hasHardware ? 'Disponible y Compatible' : 'No detectado en navegador'}
                                </span>
                            </div>

                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Usuario actual:</span>
                                <span className="font-bold text-slate-900 dark:text-white">
                                    {user?.name || user?.username} ({user?.role || 'operador'})
                                </span>
                            </div>

                            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Estado de Huella:</span>
                                {isThisUserEnrolled ? (
                                    <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                        <ShieldCheck size={14} />
                                        Registrada en este equipo
                                    </span>
                                ) : enrolledCred ? (
                                    <span className="font-semibold text-amber-500">
                                        Asignada a otro operador ({enrolledCred.username})
                                    </span>
                                ) : (
                                    <span className="font-medium text-slate-400">
                                        Sin huella registrada
                                    </span>
                                )}
                            </div>

                            {enrolledCred?.enrolledAt && (
                                <div className="text-[10px] text-slate-400 text-right">
                                    Registrado el: {new Date(enrolledCred.enrolledAt).toLocaleDateString()} a las {new Date(enrolledCred.enrolledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            )}
                        </div>

                        {/* Security notice */}
                        <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50 text-[11.5px] text-sky-900 dark:text-sky-300 leading-relaxed space-y-1">
                            <div className="font-bold flex items-center gap-1.5">
                                <ShieldCheck size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
                                <span>Privacidad y Protección Zero-Trust</span>
                            </div>
                            <p className="text-[11px] opacity-90">
                                Tu huella física jamás sale del chip de seguridad de este equipo. El sistema utiliza criptografía de hardware para autenticarte sin enviar datos biométricos a la red.
                            </p>
                        </div>

                        {/* Action buttons */}
                        <div className="pt-2 space-y-2.5">
                            <button
                                type="button"
                                onClick={handleEnroll}
                                disabled={loading}
                                className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white font-bold text-xs uppercase tracking-wider shadow-md hover:shadow-sky-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {loading ? (
                                    <>
                                        <RefreshCw size={15} className="animate-spin" />
                                        <span>Coloca tu huella en el sensor...</span>
                                    </>
                                ) : (
                                    <>
                                        <Fingerprint size={16} />
                                        <span>{isThisUserEnrolled ? 'Actualizar mi Huella Dactilar' : 'Vincular mi Huella a este Equipo'}</span>
                                    </>
                                )}
                            </button>

                            {enrolledCred && (
                                <button
                                    type="button"
                                    onClick={handleRevoke}
                                    disabled={loading}
                                    className="w-full py-2.5 px-4 rounded-xl border border-rose-300 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                >
                                    <Trash2 size={14} />
                                    <span>Desvincular Huella de esta Estación</span>
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
