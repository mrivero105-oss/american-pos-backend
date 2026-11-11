import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { 
    Shield, Search, Clock, User, RotateCcw, Filter, Activity, 
    Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, 
    Eye, TrendingUp, AlertTriangle, Tag, Banknote, Calendar, X, 
    Layers, ArrowRight, FileSpreadsheet, CheckCircle2, CheckCircle, 
    ShieldAlert, ShieldCheck, XCircle, RefreshCw, CheckCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import AuditDetailModal from '../components/AuditDetailModal';
import ConfirmModal from '../components/ConfirmModal';
import SystemTelemetryView from '../components/SystemTelemetryView';

// Friendly translations for common fields
const FIELD_LABELS = {
    price: 'Precio',
    priceBs: 'Precio Bs',
    cost: 'Costo',
    bulkPrice: 'Precio Bulto',
    bulkCost: 'Costo Bulto',
    stockQuantity: 'Stock',
    minStock: 'Stock Mín.',
    wholesalePrice: 'P. Mayor',
    midBulkPrice: 'P. Media Pres.',
    name: 'Nombre',
    category: 'Categoría',
    margin: 'Margen'
};

const CATEGORIES = [
    { id: '', label: 'Todos los Registros', icon: Activity },
    { id: 'CRITICAL', label: 'Acciones Críticas', icon: AlertTriangle, color: 'rose' },
    { id: 'PRICES', label: 'Precios y Costos', icon: Tag, color: 'blue' },
    { id: 'INVENTORY', label: 'Inventario', icon: Layers, color: 'sky' },
    { id: 'CASH', label: 'Caja y Finanzas', icon: Banknote, color: 'purple' },
    { id: 'SESSIONS', label: 'Sesiones', icon: User, color: 'emerald' }
];

const AuditPanel = () => {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    // Master Tab: 'logs' | 'alerts' | 'quarantine' | 'telemetry'
    const currentTab = searchParams.get('tab') || 'logs';
    const [masterTab, setMasterTab] = useState(
        ['logs', 'alerts', 'quarantine', 'telemetry'].includes(currentTab) ? currentTab : 'logs'
    );

    // Sync master tab with URL query parameter
    useEffect(() => {
        const t = searchParams.get('tab');
        if (t && ['logs', 'alerts', 'quarantine', 'telemetry'].includes(t)) {
            setMasterTab(t);
        }
    }, [searchParams]);

    const handleMasterTabChange = (newTab) => {
        setMasterTab(newTab);
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (newTab === 'logs') {
                next.delete('tab');
            } else {
                next.set('tab', newTab);
            }
            return next;
        });
    };

    // ==========================================
    // 1. LOGS & AUDIT TRAIL STATE
    // ==========================================
    const [logs, setLogs] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    // KPI Metrics state
    const [stats, setStats] = useState({
        totalLogs: 0,
        priceChanges: 0,
        refundsAndDiscounts: 0,
        cashOperations: 0,
        criticalEvents: 0
    });
    const [loadingStats, setLoadingStats] = useState(false);

    // Users list for cashier filter
    const [usersList, setUsersList] = useState([]);

    // Detail Modal state
    const [selectedLog, setSelectedLog] = useState(null);

    // Filters state
    const [filters, setFilters] = useState({
        search: '',
        category: '',
        action: '',
        userId: '',
        startDate: '',
        endDate: ''
    });

    // ==========================================
    // 2. SECURITY ALERTS STATE
    // ==========================================
    const [alerts, setAlerts] = useState([]);
    const [loadingAlerts, setLoadingAlerts] = useState(false);
    const [alertStatusFilter, setAlertStatusFilter] = useState('ALL'); // 'ALL' | 'OPEN' | 'RESOLVED'
    const [alertSeverityFilter, setAlertSeverityFilter] = useState('ALL'); // 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM'
    const [resolvingAll, setResolvingAll] = useState(false);
    const [confirmResolveAllModal, setConfirmResolveAllModal] = useState(false);

    // ==========================================
    // 3. LAN QUARANTINE STATE
    // ==========================================
    const [quarantineList, setQuarantineList] = useState([]);
    const [loadingQuarantine, setLoadingQuarantine] = useState(false);

    // Load available users once
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await api.get('/users');
                const users = Array.isArray(res.data) ? res.data : (res.data?.data || []);
                setUsersList(users);
            } catch (err) {
                console.warn('Could not load users list for audit filter:', err);
            }
        };
        fetchUsers();
    }, []);

    // Fetch Stats (KPIs)
    const fetchStats = useCallback(async () => {
        try {
            setLoadingStats(true);
            const params = new URLSearchParams();
            if (filters.userId) params.append('userId', filters.userId);
            if (filters.startDate) params.append('startDate', filters.startDate);
            if (filters.endDate) params.append('endDate', filters.endDate);

            const res = await api.get(`/audit/stats?${params.toString()}`);
            if (res.data) {
                setStats(res.data);
            }
        } catch (err) {
            console.warn('Could not load audit stats:', err);
        } finally {
            setLoadingStats(false);
        }
    }, [filters.userId, filters.startDate, filters.endDate]);

    // Fetch Paginated Logs
    const fetchLogs = useCallback(async (customPage = page) => {
        try {
            setLoading(true);
            const queryParams = new URLSearchParams();
            queryParams.append('page', customPage);
            queryParams.append('limit', limit);
            if (filters.search) queryParams.append('search', filters.search);
            if (filters.category) queryParams.append('category', filters.category);
            if (filters.action) queryParams.append('action', filters.action);
            if (filters.userId) queryParams.append('userId', filters.userId);
            if (filters.startDate) queryParams.append('startDate', filters.startDate);
            if (filters.endDate) queryParams.append('endDate', filters.endDate);

            const response = await api.get(`/audit/logs?${queryParams.toString()}`);
            const data = response.data?.data || [];
            setLogs(data);
            setTotalCount(response.data?.total ?? data.length);
            setTotalPages(response.data?.pages || 1);
            setPage(response.data?.page || customPage);
        } catch (error) {
            console.error('Error fetching logs', error);
            const msg = error.response?.data?.error || error.response?.data?.message || 'Error al obtener registros de auditoría';
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, [page, limit, filters]);

    // Fetch Security Alerts
    const fetchAlerts = useCallback(async () => {
        try {
            setLoadingAlerts(true);
            const response = await api.get('/audit/alerts');
            setAlerts(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error('Error fetching alerts', error);
            toast.error('Error al obtener alertas de seguridad');
        } finally {
            setLoadingAlerts(false);
        }
    }, []);

    // Fetch Quarantine List
    const fetchQuarantine = useCallback(async () => {
        try {
            setLoadingQuarantine(true);
            const response = await api.get('/lan/quarantine');
            if (response.data && response.data.success) {
                setQuarantineList(response.data.data || []);
            }
        } catch (error) {
            console.error('Error fetching quarantine sales', error);
        } finally {
            setLoadingQuarantine(false);
        }
    }, []);

    // Initial and periodic fetch
    useEffect(() => {
        fetchAlerts();
        fetchQuarantine();
    }, [fetchAlerts, fetchQuarantine]);

    useEffect(() => {
        if (masterTab === 'logs') {
            fetchLogs();
        }
    }, [page, limit, filters.category, filters.action, filters.userId, masterTab]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    // Handle Alert Resolution
    const handleResolveAlert = async (id) => {
        try {
            await api.put(`/audit/alerts/${id}/resolve`);
            toast.success('Alerta marcada como resuelta');
            fetchAlerts();
        } catch (error) {
            console.error('Error resolving alert', error);
            toast.error('Error al resolver la alerta');
        }
    };

    // Handle Resolve All Alerts - Opens custom confirmation modal
    const handleResolveAllAlerts = () => {
        setConfirmResolveAllModal(true);
    };

    const executeResolveAllAlerts = async () => {
        try {
            setResolvingAll(true);
            const res = await api.put('/audit/alerts/resolve-all', {
                resolutionNotes: `Resolución masiva por ${user?.name || 'Supervisor'}`
            });
            toast.success(res.data?.message || 'Todas las alertas han sido resueltas');
            fetchAlerts();
        } catch (error) {
            console.error('Error resolving all alerts', error);
            toast.error('Error al resolver alertas en lote');
        } finally {
            setResolvingAll(false);
        }
    };

    // Handle Quarantine Resolution
    const handleResolveQuarantine = async (id, action) => {
        const actionLabel = action === 'FORCE_APPROVE' ? 'aprobada y sincronizada' : 'anulada y descartada';
        try {
            const res = await api.post(`/lan/quarantine/${id}/resolve`, {
                action,
                supervisorId: user?.id || 'supervisor',
                notes: `Resolución manual (${action}) por ${user?.name || 'Supervisor'}`
            });
            if (res.data && res.data.success) {
                toast.success(`Transacción ${actionLabel} correctamente`);
                fetchQuarantine();
            } else {
                toast.error(res.data?.error || 'No se pudo resolver la transacción');
            }
        } catch (error) {
            console.error('Error resolving quarantine sale', error);
            toast.error('Error de servidor al resolver cuarentena');
        }
    };

    const handleFilterChange = (e) => {
        setFilters(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
        setPage(1);
    };

    const handleCategoryClick = (catId) => {
        setFilters(prev => ({
            ...prev,
            category: prev.category === catId ? '' : catId,
            action: ''
        }));
        setPage(1);
    };

    const handleSearchSubmit = (e) => {
        if (e) e.preventDefault();
        setPage(1);
        fetchLogs(1);
    };

    const handleDatePreset = (preset) => {
        const today = new Date();
        const formatDateStr = (d) => d.toISOString().split('T')[0];

        let start = '';
        let end = formatDateStr(today);

        if (preset === 'today') {
            start = end;
        } else if (preset === '7days') {
            const past = new Date();
            past.setDate(today.getDate() - 7);
            start = formatDateStr(past);
        } else if (preset === 'month') {
            const past = new Date(today.getFullYear(), today.getMonth(), 1);
            start = formatDateStr(past);
        } else if (preset === 'all') {
            start = '';
            end = '';
        }

        setFilters(prev => ({
            ...prev,
            startDate: start,
            endDate: end
        }));
        setPage(1);
    };

    const handleResetFilters = () => {
        setFilters({
            search: '',
            category: '',
            action: '',
            userId: '',
            startDate: '',
            endDate: ''
        });
        setPage(1);
    };

    // Export to Excel / CSV with UTF-8 BOM
    const handleExportCSV = async () => {
        try {
            setExporting(true);
            toast.loading('Generando reporte en Excel / CSV...', { id: 'export-toast' });

            const queryParams = new URLSearchParams();
            queryParams.append('page', 1);
            queryParams.append('limit', 2000);
            if (filters.search) queryParams.append('search', filters.search);
            if (filters.category) queryParams.append('category', filters.category);
            if (filters.action) queryParams.append('action', filters.action);
            if (filters.userId) queryParams.append('userId', filters.userId);
            if (filters.startDate) queryParams.append('startDate', filters.startDate);
            if (filters.endDate) queryParams.append('endDate', filters.endDate);

            const res = await api.get(`/audit/logs?${queryParams.toString()}`);
            const exportData = res.data?.data || [];

            if (exportData.length === 0) {
                toast.error('No hay registros para exportar con los filtros actuales.', { id: 'export-toast' });
                return;
            }

            const headers = [
                'ID Evento',
                'Fecha',
                'Hora',
                'Usuario',
                'Username',
                'Rol',
                'Accion',
                'Entidad ID',
                'Descripcion'
            ];

            const rows = exportData.map(l => {
                const dateObj = new Date(l.createdAt);
                const dateStr = dateObj.toLocaleDateString('es-VE');
                const timeStr = dateObj.toLocaleTimeString('es-VE');
                const userName = `"${(l.User?.name || l.userId || 'Sistema').replace(/"/g, '""')}"`;
                const username = l.User?.username ? `@${l.User.username}` : '';
                const role = l.User?.role || '';
                const action = l.action || '';
                const entityId = l.entityId || '';
                const desc = `"${(l.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;

                return [
                    l.id,
                    dateStr,
                    timeStr,
                    userName,
                    username,
                    role,
                    action,
                    entityId,
                    desc
                ];
            });

            const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            const dateSuffix = new Date().toISOString().split('T')[0];
            link.setAttribute('download', `Auditoria_American_POS_${dateSuffix}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast.success(`Exportados ${exportData.length} registros en Excel (.csv)`, { id: 'export-toast' });
        } catch (error) {
            console.error('Error exporting audit logs:', error);
            toast.error('Error al exportar registros de auditoría', { id: 'export-toast' });
        } finally {
            setExporting(false);
        }
    };

    const getActionBadge = (action) => {
        switch(action) {
            case 'LOGIN': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 rounded text-[10px] font-semibold tracking-wide">LOGIN</span>;
            case 'LOGOUT': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-semibold tracking-wide">LOGOUT</span>;
            case 'REFUND': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 rounded text-[10px] font-semibold tracking-wide">DEVOLUCIÓN</span>;
            case 'DISCOUNT': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 rounded text-[10px] font-semibold tracking-wide">DESCUENTO</span>;
            case 'PRICE_CHANGE': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 rounded text-[10px] font-semibold tracking-wide">CAMBIO PRECIO</span>;
            case 'COST_CHANGE': 
            case 'COST_UPDATE_IMPORT': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60 rounded text-[10px] font-semibold tracking-wide">CAMBIO COSTO</span>;
            case 'CREATE_SALE': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60 rounded text-[10px] font-semibold tracking-wide">VENTA</span>;
            case 'CASH_OPEN': 
            case 'CASH_CLOSE': 
            case 'CASH_CLOSE_BLIND': 
            case 'FORCE_CLOSE_SHIFT': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 rounded text-[10px] font-semibold tracking-wide">TURNO / CAJA</span>;
            case 'CASH_DROP': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800/60 rounded text-[10px] font-semibold tracking-wide">RETIRO EFECTIVO</span>;
            case 'CREATE_PRODUCT': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-[10px] font-semibold tracking-wide">NUEVO PRODUCTO</span>;
            case 'PRODUCT_UPDATE': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 rounded text-[10px] font-semibold tracking-wide">EDICIÓN PRODUCTO</span>;
            case 'DELETE_PRODUCT': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 rounded text-[10px] font-semibold tracking-wide">ELIMINAR PRODUCTO</span>;
            case 'EXPENSE_CREATE': 
            case 'EXPENSE_DELETE': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 rounded text-[10px] font-semibold tracking-wide">GASTO</span>;
            case 'SUPPLIER_PAYMENT': 
            case 'CUSTOMER_PAYMENT': 
                return <span className="inline-flex items-center px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 rounded text-[10px] font-semibold tracking-wide">PAGO</span>;
            default: 
                return <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-semibold tracking-wide">{action}</span>;
        }
    };

    const getSeverityBadge = (severity) => {
        switch(severity?.toLowerCase()) {
            case 'critical': return 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/40';
            case 'high': return 'bg-orange-500/20 text-orange-600 dark:text-orange-300 border-orange-500/40';
            case 'medium': return 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40';
            default: return 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border-indigo-500/40';
        }
    };

    // Helper: Parse description to extract inline smart diff badges
    const renderDescriptionCell = (log) => {
        const desc = log.description || '';
        const colonIndex = desc.indexOf(':');

        if (colonIndex !== -1 && desc.includes('->')) {
            const title = desc.substring(0, colonIndex).trim();
            const diffStr = desc.substring(colonIndex + 1).trim();

            const regex = /(?:^|,\s*)([a-zA-Z0-9_\u00C0-\u017F\s]+):\s*([^,->]+?)\s*->\s*([^,]+)/g;
            const matches = [];
            let m;
            while ((m = regex.exec(diffStr)) !== null) {
                matches.push({
                    field: m[1].trim(),
                    label: FIELD_LABELS[m[1].trim()] || m[1].trim(),
                    oldVal: m[2].trim(),
                    newVal: m[3].trim()
                });
            }

            if (matches.length > 0) {
                const priority = ['price', 'cost', 'stockQuantity', 'bulkPrice', 'bulkCost', 'wholesalePrice', 'name'];
                matches.sort((a, b) => {
                    const aPri = priority.indexOf(a.field);
                    const bPri = priority.indexOf(b.field);
                    if (aPri !== -1 && bPri !== -1) return aPri - bPri;
                    if (aPri !== -1) return -1;
                    if (bPri !== -1) return 1;
                    return 0;
                });

                const topBadges = matches.slice(0, 2);
                const remaining = matches.length - topBadges.length;

                return (
                    <div className="space-y-1.5 py-1">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                            {title}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {topBadges.map((b, idx) => (
                                <span 
                                    key={idx} 
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-[11px] font-mono"
                                >
                                    <span className="text-slate-500 dark:text-slate-400 font-sans font-bold">{b.label}:</span>
                                    <span className="line-through text-rose-500 font-medium">{b.oldVal}</span>
                                    <ArrowRight size={10} className="text-slate-400" />
                                    <span className="text-emerald-500 font-bold">{b.newVal}</span>
                                </span>
                            ))}

                            {remaining > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setSelectedLog(log)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
                                >
                                    +{remaining} cambios más
                                </button>
                            )}
                        </div>
                    </div>
                );
            }
        }

        return (
            <span className="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                {desc}
            </span>
        );
    };

    // Filtered Security Alerts
    const filteredAlerts = useMemo(() => {
        return alerts.filter(a => {
            const matchesStatus = alertStatusFilter === 'ALL' ? true : 
                (alertStatusFilter === 'OPEN' ? a.status !== 'RESOLVED' : a.status === 'RESOLVED');
            const matchesSeverity = alertSeverityFilter === 'ALL' ? true :
                (a.severity?.toUpperCase() === alertSeverityFilter);
            return matchesStatus && matchesSeverity;
        });
    }, [alerts, alertStatusFilter, alertSeverityFilter]);

    const openAlertsCount = useMemo(() => alerts.filter(a => a.status !== 'RESOLVED').length, [alerts]);
    const pendingQuarantineCount = useMemo(() => quarantineList.filter(q => q.status === 'pending_review' || q.status === 'quarantined').length, [quarantineList]);

    const MobileAuditLogCard = ({ log }) => (
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 shadow-xs space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span>{new Date(log.createdAt).toLocaleString()}</span>
                </div>
                <div>{getActionBadge(log.action)}</div>
            </div>

            <div className="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-white">
                <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{log.User ? `${log.User.name} (@${log.User.username})` : log.userId || 'Sistema'}</span>
                </div>
                {log.User?.role && (
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">
                        {log.User.role}
                    </span>
                )}
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-white/5">
                {renderDescriptionCell(log)}
            </div>

            <div className="flex justify-end pt-1">
                <button
                    onClick={() => setSelectedLog(log)}
                    className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                    <Eye size={13} />
                    <span>Ver Ficha</span>
                </button>
            </div>
        </div>
    );

    return (
        <div className="p-3 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300 pb-24 sm:pb-16 pb-safe">
            {/* Unified Header */}
            <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 pb-1">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                        <Shield size={18} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                Centro de Auditoría y Seguridad
                            </h1>
                            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                Registro inmutable
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Monitoreo unificado de seguridad, trazabilidad de eventos y resolución de discrepancias
                        </p>
                    </div>
                </div>

                {/* Master Navigation Segmented Control */}
                <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/80 p-0.5 overflow-x-auto no-scrollbar w-full xl:w-auto">
                    {/* Tab: Historial */}
                    <button
                        onClick={() => handleMasterTabChange('logs')}
                        className={`h-7 px-3 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                            masterTab === 'logs'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Shield size={13} />
                        <span>Historial</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200/60 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                            {(totalCount || 0).toLocaleString()}
                        </span>
                    </button>

                    {/* Tab: Alertas */}
                    <button
                        onClick={() => handleMasterTabChange('alerts')}
                        className={`h-7 px-3 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                            masterTab === 'alerts'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <ShieldAlert size={13} className={openAlertsCount > 0 ? "text-rose-500" : ""} />
                        <span>Alertas</span>
                        {openAlertsCount > 0 && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 font-semibold">
                                {openAlertsCount}
                            </span>
                        )}
                    </button>

                    {/* Tab: Cuarentena LAN */}
                    <button
                        onClick={() => handleMasterTabChange('quarantine')}
                        className={`h-7 px-3 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                            masterTab === 'quarantine'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <AlertTriangle size={13} className={pendingQuarantineCount > 0 ? "text-amber-500" : ""} />
                        <span>Cuarentena LAN</span>
                        {pendingQuarantineCount > 0 && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 font-semibold">
                                {pendingQuarantineCount}
                            </span>
                        )}
                    </button>

                    {/* Tab: Telemetría APM */}
                    <button
                        onClick={() => handleMasterTabChange('telemetry')}
                        className={`h-7 px-3 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                            masterTab === 'telemetry'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Activity size={13} />
                        <span>Telemetría APM</span>
                    </button>
                </div>
            </div>

            {/* ========================================================================= */}
            {/* VIEW 1: HISTORIAL DE AUDITORÍA GENERAL */}
            {/* ========================================================================= */}
            {masterTab === 'logs' && (
                <div className="space-y-4">
                    {/* Top Actions: Export + Reload Toolbar */}
                    <div className="flex justify-end gap-2">
                        <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs divide-x divide-slate-200 dark:divide-slate-800 overflow-hidden">
                            <button
                                onClick={handleExportCSV}
                                disabled={exporting || loading}
                                className="h-8 px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                                title="Exportar a Microsoft Excel / CSV con UTF-8"
                            >
                                <FileSpreadsheet size={13} className="text-emerald-600 dark:text-emerald-400" />
                                <span>{exporting ? 'Exportando...' : 'Exportar Excel'}</span>
                            </button>

                            <button
                                onClick={() => { fetchLogs(); fetchStats(); }}
                                title="Recargar registros"
                                className="h-8 px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                                <RotateCcw size={13} className={loading ? "animate-spin" : ""} />
                                <span>Actualizar</span>
                            </button>
                        </div>
                    </div>

                    {/* Top KPI Metrics Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                        {/* Total Events */}
                        <div 
                            onClick={() => handleCategoryClick('')}
                            className={`p-4 rounded-lg bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none shadow-2xs ${
                                filters.category === '' 
                                    ? 'border-slate-900 dark:border-slate-200 ring-1 ring-slate-900/10 dark:ring-slate-200/10' 
                                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Total Eventos
                                </span>
                                <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                                    <Activity size={14} />
                                </div>
                            </div>
                            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                {loadingStats ? '...' : (stats.totalLogs || totalCount).toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Registros en el periodo
                            </p>
                        </div>

                        {/* Price / Cost Changes */}
                        <div 
                            onClick={() => handleCategoryClick('PRICES')}
                            className={`p-4 rounded-lg bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none shadow-2xs ${
                                filters.category === 'PRICES' 
                                    ? 'border-slate-900 dark:border-slate-200 ring-1 ring-slate-900/10 dark:ring-slate-200/10' 
                                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Precios y Costos
                                </span>
                                <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                                    <Tag size={14} />
                                </div>
                            </div>
                            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                {loadingStats ? '...' : (stats.priceChanges || 0).toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Aumentos y ajustes de PVP
                            </p>
                        </div>

                        {/* Refunds & Discounts */}
                        <div 
                            onClick={() => handleCategoryClick('CRITICAL')}
                            className={`p-4 rounded-lg bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none shadow-2xs ${
                                filters.category === 'CRITICAL' 
                                    ? 'border-slate-900 dark:border-slate-200 ring-1 ring-slate-900/10 dark:ring-slate-200/10' 
                                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Devoluciones / Anulaciones
                                </span>
                                <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-rose-500">
                                    <AlertTriangle size={14} />
                                </div>
                            </div>
                            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                {loadingStats ? '...' : (stats.refundsAndDiscounts || 0).toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Devoluciones y ajustes de caja
                            </p>
                        </div>

                        {/* Cash Operations */}
                        <div 
                            onClick={() => handleCategoryClick('CASH')}
                            className={`p-4 rounded-lg bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none shadow-2xs ${
                                filters.category === 'CASH' 
                                    ? 'border-slate-900 dark:border-slate-200 ring-1 ring-slate-900/10 dark:ring-slate-200/10' 
                                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Caja y Egresos
                                </span>
                                <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                                    <Banknote size={14} />
                                </div>
                            </div>
                            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                {loadingStats ? '...' : (stats.cashOperations || 0).toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Retiros, aperturas y cierres
                            </p>
                        </div>
                    </div>

                    {/* Quick Category Chips - Segmented Control */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar">
                        {CATEGORIES.map(cat => {
                            const Icon = cat.icon;
                            const isActive = filters.category === cat.id;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => handleCategoryClick(cat.id)}
                                    className={`h-8 px-3 rounded-md text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 border ${
                                        isActive 
                                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-2xs font-semibold' 
                                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    <Icon size={13} className={isActive ? (document.documentElement.classList.contains('dark') ? 'text-slate-900' : 'text-white') : 'text-slate-400'} />
                                    <span>{cat.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Main Filters Bar */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg shadow-2xs space-y-3">
                        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                            {/* Universal Search */}
                            <div className="sm:col-span-4">
                                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                    <Search size={11} className="text-slate-400" /> Búsqueda Libre
                                </label>
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        name="search" 
                                        value={filters.search} 
                                        onChange={handleFilterChange}
                                        placeholder="Producto, código, detalle..."
                                        className="w-full h-9 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-md px-3 text-xs focus:outline-none focus:border-slate-400 dark:focus:border-slate-500 font-medium pl-8"
                                    />
                                    <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                                    {filters.search && (
                                        <button
                                            type="button"
                                            onClick={() => setFilters(prev => ({ ...prev, search: '' }))}
                                            className="w-7 h-7 flex items-center justify-center absolute right-1 top-1 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Cashier / User Selector */}
                            <div className="sm:col-span-3">
                                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                    <User size={11} className="text-slate-400" /> Usuario / Cajero
                                </label>
                                <select
                                    name="userId"
                                    value={filters.userId}
                                    onChange={handleFilterChange}
                                    className="w-full h-9 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-md px-2.5 text-xs focus:outline-none focus:border-slate-400 dark:focus:border-slate-500 font-medium cursor-pointer [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-white"
                                >
                                    <option value="">Todos los usuarios</option>
                                    {usersList.map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.name} (@{u.username}) {u.role ? `[${u.role}]` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Specific Action */}
                            <div className="sm:col-span-3">
                                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                    <Filter size={11} className="text-slate-400" /> Tipo de Acción
                                </label>
                                <select 
                                    name="action" 
                                    value={filters.action} 
                                    onChange={handleFilterChange}
                                    className="w-full h-9 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-md px-2.5 text-xs focus:outline-none focus:border-slate-400 dark:focus:border-slate-500 font-medium cursor-pointer [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-white"
                                >
                                    <option value="">Todas las acciones</option>
                                    <option value="PRODUCT_UPDATE">Edición de Productos (PRODUCT_UPDATE)</option>
                                    <option value="PRICE_CHANGE">Cambios de Precio (PRICE_CHANGE)</option>
                                    <option value="COST_CHANGE">Cambios de Costo (COST_CHANGE)</option>
                                    <option value="CREATE_PRODUCT">Creación de Productos (CREATE_PRODUCT)</option>
                                    <option value="DELETE_PRODUCT">Eliminación de Productos (DELETE_PRODUCT)</option>
                                    <option value="CREATE_SALE">Ventas Realizadas (CREATE_SALE)</option>
                                    <option value="REFUND">Devoluciones (REFUND)</option>
                                    <option value="DISCOUNT">Descuentos (DISCOUNT)</option>
                                    <option value="CASH_OPEN">Aperturas de Caja (CASH_OPEN)</option>
                                    <option value="CASH_CLOSE">Cierres de Caja (CASH_CLOSE)</option>
                                    <option value="CASH_CLOSE_BLIND">Cierres Ciegos (CASH_CLOSE_BLIND)</option>
                                    <option value="CASH_DROP">Retiros de Efectivo (CASH_DROP)</option>
                                    <option value="EXPENSE_CREATE">Gastos Operativos (EXPENSE_CREATE)</option>
                                    <option value="SUPPLIER_PAYMENT">Pagos a Proveedores (SUPPLIER_PAYMENT)</option>
                                    <option value="CUSTOMER_PAYMENT">Abonos de Clientes (CUSTOMER_PAYMENT)</option>
                                    <option value="LOGIN">Inicios de sesión (LOGIN)</option>
                                </select>
                            </div>

                            {/* Search & Reset Buttons */}
                            <div className="sm:col-span-2 flex gap-1.5">
                                <button 
                                    type="submit"
                                    className="flex-1 h-9 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold rounded-md shadow-2xs transition-colors flex items-center justify-center gap-1.5 text-xs cursor-pointer"
                                >
                                    <Search className="w-3.5 h-3.5" />
                                    <span>Buscar</span>
                                </button>

                                {(filters.search || filters.category || filters.action || filters.userId || filters.startDate || filters.endDate) && (
                                    <button 
                                        type="button"
                                        onClick={handleResetFilters}
                                        title="Limpiar todos los filtros"
                                        className="h-9 w-9 flex items-center justify-center bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer shrink-0"
                                    >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </form>

                        {/* Date Controls & Presets */}
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                    <Calendar size={12} /> Periodo:
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <input 
                                        type="date" 
                                        name="startDate" 
                                        value={filters.startDate} 
                                        onChange={handleFilterChange}
                                        className="h-8 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-md px-2 text-xs focus:outline-none font-medium"
                                    />
                                    <span className="text-slate-400 font-medium">a</span>
                                    <input 
                                        type="date" 
                                        name="endDate" 
                                        value={filters.endDate} 
                                        onChange={handleFilterChange}
                                        className="h-8 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-md px-2 text-xs focus:outline-none font-medium"
                                    />
                                </div>
                            </div>

                            <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5 divide-x divide-slate-200 dark:divide-slate-700 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => handleDatePreset('today')}
                                    className="h-7 px-2.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                >
                                    Hoy
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDatePreset('7days')}
                                    className="h-7 px-2.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                >
                                    7 Días
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDatePreset('month')}
                                    className="h-7 px-2.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                >
                                    Este Mes
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDatePreset('all')}
                                    className="h-7 px-2.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                >
                                    Todo el Historial
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Table Container */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xs overflow-hidden">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20 space-y-3">
                                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent"></div>
                                <p className="text-xs font-medium text-slate-500">
                                    Consultando libro de auditoría...
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Mobile View (< md) */}
                                <div className="md:hidden p-3 space-y-3">
                                    {logs.length === 0 ? (
                                        <div className="text-center py-16 text-xs font-medium text-slate-400 italic">
                                            No se encontraron registros con los filtros seleccionados.
                                        </div>
                                    ) : (
                                        logs.map(log => (
                                            <MobileAuditLogCard key={log.id} log={log} />
                                        ))
                                    )}
                                </div>

                                {/* Desktop Table View (>= md) */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-white/10">
                                                <th className="px-5 py-3.5 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 w-48">
                                                    Fecha / Hora
                                                </th>
                                                <th className="px-5 py-3.5 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 w-44">
                                                    Usuario
                                                </th>
                                                <th className="px-5 py-3.5 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 w-36">
                                                    Acción
                                                </th>
                                                <th className="px-5 py-3.5 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                    Descripción / Cambios Realizados
                                                </th>
                                                <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center w-24">
                                                    Detalle
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                            {logs.length > 0 ? logs.map(log => (
                                                <tr 
                                                    key={log.id} 
                                                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group"
                                                >
                                                    {/* Date */}
                                                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300 font-mono">
                                                        <div className="flex items-center gap-2">
                                                            <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                                            <span>{new Date(log.createdAt).toLocaleString()}</span>
                                                        </div>
                                                    </td>

                                                    {/* User */}
                                                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                                                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                            <span>{log.User?.name || log.userId || 'Sistema'}</span>
                                                        </div>
                                                        {log.User?.username && (
                                                            <div className="text-[11px] text-slate-400 font-normal pl-5">
                                                                @{log.User.username}
                                                            </div>
                                                        )}
                                                    </td>

                                                    {/* Action Badge */}
                                                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                                                        {getActionBadge(log.action)}
                                                    </td>

                                                    {/* Smart Diff Description */}
                                                    <td className="px-5 py-3 text-xs text-slate-600 dark:text-slate-300">
                                                        {renderDescriptionCell(log)}
                                                    </td>

                                                    {/* Inspect Button */}
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <button
                                                            onClick={() => setSelectedLog(log)}
                                                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 transition-all cursor-pointer"
                                                            title="Inspeccionar detalle completo"
                                                        >
                                                            <Eye size={15} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan="5" className="px-6 py-16 text-center text-slate-400 font-medium italic">
                                                        No se encontraron registros de auditoría con los filtros seleccionados.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination Footer */}
                                <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30">
                                    {/* Records per page & info */}
                                    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-medium">
                                        <span>
                                            Mostrando {totalCount === 0 ? 0 : (page - 1) * limit + 1} a {Math.min(page * limit, totalCount)} de {totalCount.toLocaleString()} registros
                                        </span>

                                        <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200 dark:border-white/10">
                                            <span className="text-[11px]">Filas:</span>
                                            <select
                                                value={limit}
                                                onChange={(e) => {
                                                    setLimit(Number(e.target.value));
                                                    setPage(1);
                                                }}
                                                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none font-bold cursor-pointer [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-white"
                                            >
                                                <option value={25}>25</option>
                                                <option value={50}>50</option>
                                                <option value={100}>100</option>
                                                <option value={200}>200</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Page Controls */}
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => setPage(1)}
                                            disabled={page <= 1}
                                            title="Primera página"
                                            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
                                        >
                                            <ChevronsLeft size={16} />
                                        </button>

                                        <button
                                            onClick={() => setPage(p => Math.max(1, p - 1))}
                                            disabled={page <= 1}
                                            title="Página anterior"
                                            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
                                        >
                                            <ChevronLeft size={16} />
                                        </button>

                                        <span className="px-2.5 sm:px-3.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 font-mono text-center">
                                            {page} / {totalPages || 1}
                                        </span>

                                        <button
                                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                            disabled={page >= totalPages}
                                            title="Página siguiente"
                                            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
                                        >
                                            <ChevronRight size={16} />
                                        </button>

                                        <button
                                            onClick={() => setPage(totalPages)}
                                            disabled={page >= totalPages}
                                            title="Última página"
                                            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer"
                                        >
                                            <ChevronsRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 2: ALERTAS DE SEGURIDAD (ANTIFRAUDE) */}
            {/* ========================================================================= */}
            {masterTab === 'alerts' && (
                <div className="space-y-4">
                    {/* Controls Bar */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Status Filter */}
                            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700 text-xs">
                                <button
                                    onClick={() => setAlertStatusFilter('ALL')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                                        alertStatusFilter === 'ALL'
                                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    Todas ({alerts.length})
                                </button>
                                <button
                                    onClick={() => setAlertStatusFilter('OPEN')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                        alertStatusFilter === 'OPEN'
                                            ? 'bg-rose-500 text-white shadow-xs'
                                            : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                                    }`}
                                >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    <span>Pendientes ({openAlertsCount})</span>
                                </button>
                                <button
                                    onClick={() => setAlertStatusFilter('RESOLVED')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                        alertStatusFilter === 'RESOLVED'
                                            ? 'bg-emerald-600 text-white shadow-xs'
                                            : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                                    }`}
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Resueltas ({alerts.filter(a => a.status === 'RESOLVED').length})</span>
                                </button>
                            </div>

                            {/* Severity Filter - Segmented Pills */}
                            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setAlertSeverityFilter('ALL')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                                        alertSeverityFilter === 'ALL'
                                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    Cualquier Severidad
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAlertSeverityFilter('CRITICAL')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                        alertSeverityFilter === 'CRITICAL'
                                            ? 'bg-rose-500 text-white shadow-xs'
                                            : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                                    }`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                    Críticas
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAlertSeverityFilter('HIGH')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                        alertSeverityFilter === 'HIGH'
                                            ? 'bg-orange-500 text-white shadow-xs'
                                            : 'text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30'
                                    }`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                                    Alta
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAlertSeverityFilter('MEDIUM')}
                                    className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                        alertSeverityFilter === 'MEDIUM'
                                            ? 'bg-amber-500 text-white shadow-xs'
                                            : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                                    }`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                    Media
                                </button>
                            </div>
                        </div>

                        {/* Bulk Action: Resolve All */}
                        <div className="flex items-center gap-2 self-end sm:self-center">
                            {openAlertsCount > 0 && (
                                <button
                                    onClick={handleResolveAllAlerts}
                                    disabled={resolvingAll}
                                    className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    <CheckCheck size={14} />
                                    <span>{resolvingAll ? 'Resolviendo...' : `Resolver Todas (${openAlertsCount})`}</span>
                                </button>
                            )}

                            <button
                                onClick={fetchAlerts}
                                title="Refrescar alertas"
                                className="p-2 sm:px-3 sm:py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors text-xs font-medium flex items-center gap-1.5 cursor-pointer shrink-0"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${loadingAlerts ? 'animate-spin' : ''}`} />
                                <span className="hidden sm:inline">Refrescar</span>
                            </button>
                        </div>
                    </div>

                    {/* Alerts Content */}
                    {loadingAlerts ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-rose-500 border-t-transparent"></div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                Escaneando alertas de seguridad...
                            </p>
                        </div>
                    ) : filteredAlerts.length === 0 ? (
                        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 p-5 rounded-xl flex items-center gap-3.5">
                            <CheckCircle className="text-emerald-600 dark:text-emerald-400 w-6 h-6 shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Sistema Protegido</h3>
                                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                                    No hay alertas pendientes con los filtros actuales. Toda la actividad está verificada y en orden.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredAlerts.map(alert => (
                                <div 
                                    key={alert.id} 
                                    className={`bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border transition-colors shadow-xs ${
                                        alert.status === 'RESOLVED' 
                                            ? 'border-slate-200 dark:border-slate-800 opacity-60' 
                                            : 'border-rose-200 dark:border-rose-900/50'
                                    }`}
                                >
                                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 sm:gap-4">
                                        <div className="flex-1 space-y-1.5">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getSeverityBadge(alert.severity)}`}>
                                                    {alert.severity}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${
                                                    alert.status === 'RESOLVED' 
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' 
                                                        : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                                }`}>
                                                    {alert.status === 'RESOLVED' ? 'RESUELTA' : 'PENDIENTE'}
                                                </span>
                                                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                                    {new Date(alert.createdAt).toLocaleString()}
                                                </span>
                                            </div>

                                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                                                {alert.type?.toUpperCase().replace(/_/g, ' ')}
                                            </h3>

                                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                                {alert.message}
                                            </p>

                                            {alert.user && (
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 pt-0.5">
                                                    <User size={12} className="text-slate-400" />
                                                    <span>Usuario involucrado:</span>
                                                    <strong className="text-slate-800 dark:text-slate-200 font-semibold">
                                                        {alert.user.name} (@{alert.user.username})
                                                    </strong>
                                                </div>
                                            )}

                                            {alert.resolutionNotes && (
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                                                    Nota de resolución: {alert.resolutionNotes}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-end shrink-0 pt-2 sm:pt-0">
                                            {alert.status !== 'RESOLVED' ? (
                                                <button 
                                                    onClick={() => handleResolveAlert(alert.id)}
                                                    className="w-full sm:w-auto min-h-[38px] px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                                >
                                                    <CheckCircle className="w-3.5 h-3.5" /> Marcar Resuelta
                                                </button>
                                            ) : (
                                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                                    Resuelta
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 3: CUARENTENA LAN P2P */}
            {/* ========================================================================= */}
            {masterTab === 'quarantine' && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-3.5 sm:p-4 rounded-xl">
                        <div className="flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200 font-medium">
                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-semibold text-amber-900 dark:text-amber-300">Sincronización Offline en Cuarentena:</span> Transacciones generadas en cajas locales con discrepancias de stock o validación P2P pendientes.
                            </div>
                        </div>
                        <button
                            onClick={fetchQuarantine}
                            className="w-full sm:w-auto min-h-[38px] flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700/50 transition-colors shrink-0 cursor-pointer"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loadingQuarantine ? 'animate-spin' : ''}`} /> Actualizar
                        </button>
                    </div>

                    {loadingQuarantine ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent"></div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cargando transacciones en cuarentena...</p>
                        </div>
                    ) : quarantineList.length === 0 ? (
                        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 p-5 rounded-xl flex items-center gap-3.5">
                            <ShieldCheck className="text-emerald-600 dark:text-emerald-400 w-6 h-6 shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Cuarentena Vacía</h3>
                                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                                    No hay ventas offline en cuarentena. Todas las cajas locales están sincronizadas.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {quarantineList.map(item => {
                                const isPending = item.status === 'pending_review' || item.status === 'quarantined';
                                const payloadData = item.payload || item.salePayload;
                                return (
                                    <div 
                                        key={item.id} 
                                        className={`bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border shadow-xs ${
                                            isPending ? 'border-amber-200 dark:border-amber-800/50' : 'border-slate-200 dark:border-slate-800 opacity-60'
                                        }`}
                                    >
                                        <div className="flex flex-col lg:flex-row justify-between gap-4">
                                            <div className="flex-1 space-y-2.5">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                                                        isPending 
                                                            ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                                    }`}>
                                                        {item.status.replace(/_/g, ' ')}
                                                    </span>
                                                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                                                        ID: {item.id}
                                                    </span>
                                                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/40 px-2 py-0.5 rounded">
                                                        Caja: {item.registerId || item.userId || 'POS-LAN'}
                                                    </span>
                                                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                                        {new Date(item.createdAt || Date.now()).toLocaleString()}
                                                    </span>
                                                </div>

                                                <div className="bg-rose-50 dark:bg-rose-950/20 p-3 rounded-lg border border-rose-200 dark:border-rose-800/40 text-xs text-rose-700 dark:text-rose-300">
                                                    <strong className="font-semibold text-rose-800 dark:text-rose-200">Motivo:</strong> {item.errorReason || item.conflictReason || 'Descuadre de inventario o duplicidad detectada.'}
                                                </div>

                                                {/* Detalles de la venta */}
                                                {payloadData && (
                                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs space-y-2">
                                                        <div className="font-semibold text-slate-800 dark:text-white flex justify-between items-center">
                                                            <span>Venta #{payloadData.clientTransactionId || item.offlineId || item.id.slice(-6)}</span>
                                                            <span className="text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                                                                ${Number(payloadData.total || 0).toFixed(2)} USD
                                                            </span>
                                                        </div>
                                                        {Array.isArray(payloadData.items) && payloadData.items.length > 0 && (
                                                            <div className="text-slate-600 dark:text-slate-300 space-y-1 border-t border-slate-200 dark:border-slate-700 pt-2">
                                                                {payloadData.items.map((prod, idx) => (
                                                                    <div key={idx} className="flex justify-between font-mono text-[11px]">
                                                                        <span>• {prod.quantity}x {prod.name || prod.nombre || 'Producto'}</span>
                                                                        <span>${Number(prod.subtotal || prod.price || 0).toFixed(2)}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Botones de acción */}
                                            <div className="flex flex-col sm:flex-row lg:flex-col justify-center items-stretch sm:items-end gap-2 shrink-0 pt-2 lg:pt-0">
                                                {isPending ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleResolveQuarantine(item.id, 'FORCE_APPROVE')}
                                                            className="w-full sm:w-auto min-h-[38px] px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                                        >
                                                            <CheckCircle className="w-3.5 h-3.5" /> Aprobar y Forzar
                                                        </button>
                                                        <button
                                                            onClick={() => handleResolveQuarantine(item.id, 'DISCARD')}
                                                            className="w-full sm:w-auto min-h-[38px] px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                                        >
                                                            <XCircle className="w-3.5 h-3.5" /> Rechazar y Anular
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 italic">
                                                        Procesada: {item.resolutionNotes || item.status}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 4: TELEMETRÍA APM & SALUD DEL SISTEMA */}
            {/* ========================================================================= */}
            {masterTab === 'telemetry' && (
                <SystemTelemetryView />
            )}

            {/* Forensic Detail Modal */}
            <AuditDetailModal
                isOpen={!!selectedLog}
                onClose={() => setSelectedLog(null)}
                log={selectedLog}
                getActionBadge={getActionBadge}
            />

            {/* Confirm Resolve All Alerts Modal */}
            <ConfirmModal
                isOpen={confirmResolveAllModal}
                onClose={() => setConfirmResolveAllModal(false)}
                onConfirm={executeResolveAllAlerts}
                title="¿Resolver todas las alertas?"
                message={`Se marcarán como resueltas las ${openAlertsCount} alertas pendientes de seguridad en el sistema.`}
                confirmText="Resolver Todas"
                cancelText="Cancelar"
                variant="success"
            />
        </div>
    );
};

export default AuditPanel;
