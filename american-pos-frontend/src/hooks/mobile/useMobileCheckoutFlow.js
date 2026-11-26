import { useMemo, useCallback } from 'react';
import api from '../../services/api';
import localDb from '../../db/localDb';
import { db as primaryDb } from '../../services/db';
import lanSyncService from '../../services/lanSyncService';
import mobilePrinterService from '../../services/mobilePrinterService';
import { evaluateCartPromotions } from '../../utils/promotionsEngine';
import { getRegionConfig } from '../../utils/regionConfig';
import { triggerHaptic } from '../../utils/haptics';
import { playScanSound, playSuccessSound, playErrorSound } from '../../utils/sounds';
import { getTerminalId } from '../../utils/terminalIdentity';
import { normalizeMobileCartItems } from '../../store/useMobilePosStore';

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

/**
 * Normaliza etiquetas de UI o alias legados a IDs canónicos del backend
 * (evita corrupción de asientos NIIF y arqueos de caja).
 */
export function canonicalizeMobilePaymentMethod(rawMethod) {
  const clean = String(rawMethod || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');

  if (!clean || clean === 'efectivo_usd' || clean === 'cash_usd' || clean === 'cash' || clean === 'efectivo') return 'cash_usd';
  if (clean === 'efectivo_bs' || clean === 'cash_bs' || clean === 'cash_ves' || clean === 'bs' || clean === 'ves') return 'cash_bs';
  if (clean === 'pago_movil' || clean === 'pagomovil' || clean === 'mobile') return 'pago_movil';
  if (clean === 'tarjeta' || clean === 'punto_de_venta' || clean === 'punto' || clean === 'debit' || clean === 'debito' || clean === 'card') return 'debit';
  if (clean === 'biopago') return 'biopago';
  if (clean === 'transferencia' || clean === 'transfer' || clean === 'transfer_bs') return 'transfer';
  if (clean === 'zelle') return 'zelle';
  if (clean === 'binance' || clean === 'binance_usdt' || clean === 'binance_pay' || clean === 'usdt') return 'binance_usdt';
  if (clean === 'credito' || clean === 'credit' || clean === 'fiado') return 'fiado';
  if (clean === 'mixto' || clean === 'mixto_/_dividido' || clean === 'split') return 'mixto';
  return clean;
}

export function stripMobileProductSuffix(rawId) {
  return String(rawId || '').replace(/__bulk$|__mid$|__pres_.*$|__wpres_.*$|__srv_.*$/, '');
}

/**
 * useMobileCheckoutFlow
 * Hook modularizado para cálculo de promociones, totales multimoneda (USD/VES + IVA/IGTF dinámicos),
 * cotizaciones (con respaldo offline) y despacho de ventas online/offline con idempotencia UUID v4.
 */
export function useMobileCheckoutFlow({
  cart,
  setCart,
  promotions,
  cartDiscountPercent,
  setCartDiscountPercent,
  discountSupervisorApprovalId,
  setDiscountSupervisorApprovalId,
  exchangeRate,
  lockedExchangeRate = null,
  businessInfo,
  documentType,
  setDocumentType,
  checkoutMode,
  setCheckoutMode,
  splitPayments,
  setSplitPayments,
  selectedMethod,
  setSelectedMethod,
  amountPaidUSD,
  setAmountPaidUSD,
  amountPaidBS,
  setAmountPaidBS,
  paymentReference,
  setPaymentReference,
  isProcessingSale,
  setIsProcessingSale,
  setIsCheckoutOpen,
  setIsMobileCartOpen,
  setIsThermalPrinterModalOpen,
  setPrintedReceipt,
  setSalesHistory,
  setPendingSalesCount,
  setProducts,
  productsMap,
  getCleanProductId,
  getProductUnitsMultiplier,
  customers,
  selectedCustomer = null,
  setSelectedCustomer,
  setSelectedTable,
  setOrderNotes,
  customerName,
  setCustomerName,
  customerDoc,
  setCustomerDoc,
  setCustomerPhone,
  isDollarCountry,
  autoPrint,
  canApplyDiscounts = true,
  user,
  requestSupervisorAuth,
  showToast
}) {
  const effectiveRate = useMemo(() => {
    const locked = Number(lockedExchangeRate);
    if (locked > 0) return locked;
    const live = Number(exchangeRate);
    return live > 0 ? live : 1;
  }, [lockedExchangeRate, exchangeRate]);

  const regionCfg = useMemo(() => getRegionConfig(businessInfo?.country), [businessInfo?.country]);

  const { isIvaEnabled, effectiveIvaRate, taxLabel } = useMemo(() => {
    const enabled = businessInfo?.taxConfig?.ivaEnabled !== undefined
      ? Boolean(businessInfo.taxConfig.ivaEnabled)
      : (businessInfo?.ivaEnabled !== undefined ? Boolean(businessInfo.ivaEnabled) : true);
    const rawRate = businessInfo?.taxConfig?.ivaRate ?? businessInfo?.ivaRate ?? businessInfo?.taxRate ?? regionCfg.defaultTaxRate;
    const parsedRate = Number(rawRate);
    const rate = enabled && Number.isFinite(parsedRate) && parsedRate >= 0 ? parsedRate : 0;
    const label = businessInfo?.taxConfig?.taxLabel || businessInfo?.taxLabel || regionCfg.taxLabel || 'IVA';
    return { isIvaEnabled: enabled, effectiveIvaRate: rate, taxLabel: label };
  }, [businessInfo, regionCfg]);

  const canonicalSelectedMethod = useMemo(() => {
    if (checkoutMode === 'split') return 'mixto';
    return canonicalizeMobilePaymentMethod(selectedMethod);
  }, [checkoutMode, selectedMethod]);

  const safeCart = useMemo(() => normalizeMobileCartItems(cart), [cart]);

  const promoResult = useMemo(() => {
    const flattenedItems = safeCart.map(item => ({
      ...item.product,
      id: item.product.id,
      productId: stripMobileProductSuffix(item.product.productId || item.product.id),
      name: item.product.name || item.product.nombre,
      price: Number(item.product.price || item.product.precio || 0),
      quantity: Number(item.quantity) || 1,
      category: item.product.category || item.product.categoria || ''
    }));
    const paymentHint = checkoutMode === 'express' ? canonicalSelectedMethod : null;
    return evaluateCartPromotions(flattenedItems, promotions, paymentHint);
  }, [safeCart, promotions, checkoutMode, canonicalSelectedMethod]);

  const {
    rawSubtotalUSD,
    totalPromoSavings,
    cartDiscountAmountUSD,
    subtotalUSD,
    enrichedCart,
    taxUSD,
    baseImponibleUSD,
    totalUSD,
    totalBS,
    totalItemsCount
  } = useMemo(() => {
    const rawSub = round2(
      safeCart.reduce((acc, item) => acc + (Number(item.product.price || item.product.precio || 0) * Number(item.quantity || 1)), 0)
    );
    const promoSavings = round2(promoResult.totalPromoSavings || 0);
    const subBeforeDisc = promoResult.finalCartSubtotal !== undefined ? round2(promoResult.finalCartSubtotal) : rawSub;
    const cartDisc = round2(subBeforeDisc * (Number(cartDiscountPercent || 0) / 100));
    const subUSD = round2(Math.max(0, subBeforeDisc - cartDisc));

    const promoItems = Array.isArray(promoResult.itemsWithPromotions) ? promoResult.itemsWithPromotions : [];
    const enriched = safeCart.map((item, idx) => {
      const promoItem = promoItems[idx] && String(promoItems[idx].id) === String(item.product.id)
        ? promoItems[idx]
        : promoItems.find(p => String(p.id) === String(item.product.id));
      return {
        ...item,
        appliedPromoName: promoItem?.appliedPromoName || null,
        promoDiscount: round2(promoItem?.promoDiscount || 0),
        finalSubtotal: round2(promoItem?.finalSubtotal ?? (Number(item.product.price || item.product.precio || 0) * Number(item.quantity || 1)))
      };
    });

    const taxableSubBeforeDisc = enriched.reduce((acc, item) => {
      const isExempt = item.product.taxStatus === 'exento' || Boolean(item.product.isExempt) || Boolean(item.product.is_exempt) || Boolean(item.product.taxExempt);
      return isExempt ? acc : acc + Number(item.finalSubtotal || 0);
    }, 0);

    const discRatio = subBeforeDisc > 0 ? (subUSD / subBeforeDisc) : 1;
    const effTaxable = round2(taxableSubBeforeDisc * discRatio);

    const ivaDivisor = 1 + (effectiveIvaRate / 100);
    const tUSD = (isIvaEnabled && effectiveIvaRate > 0)
      ? round2(Math.max(0, effTaxable - (effTaxable / ivaDivisor)))
      : 0;
    const baseImp = round2(Math.max(0, effTaxable - tUSD));
    const exUSD = round2(Math.max(0, subUSD - effTaxable));
    const totUSD = subUSD;
    const totBS = round2(totUSD * effectiveRate);
    const totItems = safeCart.reduce((acc, item) => acc + Number(item.quantity || 0), 0);

    return {
      rawSubtotalUSD: rawSub,
      totalPromoSavings: promoSavings,
      subtotalBeforeDiscountUSD: subBeforeDisc,
      cartDiscountAmountUSD: cartDisc,
      subtotalUSD: subUSD,
      enrichedCart: enriched,
      taxableSubtotalBeforeDiscountUSD: taxableSubBeforeDisc,
      effectiveTaxableUSD: effTaxable,
      taxUSD: tUSD,
      baseImponibleUSD: baseImp,
      exemptUSD: exUSD,
      totalUSD: totUSD,
      totalBS: totBS,
      totalItemsCount: totItems
    };
  }, [safeCart, promoResult, cartDiscountPercent, effectiveRate, isIvaEnabled, effectiveIvaRate]);

  const isIgtfEnabled = Boolean(
    businessInfo?.taxConfig?.igtfEnabled !== undefined
      ? businessInfo.taxConfig.igtfEnabled
      : (businessInfo?.igtfEnabled !== undefined ? businessInfo.igtfEnabled : regionCfg.hasIgtf)
  );
  const igtfRatePct = useMemo(() => {
    if (!isIgtfEnabled) return 0;
    const raw = businessInfo?.taxConfig?.igtfRate ?? businessInfo?.igtfRate ?? regionCfg.defaultIgtfRate;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [isIgtfEnabled, businessInfo, regionCfg]);

  const isBinanceIgtfEnabled = Boolean(
    businessInfo?.binanceIgtfEnabled ?? businessInfo?.taxConfig?.binanceIgtfEnabled
  );

  const currentIgtfUSD = useMemo(() => {
    if (!isIgtfEnabled || igtfRatePct <= 0 || documentType === 'cotizacion' || totalUSD <= 0) return 0;
    const factor = 1 + (igtfRatePct / 100);
    if (checkoutMode === 'split') {
      const sUsd = parseFloat(splitPayments.cash_usd) || 0;
      const sBinance = isBinanceIgtfEnabled ? (parseFloat(splitPayments.binance) || 0) : 0;
      const foreignSubjectTotal = sUsd + sBinance;
      if (foreignSubjectTotal <= 0) return 0;
      const appliedPrincipal = Math.min(totalUSD, foreignSubjectTotal / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }

    const methodNorm = canonicalSelectedMethod;
    const isCrypto = methodNorm === 'binance_usdt';
    const isExemptUsd = methodNorm === 'zelle' || methodNorm === 'fiado' || (isCrypto && !isBinanceIgtfEnabled);
    const isVesOnly = ['cash_bs', 'pago_movil', 'debit', 'biopago', 'transfer'].includes(methodNorm);
    if (isExemptUsd || isVesOnly) return 0;

    const enteredUsd = parseFloat(amountPaidUSD) || 0;
    const enteredBs = parseFloat(amountPaidBS) || 0;

    if (methodNorm === 'mixto') {
      if (enteredUsd <= 0) return 0;
      const appliedPrincipal = Math.min(totalUSD, enteredUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    if (enteredBs > 0 && enteredUsd <= 0) return 0;
    if (enteredUsd > 0) {
      const appliedPrincipal = Math.min(totalUSD, enteredUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    return round2(totalUSD * (igtfRatePct / 100));
  }, [isIgtfEnabled, isBinanceIgtfEnabled, igtfRatePct, documentType, totalUSD, checkoutMode, splitPayments, canonicalSelectedMethod, amountPaidUSD, amountPaidBS]);

  const totalDueUSD = useMemo(() => round2(totalUSD + currentIgtfUSD), [totalUSD, currentIgtfUSD]);
  const totalDueBS = useMemo(() => round2(totalDueUSD * effectiveRate), [totalDueUSD, effectiveRate]);

  const { paidUSD, paidBS, totalPaidInUSD, changeUSD, changeBS } = useMemo(() => {
    const pUSD = parseFloat(amountPaidUSD) || 0;
    const pBS = parseFloat(amountPaidBS) || 0;
    const totPaidUSD = pUSD + (pBS / effectiveRate);
    const chUSD = round2(Math.max(0, totPaidUSD - totalDueUSD));
    const chBS = round2(chUSD * effectiveRate);
    return { paidUSD: pUSD, paidBS: pBS, totalPaidInUSD: totPaidUSD, changeUSD: chUSD, changeBS: chBS };
  }, [amountPaidUSD, amountPaidBS, effectiveRate, totalDueUSD]);

  const splitPaidUSD = useMemo(() => {
    const usdCash = parseFloat(splitPayments.cash_usd) || 0;
    const zelle = parseFloat(splitPayments.zelle) || 0;
    const binance = parseFloat(splitPayments.binance) || 0;
    const credit = parseFloat(splitPayments.credito) || 0;
    const bsCash = parseFloat(splitPayments.cash_bs) || 0;
    const pagoMovil = parseFloat(splitPayments.pago_movil) || 0;
    const debit = parseFloat(splitPayments.tarjeta) || 0;
    const bsTotalInUSD = (bsCash + pagoMovil + debit) / effectiveRate;
    return usdCash + zelle + binance + credit + bsTotalInUSD;
  }, [splitPayments, effectiveRate]);

  const splitRemainingUSD = useMemo(() => round2(Math.max(0, totalDueUSD - splitPaidUSD)), [totalDueUSD, splitPaidUSD]);
  const splitChangeUSD = useMemo(() => round2(Math.max(0, splitPaidUSD - totalDueUSD)), [totalDueUSD, splitPaidUSD]);
  const splitChangeBS = useMemo(() => round2(splitChangeUSD * effectiveRate), [splitChangeUSD, effectiveRate]);

  const handleApplyDiscount = useCallback((pct) => {
    if (pct > 0 && !canApplyDiscounts) {
      triggerHaptic(30);
      playErrorSound();
      showToast('⚠️ No tienes permisos para aplicar descuentos');
      return;
    }
    if (pct > 10) {
      requestSupervisorAuth(
        'Autorizar Descuento Especial',
        `Descuento del ${pct}% requiere aprobación de supervisor`,
        (approvalData) => {
          setCartDiscountPercent(pct);
          setDiscountSupervisorApprovalId(approvalData?.id || null);
          showToast(`✅ Descuento de ${pct}% autorizado`);
        },
        'HIGH_DISCOUNT'
      );
    } else {
      setCartDiscountPercent(pct);
      if (pct === 0) setDiscountSupervisorApprovalId(null);
    }
  }, [canApplyDiscounts, requestSupervisorAuth, setCartDiscountPercent, setDiscountSupervisorApprovalId, showToast]);

  const handleSelectPaymentMethod = useCallback((method) => {
    setSelectedMethod(method);
    const canon = canonicalizeMobilePaymentMethod(method);
    if (['cash_bs', 'pago_movil', 'debit', 'biopago', 'transfer'].includes(canon)) {
      setAmountPaidBS(totalBS.toFixed(2));
      setAmountPaidUSD('');
    } else if (canon === 'cash_usd') {
      const usdDue = isIgtfEnabled && igtfRatePct > 0 ? round2(totalUSD * (1 + (igtfRatePct / 100))) : totalUSD;
      setAmountPaidUSD(usdDue.toFixed(2));
      setAmountPaidBS('');
    } else if (canon === 'binance_usdt') {
      const usdDue = (isIgtfEnabled && isBinanceIgtfEnabled && igtfRatePct > 0)
        ? round2(totalUSD * (1 + (igtfRatePct / 100)))
        : totalUSD;
      setAmountPaidUSD(usdDue.toFixed(2));
      setAmountPaidBS('');
    } else if (canon === 'zelle') {
      setAmountPaidUSD(totalUSD.toFixed(2));
      setAmountPaidBS('');
    } else if (canon === 'mixto') {
      const halfUSD = totalUSD / 2;
      const halfIgtf = isIgtfEnabled && igtfRatePct > 0 ? round2(halfUSD * (igtfRatePct / 100)) : 0;
      setAmountPaidUSD((halfUSD + halfIgtf).toFixed(2));
      setAmountPaidBS((halfUSD * effectiveRate).toFixed(2));
    } else if (canon === 'fiado') {
      setAmountPaidUSD('0.00');
      setAmountPaidBS('0.00');
    }
  }, [setSelectedMethod, totalBS, setAmountPaidBS, setAmountPaidUSD, isIgtfEnabled, isBinanceIgtfEnabled, totalUSD, igtfRatePct, effectiveRate]);

  const resetCheckoutTransientState = useCallback(() => {
    setCart([]);
    setCartDiscountPercent(0);
    setDiscountSupervisorApprovalId(null);
    setIsCheckoutOpen(false);
    setIsMobileCartOpen(false);
    setPaymentReference('');
    setAmountPaidUSD('');
    setAmountPaidBS('');
    if (typeof setSplitPayments === 'function') {
      setSplitPayments({ cash_usd: '', cash_bs: '', pago_movil: '', tarjeta: '', zelle: '', binance: '', credito: '' });
    }
    if (typeof setCheckoutMode === 'function') setCheckoutMode('express');
    if (typeof setDocumentType === 'function') setDocumentType('factura');
    if (typeof setSelectedCustomer === 'function') setSelectedCustomer(null);
    if (typeof setSelectedTable === 'function') setSelectedTable(null);
    if (typeof setOrderNotes === 'function') setOrderNotes('');
    if (typeof setCustomerName === 'function') setCustomerName('Consumidor Final');
    if (typeof setCustomerDoc === 'function') setCustomerDoc(isDollarCountry ? '0000000000' : 'V-00000000');
    if (typeof setCustomerPhone === 'function') setCustomerPhone('');
  }, [
    setCart, setCartDiscountPercent, setDiscountSupervisorApprovalId,
    setIsCheckoutOpen, setIsMobileCartOpen, setPaymentReference,
    setAmountPaidUSD, setAmountPaidBS, setSplitPayments, setCheckoutMode,
    setDocumentType, setSelectedCustomer, setSelectedTable, setOrderNotes,
    setCustomerName, setCustomerDoc, setCustomerPhone, isDollarCountry
  ]);

  const openQuotationWhatsApp = useCallback((quoteId) => {
    const taxLine = isIvaEnabled && effectiveIvaRate > 0
      ? [`${taxLabel} (${effectiveIvaRate}%): $${taxUSD.toFixed(2)}`]
      : [];
    const bsLines = !isDollarCountry
      ? [
          `*TOTAL BS: Bs. ${totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`,
          `Tasa Oficial: Bs. ${effectiveRate.toFixed(2)}`
        ]
      : [];
    const lines = [
      `📋 *PRESUPUESTO / COTIZACIÓN*`,
      `Comercio: *${businessInfo?.name || 'Isaac POS'}*`,
      `Nº Presupuesto: *${quoteId}*`,
      `Fecha: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      `Cliente: *${customerName || 'Consumidor Final'}* ${customerDoc ? `(${customerDoc})` : ''}`,
      `--------------------------------`,
      ...enrichedCart.map(i => `• ${i.quantity}x ${i.product.name || i.product.nombre} = $${Number(i.finalSubtotal).toFixed(2)}`),
      `--------------------------------`,
      `Subtotal: $${subtotalUSD.toFixed(2)}`,
      ...taxLine,
      `*TOTAL USD: $${totalUSD.toFixed(2)}*`,
      ...bsLines,
      `--------------------------------`,
      `*Validez de la oferta: 3 días continuos*`,
      `¡Gracias por su consulta!`
    ];
    const encoded = encodeURIComponent(lines.join('\n'));
    try {
      window.open(`https://wa.me/?text=${encoded}`, '_blank');
    } catch (_openErr) {
      /* Entorno sin window.open */
    }
  }, [isIvaEnabled, effectiveIvaRate, taxLabel, taxUSD, isDollarCountry, totalBS, effectiveRate, businessInfo?.name, customerName, customerDoc, enrichedCart, subtotalUSD, totalUSD]);

  const handleSaveQuotation = useCallback(async () => {
    if (safeCart.length === 0) return;
    setIsProcessingSale(true);

    const resolvedCustomerId = selectedCustomer?.id
      || (Array.isArray(customers) ? customers.find(c => c.name === customerName)?.id : null)
      || null;

    const quotationData = {
      customerId: resolvedCustomerId,
      customerName: customerName || 'Consumidor Final',
      customerDocument: customerDoc || '',
      exchangeRate: effectiveRate,
      items: enrichedCart.map(item => ({
        productId: stripMobileProductSuffix(item.product.productId || item.product.id),
        name: item.product.name || item.product.nombre,
        quantity: Number(item.quantity),
        price: Number(item.product.price || item.product.precio || 0),
        promoDiscount: Number(item.promoDiscount || 0),
        subtotal: Number(item.finalSubtotal || 0)
      })),
      subtotal: Number(subtotalUSD.toFixed(2)),
      discount: Number(cartDiscountAmountUSD.toFixed(2)) || 0,
      discountPercent: Number(cartDiscountPercent) || 0,
      tax: Number(taxUSD.toFixed(2)),
      total: Number(totalUSD.toFixed(2)),
      status: 'pending',
      date: new Date().toISOString()
    };

    try {
      const res = await api.post('/quotations', quotationData, { timeout: 4500 });
      const quote = res.data || {};
      const quoteId = quote.id || `COT-${Date.now().toString().slice(-6)}`;
      showToast('✅ Presupuesto guardado en servidor');
      openQuotationWhatsApp(quoteId);
      resetCheckoutTransientState();
    } catch (err) {
      const httpStatus = err?.response?.status;
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        const msg = err?.response?.data?.error || err?.response?.data?.message || 'Cotización rechazada por el servidor';
        showToast(`⚠️ ${msg}`);
        return;
      }

      const offlineQuoteId = `COT-OFF-${Date.now().toString().slice(-6)}`;
      let queuedOk = false;
      try {
        await primaryDb.put('syncQueue', {
          id: `quote_sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tempLocalId: offlineQuoteId,
          endpoint: '/quotations',
          method: 'POST',
          payload: quotationData,
          createdAt: new Date().toISOString()
        });
        queuedOk = true;
      } catch (queueErr) {
        console.warn('[useMobileCheckoutFlow] Error respaldando cotización offline:', queueErr?.message || queueErr);
      }

      if (!queuedOk) {
        showToast('❌ No se pudo guardar la cotización offline. Intenta nuevamente.');
        return;
      }

      showToast(`⚡ Cotización ${offlineQuoteId} respaldada offline y lista en WhatsApp`);
      openQuotationWhatsApp(offlineQuoteId);
      resetCheckoutTransientState();
    } finally {
      setIsProcessingSale(false);
    }
  }, [
    safeCart.length, setIsProcessingSale, selectedCustomer?.id, customers,
    customerName, customerDoc, effectiveRate, enrichedCart, subtotalUSD,
    cartDiscountAmountUSD, cartDiscountPercent, taxUSD, totalUSD,
    showToast, openQuotationWhatsApp, resetCheckoutTransientState
  ]);

  const activeCurrencyMode = businessInfo?.currencyMode || localStorage.getItem('pos_currency_mode') || (isDollarCountry ? 'USD' : 'BOTH');

  const handlePrintBluetoothReceipt = useCallback(async (sale) => {
    if (!sale) return;
    try {
      const activePrinter = typeof mobilePrinterService.getActivePrinterSummary === 'function'
        ? mobilePrinterService.getActivePrinterSummary()
        : null;
      const isNative = typeof mobilePrinterService.isNativePlatform === 'function'
        && mobilePrinterService.isNativePlatform();

      if (isNative && activePrinter && !activePrinter.configured) {
        triggerHaptic(20);
        showToast('⚙️ Selecciona tu impresora Bluetooth o Wi-Fi primero');
        setIsThermalPrinterModalOpen(true);
        return;
      }

      const paperWidth = localStorage.getItem('pos_mobile_paper_width') || '58mm';
      mobilePrinterService.enqueueSalePrint({
        sale,
        businessSettings: {
          ...businessInfo,
          receiptWidth: paperWidth
        },
        exchangeRate: effectiveRate,
        currencyMode: activeCurrencyMode
      });
      triggerHaptic(15);
      playScanSound();
      showToast(
        activePrinter?.configured
          ? `🖨️ Imprimiendo en ${activePrinter.label}`
          : '🖨️ Enviado a la cola de impresión térmica'
      );
    } catch (printErr) {
      showToast(`❌ Error al imprimir por Bluetooth: ${printErr?.message || 'Impresora no disponible'}`);
      setIsThermalPrinterModalOpen(true);
    }
  }, [businessInfo, effectiveRate, activeCurrencyMode, showToast, setIsThermalPrinterModalOpen]);

  const handleConfirmSale = useCallback(async () => {
    if (isProcessingSale) return;
    if (safeCart.length === 0) return;
    if (documentType === 'cotizacion') {
      await handleSaveQuotation();
      return;
    }

    if (checkoutMode === 'split') {
      if (splitPaidUSD < totalDueUSD - 0.02) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Pago incompleto: faltan $${Math.max(0, totalDueUSD - splitPaidUSD).toFixed(2)}`);
        return;
      }
    } else if (canonicalSelectedMethod !== 'fiado') {
      const hasEnteredTender = String(amountPaidUSD || '').trim() !== '' || String(amountPaidBS || '').trim() !== '';
      if (hasEnteredTender && totalPaidInUSD < totalDueUSD - 0.02) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Monto recibido insuficiente: faltan $${Math.max(0, totalDueUSD - totalPaidInUSD).toFixed(2)}`);
        return;
      }
    }

    const isRefRequired = checkoutMode === 'express'
      ? ['pago_movil', 'debit', 'zelle', 'transfer', 'biopago', 'binance_usdt'].includes(canonicalSelectedMethod)
      : ((parseFloat(splitPayments.pago_movil) || 0) > 0
        || (parseFloat(splitPayments.tarjeta) || 0) > 0
        || (parseFloat(splitPayments.zelle) || 0) > 0
        || (parseFloat(splitPayments.binance) || 0) > 0);

    if (isRefRequired && !String(paymentReference || '').trim()) {
      triggerHaptic(30);
      playErrorSound();
      showToast('⚠️ Ingrese el número de referencia para liquidar este pago');
      return;
    }

    setIsProcessingSale(true);

    const persistentTransactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Detectar si el cajero combinó manualmente USD + Bs en modo Express
    const isExpressDualTender = checkoutMode === 'express'
      && paidUSD > 0
      && paidBS > 0
      && canonicalSelectedMethod !== 'fiado';

    const effectiveCanonicalMethod = checkoutMode === 'split'
      ? 'mixto'
      : isExpressDualTender
        ? 'mixto'
        : ((canonicalSelectedMethod === 'cash_usd' && paidBS > 0 && paidUSD <= 0) ? 'cash_bs' : canonicalSelectedMethod);

    const finalChangeUSD = checkoutMode === 'split' ? splitChangeUSD : changeUSD;
    const finalChangeBS = checkoutMode === 'split' ? splitChangeBS : changeBS;
    const isVesMethod = ['pago_movil', 'cash_bs', 'debit', 'biopago', 'transfer'].includes(effectiveCanonicalMethod);

    let normalizedPaymentMethods = [];
    const cleanRef = paymentReference ? String(paymentReference).trim() : '';

    if (checkoutMode === 'split') {
      const sUsd = parseFloat(splitPayments.cash_usd) || 0;
      const sBs = parseFloat(splitPayments.cash_bs) || 0;
      const sPm = parseFloat(splitPayments.pago_movil) || 0;
      const sCard = parseFloat(splitPayments.tarjeta) || 0;
      const sZelle = parseFloat(splitPayments.zelle) || 0;
      const sBinance = parseFloat(splitPayments.binance) || 0;
      const sCred = parseFloat(splitPayments.credito) || 0;

      if (sUsd > 0) normalizedPaymentMethods.push({ method: 'cash_usd', amount: round2(sUsd), currency: 'USD', convertedAmountUsd: round2(sUsd), reference: '' });
      if (sBs > 0) normalizedPaymentMethods.push({ method: 'cash_bs', amount: round2(sBs), currency: 'VES', convertedAmountUsd: round2(sBs / effectiveRate), reference: '' });
      if (sPm > 0) normalizedPaymentMethods.push({ method: 'pago_movil', amount: round2(sPm), currency: 'VES', convertedAmountUsd: round2(sPm / effectiveRate), reference: cleanRef });
      if (sCard > 0) normalizedPaymentMethods.push({ method: 'debit', amount: round2(sCard), currency: 'VES', convertedAmountUsd: round2(sCard / effectiveRate), reference: cleanRef });
      if (sZelle > 0) normalizedPaymentMethods.push({ method: 'zelle', amount: round2(sZelle), currency: 'USD', convertedAmountUsd: round2(sZelle), reference: cleanRef });
      if (sBinance > 0) normalizedPaymentMethods.push({ method: 'binance_usdt', amount: round2(sBinance), currency: 'USDT', convertedAmountUsd: round2(sBinance), reference: cleanRef });
      if (sCred > 0) normalizedPaymentMethods.push({ method: 'fiado', amount: round2(sCred), currency: 'USD', convertedAmountUsd: round2(sCred), reference: '' });
      if (normalizedPaymentMethods.length === 0) {
        normalizedPaymentMethods.push({ method: 'cash_usd', amount: totalDueUSD, currency: 'USD', convertedAmountUsd: totalDueUSD, reference: '' });
      }
    } else if (effectiveCanonicalMethod === 'mixto') {
      if (paidUSD > 0) normalizedPaymentMethods.push({ method: 'cash_usd', amount: round2(paidUSD), currency: 'USD', convertedAmountUsd: round2(paidUSD), reference: '' });
      if (paidBS > 0) normalizedPaymentMethods.push({ method: 'cash_bs', amount: round2(paidBS), currency: 'VES', convertedAmountUsd: round2(paidBS / effectiveRate), reference: '' });
      if (normalizedPaymentMethods.length === 0) {
        normalizedPaymentMethods.push({ method: 'cash_usd', amount: totalDueUSD, currency: 'USD', convertedAmountUsd: totalDueUSD, reference: '' });
      }
    } else {
      normalizedPaymentMethods = [{
        method: effectiveCanonicalMethod,
        amount: isVesMethod ? totalDueBS : totalDueUSD,
        currency: effectiveCanonicalMethod === 'binance_usdt' ? 'USDT' : (isVesMethod ? 'VES' : 'USD'),
        convertedAmountUsd: totalDueUSD,
        reference: cleanRef
      }];
    }

    const resolvedCustomerId = selectedCustomer?.id
      || (customerName && customerName !== 'Consumidor Final' && Array.isArray(customers)
        ? customers.find(c => c.name === customerName)?.id || null
        : null);

    const receivedAmountFinal = checkoutMode === 'split'
      ? round2(splitPaidUSD > 0 ? splitPaidUSD : totalDueUSD)
      : round2(totalPaidInUSD > 0 ? totalPaidInUSD : totalDueUSD);

    const salePayload = {
      id: persistentTransactionId,
      clientTransactionId: persistentTransactionId,
      customerId: resolvedCustomerId,
      items: enrichedCart.map(item => ({
        productId: stripMobileProductSuffix(item.product.productId || item.product.id),
        name: item.product.name || item.product.nombre,
        quantity: Number(item.quantity),
        price: Number(item.product.price || item.product.precio || 0),
        cost: Number(item.product.cost || item.product.costo || 0),
        category: item.product.category || item.product.categoria || 'General',
        taxStatus: item.product.taxStatus || (item.product.isExempt ? 'exento' : 'gravable'),
        promoDiscount: Number(item.promoDiscount || 0),
        appliedPromoName: item.appliedPromoName || null,
        subtotal: Number(item.finalSubtotal || 0),
        isCustom: Boolean(item.product.isCustom),
        selectedVariant: item.product.selectedVariant || null,
        recipe: item.product.recipe || null,
        batchNumber: item.product.batchNumber || null,
        expirationDate: item.product.expirationDate || null,
        es_controlado: Boolean(item.product.es_controlado),
        presentationId: item.product.presentationId || null,
        presentationName: item.product.presentationName || null,
        factorConversion: Number(item.product.factorConversion || item.product.unitsMultiplier) || 1,
        isBulk: Boolean(item.product.isBulk),
        unitsPerBulk: Number(item.product.unitsPerBulk) || 1,
        bulkPrice: Number(item.product.bulkPrice) || 0,
        bulkUnitName: item.product.bulkUnitName || '',
        isMidBulk: Boolean(item.product.isMidBulk),
        unitsPerMidBulk: Number(item.product.unitsPerMidBulk) || 1,
        midBulkPrice: Number(item.product.midBulkPrice) || 0,
        midBulkUnitName: item.product.midBulkUnitName || ''
      })),
      subtotal: rawSubtotalUSD,
      discount: cartDiscountAmountUSD,
      discountPercent: Number(cartDiscountPercent) || 0,
      promoDiscount: totalPromoSavings,
      appliedPromotions: Array.isArray(promoResult.appliedPromotions) ? promoResult.appliedPromotions : [],
      supervisorApprovalId: discountSupervisorApprovalId || null,
      tax: taxUSD,
      igtf: currentIgtfUSD,
      igtfAmount: currentIgtfUSD,
      total: totalDueUSD,
      exchangeRate: effectiveRate,
      paymentMethod: effectiveCanonicalMethod,
      paymentReference: cleanRef || null,
      paymentMethods: normalizedPaymentMethods,
      receivedAmount: receivedAmountFinal,
      changeAmount: finalChangeUSD,
      changeUSD: finalChangeUSD,
      changeBS: finalChangeBS,
      documentType: documentType || 'factura',
      splitDetails: checkoutMode === 'split' ? splitPayments : null,
      customerName: customerName || 'Consumidor Final',
      customerDoc: customerDoc || (isDollarCountry ? '0000000000' : 'V-00000000'),
      registerId: 'Caja Móvil',
      terminalId: getTerminalId(),
      notes: cleanRef ? `Ref: ${cleanRef}` : (documentType === 'nota_entrega' ? 'Nota de Entrega' : 'Venta Terminal Móvil')
    };

    const deductLocalInventory = async () => {
      setProducts(prev => prev.map(p => {
        const cartItemsForProd = safeCart.filter(c => getCleanProductId(c.product.productId || c.product.id) === String(p.id));
        if (cartItemsForProd.length > 0) {
          const totalUnitsToDeduct = cartItemsForProd.reduce((sum, item) => {
            const mult = getProductUnitsMultiplier(item.product);
            return sum + (Number(item.quantity) * mult);
          }, 0);
          const currentStock = Number(p.stockQuantity ?? p.stock ?? 0);
          const nextStock = Math.max(0, currentStock - totalUnitsToDeduct);
          return { ...p, stockQuantity: nextStock, stock: nextStock };
        }
        return p;
      }));

      try {
        if (localDb && localDb.products) {
          await localDb.transaction('rw', localDb.products, async () => {
            const deductedByCleanId = new Map();
            for (const item of enrichedCart) {
              const cleanId = getCleanProductId(item.product.productId || item.product.id);
              const mult = getProductUnitsMultiplier(item.product);
              const unitsToDeduct = Number(item.quantity) * mult;
              deductedByCleanId.set(cleanId, (deductedByCleanId.get(cleanId) || 0) + unitsToDeduct);
            }
            for (const [cleanId, totalUnitsToDeduct] of deductedByCleanId.entries()) {
              // Priorizar lectura fresca de BD antes que snapshot React para evitar sobrescribir ventas consecutivas
              const currentProd = (await localDb.products.get(cleanId)) || productsMap.get(cleanId);
              if (currentProd) {
                const currentStock = Number(currentProd.stockQuantity ?? currentProd.stock ?? 0);
                const newStock = Math.max(0, currentStock - totalUnitsToDeduct);
                await localDb.products.update(cleanId, { stockQuantity: newStock, stock: newStock });
              }
            }
          });
        }
      } catch (caughtErr) {
        console.warn('[useMobileCheckoutFlow] Error en deducción atómica IndexedDB:', caughtErr?.message || caughtErr);
      }
    };

    try {
      const res = await api.post('/sales', salePayload, { timeout: 4500 });
      const createdSale = res.data?.sale || res.data || {};
      const invoiceNum = createdSale.invoiceNumber || (documentType === 'nota_entrega' ? `NE-${Math.floor(100000 + Math.random() * 900000)}` : `FAC-${Math.floor(100000 + Math.random() * 900000)}`);

      const now = new Date();
      const nowIso = now.toISOString();
      const completedSaleRecord = {
        ...salePayload,
        id: String(createdSale.id || persistentTransactionId),
        invoiceNumber: invoiceNum,
        date: nowIso,
        displayTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        created_at: createdSale.createdAt || nowIso,
        items: [...enrichedCart],
        subtotalUSD,
        taxUSD,
        igtfUSD: currentIgtfUSD,
        baseImponibleUSD,
        totalUSD: totalDueUSD,
        totalBS: totalDueBS,
        method: effectiveCanonicalMethod,
        changeUSD: finalChangeUSD,
        changeBS: finalChangeBS,
        status: 'synced',
        isOffline: false
      };

      try {
        await primaryDb.put('sales', completedSaleRecord);
      } catch (caughtErr) {
        console.warn('[useMobileCheckoutFlow] Error guardando venta en BD local:', caughtErr?.message || caughtErr);
      }

      await deductLocalInventory();

      try {
        lanSyncService.broadcastSale(completedSaleRecord);
      } catch (caughtErr) {
        console.warn('[useMobileCheckoutFlow] Error propagando evento LAN:', caughtErr?.message || caughtErr);
      }

      setSalesHistory(prev => [completedSaleRecord, ...prev]);

      if (autoPrint) {
        mobilePrinterService.enqueueSalePrint({
          sale: completedSaleRecord,
          businessSettings: {
            ...businessInfo,
            receiptWidth: localStorage.getItem('pos_mobile_paper_width') || '58mm'
          },
          exchangeRate: effectiveRate,
          currencyMode: activeCurrencyMode
        });
        setPrintedReceipt(completedSaleRecord);
      }

      resetCheckoutTransientState();
      playSuccessSound();
      showToast(`¡Venta #${invoiceNum} registrada en servidor PC!`);
    } catch (err) {
      console.warn('[useMobileCheckoutFlow] Error capturado en operación:', err?.message || err);
      const httpStatus = err?.response?.status;
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        const serverErrMsg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Venta rechazada por el servidor';
        showToast(serverErrMsg, 'error');
        return;
      }

      console.warn('[OFFLINE-ENGINE] Servidor PC no disponible o timeout de red. Persistiendo con ID inmutable:', persistentTransactionId);

      const offlineId = persistentTransactionId;
      const offlineInvoiceNum = `MOV-OFF-${persistentTransactionId.slice(-6).toUpperCase()}`;

      const nowOffline = new Date();
      const nowOfflineIso = nowOffline.toISOString();
      const offlineSaleRecord = {
        ...salePayload,
        id: String(offlineId),
        clientTransactionId: String(offlineId),
        terminalId: getTerminalId(),
        invoiceNumber: offlineInvoiceNum,
        date: nowOfflineIso,
        displayTime: nowOffline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        items: Array.isArray(salePayload.items) ? [...salePayload.items] : [],
        displayItems: [...enrichedCart],
        subtotalUSD,
        taxUSD,
        igtfUSD: currentIgtfUSD,
        baseImponibleUSD,
        totalUSD: totalDueUSD,
        totalBS: totalDueBS,
        method: effectiveCanonicalMethod,
        changeUSD: finalChangeUSD,
        changeBS: finalChangeBS,
        status: 'pending_sync',
        isOffline: true,
        created_at: nowOfflineIso
      };

      try {
        await primaryDb.put('sales', offlineSaleRecord);
      } catch (storeErr) {
        console.error('[useMobileCheckoutFlow] Error crítico guardando venta offline:', storeErr);
        showToast('❌ Error guardando venta en almacenamiento local. No se vació el carrito.');
        return;
      }

      await deductLocalInventory();

      setSalesHistory(prev => [offlineSaleRecord, ...prev]);
      setPendingSalesCount(prev => prev + 1);

      if (autoPrint) {
        mobilePrinterService.enqueueSalePrint({
          sale: offlineSaleRecord,
          businessSettings: {
            ...businessInfo,
            receiptWidth: localStorage.getItem('pos_mobile_paper_width') || '58mm'
          },
          exchangeRate: effectiveRate,
          currencyMode: activeCurrencyMode
        });
        setPrintedReceipt(offlineSaleRecord);
      }

      resetCheckoutTransientState();
      playSuccessSound();
      showToast(`⚡ Venta #${offlineInvoiceNum} guardada offline. Se sincronizará al conectar con la PC.`);
    } finally {
      setIsProcessingSale(false);
    }
  }, [
    isProcessingSale, safeCart, documentType, handleSaveQuotation, checkoutMode,
    splitPaidUSD, totalDueUSD, canonicalSelectedMethod, amountPaidUSD, amountPaidBS,
    totalPaidInUSD, splitPayments, paymentReference, setIsProcessingSale,
    paidBS, paidUSD, splitChangeUSD, splitChangeBS, changeUSD, changeBS, effectiveRate, totalDueBS,
    selectedCustomer?.id, customers, customerName, customerDoc, enrichedCart,
    rawSubtotalUSD, subtotalUSD, cartDiscountAmountUSD, cartDiscountPercent,
    totalPromoSavings, promoResult.appliedPromotions, discountSupervisorApprovalId,
    taxUSD, currentIgtfUSD, isDollarCountry, baseImponibleUSD, setProducts,
    getCleanProductId, getProductUnitsMultiplier, productsMap, setSalesHistory,
    autoPrint, businessInfo, activeCurrencyMode, setPrintedReceipt,
    resetCheckoutTransientState, showToast, setPendingSalesCount
  ]);

  const generateEcoReceiptText = useCallback((sale) => {
    if (!sale) return '';
    const company = businessInfo?.name || localStorage.getItem('company_name') || 'Isaac POS';
    const rif = businessInfo?.rif || localStorage.getItem('company_rif') || '';
    const address = businessInfo?.address || localStorage.getItem('company_address') || '';

    const rawSaleDate = sale.created_at || sale.createdAt || sale.date || sale.timestamp;
    const parsedSaleDate = rawSaleDate ? new Date(rawSaleDate) : null;
    const formattedSaleDate = sale.displayTime
      || (parsedSaleDate && !Number.isNaN(parsedSaleDate.getTime())
        ? parsedSaleDate.toLocaleString('es-VE')
        : (rawSaleDate || new Date().toLocaleString('es-VE')));

    const bsLines = !isDollarCountry
      ? [
          `*TOTAL BS: Bs. ${Number(sale.totalBS || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`,
          `Tasa Oficial: Bs. ${Number(sale.exchangeRate || effectiveRate).toFixed(2)}`
        ]
      : [];

    const lines = [
      `🧾 *COMPROBANTE DIGITAL DE COMPRA*`,
      `🏢 *${company.toUpperCase()}*`,
      ...(rif ? [`🔖 ${regionCfg.taxIdLabel || 'RIF'}: ${rif}`] : []),
      ...(address ? [`📍 ${address}`] : []),
      `--------------------------------`,
      `N° Documento: *${sale.invoiceNumber || sale.code || 'TICKET'}*`,
      `Fecha: ${formattedSaleDate}`,
      `Cliente: *${sale.customerName || 'Consumidor Final'}* ${sale.customerDoc ? `(${sale.customerDoc})` : ''}`,
      `Atendido por: ${user?.name || user?.username || 'Cajero'}`,
      `--------------------------------`,
      `🛒 *DETALLE DE PRODUCTOS:*`,
      ...(Array.isArray(sale.displayItems || sale.items) ? (sale.displayItems || sale.items).map(item => {
        const q = item.quantity || 1;
        const name = item.product?.name || item.name || item.product?.nombre || 'Producto';
        const price = Number(item.finalSubtotal || item.subtotal || (item.price * q) || (item.product?.price * q) || 0).toFixed(2);
        return `• ${q}x ${name} = $${price}`;
      }) : []),
      `--------------------------------`,
      `Subtotal: $${Number(sale.subtotalUSD || sale.subtotal || sale.totalUSD || sale.total || 0).toFixed(2)}`,
      ...(sale.promoDiscount > 0 ? [`Promociones: -$${Number(sale.promoDiscount).toFixed(2)}`] : []),
      ...(sale.discount > 0 ? [`Descuento: -$${Number(sale.discount).toFixed(2)}`] : []),
      ...(sale.igtf > 0 || sale.igtfUSD > 0 ? [`IGTF: +$${Number(sale.igtf || sale.igtfUSD).toFixed(2)}`] : []),
      `*TOTAL USD: $${Number(sale.totalUSD || sale.total || 0).toFixed(2)}*`,
      ...bsLines,
      `Forma de Pago: *${sale.method || sale.paymentMethod || 'Efectivo'}*`,
      ...(sale.paymentReference || (Array.isArray(sale.paymentMethods) && sale.paymentMethods[0]?.reference)
        ? [`Ref. Operación: *#${sale.paymentReference || sale.paymentMethods[0]?.reference}*`]
        : []),
      ...(sale.changeUSD > 0 ? [`Cambio Devuelto: $${Number(sale.changeUSD).toFixed(2)}${!isDollarCountry ? ` (Bs. ${Number(sale.changeBS || 0).toFixed(2)})` : ''}`] : []),
      `--------------------------------`,
      `🌱 *Recibo Ecológico - Cuidemos el planeta*`,
      `¡Gracias por su compra!`
    ];

    return lines.join('\n');
  }, [businessInfo, regionCfg.taxIdLabel, isDollarCountry, user, effectiveRate]);

  return {
    promoResult,
    rawSubtotalUSD,
    totalPromoSavings,
    cartDiscountAmountUSD,
    subtotalUSD,
    enrichedCart,
    taxUSD,
    effectiveIvaRate,
    taxLabel,
    isIvaEnabled,
    baseImponibleUSD,
    totalUSD,
    totalBS,
    totalItemsCount,
    isIgtfEnabled,
    igtfRatePct,
    isBinanceIgtfEnabled,
    currentIgtfUSD,
    totalDueUSD,
    totalDueBS,
    paidUSD,
    paidBS,
    totalPaidInUSD,
    changeUSD,
    changeBS,
    splitPaidUSD,
    splitRemainingUSD,
    splitChangeUSD,
    splitChangeBS,
    activeCurrencyMode,
    effectiveRate,
    handleApplyDiscount,
    handleSelectPaymentMethod,
    handleSaveQuotation,
    handlePrintBluetoothReceipt,
    handleConfirmSale,
    generateEcoReceiptText
  };
}
