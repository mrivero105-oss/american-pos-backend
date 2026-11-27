import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Key, 
    Copy, 
    RefreshCw, 
    CheckCircle2, 
    Clock, 
    Plus, 
    Monitor, 
    Trash2, 
    Calendar, 
    Search, 
    Check, 
    Cloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import { toast } from 'react-hot-toast';
import ConfirmModal from '../components/ConfirmModal';
import OnlineLicenseControlTab from '../components/OnlineLicenseControlTab';

const Licenses = () => {
    const [activeTab, setActiveTab] = useState('local');
    const [machineId, setMachineId] = useState('');
    const [statusData, setStatusData] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [copiedKey, setCopiedKey] = useState(null);

    // Modal de Confirmación
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
        onConfirm: () => {}
    });
    
    // Form state
    const [targetMid, setTargetMid] = useState('');
    const [durationSelection, setDurationSelection] = useState(365); // 1m, 7, 30, 365, -1, 'custom'
    const [customDays, setCustomDays] = useState('');
    const [lastGeneratedKey, setLastGeneratedKey] = useState('');

    // Filter & Search state
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('ALL'); // 'ALL', 'AVAILABLE', 'VITALICIA', 'EXPIRED'

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [statusRes, historyRes] = await Promise.all([
                api.get('/license/status'),
                api.get('/license/history')
            ]);

            const curMid = statusRes.data.machineId || '';
            setMachineId(curMid);
            setStatusData(statusRes.data);
            setHistory(historyRes.data.history || []);

            if (curMid) {
                setTargetMid((prev) => prev || curMid);
            }
        } catch (error) {
            console.error('Error fetching license data:', error);
            toast.error('Error al sincronizar datos de licencia');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleGenerateKey = async (e) => {
        e.preventDefault();
        const trimmedMid = targetMid.trim();
        if (!trimmedMid) {
            toast.error('Indique el identificador de máquina (HWID)');
            return;
        }

        let actualDays = 365;
        let unit = 'days';

        if (durationSelection === '1m') {
            actualDays = 1;
            unit = 'minutes';
        } else if (durationSelection === -1) {
            actualDays = -1;
        } else if (durationSelection === 'custom') {
            const parsed = parseInt(customDays, 10);
            if (isNaN(parsed) || parsed <= 0) {
                toast.error('Ingrese un número de días válido');
                return;
            }
            actualDays = parsed;
        } else {
            actualDays = parseInt(durationSelection, 10) || 365;
        }

        try {
            setGenerating(true);
            const res = await api.post('/license/generate', {
                machineId: trimmedMid,
                days: actualDays,
                duration: actualDays,
                unit: unit
            });
            
            const newKey = res.data.key;
            setLastGeneratedKey(newKey);
            toast.success('Llave maestra generada con éxito');
            fetchData();
        } catch (error) {
            console.error('Error generating key:', error);
            toast.error(error.response?.data?.error || 'Error al generar la llave');
        } finally {
            setGenerating(false);
        }
    };

    const copyToClipboard = (text, id = 'hwid') => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedKey(id);
        toast.success('Copiado al portapapeles');
        setTimeout(() => setCopiedKey(null), 2000);
    };

    const requestDeleteSingle = (item) => {
        setConfirmModal({
            isOpen: true,
            title: '¿Eliminar licencia del historial?',
            message: `Esta acción removerá el registro para el equipo ${item.machineId}. La llave dejará de figurar en el inventario de licencias.`,
            variant: 'danger',
            confirmText: 'Eliminar registro',
            cancelText: 'Cancelar',
            onConfirm: () => executeDeleteSingle(item.id)
        });
    };

    const executeDeleteSingle = async (id) => {
        try {
            setDeletingId(id);
            await api.delete(`/license/${id}`);
            toast.success('Licencia eliminada');
            fetchData();
        } catch (error) {
            console.error('Error deleting license:', error);
            toast.error(error.response?.data?.error || 'Error al eliminar la licencia');
        } finally {
            setDeletingId(null);
        }
    };

    const requestCleanup = () => {
        setConfirmModal({
            isOpen: true,
            title: '¿Depurar licencias inactivas?',
            message: 'Se eliminarán del historial todas las llaves expiradas o revocadas. Las licencias activas y disponibles se mantendrán intactas.',
            variant: 'danger',
            confirmText: 'Depurar historial',
            cancelText: 'Cancelar',
            onConfirm: executeCleanup
        });
    };

    const executeCleanup = async () => {
        try {
            setGenerating(true);
            const res = await api.delete('/license/cleanup');
            toast.success(res.data.message || 'Depuración completada');
            fetchData();
        } catch (error) {
            console.error('Error cleaning up licenses:', error);
            toast.error(error.response?.data?.error || 'Error al depurar licencias');
        } finally {
            setGenerating(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'Vitalicia / Permanente';
        return new Date(dateStr).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const filteredHistory = useMemo(() => {
        const query = searchTerm.toLowerCase().trim();
        return history.filter(item => {
            const matchesSearch = !query || 
                (item.machineId && item.machineId.toLowerCase().includes(query)) ||
                (item.licenseKey && item.licenseKey.toLowerCase().includes(query)) ||
                (item.meta?.generatedBy && item.meta.generatedBy.toLowerCase().includes(query));

            if (!matchesSearch) return false;

            if (filterStatus === 'AVAILABLE') {
                return item.status === 'generated';
            }
            if (filterStatus === 'VITALICIA') {
                return !item.expiresAt;
            }
            if (filterStatus === 'EXPIRED') {
                return item.status === 'expired' || item.status === 'revoked';
            }
            return true;
        });
    }, [history, searchTerm, filterStatus]);

    const stats = useMemo(() => {
        const total = history.length;
        const available = history.filter(h => h.status === 'generated').length;
        const vitalicia = history.filter(h => !h.expiresAt).length;
        const revokedOrExpired = history.filter(h => h.status === 'revoked' || h.status === 'expired').length;
        return { total, available, vitalicia, revokedOrExpired };
    }, [history]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3">
                    <RefreshCw size={28} className="animate-spin text-primary-600 dark:text-primary-400" />
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Cargando módulo de licencias...
                    </p>
                </div>
            </div>
        );
    }

    const isActivated = Boolean(statusData?.activated);

    return (
        <div className="space-y-6 max-w-[1600px] mx-auto px-1 sm:px-4 animate-in fade-in duration-300">
            {/* 1. Header Principal Estilo Enterprise */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-primary-50 dark:bg-primary-950/60 border border-primary-200/80 dark:border-primary-800/80 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0">
                        <Key size={22} strokeWidth={2.2} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                Gestión de Licencias
                            </h1>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 uppercase tracking-wide">
                                Master
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Control de activaciones, auditoría HWID y generación de claves criptográficas
                        </p>
                    </div>
                </div>

                {/* HWID de la Máquina Actual */}
                <div className="flex items-center justify-between sm:justify-end gap-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Monitor size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                        <div className="min-w-0">
                            <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                HWID del Servidor
                            </span>
                            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 truncate block">
                                {machineId || 'No disponible'}
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => copyToClipboard(machineId, 'main-hwid')}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-700/80 transition-colors cursor-pointer shrink-0"
                        title="Copiar HWID"
                    >
                        {copiedKey === 'main-hwid' ? <Check size={15} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={15} />}
                    </button>
                </div>
            </div>

            {/* Navegación por Pestañas */}
            <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 shadow-xs">
                <button
                    type="button"
                    onClick={() => setActiveTab('local')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                        activeTab === 'local'
                            ? 'bg-primary-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                >
                    <Key size={15} />
                    <span>Licencias Locales (RSA Offline)</span>
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('online')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                        activeTab === 'online'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                >
                    <Cloud size={15} />
                    <span>Control en Línea (Proveedor)</span>
                </button>
            </div>

            {activeTab === 'online' ? (
                <OnlineLicenseControlTab localMachineId={machineId} />
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* COLUMNA IZQUIERDA (5 cols): Estado del Terminal + Formulario Generador */}
                <div className="lg:col-span-5 space-y-6">
                    
                    {/* Tarjeta de Estado Local */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs transition-colors">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide flex items-center gap-2">
                                <Clock size={15} className="text-slate-500 dark:text-slate-400" />
                                Estado Local en esta Máquina
                            </span>
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                                isActivated
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80'
                                    : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80'
                            }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isActivated ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                {isActivated ? 'Activado' : 'Sin Licencia'}
                            </span>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                                <span className="text-slate-500 dark:text-slate-400">Modalidad de Licencia</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {statusData?.isLifetime || !statusData?.expiresAt ? 'Vitalicia / Indefinida' : 'Temporal'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                                <span className="text-slate-500 dark:text-slate-400">Vencimiento</span>
                                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                    {formatDate(statusData?.expiresAt)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between py-1.5">
                                <span className="text-slate-500 dark:text-slate-400">Hardware Vinculado</span>
                                <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate max-w-[200px]" title={machineId}>
                                    {machineId}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Tarjeta Generador de Llaves Maestras */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs transition-colors">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide flex items-center gap-2">
                                <Plus size={15} className="text-primary-600 dark:text-primary-400" />
                                Generador de Llaves Maestras
                            </span>
                        </div>

                        <form onSubmit={handleGenerateKey} className="space-y-4">
                            {/* Input HWID Destino */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        HWID del Terminal Destino
                                    </label>
                                    {machineId && targetMid !== machineId && (
                                        <button
                                            type="button"
                                            onClick={() => setTargetMid(machineId)}
                                            className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                                        >
                                            Usar HWID de este equipo
                                        </button>
                                    )}
                                </div>
                                <div className="relative">
                                    <Monitor size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input 
                                        type="text"
                                        placeholder="TERM-XXXX-XXXX-XXXX"
                                        value={targetMid}
                                        onChange={(e) => setTargetMid(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                        required
                                    />
                                </div>
                            </div>

                            {/* Selector de Duración */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                    Vigencia del Acceso
                                </label>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {[
                                        { label: '1 Min (Prueba)', val: '1m' },
                                        { label: '7 Días', val: 7 },
                                        { label: '30 Días', val: 30 },
                                        { label: '1 Año', val: 365 },
                                        { label: 'Vitalicia', val: -1 },
                                        { label: 'Personalizado', val: 'custom' }
                                    ].map((opt) => {
                                        const isSelected = durationSelection === opt.val;
                                        return (
                                            <button
                                                key={opt.label}
                                                type="button"
                                                onClick={() => setDurationSelection(opt.val)}
                                                className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition-all cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-primary-50 border-primary-500 text-primary-700 dark:bg-primary-950/60 dark:border-primary-500 dark:text-primary-300 font-bold shadow-2xs'
                                                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                {durationSelection === 'custom' && (
                                    <div className="mt-2 relative">
                                        <input 
                                            type="number"
                                            min="1"
                                            value={customDays}
                                            onChange={(e) => setCustomDays(e.target.value)}
                                            placeholder="Ingrese cantidad de días..."
                                            className="w-full pl-3 pr-12 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                                            required
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">
                                            días
                                        </span>
                                    </div>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={generating}
                                className="w-full bg-primary-600 hover:bg-primary-700 active:scale-[0.99] disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl text-xs shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                            >
                                {generating ? (
                                    <>
                                        <RefreshCw size={15} className="animate-spin" />
                                        <span>Generando clave...</span>
                                    </>
                                ) : (
                                    <>
                                        <Key size={15} />
                                        <span>Generar Llave de Activación</span>
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Llave Generada Recientemente */}
                        {lastGeneratedKey && (
                            <div className="mt-4 p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/80 rounded-xl">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                                        <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
                                        Llave generada con éxito
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(lastGeneratedKey, 'last-gen')}
                                        className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1 cursor-pointer"
                                    >
                                        {copiedKey === 'last-gen' ? (
                                            <>
                                                <Check size={12} />
                                                <span>Copiado</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy size={12} />
                                                <span>Copiar</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                                <div className="p-2 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60 rounded-lg">
                                    <p className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all select-all leading-relaxed">
                                        {lastGeneratedKey}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* COLUMNA DERECHA (7 cols): Historial de Licencias */}
                <div className="lg:col-span-7">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden flex flex-col transition-colors">
                        
                        {/* Cabecera del Historial */}
                        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                        Historial de Licencias Generadas
                                    </h2>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Registro de llaves emitidas para terminales y servidores
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={requestCleanup}
                                        className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
                                        title="Eliminar licencias expiradas o revocadas"
                                    >
                                        <Trash2 size={13} />
                                        <span>Limpiar inactivas</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={fetchData}
                                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                        title="Actualizar lista"
                                    >
                                        <RefreshCw size={15} />
                                    </button>
                                </div>
                            </div>

                            {/* Resumen de Métricas */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
                                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                        Total
                                    </span>
                                    <span className="text-base font-bold text-slate-900 dark:text-white">
                                        {stats.total}
                                    </span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60">
                                    <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
                                        Disponibles
                                    </span>
                                    <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                                        {stats.available}
                                    </span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60">
                                    <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider block">
                                        Vitalicias
                                    </span>
                                    <span className="text-base font-bold text-blue-700 dark:text-blue-400">
                                        {stats.vitalicia}
                                    </span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
                                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                        Expiradas
                                    </span>
                                    <span className="text-base font-bold text-slate-700 dark:text-slate-300">
                                        {stats.revokedOrExpired}
                                    </span>
                                </div>
                            </div>

                            {/* Barra de Búsqueda y Pestañas de Filtro */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                                <div className="relative flex-1">
                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input 
                                        type="text"
                                        placeholder="Buscar por HWID, clave o emisor..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition-all"
                                    />
                                </div>

                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200/80 dark:border-slate-700/80 shrink-0 overflow-x-auto">
                                    {[
                                        { id: 'ALL', label: 'Todas' },
                                        { id: 'AVAILABLE', label: 'Disponibles' },
                                        { id: 'VITALICIA', label: 'Vitalicias' },
                                        { id: 'EXPIRED', label: 'Expiradas' }
                                    ].map(f => {
                                        const isActive = filterStatus === f.id;
                                        return (
                                            <button
                                                key={f.id}
                                                type="button"
                                                onClick={() => setFilterStatus(f.id)}
                                                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer whitespace-nowrap ${
                                                    isActive 
                                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-semibold shadow-2xs' 
                                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                                }`}
                                            >
                                                {f.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Lista de Registros */}
                        <div className="p-4 divide-y divide-slate-100 dark:divide-slate-800/80 overflow-y-auto max-h-[580px] custom-scrollbar">
                            {filteredHistory.length > 0 ? (
                                <AnimatePresence>
                                    {filteredHistory.map((item) => {
                                        const isDeleting = deletingId === item.id;
                                        const isVitalicia = !item.expiresAt;

                                        return (
                                            <motion.div
                                                key={item.id}
                                                layout
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                className="py-3.5 first:pt-0 last:pb-0 group"
                                            >
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white tracking-tight">
                                                                {item.machineId}
                                                            </span>

                                                            {/* Estado */}
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                                                item.status === 'revoked'
                                                                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80'
                                                                    : item.status === 'expired'
                                                                        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80'
                                                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80'
                                                            }`}>
                                                                {item.status === 'revoked' ? 'Revocada' : 
                                                                 item.status === 'expired' ? 'Expirada' : 
                                                                 'Disponible'}
                                                            </span>

                                                            {/* Modalidad */}
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                                                isVitalicia 
                                                                    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/80' 
                                                                    : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                            }`}>
                                                                {isVitalicia ? 'Vitalicia' : 'Temporal'}
                                                            </span>
                                                        </div>

                                                        {/* Metadata de fechas */}
                                                        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                            <span className="flex items-center gap-1">
                                                                <Calendar size={12} className="text-slate-400" />
                                                                {new Date(item.createdAt).toLocaleDateString('es-ES')}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <Clock size={12} className="text-slate-400" />
                                                                Expira: {formatDate(item.expiresAt)}
                                                            </span>
                                                            {item.meta?.generatedBy && (
                                                                <span className="text-slate-400 dark:text-slate-500">
                                                                    Por: {item.meta.generatedBy}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Vista previa de Llave */}
                                                        <div className="mt-2 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-200/80 dark:border-slate-750">
                                                            <p className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300 break-all select-all leading-tight">
                                                                {item.licenseKey}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Acciones */}
                                                    <div className="flex items-center gap-1.5 shrink-0 sm:self-center">
                                                        <button 
                                                            type="button"
                                                            onClick={() => copyToClipboard(item.licenseKey, item.id)}
                                                            className="px-2.5 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                                            title="Copiar llave al portapapeles"
                                                        >
                                                            {copiedKey === item.id ? (
                                                                <>
                                                                    <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
                                                                    <span className="text-emerald-600 dark:text-emerald-400">Copiada</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Copy size={13} />
                                                                    <span>Copiar</span>
                                                                </>
                                                            )}
                                                        </button>

                                                        <button 
                                                            type="button"
                                                            onClick={() => requestDeleteSingle(item)}
                                                            disabled={isDeleting}
                                                            className="p-1.5 text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg border border-transparent hover:border-rose-200 dark:hover:border-rose-800/60 transition-colors cursor-pointer disabled:opacity-50"
                                                            title="Eliminar del historial"
                                                        >
                                                            {isDeleting ? (
                                                                <RefreshCw size={14} className="animate-spin" />
                                                            ) : (
                                                                <Trash2 size={14} />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-2">
                                        <Key size={20} />
                                    </div>
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        No hay licencias que coincidan
                                    </p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        {searchTerm ? 'Intente con otro término de búsqueda' : 'Genere una nueva llave desde el panel lateral'}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            )}

            {/* Modal de Confirmación */}
            <ConfirmModal 
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                variant={confirmModal.variant}
                confirmText={confirmModal.confirmText}
                cancelText={confirmModal.cancelText}
            />
        </div>
    );
};

export default Licenses;
