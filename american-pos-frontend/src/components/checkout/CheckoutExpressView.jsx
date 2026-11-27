import {
    Banknote,
    CreditCard,
    Euro,
    Fingerprint,
    QrCode,
    RefreshCcw,
    Send,
    User,
    Wallet
} from 'lucide-react';
import { formatBs, formatEUR, formatUSD, precisionRound } from '../../utils/format';

export default function CheckoutExpressView({
    handleSubmit,
    getMethodPromo,
    total,
    activeExchangeRate,
    activeEuroRate = 0,
    findMethodKey,
    igtfEnabled,
    isSingle,
    igtfRate,
    isUsdOnly,
    primaryCurrency = 'USD',
    currencySymbol = '$',
    formatPrimary = formatUSD,
    hasEuroMethod = false,
    setFocusedExpressMethodId,
    executeExpressPayment,
    totalToPayUsd,
    totalToPayVes,
    openPagoMovilQr,
    openBinanceQr,
    payments,
    handleResetPayment,
    handleQuickAmount
}) {
    const isSingleLocal = Boolean(isSingle || isUsdOnly);
    const quickBills = primaryCurrency === 'COP'
        ? [2000, 5000, 10000, 20000, 50000, 100000]
        : [1, 5, 10, 20, 50, 100];
    const fmt = typeof formatPrimary === 'function' ? formatPrimary : formatUSD;

    return (
        <form id="checkout-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* Grilla de Cobro Directo 1-Clic */}
            {(() => {
                const promoCashUsd = getMethodPromo('cash_usd', 'Efectivo USD');
                const promoCashEur = getMethodPromo('cash_eur', 'Efectivo €');
                const promoCashBs = getMethodPromo('cash_bs', 'Efectivo Bs');
                const promoDebit = getMethodPromo('debit', 'Punto de Venta');
                const promoMovil = getMethodPromo('pago_movil', 'Pago Móvil');
                const promoTransfer = getMethodPromo('transfer', 'Transfer / Zelle');
                const promoBiopago = getMethodPromo('biopago', 'Biopago');
                const promoCredit = getMethodPromo('fiado', 'Crédito / Fiado');

                const baseTotalUsd = Number(total) || 0;
                const baseTotalVes = precisionRound(baseTotalUsd * activeExchangeRate, 2);
                const cashUsdMethod = findMethodKey('cash_usd');
                const cashUsdAppliesIgtf = igtfEnabled && !isSingleLocal && cashUsdMethod?.id !== 'zelle' && cashUsdMethod?.id !== 'fiado';
                const netPrincipalCashUsd = promoCashUsd ? Math.max(0, baseTotalUsd - promoCashUsd.savings) : baseTotalUsd;
                const netCashUsd = cashUsdAppliesIgtf
                    ? precisionRound(netPrincipalCashUsd * (1 + ((Number(igtfRate) || 3) / 100)), 2)
                    : netPrincipalCashUsd;
                const netCashBs = promoCashBs ? Math.max(0, baseTotalVes - precisionRound(promoCashBs.savings * activeExchangeRate, 2)) : baseTotalVes;
                const netDebit = promoDebit ? Math.max(0, baseTotalVes - precisionRound(promoDebit.savings * activeExchangeRate, 2)) : baseTotalVes;
                const netMovil = promoMovil ? Math.max(0, baseTotalVes - precisionRound(promoMovil.savings * activeExchangeRate, 2)) : baseTotalVes;
                const netBiopago = promoBiopago ? Math.max(0, baseTotalVes - precisionRound(promoBiopago.savings * activeExchangeRate, 2)) : baseTotalVes;
                const netTransfer = promoTransfer ? Math.max(0, baseTotalUsd - promoTransfer.savings) : baseTotalUsd;
                const netCredit = promoCredit ? Math.max(0, baseTotalUsd - promoCredit.savings) : baseTotalUsd;
                const showVenezuelaEuroCard = !isSingleLocal && hasEuroMethod && activeEuroRate > 0;
                const netPrincipalCashEurUsd = promoCashEur ? Math.max(0, baseTotalUsd - promoCashEur.savings) : baseTotalUsd;
                const netCashEurBaseBs = precisionRound(netPrincipalCashEurUsd * activeExchangeRate, 2);
                const eurIgtfFactor = (igtfEnabled && !isSingleLocal) ? (1 + ((Number(igtfRate) || 3) / 100)) : 1;
                const netCashEur = showVenezuelaEuroCard
                    ? precisionRound((netCashEurBaseBs / activeEuroRate) * eurIgtfFactor, 2)
                    : 0;

                return (
                    <div className={`grid grid-cols-2 sm:grid-cols-3 ${isSingleLocal ? 'lg:grid-cols-4' : (showVenezuelaEuroCard ? 'lg:grid-cols-7' : 'lg:grid-cols-6')} gap-2.5 sm:gap-3`}>
                        {/* F1: EFECTIVO $ / Moneda Primaria */}
                        <button
                            type="button"
                            onMouseEnter={() => setFocusedExpressMethodId('cash_usd')}
                            onFocus={() => setFocusedExpressMethodId('cash_usd')}
                            onClick={() => executeExpressPayment('cash_usd', true)}
                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoCashUsd ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                        >
                            <div className="flex justify-between items-start">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                    {primaryCurrency === 'EUR' ? <Euro size={17} strokeWidth={2.2} /> : <Banknote size={17} strokeWidth={2.2} />}
                                </div>
                                <div className="flex items-center gap-1">
                                    {promoCashUsd && (
                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                            -{promoCashUsd.discountPercentage}%
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="mt-1">
                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">
                                    {isSingleLocal ? (primaryCurrency === 'EUR' ? 'EFECTIVO €' : 'EFECTIVO') : 'EFECTIVO $'}
                                </h4>
                                <div className="flex items-baseline gap-1.5">
                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoCashUsd ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                        {fmt(netCashUsd)}
                                    </p>
                                    {promoCashUsd && (
                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                            {fmt(totalToPayUsd)}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                {promoCashUsd ? `Ahorras ${fmt(promoCashUsd.savings)}` : 'Cobro Directo 1-Clic'}
                            </div>
                        </button>

                        {/* EFECTIVO € (Venezuela con Tasa Oficial Euro BCV) */}
                        {showVenezuelaEuroCard && (
                            <button
                                type="button"
                                onMouseEnter={() => setFocusedExpressMethodId('cash_eur')}
                                onFocus={() => setFocusedExpressMethodId('cash_eur')}
                                onClick={() => executeExpressPayment('cash_eur', true)}
                                className="group relative bg-white dark:bg-slate-850 hover:bg-indigo-50/60 dark:hover:bg-slate-800 border border-indigo-200 dark:border-indigo-800/70 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer"
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center border border-indigo-200 dark:border-indigo-800 transition-colors">
                                        <Euro size={17} strokeWidth={2.2} />
                                    </div>
                                    <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono text-[9.5px] font-bold rounded border border-indigo-200 dark:border-indigo-800">
                                        BCV €
                                    </span>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-indigo-700 dark:text-indigo-300">EFECTIVO €</h4>
                                    <p className="text-sm sm:text-base font-black tabular-nums tracking-tight text-slate-900 dark:text-white">
                                        {formatEUR(netCashEur)}
                                    </p>
                                </div>
                                <div className="text-[9.5px] font-semibold text-indigo-500 dark:text-indigo-400 font-mono">
                                    1 € = {activeEuroRate.toFixed(2)} Bs
                                </div>
                            </button>
                        )}

                        {/* F2: EFECTIVO BS */}
                        {isSingleLocal ? (
                            <button
                                type="button"
                                onMouseEnter={() => setFocusedExpressMethodId('debit')}
                                onFocus={() => setFocusedExpressMethodId('debit')}
                                onClick={() => executeExpressPayment('debit', true)}
                                className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoDebit ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                        <CreditCard size={17} strokeWidth={2.2} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {promoDebit && (
                                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                -{promoDebit.discountPercentage}%
                                            </span>
                                        )}
                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                            [F2]
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">{primaryCurrency === 'EUR' ? 'TARJETA / TPV' : 'TARJETA / DÉBITO'}</h4>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoDebit ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                            {fmt(netDebit)}
                                        </p>
                                        {promoDebit && (
                                            <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                {fmt(totalToPayUsd)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                    {promoDebit ? `Ahorras ${fmt(promoDebit.savings)}` : 'Cobro Directo 1-Clic'}
                                </div>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onMouseEnter={() => setFocusedExpressMethodId('cash_bs')}
                                onFocus={() => setFocusedExpressMethodId('cash_bs')}
                                onClick={() => executeExpressPayment('cash_bs', true)}
                                className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoCashBs ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                        <Wallet size={17} strokeWidth={2.2} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {promoCashBs && (
                                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                -{promoCashBs.discountPercentage}%
                                            </span>
                                        )}
                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                            [F2]
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">EFECTIVO BS.</h4>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoCashBs ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                            {formatBs(netCashBs)}
                                        </p>
                                        {promoCashBs && (
                                            <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                {formatBs(totalToPayVes)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                    {promoCashBs ? `Ahorras $${promoCashBs.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                </div>
                            </button>
                        )}

                        {/* F3: PUNTO DE VENTA */}
                        {isSingleLocal ? (
                            <button
                                type="button"
                                onMouseEnter={() => setFocusedExpressMethodId('transfer')}
                                onFocus={() => setFocusedExpressMethodId('transfer')}
                                onClick={() => executeExpressPayment('transfer', true)}
                                className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoTransfer ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                        <Send size={17} strokeWidth={2.2} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {promoTransfer && (
                                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                -{promoTransfer.discountPercentage}%
                                            </span>
                                        )}
                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                            [F3]
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">{primaryCurrency === 'EUR' ? 'BIZUM / SEPA' : (primaryCurrency === 'COP' ? 'NEQUI / PSE' : 'TRANSFER / ZELLE')}</h4>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoTransfer ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                            {fmt(netTransfer)}
                                        </p>
                                        {promoTransfer && (
                                            <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                {fmt(totalToPayUsd)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                    {promoTransfer ? `Ahorras ${fmt(promoTransfer.savings)}` : 'Cobro Directo 1-Clic'}
                                </div>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onMouseEnter={() => setFocusedExpressMethodId('debit')}
                                onFocus={() => setFocusedExpressMethodId('debit')}
                                onClick={() => executeExpressPayment('debit', true)}
                                className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoDebit ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                        <CreditCard size={17} strokeWidth={2.2} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {promoDebit && (
                                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                -{promoDebit.discountPercentage}%
                                            </span>
                                        )}
                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                            [F3]
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">PUNTO DE VENTA</h4>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoDebit ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                            {formatBs(netDebit)}
                                        </p>
                                        {promoDebit && (
                                            <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                {formatBs(totalToPayVes)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                    {promoDebit ? `Ahorras $${promoDebit.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                </div>
                            </button>
                        )}

                        {/* F4: PAGO MÓVIL */}
                        {isSingleLocal ? (
                            <button
                                type="button"
                                onMouseEnter={() => setFocusedExpressMethodId('credit')}
                                onFocus={() => setFocusedExpressMethodId('credit')}
                                onClick={() => executeExpressPayment('credit', true)}
                                className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoCredit ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                        <User size={17} strokeWidth={2.2} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {promoCredit && (
                                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                -{promoCredit.discountPercentage}%
                                            </span>
                                        )}
                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                            [F4]
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">CRÉDITO / CUENTA</h4>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoCredit ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                            {fmt(netCredit)}
                                        </p>
                                        {promoCredit && (
                                            <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                {fmt(totalToPayUsd)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                    Cobro Directo 1-Clic
                                </div>
                            </button>
                        ) : (
                            <div
                                role="button"
                                tabIndex={0}
                                onMouseEnter={() => setFocusedExpressMethodId('pago_movil')}
                                onFocus={() => setFocusedExpressMethodId('pago_movil')}
                                onClick={() => executeExpressPayment('movil', true)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        executeExpressPayment('movil', true);
                                    }
                                }}
                                className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoMovil ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer select-none`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                        <Send size={17} strokeWidth={2.2} />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {promoMovil && (
                                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                -{promoMovil.discountPercentage}%
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openPagoMovilQr(findMethodKey('movil') || { id: 'pago_movil', name: 'Pago Móvil', currency: 'VES' });
                                            }}
                                            className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[9.5px] font-bold uppercase tracking-wide flex items-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer z-10 shadow-2xs"
                                            title="Ver Código QR de Pago Móvil"
                                        >
                                            <QrCode size={11} />
                                            <span>QR</span>
                                        </button>
                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                            [F4]
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">PAGO MÓVIL</h4>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoMovil ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                            {formatBs(netMovil)}
                                        </p>
                                        {promoMovil && (
                                            <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                {formatBs(totalToPayVes)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                    {promoMovil ? `Ahorras $${promoMovil.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                </div>
                            </div>
                        )}

                        {/* F5: BIOPAGO */}
                        {!isSingleLocal && (
                            <button
                                type="button"
                                onMouseEnter={() => setFocusedExpressMethodId('biopago')}
                                onFocus={() => setFocusedExpressMethodId('biopago')}
                                onClick={() => executeExpressPayment('biopago', true)}
                                className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoBiopago ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                        <Fingerprint size={17} strokeWidth={2.2} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {promoBiopago && (
                                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                -{promoBiopago.discountPercentage}%
                                            </span>
                                        )}
                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                            [F5]
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">BIOPAGO</h4>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoBiopago ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                            {formatBs(netBiopago)}
                                        </p>
                                        {promoBiopago && (
                                            <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                {formatBs(totalToPayVes)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                    {promoBiopago ? `Ahorras $${promoBiopago.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                </div>
                            </button>
                        )}

                        {/* F6: BINANCE PAY (USDT - exclusivo mercado dual Venezuela) */}
                        {!isSingleLocal && (() => {
                            const binMethod = findMethodKey('binance') || { id: 'binance_usdt', name: 'Binance Pay', currency: 'USDT' };
                            const amountUsdt = precisionRound(totalToPayUsd, 2);
                            return (
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onMouseEnter={() => setFocusedExpressMethodId(binMethod.id || 'binance_usdt')}
                                    onFocus={() => setFocusedExpressMethodId(binMethod.id || 'binance_usdt')}
                                    onClick={() => openBinanceQr(binMethod)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            openBinanceQr(binMethod);
                                        }
                                    }}
                                    className="group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer select-none"
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                            <Wallet size={17} strokeWidth={2.2} />
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openBinanceQr(binMethod);
                                                }}
                                                className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[9.5px] font-bold uppercase tracking-wide flex items-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer z-10 shadow-2xs"
                                                title="Ver Código QR de Binance Pay"
                                            >
                                                <QrCode size={11} />
                                                <span>QR</span>
                                            </button>
                                            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                [F6]
                                            </span>
                                        </div>
                                    </div>
                                    <div className="mt-1">
                                        <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">BINANCE PAY</h4>
                                        <p className="text-sm sm:text-base font-black tabular-nums tracking-tight text-slate-900 dark:text-white">
                                            {amountUsdt.toFixed(2)} USDT
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between text-[9.5px] font-medium text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                                        <span>Paridad: <strong className="font-mono text-slate-700 dark:text-slate-300">1 USDT = $1.00</strong></span>
                                        <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[9px] font-bold border border-slate-200 dark:border-slate-700">
                                            1:1 USD
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                );
            })()}

            {/* Smart Tender Pad: Selección Rápida de Billetes con Cálculo de Vuelto en Vivo */}
            <div className="bg-white dark:bg-slate-900 p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        {primaryCurrency === 'EUR' ? <Euro size={15} className="text-slate-700 dark:text-slate-300" /> : <Banknote size={15} className="text-slate-700 dark:text-slate-300" />}
                        <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                            Billetes Frecuentes · Vuelto Rápido {primaryCurrency}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {parseFloat(payments[findMethodKey('cash_usd')?.id]?.amount) > 0 && (
                            <button
                                type="button"
                                onClick={handleResetPayment}
                                className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-colors uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                                title="Limpiar billete seleccionado"
                            >
                                <RefreshCcw size={11} />
                                <span>Restablecer</span>
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-2.5">
                    {/* Botón Exacto */}
                    <button
                        type="button"
                        onClick={() => handleQuickAmount(totalToPayUsd)}
                        className={`p-2.5 sm:p-3 rounded-xl border transition-all text-left shadow-2xs cursor-pointer flex flex-col justify-between min-h-[56px] sm:min-h-[60px] ${
                            Math.abs((parseFloat(payments[findMethodKey('cash_usd')?.id]?.amount) || 0) - totalToPayUsd) < 0.005
                                ? 'bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-400/50 shadow-sm'
                                : 'bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/70 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-black uppercase tracking-wider opacity-85">Monto</span>
                            <span className="text-[9px] font-mono font-black px-1.5 py-0.2 rounded bg-black/10 dark:bg-white/10 uppercase">Exacto</span>
                        </div>
                        <div className="mt-1">
                            <span className="text-sm sm:text-base font-black tracking-tight tabular-nums block">
                                {fmt(totalToPayUsd)}
                            </span>
                            <span className="text-[9.5px] opacity-80 truncate block">Sin cambio</span>
                        </div>
                    </button>

                    {/* Billetes Estándar */}
                    {quickBills.map(amt => {
                        const currentSelected = parseFloat(payments[findMethodKey('cash_usd')?.id]?.amount) === amt;
                        const isExact = Math.abs(amt - totalToPayUsd) < 0.005;
                        const isOver = amt > totalToPayUsd;
                        const isUnder = amt < totalToPayUsd && !isExact;
                        const changeDiff = isOver ? precisionRound(amt - totalToPayUsd, 2) : 0;
                        const underDiff = isUnder ? precisionRound(totalToPayUsd - amt, 2) : 0;

                        return (
                            <button
                                key={amt}
                                type="button"
                                onClick={() => handleQuickAmount(amt)}
                                className={`p-2.5 sm:p-3 rounded-xl border transition-all text-left shadow-2xs cursor-pointer flex flex-col justify-between min-h-[56px] sm:min-h-[60px] ${
                                    currentSelected
                                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white ring-2 ring-emerald-500 shadow-sm'
                                        : isOver
                                            ? 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                                            : 'bg-slate-50/80 dark:bg-slate-850 hover:bg-slate-100 border-slate-200/60 dark:border-slate-750 text-slate-500 opacity-75'
                                }`}
                            >
                                <div className="flex items-baseline justify-between gap-1.5 w-full">
                                    <span className="text-sm sm:text-base font-black tracking-tight">
                                        {primaryCurrency === 'EUR' ? `${amt} €` : `${currencySymbol}${amt.toLocaleString('es-CO')}`}
                                    </span>
                                    {!isSingleLocal && (
                                        <span className="text-[9.5px] font-mono text-slate-400 dark:text-slate-400 tabular-nums shrink-0">
                                            {formatBs(precisionRound(amt * activeExchangeRate, 0))}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1">
                                    {isOver ? (
                                        <span className={`text-[10px] sm:text-[10.5px] font-bold tabular-nums block ${currentSelected ? 'text-emerald-300 dark:text-emerald-700' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                            Vuelto: {fmt(changeDiff)}
                                        </span>
                                    ) : isExact ? (
                                        <span className="text-[10px] sm:text-[10.5px] font-bold text-sky-500 block">Monto Exacto</span>
                                    ) : (
                                        <span className="text-[9.5px] text-slate-400 tabular-nums block">Falta {fmt(underDiff)}</span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </form>
    );
}
