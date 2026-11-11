import { useState, useEffect } from 'react';
import { Power, CheckCircle2, Loader2, Monitor } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function StartupSettings() {
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchAutoLaunchState();
    }, []);

    const fetchAutoLaunchState = async () => {
        setLoading(true);
        try {
            if (window.electronAPI && typeof window.electronAPI.getAutoLaunch === 'function') {
                const state = await window.electronAPI.getAutoLaunch();
                setEnabled(!!state);
            } else {
                const res = await api.get('/settings/auto-launch');
                setEnabled(!!res.data?.enabled);
            }
        } catch (err) {
            console.error('Error fetching auto launch state:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (e) => {
        const newValue = e.target.checked;
        setSaving(true);
        try {
            if (window.electronAPI && typeof window.electronAPI.setAutoLaunch === 'function') {
                const res = await window.electronAPI.setAutoLaunch(newValue);
                if (res.success) {
                    setEnabled(newValue);
                    toast.success(newValue 
                        ? 'Inicio automático activado: El POS se abrirá al encender la PC' 
                        : 'Inicio automático desactivado');
                } else {
                    toast.error(res.error || 'No se pudo actualizar el inicio automático');
                }
            } else {
                const res = await api.post('/settings/auto-launch', { enabled: newValue });
                if (res.data?.success) {
                    setEnabled(newValue);
                    toast.success(newValue 
                        ? 'Inicio automático activado: El POS se abrirá al encender la PC' 
                        : 'Inicio automático desactivado');
                } else {
                    toast.error('No se pudo cambiar la configuración de inicio automático');
                }
            }
        } catch (err) {
            console.error('Error toggling auto launch:', err);
            toast.error('Error de conexión al actualizar la configuración de arranque');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs mb-6 transition-all">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/30">
                        <Power size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                Arranque Automático con Windows
                            </h2>
                            {!loading && (
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                    enabled 
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40' 
                                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                                }`}>
                                    {enabled ? 'Habilitado' : 'Deshabilitado'}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Abrir Isaac POS automáticamente apenas se inicie sesión en la computadora
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                    {loading ? (
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
                            <Loader2 size={14} className="animate-spin text-primary-500" />
                            <span>Consultando...</span>
                        </div>
                    ) : (
                        <label className="relative inline-flex items-center cursor-pointer select-none">
                            <input 
                                type="checkbox" 
                                className="sr-only peer" 
                                checked={enabled} 
                                onChange={handleToggle}
                                disabled={saving}
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                            <span className="ml-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                                {saving ? 'Guardando...' : (enabled ? 'Activado' : 'Desactivado')}
                            </span>
                        </label>
                    )}
                </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                    <Monitor size={14} className="text-primary-500 shrink-0" />
                    <span>Recomendado para servidores de caja principal y terminales dedicados.</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                    <span>Registro de inicio de Windows</span>
                </div>
            </div>
        </div>
    );
}
