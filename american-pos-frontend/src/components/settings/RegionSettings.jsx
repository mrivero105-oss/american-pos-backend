import { useState } from 'react';
import { Globe, CheckCircle2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import {
    COUNTRY_LIST,
    invalidateSettingsResourceCache,
    setGlobalSettings
} from '../../utils/format';

const COUNTRIES = COUNTRY_LIST.map((cfg) => ({
    id: cfg.id,
    code: cfg.code,
    name: cfg.name,
    currency: cfg.currencyLabel,
    currencyMode: cfg.currencyMode,
    tax: cfg.taxSummary,
    ivaRate: cfg.defaultTaxRate,
    igtfEnabled: cfg.hasIgtf,
    igtfRate: cfg.defaultIgtfRate
}));

/**
 * Banderas SVG inline 100% offline para evitar que Windows renderice emojis de bandera como texto plano ("VE", "EC", etc.).
 */
function CountryFlag({ code, className = 'w-6 h-4' }) {
    const baseCls = `${className} rounded-[3px] shadow-xs ring-1 ring-black/10 dark:ring-white/15 shrink-0`;
    switch (code) {
        case 'VE':
            return (
                <svg viewBox="0 0 24 16" className={baseCls} aria-hidden="true">
                    <rect width="24" height="5.34" y="0" fill="#FFCC00" />
                    <rect width="24" height="5.34" y="5.33" fill="#00247D" />
                    <rect width="24" height="5.34" y="10.66" fill="#CF142B" />
                    <circle cx="8.2" cy="8.7" r="0.55" fill="#FFFFFF" />
                    <circle cx="9.6" cy="7.7" r="0.55" fill="#FFFFFF" />
                    <circle cx="11.2" cy="7.2" r="0.55" fill="#FFFFFF" />
                    <circle cx="12.8" cy="7.2" r="0.55" fill="#FFFFFF" />
                    <circle cx="14.4" cy="7.7" r="0.55" fill="#FFFFFF" />
                    <circle cx="15.8" cy="8.7" r="0.55" fill="#FFFFFF" />
                </svg>
            );
        case 'EC':
            return (
                <svg viewBox="0 0 24 16" className={baseCls} aria-hidden="true">
                    <rect width="24" height="8" y="0" fill="#FFD100" />
                    <rect width="24" height="4" y="8" fill="#0033A0" />
                    <rect width="24" height="4" y="12" fill="#EF3340" />
                    <circle cx="12" cy="8" r="1.7" fill="#A16207" />
                </svg>
            );
        case 'CO':
            return (
                <svg viewBox="0 0 24 16" className={baseCls} aria-hidden="true">
                    <rect width="24" height="8" y="0" fill="#FCD116" />
                    <rect width="24" height="4" y="8" fill="#003893" />
                    <rect width="24" height="4" y="12" fill="#CE1126" />
                </svg>
            );
        case 'PA':
            return (
                <svg viewBox="0 0 24 16" className={baseCls} aria-hidden="true">
                    <rect width="24" height="16" fill="#FFFFFF" />
                    <rect width="12" height="8" x="12" y="0" fill="#D21034" />
                    <rect width="12" height="8" x="0" y="8" fill="#005293" />
                    <circle cx="6" cy="4" r="1.4" fill="#005293" />
                    <circle cx="18" cy="12" r="1.4" fill="#D21034" />
                </svg>
            );
        case 'US':
            return (
                <svg viewBox="0 0 24 16" className={baseCls} aria-hidden="true">
                    <rect width="24" height="16" fill="#FFFFFF" />
                    <rect width="24" height="2" y="0" fill="#B22234" />
                    <rect width="24" height="2" y="4" fill="#B22234" />
                    <rect width="24" height="2" y="8" fill="#B22234" />
                    <rect width="24" height="2" y="12" fill="#B22234" />
                    <rect width="10.5" height="9" x="0" y="0" fill="#3C3B6E" />
                </svg>
            );
        case 'ES':
            return (
                <svg viewBox="0 0 24 16" className={baseCls} aria-hidden="true">
                    <rect width="24" height="4" y="0" fill="#AA151B" />
                    <rect width="24" height="8" y="4" fill="#F1BF00" />
                    <rect width="24" height="4" y="12" fill="#AA151B" />
                    <rect width="3.2" height="4.2" x="5.4" y="5.9" rx="0.6" fill="#AA151B" />
                    <rect width="1.6" height="2" x="6.2" y="7" fill="#F1BF00" />
                </svg>
            );
        default:
            return null;
    }
}

export default function RegionSettings({ currentCountry, onRegionChanged, onHide }) {
    const [selectedCountry, setSelectedCountry] = useState(currentCountry?.toLowerCase() || 'venezuela');
    const [saving, setSaving] = useState(false);
    const [pendingCountry, setPendingCountry] = useState(null);

    const currentPreset = COUNTRIES.find(c => c.id === selectedCountry) || COUNTRIES.find(c => c.id === (currentCountry?.toLowerCase() || 'venezuela')) || COUNTRIES[0];

    const handleSelectCountry = async (countryId) => {
        if (countryId === selectedCountry) return;
        setPendingCountry(countryId);

        try {
            setSaving(true);
            const { data } = await api.post('/settings/region', { country: countryId });
            
            if (data.success) {
                const nextSettings = data.settings || {};
                const nextRate = Number(nextSettings.exchangeRate) || 1;
                const nextEuroRate = Number(nextSettings.euroRate) || 0;
                const nextMode = nextSettings.currencyMode || 'SINGLE';
                setSelectedCountry(countryId);
                localStorage.setItem('pos_country', countryId);
                localStorage.setItem('pos_currency_mode', nextMode);
                localStorage.setItem('pos_exchange_rate', String(nextRate));
                localStorage.setItem('pos_euro_rate', String(nextEuroRate));
                if (nextSettings.taxConfig) {
                    localStorage.setItem('pos_tax_settings', JSON.stringify(nextSettings.taxConfig));
                }
                if (Array.isArray(nextSettings.paymentMethods)) {
                    localStorage.setItem('pos_payment_methods', JSON.stringify(nextSettings.paymentMethods));
                }
                try {
                    const prevBiz = JSON.parse(localStorage.getItem('pos_business_settings') || '{}');
                    localStorage.setItem('pos_business_settings', JSON.stringify({
                        ...prevBiz,
                        ...(nextSettings.businessInfo || {}),
                        country: countryId,
                        euroRate: nextEuroRate,
                        taxConfig: nextSettings.taxConfig || prevBiz.taxConfig,
                        regionConfig: data.regionConfig || nextSettings.regionConfig
                    }));
                } catch { /* ignore storage parse */ }
                localStorage.setItem('initial_setup_completed', 'true');
                invalidateSettingsResourceCache('all');
                setGlobalSettings({
                    country: countryId,
                    rate: nextRate,
                    euroRate: nextEuroRate,
                    currencyMode: nextMode,
                    taxConfig: nextSettings.taxConfig,
                    paymentMethods: nextSettings.paymentMethods,
                    regionConfig: data.regionConfig || nextSettings.regionConfig
                });
                window.dispatchEvent(new CustomEvent('settings_changed', {
                    detail: { type: 'region', country: countryId, currencyMode: nextMode, exchangeRate: nextRate, euroRate: nextEuroRate }
                }));
                setPendingCountry(null);
                toast.success(`Región actualizada a ${COUNTRIES.find(c => c.id === countryId)?.name}. Moneda e impuestos aplicados.`);
                if (onRegionChanged) onRegionChanged(data);
            }
        } catch (error) {
            console.error('Error changing region:', error);
            toast.error('Error al cambiar la región');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-5">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                        <Globe size={20} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                            Región & Moneda Operativa
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                            Parámetros fiscales, divisas e impuestos predeterminados por país
                        </p>
                    </div>
                </div>

                {/* Active Country Pill + Hide Button sin solapamiento */}
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0 w-fit">
                        <CountryFlag code={currentPreset.code} className="w-5 h-3.5" />
                        <span>{currentPreset.name}</span>
                        <span className="text-slate-500 dark:text-slate-400 font-normal">• {currentPreset.currency}</span>
                    </div>
                    {typeof onHide === 'function' && (
                        <button
                            type="button"
                            onClick={onHide}
                            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer shrink-0"
                        >
                            Ocultar
                        </button>
                    )}
                </div>
            </div>

            {/* Countries Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {COUNTRIES.map((country) => {
                    const isSelected = selectedCountry === country.id;
                    const isPending = pendingCountry === country.id;

                    return (
                        <button
                            key={country.id}
                            type="button"
                            onClick={() => handleSelectCountry(country.id)}
                            disabled={saving}
                            className={`p-4 rounded-xl transition-all text-left relative cursor-pointer ${
                                isSelected
                                    ? 'border-2 border-primary-600 bg-primary-50/50 dark:bg-primary-950/30 shadow-xs'
                                    : 'border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            } disabled:opacity-50`}
                        >
                            {/* Check or spinner */}
                            {isSelected && (
                                <div className="absolute top-3 right-3 p-0.5 bg-primary-600 rounded-full text-white">
                                    <CheckCircle2 size={13} strokeWidth={2.5} />
                                </div>
                            )}
                            {isPending && (
                                <div className="absolute top-3 right-3 p-0.5 bg-amber-500 rounded-full text-white animate-spin">
                                    <RefreshCw size={13} strokeWidth={2.5} />
                                </div>
                            )}

                            <div className="flex items-center gap-2 mb-2.5">
                                <CountryFlag code={country.code} className="w-7 h-5" />
                                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 tracking-wider">{country.code}</span>
                            </div>
                            <h3 className={`text-xs font-bold leading-tight ${isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-slate-900 dark:text-white'}`}>
                                {country.name}
                            </h3>
                            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300 mt-1 truncate">
                                {country.currency}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                {country.tax}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
