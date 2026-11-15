import React, { useState } from 'react';
import { Trash2, Clock, FileText, Loader2, Pause } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';

export default function POSActionButtons({ 
    cartItems, setCartItems, 
    heldSales, setHeldSales, 
    setIsHeldModalOpen, 
    customer,
    onQuotationSaved
}) {
    const [processing, setProcessing] = useState(false);
    const { confirm, confirmDialog } = useConfirmDialog();

    const handleClearCart = async () => {
        if (cartItems.length === 0) return;
        const confirmed = await confirm({
            title: 'Vaciar carrito',
            message: '¿Estás seguro de vaciar el carrito actual?',
            confirmText: 'Vaciar carrito',
            variant: 'danger'
        });
        if (confirmed) {
            setCartItems([]);
        }
    };

    const handleHoldSale = () => {
        if (cartItems.length === 0) return;
        const newHeld = {
            id: Date.now(),
            items: [...cartItems],
            customer: customer || null,
            customerName: customer?.name || '',
            discount: 0,
            timestamp: new Date().toISOString()
        };
        setHeldSales(prev => [...prev, newHeld]);
        setCartItems([]);
        toast.success('Venta puesta en espera (guardada localmente)');
    };

    const handleSaveQuotation = async () => {
        if (cartItems.length === 0) {
            toast.error('El carrito está vacío');
            return;
        }
        
        try {
            setProcessing(true);
            const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
            
            const quotationData = {
                customerId: customer?.id || null,
                customerName: customer?.name || 'Cliente Genérico',
                customerDocument: customer?.rif || customer?.document || '',
                items: cartItems.map(item => ({
                    ...item,
                    productId: item.id || item.productId // Ensure ID mapping
                })),
                total: subtotal,
                status: 'pending',
                date: new Date().toISOString()
            };

            const res = await api.post('/quotations', quotationData);
            setCartItems([]);
            toast.success('Presupuesto generado correctamente');
            if (onQuotationSaved) onQuotationSaved(res.data.quotation || res.data);
        } catch (error) {
            console.error(error);
            toast.error('Error al generar cotización');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="grid grid-cols-4 gap-2 mb-6 mt-4">
            <button
                type="button"
                onClick={handleClearCart}
                disabled={cartItems.length === 0 || processing}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-primary-500/5 hover:bg-primary-500/10 text-primary-600 dark:text-primary-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-primary-500/20"
                title="Vaciar Carrito"
            >
                <Trash2 size={20} className="mb-1.5" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em]">Vaciar</span>
            </button>

            <button
                type="button"
                onClick={handleHoldSale}
                disabled={cartItems.length === 0 || processing}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-primary-500/5 hover:bg-primary-500/10 text-primary-600 dark:text-primary-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-primary-500/20"
                title="Pausar Venta"
            >
                <Pause size={20} className="mb-1.5" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em]">Espera</span>
            </button>

            <button
                type="button"
                onClick={() => setIsHeldModalOpen(true)}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-primary-500/5 hover:bg-primary-500/10 text-primary-600 dark:text-primary-400 transition-all border border-primary-500/20 relative"
                title="Ventas Pausadas"
            >
                <Clock size={20} className="mb-1.5" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em]">Pausadas</span>
                {heldSales.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary-600 text-white rounded-full flex items-center justify-center text-[10px] font-black shadow-lg shadow-primary-500/40 border-2 border-white dark:border-slate-900">
                        {heldSales.length}
                    </span>
                )}
            </button>

            <button
                type="button"
                onClick={handleSaveQuotation}
                disabled={cartItems.length === 0 || processing}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-primary-500/5 hover:bg-primary-500/10 text-primary-600 dark:text-primary-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-primary-500/20"
                title="Generar Cotización"
            >
                {processing ? <Loader2 size={20} className="animate-spin mb-1.5" /> : <FileText size={20} className="mb-1.5" />}
                <span className="text-[9px] font-black uppercase tracking-[0.2em]">Cotizar</span>
            </button>
            {confirmDialog}
        </div>
    );
}
