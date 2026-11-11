import { useState } from 'react';
import { Calculator, DollarSign, Loader2, Save, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TaxSettings({ taxes, setTaxes, saving, onSave, country }) {
    const [isSectionOpen, setIsSectionOpen] = useState(true);

    const effectiveCountry = (country || localStorage.getItem('pos_country') || '').toLowerCase();
    const isVenezuela = effectiveCountry === 'venezuela' || effectiveCountry === 've';

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs h-fit">
            {/* Header del Esquema Tributario - Clickeable */}
            <div 
                onClick={() => setIsSectionOpen(!isSectionOpen)}
                className={`flex items-center justify-between gap-4 cursor-pointer select-none transition-colors ${isSectionOpen ? 'mb-5 pb-4 border-b border-slate-200 dark:border-slate-800' : ''}`}
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                        <Calculator size={20} />
                    </div>
                    <div>
                        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2 flex-wrap">
                            Esquema Tributario
                            <span className="text-xs font-semibold px-2 py-0.5 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300 rounded-md border border-primary-200 dark:border-primary-800/60 whitespace-nowrap">
                                IVA {taxes?.ivaEnabled ? `${taxes.ivaRate}%` : 'Inactivo'}
                            </span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5">Gestión de alícuotas e impuestos locales</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <div className={`p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-transform ${isSectionOpen ? 'rotate-180' : ''}`}>
                        <ChevronDown size={16} />
                    </div>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {isSectionOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                    >
                        <form onSubmit={onSave} className="space-y-4">
                            <div className="space-y-3">
                                {/* IVA Toggle Module */}
                                <div className={`p-4 rounded-xl border transition-colors ${taxes.ivaEnabled ? 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-300 dark:border-slate-700' : 'bg-slate-50/30 dark:bg-slate-800/20 border-slate-200 dark:border-slate-800 opacity-60'}`}>
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200">
                                                <Calculator size={15} />
                                            </div>
                                            <div>
                                                <h3 className="text-xs font-bold text-slate-900 dark:text-white">Activar IVA</h3>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Impuesto al Valor Agregado</p>
                                            </div>
                                        </div>
                                        <div className="relative inline-flex items-center cursor-pointer shrink-0" onClick={() => setTaxes({ ...taxes, ivaEnabled: !taxes.ivaEnabled })}>
                                            <div className={`w-11 h-6 rounded-full transition-colors ${taxes.ivaEnabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                                            <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-xs ${taxes.ivaEnabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                        </div>
                                    </div>

                                    {taxes.ivaEnabled && (
                                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                                            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Tasa IVA Vigente (%)</label>
                                            <input
                                                type="number"
                                                step="any"
                                                min="0"
                                                value={taxes.ivaRate}
                                                onChange={(e) => setTaxes({ ...taxes, ivaRate: parseFloat(e.target.value) || 0 })}
                                                className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 text-center"
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* IGTF Toggle Module - Only show for Venezuela */}
                                {isVenezuela && (
                                    <div className={`p-4 rounded-xl border transition-colors ${taxes.igtfEnabled ? 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-300 dark:border-slate-700' : 'bg-slate-50/30 dark:bg-slate-800/20 border-slate-200 dark:border-slate-800 opacity-60'}`}>
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200">
                                                    <DollarSign size={15} />
                                                </div>
                                                <div>
                                                    <h3 className="text-xs font-bold text-slate-900 dark:text-white">Activar IGTF</h3>
                                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Grandes Transacciones Financieras</p>
                                                </div>
                                            </div>
                                            <div className="relative inline-flex items-center cursor-pointer shrink-0" onClick={() => setTaxes({ ...taxes, igtfEnabled: !taxes.igtfEnabled })}>
                                                <div className={`w-11 h-6 rounded-full transition-colors ${taxes.igtfEnabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                                                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-xs ${taxes.igtfEnabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                            </div>
                                        </div>

                                        {taxes.igtfEnabled && (
                                            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Tasa IGTF Divisas (%)</label>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    min="0"
                                                    value={taxes.igtfRate}
                                                    onChange={(e) => setTaxes({ ...taxes, igtfRate: parseFloat(e.target.value) || 0 })}
                                                    className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 text-center"
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <button 
                                type="submit" 
                                disabled={saving} 
                                className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors shadow-xs flex justify-center items-center gap-2 text-xs cursor-pointer"
                            >
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 
                                <span>Guardar Esquema Tributario</span>
                            </button>
                        </form>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
