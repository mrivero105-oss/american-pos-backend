/**
 * Catálogo central de internacionalización regional (Single Source of Truth Frontend).
 * Espejo de american-pos-backend/constants/regionPresets.js para garantizar paridad total
 * entre los cálculos del servidor, el formato de monedas y las etiquetas legales/fiscales.
 */

export const normalizeCountry = (country) => {
    if (!country || typeof country !== 'string') return '';
    return country
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
};

export const REGION_CONFIGS = {
    venezuela: {
        id: 'venezuela',
        code: 'VE',
        name: 'Venezuela',
        currencyCode: 'USD',
        secondaryCurrencyCode: 'VES',
        currencyLabel: 'USD / Bs (VES)',
        currencyBadge: 'USD / Bs',
        currencySymbol: '$',
        locale: 'es-VE',
        decimals: 2,
        currencyMode: 'BOTH',
        taxLabel: 'IVA',
        taxFullName: 'Impuesto al Valor Agregado',
        taxSummary: 'IVA 16% + IGTF 3%',
        defaultTaxRate: 16,
        hasIgtf: true,
        defaultIgtfRate: 3,
        taxIdLabel: 'RIF',
        customerDocLabel: 'CÉDULA / RIF',
        taxIdPlaceholder: 'EJ: J-12345678-0',
        taxAuthority: 'SENIAT',
        timezone: 'America/Caracas'
    },
    ecuador: {
        id: 'ecuador',
        code: 'EC',
        name: 'Ecuador',
        currencyCode: 'USD',
        secondaryCurrencyCode: null,
        currencyLabel: 'USD',
        currencyBadge: 'USD ($)',
        currencySymbol: '$',
        locale: 'es-EC',
        decimals: 2,
        currencyMode: 'SINGLE',
        taxLabel: 'IVA',
        taxFullName: 'Impuesto al Valor Agregado',
        taxSummary: 'IVA 15%',
        defaultTaxRate: 15,
        hasIgtf: false,
        defaultIgtfRate: 0,
        taxIdLabel: 'RUC',
        customerDocLabel: 'RUC / C.I.',
        taxIdPlaceholder: 'EJ: 1790012345001',
        taxAuthority: 'SRI',
        timezone: 'America/Guayaquil'
    },
    colombia: {
        id: 'colombia',
        code: 'CO',
        name: 'Colombia',
        currencyCode: 'COP',
        secondaryCurrencyCode: null,
        currencyLabel: 'COP',
        currencyBadge: 'COP ($)',
        currencySymbol: '$',
        locale: 'es-CO',
        decimals: 0,
        currencyMode: 'SINGLE',
        taxLabel: 'IVA',
        taxFullName: 'Impuesto al Valor Agregado',
        taxSummary: 'IVA 19%',
        defaultTaxRate: 19,
        hasIgtf: false,
        defaultIgtfRate: 0,
        taxIdLabel: 'NIT',
        customerDocLabel: 'C.C. / NIT',
        taxIdPlaceholder: 'EJ: 900.123.456-1',
        taxAuthority: 'DIAN',
        timezone: 'America/Bogota'
    },
    panama: {
        id: 'panama',
        code: 'PA',
        name: 'Panamá',
        currencyCode: 'USD',
        secondaryCurrencyCode: null,
        currencyLabel: 'USD',
        currencyBadge: 'USD ($)',
        currencySymbol: '$',
        locale: 'es-PA',
        decimals: 2,
        currencyMode: 'SINGLE',
        taxLabel: 'ITBMS',
        taxFullName: 'Impuesto de Transferencia de Bienes Muebles y Servicios',
        taxSummary: 'ITBMS 7%',
        defaultTaxRate: 7,
        hasIgtf: false,
        defaultIgtfRate: 0,
        taxIdLabel: 'RUC',
        customerDocLabel: 'CÉDULA / RUC',
        taxIdPlaceholder: 'EJ: 155612345-2-2020 DV 45',
        taxAuthority: 'DGI',
        timezone: 'America/Panama'
    },
    usa: {
        id: 'usa',
        code: 'US',
        name: 'USA',
        currencyCode: 'USD',
        secondaryCurrencyCode: null,
        currencyLabel: 'USD',
        currencyBadge: 'USD ($)',
        currencySymbol: '$',
        locale: 'en-US',
        decimals: 2,
        currencyMode: 'SINGLE',
        taxLabel: 'Sales Tax',
        taxFullName: 'State & Local Sales Tax',
        taxSummary: 'Sales Tax 7%',
        defaultTaxRate: 7,
        hasIgtf: false,
        defaultIgtfRate: 0,
        taxIdLabel: 'EIN',
        customerDocLabel: 'ID / SSN',
        taxIdPlaceholder: 'EJ: 12-3456789',
        taxAuthority: 'IRS',
        timezone: 'America/New_York'
    },
    espana: {
        id: 'espana',
        code: 'ES',
        name: 'España / Europa',
        currencyCode: 'EUR',
        secondaryCurrencyCode: null,
        currencyLabel: 'EUR (€)',
        currencyBadge: 'EUR (€)',
        currencySymbol: '€',
        locale: 'es-ES',
        decimals: 2,
        currencyMode: 'SINGLE',
        taxLabel: 'IVA',
        taxFullName: 'Impuesto sobre el Valor Añadido',
        taxSummary: 'IVA 21%',
        defaultTaxRate: 21,
        hasIgtf: false,
        defaultIgtfRate: 0,
        taxIdLabel: 'NIF / CIF',
        customerDocLabel: 'DNI / NIE / NIF',
        taxIdPlaceholder: 'EJ: B12345678',
        taxAuthority: 'AEAT',
        timezone: 'Europe/Madrid'
    }
};

