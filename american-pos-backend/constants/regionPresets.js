/**
 * Catálogo central de internacionalización regional (Single Source of Truth Backend).
 * Centraliza moneda, locale, decimales, impuesto local, autoridad fiscal, zona horaria
 * y métodos de pago predeterminados para cada país soportado por Isaac POS.
 */

const normalizeCountry = (country) => {
    if (!country || typeof country !== 'string') return '';
    return country
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
};

const COUNTRY_PRESETS = {
    venezuela: {
        id: 'venezuela',
        code: 'VE',
        name: 'Venezuela',
        currencyCode: 'USD',
        secondaryCurrencyCode: 'VES',
        currencySymbol: '$',
        secondaryCurrencySymbol: 'Bs',
        locale: 'es-VE',
        decimals: 2,
        exchangeRate: 36.5,
        euroRate: 40.0,
        currencyMode: 'BOTH',
        autoUpdateRate: true,
        taxLabel: 'IVA',
        taxFullName: 'Impuesto al Valor Agregado',
        taxIdLabel: 'RIF',
        customerDocLabel: 'CÉDULA / RIF',
        taxAuthority: 'SENIAT',
        timezone: 'America/Caracas',
        timezoneOffsetMinutes: 240,
        taxConfig: { ivaEnabled: true, ivaRate: 16.0, igtfEnabled: true, igtfRate: 3.0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo $', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'cash_eur', name: 'Efectivo €', icon: 'Euro', type: 'CASH', currency: 'EUR' },
            { id: 'cash_bs', name: 'Efectivo Bs', icon: 'DollarSign', type: 'CASH', currency: 'VES' },
            { id: 'debit', name: 'Punto de Venta', icon: 'CreditCard', type: 'DIGITAL', currency: 'VES' },
            { id: 'pago_movil', name: 'Pago Móvil', icon: 'Smartphone', type: 'DIGITAL', currency: 'VES' },
            { id: 'binance_usdt', name: 'Binance Pay (USDT)', icon: 'Wallet', type: 'DIGITAL', currency: 'USDT' },
            { id: 'zelle', name: 'Zelle', icon: 'Send', type: 'DIGITAL', currency: 'USD' },
            { id: 'fiado', name: 'Crédito / Fiado', icon: 'User', type: 'CREDIT', currency: 'USD' }
        ]
    },
    ecuador: {
        id: 'ecuador',
        code: 'EC',
        name: 'Ecuador',
        currencyCode: 'USD',
        secondaryCurrencyCode: null,
        currencySymbol: '$',
        secondaryCurrencySymbol: null,
        locale: 'es-EC',
        decimals: 2,
        exchangeRate: 1.0,
        currencyMode: 'SINGLE',
        autoUpdateRate: false,
        taxLabel: 'IVA',
        taxFullName: 'Impuesto al Valor Agregado',
        taxIdLabel: 'RUC',
        customerDocLabel: 'RUC / C.I.',
        taxAuthority: 'SRI',
        timezone: 'America/Guayaquil',
        timezoneOffsetMinutes: 300,
        taxConfig: { ivaEnabled: true, ivaRate: 15.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'card', name: 'Tarjeta / Débito', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
            { id: 'transfer', name: 'Transferencia', icon: 'Smartphone', type: 'DIGITAL', currency: 'USD' },
            { id: 'fiado', name: 'Crédito', icon: 'User', type: 'CREDIT', currency: 'USD' }
        ]
    },
    colombia: {
        id: 'colombia',
        code: 'CO',
        name: 'Colombia',
        currencyCode: 'COP',
        secondaryCurrencyCode: null,
        currencySymbol: '$',
        secondaryCurrencySymbol: null,
        locale: 'es-CO',
        decimals: 0,
        exchangeRate: 1.0,
        currencyMode: 'SINGLE',
        autoUpdateRate: false,
        taxLabel: 'IVA',
        taxFullName: 'Impuesto al Valor Agregado',
        taxIdLabel: 'NIT',
        customerDocLabel: 'C.C. / NIT',
        taxAuthority: 'DIAN',
        timezone: 'America/Bogota',
        timezoneOffsetMinutes: 300,
        taxConfig: { ivaEnabled: true, ivaRate: 19.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo COP', icon: 'DollarSign', type: 'CASH', currency: 'COP' },
            { id: 'debit', name: 'Tarjeta Débito / Crédito', icon: 'CreditCard', type: 'DIGITAL', currency: 'COP' },
            { id: 'nequi', name: 'Nequi / Daviplata', icon: 'Smartphone', type: 'DIGITAL', currency: 'COP' },
            { id: 'transfer', name: 'Transferencia PSE', icon: 'Send', type: 'DIGITAL', currency: 'COP' },
            { id: 'fiado', name: 'Crédito', icon: 'User', type: 'CREDIT', currency: 'COP' }
        ]
    },
    panama: {
        id: 'panama',
        code: 'PA',
        name: 'Panamá',
        currencyCode: 'USD',
        secondaryCurrencyCode: null,
        currencySymbol: '$',
        secondaryCurrencySymbol: null,
        locale: 'es-PA',
        decimals: 2,
        exchangeRate: 1.0,
        currencyMode: 'SINGLE',
        autoUpdateRate: false,
        taxLabel: 'ITBMS',
        taxFullName: 'Impuesto de Transferencia de Bienes Muebles y Servicios',
        taxIdLabel: 'RUC',
        customerDocLabel: 'CÉDULA / RUC',
        taxAuthority: 'DGI',
        timezone: 'America/Panama',
        timezoneOffsetMinutes: 300,
        taxConfig: { ivaEnabled: true, ivaRate: 7.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'card', name: 'Tarjeta / Clave', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
            { id: 'yappy', name: 'Yappy', icon: 'Smartphone', type: 'DIGITAL', currency: 'USD' },
            { id: 'fiado', name: 'Crédito', icon: 'User', type: 'CREDIT', currency: 'USD' }
        ]
    },
    usa: {
        id: 'usa',
        code: 'US',
        name: 'USA',
        currencyCode: 'USD',
        secondaryCurrencyCode: null,
        currencySymbol: '$',
        secondaryCurrencySymbol: null,
        locale: 'en-US',
        decimals: 2,
        exchangeRate: 1.0,
        currencyMode: 'SINGLE',
        autoUpdateRate: false,
        taxLabel: 'Sales Tax',
        taxFullName: 'State & Local Sales Tax',
        taxIdLabel: 'EIN',
        customerDocLabel: 'ID / SSN',
        taxAuthority: 'IRS',
        timezone: 'America/New_York',
        timezoneOffsetMinutes: 300,
        taxConfig: { ivaEnabled: true, ivaRate: 7.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Cash', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'card', name: 'Credit / Debit Card', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
            { id: 'zelle', name: 'Zelle / Venmo', icon: 'Send', type: 'DIGITAL', currency: 'USD' }
        ]
    },
    espana: {
        id: 'espana',
        code: 'ES',
        name: 'España / Europa',
        currencyCode: 'EUR',
        secondaryCurrencyCode: null,
        currencySymbol: '€',
        secondaryCurrencySymbol: null,
        locale: 'es-ES',
        decimals: 2,
        exchangeRate: 1.0,
        euroRate: 1.0,
        currencyMode: 'SINGLE',
        autoUpdateRate: false,
        taxLabel: 'IVA',
        taxFullName: 'Impuesto sobre el Valor Añadido',
        taxIdLabel: 'NIF / CIF',
        customerDocLabel: 'DNI / NIE / NIF',
        taxAuthority: 'AEAT',
        timezone: 'Europe/Madrid',
        timezoneOffsetMinutes: -60,
        taxConfig: { ivaEnabled: true, ivaRate: 21.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo €', icon: 'Euro', type: 'CASH', currency: 'EUR' },
            { id: 'card', name: 'Tarjeta / TPV', icon: 'CreditCard', type: 'DIGITAL', currency: 'EUR' },
            { id: 'bizum', name: 'Bizum', icon: 'Smartphone', type: 'DIGITAL', currency: 'EUR' },
            { id: 'transfer', name: 'Transferencia SEPA', icon: 'Send', type: 'DIGITAL', currency: 'EUR' },
            { id: 'fiado', name: 'Crédito / Cuenta', icon: 'User', type: 'CREDIT', currency: 'EUR' }
        ]
    }
};

