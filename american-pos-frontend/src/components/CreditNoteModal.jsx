import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
    X, 
    FileText, 
    RefreshCw, 
    Trash2
} from 'lucide-react';
import api from '../services/api';
import { formatMoney } from '../utils/format';

export default function CreditNoteModal({ isOpen, onClose, initialSale, onCreated }) {
    const [customerName, setCustomerName] = useState('');
    const [customerRif, setCustomerRif] = useState('');
    const [affectedInvoiceNumber, setAffectedInvoiceNumber] = useState('');
    const [reason, setReason] = useState('DEVOLUCION_MERCANCIA');
    const [reenterStock, setReenterStock] = useState(true);
    const [currency, setCurrency] = useState('VES');
    const [exchangeRate, setExchangeRate] = useState(1.0);
    const notes = '';
    
    // Items being returned
    const [items, setItems] = useState([]);
    const [availableProducts, setAvailableProducts] = useState([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadProducts();
            if (initialSale) {
                setAffectedInvoiceNumber(initialSale.id.length > 8 ? initialSale.id.slice(-8).toUpperCase() : initialSale.id);
                setCustomerName(initialSale.customerName || 'Consumidor Final');
                setCustomerRif(initialSale.customerRif || 'V-00000000');
                setCurrency(initialSale.currency || 'VES');
                setExchangeRate(Number(initialSale.exchangeRate) || 1.0);
                
                // If initialSale has items
                if (initialSale.SaleItems && Array.isArray(initialSale.SaleItems)) {
                    setItems(initialSale.SaleItems.map(si => ({
                        productId: si.productId,
                        name: si.productName || si.name || 'Producto',
                        quantity: Number(si.quantity) || 1,
                        price: Number(si.price) || 0,
                        taxRate: 16.00
                    })));
                }
            } else {
                setAffectedInvoiceNumber('');
                setCustomerName('Consumidor Final');
                setCustomerRif('V-00000000');
                setItems([]);
            }
        }
    }, [isOpen, initialSale]);

    const loadProducts = async () => {
        try {
            const res = await api.get('/products');
            setAvailableProducts(res.data?.products || res.data || []);
        } catch (err) {
            console.error('Error loading products for credit note:', err);
        }
    };

    const handleAddItem = (productId) => {
        const prod = availableProducts.find(p => p.id === productId);
        if (!prod) return;

        setItems([...items, {
            productId: prod.id,
            name: prod.name,
            quantity: 1,
            price: Number(prod.price) || 0,
            taxRate: 16.00
        }]);
    };

    const handleRemoveItem = (index) => {
        setItems(items.filter((_, idx) => idx !== index));
    };

    const handleUpdateQuantity = (index, qty) => {
        const updated = [...items];
        updated[index].quantity = Math.max(0.01, Number(qty) || 1);
        setItems(updated);
    };

    const handleUpdatePrice = (index, price) => {
        const updated = [...items];
        updated[index].price = Math.max(0, Number(price) || 0);
        setItems(updated);
    };

    // Financial Calculation
    const totals = useMemo(() => {
        let subtotal = 0;
        let tax = 0;

        items.forEach(it => {
            const lineSub = (Number(it.price) || 0) * (Number(it.quantity) || 0);
            const lineTax = lineSub * ((Number(it.taxRate) || 16.0) / 100);
            subtotal += lineSub;
            tax += lineTax;
        });

        return {
            subtotal,
            tax,
            total: subtotal + tax
        };
    }, [items]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (items.length === 0 && totals.total <= 0) {
            toast.error('Agrega al menos un ítem o concepto devuelto');
            return;
        }

        try {
            setSaving(true);
            const payload = {
                saleId: initialSale?.id || null,
                affectedInvoiceNumber: affectedInvoiceNumber || 'S/F',
                customerId: initialSale?.customerId || null,
                customerName: customerName || 'Consumidor Final',
                customerRif: customerRif || 'V-00000000',
                subtotal: totals.subtotal,
                taxAmount: totals.tax,
                exemptAmount: 0,
                totalAmount: totals.total,
                currency,
                exchangeRate,
                reason,
                reenterStock,
                items,
                date: new Date().toISOString().split('T')[0],
                notes
            };

            const res = await api.post('/fiscal/credit-notes', payload);
            toast.success(`Nota de Crédito ${res.data.creditNoteNumber} emitida exitosamente`);
            if (onCreated) onCreated(res.data);
            onClose();
        } catch (error) {
            console.error('Error issuing credit note:', error);
            toast.error(error.response?.data?.error || 'Error al emitir la Nota de Crédito');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden animate-in zoom-in-95 duration-150 pb-safe">
                
                {/* Header */}
                <div className="p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center font-bold shrink-0">
                            <FileText size={24} />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-slate-800 dark:text-white">
                                Emitir Nota de Crédito Fiscal
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Anula o rebaja facturas emitidas, restituye inventario y genera asiento en Libro de Ventas
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 custom-scrollbar">
                    {/* Invoice & Customer Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                Factura Afectada *
                            </label>
                            <input
                                type="text"
                                required
                                value={affectedInvoiceNumber}
                                onChange={(e) => setAffectedInvoiceNumber(e.target.value)}
                                placeholder="Ej. 00018942"
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                Cliente / Razón Social *
                            </label>
                            <input
                                type="text"
                                required
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Consumidor Final"
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                RIF / Cédula *
                            </label>
                            <input
                                type="text"
                                required
                                value={customerRif}
                                onChange={(e) => setCustomerRif(e.target.value)}
                                placeholder="V-12345678"
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                Motivo de la Nota de Crédito
                            </label>
                            <select
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none cursor-pointer"
                            >
                                <option value="DEVOLUCION_MERCANCIA">Devolución de Mercancía</option>
                                <option value="DESCUENTO_POST_VENTA">Descuento o Rebaja Concedida</option>
                                <option value="ERROR_FACTURACION">Error de Facturación / Anulación</option>
                                <option value="OTRO">Otro Motivo</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                Moneda de Emisión
                            </label>
                            <select
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none cursor-pointer"
                            >
                                <option value="VES">Bolívares (VES)</option>
                                <option value="USD">Dólares (USD)</option>
                            </select>
                        </div>
                    </div>

                    {/* Checkbox: Restock */}
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/10 flex items-center gap-3">
                        <input
                            type="checkbox"
                            id="reenterStock"
                            checked={reenterStock}
                            onChange={(e) => setReenterStock(e.target.checked)}
                            className="w-4 h-4 text-rose-500 rounded border-slate-300 focus:ring-rose-500 cursor-pointer"
                        />
                        <label htmlFor="reenterStock" className="text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                            Reingresar automáticamente los productos devueltos al Inventario (Kardex)
                        </label>
                    </div>

                    {/* Returned Items Table */}
                    <div className="space-y-2 pt-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
                                Productos / Ítems Afectados
                            </span>
                            <div className="flex items-center gap-2">
                                <select
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            handleAddItem(e.target.value);
                                            e.target.value = '';
                                        }
                                    }}
                                    className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
                                >
                                    <option value="">+ Agregar Producto...</option>
                                    {availableProducts.map(p => (
                                        <option key={p.id} value={p.id}>{p.name} - ${p.price}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {items.length === 0 ? (
                            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-white/10 text-center text-xs text-slate-400">
                                No has agregado productos devueltos a esta Nota de Crédito.
                            </div>
                        ) : (
                            <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
                                {items.map((it, idx) => (
                                    <div key={idx} className="p-3 flex items-center justify-between gap-3 text-xs bg-white dark:bg-slate-800/40">
                                        <div className="flex-1 min-w-0">
                                            <span className="font-bold text-slate-800 dark:text-white block truncate">
                                                {it.name}
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                                IVA: {it.taxRate}%
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1">
                                                <span className="text-[10px] text-slate-400">Cant:</span>
                                                <input
                                                    type="number"
                                                    step="1"
                                                    value={it.quantity}
                                                    onChange={(e) => handleUpdateQuantity(idx, e.target.value)}
                                                    className="w-16 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-white/10 rounded-lg px-2 py-1.5 min-h-[36px] text-base sm:text-xs text-center font-bold text-slate-800 dark:text-white"
                                                />
                                            </div>

                                            <div className="flex items-center gap-1">
                                                <span className="text-[10px] text-slate-400">Precio:</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={it.price}
                                                    onChange={(e) => handleUpdatePrice(idx, e.target.value)}
                                                    className="w-20 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-white/10 rounded-lg px-2 py-1.5 min-h-[36px] text-base sm:text-xs text-right font-bold text-slate-800 dark:text-white"
                                                />
                                            </div>

                                            <div className="w-24 text-right font-black tabular-nums text-slate-800 dark:text-white">
                                                {formatMoney((it.price * it.quantity), currency)}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => handleRemoveItem(idx)}
                                                className="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-rose-500 rounded-lg cursor-pointer shrink-0"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Financial Totals Summary */}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-500">
                            <span>Subtotal Base Devuelta:</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                {formatMoney(totals.subtotal, currency)}
                            </span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                            <span>Impuesto IVA (16%):</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                {formatMoney(totals.tax, currency)}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm font-black text-rose-600 dark:text-rose-400 pt-1 border-t border-slate-200 dark:border-white/10">
                            <span>Monto Total Nota de Crédito:</span>
                            <span className="tabular-nums">
                                {formatMoney(totals.total, currency)}
                            </span>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex flex-col sm:flex-row justify-end gap-2.5 pt-2 shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="min-h-[48px] px-5 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer flex items-center justify-center"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="min-h-[48px] px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-sm shadow-rose-500/20 cursor-pointer"
                        >
                            {saving ? <RefreshCw className="animate-spin" size={14} /> : null}
                            <span>Emitir Nota de Crédito</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
