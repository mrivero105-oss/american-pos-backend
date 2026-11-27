import { useState, useEffect, useMemo } from 'react';
import {
    X, 
    Search, 
    Calendar, 
    FileText, 
    Eye, 
    RefreshCw, 
    ChevronDown, 
    ChevronUp, 
    Package, 
    Building2, 
    Loader2, 
    RotateCcw, 
    Layers, 
    Receipt
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function ImportedInvoicesDrawer({ 
    isOpen, 
    onClose, 
    onViewInvoice, 
    onLoadInvoiceIntoImporter 
}) {
    const [invoices, setInvoices] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedInvoiceId, setExpandedInvoiceId] = useState(null);

    const fetchInvoices = async () => {
        setIsLoading(true);
        try {
            const { data } = await api.get('/products/imported-invoices');
            if (data?.invoices && Array.isArray(data.invoices)) {
                setInvoices(data.invoices);
            } else if (Array.isArray(data)) {
                setInvoices(data);
            } else {
                setInvoices([]);
            }
        } catch (err) {
            console.error('Error cargando historial de facturas:', err);
            toast.error(err.response?.data?.error || 'No se pudo cargar el historial de facturas');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchInvoices();
        } else {
            setSearchQuery('');
            setExpandedInvoiceId(null);
        }
    }, [isOpen]);

    // Cerrar con Escape
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const filteredInvoices = useMemo(() => {
        if (!searchQuery.trim()) return invoices;
        const q = searchQuery.toLowerCase().trim();
        return invoices.filter(inv => 
            (inv.referenceNumber && inv.referenceNumber.toLowerCase().includes(q)) ||
            (inv.supplierName && inv.supplierName.toLowerCase().includes(q)) ||
            (inv.supplierRif && inv.supplierRif.toLowerCase().includes(q))
        );
    }, [invoices, searchQuery]);

    const formatBs = (val) => {
        const num = Number(val || 0);
        if (isNaN(num) || !isFinite(num)) return '0,00';
        return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const formatUsd = (val) => {
        const num = Number(val || 0);
        if (isNaN(num) || !isFinite(num)) return '0.00';
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Backdrop con blur */}
            <div 
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
            />

            {/* Panel deslizable desde la derecha */}
            <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
                <div className="w-screen max-w-2xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-white/10 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out">
                    
                    {/* Header */}
                    <div className="p-6 border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/40">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2.5 rounded-xl bg-primary-500/10 text-primary-500 border border-primary-500/20">
                                    <Receipt className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-lg font-black text-slate-900 dark:text-white truncate">
                                            Historial de Facturas Cargadas
                                        </h2>
                                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 border border-primary-500/20">
                                            {invoices.length}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                        Recepciones físicas archivadas con respaldo digital y auditoría de precios
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={fetchInvoices}
                                    disabled={isLoading}
                                    className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                                    title="Actualizar listado"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                </button>
                                <button
                                    onClick={onClose}
                                    className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                                    title="Cerrar (Esc)"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Barra de Búsqueda */}
                        <div className="mt-4 relative">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar por N° de factura, proveedor o RIF..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white text-xs font-bold"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Lista de Facturas */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        {isLoading ? (
                            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
                                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                                <span className="text-xs font-semibold">Consultando facturas en el servidor...</span>
                            </div>
                        ) : filteredInvoices.length === 0 ? (
                            <div className="py-20 text-center space-y-3">
                                <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                                    <FileText className="w-6 h-6" />
                                </div>
                                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                    {searchQuery ? 'No hay facturas que coincidan con la búsqueda' : 'No hay facturas cargadas aún'}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                                    {searchQuery ? 'Prueba con otro número de control o nombre de proveedor.' : 'Carga una factura o comprobante físico para que quede registrado aquí.'}
                                </p>
                            </div>
                        ) : (
                            filteredInvoices.map((inv) => {
                                const isExpanded = expandedInvoiceId === inv.id;
                                const isCredit = inv.paymentStatus === 'unpaid';

                                return (
                                    <div 
                                        key={inv.id}
                                        className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden"
                                    >
                                        {/* Card Header / Resumen */}
                                        <div className="p-4 space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                                                            Factura #{inv.referenceNumber}
                                                        </span>
                                                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md tracking-wider border ${
                                                            isCredit 
                                                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' 
                                                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                                        }`}>
                                                            {isCredit ? 'Crédito' : 'Contado'}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-semibold mt-1">
                                                        <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                                        <span className="truncate">{inv.supplierName}</span>
                                                        {inv.supplierRif && (
                                                            <span className="text-[10px] font-mono font-bold text-slate-400">
                                                                ({inv.supplierRif})
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                                                        ${formatUsd(inv.totalUsd)}
                                                    </div>
                                                    {inv.totalVes > 0 && (
                                                        <div className="text-[11px] font-mono font-semibold text-slate-400">
                                                            Bs. {formatBs(inv.totalVes)}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Metadatos secundarios */}
                                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-white/5">
                                                <div className="flex items-center gap-4">
                                                    <div className="flex items-center gap-1">
                                                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                                        <span>{inv.date || 'Sin fecha'}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Package className="w-3.5 h-3.5 text-slate-400" />
                                                        <span>{inv.itemsCount} productos</span>
                                                    </div>
                                                    {inv.exchangeRate > 1 && (
                                                        <div className="hidden sm:flex items-center gap-1 font-mono text-[10px]">
                                                            <span>Tasa: {formatBs(inv.exchangeRate)} Bs/$</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Acciones */}
                                                <div className="flex items-center gap-2">
                                                    {inv.invoiceUrl && (
                                                        <button
                                                            onClick={() => onViewInvoice?.(inv.invoiceUrl, `Factura #${inv.referenceNumber} - ${inv.supplierName}`)}
                                                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950/40 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-lg transition-colors border border-primary-500/20"
                                                            title="Ver documento original escaneado"
                                                        >
                                                            <Eye className="w-3.5 h-3.5" />
                                                            <span>Ver Factura</span>
                                                        </button>
                                                    )}

                                                    {onLoadInvoiceIntoImporter && inv.invoiceUrl && (
                                                        <button
                                                            onClick={() => onLoadInvoiceIntoImporter(inv)}
                                                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors border border-slate-200 dark:border-white/10"
                                                            title="Cargar y re-auditar en el importador"
                                                        >
                                                            <RotateCcw className="w-3.5 h-3.5" />
                                                            <span className="hidden sm:inline">Re-abrir</span>
                                                        </button>
                                                    )}

                                                    {inv.items && inv.items.length > 0 && (
                                                        <button
                                                            onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                                                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors"
                                                            title={isExpanded ? 'Ocultar productos' : 'Ver productos'}
                                                        >
                                                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Acordeón de productos recibidos */}
                                        {isExpanded && inv.items && inv.items.length > 0 && (
                                            <div className="border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/60 p-4 space-y-2">
                                                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 pb-1">
                                                    <Layers className="w-3.5 h-3.5" />
                                                    <span>Renglones ingresados al inventario ({inv.items.length})</span>
                                                </div>

                                                <div className="max-h-56 overflow-y-auto divide-y divide-slate-200/60 dark:divide-white/5 rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900">
                                                    {inv.items.map((it, idx) => (
                                                        <div key={idx} className="p-2.5 text-xs flex items-center justify-between gap-3">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-bold text-slate-800 dark:text-slate-200 truncate">
                                                                    {it.name || it.externalName}
                                                                </div>
                                                                <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                                                                    <span>Cant: <strong className="text-slate-600 dark:text-slate-300 font-mono">{it.purchasedQuantity || it.quantity || 1}</strong> {Number(it.unitsPerBulk || 1) > 1 ? `bultos (${it.unitsPerBulk} u/b)` : 'u'}</span>
                                                                    <span>•</span>
                                                                    <span className={it.taxStatus === 'exento' ? 'text-emerald-500 font-bold' : 'text-slate-400 font-bold'}>
                                                                        {it.taxStatus === 'exento' ? 'Exento' : 'IVA 16%'}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            <div className="text-right flex-shrink-0 font-mono">
                                                                <div className="font-bold text-slate-900 dark:text-white">
                                                                    ${formatUsd(it.cost || it.bulkCost)}
                                                                </div>
                                                                <div className="text-[10px] text-slate-400">
                                                                    Subtotal: ${formatUsd(it.subtotal || ((it.cost || 0) * (it.purchasedQuantity || 1)))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>Mostrando <strong>{filteredInvoices.length}</strong> facturas</span>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 text-slate-800 dark:text-white font-bold rounded-xl transition-colors"
                        >
                            Cerrar
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}
