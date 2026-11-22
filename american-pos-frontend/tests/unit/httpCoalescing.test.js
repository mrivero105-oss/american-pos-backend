import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockApiGet = vi.fn();

vi.mock('../../src/services/api', () => ({
    default: {
        get: (...args) => mockApiGet(...args)
    }
}));

import {
    fetchBusinessSettingsCached,
    fetchTaxSettingsCached,
    fetchPaymentMethodsCached,
    fetchExchangeRateCached,
    fetchCurrentShiftCached,
    fetchGlobalSettings,
    clearSettingsHttpCache
} from '../../src/utils/format';

describe('Fase 2: Coalescencia HTTP de Settings y Shift Status', () => {
    beforeEach(() => {
        mockApiGet.mockReset();
        clearSettingsHttpCache();
    });

    it('coalesce llamadas concurrentes a /settings/business, /settings/rate y /settings/payment-methods sin duplicar HTTP', async () => {
        let resolveBusiness;
        let resolveRate;
        let resolvePm;
        mockApiGet.mockImplementation((url) => {
            if (url === '/settings/business') {
                return new Promise((r) => { resolveBusiness = r; });
            }
            if (url === '/settings/rate') {
                return new Promise((r) => { resolveRate = r; });
            }
            if (url === '/settings/payment-methods') {
                return new Promise((r) => { resolvePm = r; });
            }
            return Promise.resolve({ data: {} });
        });

        const pGlobal = fetchGlobalSettings();
        const pBiz1 = fetchBusinessSettingsCached();
        const pBiz2 = fetchBusinessSettingsCached();
        const pRate = fetchExchangeRateCached();
        const pPm = fetchPaymentMethodsCached();

        resolveRate({ data: { rate: 55.5, currencyMode: 'BOTH' } });
        resolvePm({ data: [{ id: 'cash_usd', name: 'Efectivo USD' }] });
        resolveBusiness({ data: { businessMode: 'STANDARD', country: 'Venezuela' } });

        const [globalRes, biz1, biz2, rateRes, pmRes] = await Promise.all([
            pGlobal,
            pBiz1,
            pBiz2,
            pRate,
            pPm
        ]);

        expect(biz1).toEqual({ businessMode: 'STANDARD', country: 'Venezuela' });
        expect(biz2).toEqual(biz1);
        expect(rateRes).toEqual({ rate: 55.5, currencyMode: 'BOTH' });
        expect(pmRes).toEqual([{ id: 'cash_usd', name: 'Efectivo USD' }]);
        expect(globalRes.rate).toBe(55.5);
        expect(mockApiGet.mock.calls.filter(([u]) => u === '/settings/business')).toHaveLength(1);
        expect(mockApiGet.mock.calls.filter(([u]) => u === '/settings/rate')).toHaveLength(1);
        expect(mockApiGet.mock.calls.filter(([u]) => u === '/settings/payment-methods')).toHaveLength(1);
    });

    it('coalesce llamadas concurrentes a /settings/taxes y /cash/current por registerId', async () => {
        let resolveTaxes;
        let resolveShift;
        mockApiGet.mockImplementation((url) => {
            if (url === '/settings/taxes') {
                return new Promise((r) => { resolveTaxes = r; });
            }
            if (url === '/cash/current') {
                return new Promise((r) => { resolveShift = r; });
            }
            return Promise.resolve({ data: null });
        });

        const t1 = fetchTaxSettingsCached();
        const t2 = fetchTaxSettingsCached();
        const s1 = fetchCurrentShiftCached('DEV-1');
        const s2 = fetchCurrentShiftCached('DEV-1');

        resolveTaxes({ data: { ivaEnabled: true, ivaRate: 16 } });
        resolveShift({ data: { id: 'shift-1', status: 'OPEN' } });

        const [taxA, taxB, shiftA, shiftB] = await Promise.all([t1, t2, s1, s2]);
        expect(taxA).toEqual({ ivaEnabled: true, ivaRate: 16 });
        expect(taxB).toEqual(taxA);
        expect(shiftA).toEqual({ id: 'shift-1', status: 'OPEN' });
        expect(shiftB).toEqual(shiftA);
        expect(mockApiGet.mock.calls.filter(([u]) => u === '/settings/taxes')).toHaveLength(1);
        expect(mockApiGet.mock.calls.filter(([u]) => u === '/cash/current')).toHaveLength(1);
    });

    it('permite limpiar el caché y promesas activas ante auth-logout sin error', () => {
        expect(() => {
            window.dispatchEvent(new CustomEvent('auth-logout'));
            clearSettingsHttpCache();
        }).not.toThrow();
    });
});
