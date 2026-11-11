import { useState, useEffect } from 'react';
import { 
    Shield, AlertCircle, TrendingDown, Users, 
    ArrowRight, Printer, Search, Filter, 
    CheckCircle2, AlertTriangle, Fingerprint,
    Calendar, User, Clock, DollarSign, Monitor, Activity
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { formatUSD, formatDate, getGlobalSettings, isSingleCurrencyMode } from '../utils/format';
import { useAuth } from '../hooks/AuthContext';
import BaseModal from '../components/BaseModal';

export default function AuditDashboard() {
    const { user } = useAuth();
    const currentUserRole = String(user?.role || '').toLowerCase();
    const isManagerOrAdmin = ['admin', 'superadmin', 'owner', 'dueño', 'gerente', 'administrador'].includes(currentUserRole);

    const [summary, setSummary] = useState(null);
    const [history, setHistory] = useState([]);
    const [activeShifts, setActiveShifts] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [selectedAudit, setSelectedAudit] = useState(null);
    const [page, setPage] = useState(1);

    useEffect(() => {
        fetchAuditData();
    }, [page]);

    const fetchAuditData = async () => {
        try {
            setLoading(true);
            const [summaryRes, historyRes, alertsRes, activeRes] = await Promise.all([
                api.get('/cash/audit-summary'),
                api.get('/cash/audit-history', { params: { page, limit: 10 } }),
                api.get('/cash/alerts'),
                api.get('/cash/active-shifts').catch(() => ({ data: [] }))
            ]);
            setSummary(summaryRes.data);
            setHistory(historyRes.data.items);
            setAlerts(alertsRes.data);
            const getRegisterRank = (item) => {
                const name = (item.registerName || '').toLowerCase();
                const user = (item.userName || item.name || item.username || '').toLowerCase();
                if (name.includes('caja 1') || name === '1' || user.includes('manuel')) return 1;
                if (name.includes('caja 2') || name === '2' || user.includes('carmen')) return 2;
                if (name.includes('caja 3') || name === '3' || user.includes('adrian')) return 3;
                const match = name.match(/\d+/);
                if (match) return 10 + parseInt(match[0], 10);
                return 100;
            };
            const sortedActive = (activeRes.data || []).sort((a, b) => {
                const rA = getRegisterRank(a);
                const rB = getRegisterRank(b);
                if (rA !== rB) return rA - rB;
                return (a.registerName || '').localeCompare(b.registerName || '', undefined, { numeric: true, sensitivity: 'base' });
            });
            setActiveShifts(sortedActive);
        } catch (error) {
            console.error(error);
            toast.error('Error al cargar datos de auditoría');
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadReport = async () => {
        try {
            setDownloading(true);
            const today = new Date().toISOString().split('T')[0];
            const response = await api.get('/cash/audit-daily-report', {
                params: { date: today },
                responseType: 'blob'
            });
            
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Auditoria_${today}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            toast.success('Reporte generado correctamente');
        } catch (error) {
            console.error(error);
            toast.error('Error al generar el reporte PDF');
        } finally {
            setDownloading(false);
        }
    };

    if (loading && !summary) {
        return (
            <div className="flex flex-col items-center justify-center h-96 gap-4">
                <Shield className="animate-pulse text-primary-500" size={48} />
                <p className="text-slate-500 font-black uppercase tracking-widest text-xs">Escaneando Ledger de Auditoría...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 md:p-8 pb-24 sm:pb-20 pb-safe animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div>
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wider text-[11px] mb-1">
                        <Shield size={14} />
                        <span>Fraud Detection Layer</span>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Audit Dashboard</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Monitoreo de integridad financiera y prevención de pérdidas.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2.5 w-full md:w-auto">
                    <button 
                        onClick={handleDownloadReport}
                        disabled={downloading}
                        className="w-full sm:w-auto min-h-[38px] px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-semibold text-xs tracking-wide hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                        {downloading ? 'Generando...' : <><Printer size={15} /> Descargar Reporte Diario</>}
                    </button>
                    
                    <button 
                        onClick={fetchAuditData}
                        className="w-full sm:w-auto min-h-[38px] px-4 py-2 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-xs tracking-wide hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-xs flex items-center justify-center cursor-pointer"
                    >
                        Recargar Análisis
                    </button>
                </div>
            </div>

            {/* Monitoreo de Cajas Activas en Vivo (Multi-Terminal) */}
            <div className="space-y-3">
                <div className="flex justify-between items-center px-1">
                    <h3 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                        <Activity className="text-emerald-500" size={15} /> Monitoreo de Cajas Activas en Vivo
                    </h3>
                    <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40 px-2.5 py-0.5 rounded-full">
                        {activeShifts.length} {activeShifts.length === 1 ? 'Caja Operando' : 'Cajas Operando'}
                    </span>
                </div>

                {activeShifts.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {activeShifts.map(shift => (
                            <div key={shift.id} className="p-5 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/40 rounded-xl shadow-xs flex flex-col justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-200 dark:border-emerald-800/40">
                                                <Monitor size={18} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <h4 className="font-bold text-slate-900 dark:text-white text-sm leading-tight">
                                                        {shift.registerName || `Caja ${shift.registerId}`}
                                                    </h4>
                                                    {isManagerOrAdmin && shift.userName && (
                                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1" title="Usuario responsable">
                                                            <User size={10} />
                                                            <span>{shift.userName}</span>
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                                    ID: {shift.registerId}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="flex items-center gap-1.5 text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/40 px-2 py-0.5 rounded">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> EN VIVO
                                        </span>
                                    </div>

                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg mb-3 space-y-1.5 border border-slate-100 dark:border-slate-800">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium">Cajero:</span>
                                            <span className="font-semibold text-slate-900 dark:text-white">
                                                {isManagerOrAdmin ? shift.userName : '🔒 Protegido (Solo Gerente / Admin)'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium">Apertura:</span>
                                            <span className="font-mono text-slate-700 dark:text-slate-300">{formatDate(shift.openedAt, { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                    <div>
                                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Base Inicial</span>
                                        <span className="text-sm font-semibold text-slate-900 dark:text-white font-mono">{formatUSD(shift.initialAmount)}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Ventas Hoy ({shift.salesCount})</span>
                                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">{formatUSD(shift.totalSalesAmount)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center">
                        <Monitor size={32} className="mx-auto text-slate-400 dark:text-slate-600 mb-2" />
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No hay ninguna caja abierta en operación en este momento.</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Cuando los cajeros abran turno, podrás monitorear sus cobros en vivo desde aquí.</p>
                    </div>
                )}
            </div>

            {/* Alertas Críticas (Timeline) */}
            {alerts.length > 0 && (
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider px-1 flex items-center gap-2">
                        <AlertCircle size={14} /> Alertas de Seguridad Recientes
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {alerts.slice(0, 3).map(alert => (
                            <div key={alert.id} className="p-4 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/40 rounded-xl shadow-xs flex gap-3.5 items-start">
                                <div className={`p-2 rounded-lg shrink-0 ${
                                    alert.severity === 'high' || alert.severity === 'critical' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                                }`}>
                                    <AlertTriangle size={18} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {formatDate(alert.createdAt, { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase border ${
                                            alert.severity === 'high' || alert.severity === 'critical' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/40' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40'
                                        }`}>
                                            {alert.severity}
                                        </span>
                                    </div>
                                    <p className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">{alert.message}</p>
                                    <p className="text-[11px] text-slate-500 mt-1">Cajero: {alert.user?.name || 'Sistema'}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Alertas e Insights */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Insights Automáticos */}
                <div className="lg:col-span-2 space-y-3">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">Insights del Sistema</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {summary?.insights.length > 0 ? summary.insights.map((insight, i) => (
                            <div key={i} className={`p-5 rounded-xl border ${
                                insight.type === 'danger' 
                                ? 'bg-red-50/70 border-red-200 text-red-900 dark:bg-red-950/20 dark:border-red-900/40 dark:text-red-300' 
                                : 'bg-amber-50/70 border-amber-200 text-amber-900 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-300'
                            }`}>
                                <div className="flex items-center gap-2.5 mb-2">
                                    {insight.type === 'danger' ? <AlertCircle size={16} className="text-red-600 dark:text-red-400" /> : <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />}
                                    <span className="font-bold text-xs uppercase tracking-wide">{insight.title}</span>
                                </div>
                                <p className="text-xs leading-relaxed">{insight.message}</p>
                            </div>
                        )) : (
                            <div className="md:col-span-2 bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 p-5 rounded-xl flex items-center gap-4">
                                <div className="p-2.5 bg-emerald-600 text-white rounded-lg shrink-0">
                                    <CheckCircle2 size={24} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-emerald-900 dark:text-emerald-300 text-sm">Sin anomalías críticas</h4>
                                    <p className="text-xs text-emerald-700 dark:text-emerald-400/80 mt-0.5">El sistema no ha detectado patrones de fraude en los últimos cierres.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Resumen Rápido */}
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">Métricas de Control</h3>
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                        <div className="space-y-5">
                            <MetricRow 
                                label="Total Faltantes (USD)" 
                                value={formatUSD(Math.abs(summary?.ranking.reduce((s, r) => s + (Number(r.totalDiffUSD) < 0 ? Number(r.totalDiffUSD) : 0), 0)))}
                                color="text-red-600 dark:text-red-400"
                            />
                            <MetricRow 
                                label="Total Sobrantes (USD)" 
                                value={formatUSD(summary?.ranking.reduce((s, r) => s + (Number(r.totalDiffUSD) > 0 ? Number(r.totalDiffUSD) : 0), 0))}
                                color="text-emerald-600 dark:text-emerald-400"
                            />
                            <MetricRow 
                                label="Cierres Forzados" 
                                value={summary?.alerts.filter(a => a.Shift?.status === 'forced_closed').length}
                                color="text-amber-600 dark:text-amber-400"
                            />
                            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Nivel de Confianza</span>
                                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 font-mono">85%</span>
                                </div>
                                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-indigo-600 dark:bg-indigo-500 w-[85%] rounded-full" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Ranking de Cajeros */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Ranking de Precisión Financiera</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Basado en últimos {summary?.ranking.reduce((s,r) => s + Number(r.totalShifts), 0)} turnos</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {summary?.ranking.map((cashier, i) => (
                        <CashierCard key={i} cashier={cashier} />
                    ))}
                </div>
            </div>

            {/* Historial de Auditoría */}
            <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">Historial de Declaraciones</h3>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                    {/* DESKTOP TABLE */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fecha / Turno</th>
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cajero</th>
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Caja / Terminal</th>
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Estado</th>
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Diferencia USD</th>
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {history.map((audit) => (
                                    <tr key={audit.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        <td className="px-6 py-3.5">
                                            <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                                {formatDate(audit.createdAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">Turno: {audit.shiftId.substring(0, 8)}</p>
                                        </td>
                                        <td className="px-6 py-3.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                                            {audit.userName || 'Usuario'}
                                        </td>
                                        <td className="px-6 py-3.5">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300">
                                                <Monitor size={12} className="text-indigo-500" />
                                                {audit.registerName || `Caja ${audit.registerId || '1'}`}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3.5">
                                            <div className="flex justify-center">
                                                {audit.differenceUSD === 0 && audit.differenceVES === 0 ? (
                                                    <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 px-2.5 py-0.5 rounded text-[11px] font-semibold border border-emerald-200 dark:border-emerald-900/40">Quadre OK</span>
                                                ) : (
                                                    <span className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-2.5 py-0.5 rounded text-[11px] font-semibold border border-red-200 dark:border-red-900/40">Discrepancia</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className={`px-6 py-3.5 text-right text-xs font-bold font-mono tabular-nums ${audit.differenceUSD < 0 ? 'text-red-600 dark:text-red-400' : audit.differenceUSD > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                            {audit.differenceUSD > 0 ? '+' : ''}{formatUSD(audit.differenceUSD)}
                                        </td>
                                        <td className="px-6 py-3.5 text-right">
                                            <button 
                                                onClick={() => setSelectedAudit(audit)}
                                                className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                                title="Ver Detalle"
                                            >
                                                <Search size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* MOBILE CARDS VIEW */}
                    <div className="block md:hidden p-3 space-y-3">
                        {history.map((audit) => (
                            <div key={audit.id} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                            {formatDate(audit.createdAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                        <p className="text-[10px] font-mono text-slate-400">Turno: {audit.shiftId.substring(0, 8)}</p>
                                    </div>
                                    {audit.differenceUSD === 0 && audit.differenceVES === 0 ? (
                                        <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5 rounded text-[10px] font-semibold border border-emerald-200 dark:border-emerald-900/40">Quadre OK</span>
                                    ) : (
                                        <span className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-2 py-0.5 rounded text-[10px] font-semibold border border-red-200 dark:border-red-900/40">Discrepancia</span>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                                    <div>
                                        <span className="text-[10px] text-slate-400 uppercase font-semibold">Cajero</span>
                                        <div className="font-semibold text-slate-800 dark:text-slate-200">{audit.userName || 'Usuario'}</div>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-400 uppercase font-semibold">Terminal</span>
                                        <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                                            <Monitor size={12} className="text-indigo-500" />
                                            {audit.registerName || `Caja ${audit.registerId || '1'}`}
                                        </div>
                                    </div>
                                    <div className="col-span-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                        <span className="text-[10px] text-slate-400 uppercase font-semibold">Diferencia USD</span>
                                        <span className={`text-xs font-bold font-mono tabular-nums ${audit.differenceUSD < 0 ? 'text-red-600 dark:text-red-400' : audit.differenceUSD > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                            {audit.differenceUSD > 0 ? '+' : ''}{formatUSD(audit.differenceUSD)}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedAudit(audit)}
                                    className="w-full min-h-[36px] py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                                >
                                    <Search size={14} /> Ver Detalle de Auditoría
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Audit Detail Modal */}
            <BaseModal
                isOpen={!!selectedAudit}
                onClose={() => setSelectedAudit(null)}
                maxWidth="max-w-2xl"
                className="flex flex-col p-4 sm:p-6"
            >
                {selectedAudit && (
                    <div className="space-y-6">
                        <div className="text-center">
                            <div className="mx-auto w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/40 flex items-center justify-center rounded-lg mb-3">
                                <Fingerprint size={24} />
                            </div>
                            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">Detalle de Auditoría</h2>
                            <p className="text-xs font-mono text-slate-400 mt-0.5">Hash: {selectedAudit.hash.substring(0, 16)}...</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700/60">
                                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Cajero</p>
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{selectedAudit.userName}</p>
                            </div>
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700/60">
                                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Fecha de Cierre</p>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{formatDate(selectedAudit.createdAt)}</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-1">Reconciliación</h4>
                            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 space-y-3">
                                <AuditDetailRow label={isSingleCurrencyMode() ? "Efectivo Contado" : "Efectivo USD"} expected={selectedAudit.expectedCashUSD} declared={selectedAudit.declaredCashUSD} diff={selectedAudit.differenceUSD} prefix="$" />
                                {!isSingleCurrencyMode() && (
                                    <AuditDetailRow label="Efectivo VES" expected={selectedAudit.expectedCashVES} declared={selectedAudit.declaredCashVES} diff={selectedAudit.differenceVES} prefix="Bs" />
                                )}
                                <AuditDetailRow label={isSingleCurrencyMode() ? "Transferencia / Zelle" : "Zelle"} expected={selectedAudit.expectedZelle} declared={selectedAudit.declaredZelle} diff={selectedAudit.declaredZelle - selectedAudit.expectedZelle} prefix="$" />
                                <AuditDetailRow label={isSingleCurrencyMode() ? "Tarjeta / Débito" : "Card / Punto"} expected={selectedAudit.expectedCard} declared={selectedAudit.declaredCard} diff={selectedAudit.declaredCard - selectedAudit.expectedCard} prefix={isSingleCurrencyMode() ? "$" : "Bs"} />
                                {!isSingleCurrencyMode() && selectedAudit.expectedMobile !== undefined && (
                                    <AuditDetailRow label="Pago Móvil" expected={selectedAudit.expectedMobile} declared={selectedAudit.declaredMobile} diff={(selectedAudit.declaredMobile || 0) - (selectedAudit.expectedMobile || 0)} prefix="Bs" />
                                )}
                            </div>
                        </div>

                        {selectedAudit.notes && (
                            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl">
                                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">Notas del Cajero</p>
                                <p className="text-xs font-medium text-amber-900 dark:text-amber-200 italic">"{selectedAudit.notes}"</p>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                            <button className="w-full sm:w-1/2 min-h-[38px] py-2 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs">
                                <Printer size={15} /> Re-imprimir Ticket
                            </button>
                            <button onClick={() => setSelectedAudit(null)} className="w-full sm:w-1/2 min-h-[38px] py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-semibold text-xs shadow-xs hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors flex items-center justify-center cursor-pointer">
                                Cerrar Detalles
                            </button>
                        </div>
                    </div>
                )}
            </BaseModal>
        </div>
    );
}

function MetricRow({ label, value, color }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
            <span className={`text-base font-bold font-mono tabular-nums ${color}`}>{value}</span>
        </div>
    );
}

function CashierCard({ cashier }) {
    const risk = cashier.risk || { level: 'SAFE', score: 0 };
    const isProblematic = risk.level === 'RISK' || risk.level === 'CRITICAL';
    const lossUSD = Number(cashier.totalDiffUSD);

    const riskColors = {
        SAFE: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40',
        WATCHLIST: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40',
        RISK: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/40',
        CRITICAL: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/40'
    };

    return (
        <div className={`relative bg-white dark:bg-slate-900 p-5 rounded-xl border transition-colors ${isProblematic ? 'border-red-200 dark:border-red-900/40' : 'border-slate-200 dark:border-slate-800'} shadow-xs hover:border-slate-300 dark:hover:border-slate-700`}>
            <div className="flex items-center gap-3.5 mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-base shrink-0 ${isProblematic ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'}`}>
                    {cashier.userName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm truncate">{cashier.userName}</h4>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border uppercase ml-1 shrink-0 ${riskColors[risk.level]}`}>
                            {risk.level}
                        </span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-400 mt-0.5 block">{cashier.totalShifts} Turnos Auditados</span>
                </div>
            </div>

            <div className="space-y-2.5">
                <div className="flex justify-between items-end">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Precisión</span>
                    <span className={`text-xs font-bold font-mono ${cashier.purityScore < 80 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{cashier.purityScore}%</span>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${cashier.purityScore < 80 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${cashier.purityScore}%` }} />
                </div>
                <div className="pt-2 flex justify-between items-center border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Balance Neto</span>
                    <span className={`text-xs font-bold font-mono tabular-nums ${lossUSD < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {lossUSD > 0 ? '+' : ''}{formatUSD(lossUSD)}
                    </span>
                </div>
            </div>
        </div>
    );
}

function AuditDetailRow({ label, expected, declared, diff, prefix }) {
    const isMismatch = diff !== 0;
    return (
        <div className="flex justify-between items-center">
            <div>
                <p className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-tight">{label}</p>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Esperado: {prefix} {Number(expected).toFixed(2)}</p>
            </div>
            <div className="text-right">
                <p className="text-sm font-black text-slate-900 dark:text-white tabular-nums">{prefix} {Number(declared).toFixed(2)}</p>
                {isMismatch && (
                    <p className={`text-[10px] font-black ${diff < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {diff > 0 ? '+' : ''}{Number(diff).toFixed(2)}
                    </p>
                )}
            </div>
        </div>
    );
}
