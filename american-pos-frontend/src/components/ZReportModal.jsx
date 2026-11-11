import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
    X, Printer, CheckCircle2, TrendingUp, 
    ArrowDownRight, ArrowUpRight, DollarSign, 
    Calendar, User, Receipt, Package, Layers
} from 'lucide-react';
import { formatMoney, formatDate as formatDateSafe, formatBs, isSingleCurrencyMode } from '../utils/format';
import { printZReportReceipt, printShiftInventoryReceipt } from '../utils/printCashReceipts';
import api from '../services/api';
import toast from 'react-hot-toast';
import BaseModal from './BaseModal';

export default function ZReportModal({ isOpen, onClose, shift, businessSettings = {}, exchangeRate = 1, paymentMethods = [], currencyMode = 'BOTH' }) {
    if (!isOpen || !shift) return null;

    const isSingle = isSingleCurrencyMode({ currencyMode, ...businessSettings });

    const formatDateLocal = (dateString) => {
        if (!dateString) return 'N/A';
        return formatDateSafe(dateString, {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const safeParse = (val) => {
        if (!val) return {};
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                return typeof parsed === 'string' ? JSON.parse(parsed) : (parsed || {});
            } catch (_) { return {}; }
        }
        return typeof val === 'object' ? val : {};
    };

    const salesSummary = safeParse(shift?.salesSummary);
    const physicalBreakdown = safeParse(salesSummary?.physicalBreakdown || shift?.physicalBreakdown);
    const expectedBreakdown = safeParse(salesSummary?.expectedBreakdown || shift?.expectedBreakdown);
    const rawMovements = shift?.CashMovements || shift?.movements || [];
    const movements = Array.isArray(rawMovements) ? rawMovements : (typeof rawMovements === 'string' ? (() => { try { return JSON.parse(rawMovements) || []; } catch (_) { return []; } })() : []);

    const effRate = Number(shift?.exchangeRateAtClose || shift?.exchangeRate || exchangeRate || 1) || 1;
    const totalSalesUsd = Number(shift?.totalSalesAmount ?? salesSummary?.totalSales ?? 0);
    const salesCount = Number(shift?.salesCount ?? salesSummary?.salesCount ?? 0);
    const totalIn = Number(shift?.totalIn ?? salesSummary?.totalIn ?? 0);
    const totalOut = Number(shift?.totalOut ?? salesSummary?.totalOut ?? 0);
    const totalExpenses = Number(shift?.totalExpenses ?? salesSummary?.totalExpenses ?? 0);
    const netFlowUsd = totalIn - (totalOut + totalExpenses);
    const diffUsd = Number(shift?.difference || 0);

    const [itemsSummary, setItemsSummary] = useState(
        Array.isArray(salesSummary?.itemsSummary) ? salesSummary.itemsSummary : []
    );
    const [loadingItems, setLoadingItems] = useState(false);

    useEffect(() => {
        if (Array.isArray(salesSummary?.itemsSummary) && salesSummary.itemsSummary.length > 0) {
            setItemsSummary(salesSummary.itemsSummary);
            return;
        }
        if (shift?.id) {
            setLoadingItems(true);
            api.get(`/cash/shift-products-summary/${shift.id}`)
                .then(res => {
                    if (res.data?.success && Array.isArray(res.data.items)) {
                        setItemsSummary(res.data.items);
                    }
                })
                .catch(err => console.warn('Could not fetch items summary for shift:', err))
                .finally(() => setLoadingItems(false));
        }
    }, [shift?.id]);

    const formatCurrencyUsd = (val) => formatMoney(Number(val) || 0, null, { currencyMode: 'USD', rate: 1 });
    const formatCurrencyVes = (val) => formatMoney((Number(val) || 0) * effRate, null, { currencyMode: 'VES', rate: effRate });

    const isVesMethod = (methodId) => {
        if (!methodId || isSingle) return false;
        const key = String(methodId).toLowerCase().trim();
        const knownVesKeys = ['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'pagomovil', 'cash_bs', 'efectivo_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'];
        if (knownVesKeys.includes(key) || key.includes('bs') || key.includes('ves') || key.includes('movil') || key.includes('debito')) return true;
        const methodObj = paymentMethods?.find(m => m && String(m.id).toLowerCase().trim() === key);
        if (methodObj) return methodObj.currency === 'VES' || methodObj.defaultCurrency === 'VES' || methodObj.currency === 'BS';
        return false;
    };

    const allMethodKeys = Array.from(new Set([
        ...Object.keys(expectedBreakdown),
        ...Object.keys(physicalBreakdown)
    ])).filter(k => {
        if (k === 'total') return false;
        const exp = Number(expectedBreakdown[k] || 0);
        const act = Number(physicalBreakdown[k] || 0);
        return exp > 0 || act > 0;
    });

    return (
        <BaseModal
            isOpen={isOpen && !!shift}
            onClose={onClose}
            maxWidth="max-w-3xl"
            className="flex flex-col h-[90dvh] max-h-[90dvh] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
        >
            {/* Status Bar */}
            <div className="bg-emerald-600 dark:bg-emerald-700 py-2.5 px-4 sm:px-6 flex items-center justify-center gap-2 shrink-0 text-white">
                <CheckCircle2 size={16} />
                <span className="text-xs font-bold uppercase tracking-wider text-center">Cierre de Jornada Fiscal • Consolidado Z</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar relative">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-bold uppercase tracking-wider text-[11px]">
                            <Calendar size={13} />
                            <span>Ciclo de Caja: #{(shift?.id || '00000000').substring(0, 8)}</span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Z-Report Fiscal</h2>
                        <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg w-fit">
                            <User size={13} className="text-slate-500 dark:text-slate-400" />
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{shift.user?.name || shift.userName || 'Administrador Central'}</span>
                        </div>
                    </div>
                    <div className="text-left md:text-right space-y-1">
                        <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">{formatDateLocal(shift?.closedAt || new Date())}</p>
                        <span className="inline-block bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 px-2.5 py-0.5 rounded text-[11px] font-semibold border border-emerald-200 dark:border-emerald-800">Sincronizado</span>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <SummaryCard 
                        title="Base de Inicio" 
                        value={formatCurrencyUsd(shift.initialAmount)} 
                        sub={!isSingle ? formatCurrencyVes(shift.initialAmount) : null}
                        icon={<DollarSign size={18} />}
                        color="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                    />
                    <SummaryCard 
                        title="Ingresos Brutos" 
                        value={formatCurrencyUsd(totalSalesUsd)} 
                        sub={`${salesCount} Operaciones`}
                        icon={<TrendingUp size={18} />}
                        color="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80"
                    />
                    <SummaryCard 
                        title="Flujo de Caja" 
                        value={formatCurrencyUsd(netFlowUsd)} 
                        sub={`Balance Neto`}
                        icon={<ArrowUpRight size={18} />}
                        color="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80"
                    />
                    <SummaryCard 
                        title="Arqueo Físico" 
                        value={formatCurrencyUsd(shift.finalAmount)} 
                        sub={!isSingle ? formatCurrencyVes(shift.finalAmount) : "Cierre de Caja"}
                        icon={<Receipt size={18} />}
                        color="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80"
                    />
                </div>

                {/* Discrepancy Alert */}
                {diffUsd !== 0 && (
                    <div 
                        className={`p-4 rounded-xl border flex items-center gap-4 ${
                            diffUsd > 0 
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100' 
                            : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100'
                        }`}
                    >
                        <div className={`p-3 rounded-lg shrink-0 ${diffUsd > 0 ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
                            {diffUsd > 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                        </div>
                        <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider opacity-75">Resultado de Auditoría</p>
                            <h4 className="text-base sm:text-lg font-bold">
                                {diffUsd > 0 ? 'Sobrante en Arqueo' : 'Faltante en Arqueo'}: {formatCurrencyUsd(diffUsd)} {!isSingle ? `(${formatCurrencyVes(diffUsd)})` : ''}
                            </h4>
                            <p className="text-xs opacity-75 mt-0.5">Ajustar balance manual o revisar movimientos pendientes</p>
                        </div>
                    </div>
                )}

                {/* Detailed Breakdown */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Mecanismos de Recaudo</h3>
                        <div className="h-px flex-1 ml-4 bg-slate-200 dark:bg-slate-800" />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {allMethodKeys.map((method) => {
                            const expected = Number(expectedBreakdown[method] || 0);
                            const actual = Number(physicalBreakdown[method] || 0);
                            const diff = actual - expected;
                            const methodObj = paymentMethods?.find(m => m.id === method);
                            
                            // Dynamic label based on currency mode
                            let label = methodObj ? methodObj.name : method;
                            if (!methodObj) {
                                label = method
                                    .replace('_bs', isSingle ? '' : ' Bs')
                                    .replace('cash', 'Efectivo')
                                    .replace('debit', 'Punto de Venta')
                                    .replace('pago_movil', 'Pago Móvil')
                                    .replace('card', 'Tarjeta/Punto')
                                    .replace('transfer', 'Transferencia')
                                    .replace('zelle', 'Zelle');
                            }

                            // Skip VES rows in SINGLE mode if they are empty
                            if (isSingle && isVesMethod(method) && expected === 0 && actual === 0) return null;
                            
                            const isVes = isVesMethod(method);
                            const formatAmount = (val) => isVes ? formatBs(val) : formatCurrencyUsd(val);

                            return (
                                <div 
                                    key={method} 
                                    className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center"
                                >
                                    <div>
                                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase">{label}</p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Sistema: {formatAmount(expected)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">Declarado: {formatAmount(actual)}</p>
                                        <p className={`text-xs font-semibold tabular-nums ${diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                            Dif: {diff > 0 ? '+' : ''}{formatAmount(diff)}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Movements */}
                {movements.length > 0 && (
                    <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Historial de Movimientos de Caja</h3>
                            <div className="h-px flex-1 ml-4 bg-slate-200 dark:bg-slate-800" />
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                            {movements.map((m, i) => (
                                <div key={i} className="flex justify-between items-center py-1.5 border-b border-slate-200/50 dark:border-slate-800/50 last:border-0">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`p-1.5 rounded-md ${m.type === 'in' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'}`}>
                                            {m.type === 'in' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                        </div>
                                        <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{m.reason}</span>
                                    </div>
                                    <span className={`text-xs font-bold tabular-nums ${m.type === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {m.type === 'in' ? '+' : '-'}{formatCurrencyUsd(m.amount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Auditoría de Mercancía Vendida y Stock Remanente (Requerimiento Z) */}
                <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Package size={16} className="text-primary-600 dark:text-primary-400" />
                            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                Mercancía Vendida y Existencias (Stock)
                            </h3>
                        </div>
                        <div className="h-px flex-1 ml-4 bg-slate-200 dark:bg-slate-800" />
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            {itemsSummary.length} producto{itemsSummary.length === 1 ? '' : 's'} en turno
                        </span>
                    </div>

                    {loadingItems ? (
                        <div className="p-6 text-center text-xs font-medium text-slate-400 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                            Cargando desglose de mercancía...
                        </div>
                    ) : itemsSummary.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                            No se registraron ventas de renglones en este turno.
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                            <th className="py-2.5 px-4">Producto / Presentación</th>
                                            <th className="py-2.5 px-3">Categoría</th>
                                            <th className="py-2.5 px-3 text-right">Vendido en Turno</th>
                                            <th className="py-2.5 px-4 text-right">Quedan en Stock</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                                        {itemsSummary.map((item, idx) => {
                                            const remaining = Number(item.stockInPresentations !== undefined ? item.stockInPresentations : (item.currentStock || 0));
                                            const isLow = remaining <= 5;
                                            const isNegative = remaining <= 0;

                                            return (
                                                <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                                    <td className="py-2.5 px-4">
                                                        <div className="font-bold text-slate-800 dark:text-slate-200">
                                                            {item.name}
                                                        </div>
                                                        {item.presentationName && (
                                                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 border border-primary-200 dark:border-primary-800/50 mt-0.5">
                                                                {item.presentationName}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-medium">
                                                        {item.category || 'General'}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right font-black text-slate-900 dark:text-white tabular-nums text-sm">
                                                        {Number(item.quantitySold || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-right">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold text-xs tabular-nums ${
                                                            isNegative 
                                                                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50'
                                                                : isLow 
                                                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50'
                                                                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50'
                                                        }`}>
                                                            {remaining.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} disp.
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Actions */}
            <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col sm:flex-row justify-end gap-2.5 shrink-0">
                <button 
                    onClick={() => {
                        printShiftInventoryReceipt({
                            shift,
                            itemsSummary,
                            settings: businessSettings,
                            businessSettings
                        });
                        toast.success('Imprimiendo ticket de inventario y mercancía...');
                    }} 
                    disabled={itemsSummary.length === 0}
                    className="px-3.5 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Imprimir tira de auditoría de mercancía y existencias"
                >
                    <Package size={15} className="text-primary-600 dark:text-primary-400" />
                    <span>Ticket de Inventario</span>
                </button>
                <button 
                    onClick={() => {
                        printZReportReceipt({
                            shift,
                            itemsSummary,
                            settings: businessSettings,
                            businessSettings,
                            exchangeRate,
                            currencyMode
                        });
                        toast.success('Imprimiendo comprobante Corte Z...');
                    }} 
                    className="px-4 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                    <Printer size={15} /> Imprimir Corte Z
                </button>
                <button 
                    onClick={onClose} 
                    className="px-5 h-10 rounded-lg font-semibold text-xs text-white bg-primary-600 hover:bg-primary-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                    <span>Cerrar Reporte</span>
                </button>
            </div>
        </BaseModal>
    );
}

function SummaryCard({ title, value, sub, icon, color }) {
    return (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className={`w-9 h-9 ${color} rounded-lg flex items-center justify-center mb-2.5`}>
                {icon}
            </div>
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{title}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white leading-tight tabular-nums">{value}</p>
            {sub && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {sub}
                </p>
            )}
        </div>
    );
}
