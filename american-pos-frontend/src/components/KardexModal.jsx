import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { X, Clock, ArrowUpRight, ArrowDownLeft, RefreshCcw, AlertCircle } from 'lucide-react';
import BaseModal from './BaseModal';

export default function KardexModal({ isOpen, onClose, product }) {
    const [movements, setMovements] = useState([]);
    const [loading, setLoading] = useState(true);
    const productId = product?.id;

    const fetchMovements = useCallback(async () => {
        if (!productId) return;
        try {
            setLoading(true);
            const res = await api.get(`/reports/inventory/kardex/${productId}`);
            setMovements(res.data);
        } catch (error) {
            console.error('Error fetching kardex:', error);
        } finally {
            setLoading(false);
        }
    }, [productId]);

    useEffect(() => {
        if (isOpen && productId) {
            fetchMovements();
        }
    }, [isOpen, productId, fetchMovements]);

    if (!isOpen || !product) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-2xl"
            className="overflow-hidden flex flex-col h-[85dvh] max-h-[85dvh] pb-safe border border-slate-200 dark:border-slate-800 rounded-xl"
        >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 rounded-lg flex items-center justify-center shrink-0">
                        <Clock size={18} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">Historial Kardex</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px] sm:max-w-xs">
                            Trazabilidad: {product?.name}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                >
                    <X size={18} />
                </button>
            </div>

            {/* List Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar bg-slate-50/50 dark:bg-slate-950/20">
                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 opacity-60">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500/30 border-t-primary-500"></div>
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Consultando Registros...</span>
                    </div>
                ) : movements.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-3 opacity-40">
                        <div className="p-4 bg-slate-200 dark:bg-slate-800 rounded-full">
                            <AlertCircle size={32} />
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 max-w-[240px]">
                            Sin movimientos históricos registrados
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {movements.map((m, idx) => (
                            <div
                                key={idx}
                                className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`p-2 rounded-lg shrink-0 ${m.type === 'IN' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' :
                                            m.type === 'OUT' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400' :
                                                'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400'
                                        }`}>
                                        {m.type === 'IN' ? <ArrowDownLeft size={16} /> :
                                            m.type === 'OUT' ? <ArrowUpRight size={16} /> :
                                                <RefreshCcw size={16} />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                            {m.reason === 'Sale' ? 'Salida por Venta' :
                                                m.reason === 'Manual Adjustment' ? 'Ajuste de Stock' :
                                                    m.reason === 'Refund' ? 'Retorno / Devolución' :
                                                        m.reason === 'Stock In' ? 'Entrada de Mercancía' : m.reason}
                                        </p>
                                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                            <Clock size={11} />
                                            <span>
                                                {new Date(m.date).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="text-right shrink-0 ml-2">
                                    <div className={`text-sm sm:text-base font-bold tabular-nums ${Number(m.quantity) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                        }`}>
                                        {Number(m.quantity) > 0 ? `+${Number(m.quantity)}` : Number(m.quantity)}
                                    </div>
                                    <div className="flex items-center justify-end gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                        <span className="hidden xs:inline">Stock:</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                                            {m.finalStock || '0'} {product?.stockUnit || 'UND'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex justify-end shrink-0 pb-safe">
                <button
                    onClick={onClose}
                    className="h-9 px-4 rounded-lg font-semibold text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                >
                    Cerrar Bitácora
                </button>
            </div>
        </BaseModal>
    );
}
