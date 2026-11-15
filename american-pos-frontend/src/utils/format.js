import api from '../services/api';
import { getSupabaseHeaders, getSupabaseRestUrl, hasSupabaseConfig } from '../config/supabaseConfig';

const getStoredSetting = (key, fallback) => {
    if (typeof window !== 'undefined') {
        try {
            const v = localStorage.getItem(key);
            if (v !== null && v !== undefined && v !== '') return v;
        } catch (_) {}
    }
    return fallback;
};

const getStoredBusinessSettings = () => {
    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_business_settings');
            if (raw) return JSON.parse(raw) || {};
        } catch (_) {}
    }
    return {};
};

let globalSettings = { 
    ...getStoredBusinessSettings(),
    rate: Number(getStoredSetting('pos_exchange_rate', 1)) || 1, 
    currencyMode: getStoredSetting('pos_currency_mode', 'BOTH'), 
    country: getStoredSetting('pos_country', '') 
};

export const setGlobalSettings = (newSettings) => {
    if (!newSettings) return;
    Object.assign(globalSettings, newSettings);
    if (newSettings.rate !== undefined) globalSettings.rate = Number(newSettings.rate) || 1;
    if (newSettings.currencyMode !== undefined) globalSettings.currencyMode = newSettings.currencyMode;
    if (newSettings.country !== undefined) globalSettings.country = (newSettings.country || '').toLowerCase().trim();
    if (newSettings.businessInfo?.country !== undefined) globalSettings.country = (newSettings.businessInfo.country || '').toLowerCase().trim();
    if (newSettings.paymentMethods !== undefined) globalSettings.paymentMethods = newSettings.paymentMethods;
};

export const fetchGlobalSettings = async () => {
    try {
        const [rateRes, pmRes, bizRes] = await Promise.all([
            api.get('/settings/rate'),
            api.get('/settings/payment-methods').catch(() => ({ data: [] })),
            api.get('/settings/business').catch(() => ({ data: getStoredBusinessSettings() }))
        ]);
        const bizData = bizRes?.data || getStoredBusinessSettings();
        if (typeof window !== 'undefined' && bizRes?.data && Object.keys(bizRes.data).length > 0) {
            try {
                localStorage.setItem('pos_business_settings', JSON.stringify(bizRes.data));
            } catch (_) {}
        }
        const merged = { ...bizData, ...rateRes.data, paymentMethods: pmRes.data || [] };
        setGlobalSettings(merged);
        return globalSettings;
    } catch (error) {
        console.error('Error fetching global settings locally, intentando Supabase Cloud:', error?.message || error);
        if (hasSupabaseConfig()) {
            try {
                const cloudRes = await fetch(getSupabaseRestUrl('cloud_configuracion?id=eq.general'), {
                    headers: getSupabaseHeaders()
                });
            if (cloudRes.ok) {
                const cloudData = await cloudRes.json();
                if (Array.isArray(cloudData) && cloudData.length > 0) {
                    const cfg = cloudData[0];
                    const cloudSettings = {
                        rate: Number(cfg.tasa_cambio || 1),
                        currencyMode: cfg.modo_moneda || 'BOTH',
                        businessName: cfg.nombre_negocio,
                        businessInfo: {
                            name: cfg.nombre_negocio,
                            address: cfg.direccion,
                            taxId: cfg.rif_cedula
                        }
                    };
                    setGlobalSettings(cloudSettings);
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('pos_exchange_rate', String(cfg.tasa_cambio));
                        localStorage.setItem('pos_currency_mode', cfg.modo_moneda || 'BOTH');
                    }
                    return globalSettings;
                }
            }
            } catch (cloudErr) {
                console.warn('Fallback de configuracion en nube fallo:', cloudErr?.message || cloudErr);
            }
        }
        return { ...getStoredBusinessSettings(), ...globalSettings };
    }
};

export const getGlobalSettings = () => globalSettings;

const formatters = {};

const getFormatter = (currency, locale = 'es-VE') => {
    const key = `${locale}-${currency}`;
    if (!formatters[key]) {
        try {
            // Check if Intl is available and NumberFormat is a function
            if (typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function') {
                formatters[key] = new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: currency,
                    minimumFractionDigits: 2
                });
            } else {
                throw new Error('Intl.NumberFormat not available');
            }
        } catch (_e) {
            console.warn(`Intl.NumberFormat failed for ${key}, using fallback.`);
            formatters[key] = {
                format: (val) => `${currency === 'VES' ? 'Bs.' : currency} ${Number(val).toFixed(2)}`
            };
        }
    }
    return formatters[key];
};

