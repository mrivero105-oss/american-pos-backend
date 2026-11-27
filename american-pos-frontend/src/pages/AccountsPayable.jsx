import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import {
    Search, 
    Truck, 
    Banknote, 
    History as HistoryIcon, 
    Download, 
    TrendingUp, 
    Receipt as ReceiptIcon, 
    AlertCircle, 
    FilePlus, 
    Eye, 
    Calendar, 
    Clock, 
    ShieldAlert, 
    CheckCircle, 
    CheckCircle2, 
    Layers
} from 'lucide-react';
import SupplierCreditModal from '../components/SupplierCreditModal';
import RegisterSupplierInvoiceModal from '../components/RegisterSupplierInvoiceModal';
import InvoiceViewerModal from '../components/InvoiceViewerModal';
import SupplierPaymentVoucherModal from '../components/SupplierPaymentVoucherModal';
import { fetchGlobalSettings } from '../utils/format';

export default function AccountsPayable() {
    const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'paid' | 'all'
    const [suppliers, setSuppliers] = useState([]);
    const [summary, setSummary] = useState({ totalAmount: 0, totalSuppliers: 0 });
    const [invoiceHistory, setInvoiceHistory] = useState({
        invoices: [],
        paidInvoices: [],
        pendingInvoices: [],
        summary: { totalInvoices: 0, totalPaidCount: 0, totalPaidUsd: 0, totalPendingCount: 0 }
    });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    
    // BCV Verification
    const [bcvRate, setBcvRate] = useState(791.3248);
    const [bcvDate, setBcvDate] = useState(new Date().toISOString().split('T')[0]);
    const [bcvSource, setBcvSource] = useState('BCV Oficial');

    // Modal states
    const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
    const [isRegisterInvoiceOpen, setIsRegisterInvoiceOpen] = useState(false);
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    const [viewerInvoice, setViewerInvoice] = useState({ isOpen: false, url: '', details: {} });
    const [selectedVoucherInvoice, setSelectedVoucherInvoice] = useState(null);

    useEffect(() => {
        fetchData();
        loadSettings();
        fetchBcvRate();
    }, []);

    const loadSettings = async () => {
        const s = await fetchGlobalSettings();
        setSettings(s);
    };

    const fetchBcvRate = async () => {
        try {
            const res = await api.get('/suppliers/bcv-rate');
            if (res.data?.rate && res.data.rate > 0) {
                setBcvRate(Number(res.data.rate));
                if (res.data.date) setBcvDate(res.data.date);
                if (res.data.source) setBcvSource(res.data.source);
            }
        } catch (e) {
            console.warn('[ACCOUNTS PAYABLE] Error consultando tasa BCV:', e);
        }
    };

    const fetchData = async () => {
        try {
            setLoading(true);
            const [apRes, invRes] = await Promise.allSettled([
                api.get('/reports/bi/accounts-payable'),
                api.get('/suppliers/invoices/history')
            ]);

            if (apRes.status === 'fulfilled') {
                setSuppliers(apRes.value.data.suppliers || []);
                setSummary(apRes.value.data.summary || { totalAmount: 0, totalSuppliers: 0 });
            }

            if (invRes.status === 'fulfilled' && invRes.value.data?.success) {
                setInvoiceHistory(invRes.value.data);
            }
        } catch (error) {
            console.error('Error fetching accounts payable:', error);
            toast.error('Error al cargar cuentas por pagar');
        } finally {
            setLoading(false);
        }
    };

    const formatBs = (amount) => {
        return `Bs. ${Number(amount || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const getSupplierDebt = (supplier) => {
        const usd = Number(supplier.creditBalance) || 0;
        if (usd <= 0) return { usd: 0, ves: 0, appliedRate: bcvRate, isInvoiceRate: false };

        // Calcular sumando cada factura pendiente a su tasa real BCV
        if (supplier.invoices && supplier.invoices.length > 0) {
            let totalVes = 0;
            let lastRate = bcvRate;
            supplier.invoices.forEach(inv => {
                const invRate = Number(inv.exchangeRate) > 1 ? Number(inv.exchangeRate) : (bcvRate > 0 ? bcvRate : 1);
                const invUsd = Number(inv.balanceRemaining || inv.amount || 0);
                totalVes += (invUsd * invRate);
                lastRate = invRate;
            });
            return {
                usd,
                ves: totalVes,
                appliedRate: lastRate,
                isInvoiceRate: true
            };
        }

        const effRate = bcvRate > 0 ? bcvRate : 1;
        return {
            usd,
            ves: usd * effRate,
            appliedRate: effRate,
            isInvoiceRate: false
        };
    };

    const getTotalConsolidatedDebt = () => {
        const totalUsd = Number(summary.totalAmount) || 0;
        let totalVes = 0;
        suppliers.forEach(s => {
            totalVes += getSupplierDebt(s).ves;
        });
        return { totalUsd, totalVes };
    };

    const handleManageCredit = (supplier) => {
        setSelectedSupplier(supplier);
        setIsCreditModalOpen(true);
    };

    const handleOpenRegisterForSupplier = (supplier) => {
        setSelectedSupplier(supplier);
        setIsRegisterInvoiceOpen(true);
    };

    const filteredSuppliers = suppliers.filter(s =>
        (s.name && s.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.contact && s.contact.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.rif && s.rif.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const filteredPaidInvoices = (invoiceHistory.paidInvoices || []).filter(inv =>
        (inv.supplierName && inv.supplierName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.referenceNumber && inv.referenceNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.description && inv.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.supplierRif && inv.supplierRif.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const filteredAllInvoices = (invoiceHistory.invoices || []).filter(inv =>
        (inv.supplierName && inv.supplierName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.referenceNumber && inv.referenceNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.description && inv.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.supplierRif && inv.supplierRif.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const getDueStatusBadge = (dueDate) => {
        if (!dueDate) return null;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-500 border border-rose-500/20">
                    <ShieldAlert size={11} /> Vencida ({Math.abs(diffDays)}d)
                </span>
            );
        } else if (diffDays <= 3) {
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    <Clock size={11} /> Vence pronto ({diffDays === 0 ? 'Hoy' : `${diffDays}d`})
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-slate-500/10 text-slate-400 border border-slate-500/20">
                <Calendar size={11} /> Vence en {diffDays}d
            </span>
        );
    };

    return (
        <div className="space-y-6 pb-20 sm:pb-8 pb-safe animate-in fade-in duration-300">
            {/* Header Section */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4 flex-1">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                            <Truck size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                                    Cuentas por Pagar
                                </h1>
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                    Pasivos
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Control de facturas de proveedores, pagos y vencimientos • {summary.totalSuppliers} proveedores con saldo
                            </p>
                        </div>
                    </div>

                    {/* Integrated Search Bar */}
                    <div className="relative flex-1 max-w-md">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar proveedor..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button 
                        onClick={() => { setSelectedSupplier(null); setIsRegisterInvoiceOpen(true); }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
                    >
                        <FilePlus size={15} />
                        <span>Registrar Factura</span>
                    </button>

                    <button 
                        onClick={async () => {
                            try {
                                const res = await api.get('/reports/bi/export?type=accounts-payable', { responseType: 'blob' });
                                const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
                                const url = window.URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = url;
                                link.setAttribute('download', `cuentas_por_pagar_${new Date().toISOString().slice(0, 10)}.csv`);
                                document.body.appendChild(link);
                                link.click();
                                link.remove();
                                window.URL.revokeObjectURL(url);
                            } catch (err) {
                                console.error('Error exportando cuentas por pagar:', err);
                                toast.error('Error al exportar Cuentas por Pagar');
                            }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs transition-colors cursor-pointer"
                    >
                        <Download size={14} className="text-slate-500" /> 
                        <span>Exportar</span>
                    </button>
                </div>
            </div>

            {/* Live BCV Rate Banner */}
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                    <Banknote size={17} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                        Tasa BCV Oficial: <strong className="font-mono text-slate-900 dark:text-white font-bold">Bs. {bcvRate.toFixed(4)} / $</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Verificada ({bcvDate})
                    </span>
                </div>
                <span className="text-slate-400 text-[11px]">
                    Fuente: {bcvSource}
                </span>
            </div>

            {/* Summary KPI Grid */}
            {(() => {
                const consolidatedDebt = getTotalConsolidatedDebt();
                const paidVes = (invoiceHistory.summary.totalPaidUsd || 0) * bcvRate;

                return (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* Deuda Consolidada */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Deuda Consolidada</span>
                                <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-center justify-center text-rose-600 dark:text-rose-400">
                                    <TrendingUp size={16} />
                                </div>
                            </div>
                            <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                ${consolidatedDebt.totalUsd.toFixed(2)} <span className="text-xs font-normal text-slate-400">USD</span>
                            </div>
                            <div className="text-xs font-medium text-rose-600 dark:text-rose-400 mt-1 font-mono">
                                {formatBs(consolidatedDebt.totalVes)}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-2">
                                {summary.totalSuppliers > 0 ? `${summary.totalSuppliers} Proveedores con saldo pendiente` : 'Sin deudas pendientes'}
                            </p>
                        </div>

                        {/* Facturas Canceladas */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Facturas Canceladas</span>
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 size={16} />
                                </div>
                            </div>
                            <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                ${(invoiceHistory.summary.totalPaidUsd || 0).toFixed(2)} <span className="text-xs font-normal text-slate-400">USD</span>
                            </div>
                            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                                {formatBs(paidVes)}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-2">
                                {invoiceHistory.summary.totalPaidCount} factura(s) liquidadas
                            </p>
                        </div>

                        {/* Total Facturas Registradas */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Facturas</span>
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                    <Layers size={16} />
                                </div>
                            </div>
                            <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {invoiceHistory.summary.totalInvoices}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-2">
                                Historial general de facturas registradas
                            </p>
                        </div>
                    </div>
                );
            })()}

            {/* Navigation Tabs */}
            <div className="flex items-center overflow-x-auto no-scrollbar gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg w-full sm:w-fit">
                <button
                    type="button"
                    onClick={() => setActiveTab('pending')}
                    className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                        activeTab === 'pending'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <AlertCircle size={13} />
                    <span>Deudas Pendientes</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                        activeTab === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                        {suppliers.length}
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('paid')}
                    className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                        activeTab === 'paid'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <CheckCircle2 size={13} />
                    <span>Canceladas</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                        activeTab === 'paid' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                        {invoiceHistory.paidInvoices?.length || 0}
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('all')}
                    className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                        activeTab === 'all'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <Layers size={13} />
                    <span>Todas</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                        activeTab === 'all' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                        {invoiceHistory.invoices?.length || 0}
                    </span>
                </button>
            </div>

            {/* TAB 1: Cuentas Pendientes (Con Saldo Deudor) */}
            {activeTab === 'pending' && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                    {/* 💻 DESKTOP TABLE */}
                    <div className="hidden md:block w-full overflow-x-auto">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                                    <th className="px-4 py-3">Proveedor</th>
                                    <th className="px-4 py-3">Última Factura & Tasa BCV</th>
                                    <th className="px-4 py-3 text-center">Vencimiento</th>
                                    <th className="px-4 py-3 text-right">Deuda Pendiente</th>
                                    <th className="px-4 py-3 text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {loading ? (
                                    <tr>
                                        <td colSpan="5" className="py-16 text-center text-slate-500">
                                            <div className="inline-flex items-center gap-2 font-medium">
                                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                                                Cargando cuentas por pagar...
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredSuppliers.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="py-16 text-center text-slate-500">
                                            <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-2 opacity-80" />
                                            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                                                Sin deudas pendientes
                                            </h3>
                                            <p className="text-xs text-slate-400 mt-0.5 mb-4">
                                                Todas las facturas de proveedores están completamente solventes.
                                            </p>
                                            <div className="flex items-center justify-center gap-2">
                                                {invoiceHistory.paidInvoices?.length > 0 && (
                                                     <button
                                                        type="button"
                                                        onClick={() => setActiveTab('paid')}
                                                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1.5"
                                                    >
                                                        <CheckCircle size={13} />
                                                        <span>Ver Facturas Canceladas ({invoiceHistory.paidInvoices.length})</span>
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setIsRegisterInvoiceOpen(true)}
                                                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium cursor-pointer"
                                                >
                                                    + Registrar Factura
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredSuppliers.map((supplier) => {
                                        const latestInvoice = supplier.invoices?.[0] || null;
                                        const debtInfo = getSupplierDebt(supplier);

                                        return (
                                            <tr key={supplier.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                                                {/* Proveedor */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center text-amber-600 dark:text-amber-400 font-bold text-xs shrink-0">
                                                            {supplier.name?.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <span className="font-semibold text-slate-900 dark:text-white block truncate">
                                                                {supplier.name}
                                                            </span>
                                                            <span className="text-[11px] text-slate-400 font-mono block">
                                                                {supplier.rif || supplier.contact || 'Sin RIF'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Última Factura & Tasa de Llegada */}
                                                <td className="px-4 py-3">
                                                    {latestInvoice ? (
                                                        <div className="flex flex-col gap-0.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                                    #{latestInvoice.referenceNumber}
                                                                </span>
                                                                {latestInvoice.invoiceUrl && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setViewerInvoice({
                                                                            isOpen: true,
                                                                            url: latestInvoice.invoiceUrl,
                                                                            details: {
                                                                                referenceNumber: latestInvoice.referenceNumber,
                                                                                supplierName: supplier.name,
                                                                                date: latestInvoice.arrivalDate || latestInvoice.timestamp?.split('T')[0]
                                                                            }
                                                                        })}
                                                                        className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                                                        title="Ver Factura Digitalizada"
                                                                    >
                                                                        <Eye size={11} />
                                                                        <span>Ver</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="text-[11px] text-slate-400">
                                                                <span>{latestInvoice.arrivalDate || 'N/A'}</span>
                                                                <span className="mx-1">•</span>
                                                                <span className="font-mono text-slate-600 dark:text-slate-300">
                                                                    BCV: {Number(latestInvoice.exchangeRate || bcvRate).toFixed(2)} Bs/$
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-[11px] text-slate-400">
                                                            <span>Sin facturas adjuntas</span>
                                                        </div>
                                                    )}
                                                </td>

                                                {/* Estado de Vencimiento */}
                                                <td className="px-4 py-3 text-center">
                                                    {supplier.nextDueDate ? (
                                                        <div className="flex flex-col items-center gap-0.5">
                                                            {getDueStatusBadge(supplier.nextDueDate)}
                                                            <span className="text-[10px] font-mono text-slate-400">
                                                                {supplier.nextDueDate}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[11px] text-slate-400">Sin Vencimiento</span>
                                                    )}
                                                </td>

                                                {/* Deuda Pendiente */}
                                                <td className="px-4 py-3 text-right">
                                                    <div className="font-mono font-bold text-slate-900 dark:text-white">
                                                        ${debtInfo.usd.toFixed(2)} USD
                                                    </div>
                                                    <div className="text-[11px] text-rose-600 dark:text-rose-400 font-mono">
                                                        {formatBs(debtInfo.ves)}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-mono">
                                                        BCV: {Number(debtInfo.appliedRate).toFixed(2)} Bs/$
                                                    </div>
                                                </td>

                                                {/* Gestión */}
                                                <td className="px-4 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => handleOpenRegisterForSupplier(supplier)}
                                                            className="p-1.5 text-slate-500 hover:text-amber-600 dark:text-slate-400 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                                            title="Cargar Nueva Factura"
                                                        >
                                                            <FilePlus size={15} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleManageCredit(supplier)}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80 hover:bg-amber-100 rounded text-xs font-medium transition-colors"
                                                        >
                                                            <HistoryIcon size={12} />
                                                            <span>Abonar / Historial</span>
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

                    {/* 📱 MOBILE CARDS VIEW */}
                    <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                        {loading ? (
                            <div className="py-12 text-center text-slate-500 text-xs font-medium">
                                Cargando cuentas por pagar...
                            </div>
                        ) : filteredSuppliers.length === 0 ? (
                            <div className="py-10 text-center text-slate-400">
                                <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-500" />
                                <p className="text-xs font-medium">Sin deudas pendientes</p>
                            </div>
                        ) : (
                            filteredSuppliers.map((supplier) => {
                                const latestInvoice = supplier.invoices?.[0] || null;
                                const debtInfo = getSupplierDebt(supplier);

                                return (
                                    <div key={supplier.id} className="p-3.5 space-y-2.5">
                                        {/* Row 1: Supplier + Debt */}
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center text-amber-600 dark:text-amber-400 font-bold text-xs shrink-0">
                                                    {supplier.name?.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                                        {supplier.name}
                                                    </h4>
                                                    <p className="text-[11px] text-slate-400 font-mono">
                                                        {supplier.rif || supplier.contact || 'Sin RIF'}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="text-right shrink-0">
                                                <div className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                                                    ${debtInfo.usd.toFixed(2)}
                                                </div>
                                                <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono block">
                                                    {formatBs(debtInfo.ves)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Row 2: Latest Invoice & Due Status */}
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500 truncate mr-2">
                                                {latestInvoice ? `Factura #${latestInvoice.referenceNumber}` : 'Sin Factura'}
                                            </span>
                                            <div className="shrink-0">
                                                {supplier.nextDueDate ? getDueStatusBadge(supplier.nextDueDate) : <span className="text-slate-400 text-[11px]">Sin Vence</span>}
                                            </div>
                                        </div>

                                        {/* Row 3: Action Buttons */}
                                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                                            <button
                                                onClick={() => handleManageCredit(supplier)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80 rounded text-xs font-medium"
                                            >
                                                <HistoryIcon size={12} />
                                                <span>Abonar / Historial</span>
                                            </button>

                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleOpenRegisterForSupplier(supplier)}
                                                    className="p-1.5 text-slate-500 hover:text-amber-600 rounded transition-colors"
                                                    title="Cargar Factura"
                                                >
                                                    <FilePlus size={14} />
                                                </button>

                                                {latestInvoice?.invoiceUrl && (
                                                    <button
                                                        onClick={() => setViewerInvoice({
                                                            isOpen: true,
                                                            url: latestInvoice.invoiceUrl,
                                                            details: {
                                                                referenceNumber: latestInvoice.referenceNumber,
                                                                supplierName: supplier.name,
                                                                date: latestInvoice.arrivalDate || latestInvoice.timestamp?.split('T')[0]
                                                            }
                                                        })}
                                                        className="p-1.5 text-slate-500 hover:text-indigo-600 rounded transition-colors"
                                                        title="Ver Comprobante"
                                                    >
                                                        <Eye size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* TAB 2: Facturas Canceladas / Pagadas */}
            {activeTab === 'paid' && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                    {/* 💻 DESKTOP TABLE */}
                    <div className="hidden md:block w-full overflow-x-auto">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                                    <th className="px-4 py-3">Factura & Proveedor</th>
                                    <th className="px-4 py-3">Fechas (Emisión / Pago)</th>
                                    <th className="px-4 py-3 text-center">Tasa BCV Aplicada</th>
                                    <th className="px-4 py-3 text-right">Monto Liquidado</th>
                                    <th className="px-4 py-3 text-center">Estado</th>
                                    <th className="px-4 py-3 text-center">Documentos</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {filteredPaidInvoices.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="py-16 text-center text-slate-500">
                                            <CheckCircle size={36} className="text-slate-400 mx-auto mb-2 opacity-80" />
                                            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                                                Sin facturas canceladas
                                            </h3>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                                Aún no se han registrado facturas pagadas en el sistema.
                                            </p>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredPaidInvoices.map((inv) => (
                                        <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                                            {/* Factura & Proveedor */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-xs shrink-0">
                                                        <CheckCircle2 size={16} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="font-mono font-semibold text-slate-900 dark:text-white block">
                                                            Factura #{inv.referenceNumber}
                                                        </span>
                                                        <span className="font-medium text-slate-700 dark:text-slate-300 block truncate">
                                                            {inv.supplierName}
                                                        </span>
                                                        {inv.supplierRif && (
                                                            <span className="text-[10px] font-mono text-slate-400 block">
                                                                RIF: {inv.supplierRif}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Fechas */}
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                <div>Emisión: <strong className="font-mono">{inv.arrivalDate || 'N/A'}</strong></div>
                                                <div className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
                                                    Pagada: {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString('es-VE') : 'Solvente'}
                                                </div>
                                            </td>

                                            {/* Tasa BCV */}
                                            <td className="px-4 py-3 text-center font-mono text-slate-600 dark:text-slate-300">
                                                Bs. {Number(inv.exchangeRate).toFixed(4)}
                                            </td>

                                            {/* Monto Liquidado */}
                                            <td className="px-4 py-3 text-right">
                                                <div className="font-mono font-bold text-slate-900 dark:text-white">
                                                    ${inv.amountUsd.toFixed(2)} USD
                                                </div>
                                                <div className="text-[11px] text-slate-400 font-mono">
                                                    Bs. {inv.amountVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                                </div>
                                            </td>

                                            {/* Estado / Auditoría */}
                                            <td className="px-4 py-3 text-center">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80">
                                                    <CheckCircle2 size={12} /> Cancelada
                                                </span>
                                                <p className="text-[10px] text-slate-400 mt-0.5">
                                                    {inv.paymentMethod || 'Efectivo'}
                                                </p>
                                            </td>

                                            {/* Documentos */}
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    {inv.invoiceUrl && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setViewerInvoice({
                                                                isOpen: true,
                                                                url: inv.invoiceUrl,
                                                                details: {
                                                                    referenceNumber: inv.referenceNumber,
                                                                    supplierName: inv.supplierName,
                                                                    date: inv.arrivalDate
                                                                }
                                                            })}
                                                            className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80 hover:bg-indigo-100 rounded text-xs font-medium cursor-pointer"
                                                        >
                                                            <Eye size={12} />
                                                            <span>Factura</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedVoucherInvoice(inv)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 hover:bg-emerald-100 rounded text-xs font-medium cursor-pointer"
                                                        title="Ver Comprobante de Liquidación"
                                                    >
                                                        <ReceiptIcon size={12} />
                                                        <span>Recibo</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* 📱 MOBILE CARDS VIEW FOR PAID INVOICES */}
                    <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredPaidInvoices.length === 0 ? (
                            <div className="py-10 text-center text-slate-400">
                                <CheckCircle size={32} className="mx-auto mb-2 text-slate-400" />
                                <p className="text-xs font-medium">Sin facturas canceladas</p>
                            </div>
                        ) : (
                            filteredPaidInvoices.map((inv) => (
                                <div key={inv.id} className="p-3.5 space-y-2.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-xs shrink-0">
                                                <CheckCircle2 size={16} />
                                            </div>
                                            <div className="min-w-0">
                                                <span className="text-xs font-mono font-semibold text-slate-900 dark:text-white block truncate">
                                                    Factura #{inv.referenceNumber}
                                                </span>
                                                <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                                    {inv.supplierName}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                                                ${inv.amountUsd.toFixed(2)}
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-mono block">
                                                Bs. {inv.amountVes?.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-xs text-slate-500">
                                        <span>Emisión: {inv.arrivalDate || 'N/A'}</span>
                                        <span className="font-mono">BCV: {Number(inv.exchangeRate).toFixed(2)} Bs/$</span>
                                    </div>

                                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                        {inv.invoiceUrl && (
                                            <button
                                                type="button"
                                                onClick={() => setViewerInvoice({
                                                    isOpen: true,
                                                    url: inv.invoiceUrl,
                                                    details: {
                                                        referenceNumber: inv.referenceNumber,
                                                        supplierName: inv.supplierName,
                                                        date: inv.arrivalDate
                                                    }
                                                })}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80 rounded text-xs font-medium"
                                            >
                                                <Eye size={12} />
                                                <span>Factura</span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedVoucherInvoice(inv)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 rounded text-xs font-medium"
                                        >
                                            <ReceiptIcon size={12} />
                                            <span>Recibo</span>
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: Todas las Facturas (Pendientes y Pagadas) */}
            {activeTab === 'all' && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                    {/* 💻 DESKTOP TABLE */}
                    <div className="hidden md:block w-full overflow-x-auto">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                                    <th className="px-4 py-3">Factura / Proveedor</th>
                                    <th className="px-4 py-3">Fecha Llegada</th>
                                    <th className="px-4 py-3 text-center">Tasa BCV</th>
                                    <th className="px-4 py-3 text-right">Total</th>
                                    <th className="px-4 py-3 text-center">Estado</th>
                                    <th className="px-4 py-3 text-center">Documento</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {filteredAllInvoices.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="px-4 py-3">
                                            <span className="font-mono font-semibold text-slate-900 dark:text-white block">
                                                Factura #{inv.referenceNumber}
                                            </span>
                                            <span className="text-slate-600 dark:text-slate-300 font-medium block truncate">
                                                {inv.supplierName}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                                            {inv.arrivalDate || 'N/A'}
                                        </td>
                                        <td className="px-4 py-3 text-center font-mono text-slate-600 dark:text-slate-300">
                                            Bs. {Number(inv.exchangeRate).toFixed(4)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                                            ${inv.amountUsd.toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {inv.status === 'PAID' ? (
                                                <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80">
                                                    Pagada
                                                </span>
                                            ) : inv.status === 'PARTIAL' ? (
                                                <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80">
                                                    Parcial (${(inv.balanceRemaining || 0).toFixed(2)})
                                                </span>
                                            ) : (
                                                <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80">
                                                    Pendiente (${(inv.balanceRemaining || 0).toFixed(2)})
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                {inv.invoiceUrl && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setViewerInvoice({
                                                            isOpen: true,
                                                            url: inv.invoiceUrl,
                                                            details: {
                                                                referenceNumber: inv.referenceNumber,
                                                                supplierName: inv.supplierName,
                                                                date: inv.arrivalDate
                                                            }
                                                        })}
                                                        className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80 hover:bg-indigo-100 rounded text-xs font-medium cursor-pointer"
                                                    >
                                                        <Eye size={12} />
                                                        <span>Factura</span>
                                                    </button>
                                                )}
                                                {inv.status === 'PAID' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedVoucherInvoice(inv)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 hover:bg-emerald-100 rounded text-xs font-medium cursor-pointer"
                                                        title="Ver Comprobante de Pago"
                                                    >
                                                        <ReceiptIcon size={12} />
                                                        <span>Recibo</span>
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* 📱 MOBILE CARDS VIEW FOR ALL INVOICES */}
                    <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredAllInvoices.map((inv) => (
                            <div key={inv.id} className="p-3.5 space-y-2.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <span className="text-xs font-mono font-semibold text-slate-900 dark:text-white block truncate">
                                            Factura #{inv.referenceNumber}
                                        </span>
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                            {inv.supplierName}
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <span className="font-mono text-xs font-bold text-slate-900 dark:text-white block">
                                            ${inv.amountUsd.toFixed(2)}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400 block">
                                            BCV: {Number(inv.exchangeRate).toFixed(2)}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-400 font-mono">
                                        {inv.arrivalDate || 'N/A'}
                                    </span>
                                    <div>
                                        {inv.status === 'PAID' ? (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80">
                                                Pagada
                                            </span>
                                        ) : inv.status === 'PARTIAL' ? (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80">
                                                Parcial (${(inv.balanceRemaining || 0).toFixed(2)})
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80">
                                                Pendiente (${(inv.balanceRemaining || 0).toFixed(2)})
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    {inv.invoiceUrl && (
                                        <button
                                            type="button"
                                            onClick={() => setViewerInvoice({
                                                isOpen: true,
                                                url: inv.invoiceUrl,
                                                details: {
                                                    referenceNumber: inv.referenceNumber,
                                                    supplierName: inv.supplierName,
                                                    date: inv.arrivalDate
                                                }
                                            })}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80 rounded text-xs font-medium"
                                        >
                                            <Eye size={12} />
                                            <span>Factura</span>
                                        </button>
                                    )}
                                    {inv.status === 'PAID' && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedVoucherInvoice(inv)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80 rounded text-xs font-medium"
                                        >
                                            <ReceiptIcon size={12} />
                                            <span>Recibo</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Modal Comprobante Individual de Pago */}
            <SupplierPaymentVoucherModal
                isOpen={!!selectedVoucherInvoice}
                onClose={() => setSelectedVoucherInvoice(null)}
                invoice={selectedVoucherInvoice}
                settings={settings}
                onOpenSupplierHistory={(sup) => {
                    const fullSup = suppliers.find(s => s.id === sup.id) || sup;
                    handleManageCredit(fullSup);
                }}
            />

            {/* Modal Estado de Cuenta / Abonos */}
            <SupplierCreditModal
                isOpen={isCreditModalOpen}
                onClose={() => setIsCreditModalOpen(false)}
                supplier={selectedSupplier}
                onUpdate={fetchData}
            />

            {/* Modal Registrar Factura de Proveedor */}
            <RegisterSupplierInvoiceModal
                isOpen={isRegisterInvoiceOpen}
                onClose={() => setIsRegisterInvoiceOpen(false)}
                onSuccess={fetchData}
                defaultSupplier={selectedSupplier}
            />

            {/* Modal Visor de Factura Real */}
            <InvoiceViewerModal
                isOpen={viewerInvoice.isOpen}
                onClose={() => setViewerInvoice(prev => ({ ...prev, isOpen: false }))}
                invoiceUrl={viewerInvoice.url}
                title="Factura Real Digitalizada"
                details={viewerInvoice.details}
            />
        </div>
    );
}
