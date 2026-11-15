import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

export default function CheckoutSuccessOverlay({ showSuccess }) {
    return (
        <AnimatePresence>
            {showSuccess && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/85 dark:bg-slate-950/90 backdrop-blur-sm"
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center gap-3"
                    >
                        <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-center">
                            <CheckCircle2 size={32} className="text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                            Venta Procesada
                        </h2>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
