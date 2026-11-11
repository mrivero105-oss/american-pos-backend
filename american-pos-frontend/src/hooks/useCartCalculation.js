import { useMemo, useCallback } from 'react';
import { formatMoney } from '../utils/format';
import precision from '../utils/precision';

/**
 * Hook to handle cart financial calculations (subtotal, taxes, discounts, promotions).
 * Uses robust precision utility to avoid floating point drift.
 */
export const useCartCalculation = (cart = [], discountActive = 0, exchangeRate = 1, currencyMode = 'USD', ivaRate = 16, igtfRate = 3, igtfEnabled = false) => {
    
    const { taxableSubtotal, exemptSubtotal, grossSubtotal, totalPromoSavings } = useMemo(() => {
        return (cart || []).reduce((acc, item) => {
            const rawItemTotal = precision.multiply(item.price || 0, item.quantity || 0);
            const promo = Number(item.promoDiscount || 0);
            const itemNetTotal = Math.max(0, precision.subtract(rawItemTotal, promo));

            acc.grossSubtotal = precision.add([acc.grossSubtotal, rawItemTotal]);
            acc.totalPromoSavings = precision.add([acc.totalPromoSavings, promo]);

            if (item.taxStatus === 'exento') {
                acc.exemptSubtotal = precision.add([acc.exemptSubtotal, itemNetTotal]);
            } else {
                acc.taxableSubtotal = precision.add([acc.taxableSubtotal, itemNetTotal]);
            }
            return acc;
        }, { taxableSubtotal: 0, exemptSubtotal: 0, grossSubtotal: 0, totalPromoSavings: 0 });
    }, [cart]);

    const subtotal = useMemo(() => grossSubtotal, [grossSubtotal]);
    const netSubtotal = useMemo(() => precision.add([taxableSubtotal, exemptSubtotal]), [taxableSubtotal, exemptSubtotal]);

    const discountAmount = useMemo(() => {
        const discountFraction = precision.divide(discountActive, 100);
        return precision.multiply(netSubtotal, discountFraction);
    }, [netSubtotal, discountActive]);

    const total = useMemo(() => {
        return Math.max(0, precision.subtract(netSubtotal, discountAmount));
    }, [netSubtotal, discountAmount]);

    const igtfAmount = useMemo(() => {
        if (!igtfEnabled) return 0;
        // El IGTF es un recargo sobre el total final si se paga en divisas
        const igtfFraction = precision.divide(igtfRate, 100);
        return precision.multiply(total, igtfFraction);
    }, [total, igtfEnabled, igtfRate]);

    // El total fiscal base sigue siendo el total sin IGTF (ya que el IGTF es dinámico al pago)
    const totalWithIgtf = useMemo(() => precision.add([total, igtfAmount]), [total, igtfAmount]);

    const discountFactor = useMemo(() => {
        return netSubtotal > 0 ? precision.divide(total, netSubtotal) : 1;
    }, [netSubtotal, total]);

    const taxableBase = useMemo(() => {
        return precision.multiply(taxableSubtotal, discountFactor);
    }, [taxableSubtotal, discountFactor]);

    const exemptBase = useMemo(() => {
        return precision.multiply(exemptSubtotal, discountFactor);
    }, [exemptSubtotal, discountFactor]);

    const ivaAmount = useMemo(() => {
        // Calculate IVA from inclusive taxable base: Base - (Base / (1 + Rate))
        const rate = precision.divide(ivaRate, 100);
        const divisor = precision.add([1, rate]);
        const netBase = precision.divide(taxableBase, divisor);
        return precision.subtract(taxableBase, netBase);
    }, [taxableBase, ivaRate]);

    const netTaxableBase = useMemo(() => {
        return precision.subtract(taxableBase, ivaAmount);
    }, [taxableBase, ivaAmount]);

    const renderFormatMoney = useCallback((val, mode = null) => {
        return formatMoney(val, mode || currencyMode, { rate: exchangeRate, currencyMode });
    }, [currencyMode, exchangeRate]);

    return {
        subtotal,
        netSubtotal,
        totalPromoSavings,
        discountAmount,
        total,
        igtfAmount,
        totalWithIgtf,
        ivaAmount,
        taxableBase: netTaxableBase,
        exemptBase,
        renderFormatMoney
    };
};
