import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, Calendar, Download, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { syncService } from '../services/syncService';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import BaseModal from './BaseModal';

export default function SyncModal({ isOpen, onClose }) {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSync, setLastSync] = useState(null);
    const [status, setStatus] = useState({ type: '', message: '' });
    const [syncStats, setSyncStats] = useState(null);

    useEffect(() => {
        if (isOpen) {
            loadLastSync();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const loadLastSync = async () => {
        const timestamp = await syncService.getLastSync();
        setLastSync(timestamp);
    };

    const handleSync = async () => {
        setIsSyncing(true);
        setStatus({ type: 'info', message: 'Sincronizando datos e imágenes... por favor espera.' });

        try {
            const { results, timestamp } = await syncService.performFullSync({
                onProgress: (prog) => {
                    setStatus({
                        type: 'info',
                        message: prog.message || 'Sincronizando datos e imágenes...',
                        percent: prog.percent
                    });
                }
            });
            setSyncStats(results);
            setLastSync(timestamp);
            setStatus({ type: 'success', message: '¡Sincronización y base de datos local actualizadas con éxito!' });
        } catch (error) {
            console.error('Sync error:', error);
            setStatus({
                type: 'error',
                message: 'Error al sincronizar. Asegúrate de que el servidor esté encendido y tengas conexión.'
            });
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-md"
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-200 dark:border-slate-800"
        >
                        {/* Header */}
                        <div className="bg-gradient-to-r from-indigo-600 to-primary-600 px-8 py-6 text-slate-800 dark:text-white flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <RefreshCw className={`${isSyncing ? 'animate-spin' : ''}`} size={24} />
                                <div>
                                    <h3 className="font-black text-lg uppercase tracking-tighter">Sincronización</h3>
                                    <p className="text-slate-800 dark:text-white/70 text-[10px] font-bold uppercase tracking-widest">Base de Datos Local e Imágenes</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-8 space-y-6">
                            {/* Status Info */}
                            <div className="flex flex-col items-center text-center space-y-2 p-6 bg-slate-50 dark:bg-white/5 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                                <div className="p-3 bg-primary-500/10 rounded-2xl mb-1">
                                    <Calendar size={28} className="text-primary-500" />
                                </div>
                                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Última actualización</span>
                                <p className="text-slate-700 dark:text-slate-200 font-bold">
                                    {lastSync
                                        ? format(new Date(lastSync), "d 'de' MMMM, HH:mm", { locale: es })
                                        : 'Nunca se ha sincronizado'
                                    }
                                </p>
                            </div>

                            {/* Feedback Alert */}
                            <AnimatePresence>
                                {status.message && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className={`p-4 rounded-2xl flex items-start gap-3 text-sm ${status.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' :
                                                status.type === 'error' ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20' :
                                                    'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20'
                                            }`}
                                    >
                                        {status.type === 'success' ? <CheckCircle size={18} className="mt-0.5 flex-shrink-0" /> :
                                            status.type === 'error' ? <AlertCircle size={18} className="mt-0.5 flex-shrink-0" /> :
                                                <RefreshCw size={18} className="mt-0.5 flex-shrink-0 animate-spin" />}
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <p className="font-black text-[11px] uppercase tracking-widest">{status.type === 'success' ? '¡Éxito!' : status.type === 'error' ? 'Error' : 'Procesando'}</p>
                                                {status.percent !== undefined && (
                                                    <span className="font-mono text-xs font-bold">{status.percent}%</span>
                                                )}
                                            </div>
                                            <p className="opacity-90 text-xs mt-0.5">{status.message}</p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Stats */}
                            {syncStats && status.type === 'success' && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                                        <span className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Productos</span>
                                        <span className="text-2xl font-black text-primary-600 dark:text-primary-400">{syncStats.products?.count || 0}</span>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                                        <span className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Imágenes Locales</span>
                                        <span className="text-2xl font-black text-teal-600 dark:text-teal-400">
                                            {(syncStats.images?.cached || 0) + (syncStats.images?.alreadyCached || 0)}
                                        </span>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                                        <span className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Clientes</span>
                                        <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{syncStats.customers?.count || 0}</span>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                                        <span className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Cajeros Offline</span>
                                        <span className="text-2xl font-black text-purple-600 dark:text-purple-400">{syncStats.cashiers?.count || 'Activos'}</span>
                                    </div>
                                </div>
                            )}

                            {/* Sync Button */}
                            <button
                                onClick={handleSync}
                                disabled={isSyncing}
                                className="w-full flex justify-center items-center gap-3 py-4 bg-gradient-to-r from-indigo-600 to-primary-600 hover:from-indigo-700 hover:to-primary-700 text-slate-800 dark:text-white font-black text-[10px] uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-primary-500/20 disabled:opacity-70 active:scale-95 cursor-pointer"
                            >
                                {isSyncing ? (
                                    <>
                                        <RefreshCw className="animate-spin" size={18} />
                                        Descargando Datos e Imágenes...
                                    </>
                                ) : (
                                    <>
                                        <Download size={18} />
                                        Sincronizar y Adoptar BD Local
                                    </>
                                )}
                            </button>

                            <p className="text-[10px] text-center text-slate-500 dark:text-slate-400 leading-relaxed max-w-[280px] mx-auto">
                                Descarga el catálogo completo, clientes, configuración y todas las imágenes a la memoria local de tu dispositivo.
                            </p>
                        </div>
        </BaseModal>
    );
}