const dateFormatters = {};

export const formatDate = (date, options = { dateStyle: 'medium' }, locale = 'es-VE') => {
    const key = `${locale}-${JSON.stringify(options)}`;
    if (!dateFormatters[key]) {
        try {
            if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
                dateFormatters[key] = new Intl.DateTimeFormat(locale, options);
            } else {
                throw new Error('Intl.DateTimeFormat not available');
            }
        } catch (_e) {
            console.warn(`Intl.DateTimeFormat failed for ${key}, using fallback.`);
            dateFormatters[key] = {
                format: (d) => {
                    try {
                        const dateObj = d instanceof Date ? d : new Date(d);
                        if (isNaN(dateObj.getTime())) return String(d);
                        // Safe YYYY-MM-DD fallback
                        return dateObj.toISOString().split('T')[0];
                    } catch (_err) {
                        return String(d);
                    }
                }
            };
        }
    }
    try {
        const d = date instanceof Date ? date : new Date(date);
        return dateFormatters[key].format(d);
    } catch (_e) {
        return String(date);
    }
};

export const isDollarOnlyCountry = (country) => {
    if (!country) return false;
    const c = String(country)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
    return ['ecuador', 'panama', 'usa', 'eeuu', 'estadosunidos', 'unitedstates', 'us'].includes(c);
};

export const isUsdOnlyMode = (settings = null) => {
    const s = settings || globalSettings;
    const rawCountry = s?.country || s?.businessInfo?.country || globalSettings.country || getStoredSetting('pos_country', '');
    if (isDollarOnlyCountry(rawCountry)) return true;
    const mode = s?.currencyMode || globalSettings.currencyMode || getStoredSetting('pos_currency_mode', 'BOTH');
    return mode === 'SINGLE' || mode === 'USD' || mode === 'USD_ONLY';
};

export const isVesOnlyMode = (settings = null) => {
    if (isUsdOnlyMode(settings)) return false;
    const s = settings || globalSettings;
    const mode = s?.currencyMode || globalSettings.currencyMode || getStoredSetting('pos_currency_mode', 'BOTH');
    return mode === 'VES' || mode === 'VES_ONLY' || mode === 'BS';
};

export const isDualCurrencyMode = (settings = null) => {
    if (isUsdOnlyMode(settings)) return false;
    return !isVesOnlyMode(settings);
};

export const isSingleCurrencyMode = (settings = null) => {
    return isUsdOnlyMode(settings);
};

export const formatMoney = (val, forceCurrency = null, customSettings = null) => {
    const settings = customSettings || globalSettings;
    
    // EN MODO "SOLO USD": Absolutamente NADA en el sistema debe mostrarse en Bs.
    // Todo valor monetario se formatea indefectiblemente en Dólares ($).
    if (isUsdOnlyMode(settings)) {
        return getFormatter('USD', 'en-US').format(val || 0).replace('USD', '$');
    }

    if (forceCurrency === 'USD') {
        return getFormatter('USD', 'en-US').format(val || 0).replace('USD', '$');
    }

    if (forceCurrency === 'VES') {
        const numVal = parseFloat(val) || 0;
        const finalVal = numVal * (settings.rate || 1);
        return getFormatter('VES').format(finalVal || 0).replace('VES', 'Bs').replace('Bs.S', 'Bs').replace('Bs.', 'Bs');
    }

    if (isVesOnlyMode(settings)) {
        const numVal = parseFloat(val) || 0;
        const finalVal = numVal * (settings.rate || 1);
        return getFormatter('VES').format(finalVal || 0).replace('VES', 'Bs').replace('Bs.S', 'Bs').replace('Bs.', 'Bs');
    }

    const mode = forceCurrency || (settings.currencyMode === 'BOTH' ? 'VES' : settings.currencyMode);
    const isVES = mode === 'VES';
    const numVal = parseFloat(val) || 0;
    const finalVal = isVES ? numVal * (settings.rate || 1) : numVal;
    const finalCurrency = isVES ? 'VES' : 'USD';

    return getFormatter(finalCurrency).format(finalVal || 0).replace('VES', 'Bs').replace('Bs.S', 'Bs').replace('Bs.', 'Bs').replace('USD', '$');
};

export const formatCurrency = formatMoney;

export const formatBs = (val, customSettings = null) => {
    const settings = customSettings || globalSettings;
    if (isUsdOnlyMode(settings) || isSingleCurrencyMode(settings)) {
        return formatUSD(val);
    }
    return getFormatter('VES').format(val || 0).replace('VES', 'Bs').replace('Bs.S', 'Bs').replace('Bs.', 'Bs');
};

