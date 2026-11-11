import { X, Clock, ShoppingCart, Trash2, ArrowRight, Smartphone, User, Utensils } from 'lucide-react';
import BaseModal from './BaseModal';
import { triggerHaptic } from '../utils/haptics';

export default function HeldSalesModal({ 
    isOpen, 
    onClose, 
    heldSales, 
    onRestore, 
    onRemove, 
    onResume,
    currencyMode = 'USD', 
    exchangeRate = 1, 
    formatMoney 
}) {
    if (!isOpen) return null;

    const handleClose = () => {
        triggerHaptic('light');
        onClose();
    };

    const handleRestoreSale = (sale) => {
        triggerHaptic('medium');
        const normalizedItems = Array.isArray(sale.items) ? sale.items.map(it => {
            if (it.product) {
                return {
                    ...it.product,
                    quantity: it.quantity,
                    unitPrice: it.unitPrice || it.product.price || it.product.precio,
                    price: it.product.price || it.product.precio
                };
            }
            return it;
        }) : [];

        const custName = sale.customer?.name || sale.customerName || '';
        const custDoc = sale.customer?.doc || sale.customer?.idDocument || sale.customer?.identification || sale.customerDoc || '';
        const custId = sale.customer?.id || sale.customerId || null;
        
        const customerObj = (custName || custDoc || custId) ? {
            id: custId,
            name: custName,
            idDocument: custDoc,
            doc: custDoc,
            documentId: custDoc,
            identification: custDoc
        } : null;

        const restoreCallback = onRestore || onResume;
        if (typeof restoreCallback === 'function') {
            restoreCallback({
                ...sale,
                items: normalizedItems,
                customer: customerObj,
                customerId: custId,
                customerName: custName,
                customerDoc: custDoc
            });
        }
    };

    const handleRemoveSale = (id) => {
        triggerHaptic('heavy');
        if (typeof onRemove === 'function') {
            onRemove(id);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={handleClose}
            maxWidth="max-w-3xl"
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90dvh]"
        >
            {/* Header */}
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl">
                        <Clock size={20} className="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                Ventas en Espera
                            </h2>
                            {Array.isArray(heldSales) && heldSales.length > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                                    {heldSales.length}
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider leading-none mt-0.5">
                            Recupera carritos pausados y preventas móviles
                        </p>
                    </div>
                </div>
                <button 
                    onClick={handleClose} 
                    className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                    aria-label="Cerrar modal"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 custom-scrollbar">
                {!heldSales || heldSales.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-400 dark:text-slate-500 gap-3">
                        <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                            <ShoppingCart size={36} className="opacity-50" />
                        </div>
                        <div className="text-center">
                            <p className="font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300 text-sm">No hay ventas pausadas</p>
                            <p className="text-xs text-slate-500 mt-0.5">Los carritos en espera y preventas móviles aparecerán aquí</p>
                        </div>
                    </div>
                ) : (
                    Array.isArray(heldSales) && heldSales.map((sale) => {
                        const itemCount = Array.isArray(sale.items) 
                            ? sale.items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0) 
                            : (Number(sale.itemCount) || 0);

                        const total = Array.isArray(sale.items) ? sale.items.reduce((sum, item) => {
                            const p = Number(item.price || item.unitPrice || item.product?.price || item.product?.precio || 0);
                            return sum + (p * (Number(item.quantity) || 1));
                        }, 0) : 0;

                        const calculatedFinal = total - (total * (sale.discount || 0) / 100);
                        const finalTotal = calculatedFinal > 0 ? calculatedFinal : (Number(sale.totalUSD || sale.total || 0));
                        const isMobile = sale.type === 'remote_preventa' || sale.source === 'Móvil';
                        const code = sale.code || null;

                        const rawCustomerName = sale.customer?.name || sale.customerName;
                        const customerDisplayName = rawCustomerName && rawCustomerName.trim() !== '' 
                            ? rawCustomerName 
                            : (isMobile ? 'Consumidor Final' : 'Cliente General');

                        const customerDoc = sale.customer?.doc || sale.customer?.documentId || sale.customerDoc || '';

                        // Limpiar notas automáticas/sintéticas antiguas
                        let cleanNote = (sale.note || '').trim();
                        if (cleanNote.includes('📱 Preventa') || cleanNote.includes('Preventa PV-')) {
                            cleanNote = '';
                        }

                        let dateStr = sale.date || '';
                        if (!dateStr && sale.timestamp) {
                            try {
                                const d = new Date(sale.timestamp);
                                dateStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            } catch (_) {}
                        }

                        return (
                            <div 
                                key={sale.id} 
                                className={`rounded-xl p-3.5 sm:p-4 border transition-all flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 sm:gap-4 ${
                                    isMobile 
                                        ? 'bg-indigo-50/25 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800/80 hover:border-indigo-300 dark:hover:border-indigo-700 shadow-xs' 
                                        : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 shadow-xs'
                                }`}
                            >
                                {/* Columna Izquierda: Información de la preventa */}
                                <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                                    {/* Badge de cantidad de artículos */}
                                    <div className={`h-11 w-11 sm:h-12 sm:w-12 rounded-xl flex flex-col items-center justify-center font-bold shrink-0 border shadow-xs ${
                                        isMobile 
                                            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/60' 
                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white border-slate-200 dark:border-slate-600'
                                    }`}>
                                        <span className="text-sm sm:text-base font-black leading-none">{itemCount}</span>
                                        <span className="text-[9px] font-black uppercase tracking-tight opacity-75 mt-0.5 leading-none">
                                            {itemCount === 1 ? 'art' : 'arts'}
                                        </span>
                                    </div>

                                    {/* Detalles principales */}
                                    <div className="min-w-0 flex-1 space-y-1">
                                        {/* Fila 1: Código + Badge de Preventa Móvil / Vendedor + Descuento */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {code ? (
                                                <span className="px-2 py-0.5 rounded-md font-mono font-black text-xs bg-indigo-600 text-white shadow-xs tracking-wider">
                                                    [{code}]
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                                    #{sale.id.toString().slice(-4)}
                                                </span>
                                            )}

                                            {isMobile ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-indigo-100/80 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800">
                                                    <Smartphone size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                                                    <span>Preventa Móvil</span>
                                                    {sale.sellerName && (
                                                        <span className="opacity-90 font-semibold">• {sale.sellerName}</span>
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                                    <span>Pausada en PC</span>
                                                </span>
                                            )}

                                            {(sale.table || sale.tableNumber) && (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800">
                                                    <Utensils size={11} className="shrink-0 text-amber-600 dark:text-amber-400" />
                                                    <span>{sale.table || sale.tableNumber}</span>
                                                </span>
                                            )}

                                            {sale.discount > 0 && (
                                                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded uppercase tracking-wider">
                                                    -{sale.discount}% Desc.
                                                </span>
                                            )}
                                        </div>

                                        {/* Fila 2: Cliente */}
                                        <div className="flex items-center gap-1.5 text-xs sm:text-sm">
                                            <User size={13} className="text-slate-400 shrink-0" />
                                            <span className="text-slate-500 dark:text-slate-400 font-medium text-xs">Cliente:</span>
                                            <span className="font-extrabold text-slate-900 dark:text-white truncate">
                                                {customerDisplayName}
                                            </span>
                                            {customerDoc && (
                                                <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                                                    ({customerDoc})
                                                </span>
                                            )}
                                        </div>

                                        {/* Fila 3: Hora / Fecha y nota */}
                                        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                                            {dateStr && (
                                                <span className="flex items-center gap-1 font-medium">
                                                    <Clock size={11} className="text-slate-400 shrink-0" />
                                                    <span>{dateStr}</span>
                                                </span>
                                            )}
                                            {cleanNote && (
                                                <span className="truncate italic text-slate-600 dark:text-slate-300 font-medium">
                                                    • "{cleanNote}"
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Columna Derecha: Montos y Botones de Acción */}
                                <div className="flex items-center justify-between md:justify-end gap-3 sm:gap-4 pt-2.5 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-700/60 shrink-0">
                                    <div className="text-left md:text-right shrink-0">
                                        <p className="font-black text-base sm:text-lg text-slate-900 dark:text-white tabular-nums leading-tight">
                                            {formatMoney
                                                ? formatMoney(finalTotal, currencyMode === 'BOTH' ? 'VES' : currencyMode)
                                                : `$${finalTotal.toFixed(2)}`
                                            }
                                        </p>
                                        {currencyMode === 'BOTH' && (
                                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums uppercase mt-0.5">
                                                REF: {formatMoney ? formatMoney(finalTotal, 'USD') : `$${finalTotal.toFixed(2)}`}
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={() => handleRemoveSale(sale.id)}
                                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors min-h-[38px] min-w-[38px] flex items-center justify-center cursor-pointer border border-transparent hover:border-rose-200 dark:hover:border-rose-900"
                                            title="Eliminar venta en espera"
                                            aria-label="Eliminar venta en espera"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleRestoreSale(sale)}
                                            className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-extrabold text-xs uppercase tracking-wider rounded-lg transition-all min-h-[38px] cursor-pointer shadow-sm hover:shadow shrink-0 whitespace-nowrap"
                                        >
                                            <span>Restaurar</span>
                                            <ArrowRight size={15} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end shrink-0">
                <button
                    onClick={handleClose}
                    className="w-full sm:w-auto px-5 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[40px] flex items-center justify-center cursor-pointer"
                >
                    Cerrar
                </button>
            </div>
        </BaseModal>
    );
}
