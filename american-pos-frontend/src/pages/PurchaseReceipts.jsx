import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { Search, FileText, CheckCircle2, PackageCheck, ChevronDown, ChevronUp, Calendar, Hash, Eye } from 'lucide-react';
import InvoiceViewerModal from '../components/InvoiceViewerModal';
import { toast } from 'react-hot-toast';

const safeParseItems = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') return [raw];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch (e) {
        return [];
    }
};

const MobilePurchaseReceiptCard = ({
    receipt,
    items,
    isExpanded,
    onToggleExpand,
    formatDate,
    onViewInvoice
}) => {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden transition-all">
            {/* Tap Header */}
            <div 
                onClick={onToggleExpand}
                className="p-4 flex items-start justify-between gap-3 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
            >
                <div className="flex items-start gap-3 min-w-0">
                    <div className={`p-2.5 rounded-xl mt-0.5 shrink-0 transition-colors ${
                        isExpanded
                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    }`}>
                        <Hash size={18} />
                    </div>

                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-sm text-slate-800 dark:text-white truncate">
                                {receipt.referenceNumber || 'SIN REF'}
                            </span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-md font-black uppercase">
                                ✓ Procesado
                            </span>
                        </div>
                        <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase truncate mt-0.5">
                            {receipt.supplierId}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            {formatDate(receipt.receivedAt || receipt.updatedAt)}
                        </p>
                    </div>
                </div>

                <div className="text-right shrink-0">
                    <span className="text-base font-black text-slate-900 dark:text-white font-mono block">
                        ${parseFloat(receipt.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                    <div className="flex items-center justify-end gap-1.5 mt-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                            {items.length} {items.length === 1 ? 'item' : 'items'}
                        </span>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180 text-emerald-500' : ''}`} />
                    </div>
                </div>
            </div>

            {/* Quick Invoice Button if exists */}
            {receipt.invoiceUrl && (
                <div className="px-4 pb-2">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onViewInvoice(receipt);
                        }}
                        className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2 px-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                    >
                        <Eye size={16} />
                        <span>Ver Factura Original Adjunta</span>
                    </button>
                </div>
            )}

            {/* Expanded Content Accordion */}
            {isExpanded && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800/80 space-y-3 animate-in slide-in-from-top-2 duration-200">
                    <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Ítems Recibidos ({items.length})
                    </h5>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {items.map((item, idx) => (
                            <div key={idx} className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700/60 shadow-xs flex justify-between items-center text-xs">
                                <div className="min-w-0 flex-1 pr-2">
                                    <p className="font-bold text-slate-800 dark:text-white truncate">{item.name}</p>
                                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                        <span>Cant: <strong className="text-emerald-600">{item.quantity}</strong></span>
                                        <span>•</span>
                                        <span>Costo: <strong>${parseFloat(item.cost || 0).toFixed(2)}</strong></span>
                                    </div>
                                </div>
                                <span className="font-mono font-black text-slate-900 dark:text-white shrink-0">
                                    ${(item.quantity * item.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default function PurchaseReceipts() {
    const [receipts, setReceipts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedReceipt, setExpandedReceipt] = useState(null);
    const [viewerInvoice, setViewerInvoice] = useState({ isOpen: false, url: '', details: {} });

    // Pagination & Loading States
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [totalItems, setTotalItems] = useState(0);

    useEffect(() => {
        setPage(1);
        fetchReceipts(1);
    }, []);

    const fetchReceipts = async (pageNum = 1) => {
        try {
            if (pageNum === 1) setLoading(true);
            else setLoadingMore(true);

            const res = await api.get('/purchase-orders', {
                params: { page: pageNum, limit: 50 }
            });
            
            let fetchedOrders = [];
            let paginationStats = null;

            if (res.data && res.data.data && res.data.pagination) {
                fetchedOrders = res.data.data;
                paginationStats = res.data.pagination;
            } else if (Array.isArray(res.data)) {
                fetchedOrders = res.data;
            }

            // Filter only received ones (Albaranes)
            const received = fetchedOrders.filter(o => o.status === 'received');
            
            if (pageNum === 1) {
                setReceipts(received);
            } else {
                setReceipts(prev => [...prev, ...received]);
            }

            if (paginationStats) {
                setHasMore(pageNum < paginationStats.totalPages);
                setTotalItems(paginationStats.totalItems);
            } else {
                setHasMore(fetchedOrders.length === 50);
            }

        } catch (error) {
            console.error('Error fetching receipts:', error);
            toast.error('Error al cargar historial de albaranes');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const handleLoadMore = () => {
        if (!loadingMore && hasMore) {
            const next = page + 1;
            setPage(next);
            fetchReceipts(next);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('es-ES', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const filtered = useMemo(() => {
        return receipts.filter(r =>
            (r.supplierId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (r.referenceNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (r.id || '').toString().includes(searchTerm)
        );
    }, [receipts, searchTerm]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-28 sm:pb-20 pb-safe">
            <div>
                <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                    <PackageCheck size={28} className="text-emerald-500" /> Historial de Albaranes
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Registro formal de mercancía recibida y costos actualizados. {totalItems > 0 && `(Total: ${totalItems})`}</p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/80">
                    <div className="relative w-full sm:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por referencia o proveedor..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 min-h-[40px] sm:min-h-[36px] text-base sm:text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors font-medium text-slate-800 dark:text-white placeholder-slate-400"
                        />
                    </div>
                </div>

                {/* 📱 Mobile Cards View (Visible on screens < md) */}
                <div className="md:hidden p-3 space-y-3">
                    {loading ? (
                        <div className="py-12 text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 inline-block"></div>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-slate-400 opacity-50">
                            <FileText size={40} />
                            <p className="font-bold text-xs">No hay albaranes registrados todavía.</p>
                        </div>
                    ) : (
                        filtered.map(receipt => {
                            const items = safeParseItems(receipt.items);
                            return (
                                <MobilePurchaseReceiptCard
                                    key={`mobile-receipt-${receipt.id}`}
                                    receipt={receipt}
                                    items={items}
                                    isExpanded={expandedReceipt === receipt.id}
                                    onToggleExpand={() => setExpandedReceipt(expandedReceipt === receipt.id ? null : receipt.id)}
                                    formatDate={formatDate}
                                    onViewInvoice={(r) => setViewerInvoice({
                                        isOpen: true,
                                        url: r.invoiceUrl,
                                        details: {
                                            referenceNumber: r.referenceNumber || r.id,
                                            supplierName: r.supplierId,
                                            date: formatDate(r.receivedAt || r.updatedAt)
                                        }
                                    })}
                                />
                            );
                        })
                    )}
                </div>

                {/* 🖥️ Desktop Table View (Hidden on mobile) */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-bold">
                            <tr>
                                <th className="px-6 py-4">Ref. Albarán</th>
                                <th className="px-6 py-4">Proveedor</th>
                                <th className="px-6 py-4">Fecha Recepción</th>
                                <th className="px-6 py-4 text-right">Monto Total ($)</th>
                                <th className="px-6 py-4 text-center">Items</th>
                                <th className="px-6 py-4 text-right"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 inline-block"></div>
                                    </td>
                                </tr>
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-24 text-center">
                                        <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400 opacity-50">
                                            <FileText size={48} />
                                            <p className="font-bold">No hay albaranes registrados todavía.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(receipt => {
                                    const items = safeParseItems(receipt.items);
                                    return (
                                        <React.Fragment key={receipt.id}>
                                            <tr 
                                                className="hover:bg-slate-50/80 dark:hover:bg-emerald-500/5 transition-colors cursor-pointer group" 
                                                onClick={() => setExpandedReceipt(expandedReceipt === receipt.id ? null : receipt.id)}
                                            >
                                                <td className="px-6 py-6">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-2 rounded-xl transition-colors ${expandedReceipt === receipt.id ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-500'}`}>
                                                            {expandedReceipt === receipt.id ? <ChevronUp size={18} /> : <Hash size={18} />}
                                                        </div>
                                                        <div>
                                                            <p className="font-black text-slate-800 dark:text-white font-mono">{receipt.referenceNumber || 'SIN REF'}</p>
                                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-tighter">ID: {receipt.id}</p>
                                                            {receipt.invoiceUrl && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setViewerInvoice({
                                                                            isOpen: true,
                                                                            url: receipt.invoiceUrl,
                                                                            details: {
                                                                                referenceNumber: receipt.referenceNumber || receipt.id,
                                                                                supplierName: receipt.supplierId,
                                                                                date: formatDate(receipt.receivedAt || receipt.updatedAt)
                                                                            }
                                                                        });
                                                                    }}
                                                                    className="mt-1 flex items-center gap-1 px-2 py-0.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer w-fit"
                                                                    title="Ver Factura Real Digitalizada"
                                                                >
                                                                    <Eye size={11} />
                                                                    <span>Factura Real</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-6">
                                                    <span className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">{receipt.supplierId}</span>
                                                </td>
                                                <td className="px-6 py-6">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-600 dark:text-slate-400 font-medium">{formatDate(receipt.receivedAt || receipt.updatedAt)}</span>
                                                        <span className="text-[10px] text-emerald-500 font-bold uppercase flex items-center gap-1"><CheckCircle2 size={10} /> Procesado</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-6 text-right font-black text-slate-900 dark:text-white text-lg">
                                                    ${parseFloat(receipt.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-6 py-6 text-center">
                                                    <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg font-bold text-slate-500">{items.length}</span>
                                                </td>
                                                <td className="px-6 py-6 text-right">
                                                    <ChevronDown className={`text-slate-300 transition-transform ${expandedReceipt === receipt.id ? 'rotate-180 text-emerald-500' : ''}`} />
                                                </td>
                                            </tr>
                                            {expandedReceipt === receipt.id && (
                                                <tr>
                                                    <td colSpan="6" className="px-6 py-6 bg-slate-50 dark:bg-slate-800/20 animate-in slide-in-from-top-4 duration-300">
                                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                                            <div className="lg:col-span-2">
                                                                <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Detalle de Mercancía Recibida
                                                                </h4>
                                                                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                                                    {items.map((item, idx) => (
                                                                        <div key={idx} className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                                                                            <div>
                                                                                <p className="font-bold text-slate-800 dark:text-white">{item.name}</p>
                                                                                <div className="flex items-center gap-3 mt-1">
                                                                                    <span className="text-xs text-slate-500 font-medium">Cantidad: <span className="text-emerald-600 font-black">{item.quantity}</span></span>
                                                                                    <span className="text-xs text-slate-600 dark:text-slate-300">|</span>
                                                                                    <span className="text-xs text-slate-500 font-medium">Costo Unit: <span className="text-slate-800 dark:text-slate-200">${parseFloat(item.cost || 0).toFixed(2)}</span></span>
                                                                                </div>
                                                                            </div>
                                                                            <span className="text-sm font-black text-slate-900 dark:text-white">
                                                                                ${(item.quantity * item.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div className="space-y-6">
                                                                {/* Factura Real Digitalizada */}
                                                                {receipt.invoiceUrl && (
                                                                    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-indigo-500/30 shadow-sm space-y-3">
                                                                        <div className="flex items-center gap-2.5">
                                                                            <div className="p-2 bg-indigo-500/20 text-indigo-500 dark:text-indigo-400 rounded-xl">
                                                                                <FileText size={20} />
                                                                            </div>
                                                                            <div>
                                                                                <h5 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">Factura Física Adjunta</h5>
                                                                                <p className="text-[10px] text-emerald-600 font-semibold">✓ Respaldo archivado permanentemente</p>
                                                                            </div>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setViewerInvoice({
                                                                                isOpen: true,
                                                                                url: receipt.invoiceUrl,
                                                                                details: {
                                                                                    referenceNumber: receipt.referenceNumber || receipt.id,
                                                                                    supplierName: receipt.supplierId,
                                                                                    date: formatDate(receipt.receivedAt || receipt.updatedAt)
                                                                                }
                                                                            })}
                                                                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
                                                                        >
                                                                            <Eye size={15} />
                                                                            <span>Ver Factura Real Completa</span>
                                                                        </button>
                                                                    </div>
                                                                )}

                                                                <div>
                                                                    <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                                        <Calendar size={12} /> Notas del Albarán
                                                                    </h4>
                                                                    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 italic font-medium min-h-[80px]">
                                                                        {receipt.notes || 'No se registraron notas adicionales para esta recepción.'}
                                                                    </div>
                                                                </div>
                                                                
                                                                <div className="bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 rounded-2xl p-4">
                                                                    <h4 className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-2">Impacto Financiero</h4>
                                                                    <div className="space-y-2">
                                                                        <div className="flex justify-between text-xs">
                                                                            <span className="text-slate-500 font-medium">Monto Neto:</span>
                                                                            <span className="font-bold text-slate-800 dark:text-slate-200">${parseFloat(receipt.total || 0).toFixed(2)}</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-xs">
                                                                            <span className="text-slate-500 font-medium">Estatus Pago:</span>
                                                                            <span className={`font-bold ${receipt.paymentStatus === 'paid' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                                                {receipt.paymentStatus === 'paid' ? 'PAGADO' : 'POR PAGAR'}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {hasMore && !searchTerm && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-700 flex justify-center">
                        <button 
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="px-6 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-emerald-600 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-600 hover:border-emerald-200 transition-colors shadow-sm disabled:opacity-50"
                        >
                            {loadingMore ? 'Cargando más...' : 'Cargar Más Albaranes'}
                        </button>
                    </div>
                )}

            </div>

            {/* Modal Visor de Factura Real */}
            <InvoiceViewerModal
                isOpen={viewerInvoice.isOpen}
                onClose={() => setViewerInvoice(prev => ({ ...prev, isOpen: false }))}
                invoiceUrl={viewerInvoice.url}
                title="Factura Real Digitalizada"
                details={viewerInvoice.details}
            />
        </div>
    );
}
