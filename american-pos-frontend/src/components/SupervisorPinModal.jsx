import { useState, useEffect, useRef } from 'react';
import { Shield, X, AlertTriangle, Fingerprint, Eye, EyeOff, Lock, CornerDownLeft } from 'lucide-react';
import api from '../services/api';
import BaseModal from './BaseModal';
import biometricService from '../services/biometricService';
import { useAuth } from '../hooks/AuthContext';

export default function SupervisorPinModal({ isOpen, onClose, onApprove, actionType, referenceId }) {
    const { user: currentUser } = useAuth();
    const [supervisors, setSupervisors] = useState([]);
    const [selectedSupervisor, setSelectedSupervisor] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setPin('');
            setError('');
            setShowPin(false);
            fetchSupervisors();
            // Foco inmediato al campo PIN para teclear al instante con el teclado de la PC
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 100);
        }
    }, [isOpen]);

    // Atajo global de teclado para cerrar con Escape
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const fetchSupervisors = async () => {
        try {
            const res = await api.get('/auth/supervisors');
            const list = res.data || [];
            setSupervisors(list);
            if (currentUser && list.some(s => String(s.id) === String(currentUser.id))) {
                setSelectedSupervisor(String(currentUser.id));
            } else if (list.length > 0) {
                setSelectedSupervisor(String(list[0].id));
            }
        } catch (_e) {
            setError('No se pudieron cargar los supervisores');
        }
    };

    const canUseBiometric = Boolean(
        currentUser &&
        selectedSupervisor &&
        String(currentUser.id) === String(selectedSupervisor) &&
        ['supervisor', 'admin', 'owner', 'superadmin'].includes(String(currentUser.role || '').toLowerCase())
    );

    const handleBiometricAuth = async () => {
        if (!selectedSupervisor) {
            setError('Selecciona un supervisor');
            return;
        }
        setError('');
        const supObj = supervisors.find(s => s.id === selectedSupervisor);
        try {
            setLoading(true);
            const enrolledCred = biometricService.getEnrolledCredential();
            if (!enrolledCred?.biometricToken || String(enrolledCred.userId) !== String(selectedSupervisor)) {
                setError('No hay una huella criptográfica vinculada en este equipo para el supervisor seleccionado. Usa tu PIN.');
                return;
            }

            const bioResult = await biometricService.authenticate({
                supervisorName: supObj?.name || supObj?.username || 'Supervisor'
            });

            if (bioResult.success) {
                const res = await api.post('/auth/supervisor-authorize', { 
                    supervisorId: selectedSupervisor, 
                    isBiometric: true,
                    biometricToken: enrolledCred.biometricToken,
                    actionType: actionType || 'GENERAL_ACTION', 
                    referenceId 
                });
                onApprove(res.data.id);
                onClose();
            }
        } catch (err) {
            setError(err.message || 'Verificación biométrica no completada');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        setError('');
        if (!pin || pin.length < 4) {
            setError('El PIN debe tener entre 4 y 6 dígitos');
            inputRef.current?.focus();
            return;
        }

        try {
            setLoading(true);
            const buffer = new TextEncoder().encode(String(pin));
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashedPin = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

            const res = await api.post('/auth/supervisor-authorize', { 
                supervisorId: selectedSupervisor, 
                pin: hashedPin, 
                actionType: actionType || 'GENERAL_ACTION', 
                referenceId 
            });
            setPin('');
            onApprove(res.data.id);
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'PIN Incorrecto o sin permisos');
            setPin('');
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        } finally {
            setLoading(false);
        }
    };

    const handlePinChange = (e) => {
        // Solo permitir números, máximo 6 dígitos
        const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6);
        setPin(cleaned);
        if (error) setError('');
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-sm"
            className="p-5 sm:p-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-white pb-safe shadow-2xl border border-slate-200 dark:border-slate-800 rounded-xl"
        >
            <div className="flex flex-col items-center mb-5">
                <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mb-2.5">
                    <Shield size={24} className="text-red-500" />
                </div>
                <h3 className="text-base sm:text-lg font-black uppercase tracking-tight text-center">
                    Autorización Requerida
                </h3>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center mt-1 bg-slate-100 dark:bg-white/5 px-2.5 py-1 rounded-md">
                    {actionType}
                </p>
            </div>

            {error && (
                <div className="mb-4 bg-red-500/10 text-red-500 text-[11px] font-bold uppercase tracking-wider p-3 rounded-xl flex items-center gap-2 border border-red-500/20">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Selector de supervisor */}
                <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
                        Supervisor Autorizador
                    </label>
                    <select 
                        value={selectedSupervisor}
                        onChange={(e) => {
                            setSelectedSupervisor(e.target.value);
                            inputRef.current?.focus();
                        }}
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-red-500 font-bold text-sm min-h-[42px] cursor-pointer"
                    >
                        {supervisors.map(s => (
                            <option key={s.id} value={s.id} className="dark:bg-slate-900 text-slate-900 dark:text-white">
                                {s.name || s.username} ({s.role})
                            </option>
                        ))}
                    </select>
                </div>

                {/* Botón de Huella / Rostro Rápido (solo si el supervisor es el titular de la sesión activa) */}
                {canUseBiometric && (
                    <>
                        <button
                            type="button"
                            onClick={handleBiometricAuth}
                            disabled={loading || !selectedSupervisor}
                            className="w-full py-2.5 px-3 min-h-[42px] bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-700 hover:to-rose-700 disabled:bg-slate-400 text-white rounded-xl font-black text-[11px] uppercase tracking-wider transition-all shadow-md shadow-red-500/20 active:scale-98 flex items-center justify-center gap-2 border border-red-400/30 cursor-pointer"
                        >
                            <Fingerprint size={18} className="text-white animate-pulse" />
                            <span>{loading ? 'Verificando Huella...' : 'Autorizar con Huella / Rostro'}</span>
                        </button>

                        <div className="relative flex items-center justify-center my-3">
                            <div className="border-t border-slate-200 dark:border-white/10 w-full"></div>
                            <span className="bg-white dark:bg-slate-900 px-3 text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                                O introduce el PIN con el teclado
                            </span>
                        </div>
                    </>
                )}

                {/* Input de PIN directo con teclado físico */}
                <div>
                    <div className="flex items-center justify-between px-1 mb-1.5">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                            <Lock size={12} /> PIN Numérico (4-6 dígitos)
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                setShowPin(!showPin);
                                inputRef.current?.focus();
                            }}
                            className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-red-500 transition-colors cursor-pointer py-0.5 px-1.5 rounded"
                        >
                            {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                            <span>{showPin ? 'Ocultar' : 'Ver'}</span>
                        </button>
                    </div>

                    <div className="relative">
                        <input
                            ref={inputRef}
                            type={showPin ? "text" : "password"}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            value={pin}
                            onChange={handlePinChange}
                            autoComplete="new-password"
                            placeholder="Introduce tu PIN"
                            className="w-full text-center text-2xl sm:text-3xl tracking-[0.4em] font-black bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-700 focus:border-red-500 dark:focus:border-red-500 rounded-lg py-2.5 min-h-[48px] focus:outline-none transition-colors placeholder:tracking-normal placeholder:text-sm placeholder:font-bold placeholder:text-slate-400"
                        />
                    </div>

                    {/* Indicador visual de dígitos ingresados */}
                    <div className="flex justify-center items-center gap-2 mt-2.5">
                        {[0, 1, 2, 3, 4, 5].map((idx) => {
                            const isFilled = pin.length > idx;
                            const isRequired = idx < 4;
                            return (
                                <div
                                    key={idx}
                                    className={`w-2 h-2 rounded-full transition-colors border ${
                                        isFilled 
                                            ? 'bg-red-500 border-red-500' 
                                            : isRequired 
                                                ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600' 
                                                : 'bg-transparent border-dashed border-slate-300 dark:border-slate-700 opacity-40'
                                    }`}
                                />
                            );
                        })}
                    </div>
                </div>

                {/* Botones de acción */}
                <div className="grid grid-cols-2 gap-2.5 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="h-10 px-3 rounded-lg font-semibold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700"
                    >
                        <X size={15} />
                        <span>Cancelar</span>
                    </button>
                    <button
                        type="submit"
                        disabled={loading || pin.length < 4 || !selectedSupervisor}
                        className={`h-10 px-3 text-white rounded-lg font-semibold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${
                            loading || pin.length < 4 || !selectedSupervisor
                                ? 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-transparent shadow-none'
                                : 'bg-red-600 hover:bg-red-700 shadow-sm'
                        }`}
                    >
                        <span>{loading ? 'Verificando...' : 'Autorizar'}</span>
                        <CornerDownLeft size={14} className="opacity-75" />
                    </button>
                </div>
            </form>
        </BaseModal>
    );
}
