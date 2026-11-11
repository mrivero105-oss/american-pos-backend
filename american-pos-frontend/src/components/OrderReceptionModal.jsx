import { useState, useEffect, useRef } from 'react';
import { 
    X, Check, CheckCircle2, AlertCircle, Package, DollarSign, 
    ArrowRight, ShoppingBag, Plus, Minus, FileText, Upload, 
    Eye, RefreshCw, Calculator, Truck, ShieldCheck, Hash, Camera, Trash2, Printer, FileCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import api from '../services/api';
import BaseModal from './BaseModal';
import { getImageUrl, getInvoiceUrl } from '../utils/imageUtils';
import { isDollarOnlyCountry } from '../utils/format';
import CameraScanModal from './CameraScanModal';
import HardwareScannerModal from './HardwareScannerModal';

export default function OrderReceptionModal({ 
    isOpen, 
    onClose, 
    order, 
    supplier, 
    onReceptionCompleted,
    bcvRate = null 
}) {
    const effectiveCountry = localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const [items, setItems] = useState([]);
    const [referenceNumber, setReferenceNumber] = useState('');
    const [paymentStatus, setPaymentStatus] = useState('unpaid');
    const [notes, setNotes] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [invoiceUrl, setInvoiceUrl] = useState('');
    const [uploadingInvoice, setUploadingInvoice] = useState(false);
    const [isPrinterScannerOpen, setIsPrinterScannerOpen] = useState(false);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [isPreviewInvoiceOpen, setIsPreviewInvoiceOpen] = useState(false);
    const [isReconciling, setIsReconciling] = useState(false);
    const [reconciliationBanner, setReconciliationBanner] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (isOpen && order) {
            setReferenceNumber(order.referenceNumber || '');
            setPaymentStatus(order.paymentStatus || 'unpaid');
            setInvoiceUrl(order.invoiceUrl || '');
            setNotes(order.notes || '');
            loadOrderItemsWithProductData();
        }
    }, [isOpen, order]);

    const loadOrderItemsWithProductData = async () => {
        try {
            setLoadingProducts(true);
            const rawItems = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : (order.items || []);
            
            // Consultar datos actualizados de los productos para conocer stock actual y precio venta
            let allProducts = [];
            try {
                const res = await api.get('/products');
                allProducts = res.data?.products || res.data || [];
            } catch (e) {
                console.warn('No se pudieron obtener productos completos:', e);
            }

            const mapped = rawItems.map(item => {
                const p = allProducts.find(prod => String(prod.id) === String(item.productId));
                const orderedQty = Number(item.quantityOrdered || item.quantity || 1);
                const currentStock = Number(p?.stockQuantity || p?.stock || 0);
                const rawCost = parseFloat(item.cost !== undefined ? item.cost : (p?.cost || 0));
                const rawPrice = parseFloat(item.price !== undefined ? item.price : (item.sellPrice !== undefined ? item.sellPrice : (p?.price || 0)));
                const unitCost = Number((isNaN(rawCost) ? 0 : rawCost).toFixed(2));
                const sellPrice = Number((isNaN(rawPrice) ? 0 : rawPrice).toFixed(2));
                const unitsPerBulk = Math.max(1, Number(item.unitsPerBulk || p?.unitsPerBulk || 1));
                const bulkUnitName = item.bulkUnitName || p?.bulkUnitName || 'Bulto';
                const rawBulkCost = parseFloat(item.bulkCost !== undefined ? item.bulkCost : (p?.bulkCost || (unitCost * unitsPerBulk)));
                const bulkCost = Number((isNaN(rawBulkCost) || rawBulkCost === 0 ? (unitCost * unitsPerBulk) : rawBulkCost).toFixed(2));

                let margin = 0;
                if (unitCost > 0 && sellPrice > 0) {
                    margin = Number((((sellPrice - unitCost) / unitCost) * 100).toFixed(1));
                } else if (p?.margin) {
                    margin = Number(Number(p.margin).toFixed(1));
                }

                const receivedQty = item.receivedQuantity !== undefined ? Number(item.receivedQuantity) : orderedQty;
                const isItemReceived = item.isReceived !== undefined ? Boolean(item.isReceived) : (receivedQty > 0);

                return {
                    productId: item.productId,
                    name: item.name || p?.name || 'Producto',
                    barcode: item.barcode || p?.barcode || '',
                    imageUri: p?.imageUri || null,
                    currentStock,
                    quantityOrdered: orderedQty,
                    receivedQuantity: receivedQty,
                    isReceived: isItemReceived,
                    cost: unitCost,
                    price: sellPrice,
                    margin,
                    bulkUnitName,
                    unitsPerBulk,
                    bulkCost
                };
            });

            setItems(mapped);
        } catch (err) {
            console.error('Error loading order items:', err);
            toast.error('Error al cargar productos de la orden');
        } finally {
            setLoadingProducts(false);
        }
    };

    if (!isOpen || !order) return null;

    const handleToggleItemReceived = (productId) => {
        setItems(prev => prev.map(item => {
            if (item.productId === productId) {
                const nextState = !item.isReceived;
                return {
                    ...item,
                    isReceived: nextState,
                    receivedQuantity: nextState ? (item.receivedQuantity > 0 ? item.receivedQuantity : item.quantityOrdered) : 0
                };
            }
            return item;
        }));
    };

    const handleMarkAll = (received) => {
        setItems(prev => prev.map(item => ({
            ...item,
            isReceived: received,
            receivedQuantity: received ? (item.quantityOrdered || 1) : 0
        })));
    };

    const handleQuantityChange = (productId, newQty) => {
        const val = Math.max(0, parseFloat(newQty) || 0);
        setItems(prev => prev.map(item => {
            if (item.productId === productId) {
                return {
                    ...item,
                    receivedQuantity: val,
                    isReceived: val > 0
                };
            }
            return item;
        }));
    };

    const handleCostChange = (productId, newCost) => {
        const rawCost = parseFloat(newCost);
        const costVal = isNaN(rawCost) ? 0 : Number(rawCost.toFixed(2));
        setItems(prev => prev.map(item => {
            if (item.productId === productId) {
                let margin = item.margin;
                let price = item.price;
                if (costVal > 0 && price > 0) {
                    margin = Number((((price - costVal) / costVal) * 100).toFixed(1));
                } else if (costVal > 0 && margin > 0) {
                    price = Number((costVal * (1 + margin / 100)).toFixed(2));
                }
                const bulkCost = Number((costVal * (item.unitsPerBulk || 1)).toFixed(2));
                return { ...item, cost: costVal, bulkCost, margin, price };
            }
            return item;
        }));
    };

    const handleBulkCostChange = (productId, newBulkCost) => {
        const rawVal = parseFloat(newBulkCost);
        const bulkCostVal = isNaN(rawVal) ? 0 : Number(rawVal.toFixed(2));
        setItems(prev => prev.map(item => {
            if (item.productId === productId) {
                const uPerBulk = Math.max(1, item.unitsPerBulk || 1);
                const unitCost = Number((bulkCostVal / uPerBulk).toFixed(2));
                let margin = item.margin;
                let price = item.price;
                if (unitCost > 0 && price > 0) {
                    margin = Number((((price - unitCost) / unitCost) * 100).toFixed(1));
                } else if (unitCost > 0 && margin > 0) {
                    price = Number((unitCost * (1 + margin / 100)).toFixed(2));
                }
                return { ...item, bulkCost: bulkCostVal, cost: unitCost, margin, price };
            }
            return item;
        }));
    };

    const handleUnitsPerBulkChange = (productId, newUnits) => {
        const units = Math.max(1, parseInt(newUnits, 10) || 1);
        setItems(prev => prev.map(item => {
            if (item.productId === productId) {
                const bulkCost = Number((item.cost * units).toFixed(2));
                return { ...item, unitsPerBulk: units, bulkCost };
            }
            return item;
        }));
    };

    const handlePriceChange = (productId, newPrice) => {
        const rawPrice = parseFloat(newPrice);
        const priceVal = isNaN(rawPrice) ? 0 : Number(rawPrice.toFixed(2));
        setItems(prev => prev.map(item => {
            if (item.productId === productId) {
                let margin = item.margin;
                if (item.cost > 0 && priceVal > 0) {
                    margin = Number((((priceVal - item.cost) / item.cost) * 100).toFixed(1));
                }
                return { ...item, price: priceVal, margin };
            }
            return item;
        }));
    };

    const handleMarginChange = (productId, newMargin) => {
        const rawMargin = parseFloat(newMargin);
        const marginVal = isNaN(rawMargin) ? 0 : Number(rawMargin.toFixed(1));
        setItems(prev => prev.map(item => {
            if (item.productId === productId) {
                let price = item.price;
                if (item.cost > 0) {
                    price = Number((item.cost * (1 + marginVal / 100)).toFixed(2));
                }
                return { ...item, margin: marginVal, price };
            }
            return item;
        }));
    };

    const reconcileWithAI = async (targetInvoiceUrl, file = null) => {
        try {
            setIsReconciling(true);
            const toastId = toast.loading(isDollarCountry ? 'Procesando factura: extrayendo ítems e importes...' : 'Leyendo factura: extrayendo ítems, IVA y tasa BCV...');
            
            let res;
            if (file) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('currentItems', JSON.stringify(items));
                res = await api.post('/purchase-orders/reconcile-invoice', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    timeout: 120000
                });
            } else {
                res = await api.post('/purchase-orders/reconcile-invoice', {
                    invoiceUrl: targetInvoiceUrl,
                    currentItems: items
                }, {
                    timeout: 120000
                });
            }

            toast.dismiss(toastId);

            if (res.data?.success) {
                if (res.data.invoiceUrl) {
                    setInvoiceUrl(res.data.invoiceUrl);
                }
                if (res.data.invoiceNumber) {
                    setReferenceNumber(res.data.invoiceNumber);
                }
                if (Array.isArray(res.data.reconciledItems) && res.data.reconciledItems.length > 0) {
                    setItems(res.data.reconciledItems);
                }

                setReconciliationBanner({
                    summary: res.data.summary,
                    bcvRate: res.data.bcvRate,
                    totalUsd: res.data.totalUsd,
                    totalBs: res.data.totalBs,
                    taxRate: res.data.taxRate,
                    matchedCount: res.data.matchedCount,
                    unreceivedCount: res.data.unreceivedCount
                });

                toast.success('¡Factura conciliada y ajustada automáticamente con éxito!', { duration: 6000 });
            }
        } catch (err) {
            console.error('Error conciliando factura:', err);
            toast.error('Error al conciliar factura: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsReconciling(false);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setUploadingInvoice(true);
            await reconcileWithAI(null, file);
        } catch (err) {
            console.error('Error subiendo y conciliando factura:', err);
            toast.error('Error al procesar el archivo de factura');
        } finally {
            setUploadingInvoice(false);
        }
    };

    const handleCameraCapture = async (file) => {
        try {
            setUploadingInvoice(true);
            await reconcileWithAI(null, file);
        } catch (err) {
            console.error('Error subiendo factura escaneada con cámara:', err);
            toast.error('Error al procesar la factura escaneada');
        } finally {
            setUploadingInvoice(false);
        }
    };

    const handleScanCompleted = async (url) => {
        setInvoiceUrl(url);
        await reconcileWithAI(url);
    };

    // Totales calculados
    const receivedItems = items.filter(i => i.isReceived && i.receivedQuantity > 0);
    const totalReceivedUnits = receivedItems.reduce((sum, i) => sum + i.receivedQuantity, 0);
    const totalOrderedUnits = items.reduce((sum, i) => sum + i.quantityOrdered, 0);
    const totalCostUsd = receivedItems.reduce((sum, i) => sum + (i.receivedQuantity * i.cost), 0);
    const effectiveRate = bcvRate > 0 ? bcvRate : 1;
    const totalCostVes = totalCostUsd * effectiveRate;

    const filteredItems = items.filter(i => 
        (i.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (i.barcode || '').includes(searchTerm)
    );

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (receivedItems.length === 0) {
            toast.error('Debes marcar al menos un producto como recibido para ingresar al inventario.');
            return;
        }

        try {
            setIsSubmitting(true);
            const payload = {
                receivedItems: items.map(i => {
                    const isExempt = i.taxStatus === 'exento' || i.isExempt === true;
                    return {
                        productId: i.productId,
                        name: i.name,
                        barcode: i.barcode,
                        quantityOrdered: i.quantityOrdered,
                        receivedQuantity: i.isReceived ? i.receivedQuantity : 0,
                        isReceived: i.isReceived && i.receivedQuantity > 0,
                        cost: i.cost,
                        price: i.price,
                        margin: i.margin,
                        unitsPerBulk: i.unitsPerBulk || 1,
                        bulkUnitName: i.bulkUnitName || 'Bulto',
                        bulkCost: i.bulkCost || Number(((i.cost || 0) * (i.unitsPerBulk || 1)).toFixed(2)),
                        taxStatus: isExempt ? 'exento' : 'gravable',
                        isExempt: isExempt
                    };
                }),
                referenceNumber: referenceNumber.trim(),
                invoiceUrl: invoiceUrl || null,
                paymentStatus: paymentStatus,
                notes: notes.trim()
            };

            await api.post(`/purchase-orders/${order.id}/receive`, payload);
            toast.success('¡Mercancía recibida! Stock y precios actualizados en inventario.', { duration: 5000 });
            
            if (onReceptionCompleted) {
                onReceptionCompleted();
            }
            onClose();
        } catch (error) {
            console.error('Error confirmando recepción:', error);
            toast.error('Error al recibir orden: ' + (error.response?.data?.error || error.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-6xl"
            className="flex flex-col h-[92dvh] max-h-[92dvh] pb-safe border border-slate-200 dark:border-white/10 overflow-hidden"
        >
            {/* Header */}
            <div className="relative px-4 sm:px-8 py-4 sm:py-5 flex justify-between items-center bg-gradient-to-r from-emerald-600/15 via-teal-600/10 to-transparent dark:from-emerald-500/10 border-b border-slate-200 dark:border-white/10 shrink-0">
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 shrink-0">
                        <Package size={22} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase truncate">
                                {order.status === 'received' ? 'Editar Recepción & Albarán' : 'Recepción de Mercancía & Albarán'}
                            </h2>
                            <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                #{order.id.slice(0, 8)}
                            </span>
                        </div>
                        <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">
                            Proveedor: <span className="font-bold text-slate-700 dark:text-slate-200 uppercase">{supplier?.name || order.supplierId}</span>
                            {order.expectedDate && ` • Prevista: ${order.expectedDate}`}
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all cursor-pointer shrink-0"
                >
                    <X size={22} />
                </button>
            </div>

            {/* Quick Summary Banner & Controls */}
            <div className="px-4 sm:px-8 py-3 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/5 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => handleMarkAll(true)}
                        className="px-3 py-2 min-h-[38px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                        <CheckCircle2 size={13} />
                        <span>Marcar Todo Llegado</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleMarkAll(false)}
                        className="px-3 py-2 min-h-[38px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                        <X size={13} />
                        <span>Desmarcar Todo</span>
                    </button>
                    <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block"></div>
                    <button
                        type="button"
                        onClick={() => {
                            setItems(prev => prev.map(p => ({ ...p, taxStatus: 'exento', isExempt: true })));
                            toast.success('Todos los productos marcados como EXENTOS (0% IVA)');
                        }}
                        className="px-2.5 py-2 min-h-[38px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
                        title="Marcar todos como Exentos (0% IVA / Nota de Entrega)"
                    >
                        <span>🟢 Todo Exento</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setItems(prev => prev.map(p => ({ ...p, taxStatus: 'gravable', isExempt: false })));
                            toast.success('Todos los productos marcados como GRAVADOS (16% IVA)');
                        }}
                        className="px-2.5 py-2 min-h-[38px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
                        title="Marcar todos como Gravados (16% IVA / Factura Fiscal)"
                    >
                        <span>🔵 Todo 16% IVA</span>
                    </button>
                    <span className="text-xs font-black text-slate-400 dark:text-slate-500 ml-1">
                        {receivedItems.length} de {items.length} marcados ({totalReceivedUnits} / {totalOrderedUnits} un)
                    </span>
                </div>

                {/* Search */}
                <div className="relative w-full sm:w-64">
                    <input
                        type="text"
                        placeholder="Buscar producto en la orden..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-3 pr-8 py-2 min-h-[44px] sm:min-h-[38px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-base sm:text-xs font-semibold text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 p-1">
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Reconciliation AI Notification Banner */}
            {reconciliationBanner && (
                <div className="mx-6 sm:mx-8 mt-3 p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center justify-between gap-3 animate-in fade-in duration-300 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl shadow-sm shrink-0">
                            <FileCheck size={18} />
                        </div>
                        <div>
                            <p className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wide flex items-center gap-2">
                                <span>Conciliación Automática: Factura Verificada</span>
                                <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md text-[10px]">
                                    IVA: {reconciliationBanner.taxRate}%{!isDollarCountry && reconciliationBanner.bcvRate ? ` • BCV: ${reconciliationBanner.bcvRate}` : ''}
                                </span>
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                                {reconciliationBanner.summary}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setReconciliationBanner(null)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-black/5 cursor-pointer"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Products Verification List */}
            {/* Products Verification List */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-8 space-y-3.5 sm:space-y-4 custom-scrollbar bg-slate-100/40 dark:bg-slate-950/20">
                {loadingProducts ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-emerald-500">
                        <RefreshCw className="animate-spin" size={32} />
                        <span className="text-xs font-black uppercase tracking-widest text-slate-400">Cargando catálogo de productos...</span>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <ShoppingBag size={40} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-bold uppercase tracking-wider">No hay productos que coincidan con la búsqueda</p>
                    </div>
                ) : (
                    filteredItems.map((item, idx) => {
                        const newStockPreview = item.isReceived ? (item.currentStock + item.receivedQuantity) : item.currentStock;
                        const subtotal = item.isReceived ? (item.receivedQuantity * item.cost) : 0;

                        return (
                            <div 
                                key={item.productId || idx}
                                className={`p-3.5 sm:p-5 rounded-2xl border transition-all ${
                                    item.isReceived 
                                        ? 'bg-white dark:bg-white/5 border-emerald-500/30 shadow-md shadow-emerald-500/5' 
                                        : 'bg-slate-50/60 dark:bg-white/[0.01] border-slate-200 dark:border-white/5 opacity-60'
                                }`}
                            >
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                    {/* Left: Checkbox & Product Info */}
                                    <div className="flex items-start gap-3 sm:gap-3.5 flex-1 min-w-0">
                                        <button
                                            type="button"
                                            onClick={() => handleToggleItemReceived(item.productId)}
                                            className={`mt-0.5 w-9 h-9 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                                                item.isReceived
                                                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400'
                                                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 border border-slate-300 dark:border-slate-700'
                                            }`}
                                            title={item.isReceived ? 'Marcar como no llegado' : 'Marcar como llegado'}
                                        >
                                            {item.isReceived ? <Check size={18} strokeWidth={3} /> : <X size={15} />}
                                        </button>

                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h4 className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate">
                                                    {item.name}
                                                </h4>
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                                                    item.isReceived ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'bg-slate-200 text-slate-500'
                                                }`}>
                                                    {item.isReceived ? 'Llegó' : 'No Llegó'}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const isCurrentlyExempt = item.taxStatus === 'exento' || item.isExempt === true;
                                                        const nextStatus = isCurrentlyExempt ? 'gravable' : 'exento';
                                                        setItems(prev => prev.map(p => p.productId === item.productId ? { ...p, taxStatus: nextStatus, isExempt: nextStatus === 'exento' } : p));
                                                        toast.success(`${item.name}: ${nextStatus === 'exento' ? 'Marcado como EXENTO (0% IVA)' : 'Marcado como GRAVADO (16% IVA)'}`);
                                                    }}
                                                    className={`text-[9px] font-black uppercase px-2.5 py-1 min-h-[30px] rounded-md border transition-all cursor-pointer ${
                                                        (item.taxStatus === 'exento' || item.isExempt)
                                                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                                                            : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/25'
                                                    }`}
                                                    title="Clic para alternar entre Exento (0% IVA) y Gravado (16% IVA)"
                                                >
                                                    {(item.taxStatus === 'exento' || item.isExempt) ? '🟢 Exento' : '🔵 16% IVA'}
                                                </button>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 mt-1 font-mono">
                                                {item.barcode && (
                                                    <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md text-slate-600 dark:text-slate-300">
                                                        Cód: {item.barcode}
                                                    </span>
                                                )}
                                                {/* Wholesale Packaging Tag */}
                                                <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md font-bold text-[10px]">
                                                    📦 1 {item.bulkUnitName} = {item.unitsPerBulk} un
                                                </span>
                                                {item.unitsPerBulk > 1 && item.isReceived && item.receivedQuantity > 0 && (
                                                    <span className="text-amber-600 dark:text-amber-400 font-black text-[10px]">
                                                        ({(item.receivedQuantity / item.unitsPerBulk).toFixed(2)} {item.bulkUnitName}s)
                                                    </span>
                                                )}
                                                <span className="text-slate-500">
                                                    Stock actual: <strong className="text-slate-700 dark:text-slate-200">{item.currentStock} un</strong>
                                                </span>
                                                <span className="text-indigo-500 font-bold">
                                                    → Nuevo Stock: <strong className="text-indigo-600 dark:text-indigo-400">{newStockPreview} un</strong> {item.isReceived && <span className="text-emerald-500">(+{item.receivedQuantity})</span>}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Quantity, Wholesale Cost, Unit Cost, Margin, Price & Subtotal */}
                                    <div className="flex flex-wrap items-center gap-2.5 justify-end shrink-0">
                                        {/* Quantity Stepper */}
                                        <div className="flex flex-col items-center bg-slate-50 dark:bg-slate-900/60 p-1.5 rounded-xl border border-slate-200 dark:border-white/5">
                                            <div className="flex items-center justify-between w-full text-[9px] font-black text-slate-400 uppercase mb-1">
                                                <span>Ped: {item.quantityOrdered}</span>
                                                <span className="text-emerald-500">Recibido</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    disabled={!item.isReceived || item.receivedQuantity <= 0}
                                                    onClick={() => handleQuantityChange(item.productId, item.receivedQuantity - 1)}
                                                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 flex items-center justify-center text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                                                >
                                                    <Minus size={13} />
                                                </button>
                                                <input
                                                    type="number"
                                                    disabled={!item.isReceived}
                                                    value={item.receivedQuantity}
                                                    onChange={(e) => handleQuantityChange(item.productId, e.target.value)}
                                                    className="w-14 text-center py-1.5 min-h-[36px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-base sm:text-xs font-black text-slate-900 dark:text-white"
                                                    min="0"
                                                    step="any"
                                                />
                                                <button
                                                    type="button"
                                                    disabled={!item.isReceived}
                                                    onClick={() => handleQuantityChange(item.productId, item.receivedQuantity + 1)}
                                                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 flex items-center justify-center text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                                                >
                                                    <Plus size={13} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Wholesale Cost Input ($ USD per Bulk / Box) */}
                                        <div className="flex flex-col bg-amber-500/5 dark:bg-amber-500/10 p-1.5 rounded-xl border border-amber-500/20 w-28">
                                            <div className="flex items-center justify-between text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase mb-1">
                                                <span>Costo {item.bulkUnitName}</span>
                                                <span className="text-[8px] opacity-75">Mayor</span>
                                            </div>
                                            <input
                                                type="number"
                                                disabled={!item.isReceived}
                                                value={item.bulkCost !== undefined ? item.bulkCost : Number(((item.cost || 0) * (item.unitsPerBulk || 1)).toFixed(2))}
                                                onChange={(e) => handleBulkCostChange(item.productId, e.target.value)}
                                                className="w-full text-center py-1.5 min-h-[36px] bg-white dark:bg-slate-800 border border-amber-500/40 rounded-lg text-base sm:text-xs font-black text-amber-700 dark:text-amber-300 font-mono"
                                                step="0.01"
                                                min="0"
                                                title={`Costo por ${item.bulkUnitName} completo (${item.unitsPerBulk} un)`}
                                            />
                                        </div>

                                        {/* Unit Cost Input ($ USD) */}
                                        <div className="flex flex-col bg-slate-50 dark:bg-slate-900/60 p-1.5 rounded-xl border border-slate-200 dark:border-white/5 w-24">
                                            <div className="flex items-center justify-between text-[9px] font-black text-slate-400 uppercase mb-1">
                                                <span>Costo Unit.</span>
                                                <span className="text-[8px]">Detal</span>
                                            </div>
                                            <input
                                                type="number"
                                                disabled={!item.isReceived}
                                                value={item.cost}
                                                onChange={(e) => handleCostChange(item.productId, e.target.value)}
                                                className="w-full text-center py-1.5 min-h-[36px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-base sm:text-xs font-black text-slate-900 dark:text-white font-mono"
                                                step="0.01"
                                                min="0"
                                            />
                                        </div>

                                        {/* Margin Input (%) */}
                                        <div className="flex flex-col bg-slate-50 dark:bg-slate-900/60 p-1.5 rounded-xl border border-slate-200 dark:border-white/5 w-20">
                                            <span className="text-[9px] font-black text-slate-400 uppercase mb-1">Margen %</span>
                                            <input
                                                type="number"
                                                disabled={!item.isReceived}
                                                value={item.margin}
                                                onChange={(e) => handleMarginChange(item.productId, e.target.value)}
                                                className="w-full text-center py-1.5 min-h-[36px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-base sm:text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono"
                                                step="1"
                                            />
                                        </div>

                                        {/* Selling Price Input ($ USD) */}
                                        <div className="flex flex-col bg-emerald-500/5 dark:bg-emerald-500/10 p-1.5 rounded-xl border border-emerald-500/20 w-28">
                                            <div className="flex items-center justify-between text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase mb-1">
                                                <span>P. Venta Inv.</span>
                                                <span className="text-[8px] font-bold opacity-75">${(item.price * (item.unitsPerBulk || 1)).toFixed(2)}/caja</span>
                                            </div>
                                            <input
                                                type="number"
                                                disabled={!item.isReceived}
                                                value={item.price}
                                                onChange={(e) => handlePriceChange(item.productId, e.target.value)}
                                                className="w-full text-center py-1.5 min-h-[36px] bg-white dark:bg-slate-800 border border-emerald-500/40 rounded-lg text-base sm:text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono"
                                                step="0.01"
                                                min="0"
                                            />
                                        </div>

                                        {/* Subtotal */}
                                        <div className="flex flex-col items-end justify-center min-w-[75px] pl-1">
                                            <span className="text-[9px] font-black text-slate-400 uppercase">Subtotal</span>
                                            <span className="text-sm font-black font-mono text-slate-800 dark:text-white tabular-nums">
                                                ${subtotal.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Additional Reception Info & Financial Verification */}
            <div className="px-6 sm:px-8 py-4 bg-slate-50/80 dark:bg-white/[0.03] border-t border-slate-200 dark:border-white/10 shrink-0">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    {/* Reference Number / Factura */}
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                            Nº Factura / Albarán Físico
                        </label>
                        <div className="relative">
                            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                            <input
                                type="text"
                                placeholder="Ej: 00062658"
                                value={referenceNumber}
                                onChange={(e) => setReferenceNumber(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-base sm:text-xs font-black uppercase text-slate-800 dark:text-white min-h-[44px] sm:min-h-[38px]"
                            />
                        </div>
                    </div>

                    {/* Payment Status Switch */}
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                            Condición de Pago
                        </label>
                        <div className="flex items-center gap-2 bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl">
                            <button
                                type="button"
                                onClick={() => setPaymentStatus('paid')}
                                className={`flex-1 py-2 min-h-[40px] rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                    paymentStatus === 'paid' 
                                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' 
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                            >
                                <CheckCircle2 size={12} />
                                <span>Pagada (Contado)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setPaymentStatus('unpaid')}
                                className={`flex-1 py-2 min-h-[40px] rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                    paymentStatus === 'unpaid' 
                                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20' 
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                            >
                                <AlertCircle size={12} />
                                <span>Por Pagar (Crédito)</span>
                            </button>
                        </div>
                    </div>

                    {/* Digitalized Invoice Attachment */}
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                            Factura Digitalizada (Foto / PDF / Escáner)
                        </label>
                        <div className="flex items-center gap-2">
                            {invoiceUrl ? (
                                <div className="flex-1 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-bold text-emerald-600 dark:text-emerald-400 min-h-[44px]">
                                    <span className="truncate flex items-center gap-1.5 font-black text-[11px] uppercase">
                                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> Factura Lista
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => reconcileWithAI(invoiceUrl)}
                                            disabled={isReconciling}
                                            className="px-2.5 py-1.5 min-h-[36px] bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase flex items-center gap-1 shadow-sm cursor-pointer disabled:opacity-50 active:scale-95 transition-all"
                                            title="Re-leer factura y verificar cantidades, IVA y precios"
                                        >
                                            <FileCheck size={12} className={isReconciling ? 'animate-spin' : ''} />
                                            <span>{isReconciling ? 'Leyendo...' : 'Conciliar Factura'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsPreviewInvoiceOpen(true)}
                                            className="px-2.5 py-1.5 min-h-[36px] bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 border border-slate-200 dark:border-white/10 shadow-sm cursor-pointer"
                                            title="Ver Factura Completa"
                                        >
                                            <Eye size={12} /> Ver
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsPrinterScannerOpen(true)}
                                            className="min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 text-slate-400 hover:text-indigo-500 cursor-pointer"
                                            title="Re-escanear con Impresora"
                                        >
                                            <Printer size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsCameraOpen(true)}
                                            className="min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 text-slate-400 hover:text-purple-500 cursor-pointer"
                                            title="Re-escanear con Cámara"
                                        >
                                            <Camera size={13} />
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => setInvoiceUrl('')} 
                                            className="min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                                            title="Eliminar Factura"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsPrinterScannerOpen(true)}
                                        disabled={uploadingInvoice}
                                        className="flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] sm:min-h-[38px] bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer disabled:opacity-50"
                                        title="Escanear documento desde la impresora multifuncional"
                                    >
                                        <Printer size={14} />
                                        <span>Escanear con Impresora</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsCameraOpen(true)}
                                        disabled={uploadingInvoice}
                                        className="px-3 py-2 min-h-[44px] sm:min-h-[38px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 hover:border-purple-500/40 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1"
                                        title="Capturar foto con Cámara / Webcam"
                                    >
                                        <Camera size={14} />
                                        <span className="hidden sm:inline">Cámara</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={uploadingInvoice}
                                        className="px-3 py-2 min-h-[44px] sm:min-h-[38px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 hover:border-indigo-500/40 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1"
                                        title="Subir Archivo PDF o Imagen"
                                    >
                                        <Upload size={14} />
                                        <span className="hidden sm:inline">Archivo</span>
                                    </button>
                                </div>
                            )}
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                                accept=".pdf,image/*"
                                className="hidden"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer Summary & Submit */}
            <div className="px-4 sm:px-8 py-3.5 sm:py-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
                {/* Total Cost Display */}
                <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
                    <div className="p-2.5 sm:p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl border border-emerald-500/20 shrink-0">
                        <DollarSign size={22} />
                    </div>
                    <div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Mercancía a Ingresar</span>
                        <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                                ${totalCostUsd.toFixed(2)} <span className="text-xs font-bold text-slate-400">USD</span>
                            </span>
                            {!isDollarCountry && effectiveRate > 1 && (
                                <span className="text-xs font-black text-slate-500 dark:text-slate-400 font-mono">
                                    ≈ Bs. {totalCostVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-2.5 sm:gap-3 w-full sm:w-auto justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 sm:px-5 py-3 min-h-[48px] sm:min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting || receivedItems.length === 0}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 sm:px-6 py-3 min-h-[48px] sm:min-h-[44px] bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50 text-center"
                    >
                        {isSubmitting ? (
                            <>
                                <RefreshCw className="animate-spin" size={16} />
                                <span>Actualizando Inventario...</span>
                            </>
                        ) : (
                            <>
                                <ShieldCheck size={16} />
                                <span>{order.status === 'received' ? 'Guardar Cambios' : 'Confirmar Recepción'}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Hardware Printer/Scanner Modal */}
            <HardwareScannerModal
                isOpen={isPrinterScannerOpen}
                onClose={() => setIsPrinterScannerOpen(false)}
                onScanCompleted={(url) => setInvoiceUrl(url)}
                title="Escanear Factura desde Impresora"
                subtitle="Digitaliza el comprobante físico utilizando el escáner de tu impresora multifuncional"
            />

            {/* Live Camera Scanner Modal */}
            <CameraScanModal
                isOpen={isCameraOpen}
                onClose={() => setIsCameraOpen(false)}
                onCapture={handleCameraCapture}
                title="Escanear Factura con Cámara"
                subtitle="Enfoca la factura o albarán físico con tu cámara o webcam"
            />

            {/* Fullscreen/Floating Invoice Viewer */}
            {isPreviewInvoiceOpen && invoiceUrl && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-4xl w-full max-h-[90dvh] pb-safe flex flex-col overflow-hidden shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950 shrink-0">
                            <span className="text-sm font-bold text-white uppercase flex items-center gap-2 truncate">
                                <FileText size={16} className="text-indigo-400 shrink-0" /> Factura Digitalizada ({referenceNumber || 'Comprobante'})
                            </span>
                            <button 
                                onClick={() => setIsPreviewInvoiceOpen(false)} 
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 text-slate-400 hover:text-white rounded-lg cursor-pointer shrink-0"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 p-3 sm:p-4 overflow-auto flex items-center justify-center bg-black/40 min-h-0">
                            {invoiceUrl.toLowerCase().endsWith('.pdf') ? (
                                <iframe src={getInvoiceUrl(invoiceUrl)} className="w-full h-full min-h-[50vh] rounded-xl border-none" title="Factura PDF" />
                            ) : (
                                <img src={getInvoiceUrl(invoiceUrl)} alt="Factura Digitalizada" className="max-w-full max-h-full object-contain rounded-xl shadow-lg" />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </BaseModal>
    );
}