export const COUNTRY_LIST = [
    REGION_CONFIGS.venezuela,
    REGION_CONFIGS.ecuador,
    REGION_CONFIGS.colombia,
    REGION_CONFIGS.panama,
    REGION_CONFIGS.usa,
    REGION_CONFIGS.espana
];

export const getCountryKey = (country) => {
    const clean = normalizeCountry(country);
    if (['ecuador', 'ec'].includes(clean)) return 'ecuador';
    if (['panama', 'pa'].includes(clean)) return 'panama';
    if (['usa', 'eeuu', 'estadosunidos', 'unitedstates', 'us'].includes(clean)) return 'usa';
    if (['colombia', 'co'].includes(clean)) return 'colombia';
    if (['espana', 'spain', 'es', 'europa', 'europe', 'eu', 'eurozona', 'zonaeuro', 'euro'].includes(clean)) return 'espana';
    if (['venezuela', 've'].includes(clean)) return 'venezuela';
    return null;
};

export const getRegionConfig = (countryOverride) => {
    let raw = countryOverride;
    if (!raw && typeof window !== 'undefined') {
        try {
            raw = localStorage.getItem('pos_country') || '';
        } catch {
            raw = '';
        }
    }
    const key = getCountryKey(raw) || 'venezuela';
    return REGION_CONFIGS[key];
};

export const isVenezuelaCountry = (country) => {
    if (!country) return true;
    return getCountryKey(country) === 'venezuela';
};

export const isDollarOnlyCountry = (country) => {
    const key = getCountryKey(country);
    return key === 'ecuador' || key === 'panama' || key === 'usa';
};

export const isSingleCurrencyCountry = (country) => {
    const key = getCountryKey(country);
    return key === 'ecuador' || key === 'panama' || key === 'usa' || key === 'colombia' || key === 'espana';
};

export const getTaxLabel = (countryOverride) => getRegionConfig(countryOverride).taxLabel;
export const getTaxFullName = (countryOverride) => getRegionConfig(countryOverride).taxFullName;
export const getTaxAuthority = (countryOverride) => getRegionConfig(countryOverride).taxAuthority;
export const getDefaultTaxRate = (countryOverride) => getRegionConfig(countryOverride).defaultTaxRate;
export const getCurrencyBadge = (countryOverride) => getRegionConfig(countryOverride).currencyBadge;
