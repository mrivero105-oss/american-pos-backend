import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
    Shield, ShieldAlert, Monitor, Banknote, DollarSign, 
    ArrowDownToLine, ArrowUpFromLine, AlertTriangle, CheckCircle2, 
    Clock, User, Users, RefreshCw, Printer, Search, 
    Zap, Activity, Eye, FileText, AlertCircle, 
    SlidersHorizontal, TrendingDown, TrendingUp,
    Lock, X, ChevronRight, ShieldCheck, HelpCircle, Layers,
    Edit2
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { formatUSD, formatBs, formatDate, getGlobalSettings, isSingleCurrencyMode } from '../utils/format';
import { useSocket } from '../hooks/SocketContext';
import { useAuth } from '../hooks/AuthContext';
import BaseModal from '../components/BaseModal';

export default function CashierAuditCenter() {
    const { user } = useAuth();
    const currentUserRole = String(user?.role || '').toLowerCase();
    const isManagerOrAdmin = ['admin', 'superadmin', 'owner', 'dueño', 'gerente', 'administrador'].includes(currentUserRole);

    const { socket, isConnected } = useSocket();
    const [activeTab, setActiveTab] = useState('live'); // 'live' | 'cashiers' | 'alerts'
    const [loading, setLoading] = useState(true);
    const [dashboardData, setDashboardData] = useState(null);
    const [liveFeed, setLiveFeed] = useState([]);
    
    // Cashier Audit File State
    const [selectedCashierId, setSelectedCashierId] = useState(null);
    const [cashierAuditFile, setCashierAuditFile] = useState(null);
    const [loadingAuditFile, setLoadingAuditFile] = useState(false);
    const [cashierSearchTerm, setCashierSearchTerm] = useState('');
    const [cashiersList, setCashiersList] = useState([]);

    // Remote X-Ray Modal State
    const [selectedRegisterForXRay, setSelectedRegisterForXRay] = useState(null);

    // Force Close Modal State
    const [forceCloseModal, setForceCloseModal] = useState({ open: false, shift: null, reason: '' });
    const [submittingForceClose, setSubmittingForceClose] = useState(false);

    // Rename Register Modal State
    const [renameModal, setRenameModal] = useState({ open: false, shift: null, name: '' });
    const [savingName, setSavingName] = useState(false);

    // Daily Report State
    const [downloadingReport, setDownloadingReport] = useState(false);

    // Filter for Terminal Grid
    const [registerFilter, setRegisterFilter] = useState('all'); // 'all' | 'active' | 'standby'

    const fetchDashboard = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const { data } = await api.get('/cash/admin/dashboard');
            setDashboardData(data);
            if (data.recentActivity) {
                setLiveFeed(data.recentActivity);
            }
        } catch (error) {
            console.error('Error fetching admin cash dashboard:', error);
            if (!silent) toast.error('Error al cargar torre de control de cajas');
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    const fetchCashiersList = useCallback(async () => {
        try {
            const [usersRes, summaryRes] = await Promise.all([
                api.get('/users').catch(() => ({ data: [] })),
                api.get('/cash/audit-summary').catch(() => ({ data: { ranking: [] } }))
            ]);
            const rawUsers = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.users || [];
            const allUsers = rawUsers.filter(u => String(u.role || '').toLowerCase() !== 'superadmin');
            const ranking = summaryRes.data?.ranking || [];

            // Combinar con métricas de ranking si existen
            const combined = allUsers.map(u => {
                const rankInfo = ranking.find(r => r.userId === u.id);
                return {
                    ...u,
                    totalShifts: rankInfo?.totalShifts || 0,
                    purityScore: rankInfo ? rankInfo.purityScore : 100,
                    totalDiffUSD: rankInfo ? rankInfo.totalDiffUSD : 0,
                    riskLevel: rankInfo?.risk?.level || 'SAFE'
                };
            });
            setCashiersList(combined);
        } catch (error) {
            console.error('Error fetching cashiers list:', error);
        }
    }, []);

    useEffect(() => {
        fetchDashboard();
        fetchCashiersList();
        
        // Auto-refresco de respaldo cada 25 segundos
        const interval = setInterval(() => {
            fetchDashboard(true);
        }, 25000);
        return () => clearInterval(interval);
    }, [fetchDashboard, fetchCashiersList]);

    // Socket.IO Real-Time Listener
    useEffect(() => {
        if (!socket) return;

        const handleRealTimeActivity = (activity) => {
            console.log('[Live Audit Event Received]:', activity);
            
            // Añadir al feed en vivo al principio
            setLiveFeed(prev => {
                const newEntry = {
                    id: `rt-${Date.now()}-${Math.random()}`,
                    eventType: activity.type,
                    timestamp: activity.timestamp || new Date().toISOString(),
                    registerId: activity.registerId || 'Caja',
                    registerName: activity.registerName || `Caja ${activity.registerId || '1'}`,
                    userName: activity.userName || 'Cajero',
                    userId: activity.userId,
                    amount: activity.amount || 0,
                    detail: activity.type === 'sale' 
                        ? `Venta cobrada (${activity.paymentMethod || 'Efectivo'})` 
                        : activity.type === 'movement'
                        ? `${activity.movementType === 'out' ? 'Retiro' : 'Ingreso'}: ${activity.reason || ''}`
                        : activity.type === 'shift_open'
                        ? 'Apertura de turno de caja'
                        : activity.type === 'shift_close'
                        ? 'Cierre de turno de caja'
                        : 'Acción administrativa en caja'
                };
                return [newEntry, ...prev.slice(0, 39)];
            });

            // Notificación flotante suave si es un evento crítico o retiro importante
            if (activity.type === 'movement' && activity.movementType === 'out' && activity.amount >= 50) {
                toast(`Retiro de $${activity.amount} en ${activity.registerName || 'Caja'} (${activity.userName})`, {
                    duration: 4000
                });
            } else if (activity.type === 'shift_force_closed') {
                toast.error(`Cierre forzado ejecutado en ${activity.registerName || 'Caja'}`);
            }

            // Actualizar dashboard silenciosamente
            fetchDashboard(true);
        };

        socket.on('cash_register_activity', handleRealTimeActivity);
        return () => {
            socket.off('cash_register_activity', handleRealTimeActivity);
        };
    }, [socket, fetchDashboard]);

    // Cargar Expediente del Cajero Seleccionado
    const loadCashierAudit = async (userId) => {
        setSelectedCashierId(userId);
        setLoadingAuditFile(true);
        try {
            const { data } = await api.get(`/cash/admin/cashier-audit/${userId}`);
            if (data && typeof data === 'object' && data.cashier) {
                setCashierAuditFile(data);
            } else {
                console.warn('Unexpected cashier audit file payload:', data);
                setCashierAuditFile(null);
                toast.error('No se pudo obtener el expediente del cajero');
            }
        } catch (error) {
            console.error('Error loading cashier audit file:', error);
            toast.error('No se pudo cargar el expediente del cajero');
            setCashierAuditFile(null);
        } finally {
            setLoadingAuditFile(false);
        }
    };

    // Confirmar Cierre Forzado
    const handleExecuteForceClose = async () => {
        if (!forceCloseModal.shift) return;
        setSubmittingForceClose(true);
        try {
            await api.post(`/cash/admin/force-close/${forceCloseModal.shift.shiftId}`, {
                reason: forceCloseModal.reason || 'Cierre administrativo remoto desde Torre de Control'
            });
            toast.success(`Turno de ${forceCloseModal.shift.userName} cerrado forzosamente`);
            setForceCloseModal({ open: false, shift: null, reason: '' });
            fetchDashboard();
        } catch (error) {
            console.error('Force close error:', error);
            toast.error(error.response?.data?.error || 'Error al ejecutar cierre forzado');
        } finally {
            setSubmittingForceClose(false);
        }
    };

    // Renombrar Caja / Terminal en Caliente
    const handleSaveRegisterName = async () => {
        if (!renameModal.shift || !renameModal.name.trim()) return;
        setSavingName(true);
        try {
            await api.put(`/cash/admin/register-name/${renameModal.shift.shiftId}`, {
                registerName: renameModal.name.trim()
            });
            toast.success(`Caja renombrada a "${renameModal.name.trim()}"`);
            setRenameModal({ open: false, shift: null, name: '' });
            fetchDashboard(true);
        } catch (error) {
            console.error('Error renaming register:', error);
            toast.error('No se pudo renombrar la caja');
        } finally {
            setSavingName(false);
        }
    };

    // Descargar Reporte Diario de Auditoría en PDF
    const handleDownloadDailyReport = async () => {
        setDownloadingReport(true);
        const toastId = toast.loading('Generando Acta Oficial de Auditoría en PDF...');
        try {
            const response = await api.get('/cash/audit-daily-report', {
                responseType: 'blob'
            });
            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            link.setAttribute('download', `Acta_Auditoria_Cajas_${dateStr}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success('Acta de Auditoría descargada correctamente', { id: toastId });
        } catch (error) {
            console.error('Error downloading daily audit report:', error);
            toast.error('No se pudo generar el acta en PDF. Verifica que existan datos auditables.', { id: toastId });
        } finally {
            setDownloadingReport(false);
        }
    };

    // Formateador de tiempo contextual para el feed de actividad
    const formatEventTime = (timestamp) => {
        if (!timestamp) return '--:--';
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '--:--';
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        
        if (isToday) {
            return date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
        return date.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
    };

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

    // Filtros de Cajas
    const filteredRegisters = useMemo(() => {
        const raw = dashboardData?.activeRegisters || [];
        const regs = [...raw].sort((a, b) => {
            const rA = getRegisterRank(a);
            const rB = getRegisterRank(b);
            if (rA !== rB) return rA - rB;
            return (a.registerName || '').localeCompare(b.registerName || '', undefined, { numeric: true, sensitivity: 'base' });
        });
        if (registerFilter === 'all') return regs;
        if (registerFilter === 'active') return regs.filter(r => r.activityStatus === 'active' || r.activityStatus === 'standby');
        if (registerFilter === 'standby') return regs.filter(r => r.activityStatus === 'standby' || r.activityStatus === 'idle');
        return regs;
    }, [dashboardData, registerFilter]);

    // Filtro de Cajeros para la Pestaña 2
    const filteredCashiers = useMemo(() => {
        const list = [...cashiersList].sort((a, b) => {
            const rA = getRegisterRank(a);
            const rB = getRegisterRank(b);
            if (rA !== rB) return rA - rB;
            return (a.name || a.username || '').localeCompare(b.name || b.username || '');
        });
        if (!cashierSearchTerm.trim()) return list;
        const term = cashierSearchTerm.toLowerCase().trim();
        return list.filter(c => 
            (c.name && c.name.toLowerCase().includes(term)) ||
            (c.username && c.username.toLowerCase().includes(term)) ||
            (c.email && c.email.toLowerCase().includes(term))
        );
    }, [cashiersList, cashierSearchTerm]);

    const kpis = dashboardData?.kpis || {
        openRegistersCount: 0,
        totalSalesTodayUsd: 0,
        totalCashInDrawersUsd: 0,
        totalCashInDrawersBs: 0,
        totalDigitalSalesActiveRegistersUsd: 0,
        totalWithdrawalsTodayUsd: 0,
        exchangeRate: 1
    };

    if (loading && !dashboardData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <ShieldCheck className="animate-pulse text-primary-500" size={54} />
                <p className="text-slate-500 font-black uppercase tracking-widest text-xs">
                    Conectando con Torre de Control de Cajas...
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-20 pb-safe animate-in fade-in duration-300">
            {/* Header Principal Adaptativo */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 flex items-center gap-1.5">
                            <Shield size={14} className="shrink-0" />
                            <span>Supervisión Central y Auditoría</span>
                        </span>
                        {isConnected ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 text-[11px] font-medium shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                En Vivo
                            </span>
                        ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[11px] font-medium shrink-0">
                                Desconectado
                            </span>
                        )}
                    </div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight truncate">
                        Control de Cajas y Auditoría
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Monitoreo en tiempo real de terminales, arqueos remotos y expedientes por cajero.
                    </p>
                </div>

                <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs divide-x divide-slate-200 dark:divide-slate-800 overflow-hidden w-full sm:w-auto shrink-0">
                    <button
                        onClick={handleDownloadDailyReport}
                        disabled={downloadingReport}
                        className="flex-1 sm:flex-initial h-8 px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-50 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        title="Generar y descargar Acta Diaria de Auditoría de Cajas en PDF"
                    >
                        <Printer size={13} className={downloadingReport ? 'animate-spin' : ''} />
                        <span>{downloadingReport ? 'Generando...' : 'Reporte PDF'}</span>
                    </button>
                    <button
                        onClick={() => fetchDashboard()}
                        className="flex-1 sm:flex-initial h-8 px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                        <RefreshCw size={13} />
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {/* KPIs Consolidados Globales */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* 1. Recaudación Hoy */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xs flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate mr-1">
                            Recaudación Hoy
                        </span>
                        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                            <TrendingUp size={14} />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                            {formatUSD(kpis.totalSalesTodayUsd)}
                        </div>
                        {!isSingleCurrencyMode() && kpis.exchangeRate > 1 && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums truncate">
                                ≈ {formatBs(kpis.totalSalesTodayUsd * kpis.exchangeRate)}
                            </p>
                        )}
                    </div>
                </div>

                {/* 2. Efectivo Físico en Gavetas */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xs flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate mr-1">
                            Efectivo Físico
                        </span>
                        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                            <Banknote size={14} />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                            {formatUSD(kpis.totalCashInDrawersUsd)}
                        </div>
                        {!isSingleCurrencyMode() && kpis.totalCashInDrawersBs > 0 && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums truncate">
                                + {formatBs(kpis.totalCashInDrawersBs)} Bs
                            </p>
                        )}
                    </div>
                </div>

                {/* 3. Pagos Digitales / Bancos */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xs flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate mr-1">
                            Cobros Digitales
                        </span>
                        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                            <Zap size={14} />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                            {formatUSD(kpis.totalDigitalSalesActiveRegistersUsd)}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                            Puntos, Pago Móvil, Zelle
                        </p>
                    </div>
                </div>

                {/* 4. Terminales Activas */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xs flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate mr-1">
                            Terminales
                        </span>
                        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                            <Monitor size={14} />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                            {kpis.openRegistersCount} <span className="text-xs font-normal text-slate-500">{kpis.openRegistersCount === 1 ? 'Caja' : 'Cajas'}</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                            {kpis.totalWithdrawalsTodayUsd > 0 ? `Bóveda: ${formatUSD(kpis.totalWithdrawalsTodayUsd)}` : 'En operación'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Pestañas de Navegación del Módulo - Segmented Control */}
            <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/80 p-0.5 overflow-x-auto no-scrollbar shadow-2xs w-full sm:w-auto">
                <button
                    onClick={() => setActiveTab('live')}
                    className={`h-7 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0 ${
                        activeTab === 'live'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <Monitor size={13} />
                    <span>Torre de Control ({dashboardData?.activeRegisters?.length || 0})</span>
                </button>

                {isManagerOrAdmin && (
                    <button
                        onClick={() => {
                            setActiveTab('cashiers');
                            if (!selectedCashierId && cashiersList.length > 0) {
                                loadCashierAudit(cashiersList[0].id);
                            }
                        }}
                        className={`h-7 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0 ${
                            activeTab === 'cashiers'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Users size={13} />
                        <span>Expediente por Cajero</span>
                    </button>
                )}

                <button
                    onClick={() => setActiveTab('feed')}
                    className={`h-7 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0 ${
                        activeTab === 'feed'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <Activity size={13} />
                    <span>Feed de Actividad ({liveFeed.length})</span>
                </button>
            </div>

            {/* TAB 1: TORRE DE CONTROL EN VIVO */}
            {activeTab === 'live' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Cuadrícula de Terminales */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                    Terminales de Venta
                                </h2>
                                <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                    {filteredRegisters.length} en pantalla
                                </span>
                            </div>

                            {/* Filtro Rápido */}
                            <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
                                <button
                                    onClick={() => setRegisterFilter('all')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${registerFilter === 'all' ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                >
                                    Todas
                                </button>
                                <button
                                    onClick={() => setRegisterFilter('active')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${registerFilter === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    <span>Operativas</span>
                                </button>
                                <button
                                    onClick={() => setRegisterFilter('standby')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${registerFilter === 'standby' ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                                    <span>En Espera</span>
                                </button>
                            </div>
                        </div>

                        {filteredRegisters.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {filteredRegisters.map(reg => (
                                    <div 
                                        key={reg.shiftId}
                                        className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xs transition-all flex flex-col justify-between"
                                    >
                                        {/* Header de la Tarjeta */}
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                                                        <Monitor size={15} />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <h3 className="font-bold text-slate-900 dark:text-white text-sm leading-tight">
                                                                {reg.registerName}
                                                            </h3>
                                                            {isManagerOrAdmin && reg.userName && (
                                                                <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0" title="Usuario en turno de esta caja">
                                                                    <User size={10} className="text-slate-400" />
                                                                    <span>{reg.userName}</span>
                                                                </span>
                                                            )}
                                                            <button
                                                                onClick={() => setRenameModal({ open: true, shift: reg, name: reg.registerName })}
                                                                className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors cursor-pointer"
                                                                title="Cambiar nombre de caja"
                                                            >
                                                                <Edit2 size={11} />
                                                            </button>
                                                        </div>
                                                        <span className="text-[11px] text-slate-400 font-mono">
                                                            Terminal #{reg.registerId} • Turno {reg.durationMinutes}m
                                                        </span>
                                                    </div>
                                                </div>

                                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1.5 ${
                                                    reg.activityStatus === 'active'
                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/50'
                                                        : reg.activityStatus === 'standby'
                                                        ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800/50'
                                                        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/50'
                                                }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                                        reg.activityStatus === 'active' ? 'bg-emerald-500' : reg.activityStatus === 'standby' ? 'bg-sky-500' : 'bg-amber-500'
                                                    }`} />
                                                    {reg.statusLabel || (
                                                        reg.activityStatus === 'active' 
                                                            ? 'Facturando' 
                                                            : reg.activityStatus === 'standby' 
                                                            ? 'En Espera' 
                                                            : `En Reposo (${reg.minutesSinceLastActivity}m)`
                                                    )}
                                                </span>
                                            </div>

                                            {/* Cajero / Usuario Asignado */}
                                            <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs shrink-0">
                                                        <User size={12} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                                                            Usuario en Turno
                                                        </span>
                                                        {isManagerOrAdmin ? (
                                                            <p className="text-xs font-medium text-slate-800 dark:text-white leading-tight truncate">
                                                                {reg.userName}
                                                                {reg.userRole && (
                                                                    <span className="ml-1 text-[10px] text-slate-400">
                                                                        ({reg.userRole === 'admin' ? 'Gerente / Admin' : reg.userRole === 'supervisor' ? 'Supervisor' : 'Cajero'})
                                                                    </span>
                                                                )}
                                                            </p>
                                                        ) : (
                                                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight italic flex items-center gap-1">
                                                                <Lock size={10} className="text-slate-400 shrink-0" />
                                                                <span className="truncate">Protegido (Solo Gerente)</span>
                                                            </p>
                                                        )}
                                                        <span className="text-[10px] text-slate-400 block truncate font-mono">
                                                            Apertura: {formatDate(reg.openedAt, { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </div>
                                                {isManagerOrAdmin && (
                                                    <button
                                                        onClick={() => {
                                                            setActiveTab('cashiers');
                                                            loadCashierAudit(reg.userId);
                                                        }}
                                                        className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:underline cursor-pointer shrink-0"
                                                    >
                                                        Historial
                                                    </button>
                                                )}
                                            </div>

                                            {/* Métricas de Gaveta */}
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-md border border-slate-200 dark:border-slate-800">
                                                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                                        Efectivo en Gaveta
                                                    </span>
                                                    <span className="text-sm font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                                        {formatUSD(reg.expectedCashUsd)}
                                                    </span>
                                                    {!isSingleCurrencyMode() && reg.expectedCashBs > 0 && (
                                                        <span className="text-[10px] font-mono text-slate-400 block tabular-nums">
                                                            + {formatBs(reg.expectedCashBs)}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-md border border-slate-200 dark:border-slate-800">
                                                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                                        Ventas Digitales
                                                    </span>
                                                    <span className="text-sm font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                                        {formatUSD(reg.digitalSalesUsd)}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 block font-mono">
                                                        {reg.salesCount} tickets cobrados
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Retiros / Egresos si hubo */}
                                            {reg.totalOut > 0 && (
                                                <div className="p-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 rounded-md flex items-center justify-between text-xs">
                                                    <span className="text-xs font-medium text-rose-700 dark:text-rose-400">
                                                        Retiros de Caja:
                                                    </span>
                                                    <span className="font-bold font-mono text-rose-700 dark:text-rose-400 tabular-nums">
                                                        -{formatUSD(reg.totalOut)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Acciones de Administrador - Grouped Toolbar */}
                                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 mt-3 flex items-center">
                                            <div className="w-full inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xs divide-x divide-slate-200 dark:divide-slate-700 overflow-hidden">
                                                <button
                                                    onClick={() => setSelectedRegisterForXRay(reg)}
                                                    className="flex-1 h-8 px-3 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                                >
                                                    <Eye size={13} />
                                                    <span>Arqueo X Remoto</span>
                                                </button>

                                                <button
                                                    onClick={() => setForceCloseModal({ open: true, shift: reg, reason: '' })}
                                                    title="Cerrar turno de esta caja remotamente"
                                                    className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors flex items-center justify-center cursor-pointer shrink-0"
                                                >
                                                    <Lock size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center shadow-xs">
                                <Monitor size={36} className="mx-auto text-slate-400 opacity-50 mb-2.5" />
                                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                                    No hay cajas operando en esta vista
                                </h3>
                                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                                    {registerFilter !== 'all' ? 'Prueba cambiando el filtro a "Todas".' : 'Cuando los cajeros abran turno en sus puestos, podrás supervisar sus cobros y movimientos en vivo.'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Feed de Actividad en Vivo (Columna Derecha) */}
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <Activity size={16} className="text-primary-600 dark:text-primary-400" />
                                <span>Actividad en Tiempo Real</span>
                            </h2>
                            <span className="text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                En vivo
                            </span>
                        </div>

                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-2.5 max-h-[620px] overflow-y-auto custom-scrollbar">
                            {liveFeed.length > 0 ? (
                                liveFeed.map(item => (
                                    <div 
                                        key={item.id}
                                        className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex items-start gap-3"
                                    >
                                        <div className={`p-2 rounded-md shrink-0 mt-0.5 ${
                                            item.eventType === 'sale'
                                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                : item.eventType === 'withdrawal' || item.eventType === 'expense'
                                                ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                                                : 'bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400'
                                        }`}>
                                            {item.eventType === 'sale' ? (
                                                <DollarSign size={14} />
                                            ) : item.eventType === 'withdrawal' || item.eventType === 'expense' ? (
                                                <ArrowDownToLine size={14} />
                                            ) : (
                                                <Zap size={14} />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start gap-2 mb-0.5">
                                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                    {item.registerName}
                                                </span>
                                                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                                                    {formatEventTime(item.timestamp)}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                                                {item.detail}
                                            </p>
                                            <div className="flex justify-between items-center mt-1">
                                                <span className="text-[11px] text-slate-400 truncate">
                                                    {isManagerOrAdmin ? item.userName : (item.registerName || 'Caja')}
                                                </span>
                                                {item.amount > 0 && (
                                                    <span className={`text-xs font-semibold tabular-nums ${
                                                        item.eventType === 'sale' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
                                                    }`}>
                                                        {formatUSD(item.amount)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-400 text-center py-8">
                                    Esperando actividad de cajas...
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: EXPEDIENTE POR CAJERO */}
            {activeTab === 'cashiers' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Lista de Cajeros (4 cols) */}
                    <div className="lg:col-span-4 space-y-4">
                        <div className="relative">
                            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
                            <input
                                type="text"
                                value={cashierSearchTerm}
                                onChange={e => setCashierSearchTerm(e.target.value)}
                                placeholder="Buscar cajero por nombre..."
                                className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-base sm:text-xs min-h-[44px] font-bold text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                            />
                        </div>

                        <div className="space-y-2.5 max-h-[650px] overflow-y-auto custom-scrollbar pr-1">
                            {filteredCashiers.map(cashier => {
                                const isSelected = selectedCashierId === cashier.id;
                                return (
                                    <div
                                        key={cashier.id}
                                        onClick={() => loadCashierAudit(cashier.id)}
                                        className={`p-4 rounded-2xl border transition-all cursor-pointer min-h-[52px] active:scale-98 flex items-center justify-between ${
                                            isSelected 
                                                ? 'bg-primary-600 text-white border-primary-600 shadow-md scale-[1.01]' 
                                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 hover:border-primary-500/40'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${
                                                isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                            }`}>
                                                {cashier.name?.substring(0, 2).toUpperCase() || 'US'}
                                            </div>
                                            <div>
                                                <p className={`text-xs font-black leading-tight ${isSelected ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                                                    {cashier.name || cashier.username}
                                                </p>
                                                <span className={`text-[10px] font-bold ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                                                    @{cashier.username} • {cashier.role}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                                cashier.riskLevel === 'SAFE'
                                                    ? isSelected ? 'bg-emerald-400/30 text-white' : 'bg-emerald-500/10 text-emerald-500'
                                                    : cashier.riskLevel === 'CRITICAL'
                                                    ? isSelected ? 'bg-rose-400/30 text-white' : 'bg-rose-500/10 text-rose-500'
                                                    : isSelected ? 'bg-amber-400/30 text-white' : 'bg-amber-500/10 text-amber-500'
                                            }`}>
                                                {cashier.riskLevel}
                                            </span>
                                            <p className={`text-[10px] font-black mt-1 ${isSelected ? 'text-white/90' : 'text-slate-500'}`}>
                                                Pureza: {cashier.purityScore}%
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Ficha 360° del Cajero Seleccionado (8 cols) */}
                    <div className="lg:col-span-8">
                        {loadingAuditFile ? (
                            <div className="p-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-3">
                                <RefreshCw className="animate-spin mx-auto text-primary-500" size={28} />
                                <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                                    Generando expediente de auditoría del cajero...
                                </p>
                            </div>
                        ) : (cashierAuditFile && cashierAuditFile.cashier) ? (
                            <div className="space-y-6">
                                {/* Cabecera del Expediente */}
                                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold text-lg">
                                                <User size={24} />
                                            </div>
                                            <div>
                                                <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                                    {cashierAuditFile.cashier?.name || cashierAuditFile.cashier?.username || 'Cajero'}
                                                </h2>
                                                <p className="text-xs font-bold text-slate-400">
                                                    @{cashierAuditFile.cashier?.username} • Rol: {cashierAuditFile.cashier?.role} • ID: {cashierAuditFile.cashier?.id}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className={`px-4 py-2 rounded-2xl text-center border ${
                                                cashierAuditFile.risk?.level === 'SAFE'
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                                    : cashierAuditFile.risk?.level === 'CRITICAL'
                                                    ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-500/20 text-rose-600 dark:text-rose-400'
                                                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-500/20 text-amber-600 dark:text-amber-400'
                                            }`}>
                                                <span className="text-[9px] font-black uppercase tracking-wider block opacity-70">
                                                    Nivel de Riesgo
                                                </span>
                                                <span className="text-sm font-black uppercase">
                                                    {cashierAuditFile.risk?.level || 'SAFE'} ({cashierAuditFile.risk?.score ?? 0} pts)
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Métricas de Integridad del Cajero */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5">
                                        <div>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                                                Score de Pureza
                                            </span>
                                            <span className={`text-xl font-black tabular-nums ${
                                                (cashierAuditFile.summary?.purityScore ?? 100) >= 90 ? 'text-emerald-500' : 'text-amber-500'
                                            }`}>
                                                {cashierAuditFile.summary?.purityScore ?? 100}%
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400 block">
                                                {cashierAuditFile.summary?.exactMatchesCount ?? 0} de {cashierAuditFile.summary?.totalShifts ?? 0} exactos
                                            </span>
                                        </div>

                                        <div>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                                                Faltantes Acumulados
                                            </span>
                                            <span className="text-xl font-black text-rose-500 tabular-nums block">
                                                -{formatUSD(cashierAuditFile.summary?.totalLossUsd || 0)}
                                            </span>
                                            {!isSingleCurrencyMode() && Number(cashierAuditFile.summary?.totalLossVes) > 0 && (
                                                <span className="text-[10px] font-bold text-rose-400 block tabular-nums">
                                                    + {formatBs(cashierAuditFile.summary.totalLossVes)} en Bs
                                                </span>
                                            )}
                                            <span className="text-[10px] font-bold text-slate-400 block">
                                                Pérdida en cierres
                                            </span>
                                        </div>

                                        <div>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                                                Volumen Facturado
                                            </span>
                                            <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
                                                {formatUSD(cashierAuditFile.summary?.totalSalesVolumeUsd || 0)}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400 block">
                                                {cashierAuditFile.summary?.salesCount ?? 0} ventas cobradas
                                            </span>
                                        </div>

                                        <div>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                                                Ticket Promedio
                                            </span>
                                            <span className="text-xl font-black text-primary-600 dark:text-primary-400 tabular-nums">
                                                {formatUSD(cashierAuditFile.summary?.averageTicketUsd || 0)}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400 block">
                                                Por operación
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Historial de Declaraciones y Cierres Ciegos */}
                                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-4">
                                    <h3 className="text-xs font-bold uppercase text-slate-800 dark:text-slate-200 tracking-wider flex items-center gap-2">
                                        <FileText size={16} className="text-primary-500" />
                                        <span>Historial de Cierres y Declaraciones de Caja ({(cashierAuditFile.declarations || []).length})</span>
                                    </h3>

                                    {(cashierAuditFile.declarations || []).length > 0 ? (
                                        <>
                                            {/* Desktop Table */}
                                            <div className="hidden md:block overflow-x-auto">
                                                <table className="w-full text-left text-xs border-collapse">
                                                    <thead>
                                                        <tr className="border-b border-slate-100 dark:border-white/5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                                            <th className="py-3 px-3">Fecha</th>
                                                            <th className="py-3 px-3">Caja / Terminal</th>
                                                            <th className="py-3 px-3 text-right">Esperado</th>
                                                            <th className="py-3 px-3 text-right">Declarado</th>
                                                            <th className="py-3 px-3 text-right">Diferencia</th>
                                                            <th className="py-3 px-3 text-center">Resultado</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-bold text-slate-700 dark:text-slate-300">
                                                        {(cashierAuditFile.declarations || []).map(dec => {
                                                            const diffU = Number(dec.differenceUSD) || 0;
                                                            const diffV = Number(dec.differenceVES) || 0;
                                                            const isExact = Math.abs(diffU) < 0.01 && (isSingleCurrencyMode() || Math.abs(diffV) < 0.01);
                                                            const hasLoss = diffU < -0.01 || (!isSingleCurrencyMode() && diffV < -0.01);

                                                            return (
                                                                <tr key={dec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                                    <td className="py-3 px-3 font-mono text-[11px]">
                                                                        {formatDate(dec.createdAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                                    </td>
                                                                    <td className="py-3 px-3">
                                                                        {dec.Shift?.registerName || `Caja ${dec.Shift?.registerId || '1'}`}
                                                                    </td>
                                                                    <td className="py-3 px-3 text-right tabular-nums">
                                                                        <span className="block">{formatUSD(dec.expectedCashUSD)}</span>
                                                                        {!isSingleCurrencyMode() && Number(dec.expectedCashVES) > 0 && (
                                                                            <span className="block text-[10px] text-slate-400 font-normal">
                                                                                {formatBs(dec.expectedCashVES)}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="py-3 px-3 text-right tabular-nums">
                                                                        <span className="block">{formatUSD(dec.declaredCashUSD)}</span>
                                                                        {!isSingleCurrencyMode() && Number(dec.declaredCashVES) > 0 && (
                                                                            <span className="block text-[10px] text-slate-400 font-normal">
                                                                                {formatBs(dec.declaredCashVES)}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="py-3 px-3 text-right font-black tabular-nums">
                                                                        <span className={diffU === 0 ? 'text-slate-400' : diffU < 0 ? 'text-rose-500' : 'text-emerald-500'}>
                                                                            {diffU > 0 ? `+${formatUSD(diffU)}` : diffU < 0 ? `-${formatUSD(Math.abs(diffU))}` : '$0.00'}
                                                                        </span>
                                                                        {!isSingleCurrencyMode() && Math.abs(diffV) >= 0.01 && (
                                                                            <span className={`block text-[10px] ${diffV < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                                                {diffV > 0 ? `+${formatBs(diffV)}` : `-${formatBs(Math.abs(diffV))}`}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="py-3 px-3 text-center">
                                                                        {isExact ? (
                                                                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase">
                                                                                Exacto
                                                                            </span>
                                                                        ) : (
                                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                                                                hasLoss ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'
                                                                            }`}>
                                                                                {hasLoss ? 'Faltante' : 'Sobrante'}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Mobile Cards */}
                                            <div className="block md:hidden space-y-3">
                                                {(cashierAuditFile.declarations || []).map(dec => {
                                                    const diffU = Number(dec.differenceUSD) || 0;
                                                    const diffV = Number(dec.differenceVES) || 0;
                                                    const isExact = Math.abs(diffU) < 0.01 && (isSingleCurrencyMode() || Math.abs(diffV) < 0.01);
                                                    const hasLoss = diffU < -0.01 || (!isSingleCurrencyMode() && diffV < -0.01);

                                                    return (
                                                        <div key={dec.id} className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-white/5 space-y-2">
                                                            <div className="flex justify-between items-start">
                                                                <div>
                                                                    <span className="text-xs font-black text-slate-800 dark:text-white block">
                                                                        {dec.Shift?.registerName || `Caja ${dec.Shift?.registerId || '1'}`}
                                                                    </span>
                                                                    <span className="text-[10px] font-mono text-slate-400">
                                                                        {formatDate(dec.createdAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                                    </span>
                                                                </div>
                                                                {isExact ? (
                                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase">
                                                                        Exacto
                                                                    </span>
                                                                ) : (
                                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                                                        hasLoss ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'
                                                                    }`}>
                                                                        {hasLoss ? 'Faltante' : 'Sobrante'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 dark:border-white/5 text-center">
                                                                <div>
                                                                    <span className="text-[9px] font-black text-slate-400 block uppercase">Esperado</span>
                                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">{formatUSD(dec.expectedCashUSD)}</span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-[9px] font-black text-slate-400 block uppercase">Declarado</span>
                                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">{formatUSD(dec.declaredCashUSD)}</span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-[9px] font-black text-slate-400 block uppercase">Diferencia</span>
                                                                    <span className={`text-xs font-black tabular-nums ${diffU === 0 ? 'text-slate-400' : diffU < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                                        {diffU > 0 ? `+${formatUSD(diffU)}` : diffU < 0 ? `-${formatUSD(Math.abs(diffU))}` : '$0.00'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic py-4">
                                            No hay declaraciones de cierre registradas para este cajero.
                                        </p>
                                    )}
                                </div>

                                {/* Movimientos de Caja Registrados por el Cajero */}
                                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-4">
                                    <h3 className="text-xs font-bold uppercase text-slate-800 dark:text-slate-200 tracking-wider flex items-center gap-2">
                                        <ArrowDownToLine size={16} className="text-rose-500" />
                                        <span>Retiros y Movimientos de Caja ({(cashierAuditFile.movements || []).length})</span>
                                    </h3>

                                    {(cashierAuditFile.movements || []).length > 0 ? (
                                        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                                            {(cashierAuditFile.movements || []).map(mov => (
                                                <div 
                                                    key={mov.id}
                                                    className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between text-xs"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <span className={`p-1.5 rounded-md ${
                                                            mov.type === 'in' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                                                        }`}>
                                                            {mov.type === 'in' ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
                                                        </span>
                                                        <div>
                                                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                                                                {mov.reason || 'Sin motivo'}
                                                            </p>
                                                            <span className="text-[10px] text-slate-400">
                                                                {formatDate(mov.timestamp, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className={`font-bold tabular-nums ${
                                                        mov.type === 'in' ? 'text-emerald-500' : 'text-rose-500'
                                                    }`}>
                                                        {mov.type === 'in' ? '+' : '-'}{formatUSD(mov.amount)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic py-4">
                                            No se registran retiros de caja por parte de este cajero.
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="p-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center">
                                <Users size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                                <p className="text-sm font-medium text-slate-500">
                                    Selecciona un cajero de la lista izquierda para consultar su expediente 360°.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: FEED COMPLETO DE AUDITORÍA */}
            {activeTab === 'feed' && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                                Transmisión de Eventos en Tiempo Real
                            </h2>
                            <p className="text-xs text-slate-400">
                                Registro en streaming de todas las transacciones generadas en el local.
                            </p>
                        </div>
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-white/5 px-3 py-1 rounded-full">
                            {liveFeed.length} eventos en buffer
                        </span>
                    </div>

                    <div className="divide-y divide-slate-100 dark:divide-white/5">
                        {liveFeed.map(item => (
                            <div key={item.id} className="py-3.5 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3.5">
                                    <div className={`p-2.5 rounded-2xl ${
                                        item.eventType === 'sale'
                                            ? 'bg-emerald-500/10 text-emerald-500'
                                            : item.eventType === 'withdrawal' || item.eventType === 'expense'
                                            ? 'bg-rose-500/10 text-rose-500'
                                            : 'bg-primary-500/10 text-primary-500'
                                    }`}>
                                        {item.eventType === 'sale' ? (
                                            <DollarSign size={18} />
                                        ) : item.eventType === 'withdrawal' || item.eventType === 'expense' ? (
                                            <ArrowDownToLine size={18} />
                                        ) : (
                                            <Zap size={18} />
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-800 dark:text-slate-200">
                                            {item.registerName} • {item.detail}
                                        </p>
                                        <p className="text-[10px] font-bold text-slate-400">
                                            Responsable: {item.userName} • {formatEventTime(item.timestamp)}
                                        </p>
                                    </div>
                                </div>

                                {item.amount > 0 && (
                                    <span className={`text-sm font-black tabular-nums ${
                                        item.eventType === 'sale' ? 'text-emerald-500' : 'text-slate-800 dark:text-slate-200'
                                    }`}>
                                        {formatUSD(item.amount)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* MODAL: ARQUEO X REMOTO */}
            <BaseModal
                isOpen={!!selectedRegisterForXRay}
                onClose={() => setSelectedRegisterForXRay(null)}
                maxWidth="max-w-xl"
                className="p-4 sm:p-8 max-h-[92dvh] overflow-y-auto pb-safe"
            >
                {selectedRegisterForXRay && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-start border-b border-slate-100 dark:border-white/5 pb-4">
                            <div>
                                <span className="text-[10px] font-black uppercase text-primary-600 dark:text-primary-400 tracking-widest block">
                                    Inspección de Caja Remota
                                </span>
                                <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                    {selectedRegisterForXRay.registerName}
                                </h2>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                                    Usuario en turno: {isManagerOrAdmin ? selectedRegisterForXRay.userName : '[Protegido: Solo Gerente / Admin]'}
                                </p>
                            </div>
                            <button
                                onClick={() => setSelectedRegisterForXRay(null)}
                                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Totales Físicos y Digitales */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-500/20 rounded-2xl">
                                <span className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400 tracking-wider block">
                                    Dinero en Gaveta (Efectivo)
                                </span>
                                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums block mt-1">
                                    {formatUSD(selectedRegisterForXRay.expectedCashUsd)}
                                </span>
                                {!isSingleCurrencyMode() && selectedRegisterForXRay.expectedCashBs > 0 && (
                                    <span className="text-xs font-bold text-slate-500 block mt-0.5">
                                        + {formatBs(selectedRegisterForXRay.expectedCashBs)}
                                    </span>
                                )}
                            </div>

                            <div className="p-5 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-500/20 rounded-2xl">
                                <span className="text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-400 tracking-wider block">
                                    Total Ventas del Turno
                                </span>
                                <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums block mt-1">
                                    {formatUSD(selectedRegisterForXRay.totalSalesAmount)}
                                </span>
                                <span className="text-xs font-bold text-slate-500 block mt-0.5">
                                    {selectedRegisterForXRay.salesCount} operaciones
                                </span>
                            </div>
                        </div>

                        {/* Desglose por Método de Pago */}
                        <div className="space-y-3">
                            <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                                Desglose por Vía de Recaudo
                            </h4>
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl space-y-2 text-xs font-bold">
                                {Object.entries(selectedRegisterForXRay.paymentBreakdown || {}).map(([method, amount]) => {
                                    const nativeAmount = selectedRegisterForXRay.paymentBreakdownNative?.[method];
                                    return (
                                        <div key={method} className="flex justify-between items-center py-1">
                                            <span className="capitalize text-slate-600 dark:text-slate-300">
                                                {method.replace('_bs', ' Bs').replace('cash', 'Efectivo')}
                                            </span>
                                            <div className="text-right">
                                                <span className="font-black text-slate-900 dark:text-white tabular-nums block">
                                                    {formatUSD(amount)}
                                                </span>
                                                {!isSingleCurrencyMode() && nativeAmount && method.includes('bs') && (
                                                    <span className="text-[10px] text-slate-400 font-bold block tabular-nums">
                                                        {formatBs(nativeAmount)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Base y Movimientos */}
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl grid grid-cols-3 gap-2 text-center text-xs">
                            <div>
                                <span className="text-[9px] font-black text-slate-400 uppercase block">Base Inicial</span>
                                <span className="font-black text-slate-700 dark:text-slate-200">{formatUSD(selectedRegisterForXRay.initialAmount)}</span>
                            </div>
                            <div>
                                <span className="text-[9px] font-black text-slate-400 uppercase block">Total Retiros</span>
                                <span className="font-black text-rose-500">-{formatUSD(selectedRegisterForXRay.totalOut)}</span>
                            </div>
                            <div>
                                <span className="text-[9px] font-black text-slate-400 uppercase block">Ingresos Extra</span>
                                <span className="font-black text-emerald-500">+{formatUSD(selectedRegisterForXRay.totalIn)}</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setSelectedRegisterForXRay(null)}
                            className="w-full min-h-[48px] py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-[1.01] active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                        >
                            Cerrar Inspección
                        </button>
                    </div>
                )}
            </BaseModal>

            {/* MODAL: CIERRE FORZADO */}
            <BaseModal
                isOpen={forceCloseModal.open}
                onClose={() => setForceCloseModal({ open: false, shift: null, reason: '' })}
                maxWidth="max-w-md"
                className="p-4 sm:p-8 max-h-[92dvh] overflow-y-auto pb-safe"
            >
                {forceCloseModal.shift && (
                    <div className="space-y-6">
                        <div className="text-center">
                            <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-500 mx-auto flex items-center justify-center mb-3">
                                <Lock size={24} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                                Cierre Forzado Remoto
                            </h2>
                            <p className="text-xs font-semibold text-slate-400 mt-1">
                                ¿Estás seguro de forzar el cierre del turno en {forceCloseModal.shift.registerName}?
                            </p>
                        </div>

                        <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-500/20 rounded-xl text-xs space-y-1">
                            <p className="font-bold text-rose-700 dark:text-rose-400">
                                Atención Supervisor:
                            </p>
                            <p className="text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                                Esta acción cerrará inmediatamente la sesión de <strong>{isManagerOrAdmin ? forceCloseModal.shift.userName : 'este cajero'}</strong> y generará un registro de auditoría de seguridad.
                            </p>
                        </div>

                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1.5">
                                Motivo del Cierre Forzado *
                            </label>
                            <textarea
                                value={forceCloseModal.reason}
                                onChange={e => setForceCloseModal({ ...forceCloseModal, reason: e.target.value })}
                                placeholder="Ej: Cajero abandonó el puesto / Corte de energía en terminal..."
                                rows={3}
                                className="w-full p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/10 rounded-2xl text-base sm:text-xs font-bold text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-rose-500"
                            />
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-3">
                            <button
                                onClick={() => setForceCloseModal({ open: false, shift: null, reason: '' })}
                                className="flex-1 min-h-[48px] py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-slate-200 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleExecuteForceClose}
                                disabled={submittingForceClose || !forceCloseModal.reason.trim()}
                                className="flex-1 min-h-[48px] py-3 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-rose-700 active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-rose-600/20 cursor-pointer flex items-center justify-center"
                            >
                                {submittingForceClose ? 'Cerrando...' : 'Confirmar Cierre'}
                            </button>
                        </div>
                    </div>
                )}
            </BaseModal>
            {/* MODAL: RENOMBRAR CAJA */}
            <BaseModal
                isOpen={renameModal.open}
                onClose={() => setRenameModal({ open: false, shift: null, name: '' })}
                maxWidth="max-w-sm"
                className="p-4 sm:p-6 max-h-[92dvh] overflow-y-auto pb-safe"
            >
                {renameModal.shift && (
                    <div className="space-y-5">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center font-black">
                                <Edit2 size={18} />
                            </div>
                            <div>
                                <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                    Renombrar Terminal
                                </h3>
                                <p className="text-[10px] font-bold text-slate-400">
                                    Terminal #{renameModal.shift.registerId}
                                </p>
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1.5">
                                Nombre de Caja / Terminal
                            </label>
                            <input
                                type="text"
                                value={renameModal.name}
                                onChange={e => setRenameModal({ ...renameModal, name: e.target.value })}
                                placeholder="Ej: Caja Principal, Caja Rápida..."
                                className="w-full p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/10 rounded-2xl text-base sm:text-xs min-h-[44px] font-bold text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                                autoFocus
                            />
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-3">
                            <button
                                onClick={() => setRenameModal({ open: false, shift: null, name: '' })}
                                className="flex-1 min-h-[48px] py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-slate-200 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveRegisterName}
                                disabled={savingName || !renameModal.name.trim()}
                                className="flex-1 min-h-[48px] py-3 bg-primary-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-primary-700 active:scale-95 transition-all disabled:opacity-50 shadow-md cursor-pointer flex items-center justify-center"
                            >
                                {savingName ? 'Guardando...' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                )}
            </BaseModal>
        </div>
    );
}
