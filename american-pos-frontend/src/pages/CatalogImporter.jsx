import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Upload,
    FileText,
    CheckCircle2,
    AlertCircle,
    Search,
    ArrowRight,
    FileSpreadsheet,
    Loader2,
    Save,
    X,
    Plus,
    Image as ImageIcon,
    Percent,
    Printer,
    Camera,
    Eye,
    Calendar,
    RefreshCw,
    Info,
    Receipt,
    BookOpen,
    CreditCard,
    CheckCheck,
    ShieldCheck,
    History
} from 'lucide-react';
import api from '../services/api';
import PrinterScanModal from '../components/PrinterScanModal';
import CameraScanModal from '../components/CameraScanModal';
import InvoiceViewerModal from '../components/InvoiceViewerModal';
import InvoiceSettlementModal from '../components/InvoiceSettlementModal';
import ImportedInvoicesDrawer from '../components/ImportedInvoicesDrawer';
import toast from 'react-hot-toast';
import { normalizeProductImage } from '../utils/imageProcess';

// --- UTILIDADES MATEMÁTICAS DE ALTA PRECISIÓN ---

const roundExact = (val, decimals = 6) => {
    const num = Number(val);
    if (isNaN(num) || !isFinite(num)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
};

const formatSmartUsd = (val) => {
    const num = Number(val || 0);
    if (isNaN(num) || !isFinite(num)) return '0.00';
    const abs = Math.abs(num);
    if (abs > 0 && abs < 0.1) {
        return num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00').padEnd(4, '0');
    }
    return num.toFixed(2);
};

const formatBs = (val) => {
    const num = Number(val || 0);
    if (isNaN(num) || !isFinite(num)) return '0,00';
    return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const computeUnitCostExact = (bulkPrice, unitsPerBulk) => {
    const safeBulk = Math.max(0, Number(bulkPrice || 0));
    const safeUnits = Math.max(1, Number(unitsPerBulk || 1));
    return roundExact(safeBulk / safeUnits, 6);
};

const computeSalesPriceExact = (bulkPrice, unitsPerBulk, margin, manualPvp = null) => {
    if (manualPvp !== null && manualPvp !== undefined && Number(manualPvp) > 0) {
        const explicit = Number(manualPvp);
        return explicit < 0.1 ? roundExact(explicit, 4) : roundExact(explicit, 2);
    }
    const unitCost = computeUnitCostExact(bulkPrice, unitsPerBulk);
    const safeMargin = Number(margin || 0);
    const rawPvp = unitCost * (1 + safeMargin / 100);
    if (rawPvp <= 0) return 0;
    return rawPvp < 0.1 ? roundExact(rawPvp, 4) : roundExact(rawPvp, 2);
};

const isItemReadyToSave = (item) => Boolean(item.isNew || (item.approved && item.matchedProduct));

const getLocalDateISO = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getConfiguredIvaPct = () => {
    try {
        const raw = localStorage.getItem('pos_business_settings');
        const parsed = raw ? JSON.parse(raw) : {};
        const val = Number(parsed?.ivaRate ?? parsed?.taxRate ?? 16);
        return val > 0 ? val : 16;
    } catch (_) {
        return 16;
    }
};

// --- COMPONENTES AUXILIARES ---

const ProductSearcher = ({ onSelect, currentProduct }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [searchError, setSearchError] = useState('');
    const wrapperRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setResults([]);
            setSearchError('');
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearching(true);
            setSearchError('');
            try {
                const { data } = await api.get(`/products/search-for-link?search=${encodeURIComponent(trimmed)}`);
                setResults(Array.isArray(data) ? data : []);
            } catch (err) {
                setResults([]);
                setSearchError(err.response?.data?.error || 'Error buscando en inventario');
            } finally {
                setIsSearching(false);
            }
        }, 260);
        return () => clearTimeout(timer);
    }, [query]);

    if (currentProduct) {
        const refCost = Number(currentProduct.currentCost ?? currentProduct.cost ?? 0);
        return (
            <div className="flex items-center justify-between gap-2 p-2 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-xl border border-emerald-500/30">
                <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 uppercase truncate" title={currentProduct.name}>
                        {currentProduct.name}
                    </span>
                    <span className="text-[9px] font-bold text-emerald-600/80 dark:text-emerald-400/80 tabular-nums mt-0.5">
                        Costo actual: ${formatSmartUsd(refCost)}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => onSelect(null)}
                    className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:text-red-500 hover:bg-white dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer shrink-0"
                    title="Desvincular producto"
                >
                    <X size={12} />
                </button>
            </div>
        );
    }

    return (
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" size={14} />
                <input
                    type="text"
                    placeholder="BUSCAR EN INVENTARIO..."
                    className="w-full min-h-[40px] sm:min-h-[34px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl pl-8 pr-7 text-xs font-black text-slate-800 dark:text-white uppercase outline-none focus:ring-2 focus:ring-primary-500"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                />
                {isSearching && (
                    <Loader2 size={13} className="animate-spin text-primary-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
                )}
            </div>

            {isOpen && query.trim().length >= 2 && (
                <div className="absolute z-50 left-0 right-0 top-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl max-h-52 overflow-y-auto no-scrollbar">
                    {searchError ? (
                        <div className="p-2.5 text-[10px] font-bold text-rose-500 text-center">{searchError}</div>
                    ) : results.length > 0 ? (
                        results.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                    onSelect(p);
                                    setIsOpen(false);
                                    setQuery('');
                                }}
                                className="w-full p-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-white/5 transition-colors flex items-center justify-between group cursor-pointer"
                            >
                                <div className="min-w-0 pr-2">
                                    <span className="text-[11px] font-black text-slate-800 dark:text-white uppercase block leading-tight group-hover:text-primary-500 truncate">
                                        {p.name}
                                    </span>
                                    <span className="text-[9px] font-bold text-slate-500 uppercase">
                                        Costo: ${formatSmartUsd(p.currentCost ?? p.cost ?? 0)} • Stock: {Number(p.stockQuantity || 0)}
                                    </span>
                                </div>
                                <ArrowRight size={12} className="text-slate-400 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                            </button>
                        ))
                    ) : !isSearching ? (
                        <div className="p-2.5 text-[10px] font-semibold text-slate-400 text-center uppercase">
                            Sin coincidencias para &quot;{query.trim()}&quot;
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
};

