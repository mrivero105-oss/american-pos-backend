import { describe, it, expect, beforeEach } from 'vitest';
import {
    formatMoney,
    formatBs,
    formatEUR,
    setGlobalSettings,
    isSingleCurrencyMode,
    isUsdOnlyMode,
    isDualCurrencyMode,
    getTaxLabel,
    getTaxAuthority,
    getTaxIdLabel,
    getCustomerDocLabel,
    getRegionConfig,
    COUNTRY_LIST
} from '../../src/utils/format';

describe('Internacionalización Frontend — Monedas, Impuestos y Etiquetas (6 países + Euro)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('Ecuador opera en USD ($), 15% IVA por defecto, RUC, SRI y nunca muestra Bs', () => {
        setGlobalSettings({ country: 'ecuador', currencyMode: 'SINGLE', rate: 1 });
        expect(isSingleCurrencyMode()).toBe(true);
        expect(isUsdOnlyMode()).toBe(true);
        expect(isDualCurrencyMode()).toBe(false);
        expect(formatMoney(12.5)).toBe('$12.50');
        expect(formatBs(12.5)).toBe('$12.50');
        expect(getTaxLabel('ecuador')).toBe('IVA');
        expect(getTaxIdLabel('ecuador')).toBe('RUC');
        expect(getCustomerDocLabel('ecuador')).toBe('RUC / C.I.');
        expect(getTaxAuthority('ecuador')).toBe('SRI');
        expect(getRegionConfig('ecuador').defaultTaxRate).toBe(15);
    });

    it('Colombia opera en COP sin decimales, sin Bs ni USD, NIT y DIAN', () => {
        setGlobalSettings({ country: 'colombia', currencyMode: 'SINGLE', rate: 1 });
        expect(isSingleCurrencyMode()).toBe(true);
        expect(isUsdOnlyMode()).toBe(false);
        expect(isDualCurrencyMode()).toBe(false);
        const formatted = formatMoney(15000);
        expect(formatted).toContain('COP');
        expect(formatted).toMatch(/15[.,]000/);
        expect(formatted).not.toContain('Bs');
        expect(formatBs(15000)).toContain('COP');
        expect(getTaxLabel('colombia')).toBe('IVA');
        expect(getTaxIdLabel('colombia')).toBe('NIT');
        expect(getCustomerDocLabel('colombia')).toBe('C.C. / NIT');
        expect(getTaxAuthority('colombia')).toBe('DIAN');
        expect(getRegionConfig('colombia').defaultTaxRate).toBe(19);
    });

    it('Panamá opera en USD ($), ITBMS 7%, RUC y DGI', () => {
        setGlobalSettings({ country: 'panama', currencyMode: 'SINGLE', rate: 1 });
        expect(isSingleCurrencyMode()).toBe(true);
        expect(isUsdOnlyMode()).toBe(true);
        expect(formatMoney(9.99)).toBe('$9.99');
        expect(getTaxLabel('panama')).toBe('ITBMS');
        expect(getTaxIdLabel('panama')).toBe('RUC');
        expect(getTaxAuthority('panama')).toBe('DGI');
        expect(getRegionConfig('panama').defaultTaxRate).toBe(7);
    });

    it('USA opera en USD ($), Sales Tax 7%, EIN e IRS', () => {
        setGlobalSettings({ country: 'usa', currencyMode: 'SINGLE', rate: 1 });
        expect(isSingleCurrencyMode()).toBe(true);
        expect(isUsdOnlyMode()).toBe(true);
        expect(formatMoney(25)).toBe('$25.00');
        expect(getTaxLabel('usa')).toBe('Sales Tax');
        expect(getTaxIdLabel('usa')).toBe('EIN');
        expect(getCustomerDocLabel('usa')).toBe('ID / SSN');
        expect(getTaxAuthority('usa')).toBe('IRS');
    });

    it('Venezuela mantiene modo dual USD / Bs (VES), IVA 16%, RIF, SENIAT y soporta formato EUR explícito', () => {
        setGlobalSettings({ country: 'venezuela', currencyMode: 'BOTH', rate: 100, euroRate: 110 });
        expect(isSingleCurrencyMode()).toBe(false);
        expect(isUsdOnlyMode()).toBe(false);
        expect(isDualCurrencyMode()).toBe(true);
        expect(formatMoney(10, 'USD')).toBe('$10.00');
        expect(formatMoney(10, 'VES')).toContain('Bs');
        expect(formatMoney(10, 'EUR')).toContain('€');
        expect(getTaxLabel('venezuela')).toBe('IVA');
        expect(getTaxIdLabel('venezuela')).toBe('RIF');
        expect(getTaxAuthority('venezuela')).toBe('SENIAT');
    });

    it('España / Europa opera en EUR (€), IVA 21%, NIF/CIF, AEAT y jamás muestra Bs ni USD', () => {
        expect(COUNTRY_LIST.some(c => c.id === 'espana' && c.currencyCode === 'EUR')).toBe(true);
        setGlobalSettings({ country: 'espana', currencyMode: 'SINGLE', rate: 1 });
        expect(isSingleCurrencyMode()).toBe(true);
        expect(isUsdOnlyMode()).toBe(false);
        expect(isDualCurrencyMode()).toBe(false);

        const formatted = formatMoney(12.5);
        expect(formatted).toContain('€');
        expect(formatted).toMatch(/12[.,]50/);
        expect(formatted).not.toContain('Bs');
        expect(formatted).not.toContain('$');

        expect(formatBs(12.5)).toContain('€');
        expect(formatEUR(99.9)).toContain('€');
        expect(getTaxLabel('espana')).toBe('IVA');
        expect(getTaxIdLabel('espana')).toBe('NIF / CIF');
        expect(getCustomerDocLabel('espana')).toBe('DNI / NIE / NIF');
        expect(getTaxAuthority('espana')).toBe('AEAT');
        expect(getRegionConfig('Europa').id).toBe('espana');
        expect(getRegionConfig('espana').defaultTaxRate).toBe(21);
    });
});
