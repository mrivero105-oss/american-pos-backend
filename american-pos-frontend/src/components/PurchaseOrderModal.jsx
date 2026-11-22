import { useState, useEffect, useRef, useMemo } from 'react';
import {
    X, 
    Save, 
    Plus, 
    Minus, 
    Check, 
    Trash2, 
    Search, 
    Package, 
    Printer, 
    Camera, 
    Upload, 
    Eye, 
    FileText, 
    CheckCircle2, 
    Loader2, 
    MessageCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { getImageUrl } from '../utils/imageUtils';
import BaseModal from './BaseModal';
import PrinterScanModal from './PrinterScanModal';
import CameraScanModal from './CameraScanModal';
import InvoiceViewerModal from './InvoiceViewerModal';
import { useFuzzySearch } from '../hooks/useFuzzySearch';

export default function PurchaseOrderModal({ isOpen, onClose, onSave, processing = false, initialSupplierId = null }) {
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [orderItems, setOrderItems] = useState([]); // [{ productId, name, quantity, cost }]
    const [expectedDate, setExpectedDate] = useState('');
    const [referenceNumber, setReferenceNumber] = useState('');
    const [isImmediateReception, setIsImmediateReception] = useState(false);
    const [notes, setNotes] = useState('');
    const [showSupplierProducts, setShowSupplierProducts] = useState(false);
    const [catalogSearchTerm, setCatalogSearchTerm] = useState('');
    const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState('paid');

    // --- Factura Real Digitalizada States ---
    const [invoiceUrl, setInvoiceUrl] = useState('');
    const [invoiceOriginalName, setInvoiceOriginalName] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [showPrinterScanModal, setShowPrinterScanModal] = useState(false);
    const [showCameraScanModal, setShowCameraScanModal] = useState(false);
    const [showInvoiceViewer, setShowInvoiceViewer] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            fetchSuppliers();
            fetchProducts();
            // Reset form
            setSelectedSupplier(initialSupplierId || '');
            setOrderItems([]);
            setExpectedDate(new Date().toISOString().split('T')[0]);
            setReferenceNumber('');
            setIsImmediateReception(false);
            setPaymentStatus('paid');
            setNotes('');
            setInvoiceUrl('');
            setInvoiceOriginalName('');
        }
    }, [isOpen, initialSupplierId]);

    const fetchSuppliers = async () => {
        try {
            const res = await api.get('/suppliers');
            setSuppliers(res.data || []);
        } catch (e) { console.error(e); }
    };

    const fetchProducts = async () => {
        try {
            const res = await api.get('/products');
            setProducts(res.data.products || res.data || []);
        } catch (e) { console.error(e); }
    };

    const addItem = (product) => {
        const existing = orderItems.find(item => item.productId === product.id);
        if (existing) {
            setOrderItems(prev => prev.map(item =>
                item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
            ));
        } else {
            setOrderItems(prev => [...prev, {
                productId: product.id,
                name: product.name,
                quantity: 1,
                cost: Number(product.cost || 0),
                sellPrice: Number(product.price || 0),
                bulkUnitName: product.bulkUnitName || 'Bulto',
                unitsPerBulk: product.unitsPerBulk || 1
            }]);
        }
        setSearchTerm('');
    };

    const addBulkItem = (product) => {
        const units = product.unitsPerBulk || 1;
        const existing = orderItems.find(item => item.productId === product.id);
        if (existing) {
            setOrderItems(prev => prev.map(item =>
                item.productId === product.id ? { ...item, quantity: item.quantity + units } : item
            ));
        } else {
            setOrderItems(prev => [...prev, {
                productId: product.id,
                name: product.name,
                quantity: units,
                cost: Number(product.cost || 0),
                sellPrice: Number(product.price || 0),
                bulkUnitName: product.bulkUnitName || 'Bulto',
                unitsPerBulk: units
            }]);
        }
    };

    const removeItem = (productId) => {
        setOrderItems(prev => prev.filter(item => item.productId !== productId));
    };

    const updateItem = (productId, field, value) => {
        setOrderItems(prev => prev.map(item => {
            if (item.productId === productId) {
                if (field === 'bulkQuantity') {
                    const units = parseFloat(value) * item.unitsPerBulk;
                    return { ...item, quantity: units };
                }
                if (field === 'bulkCost') {
                    const unitCost = Number((parseFloat(value) / (item.unitsPerBulk || 1)).toFixed(2));
                    return { ...item, cost: unitCost };
                }
                return { ...item, [field]: parseFloat(value) || 0 };
            }
            return item;
        }));
    };

    const handleImportedItems = (importedList) => {
        if (!Array.isArray(importedList) || importedList.length === 0) return;
        const newItems = [];
        importedList.forEach(item => {
            const matchedLocalProduct = products.find(p => p.id === item.localProductId);
            if (matchedLocalProduct) {
                newItems.push({
                    productId: matchedLocalProduct.id,
                    name: matchedLocalProduct.name,
                    quantity: Number(item.quantity || 1),
                    cost: Number(item.price || matchedLocalProduct.cost || 0),
                    sellPrice: Number(matchedLocalProduct.price || 0),
                    bulkUnitName: matchedLocalProduct.bulkUnitName || 'Bulto',
                    unitsPerBulk: matchedLocalProduct.unitsPerBulk || 1
                });
            } else if (item.externalName) {
                const foundByName = products.find(p => p.name.toLowerCase().trim() === item.externalName.toLowerCase().trim());
                if (foundByName) {
                    newItems.push({
                        productId: foundByName.id,
                        name: foundByName.name,
                        quantity: Number(item.quantity || 1),
                        cost: Number(item.price || foundByName.cost || 0),
                        sellPrice: Number(foundByName.price || 0),
                        bulkUnitName: foundByName.bulkUnitName || 'Bulto',
                        unitsPerBulk: foundByName.unitsPerBulk || 1
                    });
                }
            }
        });

        if (newItems.length > 0) {
            setOrderItems(prev => {
                const combined = [...prev];
                newItems.forEach(newItem => {
                    const idx = combined.findIndex(c => c.productId === newItem.productId);
                    if (idx >= 0) {
                        combined[idx] = { ...combined[idx], quantity: combined[idx].quantity + newItem.quantity, cost: newItem.cost };
                    } else {
                        combined.push(newItem);
                    }
                });
                return combined;
            });
            toast.success(`Se auto-completaron ${newItems.length} productos detectados en la factura`);
        }
    };

    const handleScanFromPrinter = async ({ deviceId, dpi, colorMode }) => {
        setIsScanning(true);
        const toastId = toast.loading('Adquiriendo factura física desde el escáner...');
        try {
            const res = await api.post('/purchase-orders/scan-invoice', {
                deviceId,
                dpi,
                colorMode,
                supplierId: selectedSupplier
            }, {
                timeout: 180000 // 3 minutes timeout for physical scanner hardware
            });

            if (res.data?.invoiceUrl) {
                setInvoiceUrl(res.data.invoiceUrl);
                setInvoiceOriginalName('Factura_Escaneada.jpg');
                setShowPrinterScanModal(false);
                toast.success('¡Factura escaneada y guardada permanentemente!', { id: toastId });

                if (res.data.items && res.data.items.length > 0) {
                    handleImportedItems(res.data.items);
                }
            }
        } catch (err) {
            console.error('Scan error:', err);
            const errorMsg = err.code === 'ECONNABORTED' || err.message?.includes('timeout')
                ? 'El escáner tardó demasiado en responder. Intenta con 300 DPI si el escaneo en 600 DPI es muy lento.'
                : (err.response?.data?.error || 'Error al adquirir imagen del escáner.');
            toast.error(errorMsg, { id: toastId, duration: 6000 });
        } finally {
            setIsScanning(false);
        }
    };

    const handleUploadInvoiceFile = async (file) => {
        if (!file) return;
        setIsUploading(true);
        const toastId = toast.loading('Procesando y almacenando factura...');
        const formData = new FormData();
        formData.append('file', file);
        if (selectedSupplier) formData.append('supplierId', selectedSupplier);

        try {
            const res = await api.post('/purchase-orders/upload-invoice', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 180000
            });

            if (res.data?.invoiceUrl) {
                setInvoiceUrl(res.data.invoiceUrl);
                setInvoiceOriginalName(file.name || 'Factura_Digital');
                setShowCameraScanModal(false);
                toast.success('¡Factura física guardada permanentemente!', { id: toastId });

                if (res.data.items && res.data.items.length > 0) {
                    handleImportedItems(res.data.items);
                }
            }
        } catch (err) {
            console.error('Upload invoice error:', err);
            toast.error(err.response?.data?.error || 'Error al subir la factura.', { id: toastId });
        } finally {
            setIsUploading(false);
        }
    };

    const handleSubmit = (e) => {
        if (e) e.preventDefault();
        if (!selectedSupplier) return toast.error('Seleccione un proveedor');
        if (orderItems.length === 0) return toast.error('Agregue al menos un producto');

        const total = orderItems.reduce((sum, item) => sum + (item.quantity * item.cost), 0);

        onSave({
            supplierId: selectedSupplier,
            items: JSON.stringify(orderItems),
            expectedDate,
            referenceNumber,
            status: isImmediateReception ? 'received' : 'pending',
            paymentStatus: paymentStatus,
            notes,
            total,
            invoiceUrl: invoiceUrl || null,
            date: new Date().toISOString().split('T')[0]
        });
    };

    const handleSaveAndSendWhatsApp = async () => {
        if (!selectedSupplier) return toast.error('Seleccione un proveedor para enviar el pedido');
        if (orderItems.length === 0) return toast.error('Agregue al menos un producto a la orden');

        const supplierObj = suppliers.find(s => String(s.id) === String(selectedSupplier));
        if (!supplierObj) return toast.error('Proveedor no encontrado');

        if (!supplierObj.phone) {
            toast.error(`El proveedor ${supplierObj.name} no tiene un teléfono configurado`);
            return;
        }

        setIsSendingWhatsApp(true);
        const total = orderItems.reduce((sum, item) => sum + (item.quantity * item.cost), 0);

        try {
            // 1. Guardar la orden si hay callback onSave o guardar directo vía api
            const orderPayload = {
                supplierId: selectedSupplier,
                items: JSON.stringify(orderItems),
                expectedDate,
                referenceNumber,
                status: isImmediateReception ? 'received' : 'pending',
                paymentStatus: paymentStatus,
                notes,
                total,
                invoiceUrl: invoiceUrl || null,
                date: new Date().toISOString().split('T')[0]
            };

            let createdOrder = null;
            try {
                const resOrder = await api.post('/purchase-orders', orderPayload);
                createdOrder = resOrder.data;
                if (onSave) onSave(createdOrder);
            } catch (saveErr) {
                console.warn('Error saving order via API (using payload):', saveErr.message);
                if (onSave) onSave(orderPayload);
            }

            // 2. Enviar por WhatsApp
            const waPayload = {
                supplierId: selectedSupplier,
                orderId: createdOrder?.id || 'NUEVO',
                phone: supplierObj.phone,
                items: orderItems,
                notes,
                total,
                referenceNumber,
                supplierName: supplierObj.name,
                supplierContact: supplierObj.contact
            };

            const resWa = await api.post('/whatsapp/send-order', waPayload);

            if (resWa.data?.botSent) {
                toast.success(`✅ Pedido enviado exitosamente por WhatsApp a ${supplierObj.name}`);
            } else if (resWa.data?.whatsappUrl) {
                window.open(resWa.data.whatsappUrl, '_blank');
                toast.success(`📱 Abriendo WhatsApp con el pedido para ${supplierObj.name}...`);
            } else {
                toast.success('Pedido registrado y formateado con éxito');
            }

            onClose();
        } catch (err) {
            console.error('Error in handleSaveAndSendWhatsApp:', err);
            toast.error('Error al procesar el envío por WhatsApp: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsSendingWhatsApp(false);
        }
    };

    const fuzzyQuickProducts = useFuzzySearch(products, searchTerm);
    const filteredProducts = searchTerm.trim() ? fuzzyQuickProducts.slice(0, 5) : [];

    const supplierProducts = useMemo(() => {
        return products.filter(p => String(p.supplierId) === String(selectedSupplier));
    }, [products, selectedSupplier]);
    const filteredCatalog = useFuzzySearch(supplierProducts, catalogSearchTerm);

    const totalOrder = orderItems.reduce((sum, item) => sum + (item.quantity * item.cost), 0);

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-4xl"
            className="overflow-hidden flex flex-col max-h-[92dvh] pb-safe border border-slate-200 dark:border-slate-800"
        >

                {/* Header */}
                <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 shrink-0">
                    <div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white">Orden de Compra / Albarán</h2>
                        <p className="text-xs text-slate-500">Planifica pedidos o registra la entrada física de mercancía.</p>
                    </div>
                    <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-3 sm:p-4 overflow-y-auto flex-1 flex flex-col gap-3 min-h-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="flex gap-2 items-end">
                            <div className="flex-1">
                                <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 ml-1">Proveedor *</label>
                                <select
                                    required
                                    value={selectedSupplier}
                                    onChange={(e) => setSelectedSupplier(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none text-base sm:text-xs font-bold min-h-[44px] sm:min-h-[36px]"
                                >
                                    <option value="">Seleccione proveedor...</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            {selectedSupplier && (
                                <button
                                    type="button"
                                    onClick={() => setShowSupplierProducts(true)}
                                    className="flex items-center justify-center gap-1.5 px-3 min-h-[44px] sm:min-h-[36px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 rounded-xl font-bold text-xs hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors shrink-0"
                                >
                                    <Package size={14} /> Catálogo
                                </button>
                            )}
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 ml-1">Fecha Esperada / Recepción</label>
                            <input
                                type="date"
                                value={expectedDate}
                                onChange={(e) => setExpectedDate(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none text-base sm:text-xs font-bold min-h-[44px] sm:min-h-[36px]"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 ml-1">Nro. Albarán / Referencia</label>
                            <input
                                type="text"
                                placeholder="Ej: ALB-2023-001..."
                                value={referenceNumber}
                                onChange={(e) => setReferenceNumber(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none font-mono text-base sm:text-xs min-h-[44px] sm:min-h-[36px]"
                            />
                        </div>
                    </div>

                    {/* --- SECCIÓN DE FACTURA REAL DIGITALIZADA (ESCÁNER / CÁMARA / PDF) --- */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                                    <FileText size={16} />
                                </div>
                                <div>
                                    <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                                        Factura Física Digitalizada
                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                                            invoiceUrl 
                                                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' 
                                                : 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                                        }`}>
                                            {invoiceUrl ? '✓ Factura Adjunta' : 'Opcional'}
                                        </span>
                                    </span>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                        Escanea o carga la factura original para archivado permanente y lectura automática
                                    </p>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            {/* Action Buttons */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setShowPrinterScanModal(true)}
                                    disabled={isScanning || isUploading}
                                    className="flex items-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs min-h-[38px] transition-all shadow-sm cursor-pointer disabled:opacity-50"
                                    title="Escanear factura desde impresora o escáner WIA"
                                >
                                    <Printer size={14} />
                                    <span>Escanear Impresora</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowCameraScanModal(true)}
                                    disabled={isScanning || isUploading}
                                    className="flex items-center gap-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs min-h-[38px] transition-all shadow-sm cursor-pointer disabled:opacity-50"
                                    title="Escanear factura con cámara o webcam"
                                >
                                    <Camera size={14} />
                                    <span>Cámara</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isScanning || isUploading}
                                    className="flex items-center gap-1 px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl font-bold text-xs min-h-[38px] transition-all cursor-pointer disabled:opacity-50"
                                    title="Cargar archivo PDF o Imagen de la factura"
                                >
                                    <Upload size={14} />
                                    <span>Subir PDF / Imagen</span>
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pdf,image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                             handleUploadInvoiceFile(e.target.files[0]);
                                            e.target.value = '';
                                        }
                                    }}
                                />
                            </div>
                        </div>

                        {/* Attached Invoice Card or Loading */}
                        {isScanning || isUploading ? (
                            <div className="p-3 bg-indigo-50/50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-xl flex items-center justify-center gap-2 text-indigo-600 dark:text-indigo-300 text-xs font-bold animate-pulse">
                                <Loader2 size={16} className="animate-spin" />
                                <span>{isScanning ? 'Adquiriendo imagen del escáner y guardando documento...' : 'Cargando y procesando factura física...'}</span>
                            </div>
                        ) : invoiceUrl ? (
                            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="p-2 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg shrink-0">
                                        <CheckCircle2 size={18} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                                            {invoiceOriginalName || 'Factura_Digitalizada.jpg'}
                                        </p>
                                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                            ✓ Guardada permanentemente en el servidor • Lista para archivar con la orden
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setShowInvoiceViewer(true)}
                                        className="flex items-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold min-h-[38px] transition-all shadow cursor-pointer"
                                    >
                                        <Eye size={13} />
                                        <span>Ver Factura</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setInvoiceUrl(''); setInvoiceOriginalName(''); }}
                                        className="min-w-[38px] min-h-[38px] flex items-center justify-center p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                                        title="Quitar factura adjunta"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="flex items-center justify-between p-2.5 px-3 bg-emerald-50 dark:bg-emerald-500/5 rounded-xl border border-emerald-100 dark:border-emerald-500/20 min-h-[44px]">
                            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-400">¿Recibido en Stock?</span>
                            <button
                                type="button"
                                onClick={() => setIsImmediateReception(!isImmediateReception)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isImmediateReception ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isImmediateReception ? 'translate-x-6' : 'translate-x-1'}`}
                                />
                            </button>
                        </div>
                        <div className="flex items-center justify-between p-2.5 px-3 bg-indigo-50 dark:bg-indigo-500/5 rounded-xl border border-indigo-100 dark:border-indigo-500/20 min-h-[44px]">
                            <span className="text-xs font-bold text-indigo-800 dark:text-indigo-400">
                                {paymentStatus === 'paid' ? '✅ Pagada (Contado)' : '⏳ Por Pagar (Crédito)'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setPaymentStatus(prev => prev === 'paid' ? 'unpaid' : 'paid')}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${paymentStatus === 'paid' ? 'bg-emerald-500' : 'bg-rose-400 dark:bg-rose-700'}`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${paymentStatus === 'paid' ? 'translate-x-6' : 'translate-x-1'}`}
                                />
                            </button>
                        </div>
                        <div className="sm:col-span-2 md:col-span-2 relative">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" size={15} />
                                <input
                                    type="text"
                                    placeholder="Escriba el nombre del producto para agregar..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none text-base sm:text-xs font-semibold min-h-[44px] sm:min-h-[38px]"
                                />
                            </div>

                            {searchTerm && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-20 overflow-hidden">
                                    {filteredProducts.length > 0 ? (
                                        filteredProducts.map(p => (
                                            <button
                                                key={p.id}
                                                onClick={() => addItem(p)}
                                                className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 flex justify-between items-center transition-colors"
                                            >
                                                <div>
                                                    <p className="font-bold text-xs text-slate-800 dark:text-white">{p.name}</p>
                                                    <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest">{p.category} | SKU: {p.id}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs font-black text-primary-600">Ref: ${p.cost || 0}</p>
                                                    <p className="text-[9px] text-slate-500">Stock: {p.stockQuantity}</p>
                                                </div>
                                            </button>
                                        ))
                                    ) : (
                                        <div className="p-3 text-center text-slate-500 text-xs italic">No se encontraron productos.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Items Table */}
                    <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-x-auto">
                        <table className="w-full text-sm min-w-[750px]">
                            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 font-bold text-slate-700 dark:text-slate-300">
                                <tr>
                                    <th className="px-4 py-3 text-left">Producto</th>
                                    <th className="px-4 py-3 text-center w-24">Cant. Mayor</th>
                                    <th className="px-4 py-3 text-center w-24">Cantidad</th>
                                    <th className="px-4 py-3 text-right w-28">Costo Bulto ($)</th>
                                    <th className="px-4 py-3 text-right w-28">Costo Unit. ($)</th>
                                    <th className="px-4 py-3 text-right w-24">Margen %</th>
                                    <th className="px-4 py-3 text-right w-28">Subtotal</th>
                                    <th className="px-4 py-3 text-center w-12"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {orderItems.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-4 py-10 text-center text-slate-500 dark:text-slate-400 italic">No has agregado productos a la orden.</td>
                                    </tr>
                                ) : (
                                    orderItems.map(item => {
                                        const sellPrice = item.sellPrice || 0;
                                        const cost = item.cost || 0;
                                        const unitsPerBulk = item.unitsPerBulk || 1;
                                        const margin = sellPrice > 0 ? ((sellPrice - cost) / sellPrice) * 100 : 0;
                                        const bulkCost = cost * unitsPerBulk;

                                        return (
                                            <tr key={item.productId}>
                                                <td className="px-4 py-2">
                                                    <p className="font-bold text-slate-800 dark:text-white leading-tight">{item.name}</p>
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">P. Venta: ${sellPrice.toFixed(2)}</p>
                                                </td>
                                                <td className="px-4 py-2">
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        value={item.quantity / unitsPerBulk}
                                                        onChange={(e) => updateItem(item.productId, 'bulkQuantity', e.target.value)}
                                                        className="w-full text-center px-1 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none font-bold text-primary-600 text-base sm:text-xs min-h-[36px]"
                                                    />
                                                    <p className="text-[10px] text-center text-slate-500 dark:text-slate-400 mt-1 uppercase font-bold">{item.bulkUnitName || 'Bulto'}s</p>
                                                </td>
                                                <td className="px-4 py-2">
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        value={item.quantity}
                                                        onChange={(e) => updateItem(item.productId, 'quantity', e.target.value)}
                                                        className="w-full text-center px-1 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none text-base sm:text-xs min-h-[36px]"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <div className="flex flex-col items-end">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            value={bulkCost || ''}
                                                            onChange={(e) => updateItem(item.productId, 'bulkCost', e.target.value)}
                                                            className="w-full text-right px-1 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 outline-none font-bold font-mono text-base sm:text-xs min-h-[36px]"
                                                        />
                                                        <span className="text-[9px] text-indigo-400 mt-0.5">Editando Bulto</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2">
                                                    <div className="flex flex-col items-end">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            value={cost || ''}
                                                            onChange={(e) => updateItem(item.productId, 'cost', e.target.value)}
                                                            className="w-full text-right px-1 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none font-mono text-base sm:text-xs min-h-[36px]"
                                                        />
                                                        <span className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">Editando Unit.</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <span className={`text-xs font-black px-2 py-1 rounded-md ${margin < 10 ? 'bg-red-100 text-red-600' :
                                                        margin < 25 ? 'bg-amber-100 text-amber-600' :
                                                            'bg-emerald-100 text-emerald-600'
                                                        }`}>
                                                        {margin.toFixed(1)}%
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-right font-bold text-slate-800 dark:text-white">
                                                    ${(item.quantity * cost).toFixed(2)}
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                    <button onClick={() => removeItem(item.productId)} className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-red-500 transition-colors mx-auto">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Notas / Instrucciones</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows="2"
                            className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none resize-none text-base sm:text-sm"
                            placeholder="Ej: Entrega antes de las 5pm, factura a crédito..."
                        ></textarea>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 shrink-0">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Total Estimado</span>
                        <span className="text-2xl font-black text-slate-800 dark:text-white">${totalOrder.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2.5 items-center justify-end">
                        <button onClick={onClose} disabled={processing || isSendingWhatsApp} className="min-h-[48px] sm:min-h-[44px] px-4 py-2.5 rounded-xl font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 dark:bg-slate-800 transition-colors text-xs flex items-center justify-center">
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveAndSendWhatsApp}
                            disabled={processing || isSendingWhatsApp || orderItems.length === 0}
                            className="min-h-[48px] sm:min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs text-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 cursor-pointer flex-1 sm:flex-none"
                            title="Guardar orden y enviar mensaje detallado al WhatsApp del proveedor"
                        >
                            {isSendingWhatsApp ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            ) : (
                                <MessageCircle size={16} className="text-white" />
                            )}
                            <span>{isSendingWhatsApp ? 'Enviando...' : 'Enviar por WhatsApp'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={processing || isSendingWhatsApp || orderItems.length === 0}
                            className="min-h-[48px] sm:min-h-[44px] flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs text-white bg-primary-600 hover:bg-primary-700 active:scale-95 transition-all shadow-lg shadow-primary-600/20 disabled:opacity-50 cursor-pointer flex-1 sm:flex-none"
                        >
                            {processing ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            ) : (
                                <><Save size={16} /> {isImmediateReception ? 'Registrar Albarán' : 'Guardar Orden'}</>
                            )}
                        </button>
                    </div>
                </div>
            {/* Nested Modal for Supplier Products Catalog */}
            {showSupplierProducts && (
                <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/85 backdrop-blur-xl p-2 sm:p-6 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-[96vw] sm:w-[94vw] max-w-6xl h-[90dvh] max-h-[90dvh] pb-safe overflow-hidden flex flex-col">
                        {/* Header */}
                        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/90 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2 sm:p-2.5 bg-primary-500/20 text-primary-400 rounded-lg border border-primary-500/30 shrink-0">
                                    <Package size={20} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-wider">
                                            Catálogo del Proveedor
                                        </h3>
                                        <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30">
                                            {products.filter(p => String(p.supplierId) === String(selectedSupplier)).length} PRODUCTOS
                                        </span>
                                    </div>
                                    <p className="text-[11px] sm:text-xs text-slate-400 font-medium mt-0.5">
                                        Selecciona los productos y cantidades para añadir a la orden de compra
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                                <div className="relative flex-1 sm:w-72">
                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                                    <input
                                        type="text"
                                        placeholder="Buscar por nombre o código..."
                                        value={catalogSearchTerm}
                                        onChange={(e) => setCatalogSearchTerm(e.target.value)}
                                        className="w-full pl-10 pr-9 py-2 text-base sm:text-xs min-h-[44px] sm:min-h-[38px] border border-slate-700 rounded-xl bg-slate-900 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                                    />
                                    {catalogSearchTerm && (
                                        <button
                                            onClick={() => setCatalogSearchTerm('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                                <button 
                                    onClick={() => { setShowSupplierProducts(false); setCatalogSearchTerm(''); }} 
                                    className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer"
                                    title="Cerrar catálogo"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Product Grid */}
                        <div className="p-3.5 sm:p-6 overflow-y-auto flex-1 bg-slate-950/60 custom-scrollbar min-h-0">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                                {(() => {
                                    if (filteredCatalog.length > 0) {
                                        return filteredCatalog.map(p => {
                                            const isInOrder = orderItems.some(item => item.productId === p.id);
                                            const orderQuantity = isInOrder ? orderItems.find(item => item.productId === p.id).quantity : 0;
                                            const hasStock = Number(p.stockQuantity || 0) > 0;

                                            return (
                                                <div 
                                                    key={p.id} 
                                                    className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between min-h-[148px] group relative ${
                                                        isInOrder 
                                                            ? 'bg-slate-800/95 border-primary-500/60 shadow-lg shadow-primary-950/30 ring-1 ring-primary-500/30' 
                                                            : 'bg-slate-900/90 hover:bg-slate-800/90 border-slate-700/60 hover:border-slate-600'
                                                    }`}
                                                >
                                                    {/* Top: Image & Info */}
                                                    <div className="flex items-start gap-3 min-w-0">
                                                        {/* Image */}
                                                        <div className="w-13 h-13 shrink-0 bg-slate-950 rounded-xl overflow-hidden border border-slate-700/80 flex items-center justify-center p-1 relative">
                                                            {(p.imageUrl || p.imageUri) ? (
                                                                <img
                                                                    src={getImageUrl(p.imageUrl || p.imageUri)}
                                                                    alt={p.name}
                                                                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                                                                />
                                                            ) : (
                                                                <Package className="text-slate-600" size={22} />
                                                            )}
                                                        </div>

                                                        {/* Name & Details */}
                                                        <div className="flex-1 min-w-0">
                                                            <h4 className="font-bold text-xs sm:text-sm text-white leading-tight line-clamp-2 h-9 flex items-center" title={p.name}>
                                                                {p.name}
                                                            </h4>
                                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                                {p.category && (
                                                                    <span className="text-[9px] font-black text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 uppercase tracking-wider truncate max-w-[100px]">
                                                                        {p.category}
                                                                    </span>
                                                                )}
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                                                    hasStock 
                                                                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' 
                                                                        : 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                                                                }`}>
                                                                    Stock: {p.stockQuantity ?? 0}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Bottom: Cost & Action Controls (Rock Solid Layout) */}
                                                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800/80 mt-2">
                                                        <div className="min-w-0 shrink-0">
                                                            <span className="text-sm font-black text-emerald-400 font-mono leading-none block">
                                                                ${Number(p.cost || 0).toFixed(2)}
                                                            </span>
                                                            <span className="text-[9px] text-slate-400 font-medium block truncate max-w-[90px] h-3.5">
                                                                {p.unitsPerBulk > 1 ? `${p.unitsPerBulk} un/${p.bulkUnitName || 'Bulto'}` : 'Precio costo'}
                                                            </span>
                                                        </div>

                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            {/* Bulk Button */}
                                                            {p.unitsPerBulk > 1 && (
                                                                <button
                                                                    onClick={() => addBulkItem(p)}
                                                                    className="flex items-center gap-1 bg-emerald-500/15 hover:bg-emerald-500/25 active:scale-95 text-emerald-400 px-2.5 py-1.5 min-h-[36px] rounded-lg text-[10px] font-black transition-all border border-emerald-500/30 cursor-pointer shadow-sm whitespace-nowrap"
                                                                    title={`Añadir 1 ${p.bulkUnitName || 'Bulto'} (+${p.unitsPerBulk} unidades)`}
                                                                >
                                                                    +1 {p.bulkUnitName || 'Bulto'}
                                                                </button>
                                                            )}

                                                            {/* Stepper / Add Unit */}
                                                            {isInOrder ? (
                                                                <div className="flex items-center bg-slate-950 border border-primary-500/50 rounded-lg p-0.5 shadow-inner">
                                                                    <button
                                                                        onClick={() => {
                                                                            if (orderQuantity <= 1) {
                                                                                removeItem(p.id);
                                                                            } else {
                                                                                setOrderItems(prev => prev.map(item => item.productId === p.id ? { ...item, quantity: item.quantity - 1 } : item));
                                                                            }
                                                                        }}
                                                                        className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center hover:bg-white/10 text-slate-300 hover:text-rose-400 rounded transition-all cursor-pointer"
                                                                        title="Disminuir 1 unidad"
                                                                    >
                                                                        <Minus size={13} />
                                                                    </button>
                                                                    <span className="text-xs font-black text-primary-300 px-1 font-mono min-w-[22px] text-center">
                                                                        {orderQuantity}
                                                                    </span>
                                                                    <button
                                                                        onClick={() => addItem(p)}
                                                                        className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center hover:bg-white/10 text-slate-300 hover:text-primary-400 rounded transition-all cursor-pointer"
                                                                        title="Aumentar 1 unidad"
                                                                    >
                                                                        <Plus size={13} />
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => addItem(p)}
                                                                    className="flex items-center gap-1 bg-primary-600 hover:bg-primary-500 active:scale-95 text-white px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-bold transition-all shadow-md shadow-primary-600/20 cursor-pointer whitespace-nowrap"
                                                                >
                                                                    <Plus size={13} /> Unidad
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        });
                                    } else {
                                        return (
                                            <div className="col-span-full py-16 text-center flex flex-col items-center justify-center">
                                                <Package size={52} className="text-slate-700 mb-3" />
                                                <p className="text-slate-300 font-bold mb-1">No se encontraron productos para este proveedor.</p>
                                                {supplierProducts.length === 0 && (
                                                    <p className="text-xs text-slate-500">Asocia productos a este proveedor desde el módulo de Inventario para verlos aquí.</p>
                                                )}
                                            </div>
                                        );
                                    }
                                })()}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-t border-slate-800 bg-slate-950/95 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 text-xs shrink-0">
                            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                <span className="text-slate-400">
                                    Productos en la orden: <strong className="text-white font-black">{orderItems.length} ítems</strong> ({orderItems.reduce((sum, item) => sum + item.quantity, 0)} unidades)
                                </span>
                                <span className="text-slate-700 hidden sm:inline">•</span>
                                <span className="text-slate-400">
                                    Total estimado: <strong className="text-emerald-400 font-mono font-black">${orderItems.reduce((sum, item) => sum + (item.quantity * item.cost), 0).toFixed(2)}</strong>
                                </span>
                            </div>

                            <button 
                                onClick={() => { setShowSupplierProducts(false); setCatalogSearchTerm(''); }} 
                                className="min-h-[48px] sm:min-h-[44px] flex items-center justify-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-500 active:scale-95 text-white rounded-xl shadow-lg shadow-primary-600/30 font-black text-xs transition-all cursor-pointer w-full sm:w-auto"
                            >
                                <Check size={16} /> Listo
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL PARA ESCÁNER WIA DE IMPRESORA --- */}
            <PrinterScanModal
                isOpen={showPrinterScanModal}
                onClose={() => setShowPrinterScanModal(false)}
                onScan={handleScanFromPrinter}
                isScanning={isScanning}
            />

            {/* --- MODAL PARA ESCÁNER POR CÁMARA --- */}
            <CameraScanModal
                isOpen={showCameraScanModal}
                onClose={() => setShowCameraScanModal(false)}
                onCapture={handleUploadInvoiceFile}
            />

            {/* --- VISOR DE FACTURA REAL DIGITALIZADA --- */}
            <InvoiceViewerModal
                isOpen={showInvoiceViewer}
                onClose={() => setShowInvoiceViewer(false)}
                invoiceUrl={invoiceUrl}
                title="Factura Adjunta a la Orden"
                details={{
                    referenceNumber: referenceNumber || 'Borrador',
                    supplierName: suppliers.find(s => s.id === selectedSupplier)?.name || '',
                    date: expectedDate || new Date().toISOString().split('T')[0]
                }}
            />
        </BaseModal>
    );
}
