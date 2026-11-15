import { useState } from 'react';
import { X, Save, AlertTriangle, Percent, ArrowUp, ArrowDown, Edit3, Layers, Building, DollarSign } from 'lucide-react';
import BaseModal from './BaseModal';
import SupervisorPinModal from './SupervisorPinModal';
import { useAuth } from '../hooks/AuthContext';
import toast from 'react-hot-toast';

export default function BulkEditModal({ isOpen, onClose, onSave, selectedCount, products = [], categories = [], suppliers = [] }) {
    const { user, hasPermission } = useAuth();
    const userRole = (user?.role || '').toLowerCase();
    const isCashier = ['cashier', 'cajero', 'waiter', 'mesero'].includes(userRole);
    const canDirectlyModifyPrices = !isCashier && (['admin', 'superadmin', 'supervisor', 'owner', 'dueño', 'master'].includes(userRole) || hasPermission('canModifyPrices'));

    const [applyTo, setApplyTo] = useState('selected'); // 'selected' | 'category' | 'supplier' | 'all'
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [adjustmentType, setAdjustmentType] = useState('percentage'); // 'percentage' | 'margin' | 'fixed'
    const [direction, setDirection] = useState('increase'); // 'increase' | 'decrease'
    const [value, setValue] = useState('');
    const [processing, setProcessing] = useState(false);
    const [isSupervisorPinOpen, setIsSupervisorPinOpen] = useState(false);
    const [pendingData, setPendingData] = useState(null);

    if (!isOpen) return null;

    const numVal = parseFloat(value) || 0;

    const handleSave = async (e) => {
        e.preventDefault();
        if (numVal <= 0) return toast.error('Ingrese un valor válido mayor a 0');
        if (applyTo === 'category' && !selectedCategory) return toast.error('Seleccione una categoría');
        if (applyTo === 'supplier' && !selectedSupplier) return toast.error('Seleccione un proveedor');

        const data = {
            mode: 'price',
            target: applyTo,
            category: selectedCategory,
            supplierId: selectedSupplier,
            productIds: applyTo === 'selected' ? products.map(p => p.id) : [],
            adjustmentType,
            direction,
            value: numVal
        };

        if (!canDirectlyModifyPrices) {
            setPendingData(data);
            setIsSupervisorPinOpen(true);
            return;
        }

        try {
            setProcessing(true);
            await onSave(data);
            onClose();
        } catch (error) {
            console.error('Error in bulk edit:', error);
        } finally {
            setProcessing(false);
        }
    };

    const handleSupervisorApproved = async (approvalId) => {
        setIsSupervisorPinOpen(false);
        if (pendingData) {
            try {
                setProcessing(true);
                await onSave({ ...pendingData, supervisorApprovalId: approvalId });
                setPendingData(null);
                onClose();
            } catch (error) {
                console.error('Error in bulk edit:', error);
            } finally {
                setProcessing(false);
            }
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-xl"
            className="overflow-hidden flex flex-col border border-slate-200 dark:border-white/10 max-h-[92dvh] pb-safe"
        >
            {/* Header */}
            <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 font-black shrink-0">
                        <Edit3 size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase leading-none">
                            Actualización Masiva de Precios
                        </h2>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">
                            Ajustes Maestros por Categoría, Proveedor o Selección
                        </p>
                    </div>
                </div>
            </div>

            {/* Form Content */}
            <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
                {/* Scope / Apply To */}
                <div>
                    <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                        Ámbito del Ajuste
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-100 dark:bg-white/5 p-1.5 rounded-2xl border border-slate-200 dark:border-white/10">
                        <button
                            type="button"
                            onClick={() => setApplyTo('selected')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center text-center cursor-pointer ${
                                applyTo === 'selected'
                                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-amber-500'
                            }`}
                        >
                            Selección ({products.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setApplyTo('category')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center text-center cursor-pointer ${
                                applyTo === 'category'
                                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-amber-500'
                            }`}
                        >
                            Categoría
                        </button>
                        <button
                            type="button"
                            onClick={() => setApplyTo('supplier')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center text-center cursor-pointer ${
                                applyTo === 'supplier'
                                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-amber-500'
                            }`}
                        >
                            Proveedor
                        </button>
                        <button
                            type="button"
                            onClick={() => setApplyTo('all')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center text-center cursor-pointer ${
                                applyTo === 'all'
                                    ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-rose-500'
                            }`}
                        >
                            Todo Catálogo
                        </button>
                    </div>
                </div>

                {/* Conditional Selectors */}
                {applyTo === 'category' && (
                    <div>
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                            Seleccionar Categoría
                        </label>
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-full px-4 py-3 min-h-[44px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white text-base sm:text-xs font-black uppercase focus:border-amber-500 focus:outline-none cursor-pointer"
                        >
                            <option value="">-- Elige una Categoría --</option>
                            {categories.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                )}

                {applyTo === 'supplier' && (
                    <div>
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                            Seleccionar Proveedor
                        </label>
                        <select
                            value={selectedSupplier}
                            onChange={(e) => setSelectedSupplier(e.target.value)}
                            className="w-full px-4 py-3 min-h-[44px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white text-base sm:text-xs font-black uppercase focus:border-amber-500 focus:outline-none cursor-pointer"
                        >
                            <option value="">-- Elige un Proveedor --</option>
                            {suppliers.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Adjustment Mode */}
                <div>
                    <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                        Regla de Ajuste
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-100 dark:bg-white/5 p-1.5 rounded-2xl border border-slate-200 dark:border-white/10">
                        <button
                            type="button"
                            onClick={() => setAdjustmentType('percentage')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                adjustmentType === 'percentage'
                                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-amber-500'
                            }`}
                        >
                            <Percent size={14} /> Porcentaje (%)
                        </button>
                        <button
                            type="button"
                            onClick={() => setAdjustmentType('margin')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                adjustmentType === 'margin'
                                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-emerald-500'
                            }`}
                        >
                            <DollarSign size={14} /> Margen s/Costo
                        </button>
                        <button
                            type="button"
                            onClick={() => setAdjustmentType('fixed')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                adjustmentType === 'fixed'
                                    ? 'bg-primary-600 text-white shadow-md shadow-primary-600/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-primary-500'
                            }`}
                        >
                            <DollarSign size={14} /> Monto Fijo ($)
                        </button>
                    </div>
                </div>

                {/* Direction (Increase / Decrease) - only for percentage & fixed */}
                {adjustmentType !== 'margin' && (
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setDirection('increase')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                                direction === 'increase'
                                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400'
                                    : 'border-slate-200 dark:border-white/10 text-slate-400'
                            }`}
                        >
                            <ArrowUp size={15} /> Aumentar (+)
                        </button>
                        <button
                            type="button"
                            onClick={() => setDirection('decrease')}
                            className={`py-2.5 min-h-[44px] rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                                direction === 'decrease'
                                    ? 'bg-rose-500/10 border-rose-500 text-rose-600 dark:text-rose-400'
                                    : 'border-slate-200 dark:border-white/10 text-slate-400'
                            }`}
                        >
                            <ArrowDown size={15} /> Disminuir (-)
                        </button>
                    </div>
                )}

                {/* Value Input */}
                <div>
                    <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                        {adjustmentType === 'margin' ? 'Margen / Markup sobre Costo (%)' : adjustmentType === 'percentage' ? 'Porcentaje de Ajuste (%)' : 'Monto Fijo a Sumar/Restar ($)'}
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={adjustmentType === 'margin' ? '10000' : '1000'}
                            required
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={adjustmentType === 'margin' ? 'Ej. 35%' : adjustmentType === 'percentage' ? 'Ej. 10%' : 'Ej. 0.50$'}
                            className="w-full px-4 py-3 min-h-[48px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white font-black text-base sm:text-lg focus:border-amber-500 focus:outline-none"
                        />
                    </div>
                </div>

                {/* Alert / Warning Plate */}
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 leading-relaxed">
                        Esta acción recalculará automáticamente los precios en USD y Bolívares según la tasa activa.
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex items-center justify-end gap-3 sticky bottom-0 bg-white dark:bg-slate-900 py-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-3 min-h-[48px] sm:min-h-[44px] rounded-2xl text-xs font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={processing || numVal <= 0}
                        className="flex items-center gap-2 px-6 py-3 min-h-[48px] sm:min-h-[44px] bg-amber-500 hover:bg-amber-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-amber-500/30 transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
                    >
                        {processing ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Procesando...
                            </>
                        ) : (
                            <>
                                <Save size={15} /> Aplicar Ajuste Masivo
                            </>
                        )}
                    </button>
                </div>
            </form>

            {isSupervisorPinOpen && (
                <SupervisorPinModal
                    isOpen={isSupervisorPinOpen}
                    onClose={() => {
                        setIsSupervisorPinOpen(false);
                        setPendingData(null);
                    }}
                    onApprove={handleSupervisorApproved}
                    actionType="ACTUALIZACIÓN MASIVA DE PRECIOS"
                    referenceId="BULK_PRICE_UPDATE"
                />
            )}
        </BaseModal>
    );
}