const MobileCatalogItemCard = ({
    item,
    realIndex,
    importMode,
    docCurrency,
    posRate,
    toggleItemTax,
    updateItemProperty,
    handleManualCostChange,
    handleManualPvpChange,
    openAiImageSearch
}) => {
    const isItemExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
    const unitCost = computeUnitCostExact(item.price, item.quantity);
    const suggestedPvp = computeSalesPriceExact(item.price, item.quantity, item.margin, item.manualPvp);
    const isReady = isItemReadyToSave(item);

    return (
        <div className={`p-4 rounded-2xl border transition-all space-y-3 shadow-sm touch-pan-y ${
            !item.matchedProduct && !item.isNew
                ? 'bg-amber-500/[0.04] border-amber-500/30'
                : isReady
                ? 'bg-white dark:bg-slate-900 border-emerald-500/30'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10'
        }`}>
            {/* Top Row: Product Name & Status */}
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <span className="text-xs font-black text-slate-900 dark:text-white uppercase leading-snug block">
                        {item.externalName}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {item.isNew ? (
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                                Nuevo en Catálogo
                            </span>
                        ) : item.matchedProduct ? (
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 truncate max-w-[200px]">
                                {item.approved ? 'Confirmado' : 'Sugerido'}: {item.matchedProduct.name}
                            </span>
                        ) : (
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                Sin Coincidencia
                            </span>
                        )}
                    </div>
                </div>

                <div className="shrink-0 flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => {
                            if (item.isNew) {
                                updateItemProperty(realIndex, 'isNew', false);
                            } else if (item.matchedProduct) {
                                updateItemProperty(realIndex, 'approved', !item.approved);
                            } else {
                                toast('Vincula un producto del inventario o márcalo como Nuevo', { icon: 'ℹ️' });
                            }
                        }}
                        className={`p-2 rounded-xl border transition-all cursor-pointer active:scale-95 ${
                            isReady
                                ? 'bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-500/20'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}
                        title={isReady ? 'Aprobado para guardar' : 'Toca para aprobar vinculación'}
                    >
                        <CheckCircle2 size={16} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Financial Grid */}
            <div className="grid grid-cols-2 gap-2.5 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60 text-xs">
                <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Costo Empaque ($):</span>
                    <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={roundExact(item.price, 4)}
                        onChange={(e) => handleManualCostChange(realIndex, e.target.value)}
                        className="w-24 min-h-[36px] mt-0.5 px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono font-black text-xs text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    {docCurrency === 'BS' && item.rawPriceBs > 0 && (
                        <span className="text-[9px] font-mono text-slate-500 block mt-0.5">
                            Bs. {formatBs(item.rawPriceBs)}
                        </span>
                    )}
                </div>

                <div>
                    <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider block">Costo Unitario:</span>
                    <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 block mt-1">
                        ${formatSmartUsd(unitCost)} USD
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono block">
                        ({item.quantity || 1} un/empaque)
                    </span>
                </div>

                <div>
                    <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider block">Margen (%):</span>
                    <div className="flex items-center gap-1 mt-0.5">
                        <input
                            type="number"
                            value={item.margin}
                            onChange={(e) => updateItemProperty(realIndex, 'margin', parseFloat(e.target.value) || 0)}
                            className="w-20 min-h-[36px] px-2 bg-white dark:bg-slate-900 border border-amber-500/40 rounded-lg text-xs font-mono font-black text-amber-600 dark:text-amber-400 outline-none"
                            step="0.5"
                        />
                        <span className="text-[10px] font-black text-amber-500">%</span>
                    </div>
                </div>

                <div>
                    <span className="text-[9px] font-bold text-primary-500 uppercase tracking-wider block">PVP Venta ($):</span>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={suggestedPvp}
                        onChange={(e) => handleManualPvpChange(realIndex, e.target.value)}
                        className="w-24 min-h-[36px] mt-0.5 px-2 bg-white dark:bg-slate-900 border border-primary-500/40 rounded-lg font-mono font-black text-xs text-primary-600 dark:text-primary-400 outline-none"
                    />
                    {posRate > 1 && (
                        <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                            PVP Hoy ≈ Bs. {formatBs(suggestedPvp * posRate)}
                        </span>
                    )}
                </div>
            </div>

            {/* Units & Tax & Stock Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                    type="button"
                    onClick={() => toggleItemTax(realIndex)}
                    className={`px-3 py-1.5 min-h-[36px] rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                        isItemExempt
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20'
                    }`}
                >
                    <span className="flex items-center justify-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${isItemExempt ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                        <span>{isItemExempt ? 'Exento (0%)' : '16% IVA'}</span>
                    </span>
                </button>

                {importMode === 'INVOICE' && (
                    <div className="flex items-center gap-1 text-[10px]">
                        <span className="font-bold text-slate-400 uppercase">Cant:</span>
                        <input
                            type="number"
                            value={item.purchasedQuantity ?? 1}
                            onChange={(e) => updateItemProperty(realIndex, 'purchasedQuantity', Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-14 min-h-[36px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-mono font-black text-xs outline-none"
                            min="0"
                            step="1"
                        />
                    </div>
                )}

                <div className="flex items-center gap-1 text-[10px]">
                    <span className="font-bold text-slate-400 uppercase">Un/Bulto:</span>
                    <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItemProperty(realIndex, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-14 min-h-[36px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-mono font-black text-xs outline-none"
                        min="1"
                    />
                </div>

                {importMode === 'INVOICE' && (
                    <div className="flex items-center gap-1 text-[10px]">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 uppercase">Stock +:</span>
                        <input
                            type="number"
                            value={item.stock || 0}
                            onChange={(e) => updateItemProperty(realIndex, 'stock', Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-16 min-h-[36px] bg-emerald-500/5 dark:bg-slate-900 border border-emerald-500/30 rounded-lg text-center font-mono font-black text-xs text-emerald-700 dark:text-emerald-300 outline-none"
                            min="0"
                        />
                    </div>
                )}

                <div className="flex items-center gap-1">
                    {item.image && (
                        <img
                            src={item.image.startsWith('http') ? item.image : `${api.defaults.baseURL || ''}${item.image.startsWith('/') ? '' : '/'}${item.image}`}
                            className="w-7 h-7 rounded-lg object-cover ring-1 ring-primary-500 shadow-sm"
                            alt=""
                        />
                    )}
                    <button
                        type="button"
                        onClick={() => openAiImageSearch(realIndex, item)}
                        className="p-1.5 bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 rounded-lg text-xs hover:bg-sky-500/20 transition-all cursor-pointer"
                        title="Buscar Imagen del Producto"
                    >
                        <Search size={14} />
                    </button>
                </div>
            </div>

            {/* Local Match / Linker Section */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                {item.isNew ? (
                    <div className="flex items-center justify-between p-2 bg-primary-500/10 rounded-xl border border-primary-500/30">
                        <span className="text-[10px] font-black text-primary-600 dark:text-primary-400 uppercase">Se creará como Producto Nuevo</span>
                        <button
                            type="button"
                            onClick={() => updateItemProperty(realIndex, 'isNew', false)}
                            className="p-1 text-primary-500 hover:text-red-500 rounded-lg cursor-pointer"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        <ProductSearcher
                            currentProduct={item.matchedProduct}
                            onSelect={(prod) => updateItemProperty(realIndex, 'matchedProduct', prod)}
                        />
                        {!item.matchedProduct && (
                            <button
                                type="button"
                                onClick={() => updateItemProperty(realIndex, 'isNew', true)}
                                className="text-[10px] font-black text-primary-500 hover:text-primary-600 uppercase tracking-wider flex items-center gap-1 cursor-pointer pt-1"
                            >
                                <Plus size={12} /> Crear como Producto Nuevo
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default function CatalogImporter() {
    const [searchParams] = useSearchParams();
    const urlSupplierId = searchParams.get('supplierId') || '';

    // Estados de carga y modo de operación
    const [importMode, setImportMode] = useState('INVOICE'); // 'INVOICE' (Factura/Compra) | 'CATALOG' (Solo Costos)
    const [file, setFile] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [items, setItems] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [selectedSupplierId, setSelectedSupplierId] = useState(urlSupplierId);
    const [detectedSupplierLabel, setDetectedSupplierLabel] = useState('');
    const [detectedSupplierRif, setDetectedSupplierRif] = useState('');
    const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [filterQuery, setFilterQuery] = useState('');

    const ivaPct = useMemo(() => getConfiguredIvaPct(), []);
    const ivaMultiplier = useMemo(() => 1 + (ivaPct / 100), [ivaPct]);

    // Metadatos fiscales y tasas
    const [docCurrency, setDocCurrency] = useState('USD');
    const [systemRate, setSystemRate] = useState(1);
    const [rateInput, setRateInput] = useState('1');
    const [posRate, setPosRate] = useState(1);
    const [invoiceDate, setInvoiceDate] = useState('');
    const [referenceNumber, setReferenceNumber] = useState('');
    const [paymentStatus, setPaymentStatus] = useState('paid'); // 'paid' | 'unpaid'
    const [dueDate, setDueDate] = useState('');
    const [rateSource, setRateSource] = useState('BCV');
    const [isLookingUpRate, setIsLookingUpRate] = useState(false);
    const [docTotals, setDocTotals] = useState({ subtotal: null, tax: null, total: null });

    // Herramientas masivas e imágenes
    const [globalMargin, setGlobalMargin] = useState('30');
    const [aiSearchItem, setAiSearchItem] = useState(null);
    const [aiSearchIndex, setAiSearchIndex] = useState(-1);
    const [customImageQuery, setCustomImageQuery] = useState('');
    const [candidateImages, setCandidateImages] = useState([]);
    const [isSearchingImages, setIsSearchingImages] = useState(false);
    const [isBulkSearchingImages, setIsBulkSearchingImages] = useState(false);
    const [isScanningPrinter, setIsScanningPrinter] = useState(false);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [showPrinterModal, setShowPrinterModal] = useState(false);
    const [invoiceUrl, setInvoiceUrl] = useState('');
    const [showInvoiceViewer, setShowInvoiceViewer] = useState(false);
    const [previewProductImage, setPreviewProductImage] = useState(null);
    const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

    const handleViewInvoiceFromHistory = (url) => {
        setInvoiceUrl(url);
        setShowInvoiceViewer(true);
    };

    const handleLoadInvoiceIntoImporter = async (historyInvoice) => {
        setIsHistoryDrawerOpen(false);
        if (!historyInvoice.invoiceUrl) {
            toast.error('Esta factura no tiene archivo digitalizado adjunto');
            return;
        }
        setInvoiceUrl(historyInvoice.invoiceUrl);
        setReferenceNumber(historyInvoice.referenceNumber || '');
        if (historyInvoice.supplierId) {
            setSelectedSupplierId(String(historyInvoice.supplierId));
        }
        const toastId = toast.loading('Cargando factura para revisión y auditoría...', { duration: 60000 });
        try {
            const { data } = await api.post('/products/reparse-invoice', {
                invoiceUrl: historyInvoice.invoiceUrl,
                supplierId: historyInvoice.supplierId
            }, { timeout: 180000 });
            const success = applyExtractedCatalogData(data);
            if (success) {
                toast.success(`Factura #${historyInvoice.referenceNumber} cargada con ${data.items?.length || 0} renglones`, { id: toastId });
            } else {
                toast.error('No se pudieron extraer renglones de la factura', { id: toastId });
            }
        } catch (err) {
            console.error('Error re-procesando factura de historial:', err);
            toast.error(err.response?.data?.error || 'Error al re-procesar factura', { id: toastId });
        }
    };

    useEffect(() => {
        const fetchSuppliers = async () => {
            try {
                const { data } = await api.get('/suppliers');
                setSuppliers(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Error fetching suppliers:', error);
            }
        };
        fetchSuppliers();
    }, []);

    const detectUnitsFromName = (name) => {
        if (!name) return 1;
        const patterns = [
            /\b\d{1,2}\s*[xX]\s*(\d{1,4})\b/,
            /\b(\d{1,4})\s*uni(?:d|dades)?\b/i,
            /\b(\d{1,4})\s*und\b/i,
            /\bcaja\s*(?:de\s*|x\s*)?(\d{1,4})\b/i,
            /\bbulto\s*(?:de\s*|x\s*)?(\d{1,4})\b/i,
            /\bdisplay\s*(?:de\s*|x\s*)?(\d{1,4})\b/i
        ];
        for (const pattern of patterns) {
            const match = name.match(pattern);
            if (match && match[1]) {
                const val = parseInt(match[1], 10);
                if (val > 1 && val < 2000) return val;
            }
        }
        return 1;
    };

    /**
     * Recalcula sincronizadamente basePrice, basePriceBs, price y rawPriceBs
     * ante cambios de Tasa BCV o cambio de Moneda del documento, sin deriva de redondeo.
     */
    const recalculateItemsCurrencyAndRate = (targetCurrency, targetRate) => {
        const safeRate = targetRate && targetRate > 0 ? Number(targetRate) : 1;
        setItems(prevItems => prevItems.map(item => {
            const isExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
            const multiplier = isExempt ? 1 : (1 + ((Number(item.taxRate) > 0 ? Number(item.taxRate) : ivaPct) / 100));

            // docRawBase conserva el número base original impreso en el documento
            const nominalBase = item.docRawBase !== undefined && item.docRawBase > 0
                ? Number(item.docRawBase)
                : (targetCurrency === 'BS' ? Number(item.basePriceBs || 0) : Number(item.basePrice || 0));

            let baseBs;
            let baseUsd;
            let priceBs;
            let priceUsd;

            if (targetCurrency === 'BS') {
                baseBs = roundExact(nominalBase, 2);
                baseUsd = roundExact(baseBs / safeRate, 6);
                priceBs = roundExact(baseBs * multiplier, 2);
                priceUsd = roundExact(priceBs / safeRate, 6);
            } else {
                baseUsd = roundExact(nominalBase, 6);
                baseBs = roundExact(baseUsd * safeRate, 2);
                priceUsd = roundExact(baseUsd * multiplier, 6);
                priceBs = roundExact(priceUsd * safeRate, 2);
            }

            return {
                ...item,
                basePriceBs: baseBs,
                basePrice: baseUsd,
                rawPriceBs: priceBs,
                price: priceUsd,
                taxAdded: !isExempt
            };
        }));
    };

    const handleCurrencySwitch = async (nextCurrency) => {
        const normalized = nextCurrency === 'BS' ? 'BS' : 'USD';
        if (normalized === docCurrency) return;
        setDocCurrency(normalized);

        let activeRate = systemRate;
        if (normalized === 'BS' && (!activeRate || activeRate <= 1)) {
            if (posRate > 1) {
                activeRate = posRate;
                setSystemRate(activeRate);
                setRateInput(String(activeRate));
            } else {
                try {
                    const { data } = await api.get(`/suppliers/bcv-rate${invoiceDate ? `?date=${invoiceDate}` : ''}`);
                    if (data?.rate > 0) {
                        activeRate = Number(data.rate);
                        setSystemRate(activeRate);
                        setRateInput(String(activeRate));
                        setRateSource(data.source || 'BCV');
                    }
                } catch (rateErr) {
                    console.warn('[CatalogImporter] No se pudo consultar tasa BCV al cambiar moneda:', rateErr);
                }
            }
        }

        recalculateItemsCurrencyAndRate(normalized, activeRate);
        toast.success(
            normalized === 'BS'
                ? `Moneda cambiada a Bolívares (Tasa: Bs. ${formatBs(activeRate)} / $)`
                : 'Moneda cambiada a Dólares (USD)'
        );
    };

    const handleDateRateLookup = async (newDate) => {
        setInvoiceDate(newDate);
        if (!newDate || docCurrency !== 'BS') return;

        setIsLookingUpRate(true);
        const toastId = toast.loading(`Consultando tasa oficial BCV del ${newDate}...`);
        try {
            const { data } = await api.get(`/suppliers/bcv-rate?date=${newDate}`);
            if (data?.rate && data.rate > 0) {
                const newRate = Number(data.rate);
                setSystemRate(newRate);
                setRateInput(String(newRate));
                setRateSource(data.source || 'BCV');
                recalculateItemsCurrencyAndRate('BS', newRate);
                toast.success(`Tasa BCV del ${newDate} aplicada: Bs. ${newRate.toFixed(4)} / $`, { id: toastId });
            } else {
                toast.error('No se encontró tasa oficial para esa fecha', { id: toastId });
            }
        } catch (_err) {
            toast.error('Error al consultar tasa BCV de esa fecha', { id: toastId });
        } finally {
            setIsLookingUpRate(false);
        }
    };

    const handleManualRateInputChange = (rawVal) => {
        setRateInput(rawVal);
        const normalized = String(rawVal).replace(',', '.');
        const parsed = parseFloat(normalized);
        if (!isNaN(parsed) && parsed > 0) {
            setSystemRate(parsed);
            setRateSource('MANUAL');
            recalculateItemsCurrencyAndRate(docCurrency, parsed);
        }
    };

    const handleSwitchImportMode = (nextMode) => {
        setImportMode(nextMode);
        setItems(prev => prev.map(item => {
            if (nextMode === 'CATALOG') {
                return { ...item, stock: 0 };
            }
            const packs = Math.max(0, Number(item.purchasedQuantity ?? 1));
            const units = Math.max(1, Number(item.quantity || 1));
            const computedStock = packs > 0 ? roundExact(packs * units, 4) : 0;
            return {
                ...item,
                purchasedQuantity: packs > 0 ? packs : 1,
                stock: item.stock > 0 ? item.stock : (packs > 0 ? computedStock : units)
            };
        }));
    };

    const applyExtractedCatalogData = (data) => {
        const rawList = (Array.isArray(data?.items) && data.items.length > 0)
            ? data.items
            : ((Array.isArray(data?.rawItems) && data.rawItems.length > 0)
                ? data.rawItems
                : ((Array.isArray(data?.items?.items) && data.items.items.length > 0)
                    ? data.items.items
                    : (Array.isArray(data) ? data : [])));

        if (data?.invoiceUrl) {
            setInvoiceUrl(data.invoiceUrl);
        }

        if (rawList.length === 0) {
            return false;
        }

        const currency = (data?.currency || data?.items?.currency || 'USD').toUpperCase() === 'BS' ? 'BS' : 'USD';
        const rate = Number(data?.rate || data?.posExchangeRate || 1) || 1;
        const activePosRate = Number(data?.posExchangeRate || rate || 1) || 1;
        const invDate = data?.invoiceDate || getLocalDateISO();
        const src = data?.rateSource || 'BCV';
        const detectedMode = String(data?.documentType || '').toUpperCase() === 'CATALOG' ? 'CATALOG' : importMode;

        setDocCurrency(currency);
        setSystemRate(rate);
        setRateInput(String(roundExact(rate, 4)));
        setPosRate(activePosRate);
        setInvoiceDate(invDate);
        setRateSource(src);
        setImportMode(detectedMode);
        setReferenceNumber(data?.referenceNumber || '');
        setDocTotals({
            subtotal: data?.docSubtotal != null ? Number(data.docSubtotal) : null,
            tax: data?.docTaxAmount != null ? Number(data.docTaxAmount) : null,
            total: data?.docTotal != null ? Number(data.docTotal) : null
        });

        if (!selectedSupplierId && data?.detectedSupplierId) {
            setSelectedSupplierId(String(data.detectedSupplierId));
        }
        setDetectedSupplierLabel(data?.detectedSupplierName || '');
        setDetectedSupplierRif(data?.detectedSupplierRif || data?.supplierRif || '');

        const nowSeed = Date.now();
        setItems(rawList.map((item, idx) => {
            const inventoryBulk = Number(item.matchedProduct?.unitsPerBulk || 1);
            const suggestedBulk = Number(item.suggestedQuantity || 1);
            const nameDetectedBulk = detectUnitsFromName(item.externalName);
            const inventoryMargin = Number(item.matchedProduct?.margin || 0);

            const isExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
            const multiplier = isExempt ? 1 : (1 + ((Number(item.taxRate) > 0 ? Number(item.taxRate) : ivaPct) / 100));

            const baseBs = Number(
                item.basePriceBs !== undefined && item.basePriceBs !== null
                    ? item.basePriceBs
                    : (item.rawPriceBs || (currency === 'BS' ? Number(item.price || 0) * rate : Number(item.price || 0) * rate))
            );
            const baseUsd = Number(
                item.basePrice !== undefined && item.basePrice !== null
                    ? item.basePrice
                    : (rate > 0 ? baseBs / rate : Number(item.price || 0))
            );

            const docRawBase = currency === 'BS' ? roundExact(baseBs, 4) : roundExact(baseUsd, 6);
            const initialPriceBs = roundExact(baseBs * multiplier, 2);
            const initialPriceUsd = currency === 'BS'
                ? (rate > 0 ? roundExact(initialPriceBs / rate, 6) : roundExact(baseUsd * multiplier, 6))
                : roundExact(baseUsd * multiplier, 6);

            let finalQuantity = suggestedBulk > 1
                ? suggestedBulk
                : (nameDetectedBulk > 1 ? nameDetectedBulk : (detectedMode === 'CATALOG' && inventoryBulk > 1 ? inventoryBulk : 1));

            // Conciliación inteligente con el costo actual del producto vinculado en inventario:
            // Si el precio en la factura ya es el costo de 1 unidad individual (cercano a refCost),
            // evitamos dividir erróneamente entre el tamaño del bulto; y si vino el precio del bulto completo, aplicamos inventoryBulk.
            const refCost = Number(item.matchedProduct?.currentCost ?? item.matchedProduct?.cost ?? 0);
            if (refCost > 0 && initialPriceUsd > 0) {
                if (finalQuantity > 1 && nameDetectedBulk <= 1) {
                    const diffAsUnit = Math.abs(initialPriceUsd - refCost);
                    const diffAsBulk = Math.abs((initialPriceUsd / finalQuantity) - refCost);
                    if (diffAsUnit < diffAsBulk && initialPriceUsd <= refCost * 2.2) {
                        finalQuantity = 1;
                    }
                } else if (finalQuantity === 1 && inventoryBulk > 1) {
                    const diffAsUnit = Math.abs(initialPriceUsd - refCost);
                    const diffAsBulk = Math.abs((initialPriceUsd / inventoryBulk) - refCost);
                    if (diffAsBulk < diffAsUnit * 0.35) {
                        finalQuantity = inventoryBulk;
                    }
                }
            }

            const rawPurchasedQty = item.purchasedQuantity !== undefined && item.purchasedQuantity !== null
                ? Number(item.purchasedQuantity)
                : (detectedMode === 'INVOICE' ? 1 : 0);
            const purchasedQuantity = detectedMode === 'CATALOG' ? 0 : Math.max(0, rawPurchasedQty);
            const autoStock = detectedMode === 'INVOICE' && purchasedQuantity > 0
                ? roundExact(purchasedQuantity * finalQuantity, 4)
                : 0;

            const hasHighConfidenceMatch = Boolean(item.matchedProduct && Number(item.confidence || 0) >= 92);

            return {
                ...item,
                _rowId: `imp_row_${nowSeed}_${idx}`,
                docRawBase,
                basePriceBs: roundExact(baseBs, 2),
                basePrice: roundExact(baseUsd, 6),
                taxAdded: !isExempt,
                price: initialPriceUsd,
                rawPriceBs: initialPriceBs,
                isExempt,
                taxRate: isExempt ? 0 : 16,
                taxStatus: isExempt ? 'exento' : 'gravable',
                purchasedQuantity,
                quantity: finalQuantity,
                margin: inventoryMargin > 0 ? roundExact(inventoryMargin, 2) : 30,
                manualPvp: null,
                approved: hasHighConfidenceMatch,
                isNew: false,
                stock: autoStock,
                stockManuallyEdited: false,
                image: null
            };
        }));

        return true;
    };

    const handleReparseCurrentInvoice = async () => {
        if (!invoiceUrl) {
            toast.error('No hay ninguna factura digitalizada abierta');
            return;
        }
        setIsLoading(true);
        const toastId = toast.loading('Extrayendo renglones y precios con Inteligencia Artificial...');
        try {
            const { data } = await api.post('/products/reparse-invoice', {
                invoiceUrl,
                supplierId: selectedSupplierId || null
            }, {
                timeout: 180000
            });

            const success = applyExtractedCatalogData(data);
            if (success) {
                const count = Array.isArray(data?.items) ? data.items.length : (Array.isArray(data?.rawItems) ? data.rawItems.length : 0);
                toast.success(`¡Éxito! ${count} renglones extraídos (Tasa: Bs. ${Number(data?.rate || 1).toFixed(2)})`, { id: toastId });
                setShowInvoiceViewer(false);
            } else {
                toast.error('No se pudieron detectar productos en la factura', { id: toastId });
            }
        } catch (err) {
            console.error('Error re-procesando factura:', err);
            const msg = err.response?.data?.error || err.message || 'Error al extraer renglones';
            toast.error(msg, { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };

    const handleExecuteScan = async ({ deviceId, dpi, colorMode }) => {
        setIsScanningPrinter(true);
        const scanMsg = Number(dpi) >= 600
            ? 'Escaneando en 600 DPI (alta definición)... Puede tomar cerca de 1 minuto.'
            : 'Adquiriendo imagen desde el escáner y procesando con IA...';
        const toastId = toast.loading(scanMsg);
        try {
            const { data } = await api.post('/products/scan-from-printer', {
                deviceId,
                dpi,
                colorMode,
                supplierId: selectedSupplierId || null
            }, {
                timeout: 300000
            });

            setShowPrinterModal(false);
            const success = applyExtractedCatalogData(data);

            if (!success) {
                if (data?.invoiceUrl) {
                    setShowInvoiceViewer(true);
                    toast('Factura digitalizada y archivada. Puedes presionar "Digitalizar Precios" para procesarla.', { icon: 'ℹ️', id: toastId, duration: 6000 });
                } else {
                    toast.error('No se detectaron productos en la factura escaneada', { id: toastId });
                }
                return;
            }

            const rawList = Array.isArray(data?.items) ? data.items : (data?.rawItems || []);
            const rate = Number(data?.rate || 1);
            toast.success(`Factura escaneada: ${rawList.length} productos detectados (Tasa BCV: Bs. ${rate.toFixed(2)})`, { id: toastId });
        } catch (error) {
            console.error('Error scanning from printer:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Error al escanear desde la impresora';
            toast.error(errorMsg, { id: toastId, duration: 6000 });
        } finally {
            setIsScanningPrinter(false);
        }
    };

    const openAiImageSearch = async (index, item) => {
        const searchName = item.externalName || item.matchedProduct?.name || '';
        if (!searchName) return;

        setAiSearchItem(item);
        setAiSearchIndex(index);
        setCustomImageQuery(searchName);
        setIsSearchingImages(true);
        setCandidateImages([]);

        try {
            const { data } = await api.post('/products/new/search-images-ia', {
                name: searchName,
                category: 'General'
            }, { timeout: 45000 });
            setCandidateImages(data.images || []);
            if (!data.images || data.images.length === 0) {
                toast.error('No se encontraron imágenes candidatas en la web');
            }
        } catch (err) {
            toast.error('Error buscando imágenes: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsSearchingImages(false);
        }
    };

    const handleCustomImageSearch = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const query = (customImageQuery || '').trim();
        if (!query) {
            toast.error('Ingresa un término para buscar');
            return;
        }

        setIsSearchingImages(true);
        setCandidateImages([]);

        try {
            const { data } = await api.post('/products/new/search-images-ia', {
                name: query,
                category: 'General'
            }, { timeout: 45000 });
            setCandidateImages(data.images || []);
            if (!data.images || data.images.length === 0) {
                toast.error('No se encontraron imágenes para este término');
            }
        } catch (err) {
            toast.error('Error buscando imágenes: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsSearchingImages(false);
        }
    };

    const selectCandidateImage = async (imageUrl) => {
        if (aiSearchIndex === -1) return;
        try {
            const { data } = await api.post('/products/new/select-image-ia', {
                imageUrl,
                name: aiSearchItem?.externalName || ''
            });
            updateItemProperty(aiSearchIndex, 'image', data.imageUri || data.imageUrl);
            toast.success('Imagen asignada correctamente');
            setAiSearchItem(null);
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al descargar la imagen elegida');
        }
    };

    const searchAllImagesIA = async () => {
        if (items.length === 0) return;
        setIsBulkSearchingImages(true);
        toast.loading('Buscando imágenes para los productos...', { id: 'bulk-img' });

        let updatedCount = 0;
        const newItems = [...items];

        for (let i = 0; i < newItems.length; i++) {
            const item = newItems[i];
            if (item.image) continue;

            const searchName = item.externalName || item.matchedProduct?.name || '';
            if (!searchName) continue;

            try {
                const { data } = await api.post('/products/new/search-images-ia', {
                    name: searchName,
                    category: 'General'
                }, { timeout: 45000 });
                if (data?.images && data.images.length > 0) {
                    const firstImg = data.images[0];
                    const selRes = await api.post('/products/new/select-image-ia', {
                        imageUrl: firstImg,
                        name: searchName
                    }, { timeout: 30000 });
                    newItems[i] = {
                        ...newItems[i],
                        image: selRes.data?.imageUri || selRes.data?.imageUrl || firstImg
                    };
                    updatedCount++;
                }
            } catch (imgErr) {
                console.warn(`[CatalogImporter] Búsqueda individual omitida para "${searchName}":`, imgErr);
            }
        }

        setItems(newItems);
        setIsBulkSearchingImages(false);
        toast.dismiss('bulk-img');
        if (updatedCount > 0) {
            toast.success(`Se asignaron imágenes automáticamente a ${updatedCount} productos`);
        } else {
            toast.error('No se encontraron imágenes nuevas para los productos');
        }
    };

    // Filtrado O(1) preservando el índice real exacto de cada fila
    const filteredEntries = useMemo(() => {
        const indexed = items.map((item, realIndex) => ({ item, realIndex }));
        if (!filterQuery.trim()) return indexed;
        const q = filterQuery.toLowerCase();
        return indexed.filter(({ item }) =>
            item.externalName.toLowerCase().includes(q) ||
            Boolean(item.matchedProduct?.name?.toLowerCase().includes(q))
        );
    }, [items, filterQuery]);

    // Cálculos en tiempo real para el Semáforo de Cuadre Fiscal
    const liveSummary = useMemo(() => {
        let exemptUsd = 0;
        let taxableBaseUsd = 0;
        let taxUsd = 0;
        let exemptBs = 0;
        let taxableBaseBs = 0;
        let taxBs = 0;
        let totalUnits = 0;

        for (const it of items) {
            const qty = importMode === 'INVOICE' ? Math.max(0, Number(it.purchasedQuantity ?? 1)) : 1;
            const packUnits = Math.max(1, Number(it.quantity ?? 1));
            if (isItemReadyToSave(it)) {
                totalUnits += qty * packUnits;
            }
            const isEx = it.isExempt === true || it.taxStatus === 'exento' || Number(it.taxRate) === 0;
            const itemTaxFactor = (Number(it.taxRate) > 0 ? Number(it.taxRate) : ivaPct) / 100;
            const lineBaseUsd = Number(it.basePrice || 0) * qty;
            const lineBaseBs = Number(it.basePriceBs || 0) * qty;

            if (isEx) {
                exemptUsd += lineBaseUsd;
                exemptBs += lineBaseBs;
            } else {
                taxableBaseUsd += lineBaseUsd;
                taxUsd += lineBaseUsd * itemTaxFactor;
                taxableBaseBs += lineBaseBs;
                taxBs += lineBaseBs * itemTaxFactor;
            }
        }

        const totalUsd = roundExact(exemptUsd + taxableBaseUsd + taxUsd, 2);
        const totalBs = roundExact(exemptBs + taxableBaseBs + taxBs, 2);
        const readyCount = items.filter(isItemReadyToSave).length;
        const unapprovedLinkedCount = items.filter(i => i.matchedProduct && !i.approved && !i.isNew).length;
        const unlinkedCount = items.filter(i => !i.matchedProduct && !i.isNew).length;

        // Comparación con total impreso de factura si existe
        let diffDoc = null;
        let isReconciled = null;
        if (docTotals.total && docTotals.total > 0) {
            const calcInDocCurrency = docCurrency === 'BS' ? totalBs : totalUsd;
            diffDoc = roundExact(calcInDocCurrency - docTotals.total, 2);
            const pctDiff = Math.abs(diffDoc) / docTotals.total;
            const absTolerance = docCurrency === 'BS' ? Math.max(2, systemRate * 0.15) : 0.15;
            isReconciled = Math.abs(diffDoc) <= absTolerance || pctDiff <= 0.01;
        }

        return {
            exemptUsd: roundExact(exemptUsd, 2),
            taxableBaseUsd: roundExact(taxableBaseUsd, 2),
            taxUsd: roundExact(taxUsd, 2),
            totalUsd,
            exemptBs: roundExact(exemptBs, 2),
            taxableBaseBs: roundExact(taxableBaseBs, 2),
            taxBs: roundExact(taxBs, 2),
            totalBs,
            totalUnits: roundExact(totalUnits, 2),
            readyCount,
            unapprovedLinkedCount,
            unlinkedCount,
            diffDoc,
            isReconciled
        };
    }, [items, importMode, docTotals, docCurrency, systemRate, ivaPct]);

    const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = () => setIsDragging(false);
    const onDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
    };

    const handleFile = (selectedFile) => {
        const validExts = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
        const ext = (selectedFile.name.split('.').pop() || '').toLowerCase();
        if (!validExts.includes(ext) && !selectedFile.type.startsWith('image/')) {
            toast.error('Por favor sube un archivo PDF o Imagen de factura (JPG/PNG/WEBP)');
            return;
        }
        setFile(selectedFile);
    };

    const processFile = async () => {
        if (!file) return;
        setIsLoading(true);
        const formData = new FormData();
        formData.append('catalog', file);
        if (selectedSupplierId) formData.append('supplierId', selectedSupplierId);

        try {
            const { data } = await api.post('/products/import-catalog', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 180000
            });

            const success = applyExtractedCatalogData(data);
            if (!success) {
                toast.error('No se detectaron renglones de productos en el documento');
                return;
            }

            const rawList = Array.isArray(data?.items) ? data.items : (data?.rawItems || []);
            const currency = (data?.currency || 'USD').toUpperCase();
            const rate = Number(data?.rate || 1);

            if (currency === 'BS') {
                toast.success(`Documento en Bolívares: ${rawList.length} renglones (Tasa BCV: Bs. ${rate.toFixed(2)}).`, { duration: 5000 });
            } else {
                toast.success(`${rawList.length} renglones detectados correctamente (USD)`);
            }
        } catch (error) {
            console.error('Error processing document:', error);
            const errMsg = error.response?.data?.error || error.message || 'Error al analizar el documento';
            toast.error(errMsg, { duration: 6000 });
        } finally {
            setIsLoading(false);
        }
    };

    const toggleItemTax = (index) => {
        if (index < 0 || index >= items.length) return;
        setItems(prev => {
            const newItems = [...prev];
            const item = newItems[index];
            if (!item) return prev;

            const currentExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
            const nextExempt = !currentExempt;
            const itemTaxPct = Number(item.taxRate) > 0 ? Number(item.taxRate) : ivaPct;
            const itemMult = 1 + (itemTaxPct / 100);
            const multiplier = nextExempt ? 1 : itemMult;
            const safeRate = systemRate > 0 ? systemRate : 1;

            const baseBs = item.basePriceBs > 0
                ? Number(item.basePriceBs)
                : roundExact((currentExempt ? Number(item.price || 0) : Number(item.price || 0) / itemMult) * safeRate, 2);
            const baseUsd = item.basePrice > 0
                ? Number(item.basePrice)
                : roundExact(baseBs / safeRate, 6);

            const updatedPriceBs = roundExact(baseBs * multiplier, 2);
            const updatedPriceUsd = docCurrency === 'BS'
                ? roundExact(updatedPriceBs / safeRate, 6)
                : roundExact(baseUsd * multiplier, 6);

            newItems[index] = {
                ...item,
                basePriceBs: baseBs,
                basePrice: baseUsd,
                taxAdded: !nextExempt,
                price: updatedPriceUsd,
                rawPriceBs: updatedPriceBs,
                isExempt: nextExempt,
                taxRate: nextExempt ? 0 : itemTaxPct,
                taxStatus: nextExempt ? 'exento' : 'gravable',
                manualPvp: null
            };
            return newItems;
        });
    };

    const handleApplyGlobalTax = (makeExempt) => {
        const safeRate = systemRate > 0 ? systemRate : 1;
        const multiplier = makeExempt ? 1 : ivaMultiplier;

        setItems(prev => prev.map(item => {
            const currentExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
            const baseBs = item.basePriceBs > 0
                ? Number(item.basePriceBs)
                : roundExact((currentExempt ? Number(item.price || 0) : Number(item.price || 0) / ivaMultiplier) * safeRate, 2);
            const baseUsd = item.basePrice > 0
                ? Number(item.basePrice)
                : roundExact(baseBs / safeRate, 6);

            const updatedPriceBs = roundExact(baseBs * multiplier, 2);
            const updatedPriceUsd = docCurrency === 'BS'
                ? roundExact(updatedPriceBs / safeRate, 6)
                : roundExact(baseUsd * multiplier, 6);

            return {
                ...item,
                basePriceBs: baseBs,
                basePrice: baseUsd,
                taxAdded: !makeExempt,
                price: updatedPriceUsd,
                rawPriceBs: updatedPriceBs,
                isExempt: makeExempt,
                taxRate: makeExempt ? 0 : ivaPct,
                taxStatus: makeExempt ? 'exento' : 'gravable',
                manualPvp: null
            };
        }));

        toast.success(
            makeExempt
                ? 'Todos los productos marcados como EXENTOS (0% IVA)'
                : `Todos los productos marcados como GRAVADOS (+${ivaPct}% IVA sumado al costo)`
        );
    };

    const handleManualCostChange = (index, rawValue) => {
        const newCostUsd = Math.max(0, parseFloat(rawValue) || 0);
        const safeRate = systemRate > 0 ? systemRate : 1;
        setItems(prev => {
            const newItems = [...prev];
            const item = newItems[index];
            if (!item) return prev;

            const isExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
            const divisor = isExempt ? 1 : (1 + ((Number(item.taxRate) > 0 ? Number(item.taxRate) : ivaPct) / 100));
            const baseUsd = roundExact(newCostUsd / divisor, 6);
            const priceBs = roundExact(newCostUsd * safeRate, 2);
            const baseBs = roundExact(baseUsd * safeRate, 2);

            newItems[index] = {
                ...item,
                price: roundExact(newCostUsd, 6),
                basePrice: baseUsd,
                rawPriceBs: priceBs,
                basePriceBs: baseBs,
                docRawBase: docCurrency === 'BS' ? baseBs : baseUsd,
                manualPvp: null
            };
            return newItems;
        });
    };

    const handleManualPvpChange = (index, rawValue) => {
        const targetPvp = Math.max(0, parseFloat(rawValue) || 0);
        setItems(prev => {
            const newItems = [...prev];
            const item = newItems[index];
            if (!item) return prev;

            const unitCost = computeUnitCostExact(item.price, item.quantity);
            const impliedMargin = unitCost > 0
                ? roundExact(((targetPvp / unitCost) - 1) * 100, 2)
                : Number(item.margin || 0);

            newItems[index] = {
                ...item,
                manualPvp: targetPvp,
                margin: Math.max(0, impliedMargin)
            };
            return newItems;
        });
    };

    const updateItemProperty = (index, property, value) => {
        if (index < 0) return;
        setItems(prev => {
            const newItems = [...prev];
            const current = newItems[index];
            if (!current) return prev;

            const updated = { ...current, [property]: value };

            if (property === 'margin') {
                updated.manualPvp = null;
            }

            if (property === 'quantity') {
                const safeUnits = Math.max(1, Number(value) || 1);
                updated.quantity = safeUnits;
                updated.manualPvp = null;
                if (importMode === 'INVOICE' && !current.stockManuallyEdited) {
                    const packs = Math.max(0, Number(current.purchasedQuantity ?? 1));
                    updated.stock = roundExact(packs * safeUnits, 4);
                }
            }

            if (property === 'purchasedQuantity') {
                const safePacks = Math.max(0, Number(value) || 0);
                updated.purchasedQuantity = safePacks;
                if (importMode === 'INVOICE') {
                    updated.stock = roundExact(safePacks * Math.max(1, Number(current.quantity || 1)), 4);
                    updated.stockManuallyEdited = false;
                }
            }

            if (property === 'stock') {
                updated.stockManuallyEdited = true;
            }

            if (property === 'isNew') {
                if (value === true) {
                    updated.matchedProduct = null;
                    updated.approved = true;
                } else {
                    updated.approved = Boolean(updated.matchedProduct);
                }
            }

            if (property === 'matchedProduct') {
                if (value) {
                    updated.isNew = false;
                    updated.approved = true;
                    const invBulk = Number(value.unitsPerBulk || 1);
                    const pdfBulk = Number(current.suggestedQuantity || 1);
                    const nextUnits = invBulk > 1 ? invBulk : (pdfBulk > 1 ? pdfBulk : 1);
                    updated.quantity = nextUnits;
                    if (importMode === 'INVOICE' && !current.stockManuallyEdited) {
                        updated.stock = roundExact(Math.max(0, Number(current.purchasedQuantity ?? 1)) * nextUnits, 4);
                    }
                    if (value.margin !== undefined && Number(value.margin) > 0) {
                        updated.margin = roundExact(Number(value.margin), 2);
                        updated.manualPvp = null;
                    }
                } else {
                    updated.approved = false;
                }
            }

            newItems[index] = updated;
            return newItems;
        });
    };

    const handleApproveAllSuggested = () => {
        let count = 0;
        setItems(prev => prev.map(item => {
            if (item.matchedProduct && !item.approved && !item.isNew) {
                count++;
                return { ...item, approved: true };
            }
            return item;
        }));
        if (count > 0) {
            toast.success(`${count} sugerencias de inventario aprobadas`);
        }
    };

    const handleApproveUnlinkedAsNew = () => {
        let count = 0;
        setItems(prev => prev.map(item => {
            if (!item.matchedProduct && !item.isNew) {
                count++;
                return { ...item, isNew: true, approved: true };
            }
            return item;
        }));
        if (count > 0) {
            toast.success(`${count} productos sin vínculo marcados para crearse como Nuevos`);
        }
    };

    const handleApplyGlobalMargin = () => {
        const marginValue = parseFloat(globalMargin);
        if (isNaN(marginValue) || marginValue < 0) {
            toast.error('Ingresa un porcentaje de margen válido');
            return;
        }

        setItems(prev => prev.map(item => ({
            ...item,
            margin: roundExact(marginValue, 2),
            manualPvp: null
        })));
        toast.success(`Margen del ${marginValue}% aplicado con precisión completa`);
    };

    const applyUpdates = async (settlementOverride = null) => {
        const readyItems = items.filter(isItemReadyToSave);
        if (!readyItems.length) {
            toast.error('No hay productos vinculados aprobados ni marcados como nuevos para guardar');
            return;
        }

        // Si estamos en modo Factura y no se ha especificado la condición de asentamiento, abrir el modal financiero
        if (importMode === 'INVOICE' && !settlementOverride) {
            setIsSettlementModalOpen(true);
            return;
        }

        setIsSaving(true);
        try {
            const targetSupplierId = settlementOverride?.supplierId || selectedSupplierId || null;
            const newSupplierObj = settlementOverride?.newSupplier || null;
            const finAction = settlementOverride?.financialAction || (paymentStatus === 'unpaid' ? 'CREDIT' : 'PAID');
            const targetPaymentStatus = finAction === 'CREDIT' ? 'unpaid' : 'paid';

            const mappings = readyItems.map(i => {
                const safeBulkPrice = roundExact(Number(i.price || 0), 6);
                const safeQuantity = Math.max(1, Number(i.quantity || 1));
                const safeMargin = roundExact(Number(i.margin || 0), 4);
                const salesPrice = computeSalesPriceExact(safeBulkPrice, safeQuantity, safeMargin, i.manualPvp);
                const itemIsExempt = i.isExempt === true || i.taxStatus === 'exento' || Number(i.taxRate) === 0;

                return {
                    externalName: i.externalName,
                    barcode: i.barcode || null,
                    localProductId: (i.isNew || !i.matchedProduct) ? null : i.matchedProduct.id,
                    isNew: Boolean(i.isNew),
                    price: safeBulkPrice,
                    purchasedQuantity: importMode === 'INVOICE' ? Math.max(0, Number(i.purchasedQuantity ?? 1)) : 0,
                    quantity: safeQuantity,
                    margin: safeMargin,
                    newPrice: salesPrice,
                    supplierId: targetSupplierId,
                    initialStock: importMode === 'INVOICE' ? Math.max(0, Number(i.stock || 0)) : 0,
                    imageUri: i.image || null,
                    taxStatus: itemIsExempt ? 'exento' : 'gravable',
                    isExempt: itemIsExempt,
                    taxRate: itemIsExempt ? 0 : 16
                };
            });

            // Total fiscal oficial verificado de la factura física
            const officialDocTotalBs = docTotals.total > 0 && docCurrency === 'BS' ? roundExact(docTotals.total, 2) : null;
            const officialDocTotalUsd = docTotals.total > 0
                ? (docCurrency === 'BS' && systemRate > 0 ? roundExact(docTotals.total / systemRate, 2) : roundExact(docTotals.total, 2))
                : null;
            const finalInvoiceTotalUsd = officialDocTotalUsd || liveSummary.totalUsd;
            const finalInvoiceTotalBs = officialDocTotalBs || (docCurrency === 'BS' ? liveSummary.totalBs : roundExact(liveSummary.totalUsd * systemRate, 2));

            const { data: resData } = await api.post('/products/apply-mapping', {
                mappings,
                importMode,
                invoiceUrl: invoiceUrl || null,
                referenceNumber: referenceNumber.trim() || null,
                supplierId: targetSupplierId,
                newSupplier: newSupplierObj,
                financialAction: finAction,
                createPurchaseOrder: importMode === 'INVOICE' && finAction !== 'INVENTORY_ONLY',
                paymentStatus: targetPaymentStatus,
                paymentMethod: settlementOverride?.paymentMethod || null,
                invoiceDate: invoiceDate || null,
                dueDate: finAction === 'CREDIT' ? (settlementOverride?.dueDate || dueDate || null) : null,
                exchangeRate: systemRate > 0 ? systemRate : 1,
                totalUsd: importMode === 'INVOICE' ? finalInvoiceTotalUsd : null,
                totalVes: importMode === 'INVOICE' ? finalInvoiceTotalBs : null,
                notes: settlementOverride?.notes || null
            });

            if (importMode === 'CATALOG' || finAction === 'INVENTORY_ONLY') {
                toast.success(`¡Inventario actualizado! ${resData.updateCount || mappings.length} productos procesados (Sin alterar Cuentas por Pagar).`, { duration: 5000 });
            } else if (resData.creditCharged || finAction === 'CREDIT') {
                toast.success(
                    `¡Recepción completada! ${resData.updateCount} productos ingresados y $${finalInvoiceTotalUsd.toFixed(2)} registrados en Cuentas por Pagar.`,
                    { duration: 6000 }
                );
            } else {
                toast.success(`¡Factura procesada! ${resData.updateCount || mappings.length} productos ingresados y compra archivada como solvente de contado.`, { duration: 5000 });
            }

            // Refrescar listado de proveedores en memoria
            try {
                const { data: freshSups } = await api.get('/suppliers');
                if (Array.isArray(freshSups)) setSuppliers(freshSups);
            } catch (caughtErr) { console.warn('[CatalogImporter] Error en operación auxiliar:', caughtErr?.message || caughtErr); }

            setIsSettlementModalOpen(false);
            setItems([]);
            setFile(null);
            setInvoiceUrl('');
            setReferenceNumber('');
            setPaymentStatus('paid');
            setDueDate('');
            setDocTotals({ subtotal: null, tax: null, total: null });
        } catch (error) {
            console.error('Error applying updates:', error);
            const errMsg = error.response?.data?.error || error.message || 'Error al guardar las actualizaciones';
            toast.error(errMsg, { duration: 6000 });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-28 sm:pb-20 pb-safe">
            {/* Header Section + Selector de Modo Operativo */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-slate-900 dark:bg-slate-800 text-white rounded-xl shadow-xs">
                        <FileSpreadsheet size={22} className="text-primary-400" />
                    </div>
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                            Importador de Catálogos y Facturas
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Recepción fiscal verificada, conciliación BCV/IVA y actualización exacta de costos y PVP
                        </p>
                    </div>
                </div>

                {/* Controles de Modo e Historial */}
                <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto">
                    {/* Conmutador de Modo: Factura de Compra vs Catálogo de Precios */}
                    <div className="flex flex-wrap sm:inline-flex w-full sm:w-auto p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl gap-1">
                        <button
                            type="button"
                            onClick={() => handleSwitchImportMode('INVOICE')}
                            className={`flex-1 sm:flex-initial justify-center px-3 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer min-w-0 ${
                                importMode === 'INVOICE'
                                    ? 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-xs border border-slate-200/80 dark:border-slate-700'
                                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            <Receipt size={15} className="shrink-0" />
                            <span className="truncate">Factura / Compra</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSwitchImportMode('CATALOG')}
                            className={`flex-1 sm:flex-initial justify-center px-3 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer min-w-0 ${
                                importMode === 'CATALOG'
                                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs border border-slate-200/80 dark:border-slate-700'
                                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            <BookOpen size={15} className="shrink-0" />
                            <span className="truncate">Catálogo / Lista</span>
                        </button>
                    </div>

                    {/* Botón Historial de Facturas Cargadas (Drawer Deslizable) */}
                    <button
                        type="button"
                        onClick={() => setIsHistoryDrawerOpen(true)}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-primary-500/40 transition-all shadow-xs cursor-pointer"
                        title="Ver historial de facturas cargadas anteriormente"
                    >
                        <History size={15} className="text-primary-500 shrink-0" />
                        <span>Historial</span>
                    </button>
                </div>
            </div>

            {!items.length ? (
                <div className="space-y-6">
                    {/* Tarjeta de Factura Digitalizada en Servidor */}
                    {invoiceUrl && (
                        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/60 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3.5 sm:gap-4 shadow-xs overflow-hidden">
                            <div className="flex items-start sm:items-center gap-3 min-w-0 w-full sm:w-auto">
                                <div className="p-2.5 sm:p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-800/50 shrink-0">
                                    <FileText size={20} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Documento Digitalizado en Servidor</h4>
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/40 shrink-0">
                                            Listo para procesar
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed break-words">
                                        Existe un comprobante digital archivado. Puedes inspeccionarlo o extraer automáticamente sus renglones.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setShowInvoiceViewer(true)}
                                    className="flex-1 sm:flex-initial justify-center px-3.5 py-2.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs cursor-pointer transition-colors flex items-center gap-1.5"
                                >
                                    <Eye size={14} className="shrink-0" />
                                    <span>Ver Documento</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleReparseCurrentInvoice}
                                    disabled={isLoading}
                                    className="flex-1 sm:flex-initial justify-center px-4 py-2.5 sm:py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50 transition-all active:scale-95"
                                >
                                    {isLoading ? <Loader2 size={15} className="animate-spin shrink-0" /> : <RefreshCw size={15} className="shrink-0" />}
                                    <span>Digitalizar Precios</span>
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* Columna Izquierda: Configuración y Captura */}
                        <div className="lg:col-span-5 space-y-4">
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                                <div>
                                    <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Parámetros de Importación</h3>
                                    <p className="text-[11px] text-slate-500 mt-0.5">Asigna el proveedor o deja que el motor lo detecte por RIF</p>
                                </div>

                                <div className="space-y-3 pt-1">
                                    <div>
                                        <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Proveedor Asociado (Opcional)</label>
                                        <select
                                            value={selectedSupplierId}
                                            onChange={(e) => setSelectedSupplierId(e.target.value)}
                                            className="w-full h-10 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 text-xs font-medium text-slate-800 dark:text-white focus:border-primary-500 transition-colors outline-none cursor-pointer"
                                        >
                                            <option value="">Auto-detectar por RIF / Seleccionar luego...</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.rif ? ` (${s.rif})` : ''}</option>)}
                                        </select>
                                    </div>

                                    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl space-y-1">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            <Info size={14} className="text-primary-500" />
                                            <span>
                                                {importMode === 'INVOICE'
                                                    ? 'Modo Recepción de Factura Activo'
                                                    : 'Modo Lista de Precios / Catálogo Activo'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                            {importMode === 'INVOICE'
                                                ? 'Extraerá cantidades compradas, bultos, tasa BCV, IVA 16%/Exento, cuadrará el total fiscal y te permitirá cargar existencias y Cuentas por Pagar en un solo paso.'
                                                : 'Solo actualizará costos unitarios, márgenes, régimen de IVA y PVP sin sumar stock ni generar órdenes de compra.'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Acciones de Digitalización Directa */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
                                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Captura por Dispositivo</h3>

                                <div className="space-y-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowPrinterModal(true)}
                                        disabled={isScanningPrinter}
                                        className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left transition-all flex items-center gap-3.5 cursor-pointer disabled:opacity-50 group"
                                    >
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 shrink-0 group-hover:text-primary-600 transition-colors">
                                            {isScanningPrinter ? <Loader2 size={18} className="animate-spin" /> : <Printer size={18} />}
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">Escanear desde Impresora</h4>
                                            <p className="text-[11px] text-slate-500 truncate">Captura directa desde escáner USB o Red</p>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setShowCameraModal(true)}
                                        className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left transition-all flex items-center gap-3.5 cursor-pointer group"
                                    >
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 shrink-0 group-hover:text-primary-600 transition-colors">
                                            <Camera size={18} />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">Capturar con Cámara</h4>
                                            <p className="text-[11px] text-slate-500 truncate">Fotografía la factura física con la cámara web</p>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Columna Derecha: Zona Principal de Carga */}
                        <div className="lg:col-span-7">
                            <div
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                className={`min-h-[380px] border-2 border-dashed rounded-2xl transition-all flex flex-col items-center justify-center text-center p-8 relative overflow-hidden ${
                                    isDragging
                                        ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/20 shadow-inner'
                                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary-400 dark:hover:border-slate-600 shadow-xs'
                                }`}
                            >
                                {file ? (
                                    <div className="space-y-5 animate-in zoom-in-95 duration-200 relative z-10 max-w-sm">
                                        <div className="w-16 h-16 bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 rounded-2xl flex items-center justify-center mx-auto border border-primary-200 dark:border-primary-800/60 shadow-xs">
                                            <FileText size={32} />
                                        </div>
                                        <div>
                                            <p className="text-base font-bold text-slate-900 dark:text-white truncate">{file.name}</p>
                                            <p className="text-xs font-mono text-slate-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB • Documento listo para procesar</p>
                                        </div>
                                        <div className="flex gap-2.5 justify-center pt-2">
                                            <button
                                                type="button"
                                                onClick={() => setFile(null)}
                                                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
                                            >
                                                Cambiar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={processFile}
                                                disabled={isLoading}
                                                className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer active:scale-95"
                                            >
                                                {isLoading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
                                                <span>{isLoading ? 'Analizando...' : 'Analizar Documento'}</span>
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4 relative z-10 max-w-md">
                                        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400 transition-colors mx-auto">
                                            <Upload size={28} />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Suelta aquí tu Factura o Catálogo</h3>
                                            <p className="text-xs text-slate-500 mt-1">Arrastra el archivo o haz clic en cualquier parte de este recuadro para explorar</p>
                                        </div>
                                        <div className="flex items-center justify-center gap-2 pt-2 text-[11px] font-mono text-slate-400">
                                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">PDF</span>
                                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">JPG</span>
                                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">PNG</span>
                                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">WEBP</span>
                                        </div>
                                        <input
                                            type="file"
                                            accept=".pdf,.png,.jpg,.jpeg,.webp"
                                            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-300">
                    {/* Panel Fiscal Superior: Moneda, Tasa BCV, Proveedor y Condición de Pago */}
                    <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800/40">
                                    <CheckCircle2 size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                        {importMode === 'INVOICE' ? 'Revisión y Conciliación de Factura' : 'Actualización de Catálogo de Precios'}
                                    </h3>
                                    <p className="text-xs text-slate-500 font-medium">
                                        <strong className="text-emerald-600 dark:text-emerald-400">{liveSummary.readyCount}</strong> de <strong>{items.length}</strong> renglones listos para guardar
                                        {detectedSupplierLabel && !selectedSupplierId ? ` • Detectado: ${detectedSupplierLabel}` : ''}
                                    </p>
                                </div>
                            </div>

                            {/* Acciones Principales */}
                            <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto justify-end">
                                {invoiceUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setShowInvoiceViewer(true)}
                                        className="px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50 font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                                    >
                                        <Eye size={14} />
                                        <span>Ver Documento</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={searchAllImagesIA}
                                    disabled={isBulkSearchingImages || items.length === 0}
                                    className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                                >
                                    {isBulkSearchingImages ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                                    <span>{isBulkSearchingImages ? 'Buscando...' : 'Auto-Imágenes'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setItems([])}
                                    className="px-3.5 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 bg-slate-50 dark:bg-slate-800/60 font-semibold text-xs transition-colors border border-slate-200 dark:border-slate-800 cursor-pointer shrink-0"
                                >
                                    Descartar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => applyUpdates(null)}
                                    disabled={isSaving || liveSummary.readyCount === 0}
                                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer shrink-0"
                                >
                                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    <span>
                                        {isSaving
                                            ? 'Procesando...'
                                            : importMode === 'INVOICE'
                                            ? `Confirmar Recepción (${liveSummary.readyCount})`
                                            : `Actualizar Precios (${liveSummary.readyCount})`}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* Fila de Controles Fiscales y Contables */}
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                            {/* Proveedor Editable */}
                            <div className="xl:col-span-3">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Proveedor</label>
                                <select
                                    value={selectedSupplierId}
                                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                                    className="w-full h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 text-xs font-semibold text-slate-800 dark:text-white outline-none focus:border-primary-500 cursor-pointer"
                                >
                                    <option value="">Sin proveedor asignado</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>

                            {/* Selector Conmutable Moneda USD <-> BS */}
                            <div className="xl:col-span-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Moneda Documento</label>
                                <div className="grid grid-cols-2 h-9 p-0.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                                    <button
                                        type="button"
                                        onClick={() => handleCurrencySwitch('BS')}
                                        className={`rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                                            docCurrency === 'BS'
                                                ? 'bg-indigo-600 text-white shadow-xs'
                                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        Bs (VES)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleCurrencySwitch('USD')}
                                        className={`rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                                            docCurrency === 'USD'
                                                ? 'bg-emerald-600 text-white shadow-xs'
                                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        USD ($)
                                    </button>
                                </div>
                            </div>

                            {/* Fecha Emisión + Tasa BCV */}
                            <div className="xl:col-span-3 grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                                        <Calendar size={11} className="text-amber-500" />
                                        <span>Fecha Doc.</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={invoiceDate || ''}
                                        onChange={(e) => handleDateRateLookup(e.target.value)}
                                        disabled={isLookingUpRate}
                                        className="w-full h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 text-xs font-mono font-semibold text-slate-800 dark:text-white outline-none focus:border-amber-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                        Tasa ({rateSource || 'BCV'})
                                    </label>
                                    <div className="relative flex items-center">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={rateInput}
                                            onChange={(e) => handleManualRateInputChange(e.target.value)}
                                            className="w-full h-9 bg-slate-50 dark:bg-slate-950 border border-emerald-500/40 rounded-lg pl-2.5 pr-9 text-xs font-mono font-black text-emerald-600 dark:text-emerald-400 outline-none focus:ring-1 focus:ring-emerald-500"
                                            placeholder="Ej. 1000"
                                        />
                                        <span className="absolute right-2 text-[9px] font-mono text-slate-400 pointer-events-none">Bs/$</span>
                                    </div>
                                </div>
                            </div>

                            {/* Controles Exclusivos de Modo Factura: Nro Factura y Condición de Pago */}
                            {importMode === 'INVOICE' ? (
                                <div className="xl:col-span-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">N° Factura / Ref</label>
                                        <input
                                            type="text"
                                            value={referenceNumber}
                                            onChange={(e) => setReferenceNumber(e.target.value)}
                                            placeholder="Ej. 00044831"
                                            className="w-full h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 text-xs font-mono font-semibold text-slate-800 dark:text-white outline-none focus:border-primary-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                                            <CreditCard size={11} className="text-primary-500" />
                                            <span>Condición</span>
                                        </label>
                                        <select
                                            value={paymentStatus}
                                            onChange={(e) => setPaymentStatus(e.target.value)}
                                            className={`w-full h-9 border rounded-lg px-2 text-xs font-bold outline-none cursor-pointer ${
                                                paymentStatus === 'unpaid'
                                                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400'
                                                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white'
                                            }`}
                                        >
                                            <option value="paid">Contado (Pagada)</option>
                                            <option value="unpaid">Crédito (Por Pagar)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Vencimiento</label>
                                        <input
                                            type="date"
                                            value={dueDate}
                                            onChange={(e) => setDueDate(e.target.value)}
                                            disabled={paymentStatus !== 'unpaid'}
                                            className="w-full h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 text-xs font-mono text-slate-800 dark:text-white outline-none disabled:opacity-40"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="xl:col-span-4 flex items-center px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                                    Modo Lista de Precios: las existencias actuales del almacén y tus Cuentas por Pagar permanecerán intactas.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Items List Card */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs lg:h-[640px] flex flex-col">
                        {/* List Header with Mass Actions & Search */}
                        <div className="p-4 border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/20 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <div>
                                    <h3 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-widest">Renglones Detectados</h3>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">{filteredEntries.length} de {items.length} mostrados</p>
                                </div>

                                {liveSummary.unapprovedLinkedCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleApproveAllSuggested}
                                        className="ml-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                                    >
                                        <CheckCheck size={14} />
                                        <span>Aprobar Sugeridos ({liveSummary.unapprovedLinkedCount})</span>
                                    </button>
                                )}

                                {liveSummary.unlinkedCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleApproveUnlinkedAsNew}
                                        className="px-3 py-1.5 rounded-xl bg-primary-500/10 hover:bg-primary-500/20 text-primary-700 dark:text-primary-400 border border-primary-500/30 text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                                        title="Marca todos los productos que no existen en tu inventario para crearlos automáticamente"
                                    >
                                        <Plus size={13} />
                                        <span>Crear Sin Vínculo ({liveSummary.unlinkedCount})</span>
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2.5">
                                {/* Botones de IVA Masivo */}
                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200 dark:border-white/10">
                                    <button
                                        type="button"
                                        onClick={() => handleApplyGlobalTax(true)}
                                        className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        <span>Todos Exentos</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleApplyGlobalTax(false)}
                                        className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                        <span>Todos 16% IVA</span>
                                    </button>
                                </div>

                                {/* Herramienta de Margen Masivo */}
                                <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-xl">
                                    <Percent size={13} className="text-amber-500 font-bold" />
                                    <span className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase">Margen:</span>
                                    <input
                                        type="number"
                                        placeholder="30"
                                        value={globalMargin}
                                        onChange={(e) => setGlobalMargin(e.target.value)}
                                        className="w-12 h-7 bg-white dark:bg-slate-950 border border-amber-500/30 rounded-lg text-center text-xs font-black text-amber-600 dark:text-amber-400 outline-none focus:ring-1 focus:ring-amber-500"
                                        min="0"
                                        step="0.5"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleApplyGlobalMargin}
                                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] uppercase tracking-wider rounded-lg shadow-xs transition-all cursor-pointer active:scale-95"
                                    >
                                        Aplicar
                                    </button>
                                </div>

                                {/* Filtro por Nombre */}
                                <div className="relative w-full sm:w-52">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                                    <input
                                        type="text"
                                        placeholder="FILTRAR RENGLÓN..."
                                        className="w-full h-8 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl pl-8 pr-7 text-[10px] font-black text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary-500 transition-all uppercase outline-none"
                                        value={filterQuery}
                                        onChange={(e) => setFilterQuery(e.target.value)}
                                    />
                                    {filterQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setFilterQuery('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Desktop Table Header */}
                        <div className="hidden lg:flex items-center bg-slate-100/70 dark:bg-slate-800/60 px-3 py-3 border-b border-slate-200 dark:border-white/5 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <div className={importMode === 'INVOICE' ? 'w-[16%] px-2' : 'w-[22%] px-2'}>Producto (Documento)</div>
                            {importMode === 'INVOICE' && <div className="w-[5%] text-center px-1">Cant.</div>}
                            <div className="w-[9%] text-center px-1">Costo Emp ($)</div>
                            <div className="w-[7%] text-center px-1">IVA</div>
                            <div className="w-[6%] text-center px-1">Un/Bulto</div>
                            <div className="w-[8%] text-center px-1 text-emerald-600 dark:text-emerald-400">Costo Unit.</div>
                            <div className="w-[6%] text-center px-1 text-amber-600 dark:text-amber-400">Mg %</div>
                            <div className="w-[8%] text-center px-1 text-primary-600 dark:text-primary-400">PVP ($)</div>
                            {importMode === 'INVOICE' && <div className="w-[6%] text-center px-1 text-emerald-600 dark:text-emerald-400">Stock +</div>}
                            <div className="w-[5%] text-center px-1">Img</div>
                            <div className={importMode === 'INVOICE' ? 'w-[18%] px-2' : 'w-[22%] px-2'}>Tu Inventario (Local)</div>
                            <div className="w-[6%] text-center px-1">Estado</div>
                        </div>

                        {/* Scrollable Rows Body */}
                        <div className="lg:flex-1 lg:overflow-y-auto no-scrollbar bg-white dark:bg-slate-900/60">
                            {/* Mobile Cards View */}
                            <div className="lg:hidden p-3 space-y-3">
                                {filteredEntries.length === 0 ? (
                                    <div className="text-center py-12 text-xs font-black text-slate-400 uppercase">
                                        No se encontraron productos en el filtro
                                    </div>
                                ) : (
                                    filteredEntries.map(({ item, realIndex }) => (
                                        <MobileCatalogItemCard
                                            key={item._rowId}
                                            item={item}
                                            realIndex={realIndex}
                                            importMode={importMode}
                                            docCurrency={docCurrency}
                                            posRate={posRate}
                                            toggleItemTax={toggleItemTax}
                                            updateItemProperty={updateItemProperty}
                                            handleManualCostChange={handleManualCostChange}
                                            handleManualPvpChange={handleManualPvpChange}
                                            openAiImageSearch={openAiImageSearch}
                                        />
                                    ))
                                )}

                                {filteredEntries.length > 0 && (
                                    <div className="pt-3 pb-6 flex flex-col gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => applyUpdates(null)}
                                            disabled={isSaving || liveSummary.readyCount === 0}
                                            className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-2.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                                        >
                                            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                            <span>{isSaving ? 'Guardando...' : `Confirmar y Guardar (${liveSummary.readyCount} aprobados)`}</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Desktop Multi-Column Table View */}
                            <div className="hidden lg:block divide-y divide-slate-100 dark:divide-white/5">
                                {filteredEntries.map(({ item, realIndex }) => {
                                    const isItemExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
                                    const unitCost = computeUnitCostExact(item.price, item.quantity);
                                    const suggestedPvp = computeSalesPriceExact(item.price, item.quantity, item.margin, item.manualPvp);
                                    const oldUnitCost = Number(item.matchedProduct?.currentCost ?? item.matchedProduct?.cost ?? 0);
                                    const costDiffPct = oldUnitCost > 0 ? ((unitCost - oldUnitCost) / oldUnitCost) * 100 : 0;
                                    const isReady = isItemReadyToSave(item);

                                    return (
                                        <div
                                            key={item._rowId}
                                            className={`flex items-center px-3 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/60 ${
                                                !item.matchedProduct && !item.isNew ? 'bg-amber-50/40 dark:bg-amber-500/[0.03]' : ''
                                            }`}
                                        >
                                            {/* Nombre Externo */}
                                            <div className={`${importMode === 'INVOICE' ? 'w-[16%]' : 'w-[22%]'} min-w-0 px-2`}>
                                                <span className="text-[11px] font-black text-slate-800 dark:text-white uppercase whitespace-normal block leading-tight">
                                                    {item.externalName}
                                                </span>
                                                {item.barcode && (
                                                    <span className="text-[9px] font-mono text-slate-400 block mt-0.5">{item.barcode}</span>
                                                )}
                                            </div>

                                            {/* Cantidad Comprada (Modo Factura) */}
                                            {importMode === 'INVOICE' && (
                                                <div className="w-[5%] px-1">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={item.purchasedQuantity ?? 1}
                                                        onChange={(e) => updateItemProperty(realIndex, 'purchasedQuantity', Math.max(0, parseFloat(e.target.value) || 0))}
                                                        className="w-full h-8 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-center text-[11px] font-mono font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                                        title="Cantidad de empaques/bultos facturados en esta línea"
                                                    />
                                                </div>
                                            )}

                                            {/* Costo Empaque Editable */}
                                            <div className="w-[9%] px-1 text-center">
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    min="0"
                                                    value={roundExact(item.price, 4)}
                                                    onChange={(e) => handleManualCostChange(realIndex, e.target.value)}
                                                    className="w-full h-8 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-center text-[11px] font-mono font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                                    title="Costo USD del empaque/bulto (editable si deseas corregir lectura óptica)"
                                                />
                                                {docCurrency === 'BS' && item.rawPriceBs > 0 && (
                                                    <span className="text-[9px] font-mono font-bold text-slate-400 block mt-0.5 truncate">
                                                        Bs. {formatBs(item.rawPriceBs)}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Botón IVA */}
                                            <div className="w-[7%] px-1 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleItemTax(realIndex)}
                                                    className={`w-full py-1.5 px-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-all cursor-pointer ${
                                                        isItemExempt
                                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20'
                                                    }`}
                                                    title={isItemExempt ? 'Clic para gravar con 16% IVA' : 'Clic para marcar Exento (0% IVA)'}
                                                >
                                                    <span className="flex items-center justify-center gap-1">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${isItemExempt ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                                                        <span>{isItemExempt ? 'Exento' : '16% IVA'}</span>
                                                    </span>
                                                </button>
                                            </div>

                                            {/* Unidades por Bulto */}
                                            <div className="w-[6%] px-1">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={item.quantity}
                                                    onChange={(e) => updateItemProperty(realIndex, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                    className="w-full h-8 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-center text-[11px] font-mono font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                                    title="Unidades individuales de venta que trae cada empaque/bulto"
                                                />
                                            </div>

                                            {/* Costo Unitario Exacto + Variación % */}
                                            <div className="w-[8%] px-1 text-center">
                                                <div className="flex flex-col items-center">
                                                    <span className="text-[11px] font-mono font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        ${formatSmartUsd(unitCost)}
                                                    </span>
                                                    {oldUnitCost > 0 && Math.abs(costDiffPct) > 0.1 && (
                                                        <span
                                                            className={`text-[8px] font-black px-1.5 py-0.5 rounded-md mt-0.5 tabular-nums ${
                                                                costDiffPct > 15
                                                                    ? 'bg-red-500 text-white'
                                                                    : costDiffPct > 0
                                                                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                                                    : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                                            }`}
                                                            title={`Costo anterior en inventario: $${formatSmartUsd(oldUnitCost)}`}
                                                        >
                                                            {costDiffPct > 0 ? '+' : ''}{costDiffPct.toFixed(1)}%
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Margen % */}
                                            <div className="w-[6%] px-1">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.5"
                                                    value={item.margin}
                                                    onChange={(e) => updateItemProperty(realIndex, 'margin', Math.max(0, parseFloat(e.target.value) || 0))}
                                                    className="w-full h-8 bg-amber-500/10 border border-amber-500/30 rounded-lg text-center text-[11px] font-mono font-black text-amber-600 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500"
                                                />
                                            </div>

                                            {/* PVP Sugerido Editable Bidireccional */}
                                            <div className="w-[8%] px-1 text-center">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={suggestedPvp}
                                                    onChange={(e) => handleManualPvpChange(realIndex, e.target.value)}
                                                    className="w-full h-8 bg-primary-500/10 border border-primary-500/30 rounded-lg text-center text-[11px] font-mono font-black text-primary-600 dark:text-primary-400 outline-none focus:ring-2 focus:ring-primary-500"
                                                    title="PVP de venta en USD (si lo editas, recalcula el margen automáticamente)"
                                                />
                                                {posRate > 1 && (
                                                    <span className="text-[8px] font-mono text-slate-400 block mt-0.5 truncate">
                                                        Bs. {formatBs(suggestedPvp * posRate)}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Stock Entrante (Modo Factura) */}
                                            {importMode === 'INVOICE' && (
                                                <div className="w-[6%] px-1">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={item.stock || 0}
                                                        onChange={(e) => updateItemProperty(realIndex, 'stock', Math.max(0, parseFloat(e.target.value) || 0))}
                                                        className="w-full h-8 bg-emerald-500/5 dark:bg-white/5 border border-emerald-500/30 rounded-lg text-center text-[11px] font-mono font-black text-emerald-700 dark:text-emerald-300 outline-none focus:ring-2 focus:ring-emerald-500"
                                                        title="Unidades totales a sumar al inventario (Cant. × Un/Bulto)"
                                                    />
                                                </div>
                                            )}

                                            {/* Imagen */}
                                            <div className="w-[5%] px-1 flex justify-center items-center gap-1 relative">
                                                {item.image ? (
                                                    <div
                                                        onClick={() => setPreviewProductImage({ item, index: realIndex, imageUrl: item.image })}
                                                        className="relative group/thumb cursor-pointer shrink-0"
                                                        title="Clic para ampliar o cambiar imagen"
                                                    >
                                                        <img
                                                            src={item.image.startsWith('http') ? item.image : `${api.defaults.baseURL || ''}${item.image.startsWith('/') ? '' : '/'}${item.image}`}
                                                            className="w-7 h-7 rounded-lg object-cover ring-2 ring-primary-500/30 group-hover/thumb:ring-primary-500 transition-all"
                                                            alt=""
                                                        />
                                                    </div>
                                                ) : (
                                                    <label className="cursor-pointer" title="Subir imagen desde PC">
                                                        <div className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-500 hover:text-primary-500 hover:border-primary-500/50 transition-all">
                                                            <Upload size={12} />
                                                        </div>
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            className="hidden"
                                                            onChange={async (e) => {
                                                                const upFile = e.target.files?.[0];
                                                                if (!upFile) return;
                                                                try {
                                                                    const base64 = await normalizeProductImage(upFile, { size: 500, mode: 'contain' });
                                                                    const { data } = await api.post('/products/upload-image', { base64 });
                                                                    updateItemProperty(realIndex, 'image', data.imageUri || data.filename);
                                                                    toast.success('Imagen cargada correctamente');
                                                                } catch (_err) {
                                                                    toast.error('Error al subir imagen');
                                                                }
                                                            }}
                                                        />
                                                    </label>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={() => openAiImageSearch(realIndex, item)}
                                                    className="w-7 h-7 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/30 flex items-center justify-center transition-all cursor-pointer shrink-0"
                                                    title="Buscar foto comercial en la web"
                                                >
                                                    <Search size={12} />
                                                </button>
                                            </div>

                                            {/* Vinculación Inventario Local */}
                                            <div className={`${importMode === 'INVOICE' ? 'w-[18%]' : 'w-[22%]'} px-2`}>
                                                {item.isNew ? (
                                                    <div className="flex items-center justify-between gap-2 p-2 bg-primary-500/10 rounded-xl border border-primary-500/30">
                                                        <span className="text-[10px] font-black text-primary-600 dark:text-primary-400 uppercase truncate">
                                                            CREAR COMO NUEVO
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => updateItemProperty(realIndex, 'isNew', false)}
                                                            className="p-1 text-primary-500 hover:text-red-500 rounded-lg cursor-pointer"
                                                            title="Cancelar creación como nuevo"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-1">
                                                        <ProductSearcher
                                                            currentProduct={item.matchedProduct}
                                                            onSelect={(prod) => updateItemProperty(realIndex, 'matchedProduct', prod)}
                                                        />
                                                        {!item.matchedProduct && (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateItemProperty(realIndex, 'isNew', true)}
                                                                className="text-[9px] font-black text-primary-500 hover:text-primary-600 transition-colors uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                                                            >
                                                                <Plus size={10} /> Crear como Producto Nuevo
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Botón Estado Clicable */}
                                            <div className="w-[6%] flex justify-center">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (item.isNew) {
                                                            updateItemProperty(realIndex, 'isNew', false);
                                                        } else if (item.matchedProduct) {
                                                            updateItemProperty(realIndex, 'approved', !item.approved);
                                                        } else {
                                                            updateItemProperty(realIndex, 'isNew', true);
                                                        }
                                                    }}
                                                    className={`p-2 rounded-xl transition-all cursor-pointer active:scale-95 ${
                                                        isReady
                                                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
                                                            : item.matchedProduct
                                                            ? 'bg-amber-500/15 hover:bg-emerald-500 hover:text-white text-amber-600 dark:text-amber-400 border border-amber-500/40'
                                                            : 'bg-slate-100 hover:bg-primary-500/15 text-slate-400 hover:text-primary-500 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'
                                                    }`}
                                                    title={
                                                        isReady
                                                            ? 'Aprobado (clic para desmarcar)'
                                                            : item.matchedProduct
                                                            ? 'Coincidencia sugerida: clic para aprobar'
                                                            : 'Sin vínculo: clic para marcar como Producto Nuevo'
                                                    }
                                                >
                                                    {isReady ? <CheckCircle2 size={14} strokeWidth={2.8} /> : <AlertCircle size={14} strokeWidth={2.5} />}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Pie de Tabla: Semáforo de Cuadre Fiscal (Modo Factura) */}
                        {importMode === 'INVOICE' && (
                            <div className="p-3.5 sm:px-5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-4 text-xs">
                                    <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Exento</span>
                                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                                            ${liveSummary.exemptUsd.toFixed(2)}
                                            {docCurrency === 'BS' && ` (Bs. ${formatBs(liveSummary.exemptBs)})`}
                                        </span>
                                    </div>
                                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
                                    <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Base Gravada</span>
                                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                                            ${liveSummary.taxableBaseUsd.toFixed(2)}
                                            {docCurrency === 'BS' && ` (Bs. ${formatBs(liveSummary.taxableBaseBs)})`}
                                        </span>
                                    </div>
                                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
                                    <div>
                                        <span className="text-[10px] font-bold text-blue-500 uppercase block">IVA (16%)</span>
                                        <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                                            ${liveSummary.taxUsd.toFixed(2)}
                                            {docCurrency === 'BS' && ` (Bs. ${formatBs(liveSummary.taxBs)})`}
                                        </span>
                                    </div>
                                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
                                    <div>
                                        <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase block">Total Calculado</span>
                                        <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                                            ${liveSummary.totalUsd.toFixed(2)} USD
                                            {docCurrency === 'BS' && (
                                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 ml-1.5">
                                                    • Bs. {formatBs(liveSummary.totalBs)}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                </div>

                                {/* Semáforo contra Total Impreso en Factura */}
                                {liveSummary.isReconciled !== null ? (
                                    <div
                                        className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                                            liveSummary.isReconciled
                                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                                                : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                                        }`}
                                    >
                                        {liveSummary.isReconciled ? <ShieldCheck size={15} /> : <AlertCircle size={15} />}
                                        <span>
                                            {liveSummary.isReconciled
                                                ? `Cuadre Fiscal Exacto vs Factura (${docCurrency === 'BS' ? `Bs. ${formatBs(docTotals.total)}` : `$${Number(docTotals.total).toFixed(2)}`})`
                                                : `Diferencia vs Total Factura (${docCurrency === 'BS' ? `Bs. ${formatBs(docTotals.total)}` : `$${Number(docTotals.total).toFixed(2)}`}) • Dif: ${liveSummary.diffDoc > 0 ? '+' : ''}${docCurrency === 'BS' ? `Bs. ${formatBs(liveSummary.diffDoc)}` : `$${liveSummary.diffDoc.toFixed(2)}`}`}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                                        <ShieldCheck size={14} className="text-emerald-500" />
                                        <span>Precisión interna de 6 decimales activa</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal Selector de Imágenes */}
            {aiSearchItem && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 max-w-2xl w-full shadow-2xl space-y-4">
                        <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div className="pr-4 min-w-0">
                                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <ImageIcon size={18} className="text-primary-500 shrink-0" />
                                    <span>Búsqueda de Imagen Comercial</span>
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1 truncate">
                                    Ítem: <span className="font-semibold text-slate-700 dark:text-slate-300">{aiSearchItem.externalName}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAiSearchItem(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleCustomImageSearch} className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <input
                                    type="text"
                                    value={customImageQuery}
                                    onChange={(e) => setCustomImageQuery(e.target.value)}
                                    placeholder="Ajusta los términos de búsqueda (ej. Harina PAN 1kg)..."
                                    className="w-full pl-9 pr-9 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-all font-medium"
                                />
                                {customImageQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setCustomImageQuery('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <button
                                type="submit"
                                disabled={isSearchingImages || !customImageQuery.trim()}
                                className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-sm cursor-pointer shrink-0"
                            >
                                {isSearchingImages ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                                <span>{isSearchingImages ? 'Buscando...' : 'Buscar'}</span>
                            </button>
                        </form>

                        {isSearchingImages ? (
                            <div className="py-14 flex flex-col items-center justify-center gap-3">
                                <Loader2 size={32} className="animate-spin text-primary-500" />
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                                    Buscando imágenes disponibles en la web...
                                </span>
                            </div>
                        ) : candidateImages.length > 0 ? (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-medium px-0.5">
                                    <span>{candidateImages.length} imágenes encontradas</span>
                                    <span className="text-[10px] text-slate-400">Haz clic en la imagen deseada para asignarla</span>
                                </div>
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-88 overflow-y-auto p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/40">
                                    {candidateImages.map((imgUrl, idx) => (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => selectCandidateImage(imgUrl)}
                                            className="group relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 hover:border-emerald-500 transition-all cursor-pointer bg-white dark:bg-slate-800 flex items-center justify-center p-2"
                                        >
                                            <img
                                                src={imgUrl}
                                                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300 rounded-lg"
                                                alt={`Candidato ${idx + 1}`}
                                                loading="lazy"
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            />
                                            <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <span className="bg-emerald-600 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-md">
                                                    <CheckCircle2 size={12} />
                                                    Asignar
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="py-12 px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-2 bg-slate-50/50 dark:bg-slate-800/30">
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    No se encontraron imágenes candidatas
                                </p>
                                <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                                    Simplifica el término en el buscador superior (ej. marca y presentación).
                                </p>
                            </div>
                        )}

                        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setAiSearchItem(null)}
                                className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Selector de Escáneres */}
            <PrinterScanModal
                isOpen={showPrinterModal}
                onClose={() => setShowPrinterModal(false)}
                onScan={handleExecuteScan}
                isScanning={isScanningPrinter}
            />

            {/* Modal de Cámara */}
            <CameraScanModal
                isOpen={showCameraModal}
                onClose={() => setShowCameraModal(false)}
                onCapture={(capturedFile) => handleFile(capturedFile)}
            />

            {/* Modal Visor de Factura Real */}
            <InvoiceViewerModal
                isOpen={showInvoiceViewer}
                onClose={() => setShowInvoiceViewer(false)}
                invoiceUrl={invoiceUrl}
                title="Documento Original Digitalizado"
                details={{
                    referenceNumber: referenceNumber || 'Importador',
                    supplierName: suppliers.find(s => String(s.id) === String(selectedSupplierId))?.name || detectedSupplierLabel || '',
                    date: invoiceDate || getLocalDateISO()
                }}
            />

            {/* Modal Visor de Imagen de Producto */}
            {previewProductImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setPreviewProductImage(null)}
                >
                    <div
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-lg w-full shadow-xl space-y-4 animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div className="min-w-0 pr-4">
                                <span className="text-[10px] font-semibold text-primary-500 uppercase tracking-wider block">Vista Previa de Imagen</span>
                                <h3 className="text-sm font-bold text-slate-800 dark:text-white leading-tight truncate mt-0.5">
                                    {previewProductImage.item?.externalName || previewProductImage.item?.matchedProduct?.name || 'Producto'}
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPreviewProductImage(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="relative aspect-square max-h-80 w-full rounded-lg overflow-hidden bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-slate-800 flex items-center justify-center p-3">
                            <img
                                src={previewProductImage.imageUrl?.startsWith('http') ? previewProductImage.imageUrl : `${api.defaults.baseURL || ''}${previewProductImage.imageUrl.startsWith('/') ? '' : '/'}${previewProductImage.imageUrl}`}
                                className="max-w-full max-h-full object-contain rounded-xl"
                                alt=""
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const idx = previewProductImage.index;
                                        const itm = previewProductImage.item;
                                        setPreviewProductImage(null);
                                        openAiImageSearch(idx, itm);
                                    }}
                                    className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    <Search size={14} />
                                    <span>Buscar en Web</span>
                                </button>

                                <label className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer">
                                    <Upload size={14} />
                                    <span>Cambiar Imagen</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                            const upFile = e.target.files?.[0];
                                            if (!upFile) return;
                                            try {
                                                const base64 = await normalizeProductImage(upFile, { size: 500, mode: 'contain' });
                                                const { data } = await api.post('/products/upload-image', { base64 });
                                                const uri = data.imageUri || data.filename;
                                                updateItemProperty(previewProductImage.index, 'image', uri);
                                                setPreviewProductImage(prev => ({ ...prev, imageUrl: uri }));
                                                toast.success('Imagen actualizada');
                                            } catch (_e) {
                                                toast.error('Error al subir la imagen');
                                            }
                                        }}
                                    />
                                </label>
                            </div>

                            <button
                                type="button"
                                onClick={() => {
                                    updateItemProperty(previewProductImage.index, 'image', null);
                                    setPreviewProductImage(null);
                                    toast.success('Imagen eliminada');
                                }}
                                className="px-3.5 py-2.5 text-red-500 hover:bg-red-500/10 border border-red-500/30 rounded-xl font-black text-xs uppercase tracking-wider transition-colors cursor-pointer"
                            >
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal de Asentamiento Contable y Cuentas por Pagar */}
            <InvoiceSettlementModal
                isOpen={isSettlementModalOpen}
                onClose={() => setIsSettlementModalOpen(false)}
                onConfirm={(config) => applyUpdates(config)}
                isSaving={isSaving}
                summary={{
                    totalUsd: (docTotals.total > 0 && docCurrency === 'BS' && systemRate > 0)
                        ? roundExact(docTotals.total / systemRate, 2)
                        : (docTotals.total > 0 && docCurrency === 'USD' ? roundExact(docTotals.total, 2) : liveSummary.totalUsd),
                    totalBs: (docTotals.total > 0 && docCurrency === 'BS')
                        ? roundExact(docTotals.total, 2)
                        : (docTotals.total > 0 && docCurrency === 'USD' && systemRate > 0 ? roundExact(docTotals.total * systemRate, 2) : liveSummary.totalBs),
                    exchangeRate: systemRate,
                    itemCount: liveSummary.readyCount,
                    totalUnits: liveSummary.totalUnits,
                    referenceNumber: referenceNumber,
                    invoiceDate: invoiceDate,
                    invoiceUrl: invoiceUrl,
                    detectedSupplierName: detectedSupplierLabel,
                    detectedSupplierRif: detectedSupplierRif,
                    detectedSupplierId: selectedSupplierId
                }}
                suppliers={suppliers}
                initialSupplierId={selectedSupplierId}
            />

            {/* Modal Deslizable Lateral: Historial de Facturas Cargadas */}
            <ImportedInvoicesDrawer
                isOpen={isHistoryDrawerOpen}
                onClose={() => setIsHistoryDrawerOpen(false)}
                onViewInvoice={handleViewInvoiceFromHistory}
                onLoadInvoiceIntoImporter={handleLoadInvoiceIntoImporter}
            />
        </div>
    );
}