const getPresetKey = (country) => {
    const clean = normalizeCountry(country);
    if (['ecuador', 'ec'].includes(clean)) return 'ecuador';
    if (['panama', 'pa'].includes(clean)) return 'panama';
    if (['usa', 'eeuu', 'estadosunidos', 'unitedstates', 'us'].includes(clean)) return 'usa';
    if (['colombia', 'co'].includes(clean)) return 'colombia';
    if (['espana', 'spain', 'es', 'europa', 'europe', 'eu', 'eurozona', 'zonaeuro', 'euro'].includes(clean)) return 'espana';
    if (['venezuela', 've'].includes(clean)) return 'venezuela';
    return null;
};

const getRegionConfig = (country) => {
    const key = getPresetKey(country) || 'venezuela';
    return COUNTRY_PRESETS[key];
};

const isVenezuelaCountry = (country) => {
    if (!country) return true;
    return getPresetKey(country) === 'venezuela';
};

const isDollarOnlyCountry = (country) => {
    const key = getPresetKey(country);
    return key === 'ecuador' || key === 'panama' || key === 'usa';
};

const isSingleCurrencyCountry = (country) => {
    const key = getPresetKey(country);
    return key === 'ecuador' || key === 'panama' || key === 'usa' || key === 'colombia' || key === 'espana';
};

/**
 * Construye una copia limpia de metadatos regionales serializable para enviar a clientes.
 */
const buildPublicRegionMetadata = (country) => {
    const cfg = getRegionConfig(country);
    return {
        id: cfg.id,
        code: cfg.code,
        name: cfg.name,
        currencyCode: cfg.currencyCode,
        secondaryCurrencyCode: cfg.secondaryCurrencyCode,
        currencySymbol: cfg.currencySymbol,
        secondaryCurrencySymbol: cfg.secondaryCurrencySymbol,
        locale: cfg.locale,
        decimals: cfg.decimals,
        currencyMode: cfg.currencyMode,
        taxLabel: cfg.taxLabel,
        taxFullName: cfg.taxFullName,
        taxIdLabel: cfg.taxIdLabel,
        customerDocLabel: cfg.customerDocLabel,
        taxAuthority: cfg.taxAuthority,
        timezone: cfg.timezone,
        timezoneOffsetMinutes: cfg.timezoneOffsetMinutes
    };
};

module.exports = {
    COUNTRY_PRESETS,
    normalizeCountry,
    getPresetKey,
    getRegionConfig,
    isVenezuelaCountry,
    isDollarOnlyCountry,
    isSingleCurrencyCountry,
    buildPublicRegionMetadata
};
