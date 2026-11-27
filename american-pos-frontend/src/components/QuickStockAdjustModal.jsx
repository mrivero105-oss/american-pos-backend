import { useState, useEffect } from 'react';
import { Package, Plus, Minus, Hash, Save, RefreshCw } from 'lucide-react';
import BaseModal from './BaseModal';
import SupervisorPinModal from './SupervisorPinModal';
import { useAuth } from '../hooks/AuthContext';
import { formatStock } from '../utils/format';
import { getImageUrl } from '../utils/imageUtils';
import toast from 'react-hot-toast';

export default function QuickStockAdjustModal({ isOpen, onClose, product, onSave, processing, onOpenWasteModule }) {
    const { user, hasPermission } = useAuth();
    const userRole = (user?.role || '').toLowerCase();
    const isCashier = ['cashier', 'cajero', 'waiter', 'mesero'].includes(userRole);
    const canAdjustDirectly = !isCashier && (['admin', 'superadmin', 'supervisor', 'owner', 'dueño', 'master'].includes(userRole) || hasPermission('canAdjustStock'));

    const [adjustType, setAdjustType] = useState('add'); // 'add' | 'subtract' | 'set'
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('conteo_fisico');
    const [notes, setNotes] = useState('');
    const [isPinModalOpen, setIsPinModalOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setAdjustType('add');
            setQuantity('');
            setReason('conteo_fisico');
            setNotes('');
            setIsPinModalOpen(false);
        }
    }, [isOpen, product]);

    if (!isOpen || !product) return null;

    const currentStock = Number(product.stockQuantity || product.stock || 0);
    const numQty = parseFloat(quantity) || 0;

    let projectedStock = currentStock;
    if (adjustType === 'add') {
        projectedStock = currentStock + numQty;
    } else if (adjustType === 'subtract') {
        projectedStock = Math.max(0, currentStock - numQty);
    } else if (adjustType === 'set') {
        projectedStock = numQty;
    }

    const delta = projectedStock - currentStock;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (quantity === '' || isNaN(numQty) || numQty < 0) {
            return toast.error('Ingrese una cantidad válida mayor o igual a 0');
        }

        if (!canAdjustDirectly) {
            setIsPinModalOpen(true);
            return;
        }

        onSave({
            productId: product.id,
            type: adjustType,
            quantity: numQty,
            reason,
            notes
        });
    };

    const handleSupervisorApproved = (approvalId) => {
        setIsPinModalOpen(false);
        onSave({
            productId: product.id,
            type: adjustType,
            quantity: numQty,
            reason,
            notes,
            supervisorApprovalId: approvalId
        });
    };

    const reasonsList = [
        { id: 'conteo_fisico', label: '📋 Conteo Físico / Inventario' },
        { id: 'compra', label: '📥 Ingreso por Compra Directa' },
        { id: 'merma', label: '📉 Merma / Desperdicio' },
        { id: 'dañado', label: '💔 Producto Roto / Dañado' },
        { id: 'vencido', label: '⏳ Producto Vencido' },
        { id: 'uso_interno', label: '🏢 Consumo / Uso Interno' },
        { id: 'devolucion', label: '🔄 Devolución de Cliente' },
        { id: 'ajuste_inicial', label: '🚀 Corrección de Catálogo' }
    ];

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-lg"
            className="overflow-hidden flex flex-col border border-slate-200 dark:border-white/10 max-h-[92dvh] pb-safe"
        >
            {/* Header */}
            <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-primary-500 font-black shrink-0">
                        <RefreshCw size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase leading-none">
                            Ajuste Rápido de Stock
                        </h2>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">
                            Sincronización Inmediata con Kardex
                        </p>
                    </div>
                </div>
            </div>

            {/* Product Summary Card */}
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
                <div className="flex items-center gap-3 sm:gap-4 bg-slate-50 dark:bg-white/5 p-3 sm:p-3.5 rounded-2xl border border-slate-200/60 dark:border-white/10">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                        {product.imageUri ? (
                            <img src={getImageUrl(product.imageUri)} alt={product.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        ) : (
                            <Package size={22} className="text-slate-400" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="font-black text-slate-900 dark:text-white text-xs sm:text-sm truncate uppercase">{product.name}</h4>
                        <div className="flex items-center gap-1.5 sm:gap-2 mt-1">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">{product.barcode || 'S/C'}</span>
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-primary-500/10 text-primary-500 border border-primary-500/20 uppercase truncate">
                                {product.category || 'General'}
                            </span>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <span className="text-[8px] sm:text-[9px] font-black text-slate-400 uppercase tracking-widest block">Stock Actual</span>
                        <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white tabular-nums">
                            {formatStock(currentStock, product.isSoldByWeight ? 3 : 0)} {product.stockUnit || 'UND'}
                        </span>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Action Selector */}
                    <div>
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                            Tipo de Operación
                        </label>
                        <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-white/5 p-1.5 rounded-2xl border border-slate-200 dark:border-white/10">
                            <button
                                type="button"
                                onClick={() => setAdjustType('add')}
                                className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                    adjustType === 'add'
                                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-emerald-500'
                                }`}
                            >
                                <Plus size={14} /> Entrada (+)
                            </button>
                            <button
                                type="button"
                                onClick={() => setAdjustType('subtract')}
                                className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                    adjustType === 'subtract'
                                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-rose-500'
                                }`}
                            >
                                <Minus size={14} /> Salida (-)
                            </button>
                            <button
                                type="button"
                                onClick={() => setAdjustType('set')}
                                className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                    adjustType === 'set'
                                        ? 'bg-primary-600 text-white shadow-md shadow-primary-600/30'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-primary-500'
                                }`}
                            >
                                <Hash size={14} /> Conteo (=)
                            </button>
                        </div>
                    </div>

                    {/* Quantity Input & Projected Stock */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                                {adjustType === 'set' ? 'Nuevo Stock Real' : 'Cantidad a Ajustar'}
                            </label>
                            <input
                                type="number"
                                step={product.isSoldByWeight ? '0.001' : '1'}
                                min="0"
                                required
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                placeholder="0"
                                autoFocus
                                className="w-full px-4 py-3 min-h-[48px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-base sm:text-lg focus:border-primary-500 focus:outline-none"
                            />
                        </div>

                        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 flex flex-col justify-center min-h-[48px]">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stock Resultante</span>
                            <div className="flex items-baseline gap-2 mt-0.5">
                                <span className={`text-xl font-black tabular-nums ${projectedStock <= 0 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                                    {formatStock(projectedStock, product.isSoldByWeight ? 3 : 0)}
                                </span>
                                <span className={`text-[10px] font-black uppercase ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    ({delta >= 0 ? `+${delta}` : delta})
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Reason Selector */}
                    <div>
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                            Motivo del Ajuste (Kardex)
                        </label>
                        <select
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full px-4 py-3 min-h-[44px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white text-base sm:text-xs font-black uppercase tracking-wider focus:border-primary-500 focus:outline-none cursor-pointer"
                        >
                            {reasonsList.map(r => (
                                <option key={r.id} value={r.id}>{r.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Financial Loss Warning when subtracting or selecting loss reason */}
                    {(adjustType === 'subtract' || ['merma', 'dañado', 'vencido', 'uso_interno'].includes(reason)) && numQty > 0 && (
                        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-between text-xs">
                            <span className="font-bold text-rose-600 dark:text-rose-400">
                                📉 Pérdida al costo: ${(numQty * Number(product.cost || 0)).toFixed(2)}
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold">
                                Registrado en auditoría
                            </span>
                        </div>
                    )}

                    {onOpenWasteModule && (
                        <button
                            type="button"
                            onClick={() => {
                                onClose();
                                onOpenWasteModule(product);
                            }}
                            className="w-full py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-[11px] font-black uppercase tracking-wider border border-rose-200 dark:border-rose-900/50 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                            <span>📉 Abrir en Módulo de Mermas & Auditoría</span>
                        </button>
                    )}

                    {/* Action Buttons */}
                    <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex flex-col-reverse sm:flex-row items-center justify-end gap-2 sm:gap-3 sticky bottom-0 bg-white dark:bg-slate-900 py-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full sm:w-auto px-5 py-3 min-h-[48px] sm:min-h-[44px] rounded-2xl text-xs font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex items-center justify-center cursor-pointer"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={processing || quantity === ''}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] sm:min-h-[44px] bg-primary-600 hover:bg-primary-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-primary-600/30 transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
                        >
                            {processing ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Guardando...
                                </>
                            ) : (
                                <>
                                    <Save size={15} /> Aplicar Ajuste
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            {isPinModalOpen && (
                <SupervisorPinModal
                    isOpen={isPinModalOpen}
                    onClose={() => setIsPinModalOpen(false)}
                    onApprove={handleSupervisorApproved}
                    actionType={`AJUSTE DE STOCK (${adjustType.toUpperCase()} ${numQty})`}
                    referenceId={product.id}
                />
            )}
        </BaseModal>
    );
}
