import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { Banknote, CreditCard, RefreshCw, FileText, Share2, UserCheck, AlertTriangle, X, CheckCircle, Zap } from 'lucide-react';
import { useMobileKeyboardViewport, handleMobileFormEnterAdvance } from '../../hooks/useMobileKeyboardViewport';
import VortexMathEngine from '../../utils/VortexMathEngine';

export default function MobileCheckoutModal({
  isOpen,
  onClose,
  T,
  isLight = false,
  documentType,
  setDocumentType,
  totalUSD,
  baseTotalUSD = null,
  totalBS,
  taxUSD,
  taxLabel = 'IVA',
  effectiveIvaRate = 16,
  isIvaEnabled = true,
  currentIgtfUSD = 0,
  igtfRate = 3,
  isIgtfEnabled = false,
  exchangeRate,
  customerDoc,
  setCustomerDoc,
  customerName,
  setCustomerName,
  onOpenCustomerSelect,
  isProcessingSale,
  handleSaveQuotation,
  checkoutMode,
  setCheckoutMode,
  selectedMethod,
  handleSelectPaymentMethod,
  cashAccumulateMode,
  setCashAccumulateMode,
  amountPaidUSD,
  setAmountPaidUSD,
  amountPaidBS,
  setAmountPaidBS,
  totalPaidInUSD,
  paidUSD,
  paidBS,
  changeUSD,
  changeBS,
  isDollarCountry,
  splitPayments,
  setSplitPayments,
  splitPaidUSD,
  splitRemainingUSD,
  splitChangeUSD,
  splitChangeBS = 0,
  businessInfo,
  paymentReference,
  setPaymentReference,
  handleConfirmSale,
  triggerHaptic = () => {},
  playScanSound = () => {}
}) {
  const dragControls = useDragControls();
  const paymentReferenceInputRef = useRef(null);
  const prevMethodRef = useRef(selectedMethod);
  const {
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    scrollFieldIntoView,
    handleFieldFocusCapture
  } = useMobileKeyboardViewport({ enabled: isOpen });

  const round2 = (v) => VortexMathEngine.round(v, 2);
  const principalUSD = baseTotalUSD !== null && baseTotalUSD !== undefined ? Number(baseTotalUSD) : Number(totalUSD || 0);
  const effectiveRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;
  const binanceRate = Number(businessInfo?.binanceRate ?? businessInfo?.taxConfig?.binanceRate ?? 0) || effectiveRate;
  const euroRate = Number(businessInfo?.euroRate ?? businessInfo?.taxConfig?.euroRate ?? 0);
  const hasEuroRate = !isDollarCountry && euroRate > 0;
  const effectiveChangeUSD = checkoutMode === 'split' ? splitChangeUSD : changeUSD;
  const effectiveChangeBS = checkoutMode === 'split' ? (splitChangeBS || round2(VortexMathEngine.multiply(splitChangeUSD, effectiveRate))) : changeBS;
  const igtfFactor = (isIgtfEnabled && Number(igtfRate) > 0) ? VortexMathEngine.add([1, VortexMathEngine.divide(Number(igtfRate), 100)]) : 1;
  const isBinanceIgtfActive = Boolean(businessInfo?.binanceIgtfEnabled ?? businessInfo?.taxConfig?.binanceIgtfEnabled);
  const selectedMethodNorm = String(selectedMethod || '').toLowerCase();
  const isCashOrMixedExpress = checkoutMode === 'express' && (
    selectedMethodNorm.includes('efectivo') ||
    selectedMethodNorm.includes('mixto') ||
    selectedMethodNorm === ''
  );
  const isEuroExpress = checkoutMode === 'express' && (selectedMethodNorm.includes('eur'));
  const isBinanceExpress = checkoutMode === 'express' && selectedMethodNorm.includes('binance');
  const exactUsdTarget = (() => {
    const isExemptUsd = selectedMethodNorm.includes('zelle') || selectedMethodNorm.includes('crédito') || selectedMethodNorm.includes('credito') || selectedMethodNorm.includes('fiado')
      || (selectedMethodNorm.includes('binance') && !isBinanceIgtfActive);
    return (!isExemptUsd && igtfFactor > 1) ? round2(VortexMathEngine.multiply(principalUSD, igtfFactor)) : round2(principalUSD);
  })();
  const exactUsdtTarget = (!isDollarCountry && binanceRate > 0 && Math.abs(binanceRate - effectiveRate) > 0.0001)
    ? round2(VortexMathEngine.divide(VortexMathEngine.multiply(exactUsdTarget, effectiveRate), binanceRate))
    : exactUsdTarget;
  const exactEurTarget = hasEuroRate
    ? round2(VortexMathEngine.divide(VortexMathEngine.multiply(exactUsdTarget, effectiveRate), euroRate))
    : exactUsdTarget;

  const hasCreditTender = checkoutMode === 'express'
    ? (selectedMethodNorm.includes('crédito') || selectedMethodNorm.includes('credito') || selectedMethodNorm.includes('fiado'))
    : (parseFloat(splitPayments.credito) || 0) > 0;
  const hasValidCustomerForCredit = Boolean(
    customerName &&
    String(customerName).trim() !== '' &&
    String(customerName).trim().toLowerCase() !== 'consumidor final' &&
    String(customerName).trim().toLowerCase() !== 'cliente ocasional'
  );
  const isMissingCreditCustomer = hasCreditTender && !hasValidCustomerForCredit;

  const splitRefs = (splitPayments && typeof splitPayments.refs === 'object' && splitPayments.refs) ? splitPayments.refs : {};
  const activeElectronicSplitMethods = checkoutMode === 'split'
    ? [
        { key: 'pago_movil', label: 'Pago Móvil', amt: parseFloat(splitPayments.pago_movil) || 0 },
        { key: 'tarjeta', label: 'Tarjeta / Punto', amt: parseFloat(splitPayments.tarjeta) || 0 },
        { key: 'zelle', label: 'Zelle', amt: parseFloat(splitPayments.zelle) || 0 },
        { key: 'binance', label: 'Binance USDT', amt: parseFloat(splitPayments.binance) || 0 }
      ].filter((e) => e.amt > 0)
    : [];
  const isRefRequired = checkoutMode === 'express'
    ? ['pago móvil', 'pago movil', 'tarjeta', 'punto de venta', 'zelle', 'transferencia', 'biopago', 'binance'].some(m => selectedMethodNorm.includes(m))
    : activeElectronicSplitMethods.length > 0;
  const isMissingRequiredRef = checkoutMode === 'express'
    ? (isRefRequired && !String(paymentReference || '').trim())
    : activeElectronicSplitMethods.some((e) => !String(splitRefs[e.key] || paymentReference || '').trim());
  const canSubmitSale = !isProcessingSale &&
    !(checkoutMode === 'split' && splitRemainingUSD > 0.01) &&
    !isMissingRequiredRef &&
    !isMissingCreditCustomer;

  // Al cambiar a un método electrónico en modo Express, hacer scroll y foco automático al N° de Referencia obligatorio
  useEffect(() => {
    const methodChanged = prevMethodRef.current !== selectedMethod;
    prevMethodRef.current = selectedMethod;
    if (!isOpen || documentType === 'cotizacion') return;
    if (checkoutMode === 'express' && isRefRequired && !String(paymentReference || '').trim() && methodChanged) {
      const el = paymentReferenceInputRef.current;
      if (el) {
        setTimeout(() => {
          el.focus();
          scrollFieldIntoView(el, 80);
        }, 120);
      }
    }
  }, [isOpen, documentType, checkoutMode, selectedMethod, isRefRequired, paymentReference, scrollFieldIntoView]);

  const handleFillSplitRemaining = (fieldKey, isBolivares = false) => {
    if (splitRemainingUSD <= 0.005) return;
    triggerHaptic(12);
    playScanSound();
    if (isBolivares) {
      const addBs = round2(VortexMathEngine.multiply(splitRemainingUSD, effectiveRate));
      setSplitPayments((p) => ({
        ...p,
        [fieldKey]: round2(VortexMathEngine.add([parseFloat(p[fieldKey]) || 0, addBs])).toFixed(2)
      }));
      return;
    }
    const appliesIgtf = igtfFactor > 1 && (fieldKey === 'cash_usd' || fieldKey === 'cash_eur' || (fieldKey === 'binance' && isBinanceIgtfActive));
    const usdTarget = appliesIgtf ? round2(VortexMathEngine.multiply(splitRemainingUSD, igtfFactor)) : round2(splitRemainingUSD);
    let addNative = usdTarget;
    if (fieldKey === 'cash_eur' && hasEuroRate) {
      addNative = round2(VortexMathEngine.divide(VortexMathEngine.multiply(usdTarget, effectiveRate), euroRate));
    } else if (fieldKey === 'binance' && !isDollarCountry && binanceRate > 0 && Math.abs(binanceRate - effectiveRate) > 0.0001) {
      addNative = round2(VortexMathEngine.divide(VortexMathEngine.multiply(usdTarget, effectiveRate), binanceRate));
    }
    setSplitPayments((p) => ({
      ...p,
      [fieldKey]: round2(VortexMathEngine.add([parseFloat(p[fieldKey]) || 0, addNative])).toFixed(2)
    }));
  };

  const handleClearSplitPayments = () => {
    triggerHaptic(10);
    setSplitPayments({
      cash_usd: '',
      cash_eur: '',
      cash_bs: '',
      pago_movil: '',
      tarjeta: '',
      zelle: '',
      binance: '',
      credito: '',
      refs: {}
    });
  };

  const handleBodyKeyDown = (e) => {
    handleMobileFormEnterAdvance(e, {
      onSubmitLastField: () => {
        if (documentType === 'cotizacion') {
          if (!isProcessingSale) handleSaveQuotation();
        } else if (canSubmitSale) {
          handleConfirmSale();
        }
      }
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3"
            style={modalOverlayStyle}
          >
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => {
                triggerHaptic(10);
                onClose();
              }}
              className="fixed inset-0 bg-black/85 cursor-pointer"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              drag="y"
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.05, bottom: 0.7 }}
              onDragEnd={(e, { offset, velocity }) => {
                if (offset.y > 90 || velocity.y > 350) {
                  triggerHaptic(20);
                  onClose();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md sm:max-w-lg ${T.modalCard} rounded-t-2xl sm:rounded-2xl shadow-2xl h-[92dvh] max-h-[92dvh] flex flex-col relative z-10 border-t sm:border select-none overflow-hidden`}
              style={modalCardMaxHeightStyle}
            >
              {/* Drag Pill Handle */}
              <div onPointerDown={(e) => dragControls.start(e)} className="w-full flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing sm:hidden touch-none shrink-0">
                <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
              </div>
            
              <div className={`px-4 py-2.5 flex items-center justify-between border-b ${T.border} shrink-0`}>
                <div className="flex items-center gap-2">
                  <CreditCard size={18} className="text-emerald-500 dark:text-emerald-400" />
                  <h3 className={`font-extrabold text-sm ${T.textPrimary}`}>
                    {documentType === 'cotizacion' ? 'Generar Cotización / Presupuesto' : documentType === 'nota_entrega' ? 'Emitir Nota de Entrega' : 'Cobro de Venta Fiscal'}
                  </h3>
                </div>
                <button 
                  onClick={() => {
                    triggerHaptic(10);
                    onClose();
                  }}
                  aria-label="Cerrar cobro"
                  className={`${T.textMuted} hover:opacity-100 p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg cursor-pointer active:scale-95`}
                >
                  <X size={16} />
                </button>
              </div>

              {/* CUERPO CENTRAL CON SCROLL INDEPENDIENTE (LIBRE DE INTERFERENCIA CON TECLADO VIRTUAL) */}
              <div
                onKeyDown={handleBodyKeyDown}
                onFocusCapture={handleFieldFocusCapture}
                className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 custom-scrollbar overscroll-contain"
              >
                {/* 1. Selector de Tipo de Documento: Factura | Nota de Entrega | Cotización */}
            <div className="space-y-1">
              <label className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                Tipo de Comprobante
              </label>
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                {[
                  { id: 'factura', label: '🧾 Factura', desc: 'Fiscal' },
                  { id: 'nota_entrega', label: '📋 Nota Ent.', desc: 'Comercial' },
                  { id: 'cotizacion', label: '💬 Cotización', desc: 'Presupuesto' }
                ].map(doc => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setDocumentType(doc.id);
                    }}
                    className={`py-2 px-1.5 rounded-xl text-center border font-black transition-colors cursor-pointer active:scale-95 flex flex-col items-center justify-center ${
                      documentType === doc.id
                        ? isLight
                          ? 'bg-[#0a0d12] border-[#0a0d12] text-white shadow-sm'
                          : 'bg-blue-600 border-blue-400 text-white shadow-xs'
                        : `${T.btnGhost} ${isLight ? 'border-[#dcdfe6] text-[#4b5563]' : 'border-slate-700/60 text-slate-400'}`
                    }`}
                  >
                    <span className="text-xs">{doc.label}</span>
                    <span className="text-[9px] opacity-75 font-normal">{doc.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Banner de Totales Duales — Estilo Consola Ejecutiva de Escritorio (#0a0d12) */}
            <div className="cart-summary-card bg-[#0a0d12] text-white p-3.5 rounded-xl border border-[#1e242e] flex justify-between items-center shadow-md">
              <div>
                <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">Total a Liquidar</p>
                <p className="font-black text-xl text-[#34d399] font-mono">${totalUSD.toFixed(2)}</p>
                <p className="text-[10px] text-[#64748b] font-semibold mt-0.5">
                  {isIvaEnabled && effectiveIvaRate > 0
                    ? `${taxLabel} ${effectiveIvaRate}% incluido ($${taxUSD.toFixed(2)})`
                    : `${taxLabel} Exento ($0.00)`}
                  {currentIgtfUSD > 0 && (
                    <span className="text-amber-400 font-bold ml-1.5">• IGTF {igtfRate}% (+${currentIgtfUSD.toFixed(2)})</span>
                  )}
                </p>
              </div>
              {!isDollarCountry && (
                <div className="text-right">
                  <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">Bolívares (Tasa {exchangeRate.toFixed(2)})</p>
                  <p className="font-black text-base text-[#fbbf24] font-mono">Bs. {totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              )}
            </div>

            {/* Si es Cotización: Vista simplificada de presupuesto */}
            {documentType === 'cotizacion' ? (
              <div className="space-y-3">
                <div className="bg-blue-500/10 border border-blue-500/25 p-3 rounded-2xl text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-blue-400 font-black">
                    <FileText size={15} />
                    <span>Presupuesto Comercial sin Impacto en Caja</span>
                  </div>
                  <p className={`text-[11px] ${T.textSecondary}`}>
                    Se generará un presupuesto formal a nombre del cliente seleccionado y se enviará por WhatsApp con el desglose de productos y vigencia de 3 días. No rebajará inventario ni sumará dinero a la caja.
                  </p>
                </div>

                {/* Selector de Cliente para Cotización */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className={`text-[10px] font-bold ${T.textSecondary}`}>Cliente Receptor</label>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenCustomerSelect()
                      }}
                      className="text-[10px] text-blue-500 hover:text-blue-400 font-bold flex items-center gap-1 cursor-pointer bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20 active:scale-95 transition-all"
                    >
                      <UserCheck size={11} />
                      <span>Seleccionar Cliente</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="text" 
                      enterKeyHint="next"
                      value={customerDoc}
                      placeholder="C.I. / RIF"
                      onChange={(e) => setCustomerDoc(e.target.value)}
                      className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2 text-base sm:text-sm font-bold outline-none`}
                    />
                    <input 
                      type="text" 
                      enterKeyHint="done"
                      value={customerName}
                      placeholder="Nombre completo"
                      onChange={(e) => setCustomerName(e.target.value)}
                      className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2 text-base sm:text-sm font-bold outline-none`}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* 2. Selector de Modo de Cobro: Express vs Dividido (Split) */}
                <div className="flex items-center justify-between border-b border-slate-700/40 pb-2">
                  <label className={`text-xs font-extrabold ${T.textSecondary}`}>Modo de Pago:</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCheckoutMode('express')}
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition-all cursor-pointer ${
                        checkoutMode === 'express'
                          ? 'bg-emerald-600 border-emerald-400 text-white shadow-xs'
                          : `${T.btnGhost} text-slate-400`
                      }`}
                    >
                      ⚡ Rápido (1 Método)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutMode('split')}
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition-all cursor-pointer ${
                        checkoutMode === 'split'
                          ? 'bg-purple-600 border-purple-400 text-white shadow-xs'
                          : `${T.btnGhost} text-slate-400`
                      }`}
                    >
                      🔀 Dividido (Split)
                    </button>
                  </div>
                </div>

                {checkoutMode === 'express' ? (
                  <>
                    {/* Métodos de Pago Express */}
                    <div className="space-y-1.5">
                      <label className={`text-xs font-extrabold ${T.textSecondary} block`}>Forma de Pago</label>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 text-xs">
                        {(isDollarCountry 
                          ? ['Efectivo USD', 'Tarjeta', 'Zelle', 'Binance', 'Transferencia', 'Mixto', 'Crédito'] 
                          : ['Efectivo USD', ...(hasEuroRate ? ['Efectivo EUR'] : []), 'Efectivo Bs', 'Tarjeta', 'Pago Móvil', 'Biopago', 'Zelle', 'Binance', 'Mixto', 'Crédito']
                        ).map(m => (
                          <button 
                            key={m}
                            onClick={() => handleSelectPaymentMethod(m)}
                            className={`min-h-[40px] p-2 rounded-xl font-bold border transition-colors text-center flex items-center justify-center cursor-pointer active:scale-95 ${
                              selectedMethod === m 
                                ? isLight
                                  ? 'bg-[#0a0d12] border-[#0a0d12] text-white shadow-sm'
                                  : 'bg-blue-600 border-blue-400 text-white shadow-xs' 
                                : isLight 
                                ? 'bg-[#f8fafc] border-[#dcdfe6] text-[#1f2937] hover:bg-slate-100' 
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Aviso de Venta a Crédito si está seleccionado */}
                    {selectedMethod === 'Crédito' && (
                      <div className={`${isMissingCreditCustomer ? 'bg-rose-500/15 border-rose-500/35' : 'bg-amber-500/10 border-amber-500/25'} border p-2.5 rounded-xl text-xs space-y-1.5`}>
                        <p className={`font-extrabold ${isMissingCreditCustomer ? 'text-rose-500' : 'text-amber-600 dark:text-amber-400'} text-[11px] uppercase`}>
                          Venta a Crédito (Cuentas por Cobrar):
                        </p>
                        {isMissingCreditCustomer ? (
                          <div className="space-y-1.5">
                            <p className="text-[11px] text-rose-400 font-bold">
                              ⚠️ Debes seleccionar un cliente registrado antes de procesar un pago Fiado / Crédito.
                            </p>
                            <button
                              type="button"
                              onClick={() => onOpenCustomerSelect?.()}
                              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black cursor-pointer active:scale-95"
                            >
                              Seleccionar Cliente Ahora
                            </button>
                          </div>
                        ) : (
                          <p className={`text-[11px] ${T.textSecondary}`}>
                            El saldo de <b className="text-amber-600 dark:text-amber-400">${totalUSD.toFixed(2)}</b> quedará registrado a nombre de <b className={T.textPrimary}>{customerName}</b> para su cobro posterior.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Desglose Binance USDT / Euro BCV si aplica */}
                    {isBinanceExpress && !isDollarCountry && Math.abs(binanceRate - effectiveRate) > 0.0001 && (
                      <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl text-xs flex items-center justify-between">
                        <div>
                          <span className="font-extrabold text-amber-500 text-[10px] uppercase block">Tasa Binance USDT Activa</span>
                          <span className={`text-[10px] ${T.textSecondary}`}>Bs. {binanceRate.toFixed(2)} / USDT</span>
                        </div>
                        <span className="font-mono font-black text-amber-400 text-sm">{exactUsdtTarget.toFixed(2)} USDT</span>
                      </div>
                    )}
                    {isEuroExpress && hasEuroRate && (
                      <div className="bg-indigo-500/10 border border-indigo-500/30 p-2.5 rounded-xl text-xs flex items-center justify-between">
                        <div>
                          <span className="font-extrabold text-indigo-400 text-[10px] uppercase block">Tasa Euro BCV Activa</span>
                          <span className={`text-[10px] ${T.textSecondary}`}>Bs. {euroRate.toFixed(2)} / EUR</span>
                        </div>
                        <span className="font-mono font-black text-indigo-300 text-sm">€{exactEurTarget.toFixed(2)} EUR</span>
                      </div>
                    )}

                    {/* Datos de Pago Móvil si está seleccionado */}
                    {selectedMethod === 'Pago Móvil' && !isDollarCountry && (
                      <div className="bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-xl text-xs space-y-1">
                        <p className="font-extrabold text-blue-600 dark:text-blue-400 text-[11px] uppercase">Datos Pago Móvil:</p>
                        {businessInfo?.pagoMovilPhone ? (
                          <div className={`text-[11px] ${T.textSecondary} grid grid-cols-2 gap-1`}>
                            <span>Banco: <b className={T.textPrimary}>{businessInfo.pagoMovilBank || 'No definido'}</b></span>
                            <span>Tel: <b className={T.textPrimary}>{businessInfo.pagoMovilPhone}</b></span>
                            <span className="col-span-2">C.I./RIF: <b className={T.textPrimary}>{businessInfo.pagoMovilId || 'No definido'}</b></span>
                          </div>
                        ) : (
                          <p className="text-[10.5px] text-amber-600 dark:text-amber-400 font-semibold py-0.5">
                            ⚠️ Configure los datos de Pago Móvil en los Ajustes del Negocio.
                          </p>
                        )}
                      </div>
                    )}

                    {/* 💵 CALCULADORA DE CAMBIO INTELIGENTE EN DOBLE MONEDA (SOLO EN EFECTIVO / MIXTO) */}
                    {isCashOrMixedExpress ? (
                      <>
                        <div className={`space-y-2 ${isLight ? 'bg-[#f8fafc] border-[#e2e5ec]' : 'bg-slate-950/40 border-slate-800/80'} border p-3 rounded-xl`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-[11px] font-black ${T.textSecondary} uppercase tracking-wider flex items-center gap-1.5`}>
                              <Banknote size={14} className="text-[#059669]" /> Billetes & Calculadora Rápida:
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  triggerHaptic(10);
                                  setCashAccumulateMode(!cashAccumulateMode);
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                                  cashAccumulateMode
                                    ? 'bg-[#0a0d12] text-white border-[#0a0d12]'
                                    : isLight
                                    ? 'bg-white text-[#4b5563] border-[#dcdfe6]'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                                title="Alternar entre reemplazar monto o sumar billetes"
                              >
                                {cashAccumulateMode ? '➕ Sumar Billetes' : '⚡ 1-Toque'}
                              </button>
                              {(amountPaidUSD || amountPaidBS) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    triggerHaptic(10);
                                    setAmountPaidUSD('');
                                    setAmountPaidBS('');
                                  }}
                                  className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 cursor-pointer"
                                >
                                  Limpiar (C)
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Billetes USD */}
                          <div className="space-y-1">
                            <span className={`text-[9px] font-black ${T.textSecondary} uppercase tracking-wider block`}>Billetes en Dólares ($):</span>
                            <div className="grid grid-cols-7 gap-1">
                              {/* Exacto $ */}
                              <button
                                type="button"
                                onClick={() => {
                                  triggerHaptic(12);
                                  playScanSound();
                                  setAmountPaidUSD(exactUsdTarget.toFixed(2));
                                  setAmountPaidBS('');
                                }}
                                className={`col-span-1 p-1 rounded-xl text-center cursor-pointer active:scale-95 transition-colors flex flex-col items-center justify-center ${
                                  amountPaidUSD === exactUsdTarget.toFixed(2) && !amountPaidBS
                                    ? 'bg-[#059669] text-white font-black shadow-sm'
                                    : 'bg-[#ecfdf5] dark:bg-emerald-500/15 text-[#047857] dark:text-emerald-400 border border-[#a7f3d0] dark:border-emerald-500/30 font-bold'
                                }`}
                                title={`Exacto: $${exactUsdTarget.toFixed(2)}`}
                              >
                                <span className="text-[10px] font-black leading-tight">Exacto</span>
                              </button>

                              {/* $1, $5, $10, $20, $50, $100 */}
                              {[1, 5, 10, 20, 50, 100].map(val => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => {
                                    triggerHaptic(12);
                                    playScanSound();
                                    if (cashAccumulateMode) {
                                      const current = parseFloat(amountPaidUSD) || 0;
                                      setAmountPaidUSD((current + val).toFixed(2));
                                    } else {
                                      setAmountPaidUSD(String(val));
                                      setAmountPaidBS('');
                                    }
                                  }}
                                  className={`p-1.5 rounded-xl text-center cursor-pointer active:scale-95 transition-colors flex flex-col items-center justify-center ${
                                    Number(amountPaidUSD) === val && !amountPaidBS
                                      ? 'bg-[#0a0d12] text-white font-black shadow-sm'
                                      : isLight
                                      ? 'bg-white text-[#0a0d12] border border-[#dcdfe6] hover:bg-slate-100 font-black'
                                      : 'bg-slate-800/90 text-slate-100 border border-slate-700/80 hover:bg-slate-700 font-black'
                                  }`}
                                >
                                  <span className="text-xs leading-none">${val}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Chips en Bolívares */}
                          {!isDollarCountry && (
                            <div className="space-y-1 pt-0.5">
                              <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider block">Pago en Bolívares (Bs):</span>
                              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                                {/* Exacto Bs */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    triggerHaptic(12);
                                    playScanSound();
                                    if (selectedMethod === 'Efectivo USD' || selectedMethod === 'Zelle' || selectedMethod === 'Mixto') {
                                      handleSelectPaymentMethod('Efectivo Bs');
                                    } else {
                                      setAmountPaidBS(totalBS.toFixed(2));
                                      setAmountPaidUSD('');
                                    }
                                  }}
                                  className={`px-2.5 py-1 rounded-xl text-xs font-black shrink-0 cursor-pointer active:scale-95 transition-colors ${
                                    amountPaidBS === totalBS.toFixed(2) && !amountPaidUSD
                                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                                  }`}
                                >
                                  🇻🇪 Exacto Bs ({totalBS.toFixed(2)})
                                </button>

                                {[100, 200, 500, 1000].map(bsVal => (
                                  <button
                                    key={bsVal}
                                    type="button"
                                    onClick={() => {
                                      triggerHaptic(12);
                                      playScanSound();
                                      if (cashAccumulateMode) {
                                        const curr = parseFloat(amountPaidBS) || 0;
                                        setAmountPaidBS((curr + bsVal).toFixed(2));
                                      } else {
                                        setAmountPaidBS(String(bsVal));
                                        setAmountPaidUSD('');
                                      }
                                    }}
                                    className={`px-2 py-1 rounded-xl border text-xs font-bold shrink-0 cursor-pointer active:scale-95 ${
                                      isLight
                                        ? 'bg-white text-amber-700 border-[#dcdfe6] hover:bg-amber-50'
                                        : 'bg-slate-800 text-amber-300 border-slate-700 hover:bg-slate-700'
                                    }`}
                                  >
                                    {cashAccumulateMode ? `+${bsVal} Bs` : `${bsVal} Bs`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Montos Recibidos Manuales */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className={`text-[10px] font-extrabold ${T.textSecondary} block mb-1`}>Efectivo Recibido en USD ($)</label>
                            <input 
                              type="number" 
                              inputMode="decimal"
                              enterKeyHint="next"
                              step="0.01" 
                              placeholder="0.00"
                              value={amountPaidUSD}
                              onChange={(e) => setAmountPaidUSD(e.target.value)}
                              className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2.5 text-base sm:text-sm font-black outline-none focus:border-emerald-500`}
                            />
                          </div>
                          <div>
                            <label className={`text-[10px] font-extrabold ${T.textSecondary} block mb-1`}>Efectivo Recibido en Bs (Bs)</label>
                            <input 
                              type="number" 
                              inputMode="decimal"
                              enterKeyHint="next"
                              step="0.1" 
                              placeholder="0.00"
                              value={amountPaidBS}
                              onChange={(e) => setAmountPaidBS(e.target.value)}
                              className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2.5 text-base sm:text-sm font-black outline-none focus:border-amber-500`}
                            />
                          </div>
                        </div>

                        {/* Desglose de Cambio / Vuelto en Doble Moneda */}
                        {totalPaidInUSD >= totalUSD && (paidUSD > 0 || paidBS > 0) ? (
                          <div className="bg-emerald-500/15 border-2 border-emerald-500/40 p-3 rounded-2xl flex items-center justify-between shadow-md">
                            <div className="flex items-center gap-2">
                              <div className="w-9 h-9 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-base shadow-sm">
                                $
                              </div>
                              <div>
                                <span className="text-[10px] uppercase font-black tracking-wider text-emerald-400 block leading-tight">
                                  Vuelto / Cambio a Entregar
                                </span>
                                <span className="text-[10px] text-slate-400 font-bold block">
                                  Tasa BCV: Bs. {exchangeRate.toFixed(2)}
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-black text-emerald-400 font-mono leading-none">
                                ${changeUSD.toFixed(2)} USD
                              </div>
                              <div className="text-xs font-black text-amber-400 font-mono mt-0.5">
                                Bs. {changeBS.toFixed(2)}
                              </div>
                            </div>
                          </div>
                        ) : (totalPaidInUSD > 0 && totalPaidInUSD < totalUSD) ? (
                          <div className="bg-rose-500/15 border border-rose-500/30 p-2.5 rounded-xl flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 text-rose-400 font-black">
                              <AlertTriangle size={15} />
                              <span>Falta por Pagar:</span>
                            </div>
                            <div className="text-right font-black font-mono">
                              <span className="text-rose-400">${(totalUSD - totalPaidInUSD).toFixed(2)} USD</span>
                              <span className="text-slate-400 text-[10px] block font-semibold">
                                Bs. {((totalUSD - totalPaidInUSD) * exchangeRate).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : selectedMethod !== 'Crédito' ? (
                      <div className={`p-2.5 rounded-xl border ${isLight ? 'bg-blue-50/70 border-blue-200 text-blue-900' : 'bg-blue-500/10 border-blue-500/25 text-blue-200'} flex items-center justify-between text-xs`}>
                        <span className="font-bold">Monto exacto por {selectedMethod}:</span>
                        <span className="font-mono font-black">
                          ${totalUSD.toFixed(2)}{!isDollarCountry ? ` • Bs. ${totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  /* Modo Dividido (Split Payments) */
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-purple-400 uppercase text-[10px]">Desglose de Pago Mixto:</span>
                      <div className="flex items-center gap-2">
                        {splitPaidUSD > 0 && (
                          <button
                            type="button"
                            onClick={handleClearSplitPayments}
                            className="text-[10px] text-rose-400 font-bold hover:underline cursor-pointer"
                          >
                            Limpiar
                          </button>
                        )}
                        {splitRemainingUSD > 0.01 && (
                          <button
                            type="button"
                            onClick={() => handleFillSplitRemaining('cash_usd', false)}
                            className="text-[10px] text-emerald-400 font-bold hover:underline cursor-pointer"
                          >
                            ⚡ Restante a USD
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { key: 'cash_usd', label: 'Efectivo USD ($)', isBs: false, step: '0.01', show: true },
                        { key: 'cash_eur', label: `Efectivo EUR (€ • ${euroRate.toFixed(2)})`, isBs: false, step: '0.01', show: hasEuroRate },
                        { key: 'cash_bs', label: 'Efectivo Bs (Bs)', isBs: true, step: '0.1', show: !isDollarCountry },
                        { key: 'pago_movil', label: 'Pago Móvil (Bs)', isBs: true, step: '0.1', show: !isDollarCountry },
                        { key: 'tarjeta', label: isDollarCountry ? 'Punto / Tarjeta ($)' : 'Punto / Tarjeta (Bs)', isBs: !isDollarCountry, step: '0.1', show: true },
                        { key: 'zelle', label: 'Zelle ($)', isBs: false, step: '0.01', show: true },
                        { key: 'binance', label: !isDollarCountry && Math.abs(binanceRate - effectiveRate) > 0.0001 ? `Binance USDT (${binanceRate.toFixed(2)})` : 'Binance USDT ($)', isBs: false, step: '0.01', show: true },
                        { key: 'credito', label: 'Crédito / Fiado ($)', isBs: false, step: '0.01', show: true }
                      ].filter((field) => field.show).map((field) => (
                        <div key={field.key}>
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <label className={`text-[10px] font-bold ${T.textSecondary} truncate`}>{field.label}</label>
                            {splitRemainingUSD > 0.01 && (
                              <button
                                type="button"
                                onClick={() => handleFillSplitRemaining(field.key, field.isBs)}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30 text-[9px] font-black shrink-0 cursor-pointer active:scale-95"
                                title={`Completar restante en ${field.label}`}
                              >
                                <Zap size={9} />
                                <span>Resto</span>
                              </button>
                            )}
                          </div>
                          <input
                            type="number"
                            inputMode="decimal"
                            enterKeyHint="next"
                            step={field.step}
                            value={splitPayments[field.key] || ''}
                            onChange={(e) => setSplitPayments(p => ({ ...p, [field.key]: e.target.value }))}
                            placeholder="0.00"
                            className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2 text-base sm:text-sm font-black outline-none focus:border-purple-500`}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Balance de Split */}
                    <div className="p-2.5 rounded-xl bg-[#0a0d12] border border-[#1e242e] space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Total Cubierto:</span>
                        <span className="font-black text-white">${splitPaidUSD.toFixed(2)} USD</span>
                      </div>
                      {splitRemainingUSD > 0.01 ? (
                        <div className="flex justify-between text-rose-400 font-bold">
                          <span>Faltante por Cubrir:</span>
                          <span>${splitRemainingUSD.toFixed(2)}{!isDollarCountry ? ` (Bs. ${(splitRemainingUSD * effectiveRate).toFixed(2)})` : ''}</span>
                        </div>
                      ) : (
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Vuelto / Excedente:</span>
                          <span>${splitChangeUSD.toFixed(2)} USD</span>
                        </div>
                      )}
                    </div>

                    {isMissingCreditCustomer && (
                      <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs flex items-center justify-between gap-2">
                        <span className="text-rose-400 font-bold text-[11px]">⚠️ Crédito en Split requiere cliente registrado.</span>
                        <button
                          type="button"
                          onClick={() => onOpenCustomerSelect?.()}
                          className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black shrink-0 cursor-pointer"
                        >
                          Elegir Cliente
                        </button>
                      </div>
                    )}

                    {/* Referencias independientes cuando hay múltiples métodos electrónicos en Split */}
                    {activeElectronicSplitMethods.length > 1 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-black uppercase text-amber-500 block">
                          Referencias Individuales por Método Electrónico
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {activeElectronicSplitMethods.map((m) => (
                            <div key={m.key}>
                              <label className={`text-[10px] font-bold ${T.textSecondary} block mb-0.5`}>
                                Ref. {m.label} *
                              </label>
                              <input
                                type="text"
                                inputMode="text"
                                value={splitRefs[m.key] ?? ''}
                                placeholder={`Comprobante ${m.label}`}
                                onChange={(e) => setSplitPayments((p) => ({
                                  ...p,
                                  refs: { ...(p.refs || {}), [m.key]: e.target.value }
                                }))}
                                className={`w-full min-h-[40px] ${T.inputBg} border rounded-xl p-2 text-xs font-bold font-mono outline-none ${
                                  !String(splitRefs[m.key] || paymentReference || '').trim() ? 'border-amber-500' : 'border-emerald-500'
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Inputs y Selector de Cliente */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className={`text-[10px] font-bold ${T.textSecondary}`}>Datos del Cliente</label>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenCustomerSelect()
                      }}
                      className="text-[10px] text-blue-500 hover:text-blue-400 font-bold flex items-center gap-1 cursor-pointer bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20 active:scale-95 transition-all"
                    >
                      <UserCheck size={11} />
                      <span>Seleccionar Cliente</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <input 
                        type="text" 
                        enterKeyHint="next"
                        value={customerDoc}
                        placeholder="C.I. / RIF"
                        onChange={(e) => setCustomerDoc(e.target.value)}
                        className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2 text-base sm:text-sm font-bold outline-none`}
                      />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        enterKeyHint="next"
                        value={customerName}
                        placeholder="Nombre completo"
                        onChange={(e) => setCustomerName(e.target.value)}
                        className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2 text-base sm:text-sm font-bold outline-none`}
                      />
                    </div>
                  </div>
                </div>

                {/* Referencia de Pago */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className={`text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${
                      isRefRequired ? 'text-amber-500' : T.textSecondary
                    }`}>
                      <span>N° de Referencia / Comprobante</span>
                      {isRefRequired ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-500/30 font-mono">
                          OBLIGATORIO
                        </span>
                      ) : (
                        <span className="text-[9px] text-slate-400 font-normal">
                          (Opcional)
                        </span>
                      )}
                    </label>
                  </div>
                  <input
                    ref={paymentReferenceInputRef}
                    type="text"
                    inputMode="text"
                    enterKeyHint="done"
                    data-enter-submit="true"
                    value={paymentReference}
                    placeholder={
                      isRefRequired
                        ? "Ej: 123456 (Ingrese los dígitos del comprobante)"
                        : "Referencia bancaria / Notas del pago (Opcional)"
                    }
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl p-2.5 text-base sm:text-sm font-bold outline-none font-mono transition-colors ${
                      isRefRequired
                        ? isMissingRequiredRef
                          ? 'border-amber-500 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/40'
                          : 'border-emerald-500 focus:border-emerald-400'
                        : 'focus:border-blue-500'
                    }`}
                  />
                  {isMissingRequiredRef && (
                    <p className="text-[10px] text-amber-500 font-semibold flex items-center gap-1">
                      ⚠️ Ingrese el número de referencia para liquidar este pago electrónico.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* FOOTER FIJO INFERIOR (STICKY ACTION BAR): NUNCA QUEDA TAPADO POR EL TECLADO VIRTUAL */}
          <div className={`p-3 sm:p-4 border-t ${T.border} ${isLight ? 'bg-white' : 'bg-[#0e1217]'} shrink-0 space-y-2`} style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
            {documentType !== 'cotizacion' && isMissingRequiredRef && (
              <button
                type="button"
                onClick={() => {
                  paymentReferenceInputRef.current?.focus();
                  scrollFieldIntoView(paymentReferenceInputRef.current, 60);
                }}
                className="w-full py-1.5 px-3 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-500 text-[11px] font-extrabold text-center cursor-pointer active:scale-[0.99]"
              >
                ⚠️ Falta el N° de Referencia obligatorio — Toca aquí para escribirlo
              </button>
            )}
            {documentType === 'cotizacion' ? (
              <button
                type="button"
                disabled={isProcessingSale}
                onClick={handleSaveQuotation}
                className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-50 text-white font-black py-3 px-4 rounded-xl text-xs uppercase tracking-wider transition-all shadow-xl shadow-blue-500/20 cursor-pointer flex items-center justify-center gap-2"
              >
                {isProcessingSale ? <RefreshCw size={16} className="animate-spin" /> : <Share2 size={16} />}
                <span>GUARDAR Y ENVIAR COTIZACIÓN (WHATSAPP)</span>
              </button>
            ) : (
              <button 
                disabled={!canSubmitSale}
                onClick={handleConfirmSale}
                className="pos-checkout-btn w-full min-h-[50px] bg-[#059669] hover:bg-[#047857] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3 px-4 rounded-xl text-xs sm:text-sm uppercase tracking-wider transition-all shadow-lg cursor-pointer flex items-center justify-between"
              >
                {isProcessingSale ? (
                  <div className="w-full flex items-center justify-center gap-2">
                    <RefreshCw size={18} className="animate-spin" />
                    <span>PROCESANDO VENTA...</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-left truncate">
                      <CheckCircle size={18} className="shrink-0 text-white" />
                      <span className="truncate">
                        {documentType === 'nota_entrega' ? 'EMITIR NOTA DE ENTREGA' : 'REGISTRAR FACTURA EN SERVIDOR'}
                      </span>
                    </div>
                    <div className="font-mono text-right shrink-0">
                      <span className="text-sm sm:text-base font-black block leading-none tabular-nums">
                        {effectiveChangeUSD > 0 ? `VUELTO: +$${effectiveChangeUSD.toFixed(2)}` : `$${totalUSD.toFixed(2)}`}
                      </span>
                      {!isDollarCountry && effectiveChangeBS > 0 && (
                        <span className="text-[10px] text-emerald-200 block leading-none mt-0.5 tabular-nums">
                          Bs. {effectiveChangeBS.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
          </div>
        )}
    </AnimatePresence>
  );
}
