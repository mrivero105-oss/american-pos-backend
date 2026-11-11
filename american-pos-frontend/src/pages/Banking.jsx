import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { 
    Landmark, Plus, ArrowUpRight, ArrowDownRight, RefreshCw, 
    Search, Filter, Calendar, DollarSign, Banknote, ShieldCheck, 
    TrendingUp, TrendingDown, Building2, CreditCard, ArrowLeftRight, 
    CheckCircle2, AlertCircle, Edit2, Trash2, Eye, FileText, Check, 
    Layers, Wallet, MoreVertical, X, Clock, HelpCircle, ChevronRight
} from 'lucide-react';
import api from '../services/api';
import { formatMoney } from '../utils/format';
import BankReconciliationModal from '../components/BankReconciliationModal';

// Venezuelan and International Bank Presets
const BANK_PRESETS = [
    { name: 'Banesco Banco Universal', code: '0134', defaultCurrency: 'VES', color: 'bg-emerald-600' },
    { name: 'Banco de Venezuela', code: '0102', defaultCurrency: 'VES', color: 'bg-red-600' },
    { name: 'Mercantil Banco', code: '0105', defaultCurrency: 'VES', color: 'bg-blue-600' },
    { name: 'BBVA Provincial', code: '0108', defaultCurrency: 'VES', color: 'bg-cyan-700' },
    { name: 'Bancamiga Banco Universal', code: '0172', defaultCurrency: 'VES', color: 'bg-teal-600' },
    { name: 'Banco Nacional de Crédito (BNC)', code: '0191', defaultCurrency: 'VES', color: 'bg-amber-600' },
    { name: 'Bancaribe', code: '0114', defaultCurrency: 'VES', color: 'bg-blue-800' },
    { name: 'Banco Fondo Común (BFC)', code: '0151', defaultCurrency: 'VES', color: 'bg-indigo-600' },
    { name: 'Banplus Banco Universal', code: '0174', defaultCurrency: 'VES', color: 'bg-orange-600' },
    { name: 'Banco del Tesoro', code: '0163', defaultCurrency: 'VES', color: 'bg-rose-700' },
    { name: 'Banesco Panamá (USD)', code: 'BPAN', defaultCurrency: 'USD', color: 'bg-emerald-700' },
    { name: 'Zelle / Banco USA (USD)', code: 'ZELLE', defaultCurrency: 'USD', color: 'bg-purple-600' },
    { name: 'Binance Pay / USDT', code: 'CRYPTO', defaultCurrency: 'USD', color: 'bg-amber-500' },
    { name: 'Cuenta Custodia en Dólares (Nacional)', code: 'CUSTODIA', defaultCurrency: 'USD', color: 'bg-teal-700' },
    { name: 'Otro Banco / Billetera', code: 'OTRO', defaultCurrency: 'VES', color: 'bg-slate-700' }
];

