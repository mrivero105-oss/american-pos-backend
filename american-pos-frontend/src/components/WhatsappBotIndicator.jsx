import { useState, useEffect } from 'react';
import { MessageCircle, QrCode, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';

export default function WhatsappBotIndicator({ onOpenModal }) {
    const [status, setStatus] = useState('DISCONNECTED');
    const [isHovered, setIsHovered] = useState(false);

    const fetchStatus = async () => {
        try {
            const { data } = await api.get('/whatsapp/status');
            if (data && data.status) {
                setStatus(data.status);
            }
        } catch (error) {
            // Silencioso para no ensuciar la consola
        }
    };

    useEffect(() => {
        // Skip polling on mobile screens where this indicator is hidden in header
        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
            return;
        }

        fetchStatus();
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                fetchStatus();
            }
        }, 20000); // Polling cada 20 segundos en desktop

        return () => clearInterval(interval);
    }, []);

    const isConnected = status === 'CONNECTED';
    const isQrReady = status === 'QR_READY';
    const isInitializing = status === 'INITIALIZING';

    return (
        <div 
            className="relative"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <motion.button 
                type="button"
                onClick={onOpenModal}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-all duration-150 cursor-pointer select-none active:scale-95"
                aria-label="Estado del Servicio de WhatsApp"
                title="Servicio de WhatsApp"
            >
                <div className="relative flex items-center justify-center">
                    {isInitializing ? (
                        <Loader2 size={13} className="animate-spin text-slate-500" />
                    ) : isQrReady ? (
                        <QrCode size={13} className="text-slate-500 dark:text-slate-400" />
                    ) : (
                        <MessageCircle size={14} className="text-slate-500 dark:text-slate-400" />
                    )}

                    <span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${
                        isConnected ? 'bg-emerald-500' : isQrReady ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'
                    }`}></span>
                </div>

                <span className="text-[11.5px] font-bold text-slate-700 dark:text-slate-200 hidden xl:inline">
                    WhatsApp
                </span>
            </motion.button>

            {/* Quick Preview Tooltip */}
            <AnimatePresence>
                {isHovered && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        onClick={onOpenModal}
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 p-4 z-[1000] backdrop-blur-2xl cursor-pointer"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                                <MessageCircle size={13} className="text-emerald-500" />
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-800 dark:text-white">Servicio WhatsApp</span>
                            </div>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                isConnected ? 'bg-emerald-500/20 text-emerald-500' : isQrReady ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-500/20 text-slate-400'
                            }`}>
                                {status}
                            </span>
                        </div>

                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                            {isConnected 
                                ? 'El servicio de WhatsApp está activo para envío de comprobantes y notificaciones.'
                                : isQrReady 
                                    ? 'Código QR generado. Haz clic para escanearlo con WhatsApp en tu celular.'
                                    : isInitializing
                                        ? 'El servicio se está iniciando en segundo plano...'
                                        : 'El servicio está desconectado. Haz clic para vincular tu WhatsApp.'}
                        </p>

                        <div className="mt-3 pt-2 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase text-primary-500">
                            <span>Clic para administrar</span>
                            <span>→</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
