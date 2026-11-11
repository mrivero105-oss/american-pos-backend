import { useState, useEffect } from 'react';
import {
    Database, ShieldCheck as ShieldCheckIcon, Loader2, FileCode,
    Download, RefreshCcw, Trash2, UploadCloud, ChevronDown, ChevronUp,
    ChevronLeft, ChevronRight, HardDrive, Wrench, FolderOpen,
    Cloud, CheckCircle2, Lock, FolderSearch, Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function BackupSettings({ 
    backups = [], generating = false, saving = false, 
    onGenerate, onDownload, onRestore, onDelete, 
    onRestoreManual, onExport, onMaintenance, 
    runningMaintenance = false, onExploreFolder,
    onRefreshBackups
}) {
    const [isSectionOpen, setIsSectionOpen] = useState(true);
    const [isCloudPanelOpen, setIsCloudPanelOpen] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 5;

    // Estado de Carpeta Espejo Cloud
    const [cloudStatus, setCloudStatus] = useState(null);
    const [cloudConfig, setCloudConfig] = useState({
        enabled: true,
        providerId: 'local_c',
        mirrorPath: 'C:\\IsaacPOS_Respaldos',
        autoSyncOnBackup: true,
        encryptMirrorCopies: false,
        maxMirrorCopies: 15
    });
    const [loadingCloud, setLoadingCloud] = useState(false);
    const [savingCloud, setSavingCloud] = useState(false);
    const [syncingCloud, setSyncingCloud] = useState(false);
    const [syncingSingleFile, setSyncingSingleFile] = useState(null);

    const fetchCloudMirrorStatus = async () => {
        try {
            setLoadingCloud(true);
            const res = await api.get('/backup/cloud-mirror/status');
            if (res.data?.config) {
                setCloudStatus(res.data);
                setCloudConfig(res.data.config);
            }
        } catch (err) {
            console.error('Error fetching cloud mirror status:', err);
        } finally {
            setLoadingCloud(false);
        }
    };

    useEffect(() => {
        fetchCloudMirrorStatus();
    }, []);

    const handleSelectProvider = (provider) => {
        if (!provider.detected && provider.id !== 'local_c') {
            toast(
                `No se detectó la aplicación de escritorio de ${provider.name} en esta computadora. Te sugerimos Microsoft OneDrive (que ya está instalado y activo en tu equipo) o instalar ${provider.name}.`,
                { id: 'prov_warn', icon: '⚠️', duration: 5000 }
            );
        } else {
            toast.success(
                `Seleccionado: ${provider.name}. Pulsa "Guardar Destino" para confirmar.`,
                { id: 'prov_warn' }
            );
        }
        setCloudConfig(prev => ({
            ...prev,
            enabled: true,
            providerId: provider.id,
            mirrorPath: provider.suggestedMirrorPath
        }));
    };

    const handleBrowseCloudFolder = async () => {
        try {
            toast.loading('Abriendo selector de carpetas de Windows...', { id: 'browse_cloud' });
            const res = await api.post('/backup/cloud-mirror/browse', {
                initialDir: cloudConfig.mirrorPath
            });
            toast.dismiss('browse_cloud');
            if (res.data && !res.data.canceled && res.data.folderPath) {
                setCloudConfig(prev => ({
                    ...prev,
                    providerId: 'custom',
                    mirrorPath: res.data.folderPath
                }));
                toast.success('Carpeta seleccionada. Pulsa "Guardar Destino" para aplicar.');
            }
        } catch (err) {
            toast.error('No se pudo abrir el selector de carpetas', { id: 'browse_cloud' });
        }
    };

    const handleSaveCloudConfig = async (overridePartial = null) => {
        try {
            setSavingCloud(true);
            const payload = overridePartial ? { ...cloudConfig, ...overridePartial } : cloudConfig;
            const res = await api.put('/backup/cloud-mirror/config', payload);
            if (res.data?.config) {
                setCloudStatus(res.data);
                setCloudConfig(res.data.config);
            }
            toast.success('Carpeta Espejo Cloud configurada correctamente');
            if (typeof onRefreshBackups === 'function') onRefreshBackups();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al guardar la carpeta espejo');
        } finally {
            setSavingCloud(false);
        }
    };

    const handleSyncCloudNow = async (filename = null) => {
        try {
            if (filename) {
                setSyncingSingleFile(filename);
            } else {
                setSyncingCloud(true);
            }
            toast.loading(
                filename ? `Enviando ${filename} a la carpeta Cloud...` : 'Sincronizando bóveda con la carpeta Cloud...',
                { id: 'sync_cloud_now' }
            );
            const res = await api.post('/backup/cloud-mirror/sync-now', filename ? { filename } : {});
            if (res.data?.config) {
                setCloudStatus(res.data);
                setCloudConfig(res.data.config);
            }
            toast.success(res.data?.message || 'Sincronización completada', { id: 'sync_cloud_now' });
            if (typeof onRefreshBackups === 'function') onRefreshBackups();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al sincronizar con la carpeta en nube', { id: 'sync_cloud_now' });
        } finally {
            setSyncingCloud(false);
            setSyncingSingleFile(null);
        }
    };

    const totalItems = Array.isArray(backups) ? backups.length : 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    const startIndex = (safePage - 1) * itemsPerPage;
    const currentBackups = Array.isArray(backups) ? backups.slice(startIndex, startIndex + itemsPerPage) : [];

    const formatBackupDate = (dateVal) => {
        try {
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return String(dateVal || 'N/A');
            return d.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return String(dateVal || 'N/A');
        }
    };

    const providers = cloudStatus?.providers || [];

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs mb-6 transition-all">
            {/* Header Desplegable / Plegable */}
            <div 
                onClick={() => setIsSectionOpen(!isSectionOpen)}
                className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 cursor-pointer select-none group/header"
            >
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-900/30">
                        <Database size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                Respaldos & Bóveda de Datos
                            </h2>
                            <span className="p-1 rounded-lg text-slate-400 group-hover/header:text-emerald-600 dark:group-hover/header:text-emerald-400 transition-colors">
                                {isSectionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Copias de seguridad locales, replicación automática en carpeta Cloud y recuperación de base de datos
                        </p>
                    </div>
                </div>
                
                {/* Botones de Acción */}
                <div 
                    onClick={(e) => e.stopPropagation()}
                    className="flex flex-wrap items-center gap-2 w-full xl:w-auto"
                >
                    <button
                        type="button"
                        onClick={onExport || onGenerate}
                        disabled={generating || saving}
                        className="px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shadow-xs active:scale-98 disabled:opacity-50 cursor-pointer"
                        title="Descargar archivo ZIP con base de datos e imágenes"
                    >
                        {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        <span>Exportar ZIP</span>
                    </button>

                    <button
                        type="button"
                        onClick={onRestoreManual}
                        disabled={generating || saving}
                        className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium text-xs flex items-center gap-1.5 transition-colors active:scale-98 disabled:opacity-50 cursor-pointer"
                        title="Seleccionar un archivo PostgreSQL (.zip, .sql, .json o .enc) para restaurar"
                    >
                        <UploadCloud size={14} className="text-emerald-600 dark:text-emerald-400" />
                        <span>Restaurar Archivo</span>
                    </button>

                    <button
                        type="button"
                        onClick={onGenerate}
                        disabled={generating || saving}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shadow-xs active:scale-98 disabled:opacity-50 cursor-pointer"
                        title="Generar instantánea en la bóveda interna y replicar en carpeta Cloud"
                    >
                        {generating ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheckIcon size={14} />} 
                        <span>Crear Copia</span>
                    </button>

                    {onExploreFolder && (
                        <button
                            type="button"
                            onClick={onExploreFolder}
                            disabled={generating || saving}
                            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium text-xs flex items-center gap-1.5 transition-colors active:scale-98 disabled:opacity-50 cursor-pointer"
                            title="Abre la carpeta espejo activa en el Explorador de Windows"
                        >
                            <FolderOpen size={14} className="text-amber-500" />
                            <span>Abrir Carpeta</span>
                        </button>
                    )}

                    {onMaintenance && (
                        <button
                            type="button"
                            onClick={onMaintenance}
                            disabled={generating || saving || runningMaintenance}
                            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium text-xs flex items-center gap-1.5 transition-colors active:scale-98 disabled:opacity-50 cursor-pointer"
                            title="Reconstruye índices y ejecuta VACUUM ANALYZE en la base de datos"
                        >
                            {runningMaintenance ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />} 
                            <span>Optimizar BD</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Contenido Desplegable */}
            <AnimatePresence initial={false}>
                {isSectionOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden mt-5 space-y-5"
                    >
                        {/* PANEL DE CARPETA ESPEJO EN NUBE (GOOGLE DRIVE / ONEDRIVE / MEGA) */}
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-4">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                                <div className="flex items-start sm:items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800/50 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                                        <Cloud size={18} />
                                    </div>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                                                Sincronización en Nube (Carpeta Espejo Windows)
                                            </h3>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                                                cloudConfig.enabled
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40'
                                                    : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                            }`}>
                                                {cloudConfig.enabled ? 'Replicación Activa' : 'Pausada'}
                                            </span>
                                            {cloudStatus?.mirroredCount > 0 && (
                                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                                    • {cloudStatus.mirroredCount} copias en destino ({((cloudStatus.totalSizeBytes || 0) / 1024 / 1024).toFixed(1)} MB)
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                            Cada respaldo generado al cerrar turno o manualmente se copia automáticamente en tu carpeta local de Google Drive, OneDrive o MEGA para que se suba a internet en segundo plano.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => handleSyncCloudNow(null)}
                                        disabled={syncingCloud || loadingCloud}
                                        className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                        title="Copia inmediatamente los respaldos recientes de la bóveda hacia la carpeta en nube"
                                    >
                                        {syncingCloud ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                                        <span>Sincronizar Ahora</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsCloudPanelOpen(!isCloudPanelOpen)}
                                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                    >
                                        {isCloudPanelOpen ? 'Ocultar Ajustes' : 'Configurar Ruta'}
                                    </button>
                                </div>
                            </div>

                            {isCloudPanelOpen && (
                                <div className="mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-700/60 space-y-4">
                                    {/* Proveedores autodetectados en Windows */}
                                    <div>
                                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                                            1. Clientes de Nube Detectados en este Equipo (Clic para elegir destino)
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {providers.map((prov) => {
                                                const isSelected = cloudConfig.mirrorPath?.toLowerCase() === prov.suggestedMirrorPath?.toLowerCase();
                                                const isAvailable = Boolean(prov.detected || prov.id === 'local_c');
                                                return (
                                                    <button
                                                        key={prov.id}
                                                        type="button"
                                                        onClick={() => handleSelectProvider(prov)}
                                                        className={`px-3 py-2 rounded-lg border text-left transition-all flex items-center gap-2 cursor-pointer ${
                                                            isSelected
                                                                ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-500 text-sky-900 dark:text-sky-200 shadow-2xs ring-1 ring-sky-500/30'
                                                                : isAvailable
                                                                    ? 'bg-white dark:bg-slate-900 border-emerald-200/80 dark:border-emerald-800/40 text-slate-800 dark:text-slate-200 hover:border-emerald-400'
                                                                    : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300'
                                                        }`}
                                                    >
                                                        <div className={`w-2 h-2 rounded-full ${isAvailable ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                                        <div>
                                                            <div className="text-xs font-semibold flex items-center gap-1.5">
                                                                <span>{prov.name}</span>
                                                                {isAvailable && prov.id !== 'local_c' ? (
                                                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-mono font-bold">
                                                                        INSTALADO (LISTO)
                                                                    </span>
                                                                ) : !isAvailable ? (
                                                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                                                                        NO INSTALADO
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            <div className="text-[10px] font-mono text-slate-400 truncate max-w-[210px]">
                                                                {prov.suggestedMirrorPath}
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Ruta de Carpeta Espejo + Botón Examinar + Guardar */}
                                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                                        <div className="lg:col-span-7">
                                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                                2. Ruta de Carpeta Sincronizada (Google Drive / OneDrive / MEGA / Red)
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={cloudConfig.mirrorPath || ''}
                                                    onChange={(e) => setCloudConfig(prev => ({ ...prev, providerId: 'custom', mirrorPath: e.target.value }))}
                                                    placeholder="Ej: G:\Mi unidad\IsaacPOS_Respaldos o C:\Users\TuUsuario\OneDrive\IsaacPOS_Respaldos"
                                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleBrowseCloudFolder}
                                                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1.5 shrink-0 cursor-pointer"
                                                    title="Elegir carpeta en el Explorador de Windows"
                                                >
                                                    <FolderSearch size={14} className="text-sky-600 dark:text-sky-400" />
                                                    <span>Examinar...</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="lg:col-span-3">
                                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                                Límite de Copias en Nube
                                            </label>
                                            <select
                                                value={cloudConfig.maxMirrorCopies || 15}
                                                onChange={(e) => setCloudConfig(prev => ({ ...prev, maxMirrorCopies: Number(e.target.value) }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                                            >
                                                <option value={5}>Últimas 5 copias (Ahorro de espacio)</option>
                                                <option value={10}>Últimas 10 copias</option>
                                                <option value={15}>Últimas 15 copias (Recomendado)</option>
                                                <option value={30}>Últimas 30 copias (Historial extendido)</option>
                                                <option value={60}>Últimas 60 copias</option>
                                            </select>
                                        </div>

                                        <div className="lg:col-span-2">
                                            <button
                                                type="button"
                                                onClick={() => handleSaveCloudConfig()}
                                                disabled={savingCloud}
                                                className="w-full px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                {savingCloud ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                <span>Guardar Destino</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Opciones de automatización y cifrado */}
                                    <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                                        <div className="flex flex-wrap items-center gap-6">
                                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(cloudConfig.autoSyncOnBackup)}
                                                    onChange={(e) => {
                                                        const val = e.target.checked;
                                                        setCloudConfig(prev => ({ ...prev, autoSyncOnBackup: val }));
                                                        handleSaveCloudConfig({ autoSyncOnBackup: val });
                                                    }}
                                                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                                />
                                                <span className="font-medium">Replicar automáticamente cada vez que se cierre turno o se cree una copia</span>
                                            </label>

                                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(cloudConfig.encryptMirrorCopies)}
                                                    onChange={(e) => {
                                                        const val = e.target.checked;
                                                        setCloudConfig(prev => ({ ...prev, encryptMirrorCopies: val }));
                                                        handleSaveCloudConfig({ encryptMirrorCopies: val });
                                                    }}
                                                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <span className="font-medium flex items-center gap-1">
                                                    <Lock size={12} className="text-emerald-600 dark:text-emerald-400" />
                                                    Cifrar copias en nube con AES-256-GCM (.enc)
                                                </span>
                                            </label>
                                        </div>

                                        {cloudConfig.lastSyncAt && (
                                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                                Última réplica: {formatBackupDate(cloudConfig.lastSyncAt)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left min-w-[650px]">
                                    <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <th className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Copia de Seguridad</th>
                                            <th className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Estado Nube</th>
                                            <th className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Fecha y Hora</th>
                                            <th className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Tamaño</th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {currentBackups.length > 0 ? currentBackups.map((b, i) => {
                                            const isZip = b.name.endsWith('.zip');
                                            const extLabel = isZip
                                                ? 'ZIP'
                                                : b.name.endsWith('.json')
                                                    ? 'JSON'
                                                    : b.name.endsWith('.sql')
                                                        ? 'SQL'
                                                        : b.name.endsWith('.enc')
                                                            ? 'AES-256'
                                                            : 'PG';
                                            return (
                                                <tr key={b.name || i} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${
                                                                isZip 
                                                                    ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/40' 
                                                                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                                                            }`}>
                                                                {isZip ? <FileCode size={15} /> : <HardDrive size={15} />}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                                                        {isZip ? 'Copia Integral (BD + Imágenes)' : 'Instantánea del Servidor'}
                                                                    </span>
                                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase shrink-0 ${
                                                                        isZip 
                                                                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/40' 
                                                                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                                                                    }`}>
                                                                        {extLabel}
                                                                    </span>
                                                                </div>
                                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5 max-w-[280px]">
                                                                    {b.name}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {b.inCloudMirror ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border border-sky-200 dark:border-sky-800/40">
                                                                <CheckCircle2 size={12} />
                                                                <span>En Carpeta Cloud</span>
                                                            </span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSyncCloudNow(b.name)}
                                                                disabled={syncingSingleFile === b.name}
                                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-sky-50 text-slate-600 hover:text-sky-700 dark:bg-slate-800 dark:hover:bg-sky-950/50 dark:text-slate-300 dark:hover:text-sky-300 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                                                title="Copiar este respaldo a la carpeta Cloud configurada"
                                                            >
                                                                {syncingSingleFile === b.name ? <Loader2 size={11} className="animate-spin" /> : <Cloud size={11} />}
                                                                <span>Enviar a Cloud</span>
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="text-xs text-slate-600 dark:text-slate-300">
                                                            {formatBackupDate(b.date)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs font-mono font-medium text-slate-600 dark:text-slate-300">
                                                        {((b.size || 0) / 1024 / 1024).toFixed(2)} MB
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <div className="flex justify-end items-center gap-1.5">
                                                            <button 
                                                                type="button"
                                                                onClick={() => onDownload(b.name)} 
                                                                title="Descargar archivo a tu PC"
                                                                className="p-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                                            >
                                                                <Download size={13} />
                                                            </button>
                                                            <button 
                                                                type="button"
                                                                onClick={() => onRestore(b.name)} 
                                                                disabled={saving} 
                                                                title="Restaurar el sistema a este punto"
                                                                className="px-2 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium rounded-lg border border-amber-200 dark:border-amber-800/40 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                                            >
                                                                <RefreshCcw size={11} className={saving ? "animate-spin" : ""} /> 
                                                                <span>Restaurar</span>
                                                            </button>
                                                            <button 
                                                                type="button"
                                                                onClick={() => onDelete(b.name)} 
                                                                disabled={saving} 
                                                                title="Eliminar de la bóveda"
                                                                className="p-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800/40 transition-colors cursor-pointer disabled:opacity-50"
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        }) : (
                                            <tr>
                                                <td colSpan="5" className="px-4 py-8 text-center text-xs text-slate-400">
                                                    No se registran copias de seguridad en la bóveda
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Paginación */}
                            {totalPages > 1 && (
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800">
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                        Mostrando {startIndex + 1} - {Math.min(startIndex + itemsPerPage, totalItems)} de {totalItems} respaldos
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={safePage === 1}
                                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            <ChevronLeft size={13} />
                                            <span>Anterior</span>
                                        </button>
                                        
                                        <div className="flex items-center gap-1 mx-1">
                                            {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                                                <button
                                                    key={pageNum}
                                                    type="button"
                                                    onClick={() => setCurrentPage(pageNum)}
                                                    className={`w-6 h-6 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                                        safePage === pageNum
                                                            ? 'bg-primary-600 text-white shadow-xs'
                                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                    }`}
                                                >
                                                    {pageNum}
                                                </button>
                                            ))}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={safePage === totalPages}
                                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            <span>Siguiente</span>
                                            <ChevronRight size={13} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
