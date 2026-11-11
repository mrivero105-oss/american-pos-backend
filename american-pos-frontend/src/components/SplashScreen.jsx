import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import IsaacWebLogo from './IsaacWebLogo';

export default function SplashScreen({ onFinished, minDuration = 1000 }) {
    const [isVisible, setIsVisible] = useState(true);
    const [statusText, setStatusText] = useState('Iniciando motor Isaac POS...');
    const [progress, setProgress] = useState(20);

    useEffect(() => {
        const t1 = setTimeout(() => {
            setStatusText('Cargando base de datos local...');
            setProgress(65);
        }, minDuration * 0.4);

        const t2 = setTimeout(() => {
            setStatusText('Preparando sistema...');
            setProgress(100);
        }, minDuration * 0.8);

        const t3 = setTimeout(() => {
            setIsVisible(false);
            if (onFinished) onFinished();
        }, minDuration);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
        };
    }, [minDuration, onFinished]);

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.4, ease: 'easeInOut' }}
                    className="fixed inset-0 z-[99999] bg-[#030712] flex flex-col items-center justify-center select-none overflow-hidden"
                >
                    {/* Central Brand Card */}
                    <motion.div 
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className="relative z-10 flex flex-col items-center gap-6 px-8 py-10 rounded-xl bg-slate-900 border border-slate-800 shadow-xl max-w-xs w-[90%] text-center"
                    >
                        {/* Logo Oficial de Isaac POS */}
                        <div className="px-6 py-4 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-center shadow-inner">
                            <IsaacWebLogo 
                                isLight={false} 
                                height="h-13 sm:h-16" 
                                imgClassName="max-w-[240px] sm:max-w-[280px]" 
                                className="justify-center" 
                            />
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full space-y-2">
                            <div className="w-full h-1.5 bg-slate-800/90 rounded-full overflow-hidden shadow-inner">
                                <motion.div 
                                    className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 rounded-full"
                                    initial={{ width: '0%' }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                                />
                            </div>

                            <p className="text-[11px] font-medium text-slate-400 tracking-wide font-sans animate-pulse">
                                {statusText}
                            </p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
