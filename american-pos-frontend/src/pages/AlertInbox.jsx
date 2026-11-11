import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useSettings } from '../context/SettingsContext';
import { ShieldAlert, AlertTriangle, CheckCircle2, Clock, User, MessageSquare, ChevronRight } from 'lucide-react';
import api from '../utils/api';
import BaseModal from '../components/common/BaseModal';
import { formatDate } from '../utils/format';

export default function AlertInbox() {
    const { socket } = useSocket();
    const { settings } = useSettings();
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState({ status: 'OPEN' });
    const [selectedAlert, setSelectedAlert] = useState(null);
    const [resolutionNotes, setResolutionNotes] = useState('');
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        fetchAlerts();

        if (socket) {
            socket.on('audit:new_alert', handleNewAlert);
            return () => socket.off('audit:new_alert', handleNewAlert);
        }
    }, [filter, socket]);

    const fetchAlerts = async () => {
        try {
            setLoading(true);
            const res = await api.get('/audit/alerts', { params: filter });
            setAlerts(res.data || []);
        } catch (error) {
            console.error('Error fetching alerts:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleNewAlert = (newAlert) => {
        setAlerts(prev => [newAlert, ...prev]);
        if (Notification.permission === 'granted') {
            new Notification('Alerta de Seguridad POS', {
                body: newAlert.message,
                icon: '/icon.png'
            });
        }
    };

    const handleUpdateStatus = async (id, status) => {
        try {
            setUpdating(true);
            await api.put(`/audit/alerts/${id}/resolve`, {
                status,
                resolutionNotes
            });
            fetchAlerts();
            setSelectedAlert(null);
            setResolutionNotes('');
        } catch (error) {
            console.error('Error updating alert status:', error);
        } finally {
            setUpdating(false);
        }
    };

    const severityColors = {
        low: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800/40',
        medium: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/40',
        high: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border-orange-200 dark:border-orange-800/40',
        critical: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800/40'
    };

    const statusBadges = {
        OPEN: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/40',
        IN_REVIEW: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40',
        RESOLVED: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40',
        IGNORED: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
    };

    return (
        <div className="space-y-5 pb-20 pb-safe animate-in fade-in duration-300">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40 flex items-center justify-center shrink-0">
                        <ShieldAlert size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                Centro de Alertas
                            </h1>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {alerts.length}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Incidencias de seguridad, desajustes y excepciones operativas
                        </p>
                    </div>
                </div>

                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 w-full lg:w-auto gap-1">
                    {[
                        { id: 'OPEN', label: 'Pendientes' },
                        { id: 'IN_REVIEW', label: 'En Revisión' },
                        { id: 'RESOLVED', label: 'Resueltas' }
                    ].map(s => (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => setFilter({ ...filter, status: s.id })}
                            className={`flex-1 lg:flex-none px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-center ${
                                filter.status === s.id 
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-xs' 
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs min-h-[400px] flex flex-col">
                {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
                        <ShieldAlert className="animate-pulse text-primary-500" size={36} />
                        <p className="text-xs font-medium">Escaneando incidencias...</p>
                    </div>
                ) : alerts.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-center px-6">
                        <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center rounded-lg border border-emerald-200 dark:border-emerald-800/40">
                            <CheckCircle2 size={24} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Sin alertas pendientes</h3>
                            <p className="text-xs text-slate-500 mt-1">Todas las operaciones se encuentran dentro de los parámetros normales.</p>
                        </div>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {alerts.map((alert) => (
                            <div 
                                key={alert.id} 
                                onClick={() => setSelectedAlert(alert)}
                                className={`flex items-center gap-3.5 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors ${
                                    !alert.isRead ? 'bg-primary-50/20 dark:bg-primary-950/10' : ''
                                }`}
                            >
                                <div className={`p-2.5 rounded-lg flex-shrink-0 ${
                                    alert.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40' :
                                    alert.severity === 'high' ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/40' :
                                    'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40'
                                }`}>
                                    {alert.type === 'mismatch' ? <AlertTriangle size={18} /> : <ShieldAlert size={18} />}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${statusBadges[alert.status]}`}>
                                            {alert.status}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                            {formatDate(alert.createdAt, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                                        </span>
                                    </div>
                                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{alert.message}</h4>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                                        <div className="flex items-center gap-1">
                                            <User size={12} className="text-slate-400" />
                                            <span>{alert.user?.name || 'Sistema'}</span>
                                        </div>
                                        {alert.metadata?.shiftId && (
                                            <div className="flex items-center gap-1 text-slate-400">
                                                <Clock size={12} />
                                                <span>Turno: #{alert.metadata.shiftId.substring(0, 8)}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                    <div className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${severityColors[alert.severity]}`}>
                                        {alert.severity}
                                    </div>
                                    <ChevronRight className="text-slate-400" size={16} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Alert Detail Modal */}
            <BaseModal
                isOpen={!!selectedAlert}
                onClose={() => setSelectedAlert(null)}
                maxWidth="max-w-xl"
                className="p-5 sm:p-6 max-h-[92dvh] overflow-y-auto pb-safe"
            >
                {selectedAlert && (
                    <div className="space-y-5">
                        <div className="flex justify-between items-start">
                            <div className={`p-2.5 rounded-lg ${
                                selectedAlert.severity === 'critical' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-amber-50 text-amber-600 border border-amber-200'
                            }`}>
                                <ShieldAlert size={22} />
                            </div>
                            <div className="text-right">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${statusBadges[selectedAlert.status]}`}>
                                    {selectedAlert.status}
                                </span>
                                <p className="text-[11px] text-slate-400 mt-1">{formatDate(selectedAlert.createdAt)}</p>
                            </div>
                        </div>

                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">{selectedAlert.message}</h2>
                            <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                                Incidencia registrada durante la operación. Requiere revisión por parte del personal administrativo.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                                <p className="text-xs text-slate-400 mb-0.5">Cajero Involucrado</p>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedAlert.user?.name || 'Desconocido'}</p>
                            </div>
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                                <p className="text-xs text-slate-400 mb-0.5">Severidad</p>
                                <p className={`text-sm font-semibold uppercase ${
                                    selectedAlert.severity === 'critical' ? 'text-red-600' : 'text-amber-600'
                                }`}>{selectedAlert.severity}</p>
                            </div>
                        </div>

                        {selectedAlert.status !== 'RESOLVED' && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <MessageSquare size={13} /> Notas de Resolución
                                </label>
                                <textarea
                                    value={resolutionNotes}
                                    onChange={(e) => setResolutionNotes(e.target.value)}
                                    className="w-full h-24 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                                    placeholder="Detalla las acciones tomadas para resolver la incidencia..."
                                />
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2.5">
                            {selectedAlert.status === 'OPEN' && (
                                <button 
                                    onClick={() => handleUpdateStatus(selectedAlert.id, 'IN_REVIEW')}
                                    className="flex-1 min-h-[36px] py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-xs transition-colors cursor-pointer flex items-center justify-center"
                                >
                                    Marcar en Revisión
                                </button>
                            )}
                            
                            {(selectedAlert.status === 'OPEN' || selectedAlert.status === 'IN_REVIEW') && (
                                <button 
                                    disabled={updating}
                                    onClick={() => handleUpdateStatus(selectedAlert.id, 'RESOLVED')}
                                    className="flex-1 min-h-[36px] py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-xs transition-colors cursor-pointer flex items-center justify-center"
                                >
                                    {updating ? 'Resolviendo...' : 'Resolver Alerta'}
                                </button>
                            )}

                            {selectedAlert.status === 'RESOLVED' && (
                                <div className="flex-1 p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-center">
                                    <p className="text-emerald-700 dark:text-emerald-400 font-semibold text-xs">Alerta Resuelta</p>
                                    <p className="text-[11px] text-emerald-600/80 mt-0.5">Revisada el {formatDate(selectedAlert.resolvedAt)}</p>
                                </div>
                            )}
                        </div>

                        {selectedAlert.status !== 'RESOLVED' && (
                            <button 
                                onClick={() => handleUpdateStatus(selectedAlert.id, 'IGNORED')}
                                className="w-full py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer text-center"
                            >
                                Ignorar esta alerta
                            </button>
                        )}
                    </div>
                )}
            </BaseModal>
        </div>
    );
}
