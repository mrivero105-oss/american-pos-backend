import { describe, it, expect } from 'vitest';
import VortexMathEngine from '../../src/utils/VortexMathEngine';
import {
    evaluateCartPromotions,
    calculatePaymentMethodDiscounts,
    matchesPaymentMethod
} from '../../src/utils/promotionsEngine';
import {
    precisionRound,
    formatMoney,
    isUsdOnlyMode,
    isVesOnlyMode
} from '../../src/utils/format';

describe('VortexMathEngine, Format y Motor de Promociones', () => {
    it('elimina errores IEEE 754 en suma, resta, multiplicación y división', () => {
        expect(VortexMathEngine.add(0.1, 0.2)).toBe(0.3);
        expect(VortexMathEngine.subtract(10.3, 0.1)).toBe(10.2);
        expect(VortexMathEngine.multiply(1.005, 100)).toBe(100.5);
        expect(VortexMathEngine.round(12.345, 2)).toBe(12.35);
        expect(VortexMathEngine.parseNumericInput('1.234,56')).toBe(1234.56);
    });

    it('evalua promociones BUY_X_GET_Y (3x2), VOLUME_DISCOUNT y CATEGORY_DISCOUNT', () => {
        const cart = [
            { id: 'p1', name: 'Refresco 2L', price: 2.5, quantity: 3, category: 'Bebidas' },
            { id: 'p2', name: 'Galleta', price: 1.0, quantity: 12, category: 'Snacks' }
        ];
        const promos = [
            {
                id: 'promo_3x2',
                name: 'Lleva 3 paga 2',
                type: 'BUY_X_GET_Y',
                isActive: true,
                targetProductIds: ['p1'],
                buyQuantity: 3,
                payQuantity: 2,
                priority: 10
            },
            {
                id: 'promo_vol',
                name: 'Docena Mayorista',
                type: 'VOLUME_DISCOUNT',
                isActive: true,
                targetProductIds: ['p2'],
                minUnits: 12,
                discountPercentage: 10,
                priority: 5
            }
        ];

        const result = evaluateCartPromotions(cart, promos);
        expect(result.totalPromoSavings).toBe(3.7); // 2.50 + 1.20
        expect(result.finalCartSubtotal).toBe(15.8); // (7.5-2.5) + (12-1.2)
        expect(result.appliedPromotions).toHaveLength(2);
    });

    it('calcula badges PAYMENT_METHOD_DISCOUNT respetando alias cash_usd / pago_movil', () => {
        expect(matchesPaymentMethod(['cash_usd'], 'efectivo_usd')).toBe(true);
        expect(matchesPaymentMethod(['pago_movil'], 'Pago Móvil')).toBe(true);

        const cart = [{ id: 'p1', name: 'Queso', price: 10, quantity: 2, category: 'Charcutería' }];
        const promos = [
            {
                id: 'pm_cash',
                name: '5% Divisa',
                type: 'PAYMENT_METHOD_DISCOUNT',
                isActive: true,
                targetPaymentMethods: ['cash_usd'],
                discountPercentage: 5
            }
        ];

        const byMethod = calculatePaymentMethodDiscounts(cart, promos);
        expect(byMethod.cash_usd).toBeTruthy();
        expect(byMethod.cash_usd.savings).toBe(1.0);
        expect(byMethod.cash_usd.promoName).toBe('5% Divisa');
    });

    it('formatea y valida modos de moneda e IGTF / IVA con precisionRound', () => {
        expect(isUsdOnlyMode({ currencyMode: 'SINGLE', country: 'Ecuador' })).toBe(true);
        expect(isVesOnlyMode({ currencyMode: 'VES', country: 'Venezuela' })).toBe(true);
        expect(precisionRound(100 * 0.03, 2)).toBe(3);

        const vesFormatted = formatMoney(10, 'VES', { rate: 50, currencyMode: 'BOTH' });
        expect(vesFormatted).toContain('Bs');
        expect(vesFormatted).toContain('500,00');
    });
});
