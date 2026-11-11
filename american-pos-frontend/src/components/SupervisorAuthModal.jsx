import { useState, useEffect } from 'react';
import { ShieldCheck, Key, UserCheck } from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/AuthContext';

export default function SupervisorAuthModal({
    isOpen,
    onClose,
    onAuthorized,
    actionType,
    actionLabel = 'autorizar acción',
    referenceId = null
}) {
    const { user: currentUser } = useAuth();
    const [supervisors, setSupervisors] = useState([]);
    const [selectedSupervisor, setSelectedSupervisor] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchSupervisors();
        } else {
            setPin('');
            setSelectedSupervisor('');
        }
    }, [isOpen]);

    const fetchSupervisors = async () => {
        try {
            setFetching(true);
            const { data } = await api.get('/auth/supervisors');
            const list = Array.isArray(data) ? data : [];
            setSupervisors(list);

            // Pre-seleccionar automáticamente al usuario actual si es supervisor/admin
            if (currentUser && list.some(s => String(s.id) === String(currentUser.id))) {
                setSelectedSupervisor(String(currentUser.id));
            } else if (list.length > 0) {
                setSelectedSupervisor(String(list[0].id));
            }
        } catch (_error) {
            toast.error('Error al cargar lista de supervisores');
        } finally {
            setFetching(false);
        }
    };

    const handleAuthorize = async (e) => {
        e.preventDefault();
        if (!selectedSupervisor || !pin) return;

        try {
            setLoading(true);
            // Hashear PIN con SHA-256 antes de enviar por LAN para mitigar packet sniffing (CVE-INT-005)
            const buffer = new TextEncoder().encode(String(pin));
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashedPin = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

            const { data } = await api.post('/auth/supervisor-authorize', {
                supervisorId: selectedSupervisor,
                pin: hashedPin,
                actionType,
                referenceId
            });
            
            toast.success('Acción autorizada correctamente');
            onAuthorized(data); // Pass approval record
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error de autorización');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-md"
            className="p-5 sm:p-8 max-h-[92dvh] overflow-y-auto custom-scrollbar bg-white dark:bg-slate-950 pb-safe"
        >
            <div className="flex flex-col items-center text-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl flex items-center justify-center mb-4 sm:mb-6 shadow-xl">
                    <ShieldCheck size={28} className="sm:w-8 sm:h-8" />
                </div>
                
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Autorización Requerida</h2>
                <p className="text-xs sm:text-sm font-bold text-slate-500 mt-1.5 sm:mt-2 uppercase tracking-widest">
                    Se necesita un supervisor para <span className="text-primary-500">{actionLabel}</span>
                </p>

                <form onSubmit={handleAuthorize} className="w-full mt-6 sm:mt-8 space-y-4 sm:space-y-6">
                    {/* Supervisor Select */}
                    <div className="space-y-1.5 sm:space-y-2 text-left">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Supervisor Responsable</label>
                        <div className="relative">
                            <select
                                value={selectedSupervisor}
                                onChange={(e) => setSelectedSupervisor(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl px-12 py-3.5 sm:py-4 font-black appearance-none focus:border-primary-500 outline-none text-slate-800 dark:text-white text-base sm:text-sm min-h-[48px]"
                                disabled={fetching || loading}
                            >
                                {supervisors.map(s => (
                                    <option key={s.id} value={s.id}>
                                        {s.name || s.username} ({s.role.toUpperCase()})
                                    </option>
                                ))}
                            </select>
                            <UserCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        </div>
                    </div>

                    {/* PIN Input */}
                    <div className="space-y-1.5 sm:space-y-2 text-left">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">PIN de Autorización</label>
                        <div className="relative">
                            <input
                                type="password"
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl px-12 py-3.5 sm:py-4 font-black tracking-[0.5em] text-center text-xl focus:border-primary-500 outline-none text-slate-800 dark:text-white min-h-[48px]"
                                placeholder="****"
                                maxLength={6}
                                required
                                disabled={loading}
                                autoFocus
                            />
                            <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        </div>
                    </div>

                    <div className="flex gap-3 sm:gap-4 pt-3 sm:pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3.5 sm:py-4 min-h-[48px] bg-slate-100 dark:bg-slate-900 text-slate-500 font-black rounded-2xl uppercase tracking-widest text-[11px] hover:bg-slate-200 transition-all active:scale-95 flex items-center justify-center cursor-pointer"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !pin}
                            className="flex-1 py-3.5 sm:py-4 min-h-[48px] bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black rounded-2xl uppercase tracking-widest text-[11px] hover:scale-[1.02] transition-all active:scale-95 shadow-xl disabled:opacity-50 flex items-center justify-center cursor-pointer"
                        >
                            {loading ? 'Validando...' : 'Autorizar'}
                        </button>
                    </div>
                </form>

                <p className="mt-6 sm:mt-8 text-[10px] font-bold text-slate-400 uppercase leading-relaxed max-w-[280px]">
                    Esta acción será registrada permanentemente en el historial de auditoría de seguridad.
                </p>
            </div>
        </BaseModal>
    );
}
