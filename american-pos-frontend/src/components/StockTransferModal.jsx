import { useState, useEffect, useMemo } from 'react';
import { X, ArrowRightLeft, AlertCircle, Building2 } from 'lucide-react';
import api from '../services/api';
import BaseModal from './BaseModal';

export default function StockTransferModal({ isOpen, onClose, product, currentBranchId, branches }) {
    const [formData, setFormData] = useState({
        toBranchId: '',
        quantity: ''
    });
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState(null);

    // Filter out the current branch from destinations
    const availableDestinations = useMemo(
        () => (branches || []).filter(b => b.id !== currentBranchId),
        [branches, currentBranchId]
    );

    useEffect(() => {
        if (isOpen) {
            setFormData({ toBranchId: availableDestinations[0]?.id || '', quantity: '' });
            setError(null);
        }
    }, [isOpen, availableDestinations]);

    if (!isOpen || !product) return null;

    const maxTransferable = product.stockQuantity;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (!formData.toBranchId) {
            setError('Seleccione una sucursal de destino');
            return;
        }

        const qty = Number(formData.quantity);
        if (qty <= 0 || qty > maxTransferable) {
            setError(`Cantidad inválida. Máximo disponible: ${maxTransferable}`);
            return;
        }

        try {
            setProcessing(true);
            await api.post('/products/transfer', {
                productId: product.id,
                fromBranchId: currentBranchId,
                toBranchId: formData.toBranchId,
                quantity: qty
            });
            onClose(true); // Tell parent to refresh
        } catch (err) {
            console.error('Transfer error:', err);
            setError(err.response?.data?.error || 'Error al transferir inventario');
        } finally {
            setProcessing(false);
        }
    };

    const sourceBranch = branches.find(b => b.id === currentBranchId);

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={() => onClose(false)}
            maxWidth="max-w-md"
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-100 dark:border-slate-800 max-h-[92dvh] pb-safe flex flex-col"
        >

                {/* Header */}
                <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 truncate">
                            <ArrowRightLeft size={20} className="text-primary-600 dark:text-primary-400 shrink-0" />
                            Transferir Stock
                        </h2>
                        <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {product.name}
                        </p>
                    </div>
                    <button
                        onClick={() => onClose(false)}
                        className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-200/50 dark:hover:bg-slate-700 transition-all cursor-pointer shrink-0 ml-2"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 sm:p-6 overflow-y-auto flex-1">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl flex items-start gap-3 text-red-700 dark:text-red-400">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                    )}

                    <form id="transfer-form" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">

                        {/* Source Branch Info */}
                        <div className="bg-slate-50 dark:bg-slate-800 p-3.5 sm:p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 sm:mb-2">
                                Origen
                            </label>
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white dark:bg-slate-700 rounded-lg shadow-sm border border-slate-200 dark:border-slate-600 shrink-0">
                                    <Building2 size={20} className="text-slate-600 dark:text-slate-300" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-slate-800 dark:text-slate-100 truncate">
                                        {sourceBranch?.name || 'Sucursal Actual'}
                                    </p>
                                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                        Disponible: <span className="font-black text-slate-700 dark:text-slate-200">{maxTransferable}</span> {product.stockUnit}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Transfer Form Inputs */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                    Sucursal Destino
                                </label>
                                <select
                                    required
                                    value={formData.toBranchId}
                                    onChange={(e) => setFormData(prev => ({ ...prev, toBranchId: e.target.value }))}
                                    className="w-full px-4 py-3 min-h-[44px] border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 outline-none transition-all text-base sm:text-sm cursor-pointer"
                                >
                                    <option value="" disabled>Seleccione un destino...</option>
                                    {availableDestinations.map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex justify-between">
                                    <span>Cantidad a Transferir</span>
                                    <span className="text-slate-500 dark:text-slate-400 font-normal">Máx: {maxTransferable}</span>
                                </label>
                                <div className="relative">
                                    <input
                                        required
                                        type="number"
                                        min="0.01"
                                        step={product.isSoldByWeight ? "0.01" : "1"}
                                        max={maxTransferable}
                                        value={formData.quantity}
                                        onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                                        className="w-full px-4 py-3 min-h-[48px] border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 outline-none transition-all text-base sm:text-lg font-bold"
                                        placeholder="0"
                                    />
                                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                                        <span className="text-slate-500 dark:text-slate-400 font-medium lowercase tracking-wider">{product.stockUnit}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 shrink-0 pb-safe">
                    <button
                        type="button"
                        onClick={() => onClose(false)}
                        disabled={processing}
                        className="w-full sm:w-auto px-5 py-2.5 min-h-[48px] sm:min-h-[44px] rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        form="transfer-form"
                        disabled={processing || availableDestinations.length === 0}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 min-h-[48px] sm:min-h-[44px] rounded-xl font-bold text-white bg-primary-600 hover:bg-primary-700 focus:ring-4 focus:ring-primary-500/30 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {processing ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        ) : (
                            <>Confirmar Traspaso</>
                        )}
                    </button>
                </div>
        </BaseModal>
    );
}
