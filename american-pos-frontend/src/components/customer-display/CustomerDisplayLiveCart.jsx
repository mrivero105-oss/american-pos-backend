import {
    Banknote,
    Check,
    CheckCircle2,
    Clock,
    CreditCard,
    Fingerprint,
    Layers,
    Loader2,
    QrCode,
    Send,
    Smartphone,
    User,
    Wallet
} from 'lucide-react';
import { formatBs, formatStock, formatUSD, precisionRound } from '../../utils/format';
import { getImageUrl } from '../../utils/imageUtils';
import { formatIdDisplay, formatPhoneDisplay, getBankNameByCode } from '../../utils/pagoMovilQR';

export default function CustomerDisplayLiveCart({
    cartData,
    checkoutPayment,
    isCheckoutActive,
    checkoutActiveMethod,
    isSplitActive,
    splitList,
    isBinanceActive,
    binanceSettings,
    generatingBinanceQr,
    binanceQrUrl,
    hasPagoMovil,
    pagoMovilMethods,
    selectedMethodId,
    setSelectedMethodId,
    checkoutRightTab,
    setCheckoutRightTab,
    generatingQr,
    qrCodeUrl,
    activeBank,
    activeId,
    activePhone,
    activeSlide,
    playlist,
    displayRate,
    rateFormattedClean,
    isUsdOnly,
    bizSettings,
    itemsListRef,
    tokens
}) {
    const { isSwiss, isTitanium, stagePanelStyle } = tokens;

    return (
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 p-3 sm:p-4 overflow-hidden">
            {/* CINTA CONTABLE DE ARTÍCULOS ESCANEADOS (7 COLUMNAS) */}
            <section className={`lg:col-span-7 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                {/* Placa de Identificación del Cliente / Titular de la Operación */}
                {(() => {
                    const activeCustName = (isCheckoutActive && checkoutPayment?.customerName)
                        ? checkoutPayment.customerName
                        : (cartData.customerName || '');
                    const activeCustDoc = (isCheckoutActive && checkoutPayment?.customerDoc)
                        ? checkoutPayment.customerDoc
                        : (cartData.customerDoc || '');
                    const hasRegisteredCustomer = Boolean(activeCustName && activeCustName.trim() && activeCustName.toLowerCase() !== 'cliente ocasional');

                    return (
                        <div className={`px-4 sm:px-5 py-2.5 border-b flex items-center justify-between gap-3 shrink-0 ${
                            hasRegisteredCustomer
                                ? isTitanium
                                    ? 'bg-blue-950/30 border-[#212834]'
                                    : 'bg-blue-50/70 border-[#D4DCE6]'
                                : isTitanium
                                    ? 'bg-[#0F141C] border-[#212834]'
                                    : 'bg-white border-[#D4DCE6]'
                        }`}>
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-7 h-7 rounded-xs border flex items-center justify-center shrink-0 ${
                                    hasRegisteredCustomer
                                        ? isTitanium
                                            ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                                            : 'bg-blue-600 border-blue-600 text-white'
                                        : isTitanium
                                            ? 'bg-[#18202C] border-[#2B374A] text-[#94A3B8]'
                                            : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]'
                                }`}>
                                    <User size={14} strokeWidth={2.3} />
                                </div>
                                <div className="min-w-0">
                                    <span className={`text-[9.5px] font-mono font-bold uppercase tracking-[0.14em] block leading-none mb-0.5 ${
                                        hasRegisteredCustomer
                                            ? isTitanium ? 'text-blue-400' : 'text-blue-700'
                                            : isTitanium ? 'text-[#8B96A8]' : 'text-[#64748B]'
                                    }`}>
                                        Cliente Titular
                                    </span>
                                    <div className="text-xs sm:text-sm font-extrabold tracking-tight truncate">
                                        {hasRegisteredCustomer ? activeCustName : 'Cliente Ocasional'}
                                    </div>
                                </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-1.5">
                                {hasRegisteredCustomer ? (
                                    <span className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold uppercase border ${
                                        isTitanium
                                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    }`}>
                                        {activeCustDoc ? `DOC: ${activeCustDoc}` : 'REGISTRADO'}
                                    </span>
                                ) : (
                                    <span className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-semibold uppercase border ${
                                        isTitanium
                                            ? 'bg-[#161C26] border-[#263040] text-[#8B96A8]'
                                            : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#64748B]'
                                    }`}>
                                        Consumidor Final
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* Cabecera Tabular de la Hoja Contable */}
                <div className={`px-4 sm:px-5 py-2.5 border-b flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-[0.14em] shrink-0 ${
                    isTitanium
                        ? 'bg-[#121720] border-[#212834] text-[#8B96A8]'
                        : 'bg-[#F8FAFC] border-[#D4DCE6] text-[#5A6577]'
                }`}>
                    <div className="flex items-center gap-2">
                        <span>Detalle de Facturación</span>
                        <span className={`px-1.5 py-0.5 rounded-xs text-[10px] ${
                            isTitanium ? 'bg-[#1D2532] text-white' : 'bg-[#0B0F17] text-white'
                        }`}>
                            {cartData.items.length}
                        </span>
                    </div>
                    <span>Importe</span>
                </div>

                {/* Lista de Líneas con Auto-Scroll */}
                <div
                    ref={itemsListRef}
                    className={`flex-1 overflow-y-auto divide-y custom-scrollbar ${
                        isTitanium ? 'divide-[#1C232E]' : 'divide-[#E2E8F0]'
                    }`}
                >
                    {cartData.items.map((item, idx) => {
                        const isLatest = idx === cartData.items.length - 1;
                        const itemImg = getImageUrl(item.imageUrl);
                        const lineUsd = Number(item.subtotal) || ((Number(item.price) || 0) * (Number(item.quantity) || 0));
                        const lineBs = lineUsd * (cartData.exchangeRate || displayRate || 1);

                        return (
                            <div
                                key={`${item.id || idx}_${idx}`}
                                className={`px-4 sm:px-5 py-3 flex items-center justify-between gap-3 transition-colors relative ${
                                    isLatest
                                        ? isTitanium
                                            ? 'bg-blue-950/25'
                                            : 'bg-blue-50/60'
                                        : ''
                                }`}
                            >
                                {isLatest && (
                                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-600" />
                                )}

                                <div className="flex items-center gap-3 min-w-0">
                                    {/* Índice o Miniatura del Producto */}
                                    {itemImg ? (
                                        <div className="w-10 h-10 rounded-xs bg-white border border-slate-200 p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
                                            <img src={itemImg} alt={item.name} className="w-full h-full object-contain" />
                                        </div>
                                    ) : (
                                        <div className={`w-10 h-10 rounded-xs border flex items-center justify-center font-mono text-xs font-bold shrink-0 ${
                                            isTitanium
                                                ? 'bg-[#141A23] border-[#263040] text-[#94A3B8]'
                                                : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]'
                                        }`}>
                                            {String(idx + 1).padStart(2, '0')}
                                        </div>
                                    )}

                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="text-sm sm:text-[15px] font-bold leading-snug truncate">
                                                {item.name}
                                            </h4>
                                            {item.presentationName && (
                                                <span className={`px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase rounded-xs border ${
                                                    isTitanium
                                                        ? 'bg-[#18202C] border-[#2B374A] text-blue-300'
                                                        : 'bg-slate-100 border-slate-300 text-slate-700'
                                                }`}>
                                                    {item.presentationName}
                                                </span>
                                            )}
                                        </div>
                                        <div className={`text-xs font-mono tabular-nums mt-0.5 flex items-center gap-2 ${
                                            isTitanium ? 'text-[#8B96A8]' : 'text-[#5A6577]'
                                        }`}>
                                            <span className="font-bold">
                                                {formatStock(item.quantity)} und
                                            </span>
                                            <span>×</span>
                                            <span>
                                                {!isUsdOnly
                                                    ? `${formatBs((Number(item.price) || 0) * (cartData.exchangeRate || displayRate || 1))} (${formatUSD(item.price)})`
                                                    : formatUSD(item.price)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="text-right font-mono tabular-nums shrink-0">
                                    {!isUsdOnly ? (
                                        <>
                                            <span className="text-base sm:text-lg font-extrabold block leading-tight">
                                                {formatBs(lineBs)}
                                            </span>
                                            <span className={`text-xs font-semibold block ${
                                                isTitanium ? 'text-[#8B96A8]' : 'text-[#5A6577]'
                                            }`}>
                                                {formatUSD(lineUsd)}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="text-base sm:text-lg font-extrabold block">
                                            {formatUSD(lineUsd)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* CONSOLA FINANCIERA DERECHA: TOTALIZADOR + CANAL DE PAGO ACTIVO / MINI-VITRINA (5 COLUMNAS) */}
            <section className="lg:col-span-5 flex flex-col gap-3 sm:gap-4 overflow-hidden">
                {/* Totalizador Monumental */}
                {(() => {
                    const finalTotalUSD = isCheckoutActive && checkoutPayment.totals?.totalToPayUsd !== undefined
                        ? checkoutPayment.totals.totalToPayUsd
                        : cartData.totalUSD;
                    const finalTotalBs = isCheckoutActive && checkoutPayment.totals?.totalToPayVes !== undefined
                        ? checkoutPayment.totals.totalToPayVes
                        : cartData.totalBs;
                    const hasIgtf = isCheckoutActive && (checkoutPayment.totals?.currentIgtfUsd > 0);
                    const paymentPromo = isCheckoutActive ? checkoutPayment.activePaymentPromo : null;
                    const receivedUsd = isCheckoutActive ? (checkoutPayment.totals?.receivedUsd || 0) : 0;
                    const receivedVes = isCheckoutActive ? (checkoutPayment.totals?.receivedVes || 0) : 0;
                    const changeUsd = isCheckoutActive ? (checkoutPayment.totals?.changeUsd || 0) : 0;
                    const changeBs = isCheckoutActive ? (checkoutPayment.totals?.changeBs || 0) : 0;
                    const remainingUsd = isCheckoutActive ? (checkoutPayment.totals?.remainingUsd || 0) : 0;
                    const remainingBs = isCheckoutActive ? (checkoutPayment.totals?.remainingBs || 0) : 0;
                    const isInsufficient = isCheckoutActive ? checkoutPayment.totals?.isInsufficient : false;

                    return (
                        <div className={`border rounded-md p-5 shrink-0 ${
                            isSwiss
                                ? 'bg-[#090D14] border-[#090D14] text-white'
                                : isTitanium
                                    ? 'bg-[#11161D] border-[#242E3D] text-white'
                                    : 'bg-[#0A0D12] border-[#1E2530] text-white'
                        }`}>
                            {/* Indicadores de Ofertas o Subtotales */}
                            {(cartData.discountUSD > 0 || paymentPromo || hasIgtf) && (
                                <div className="pb-2.5 mb-2.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-300">
                                    {cartData.discountUSD > 0 && (
                                        <span className="text-emerald-400 font-bold">
                                            DESC: -{!isUsdOnly ? formatBs((cartData.discountUSD || 0) * displayRate) : formatUSD(cartData.discountUSD)}
                                        </span>
                                    )}
                                    {paymentPromo && (
                                        <span className="text-amber-400 font-bold flex items-center gap-1">
                                            <span>PROMO {paymentPromo.promoName}:</span>
                                            <span>-{formatUSD(paymentPromo.savings)}</span>
                                        </span>
                                    )}
                                    {hasIgtf && (
                                        <span className="text-sky-400 font-bold">
                                            +3% IGTF: {formatUSD(checkoutPayment.totals.currentIgtfUsd)}
                                        </span>
                                    )}
                                </div>
                            )}

                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10.5px] font-mono font-bold uppercase tracking-[0.16em] text-slate-400 flex items-center gap-1.5">
                                    {isCheckoutActive && checkoutActiveMethod && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    )}
                                    <span>{isCheckoutActive ? 'Total a Percibir' : 'Total a Pagar'}</span>
                                </span>
                                {!isUsdOnly && (
                                    <span className="text-[10.5px] font-mono text-slate-400 tabular-nums">
                                        BCV: Bs {rateFormattedClean}
                                    </span>
                                )}
                            </div>

                            {!isUsdOnly ? (
                                <div className="flex flex-col">
                                    <div className="text-3xl sm:text-5xl font-black font-mono tabular-nums tracking-tight leading-none text-white">
                                        {formatBs(finalTotalBs)}
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between font-mono tabular-nums">
                                        <span className="text-[11px] uppercase tracking-wider text-slate-400">
                                            Equivalente Divisas
                                        </span>
                                        <span className="text-xl sm:text-2xl font-extrabold text-emerald-400">
                                            {formatUSD(finalTotalUSD)}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-4xl sm:text-5xl font-black font-mono tabular-nums tracking-tight leading-none text-white">
                                    {formatUSD(finalTotalUSD)}
                                </div>
                            )}

                            {/* Placa de Abonos Parciales / Vuelto en Tiempo Real */}
                            {isCheckoutActive && (receivedUsd > 0 || isSplitActive) && (
                                <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center justify-between text-xs font-mono tabular-nums">
                                    {isInsufficient ? (
                                        <>
                                            <span className="text-slate-300">
                                                ABONADO: <strong className="text-white">{formatUSD(receivedUsd)}</strong>
                                            </span>
                                            <span className="text-amber-400 font-bold">
                                                RESTANTE: {formatUSD(remainingUsd)} ({formatBs(remainingBs)})
                                            </span>
                                        </>
                                    ) : changeUsd > 0.001 || changeBs > 0.01 ? (
                                        <>
                                            <span className="text-slate-300">
                                                RECIBIDO: <strong className="text-white">{formatUSD(receivedUsd)}</strong>
                                            </span>
                                            <span className="text-emerald-400 font-black text-sm">
                                                SU VUELTO: {formatUSD(changeUsd)} ({formatBs(changeBs)})
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                                                <CheckCircle2 size={13} className="text-emerald-400" />
                                                PAGO CUBIERTO AL 100%
                                            </span>
                                            <span className="text-white font-bold">
                                                ABONADO: {formatUSD(receivedUsd > 0 ? receivedUsd : finalTotalUSD)} ({formatBs(receivedVes > 0 ? receivedVes : finalTotalBs)})
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Panel Inferior: Canal de Cobro Seleccionado por el Cajero o Vitrina */}
                {(() => {
                    // CASO ESPECIAL: PAGO MIXTO / MULTICANAL ACTIVO
                    if (isSplitActive) {
                        const totalUsd = checkoutPayment?.totals?.totalToPayUsd ?? (cartData.totalUSD || 0);
                        const receivedUsdVal = checkoutPayment?.totals?.receivedUsd ?? 0;
                        const remUsd = checkoutPayment?.totals?.remainingUsd ?? 0;
                        const remBs = checkoutPayment?.totals?.remainingBs ?? 0;
                        const chgUsd = checkoutPayment?.totals?.changeUsd ?? 0;
                        const chgBs = checkoutPayment?.totals?.changeBs ?? 0;
                        const isInsuff = checkoutPayment?.totals?.isInsufficient ?? false;
                        const pct = totalUsd > 0
                            ? Math.min(100, Math.max(0, Math.round((receivedUsdVal / totalUsd) * 100)))
                            : (!isInsuff ? 100 : 0);
                        const debitItem = splitList.find(x => x.isDebit);

                        return (
                            <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                {/* Barra Superior Técnica de Pago Mixto */}
                                <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                    isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <Layers size={15} className="text-blue-500" />
                                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                            Pago Mixto · Abonos Multicanal
                                        </span>
                                    </div>

                                    {/* Badge Dinámico de Estado */}
                                    {!isInsuff ? (
                                        chgUsd > 0.001 || chgBs > 0.01 ? (
                                            <span className="px-2.5 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-sky-500/15 text-sky-400 rounded-xs border border-sky-500/30 flex items-center gap-1">
                                                <CheckCircle2 size={11} /> VUELTO: {formatUSD(chgUsd)} ({formatBs(chgBs)})
                                            </span>
                                        ) : (
                                            <span className="px-2.5 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-emerald-500/15 text-emerald-400 rounded-xs border border-emerald-500/30 flex items-center gap-1">
                                                <CheckCircle2 size={11} /> 100% CUBIERTO · SALDADO
                                            </span>
                                        )
                                    ) : (
                                        <span className="px-2.5 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-amber-500/15 text-amber-400 rounded-xs border border-amber-500/30 flex items-center gap-1">
                                            <Clock size={11} /> FALTAN: {formatUSD(remUsd)} ({formatBs(remBs)})
                                        </span>
                                    )}
                                </div>

                                {/* Contenido Modular: Progreso + Desglose de Abonos */}
                                <div className="flex-1 p-3.5 flex flex-col gap-3 overflow-hidden">
                                    {/* Placa de Progreso Tabular */}
                                    <div className={`p-2.5 rounded-xs border shrink-0 ${
                                        isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                    }`}>
                                        <div className="flex items-center justify-between text-[10px] font-mono uppercase mb-1.5 opacity-80">
                                            <span className="flex items-center gap-1.5">
                                                <span className={`w-1.5 h-1.5 rounded-full ${!isInsuff ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                                                <span>Cobertura de la cuenta</span>
                                            </span>
                                            <span className="font-bold tabular-nums">
                                                {pct}% ({splitList.length} {splitList.length === 1 ? 'método abonado' : 'métodos abonados'})
                                            </span>
                                        </div>
                                        <div className="w-full h-2 rounded-full bg-slate-700/30 overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-300 ${
                                                    !isInsuff ? 'bg-emerald-500' : 'bg-amber-500'
                                                }`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Lista de Abonos Ingresados por el Cajero */}
                                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                                        {splitList.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400">
                                                <Layers size={28} className="mb-2 opacity-50 text-blue-400" />
                                                <span className="text-xs font-mono">Esperando abonos en caja...</span>
                                            </div>
                                        ) : (
                                            splitList.map((item, idx) => {
                                                const isDebit = item.isDebit;
                                                const isPM = item.isPagoMovil;
                                                const isBin = item.isBinance;
                                                const isCash = item.isCash;

                                                return (
                                                    <div
                                                        key={item.id || idx}
                                                        className={`p-2.5 rounded-xs border flex items-center justify-between gap-3 transition-colors ${
                                                            isTitanium
                                                                ? 'bg-[#181E29] border-[#2B374A] hover:border-slate-600'
                                                                : 'bg-white border-[#D4DCE6] shadow-xs'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                                                isBin ? 'bg-amber-500/15 text-amber-500' :
                                                                isPM ? 'bg-blue-500/15 text-blue-500' :
                                                                isDebit ? 'bg-sky-500/15 text-sky-400' :
                                                                isCash ? 'bg-emerald-500/15 text-emerald-400' :
                                                                'bg-purple-500/15 text-purple-400'
                                                            }`}>
                                                                {isBin ? <Wallet size={16} /> :
                                                                 isPM ? <Smartphone size={16} /> :
                                                                 isDebit ? <CreditCard size={16} /> :
                                                                 isCash ? <Banknote size={16} /> :
                                                                 <Send size={15} />}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="text-xs font-bold truncate flex items-center gap-1.5">
                                                                    <span>{item.name}</span>
                                                                    <span className="text-[9px] font-mono font-normal opacity-60">
                                                                        [Abono #{idx + 1}]
                                                                    </span>
                                                                </div>
                                                                <div className="text-[10px] font-mono opacity-65 flex items-center gap-2">
                                                                    <span>
                                                                        {item.currency === 'USD'
                                                                            ? `Equiv: ${formatBs(item.equivBs)}`
                                                                            : item.currency === 'USDT'
                                                                            ? `Equiv: ${formatBs(item.equivBs)}`
                                                                            : `Ref: ${formatUSD(item.equivUsd)}`}
                                                                    </span>
                                                                    {item.reference && (
                                                                        <span className="text-emerald-400 font-bold">Ref: {item.reference}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="text-right shrink-0 font-mono">
                                                            <div className="text-sm font-black tabular-nums text-slate-100 dark:text-white">
                                                                {item.currency === 'USD'
                                                                    ? formatUSD(item.amount)
                                                                    : item.currency === 'USDT'
                                                                    ? `${item.amount.toFixed(2)} USDT`
                                                                    : formatBs(item.amount)}
                                                            </div>
                                                            <span className="text-[9px] font-bold text-emerald-400 flex items-center justify-end gap-1">
                                                                <Check size={10} /> Registrado
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    {/* Sub-placa informativa de terminal bancario para Punto de Venta */}
                                    {debitItem && (
                                        <div className={`p-2 rounded-xs border flex items-center justify-between gap-2 text-xs font-mono shrink-0 ${
                                            isTitanium ? 'bg-blue-950/30 border-blue-500/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-900'
                                        }`}>
                                            <span className="flex items-center gap-1.5 text-[10.5px]">
                                                <CreditCard size={14} className="text-blue-400" />
                                                <span>Terminal bancario: Pase o acerque su tarjeta en caja</span>
                                            </span>
                                            <span className="font-black tabular-nums text-blue-400">
                                                {formatBs(debitItem.amount)}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    // SI HAY UN MÉTODO SELECCIONADO POR EL CAJERO EN CHECKOUTMODAL (MODO EXPRESS / INDIVIDUAL)
                    if (isCheckoutActive && checkoutActiveMethod) {
                        const methodId = (checkoutActiveMethod.id || '').toLowerCase();
                        const methodName = (checkoutActiveMethod.name || '').toLowerCase();
                        const methodCurr = (checkoutActiveMethod.currency || '').toUpperCase();

                        // CASO 1: BINANCE PAY (USDT)
                        if (isBinanceActive) {
                            const fallbackUsd = checkoutPayment?.totals?.totalToPayUsd ?? cartData.totalUSD ?? 0;
                            const effectiveAmountBs = checkoutActiveMethod.amountBs || checkoutPayment?.totals?.totalToPayVes || cartData.totalBs;
                            const effectiveUsdt = checkoutActiveMethod.amountUsdt !== undefined && checkoutActiveMethod.amountUsdt !== null
                                ? Number(checkoutActiveMethod.amountUsdt)
                                : precisionRound(fallbackUsd, 2);
                            const payId = checkoutActiveMethod.binancePayId || binanceSettings.payId;
                            const email = checkoutActiveMethod.binanceEmail || binanceSettings.email;

                            return (
                                <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                    <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                        isTitanium ? 'bg-[#151208] border-[#362A14]' : 'bg-[#FFFBEB] border-[#FDE68A]'
                                    }`}>
                                        <div className="flex items-center gap-2">
                                            <Wallet size={15} className="text-amber-500" />
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                                                Binance Pay & Código QR (USDT)
                                            </span>
                                        </div>
                                        <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-xs border border-amber-500/30">
                                            RED BEP-20 / PAY ID
                                        </span>
                                    </div>

                                    <div className="flex-1 p-4 flex flex-col sm:flex-row items-center gap-4 overflow-y-auto">
                                        {/* Marco Blanco de Lectura Óptica QR */}
                                        <div className="p-2.5 bg-white rounded border border-slate-300 shrink-0 flex flex-col items-center shadow-xs">
                                            {generatingBinanceQr ? (
                                                <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-700 gap-2">
                                                    <Loader2 size={22} className="animate-spin text-amber-600" />
                                                    <span className="text-[9px] font-mono font-bold uppercase">Generando QR</span>
                                                </div>
                                            ) : binanceQrUrl ? (
                                                <img
                                                    src={binanceQrUrl}
                                                    alt="Código QR Binance Pay"
                                                    className="w-32 h-32 sm:w-36 sm:h-36 object-contain"
                                                />
                                            ) : (
                                                <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-400 text-center p-2">
                                                    <Wallet size={22} className="text-amber-500 mb-1" />
                                                    <span className="text-[9.5px] font-mono">Use Binance Pay ID</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Placa Técnica Binance Pay */}
                                        <div className="flex-1 w-full space-y-2 text-xs">
                                            {payId && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#181E29] border-[#2B374A]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">Binance Pay ID</span>
                                                    <span className="font-mono font-black text-sm tracking-wide text-amber-500">{payId}</span>
                                                </div>
                                            )}
                                            {email && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#181E29] border-[#2B374A]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">Correo Binance</span>
                                                    <span className="font-mono font-bold truncate max-w-[200px]">{email}</span>
                                                </div>
                                            )}
                                            <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                isTitanium ? 'bg-[#181E29] border-[#2B374A]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                            }`}>
                                                <span className="text-[10px] font-mono uppercase opacity-65">Paridad Cambiaria</span>
                                                <span className="font-mono font-bold tabular-nums">1 USDT = $1.00 USD</span>
                                            </div>

                                            {/* Monto Exacto en USDT */}
                                            <div className={`px-3 py-2 rounded-xs border flex items-center justify-between gap-2 ${
                                                isTitanium
                                                    ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                                                    : 'bg-amber-50 border-amber-300 text-amber-950'
                                            }`}>
                                                <div>
                                                    <span className="text-[10px] font-mono font-bold uppercase block">Total a Transferir</span>
                                                    <span className="text-[10px] font-mono opacity-70">
                                                        Equiv: {formatBs(effectiveAmountBs)}
                                                    </span>
                                                </div>
                                                <span className="font-mono font-black text-base sm:text-lg tabular-nums text-amber-600 dark:text-amber-400">
                                                    {effectiveUsdt.toFixed(2)} USDT
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // CASO 2: PAGO MÓVIL
                        const isPM = checkoutActiveMethod.isPagoMovil || methodId.includes('movil') || methodName.includes('móvil') || Boolean(checkoutActiveMethod.pagoMovilPhone || checkoutActiveMethod.pagoMovilId);
                        if (isPM) {
                            const pmBank = checkoutActiveMethod.pagoMovilBank || activeBank;
                            const pmPhone = checkoutActiveMethod.pagoMovilPhone || activePhone;
                            const pmId = checkoutActiveMethod.pagoMovilId || activeId;
                            const pmAmountBs = checkoutActiveMethod.amountBs || cartData.totalBs;

                            return (
                                <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                    <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                        isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                    }`}>
                                        <div className="flex items-center gap-2">
                                            <QrCode size={15} className="text-blue-600 dark:text-blue-400" />
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                Pago Móvil Directo
                                            </span>
                                        </div>
                                        <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600/15 text-blue-600 dark:text-blue-400 rounded-xs border border-blue-600/30">
                                            BANCA NACIONAL
                                        </span>
                                    </div>

                                    <div className="flex-1 p-4 flex flex-col sm:flex-row items-center gap-4 overflow-y-auto">
                                        <div className="p-2.5 bg-white rounded border border-slate-300 shrink-0 flex flex-col items-center">
                                            {generatingQr ? (
                                                <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-700 gap-2">
                                                    <Loader2 size={22} className="animate-spin" />
                                                    <span className="text-[9px] font-mono font-bold uppercase">Generando</span>
                                                </div>
                                            ) : qrCodeUrl ? (
                                                <img
                                                    src={qrCodeUrl}
                                                    alt="QR Pago Móvil"
                                                    className="w-32 h-32 sm:w-36 sm:h-36 object-contain"
                                                />
                                            ) : (
                                                <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-400 text-center p-2">
                                                    <Smartphone size={22} />
                                                    <span className="text-[9px] font-mono mt-1">Datos incompletos</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 w-full space-y-2 text-xs">
                                            {pmBank && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">Banco</span>
                                                    <span className="font-bold text-right truncate">{getBankNameByCode(pmBank)}</span>
                                                </div>
                                            )}
                                            {pmId && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">RIF / C.I.</span>
                                                    <span className="font-mono font-bold tabular-nums">{formatIdDisplay(pmId)}</span>
                                                </div>
                                            )}
                                            {pmPhone && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">Teléfono</span>
                                                    <span className="font-mono font-bold tabular-nums">{formatPhoneDisplay(pmPhone)}</span>
                                                </div>
                                            )}
                                            <div className={`px-3 py-2 rounded-xs border flex items-center justify-between gap-2 ${
                                                isTitanium
                                                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                                                    : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                            }`}>
                                                <span className="text-[10px] font-mono font-bold uppercase">Monto Exacto</span>
                                                <span className="font-mono font-black text-sm tabular-nums">
                                                    {formatBs(pmAmountBs)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // CASO 3: PUNTO DE VENTA / DÉBITO
                        if (methodId.includes('debit') || methodId.includes('punto') || methodName.includes('punto') || methodName.includes('débito')) {
                            const amountBs = checkoutActiveMethod.appliedAmount ? Number(checkoutActiveMethod.appliedAmount) : cartData.totalBs;
                            return (
                                <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                    <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                        isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                    }`}>
                                        <div className="flex items-center gap-2">
                                            <CreditCard size={15} className="text-blue-500" />
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                Punto de Venta · Tarjeta de Débito
                                            </span>
                                        </div>
                                        <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600/15 text-blue-600 dark:text-blue-400 rounded-xs border border-blue-600/30">
                                            TERMINAL BDV / BANCARIO
                                        </span>
                                    </div>

                                    <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                        <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                            <CreditCard size={32} strokeWidth={2} />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                Acerque o inserte su tarjeta
                                            </h3>
                                            <p className="text-xs opacity-70 max-w-xs font-mono">
                                                Presente su tarjeta de débito en el terminal de punto de venta en caja.
                                            </p>
                                        </div>
                                        <div className="mt-2 px-5 py-2.5 bg-blue-500/10 border border-blue-500/30 rounded-md font-mono">
                                            <span className="text-[10px] uppercase opacity-70 block">Monto a procesar</span>
                                            <span className="text-xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                                                {formatBs(amountBs)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // CASO 4: BIOPAGO BDV
                        if (methodId.includes('biopago') || methodName.includes('biopago') || methodName.includes('huella')) {
                            return (
                                <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                    <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                        isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                    }`}>
                                        <div className="flex items-center gap-2">
                                            <Fingerprint size={15} className="text-emerald-500" />
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                Biopago BDV · Huella Dactilar
                                            </span>
                                        </div>
                                        <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 rounded-xs border border-emerald-600/30">
                                            BIOMÉTRICO
                                        </span>
                                    </div>

                                    <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                            <Fingerprint size={34} strokeWidth={2} />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                Coloque su huella en el sensor
                                            </h3>
                                            <p className="text-xs opacity-70 max-w-xs font-mono">
                                                Autenticación biométrica rápida sin necesidad de tarjeta plástica.
                                            </p>
                                        </div>
                                        <div className="mt-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-md font-mono">
                                            <span className="text-[10px] uppercase opacity-70 block">Monto a autorizar</span>
                                            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                {formatBs(cartData.totalBs)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // CASO 5: EFECTIVO ($ O BS)
                        if (checkoutActiveMethod.isCash || methodId.includes('cash') || methodName.includes('efectivo')) {
                            const isCashUsd = methodCurr === 'USD' || methodId.includes('usd');
                            return (
                                <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                    <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                        isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                    }`}>
                                        <div className="flex items-center gap-2">
                                            <Banknote size={15} className="text-emerald-500" />
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                {isCashUsd ? 'Efectivo en Divisas (USD)' : 'Efectivo en Bolívares (VES)'}
                                            </span>
                                        </div>
                                        <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 rounded-xs border border-emerald-600/30">
                                            PAGO FÍSICO
                                        </span>
                                    </div>

                                    <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                            <Banknote size={34} strokeWidth={2} />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                Entrega en ventanilla de caja
                                            </h3>
                                            <p className="text-xs opacity-70 max-w-xs font-mono">
                                                {isCashUsd ? 'Se reciben billetes en buen estado.' : 'Verificación y conteo en caja.'}
                                            </p>
                                        </div>
                                        <div className="mt-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-md font-mono">
                                            <span className="text-[10px] uppercase opacity-70 block">Monto a cancelar</span>
                                            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                {isCashUsd ? formatUSD(cartData.totalUSD) : formatBs(cartData.totalBs)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // CASO 6: ZELLE / TRANSFERENCIA
                        if (methodId.includes('zelle') || methodId.includes('transfer')) {
                            return (
                                <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                    <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                        isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                    }`}>
                                        <div className="flex items-center gap-2">
                                            <Send size={15} className="text-purple-500" />
                                            <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                Transferencia / Zelle
                                            </span>
                                        </div>
                                        <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-purple-600/15 text-purple-600 dark:text-purple-400 rounded-xs border border-purple-600/30">
                                            ELECTRÓNICO
                                        </span>
                                    </div>

                                    <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                        <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                                            <Send size={30} strokeWidth={2} />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                Transferencia directa
                                            </h3>
                                            <p className="text-xs opacity-70 max-w-xs font-mono">
                                                Muestre su comprobante al cajero para registrar el número de confirmación.
                                            </p>
                                        </div>
                                        <div className="mt-2 px-5 py-2.5 bg-purple-500/10 border border-purple-500/30 rounded-md font-mono">
                                            <span className="text-[10px] uppercase opacity-70 block">Monto a transferir</span>
                                            <span className="text-xl font-black text-purple-600 dark:text-purple-400 tabular-nums">
                                                {methodCurr === 'USD' ? formatUSD(cartData.totalUSD) : formatBs(cartData.totalBs)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // CASO GENÉRICO
                        return (
                            <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                    isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <Layers size={15} className="text-blue-500" />
                                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                            {checkoutActiveMethod.name || 'Canal de Pago'}
                                        </span>
                                    </div>
                                    <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600/15 text-blue-600 dark:text-blue-400 rounded-xs border border-blue-600/30">
                                        SELECCIONADO EN CAJA
                                    </span>
                                </div>

                                <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                    <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                        <Layers size={32} strokeWidth={2} />
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-base font-extrabold uppercase tracking-tight">
                                            {checkoutActiveMethod.name}
                                        </h3>
                                        <p className="text-xs opacity-70 max-w-xs font-mono">
                                            Canal de pago activado en la estación del operador.
                                        </p>
                                    </div>
                                    <div className="mt-2 px-5 py-2.5 bg-blue-500/10 border border-blue-500/30 rounded-md font-mono">
                                        <span className="text-[10px] uppercase opacity-70 block">Total a percibir</span>
                                        <span className="text-xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                                            {formatBs(cartData.totalBs)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    // VISTA POR DEFECTO: SI NO HAY CHECKOUT ACTIVO, MOSTRAR PAGO MÓVIL DIRECTO O VITRINA
                    if (hasPagoMovil) {
                        return (
                            <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                {/* Barra de cabecera Pago Móvil + Selector de cuentas o Vitrina */}
                                <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                    isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <QrCode size={15} className="text-blue-600 dark:text-blue-400" />
                                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                            {checkoutRightTab === 'qr' ? 'Pago Móvil Directo' : 'Oferta Destacada'}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {pagoMovilMethods.length > 1 && checkoutRightTab === 'qr' && (
                                            <div className="flex items-center gap-1 mr-1">
                                                {pagoMovilMethods.map(m => (
                                                    <button
                                                        key={m.id}
                                                        type="button"
                                                        onClick={() => setSelectedMethodId(m.id)}
                                                        className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-xs border cursor-pointer ${
                                                            selectedMethodId === m.id
                                                                ? 'bg-blue-600 text-white border-blue-600'
                                                                : isTitanium
                                                                    ? 'border-[#263040] text-slate-400'
                                                                    : 'border-slate-300 text-slate-600 bg-white'
                                                        }`}
                                                    >
                                                        {m.name || 'PM'}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {playlist.length > 0 && (
                                            <div className={`flex items-center p-0.5 rounded-xs border text-[10px] font-mono font-bold ${
                                                isTitanium ? 'border-[#263040] bg-[#0B0E13]' : 'border-slate-300 bg-white'
                                            }`}>
                                                <button
                                                    type="button"
                                                    onClick={() => setCheckoutRightTab('qr')}
                                                    className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                                                        checkoutRightTab === 'qr' ? 'bg-blue-600 text-white' : 'opacity-65'
                                                    }`}
                                                >
                                                    QR
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setCheckoutRightTab('promo')}
                                                    className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                                                        checkoutRightTab === 'promo' ? 'bg-blue-600 text-white' : 'opacity-65'
                                                    }`}
                                                >
                                                    INFO
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {checkoutRightTab === 'qr' ? (
                                    <div className="flex-1 p-4 flex flex-col sm:flex-row items-center gap-4 overflow-y-auto">
                                        {/* Marco Blanco Puro de Lectura Óptica QR */}
                                        <div className="p-2.5 bg-white rounded border border-slate-300 shrink-0 flex flex-col items-center">
                                            {generatingQr ? (
                                                <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-700 gap-2">
                                                    <Loader2 size={22} className="animate-spin" />
                                                    <span className="text-[9px] font-mono font-bold uppercase">Generando</span>
                                                </div>
                                            ) : qrCodeUrl ? (
                                                <img
                                                    src={qrCodeUrl}
                                                    alt="QR Pago Móvil"
                                                    className="w-32 h-32 sm:w-36 sm:h-36 object-contain"
                                                />
                                            ) : (
                                                <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-400 text-center p-2">
                                                    <Smartphone size={22} />
                                                    <span className="text-[9px] font-mono mt-1">Datos incompletos</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Datos Bancarios Tabulares */}
                                        <div className="flex-1 w-full space-y-2 text-xs">
                                            {activeBank && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">Banco</span>
                                                    <span className="font-bold text-right truncate">{getBankNameByCode(activeBank)}</span>
                                                </div>
                                            )}
                                            {activeId && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">RIF / C.I.</span>
                                                    <span className="font-mono font-bold tabular-nums">{formatIdDisplay(activeId)}</span>
                                                </div>
                                            )}
                                            {activePhone && (
                                                <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                    isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                }`}>
                                                    <span className="text-[10px] font-mono uppercase opacity-65">Teléfono</span>
                                                    <span className="font-mono font-bold tabular-nums">{formatPhoneDisplay(activePhone)}</span>
                                                </div>
                                            )}
                                            <div className={`px-3 py-2 rounded-xs border flex items-center justify-between gap-2 ${
                                                isTitanium
                                                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                                                    : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                            }`}>
                                                <span className="text-[10px] font-mono font-bold uppercase">Monto Exacto</span>
                                                <span className="font-mono font-black text-sm tabular-nums">
                                                    {formatBs(cartData.totalBs)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : activeSlide ? (
                                    <div className="flex-1 p-4 flex items-center gap-4 overflow-hidden">
                                        {activeSlide.imageUrl && (
                                            <div className="w-24 h-24 rounded bg-white border border-slate-200 p-1 shrink-0 flex items-center justify-center overflow-hidden">
                                                <img src={activeSlide.imageUrl} alt={activeSlide.title} className="w-full h-full object-contain" />
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            {activeSlide.badge && (
                                                <span className="inline-block px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600 text-white rounded-xs mb-1">
                                                    {activeSlide.badge}
                                                </span>
                                            )}
                                            <h4 className="text-sm font-extrabold truncate">{activeSlide.title || bizSettings.name}</h4>
                                            {activeSlide.priceUSD !== null && activeSlide.priceUSD > 0 && (
                                                <div className="mt-1 font-mono font-black text-base tabular-nums">
                                                    {formatBs(activeSlide.priceUSD * displayRate)}{' '}
                                                    <span className="text-xs font-semibold opacity-65">({formatUSD(activeSlide.priceUSD)})</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    }

                    if (activeSlide) {
                        return (
                            <div className={`flex-1 border rounded-md p-4 flex items-center gap-4 overflow-hidden ${stagePanelStyle}`}>
                                {activeSlide.imageUrl && (
                                    <div className="w-28 h-28 rounded bg-white border border-slate-200 p-1.5 shrink-0 flex items-center justify-center overflow-hidden">
                                        <img src={activeSlide.imageUrl} alt={activeSlide.title} className="w-full h-full object-contain" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1 space-y-1">
                                    <span className="inline-block px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600 text-white rounded-xs">
                                        {activeSlide.badge || 'DESTACADO'}
                                    </span>
                                    <h4 className="text-base font-extrabold line-clamp-2">{activeSlide.title || bizSettings.name}</h4>
                                    {activeSlide.subtitle && (
                                        <p className="text-xs opacity-70 line-clamp-2">{activeSlide.subtitle}</p>
                                    )}
                                    {activeSlide.priceUSD !== null && activeSlide.priceUSD > 0 && (
                                        <div className="pt-1 font-mono font-black text-lg tabular-nums">
                                            {!isUsdOnly ? formatBs(activeSlide.priceUSD * displayRate) : formatUSD(activeSlide.priceUSD)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    return null;
                })()}
            </section>
        </main>
    );
}
