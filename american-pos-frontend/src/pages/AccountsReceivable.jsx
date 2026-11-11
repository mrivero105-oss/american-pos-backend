import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { 
    Search, Users, Star, Banknote, X, 
    History as HistoryIcon, Download,
    TrendingUp, DollarSign, MessageCircle,
    AlertCircle, FileText, CheckCircle2,
    Eye, RefreshCw, Copy, Check, Clock,
    AlertTriangle, ShieldCheck
} from 'lucide-react';
import AbonoModal from '../components/AbonoModal';
import CreditHistoryModal from '../components/CreditHistoryModal';
import ReceiptModal from '../components/ReceiptModal';
import AccountStatementModal from '../components/AccountStatementModal';
import Customer360Modal from '../components/Customer360Modal';
import { formatMoney, fetchGlobalSettings, isUsdOnlyMode } from '../utils/format';
import { triggerHaptic } from '../utils/haptics';

export default function AccountsReceivable() {
    const [customers, setCustomers] = useState([]);
    const [summary, setSummary] = useState({ 
        totalAmount: 0, 
        totalCustomers: 0,
        averageExposure: 0,
        aging: { current: 0, warning: 0, overdue: 0, critical: 0 }
    });
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterBracket, setFilterBracket] = useState('ALL'); // 'ALL' | 'CURRENT' | 'WARNING' | 'OVERDUE' | 'CRITICAL'
    const [copiedDoc, setCopiedDoc] = useState(null);
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    const [businessSettings, setBusinessSettings] = useState({});
    const [paymentMethods, setPaymentMethods] = useState([]);
    
    // Modal state
    const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
    const [is360ModalOpen, setIs360ModalOpen] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [processing, setProcessing] = useState(false);

    // Receipt Modal state
    const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
    const [selectedSale, setSelectedSale] = useState(null);

    useEffect(() => {
        fetchData();
        loadSettings();
        fetchBusinessSettings();
        fetchPaymentMethods();
    }, []);

    const loadSettings = async () => {
        const s = await fetchGlobalSettings();
        setSettings(s);
    };

    const fetchBusinessSettings = async () => {
        try {
            const res = await api.get('/settings/business');
            setBusinessSettings(res.data || {});
        } catch (e) {
            console.error('Error fetching business settings', e);
        }
    };

    const fetchPaymentMethods = async () => {
        try {
            const { data } = await api.get('/settings/payment-methods');
            setPaymentMethods(data || []);
        } catch (e) {
            console.error('Error fetching payment methods:', e);
        }
    };

    const fetchData = async () => {
        try {
            setLoading(true);
            const res = await api.get('/reports/bi/accounts-receivable');
            setCustomers(res.data.customers || []);
            setSummary(res.data.summary || { 
                totalAmount: 0, 
                totalCustomers: 0,
                averageExposure: 0,
                aging: { current: 0, warning: 0, overdue: 0, critical: 0 }
            });
        } catch (error) {
            console.error('Error fetching accounts receivable:', error);
            toast.error('Error al cargar cuentas por cobrar');
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };

    const handleRefresh = () => {
        triggerHaptic('light');
        setIsRefreshing(true);
        fetchData();
    };

    const handleOpenHistory = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsHistoryModalOpen(true);
    };

    const handleOpenStatement = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsStatementModalOpen(true);
    };

    const handleOpen360 = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIs360ModalOpen(true);
    };

    const handleViewReceipt = async (saleId) => {
        try {
            const res = await api.get(`/sales/${saleId}`);
            setSelectedSale(res.data);
            setIsReceiptModalOpen(true);
        } catch (error) {
            console.error('Error fetching sale details:', error);
            toast.error('Error al obtener los detalles de la venta');
        }
    };

    const handleRegisterAbono = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsAbonoModalOpen(true);
    };

    const handleSaveAbono = async (abonoData) => {
        try {
            setProcessing(true);
            await api.post(`/customers/${abonoData.customerId}/payment`, {
                amount: abonoData.amount,
                currency: abonoData.currency || 'USD',
                exchangeRate: abonoData.exchangeRate || settings.rate || 1,
                method: abonoData.method,
                notes: abonoData.notes,
                saleIds: abonoData.saleIds,
                cryptoRate: abonoData.cryptoRate,
                cryptoAmount: abonoData.cryptoAmount,
                reference: abonoData.reference
            });
            toast.success('Abono registrado con éxito y conciliado en caja');
            fetchData();
            setIsAbonoModalOpen(false);
        } catch (error) {
            console.error('Error registering payment:', error);
            toast.error('Error al registrar abono: ' + (error.response?.data?.error || error.message));
        } finally {
            setProcessing(false);
        }
    };

    const handleExportCSV = async () => {
        try {
            const toastId = toast.loading('Exportando reporte de cuentas por cobrar...');
            const response = await api.get('/reports/bi/accounts-receivable/export', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `cuentas_por_cobrar_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.dismiss(toastId);
            toast.success('Cuentas por cobrar exportadas exitosamente');
        } catch (error) {
            console.error('Export AR error:', error);
            toast.error('Error al exportar cuentas por cobrar');
        }
    };

    const handleSendWhatsApp = (customer) => {
        triggerHaptic('light');
        if (!customer.phone) {
            toast.error('El cliente no tiene teléfono registrado');
            return;
        }
        const debtUsd = parseFloat(customer.creditBalance) || 0;
        const rate = settings.rate || 1;
        const debtBs = (debtUsd * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const bizName = businessSettings.name || 'American POS';
        
        let msg = `Estimado(a) *${customer.name}*, le contactamos de *${bizName}*.\n\n`;
        msg += `Le recordamos amablemente que mantiene un saldo pendiente de *$${debtUsd.toFixed(2)} USD* (${debtBs} Bs).\n`;
        if (customer.daysOverdue > 7) {
            msg += `Antigüedad de la cuenta: *${customer.daysOverdue} días*.\n`;
        }
        msg += `\nAgradecemos coordinar la conciliación de su saldo. Si ya efectuó su pago, por favor compártanos el comprobante por este medio.\n\n`;
        msg += `Saludos cordiales.`;

        const phone = customer.phone.replace(/[^0-9]/g, '');
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    };

    const handleCopyDoc = (doc, e) => {
        e?.stopPropagation();
        if (!doc || doc === '---') return;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(doc);
        }
        setCopiedDoc(doc);
        toast.success(`Documento ${doc} copiado`, { duration: 1500 });
        setTimeout(() => setCopiedDoc(null), 2000);
    };

    // Filter customers by Search and by Aging Bracket
    const filteredCustomers = customers.filter(c => {
        const matchesSearch = (c.name && c.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                              (c.idDocument && c.idDocument.toLowerCase().includes(searchTerm.toLowerCase())) ||
                              (c.phone && c.phone.includes(searchTerm));
        
        if (!matchesSearch) return false;
        if (filterBracket === 'ALL') return true;
        return c.agingBracket === filterBracket;
    });

    const getAgingBadge = (bracket) => {
        switch (bracket) {
            case 'CRITICAL':
                return { 
                    label: 'Crítico (>30d)', 
                    className: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60',
                    dotColor: 'bg-rose-500'
                };
            case 'OVERDUE':
                return { 
                    label: 'Vencido (16-30d)', 
                    className: 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60',
                    dotColor: 'bg-amber-500'
                };
            case 'WARNING':
                return { 
                    label: 'Preventivo (8-15d)', 
                    className: 'text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50',
                    dotColor: 'bg-amber-400'
                };
            default:
                return { 
                    label: 'Corriente (0-7d)', 
                    className: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
                    dotColor: 'bg-emerald-500'
                };
        }
    };

    const formatNumber = (num) => {
        return Number(num || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    const isUsd = isUsdOnlyMode(settings);
    const criticalCount = customers.filter(c => c.agingBracket === 'CRITICAL').length;
    const warningCount = customers.filter(c => c.agingBracket === 'WARNING' || c.agingBracket === 'OVERDUE').length;

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
                                    <Banknote size={18} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                            Cuentas por Cobrar
                                        </h1>
                                        <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                            Cartera Comercial
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Monitoreo de vencimientos, antigüedad de mora y conciliación de créditos
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
                                    title="Actualizar cartera"
                                >
                                    <RefreshCw size={13} className={loading || isRefreshing ? 'animate-spin text-primary-500' : ''} />
                                    <span className="hidden sm:inline">Actualizar</span>
                                </button>

                                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

                                <button
                                    type="button"
                                    onClick={handleExportCSV}
                                    className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                    title="Exportar reporte de cuentas por cobrar en CSV"
                                >
                                    <Download size={13} />
                                    <span>Exportar Cartera</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Toolbar: Segmented Aging Control y Búsqueda */}
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                        {/* Selector de Tramos de Vencimiento */}
                        <div className="inline-flex items-center overflow-x-auto p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 gap-1 text-xs">
                            <button
                                type="button"
                                onClick={() => setFilterBracket('ALL')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 cursor-pointer ${
                                    filterBracket === 'ALL'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                Todos ({customers.length})
                            </button>

                            <button
                                type="button"
                                onClick={() => setFilterBracket('CURRENT')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                    filterBracket === 'CURRENT'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span>0-7d</span>
                                <span className="text-[10px] font-mono text-slate-500">
                                    (${formatNumber(summary.aging?.current || 0)})
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setFilterBracket('WARNING')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                    filterBracket === 'WARNING'
                                        ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-amber-600'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                <span>8-15d</span>
                                <span className="text-[10px] font-mono text-slate-500">
                                    (${formatNumber(summary.aging?.warning || 0)})
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setFilterBracket('OVERDUE')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                    filterBracket === 'OVERDUE'
                                        ? 'bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-amber-700'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                <span>16-30d</span>
                                <span className="text-[10px] font-mono text-slate-500">
                                    (${formatNumber(summary.aging?.overdue || 0)})
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setFilterBracket('CRITICAL')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                    filterBracket === 'CRITICAL'
                                        ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-rose-600'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                <span>+30d</span>
                                <span className="text-[10px] font-mono text-slate-500">
                                    (${formatNumber(summary.aging?.critical || 0)})
                                </span>
                            </button>
                        </div>

                        {/* Campo de Búsqueda */}
                        <div className="relative flex-1 md:max-w-md">
                            <Search size={14} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar por cliente, documento, RIF o teléfono..."
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
            </div>

            {/* Tarjetas de Métricas Financieras (KPIs) */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    {/* Tarjeta 1: Deuda Consolidada */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Deuda Consolidada
                            </span>
                            <div className="w-7 h-7 rounded-md bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
                                <TrendingUp size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                $ {formatNumber(summary.totalAmount)}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                {!isUsd ? (
                                    <span>Ref. Bs {formatNumber(summary.totalAmount * (settings.rate || 1))}</span>
                                ) : (
                                    <span>Total exigible en cartera</span>
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 2: Total Deudores */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Deudores Activos
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <Users size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {summary.totalCustomers}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {criticalCount > 0 ? (
                                    <span className="text-rose-600 dark:text-rose-400 font-medium">
                                        {criticalCount} cuentas en mora crítica (&gt;30d)
                                    </span>
                                ) : (
                                    <span>Sin cuentas en mora crítica</span>
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 3: Exposición Promedio */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Exposición Promedio
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <DollarSign size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                $ {formatNumber(summary.averageExposure || 0)}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Riesgo estimado por deudor
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid de Cuentas por Cobrar */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    {/* Vista Desktop / Tabla Contable */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                                    <th className="px-4 py-3 text-left">Cliente / Razón Social</th>
                                    <th className="px-4 py-3 text-left">Documento / RIF</th>
                                    <th className="px-4 py-3 text-center">Antigüedad de Mora</th>
                                    <th className="px-4 py-3 text-right">Límite Crédito</th>
                                    <th className="px-4 py-3 text-right">Saldo Exigible</th>
                                    <th className="px-4 py-3 text-right">Gestión & Cobranza</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {loading ? (
                                    <tr>
                                        <td colSpan="6" className="py-20 text-center">
                                            <div className="inline-flex flex-col items-center gap-2 text-slate-600 dark:text-slate-300">
                                                <RefreshCw size={22} className="animate-spin text-primary-500 mb-1" />
                                                <span className="font-medium text-xs">Cargando cuentas por cobrar...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredCustomers.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="py-16 text-center">
                                            <div className="max-w-sm mx-auto space-y-2">
                                                <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                                                    <CheckCircle2 size={20} />
                                                </div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                    Cartera al día
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    No se encontraron saldos pendientes bajo el criterio seleccionado.
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredCustomers.map((customer) => {
                                        const creditBal = parseFloat(customer.creditBalance) || 0;
                                        const creditLim = parseFloat(customer.creditLimit) || 0;
                                        const agingInfo = getAgingBadge(customer.agingBracket);
                                        const rate = settings.rate || 1;
                                        const refBs = (creditBal * rate).toFixed(2);

                                        return (
                                            <tr 
                                                key={customer.id} 
                                                className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                                            >
                                                {/* 1. Cliente */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div 
                                                            onClick={() => handleOpen360(customer)}
                                                            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0 cursor-pointer hover:border-primary-500 transition-colors"
                                                            title="Ver expediente 360°"
                                                        >
                                                            {(customer.name || 'C').charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpen360(customer)}
                                                                    className="font-medium text-slate-900 dark:text-white truncate hover:text-primary-600 dark:hover:text-primary-400 transition-colors text-left cursor-pointer"
                                                                    title="Ver expediente 360°"
                                                                >
                                                                    {customer.name}
                                                                </button>
                                                                {customer.isVIP && (
                                                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-1.5 py-0.2 rounded">
                                                                        <Star size={9} fill="currentColor" /> VIP
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {customer.phone ? (
                                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono block mt-0.5">
                                                                    {customer.phone}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                                                                    Sin teléfono
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* 2. Documento */}
                                                <td className="px-4 py-3">
                                                    {customer.idDocument && customer.idDocument !== '---' ? (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleCopyDoc(customer.idDocument, e)}
                                                            className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group cursor-pointer"
                                                            title="Copiar documento"
                                                        >
                                                            <span>{customer.idDocument}</span>
                                                            {copiedDoc === customer.idDocument ? (
                                                                <Check size={12} className="text-emerald-500" />
                                                            ) : (
                                                                <Copy size={12} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                            )}
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-400 font-mono text-xs">---</span>
                                                    )}
                                                </td>

                                                {/* 3. Antigüedad de Mora */}
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-medium border ${agingInfo.className}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${agingInfo.dotColor}`} />
                                                        <span>{agingInfo.label}</span>
                                                        <span className="font-mono text-[10px] opacity-75">({customer.daysOverdue}d)</span>
                                                    </span>
                                                </td>

                                                {/* 4. Límite de Crédito */}
                                                <td className="px-4 py-3 text-right">
                                                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                                                        $ {formatNumber(creditLim)}
                                                    </span>
                                                </td>

                                                {/* 5. Saldo Exigible */}
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex flex-col items-end">
                                                        <span className="font-mono font-bold text-xs text-rose-600 dark:text-rose-400">
                                                            $ {formatNumber(creditBal)}
                                                        </span>
                                                        {!isUsd && (
                                                            <span className="text-[10px] font-mono text-slate-400">
                                                                Ref. Bs {formatNumber(refBs)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* 6. Gestión & Cobranza */}
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex items-center justify-end gap-1.5">
                                                        {/* Acción Primaria: Abonar */}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRegisterAbono(customer)}
                                                            className="h-7 px-2.5 inline-flex items-center gap-1 bg-primary-600 hover:bg-primary-700 text-white rounded-md text-xs font-medium shadow-2xs transition-colors cursor-pointer"
                                                            title="Registrar abono de deuda"
                                                        >
                                                            <Banknote size={13} />
                                                            <span>Abonar</span>
                                                        </button>

                                                        {/* WhatsApp */}
                                                        {customer.phone && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSendWhatsApp(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800/40 transition-colors cursor-pointer"
                                                                title="Enviar recordatorio de cobro formal por WhatsApp"
                                                            >
                                                                <MessageCircle size={14} />
                                                            </button>
                                                        )}

                                                        {/* Botonera Agrupada de Auditoría */}
                                                        <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-x divide-slate-200 dark:divide-slate-700 shadow-2xs">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpen360(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                                title="Expediente 360° del cliente"
                                                            >
                                                                <Eye size={13} />
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenStatement(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                                title="Estado de cuenta oficial"
                                                            >
                                                                <FileText size={13} />
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenHistory(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                                title="Historial de créditos y pagos"
                                                            >
                                                                <HistoryIcon size={13} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Vista Móvil / Tarjetas Contables */}
                    <div className="md:hidden p-3.5 space-y-3">
                        {loading ? (
                            <div className="py-12 text-center text-slate-500 font-medium text-xs flex flex-col items-center gap-2">
                                <RefreshCw size={20} className="animate-spin text-primary-500" />
                                <span>Cargando cuentas por cobrar...</span>
                            </div>
                        ) : filteredCustomers.length === 0 ? (
                            <div className="py-10 text-center text-slate-400 space-y-1">
                                <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-1" />
                                <p className="text-xs font-semibold">Cartera al día</p>
                                <p className="text-[11px] text-slate-400">Sin deudores en esta categoría</p>
                            </div>
                        ) : (
                            filteredCustomers.map((customer) => {
                                const creditBal = parseFloat(customer.creditBalance) || 0;
                                const creditLim = parseFloat(customer.creditLimit) || 0;
                                const agingInfo = getAgingBadge(customer.agingBracket);
                                const rate = settings.rate || 1;
                                const refBs = (creditBal * rate).toFixed(2);

                                return (
                                    <div 
                                        key={customer.id} 
                                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 shadow-2xs"
                                    >
                                        {/* Fila 1: Cliente y Saldo Exigible */}
                                        <div className="flex items-start justify-between gap-3">
                                            <div 
                                                onClick={() => handleOpen360(customer)}
                                                className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                                            >
                                                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-300 shrink-0">
                                                    {(customer.name || 'C').charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <h4 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                                            {customer.name}
                                                        </h4>
                                                        {customer.isVIP && (
                                                            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.2 rounded border border-amber-200 dark:border-amber-800/40">
                                                                VIP
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                                        {customer.idDocument || 'Sin documento'}{customer.phone ? ` · ${customer.phone}` : ''}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Saldo Exigible */}
                                            <div className="shrink-0 text-right">
                                                <div className="text-xs font-bold text-rose-600 dark:text-rose-400 font-mono">
                                                    $ {formatNumber(creditBal)}
                                                </div>
                                                {!isUsd && (
                                                    <span className="text-[10px] text-slate-400 font-mono block">
                                                        Ref. Bs {formatNumber(refBs)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Fila 2: Antigüedad y Límite */}
                                        <div className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border ${agingInfo.className}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${agingInfo.dotColor}`} />
                                                <span>{agingInfo.label}</span>
                                                <span className="font-mono opacity-75">({customer.daysOverdue}d)</span>
                                            </span>
                                            <span className="text-slate-500 text-[11px]">
                                                Límite: <strong className="text-slate-700 dark:text-slate-300 font-mono">$ {formatNumber(creditLim)}</strong>
                                            </span>
                                        </div>

                                        {/* Fila 3: Botones de Acción */}
                                        <div className="flex items-center gap-1.5 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => handleRegisterAbono(customer)}
                                                className="flex-1 h-8 px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 bg-primary-600 hover:bg-primary-700 text-white transition-colors cursor-pointer shadow-2xs"
                                            >
                                                <Banknote size={13} />
                                                <span>Abonar</span>
                                            </button>

                                            {customer.phone && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSendWhatsApp(customer)}
                                                    className="h-8 px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 border border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                                                >
                                                    <MessageCircle size={13} />
                                                    <span>WhatsApp</span>
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => handleOpen360(customer)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                                title="Ficha 360°"
                                            >
                                                <Eye size={13} />
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => handleOpenStatement(customer)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                                title="Estado de cuenta"
                                            >
                                                <FileText size={13} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Resumen del Pie */}
                    <div className="px-4 py-3 bg-slate-50/60 dark:bg-slate-800/20 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>
                            Mostrando <strong className="font-semibold text-slate-700 dark:text-slate-300 font-mono">{filteredCustomers.length}</strong> deudores en cartera
                        </span>
                    </div>
                </div>
            </div>

            {/* Modales */}
            <AbonoModal
                isOpen={isAbonoModalOpen}
                onClose={() => setIsAbonoModalOpen(false)}
                onSave={handleSaveAbono}
                customer={selectedCustomer}
                processing={processing}
            />

            <CreditHistoryModal
                isOpen={isHistoryModalOpen}
                onClose={() => setIsHistoryModalOpen(false)}
                customerId={selectedCustomer?.id}
                onViewReceipt={handleViewReceipt}
            />

            <AccountStatementModal
                isOpen={isStatementModalOpen}
                onClose={() => setIsStatementModalOpen(false)}
                customer={selectedCustomer}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
            />

            <Customer360Modal
                isOpen={is360ModalOpen}
                onClose={() => setIs360ModalOpen(false)}
                customerId={selectedCustomer?.id}
                onOpenAbono={handleRegisterAbono}
                onOpenHistory={handleOpenHistory}
                onOpenStatement={handleOpenStatement}
                onOpenRedeem={() => {}}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
            />

            <ReceiptModal
                isOpen={isReceiptModalOpen}
                onClose={() => setIsReceiptModalOpen(false)}
                sale={selectedSale}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
                currencyMode={settings.currencyMode}
                paymentMethods={paymentMethods}
            />
        </div>
    );
}
