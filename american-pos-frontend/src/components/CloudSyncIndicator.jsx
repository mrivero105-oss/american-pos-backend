import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw, CheckCircle2, ShieldCheck, Wifi, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { syncService } from '../services/syncService';
import { checkServerHealth } from '../services/api';
import { useAuth } from '../hooks/AuthContext';

export default function CloudSyncIndicator({ compact = false }) {
    const { user } = useAuth();
    const canReadCloudStats = Boolean(
        user && (
            ['superadmin', 'admin', 'owner', 'dueño', 'dueno'].includes(String(user.role || '').toLowerCase()) ||
            user.permissions?.canManageSettings === true
        )
    );
    const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
    const [syncData, setSyncData] = useState({
        stats: { PENDING: 0, SYNCED: 0, RETRYING: 0, FAILED: 0 },
        isOnline: true
    });
    const [isHovered, setIsHovered] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const fetchStats = useCallback(async () => {
        try {
            setIsRefreshing(true);
            if (!canReadCloudStats) {
                const isOfflineFlag = localStorage.getItem('isaac_pos_is_offline_mode') === 'true';
                if (isOfflineFlag) {
                    setSyncData({ stats: { PENDING: 0, SYNCED: 0, RETRYING: 0, FAILED: 0 }, isOnline: false, cloudConfigured: false });
                    setIsOnline(false);
                    return;
                }
                const healthy = await checkServerHealth();
                setSyncData({ stats: { PENDING: 0, SYNCED: 0, RETRYING: 0, FAILED: 0 }, isOnline: Boolean(healthy), cloudConfigured: false });
                setIsOnline(Boolean(healthy));
                return;
            }
            const data = await syncService.getCloudSyncStats();
            if (data && data.stats) {
                setSyncData(data);
                if (typeof data.isOnline === 'boolean') {
                    setIsOnline(data.isOnline);
                }
            }
        } catch (_error) {
            // Offline fallback
            setIsOnline(false);
        } finally {
            setTimeout(() => setIsRefreshing(false), 800);
        }
    }, [canReadCloudStats]);

    // Instant Online / Offline reactive listeners
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            fetchStats();
        };
        const handleOffline = () => {
            setIsOnline(false);
        };

        let queueRefreshTimer = null;
        const handleQueueUpdated = () => {
            if (queueRefreshTimer) clearTimeout(queueRefreshTimer);
            queueRefreshTimer = setTimeout(() => {
                queueRefreshTimer = null;
                if (document.visibilityState === 'visible') fetchStats();
            }, 1500);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        window.addEventListener('sync-queue-updated', handleQueueUpdated);

        fetchStats();
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                fetchStats();
            }
        }, 90000); // Polling cada 90s en reposo + refresco reactivo en eventos online/sync-queue-updated

        return () => {
            if (queueRefreshTimer) clearTimeout(queueRefreshTimer);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('sync-queue-updated', handleQueueUpdated);
            clearInterval(interval);
        };
    }, [fetchStats]);

    const handleForceSync = async () => {
        if (navigator.vibrate) try { navigator.vibrate(25); } catch { /* Vibración háptica opcional no soportada */ }
        setIsRefreshing(true);
        try {
            if (syncService.performFullSync) {
                await syncService.performFullSync();
            }
            await fetchStats();
        } catch (caughtErr) { console.warn('[CloudSyncIndicator] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
        setIsRefreshing(false);
    };

    const stats = syncData?.stats || { PENDING: 0, SYNCED: 0, RETRYING: 0, FAILED: 0 };
    const isCloudConfigured = syncData?.cloudConfigured !== false;
    const pendingCount = isCloudConfigured ? ((Number(stats.PENDING) || 0) + (Number(stats.RETRYING) || 0)) : 0;
    const hasFailed = isCloudConfigured && (Number(stats.FAILED) || 0) > 0;
    const isSyncing = pendingCount > 0 && isOnline;

    const effectiveOnline = isOnline && syncData.isOnline !== false;

    return (
        <>
            <div 
                className="relative select-none"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <button
                    type="button"
                    onClick={() => {
                        if (navigator.vibrate) try { navigator.vibrate(20); } catch { /* Vibración háptica opcional no soportada */ }
                        setIsModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-all duration-150 cursor-pointer select-none active:scale-95"
                    aria-label="Estado de red y sincronización"
                >
                    <div className="relative flex items-center justify-center shrink-0">
                        {!effectiveOnline ? (
                            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                        ) : isSyncing ? (
                            <RefreshCw size={12} className="animate-spin text-sky-500" />
                        ) : hasFailed ? (
                            <AlertCircle size={13} className="text-amber-500" />
                        ) : (
                            <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 leading-none">
                        <span className="text-[11.5px] font-bold text-slate-700 dark:text-slate-200">
                            {!effectiveOnline ? (
                                compact ? 'Local' : 'Offline'
                            ) : isSyncing ? (
                                compact ? 'Sinc...' : 'Sincronizando'
                            ) : (
                                compact ? 'Online' : 'En línea'
                            )}
                        </span>
                        {pendingCount > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/50">
                                {pendingCount}
                            </span>
                        )}
                    </div>
                </button>

                {/* Desktop Hover Tooltip (Quick peek) */}
                <AnimatePresence>
                    {isHovered && !isModalOpen && (
                        <motion.div
                            initial={{ opacity: 0, y: 6, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 6, scale: 0.96 }}
                            onClick={() => setIsModalOpen(true)}
                            className="hidden lg:block absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 p-3.5 z-[1000] backdrop-blur-2xl cursor-pointer"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Estado de Conexión
                                </span>
                                <span className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                    effectiveOnline ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                }`}>
                                    {effectiveOnline ? 'Conectado' : 'Autónomo'}
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                                {effectiveOnline 
                                    ? 'Sincronizado en tiempo real con la nube.' 
                                    : 'Sin red externa. Las ventas se guardan localmente en IndexedDB.'}
                            </p>
                            <p className="text-[9px] font-bold text-primary-500 dark:text-primary-400 mt-2 text-right">
                                Clic para abrir panel completo →
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Comprehensive Status Modal / Bottom-Sheet (Mobile & Desktop) */}
            {isModalOpen && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200">
                    <div 
                        className="fixed inset-0" 
                        onClick={() => setIsModalOpen(false)}
                    />
                    
                    <div className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-xl sm:rounded-xl p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl z-10 animate-in slide-in-from-bottom-4 duration-250">
                        {/* Header */}
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2.5">
                                <div className={`p-2 rounded-xl ${effectiveOnline ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>
                                    {effectiveOnline ? <Wifi size={20} /> : <ShieldCheck size={20} />}
                                </div>
                                <div>
                                    <h3 className="font-black text-sm uppercase tracking-wide text-slate-900 dark:text-white">
                                        {effectiveOnline ? 'Sistema En Línea' : 'Modo Autónomo Local'}
                                    </h3>
                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        Isaac POS Sync Engine
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Informative Security Banner */}
                        <div className={`mt-4 p-3.5 rounded-2xl border ${
                            effectiveOnline 
                                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500/20 text-emerald-900 dark:text-emerald-300' 
                                : 'bg-amber-50 dark:bg-amber-950/20 border-amber-500/20 text-amber-900 dark:text-amber-300'
                        }`}>
                            <div className="flex items-start gap-2.5">
                                <ShieldCheck size={18} className="shrink-0 mt-0.5" />
                                <div className="text-xs leading-relaxed">
                                    <strong className="font-black block uppercase text-[10.5px] tracking-wide mb-0.5">
                                        {effectiveOnline ? 'Datos Protegidos & Sincronizados' : 'Tus Ventas Están 100% Seguras'}
                                    </strong>
                                    {effectiveOnline ? (
                                        <span>Cada cobro y movimiento está respaldado en la base de datos principal y en la memoria local.</span>
                                    ) : (
                                        <span>No tienes conexión a internet en este momento, pero puedes seguir cobrando con total normalidad. Todas las ventas se guardan en la memoria interna (IndexedDB) y se subirán solas al recuperar la señal.</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Sync Queue Statistics */}
                        <div className="mt-4 space-y-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block px-1">
                                Estado de la Cola de Datos
                            </span>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
                                    <div className="flex items-center gap-2 mb-1">
                                        <CheckCircle2 size={14} className="text-emerald-500" />
                                        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Sincronizados</span>
                                    </div>
                                    <span className="text-lg font-black font-mono text-slate-900 dark:text-white">
                                        {stats.SYNCED}
                                    </span>
                                </div>

                                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
                                    <div className="flex items-center gap-2 mb-1">
                                        <RefreshCw size={14} className={`text-primary-500 ${isSyncing ? 'animate-spin' : ''}`} />
                                        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Pendientes</span>
                                    </div>
                                    <span className="text-lg font-black font-mono text-primary-600 dark:text-primary-400">
                                        {stats.PENDING}
                                    </span>
                                </div>
                            </div>

                            {stats.FAILED > 0 && (
                                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 rounded-xl border border-rose-500/20 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle size={15} className="text-rose-500" />
                                        <span className="text-xs font-bold text-rose-700 dark:text-rose-300">Reintentos con error</span>
                                    </div>
                                    <span className="text-xs font-black font-mono text-rose-600 dark:text-rose-400">{stats.FAILED}</span>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="mt-5 flex gap-2.5">
                            <button
                                type="button"
                                onClick={handleForceSync}
                                disabled={isRefreshing}
                                className="flex-1 py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20"
                            >
                                <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
                                {isRefreshing ? 'Sincronizando...' : 'Sincronizar Ahora'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="py-3 px-5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
