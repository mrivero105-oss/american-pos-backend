import { ArrowUpRight, ArrowDownRight, Printer, Banknote } from 'lucide-react';
import { formatUSD, formatBs, formatDate as formatDateSafe, isUsdOnlyMode } from '../utils/format';
import { useAuth } from '../hooks/AuthContext';

export default function CashShiftDetails({ shift, title = "Detalle del Turno", onPrint, paymentMethods = [], exchangeRate: propExchangeRate }) {
    const { user } = useAuth();
    if (!shift) return null;

    const isUsdOnly = isUsdOnlyMode();
    const exchangeRate = Number(shift.exchangeRate) || Number(shift.exchangeRateAtClose) || Number(propExchangeRate) || 1;
    const isDual = !isUsdOnly && exchangeRate > 1;
    const isClosed = shift.status === 'closed';
    const movements = shift.CashMovements || shift.movements || [];
    const salesSummary = shift.salesSummary || {};

    // In X-Report, breakdown comes from shift.expectedBreakdown (which has native amounts)
    // In Closed Shift, it's inside salesSummary.physicalBreakdown
    const breakdown = isClosed ? (salesSummary.physicalBreakdown || {}) : (shift.expectedBreakdown || shift.paymentBreakdown || {});
    const expectedBreakdown = isClosed ? (salesSummary.expectedBreakdown || {}) : (shift.expectedBreakdown || shift.paymentBreakdown || {});

    const tIn = shift.totalIn || 0;
    const tOut = shift.totalOut || 0;
    const tExp = shift.totalExpenses || 0;

    const formatDateLocal = (dateString) => {
        if (!dateString) return 'N/A';
        return formatDateSafe(dateString, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const formatCurrencyUsd = (amount) => formatUSD(amount);
    const formatCurrencyVes = (amount) => isUsdOnly ? formatUSD(amount) : formatBs(amount);

    // Helper to detect if a payment method operates in VES
    const isVesMethod = (methodId) => {
        if (isUsdOnly || !methodId) return false;
        const key = String(methodId).toLowerCase().trim();
        const methodObj = paymentMethods?.find(m => m && (String(m.id).toLowerCase().trim() === key || String(m.name).toLowerCase().trim() === key));
        if (methodObj) {
            if (methodObj.currency === 'USD' || methodObj.currency === 'COP' || methodObj.currency === '$') return false;
            if (methodObj.currency === 'VES' || methodObj.currency === 'BS' || methodObj.defaultCurrency === 'VES' || methodObj.currency === 'BS') return true;
        }
        const knownVesKeys = ['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'pagomovil', 'cash_bs', 'efectivo_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'];
        if (knownVesKeys.includes(key) || key.includes('bs') || key.includes('ves') || key.includes('movil') || key.includes('debito')) return true;
        return false;
    };

    const isUsdtMethod = (methodId) => {
        if (!methodId) return false;
        const key = String(methodId).toLowerCase().trim();
        return key === 'binance_usdt' || key === 'binance' || key.includes('usdt') || key.includes('binance');
    };

    const formatByMethod = (methodId, amount) => {
        if (isUsdtMethod(methodId)) return `${Number(amount || 0).toFixed(2)} USDT`;
        return isVesMethod(methodId) ? formatCurrencyVes(amount) : formatCurrencyUsd(amount);
    };

    const formatMovementAmount = (m) => {
        const isVes = m.currency === 'VES' || (m.paymentMethodId && isVesMethod(m.paymentMethodId));
        return isVes ? formatCurrencyVes(m.amount) : formatCurrencyUsd(m.amount);
    };

    return (
        <div className="space-y-6 sm:space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white tracking-tight">{title}</h3>
                    <p className="text-[10px] sm:text-[11px] text-slate-500 mt-1 sm:mt-2 uppercase tracking-[0.2em] font-black opacity-60">
                        Turno #{shift.id.substring(0, 8)} {shift.registerId && `• Caja #${shift.registerId}`}
                    </p>
                </div>
                {onPrint && (
                    <button
                        onClick={onPrint}
                        className="w-full sm:w-auto px-5 sm:px-6 py-3 min-h-[44px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-300 font-black rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95 text-xs tracking-widest uppercase flex items-center justify-center gap-2 cursor-pointer"
                    >
                        <Printer size={18} /> Imprimir Ticket
                    </button>
                )}
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">Apertura</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 capitalize leading-tight">{formatDateLocal(shift.openedAt)}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">Cierre</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 capitalize leading-tight">{isClosed ? formatDateLocal(shift.closedAt) : 'En curso'}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">Base Inicial</p>
                    <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums leading-none mb-1">
                        {isDual ? formatCurrencyVes(shift.initialAmount * exchangeRate) : formatCurrencyUsd(shift.initialAmount)}
                    </p>
                    {isDual && (
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Ref: {formatCurrencyUsd(shift.initialAmount)}</p>
                    )}
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 sm:p-4 rounded-lg border border-emerald-200 dark:border-emerald-800 flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1">Ventas Totales</p>
                    <p className="text-xl sm:text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums leading-none mb-1">
                        {isDual
                            ? formatCurrencyVes((shift.totalSalesAmount || salesSummary.totalSales || 0) * exchangeRate)
                            : formatCurrencyUsd(shift.totalSalesAmount || salesSummary.totalSales)}
                    </p>
                    {isDual && (
                        <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-500 mb-0.5">
                            Ref: {formatCurrencyUsd(shift.totalSalesAmount || salesSummary.totalSales)}
                        </p>
                    )}
                    <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-500">
                        {shift.salesCount || salesSummary.salesCount || 0} operaciones
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8">
                <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-4">Desglose de Caja</h4>

                    <div className="space-y-3">
                        {Object.entries(expectedBreakdown).length === 0 && (
                            <p className="text-xs text-slate-500 italic">No hay registros</p>
                        )}
                        {Object.entries(expectedBreakdown).map(([method, amount]) => {
                            const actualAmt = isClosed ? (breakdown[method] || 0) : amount;
                            const diff = Number(actualAmt) - Number(amount);
                            const methodObj = paymentMethods?.find(m => m && (String(m.id).toLowerCase().trim() === String(method).toLowerCase().trim() || String(m.name).toLowerCase().trim() === String(method).toLowerCase().trim()));
                            const methodLabel = methodObj ? methodObj.name : method.replace('_bs', ' Bs').replace('_usd', ' $').replace('cash', 'Efectivo').replace('binance_usdt', 'Binance Pay (USDT)').replace('debit', 'Débito').replace('transfer', 'Transferencia').replace('mobile_payment', 'Pago Móvil');

                            // BLIND CLOSE LOGIC
                            // If user is cajero and the shift is NOT closed (i.e. currently open, viewing report),
                            // we do NOT want them to see the expected amount or the diff.
                            // The modal already hides the X-report, but this is an extra layer of protection,
                            // or if they somehow trigger a view. 
                            const hideExpected = !isClosed && !['admin', 'superadmin'].includes(user?.role?.toLowerCase()?.trim());

                            return (
                                <div key={method} className="flex justify-between items-center p-3 bg-white dark:bg-slate-800/80 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors">
                                    <div className="flex items-center gap-2.5">
                                        <div className="h-7 w-7 rounded-md bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                                            <Banknote size={15} />
                                        </div>
                                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 capitalize tracking-tight">{methodLabel}</p>
                                    </div>
                                    <div className="text-right flex items-center gap-2 sm:gap-4 flex-wrap sm:flex-nowrap justify-end">
                                        <div>
                                            {isClosed && (
                                                <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Reportado</p>
                                            )}
                                            {hideExpected ? (
                                                <p className="text-xs font-semibold text-slate-400 italic">Oculto</p>
                                            ) : (
                                                <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">{formatByMethod(method, actualAmt)}</p>
                                            )}
                                        </div>
                                        {isClosed && !hideExpected && (
                                            <div className="text-right min-w-[60px]">
                                                <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Dif.</p>
                                                <p className={`text-xs font-bold tabular-nums ${diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
                                                    {diff > 0 ? '+' : ''}{formatByMethod(method, diff)}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {!(!isClosed && !['admin', 'superadmin'].includes(user?.role?.toLowerCase()?.trim())) && (
                        <div className="bg-sky-50 dark:bg-sky-950/30 p-3.5 rounded-lg border border-sky-200 dark:border-sky-800/60 mt-3 flex justify-between items-center">
                            <div>
                                <p className="text-[10px] font-bold text-sky-800 dark:text-sky-300 uppercase tracking-wider mb-0.5">
                                    {isClosed ? 'Total Físico (Entregado)' : 'Esperado en Caja'}
                                </p>
                                <p className="text-xl font-bold text-sky-900 dark:text-sky-200 leading-none">
                                    {formatCurrencyUsd(isClosed ? shift.finalAmount : shift.expectedAmount)}
                                </p>
                            </div>
                            {isClosed && (shift.difference !== 0) && (
                                <div className="text-right">
                                    <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">Diferencia Total</p>
                                    <p className={`text-xl font-black leading-none ${shift.difference > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {shift.difference > 0 ? '+' : ''}{formatCurrencyUsd(shift.difference)}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="space-y-4">
                    <div className="flex justify-between items-end border-b border-slate-200 dark:border-slate-700 pb-2">
                        <h4 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-widest">Movimientos Extras</h4>
                        <div className="flex gap-3 text-[10px] font-bold uppercase">
                            <span className="text-emerald-500">In: {formatCurrencyUsd(tIn)}</span>
                            <span className="text-red-500">Out: {formatCurrencyUsd(tOut + tExp)}</span>
                        </div>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                        {movements.length === 0 ? (
                            <p className="text-xs text-slate-500 italic p-4 text-center bg-slate-50 dark:bg-slate-800/30 rounded-xl">No se registraron movimientos</p>
                        ) : (
                            [...movements].reverse().map((movement, idx) => (
                                <div key={idx} className="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded-lg ${movement.type === 'in' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500' : 'bg-red-50 dark:bg-red-500/10 text-red-500'}`}>
                                            {movement.type === 'in' ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{movement.reason || 'Sin razón'}</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400">{new Date(movement.timestamp).toLocaleTimeString()}</p>
                                        </div>
                                    </div>
                                    <p className={`text-sm font-bold ${movement.type === 'in' ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {movement.type === 'in' ? '+' : '-'}{formatMovementAmount(movement)}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
