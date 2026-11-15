import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, Download, Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../hooks/AuthContext';

export default function UpdateAlertBadge() {
    const { user, hasPermission } = useAuth();
    const canCheckUpdates = Boolean(user && hasPermission('canManageSettings'));
    const [updateStatus, setUpdateStatus] = useState(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloaded, setDownloaded] = useState(false);
    const navigate = useNavigate();

    const checkUpdateStatus = async () => {
        if (!canCheckUpdates) return;
        try {
            const { data } = await api.get('/system/updater/status');
            if (data && data.success) {
                setUpdateStatus(data);
            }
        } catch (error) {
            // Silently continue if background check fails
        }
    };

    useEffect(() => {
        if (!canCheckUpdates) {
            setUpdateStatus(null);
            return;
        }
        checkUpdateStatus();
        const interval = setInterval(checkUpdateStatus, 5 * 60 * 1000); // Verificación periódica cada 5 minutos

        let unsubscribe = null;
        if (window.electronAPI && typeof window.electronAPI.onUpdaterEvent === 'function') {
            unsubscribe = window.electronAPI.onUpdaterEvent((data) => {
                if (data.status === 'available') {
                    setUpdateStatus(prev => ({
                        ...prev,
                        isUpdateAvailable: true,
                        latestRelease: data.info || prev?.latestRelease
                    }));
                } else if (data.status === 'downloading') {
                    setDownloading(true);
                    setDownloadProgress(Math.round(data.progress || 0));
                } else if (data.status === 'downloaded') {
                    setDownloading(false);
                    setDownloaded(true);
                    setDownloadProgress(100);
                } else if (data.status === 'error') {
                    setDownloading(false);
                    toast.error('Error al descargar la actualización');
                }
            });
        }

        return () => {
            clearInterval(interval);
            if (unsubscribe && typeof unsubscribe === 'function') unsubscribe();
        };
    }, [canCheckUpdates]);

    if (!canCheckUpdates || !updateStatus || !updateStatus.isUpdateAvailable) {
        return null;
    }

    const handleBadgeClick = async () => {
        if (downloaded) {
            // Install and restart
            if (window.electronAPI && typeof window.electronAPI.installUpdate === 'function') {
                await window.electronAPI.installUpdate();
            }
            return;
        }

        if (downloading) {
            // Just go to settings so they can see more details if they want
            navigate('/settings?tab=system');
            return;
        }

        if (updateStatus?.latestRelease?.tagName === 'Git') {
            navigate('/settings?tab=system');
            return;
        }

        // Trigger download
        const isDesktop = !!window.electronAPI;
        if (isDesktop && typeof window.electronAPI.downloadUpdate === 'function') {
            toast.success('Iniciando descarga en segundo plano...');
            setDownloading(true);
            setDownloadProgress(0);
            try {
                const res = await window.electronAPI.downloadUpdate(updateStatus?.latestRelease?.downloadUrl);
                if (!res.success && updateStatus?.latestRelease?.downloadUrl) {
                    window.open(updateStatus.latestRelease.downloadUrl, '_blank');
                    setDownloading(false);
                } else if (!res.success) {
                    toast.error(res.error || 'Error al iniciar descarga');
                    setDownloading(false);
                }
            } catch (err) {
                toast.error('Error al iniciar la descarga');
                setDownloading(false);
            }
        } else {
            navigate('/settings?tab=system');
        }
    };

    const versionTag = updateStatus.latestRelease?.tagName || updateStatus.latestRelease?.version || updateStatus.latestRelease?.name || 'Nueva Versión';

    if (downloaded) {
        return (
            <div
                onClick={handleBadgeClick}
                title="Actualización descargada. Haz clic para instalar y reiniciar."
                className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3.5 py-1 sm:py-1.5 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-[1.2rem] shadow-lg shadow-emerald-500/30 cursor-pointer hover:scale-105 hover:shadow-emerald-500/50 transition-all duration-300 animate-in fade-in zoom-in group border border-white/20 select-none"
            >
                <CheckCircle2 size={14} className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-100 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] sm:text-[11.5px] font-black tracking-tight uppercase whitespace-nowrap">
                    REINICIAR PARA ACTUALIZAR
                </span>
            </div>
        );
    }

    if (downloading) {
        return (
            <div
                onClick={handleBadgeClick}
                title="Descargando actualización en segundo plano..."
                className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3.5 py-1 sm:py-1.5 bg-slate-800 text-white rounded-[1.2rem] shadow-lg shadow-slate-900/30 cursor-pointer hover:scale-105 hover:bg-slate-700 transition-all duration-300 animate-in fade-in zoom-in group border border-slate-600 select-none relative overflow-hidden"
            >
                {/* Progress Background */}
                <div 
                    className="absolute top-0 left-0 h-full bg-violet-600/50 transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                />
                
                <div className="relative z-10 flex items-center gap-1.5 sm:gap-2">
                    <Loader2 size={14} className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-violet-300 animate-spin" />
                    <span className="text-[10px] sm:text-[11.5px] font-black tracking-tight uppercase whitespace-nowrap">
                        DESCARGANDO {downloadProgress}%
                    </span>
                </div>
            </div>
        );
    }

        <div
            onClick={handleBadgeClick}
            title="Nueva versión de Isaac POS disponible en GitHub. Haz clic para actualizar."
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg border border-slate-700 shadow-xs cursor-pointer active:scale-95 transition-all select-none"
        >
            <Download size={13} className="text-slate-300" />
            <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                {versionTag} <span className="hidden sm:inline font-normal text-slate-400">disponible</span>
            </span>
        </div>
}
