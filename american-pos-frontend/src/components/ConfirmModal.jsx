import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import BaseModal from './BaseModal';

export default function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title = '¿Estás seguro?',
    message = 'Esta acción no se puede deshacer.',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'primary', // 'danger', 'success', 'primary'
    zIndex = 'z-[100000]',
}) {
    useEffect(() => {
        if (isOpen) {
            const handleKeys = (e) => {
                if (e.key === 'Escape' || e.key === 'Esc') {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                    return;
                }
                const isTextInput = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA';
                const isSpace = e.key === ' ' || e.code === 'Space';
                const isEnter = e.key === 'Enter';

                if ((isEnter || isSpace) && !isTextInput) {
                    e.preventDefault();
                    e.stopPropagation();
                    onConfirm();
                    onClose();
                }
            };
            window.addEventListener('keydown', handleKeys, true);
            return () => window.removeEventListener('keydown', handleKeys, true);
        }
    }, [isOpen, onClose, onConfirm]);

    if (!isOpen) return null;

    const variantConfig = {
        danger: {
            bg: 'bg-rose-600 hover:bg-rose-700',
            Icon: AlertTriangle,
            iconColor: 'text-rose-600 dark:text-rose-400',
            iconBg: 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50'
        },
        success: {
            bg: 'bg-emerald-600 hover:bg-emerald-700',
            Icon: CheckCircle,
            iconColor: 'text-emerald-600 dark:text-emerald-400',
            iconBg: 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50'
        },
        primary: {
            bg: 'bg-sky-600 hover:bg-sky-700',
            Icon: Info,
            iconColor: 'text-sky-600 dark:text-sky-400',
            iconBg: 'bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/50'
        }
    };

    const currentVariant = variantConfig[variant] || variantConfig.primary;
    const VariantIcon = currentVariant.Icon;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-[420px]"
            zIndex={zIndex}
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xl"
        >
            <div className="px-5 pt-5 pb-4 flex items-start gap-3.5 relative">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${currentVariant.iconBg}`}>
                    <VariantIcon className={currentVariant.iconColor} size={19} strokeWidth={2} />
                </div>

                <div className="flex-1 min-w-0 pr-6">
                    <h3 className="text-base sm:text-[17px] font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
                        {title}
                    </h3>
                    <p className="text-xs sm:text-[13px] font-normal text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {message}
                    </p>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    aria-label="Cerrar"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="px-5 py-3.5 pb-[max(0.875rem,calc(0.875rem+env(safe-area-inset-bottom,0px)))] border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full sm:w-auto min-h-[38px] px-4 py-2 rounded-lg font-semibold text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/70 border border-slate-300 dark:border-slate-700 transition-colors outline-none flex items-center justify-center cursor-pointer"
                >
                    {cancelText}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        onConfirm();
                        onClose();
                    }}
                    className={`w-full sm:w-auto min-h-[38px] px-4 py-2 rounded-lg font-semibold text-xs sm:text-[13px] text-white ${currentVariant.bg} transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-2xs`}
                >
                    <span>{confirmText}</span>
                    <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 bg-white/15 rounded text-[10px] font-mono leading-none">
                        ↵
                    </kbd>
                </button>
            </div>
        </BaseModal>
    );
}
