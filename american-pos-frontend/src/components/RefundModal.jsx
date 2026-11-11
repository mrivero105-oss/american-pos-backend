import { useState, useEffect } from 'react';
import { X, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import BaseModal from './BaseModal';
import SupervisorPinModal from './SupervisorPinModal';

export default function RefundModal({ isOpen, onClose, sale, onRefundSuccess, initialApprovalId = null }) {
    const [refundItems, setRefundItems] = useState([]);
    const [reason, setReason] = useState('');
    const [processing, setProcessing] = useState(false);
    const [isPinModalOpen, setIsPinModalOpen] = useState(false);

    useEffect(() => {
        if (sale && sale.SaleItems) {
            setRefundItems(sale.SaleItems.map(item => ({
                ...item,
                returnQuantity: 0
            })));
        }
    }, [sale]);

    if (!isOpen || !sale) return null;

    const handleQuantityChange = (productId, val) => {
        const item = refundItems.find(i => i.productId === productId);
        let qty = parseFloat(val) || 0;
        if (qty > item.quantity) qty = item.quantity;
        if (qty < 0) qty = 0;

        setRefundItems(prev => prev.map(i =>
            i.productId === productId ? { ...i, returnQuantity: qty } : i
        ));
    };

    const totalRefund = refundItems.reduce((sum, item) => sum + (item.price * item.returnQuantity), 0);
    const hasItemsToReturn = refundItems.some(item => item.returnQuantity > 0);

    const handleSubmit = () => {
        if (!hasItemsToReturn) {
            toast.error('Seleccione al menos un producto para devolver');
            return;
        }

        if (initialApprovalId) {
            processRefund(initialApprovalId);
        } else {
            setIsPinModalOpen(true);
        }
    };

    const processRefund = async (approvalId) => {

        try {
            setProcessing(true);
            const itemsToRefund = refundItems
                .filter(item => item.returnQuantity > 0)
                .map(item => ({
                    productId: item.productId,
                    name: item.name,
                    price: item.price,
                    quantity: item.returnQuantity
                }));

            const payload = {
                saleId: sale.id,
                reason: reason || 'Devolución de cliente',
                items: itemsToRefund,
                method: sale.paymentMethod,
                supervisorApprovalId: approvalId
            };

            await api.post('/refunds', payload);
            toast.success('Devolución procesada exitosamente');
            onRefundSuccess();
            onClose();
        } catch (error) {
            console.error('Refund error:', error);
            toast.error(error.response?.data?.error || 'Error al procesar la devolución');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <>
        <BaseModal
            isOpen={isOpen && !!sale}
            onClose={onClose}
            maxWidth="max-w-3xl"
            className="flex flex-col max-h-[90dvh] overflow-hidden border border-slate-200 dark:border-slate-800"
        >
                        {/* Header */}
                        <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
                            <div className="flex items-center gap-3 sm:gap-4 min-w-0 pr-2">
                                <div className="p-2 sm:p-2.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-900/40 shrink-0">
                                    <RotateCcw size={20} className="sm:w-5 sm:h-5" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight leading-none truncate">
                                        Procesar Devolución
                                    </h2>
                                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">Ticket: {sale.id.split('-')[0]}</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-8 h-8 flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5 custom-scrollbar">
                            {/* Notice */}
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-4 rounded-xl flex gap-3 text-amber-800 dark:text-amber-300 items-start">
                                <div className="p-1.5 bg-amber-100 dark:bg-amber-900/40 rounded-lg shrink-0">
                                    <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />
                                </div>
                                <p className="text-xs font-medium leading-relaxed">
                                    Esta acción reintegrará los productos al inventario y registrará la salida de dinero si fue en efectivo.
                                </p>
                            </div>

                            {/* Items List */}
                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">Productos Vendidos</h3>
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                                    <div className="overflow-x-auto custom-scrollbar">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                                                <tr>
                                                    <th className="py-2.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Producto</th>
                                                    <th className="py-2.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Cant.</th>
                                                    <th className="py-2.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Retorno</th>
                                                    <th className="py-2.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Subtotal</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {refundItems.map((item) => (
                                                    <tr key={item.productId} className={`transition-colors ${item.returnQuantity > 0 ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}>
                                                        <td className="py-3 px-4">
                                                            <div className="font-semibold text-slate-900 dark:text-white leading-snug">{item.name}</div>
                                                            <div className="text-[11px] font-mono text-slate-400">${Number(item.price).toFixed(2)}</div>
                                                        </td>
                                                        <td className="py-3 px-4 text-center">
                                                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-xs font-mono font-medium text-slate-600 dark:text-slate-300">
                                                                {Number(item.quantity)}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <div className="flex items-center justify-center">
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    max={Number(item.quantity)}
                                                                    min="0"
                                                                    step="any"
                                                                    value={item.returnQuantity}
                                                                    onChange={(e) => handleQuantityChange(item.productId, e.target.value)}
                                                                    className="w-16 px-2 py-1 text-center bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md focus:ring-1 focus:ring-red-500 outline-none font-bold text-xs text-slate-800 dark:text-white transition-colors"
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-right">
                                                            <span className={`font-mono font-bold text-xs tabular-nums ${item.returnQuantity > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                                                                ${(Number(item.price) * item.returnQuantity).toFixed(2)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Reason */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">Motivo de la Devolución</label>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Ej: Producto defectuoso, cambio de opinión..."
                                    className="w-full h-20 px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-1 focus:ring-red-500 outline-none text-slate-900 dark:text-white text-xs resize-none transition-colors placeholder:text-slate-400"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sticky bottom-0 pb-safe">
                            <div className="flex items-center justify-between sm:flex-col sm:items-start">
                                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total a Reembolsar</span>
                                <span className="text-xl sm:text-2xl font-bold font-mono text-red-600 dark:text-red-400 tabular-nums">${Number(totalRefund).toFixed(2)}</span>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 min-h-[38px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-semibold text-xs flex items-center justify-center cursor-pointer shadow-xs"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={processing || !hasItemsToReturn}
                                    className={`px-5 py-2 min-h-[38px] bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-xs transition-colors font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {processing ? (
                                        <>
                                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span>Procesando...</span>
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 size={16} />
                                            <span>Confirmar Devolución</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
        </BaseModal>
        
        <SupervisorPinModal
            isOpen={isPinModalOpen}
            onClose={() => setIsPinModalOpen(false)}
            onApprove={processRefund}
            actionType="SALE_REFUND"
            referenceId={sale?.id}
        />
        </>
    );
}