export const formatUSD = (val) => {
    return getFormatter('USD', 'en-US').format(val || 0);
};

/**
 * Reliable rounding for financial calculations.
 */
export const precisionRound = (value, decimals = 6) => {
    if (!value || isNaN(value)) return 0;
    const result = Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
    return isFinite(result) ? result : 0;
};

/**
 * Formats stock/quantity for display.
 * Shows integer if no decimals, otherwise rounds to specified decimals.
 */
export const formatStock = (val, decimals = 2) => {
    if (val === '∞' || val === Infinity) return '∞';
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    
    // If it's an integer, don't show decimals
    if (num % 1 === 0) return num.toFixed(0);
    
    // Otherwise show up to 'decimals' places, but remove trailing zeros
    return parseFloat(num.toFixed(decimals)).toString();
};

/**
 * Normalizes stock measurement units into standardized short format (und, kg, g, l, m, etc.)
 */
export const formatStockUnit = (unit, isSoldByWeight = false) => {
    if (isSoldByWeight) {
        if (!unit) return 'kg';
        const u = String(unit).trim().toLowerCase();
        if (['unidad', 'unidades', 'und', 'und.', 'unid', 'unid.', 'y', ''].includes(u)) return 'kg';
    }
    if (!unit) return 'und';
    const u = String(unit).trim().toLowerCase();
    if (['unidad', 'unidades', 'und', 'und.', 'unid', 'unid.', 'y'].includes(u)) return 'und';
    if (['kilogramo', 'kilogramos', 'kg', 'kgs'].includes(u)) return 'kg';
    if (['gramo', 'gramos', 'g', 'gr', 'grs'].includes(u)) return 'g';
    if (['litro', 'litros', 'l', 'lts'].includes(u)) return 'l';
    if (['metro', 'metros', 'm', 'mts'].includes(u)) return 'm';
    if (['caja', 'cajas', 'cj', 'caj'].includes(u)) return 'caj';
    if (['paquete', 'paquetes', 'paq', 'pq'].includes(u)) return 'paq';
    return u.substring(0, 5);
};

/**
 * Formats a weight value with precision (default 3 decimals for scales: e.g. 0.090 kg)
 */
export const formatWeight = (val, unit = 'kg', decimals = 3) => {
    const num = parseFloat(val);
    if (isNaN(num)) return `0.000 ${unit}`;
    return `${num.toFixed(decimals)} ${unit}`;
};

/**
 * Returns the country-specific Tax ID label (RUC for Ecuador/Panamá, NIT for Colombia, RIF for Venezuela).
 */
export const getTaxIdLabel = (countryOverride) => {
    const raw = countryOverride || globalSettings.country || getStoredSetting('pos_country', 'venezuela');
    const c = String(raw).toLowerCase().trim();
    if (c === 'ecuador' || c === 'ec') return 'RUC';
    if (c === 'colombia' || c === 'co') return 'NIT';
    if (c === 'panama' || c === 'pa') return 'RUC';
    if (c === 'usa' || c === 'us') return 'EIN';
    return 'RIF';
};

/**
 * Returns the country-specific Customer Identification label for receipts.
 */
export const getCustomerDocLabel = (countryOverride) => {
    const raw = countryOverride || globalSettings.country || getStoredSetting('pos_country', 'venezuela');
    const c = String(raw).toLowerCase().trim();
    if (c === 'ecuador' || c === 'ec') return 'RUC / C.I.';
    if (c === 'colombia' || c === 'co') return 'C.C. / NIT';
    if (c === 'panama' || c === 'pa') return 'CÉDULA / RUC';
    if (c === 'usa' || c === 'us') return 'ID / SSN';
    return 'CÉDULA / RIF';
};

/**
 * Returns placeholder format for tax ID input based on active country.
 */
export const getTaxIdPlaceholder = (countryOverride) => {
    const raw = countryOverride || globalSettings.country || getStoredSetting('pos_country', 'venezuela');
    const c = String(raw).toLowerCase().trim();
    if (c === 'ecuador' || c === 'ec') return 'EJ: 1790012345001';
    if (c === 'colombia' || c === 'co') return 'EJ: 900.123.456-1';
    if (c === 'panama' || c === 'pa') return 'EJ: 155612345-2-2020 DV 45';
    if (c === 'usa' || c === 'us') return 'EJ: 12-3456789';
    return 'EJ: J-12345678-0';
};



/**
 * Pluraliza inteligentemente el nombre de una presentación comercial en español.
 * Maneja acentos (Cartón -> Cartones), sufijos numéricos o entre paréntesis.
 */
