import { useState } from 'react';
import { Store, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function SetupWizard({ onComplete }) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        country: 'venezuela', // Valor por defecto local
        businessName: ''
    });

    const countries = [
        { id: 'venezuela', name: 'Venezuela', flag: '🇻🇪', currency: 'USD / BS', tax: 'IVA 16% + IGTF' },
        { id: 'colombia', name: 'Colombia', flag: '🇨🇴', currency: 'COP', tax: 'IVA 19%' },
        { id: 'panama', name: 'Panamá', flag: '🇵🇦', currency: 'USD', tax: 'ITBMS 7%' },
        { id: 'ecuador', name: 'Ecuador', flag: '🇪🇨', currency: 'USD', tax: 'IVA 15%' },
        { id: 'chile', name: 'Chile', flag: '🇨🇱', currency: 'CLP', tax: 'IVA 19%' }
    ];

    const handleNext = () => {
        if (step === 1 && !formData.country) return toast.error('Selecciona tu país');
        if (step === 2 && !formData.businessName) return toast.error('Ingresa el nombre del negocio');
        setStep(step + 1);
    };

    const handleFinish = async () => {
        try {
            setLoading(true);
            await api.post('/settings/setup', formData);
            toast.success('¡Configuración inicial completada!');
            onComplete();
        } catch (_error) {
            toast.error('Error al guardar la configuración');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe sm:pb-4">
            <motion.div 
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="w-full max-w-xl max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800"
            >
                {/* Header */}
                <div className="p-4 sm:p-6 pb-3 sm:pb-4 flex justify-between items-start shrink-0 border-b border-slate-100 dark:border-slate-800/80">
                    <div className="space-y-1">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                            {step === 1 && '¿Dónde te encuentras?'}
                            {step === 2 && 'Identidad del Negocio'}
                            {step === 3 && '¡Todo Listo!'}
                        </h2>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium">
                            {step === 1 && 'Personalizaremos la moneda e impuestos para tu región.'}
                            {step === 2 && '¿Cómo se llama tu empresa o establecimiento?'}
                            {step === 3 && 'Hemos configurado los presets según tu ubicación.'}
                        </p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2 mt-1">
                        {[1, 2, 3].map(i => (
                            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${step === i ? 'w-5 bg-indigo-600' : 'w-2 bg-slate-200 dark:bg-slate-700'}`} />
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className="p-4 sm:p-6 flex-1 overflow-y-auto min-h-0 flex flex-col">
                    <AnimatePresence mode="wait">
                        {step === 1 && (
                            <motion.div 
                                key="step1"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="grid grid-cols-1 gap-2.5"
                            >
                                {countries.map((c) => (
                                    <button
                                        key={c.id}
                                        onClick={() => setFormData({ ...formData, country: c.id })}
                                        className={`flex items-center justify-between p-3.5 rounded-xl border transition-colors cursor-pointer min-h-[44px] ${
                                            formData.country === c.id 
                                            ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30' 
                                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">{c.flag}</span>
                                            <div className="text-left">
                                                <div className="font-semibold text-sm text-slate-900 dark:text-white">{c.name}</div>
                                                <div className="text-xs text-slate-500 font-medium">{c.currency} • {c.tax}</div>
                                            </div>
                                        </div>
                                        {formData.country === c.id && <CheckCircle2 className="text-indigo-600 dark:text-indigo-400" size={20} />}
                                    </button>
                                ))}
                            </motion.div>
                        )}

                        {step === 2 && (
                            <motion.div 
                                key="step2"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex flex-col items-center justify-center space-y-6 flex-1 my-auto py-4"
                            >
                                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/40 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <Store size={32} />
                                </div>
                                <div className="w-full space-y-2">
                                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">Nombre Comercial</label>
                                    <input 
                                        autoFocus
                                        type="text" 
                                        placeholder="Ej: Inversiones Isaac POS"
                                        value={formData.businessName}
                                        onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                                        className="w-full min-h-[44px] p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-base font-semibold focus:ring-1 focus:ring-indigo-500 outline-none transition-colors text-slate-900 dark:text-white placeholder:text-slate-400"
                                    />
                                </div>
                            </motion.div>
                        )}

                        {step === 3 && (
                            <motion.div 
                                key="step3"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center space-y-4 flex-1 text-center my-auto py-4"
                            >
                                <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 size={36} />
                                </div>
                                <div className="space-y-1.5">
                                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">Configuración Lista</h3>
                                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                                        Se han configurado los métodos de pago, monedas y tasas base para {countries.find(c => c.id === formData.country)?.name}.
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer Buttons */}
                <div className="p-4 sm:p-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] border-t border-slate-100 dark:border-slate-800 flex gap-2.5 shrink-0 bg-white dark:bg-slate-900">
                    {step > 1 && step < 3 && (
                        <button 
                            onClick={() => setStep(step - 1)}
                            className="flex-1 min-h-[40px] py-2 px-3.5 rounded-lg font-semibold text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors cursor-pointer shadow-xs"
                        >
                            Atrás
                        </button>
                    )}
                    <button 
                        onClick={step === 3 ? handleFinish : handleNext}
                        disabled={loading}
                        className="flex-[2] min-h-[40px] py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                    >
                        {loading ? <Loader2 className="animate-spin" size={16} /> : (
                            <>
                                <span>{step === 3 ? 'Comenzar ahora' : 'Continuar'}</span>
                                <ChevronRight size={16} />
                            </>
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
