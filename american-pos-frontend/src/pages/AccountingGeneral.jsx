import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
    BookOpen, 
    Layers, 
    FileSpreadsheet, 
    Scale, 
    PlusCircle, 
    Search, 
    Calendar, 
    Download, 
    Printer
} from 'lucide-react';
import api from '../services/api';
import { useBusinessSettingsStore } from '../stores/useBusinessSettingsStore';

const showToast = (msg, type = 'info') => {
    if (type === 'success') toast.success(msg);
    else if (type === 'error') toast.error(msg);
    else toast(msg);
};

const ACCOUNT_TYPE_META = {
    ASSET: { label: '1 · Activo', badge: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700' },
    LIABILITY: { label: '2 · Pasivo', badge: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50' },
    EQUITY: { label: '3 · Patrimonio', badge: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50' },
    REVENUE: { label: '4 · Ingreso', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50' },
    COST: { label: '5 · Costo', badge: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50' },
    EXPENSE: { label: '6 · Gasto', badge: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/50' }
};

export default function AccountingGeneral() {
    const exchangeRate = useBusinessSettingsStore((s) => s.rate);
    const bcvRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;

    const [activeTab, setActiveTab] = useState('diario'); // 'diario' | 'catalogo' | 'mayor' | 'balances'
    const [loading, setLoading] = useState(false);

    // Date Filters
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [referenceTypeFilter, setReferenceTypeFilter] = useState('');

    // Data States
    const [accounts, setAccounts] = useState([]);
    const [entries, setEntries] = useState([]);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [ledgerData, setLedgerData] = useState(null);
    const [trialBalanceData, setTrialBalanceData] = useState(null);
    const [balanceSheetData, setBalanceSheetData] = useState(null);
    const [balanceType, setBalanceType] = useState('comprobacion'); // 'comprobacion' | 'general'

    // Search in PUC
    const [accountSearch, setAccountSearch] = useState('');
    const [accountTypeFilter, setAccountTypeFilter] = useState('ALL');

    // Modals
    const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
    const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);

    const [newAccountForm, setNewAccountForm] = useState({
        code: '',
        name: '',
        accountType: 'ASSET',
        nature: 'DEBIT',
        parentCode: '',
        isSelectable: true,
        description: ''
    });

    const [newEntryForm, setNewEntryForm] = useState({
        entryDate: new Date().toISOString().split('T')[0],
        description: '',
        lines: [
            { accountId: '', description: '', debit: '', credit: '' },
            { accountId: '', description: '', debit: '', credit: '' }
        ]
    });

    const fetchCatalog = useCallback(async () => {
        try {
            const res = await api.get('/accounting/accounts');
            if ((res.data?.success || res.data?.ok)) {
                setAccounts(res.data.accounts || []);
                if (res.data.accounts?.length > 0) {
                    const firstSelectable = res.data.accounts.find(a => a.isSelectable);
                    if (firstSelectable) setSelectedAccountId(prev => prev || firstSelectable.id);
                }
            }
        } catch (err) {
            console.error('Error cargando catálogo contable:', err);
        }
    }, []);

    const fetchJournalEntries = useCallback(async () => {
        setLoading(true);
        try {
            const params = { startDate, endDate };
            if (referenceTypeFilter) params.referenceType = referenceTypeFilter;
            const res = await api.get('/accounting/entries', { params });
            if ((res.data?.success || res.data?.ok)) {
                setEntries(res.data.entries || []);
            }
        } catch (err) {
            console.error('Error cargando Libro Diario:', err);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, referenceTypeFilter]);

    const fetchLedger = useCallback(async (accId) => {
        const targetId = accId || selectedAccountId;
        if (!targetId) return;
        setLoading(true);
        try {
            const res = await api.get(`/accounting/ledger/${targetId}`, {
                params: { startDate, endDate }
            });
            if ((res.data?.success || res.data?.ok)) {
                setLedgerData(res.data);
            }
        } catch (err) {
            console.error('Error cargando Libro Mayor:', err);
        } finally {
            setLoading(false);
        }
    }, [selectedAccountId, startDate, endDate]);

    const fetchBalances = useCallback(async () => {
        setLoading(true);
        try {
            const [tbRes, bsRes] = await Promise.all([
                api.get('/accounting/trial-balance', { params: { startDate, endDate } }),
                api.get('/accounting/balance-sheet', { params: { endDate } })
            ]);
            if (tbRes.data?.ok) setTrialBalanceData(tbRes.data);
            if (bsRes.data?.ok) setBalanceSheetData(bsRes.data);
        } catch (err) {
            console.error('Error cargando Balances:', err);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => {
        fetchCatalog();
    }, [fetchCatalog]);

    useEffect(() => {
        if (activeTab === 'diario') fetchJournalEntries();
        if (activeTab === 'mayor' && selectedAccountId) fetchLedger(selectedAccountId);
        if (activeTab === 'balances') fetchBalances();
    }, [activeTab, selectedAccountId, fetchJournalEntries, fetchLedger, fetchBalances]);

    // Equation summary from catalog
    const patrimonialSummary = useMemo(() => {
        const sumByType = (type) => accounts
            .filter(a => a.accountType === type && a.isSelectable)
            .reduce((acc, a) => acc + (parseFloat(a.currentBalance) || 0), 0);

        const assets = sumByType('ASSET');
        const liabilities = sumByType('LIABILITY');
        const equity = sumByType('EQUITY');
        const revenues = sumByType('REVENUE');
        const costs = sumByType('COST');
        const expenses = sumByType('EXPENSE');
        const periodResult = revenues - costs - expenses;

        return {
            assets,
            liabilities,
            equity: equity + periodResult,
            revenues,
            expenses: costs + expenses,
            periodResult
        };
    }, [accounts]);

    const handleSeedCatalog = async () => {
        try {
            setLoading(true);
            const res = await api.post('/accounting/seed-catalog');
            if ((res.data?.success || res.data?.ok)) {
                showToast('Plan Único de Cuentas (VEN-NIF) verificado y actualizado', 'success');
                fetchCatalog();
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error inicializando catálogo', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateAccount = async (e) => {
        e.preventDefault();
        try {
            const res = await api.post('/accounting/accounts', newAccountForm);
            if ((res.data?.success || res.data?.ok)) {
                setIsNewAccountModalOpen(false);
                setNewAccountForm({
                    code: '',
                    name: '',
                    accountType: 'ASSET',
                    nature: 'DEBIT',
                    parentCode: '',
                    isSelectable: true,
                    description: ''
                });
                showToast('Cuenta contable incorporada al PUC', 'success');
                fetchCatalog();
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error creando cuenta contable', 'error');
        }
    };

    const handleAddLineToManualEntry = () => {
        setNewEntryForm(prev => ({
            ...prev,
            lines: [...prev.lines, { accountId: '', description: '', debit: '', credit: '' }]
        }));
    };

    const handleRemoveLineFromManualEntry = (index) => {
        if (newEntryForm.lines.length <= 2) return;
        setNewEntryForm(prev => ({
            ...prev,
            lines: prev.lines.filter((_, i) => i !== index)
        }));
    };

    const handleManualLineChange = (index, field, value) => {
        setNewEntryForm(prev => {
            const updated = [...prev.lines];
            updated[index] = { ...updated[index], [field]: value };
            if (field === 'debit' && parseFloat(value) > 0) updated[index].credit = '';
            if (field === 'credit' && parseFloat(value) > 0) updated[index].debit = '';
            return { ...prev, lines: updated };
        });
    };

    // Apply quick accounting template
    const applyEntryTemplate = (templateKey) => {
        const selectable = accounts.filter(a => a.isSelectable);
        const findByCodeOrName = (codePrefix, keyword) => {
            return selectable.find(a => a.code.startsWith(codePrefix)) ||
                selectable.find(a => a.name.toLowerCase().includes(keyword.toLowerCase())) ||
                selectable[0];
        };

        const cashAcc = findByCodeOrName('1.1.01', 'caja');
        const bankAcc = findByCodeOrName('1.1.02', 'banco');
        const invAcc = findByCodeOrName('1.1.04', 'inventario');
        const capAcc = findByCodeOrName('3.1', 'capital');
        const expAcc = findByCodeOrName('6.1', 'gasto');

        if (templateKey === 'CAPITAL') {
            setNewEntryForm(prev => ({
                ...prev,
                description: 'Aporte de capital social / fondo operativo en caja',
                lines: [
                    { accountId: cashAcc?.id || '', description: 'Ingreso a caja principal', debit: '100.00', credit: '' },
                    { accountId: capAcc?.id || '', description: 'Aporte patrimonial socio', debit: '', credit: '100.00' }
                ]
            }));
        } else if (templateKey === 'DEPOSIT') {
            setNewEntryForm(prev => ({
                ...prev,
                description: 'Traslado de efectivo en caja a cuenta bancaria nacional',
                lines: [
                    { accountId: bankAcc?.id || '', description: 'Depósito bancario', debit: '100.00', credit: '' },
                    { accountId: cashAcc?.id || '', description: 'Salida de efectivo de caja', debit: '', credit: '100.00' }
                ]
            }));
        } else if (templateKey === 'INVENTORY_ADJ') {
            setNewEntryForm(prev => ({
                ...prev,
                description: 'Ajuste de inventario físico contra patrimonio / resultados',
                lines: [
                    { accountId: invAcc?.id || '', description: 'Ajuste positivo de mercancía', debit: '50.00', credit: '' },
                    { accountId: capAcc?.id || '', description: 'Contrapartida ajuste inventario', debit: '', credit: '50.00' }
                ]
            }));
        } else if (templateKey === 'EXPENSE') {
            setNewEntryForm(prev => ({
                ...prev,
                description: 'Registro de gasto operativo pagado por banco',
                lines: [
                    { accountId: expAcc?.id || '', description: 'Gasto operativo del período', debit: '25.00', credit: '' },
                    { accountId: bankAcc?.id || '', description: 'Egreso bancario', debit: '', credit: '25.00' }
                ]
            }));
        }
    };

    const manualEntryTotals = useMemo(() => {
        let debits = 0;
        let credits = 0;
        for (const l of newEntryForm.lines) {
            debits += parseFloat(l.debit) || 0;
            credits += parseFloat(l.credit) || 0;
        }
        const diff = Math.abs(debits - credits);
        return { debits, credits, diff, isBalanced: diff <= 0.01 && debits > 0 };
    }, [newEntryForm.lines]);

    const handleCreateManualEntry = async (e) => {
        e.preventDefault();
        if (!manualEntryTotals.isBalanced) {
            showToast('El asiento está descuadrado. El Debe y el Haber deben ser idénticos.', 'warning');
            return;
        }
        try {
            const res = await api.post('/accounting/entries', {
                ...newEntryForm,
                exchangeRate: bcvRate
            });
            if ((res.data?.success || res.data?.ok)) {
                setIsNewEntryModalOpen(false);
                setNewEntryForm({
                    entryDate: new Date().toISOString().split('T')[0],
                    description: '',
                    lines: [
                        { accountId: '', description: '', debit: '', credit: '' },
                        { accountId: '', description: '', debit: '', credit: '' }
                    ]
                });
                showToast('Asiento contable registrado en el Libro Diario', 'success');
                fetchJournalEntries();
                fetchCatalog();
                fetchBalances();
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error registrando asiento', 'error');
        }
    };

    const filteredAccounts = useMemo(() => {
        return accounts.filter(acc => {
            const matchesType = accountTypeFilter === 'ALL' || acc.accountType === accountTypeFilter;
            if (!matchesType) return false;
            if (!accountSearch.trim()) return true;
            const q = accountSearch.toLowerCase();
            return acc.code.toLowerCase().includes(q) || acc.name.toLowerCase().includes(q);
        });
    }, [accounts, accountSearch, accountTypeFilter]);

    const fmtUSD = (val) => {
        const num = parseFloat(val) || 0;
        return `$ ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const fmtBs = (valUsd) => {
        const num = (parseFloat(valUsd) || 0) * bcvRate;
        return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const handleExportCSV = () => {
        const rows = [
            ['LIBRO DIARIO GENERAL - PARTIDA DOBLE (VEN-NIF)'],
            [`Periodo: ${startDate} al ${endDate}`, `Tasa BCV: Bs. ${bcvRate.toFixed(2)} / USD`],
            [],
            ['Asiento', 'Fecha', 'Origen', 'Codigo PUC', 'Cuenta Contable', 'Glosa / Detalle', 'Debe (USD)', 'Haber (USD)', 'Debe (Bs)', 'Haber (Bs)']
        ];
        entries.forEach(entry => {
            (entry.Lines || []).forEach(line => {
                const deb = parseFloat(line.debit) || 0;
                const cred = parseFloat(line.credit) || 0;
                rows.push([
                    entry.entryNumber,
                    entry.entryDate,
                    entry.referenceType || 'MANUAL',
                    line.Account?.code || '',
                    `"${(line.Account?.name || '').replace(/"/g, '""')}"`,
                    `"${(line.description || entry.description || '').replace(/"/g, '""')}"`,
                    deb.toFixed(2),
                    cred.toFixed(2),
                    (deb * bcvRate).toFixed(2),
                    (cred * bcvRate).toFixed(2)
                ]);
            });
        });
        const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map(r => r.join(',')).join('\n');
        const link = document.createElement('a');
        link.setAttribute('href', encodeURI(csvContent));
        link.setAttribute('download', `Libro_Diario_${startDate}_${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-5 animate-in fade-in duration-300">
            {/* CABECERA INSTITUCIONAL */}
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                                LIBRO OFICIAL VEN-NIF
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                Partida Doble Automatizada • Tasa BCV: Bs. {bcvRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} / USD
                            </span>
                        </div>
                        <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">
                            Contabilidad General y Plan Único de Cuentas (PUC)
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Asientos automáticos de facturación POS, compras, gastos, nómina y depreciación con trazabilidad en Libro Mayor
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            className="h-9 px-3 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                            <Download size={13} />
                            <span>Exportar CSV</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="h-9 px-3 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                            <Printer size={13} />
                            <span>Imprimir</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsNewAccountModalOpen(true)}
                            className="h-9 px-3 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                            <PlusCircle size={13} />
                            <span>Nueva Cuenta PUC</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsNewEntryModalOpen(true)}
                            className="h-9 px-3.5 rounded-md bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                        >
                            <BookOpen size={13} />
                            <span>Asiento Manual</span>
                        </button>
                    </div>
                </div>

                {/* ECUACIÓN PATRIMONIAL EN TIEMPO REAL */}
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                    <div className="p-3.5 sm:px-5">
                        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500">
                            <span>1. ACTIVO TOTAL (BIENES Y CAJA)</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300">DEUDOR</span>
                        </div>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                            {fmtUSD(patrimonialSummary.assets)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(patrimonialSummary.assets)}
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500">
                            <span>2. PASIVO EXIGIBLE (DEUDAS)</span>
                            <span className="font-bold text-amber-600 dark:text-amber-400">ACREEDOR</span>
                        </div>
                        <div className="text-base sm:text-lg font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-1">
                            {fmtUSD(patrimonialSummary.liabilities)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(patrimonialSummary.liabilities)}
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500">
                            <span>3. PATRIMONIO + RESULTADO</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400">CAPITAL</span>
                        </div>
                        <div className="text-base sm:text-lg font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums mt-1">
                            {fmtUSD(patrimonialSummary.equity)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(patrimonialSummary.equity)}
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500">
                            <span>CUENTAS IMPUTABLES PUC</span>
                            <button
                                type="button"
                                onClick={handleSeedCatalog}
                                className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                                Verificar PUC
                            </button>
                        </div>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                            {accounts.length} cuentas
                        </div>
                        <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                            {entries.length} asientos en el período
                        </div>
                    </div>
                </div>
            </div>

            {/* BARRA DE NAVEGACIÓN DE LIBROS Y FILTROS */}
            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar bg-slate-100 dark:bg-slate-800/70 p-1 rounded-md">
                    {[
                        { id: 'diario', label: '1. Libro Diario General', icon: BookOpen },
                        { id: 'mayor', label: '2. Libro Mayor (T-Account)', icon: FileSpreadsheet },
                        { id: 'balances', label: '3. Balance de Comprobación y General', icon: Scale },
                        { id: 'catalogo', label: '4. Plan Único de Cuentas (PUC)', icon: Layers }
                    ].map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`h-8 px-3 rounded text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                                    active
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Icon size={13} />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {activeTab !== 'catalogo' && (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 px-2.5 h-8 rounded border border-slate-200 dark:border-slate-700 text-xs">
                            <Calendar size={13} className="text-slate-400" />
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-transparent font-mono text-xs text-slate-800 dark:text-slate-200 outline-none"
                            />
                            <span className="text-slate-400">→</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-transparent font-mono text-xs text-slate-800 dark:text-slate-200 outline-none"
                            />
                        </div>

                        {activeTab === 'diario' && (
                            <select
                                value={referenceTypeFilter}
                                onChange={(e) => setReferenceTypeFilter(e.target.value)}
                                className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-medium text-slate-700 dark:text-slate-200 outline-none"
                            >
                                <option value="">Todos los orígenes</option>
                                <option value="SALE">Ventas POS</option>
                                <option value="PURCHASE">Compras / Proveedores</option>
                                <option value="EXPENSE">Gastos Operativos</option>
                                <option value="PAYROLL">Nómina Laboral</option>
                                <option value="DEPRECIATION">Depreciación Activos</option>
                                <option value="MANUAL">Ajustes Manuales</option>
                            </select>
                        )}
                    </div>
                )}
            </div>

            {/* 1. LIBRO DIARIO GENERAL */}
            {activeTab === 'diario' && (
                <div className="space-y-3">
                    {loading ? (
                        <div className="bg-white dark:bg-slate-900 p-12 rounded-lg border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                            Consultando asientos contables del período...
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="bg-white dark:bg-slate-900 p-12 rounded-lg border border-slate-200 dark:border-slate-800 text-center space-y-3">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                Sin asientos contables en el rango ({startDate} a {endDate})
                            </p>
                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                                Cada venta en caja, gasto operativo, compra de inventario o liquidación de nómina genera automáticamente su comprobante de partida doble aquí. También puede registrar un asiento manual.
                            </p>
                            <button
                                type="button"
                                onClick={() => setIsNewEntryModalOpen(true)}
                                className="h-9 px-4 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                                <PlusCircle size={14} />
                                <span>Registrar Primer Asiento</span>
                            </button>
                        </div>
                    ) : (
                        entries.map(entry => (
                            <div
                                key={entry.id}
                                className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs"
                            >
                                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2.5">
                                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                                            {entry.entryNumber}
                                        </span>
                                        <span className="text-xs font-mono text-slate-500">
                                            {entry.entryDate}
                                        </span>
                                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                            {entry.referenceType || 'MANUAL'}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-900 dark:text-white">
                                            {entry.description}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs font-mono">
                                        <span className="text-slate-500">
                                            Total Comprobante: <strong className="text-slate-900 dark:text-white">{fmtUSD(entry.totalDebit)}</strong> ({fmtBs(entry.totalDebit)})
                                        </span>
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-400">
                                                <th className="py-2 px-4 w-32">Código PUC</th>
                                                <th className="py-2 px-4">Cuenta Contable</th>
                                                <th className="py-2 px-4">Concepto / Glosa de Línea</th>
                                                <th className="py-2 px-4 text-right w-40">Debe (USD / Bs)</th>
                                                <th className="py-2 px-4 text-right w-40">Haber (USD / Bs)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                                            {entry.Lines?.map((line, idx) => {
                                                const deb = parseFloat(line.debit) || 0;
                                                const cred = parseFloat(line.credit) || 0;
                                                return (
                                                    <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                                        <td className="py-2 px-4 font-bold text-slate-700 dark:text-slate-300">
                                                            {line.Account?.code}
                                                        </td>
                                                        <td className="py-2 px-4 font-sans font-semibold text-slate-900 dark:text-white">
                                                            {line.Account?.name}
                                                        </td>
                                                        <td className="py-2 px-4 font-sans text-slate-500 dark:text-slate-400">
                                                            {line.description || entry.description}
                                                        </td>
                                                        <td className="py-2 px-4 text-right tabular-nums">
                                                            {deb > 0 ? (
                                                                <div>
                                                                    <div className="font-bold text-slate-900 dark:text-white">{fmtUSD(deb)}</div>
                                                                    <div className="text-[10px] text-slate-400">{fmtBs(deb)}</div>
                                                                </div>
                                                            ) : '—'}
                                                        </td>
                                                        <td className="py-2 px-4 text-right tabular-nums">
                                                            {cred > 0 ? (
                                                                <div>
                                                                    <div className="font-bold text-slate-900 dark:text-white">{fmtUSD(cred)}</div>
                                                                    <div className="text-[10px] text-slate-400">{fmtBs(cred)}</div>
                                                                </div>
                                                            ) : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* 2. LIBRO MAYOR ANALÍTICO */}
            {activeTab === 'mayor' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="w-full sm:w-96">
                            <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block mb-1">
                                Cuenta Auxiliar a Auditar:
                            </label>
                            <select
                                value={selectedAccountId}
                                onChange={(e) => setSelectedAccountId(e.target.value)}
                                className="w-full h-9 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold text-slate-900 dark:text-white outline-none"
                            >
                                {accounts.filter(a => a.isSelectable).map(acc => (
                                    <option key={acc.id} value={acc.id}>
                                        {acc.code} — {acc.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {ledgerData?.account && (
                            <div className="flex items-center gap-6 font-mono text-right">
                                <div>
                                    <span className="text-[10px] uppercase text-slate-400 block">Naturaleza</span>
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                        {ledgerData.account.nature === 'DEBIT' ? 'DEUDORA (Debe)' : 'ACREEDORA (Haber)'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[10px] uppercase text-slate-400 block">Saldo Final Mayor</span>
                                    <span className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
                                        {fmtUSD(ledgerData.closingBalance)}
                                    </span>
                                    <span className="block text-[11px] text-slate-500 tabular-nums">
                                        {fmtBs(ledgerData.closingBalance)}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500">
                                        <th className="py-2.5 px-4">Fecha</th>
                                        <th className="py-2.5 px-4">Comprobante</th>
                                        <th className="py-2.5 px-4">Concepto / Glosa</th>
                                        <th className="py-2.5 px-4 text-right">Cargo (Debe)</th>
                                        <th className="py-2.5 px-4 text-right">Abono (Haber)</th>
                                        <th className="py-2.5 px-4 text-right">Saldo Acumulado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                                    {!ledgerData?.movements || ledgerData.movements.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="p-8 text-center font-sans text-slate-400">
                                                Sin movimientos registrados para esta cuenta en el período seleccionado.
                                            </td>
                                        </tr>
                                    ) : (
                                        ledgerData.movements.map((m, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                                <td className="py-2.5 px-4 text-slate-500">{m.entryDate}</td>
                                                <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">{m.entryNumber}</td>
                                                <td className="py-2.5 px-4 font-sans text-slate-700 dark:text-slate-300">{m.description}</td>
                                                <td className="py-2.5 px-4 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                                                    {m.debit > 0 ? fmtUSD(m.debit) : '—'}
                                                </td>
                                                <td className="py-2.5 px-4 text-right tabular-nums text-amber-700 dark:text-amber-400">
                                                    {m.credit > 0 ? fmtUSD(m.credit) : '—'}
                                                </td>
                                                <td className="py-2.5 px-4 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                                                    <div>{fmtUSD(m.runningBalance)}</div>
                                                    <div className="text-[10px] font-normal text-slate-400">{fmtBs(m.runningBalance)}</div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. BALANCE DE COMPROBACIÓN Y BALANCE GENERAL */}
            {activeTab === 'balances' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="inline-flex rounded-md bg-slate-100 dark:bg-slate-800 p-1">
                            <button
                                type="button"
                                onClick={() => setBalanceType('comprobacion')}
                                className={`h-8 px-3 rounded text-xs font-semibold cursor-pointer ${
                                    balanceType === 'comprobacion'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                        : 'text-slate-600 dark:text-slate-400'
                                }`}
                            >
                                Balance de Comprobación (Sumas y Saldos)
                            </button>
                            <button
                                type="button"
                                onClick={() => setBalanceType('general')}
                                className={`h-8 px-3 rounded text-xs font-semibold cursor-pointer ${
                                    balanceType === 'general'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                        : 'text-slate-600 dark:text-slate-400'
                                }`}
                            >
                                Estado de Situación Financiera (Balance General)
                            </button>
                        </div>
                    </div>

                    {balanceType === 'comprobacion' && trialBalanceData && (
                        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                    Cédula de Sumas y Saldos ({startDate} al {endDate})
                                </span>
                                <span className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded border ${
                                    trialBalanceData.isBalanced
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                        : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}>
                                    {trialBalanceData.isBalanced ? 'SUMAS IGUALES VERIFICADAS' : 'DESCUADRE DETECTADO'}
                                </span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500 bg-slate-50/50 dark:bg-slate-900">
                                            <th className="py-2.5 px-4">Código PUC</th>
                                            <th className="py-2.5 px-4">Denominación de Cuenta</th>
                                            <th className="py-2.5 px-4">Grupo</th>
                                            <th className="py-2.5 px-4 text-right">Sumas Debe</th>
                                            <th className="py-2.5 px-4 text-right">Sumas Haber</th>
                                            <th className="py-2.5 px-4 text-right">Saldo Final (USD / Bs)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                                        {trialBalanceData.rows?.map((r, i) => (
                                            <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                                <td className="py-2.5 px-4 font-bold text-slate-700 dark:text-slate-300">{r.code}</td>
                                                <td className="py-2.5 px-4 font-sans font-semibold text-slate-900 dark:text-white">{r.name}</td>
                                                <td className="py-2.5 px-4 font-sans text-[11px] text-slate-500">
                                                    {ACCOUNT_TYPE_META[r.accountType]?.label || r.accountType}
                                                </td>
                                                <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 dark:text-slate-300">{fmtUSD(r.periodDebit)}</td>
                                                <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 dark:text-slate-300">{fmtUSD(r.periodCredit)}</td>
                                                <td className="py-2.5 px-4 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                                                    <div>{fmtUSD(r.closingBalance)}</div>
                                                    <div className="text-[10px] font-normal text-slate-400">{fmtBs(r.closingBalance)}</div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-100 dark:bg-slate-800 font-mono font-bold text-xs border-t-2 border-slate-300 dark:border-slate-700">
                                            <td colSpan="3" className="py-3 px-4 uppercase text-right">Totales de Comprobación:</td>
                                            <td className="py-3 px-4 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtUSD(trialBalanceData.totalDebits)}</td>
                                            <td className="py-3 px-4 text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtUSD(trialBalanceData.totalCredits)}</td>
                                            <td className="py-3 px-4 text-right tabular-nums text-slate-500">Dif: $0.00</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}

                    {balanceType === 'general' && balanceSheetData && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                    <span className="font-mono font-bold text-xs uppercase text-slate-800 dark:text-slate-200">1. ACTIVO (RECURSOS CONTROLADOS)</span>
                                    <div className="text-right font-mono">
                                        <span className="font-bold text-sm text-slate-900 dark:text-white">{fmtUSD(balanceSheetData.totalAssets)}</span>
                                        <span className="block text-[10px] text-slate-500">{fmtBs(balanceSheetData.totalAssets)}</span>
                                    </div>
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-mono p-4">
                                    {balanceSheetData.assets?.map((a, i) => (
                                        <div key={i} className="py-2 flex justify-between items-center">
                                            <span className="font-sans text-slate-700 dark:text-slate-300">{a.code} — {a.name}</span>
                                            <div className="text-right tabular-nums">
                                                <span className="font-bold text-slate-900 dark:text-white">{fmtUSD(a.balance)}</span>
                                                <span className="block text-[10px] text-slate-400">{fmtBs(a.balance)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                        <span className="font-mono font-bold text-xs uppercase text-amber-700 dark:text-amber-400">2. PASIVO (OBLIGACIONES)</span>
                                        <div className="text-right font-mono">
                                            <span className="font-bold text-sm text-slate-900 dark:text-white">{fmtUSD(balanceSheetData.totalLiabilities)}</span>
                                            <span className="block text-[10px] text-slate-500">{fmtBs(balanceSheetData.totalLiabilities)}</span>
                                        </div>
                                    </div>
                                    <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-mono p-4">
                                        {balanceSheetData.liabilities?.map((l, i) => (
                                            <div key={i} className="py-2 flex justify-between items-center">
                                                <span className="font-sans text-slate-700 dark:text-slate-300">{l.code} — {l.name}</span>
                                                <div className="text-right tabular-nums">
                                                    <span className="font-bold text-slate-900 dark:text-white">{fmtUSD(l.balance)}</span>
                                                    <span className="block text-[10px] text-slate-400">{fmtBs(l.balance)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                        <span className="font-mono font-bold text-xs uppercase text-blue-700 dark:text-blue-400">3. PATRIMONIO NETO</span>
                                        <div className="text-right font-mono">
                                            <span className="font-bold text-sm text-slate-900 dark:text-white">{fmtUSD(balanceSheetData.totalEquity)}</span>
                                            <span className="block text-[10px] text-slate-500">{fmtBs(balanceSheetData.totalEquity)}</span>
                                        </div>
                                    </div>
                                    <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-mono p-4">
                                        {balanceSheetData.equity?.map((e, i) => (
                                            <div key={i} className="py-2 flex justify-between items-center">
                                                <span className="font-sans text-slate-700 dark:text-slate-300">{e.code} — {e.name}</span>
                                                <div className="text-right tabular-nums">
                                                    <span className="font-bold text-slate-900 dark:text-white">{fmtUSD(e.balance)}</span>
                                                    <span className="block text-[10px] text-slate-400">{fmtBs(e.balance)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-slate-900 text-white dark:bg-slate-800 p-4 rounded-lg flex justify-between items-center font-mono">
                                    <span className="text-xs uppercase tracking-wider">Total Pasivo + Patrimonio:</span>
                                    <div className="text-right">
                                        <span className="text-base font-bold">{fmtUSD(balanceSheetData.totalLiabilitiesAndEquity)}</span>
                                        <span className="block text-[11px] text-slate-300">{fmtBs(balanceSheetData.totalLiabilitiesAndEquity)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 4. PLAN ÚNICO DE CUENTAS (PUC) */}
            {activeTab === 'catalogo' && (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                        <div className="relative flex-1 max-w-md">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Filtrar cuenta por código PUC o denominación..."
                                value={accountSearch}
                                onChange={(e) => setAccountSearch(e.target.value)}
                                className="w-full h-9 pl-8 pr-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs text-slate-900 dark:text-white outline-none"
                            />
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                            {['ALL', 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE'].map(t => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setAccountTypeFilter(t)}
                                    className={`h-8 px-2.5 rounded text-[11px] font-semibold cursor-pointer ${
                                        accountTypeFilter === t
                                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                    }`}
                                >
                                    {t === 'ALL' ? 'Todas' : ACCOUNT_TYPE_META[t]?.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500">
                                    <th className="py-2.5 px-4">Código PUC</th>
                                    <th className="py-2.5 px-4">Denominación de la Cuenta</th>
                                    <th className="py-2.5 px-4">Elemento Contable</th>
                                    <th className="py-2.5 px-4">Naturaleza</th>
                                    <th className="py-2.5 px-4 text-right">Saldo Actual (USD)</th>
                                    <th className="py-2.5 px-4 text-right">Equivalente (Bs.)</th>
                                    <th className="py-2.5 px-4 text-right">Mayor</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                {filteredAccounts.map(acc => {
                                    const meta = ACCOUNT_TYPE_META[acc.accountType] || ACCOUNT_TYPE_META.ASSET;
                                    return (
                                        <tr
                                            key={acc.id}
                                            className={`${!acc.isSelectable ? 'bg-slate-50/70 dark:bg-slate-800/30 font-bold' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}
                                        >
                                            <td className="py-2.5 px-4 font-mono font-bold text-slate-800 dark:text-slate-200">
                                                {acc.code}
                                            </td>
                                            <td className="py-2.5 px-4 text-slate-900 dark:text-white">
                                                {acc.name}
                                            </td>
                                            <td className="py-2.5 px-4">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${meta.badge}`}>
                                                    {meta.label}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                                                {acc.nature === 'DEBIT' ? 'Deudora (Debe)' : 'Acreedora (Haber)'}
                                            </td>
                                            <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                                                {fmtUSD(acc.currentBalance)}
                                            </td>
                                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                                                {fmtBs(acc.currentBalance)}
                                            </td>
                                            <td className="py-2.5 px-4 text-right">
                                                {acc.isSelectable ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedAccountId(acc.id);
                                                            setActiveTab('mayor');
                                                        }}
                                                        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                                    >
                                                        Ver Mayor →
                                                    </button>
                                                ) : (
                                                    <span className="text-[10px] font-mono uppercase text-slate-400">Grupo</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* MODAL: NUEVA CUENTA PUC */}
            {isNewAccountModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-lg border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-4">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Incorporar Cuenta al Plan Único de Cuentas (PUC)
                        </h3>
                        <form onSubmit={handleCreateAccount} className="space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Código Contable:</label>
                                    <input
                                        type="text"
                                        placeholder="Ej: 1.1.02.05"
                                        required
                                        value={newAccountForm.code}
                                        onChange={(e) => setNewAccountForm({ ...newAccountForm, code: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Elemento Contable:</label>
                                    <select
                                        value={newAccountForm.accountType}
                                        onChange={(e) => {
                                            const type = e.target.value;
                                            const defaultNature = (type === 'ASSET' || type === 'COST' || type === 'EXPENSE') ? 'DEBIT' : 'CREDIT';
                                            setNewAccountForm({ ...newAccountForm, accountType: type, nature: defaultNature });
                                        }}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    >
                                        <option value="ASSET">1 · Activo</option>
                                        <option value="LIABILITY">2 · Pasivo</option>
                                        <option value="EQUITY">3 · Patrimonio</option>
                                        <option value="REVENUE">4 · Ingreso</option>
                                        <option value="COST">5 · Costo de Venta</option>
                                        <option value="EXPENSE">6 · Gasto Operativo</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-500 mb-1">Denominación de la Cuenta:</label>
                                <input
                                    type="text"
                                    placeholder="Ej: Banco Provincial Cuenta Corriente"
                                    required
                                    value={newAccountForm.name}
                                    onChange={(e) => setNewAccountForm({ ...newAccountForm, name: e.target.value })}
                                    className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3 items-center">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Naturaleza:</label>
                                    <select
                                        value={newAccountForm.nature}
                                        onChange={(e) => setNewAccountForm({ ...newAccountForm, nature: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    >
                                        <option value="DEBIT">Deudora (Aumenta al Debe)</option>
                                        <option value="CREDIT">Acreedora (Aumenta al Haber)</option>
                                    </select>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300 pt-4">
                                    <input
                                        type="checkbox"
                                        checked={newAccountForm.isSelectable}
                                        onChange={(e) => setNewAccountForm({ ...newAccountForm, isSelectable: e.target.checked })}
                                    />
                                    <span>Cuenta Auxiliar Imputable</span>
                                </label>
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsNewAccountModalOpen(false)}
                                    className="h-9 px-4 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="h-9 px-4 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold"
                                >
                                    Guardar Cuenta
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: NUEVO ASIENTO MANUAL CON PLANTILLAS RÁPIDAS */}
            {isNewEntryModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-lg border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                    Comprobante de Diario (Asiento Contable Manual)
                                </h3>
                                <p className="text-[11px] text-slate-500">
                                    Use una plantilla contable preconfigurada o seleccione las cuentas manualmente
                                </p>
                            </div>
                            <div>
                                {manualEntryTotals.isBalanced ? (
                                    <span className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-mono font-bold">
                                        PARTIDA CUADRADA
                                    </span>
                                ) : (
                                    <span className="px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-xs font-mono font-bold">
                                        DESCUADRE: ${manualEntryTotals.diff.toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Plantillas rápidas para no contadores */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono uppercase text-slate-500 font-bold">Plantillas 1-Clic:</span>
                            <button
                                type="button"
                                onClick={() => applyEntryTemplate('CAPITAL')}
                                className="px-2.5 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold hover:bg-slate-100 cursor-pointer"
                            >
                                + Aporte de Capital
                            </button>
                            <button
                                type="button"
                                onClick={() => applyEntryTemplate('DEPOSIT')}
                                className="px-2.5 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold hover:bg-slate-100 cursor-pointer"
                            >
                                + Traslado Caja a Banco
                            </button>
                            <button
                                type="button"
                                onClick={() => applyEntryTemplate('INVENTORY_ADJ')}
                                className="px-2.5 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold hover:bg-slate-100 cursor-pointer"
                            >
                                + Ajuste de Inventario
                            </button>
                            <button
                                type="button"
                                onClick={() => applyEntryTemplate('EXPENSE')}
                                className="px-2.5 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold hover:bg-slate-100 cursor-pointer"
                            >
                                + Gasto por Banco
                            </button>
                        </div>

                        <form onSubmit={handleCreateManualEntry} className="space-y-4 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Fecha Contable:</label>
                                    <input
                                        type="date"
                                        required
                                        value={newEntryForm.entryDate}
                                        onChange={(e) => setNewEntryForm({ ...newEntryForm, entryDate: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono font-semibold"
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block font-semibold text-slate-500 mb-1">Glosa / Concepto General del Comprobante:</label>
                                    <input
                                        type="text"
                                        placeholder="Ej: Aporte inicial de efectivo en caja principal"
                                        required
                                        value={newEntryForm.description}
                                        onChange={(e) => setNewEntryForm({ ...newEntryForm, description: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-mono uppercase text-slate-500 font-bold">
                                        Renglones de Imputación (Montos en USD — Equivalente Bs. automático)
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleAddLineToManualEntry}
                                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                    >
                                        + Añadir Renglón
                                    </button>
                                </div>

                                {newEntryForm.lines.map((line, idx) => (
                                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-slate-50 dark:bg-slate-800/40 p-2 rounded border border-slate-200 dark:border-slate-800">
                                        <div className="sm:col-span-5">
                                            <select
                                                required
                                                value={line.accountId}
                                                onChange={(e) => handleManualLineChange(idx, 'accountId', e.target.value)}
                                                className="w-full h-10 sm:h-8 px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold"
                                            >
                                                <option value="">Seleccionar cuenta PUC...</option>
                                                {accounts.filter(a => a.isSelectable).map(acc => (
                                                    <option key={acc.id} value={acc.id}>
                                                        {acc.code} — {acc.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-2 sm:contents gap-2">
                                            <div className="sm:col-span-3">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="Debe USD"
                                                    value={line.debit}
                                                    onChange={(e) => handleManualLineChange(idx, 'debit', e.target.value)}
                                                    className="w-full h-10 sm:h-8 px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-mono font-bold text-right"
                                                />
                                            </div>
                                            <div className="sm:col-span-3">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="Haber USD"
                                                    value={line.credit}
                                                    onChange={(e) => handleManualLineChange(idx, 'credit', e.target.value)}
                                                    className="w-full h-10 sm:h-8 px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-mono font-bold text-right"
                                                />
                                            </div>
                                        </div>
                                        <div className="sm:col-span-1 text-right sm:text-center">
                                            <button
                                                type="button"
                                                aria-label="Eliminar renglón contable"
                                                onClick={() => handleRemoveLineFromManualEntry(idx)}
                                                className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-rose-600 font-bold"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                                <span>Totales del Comprobante:</span>
                                <div className="flex flex-wrap gap-4 sm:gap-6">
                                    <span>Debe: <strong>{fmtUSD(manualEntryTotals.debits)}</strong> ({fmtBs(manualEntryTotals.debits)})</span>
                                    <span>Haber: <strong>{fmtUSD(manualEntryTotals.credits)}</strong> ({fmtBs(manualEntryTotals.credits)})</span>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsNewEntryModalOpen(false)}
                                    className="h-9 px-4 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={!manualEntryTotals.isBalanced}
                                    className="h-9 px-4 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold disabled:opacity-40 cursor-pointer"
                                >
                                    Asentar en Libro Diario
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