function pluralizePresentationName(name, count) {
    if (!name) return '';
    let trimmed = String(name).trim();
    
    // Limpiar palabras redundantes como "completa", "completo", "completas"
    trimmed = trimmed.replace(/\bcomplet[ao]s?\b/gi, '').replace(/\s+/g, ' ').trim();

    // Si empieza con "1 " o "1 Un " o "Un ", removerlo porque el conteo numérico ya se antepone
    trimmed = trimmed.replace(/^(?:1\s+(?:un\s+)?|un[ao]?\s+)/i, '').trim();

    if (count <= 1) return trimmed;
    
    // Si contiene paréntesis ej: "Cartón (30 Und)" o "Caja (x360)"
    const parenMatch = trimmed.match(/^([^(]+)(\(.*\))$/);
    if (parenMatch) {
        const baseWord = parenMatch[1].trim();
        const rest = parenMatch[2];
        return `${pluralizeWord(baseWord)} ${rest}`;
    }
    
    // Si contiene formato "x360" ej: "Caja x360"
    const xMatch = trimmed.match(/^(.+?)\s+(x\d+.*)$/i);
    if (xMatch) {
        return `${pluralizeWord(xMatch[1].trim())} ${xMatch[2]}`;
    }

    return pluralizeWord(trimmed);
}

function pluralizeWord(word) {
    if (!word) return '';
    const lower = word.toLowerCase();
    if (lower.endsWith('ón')) return word.slice(0, -2) + 'ones';
    if (lower.endsWith('án')) return word.slice(0, -2) + 'anes';
    if (lower.endsWith('én')) return word.slice(0, -2) + 'enes';
    if (lower.endsWith('z')) return word.slice(0, -1) + 'ces';
    if (/[aeiouáéíóú]s$/i.test(word) || /\d$/.test(word)) return word;
    if (/[aeiou]$/i.test(word)) return word + 's';
    return word + 'es';
}

/**
 * Desglose Visual Inteligente de Stock físico para bodegas y almacenes.
 * Desglosa en empaques cerrados principales (Cajas, Cartones, Bultos) y unidades sueltas,
 * filtrando fracciones comerciales (como 1/2 Caja o 1/2 Cartón) y soportando stock negativo.
 */
export const formatPhysicalStock = (totalBaseUnits, presentations = [], legacyBulk = {}) => {
    if (totalBaseUnits === '∞' || totalBaseUnits === Infinity) return '∞';
    const total = Number(totalBaseUnits);
    if (isNaN(total)) return '0 Und';
    if (total === 0) return '0 Und';

    const isNegative = total < 0;
    let remaining = Math.abs(total);

    // Filtrar empaques físicos mayores a 1 descartando fracciones comerciales y ofertas duplicadas del mismo factor
    let physicalTiers = [];
    if (Array.isArray(presentations) && presentations.length > 0) {
        const tierMap = new Map();
        const isPromoName = (name) => /oferta|promo|descuento|especial|rebaja|liquidaci/i.test(String(name || ''));
        presentations
            .filter(p => Number(p.factorConversion) > 1 && !/1\/2|medio|media|fracci/i.test(p.name))
            .forEach(p => {
                const factor = Number(p.factorConversion);
                const existing = tierMap.get(factor);
                if (!existing || (isPromoName(existing.name) && !isPromoName(p.name))) {
                    tierMap.set(factor, { name: p.name, factor });
                }
            });
        physicalTiers = Array.from(tierMap.values()).sort((a, b) => b.factor - a.factor);
    } else if (Number(legacyBulk?.unitsPerBulk) > 1) {
        physicalTiers.push({
            name: legacyBulk.bulkUnitName || 'Bulto',
            factor: Number(legacyBulk.unitsPerBulk)
        });
    }

    const cleanUnit = (num) => Number.isInteger(num) ? String(num) : num.toFixed(2);

    if (physicalTiers.length === 0) {
        return `${isNegative ? '-' : ''}${cleanUnit(remaining)} Und`;
    }

    const parts = [];
    for (const tier of physicalTiers) {
        const count = Math.floor(remaining / tier.factor);
        if (count > 0) {
            parts.push(`${count} ${pluralizePresentationName(tier.name, count)}`);
            remaining = remaining % tier.factor;
        }
    }

    if (remaining > 0 || parts.length === 0) {
        parts.push(`${cleanUnit(remaining)} Und`);
    }

    return `${isNegative ? '-' : ''}${parts.join(' + ')}`;
};
