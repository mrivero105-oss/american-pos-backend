import { useState, useEffect } from 'react';
import { Github, RefreshCw, Download, CheckCircle2, ArrowUpRight, Loader2, GitBranch, ShieldCheck, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function GithubUpdaterSettings() {
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [statusData, setStatusData] = useState(null);
    const [downloadProgress, setDownloadProgress] = useState(null);
    const [updaterEventStatus, setUpdaterEventStatus] = useState('');

    const isDesktop = !!window.electronAPI;
    const mode = statusData?.gitInfo?.isGitWorkspace ? 'git' : (isDesktop ? 'release' : 'git');

    useEffect(() => {
        fetchStatus();

        if (window.electronAPI && typeof window.electronAPI.onUpdaterEvent === 'function') {
            const unsubscribe = window.electronAPI.onUpdaterEvent((data) => {
                if (data.status === 'checking') {
                    setUpdaterEventStatus('Verificando en servidores de GitHub...');
                } else if (data.status === 'available') {
                    setUpdaterEventStatus(`¡Nueva versión detectada (${data.info?.version || 'superior'})!`);
                    toast.success('Nueva versión disponible en GitHub Releases');
                } else if (data.status === 'downloading') {
                    const percent = Math.round(data.progress || 0);
                    setDownloadProgress(percent);
                    setUpdaterEventStatus(`Descargando actualización: ${percent}%`);
                } else if (data.status === 'downloaded') {
                    setDownloadProgress(100);
                    setUpdaterEventStatus('Actualización descargada y lista para instalar');
                    toast.success('Actualización descargada. Listo para reiniciar.');
                } else if (data.status === 'error') {
                    setUpdaterEventStatus(`Error en auto-updater: ${data.error || 'Fallo de red'}`);
                }
            });
            return () => unsubscribe();
        }
    }, []);

    const fetchStatus = async (isManual = false) => {
        setLoading(true);
        try {
            const res = await api.get('/system/updater/status', isManual ? { params: { force: 1 } } : undefined);
            if (res.data?.success) {
                setStatusData(res.data);
            }
        } catch (err) {
            console.warn('Error al obtener estado de actualizaciones GitHub:', err.message);
            if (isManual) {
                toast.error('No se pudo consultar el estado de actualizaciones');
            }
        } finally {
            setLoading(false);
        }
    };


    const handleCheckForUpdates = async () => {
        setChecking(true);
        setUpdaterEventStatus('Verificando en servidores de GitHub...');
        try {
            if (window.electronAPI && typeof window.electronAPI.checkForUpdates === 'function') {
                try {
                    await window.electronAPI.checkForUpdates();
                } catch (e) {
                    console.warn('IPC Check for updates fallback:', e);
                }
            }
            await fetchStatus(true);
            toast.success('Búsqueda de actualizaciones completada');
            setUpdaterEventStatus('');
        } catch (err) {
            console.error('Error checking updates:', err);
            toast.error('Error al comprobar actualizaciones');
            setUpdaterEventStatus('Error al consultar GitHub');
        } finally {
            setChecking(false);
        }
    };

    const handleTriggerUpdate = async () => {
        setTriggering(true);
        try {
            if (mode === 'release' && isDesktop && typeof window.electronAPI.downloadUpdate === 'function') {
                toast.loading('Generando respaldo e iniciando descarga...');
                const res = await window.electronAPI.downloadUpdate(statusData?.latestRelease?.downloadUrl);
                if (res.success) {
                    toast.dismiss();
                    toast.success('Descarga en segundo plano iniciada...');
                } else if (statusData?.latestRelease?.downloadUrl) {
                    toast.dismiss();
                    toast.success('Abriendo instalador directo desde GitHub...');
                    window.open(statusData.latestRelease.downloadUrl, '_blank');
                } else {
                    toast.dismiss();
                    toast.error(res.error || 'No se pudo iniciar la descarga del instalador');
                }
            } else if (mode === 'git') {
                toast.loading('Generando respaldo previo a la sincronización...');
                const res = await api.post('/system/updater/trigger', { mode: 'git' });
                toast.dismiss();
                if (res.data?.success) {
                    if (res.data.preUpdateBackup) {
                        toast.success(`Respaldo previo creado: ${res.data.preUpdateBackup}`, { duration: 5000 });
                    }
                    toast.success('¡Sincronización Git exitosa! Reiniciando servicio...');
                } else {
                    toast.error(res.data?.error || 'Fallo durante git pull');
                }
            } else if (statusData?.latestRelease?.downloadUrl) {
                window.open(statusData.latestRelease.downloadUrl, '_blank');
            } else {
                toast.error('No hay un paquete de instalación o repositorio configurado');
            }
        } catch (err) {
            console.warn('[GithubUpdaterSettings] Error capturado en operación:', err?.message || err);
            toast.dismiss();
            toast.error('Error durante la ejecución de la actualización');
        } finally {
            setTriggering(false);
        }
    };

    const handleInstallDownloaded = async () => {
        if (window.electronAPI && typeof window.electronAPI.installUpdate === 'function') {
            await window.electronAPI.installUpdate();
        } else {
            toast.error('Esta acción está disponible solo en la versión de escritorio');
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs mb-6 space-y-6 transition-all">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 border border-purple-100 dark:border-purple-900/30">
                        <Github size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                Actualizaciones del Sistema
                            </h2>
                            {!loading && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border border-purple-200 dark:border-purple-800/40">
                                    <ShieldCheck size={12} /> Respaldo previo automático
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Descarga e instala mejoras directamente desde GitHub Releases o repositorio oficial
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleCheckForUpdates}
                    disabled={checking || loading}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-medium text-xs shadow-xs flex items-center justify-center gap-2 transition-colors active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                    {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    <span>{checking ? 'Verificando...' : 'Buscar Actualizaciones'}</span>
                </button>
            </div>

            {/* Status Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">Versión en Ejecución</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 block">
                        v{statusData?.currentVersion || '2.0.2'}
                    </span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">Entorno / Plataforma</span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 flex items-center gap-1.5">
                        {window.electronAPI ? (
                            <>
                                <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                                <span>Aplicación de Escritorio (.exe)</span>
                            </>
                        ) : statusData?.gitInfo?.isGitWorkspace ? (
                            <>
                                <GitBranch size={13} className="text-purple-500 shrink-0" />
                                <span>Rama Git ({statusData.gitInfo.branch})</span>
                            </>
                        ) : (
                            <>
                                <Terminal size={13} className="text-blue-500 shrink-0" />
                                <span>Servidor Node {statusData?.nodeVersion || ''}</span>
                            </>
                        )}
                    </span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">Estado de Sincronización</span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 block">
                        {updaterEventStatus || (statusData?.isUpdateAvailable ? 'Nueva versión disponible' : 'Sistema al día')}
                    </span>
                </div>
            </div>

            {/* Barra de progreso de descarga */}
            {downloadProgress !== null && (
                <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-xs font-semibold text-purple-900 dark:text-purple-300">
                        <span>Descargando instalador...</span>
                        <span>{downloadProgress}%</span>
                    </div>
                    <div className="w-full bg-purple-200/60 dark:bg-purple-900/40 rounded-full h-2 overflow-hidden">
                        <div
                            className="bg-purple-600 h-full rounded-full transition-all duration-300"
                            style={{ width: `${downloadProgress}%` }}
                        ></div>
                    </div>
                    {downloadProgress === 100 && (
                        <button
                            type="button"
                            onClick={handleInstallDownloaded}
                            className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-xs transition-colors cursor-pointer"
                        >
                            Reiniciar e Instalar Ahora
                        </button>
                    )}
                </div>
            )}

            {/* Tarjeta de Nueva Versión Disponible */}
            {statusData?.isUpdateAvailable && statusData?.latestRelease && (
                <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                                Actualización disponible: {statusData.latestRelease.tagName}
                            </span>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1.5">
                                {statusData.latestRelease.title}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Publicado el {new Date(statusData.latestRelease.publishedAt || Date.now()).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                            <button
                                type="button"
                                onClick={handleTriggerUpdate}
                                disabled={triggering}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                            >
                                {triggering ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                <span>{mode === 'git' ? 'Descargar Código (Git)' : 'Instalar Actualización'}</span>
                            </button>

                            {statusData.latestRelease.downloadUrl && (
                                <a
                                    href={statusData.latestRelease.downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3.5 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 rounded-xl font-medium text-xs border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                                >
                                    <span>Ver en GitHub</span>
                                    <ArrowUpRight size={13} />
                                </a>
                            )}
                        </div>
                    </div>

                    {statusData.latestRelease.notes && (
                        <div className="space-y-1.5">
                            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Notas de la versión</h4>
                            <div className="whitespace-pre-wrap text-xs bg-white dark:bg-slate-850 p-3 rounded-lg border border-slate-200 dark:border-slate-750 text-slate-700 dark:text-slate-300 max-h-36 overflow-y-auto font-sans leading-relaxed">
                                {statusData.latestRelease.notes}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