export default function Banking() {
    const [accounts, setAccounts] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [cashflow, setCashflow] = useState(null);
    const [exchangeDifferences, setExchangeDifferences] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [selectedAccountFilter, setSelectedAccountFilter] = useState('ALL');
    const [selectedTypeFilter, setSelectedTypeFilter] = useState('ALL');
    const [selectedStatusFilter, setSelectedStatusFilter] = useState('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState('all'); // 'today', 'this_month', 'all'

    // Modals
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [isManualTxModalOpen, setIsManualTxModalOpen] = useState(false);
    const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
    const [reconcileInitialAccount, setReconcileInitialAccount] = useState(null);
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

    // Forms
    const [accountForm, setAccountForm] = useState({
        bankName: 'Banesco Banco Universal',
        accountNumber: '',
        accountType: 'CORRIENTE',
        currency: 'VES',
        initialBalance: '0',
        accountHolder: '',
        holderIdDoc: '',
        phone: '',
        color: '#059669'
    });

    const [transferForm, setTransferForm] = useState({
        fromType: 'BANK',
        fromId: '',
        toType: 'BANK',
        toId: '',
        amountSent: '',
        currencySent: 'VES',
        referenceNumber: '',
        notes: '',
        date: new Date().toISOString().split('T')[0]
    });

    const [manualTxForm, setManualTxForm] = useState({
        bankAccountId: '',
        type: 'INGRESO',
        amount: '',
        referenceNumber: '',
        description: '',
        category: 'MANUAL',
        date: new Date().toISOString().split('T')[0]
    });

    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadAllBankingData();
    }, [selectedAccountFilter, selectedTypeFilter, selectedStatusFilter, dateRange]);

    const loadAllBankingData = async () => {
        try {
            setLoading(true);
            const [accRes, cfRes, txRes, diffRes] = await Promise.all([
                api.get('/banks/accounts'),
                api.get('/banks/cashflow'),
                api.get('/banks/transactions', {
                    params: {
                        bankAccountId: selectedAccountFilter === 'ALL' ? undefined : selectedAccountFilter,
                        type: selectedTypeFilter === 'ALL' ? undefined : selectedTypeFilter,
                        status: selectedStatusFilter === 'ALL' ? undefined : selectedStatusFilter,
                        dateRange: dateRange !== 'all' ? dateRange : undefined
                    }
                }),
                api.get('/banks/exchange-differences')
            ]);

            setAccounts(Array.isArray(accRes.data) ? accRes.data : (accRes.data?.accounts || []));
            setCashflow(cfRes.data || null);
            setTransactions(Array.isArray(txRes.data) ? txRes.data : (txRes.data?.transactions || []));
            setExchangeDifferences(Array.isArray(diffRes.data) ? diffRes.data : (diffRes.data?.logs || diffRes.data?.differences || []));
        } catch (error) {
            console.error('Error fetching banking data:', error);
            toast.error('Error al cargar datos bancarios y de tesorería');
        } finally {
            setLoading(false);
        }
    };

    // Filter transactions locally for fast search
    const filteredTransactions = useMemo(() => {
        return transactions.filter(tx => {
            const term = searchTerm.toLowerCase();
            const refMatch = (tx.referenceNumber || '').toLowerCase().includes(term);
            const descMatch = (tx.description || '').toLowerCase().includes(term);
            const accMatch = (tx.Account?.bankName || '').toLowerCase().includes(term);
            return refMatch || descMatch || accMatch;
        });
    }, [transactions, searchTerm]);

    // Financial totals summary
    const summary = useMemo(() => {
        let totalVes = 0;
        let totalUsd = 0;
        accounts.forEach(acc => {
            const bal = Number(acc.currentBalance) || 0;
            if (acc.currency === 'USD') totalUsd += bal;
            else totalVes += bal;
        });

        const drawerVes = cashflow?.totals?.cashDrawers?.ves || 0;
        const drawerUsd = cashflow?.totals?.cashDrawers?.usd || 0;

        return {
            bankTotalVes: totalVes,
            bankTotalUsd: totalUsd,
            drawerVes,
            drawerUsd,
            grandTotalVes: totalVes + drawerVes,
            grandTotalUsd: totalUsd + drawerUsd,
            accountCount: accounts.length
        };
    }, [accounts, cashflow]);

    // Handlers
    const handleOpenCreateAccount = () => {
        setEditingAccount(null);
        setAccountForm({
            bankName: 'Banesco Banco Universal',
            accountNumber: '',
            accountType: 'CORRIENTE',
            currency: 'VES',
            initialBalance: '0',
            accountHolder: '',
            holderIdDoc: '',
            phone: '',
            color: '#059669'
        });
        setIsAccountModalOpen(true);
    };

    const handleOpenEditAccount = (acc) => {
        setEditingAccount(acc);
        setAccountForm({
            bankName: acc.bankName,
            accountNumber: acc.accountNumber || '',
            accountType: acc.accountType || 'CORRIENTE',
            currency: acc.currency || 'VES',
            initialBalance: acc.initialBalance || 0,
            accountHolder: acc.accountHolder || '',
            holderIdDoc: acc.holderIdDoc || '',
            phone: acc.phone || '',
            color: acc.color || '#059669'
        });
        setIsAccountModalOpen(true);
    };

    const handleSaveAccount = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            if (editingAccount) {
                await api.put(`/banks/accounts/${editingAccount.id}`, accountForm);
                toast.success('Cuenta bancaria actualizada');
            } else {
                await api.post('/banks/accounts', accountForm);
                toast.success('Cuenta bancaria registrada exitosamente');
            }
            setIsAccountModalOpen(false);
            loadAllBankingData();
        } catch (error) {
            console.error('Error saving bank account:', error);
            toast.error(error.response?.data?.error || 'Error al guardar la cuenta');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteAccount = async (acc) => {
        if (!window.confirm(`¿Deseas desactivar la cuenta bancaria ${acc.bankName}? No se borrarán los movimientos históricos.`)) return;
        try {
            await api.delete(`/banks/accounts/${acc.id}`);
            toast.success('Cuenta bancaria desactivada');
            loadAllBankingData();
        } catch (error) {
            console.error('Error deactivating account:', error);
            toast.error('Error al desactivar la cuenta');
        }
    };

    const handleOpenTransfer = (preselectedFromId = null) => {
        const fromAcc = accounts.find(a => a.id === preselectedFromId) || accounts[0];
        const toAcc = accounts.length > 1 ? (accounts.find(a => a.id !== fromAcc?.id) || accounts[1]) : null;
        const savedRate = Number(localStorage.getItem('pos_bcv_rate') || 36.5);
        setTransferForm({
            fromType: 'BANK',
            fromId: fromAcc?.id || '',
            toType: toAcc ? 'BANK' : 'CASH_DRAWER',
            toId: toAcc?.id || 'CASH_VES',
            amountSent: '',
            currencySent: fromAcc?.currency || 'VES',
            currencyReceived: toAcc?.currency || 'VES',
            exchangeRate: savedRate > 0 ? String(savedRate) : '1',
            referenceNumber: '',
            notes: '',
            date: new Date().toISOString().split('T')[0]
        });
        setIsTransferModalOpen(true);
    };

    const handleExecuteTransfer = async (e) => {
        e.preventDefault();
        if (transferForm.fromType === transferForm.toType && transferForm.fromId === transferForm.toId) {
            toast.error('La cuenta de origen y destino no pueden ser la misma');
            return;
        }

        const fromCur = transferForm.fromType === 'CASH_DRAWER'
            ? (transferForm.fromId === 'CASH_USD' ? 'USD' : 'VES')
            : (accounts.find(a => a.id === transferForm.fromId)?.currency || transferForm.currencySent || 'VES');
        const toCur = transferForm.toType === 'CASH_DRAWER'
            ? (transferForm.toId === 'CASH_USD' ? 'USD' : 'VES')
            : (accounts.find(a => a.id === transferForm.toId)?.currency || transferForm.currencyReceived || 'VES');
        const sent = Number(transferForm.amountSent) || 0;
        const rate = Number(transferForm.exchangeRate) || 1;
        let amountReceived = sent;
        if (fromCur !== toCur) {
            amountReceived = fromCur === 'USD' ? Number((sent * rate).toFixed(2)) : (rate > 0 ? Number((sent / rate).toFixed(2)) : sent);
        }

        try {
            setSaving(true);
            await api.post('/banks/transfer', {
                ...transferForm,
                currencySent: fromCur,
                currencyReceived: toCur,
                exchangeRate: rate,
                amountReceived
            });
            toast.success('Transferencia registrada exitosamente');
            setIsTransferModalOpen(false);
            loadAllBankingData();
        } catch (error) {
            console.error('Error processing transfer:', error);
            toast.error(error.response?.data?.error || 'Error al procesar la transferencia');
        } finally {
            setSaving(false);
        }
    };

    const handleOpenManualTx = (preselectedAccountId = null, defaultType = 'INGRESO') => {
        setManualTxForm({
            bankAccountId: preselectedAccountId || (accounts[0]?.id || ''),
            type: defaultType,
            amount: '',
            referenceNumber: '',
            description: defaultType === 'INGRESO' ? 'Depósito bancario directo' : 'Retiro / Débito bancario directo',
            category: 'MANUAL',
            date: new Date().toISOString().split('T')[0]
        });
        setIsManualTxModalOpen(true);
    };

    const handleSaveManualTx = async (e) => {
        e.preventDefault();
        if (!manualTxForm.amount || Number(manualTxForm.amount) <= 0) {
            toast.error('Ingresa un monto válido');
            return;
        }

        try {
            setSaving(true);
            await api.post('/banks/transactions', manualTxForm);
            toast.success('Movimiento bancario registrado');
            setIsManualTxModalOpen(false);
            loadAllBankingData();
        } catch (error) {
            console.error('Error saving transaction:', error);
            toast.error(error.response?.data?.error || 'Error al registrar el movimiento');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleQuickReconcile = async (tx) => {
        try {
            const nextStatus = tx.status !== 'CONCILIADO';
            await api.post(`/banks/transactions/${tx.id}/reconcile`, { reconciled: nextStatus });
            toast.success(nextStatus ? 'Movimiento conciliado' : 'Movimiento desconciliado');
            setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, status: nextStatus ? 'CONCILIADO' : 'PENDIENTE' } : t));
        } catch (error) {
            console.error('Error toggling reconcile:', error);
            toast.error('Error al actualizar estatus de conciliación');
        }
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 overflow-y-auto custom-scrollbar pb-24 sm:pb-8 pb-safe">
            <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-4 sm:space-y-6">

                {/* Page Title & Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold shrink-0">
                                <Landmark size={24} />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                                    Bancos & Tesorería
                                </h1>
                                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                    Control de cuentas bancarias, custodia en divisas, transferencias y conciliación
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
                        <button
                            onClick={() => setIsDiffModalOpen(true)}
                            className="min-h-[44px] px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/70 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
                            title="Auditoría de diferencial cambiario registrado"
                        >
                            <ArrowLeftRight size={15} className="text-primary-500 shrink-0" />
                            <span className="truncate">Diferencial</span>
                            {exchangeDifferences.length > 0 && (
                                <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse shrink-0"></span>
                            )}
                        </button>

                        <button
                            onClick={() => {
                                setReconcileInitialAccount(null);
                                setIsReconcileModalOpen(true);
                            }}
                            className="min-h-[44px] px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/70 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
                        >
                            <ShieldCheck size={15} className="text-emerald-500 shrink-0" />
                            <span className="truncate">Conciliación</span>
                        </button>

                        <button
                            onClick={() => handleOpenTransfer()}
                            disabled={accounts.length === 0}
                            className="min-h-[44px] px-3.5 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm shadow-indigo-500/20 active:scale-95"
                        >
                            <ArrowLeftRight size={15} className="shrink-0" />
                            <span className="truncate">Transferir</span>
                        </button>

                        <button
                            onClick={handleOpenCreateAccount}
                            className="min-h-[44px] px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-xs font-black tracking-wide transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm shadow-primary-500/20 active:scale-95"
                        >
                            <Plus size={16} className="shrink-0" />
                            <span className="truncate">Nueva Cuenta</span>
                        </button>
                    </div>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Card 1: Total Bancos USD */}
                    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm relative overflow-hidden group">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                                Bancos en Dólares ($)
                            </span>
                            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
                                <DollarSign size={18} />
                            </div>
                        </div>
                        <div className="mt-3">
                            <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
                                {formatMoney(summary.bankTotalUsd, 'USD')}
                            </span>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="font-bold text-emerald-500">Saldo Consolidado</span>
                            <span>en cuentas USD</span>
                        </div>
                    </div>

                    {/* Card 2: Total Bancos VES */}
                    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm relative overflow-hidden group">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                                Bancos en Bolívares (Bs)
                            </span>
                            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
                                <Banknote size={18} />
                            </div>
                        </div>
                        <div className="mt-3">
                            <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
                                {formatMoney(summary.bankTotalVes, 'VES')}
                            </span>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="font-bold text-blue-500">Saldo Consolidado</span>
                            <span>en cuentas VES</span>
                        </div>
                    </div>

                    {/* Card 3: Efectivo en Cajas Turno */}
                    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm relative overflow-hidden group">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                                Efectivo en Cajas
                            </span>
                            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
                                <Wallet size={18} />
                            </div>
                        </div>
                        <div className="mt-2 space-y-0.5">
                            <div className="text-base font-black text-slate-800 dark:text-white tabular-nums">
                                {formatMoney(summary.drawerUsd, 'USD')}
                            </div>
                            <div className="text-xs font-bold text-slate-500 tabular-nums">
                                + {formatMoney(summary.drawerVes, 'VES')}
                            </div>
                        </div>
                        <div className="mt-2 text-[10px] text-amber-500 font-bold">
                            Disponible en gavetas activas
                        </div>
                    </div>

                    {/* Card 4: Gran Total Tesorería */}
                    <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden group">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Tesorería Total
                            </span>
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                                <Building2 size={16} />
                            </div>
                        </div>
                        <div className="mt-2 space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                {formatMoney(summary.grandTotalUsd, 'USD')}
                            </div>
                            <div className="text-xs font-medium font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                + {formatMoney(summary.grandTotalVes, 'VES')}
                            </div>
                        </div>
                        <div className="mt-2 text-[11px] font-medium text-slate-400">
                            Bancos ({summary.accountCount}) + Gavetas físicas
                        </div>
                    </div>
                </div>

                {/* Bank Accounts Grid */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                            <span>Cuentas Bancarias Registradas</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                                {accounts.length}
                            </span>
                        </h2>
                    </div>

                    {accounts.length === 0 ? (
                        <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-center space-y-3">
                            <div className="w-12 h-12 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center mx-auto font-bold">
                                <Landmark size={24} />
                            </div>
                            <h3 className="text-base font-black text-slate-800 dark:text-white">
                                No tienes cuentas bancarias registradas aún
                            </h3>
                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                                Agrega tus cuentas corrientes, de ahorro, custodia en divisas o billeteras electrónicas para controlar el flujo de dinero y conciliar tus saldos.
                            </p>
                            <button
                                onClick={handleOpenCreateAccount}
                                className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-xs font-black transition-all inline-flex items-center gap-2 cursor-pointer shadow-sm"
                            >
                                <Plus size={16} />
                                <span>Registrar Primera Cuenta</span>
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {accounts.map(acc => {
                                const isUsd = acc.currency === 'USD';
                                return (
                                    <div 
                                        key={acc.id}
                                        className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm hover:border-primary-500/40 transition-all flex flex-col justify-between relative group"
                                    >
                                        <div>
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-xs shadow-sm ${
                                                        isUsd ? 'bg-emerald-600' : 'bg-blue-600'
                                                    }`}>
                                                        <Landmark size={20} />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-sm font-black text-slate-900 dark:text-white truncate max-w-[180px]">
                                                            {acc.bankName}
                                                        </h3>
                                                        <div className="flex items-center gap-1.5 mt-0.5">
                                                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                                isUsd ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                                            }`}>
                                                                {acc.currency}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400 font-semibold uppercase">
                                                                {acc.accountType}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => handleOpenEditAccount(acc)}
                                                        className="min-h-[36px] min-w-[36px] flex items-center justify-center p-2 text-slate-400 hover:text-primary-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer active:scale-95"
                                                        title="Editar datos de cuenta"
                                                    >
                                                        <Edit2 size={15} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteAccount(acc)}
                                                        className="min-h-[36px] min-w-[36px] flex items-center justify-center p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer active:scale-95"
                                                        title="Desactivar cuenta"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Account Balances */}
                                            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
                                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                                    Saldo Actual en Libros
                                                </span>
                                                <span className={`text-2xl font-black tabular-nums tracking-tight ${
                                                    Number(acc.currentBalance) < 0 ? 'text-rose-500' : isUsd ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'
                                                }`}>
                                                    {formatMoney(acc.currentBalance, acc.currency)}
                                                </span>
                                            </div>

                                            {/* Metadata */}
                                            <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                                                {acc.accountNumber && (
                                                    <div className="flex items-center justify-between text-[11px]">
                                                        <span className="text-slate-400">N° Cuenta:</span>
                                                        <span className="font-bold text-slate-700 dark:text-slate-200">
                                                            {acc.accountNumber.length > 10 ? `...${acc.accountNumber.slice(-10)}` : acc.accountNumber}
                                                        </span>
                                                    </div>
                                                )}
                                                {acc.accountHolder && (
                                                    <div className="flex items-center justify-between text-[11px]">
                                                        <span className="text-slate-400">Titular:</span>
                                                        <span className="truncate max-w-[140px] text-slate-700 dark:text-slate-200 font-sans">
                                                            {acc.accountHolder}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Quick Account Actions */}
                                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5 grid grid-cols-3 gap-2 text-center">
                                            <button
                                                onClick={() => handleOpenManualTx(acc.id, 'INGRESO')}
                                                type="button"
                                                className="min-h-[38px] py-2 px-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center justify-center"
                                            >
                                                + Depósito
                                            </button>
                                            <button
                                                onClick={() => handleOpenManualTx(acc.id, 'EGRESO')}
                                                type="button"
                                                className="min-h-[38px] py-2 px-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center justify-center"
                                            >
                                                - Retiro
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setReconcileInitialAccount(acc.id);
                                                    setIsReconcileModalOpen(true);
                                                }}
                                                type="button"
                                                className="min-h-[38px] py-2 px-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center justify-center"
                                            >
                                                Conciliar
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Transactions History Header & Filters */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex items-center justify-between sm:justify-start gap-2">
                            <h2 className="text-base font-black text-slate-900 dark:text-white">
                                Movimientos Bancarios
                            </h2>
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold">
                                {filteredTransactions.length}
                            </span>
                        </div>

                        {/* Filters Bar */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5 w-full md:w-auto">
                            {/* Search */}
                            <div className="relative w-full sm:col-span-2 lg:w-64">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Buscar referencia o concepto..."
                                    className="w-full pl-9 pr-3 py-2 min-h-[42px] sm:min-h-[36px] bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-xl text-base sm:text-xs text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>

                            {/* Account Filter */}
                            <select
                                value={selectedAccountFilter}
                                onChange={(e) => setSelectedAccountFilter(e.target.value)}
                                className="w-full sm:w-auto min-h-[42px] sm:min-h-[36px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                            >
                                <option value="ALL">Todas las cuentas</option>
                                {accounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.bankName} ({acc.currency})</option>
                                ))}
                            </select>

                            {/* Type Filter */}
                            <select
                                value={selectedTypeFilter}
                                onChange={(e) => setSelectedTypeFilter(e.target.value)}
                                className="w-full sm:w-auto min-h-[42px] sm:min-h-[36px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                            >
                                <option value="ALL">Todos los tipos</option>
                                <option value="INGRESO">Ingresos / Depósitos</option>
                                <option value="EGRESO">Egresos / Retiros</option>
                                <option value="TRANSFERENCIA_ENTRADA">Transf. Recibidas</option>
                                <option value="TRANSFERENCIA_SALIDA">Transf. Enviadas</option>
                                <option value="COMISION">Comisiones</option>
                            </select>

                            {/* Status Filter */}
                            <select
                                value={selectedStatusFilter}
                                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                                className="w-full sm:w-auto min-h-[42px] sm:min-h-[36px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                            >
                                <option value="ALL">Cualquier estatus</option>
                                <option value="PENDIENTE">Pendientes de Conciliar</option>
                                <option value="CONCILIADO">Conciliados</option>
                            </select>

                            <button
                                onClick={loadAllBankingData}
                                className="min-h-[42px] sm:min-h-[36px] min-w-[42px] sm:min-w-[36px] flex items-center justify-center p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 border border-slate-200 dark:border-white/10"
                                title="Recargar movimientos"
                            >
                                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>

                    {/* Mobile Cards (block md:hidden) */}
                    <div className="block md:hidden divide-y divide-slate-100 dark:divide-white/5">
                        {loading ? (
                            <div className="py-12 text-center text-slate-400">
                                <RefreshCw className="animate-spin text-primary-500 mx-auto mb-2" size={24} />
                                <span className="text-xs">Cargando transacciones bancarias...</span>
                            </div>
                        ) : filteredTransactions.length === 0 ? (
                            <div className="py-12 text-center text-slate-400 p-4">
                                <FileText className="mx-auto mb-2 opacity-50" size={28} />
                                <span className="text-xs">No hay movimientos registrados con los filtros seleccionados</span>
                            </div>
                        ) : (
                            filteredTransactions.map(tx => {
                                const isIngreso = tx.type === 'INGRESO' || tx.type === 'TRANSFERENCIA_ENTRADA';
                                const isReconciled = tx.status === 'CONCILIADO';

                                return (
                                    <div key={tx.id} className="p-4 space-y-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="font-bold text-slate-900 dark:text-white text-xs truncate">
                                                    {tx.Account?.bankName || 'Banco'}
                                                </span>
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                                                    {tx.currency}
                                                </span>
                                            </div>
                                            <span className="text-[11px] font-mono text-slate-400 shrink-0">
                                                {tx.date}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between gap-2">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                                isIngreso 
                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                                                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                            }`}>
                                                {isIngreso ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                                                {tx.type}
                                            </span>
                                            {tx.referenceNumber && (
                                                <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300">
                                                    Ref: {tx.referenceNumber}
                                                </span>
                                            )}
                                        </div>

                                        {tx.description && (
                                            <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                                                {tx.description}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5">
                                            <div>
                                                <span className="text-[10px] uppercase font-bold text-slate-400 block">Monto</span>
                                                <span className={`text-sm font-black tabular-nums ${
                                                    isIngreso ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                                }`}>
                                                    {isIngreso ? '+' : '-'}{formatMoney(tx.amount, tx.currency)}
                                                </span>
                                            </div>

                                            <button
                                                onClick={() => handleToggleQuickReconcile(tx)}
                                                type="button"
                                                className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer transition-all border active:scale-95 ${
                                                    isReconciled 
                                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' 
                                                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500 hover:text-white'
                                                }`}
                                            >
                                                {isReconciled ? <Check size={14} /> : <Clock size={14} />}
                                                <span>{isReconciled ? 'Conciliado' : 'Pendiente'}</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Desktop Transactions Table (hidden md:block) */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/30 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                                    <th className="py-3 px-4">Fecha</th>
                                    <th className="py-3 px-4">Cuenta</th>
                                    <th className="py-3 px-4">Tipo</th>
                                    <th className="py-3 px-4">Referencia</th>
                                    <th className="py-3 px-4">Descripción</th>
                                    <th className="py-3 px-4 text-right">Monto</th>
                                    <th className="py-3 px-4 text-center">Conciliación</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-xs">
                                {loading ? (
                                    <tr>
                                        <td colSpan="7" className="py-12 text-center text-slate-400">
                                            <RefreshCw className="animate-spin text-primary-500 mx-auto mb-2" size={24} />
                                            <span>Cargando transacciones bancarias...</span>
                                        </td>
                                    </tr>
                                ) : filteredTransactions.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="py-12 text-center text-slate-400">
                                            <FileText className="mx-auto mb-2 opacity-50" size={28} />
                                            <span>No hay movimientos registrados con los filtros seleccionados</span>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredTransactions.map(tx => {
                                        const isIngreso = tx.type === 'INGRESO' || tx.type === 'TRANSFERENCIA_ENTRADA';
                                        const isReconciled = tx.status === 'CONCILIADO';

                                        return (
                                            <tr 
                                                key={tx.id}
                                                className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                                            >
                                                <td className="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                    {tx.date}
                                                </td>
                                                <td className="py-3.5 px-4 font-bold text-slate-800 dark:text-white whitespace-nowrap">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>{tx.Account?.bankName || 'Banco'}</span>
                                                        <span className="text-[10px] font-normal text-slate-400">
                                                            ({tx.currency})
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                                        isIngreso 
                                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                                                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                    }`}>
                                                        {isIngreso ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                                                        {tx.type}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 font-mono text-slate-700 dark:text-slate-300 font-bold whitespace-nowrap">
                                                    {tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : '-'}
                                                </td>
                                                <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                                                    {tx.description || '-'}
                                                </td>
                                                <td className="py-3.5 px-4 text-right font-black tabular-nums whitespace-nowrap">
                                                    <span className={isIngreso ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                                        {isIngreso ? '+' : '-'}{formatMoney(tx.amount, tx.currency)}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                                    <button
                                                        onClick={() => handleToggleQuickReconcile(tx)}
                                                        type="button"
                                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black cursor-pointer transition-all border ${
                                                            isReconciled 
                                                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' 
                                                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500 hover:text-white'
                                                        }`}
                                                        title={isReconciled ? 'Clic para desconciliar' : 'Clic para marcar como conciliado'}
                                                    >
                                                        {isReconciled ? <Check size={12} /> : <Clock size={12} />}
                                                        <span>{isReconciled ? 'Conciliado' : 'Pendiente'}</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>

            {/* Modal: Create/Edit Bank Account */}
            {isAccountModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[92dvh] sm:max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150">
                        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                            <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <Landmark size={18} className="text-primary-500" />
                                <span>{editingAccount ? 'Editar Cuenta Bancaria' : 'Registrar Nueva Cuenta Bancaria'}</span>
                            </h3>
                            <button
                                onClick={() => setIsAccountModalOpen(false)}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl active:scale-95"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveAccount} className="overflow-y-auto p-4 sm:p-5 space-y-4 pb-safe custom-scrollbar">
                            {/* Preset Selector */}
                            {!editingAccount && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Plantilla Rápida de Banco
                                    </label>
                                    <select
                                        onChange={(e) => {
                                            const preset = BANK_PRESETS.find(p => p.name === e.target.value);
                                            if (preset) {
                                                setAccountForm({
                                                    ...accountForm,
                                                    bankName: preset.name,
                                                    currency: preset.defaultCurrency
                                                });
                                            }
                                        }}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    >
                                        {BANK_PRESETS.map(p => (
                                            <option key={p.name} value={p.name}>
                                                {p.name} [{p.defaultCurrency}]
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Nombre de la Entidad o Cuenta *
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={accountForm.bankName}
                                    onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })}
                                    placeholder="Ej. Banesco Principal, Zelle Gerencia, etc."
                                    className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Moneda *
                                    </label>
                                    <select
                                        value={accountForm.currency}
                                        disabled={!!editingAccount}
                                        onChange={(e) => setAccountForm({ ...accountForm, currency: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    >
                                        <option value="VES">Bolívares (VES)</option>
                                        <option value="USD">Dólares (USD)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Tipo de Cuenta *
                                    </label>
                                    <select
                                        value={accountForm.accountType}
                                        onChange={(e) => setAccountForm({ ...accountForm, accountType: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    >
                                        <option value="CORRIENTE">Corriente</option>
                                        <option value="AHORRO">Ahorro</option>
                                        <option value="CUSTODIA_USD">Custodia Divisas</option>
                                        <option value="DIGITAL">Billetera / Digital</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Número de Cuenta (20 dígitos o identificador)
                                </label>
                                <input
                                    type="text"
                                    value={accountForm.accountNumber}
                                    onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })}
                                    placeholder="0134-XXXX-XX-XXXXXXXXXX"
                                    className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                />
                            </div>

                            {!editingAccount && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Saldo Inicial de Apertura ({accountForm.currency})
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={accountForm.initialBalance}
                                        onChange={(e) => setAccountForm({ ...accountForm, initialBalance: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        Este saldo inicial creará automáticamente un asiento de apertura conciliado.
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Titular de la Cuenta
                                    </label>
                                    <input
                                        type="text"
                                        value={accountForm.accountHolder}
                                        onChange={(e) => setAccountForm({ ...accountForm, accountHolder: e.target.value })}
                                        placeholder="Nombre de la empresa o persona"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        RIF / Cédula del Titular
                                    </label>
                                    <input
                                        type="text"
                                        value={accountForm.holderIdDoc}
                                        onChange={(e) => setAccountForm({ ...accountForm, holderIdDoc: e.target.value })}
                                        placeholder="J-12345678-0"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsAccountModalOpen(false)}
                                    className="min-h-[44px] px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer active:scale-95 flex items-center justify-center"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="min-h-[44px] px-5 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-primary-500/20 active:scale-95"
                                >
                                    {saving ? <RefreshCw className="animate-spin" size={14} /> : null}
                                    <span>{editingAccount ? 'Actualizar Cuenta' : 'Guardar Cuenta'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Transfer Between Accounts / Cash Drawer */}
            {isTransferModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[92dvh] sm:max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150">
                        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                            <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <ArrowLeftRight size={18} className="text-indigo-500" />
                                <span>Transferir Fondos / Depósito</span>
                            </h3>
                            <button
                                onClick={() => setIsTransferModalOpen(false)}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl active:scale-95"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleExecuteTransfer} className="overflow-y-auto p-4 sm:p-5 space-y-4 pb-safe custom-scrollbar">
                            {/* Origin */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Cuenta / Origen de Fondos *
                                </label>
                                <select
                                    required
                                    value={transferForm.fromId}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const isCash = val === 'CASH_VES' || val === 'CASH_USD';
                                        const selected = accounts.find(a => a.id === val);
                                        const cur = isCash ? (val === 'CASH_USD' ? 'USD' : 'VES') : (selected?.currency || 'VES');
                                        setTransferForm({
                                            ...transferForm,
                                            fromType: isCash ? 'CASH_DRAWER' : 'BANK',
                                            fromId: val,
                                            currencySent: cur
                                        });
                                    }}
                                    className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                >
                                    <option value="">Seleccione cuenta o caja origen...</option>
                                    <optgroup label="Gaveta de Caja (Turno Activo)">
                                        <option value="CASH_VES">Gaveta de Caja en Bolívares [VES] - Disp: {formatMoney(summary.drawerVes, 'VES')}</option>
                                        <option value="CASH_USD">Gaveta de Caja en Divisas [USD] - Disp: {formatMoney(summary.drawerUsd, 'USD')}</option>
                                    </optgroup>
                                    <optgroup label="Cuentas Bancarias">
                                        {accounts.map(acc => (
                                            <option key={acc.id} value={acc.id}>
                                                {acc.bankName} [{acc.currency}] - Saldo: {formatMoney(acc.currentBalance, acc.currency)}
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                            </div>

                            {/* Destination */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Cuenta / Destino de Fondos *
                                </label>
                                <select
                                    required
                                    value={transferForm.toId}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const isCash = val === 'CASH_VES' || val === 'CASH_USD';
                                        const selected = accounts.find(a => a.id === val);
                                        const cur = isCash ? (val === 'CASH_USD' ? 'USD' : 'VES') : (selected?.currency || 'VES');
                                        setTransferForm({
                                            ...transferForm,
                                            toType: isCash ? 'CASH_DRAWER' : 'BANK',
                                            toId: val,
                                            currencyReceived: cur
                                        });
                                    }}
                                    className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                >
                                    <option value="">Seleccione cuenta o caja destino...</option>
                                    <optgroup label="Gaveta de Caja (Turno Activo)">
                                        {transferForm.fromId !== 'CASH_VES' && (
                                            <option value="CASH_VES">Gaveta de Caja en Bolívares [VES]</option>
                                        )}
                                        {transferForm.fromId !== 'CASH_USD' && (
                                            <option value="CASH_USD">Gaveta de Caja en Divisas [USD]</option>
                                        )}
                                    </optgroup>
                                    <optgroup label="Cuentas Bancarias">
                                        {accounts.filter(a => a.id !== transferForm.fromId).map(acc => (
                                            <option key={acc.id} value={acc.id}>
                                                {acc.bankName} [{acc.currency}] - Saldo: {formatMoney(acc.currentBalance, acc.currency)}
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                            </div>

                            {(() => {
                                const fromCur = transferForm.fromType === 'CASH_DRAWER'
                                    ? (transferForm.fromId === 'CASH_USD' ? 'USD' : 'VES')
                                    : (accounts.find(a => a.id === transferForm.fromId)?.currency || transferForm.currencySent || 'VES');
                                const toCur = transferForm.toType === 'CASH_DRAWER'
                                    ? (transferForm.toId === 'CASH_USD' ? 'USD' : 'VES')
                                    : (accounts.find(a => a.id === transferForm.toId)?.currency || transferForm.currencyReceived || 'VES');
                                if (fromCur === toCur || !transferForm.fromId || !transferForm.toId) return null;
                                const sent = Number(transferForm.amountSent) || 0;
                                const rate = Number(transferForm.exchangeRate) || 1;
                                const previewRec = fromCur === 'USD' ? (sent * rate) : (rate > 0 ? (sent / rate) : 0);
                                return (
                                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-500/30 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                                        <div>
                                            <label className="block text-xs font-bold text-amber-800 dark:text-amber-300 mb-1">
                                                Tasa de Cambio (Bs / $) *
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                required
                                                value={transferForm.exchangeRate || ''}
                                                onChange={(e) => setTransferForm({ ...transferForm, exchangeRate: e.target.value })}
                                                className="w-full min-h-[38px] bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-500/40 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 dark:text-white outline-none"
                                            />
                                        </div>
                                        <div className="text-right">
                                            <span className="block text-[11px] font-bold text-amber-700 dark:text-amber-400">Monto Convertido a Abonar ({toCur})</span>
                                            <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                                                {formatMoney(previewRec, toCur)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Monto a Enviar ({transferForm.currencySent}) *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={transferForm.amountSent}
                                        onChange={(e) => setTransferForm({ ...transferForm, amountSent: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Número de Referencia
                                    </label>
                                    <input
                                        type="text"
                                        value={transferForm.referenceNumber}
                                        onChange={(e) => setTransferForm({ ...transferForm, referenceNumber: e.target.value })}
                                        placeholder="Ej. TRF-10293"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Fecha
                                    </label>
                                    <input
                                        type="date"
                                        value={transferForm.date}
                                        onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Concepto / Notas
                                    </label>
                                    <input
                                        type="text"
                                        value={transferForm.notes}
                                        onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                                        placeholder="Motivo del traspaso..."
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsTransferModalOpen(false)}
                                    className="min-h-[44px] px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer active:scale-95 flex items-center justify-center"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="min-h-[44px] px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-indigo-500/20 active:scale-95"
                                >
                                    {saving ? <RefreshCw className="animate-spin" size={14} /> : null}
                                    <span>Ejecutar Transferencia</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Manual Direct Transaction */}
            {isManualTxModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[92dvh] sm:max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150">
                        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                            <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                                {manualTxForm.type === 'INGRESO' ? (
                                    <ArrowDownRight size={18} className="text-emerald-500" />
                                ) : (
                                    <ArrowUpRight size={18} className="text-rose-500" />
                                )}
                                <span>{manualTxForm.type === 'INGRESO' ? 'Registrar Depósito / Ingreso Bancario' : 'Registrar Retiro / Débito Bancario'}</span>
                            </h3>
                            <button
                                onClick={() => setIsManualTxModalOpen(false)}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl active:scale-95"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveManualTx} className="overflow-y-auto p-4 sm:p-5 space-y-4 pb-safe custom-scrollbar">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Cuenta Bancaria *
                                </label>
                                <select
                                    required
                                    value={manualTxForm.bankAccountId}
                                    onChange={(e) => setManualTxForm({ ...manualTxForm, bankAccountId: e.target.value })}
                                    className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                >
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>
                                            {acc.bankName} [{acc.currency}] - Saldo: {formatMoney(acc.currentBalance, acc.currency)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Monto *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={manualTxForm.amount}
                                        onChange={(e) => setManualTxForm({ ...manualTxForm, amount: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Número de Referencia
                                    </label>
                                    <input
                                        type="text"
                                        value={manualTxForm.referenceNumber}
                                        onChange={(e) => setManualTxForm({ ...manualTxForm, referenceNumber: e.target.value })}
                                        placeholder="Ej. DEP-40192"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Concepto / Descripción
                                </label>
                                <input
                                    type="text"
                                    value={manualTxForm.description}
                                    onChange={(e) => setManualTxForm({ ...manualTxForm, description: e.target.value })}
                                    className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Fecha
                                </label>
                                <input
                                    type="date"
                                    value={manualTxForm.date}
                                    onChange={(e) => setManualTxForm({ ...manualTxForm, date: e.target.value })}
                                    className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                />
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsManualTxModalOpen(false)}
                                    className="min-h-[44px] px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer active:scale-95 flex items-center justify-center"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className={`min-h-[44px] px-5 py-2 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95 ${
                                        manualTxForm.type === 'INGRESO' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600'
                                    }`}
                                >
                                    {saving ? <RefreshCw className="animate-spin" size={14} /> : null}
                                    <span>Registrar Movimiento</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Exchange Differences Audit Log */}
            {isDiffModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold shrink-0">
                                    <ArrowLeftRight size={22} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-slate-800 dark:text-white">
                                        Auditoría de Diferencial Cambiario
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        Registro de variaciones cambiarias en cobros o pagos con cambio de tasa
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsDiffModalOpen(false)}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-xl active:scale-95"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar pb-safe">
                            {exchangeDifferences.length === 0 ? (
                                <div className="text-center py-12 text-slate-400 space-y-2">
                                    <CheckCircle2 size={36} className="mx-auto text-primary-500 opacity-60" />
                                    <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                        No hay registros de diferencial cambiario aún
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        Se generarán automáticamente cuando se liquide una deuda o factura a una tasa cambiaria distinta a la original de emisión.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {exchangeDifferences.map(diff => {
                                        const isGain = diff.classification === 'GANANCIA' || Number(diff.differenceAmountVes) >= 0;
                                        return (
                                            <div 
                                                key={diff.id}
                                                className="p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                            >
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                            isGain ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                                                        }`}>
                                                            {diff.classification || (isGain ? 'GANANCIA' : 'PERDIDA')}
                                                        </span>
                                                        <span className="text-xs font-bold text-slate-800 dark:text-white">
                                                            Doc: {diff.documentId || 'S/N'}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 sm:gap-3">
                                                        <span>Monto: ${Number(diff.originalAmountUsd).toFixed(2)} USD</span>
                                                        <span className="hidden sm:inline">•</span>
                                                        <span>Emisión: {Number(diff.originalRate).toFixed(2)} Bs</span>
                                                        <span className="hidden sm:inline">•</span>
                                                        <span>Cobro: {Number(diff.settlementRate).toFixed(2)} Bs</span>
                                                    </div>
                                                </div>

                                                <div className="text-left sm:text-right flex items-center justify-between sm:block border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 dark:border-white/5">
                                                    <span className={`text-base font-black tabular-nums ${
                                                        isGain ? 'text-emerald-500' : 'text-rose-500'
                                                    }`}>
                                                        {isGain ? '+' : ''}{formatMoney(diff.differenceAmountVes, 'VES')}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 block">{diff.date}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/50 flex justify-end pb-safe">
                            <button
                                onClick={() => setIsDiffModalOpen(false)}
                                className="min-h-[44px] px-6 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white rounded-xl text-xs font-bold transition-colors cursor-pointer active:scale-95 w-full sm:w-auto"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reconciliation Modal */}
            <BankReconciliationModal
                isOpen={isReconcileModalOpen}
                onClose={() => setIsReconcileModalOpen(false)}
                initialAccountId={reconcileInitialAccount}
                onReconciled={() => loadAllBankingData()}
            />
        </div>
    );
}
