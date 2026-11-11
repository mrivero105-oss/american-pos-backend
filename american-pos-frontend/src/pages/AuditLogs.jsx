import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import { 
    Shield, Clock, User, Info, Search, X, 
    AlertCircle, Trash2, Tag, Filter, ChevronRight, 
    ArrowRight, Calendar, Eye
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function AuditLogs() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterAction, setFilterAction] = useState('ALL');
    const [selectedLog, setSelectedLog] = useState(null);

    useEffect(() => {
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/reports/audit-logs');
            setLogs(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching audit logs:', error);
        } finally {
            setLoading(false);
        }
    };

    const actionTypes = useMemo(() => {
        const types = new Set(logs.map(log => log.action));
        return ['ALL', ...Array.from(types)];
    }, [logs]);

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const matchesSearch = 
                (log.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (log.User?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (log.entityId || '').includes(searchTerm);
            
            const matchesAction = filterAction === 'ALL' || log.action === filterAction;
            
            return matchesSearch && matchesAction;
        });
    }, [logs, searchTerm, filterAction]);

    const getActionTheme = (action) => {
        switch (action) {
            case 'PRICE_CHANGE': return { color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/40', icon: <Tag size={13} /> };
            case 'COST_CHANGE': return { color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/40', icon: <AlertCircle size={13} /> };
            case 'DELETE_PRODUCT': return { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/40', icon: <Trash2 size={13} /> };
            case 'VOID_SALE': return { color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800/40', icon: <Shield size={13} /> };
            case 'LOGIN': return { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40', icon: <User size={13} /> };
            default: return { color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700', icon: <Info size={13} /> };
        }
    };

    const getActionLabel = (action) => {
        switch (action) {
            case 'PRICE_CHANGE': return 'Cambio Precio';
            case 'COST_CHANGE': return 'Cambio Costo';
            case 'DELETE_PRODUCT': return 'Eliminación';
            case 'VOID_SALE': return 'Anulación';
            case 'LOGIN': return 'Inicio Sesión';
            default: return action;
        }
    };

    const formatTimestamp = (ts) => {
        try {
            return format(new Date(ts), 'dd MMM, p', { locale: es });
        } catch (_e) {
            return ts;
        }
    };

    return (
        <div className="space-y-5 p-3 sm:p-6 max-w-7xl mx-auto pb-20 pb-safe animate-in fade-in duration-300">
            {/* Header Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800/40 flex items-center justify-center shrink-0">
                        <Shield size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                Registro de Auditoría
                            </h1>
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 text-[11px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Protegido
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Seguridad, trazabilidad y control de eventos del sistema
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 w-full lg:w-auto justify-between lg:justify-end">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        {filteredLogs.length} eventos
                    </span>
                    <button 
                        onClick={fetchLogs}
                        className="px-3 py-1.5 flex items-center justify-center gap-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                        title="Sincronizar Historial"
                    >
                        <Clock size={14} />
                        <span>Sincronizar</span>
                    </button>
                </div>
            </div>

            {/* Filters Row */}
            <div className="bg-white dark:bg-slate-900 rounded-xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-7 relative">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                    <input
                        type="text"
                        placeholder="Buscar en el registro de eventos..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-1.5 min-h-[36px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                    />
                </div>
                
                <div className="md:col-span-5 relative">
                    <Filter className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" size={15} />
                    <select
                        value={filterAction}
                        onChange={(e) => setFilterAction(e.target.value)}
                        className="w-full pl-9 pr-8 py-1.5 min-h-[36px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors appearance-none cursor-pointer"
                    >
                        <option value="ALL">Todas las acciones</option>
                        {actionTypes.filter(t => t !== 'ALL').map(type => (
                            <option key={type} value={type} className="bg-white dark:bg-slate-900">{getActionLabel(type)}</option>
                        ))}
                    </select>
                    <ChevronRight size={14} className="absolute right-3 top-3 pointer-events-none text-slate-400 rotate-90" />
                </div>
            </div>

            {/* Main Table Plate */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                {/* DESKTOP TABLE */}
                <div className="hidden md:block overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
                                <th className="px-4 py-3 text-left">Cronología</th>
                                <th className="px-4 py-3 text-left">Operador</th>
                                <th className="px-4 py-3 text-left">Clasificación</th>
                                <th className="px-4 py-3 text-left">Descripción</th>
                                <th className="px-4 py-3 text-center">Data</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="py-16 text-center text-primary-500 text-xs font-medium">
                                        Cargando registros...
                                    </td>
                                </tr>
                            ) : filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="py-16 text-center text-slate-400 text-xs">
                                        No se encontraron eventos registrados
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => {
                                    const theme = getActionTheme(log.action);
                                    return (
                                        <tr 
                                            key={log.id} 
                                            onClick={() => (log.oldValue || log.newValue) && setSelectedLog(log)}
                                            className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                                                (log.oldValue || log.newValue) ? 'cursor-pointer' : ''
                                            }`}
                                        >
                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">
                                                {formatTimestamp(log.timestamp)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 font-bold text-xs shrink-0">
                                                        {log.User?.name?.charAt(0) || 'S'}
                                                    </div>
                                                    <span className="text-xs font-medium text-slate-900 dark:text-white truncate max-w-[140px]">
                                                        {log.User?.name || 'Sistema'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1.5 border ${theme.bg} ${theme.color}`}>
                                                    {theme.icon}
                                                    {getActionLabel(log.action)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-1 max-w-md">
                                                    {log.description}
                                                </p>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {(log.oldValue || log.newValue) ? (
                                                    <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800/40 hover:bg-primary-100">
                                                        <Eye size={14} />
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* MOBILE CARDS VIEW */}
                <div className="block md:hidden p-3 space-y-2.5">
                    {loading ? (
                        <div className="py-12 text-center text-primary-500 font-medium text-xs">
                            Cargando registros...
                        </div>
                    ) : filteredLogs.length === 0 ? (
                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-6 text-center">
                            <Info size={28} className="text-slate-400 mx-auto mb-2" />
                            <p className="text-xs text-slate-500">No se encontraron eventos</p>
                        </div>
                    ) : (
                        filteredLogs.map((log) => {
                            const theme = getActionTheme(log.action);
                            return (
                                <div 
                                    key={log.id} 
                                    onClick={() => setSelectedLog(log)}
                                    className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2 cursor-pointer transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1.5 border ${theme.bg} ${theme.color}`}>
                                            {theme.icon}
                                            {getActionLabel(log.action)}
                                        </span>
                                        <span className="text-[11px] text-slate-400 font-mono">
                                            {formatTimestamp(log.timestamp)}
                                        </span>
                                    </div>
                                    
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 font-bold text-xs shrink-0">
                                            {log.User?.name?.charAt(0) || 'S'}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="text-xs font-semibold text-slate-900 dark:text-white truncate block">
                                                {log.User?.name || 'Sistema'}
                                            </span>
                                        </div>
                                    </div>

                                    <p className="text-xs text-slate-600 dark:text-slate-300">
                                        {log.description}
                                    </p>

                                    {(log.oldValue || log.newValue) && (
                                        <div className="flex items-center justify-between text-xs text-primary-600 dark:text-primary-400 font-medium pt-1">
                                            <span className="flex items-center gap-1">
                                                <Eye size={12} /> Ver cambio de estado
                                            </span>
                                            <ChevronRight size={13} />
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Detail Modal */}
            <AnimatePresence>
                {selectedLog && (
                <div 
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70"
                    onClick={() => setSelectedLog(null)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 10 }}
                        transition={{ duration: 0.2 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative bg-white dark:bg-slate-900 w-full max-w-xl rounded-xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden pb-safe"
                    >
                        {/* Modal Header */}
                        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border shrink-0 ${getActionTheme(selectedLog.action).bg} ${getActionTheme(selectedLog.action).color}`}>
                                    {getActionTheme(selectedLog.action).icon}
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight truncate">Detalle de Auditoría</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">{getActionLabel(selectedLog.action)}</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setSelectedLog(null)}
                                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-5 space-y-4 overflow-y-auto">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Fecha y Hora</span>
                                    <div className="flex items-center gap-2">
                                        <Calendar size={14} className="text-slate-400 shrink-0" />
                                        <p className="text-xs font-semibold text-slate-900 dark:text-white tabular-nums">
                                            {formatTimestamp(selectedLog.timestamp)}
                                        </p>
                                    </div>
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Operador Responsable</span>
                                    <div className="flex items-center gap-2">
                                        <User size={14} className="text-slate-400 shrink-0" />
                                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                            {selectedLog.User?.name || 'Sistema'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Descripción del Evento</span>
                                <p className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
                                    {selectedLog.description}
                                </p>
                            </div>

                            {(selectedLog.oldValue || selectedLog.newValue) && (
                                <div className="space-y-2">
                                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Diferencial de Estado</span>
                                    <div className="grid grid-cols-1 sm:grid-cols-11 items-center gap-2.5">
                                        <div className="sm:col-span-5 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-900/40">
                                            <span className="text-[10px] font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider block mb-1">Estado Anterior</span>
                                            <p className="font-mono text-xs text-slate-700 dark:text-slate-300 break-all leading-relaxed">
                                                {selectedLog.oldValue || 'VACÍO'}
                                            </p>
                                        </div>

                                        <div className="hidden sm:flex sm:col-span-1 justify-center">
                                            <ArrowRight size={16} className="text-slate-400" />
                                        </div>

                                        <div className="sm:col-span-5 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-900/40">
                                            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block mb-1">Nuevo Estado</span>
                                            <p className="font-mono text-xs text-emerald-800 dark:text-emerald-300 font-semibold break-all leading-relaxed">
                                                {selectedLog.newValue || 'SIN CAMBIOS'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center text-xs text-slate-500 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <span>ID del Activo</span>
                                <span className="font-mono text-slate-600 dark:text-slate-400">{selectedLog.entityId}</span>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end shrink-0">
                            <button
                                onClick={() => setSelectedLog(null)}
                                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-lg font-medium text-xs transition-colors cursor-pointer"
                            >
                                Cerrar
                            </button>
                        </div>
                    </motion.div>
                </div>
                )}
            </AnimatePresence>
        </div>
    );
}
