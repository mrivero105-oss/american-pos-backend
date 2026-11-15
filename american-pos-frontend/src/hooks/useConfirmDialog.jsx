import { useState, useCallback, useRef, useEffect } from 'react';
import { MessageSquare, X } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import BaseModal from '../components/BaseModal';

/**
 * Hook declarativo para reemplazar window.confirm y window.prompt con modales
 * accesibles integrados al sistema visual de Isaac POS.
 */
export function useConfirmDialog() {
    const resolverRef = useRef(null);
    const [dialogState, setDialogState] = useState({
        isOpen: false,
        mode: 'confirm',
        title: '¿Estás seguro?',
        message: '',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
        variant: 'primary',
        zIndex: 'z-[100000]',
        placeholder: '',
        inputValue: '',
        multiline: false
    });

    const settle = useCallback((value) => {
        const resolver = resolverRef.current;
        resolverRef.current = null;
        setDialogState((prev) => ({ ...prev, isOpen: false }));
        if (resolver) {
            resolver(value);
        }
    }, []);

    useEffect(() => {
        return () => {
            if (resolverRef.current) {
                const pendingMode = dialogState.mode;
                const resolver = resolverRef.current;
                resolverRef.current = null;
                resolver(pendingMode === 'prompt' ? null : false);
            }
        };
    }, [dialogState.mode]);

    const confirm = useCallback((options = {}) => {
        if (resolverRef.current) {
            resolverRef.current(false);
            resolverRef.current = null;
        }
        return new Promise((resolve) => {
            resolverRef.current = resolve;
            setDialogState({
                isOpen: true,
                mode: 'confirm',
                title: options.title || '¿Confirmar acción?',
                message: options.message || '',
                confirmText: options.confirmText || 'Confirmar',
                cancelText: options.cancelText || 'Cancelar',
                variant: options.variant || 'primary',
                zIndex: options.zIndex || 'z-[100000]',
                placeholder: '',
                inputValue: '',
                multiline: false
            });
        });
    }, []);

    const prompt = useCallback((options = {}) => {
        if (resolverRef.current) {
            resolverRef.current(null);
            resolverRef.current = null;
        }
        return new Promise((resolve) => {
            resolverRef.current = resolve;
            setDialogState({
                isOpen: true,
                mode: 'prompt',
                title: options.title || 'Ingresar valor',
                message: options.message || '',
                confirmText: options.confirmText || 'Aceptar',
                cancelText: options.cancelText || 'Cancelar',
                variant: options.variant || 'primary',
                zIndex: options.zIndex || 'z-[100000]',
                placeholder: options.placeholder || '',
                inputValue: options.defaultValue || '',
                multiline: Boolean(options.multiline)
            });
        });
    }, []);

    const confirmDialog = dialogState.mode === 'prompt' ? (
        <BaseModal
            isOpen={dialogState.isOpen}
            onClose={() => settle(null)}
            maxWidth="max-w-[460px]"
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xl"
        >
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    settle(dialogState.inputValue);
                }}
            >
                <div className="px-5 pt-5 pb-4 flex items-start gap-3.5 relative">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/50">
                        <MessageSquare className="text-sky-600 dark:text-sky-400" size={19} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0 pr-6 space-y-2">
                        <h3 className="text-base sm:text-[17px] font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
                            {dialogState.title}
                        </h3>
                        {dialogState.message && (
                            <p className="text-xs sm:text-[13px] font-normal text-slate-500 dark:text-slate-400 leading-relaxed">
                                {dialogState.message}
                            </p>
                        )}
                        {dialogState.multiline ? (
                            <textarea
                                autoFocus
                                rows={3}
                                value={dialogState.inputValue}
                                placeholder={dialogState.placeholder}
                                onChange={(e) => setDialogState((prev) => ({ ...prev, inputValue: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                        ) : (
                            <input
                                autoFocus
                                type="text"
                                value={dialogState.inputValue}
                                placeholder={dialogState.placeholder}
                                onChange={(e) => setDialogState((prev) => ({ ...prev, inputValue: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => settle(null)}
                        className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        aria-label="Cerrar"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="px-5 py-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => settle(null)}
                        className="w-full sm:w-auto min-h-[38px] px-4 py-2 rounded-lg font-semibold text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/70 border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
                    >
                        {dialogState.cancelText}
                    </button>
                    <button
                        type="submit"
                        className="w-full sm:w-auto min-h-[38px] px-4 py-2 rounded-lg font-semibold text-xs sm:text-[13px] text-white bg-sky-600 hover:bg-sky-700 transition-colors cursor-pointer shadow-2xs"
                    >
                        {dialogState.confirmText}
                    </button>
                </div>
            </form>
        </BaseModal>
    ) : (
        <ConfirmModal
            isOpen={dialogState.isOpen}
            onClose={() => settle(false)}
            onConfirm={() => settle(true)}
            title={dialogState.title}
            message={dialogState.message}
            confirmText={dialogState.confirmText}
            cancelText={dialogState.cancelText}
            variant={dialogState.variant}
            zIndex={dialogState.zIndex}
        />
    );

    return { confirm, prompt, confirmDialog };
}

export default useConfirmDialog;
