import {
    Banknote,
    Coins,
    CreditCard,
    DollarSign,
    Euro,
    Fingerprint,
    QrCode,
    Send,
    User,
    Wallet,
    X,
    Zap
} from 'lucide-react';
import { formatBs, formatUSD, precisionRound } from '../../utils/format';
import { cleanMethodName } from './checkoutUtils';

function DynamicPaymentIcon({ name, size = 20, className = '' }) {
    const icons = { Banknote, CreditCard, User, Send, DollarSign, Euro, X, Wallet, Fingerprint, QrCode, Coins };
    const IconComp = icons[name] || (name === 'Fingerprint' ? Fingerprint : CreditCard);
    return <IconComp size={size} className={className} />;
}

export default function CheckoutSplitView({
    handleSubmit,
    isMaximized,
    methods,
    isUsdOnly,
    isSingle,
    primaryCurrency = 'USD',
    activeExchangeRate = 1,
    activeEuroRate = 0,
    payments,
    getMethodPromo,
    getEffectiveBinanceRate,
    selectedIndex,
    setSelectedIndex,
    handleAmountChange,
    handleFlashFill,
    remainingBs,
    remainingUsd,
    isInsufficient,
    openBinanceQr,
    openPagoMovilQr,
    paymentReferences,
    setPaymentReferences
}) {
    return (
        <form id="checkout-form" onSubmit={handleSubmit} className={`grid grid-cols-1 md:grid-cols-2 ${isMaximized ? 'xl:grid-cols-3' : ''} gap-2.5 sm:gap-3`}>
            {Array.isArray(methods) && methods.filter(method => {
                if (isSingle || isUsdOnly) {
                    const idLower = (method.id || '').toLowerCase();
                    const nameLower = (method.name || '').toLowerCase();
                    const curr = (method.currency || method.defaultCurrency || '').toUpperCase();
                    if (curr === 'VES' || curr === 'BS') return false;
                    if (['cash_bs', 'efectivo_bs', 'pago_movil', 'biopago'].includes(idLower)) return false;
                    if (nameLower.includes(' bs') || nameLower.includes('ves') || nameLower.includes('pago móvil') || nameLower.includes('pago movil') || nameLower.includes('biopago')) return false;
                    if (primaryCurrency !== 'EUR' && (idLower === 'cash_eur' || curr === 'EUR')) return false;
                }
                return true;
            }).map((method, index) => {
                const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(method.id.toLowerCase()) || method.id.toLowerCase().includes('bs') || method.id.toLowerCase().includes('ves') || method.id.toLowerCase().includes('movil'));
                const defaultCurrency = isSingle ? primaryCurrency : (method.currency || method.defaultCurrency || (isVesKey ? 'VES' : 'USD'));
                const payment = payments[method.id] || { amount: '', currency: defaultCurrency };
                const hasAmount = parseFloat(payment.amount) > 0;
                const cleanName = cleanMethodName(method.name);
                const methodPromo = getMethodPromo(method.id, cleanName);
                const isBinanceCard = !isSingle && (payment.currency === 'USDT' || (method.id || '').toLowerCase().includes('binance') || (method.name || '').toLowerCase().includes('binance'));
                const isForeignEurCard = !isSingle && (payment.currency === 'EUR' || (method.id || '').toLowerCase() === 'cash_eur');
                const cardBinRate = isBinanceCard ? getEffectiveBinanceRate(method.id, payment.cryptoRate) : 0;
                const cardEquivBs = isBinanceCard && hasAmount
                    ? (payment.coveredBs && Math.abs(parseFloat(payment.amount) - precisionRound(Number(payment.coveredBs) / cardBinRate, 2)) < 0.001
                        ? Number(payment.coveredBs)
                        : precisionRound(parseFloat(payment.amount) * cardBinRate, 2))
                    : 0;
                const eurEquivBs = isForeignEurCard && hasAmount && activeEuroRate > 0
                    ? precisionRound(parseFloat(payment.amount) * activeEuroRate, 2)
                    : 0;
                const eurEquivUsd = isForeignEurCard && eurEquivBs > 0 && activeExchangeRate > 0
                    ? precisionRound(eurEquivBs / activeExchangeRate, 2)
                    : 0;

                return (
                    <div
                        key={method.id}
                        className={`group relative bg-white dark:bg-slate-800 rounded-xl border transition-all p-3 sm:p-3.5 shadow-2xs ${index === selectedIndex
                            ? 'border-sky-500 ring-2 ring-sky-500/30 z-10'
                            : methodPromo
                                ? 'border-amber-400/80 dark:border-amber-500/50 hover:border-amber-500'
                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                            } ${hasAmount ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-500/70 dark:border-emerald-600/70' : ''}`}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
                                <div className={`shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-colors ${hasAmount ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-600/60'}`}>
                                    <DynamicPaymentIcon name={method.icon} size={18} />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <h3 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100 uppercase tracking-tight truncate" title={cleanName}>
                                        {cleanName}
                                    </h3>
                                    <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded uppercase tracking-wider ${
                                            payment.currency === 'VES'
                                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/60'
                                                : isBinanceCard
                                                    ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/60'
                                                    : payment.currency === 'EUR'
                                                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60'
                                                        : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 border border-sky-200/70 dark:border-sky-800/60'
                                        }`}>
                                            {payment.currency}
                                        </span>
                                        {isBinanceCard && (
                                            <span className="text-[9.5px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                                                {hasAmount ? `≈ ${formatBs(cardEquivBs)} (1:1 USD)` : 'Paridad 1:1 USD'}
                                            </span>
                                        )}
                                        {isForeignEurCard && (
                                            <span className="text-[9.5px] font-mono font-semibold text-indigo-600 dark:text-indigo-300">
                                                {activeEuroRate > 0
                                                    ? (hasAmount
                                                        ? `≈ ${formatBs(eurEquivBs)} (${formatUSD(eurEquivUsd)})`
                                                        : `BCV €: ${activeEuroRate.toFixed(2)} Bs`)
                                                    : 'Configura tasa € BCV'}
                                            </span>
                                        )}
                                        {methodPromo && (
                                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 tabular-nums">
                                                -{methodPromo.discountPercentage}% (-${methodPromo.savings.toFixed(2)})
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                                <div className="relative">
                                    <input
                                        id={`payment-amount-${method.id}`}
                                        type="text"
                                        inputMode="decimal"
                                        step="any"
                                        value={payment.amount}
                                        onChange={(e) => handleAmountChange(method.id, e.target.value, payment.currency)}
                                        onFocus={() => setSelectedIndex(index)}
                                        placeholder="0.00"
                                        className="w-28 sm:w-32 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-right font-mono font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all text-sm shadow-2xs"
                                    />
                                </div>

                                <button
                                    type="button"
                                    id={`flash-fill-${method.id}`}
                                    onClick={() => handleFlashFill(method.id, method.type, remainingBs, remainingUsd)}
                                    disabled={!isInsufficient}
                                    className={`min-w-[36px] min-h-[36px] p-2 rounded-lg border transition-all flex items-center justify-center cursor-pointer ${isInsufficient
                                        ? 'border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 active:scale-95'
                                        : 'border-slate-200/50 dark:border-slate-800 text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-850 cursor-not-allowed'}`}
                                    title="Auto-liquidar restante"
                                    aria-label="Liquidar Restante"
                                >
                                    <Zap size={16} fill="currentColor" />
                                </button>

                                {/* Botón QR en Fila Mixta si es Binance Pay */}
                                {isBinanceCard && (
                                    <button
                                        type="button"
                                        onClick={() => openBinanceQr(method)}
                                        className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800 transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-2xs"
                                        title="Mostrar Código QR de Binance Pay"
                                        aria-label="Ver Código QR Binance"
                                    >
                                        <QrCode size={16} />
                                    </button>
                                )}

                                {/* Botón QR en Fila Mixta si es método VES o Pago Móvil */}
                                {!isUsdOnly && !isBinanceCard && (
                                    payment.currency === 'VES' ||
                                    (method.id || '').toLowerCase().includes('movil') ||
                                    (method.name || '').toLowerCase().includes('movil') ||
                                    method.pagoMovilPhone ||
                                    method.pagoMovilId
                                ) && (
                                    <button
                                        type="button"
                                        onClick={() => openPagoMovilQr(method)}
                                        className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-2xs"
                                        title="Mostrar Código QR y Datos Bancarios"
                                        aria-label="Ver Código QR"
                                    >
                                        <QrCode size={16} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {(() => {
                            const mIdLower = (method.id || '').toLowerCase();
                            const mNameLower = (method.name || '').toLowerCase();
                            const needsRef = Boolean(
                                method.requiresReference ||
                                isBinanceCard ||
                                mIdLower.includes('movil') ||
                                mIdLower.includes('zelle') ||
                                mIdLower.includes('transfer') ||
                                mNameLower.includes('móvil') ||
                                mNameLower.includes('movil') ||
                                mNameLower.includes('zelle') ||
                                mNameLower.includes('transfer')
                            );
                            const currentRef = (paymentReferences[method.id] || payment.reference || '').trim();
                            if (!needsRef || !hasAmount) return null;
                            return (
                                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                                    <input
                                        id={`payment-reference-${method.id}`}
                                        type="text"
                                        required
                                        value={paymentReferences[method.id] ?? payment.reference ?? ''}
                                        onChange={(e) => setPaymentReferences(prev => ({ ...prev, [method.id]: e.target.value }))}
                                        placeholder={isBinanceCard ? 'Nº Order ID / Referencia Binance (Obligatorio) *' : 'Nº de Referencia / Comprobante (Obligatorio) *'}
                                        className={`w-full bg-slate-50 dark:bg-slate-900 border ${!currentRef ? 'border-amber-400 dark:border-amber-500/70' : 'border-emerald-400 dark:border-emerald-500/70'} rounded-lg px-3 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-sky-500 transition-colors`}
                                    />
                                </div>
                            );
                        })()}
                    </div>
                );
            })}
        </form>
    );
}
