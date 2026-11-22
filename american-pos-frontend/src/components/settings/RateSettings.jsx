import { useState } from 'react';
import { DollarSign, Save, Loader2, CloudDownload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function RateSettings({ rate, setRate, currencyMode, setCurrencyMode, saving, onSave, country }) {
    const [isFetchingBCV, setIsFetchingBCV] = useState(false);

    const isVenezuela = (country && (country.toLowerCase() === 'venezuela' || country.toLowerCase() === 've')) || (!country && (!localStorage.getItem('pos_country') || localStorage.getItem('pos_country')?.toLowerCase() === 'venezuela'));
    if (!isVenezuela) return null;

    const handleFetchBCV = async (e) => {
        if (e) e.preventDefault();
        setIsFetchingBCV(true);
        try {
            let bcvRate = null;
            // 1. Backend oficial scraping (bcv.org.ve directo)
            try {
                const { data } = await api.get('/settings/bcv');
                if (data && data.success && data.rate) {
                    bcvRate = data.rate;
                }
            } catch (backendErr) {
                console.warn('[RateSettings] Falló endpoint BCV backend, intentando fallback:', backendErr?.message);
            }

            // 2. Fallback PyDolarVenezuela API
            if (!bcvRate) {
                try {
                    const res = await fetch('https://pydolarvenezuela-api.vercel.app/api/v1/dollar?page=bcv');
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.monitors && data.monitors.bcv && data.monitors.bcv.price) {
                            bcvRate = data.monitors.bcv.price;
                        }
                    }
                } catch (pyErr) {
                    console.warn('[RateSettings] Falló fallback PyDolarVenezuela:', pyErr?.message);
                }
            }

            // 3. Fallback DolarAPI
            if (!bcvRate) {
                const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
                if (!res.ok) throw new Error('Error al conectar con el servidor BCV');
                const data = await res.json();
                if (data && data.promedio) {
                    bcvRate = data.promedio;
                }
            }

            if (bcvRate && !isNaN(bcvRate)) {
                setRate(bcvRate.toString());
                toast.success(`Tasa Oficial BCV obtenida: ${bcvRate} Bs/$`);
            } else {
                throw new Error('No se pudo obtener la tasa oficial en este momento');
            }
        } catch (_err) {
            toast.error('Error al consultar la Tasa Oficial del BCV');
        } finally {
            setIsFetchingBCV(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs h-fit">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                    <DollarSign size={20} />
                </div>
                <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">Divisa & Tasa de Cambio</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5">Control de conversión cambiaria referencial</p>
                </div>
            </div>

            <form onSubmit={onSave} className="space-y-4">
                <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Tasa Referencial BCV (Bs/$)
                    </label>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <input
                                type="number"
                                step="any"
                                min="0.01"
                                required
                                value={rate}
                                onChange={(e) => setRate(e.target.value)}
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-lg font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all text-center placeholder:text-slate-400"
                                placeholder="0.00"
                            />
                            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">VES</div>
                        </div>
                        <button
                            type="button"
                            onClick={handleFetchBCV}
                            disabled={isFetchingBCV}
                            className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl flex items-center gap-1.5 transition-colors border border-slate-300 dark:border-slate-600 text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-50"
                            title="Consultar Tasa Oficial BCV en tiempo real"
                        >
                            {isFetchingBCV ? <Loader2 size={15} className="animate-spin text-emerald-600" /> : <CloudDownload size={15} className="text-emerald-600 dark:text-emerald-400" />}
                            <span>BCV</span>
                        </button>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Modalidad de Visualización
                    </label>
                    <select
                        value={currencyMode}
                        onChange={(e) => setCurrencyMode(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all cursor-pointer"
                    >
                        <option value="BOTH">Moneda Dual (USD y Bs)</option>
                        <option value="USD">Solo Dólares (USD)</option>
                        <option value="VES">Solo Bolívares (VES)</option>
                    </select>
                </div>

                <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors shadow-xs flex justify-center items-center gap-2 text-xs cursor-pointer"
                >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 
                    <span>Guardar Tasa</span>
                </button>
            </form>
        </div>
    );
}
