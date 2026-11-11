import { useState, useEffect } from 'react';
import { Shield, Fingerprint, ShieldCheck, CheckCircle2, ChevronRight } from 'lucide-react';
import IdleLockPanel from './IdleLockPanel';
import BiometricEnrollModal from '../BiometricEnrollModal';
import biometricService from '../../services/biometricService';
import { useAuth } from '../../hooks/AuthContext';

export default function SecuritySettings() {
    const { user } = useAuth();
    const [isBioModalOpen, setIsBioModalOpen] = useState(false);
    const [hasBioHardware, setHasBioHardware] = useState(false);
    const [enrolledCred, setEnrolledCred] = useState(null);

    useEffect(() => {
        biometricService.checkSupport().then(supported => {
            setHasBioHardware(supported);
        }).catch(() => setHasBioHardware(false));

        setEnrolledCred(biometricService.getEnrolledCredential());
    }, [isBioModalOpen]);

    const isThisUserEnrolled = enrolledCred && (
        String(enrolledCred.userId) === String(user?.id) ||
        enrolledCred.username?.toLowerCase() === user?.username?.toLowerCase()
    );

    return (
        <div className="space-y-6">
            {/* 1. SECCIÓN DE HUELLA DACTILAR & BIOMETRÍA ZERO-TRUST */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 border border-sky-100 dark:border-sky-900/30">
                            <Fingerprint size={22} />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                Autenticación por Huella Dactilar
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Acceso biométrico seguro y ultrarrápido al inicio de sesión (WebAuthn / Android TEE)
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setIsBioModalOpen(true)}
                        className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                    >
                        <Fingerprint size={15} />
                        <span>{isThisUserEnrolled ? 'Gestionar Huella' : 'Vincular Huella'}</span>
                        <ChevronRight size={14} className="opacity-70" />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#151921] border border-slate-200/80 dark:border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Sensor de Hardware:</span>
                            <span className={`font-bold inline-flex items-center gap-1.5 ${hasBioHardware ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                                <span className={`w-2 h-2 rounded-full ${hasBioHardware ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                                {hasBioHardware ? 'Disponible y compatible' : 'Compatible con WebAuthn / Sensor'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Estado para tu usuario:</span>
                            {isThisUserEnrolled ? (
                                <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <ShieldCheck size={14} />
                                    Huella Vinculada
                                </span>
                            ) : (
                                <span className="font-medium text-slate-400">
                                    Sin vincular en esta estación
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/30 text-xs text-sky-950 dark:text-sky-300 flex items-center justify-between gap-3">
                        <div className="space-y-1">
                            <div className="font-bold text-sky-900 dark:text-sky-200">
                                Inicio de sesión en 1 toque
                            </div>
                            <p className="text-[11px] opacity-80 leading-relaxed">
                                Vincula tu dedo para acceder instantáneamente desde la pantalla de login sin teclear contraseña.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsBioModalOpen(true)}
                            className="sm:hidden shrink-0 px-3 py-1.5 rounded-lg bg-sky-600 text-white font-bold text-xs"
                        >
                            Configurar
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. SECCIÓN DE SEGURIDAD & BLOQUEO POR INACTIVIDAD */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-6">
                <div className="flex items-center gap-3.5 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-100 dark:border-amber-900/30">
                        <Shield size={20} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">
                            Bloqueo de Sesión por Inactividad
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Protección automática contra accesos no autorizados en caja
                        </p>
                    </div>
                </div>

                <IdleLockPanel allowDisable />
            </div>

            {/* Modal de Enrolamiento Biométrico */}
            <BiometricEnrollModal
                isOpen={isBioModalOpen}
                onClose={() => setIsBioModalOpen(false)}
                onEnrolledChange={(cred) => setEnrolledCred(cred)}
            />
        </div>
    );
}
