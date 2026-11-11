import { useState } from 'react';
import { Globe, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

const COUNTRIES = [
    { id: 'venezuela', name: 'Venezuela', flag: '🇻🇪', currency: 'USD / Bs (VES)', currencyMode: 'BOTH', tax: 'IVA 16% + IGTF 3%', ivaRate: 16, igtfEnabled: true, igtfRate: 3 },
    { id: 'ecuador',   name: 'Ecuador',   flag: '🇪🇨', currency: 'USD',             currencyMode: 'SINGLE', tax: 'IVA 15%',         ivaRate: 15, igtfEnabled: false, igtfRate: 0 },
    { id: 'colombia',  name: 'Colombia',  flag: '🇨🇴', currency: 'COP',             currencyMode: 'SINGLE', tax: 'IVA 19%',         ivaRate: 19, igtfEnabled: false, igtfRate: 0 },
    { id: 'panama',    name: 'Panamá',    flag: '🇵🇦', currency: 'USD',             currencyMode: 'SINGLE', tax: 'ITBMS 7%',        ivaRate: 7,  igtfEnabled: false, igtfRate: 0 },
    { id: 'usa',       name: 'USA',       flag: '🇺🇸', currency: 'USD',             currencyMode: 'SINGLE', tax: 'Sales Tax 7%',    ivaRate: 7,  igtfEnabled: false, igtfRate: 0 },
];

export default function RegionSettings({ currentCountry, onRegionChanged }) {
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
                setSelectedCountry(countryId);
                localStorage.setItem('pos_country', countryId);
                localStorage.setItem('initial_setup_completed', 'true');
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                        <Globe size={20} />
                    </div>
                    <div>
                        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                            Región & Moneda Operativa
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                            Parámetros fiscales, divisas e impuestos predeterminados por país
                        </p>
                    </div>
                </div>

                {/* Active Country Pill */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0 w-fit">
                    <span className="text-base">{currentPreset.flag}</span>
                    <span>{currentPreset.name}</span>
                    <span className="text-slate-500 dark:text-slate-400 font-normal">• {currentPreset.currency}</span>
                </div>
            </div>

            {/* Countries Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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

                            <span className="text-2xl sm:text-3xl block mb-2">{country.flag}</span>
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
