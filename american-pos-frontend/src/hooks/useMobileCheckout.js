import { useState, useMemo, useCallback } from 'react';

/**
 * Hook modular para el proceso de Cobro y Cierre de Venta Móvil.
 * Gestiona montos entregados (USD y Bs), pagos divididos (Split Payments),
 * vuelto en ambas monedas y botones de billetes sugeridos.
 */
export function useMobileCheckout({
  totalUSD = 0,
  exchangeRate = 1.0
}) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('cash_usd');
  const [amountPaidUSD, setAmountPaidUSD] = useState('');
  const [amountPaidBS, setAmountPaidBS] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [splitPayments, setSplitPayments] = useState({
    cash_usd: '',
    cash_bs: '',
    pago_movil: '',
    tarjeta: '',
    zelle: '',
    credito: ''
  });

  // Cálculo reactivo de montos entregados y vuelto
  const { paidUSD, paidBS, totalPaidInUSD, changeUSD, changeBS } = useMemo(() => {
    const pUSD = parseFloat(amountPaidUSD) || 0;
    const pBS = parseFloat(amountPaidBS) || 0;
    const totPaidUSD = pUSD + (pBS / (exchangeRate || 1));
    const chUSD = Math.max(0, totPaidUSD - totalUSD);
    const chBS = chUSD * (exchangeRate || 1);
    return { paidUSD: pUSD, paidBS: pBS, totalPaidInUSD: totPaidUSD, changeUSD: chUSD, changeBS: chBS };
  }, [amountPaidUSD, amountPaidBS, exchangeRate, totalUSD]);

  // Botones de Billetes Sugeridos (Quick Cash Tender Chips)
  const suggestedCashTenders = useMemo(() => {
    if (totalUSD <= 0) return [];
    const list = [];
    const standardBills = [5, 10, 20, 50, 100];
    const higherBills = standardBills.filter(b => b > totalUSD);

    if (higherBills.length > 0) {
      higherBills.slice(0, 3).forEach(bill => {
        list.push({
          id: `bill_${bill}`,
          amountUSD: String(bill),
          label: `$${bill}`,
          subtitle: `Vuelto: $${(bill - totalUSD).toFixed(2)}`
        });
      });
    } else {
      const next10 = Math.ceil(totalUSD / 10) * 10;
      const next20 = Math.ceil(totalUSD / 20) * 20;
      const next50 = Math.ceil(totalUSD / 50) * 50;
      const next100 = Math.ceil(totalUSD / 100) * 100;
      [next10, next20, next50, next100]
        .filter((v, idx, arr) => v > totalUSD && arr.indexOf(v) === idx)
        .slice(0, 3)
        .forEach(val => {
          list.push({
            id: `round_${val}`,
            amountUSD: String(val),
            label: `$${val}`,
            subtitle: `Vuelto: $${(val - totalUSD).toFixed(2)}`
          });
        });
    }

    return list;
  }, [totalUSD]);

  // Cálculo de Split Payments en USD y Bolívares
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

  const splitRemainingUSD = Math.max(0, totalUSD - splitPaidUSD);
  const splitChangeUSD = Math.max(0, splitPaidUSD - totalUSD);

  const resetCheckoutForm = useCallback(() => {
    setAmountPaidUSD('');
    setAmountPaidBS('');
    setPaymentReference('');
    setSplitPayments({
      cash_usd: '',
      cash_bs: '',
      pago_movil: '',
      tarjeta: '',
      zelle: '',
      credito: ''
    });
  }, []);

  return {
    selectedPaymentMethod,
    setSelectedPaymentMethod,
    amountPaidUSD,
    setAmountPaidUSD,
    amountPaidBS,
    setAmountPaidBS,
    paymentReference,
    setPaymentReference,
    splitPayments,
    setSplitPayments,
    paidUSD,
    paidBS,
    totalPaidInUSD,
    changeUSD,
    changeBS,
    suggestedCashTenders,
    splitPaidUSD,
    splitRemainingUSD,
    splitChangeUSD,
    resetCheckoutForm
  };
}

export default useMobileCheckout;
