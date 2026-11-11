import React, { useEffect } from 'react';
import { usePos } from '../hooks/PosContext';
import { RotateCcw, X, AlertTriangle, ShoppingCart, Clock } from 'lucide-react';
import { formatBs } from '../utils/format';

/**
 * DraftRecoveryBanner
 * Alerta táctica de recuperación instantánea de compras interrumpidas ante cortes de energía eléctrica o cierres de ventana.
 */
export default function DraftRecoveryBanner() {
    const { pendingRecoveryDraft, handleRestoreDraft, handleDiscardDraft, exchangeRate } = usePos();

    // Atajos de teclado: Enter para recuperar, Escape para descartar
    useEffect(() => {
        if (!pendingRecoveryDraft) return;

        const handleKeyDown = (e) => {
            // Solo si no estamos escribiendo en un input
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                handleRestoreDraft();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleDiscardDraft();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pendingRecoveryDraft, handleRestoreDraft, handleDiscardDraft]);

    if (!pendingRecoveryDraft || !Array.isArray(pendingRecoveryDraft.items) || pendingRecoveryDraft.items.length === 0) {
        return null;
    }

    const itemCount = pendingRecoveryDraft.items.length;
    const totalUSD = Number(pendingRecoveryDraft.totalUSD || 0);
    const totalVES = totalUSD * (Number(exchangeRate) || 1);
    const savedTime = pendingRecoveryDraft.updatedAt 
        ? new Date(pendingRecoveryDraft.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'reciente';

    return (
        <div className="w-full bg-amber-500/10 dark:bg-amber-950/40 border-b border-amber-500/30 px-3 py-2 animate-in slide-in-from-top-2 duration-200 select-none z-30">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
                        <AlertTriangle size={17} className="animate-pulse" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-black tracking-tight text-amber-900 dark:text-amber-200">
                                Venta interrumpida detectada en esta caja
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold bg-amber-200/60 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                                <Clock size={10} />
                                {savedTime}
                            </span>
                        </div>
                        <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 truncate">
                            Contiene <strong>{itemCount} producto{itemCount > 1 ? 's' : ''}</strong> por un total de{' '}
                            <strong className="font-mono text-amber-950 dark:text-white">${totalUSD.toFixed(2)}</strong> ({formatBs(totalVES)}).
                            {pendingRecoveryDraft.customer?.name && (
                                <span className="ml-1.5 font-medium">
                                    • Cliente: <u>{pendingRecoveryDraft.customer.name}</u>
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={() => handleRestoreDraft()}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 border border-emerald-500/80"
                        title="Recuperar productos al carrito (Enter)"
                    >
                        <RotateCcw size={13} strokeWidth={2.5} />
                        <span>Recuperar Ticket</span>
                        <kbd className="hidden sm:inline text-[9px] bg-emerald-800/60 px-1 rounded font-mono font-normal">Enter</kbd>
                    </button>

                    <button
                        type="button"
                        onClick={handleDiscardDraft}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-200/80 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-all border border-slate-300 dark:border-slate-700 flex items-center gap-1 cursor-pointer"
                        title="Descartar este borrador (Esc)"
                    >
                        <X size={13} />
                        <span className="hidden sm:inline">Descartar</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
