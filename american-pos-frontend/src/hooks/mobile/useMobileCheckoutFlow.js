import { useMemo, useCallback } from 'react';
import api from '../../services/api';
import localDb from '../../db/localDb';
import { db as primaryDb } from '../../services/db';
import lanSyncService from '../../services/lanSyncService';
import mobilePrinterService from '../../services/mobilePrinterService';
import { evaluateCartPromotions } from '../../utils/promotionsEngine';
import { triggerHaptic } from '../../utils/haptics';
import { playScanSound, playSuccessSound, playErrorSound } from '../../utils/sounds';
import { getTerminalId } from '../../utils/terminalIdentity';
import { normalizeMobileCartItems } from '../../store/useMobilePosStore';

/**
 * useMobileCheckoutFlow
 * Hook modularizado para cálculo de promociones, totales multimoneda (USD/VES + IGTF),
 * cotizaciones y despacho de ventas online/offline con idempotencia UUID v4.
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
  businessInfo,
  documentType,
  checkoutMode,
  splitPayments,
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
  customerName,
  customerDoc,
  isDollarCountry,
  autoPrint,
  user,
  requestSupervisorAuth,
  showToast
}) {
  const promoResult = useMemo(() => {
    const safeCart = normalizeMobileCartItems(cart);
    const flattenedItems = safeCart.map(item => ({
      ...item.product,
      id: item.product.id,
      name: item.product.name || item.product.nombre,
      price: Number(item.product.price || item.product.precio || 0),
      quantity: Number(item.quantity) || 1,
      category: item.product.category || item.product.categoria || ''
    }));
    return evaluateCartPromotions(flattenedItems, promotions);
  }, [cart, promotions]);

  const {
    cartDiscountAmountUSD,
    subtotalUSD,
    enrichedCart,
    taxUSD,
    baseImponibleUSD,
    totalUSD,
    totalBS,
    totalItemsCount
  } = useMemo(() => {
    const safeCart = normalizeMobileCartItems(cart);
    const rawSub = safeCart.reduce((acc, item) => acc + ((item.product.price || item.product.precio || 0) * item.quantity), 0);
    const promoSavings = promoResult.totalPromoSavings || 0;
    const subBeforeDisc = promoResult.finalCartSubtotal ?? rawSub;
    const cartDisc = Number((subBeforeDisc * (cartDiscountPercent / 100)).toFixed(2));
    const subUSD = Math.max(0, subBeforeDisc - cartDisc);

    const enriched = safeCart.map(item => {
      const promoItem = (promoResult.itemsWithPromotions || []).find(p => String(p.id) === String(item.product.id));
      return {
        ...item,
        appliedPromoName: promoItem?.appliedPromoName || null,
        promoDiscount: promoItem?.promoDiscount || 0,
        finalSubtotal: promoItem?.finalSubtotal ?? ((item.product.price || item.product.precio || 0) * item.quantity)
      };
    });

    const taxableSubBeforeDisc = enriched.reduce((acc, item) => {
      const isExempt = item.product.taxStatus === 'exento' || Boolean(item.product.isExempt) || Boolean(item.product.is_exempt) || Boolean(item.product.taxExempt);
      return isExempt ? acc : acc + Number(item.finalSubtotal || 0);
    }, 0);

    const discRatio = subBeforeDisc > 0 ? (subUSD / subBeforeDisc) : 1;
    const effTaxable = Number((taxableSubBeforeDisc * discRatio).toFixed(2));

    const configuredIvaPct = Number(businessInfo?.ivaRate ?? businessInfo?.taxRate ?? 16) || 16;
    const ivaDivisor = 1 + (configuredIvaPct / 100);
    const tUSD = Number(Math.max(0, effTaxable - (effTaxable / ivaDivisor)).toFixed(2));
    const baseImp = Number((effTaxable - tUSD).toFixed(2));
    const exUSD = Number(Math.max(0, subUSD - effTaxable).toFixed(2));
    const totUSD = subUSD;
    const totBS = totUSD * exchangeRate;
    const totItems = cart.reduce((acc, item) => acc + item.quantity, 0);

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
  }, [cart, promoResult, cartDiscountPercent, exchangeRate, businessInfo?.ivaRate, businessInfo?.taxRate]);

  const isIgtfEnabled = Boolean(
    businessInfo?.taxConfig?.igtfEnabled !== undefined
      ? businessInfo.taxConfig.igtfEnabled
      : businessInfo?.igtfEnabled
  );
  const igtfRatePct = Number(businessInfo?.taxConfig?.igtfRate ?? businessInfo?.igtfRate ?? 3) || 3;
  const isBinanceIgtfEnabled = Boolean(
    businessInfo?.binanceIgtfEnabled ?? businessInfo?.taxConfig?.binanceIgtfEnabled
  );

  const currentIgtfUSD = useMemo(() => {
    if (!isIgtfEnabled || documentType === 'cotizacion' || totalUSD <= 0) return 0;
    const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
    const factor = 1 + (igtfRatePct / 100);
    if (checkoutMode === 'split') {
      const sUsd = parseFloat(splitPayments.cash_usd) || 0;
      if (sUsd <= 0) return 0;
      const appliedPrincipal = Math.min(totalUSD, sUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    const methodNorm = String(selectedMethod || '').toLowerCase().trim();
    const isCrypto = methodNorm === 'binance' || methodNorm === 'binance_usdt';
    const isExemptUsd = methodNorm === 'zelle' || methodNorm === 'crédito' || methodNorm === 'credito' || methodNorm === 'fiado' || (isCrypto && !isBinanceIgtfEnabled);
    const isVesOnly = ['efectivo bs', 'pago móvil', 'pago movil', 'tarjeta', 'punto de venta', 'biopago', 'cash_bs', 'pago_movil', 'debit'].includes(methodNorm);
    if (isExemptUsd || isVesOnly) return 0;
    if (methodNorm === 'mixto') {
      const enteredUsd = parseFloat(amountPaidUSD) || 0;
      if (enteredUsd <= 0) return 0;
      const appliedPrincipal = Math.min(totalUSD, enteredUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    const enteredUsd = parseFloat(amountPaidUSD) || 0;
    const enteredBs = parseFloat(amountPaidBS) || 0;
    if (enteredBs > 0 && enteredUsd <= 0) return 0;
    if (enteredUsd > 0) {
      const appliedPrincipal = Math.min(totalUSD, enteredUsd / factor);
      return round2(appliedPrincipal * (igtfRatePct / 100));
    }
    return round2(totalUSD * (igtfRatePct / 100));
  }, [isIgtfEnabled, isBinanceIgtfEnabled, igtfRatePct, documentType, totalUSD, checkoutMode, splitPayments.cash_usd, selectedMethod, amountPaidUSD, amountPaidBS]);

  const totalDueUSD = useMemo(() => Number((totalUSD + currentIgtfUSD).toFixed(2)), [totalUSD, currentIgtfUSD]);
  const totalDueBS = useMemo(() => Number((totalDueUSD * exchangeRate).toFixed(2)), [totalDueUSD, exchangeRate]);

  const { paidUSD, paidBS, totalPaidInUSD, changeUSD, changeBS } = useMemo(() => {
    const pUSD = parseFloat(amountPaidUSD) || 0;
    const pBS = parseFloat(amountPaidBS) || 0;
    const totPaidUSD = pUSD + (pBS / (exchangeRate || 1));
    const chUSD = Math.max(0, totPaidUSD - totalDueUSD);
    const chBS = chUSD * (exchangeRate || 1);
    return { paidUSD: pUSD, paidBS: pBS, totalPaidInUSD: totPaidUSD, changeUSD: chUSD, changeBS: chBS };
  }, [amountPaidUSD, amountPaidBS, exchangeRate, totalDueUSD]);

  const splitPaidUSD = useMemo(() => {
    const usdCash = parseFloat(splitPayments.cash_usd) || 0;
    const zelle = parseFloat(splitPayments.zelle) || 0;
    const credit = parseFloat(splitPayments.credito) || 0;
    const bsCash = parseFloat(splitPayments.cash_bs) || 0;
    const pagoMovil = parseFloat(splitPayments.pago_movil) || 0;
    const debit = parseFloat(splitPayments.tarjeta) || 0;
    const bsTotalInUSD = (bsCash + pagoMovil + debit) / (exchangeRate || 1);
    return usdCash + zelle + credit + bsTotalInUSD;
  }, [splitPayments, exchangeRate]);

  const splitRemainingUSD = Math.max(0, totalDueUSD - splitPaidUSD);
  const splitChangeUSD = Math.max(0, splitPaidUSD - totalDueUSD);

  const handleApplyDiscount = useCallback((pct) => {
    if (pct > 10) {
      requestSupervisorAuth(
        'Autorizar Descuento Especial',
        `Descuento del ${pct}% requiere aprobación de supervisor`,
        (approvalData) => {
          setCartDiscountPercent(pct);
          setDiscountSupervisorApprovalId(approvalData?.id || null);
          showToast(`✅ Descuento de ${pct}% autorizado`);
        },
        'discount'
      );
    } else {
      setCartDiscountPercent(pct);
      if (pct === 0) setDiscountSupervisorApprovalId(null);
    }
  }, [requestSupervisorAuth, setCartDiscountPercent, setDiscountSupervisorApprovalId, showToast]);

  const handleSelectPaymentMethod = useCallback((method) => {
    setSelectedMethod(method);
    const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
    if (method === 'Efectivo Bs' || method === 'Pago Móvil' || method === 'Tarjeta' || method === 'Punto de Venta') {
      setAmountPaidBS(totalBS.toFixed(2));
      setAmountPaidUSD('');
    } else if (method === 'Efectivo USD') {
      const usdDue = isIgtfEnabled ? round2(totalUSD * (1 + (igtfRatePct / 100))) : totalUSD;
      setAmountPaidUSD(usdDue.toFixed(2));
      setAmountPaidBS('');
    } else if (method === 'Zelle') {
      setAmountPaidUSD(totalUSD.toFixed(2));
      setAmountPaidBS('');
    } else if (method === 'Mixto') {
      const halfUSD = totalUSD / 2;
      const halfIgtf = isIgtfEnabled ? round2(halfUSD * (igtfRatePct / 100)) : 0;
      setAmountPaidUSD((halfUSD + halfIgtf).toFixed(2));
      setAmountPaidBS((halfUSD * exchangeRate).toFixed(2));
    } else if (method === 'Crédito') {
      setAmountPaidUSD('0.00');
      setAmountPaidBS('0.00');
    }
  }, [setSelectedMethod, totalBS, setAmountPaidBS, setAmountPaidUSD, isIgtfEnabled, totalUSD, igtfRatePct, exchangeRate]);

  const handleSaveQuotation = useCallback(async () => {
    if (cart.length === 0) return;
    setIsProcessingSale(true);

    const quotationData = {
      customerId: (Array.isArray(customers) ? customers.find(c => c.name === customerName)?.id : null) || null,
      customerName: customerName || 'Consumidor Final',
      customerDocument: customerDoc || '',
      items: enrichedCart.map(item => ({
        productId: String(item.product.id),
        name: item.product.name || item.product.nombre,
        quantity: Number(item.quantity),
        price: Number(item.product.price || item.product.precio || 0),
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

      const lines = [
        `📋 *PRESUPUESTO / COTIZACIÓN*`,
        `Comercio: *${businessInfo.name || 'Isaac POS'}*`,
        `Nº Presupuesto: *${quoteId}*`,
        `Fecha: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        `Cliente: *${customerName}* (${customerDoc})`,
        `--------------------------------`,
        ...enrichedCart.map(i => `• ${i.quantity}x ${i.product.name || i.product.nombre} = $${Number(i.finalSubtotal).toFixed(2)}`),
        `--------------------------------`,
        `Subtotal: $${subtotalUSD.toFixed(2)}`,
        `IVA (16%): $${taxUSD.toFixed(2)}`,
        `*TOTAL USD: $${totalUSD.toFixed(2)}*`,
        `*TOTAL BS: Bs. ${totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`,
        `Tasa Oficial: Bs. ${exchangeRate.toFixed(2)}`,
        `--------------------------------`,
        `*Validez de la oferta: 3 días continuos*`,
        `¡Gracias por su consulta!`
      ];
      const encoded = encodeURIComponent(lines.join('\n'));
      window.open(`https://wa.me/?text=${encoded}`, '_blank');

      setCart([]);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
    } catch (_err) {
      showToast('⚡ Cotización generada (modo offline)');
      setCart([]);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
    } finally {
      setIsProcessingSale(false);
    }
  }, [
    cart.length, setIsProcessingSale, customers, customerName, customerDoc,
    enrichedCart, subtotalUSD, cartDiscountAmountUSD, cartDiscountPercent,
    taxUSD, totalUSD, showToast, businessInfo?.name, totalBS, exchangeRate,
    setCart, setIsCheckoutOpen, setIsMobileCartOpen
  ]);

  const activeCurrencyMode = businessInfo?.currencyMode || localStorage.getItem('pos_currency_mode') || (isDollarCountry ? 'USD' : 'BOTH');

  const handlePrintBluetoothReceipt = useCallback(async (sale) => {
    if (!sale) return;
    try {
      const paperWidth = localStorage.getItem('pos_mobile_paper_width') || '58mm';
      mobilePrinterService.enqueueSalePrint({
        sale,
        businessSettings: {
          ...businessInfo,
          receiptWidth: paperWidth
        },
        exchangeRate,
        currencyMode: activeCurrencyMode
      });
      triggerHaptic(15);
      playScanSound();
      showToast('🖨️ Enviado a la cola de impresión térmica');
    } catch (printErr) {
      alert(`Error al encolar impresión Bluetooth: ${printErr.message}`);
      setIsThermalPrinterModalOpen(true);
    }
  }, [businessInfo, exchangeRate, activeCurrencyMode, showToast, setIsThermalPrinterModalOpen]);

  const handleConfirmSale = useCallback(async () => {
    if (isProcessingSale) return;
    if (cart.length === 0) return;
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
    } else if (selectedMethod !== 'Crédito' && selectedMethod !== 'fiado') {
      const hasEnteredTender = String(amountPaidUSD || '').trim() !== '' || String(amountPaidBS || '').trim() !== '';
      if (hasEnteredTender && totalPaidInUSD < totalDueUSD - 0.02) {
        triggerHaptic(30);
        playErrorSound();
        showToast(`⚠️ Monto recibido insuficiente: faltan $${Math.max(0, totalDueUSD - totalPaidInUSD).toFixed(2)}`);
        return;
      }
    }

    const isRefRequired = checkoutMode === 'express'
      ? ['pago móvil', 'pago movil', 'tarjeta', 'punto de venta', 'zelle', 'transferencia', 'biopago'].some(m => String(selectedMethod || '').toLowerCase().includes(m))
      : ((parseFloat(splitPayments.pago_movil) || 0) > 0 || (parseFloat(splitPayments.tarjeta) || 0) > 0 || (parseFloat(splitPayments.zelle) || 0) > 0);

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

    const effectiveMethod = checkoutMode === 'split'
      ? 'Mixto / Dividido'
      : ((selectedMethod === 'Efectivo USD' && paidBS > 0 && paidUSD <= 0) ? 'Efectivo Bs' : selectedMethod);
    const finalChangeUSD = checkoutMode === 'split' ? splitChangeUSD : changeUSD;
    const finalChangeBS = finalChangeUSD * exchangeRate;

    const isVesMethod = ['Pago Móvil', 'Efectivo Bs', 'Punto de Venta', 'Tarjeta', 'Biopago', 'pago_movil', 'cash_bs', 'debit', 'biopago'].includes(effectiveMethod);

    let normalizedPaymentMethods = [];
    if (checkoutMode === 'split') {
      const sUsd = parseFloat(splitPayments.cash_usd) || 0;
      const sBs = parseFloat(splitPayments.cash_bs) || 0;
      const sPm = parseFloat(splitPayments.pago_movil) || 0;
      const sCard = parseFloat(splitPayments.tarjeta) || 0;
      const sZelle = parseFloat(splitPayments.zelle) || 0;
      const sCred = parseFloat(splitPayments.credito) || 0;

      if (sUsd > 0) normalizedPaymentMethods.push({ method: 'cash_usd', amount: sUsd, currency: 'USD', convertedAmountUsd: sUsd, reference: '' });
      if (sBs > 0) normalizedPaymentMethods.push({ method: 'cash_bs', amount: sBs, currency: 'VES', convertedAmountUsd: Number((sBs / (exchangeRate || 1)).toFixed(2)), reference: '' });
      if (sPm > 0) normalizedPaymentMethods.push({ method: 'pago_movil', amount: sPm, currency: 'VES', convertedAmountUsd: Number((sPm / (exchangeRate || 1)).toFixed(2)), reference: paymentReference ? String(paymentReference).trim() : '' });
      if (sCard > 0) normalizedPaymentMethods.push({ method: 'debit', amount: sCard, currency: 'VES', convertedAmountUsd: Number((sCard / (exchangeRate || 1)).toFixed(2)), reference: paymentReference ? String(paymentReference).trim() : '' });
      if (sZelle > 0) normalizedPaymentMethods.push({ method: 'zelle', amount: sZelle, currency: 'USD', convertedAmountUsd: sZelle, reference: paymentReference ? String(paymentReference).trim() : '' });
      if (sCred > 0) normalizedPaymentMethods.push({ method: 'fiado', amount: sCred, currency: 'USD', convertedAmountUsd: sCred, reference: '' });
      if (normalizedPaymentMethods.length === 0) {
        normalizedPaymentMethods.push({ method: 'cash_usd', amount: Number(totalDueUSD.toFixed(2)), currency: 'USD', convertedAmountUsd: Number(totalDueUSD.toFixed(2)), reference: '' });
      }
    } else if (effectiveMethod === 'Mixto') {
      const mUsd = paidUSD > 0 ? paidUSD : 0;
      const mBs = paidBS > 0 ? paidBS : 0;
      if (mUsd > 0) normalizedPaymentMethods.push({ method: 'cash_usd', amount: Number(mUsd.toFixed(2)), currency: 'USD', convertedAmountUsd: Number(mUsd.toFixed(2)), reference: '' });
      if (mBs > 0) normalizedPaymentMethods.push({ method: 'cash_bs', amount: Number(mBs.toFixed(2)), currency: 'VES', convertedAmountUsd: Number((mBs / (exchangeRate || 1)).toFixed(2)), reference: '' });
      if (normalizedPaymentMethods.length === 0) {
        normalizedPaymentMethods.push({ method: 'cash_usd', amount: Number(totalDueUSD.toFixed(2)), currency: 'USD', convertedAmountUsd: Number(totalDueUSD.toFixed(2)), reference: '' });
      }
    } else {
      normalizedPaymentMethods = [{
        method: effectiveMethod === 'Crédito' ? 'fiado' : effectiveMethod,
        amount: isVesMethod ? Number(totalDueBS.toFixed(2)) : Number(totalDueUSD.toFixed(2)),
        currency: isVesMethod ? 'VES' : 'USD',
        convertedAmountUsd: Number(totalDueUSD.toFixed(2)),
        reference: paymentReference ? String(paymentReference).trim() : ''
      }];
    }

    const salePayload = {
      id: persistentTransactionId,
      clientTransactionId: persistentTransactionId,
      items: enrichedCart.map(item => ({
        productId: String(item.product.productId || item.product.id).replace(/__bulk$|__mid$|__pres_.*$/, ''),
        name: item.product.name || item.product.nombre,
        quantity: Number(item.quantity),
        price: Number(item.product.price || item.product.precio || 0),
        subtotal: Number(item.finalSubtotal || 0),
        isCustom: Boolean(item.product.isCustom),
        selectedVariant: item.product.selectedVariant || null,
        recipe: item.product.recipe || null,
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
      subtotal: Number(subtotalUSD.toFixed(2)),
      discount: Number(cartDiscountAmountUSD.toFixed(2)) || 0,
      discountPercent: Number(cartDiscountPercent) || 0,
      supervisorApprovalId: discountSupervisorApprovalId || null,
      tax: Number(taxUSD.toFixed(2)),
      igtf: Number(currentIgtfUSD.toFixed(2)),
      igtfAmount: Number(currentIgtfUSD.toFixed(2)),
      total: Number(totalDueUSD.toFixed(2)),
      exchangeRate: Number(exchangeRate),
      paymentMethod: effectiveMethod === 'Crédito' ? 'fiado' : effectiveMethod,
      paymentReference: paymentReference ? String(paymentReference).trim() : null,
      paymentMethods: normalizedPaymentMethods,
      receivedAmount: Number((totalPaidInUSD > 0 ? totalPaidInUSD : totalDueUSD).toFixed(2)),
      changeAmount: Number(finalChangeUSD.toFixed(2)),
      changeUSD: Number(finalChangeUSD.toFixed(2)),
      changeBS: Number(finalChangeBS.toFixed(2)),
      documentType: documentType || 'factura',
      splitDetails: checkoutMode === 'split' ? splitPayments : null,
      customerName: customerName || 'Consumidor Final',
      customerDoc: customerDoc || (isDollarCountry ? '0000000000' : 'V-00000000'),
      registerId: 'Caja Móvil',
      terminalId: getTerminalId(),
      notes: paymentReference ? `Ref: ${paymentReference}` : (documentType === 'nota_entrega' ? 'Nota de Entrega' : 'Venta Terminal Móvil')
    };

    const deductLocalInventory = async () => {
      setProducts(prev => prev.map(p => {
        const cartItemsForProd = cart.filter(c => getCleanProductId(c.product.productId || c.product.id) === String(p.id));
        if (cartItemsForProd.length > 0) {
          const totalUnitsToDeduct = cartItemsForProd.reduce((sum, item) => {
            const mult = getProductUnitsMultiplier(item.product);
            return sum + (item.quantity * mult);
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
              const currentProd = productsMap.get(cleanId) || await localDb.products.get(cleanId);
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
        id: String(createdSale.id || Date.now().toString()),
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
        method: effectiveMethod,
        changeUSD: finalChangeUSD,
        changeBS: finalChangeBS,
        status: 'synced',
        isOffline: false
      };

      try {
        if (localDb && localDb.sales) await localDb.sales.put(completedSaleRecord);
        await primaryDb.put('sales', completedSaleRecord);
      } catch (caughtErr) {
        console.warn('[useMobileCheckoutFlow] Error guardando venta en IndexedDB:', caughtErr?.message || caughtErr);
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
          exchangeRate,
          currencyMode: activeCurrencyMode
        });
        setPrintedReceipt(completedSaleRecord);
      }

      setCart([]);
      setCartDiscountPercent(0);
      setDiscountSupervisorApprovalId(null);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
      setPaymentReference('');
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

      let cryptoSig = 'SHA256_LOCAL_STAMP';
      try {
        const rawPayload = `${offlineId}|${offlineInvoiceNum}|${totalDueUSD}|${user?.id || 'movil'}|${Date.now()}`;
        const buffer = new TextEncoder().encode(rawPayload);
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        cryptoSig = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (caughtErr) {
        console.warn('[useMobileCheckoutFlow] Error generando firma criptográfica local:', caughtErr?.message || caughtErr);
      }

      const nowOffline = new Date();
      const nowOfflineIso = nowOffline.toISOString();
      const offlineSaleRecord = {
        ...salePayload,
        id: String(offlineId),
        clientTransactionId: String(offlineId),
        terminalId: getTerminalId(),
        invoiceNumber: offlineInvoiceNum,
        cryptographicSignature: cryptoSig,
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
        method: effectiveMethod,
        changeUSD: finalChangeUSD,
        changeBS: finalChangeBS,
        status: 'pending_sync',
        isOffline: true,
        created_at: nowOfflineIso
      };

      try {
        if (localDb && localDb.sales) await localDb.sales.put(offlineSaleRecord);
        await primaryDb.put('sales', offlineSaleRecord);
      } catch (storeErr) {
        console.warn('Error guardando venta offline en DB:', storeErr);
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
          exchangeRate,
          currencyMode: activeCurrencyMode
        });
        setPrintedReceipt(offlineSaleRecord);
      }

      setCart([]);
      setCartDiscountPercent(0);
      setDiscountSupervisorApprovalId(null);
      setIsCheckoutOpen(false);
      setIsMobileCartOpen(false);
      setPaymentReference('');
      playSuccessSound();
      showToast(`⚡ Venta #${offlineInvoiceNum} guardada offline. Se sincronizará al conectar con la PC.`);
    } finally {
      setIsProcessingSale(false);
    }
  }, [
    isProcessingSale, cart, documentType, handleSaveQuotation, checkoutMode,
    splitPaidUSD, totalDueUSD, selectedMethod, amountPaidUSD, amountPaidBS,
    totalPaidInUSD, splitPayments, paymentReference, setIsProcessingSale,
    paidBS, paidUSD, splitChangeUSD, changeUSD, exchangeRate, totalDueBS,
    enrichedCart, subtotalUSD, cartDiscountAmountUSD, cartDiscountPercent,
    discountSupervisorApprovalId, taxUSD, currentIgtfUSD, customerName,
    customerDoc, isDollarCountry, baseImponibleUSD, setProducts, getCleanProductId,
    getProductUnitsMultiplier, productsMap, setSalesHistory, autoPrint,
    businessInfo, activeCurrencyMode, setPrintedReceipt, setCart,
    setCartDiscountPercent, setDiscountSupervisorApprovalId, setIsCheckoutOpen,
    setIsMobileCartOpen, setPaymentReference, showToast, user?.id, setPendingSalesCount
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

    const lines = [
      `🧾 *COMPROBANTE DIGITAL DE COMPRA*`,
      `🏢 *${company.toUpperCase()}*`,
      ...(rif ? [`🔖 RIF / NIT: ${rif}`] : []),
      ...(address ? [`📍 ${address}`] : []),
      `--------------------------------`,
      `N° Documento: *${sale.invoiceNumber || sale.code || 'TICKET'}*`,
      `Fecha: ${formattedSaleDate}`,
      `Cliente: *${sale.customerName || 'Consumidor Final'}* ${sale.customerDoc ? `(${sale.customerDoc})` : ''}`,
      `Atendido por: ${user?.name || user?.username || 'Cajero'}`,
      `--------------------------------`,
      `🛒 *DETALLE DE PRODUCTOS:*`,
      ...(Array.isArray(sale.items) ? sale.items.map(item => {
        const q = item.quantity || 1;
        const name = item.product?.name || item.name || item.product?.nombre || 'Producto';
        const price = Number(item.finalSubtotal || (item.price * q) || (item.product?.price * q) || 0).toFixed(2);
        return `• ${q}x ${name} = $${price}`;
      }) : []),
      `--------------------------------`,
      `Subtotal: $${Number(sale.subtotal || sale.totalUSD || sale.total || 0).toFixed(2)}`,
      ...(sale.discount > 0 ? [`Descuento: -$${Number(sale.discount).toFixed(2)}`] : []),
      `*TOTAL USD: $${Number(sale.totalUSD || sale.total || 0).toFixed(2)}*`,
      `*TOTAL BS: Bs. ${Number(sale.totalBS || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`,
      `Tasa Oficial: Bs. ${Number(sale.exchangeRate || exchangeRate).toFixed(2)}`,
      `Forma de Pago: *${sale.method || sale.paymentMethod || 'Efectivo'}*`,
      ...(sale.paymentReference || (Array.isArray(sale.paymentMethods) && sale.paymentMethods[0]?.reference)
        ? [`Ref. Operación: *#${sale.paymentReference || sale.paymentMethods[0]?.reference}*`]
        : []),
      ...(sale.changeUSD > 0 ? [`Cambio Devuelto: $${Number(sale.changeUSD).toFixed(2)} (Bs. ${Number(sale.changeBS).toFixed(2)})`] : []),
      `--------------------------------`,
      `🌱 *Recibo Ecológico - Cuidemos el planeta*`,
      `¡Gracias por su compra!`
    ];

    return lines.join('\n');
  }, [businessInfo, user, exchangeRate]);

  return {
    promoResult,
    cartDiscountAmountUSD,
    subtotalUSD,
    enrichedCart,
    taxUSD,
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
    activeCurrencyMode,
    handleApplyDiscount,
    handleSelectPaymentMethod,
    handleSaveQuotation,
    handlePrintBluetoothReceipt,
    handleConfirmSale,
    generateEcoReceiptText
  };
}
