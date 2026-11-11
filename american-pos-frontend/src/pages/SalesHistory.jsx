import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { 
    Search, Eye, Printer, Receipt, X, CornerUpLeft, History, Download, 
    TrendingUp, CreditCard, Wallet, Banknote, Smartphone, Zap, Clock, 
    Layers, RefreshCw, Copy, Check, Calendar, ArrowUpRight, ShieldCheck,
    ShoppingBag
} from 'lucide-react';
import { formatMoney, fetchGlobalSettings, formatDate, isUsdOnlyMode } from '../utils/format';
import RefundModal from '../components/RefundModal';
import ReceiptModal from '../components/ReceiptModal';
import SalesFilters from '../components/SalesFilters';
import SupervisorPinModal from '../components/SupervisorPinModal';
import { useAuth } from '../hooks/AuthContext';
import { useSocket } from '../hooks/SocketContext';
import { triggerHaptic } from '../utils/haptics';

export default function SalesHistory() {
    const { user, hasPermission } = useAuth();
    const canVoidSales = hasPermission('canVoidSales') || ['admin', 'superadmin', 'supervisor', 'owner'].includes(user?.role?.toLowerCase());
    const { socket } = useSocket();
    const [sales, setSales] = useState([]);
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    const [businessSettings, setBusinessSettings] = useState({});
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [users, setUsers] = useState([]);
    
    // Supervisor PIN states for Cashiers
    const [isSupervisorRefundPinOpen, setIsSupervisorRefundPinOpen] = useState(false);
    const [pendingRefundSale, setPendingRefundSale] = useState(null);
    const [refundApprovalId, setRefundApprovalId] = useState(null);
    
    // Pagination & Loading States
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [totalItems, setTotalItems] = useState(0);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [advancedFilters, setAdvancedFilters] = useState(() => {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const today = `${y}-${m}-${day}`;
        return {
            startDate: today,
            endDate: today
        };
    });

    // Clipboard copy state
    const [copiedId, setCopiedId] = useState(null);

    // Modal state
    const [selectedSale, setSelectedSale] = useState(null);
    const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
    const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);

    const isManagerOrAdmin = useMemo(() => {
        const role = String(user?.role || '').toLowerCase();
        return ['admin', 'superadmin', 'owner', 'dueño', 'dueno', 'gerente', 'manager', 'administrador', 'supervisor'].includes(role);
    }, [user?.role]);

    const [registers, setRegisters] = useState([]);

    const fetchRegisters = useCallback(async () => {
        if (!isManagerOrAdmin) return;
        try {
            const { data } = await api.get('/sales/registers');
            if (data && data.registers) {
                setRegisters(data.registers);
            }
        } catch (e) {
            console.warn('Error fetching registers:', e);
        }
    }, [isManagerOrAdmin]);

    const fetchUsers = useCallback(async () => {
        if (user?.role !== 'superadmin') return;
        try {
            const { data } = await api.get('/users');
            setUsers(data || []);
        } catch (e) {
            console.error('Error fetching users:', e);
        }
    }, [user?.role]);

    const fetchBusinessSettings = useCallback(async () => {
        try {
            const res = await api.get('/settings/business');
            setBusinessSettings(res.data || {});
        } catch (e) { console.error('Error fetching settings', e); }
    }, []);

    const fetchSettings = useCallback(async () => {
        const s = await fetchGlobalSettings();
        setSettings(s);
    }, []);

    const fetchPaymentMethods = useCallback(async () => {
        try {
            const { data } = await api.get('/settings/payment-methods');
            setPaymentMethods(data || []);
        } catch (e) {
            console.error('Error fetching payment methods:', e);
        }
    }, []);

    const fetchSales = useCallback(async (pageNum = 1) => {
        try {
            if (pageNum === 1) setLoading(true);
            else setLoadingMore(true);

            const params = { 
                page: pageNum, 
                limit: 50,
                timezoneOffset: new Date().getTimezoneOffset(),
                ...advancedFilters
            };

            const { data: responseData } = await api.get('/sales', { params });
            
            let newSales = [];
            let paginationStats = null;

            if (responseData && responseData.data && responseData.pagination) {
                newSales = responseData.data;
                paginationStats = responseData.pagination;
            } else if (Array.isArray(responseData)) {
                newSales = responseData;
            }

            const sorted = newSales.sort((a, b) => new Date(b.date) - new Date(a.date));

            if (pageNum === 1) {
                setSales(sorted);
            } else {
                setSales(prev => [...prev, ...sorted]);
            }

            if (paginationStats) {
                setHasMore(pageNum < paginationStats.totalPages);
                setTotalItems(paginationStats.totalItems);
            } else {
                setHasMore(newSales.length === 50);
            }

        } catch (error) {
            console.error('Error fetching sales:', error);
            toast.error('Error al sincronizar historial de ventas');
        } finally {
            setLoading(false);
            setLoadingMore(false);
            setIsRefreshing(false);
        }
    }, [advancedFilters]);

    useEffect(() => {
        setPage(1); 
        fetchSales(1);
    }, [advancedFilters, fetchSales]);

    useEffect(() => {
        fetchBusinessSettings();
        fetchSettings();
        fetchPaymentMethods();
        fetchUsers();
        fetchRegisters();
    }, [fetchBusinessSettings, fetchSettings, fetchPaymentMethods, fetchUsers, fetchRegisters]);

    // Real-time Socket.io listener
    const lastSaleUpdateRef = useRef(0);
    useEffect(() => {
        if (!socket) return;
        const handleSaleUpdate = () => {
            const now = Date.now();
            if (now - lastSaleUpdateRef.current < 2000) return;
            lastSaleUpdateRef.current = now;
            console.log('[Socket] Nueva venta detectada. Refrescando historial...');
            setPage(1);
            fetchSales(1);
            fetchRegisters();
        };

        const handleShiftUpdate = () => {
            fetchRegisters();
        };

        socket.on('sale_completed', handleSaleUpdate);
        socket.on('inventory_changed', handleSaleUpdate);
        socket.on('cash_shift_opened', handleShiftUpdate);
        socket.on('cash_shift_closed', handleShiftUpdate);
        socket.on('lan_peer_list_changed', handleShiftUpdate);

        return () => {
            socket.off('sale_completed', handleSaleUpdate);
            socket.off('inventory_changed', handleSaleUpdate);
            socket.off('cash_shift_opened', handleShiftUpdate);
            socket.off('cash_shift_closed', handleShiftUpdate);
            socket.off('lan_peer_list_changed', handleShiftUpdate);
        };
    }, [socket, fetchSales, fetchRegisters]);

    const handleRefresh = () => {
        triggerHaptic('light');
        setIsRefreshing(true);
        fetchSales(1);
    };

    const handleLoadMore = () => {
        if (!loadingMore && hasMore) {
            const next = page + 1;
            setPage(next);
            fetchSales(next);
        }
    };

    const handleCopyId = (id, e) => {
        e?.stopPropagation();
        const shortId = id.split('-')[0].toUpperCase();
        if (navigator.clipboard) {
            navigator.clipboard.writeText(shortId);
        }
        setCopiedId(shortId);
        toast.success(`Ticket #${shortId} copiado`, { duration: 1500 });
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleCopyReference = (ref, e) => {
        e?.stopPropagation();
        const cleanRef = String(ref || '').trim();
        if (!cleanRef) return;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(cleanRef);
        }
        toast.success(`Referencia #${cleanRef} copiada`, { duration: 1500 });
    };

    // Extrae todas las referencias de pago asociadas a una venta (soporta array, JSON string, o campo directo)
    const extractSaleReferences = useCallback((sale) => {
        if (!sale) return [];
        const refs = [];
        let methodsList = sale.paymentMethods || sale.PaymentDetails || sale.splitDetails;
        if (typeof methodsList === 'string') {
            try { methodsList = JSON.parse(methodsList); } catch (_) { methodsList = []; }
        }
        if (Array.isArray(methodsList)) {
            methodsList.forEach(pm => {
                const r = String(pm?.reference || pm?.ref || pm?.paymentReference || '').trim();
                if (r && !refs.includes(r)) {
                    refs.push(r);
                }
            });
        }
        const directRef = String(sale.paymentReference || sale.reference || sale.taxInfo?.reference || '').trim();
        if (directRef && !refs.includes(directRef)) {
            refs.push(directRef);
        }
        if (refs.length === 0 && typeof sale.notes === 'string' && sale.notes.toLowerCase().startsWith('ref:')) {
            const noteRef = sale.notes.substring(4).trim();
            if (noteRef) refs.push(noteRef);
        }
        return refs;
    }, []);

    const handleViewDetails = async (sale) => {
        triggerHaptic('light');
        const fullSale = { ...sale, _autoPrint: false };
        if (!fullSale.SaleItems && !fullSale.items) {
            try {
                const res = await api.get(`/sales/${fullSale.id}/items`);
                fullSale.SaleItems = res.data;
            } catch (e) { console.error('Error fetching items', e); }
        }
        setSelectedSale(fullSale);
        setIsReceiptModalOpen(true);
    };

    const handlePrint = async (sale) => {
        triggerHaptic('light');
        const fullSale = { ...sale, _autoPrint: true, _autoPrintNonce: Date.now() };
        if (!fullSale.SaleItems && !fullSale.items) {
            try {
                const res = await api.get(`/sales/${fullSale.id}/items`);
                fullSale.SaleItems = res.data;
            } catch (e) { console.error('Error fetching items', e); }
        }
        setSelectedSale(fullSale);
        setIsReceiptModalOpen(true);
    };

    const handleOpenRefund = async (sale, approvalId = null) => {
        triggerHaptic('medium');
        if (!sale.SaleItems && !sale.items) {
            try {
                const res = await api.get(`/sales/${sale.id}/items`);
                sale.SaleItems = res.data;
            } catch (e) { console.error('Error fetching items', e); }
        }
        setSelectedSale(sale);
        setRefundApprovalId(approvalId || null);
        setIsRefundModalOpen(true);
    };

    const handleInitiateRefund = (sale) => {
        if (canVoidSales) {
            handleOpenRefund(sale);
        } else {
            setPendingRefundSale(sale);
            setIsSupervisorRefundPinOpen(true);
        }
    };

    const handleExportCSV = async () => {
        try {
            toast.loading('Generando reporte CSV...', { id: 'csv-toast' });
            const rangeStr = advancedFilters.startDate ? 'custom' : '30d'; 
            let path = `/reports/bi/export?range=${rangeStr}`;
            if (rangeStr === 'custom') {
                if (advancedFilters.startDate) path += `&startDate=${advancedFilters.startDate}`;
                if (advancedFilters.endDate) path += `&endDate=${advancedFilters.endDate}`;
            }
            
            const response = await api.get(path, { responseType: 'blob' });
            
            let filename = `reporte_ventas_${rangeStr}.csv`;
            const disposition = response.headers['content-disposition'];
            if (disposition && disposition.indexOf('filename=') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                    filename = matches[1].replace(/['"]/g, '');
                }
            }
            
            const blob = new Blob([response.data], { type: response.headers['content-type'] || 'text/csv' });
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(downloadUrl);
            toast.success('Reporte exportado con éxito', { id: 'csv-toast' });
        } catch (error) {
            console.error('Error al exportar datos', error);
            toast.error('Error al exportar reporte CSV', { id: 'csv-toast' });
        }
    };

    const translateMethod = useCallback((method) => {
        const hardcoded = {
            'cash': 'Efectivo',
            'cash_bs': 'Efectivo Bs',
            'cash_usd': 'Efectivo $',
            'efectivo_bs': 'Efectivo Bs',
            'efectivo_usd': 'Efectivo $',
            'card': 'Punto de Venta',
            'debit': 'Punto de Venta',
            'punto_de_venta': 'Punto de Venta',
            'pago_movil': 'Pago Móvil',
            'biopago': 'Biopago BDV',
            'transfer': 'Transfer / Pago Móvil',
            'transferencia': 'Transferencia',
            'zelle': 'Zelle',
            'fiado': 'Fiado (Crédito)',
            'mixed': 'Pago Mixto'
        };

        if (hardcoded[method]) return hardcoded[method];
        const dynamic = paymentMethods.find(pm => pm.id === method || String(pm.id).toLowerCase() === String(method).toLowerCase());
        if (dynamic) return dynamic.name;

        if (typeof method === 'string' && method.startsWith('method_')) {
            return method.substring(0, 15) + '...';
        }

        return method || 'Otro';
    }, [paymentMethods]);

    // Payment method badge styling with semantic colors and icons
    const renderMethodBadge = (method, sale = null) => {
        const m = (method || '').toLowerCase();
        let config = {
            label: translateMethod(method),
            icon: Wallet
        };

        if (m.includes('cash') || m.includes('efectivo')) {
            config = {
                label: translateMethod(method),
                icon: Banknote
            };
        } else if (m === 'card' || m === 'debit' || m.includes('punto') || m.includes('tarjeta')) {
            config = {
                label: translateMethod(method),
                icon: CreditCard
            };
        } else if (m === 'pago_movil' || m === 'transfer' || m.includes('movil') || m.includes('transferencia')) {
            config = {
                label: translateMethod(method),
                icon: Smartphone
            };
        } else if (m === 'zelle') {
            config = {
                label: 'Zelle',
                icon: Zap
            };
        } else if (m === 'fiado' || m.includes('credito')) {
            config = {
                label: 'Fiado (Crédito)',
                icon: Clock
            };
        } else if (m === 'mixed' || m.includes('mixto')) {
            config = {
                label: 'Pago Mixto',
                icon: Layers
            };
        }

        const Icon = config.icon;
        const refs = sale ? extractSaleReferences(sale) : [];

        return (
            <div className="inline-flex flex-col items-start gap-1">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <Icon size={12} className="text-slate-500 shrink-0" />
                    <span className="truncate max-w-[130px]">{config.label}</span>
                </span>
                {refs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                        {refs.map((refVal, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={(e) => handleCopyReference(refVal, e)}
                                title={`Clic para copiar referencia #${refVal}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 border border-sky-200/80 dark:border-sky-800/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors cursor-pointer"
                            >
                                <span className="text-[9px] font-semibold uppercase text-sky-500 dark:text-sky-400">Ref:</span>
                                <span>#{refVal}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // Filter by search term
    const filteredSales = useMemo(() => {
        if (!Array.isArray(sales)) return [];
        return (sales || []).filter(s => {
            const term = searchTerm.toLowerCase().trim();
            if (!term) return true;
            const matchesName = (s.customerName || '').toLowerCase().includes(term);
            const matchesId = (s.id || '').toString().toLowerCase().includes(term);
            const matchesShortId = (s.id || '').split('-')[0].toLowerCase().includes(term);
            const dailyNum = s.dailyTicketNumber || s.taxInfo?.dailyTicketNumber;
            const matchesDailyTicket = dailyNum && (`ticket ${dailyNum}`.includes(term) || `#${dailyNum}` === term || String(dailyNum) === term);
            const matchesMethod = (s.paymentMethod || '').toLowerCase().includes(term) ||
                translateMethod(s.paymentMethod).toLowerCase().includes(term);
            const refs = extractSaleReferences(s);
            const matchesReference = refs.some(r => r.toLowerCase().includes(term) || `#${r.toLowerCase()}`.includes(term));
            return matchesName || matchesId || matchesShortId || matchesDailyTicket || matchesMethod || matchesReference;
        });
    }, [sales, searchTerm, translateMethod, extractSaleReferences]);

    // Live KPI Metrics computed dynamically from filtered sales
    const metrics = useMemo(() => {
        const list = filteredSales || [];
        let totalAmount = 0;
        let completedCount = 0;
        let refundedCount = 0;
        let cancelledCount = 0;
        const methodCounts = {};

        list.forEach(sale => {
            if (sale.status === 'cancelled') {
                cancelledCount++;
                return;
            }
            if (sale.status === 'refunded') {
                refundedCount++;
            }
            completedCount++;
            totalAmount += parseFloat(sale.total) || 0;

            const method = sale.paymentMethod || 'other';
            methodCounts[method] = (methodCounts[method] || 0) + 1;
        });

        let topMethod = null;
        let topMethodCount = 0;
        Object.entries(methodCounts).forEach(([m, count]) => {
            if (count > topMethodCount) {
                topMethodCount = count;
                topMethod = m;
            }
        });

        const avgTicket = completedCount > 0 ? (totalAmount / completedCount) : 0;
        const topMethodPct = completedCount > 0 ? Math.round((topMethodCount / completedCount) * 100) : 0;

        return {
            totalAmount,
            completedCount,
            refundedCount,
            cancelledCount,
            avgTicket,
            topMethod: topMethod ? translateMethod(topMethod) : 'N/A',
            topMethodCount,
            topMethodPct
        };
    }, [filteredSales, translateMethod]);

    const renderFormatMoney = (val, forcedCurrency = null) => formatMoney(val, forcedCurrency, settings);

    // Dual Currency renderer: primary currency + reference
    const renderDualCurrency = (amount, isCancelled = false) => {
        const isUsd = isUsdOnlyMode(settings);
        const primary = renderFormatMoney(amount);
        
        if (isUsd) {
            return (
                <div className="flex flex-col items-end">
                    <span className={`text-base sm:text-lg font-black tracking-tight leading-none tabular-nums ${
                        isCancelled ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white group-hover:text-primary-500 transition-colors'
                    }`}>
                        {primary}
                    </span>
                </div>
            );
        }

        const num = parseFloat(amount) || 0;
        const refUsd = `$ ${num.toFixed(2)}`;

        return (
            <div className="flex flex-col items-end">
                <span className={`text-base sm:text-lg font-black tracking-tight leading-none tabular-nums ${
                    isCancelled ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white group-hover:text-primary-500 transition-colors'
                }`}>
                    {primary}
                </span>
                <span className="text-[10px] font-black font-mono text-slate-400 dark:text-slate-400 uppercase tracking-tight mt-1 flex items-center gap-1">
                    <span className="text-[8.5px] px-1 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-bold">Ref</span>
                    <span>{refUsd}</span>
                </span>
            </div>
        );
    };

    const formatDateLocal = (dateString) => {
        if (!dateString) return 'N/A';
        return formatDate(dateString, {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const isAdmin = ['admin', 'superadmin', 'owner', 'supervisor'].includes(user?.role?.toLowerCase());

    return (
        <div className="space-y-5 pb-24 pb-safe animate-in fade-in duration-300">
            {/* Header Corporativo Nivel ERP */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Título y subtítulo */}
                        <div>
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300">
                                    <Receipt size={18} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                            Historial de Ventas
                                        </h1>
                                        <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                            {isAdmin ? 'Registro Maestro' : 'Mis Ventas'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Control cronológico de operaciones, tickets emitidos y auditoría comercial
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Barra de Acciones Superior */}
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                            <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-0.5 shadow-2xs">
                                <button
                                    type="button"
                                    onClick={handleRefresh}
                                    disabled={loading || isRefreshing}
                                    className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                    title="Actualizar listado de ventas"
                                >
                                    <RefreshCw size={13} className={loading || isRefreshing ? 'animate-spin text-primary-500' : ''} />
                                    <span className="hidden sm:inline">Actualizar</span>
                                </button>

                                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

                                <button
                                    type="button"
                                    onClick={handleExportCSV}
                                    className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                    title="Exportar reporte de ventas en CSV"
                                >
                                    <Download size={13} />
                                    <span>Exportar CSV</span>
                                </button>
                            </div>

                            {/* Buscador Integrado */}
                            <div className="relative w-full sm:w-64">
                                <Search size={14} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="Buscar por ticket, ref, cliente o ID..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="block w-full h-9 pl-9 pr-8 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchTerm('')}
                                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Filtros Integrados */}
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <SalesFilters 
                            onFilterChange={setAdvancedFilters}
                            paymentMethods={paymentMethods}
                            users={users}
                            registers={registers}
                            initialFilters={advancedFilters}
                        />
                    </div>
                </div>
            </div>

            {/* Tarjetas de Métricas Ejecutivas / KPIs */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {/* Tarjeta 1: Total Facturado */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Total Facturado
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <TrendingUp size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {renderFormatMoney(metrics.totalAmount)}
                            </div>
                            {!isUsdOnlyMode(settings) && (
                                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    Ref: $ {metrics.totalAmount.toFixed(2)}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Tarjeta 2: Transacciones */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Transacciones
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <Receipt size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {metrics.completedCount}{' '}
                                <span className="text-xs font-normal text-slate-500">ventas</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {metrics.cancelledCount > 0 ? (
                                    <span className="text-rose-600 dark:text-rose-400 font-medium">{metrics.cancelledCount} anuladas</span>
                                ) : (
                                    <span>100% efectivas</span>
                                )}
                                {metrics.refundedCount > 0 && ` · ${metrics.refundedCount} reembolsos`}
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 3: Ticket Promedio */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Ticket Promedio
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <CreditCard size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {renderFormatMoney(metrics.avgTicket)}
                            </div>
                            {!isUsdOnlyMode(settings) && (
                                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    Ref: $ {metrics.avgTicket.toFixed(2)} / ticket
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Tarjeta 4: Método Principal */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Método Principal
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <Wallet size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                                {metrics.topMethod}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {metrics.completedCount > 0 ? `${metrics.topMethodPct}% de operaciones` : 'Sin registros'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid de Ventas Principal */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    {/* Vista Desktop / Tabla Contable */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                                    <th className="px-4 py-3 text-left">Fecha y Hora</th>
                                    <th className="px-4 py-3 text-left">Ticket / Terminal</th>
                                    <th className="px-4 py-3 text-left">Cliente</th>
                                    <th className="px-4 py-3 text-left">Tipo Doc</th>
                                    <th className="px-4 py-3 text-left">Método</th>
                                    <th className="px-4 py-3 text-right">Total Venta</th>
                                    <th className="px-4 py-3 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {loading ? (
                                    <tr>
                                        <td colSpan="7" className="py-20 text-center">
                                            <div className="inline-flex flex-col items-center gap-2 text-slate-600 dark:text-slate-300">
                                                <RefreshCw size={22} className="animate-spin text-primary-500 mb-1" />
                                                <span className="font-medium text-xs">Indexando transacciones...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredSales.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="py-16 text-center">
                                            <div className="max-w-sm mx-auto space-y-2">
                                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                                                    <Receipt size={20} />
                                                </div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                    No se encontraron transacciones
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    Ajusta los filtros o el rango de fechas seleccionado.
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredSales.map((sale) => {
                                        const isCancelled = sale.status === 'cancelled';
                                        const isRefunded = sale.status === 'refunded';
                                        const shortId = sale.id.split('-')[0].toUpperCase();
                                        const dailyTicketNum = sale.dailyTicketNumber || sale.taxInfo?.dailyTicketNumber || null;

                                        return (
                                            <tr 
                                                key={sale.id} 
                                                className={`transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30 ${
                                                    isCancelled ? 'opacity-60 bg-rose-50/20 dark:bg-rose-950/10' : ''
                                                }`}
                                            >
                                                {/* 1. FECHA */}
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-900 dark:text-white font-medium">
                                                            {formatDateLocal(sale.date).split(',')[0]}
                                                        </span>
                                                        <span className="text-slate-500 dark:text-slate-400 text-[11px] font-mono mt-0.5">
                                                            {formatDateLocal(sale.date).split(',')[1]}
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* 2. TICKET / CAJA */}
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col gap-0.5 items-start">
                                                        <div className="flex items-center gap-1.5">
                                                            {dailyTicketNum && (
                                                                <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                                                                    #{dailyTicketNum}
                                                                </span>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleCopyId(sale.id, e)}
                                                                className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group cursor-pointer"
                                                                title="Copiar ID de Venta"
                                                            >
                                                                <span>({shortId})</span>
                                                                {copiedId === shortId ? (
                                                                    <Check size={11} className="text-emerald-500" />
                                                                ) : (
                                                                    <Copy size={11} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                )}
                                                            </button>
                                                        </div>
                                                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                                            {sale.registerName || (sale.registerId ? `Caja ${sale.registerId}` : 'Caja 1')}
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* 3. CLIENTE */}
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-900 dark:text-slate-100 font-medium truncate max-w-[180px]">
                                                            {sale.customerName || 'Cliente Ocasional'}
                                                        </span>
                                                        {(isCancelled || isRefunded) && (
                                                            <span className={`text-[10px] font-medium mt-0.5 inline-flex items-center gap-1 ${
                                                                isCancelled ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                                                            }`}>
                                                                <span className={`w-1.5 h-1.5 rounded-full ${isCancelled ? 'bg-rose-500' : 'bg-amber-500'}`} />
                                                                <span>{isCancelled ? 'Anulada' : 'Reembolsada'}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* 4. TIPO DOC */}
                                                <td className="px-4 py-3">
                                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                        {sale.documentType === 'nota_entrega' ? 'Nota Entrega' : 'Factura'}
                                                    </span>
                                                </td>

                                                {/* 5. MÉTODO */}
                                                <td className="px-4 py-3">
                                                    {renderMethodBadge(sale.paymentMethod, sale)}
                                                </td>

                                                {/* 6. TOTAL VENTA */}
                                                <td className="px-4 py-3 text-right">
                                                    {renderDualCurrency(sale.total, isCancelled)}
                                                </td>

                                                {/* 7. ACCIONES AGRUPADAS */}
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex items-center justify-end rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-x divide-slate-200 dark:divide-slate-700 shadow-2xs">
                                                        {!isRefunded && !isCancelled && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); handleInitiateRefund(sale); }}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                                                                title={canVoidSales ? "Anular o Reembolsar Venta" : "Anular Venta (Requiere PIN de Supervisor)"}
                                                            >
                                                                <CornerUpLeft size={13} />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleViewDetails(sale)}
                                                            className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                            title="Ver Detalle y Factura"
                                                        >
                                                            <Eye size={13} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrint(sale)}
                                                            className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                            title="Imprimir Ticket"
                                                        >
                                                            <Printer size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile View Card System */}
                    <div className="md:hidden p-3.5 sm:p-5 space-y-3">
                        {loading ? (
                            <div className="py-20 text-center animate-pulse text-primary-500 font-black uppercase text-xs tracking-widest flex flex-col items-center gap-2">
                                <RefreshCw size={24} className="animate-spin" />
                                Sincronizando...
                            </div>
                        ) : filteredSales.length === 0 ? (
                            <div className="py-20 text-center text-slate-500 font-black uppercase text-xs tracking-widest">
                                No hay registros
                            </div>
                        ) : (
                            filteredSales.map((sale) => {
                                const isCancelled = sale.status === 'cancelled';
                                const isRefunded = sale.status === 'refunded';
                                const shortId = sale.id.split('-')[0].toUpperCase();

                                return (
                                    <div 
                                        key={sale.id} 
                                        className={`bg-slate-50 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 space-y-3 shadow-md ${
                                            isCancelled ? 'opacity-65 border-rose-500/30' : ''
                                        }`}
                                    >
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-black text-slate-900 dark:text-white text-sm uppercase tracking-tight truncate">
                                                    {sale.customerName || 'Cliente Ocasional'}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleCopyId(sale.id, e)}
                                                        className="text-[9px] font-mono font-black text-primary-500 bg-primary-500/10 px-2 py-0.5 rounded border border-primary-500/20"
                                                    >
                                                        #{shortId}
                                                    </button>
                                                    <span className="text-[8.5px] font-black bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded uppercase">
                                                        {sale.registerName || (sale.registerId ? `Caja ${sale.registerId}` : 'Caja 1')}
                                                    </span>
                                                    {sale.documentType === 'nota_entrega' ? (
                                                        <span className="text-[8.5px] font-black text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase">
                                                            Nota
                                                        </span>
                                                    ) : (
                                                        <span className="text-[8.5px] font-black text-sky-500 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20 uppercase">
                                                            Factura
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                {renderDualCurrency(sale.total, isCancelled)}
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight mt-1">
                                                    {formatDateLocal(sale.date).split(',')[0]}
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center justify-between border-t border-slate-100 dark:border-white/5 pt-3">
                                            <div>
                                                {renderMethodBadge(sale.paymentMethod, sale)}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <button 
                                                    onClick={() => handleViewDetails(sale)} 
                                                    className="w-8 h-8 flex items-center justify-center bg-sky-500/10 border border-sky-500/25 text-sky-500 rounded-lg active:scale-95"
                                                    title="Ver Detalle"
                                                >
                                                    <Eye size={15} />
                                                </button>
                                                <button 
                                                    onClick={() => handlePrint(sale)} 
                                                    className="w-8 h-8 flex items-center justify-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 rounded-lg active:scale-95"
                                                    title="Imprimir"
                                                >
                                                    <Printer size={15} />
                                                </button>
                                                {!isRefunded && !isCancelled && (
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleInitiateRefund(sale); }} 
                                                        className="w-8 h-8 flex items-center justify-center bg-rose-500/10 border border-rose-500/25 text-rose-500 rounded-lg active:scale-95"
                                                        title={canVoidSales ? "Anular" : "Anular (Requiere PIN)"}
                                                    >
                                                        <CornerUpLeft size={15} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Load More Button & Summary Bar */}
                    <div className="p-4 sm:p-6 bg-slate-50/50 dark:bg-black/20 border-t border-slate-200/60 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Mostrando {filteredSales.length} de {totalItems} transacciones
                        </span>

                        {hasMore && !searchTerm && (
                            <button 
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                                className="w-full sm:w-auto min-h-[42px] flex items-center justify-center bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-800 dark:text-white px-6 sm:px-8 py-2 rounded-xl text-xs font-black uppercase tracking-wider border border-slate-200 dark:border-white/10 transition-all active:scale-95 disabled:opacity-50 group shadow-sm"
                            >
                                {loadingMore ? 'Cargando más...' : 'Cargar Más Registros'}
                                {!loadingMore && <History size={14} className="inline ml-2 group-hover:rotate-180 transition-transform duration-500 text-primary-500" />}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Refund Modal */}
            <RefundModal
                isOpen={isRefundModalOpen}
                onClose={() => {
                    setIsRefundModalOpen(false);
                    setRefundApprovalId(null);
                }}
                sale={selectedSale}
                onRefundSuccess={fetchSales}
                initialApprovalId={refundApprovalId}
            />

            {isSupervisorRefundPinOpen && (
                <SupervisorPinModal
                    isOpen={isSupervisorRefundPinOpen}
                    onClose={() => {
                        setIsSupervisorRefundPinOpen(false);
                        setPendingRefundSale(null);
                    }}
                    onApprove={(approvalId) => {
                        setIsSupervisorRefundPinOpen(false);
                        if (pendingRefundSale) {
                            handleOpenRefund(pendingRefundSale, approvalId);
                            setPendingRefundSale(null);
                        }
                    }}
                    actionType="ANULAR / REEMBOLSAR FACTURA"
                    referenceId={pendingRefundSale?.id || 'REFUND'}
                />
            )}

            {/* Official Unified Receipt Modal with HD Thermal Design & WhatsApp / Email Sharing */}
            <ReceiptModal
                isOpen={isReceiptModalOpen}
                onClose={() => setIsReceiptModalOpen(false)}
                sale={selectedSale ? { ...selectedSale, isReprint: true } : null}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
                currencyMode={settings.currencyMode}
                paymentMethods={paymentMethods}
                onRefund={selectedSale && selectedSale?.status !== 'refunded' && selectedSale?.status !== 'cancelled' ? () => {
                    setIsReceiptModalOpen(false);
                    handleInitiateRefund(selectedSale);
                } : null}
            />
        </div>
    );
}
