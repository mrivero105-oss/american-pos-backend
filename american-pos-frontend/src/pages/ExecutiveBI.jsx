import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
    TrendingUp, 
    Lock, 
    Unlock, 
    Award, 
    RefreshCw, 
    Download, 
    Printer, 
    X, 
    Briefcase
} from 'lucide-react';
import api from '../services/api';
import { useBusinessSettingsStore } from '../stores/useBusinessSettingsStore';
import { formatBs, formatUSD } from '../utils/format';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

const MONTHS = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' }
];

export default function ExecutiveBI() {
    const exchangeRate = useBusinessSettingsStore((s) => s.rate);
    const { confirm, confirmDialog } = useConfirmDialog();
    const effRate = Number(exchangeRate) || 1;

    const currentDate = new Date();
    const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
    const [activeTab, setActiveTab] = useState('pnl'); // 'pnl', 'periodos', 'comisiones'
    const [loading, setLoading] = useState(false);

    // Data States
    const [pnlData, setPnlData] = useState(null);
    const [periods, setPeriods] = useState([]);
    const [commissions, setCommissions] = useState([]);

    // Modals
    const [isClosePeriodModalOpen, setIsClosePeriodModalOpen] = useState(false);
    const [periodToClose, setPeriodToClose] = useState(null);
    const [closureNotes, setClosureNotes] = useState('');

    const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
    const [periodToReopen, setPeriodToReopen] = useState(null);
    const [reopenReason, setReopenReason] = useState('');

    const [isEditRateModalOpen, setIsEditRateModalOpen] = useState(false);
    const [selectedCommission, setSelectedCommission] = useState(null);
    const [customRate, setCustomRate] = useState('3.0');

    const fetchDashboardData = useCallback(async () => {
        setLoading(true);
        try {
            const [pnlRes, periodsRes, commRes] = await Promise.all([
                api.get('/bi/profit-loss', { params: { year: selectedYear, month: selectedMonth } }).catch(() => ({ data: null })),
                api.get('/bi/periods', { params: { year: selectedYear } }).catch(() => ({ data: [] })),
                api.get('/bi/commissions', { params: { year: selectedYear, month: selectedMonth } }).catch(() => ({ data: [] }))
            ]);

            setPnlData(pnlRes.data);
            setPeriods(periodsRes.data || []);
            setCommissions(commRes.data || []);
        } catch (error) {
            console.error('Error fetching BI data:', error);
            toast.error('Error al sincronizar estados financieros');
        } finally {
            setLoading(false);
        }
    }, [selectedYear, selectedMonth]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    const handleOpenClosePeriodModal = (period) => {
        setPeriodToClose(period);
        setClosureNotes('');
        setIsClosePeriodModalOpen(true);
    };

    const handleConfirmClosePeriod = async (e) => {
        e.preventDefault();
        if (!periodToClose) return;
        try {
            await api.post('/bi/periods/close', {
                year: periodToClose.periodYear,
                month: periodToClose.periodMonth,
                notes: closureNotes
            });
            toast.success(`Período ${periodToClose.periodMonth}/${periodToClose.periodYear} cerrado formalmente`);
            setIsClosePeriodModalOpen(false);
            fetchDashboardData();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al cerrar período');
        }
    };

    const handleOpenReopenModal = (period) => {
        setPeriodToReopen(period);
        setReopenReason('');
        setIsReopenModalOpen(true);
    };

    const handleConfirmReopenPeriod = async (e) => {
        e.preventDefault();
        if (!periodToReopen) return;
        try {
            await api.post('/bi/periods/reopen', {
                year: periodToReopen.periodYear,
                month: periodToReopen.periodMonth,
                reason: reopenReason
            });
            toast.success(`Período ${periodToReopen.periodMonth}/${periodToReopen.periodYear} reabierto`);
            setIsReopenModalOpen(false);
            fetchDashboardData();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al reabrir período');
        }
    };

    const handleOpenEditRateModal = (comm) => {
        setSelectedCommission(comm);
        setCustomRate(String(comm.commissionRate || 3.0));
        setIsEditRateModalOpen(true);
    };

    const handleSaveCommissionRate = async (e) => {
        e.preventDefault();
        if (!selectedCommission) return;
        const rate = parseFloat(customRate);
        if (isNaN(rate) || rate < 0) return toast.error('Ingrese un porcentaje válido');
        try {
            await api.post('/bi/commissions/rate', {
                userId: selectedCommission.userId,
                year: selectedYear,
                month: selectedMonth,
                rate
            });
            toast.success('Tasa de comisión actualizada');
            setIsEditRateModalOpen(false);
            fetchDashboardData();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al guardar tasa');
        }
    };

    const handleSettleCommission = async (comm) => {
        const confirmed = await confirm({
            title: 'Liquidar comisión',
            message: `¿Confirmar liquidación de comisión para ${comm.userName} por ${formatUSD(comm.commissionAmount)}?`,
            confirmText: 'Liquidar',
            variant: 'primary'
        });
        if (!confirmed) return;
        try {
            await api.post(`/bi/commissions/${comm.id}/settle`, {
                notes: `Liquidado en cierre mensual ${selectedMonth}/${selectedYear}`
            });
            toast.success('Comisión liquidada');
            fetchDashboardData();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al liquidar comisión');
        }
    };

    // Cálculos consolidados del Estado de Resultados (P&L)
    const fin = useMemo(() => {
        const raw = pnlData?.summary || {};
        const salesUsd = Number(raw.grossSales) || 0;
        const cogsUsd = Number(raw.costOfGoodsSold) || 0;
        const opExpensesUsd = Number(raw.totalOperatingExpenses) || 0;
        const fxDiffVes = Number(raw.netExchangeDifferenceVes) || 0;
        const fxDiffUsd = effRate > 0 ? fxDiffVes / effRate : 0;
        const salesCount = Number(raw.salesCount) || 0;

        const totalRevenueUsd = salesUsd;
        const grossProfitUsd = totalRevenueUsd - cogsUsd;
        const grossMarginPct = totalRevenueUsd > 0 ? (grossProfitUsd / totalRevenueUsd) * 100 : 0;

        const totalCommissionsUsd = commissions.reduce((acc, c) => acc + (Number(c.commissionAmount) || 0), 0);
        const operatingIncomeUsd = grossProfitUsd - opExpensesUsd;
        const operatingMarginPct = totalRevenueUsd > 0 ? (operatingIncomeUsd / totalRevenueUsd) * 100 : 0;

        const netProfitUsd = operatingIncomeUsd + fxDiffUsd;
        const netMarginPct = totalRevenueUsd > 0 ? (netProfitUsd / totalRevenueUsd) * 100 : 0;

        // Punto de equilibrio mensual: Gastos Fijos / (Margen Bruto %)
        const breakEvenUsd = grossMarginPct > 0 ? (opExpensesUsd / (grossMarginPct / 100)) : 0;
        const avgTicketUsd = salesCount > 0 ? (salesUsd / salesCount) : 0;

        return {
            salesUsd,
            salesBs: salesUsd * effRate,
            totalRevenueUsd,
            totalRevenueBs: totalRevenueUsd * effRate,
            cogsUsd,
            cogsBs: cogsUsd * effRate,
            grossProfitUsd,
            grossProfitBs: grossProfitUsd * effRate,
            grossMarginPct,
            opExpensesUsd,
            opExpensesBs: opExpensesUsd * effRate,
            totalCommissionsUsd,
            operatingIncomeUsd,
            operatingIncomeBs: operatingIncomeUsd * effRate,
            operatingMarginPct,
            fxDiffVes,
            fxDiffUsd,
            netProfitUsd,
            netProfitBs: netProfitUsd * effRate,
            netMarginPct,
            salesCount,
            breakEvenUsd,
            breakEvenBs: breakEvenUsd * effRate,
            avgTicketUsd,
            avgTicketBs: avgTicketUsd * effRate
        };
    }, [pnlData, commissions, effRate]);

    const handleExportCSV = () => {
        const monthName = MONTHS.find(m => m.value === selectedMonth)?.label || selectedMonth;
        const rows = [
            ['CODIGO', 'CONCEPTO CONTABLE', 'MONTO VES (BS)', 'MONTO USD ($)', '% SOBRE INGRESOS'],
            ['4.1.01', 'Ventas Brutas de Mercancia (POS)', fin.salesBs.toFixed(2), fin.salesUsd.toFixed(2), fin.totalRevenueUsd > 0 ? ((fin.salesUsd / fin.totalRevenueUsd) * 100).toFixed(2) + '%' : '0%'],
            ['4.0.00', 'TOTAL INGRESOS OPERACIONALES', fin.totalRevenueBs.toFixed(2), fin.totalRevenueUsd.toFixed(2), '100.00%'],
            ['5.1.01', '(-) Costo de Mercancia Vendida (CMV)', (-fin.cogsBs).toFixed(2), (-fin.cogsUsd).toFixed(2), fin.totalRevenueUsd > 0 ? ((fin.cogsUsd / fin.totalRevenueUsd) * 100).toFixed(2) + '%' : '0%'],
            ['5.0.00', 'UTILIDAD BRUTA EN VENTAS', fin.grossProfitBs.toFixed(2), fin.grossProfitUsd.toFixed(2), fin.grossMarginPct.toFixed(2) + '%'],
            ['6.1.01', '(-) Gastos Operativos y Administrativos', (-fin.opExpensesBs).toFixed(2), (-fin.opExpensesUsd).toFixed(2), fin.totalRevenueUsd > 0 ? ((fin.opExpensesUsd / fin.totalRevenueUsd) * 100).toFixed(2) + '%' : '0%'],
            ['6.0.00', 'RESULTADO OPERATIVO (EBITDA)', fin.operatingIncomeBs.toFixed(2), fin.operatingIncomeUsd.toFixed(2), fin.operatingMarginPct.toFixed(2) + '%'],
            ['7.1.01', '(+/-) Diferencial Cambiario en Cobranza', fin.fxDiffVes.toFixed(2), fin.fxDiffUsd.toFixed(2), fin.totalRevenueUsd > 0 ? ((fin.fxDiffUsd / fin.totalRevenueUsd) * 100).toFixed(2) + '%' : '0%'],
            ['8.0.00', 'UTILIDAD / RESULTADO NETO DEL EJERCICIO', fin.netProfitBs.toFixed(2), fin.netProfitUsd.toFixed(2), fin.netMarginPct.toFixed(2) + '%']
        ];

        const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map(r => r.join(';')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Estado_Resultados_PyL_${monthName}_${selectedYear}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('Cédula de Estado de Resultados exportada (CSV)');
    };

    const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || '';

    const statementLines = [
        {
            code: '4.1.01',
            label: 'Facturación Bruta de Mercancía (POS)',
            meta: `${fin.salesCount} tickets emitidos`,
            bs: fin.salesBs,
            usd: fin.salesUsd,
            pct: fin.totalRevenueUsd > 0 ? (fin.salesUsd / fin.totalRevenueUsd) * 100 : 0,
            type: 'item'
        },
        {
            code: '4.0.00',
            label: 'TOTAL INGRESOS OPERACIONALES NETOS',
            bs: fin.totalRevenueBs,
            usd: fin.totalRevenueUsd,
            pct: fin.totalRevenueUsd > 0 ? 100 : 0,
            type: 'subtotal'
        },
        {
            code: '5.1.01',
            label: '(-) Costo de Mercancía Vendida (CMV / Reposición)',
            meta: 'Costo histórico de inventario despachado',
            bs: -fin.cogsBs,
            usd: -fin.cogsUsd,
            pct: fin.totalRevenueUsd > 0 ? (fin.cogsUsd / fin.totalRevenueUsd) * 100 : 0,
            type: 'deduction'
        },
        {
            code: '5.0.00',
            label: '(=) UTILIDAD BRUTA COMERCIAL',
            meta: `Margen Bruto sobre Ventas: ${fin.grossMarginPct.toFixed(2)}%`,
            bs: fin.grossProfitBs,
            usd: fin.grossProfitUsd,
            pct: fin.grossMarginPct,
            type: 'highlight'
        },
        {
            code: '6.1.01',
            label: '(-) Gastos Operativos, Servicios y Nómina',
            meta: `${pnlData?.expenseBreakdown?.length || 0} partidas de gasto ejecutadas`,
            bs: -fin.opExpensesBs,
            usd: -fin.opExpensesUsd,
            pct: fin.totalRevenueUsd > 0 ? (fin.opExpensesUsd / fin.totalRevenueUsd) * 100 : 0,
            type: 'deduction'
        },
        {
            code: '6.0.00',
            label: '(=) RESULTADO OPERATIVO (EBITDA)',
            meta: `Margen Operativo: ${fin.operatingMarginPct.toFixed(2)}%`,
            bs: fin.operatingIncomeBs,
            usd: fin.operatingIncomeUsd,
            pct: fin.operatingMarginPct,
            type: 'subtotal'
        },
        {
            code: '7.1.01',
            label: '(+/-) Diferencial Cambiario en Cartera Cobrada',
            meta: 'Ajuste por variación de tasa BCV en cuentas por cobrar',
            bs: fin.fxDiffVes,
            usd: fin.fxDiffUsd,
            pct: fin.totalRevenueUsd > 0 ? (Math.abs(fin.fxDiffUsd) / fin.totalRevenueUsd) * 100 : 0,
            type: 'item'
        },
        {
            code: '8.0.00',
            label: '(=) UTILIDAD / RESULTADO NETO DEL EJERCICIO',
            meta: `Rentabilidad Neta Final: ${fin.netMarginPct.toFixed(2)}%`,
            bs: fin.netProfitBs,
            usd: fin.netProfitUsd,
            pct: fin.netMarginPct,
            type: 'net_total'
        }
    ];

    return (
        <div className="space-y-5 pb-20 max-w-[1600px] mx-auto px-2 sm:px-6">
            {/* CABECERA INSTITUCIONAL DE AUDITORÍA FINANCIERA */}
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-2xs">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5">
                        <div className="w-10 h-10 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center shrink-0">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                                    Estado de Resultados & Rendimiento (P&L)
                                </h1>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                    NIF-VE • Tasa Ref: Bs. {effRate.toFixed(2)}/$
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Cédula financiera de ingresos brutos, costo de reposición, gastos operativos, punto de equilibrio y cierres contables
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Selector de Período */}
                        <div className="inline-flex items-center h-9 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-1 text-xs">
                            <select
                                value={selectedMonth}
                                onChange={e => setSelectedMonth(Number(e.target.value))}
                                className="bg-transparent text-slate-900 dark:text-white font-semibold px-2 py-1 outline-none cursor-pointer"
                            >
                                {MONTHS.map(m => (
                                    <option key={m.value} value={m.value} className="bg-white dark:bg-slate-900">{m.label}</option>
                                ))}
                            </select>
                            <span className="text-slate-300 dark:text-slate-600">|</span>
                            <select
                                value={selectedYear}
                                onChange={e => setSelectedYear(Number(e.target.value))}
                                className="bg-transparent text-slate-900 dark:text-white font-mono font-bold px-2 py-1 outline-none cursor-pointer"
                            >
                                {[2024, 2025, 2026, 2027].map(y => (
                                    <option key={y} value={y} className="bg-white dark:bg-slate-900">{y}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            type="button"
                            onClick={handleExportCSV}
                            className="h-9 px-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                            title="Exportar Estado de Resultados a CSV / Excel"
                        >
                            <Download size={14} />
                            <span>Exportar CSV</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="h-9 px-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                            <Printer size={14} />
                            <span className="hidden sm:inline">Imprimir</span>
                        </button>

                        <button
                            type="button"
                            onClick={fetchDashboardData}
                            className="h-9 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                            <span>Sincronizar</span>
                        </button>
                    </div>
                </div>

                {/* CINTA DE RATIOS FINANCIEROS REALES (5 INDICADORES TÉCNICOS) */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="p-3 rounded-md bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                            Ingresos Totales ({monthLabel})
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                            {formatBs(fin.totalRevenueBs)}
                        </div>
                        <span className="text-[11px] font-mono text-slate-500">
                            Ref: {formatUSD(fin.totalRevenueUsd)} ({fin.salesCount} vtas)
                        </span>
                    </div>

                    <div className="p-3 rounded-md bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                            Utilidad Bruta & Margen
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                            {formatBs(fin.grossProfitBs)}
                        </div>
                        <span className="text-[11px] font-mono font-semibold text-sky-600 dark:text-sky-400">
                            {formatUSD(fin.grossProfitUsd)} • Margen {fin.grossMarginPct.toFixed(1)}%
                        </span>
                    </div>

                    <div className="p-3 rounded-md bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                            Punto de Equilibrio Mensual
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                            {formatUSD(fin.breakEvenUsd)}
                        </div>
                        <span className="text-[11px] font-mono text-slate-500">
                            Venta mínima p/ cubrir gastos
                        </span>
                    </div>

                    <div className="p-3 rounded-md bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                            Ticket Promedio
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                            {formatBs(fin.avgTicketBs)}
                        </div>
                        <span className="text-[11px] font-mono text-slate-500">
                            Ref: {formatUSD(fin.avgTicketUsd)} / operación
                        </span>
                    </div>

                    <div className={`p-3 rounded-md border col-span-2 sm:col-span-1 ${
                        fin.netProfitUsd >= 0
                            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60'
                            : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60'
                    }`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wider block ${
                            fin.netProfitUsd >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                        }`}>
                            Resultado Líquido Neto
                        </span>
                        <div className={`text-base sm:text-lg font-mono font-black tabular-nums mt-0.5 ${
                            fin.netProfitUsd >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400'
                        }`}>
                            {formatBs(fin.netProfitBs)}
                        </div>
                        <span className={`text-[11px] font-mono font-bold ${
                            fin.netProfitUsd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                        }`}>
                            {formatUSD(fin.netProfitUsd)} ({fin.netMarginPct.toFixed(1)}% neto)
                        </span>
                    </div>
                </div>
            </div>

            {/* PESTAÑAS DE NAVEGACIÓN SOBRIAS */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                    {[
                        { id: 'pnl', label: '1. Cédula de Estado de Resultados (P&L)', icon: Briefcase },
                        { id: 'periodos', label: `2. Control y Cierre de Períodos (${selectedYear})`, icon: Lock },
                        { id: 'comisiones', label: `3. Nómina de Comisiones (${commissions.length})`, icon: Award }
                    ].map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                                    active
                                        ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                                }`}
                            >
                                <Icon size={14} />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ==================== TAB 1: HOJA FORMAL DE ESTADO DE RESULTADOS ==================== */}
            {activeTab === 'pnl' && (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                    {/* CÉDULA PRINCIPAL (8 COLUMNAS EN XL) */}
                    <div className="xl:col-span-8 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                    Estado Consolidado de Ganancias y Pérdidas — {monthLabel} {selectedYear}
                                </h2>
                                <p className="text-[11px] text-slate-500">
                                    Cifras expresadas en Bolívares (VES) y Dólares de Referencia (USD) con análisis vertical
                                </p>
                            </div>
                            <span className="text-[11px] font-mono text-slate-500">
                                Base 100% = Ingresos Operacionales
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/40 dark:bg-slate-900">
                                        <th className="py-2.5 px-3 w-20">Partida</th>
                                        <th className="py-2.5 px-3">Concepto / Cuenta de Resultado</th>
                                        <th className="py-2.5 px-3 text-right">Bolívares (VES)</th>
                                        <th className="py-2.5 px-3 text-right">Divisa Ref. (USD)</th>
                                        <th className="py-2.5 px-3 text-right w-28">% Vertical</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                                    {statementLines.map((row) => {
                                        const isSubtotal = row.type === 'subtotal';
                                        const isHighlight = row.type === 'highlight';
                                        const isNetTotal = row.type === 'net_total';
                                        const isDeduction = row.type === 'deduction';

                                        return (
                                            <tr
                                                key={row.code}
                                                className={
                                                    isNetTotal
                                                        ? 'bg-slate-900 text-white dark:bg-slate-800 font-bold'
                                                        : isHighlight
                                                            ? 'bg-sky-50/60 dark:bg-sky-950/25 font-bold'
                                                            : isSubtotal
                                                                ? 'bg-slate-50 dark:bg-slate-800/50 font-bold'
                                                                : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                                                }
                                            >
                                                <td className={`py-3 px-3 font-mono text-[11px] ${isNetTotal ? 'text-slate-300' : 'text-slate-400'}`}>
                                                    {row.code}
                                                </td>
                                                <td className="py-3 px-3">
                                                    <div className={isNetTotal ? 'text-white font-black' : 'text-slate-900 dark:text-white'}>
                                                        {row.label}
                                                    </div>
                                                    {row.meta && (
                                                        <div className={`text-[10px] mt-0.5 ${isNetTotal ? 'text-slate-300' : 'text-slate-500'}`}>
                                                            {row.meta}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className={`py-3 px-3 text-right font-mono tabular-nums ${
                                                    isNetTotal
                                                        ? (row.bs >= 0 ? 'text-emerald-400 font-black text-sm' : 'text-rose-400 font-black text-sm')
                                                        : isDeduction
                                                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                                            : 'text-slate-800 dark:text-slate-200'
                                                }`}>
                                                    {row.bs < 0 ? `(${formatBs(Math.abs(row.bs))})` : formatBs(row.bs)}
                                                </td>
                                                <td className={`py-3 px-3 text-right font-mono tabular-nums ${
                                                    isNetTotal
                                                        ? (row.usd >= 0 ? 'text-emerald-400 font-black text-sm' : 'text-rose-400 font-black text-sm')
                                                        : isDeduction
                                                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                                            : 'text-slate-900 dark:text-white font-bold'
                                                }`}>
                                                    {row.usd < 0 ? `(${formatUSD(Math.abs(row.usd))})` : formatUSD(row.usd)}
                                                </td>
                                                <td className="py-3 px-3 text-right font-mono tabular-nums">
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span className={`text-[11px] font-bold ${
                                                            isNetTotal ? 'text-white' : isDeduction ? 'text-rose-500' : 'text-slate-600 dark:text-slate-400'
                                                        }`}>
                                                            {row.pct.toFixed(1)}%
                                                        </span>
                                                        <div className="w-16 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                                            <div
                                                                style={{ width: `${Math.min(100, Math.max(0, Math.abs(row.pct)))}%` }}
                                                                className={`h-full ${
                                                                    isDeduction ? 'bg-rose-500' : isNetTotal ? 'bg-emerald-400' : 'bg-sky-500'
                                                                }`}
                                                            />
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* COLUMNA LATERAL DE AUDITORÍA: TOP PRODUCTOS & PARTIDAS DE GASTO (4 COLUMNAS EN XL) */}
                    <div className="xl:col-span-4 space-y-5">
                        {/* Desglose de Gastos Operativos */}
                        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
                            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                <div>
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                        Estructura de Gastos Operativos
                                    </h3>
                                    <p className="text-[11px] text-slate-500">Partidas ejecutadas en el período</p>
                                </div>
                                <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">
                                    {formatUSD(fin.opExpensesUsd)}
                                </span>
                            </div>

                            <div className="p-4 space-y-3 text-xs">
                                {(!pnlData?.expenseBreakdown || pnlData.expenseBreakdown.length === 0) ? (
                                    <div className="text-center py-6 text-slate-400">
                                        Sin egresos operativos registrados en {monthLabel}.
                                    </div>
                                ) : (
                                    pnlData.expenseBreakdown.map((e, idx) => (
                                        <div key={idx} className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-slate-700 dark:text-slate-300 uppercase text-[11px]">
                                                    {e.category}
                                                </span>
                                                <span className="font-mono font-bold text-slate-900 dark:text-white">
                                                    {formatUSD(e.amount)} <span className="text-slate-400 font-normal">({Number(e.percentage || 0).toFixed(1)}%)</span>
                                                </span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    style={{ width: `${Math.min(100, Number(e.percentage) || 0)}%` }}
                                                    className="h-full bg-slate-700 dark:bg-slate-300"
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Top 10 Productos por Contribución Marginal */}
                        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
                            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                    Productos de Mayor Contribución Bruta
                                </h3>
                                <p className="text-[11px] text-slate-500">Ordenados por utilidad neta aportada al negocio</p>
                            </div>

                            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-[360px] overflow-y-auto">
                                {(!pnlData?.topProducts || pnlData.topProducts.length === 0) ? (
                                    <div className="text-center py-8 text-slate-400">
                                        Sin ventas facturadas en este mes.
                                    </div>
                                ) : (
                                    pnlData.topProducts.map((p, idx) => {
                                        const marginPct = p.revenue > 0 ? ((p.grossProfit / p.revenue) * 100).toFixed(0) : 0;
                                        return (
                                            <div key={p.productId || idx} className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <span className="w-5 h-5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold text-[10px] flex items-center justify-center shrink-0">
                                                        {idx + 1}
                                                    </span>
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                                                            {p.productName}
                                                        </div>
                                                        <span className="text-[10px] font-mono text-slate-400">
                                                            {p.unitsSold} uds • Facturado: {formatUSD(p.revenue)}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0 font-mono">
                                                    <div className="font-bold text-emerald-600 dark:text-emerald-400">
                                                        +{formatUSD(p.grossProfit)}
                                                    </div>
                                                    <span className="text-[10px] text-slate-400">
                                                        Margen {marginPct}%
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== TAB 2: CIERRES DE PERÍODO CONTABLE ==================== */}
            {activeTab === 'periodos' && (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                Control de Períodos Fiscales y Contables — Ejercicio {selectedYear}
                            </h3>
                            <p className="text-[11px] text-slate-500">
                                El cierre de un mes congela los saldos históricos e impide insertar o alterar facturas retroactivas sin autorización
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
                        {periods.map(p => {
                            const isClosed = Boolean(p.isClosed);
                            return (
                                <div
                                    key={p.periodMonth}
                                    className={`p-3.5 rounded-lg border flex flex-col justify-between ${
                                        isClosed
                                            ? 'bg-slate-50/70 dark:bg-slate-800/30 border-slate-200 dark:border-slate-800'
                                            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                                    }`}
                                >
                                    <div>
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                                    {p.monthName} {p.periodYear}
                                                </h4>
                                                <span className="text-[10px] font-mono text-slate-400">
                                                    PERÍODO {String(p.periodMonth).padStart(2, '0')}/{p.periodYear}
                                                </span>
                                            </div>
                                            <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded uppercase inline-flex items-center gap-1 border ${
                                                isClosed
                                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                                                    : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                                            }`}>
                                                {isClosed ? <Lock size={10} /> : <Unlock size={10} />}
                                                {isClosed ? 'CERRADO' : 'ABIERTO'}
                                            </span>
                                        </div>

                                        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs space-y-1 font-mono">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500 font-sans">Facturación:</span>
                                                <span className="font-bold text-slate-900 dark:text-white">{formatUSD(p.salesTotal)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500 font-sans">Resultado Neto:</span>
                                                <span className={`font-bold ${Number(p.netProfit) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                                                    {formatUSD(p.netProfit)}
                                                </span>
                                            </div>
                                            {isClosed && p.closedBy && (
                                                <div className="text-[10px] text-slate-400 font-sans pt-0.5">
                                                    Auditor: <strong className="text-slate-600 dark:text-slate-300">{p.closedBy}</strong>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-3 pt-2">
                                        {isClosed ? (
                                            <button
                                                type="button"
                                                onClick={() => handleOpenReopenModal(p)}
                                                className="w-full py-1.5 bg-white dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-600 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded text-xs font-semibold transition-colors cursor-pointer"
                                            >
                                                Reabrir Mes
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleOpenClosePeriodModal(p)}
                                                className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                            >
                                                <Lock size={12} /> Ejecutar Cierre
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ==================== TAB 3: COMISIONES DE VENDEDORES ==================== */}
            {activeTab === 'comisiones' && (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                Cédula de Comisiones sobre Ventas — {monthLabel} {selectedYear}
                            </h3>
                            <p className="text-[11px] text-slate-500">
                                Cálculo directo sobre facturación efectivamente cobrada por operador
                            </p>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    <th className="py-2.5 px-4">Operador / Vendedor</th>
                                    <th className="py-2.5 px-4">Cargo / Rol</th>
                                    <th className="py-2.5 px-4 text-right">Operaciones</th>
                                    <th className="py-2.5 px-4 text-right">Base Facturada (USD)</th>
                                    <th className="py-2.5 px-4 text-right">Alícuota %</th>
                                    <th className="py-2.5 px-4 text-right">Comisión (USD)</th>
                                    <th className="py-2.5 px-4 text-right">Equivalente (VES)</th>
                                    <th className="py-2.5 px-4 text-center">Estado</th>
                                    <th className="py-2.5 px-4 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {commissions.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="text-center py-10 text-slate-400">
                                            No se registran ventas comisionables en este período.
                                        </td>
                                    </tr>
                                ) : (
                                    commissions.map(c => (
                                        <tr key={c.userId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                            <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                                                {c.userName}
                                            </td>
                                            <td className="py-3 px-4 font-mono text-[11px] uppercase text-slate-500">
                                                {c.role}
                                            </td>
                                            <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                                                {c.salesCount}
                                            </td>
                                            <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 dark:text-white">
                                                {formatUSD(c.totalSales)}
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenEditRateModal(c)}
                                                    className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded border border-slate-200 dark:border-slate-700 font-mono font-bold text-xs text-slate-800 dark:text-slate-200 cursor-pointer"
                                                    title="Modificar porcentaje de comisión"
                                                >
                                                    {c.commissionRate}%
                                                </button>
                                            </td>
                                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                {formatUSD(c.commissionAmount)}
                                            </td>
                                            <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                                                {formatBs((Number(c.commissionAmount) || 0) * effRate)}
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded uppercase border ${
                                                    c.status === 'PAGADO'
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                        : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                                }`}>
                                                    {c.status}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                {c.status === 'PAGADO' ? (
                                                    <span className="text-[11px] text-slate-400 font-mono">LIQUIDADO</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSettleCommission(c)}
                                                        className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded font-semibold text-[11px] cursor-pointer"
                                                    >
                                                        Liquidar
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* MODAL: Cerrar Período Contable */}
            {isClosePeriodModalOpen && periodToClose && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                                <Lock size={15} />
                                Cierre Contable: {periodToClose.monthName} {periodToClose.periodYear}
                            </h3>
                            <button onClick={() => setIsClosePeriodModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleConfirmClosePeriod} className="p-4 space-y-4 text-xs">
                            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                                Al ejecutar el cierre contable se congelan los saldos de ingresos, costos y gastos de este período para auditoría.
                            </div>
                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Acta / Observaciones de Cierre</label>
                                <textarea
                                    value={closureNotes}
                                    onChange={e => setClosureNotes(e.target.value)}
                                    rows={3}
                                    placeholder="Ej: Cierre mensual conciliado con arqueos de caja y bancos."
                                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none text-xs"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsClosePeriodModalOpen(false)}
                                    className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md font-semibold cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-md font-semibold cursor-pointer"
                                >
                                    Confirmar Cierre
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Reabrir Período Contable */}
            {isReopenModalOpen && periodToReopen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                                <Unlock size={15} className="text-rose-500" />
                                Reabrir Período: {periodToReopen.monthName} {periodToReopen.periodYear}
                            </h3>
                            <button onClick={() => setIsReopenModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleConfirmReopenPeriod} className="p-4 space-y-4 text-xs">
                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Motivo de Auditoría *</label>
                                <textarea
                                    required
                                    value={reopenReason}
                                    onChange={e => setReopenReason(e.target.value)}
                                    rows={3}
                                    placeholder="Indique la razón contable para reabrir el período..."
                                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none text-xs"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsReopenModalOpen(false)}
                                    className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md font-semibold cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-md font-semibold cursor-pointer"
                                >
                                    Reabrir Período
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Modificar Tasa de Comisión */}
            {isEditRateModalOpen && selectedCommission && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-full max-w-sm overflow-hidden shadow-xl">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white text-sm">Alícuota de Comisión</h3>
                            <button onClick={() => setIsEditRateModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveCommissionRate} className="p-4 space-y-4 text-xs">
                            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                <span className="text-slate-400 text-[10px] uppercase block">Operador:</span>
                                <div className="font-bold text-slate-900 dark:text-white">{selectedCommission.userName}</div>
                            </div>
                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Porcentaje (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="100"
                                    required
                                    value={customRate}
                                    onChange={e => setCustomRate(e.target.value)}
                                    className="w-full p-2.5 font-mono font-bold text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsEditRateModalOpen(false)}
                                    className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md font-semibold cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-md font-semibold cursor-pointer"
                                >
                                    Guardar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {confirmDialog}
        </div>
    );
}
