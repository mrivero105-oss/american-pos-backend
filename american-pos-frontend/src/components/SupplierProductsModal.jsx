import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    X, 
    Save, 
    Search, 
    Package, 
    CheckCircle2, 
    Circle, 
    FileText, 
    Upload, 
    ArrowUpRight, 
    Plus, 
    AlertCircle, 
    CheckSquare, 
    Square, 
    FileUp, 
    Database, 
    Link2, 
    Layers, 
    Check, 
    MessageCircle
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { formatUSD } from '../utils/format';
import { getImageUrl } from '../utils/imageUtils';
import BaseModal from './BaseModal';

export default function SupplierProductsModal({ isOpen, onClose, supplier, onUpdate, onOpenPurchaseOrder = null }) {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    // Tab Mode: 'manual' (existing product linkage) | 'pdf' (import from supplier's PDF)
    const [activeTab, setActiveTab] = useState('manual');

    // Manual view state
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState([]);
    const [processing, setProcessing] = useState(false);

    // PDF Import state
    const [pdfLoading, setPdfLoading] = useState(false);
    const [pdfItems, setPdfItems] = useState([]);
    const [pdfSaving, setPdfSaving] = useState(false);
    const [pdfSearchTerm, setPdfSearchTerm] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    
    // PDF Sub-filter: 'matched' (in DB) | 'all' (everything) | 'new' (not in DB)
    const [pdfFilterTab, setPdfFilterTab] = useState('matched');

    // Manual Link picker for individual PDF row
    const [manualLinkTargetItem, setManualLinkTargetItem] = useState(null);
    const [manualLinkSearch, setManualLinkSearch] = useState('');

    const supplierId = supplier?.id;

    const fetchProducts = useCallback(async () => {
        if (!supplierId) return;
        try {
            setLoading(true);
            const res = await api.get('/products');
            const allProducts = res.data || [];
            setProducts(allProducts);
            
            // Initially select products that already belong to this supplier
            const initialSelected = allProducts
                .filter(p => p.supplierId === supplierId)
                .map(p => p.id);
            setSelectedIds(initialSelected);
        } catch (error) {
            console.error('Error fetching products:', error);
            toast.error('Error al cargar productos');
        } finally {
            setLoading(false);
        }
    }, [supplierId]);

    useEffect(() => {
        if (isOpen && supplier) {
            fetchProducts();
            // Reset PDF state on open
            setPdfItems([]);
            setActiveTab('manual');
            setPdfFilterTab('matched');
            setManualLinkTargetItem(null);
        }
    }, [isOpen, supplier, fetchProducts]);

    if (!isOpen || !supplier) return null;

    const toggleProduct = (productId) => {
        setSelectedIds(prev => 
            prev.includes(productId) 
                ? prev.filter(id => id !== productId)
                : [...prev, productId]
        );
    };

    const handleSaveManual = async () => {
        try {
            setProcessing(true);
            await api.post(`/suppliers/${supplier.id}/products`, {
                productIds: selectedIds
            });
            toast.success('Productos vinculados correctamente al proveedor');
            if (onUpdate) onUpdate();
            onClose();
        } catch (error) {
            console.error('Error syncing products:', error);
            toast.error('Error al sincronizar productos');
        } finally {
            setProcessing(false);
        }
    };

    // --- PDF Processing Methods ---
    const handlePdfFileSelect = (selectedFile) => {
        if (!selectedFile) return;
        const validExts = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
        const ext = (selectedFile.name.split('.').pop() || '').toLowerCase();
        if (!validExts.includes(ext) && !selectedFile.type.startsWith('image/')) {
            toast.error('Por favor selecciona un archivo PDF o imagen de catálogo');
            return;
        }
        processPdfFile(selectedFile);
    };

    const processPdfFile = async (fileToProcess) => {
        setPdfLoading(true);
        const toastId = toast.loading(`Extrayendo y verificando con tu inventario...`);
        const formData = new FormData();
        formData.append('catalog', fileToProcess);
        formData.append('supplierId', supplier.id);

        try {
            const { data } = await api.post('/products/import-catalog', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 180000
            });

            const rawList = Array.isArray(data) 
                ? data 
                : (Array.isArray(data?.items) 
                    ? data.items 
                    : (Array.isArray(data?.items?.items) ? data.items.items : (Array.isArray(data?.rawItems) ? data.rawItems : [])));

            if (rawList.length === 0) {
                toast.error('No se detectaron productos legibles en el documento', { id: toastId });
                setPdfItems([]);
                return;
            }

            // Map items: ONLY select products that match an existing item in the Database (Inventory)
            const parsedItems = rawList.map((item, idx) => {
                const hasMatch = !!item.matchedProduct;
                return {
                    id: `pdf_item_${idx}_${Date.now()}`,
                    externalName: item.externalName || 'Producto sin nombre',
                    price: Number(item.price || 0),
                    quantity: Number(item.suggestedQuantity || 1) || 1,
                    margin: 30,
                    isNew: !hasMatch,
                    matchedProduct: item.matchedProduct || null,
                    confidence: item.confidence || (hasMatch ? 80 : 0),
                    // KEY RULE: ONLY SELECT PRODUCTS EXISTING IN DB BY DEFAULT!
                    selected: hasMatch
                };
            });

            const matchedTotal = parsedItems.filter(i => !!i.matchedProduct).length;
            setPdfItems(parsedItems);

            if (matchedTotal > 0) {
                setPdfFilterTab('matched');
                toast.success(`✨ ${parsedItems.length} detectados en PDF (${matchedTotal} coinciden con tu BD y fueron seleccionados)`, { id: toastId, duration: 4000 });
            } else {
                setPdfFilterTab('all');
                toast.success(`✨ ${parsedItems.length} productos detectados en el PDF`, { id: toastId });
            }
        } catch (error) {
            console.error('Error importing PDF catalog:', error);
            const msg = error.response?.data?.error || error.message || 'Error al procesar el archivo PDF';
            toast.error(msg, { id: toastId, duration: 5000 });
        } finally {
            setPdfLoading(false);
        }
    };

    const togglePdfItem = (id) => {
        setPdfItems(prev => prev.map(item => 
            item.id === id ? { ...item, selected: !item.selected } : item
        ));
    };

    const toggleSelectAllPdf = (select) => {
        setPdfItems(prev => prev.map(item => ({ ...item, selected: select })));
    };

    const selectOnlyMatchedPdf = () => {
        setPdfItems(prev => prev.map(item => ({
            ...item,
            selected: !!item.matchedProduct
        })));
        toast.success('Seleccionados únicamente los productos que coinciden con tu inventario (BD)');
    };

    const handleManualLinkProduct = (targetItem, selectedDbProduct) => {
        if (!targetItem || !selectedDbProduct) return;
        setPdfItems(prev => prev.map(item => {
            if (item.id === targetItem.id) {
                return {
                    ...item,
                    isNew: false,
                    matchedProduct: {
                        id: selectedDbProduct.id,
                        name: selectedDbProduct.name,
                        currentCost: selectedDbProduct.cost,
                        barcode: selectedDbProduct.barcode,
                        unitsPerBulk: Number(selectedDbProduct.unitsPerBulk || 1),
                        margin: Number(selectedDbProduct.margin || 0)
                    },
                    selected: true,
                    confidence: 100
                };
            }
            return item;
        }));
        setManualLinkTargetItem(null);
        toast.success(`Vinculado a: ${selectedDbProduct.name}`);
    };

    const handleApplyPdfMapping = async () => {
        const approvedItems = pdfItems.filter(i => i.selected);
        if (approvedItems.length === 0) {
            toast.error('Selecciona al menos un producto para incorporar');
            return;
        }

        setPdfSaving(true);
        const toastId = toast.loading(`Incorporando ${approvedItems.length} productos al catálogo de ${supplier.name}...`);

        try {
            const mappings = approvedItems.map(i => {
                const safePrice = Number(i.price || 0);
                const safeQuantity = Number(i.quantity || 1) || 1;
                const safeMargin = Number(i.margin || 30);
                const unitCost = safePrice / safeQuantity;
                const salesPrice = unitCost * (1 + safeMargin / 100);

                return {
                    externalName: i.externalName,
                    localProductId: (i.isNew || !i.matchedProduct) ? null : i.matchedProduct.id,
                    isNew: !!i.isNew,
                    price: safePrice,
                    quantity: safeQuantity,
                    margin: safeMargin,
                    newPrice: salesPrice,
                    supplierId: supplier.id,
                    initialStock: 0,
                    imageUri: null
                };
            });

            await api.post('/products/apply-mapping', {
                mappings,
                supplierId: supplier.id
            });

            toast.success(`¡Éxito! ${mappings.length} productos vinculados a ${supplier.name}`, { id: toastId });
            
            // Reload full product list and switch back to manual catalog view
            await fetchProducts();
            setActiveTab('manual');
            setPdfItems([]);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Error applying PDF mapping:', error);
            const msg = error.response?.data?.error || 'Error al guardar productos del catálogo';
            toast.error(msg, { id: toastId });
        } finally {
            setPdfSaving(false);
        }
    };

    const filteredManualProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.barcode?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Filter PDF list based on search and tab filter ('matched' | 'all' | 'new')
    const filteredPdfItems = pdfItems.filter(p => {
        const matchesSearch = p.externalName.toLowerCase().includes(pdfSearchTerm.toLowerCase()) ||
            (p.matchedProduct?.name && p.matchedProduct.name.toLowerCase().includes(pdfSearchTerm.toLowerCase()));
        
        if (!matchesSearch) return false;
        if (pdfFilterTab === 'matched') return !!p.matchedProduct;
        if (pdfFilterTab === 'new') return !p.matchedProduct;
        return true;
    });

    const totalPdfCount = pdfItems.length;
    const matchedPdfCount = pdfItems.filter(i => !!i.matchedProduct).length;
    const newPdfCount = pdfItems.filter(i => !i.matchedProduct).length;
    const selectedPdfCount = pdfItems.filter(i => i.selected).length;
    const selectedMatchedCount = pdfItems.filter(i => i.selected && !!i.matchedProduct).length;

    // Filter products for the manual link modal
    const manualLinkCandidates = products.filter(p => 
        !manualLinkSearch || 
        p.name.toLowerCase().includes(manualLinkSearch.toLowerCase()) ||
        p.barcode?.toLowerCase().includes(manualLinkSearch.toLowerCase())
    ).slice(0, 15);

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-4xl"
            className="relative bg-white dark:bg-slate-900 overflow-hidden border border-slate-200 dark:border-slate-800 h-[92dvh] max-h-[92dvh] pb-safe flex flex-col rounded-xl shadow-xl"
        >
            {/* Header with Navigation Tabs */}
            <div className="relative px-4 sm:px-8 py-3.5 sm:py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 group overflow-hidden shrink-0 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-950/40">
                <div className="absolute inset-0 bg-gradient-to-r from-primary-600/10 via-transparent to-purple-600/5 pointer-events-none" />
                
                <div className="relative flex items-center gap-3 sm:gap-4 min-w-0">
                    <div className="p-2.5 sm:p-3 bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400 rounded-xl sm:rounded-2xl shadow-inner shrink-0">
                        <Package size={20} className="sm:w-6 sm:h-6" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase truncate">Catálogo del Proveedor</h2>
                        </div>
                        <p className="text-[9.5px] sm:text-[10px] font-black text-primary-600 dark:text-primary-400 uppercase tracking-[0.2em] truncate max-w-[200px] sm:max-w-[280px]">
                            {supplier?.name}
                        </p>
                    </div>
                </div>

                {/* Tab Switcher */}
                <div className="flex items-center gap-2 z-10 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="flex bg-slate-200/70 dark:bg-slate-800 p-1 rounded-2xl border border-slate-300/40 dark:border-white/5 flex-1 sm:flex-none">
                        <button
                            type="button"
                            onClick={() => setActiveTab('manual')}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                activeTab === 'manual'
                                    ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-md scale-102'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Package size={14} />
                            <span>Inventario ({selectedIds.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('pdf')}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                activeTab === 'pdf'
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20 scale-102'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400'
                            }`}
                        >
                            <FileText size={14} />
                            <span>Cargar PDF</span>
                            {pdfItems.length > 0 && (
                                <span className="bg-white text-emerald-700 px-1.5 py-0.2 rounded-full text-[9px] font-bold">
                                    {pdfItems.length}
                                </span>
                            )}
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer shrink-0"
                        title="Cerrar [ESC]"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* TAB 1: MANUAL SELECTION MODE */}
            {activeTab === 'manual' && (
                <>
                    {/* Search & Action Bar */}
                    <div className="px-4 sm:px-8 py-3 border-b border-slate-100 dark:border-white/5 bg-slate-50/30 dark:bg-slate-950/20 backdrop-blur-sm shrink-0 flex flex-col sm:flex-row gap-2.5 sm:gap-3 items-center justify-between">
                        <div className="relative group w-full sm:flex-1">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary-500 transition-colors">
                                <Search size={16} strokeWidth={2.5} />
                            </div>
                            <input
                                type="text"
                                placeholder="FILTRAR POR NOMBRE O SKU..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full min-h-[44px] sm:min-h-[38px] pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-base sm:text-[11px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider focus:ring-2 focus:ring-primary-500/30 outline-none transition-all placeholder-slate-400 shadow-inner"
                            />
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end shrink-0 flex-wrap">
                            {onOpenPurchaseOrder && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        onOpenPurchaseOrder(supplier);
                                    }}
                                    className="flex-1 sm:flex-none min-h-[40px] sm:min-h-[36px] flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-md shadow-emerald-600/20 cursor-pointer active:scale-95"
                                    title="Crear orden de compra y enviar por WhatsApp"
                                >
                                    <MessageCircle size={15} />
                                    <span>Hacer Pedido</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setActiveTab('pdf')}
                                className="flex-1 sm:flex-none min-h-[40px] sm:min-h-[36px] flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer active:scale-95"
                            >
                                <FileUp size={15} /> Cargar PDF
                            </button>
                            <div className="flex gap-2">
                                <span className="min-h-[36px] flex items-center text-[9px] font-black text-primary-600 dark:text-primary-400 uppercase tracking-widest bg-primary-50 dark:bg-primary-500/10 px-2.5 py-1 rounded-xl border border-primary-500/20">
                                    {selectedIds.length} VINCULADOS
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Products List */}
                    <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-2 custom-scrollbar bg-slate-50/20 dark:bg-slate-950/10">
                        {loading ? (
                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-50 py-12">
                                <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-primary-500/30 border-t-primary-500"></div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Escaneando Inventario...</span>
                            </div>
                        ) : filteredManualProducts.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center space-y-3 opacity-40 py-12">
                                <div className="p-4 bg-slate-200 dark:bg-slate-800 rounded-xl">
                                    <Package size={32} />
                                </div>
                                <p className="text-xs font-black uppercase tracking-wider text-slate-500 max-w-[240px]">
                                    Sin coincidencias en el catálogo maestro
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2">
                                {filteredManualProducts.map((product) => {
                                    const isSelected = selectedIds.includes(product.id);
                                    return (
                                        <button
                                            key={product.id}
                                            type="button"
                                            onClick={() => toggleProduct(product.id)}
                                            className={`group relative flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 min-h-[52px] rounded-2xl transition-all border text-left overflow-hidden cursor-pointer ${
                                                isSelected 
                                                    ? 'bg-primary-50 dark:bg-primary-500/10 border-primary-500/70 shadow-md shadow-primary-500/10' 
                                                    : 'bg-white dark:bg-slate-900 border-slate-200/60 dark:border-white/5 hover:border-primary-400/40 hover:shadow-md'
                                            }`}
                                        >
                                            <div className={`relative z-10 flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl transition-all ${
                                                isSelected ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                            }`}>
                                                {isSelected ? <CheckCircle2 size={18} strokeWidth={3} /> : <Circle size={18} strokeWidth={2} />}
                                            </div>

                                            <div className="relative z-10 w-10 sm:w-11 h-10 sm:h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex-shrink-0 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-white/5">
                                                {product.imageUri ? (
                                                    <img 
                                                        src={getImageUrl(product.imageUri)} 
                                                        alt={product.name} 
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <Package size={18} className="text-slate-400 opacity-60" />
                                                )}
                                            </div>

                                            <div className="relative z-10 flex-1 min-w-0">
                                                <p className={`text-xs font-black uppercase tracking-tight truncate ${isSelected ? 'text-primary-700 dark:text-primary-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                                    {product.name}
                                                </p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">SKU: {product.barcode || product.sku || '---'}</span>
                                                    {product.supplierId && product.supplierId !== supplier.id && (
                                                        <span className="text-[8px] font-black bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.2 rounded uppercase tracking-wider">
                                                             Otro Prov
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="relative z-10 text-right shrink-0">
                                                <p className="text-sm font-black text-slate-900 dark:text-white tracking-tight tabular-nums">{formatUSD(product.price)}</p>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">P. Venta</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="px-4 sm:px-8 py-3 sm:py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-950/50 backdrop-blur-xl flex flex-col-reverse sm:flex-row justify-between items-center gap-2.5 sm:gap-3 shrink-0">
                        <div className="text-[10px] font-bold text-slate-400 text-center sm:text-left">
                            {selectedIds.length} productos asociados a este proveedor
                        </div>
                        <div className="flex items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 sm:flex-none min-h-[44px] flex items-center justify-center px-5 py-2.5 rounded-xl font-bold text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 uppercase tracking-wider transition-all cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveManual}
                                disabled={processing}
                                className="flex-1 sm:flex-none min-h-[44px] flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-black text-[11px] text-white bg-primary-600 hover:bg-primary-700 shadow-lg shadow-primary-600/25 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 active:scale-95"
                            >
                                {processing ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                                ) : (
                                    <>
                                        <Save size={16} />
                                        <span>Consolidar Catálogo</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* TAB 2: PDF IMPORT MODE */}
            {activeTab === 'pdf' && (
                <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/20 dark:bg-slate-950/10">
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept=".pdf,image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => handlePdfFileSelect(e.target.files?.[0])}
                    />

                    {/* Subheader / Upload status */}
                    <div className="px-4 sm:px-8 py-3 sm:py-3.5 border-b border-slate-100 dark:border-white/5 bg-slate-50/30 dark:bg-slate-950/30 shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 sm:gap-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
                                <FileText size={18} />
                            </div>
                            <div>
                                <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white tracking-wider">
                                    Carga Masiva desde PDF de Proveedor
                                </h3>
                                <p className="text-[10px] text-slate-400 font-medium">
                                    Sube el catálogo de <strong className="text-emerald-600 dark:text-emerald-400">{supplier.name}</strong> para sincronizar con tu inventario.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <button
                                type="button"
                                onClick={() => navigate(`/catalog-importer?supplierId=${supplier.id}`)}
                                className="min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border border-slate-200 dark:border-white/10 cursor-pointer"
                                title="Abrir en el importador avanzado con soporte para escáner y fotos"
                            >
                                <ArrowUpRight size={14} />
                                <span>Importador Avanzado</span>
                            </button>
                        </div>
                    </div>

                    {/* If no PDF is loaded yet: Dropzone */}
                    {pdfItems.length === 0 && !pdfLoading && (
                        <div className="flex-1 p-4 sm:p-8 flex flex-col items-center justify-center">
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setIsDragging(false);
                                    if (e.dataTransfer.files?.[0]) handlePdfFileSelect(e.dataTransfer.files[0]);
                                }}
                                onClick={() => fileInputRef.current?.click()}
                                className={`w-full max-w-lg p-6 sm:p-10 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                                    isDragging 
                                        ? 'border-emerald-500 bg-emerald-500/10' 
                                        : 'border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-slate-50 dark:bg-slate-900'
                                }`}
                            >
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl mb-3 border border-emerald-200 dark:border-emerald-800/40">
                                    <Upload size={28} />
                                </div>
                                <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight mb-1">
                                    Selecciona o Arrastra el Archivo PDF
                                </h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mb-4 font-medium">
                                    Catálogo de productos o lista de precios enviada por {supplier.name}
                                </p>
                                <span className="min-h-[38px] flex items-center justify-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors">
                                    Examinar Documento
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Loading State during PDF parsing */}
                    {pdfLoading && (
                        <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8 gap-4 text-center">
                            <div className="p-5 sm:p-6 bg-emerald-500/10 rounded-full">
                                <div className="animate-spin rounded-full h-10 sm:h-12 w-10 sm:w-12 border-3 border-emerald-500/30 border-t-emerald-500"></div>
                            </div>
                            <div>
                                <h4 className="text-xs sm:text-sm font-black uppercase text-slate-800 dark:text-white tracking-wider">
                                    Verificando productos con tu inventario (BD)...
                                </h4>
                                <p className="text-xs text-slate-400 font-medium mt-1 max-w-sm">
                                    Analizando catálogo de {supplier.name} y seleccionando automáticamente los productos existentes en tu base de datos
                                </p>
                            </div>
                        </div>
                    )}

                    {/* PDF Extracted Results View */}
                    {pdfItems.length > 0 && !pdfLoading && (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            {/* Filter Tabs & Selection Toolbar */}
                            <div className="px-3 sm:px-8 py-2.5 sm:py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-white/5 flex flex-col gap-2.5 sm:gap-3 shrink-0">
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
                                    {/* View Mode Filters */}
                                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-white/5 overflow-x-auto">
                                        <button
                                            type="button"
                                            onClick={() => setPdfFilterTab('matched')}
                                            className={`min-h-[36px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                                                pdfFilterTab === 'matched'
                                                    ? 'bg-emerald-600 text-white shadow-sm'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            <Database size={13} />
                                            <span>En BD ({matchedPdfCount})</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPdfFilterTab('all')}
                                            className={`min-h-[36px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                                                pdfFilterTab === 'all'
                                                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            <Layers size={13} />
                                            <span>Todos ({totalPdfCount})</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPdfFilterTab('new')}
                                            className={`min-h-[36px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                                                pdfFilterTab === 'new'
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            <Plus size={13} />
                                            <span>Nuevos ({newPdfCount})</span>
                                        </button>
                                    </div>

                                    {/* Action Selector Buttons */}
                                    <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
                                        <button
                                            type="button"
                                            onClick={selectOnlyMatchedPdf}
                                            className="min-h-[36px] flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded-lg text-[9.5px] font-black uppercase tracking-wider cursor-pointer"
                                            title="Marcar solo los productos que existen en tu inventario (BD)"
                                        >
                                            <Check size={13} strokeWidth={3} />
                                            <span>Sólo BD</span>
                                        </button>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => toggleSelectAllPdf(true)}
                                                className="min-h-[36px] px-2 py-1 text-[9.5px] font-black uppercase text-slate-600 dark:text-slate-300 hover:text-emerald-500 cursor-pointer flex items-center"
                                            >
                                                Todos
                                            </button>
                                            <span className="text-slate-300 dark:text-slate-700">|</span>
                                            <button
                                                type="button"
                                                onClick={() => toggleSelectAllPdf(false)}
                                                className="min-h-[36px] px-2 py-1 text-[9.5px] font-black uppercase text-slate-400 hover:text-rose-500 cursor-pointer flex items-center"
                                            >
                                                Ninguno
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="min-h-[36px] text-[9.5px] font-black uppercase bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg cursor-pointer flex items-center"
                                        >
                                            Cambiar PDF
                                        </button>
                                    </div>
                                </div>

                                {/* Search Bar inside PDF items */}
                                <div className="relative w-full">
                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder={`BUSCAR EN ${pdfFilterTab === 'matched' ? 'PRODUCTOS COINCIDENTES' : pdfFilterTab === 'new' ? 'PRODUCTOS NUEVOS' : 'TODOS LOS PRODUCTOS DETECTADOS'}...`}
                                        value={pdfSearchTerm}
                                        onChange={(e) => setPdfSearchTerm(e.target.value)}
                                        className="w-full min-h-[40px] pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-base sm:text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-800 dark:text-white"
                                    />
                                </div>
                            </div>

                            {/* Extracted Items List */}
                            <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-2 custom-scrollbar">
                                {filteredPdfItems.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-50">
                                        <Database size={32} className="text-slate-400 mb-2" />
                                        <p className="text-xs font-black uppercase text-slate-500">
                                            {pdfFilterTab === 'matched' 
                                                ? 'No se encontraron coincidencias automáticas en tu base de datos para este filtro.' 
                                                : 'No hay productos que coincidan con la búsqueda.'}
                                        </p>
                                        {pdfFilterTab === 'matched' && newPdfCount > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setPdfFilterTab('all')}
                                                className="mt-3 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline uppercase"
                                            >
                                                Ver todos los {totalPdfCount} productos del PDF
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    filteredPdfItems.map((item) => {
                                        const isMatched = !!item.matchedProduct;
                                        return (
                                            <div
                                                key={item.id}
                                                className={`flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-2xl transition-all border text-left ${
                                                    item.selected
                                                        ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm'
                                                        : 'bg-white dark:bg-slate-900 border-slate-200/50 dark:border-white/5 opacity-60 hover:opacity-100'
                                                }`}
                                            >
                                                {/* Checkbox */}
                                                <button
                                                    type="button"
                                                    onClick={() => togglePdfItem(item.id)}
                                                    className={`min-w-[36px] min-h-[36px] w-9 h-9 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                                                        item.selected ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                                                    }`}
                                                >
                                                    {item.selected ? <CheckSquare size={18} /> : <Square size={18} />}
                                                </button>

                                                {/* Item Details */}
                                                <div 
                                                    onClick={() => togglePdfItem(item.id)}
                                                    className="flex-1 min-w-0 cursor-pointer"
                                                >
                                                    <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">
                                                        {item.externalName}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                        {isMatched ? (
                                                            <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/30">
                                                                <Database size={10} />
                                                                <span>En tu BD: {item.matchedProduct.name}</span>
                                                                {item.matchedProduct.currentCost > 0 && (
                                                                    <span className="opacity-75 font-normal">
                                                                        (Costo actual: ${Number(item.matchedProduct.currentCost).toFixed(2)})
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-500 dark:text-slate-400 bg-slate-200/60 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                                                                <AlertCircle size={10} />
                                                                <span>No está en tu BD (desmarcado)</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Action: Link manually with BD Product */}
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setManualLinkTargetItem(item);
                                                        setManualLinkSearch('');
                                                    }}
                                                    className="min-h-[36px] px-2.5 py-1.5 text-[9.5px] font-bold text-slate-500 dark:text-slate-400 hover:text-primary-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                                                    title="Vincular o cambiar el producto asociado de tu BD"
                                                >
                                                    <Link2 size={13} />
                                                    <span className="hidden sm:inline">{isMatched ? 'Cambiar BD' : 'Vincular BD'}</span>
                                                </button>

                                                {/* Price */}
                                                <div 
                                                    onClick={() => togglePdfItem(item.id)}
                                                    className="text-right shrink-0 cursor-pointer"
                                                >
                                                    <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        ${Number(item.price || 0).toFixed(2)}
                                                    </p>
                                                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Costo PDF</p>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* PDF Footer Actions */}
                            <div className="px-4 sm:px-8 py-3 sm:py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-950/50 backdrop-blur-xl flex flex-col-reverse sm:flex-row justify-between items-center gap-2.5 sm:gap-3 shrink-0">
                                <div className="flex flex-col text-[10px] text-center sm:text-left">
                                    <span className="font-black uppercase text-emerald-600 dark:text-emerald-400">
                                        {selectedPdfCount} seleccionados ({selectedMatchedCount} existentes en tu BD)
                                    </span>
                                    <span className="text-[9px] text-slate-400">
                                        Se actualizarán costos y vincularán únicamente los seleccionados al proveedor
                                    </span>
                                </div>

                                <div className="flex items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
                                    <button
                                        type="button"
                                        onClick={() => setPdfItems([])}
                                        className="flex-1 sm:flex-none min-h-[44px] flex items-center justify-center px-4 py-2.5 rounded-xl font-bold text-[11px] text-slate-400 hover:text-slate-600 uppercase tracking-wider cursor-pointer"
                                    >
                                        Descartar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleApplyPdfMapping}
                                        disabled={pdfSaving || selectedPdfCount === 0}
                                        className="flex-1 sm:flex-none min-h-[44px] flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-black text-[11px] text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/25 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 active:scale-95"
                                    >
                                        {pdfSaving ? (
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                                        ) : (
                                            <>
                                                <Plus size={16} />
                                                <span>Incorporar {selectedPdfCount} Productos</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MODAL / OVERLAY TO MANUALLY LINK WITH A DB PRODUCT */}
            {manualLinkTargetItem && (
                <div className="absolute inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-3 sm:p-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] pb-safe">
                        {/* Modal Header */}
                        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                            <div className="min-w-0">
                                <h3 className="text-xs sm:text-sm font-black uppercase text-slate-800 dark:text-white truncate">
                                    Vincular con Producto de Inventario
                                </h3>
                                <p className="text-[10px] text-slate-400 truncate max-w-xs sm:max-w-sm">
                                    Línea PDF: <strong className="text-emerald-500">{manualLinkTargetItem.externalName}</strong>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setManualLinkTargetItem(null)}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer shrink-0"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Search Input */}
                        <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-950/30">
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="BUSCAR EN TU BASE DE DATOS..."
                                    value={manualLinkSearch}
                                    onChange={(e) => setManualLinkSearch(e.target.value)}
                                    autoFocus
                                    className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-base sm:text-xs font-black uppercase outline-none focus:ring-2 focus:ring-primary-500/30 text-slate-800 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* Product Selection List */}
                        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5 custom-scrollbar">
                            {manualLinkCandidates.length === 0 ? (
                                <div className="text-center py-8 text-xs text-slate-400 font-bold">
                                    No se encontraron productos en tu base de datos con ese criterio
                                </div>
                            ) : (
                                manualLinkCandidates.map((dbProd) => (
                                    <button
                                        key={dbProd.id}
                                        type="button"
                                        onClick={() => handleManualLinkProduct(manualLinkTargetItem, dbProd)}
                                        className="w-full min-h-[48px] flex items-center justify-between p-2.5 sm:p-3 rounded-xl hover:bg-emerald-500/10 border border-slate-100 dark:border-white/5 hover:border-emerald-500/30 transition-all text-left group cursor-pointer"
                                    >
                                        <div className="flex-1 min-w-0 pr-2">
                                            <p className="text-xs font-black text-slate-800 dark:text-white group-hover:text-emerald-600 uppercase truncate">
                                                {dbProd.name}
                                            </p>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase">
                                                SKU: {dbProd.barcode || dbProd.sku || '---'} • Costo actual: {formatUSD(dbProd.cost)}
                                            </span>
                                        </div>
                                        <span className="min-h-[32px] flex items-center text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase bg-emerald-500/10 px-2.5 py-1 rounded-lg shrink-0">
                                            Vincular
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-4 sm:px-6 py-3 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-950/50 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setManualLinkTargetItem(null)}
                                className="min-h-[44px] px-5 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase cursor-pointer"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </BaseModal>
    );
}
