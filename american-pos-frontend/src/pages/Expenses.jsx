import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import {
    Plus, Search, Trash2, Calendar, Tag, DollarSign,
    PieChart, AlertCircle, CheckCircle2, X, Activity,
    Eye, FileText, Camera, Printer, Upload, Loader2,
    TrendingUp, TrendingDown, ArrowUpRight, Filter,
    Download, RefreshCw, Edit2, Zap, Building2,
    Users, Package, Wrench, Landmark, Truck,
    Coffee, Megaphone, Banknote, ShieldAlert,
    CreditCard, ArrowDownRight, Layers,
    ChevronDown, SlidersHorizontal, Image as ImageIcon
} from 'lucide-react';
import { formatMoney, fetchGlobalSettings, isSingleCurrencyMode, isDollarOnlyCountry } from '../utils/format';
import { getInvoiceUrl } from '../utils/imageUtils';
import ConfirmModal from '../components/ConfirmModal';
import InvoiceViewerModal from '../components/InvoiceViewerModal';
import PrinterScanModal from '../components/PrinterScanModal';
import CameraScanModal from '../components/CameraScanModal';

export const CATEGORY_CONFIG = {
    'Servicios': { icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30', badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
    'Alquiler': { icon: Building2, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30', badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' },
    'Nómina': { icon: Users, color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/30', badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30' },
    'Suministros': { icon: Package, color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
    'Mantenimiento': { icon: Wrench, color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/30', badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30' },
    'Impuestos': { icon: Landmark, color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/30', badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30' },
    'Transporte': { icon: Truck, color: 'text-cyan-500', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', badge: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30' },
    'Viáticos / Comida': { icon: Coffee, color: 'text-lime-500', bg: 'bg-lime-500/10', border: 'border-lime-500/30', badge: 'bg-lime-500/15 text-lime-600 dark:text-lime-400 border-lime-500/30' },
    'Publicidad': { icon: Megaphone, color: 'text-pink-500', bg: 'bg-pink-500/10', border: 'border-pink-500/30', badge: 'bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/30' },
    'Otros': { icon: FileText, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30', badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30' }
};

export const PAYMENT_METHODS = [
    { id: 'cash', label: 'Efectivo USD', icon: DollarSign, isCashDrawer: true },
    { id: 'cash_ves', label: 'Efectivo Bolívares (Bs)', icon: Banknote, isCashDrawer: true },
    { id: 'transfer', label: 'Transferencia Bancaria', icon: Landmark, isCashDrawer: false },
    { id: 'pago_movil', label: 'Pago Móvil', icon: CreditCard, isCashDrawer: false },
    { id: 'pos', label: 'Tarjeta / Punto de Venta', icon: CreditCard, isCashDrawer: false },
    { id: 'zelle', label: 'Zelle / Divisas Ext.', icon: ArrowUpRight, isCashDrawer: false }
];

export default function Expenses() {
    const [expenses, setExpenses] = useState([]);
    const effectiveCountry = localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = isDollarCountry || isSingleCurrencyMode();

    const activePaymentMethods = useMemo(() => {
        if (!isUsdOnly) return PAYMENT_METHODS;
        return PAYMENT_METHODS
            .filter(pm => pm.id !== 'cash_ves' && pm.id !== 'pago_movil')
            .map(pm => {
                if (pm.id === 'cash') return { ...pm, label: 'Efectivo' };
                if (pm.id === 'pos') return { ...pm, label: 'Tarjeta / Débito' };
                return pm;
            });
    }, [isUsdOnly]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('ALL');
    const [dateRange, setDateRange] = useState('this_month'); // 'today', 'this_week', 'this_month', 'last_month', 'all', 'custom'
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [showAnalytics, setShowAnalytics] = useState(true);

    // Modal & Form States
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingExpenseId, setEditingExpenseId] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [inputCurrency, setInputCurrency] = useState('USD'); // 'USD' | 'VES'
    const [enteredAmount, setEnteredAmount] = useState('');

    const [formExpense, setFormExpense] = useState({
        description: '',
        category: 'Servicios',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        currency: 'USD',
        paymentMethod: 'cash',
        deductFromCash: true,
        beneficiary: '',
        invoiceUrl: ''
    });

    // Settings & Live BCV
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    const [bcvRate, setBcvRate] = useState(791.3248);
    const [bcvDate, setBcvDate] = useState(new Date().toISOString().split('T')[0]);
    const [isShiftOpen, setIsShiftOpen] = useState(false);

    // Modals
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        action: null,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar'
    });

    const [viewerInvoice, setViewerInvoice] = useState({
        isOpen: false,
        url: '',
        details: {}
    });

    const [showPrinterModal, setShowPrinterModal] = useState(false);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [isScanningPrinter, setIsScanningPrinter] = useState(false);
    const [isUploadingInvoice, setIsUploadingInvoice] = useState(false);

    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        try {
            setLoading(true);
            await Promise.all([
                fetchSettings(),
                fetchBcvRate(),
                fetchExpenses(),
                checkShiftStatus()
            ]);
        } finally {
            setLoading(false);
        }
    };

    const fetchSettings = async () => {
        try {
            const s = await fetchGlobalSettings();
            setSettings(s);
        } catch (e) {
            console.error('Error fetching settings:', e);
        }
    };

    const fetchBcvRate = async () => {
        try {
            const res = await api.get('/suppliers/bcv-rate');
            if (res.data?.rate && res.data.rate > 0) {
                setBcvRate(Number(res.data.rate));
                if (res.data.date) setBcvDate(res.data.date);
            }
        } catch (e) {
            console.warn('[EXPENSES] Error consultando tasa BCV:', e);
        }
    };

    const checkShiftStatus = async () => {
        try {
            const { data } = await api.get('/cash/current');
            setIsShiftOpen(!!data);
        } catch (_e) {
            setIsShiftOpen(false);
        }
    };

    const fetchExpenses = async () => {
        try {
            const res = await api.get('/expenses');
            setExpenses(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error('Error fetching expenses:', error);
            toast.error('Error al cargar la lista de gastos');
        }
    };

    // Formatters
    const formatBs = (amount) => {
        return `Bs. ${Number(amount || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatUsd = (amount) => {
        return `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    // Date Range Helpers
    const getFilteredByDateExpenses = useMemo(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];

        // Start of this week (Monday)
        const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
        const monday = new Date(now);
        monday.setDate(now.getDate() - dayOfWeek);
        const startOfWeek = monday.toISOString().split('T')[0];

        // Start of this month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

        // Start and end of last month
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

        // Start of this year
        const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];

        return (expenses || []).filter(ex => {
            if (!ex.date) return true;
            const exDate = ex.date.split('T')[0];

            if (dateRange === 'today') return exDate === startOfToday;
            if (dateRange === 'this_week') return exDate >= startOfWeek;
            if (dateRange === 'this_month') return exDate >= startOfMonth;
            if (dateRange === 'last_month') return exDate >= startOfLastMonth && exDate <= endOfLastMonth;
            if (dateRange === 'this_year') return exDate >= startOfYear;
            if (dateRange === 'custom') {
                if (customStartDate && customEndDate) {
                    return exDate >= customStartDate && exDate <= customEndDate;
                }
                if (customStartDate) return exDate >= customStartDate;
                if (customEndDate) return exDate <= customEndDate;
            }
            return true;
        });
    }, [expenses, dateRange, customStartDate, customEndDate]);

    // Filtered Expenses by Category and Search Term
    const filteredExpenses = useMemo(() => {
        return getFilteredByDateExpenses.filter(ex => {
            const matchesCategory = selectedCategory === 'ALL' || ex.category === selectedCategory;
            const q = searchTerm.toLowerCase();
            const matchesSearch = !q ||
                (ex.description && ex.description.toLowerCase().includes(q)) ||
                (ex.category && ex.category.toLowerCase().includes(q)) ||
                (ex.paymentMethod && ex.paymentMethod.toLowerCase().includes(q)) ||
                (ex.id && ex.id.toLowerCase().includes(q));

            return matchesCategory && matchesSearch;
        });
    }, [getFilteredByDateExpenses, selectedCategory, searchTerm]);

    // Financial Analytics Aggregations
    const analytics = useMemo(() => {
        const totalUsd = getFilteredByDateExpenses.reduce((sum, ex) => sum + Number(ex.amount || 0), 0);
        const totalVes = totalUsd * (bcvRate > 0 ? bcvRate : 1);

        // Deductions from Cash Drawer
        const cashDrawerUsd = getFilteredByDateExpenses
            .filter(ex => ex.paymentMethod === 'cash' || ex.paymentMethod === 'cash_ves' || ex.deductFromCash)
            .reduce((sum, ex) => sum + Number(ex.amount || 0), 0);

        // With invoices attached
        const attachedCount = getFilteredByDateExpenses.filter(ex => !!ex.invoiceUrl).length;

        // Group by category
        const categoryMap = {};
        getFilteredByDateExpenses.forEach(ex => {
            const cat = ex.category || 'Otros';
            categoryMap[cat] = (categoryMap[cat] || 0) + Number(ex.amount || 0);
        });

        const categoryBreakdown = Object.entries(categoryMap)
            .map(([cat, amount]) => ({
                category: cat,
                amount,
                ves: amount * (bcvRate > 0 ? bcvRate : 1),
                percent: totalUsd > 0 ? Math.round((amount / totalUsd) * 100) : 0,
                config: CATEGORY_CONFIG[cat] || CATEGORY_CONFIG['Otros']
            }))
            .sort((a, b) => b.amount - a.amount);

        const topCategory = categoryBreakdown[0] || null;

        return {
            totalUsd,
            totalVes,
            cashDrawerUsd,
            attachedCount,
            totalCount: getFilteredByDateExpenses.length,
            categoryBreakdown,
            topCategory
        };
    }, [getFilteredByDateExpenses, bcvRate]);

    // Handle Open Register Modal (New or Edit)
    const handleOpenCreate = () => {
        setEditingExpenseId(null);
        setInputCurrency('USD');
        setEnteredAmount('');
        setFormExpense({
            description: '',
            category: 'Servicios',
            amount: '',
            date: new Date().toISOString().split('T')[0],
            currency: 'USD',
            paymentMethod: 'cash',
            deductFromCash: isShiftOpen,
            beneficiary: '',
            invoiceUrl: ''
        });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (ex) => {
        setEditingExpenseId(ex.id);
        const cur = ex.currency || 'USD';
        setInputCurrency(cur);
        const amtUsd = Number(ex.amount || 0);
        const rate = bcvRate > 0 ? bcvRate : 1;
        const displayAmt = cur === 'VES' ? Number((amtUsd * rate).toFixed(2)) : amtUsd;
        setEnteredAmount(displayAmt ? String(displayAmt) : '');
        setFormExpense({
            description: ex.description || '',
            category: ex.category || 'Servicios',
            amount: amtUsd,
            nativeAmount: displayAmt,
            exchangeRate: rate,
            date: ex.date ? ex.date.split('T')[0] : new Date().toISOString().split('T')[0],
            currency: cur,
            paymentMethod: ex.paymentMethod || 'cash',
            deductFromCash: ex.deductFromCash !== undefined ? ex.deductFromCash : (ex.paymentMethod === 'cash' || ex.paymentMethod === 'cash_ves'),
            beneficiary: ex.beneficiary || '',
            invoiceUrl: ex.invoiceUrl || ''
        });
        setIsModalOpen(true);
    };

    // Amount & Currency Conversion in Modal
    const handleAmountChange = (val, curr = inputCurrency) => {
        let clean = String(val).replace(',', '.');
        setEnteredAmount(clean);
        const numeric = parseFloat(clean) || 0;
        const rate = bcvRate > 0 ? bcvRate : 1;

        if (curr === 'VES') {
            const calculatedUsd = rate > 0 ? (numeric / rate) : numeric;
            setFormExpense(prev => ({
                ...prev,
                amount: calculatedUsd.toFixed(2),
                nativeAmount: numeric,
                exchangeRate: rate,
                currency: 'VES'
            }));
        } else {
            setFormExpense(prev => ({
                ...prev,
                amount: clean,
                nativeAmount: numeric,
                exchangeRate: rate,
                currency: 'USD'
            }));
        }
    };

    const handleCurrencyToggle = (curr) => {
        setInputCurrency(curr);
        handleAmountChange(enteredAmount, curr);
    };

    // Save Expense (Create or Update)
    const handleSaveExpense = async (e) => {
        e.preventDefault();
        if (!formExpense.description || !formExpense.amount || Number(formExpense.amount) <= 0) {
            toast.error('Por favor ingresa una descripción y un monto válido.');
            return;
        }

        try {
            setProcessing(true);
            const rate = bcvRate > 0 ? bcvRate : 1;
            const numericEntered = parseFloat(enteredAmount) || parseFloat(formExpense.amount) || 0;
            const payload = {
                ...formExpense,
                amount: parseFloat(formExpense.amount),
                nativeAmount: inputCurrency === 'VES' ? numericEntered : parseFloat(formExpense.amount),
                exchangeRate: rate
            };

            if (editingExpenseId) {
                await api.put(`/expenses/${editingExpenseId}`, payload);
                toast.success('Gasto actualizado exitosamente');
            } else {
                await api.post('/expenses', payload);
                toast.success('Gasto registrado con éxito');
            }

            setIsModalOpen(false);
            await fetchExpenses();
            await checkShiftStatus();
        } catch (error) {
            console.error('Error saving expense:', error);
            toast.error(error.response?.data?.error || 'Error al guardar el gasto');
        } finally {
            setProcessing(false);
        }
    };

    // Delete Expense
    const handleDeleteExpense = (id) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Registro de Gasto',
            message: '¿Estás seguro de eliminar este egreso? Si fue deducido de la caja chica, el arqueo se revertirá automáticamente.',
            variant: 'danger',
            confirmText: 'Eliminar Gasto',
            action: async () => {
                try {
                    await api.delete(`/expenses/${id}`);
                    toast.success('Gasto eliminado correctamente');
                    await fetchExpenses();
                    await checkShiftStatus();
                } catch (error) {
                    console.error('Error deleting expense:', error);
                    toast.error('Error al eliminar el gasto');
                }
            }
        });
    };

    // Upload & Scanner Handlers
    const handleUploadInvoiceFile = async (file) => {
        if (!file) return;
        setIsUploadingInvoice(true);
        const toastId = toast.loading('Guardando comprobante digital...');
        try {
            const formData = new FormData();
            formData.append('invoice', file);
            const { data } = await api.post('/purchase-orders/upload-invoice', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 180000
            });
            if (data?.invoiceUrl) {
                setFormExpense(prev => ({
                    ...prev,
                    invoiceUrl: data.invoiceUrl
                }));
                toast.success('Comprobante adjuntado correctamente', { id: toastId });
            }
        } catch (error) {
            console.error('Error uploading invoice:', error);
            toast.error('Error al subir el comprobante', { id: toastId });
        } finally {
            setIsUploadingInvoice(false);
        }
    };

    const handleExecuteScan = async ({ deviceId, dpi, colorMode }) => {
        setIsScanningPrinter(true);
        const toastId = toast.loading('Adquiriendo comprobante desde el escáner...');
        try {
            const { data } = await api.post('/purchase-orders/scan-invoice', {
                deviceId,
                dpi,
                colorMode
            }, {
                timeout: 180000
            });

            if (data?.invoiceUrl) {
                setFormExpense(prev => ({
                    ...prev,
                    invoiceUrl: data.invoiceUrl
                }));
                toast.success('Comprobante escaneado y adjuntado con éxito', { id: toastId });
            }
            setShowPrinterModal(false);
        } catch (error) {
            console.error('Error scanning invoice:', error);
            toast.error(error.response?.data?.error || 'Error al escanear comprobante', { id: toastId });
        } finally {
            setIsScanningPrinter(false);
        }
    };

    // Export to CSV
    const handleExportCSV = () => {
        if (filteredExpenses.length === 0) {
            toast.error('No hay registros de gastos para exportar en este periodo.');
            return;
        }

        const headers = ['ID', 'Fecha', 'Concepto', 'Categoria', 'Monto USD', 'Monto Bs (BCV)', 'Metodo de Pago', 'Comprobante'];
        const rows = filteredExpenses.map(ex => [
            ex.id,
            ex.date ? ex.date.split('T')[0] : '',
            `"${(ex.description || '').replace(/"/g, '""')}"`,
            ex.category || 'Otros',
            Number(ex.amount || 0).toFixed(2),
            (Number(ex.amount || 0) * bcvRate).toFixed(2),
            ex.paymentMethod || 'cash',
            ex.invoiceUrl ? 'Si' : 'No'
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Reporte_Gastos_${dateRange}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
document.body.removeChild(link);
        toast.success('Reporte de gastos exportado en CSV.');
    };

    return (
        <div className="space-y-5 pb-24 sm:pb-8 pb-safe animate-in fade-in duration-300">
            {/* Top Control Center Plate */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4 flex-1 w-full">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 flex items-center justify-center shrink-0">
                            <TrendingDown size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                    Control de Gastos
                                </h1>
                                <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700">
                                    {analytics.totalCount} registros
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Registro de egresos operativos, servicios y deducciones de caja
                            </p>
                        </div>
                    </div>

                    {/* Integrated Search Bar */}
                    <div className="relative flex-1 w-full lg:max-w-md">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Buscar por concepto, categoría, ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-normal text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 transition-colors"
                        />
                    </div>
                </div>

                <div className="flex items-center overflow-x-auto no-scrollbar gap-2 w-full lg:w-auto">
                    {/* Botón Registrar Gasto */}
                    <button
                        onClick={handleOpenCreate}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <Plus size={16} />
                        <span>Registrar Gasto</span>
                    </button>

                    {/* Exportar Reporte */}
                    <button
                        onClick={handleExportCSV}
                        className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        title="Exportar registros a CSV"
                    >
                        <Download size={14} />
                        <span>Exportar</span>
                    </button>

                    {/* Toggle Analytics */}
                    <button
                        onClick={() => setShowAnalytics(!showAnalytics)}
                        className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                            showAnalytics
                                ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40'
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                        title="Alternar gráfico de categorías"
                    >
                        <PieChart size={16} />
                    </button>
                </div>
            </div>

            {/* Live BCV Rate Banner */}
            {!isUsdOnly && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-xs">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/40 rounded-lg shrink-0">
                            <Banknote size={18} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                Tasa oficial BCV:
                            </span>
                            <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                                Bs. {bcvRate.toFixed(4)} / $
                            </span>
                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40 rounded-md text-[11px] font-medium flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Vigente ({bcvDate})
                            </span>
                        </div>
                    </div>

                    {/* Shift Status Indicator */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium shrink-0">
                        <span className={`w-2 h-2 rounded-full ${isShiftOpen ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        <span className={isShiftOpen ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}>
                            {isShiftOpen ? 'Caja Chica Activa' : 'Caja Chica Cerrada'}
                        </span>
                    </div>
                </div>
            )}

            {/* Top Financial KPI Cards Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* 1. Total Egresos Periodo */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Egresos</span>
                        <div className="p-1.5 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 rounded-lg shrink-0">
                            <TrendingDown size={16} />
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                            {formatUsd(analytics.totalUsd)}
                        </div>
                        {!isUsdOnly && (
                            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">
                                ≈ {formatBs(analytics.totalVes)}
                            </p>
                        )}
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            {analytics.totalCount} movimiento(s)
                        </p>
                    </div>
                </div>

                {/* 2. Deducido de Caja Chica */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Caja Chica</span>
                        <div className="p-1.5 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 rounded-lg shrink-0">
                            <DollarSign size={16} />
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                            {formatUsd(analytics.cashDrawerUsd)}
                        </div>
                        {!isUsdOnly && (
                            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">
                                ≈ {formatBs(analytics.cashDrawerUsd * bcvRate)}
                            </p>
                        )}
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            Salidas en turnos POS
                        </p>
                    </div>
                </div>

                {/* 3. Categoría Principal */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Mayor Rubro</span>
                        <div className="p-1.5 bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 rounded-lg shrink-0">
                            <Layers size={16} />
                        </div>
                    </div>
                    <div>
                        {analytics.topCategory ? (
                            <>
                                <div className="text-lg font-bold text-slate-900 dark:text-white truncate">
                                    {analytics.topCategory.category}
                                </div>
                                <p className="text-xs font-medium text-purple-600 dark:text-purple-400 mt-0.5">
                                    {formatUsd(analytics.topCategory.amount)} ({analytics.topCategory.percent}%)
                                </p>
                            </>
                        ) : (
                            <div className="text-xs text-slate-400">Sin registros</div>
                        )}
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            Categoría con más gasto
                        </p>
                    </div>
                </div>

                {/* 4. Comprobantes Digitalizados */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Comprobantes</span>
                        <div className="p-1.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400 rounded-lg shrink-0">
                            <FileText size={16} />
                        </div>
                    </div>
                    <div>
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                            {analytics.attachedCount} <span className="text-xs font-normal text-slate-400">/ {analytics.totalCount}</span>
                        </div>
                        <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">
                            {analytics.totalCount > 0 ? Math.round((analytics.attachedCount / analytics.totalCount) * 100) : 0}% Digitalizados
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            Facturas y recibos adjuntos
                        </p>
                    </div>
                </div>
            </div>

            {/* Category Analytics Visual Bar (Collapsible) */}
            {showAnalytics && analytics.categoryBreakdown.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <PieChart size={16} className="text-rose-500" />
                            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                                Distribución de Gastos por Categoría
                            </h3>
                        </div>
                        <span className="text-xs text-slate-400 hidden sm:inline">
                            Haz clic en una categoría para filtrar
                        </span>
                    </div>

                    {/* Proportional Segmented Bar */}
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                        {analytics.categoryBreakdown.map((item) => (
                            <div
                                key={item.category}
                                style={{ width: `${Math.max(item.percent, 3)}%` }}
                                className={`h-full transition-opacity cursor-pointer ${
                                    item.config.bg.replace('/10', '')
                                } hover:opacity-80`}
                                title={`${item.category}: ${formatUsd(item.amount)} (${item.percent}%)`}
                                onClick={() => setSelectedCategory(selectedCategory === item.category ? 'ALL' : item.category)}
                            />
                        ))}
                    </div>

                    {/* Category Badges Grid */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {analytics.categoryBreakdown.map((item) => {
                            const IconComponent = item.config.icon;
                            const isSelected = selectedCategory === item.category;

                            return (
                                <button
                                    key={item.category}
                                    type="button"
                                    onClick={() => setSelectedCategory(isSelected ? 'ALL' : item.category)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                                        isSelected
                                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                            : `${item.config.bg} ${item.config.color} ${item.config.border} hover:opacity-90`
                                    }`}
                                >
                                    <IconComponent size={13} />
                                    <span>{item.category}</span>
                                    <span className="font-mono text-[11px] opacity-80">
                                        {formatUsd(item.amount)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Quick Filters Toolbar */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
                {/* Date Range Selector Pills */}
                <div className="flex flex-wrap items-center gap-1 w-full md:w-auto">
                    {[
                        { id: 'today', label: 'Hoy' },
                        { id: 'this_week', label: 'Esta Semana' },
                        { id: 'this_month', label: 'Este Mes' },
                        { id: 'last_month', label: 'Mes Anterior' },
                        { id: 'this_year', label: 'Año' },
                        { id: 'all', label: 'Todos' },
                        { id: 'custom', label: 'Personalizado' }
                    ].map((btn) => (
                        <button
                            key={btn.id}
                            type="button"
                            onClick={() => setDateRange(btn.id)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                dateRange === btn.id
                                    ? 'bg-rose-600 text-white shadow-xs'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>

                {/* Custom Date Inputs */}
                {dateRange === 'custom' && (
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-white"
                        />
                        <span className="text-xs text-slate-400">a</span>
                        <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-white"
                        />
                    </div>
                )}

                {/* Category Reset Pill if selected */}
                {selectedCategory !== 'ALL' && (
                    <button
                        type="button"
                        onClick={() => setSelectedCategory('ALL')}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 rounded-md text-xs font-medium transition-colors cursor-pointer"
                    >
                        <X size={12} />
                        <span>Quitar filtro ({selectedCategory})</span>
                    </button>
                )}
            </div>

            {/* Expenses List: Dual View (Desktop Table + Mobile Cards) */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                {/* 💻 DESKTOP TABLE */}
                <div className="hidden md:block w-full overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800">
                                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Fecha y Referencia</th>
                                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Concepto y Comprobante</th>
                                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-center">Categoría</th>
                                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-center">Origen / Método</th>
                                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{isUsdOnly ? 'Monto ($)' : 'Monto ($ / Bs)'}</th>
                                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-center w-28">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="py-16 text-center text-xs font-medium text-slate-500">
                                        <div className="inline-flex items-center gap-2 text-rose-600">
                                            <div className="w-2 h-2 bg-rose-600 rounded-full animate-ping" />
                                            Cargando egresos...
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredExpenses.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="py-16 text-center">
                                        <AlertCircle size={36} className="text-slate-400 opacity-50 mx-auto mb-2" />
                                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                            Sin egresos registrados
                                        </h3>
                                        <p className="text-xs text-slate-500 mt-0.5 mb-4">
                                            No se encontraron movimientos para los filtros seleccionados.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleOpenCreate}
                                            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                                        >
                                            Registrar Gasto
                                        </button>
                                    </td>
                                </tr>
                            ) : (
                                filteredExpenses.map((ex) => {
                                    const catConfig = CATEGORY_CONFIG[ex.category] || CATEGORY_CONFIG['Otros'];
                                    const IconComponent = catConfig.icon;
                                    const amountUsd = Number(ex.amount || 0);
                                    const amountVes = amountUsd * bcvRate;

                                    return (
                                        <tr key={ex.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                            {/* Fecha & REF */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={`w-8 h-8 rounded-lg ${catConfig.bg} ${catConfig.color} border ${catConfig.border} flex items-center justify-center shrink-0`}>
                                                        <IconComponent size={15} />
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-900 dark:text-white text-xs font-medium">
                                                            {ex.date ? new Date(ex.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}
                                                        </span>
                                                        <span className="text-[11px] font-mono text-slate-400">
                                                            EXP-{ex.id.slice(-6).toUpperCase()}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Concepto & Comprobante */}
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-slate-900 dark:text-white text-xs font-medium">
                                                        {ex.description}
                                                    </span>
                                                    {ex.invoiceUrl && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setViewerInvoice({
                                                                isOpen: true,
                                                                url: ex.invoiceUrl,
                                                                details: {
                                                                    referenceNumber: `EXP-${ex.id.slice(-6).toUpperCase()}`,
                                                                    supplierName: ex.category,
                                                                    date: ex.date ? ex.date.split('T')[0] : ''
                                                                }
                                                            })}
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/40 text-[11px] font-medium hover:bg-indigo-100 transition-colors cursor-pointer w-fit"
                                                            title="Ver comprobante adjunto"
                                                        >
                                                            <Eye size={11} />
                                                            <span>Ver Comprobante</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Categoría */}
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium border ${catConfig.badge}`}>
                                                    <IconComponent size={12} />
                                                    <span>{ex.category || 'General'}</span>
                                                </span>
                                            </td>

                                            {/* Origen / Método de Pago */}
                                            <td className="px-4 py-3 text-center">
                                                {ex.deductFromCash || ex.paymentMethod === 'cash' ? (
                                                    <div className="inline-flex flex-col items-center">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 text-[11px] font-medium">
                                                            <DollarSign size={11} /> Caja Chica
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 mt-0.5">Turno POS</span>
                                                    </div>
                                                ) : (
                                                    <div className="inline-flex flex-col items-center">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[11px] font-medium">
                                                            <Landmark size={11} /> {ex.paymentMethod || 'Banco'}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 mt-0.5">Administrativo</span>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Monto ($ / Bs) */}
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-slate-900 dark:text-white font-bold text-sm tabular-nums">
                                                        {formatUsd(amountUsd)}
                                                    </span>
                                                    {!isUsdOnly && (
                                                        <span className="text-slate-500 dark:text-slate-400 text-xs tabular-nums font-mono">
                                                            {formatBs(amountVes)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Acciones */}
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenEdit(ex)}
                                                        className="p-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/30 text-slate-600 dark:text-slate-400 rounded-md border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                                        title="Editar Gasto"
                                                    >
                                                        <Edit2 size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteExpense(ex.id)}
                                                        className="p-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 text-slate-600 dark:text-slate-400 rounded-md border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                                        title="Eliminar Gasto"
                                                    >
                                                        <Trash2 size={13} />
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

                {/* 📱 MOBILE CARD VIEW */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {loading ? (
                        <div className="py-12 text-center text-rose-600 font-medium text-xs">
                            Cargando egresos...
                        </div>
                    ) : filteredExpenses.length === 0 ? (
                        <div className="py-10 text-center text-slate-400">
                            <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-xs font-medium">Sin egresos registrados</p>
                        </div>
                    ) : (
                        filteredExpenses.map((ex) => {
                            const catConfig = CATEGORY_CONFIG[ex.category] || CATEGORY_CONFIG['Otros'];
                            const IconComponent = catConfig.icon;
                            const amountUsd = Number(ex.amount || 0);
                            const amountVes = amountUsd * bcvRate;

                            return (
                                <div key={ex.id} className="p-3.5 space-y-2.5">
                                    {/* Top Row: Category icon + Description + Amount */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className={`w-8 h-8 rounded-lg ${catConfig.bg} ${catConfig.color} border ${catConfig.border} flex items-center justify-center shrink-0`}>
                                                <IconComponent size={15} />
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                                    {ex.description}
                                                </h4>
                                                <p className="text-[11px] text-slate-400 font-mono">
                                                    EXP-{ex.id.slice(-6).toUpperCase()} • {ex.date ? new Date(ex.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : 'N/A'}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Amount */}
                                        <div className="text-right shrink-0">
                                            <div className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                                                {formatUsd(amountUsd)}
                                            </div>
                                            {!isUsdOnly && (
                                                <span className="text-[10px] text-slate-400 font-mono block">
                                                    {formatBs(amountVes)}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Middle Row: Badges (Category & Origin) */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${catConfig.badge}`}>
                                            {ex.category || 'General'}
                                        </span>

                                        <span className="text-slate-500 text-[11px]">
                                            {ex.deductFromCash || ex.paymentMethod === 'cash' ? 'Caja Chica POS' : (ex.paymentMethod || 'Banco')}
                                        </span>
                                    </div>

                                    {/* Actions Row */}
                                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                                        {ex.invoiceUrl ? (
                                            <button
                                                type="button"
                                                onClick={() => setViewerInvoice({
                                                    isOpen: true,
                                                    url: ex.invoiceUrl,
                                                    details: {
                                                        referenceNumber: `EXP-${ex.id.slice(-6).toUpperCase()}`,
                                                        supplierName: ex.category,
                                                        date: ex.date ? ex.date.split('T')[0] : ''
                                                    }
                                                })}
                                                className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium"
                                            >
                                                <Eye size={12} />
                                                <span>Ver Comprobante</span>
                                            </button>
                                        ) : <div />}

                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => handleOpenEdit(ex)}
                                                className="p-1.5 text-slate-500 hover:text-blue-600 rounded transition-colors"
                                                title="Editar"
                                            >
                                                <Edit2 size={13} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteExpense(ex.id)}
                                                className="p-1.5 text-slate-500 hover:text-rose-600 rounded transition-colors"
                                                title="Eliminar"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Modal de Registro y Edición de Gastos */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}></div>
                    <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-xl relative overflow-hidden max-h-[92dvh] sm:max-h-[90vh] flex flex-col pb-safe">
                        {/* Modal Header */}
                        <div className="px-5 sm:px-8 py-4 sm:py-5 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 sm:p-3 bg-rose-500/10 text-rose-500 rounded-2xl border border-rose-500/20 shrink-0">
                                    <DollarSign size={20} />
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                        {editingExpenseId ? 'Editar Registro de Gasto' : 'Registrar Nuevo Gasto'}
                                    </h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                        Control financiero & comprobantes
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-slate-200 dark:bg-white/5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-full transition-all cursor-pointer active:scale-95">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Form */}
                        <form onSubmit={handleSaveExpense} className="p-4 sm:p-8 space-y-4 sm:space-y-5 overflow-y-auto custom-scrollbar flex-1 pb-safe">
                            {/* Concepto / Descripción */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">
                                    Descripción / Concepto *
                                </label>
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    placeholder="Ej. Pago de Electricidad CORPOELEC mes actual..."
                                    value={formExpense.description}
                                    onChange={e => setFormExpense({ ...formExpense, description: e.target.value })}
                                    className="w-full px-4 sm:px-5 py-3 sm:py-3.5 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl text-base sm:text-xs min-h-[44px] font-bold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                                />
                            </div>

                            {/* Moneda y Monto */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                                            Monto del Gasto *
                                        </label>
                                        {/* Currency Selector Switch */}
                                        <div className="flex items-center gap-1 bg-slate-200 dark:bg-black/40 p-1 rounded-xl">
                                            <button
                                                type="button"
                                                onClick={() => handleCurrencyToggle('USD')}
                                                className={`min-h-[32px] px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase cursor-pointer transition-all active:scale-95 ${
                                                    inputCurrency === 'USD' ? 'bg-rose-500 text-white' : 'text-slate-500'
                                                }`}
                                            >
                                                $ USD
                                            </button>
                                            {!isUsdOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleCurrencyToggle('VES')}
                                                    className={`min-h-[32px] px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase cursor-pointer transition-all active:scale-95 ${
                                                        inputCurrency === 'VES' ? 'bg-rose-500 text-white' : 'text-slate-500'
                                                    }`}
                                                >
                                                    Bs.
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            required
                                            placeholder="0.00"
                                            value={enteredAmount}
                                            onChange={e => handleAmountChange(e.target.value, inputCurrency)}
                                            className="w-full px-4 sm:px-5 py-3 sm:py-3.5 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl text-base min-h-[44px] font-black font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                                            {inputCurrency}
                                        </span>
                                    </div>
                                    {/* Conversion feedback */}
                                    {enteredAmount && !isUsdOnly && (
                                        <p className="text-[10px] font-bold text-rose-500 mt-1 font-mono">
                                            ≈ {inputCurrency === 'USD' ? formatBs(Number(enteredAmount) * bcvRate) : formatUsd(Number(formExpense.amount))} (Tasa: {bcvRate.toFixed(2)})
                                        </p>
                                    )}
                                </div>

                                {/* Fecha */}
                                <div>
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">
                                        Fecha del Gasto *
                                    </label>
                                    <input
                                        type="date"
                                        required
                                        value={formExpense.date}
                                        onChange={e => setFormExpense({ ...formExpense, date: e.target.value })}
                                        className="w-full px-4 sm:px-5 py-3 sm:py-3.5 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl text-base sm:text-xs min-h-[44px] font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                                    />
                                </div>
                            </div>

                            {/* Categoría */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">
                                    Categoría de Gasto *
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {Object.keys(CATEGORY_CONFIG).map(catName => {
                                        const cfg = CATEGORY_CONFIG[catName];
                                        const IconComp = cfg.icon;
                                        const isSel = formExpense.category === catName;

                                        return (
                                            <button
                                                key={catName}
                                                type="button"
                                                onClick={() => setFormExpense({ ...formExpense, category: catName })}
                                                className={`min-h-[42px] flex items-center gap-2 p-2 sm:p-2.5 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95 ${
                                                    isSel
                                                        ? 'bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/20'
                                                        : `${cfg.bg} ${cfg.color} ${cfg.border} hover:opacity-80`
                                                }`}
                                            >
                                                <IconComp size={14} className="shrink-0" />
                                                <span className="truncate">{catName}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Método de Pago & Caja Chica */}
                            <div className="p-3.5 sm:p-4 bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-2xl space-y-3">
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                                    Método de Pago & Origen de Fondos
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {activePaymentMethods.map(pm => {
                                        const IconComp = pm.icon;
                                        const isSel = formExpense.paymentMethod === pm.id;

                                        return (
                                            <button
                                                key={pm.id}
                                                type="button"
                                                onClick={() => setFormExpense({ ...formExpense, paymentMethod: pm.id, deductFromCash: pm.isCashDrawer })}
                                                className={`min-h-[42px] flex items-center gap-2 p-2 sm:p-2.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95 ${
                                                    isSel
                                                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent shadow-md'
                                                        : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400'
                                                }`}
                                            >
                                                <IconComp size={12} className="shrink-0" />
                                                <span className="truncate">{pm.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <label className="flex items-center gap-2.5 pt-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formExpense.deductFromCash}
                                        onChange={e => setFormExpense({ ...formExpense, deductFromCash: e.target.checked })}
                                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                                    />
                                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                        Deducir del Efectivo en Caja Chica (Turno de Caja Activo)
                                    </span>
                                </label>
                            </div>

                            {/* Digitalización de Comprobante / Factura */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">
                                    Comprobante Digital / Factura Adjunta
                                </label>

                                {formExpense.invoiceUrl ? (
                                    <div className="flex items-center justify-between p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
                                            <div className="truncate">
                                                <p className="text-xs font-black text-slate-900 dark:text-white uppercase truncate">
                                                    Comprobante Adjuntado
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-mono truncate">
                                                    {formExpense.invoiceUrl}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => setViewerInvoice({
                                                    isOpen: true,
                                                    url: formExpense.invoiceUrl,
                                                    details: { referenceNumber: 'NUEVO', supplierName: formExpense.category, date: formExpense.date }
                                                })}
                                                className="min-h-[38px] p-2 bg-white dark:bg-white/10 hover:bg-slate-100 rounded-xl text-slate-700 dark:text-white text-xs font-bold transition-all cursor-pointer active:scale-95"
                                                title="Ver Comprobante"
                                            >
                                                <Eye size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setFormExpense({ ...formExpense, invoiceUrl: '' })}
                                                className="min-h-[38px] p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95"
                                                title="Eliminar Comprobante"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                        {/* Subir Archivo */}
                                        <label className="min-h-[56px] flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-slate-300 dark:border-white/10 hover:border-rose-500 rounded-2xl text-center cursor-pointer transition-all bg-slate-50 dark:bg-white/5 active:scale-95">
                                            <Upload size={18} className="text-rose-500 mb-1" />
                                            <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300">
                                                Subir Archivo
                                            </span>
                                            <span className="text-[8px] text-slate-400">PDF, JPG, PNG</span>
                                            <input
                                                type="file"
                                                accept="image/*,.pdf"
                                                className="hidden"
                                                onChange={e => handleUploadInvoiceFile(e.target.files[0])}
                                            />
                                        </label>

                                        {/* Escanear con Impresora */}
                                        <button
                                            type="button"
                                            onClick={() => setShowPrinterModal(true)}
                                            className="min-h-[56px] flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-slate-300 dark:border-white/10 hover:border-rose-500 rounded-2xl text-center cursor-pointer transition-all bg-slate-50 dark:bg-white/5 active:scale-95"
                                        >
                                            <Printer size={18} className="text-amber-500 mb-1" />
                                            <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300">
                                                Escanear
                                            </span>
                                            <span className="text-[8px] text-slate-400">Impresora WIA</span>
                                        </button>

                                        {/* Cámara Web */}
                                        <button
                                            type="button"
                                            onClick={() => setShowCameraModal(true)}
                                            className="min-h-[56px] flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-slate-300 dark:border-white/10 hover:border-rose-500 rounded-2xl text-center cursor-pointer transition-all bg-slate-50 dark:bg-white/5 active:scale-95"
                                        >
                                            <Camera size={18} className="text-blue-500 mb-1" />
                                            <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300">
                                                Tomar Foto
                                            </span>
                                            <span className="text-[8px] text-slate-400">Cámara Web</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Modal Actions */}
                            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 sm:gap-3 pt-4 border-t border-slate-200 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="min-h-[48px] w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-300 dark:border-white/10 text-xs font-black uppercase text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all cursor-pointer flex items-center justify-center active:scale-95"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={processing}
                                    className="min-h-[48px] w-full sm:w-auto px-6 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95"
                                >
                                    {processing && <Loader2 size={14} className="animate-spin" />}
                                    <span>{editingExpenseId ? 'Guardar Cambios' : 'Registrar Gasto'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Confirm Modal */}
            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
                onConfirm={confirmConfig.action}
                title={confirmConfig.title}
                message={confirmConfig.message}
                variant={confirmConfig.variant}
                confirmText={confirmConfig.confirmText}
            />

            {/* Invoice Viewer Modal */}
            <InvoiceViewerModal
                isOpen={viewerInvoice.isOpen}
                onClose={() => setViewerInvoice({ isOpen: false, url: '', details: {} })}
                invoiceUrl={viewerInvoice.url}
                invoiceDetails={viewerInvoice.details}
            />

            {/* Printer Scanner Modal */}
            <PrinterScanModal
                isOpen={showPrinterModal}
                onClose={() => setShowPrinterModal(false)}
                onScan={handleExecuteScan}
                loading={isScanningPrinter}
            />

            {/* Camera Scan Modal */}
            <CameraScanModal
                isOpen={showCameraModal}
                onClose={() => setShowCameraModal(false)}
                onCapture={(file) => {
                    setShowCameraModal(false);
                    handleUploadInvoiceFile(file);
                }}
            />
        </div>
    );
}
