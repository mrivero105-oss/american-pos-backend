import { useState, useEffect, useMemo, useRef } from 'react';
import { 
    X, TrendingDown, Package, Search, AlertTriangle, CheckCircle2, 
    Calendar, User, DollarSign, FileSpreadsheet, Printer, RefreshCw, 
    Flame, Clock, Filter, ArrowDownRight, Layers, FileText, Check, ShieldAlert,
    Loader2
} from 'lucide-react';
import BaseModal from './BaseModal';
import { formatMoney, formatStock } from '../utils/format';
import { getImageUrl } from '../utils/imageUtils';
import api from '../services/api';
import { db } from '../services/db';
import localDb from '../db/localDb';
import toast from 'react-hot-toast';

export default function WasteManagementModal({ 
    isOpen, 
    onClose, 
    products = [], 
    initialProduct = null,
    onProductUpdated,
    user,
    settings 
}) {
    const [activeTab, setActiveTab] = useState('register'); // 'register' | 'history'
    
    // Form state (Registro de Merma)
    const [selectedProduct, setSelectedProduct] = useState(initialProduct);
    const [selectedPresentation, setSelectedPresentation] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [localProducts, setLocalProducts] = useState([]);
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('rotura');
    const [notes, setNotes] = useState('');
    const [responsibleName, setResponsibleName] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // History state
    const [history, setHistory] = useState([]);
    const [summary, setSummary] = useState({ totalUnits: 0, totalCostUSD: 0, totalRecords: 0, byCategory: {} });
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [dateFilter, setDateFilter] = useState('month'); // 'today' | '7d' | 'month' | 'all'
    const [reasonFilter, setReasonFilter] = useState('all');
    const [historySearch, setHistorySearch] = useState('');

    const searchInputRef = useRef(null);
    // Cargar presentaciones del producto si no están presentes
    useEffect(() => {
        if (selectedProduct && selectedProduct.id && (!selectedProduct.Presentations || selectedProduct.Presentations.length === 0)) {
            api.get(`/products/${selectedProduct.id}`).then(res => {
                if (res.data?.Presentations && res.data.Presentations.length > 0) {
                    setSelectedProduct(prev => prev && prev.id === res.data.id ? { ...prev, Presentations: res.data.Presentations } : prev);
                }
            }).catch(() => {});
        }
    }, [selectedProduct?.id]);


    // Sync initial product and default responsible
    useEffect(() => {
        if (isOpen) {
            setSelectedProduct(initialProduct);
            setSelectedPresentation(null);
            setResponsibleName(user?.name || user?.username || 'Administrador');
            setQuantity('');
            setNotes('');
            setReason('rotura');
            setSearchQuery('');
            if (activeTab === 'history') {
                fetchHistory();
            }
        }
    }, [isOpen, initialProduct, user]);

    useEffect(() => {
        if (isOpen && activeTab === 'history') {
            fetchHistory();
        }
    }, [activeTab, dateFilter, reasonFilter]);

    // Motivos predefinidos para auditoría
    const reasonsConfig = [
        { 
            id: 'rotura', 
            label: 'Rotura / Daño', 
            icon: '💥', 
            color: 'text-rose-500 bg-rose-500/10 border-rose-500/30',
            badgeBg: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-300 dark:border-rose-800',
            desc: 'Mercancía quebrada, dañada en transporte o góndola' 
        },
        { 
            id: 'caducidad', 
            label: 'Caducidad / Vencimiento', 
            icon: '⏳', 
            color: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
            badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-800',
            desc: 'Producto vencido o descompuesto retirado de venta' 
        },
        { 
            id: 'consumo_interno', 
            label: 'Consumo / Uso Interno', 
            icon: '🏢', 
            color: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
            badgeBg: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-300 dark:border-blue-800',
            desc: 'Artículos de limpieza, consumo del personal o tienda' 
        },
        { 
            id: 'merma', 
            label: 'Merma Operativa', 
            icon: '📉', 
            color: 'text-violet-500 bg-violet-500/10 border-violet-500/30',
            badgeBg: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300 border-violet-300 dark:border-violet-800',
            desc: 'Pérdida por peso, descongelación, desposte o corte' 
        },
        { 
            id: 'extravio', 
            label: 'Extravío / Descuadre', 
            icon: '🚨', 
            color: 'text-pink-500 bg-pink-500/10 border-pink-500/30',
            badgeBg: 'bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300 border-pink-300 dark:border-pink-800',
            desc: 'Diferencia no justificada o faltante en auditoría' 
        },
        { 
            id: 'ajuste_positivo', 
            label: 'Sobrante / Entrada', 
            icon: '➕', 
            color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
            badgeBg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
            desc: 'Mercancía física encontrada que no estaba en sistema' 
        }
    ];

    // Cargar catálogo local completo para búsqueda instantánea 0ms
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        const loadCatalog = async () => {
            try {
                let list = await db.getAll('products');
                if (!list || list.length === 0) {
                    if (localDb && localDb.products) {
                        list = await localDb.products.toArray();
                    }
                }
                if (isMounted) {
                    if (list && list.length > 0) {
                        setLocalProducts(list);
                    } else if (products && products.length > 0) {
                        setLocalProducts(products);
                    }
                }
            } catch (e) {
                console.warn('[WASTE MODAL] Fallback cargando catálogo local:', e);
                if (isMounted && products && products.length > 0) {
                    setLocalProducts(products);
                }
            }
        };
        loadCatalog();
        return () => { isMounted = false; };
    }, [isOpen, products]);

    // Búsqueda inteligente híbrida (Local 0ms + Servidor API garantizado)
    const normalizeSearchText = (str) => 
        (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    useEffect(() => {
        const query = searchQuery.trim();
        if (!query) {
            setSearchResults([]);
            setSearching(false);
            return;
        }

        const normQuery = normalizeSearchText(query);
        const searchTokens = normQuery.split(/\s+/).filter(Boolean);

        // 1. Filtrado local inmediato en catálogo completo (0ms)
        const catalogPool = localProducts.length > 0 ? localProducts : products;
        const localMatches = catalogPool.filter(p => {
            const name = normalizeSearchText(p.name || p.nombre);
            const barcode = normalizeSearchText(p.barcode || p.codigo_barras);
            const sku = normalizeSearchText(p.sku);
            return searchTokens.every(token => name.includes(token) || barcode.includes(token) || sku.includes(token));
        }).slice(0, 20);

        setSearchResults(localMatches);
        setSearching(true);

        // 2. Búsqueda en API con debounce para abarcar todo el catálogo en backend
        const timer = setTimeout(async () => {
            try {
                const res = await api.get('/products', {
                    params: {
                        search: query,
                        limit: 30
                    }
                });
                const serverItems = res.data?.products || (Array.isArray(res.data) ? res.data : []);
                
                // Unir sin duplicados priorizando coincidencia
                const itemMap = new Map();
                localMatches.forEach(item => {
                    if (item && item.id) itemMap.set(String(item.id), item);
                });
                serverItems.forEach(item => {
                    if (item && item.id) itemMap.set(String(item.id), item);
                });

                setSearchResults(Array.from(itemMap.values()).slice(0, 30));
            } catch (err) {
                console.warn('[WASTE MODAL] Búsqueda remota API error:', err.message);
            } finally {
                setSearching(false);
            }
        }, 200);

        return () => clearTimeout(timer);
    }, [searchQuery, localProducts, products]);

    // Cálculos de impacto financiero con factor de conversión
    const factor = selectedPresentation ? (parseFloat(selectedPresentation.factorConversion) || 1) : 1;
    const numQty = parseFloat(quantity) || 0;
    const baseUnits = numQty * factor;
    const currentStock = selectedProduct ? Number(selectedProduct.stockQuantity || selectedProduct.stock || 0) : 0;
    const unitCost = selectedProduct ? Number(selectedProduct.cost || 0) : 0;
    const unitPrice = selectedPresentation ? Number(selectedPresentation.price || 0) : (selectedProduct ? Number(selectedProduct.price || 0) : 0);
    
    const isPositive = reason === 'ajuste_positivo';
    const projectedStock = isPositive ? currentStock + baseUnits : Math.max(0, currentStock - baseUnits);
    const totalCostLoss = unitCost * baseUnits;
    const totalRetailLoss = unitPrice * numQty;

    // Helper format money
    const renderMoney = (amount, currency = 'USD') => {
        return formatMoney(amount, currency, settings);
    };

    // Consultar historial
    const fetchHistory = async () => {
        try {
            setLoadingHistory(true);
            const params = {};
            
            const now = new Date();
            if (dateFilter === 'today') {
                const todayStr = now.toISOString().split('T')[0];
                params.startDate = todayStr;
                params.endDate = todayStr;
            } else if (dateFilter === '7d') {
                const past = new Date(now.setDate(now.getDate() - 7));
                params.startDate = past.toISOString().split('T')[0];
            } else if (dateFilter === 'month') {
                const past = new Date(now.setMonth(now.getMonth() - 1));
                params.startDate = past.toISOString().split('T')[0];
            }

            if (reasonFilter !== 'all') {
                params.reason = reasonFilter;
            }

            if (historySearch.trim()) {
                params.search = historySearch.trim();
            }

            const res = await api.get('/products/waste/history', { params });
            setHistory(res.data.movements || []);
            setSummary(res.data.summary || { totalUnits: 0, totalCostUSD: 0, totalRecords: 0, byCategory: {} });
        } catch (error) {
            console.error('Error fetching waste history:', error);
            toast.error('Error al cargar historial de mermas');
        } finally {
            setLoadingHistory(false);
        }
    };

    // Guardar merma / baja
    const handleSubmitWaste = async (e) => {
        e.preventDefault();
        if (!selectedProduct) {
            return toast.error('Seleccione un producto para registrar la merma');
        }
        if (numQty <= 0) {
            return toast.error('Ingrese una cantidad válida mayor a 0');
        }
        if (!notes.trim() || notes.trim().length < 3) {
            return toast.error('Ingrese una justificación detallada para la auditoría (mínimo 3 caracteres)');
        }

        try {
            setSubmitting(true);
            const payload = {
                quantity: numQty,
                factorConversion: factor,
                presentationId: selectedPresentation?.id || null,
                presentationName: selectedPresentation?.name || null,
                reason,
                notes: notes.trim(),
                responsibleName: responsibleName.trim() || user?.name || user?.username,
                costPrice: unitCost
            };

            const res = await api.post(`/products/${selectedProduct.id}/waste`, payload);
            toast.success(`Merma registrada: -${numQty} unidades (${reasonsConfig.find(r => r.id === reason)?.label || reason})`);
            
            if (onProductUpdated && res.data.product) {
                onProductUpdated(res.data.product);
            }

            // Reset form
            setQuantity('');
            setNotes('');
            setSelectedProduct(null);
            setSearchQuery('');
            setSearchResults([]);
            
            // Refrescar historial
            fetchHistory();
        } catch (error) {
            console.error('Error recording waste:', error);
            const msg = error.response?.data?.error || error.message || 'Error al registrar la merma';
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    // Exportar Excel
    const handleExportExcel = async () => {
        try {
            toast.loading('Descargando reporte de mermas...', { id: 'waste-export' });
            const res = await api.get('/products/waste/export', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `auditoria_mermas_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            toast.success('Reporte de auditoría exportado con éxito', { id: 'waste-export' });
        } catch (error) {
            console.error('Error exporting waste excel:', error);
            toast.error('Error al exportar a Excel', { id: 'waste-export' });
        }
    };

    // Imprimir acta de baja física
    const handlePrintAuditSheet = () => {
        window.print();
    };

    if (!isOpen) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-4xl"
            className="overflow-hidden flex flex-col border border-slate-200 dark:border-white/10 max-h-[92dvh] pb-safe"
        >
            {/* Header */}
            <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-white/10 bg-slate-50/70 dark:bg-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 font-black shrink-0">
                        <TrendingDown size={22} />
                    </div>
                    <div>
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase leading-none">
                            Módulo de Mermas & Pérdidas
                        </h2>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">
                            Auditoría de Desperdicios, Roturas y Consumo Interno
                        </p>
                    </div>
                </div>

                {/* Tabs Switcher */}
                <div className="flex items-center gap-1.5 bg-slate-200/60 dark:bg-white/10 p-1 rounded-xl">
                    <button
                        type="button"
                        onClick={() => setActiveTab('register')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                            activeTab === 'register' 
                                ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm' 
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        Registrar Pérdida
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('history')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                            activeTab === 'history' 
                                ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm' 
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <span>Auditoría & Historial</span>
                        {summary.totalRecords > 0 && (
                            <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center font-bold">
                                {summary.totalRecords}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* TAB 1: REGISTRAR MERMA / PÉRDIDA */}
            {activeTab === 'register' && (
                <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
                    {/* 1. Seleccionar Producto */}
                    {!selectedProduct ? (
                        <div className="space-y-3">
                            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                1. Seleccione el Producto a Dar de Baja
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar por nombre, código de barra o SKU..."
                                    className="w-full pl-10 pr-10 py-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl text-xs sm:text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                                    autoFocus
                                />
                                {searching ? (
                                    <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 text-rose-500 animate-spin" size={18} />
                                ) : searchQuery ? (
                                    <button 
                                        type="button" 
                                        onClick={() => {
                                            setSearchQuery('');
                                            setSearchResults([]);
                                            searchInputRef.current?.focus();
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-full hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                                    >
                                        <X size={16} />
                                    </button>
                                ) : null}
                            </div>

                            {/* Resultados de búsqueda */}
                            {searchResults.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1.5 border border-slate-200 dark:border-white/10 rounded-2xl bg-slate-50/50 dark:bg-white/5">
                                    {searchResults.map(prod => (
                                        <button
                                            key={prod.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedProduct(prod);
                                                setSearchQuery('');
                                                setSearchResults([]);
                                            }}
                                            className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-white/10 text-left transition-all cursor-pointer group hover:shadow-sm"
                                        >
                                            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-white/10 overflow-hidden flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-white/5">
                                                {prod.imageUri ? (
                                                    <img src={getImageUrl(prod.imageUri)} alt={prod.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <Package size={18} className="text-slate-400 group-hover:text-rose-500 transition-colors" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-bold text-xs text-slate-900 dark:text-white truncate uppercase group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                                                    {prod.name || prod.nombre}
                                                </h4>
                                                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold mt-0.5">
                                                    <span>Stock: {formatStock(prod.stockQuantity ?? prod.stock ?? prod.stock_total ?? 0)}</span>
                                                    <span>•</span>
                                                    <span>Costo: ${Number(prod.cost || 0).toFixed(2)}</span>
                                                    {prod.barcode && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="font-mono text-[9px] text-slate-400 truncate max-w-[80px]">{prod.barcode}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : searchQuery.trim().length > 0 ? (
                                <div className="p-6 text-center border border-dashed border-slate-200 dark:border-white/10 rounded-2xl bg-slate-50/50 dark:bg-white/5">
                                    {searching ? (
                                        <div className="flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                                            <Loader2 className="animate-spin text-rose-500" size={18} />
                                            <span className="text-xs font-bold">Buscando "{searchQuery}" en todo el catálogo...</span>
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            <Package size={26} className="mx-auto text-slate-300 dark:text-slate-600 mb-1" />
                                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                                No se encontraron productos para "{searchQuery}"
                                            </p>
                                            <p className="text-[11px] text-slate-400">
                                                Verifica la ortografía o intenta buscar por código de barra o SKU
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        /* Card de Producto Seleccionado */
                        <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-rose-500/10 via-amber-500/5 to-transparent border border-rose-500/20">
                            <div className="flex items-center gap-3.5 min-w-0">
                                <div className="w-12 h-12 rounded-xl bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                    {selectedProduct.imageUri ? (
                                        <img src={getImageUrl(selectedProduct.imageUri)} alt={selectedProduct.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <Package size={22} className="text-slate-400" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-widest bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                                            Producto Activo
                                        </span>
                                        {selectedProduct.barcode && (
                                            <span className="text-[10px] font-mono text-slate-400 font-bold truncate">
                                                BAR: {selectedProduct.barcode}
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white uppercase truncate mt-0.5">
                                        {selectedProduct.name}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-600 dark:text-slate-300 mt-1">
                                        <span>Stock: <strong className="text-slate-900 dark:text-white font-mono">{formatStock(currentStock)} {selectedProduct.stockUnit || 'UND'}</strong></span>
                                        <span>•</span>
                                        <span>Costo: <strong className="text-slate-900 dark:text-white font-mono">${unitCost.toFixed(2)}</strong></span>
                                        <span>•</span>
                                        <span>Precio: <strong className="text-slate-900 dark:text-white font-mono">${unitPrice.toFixed(2)}</strong></span>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedProduct(null)}
                                className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold border border-slate-200 dark:border-white/10 transition-all cursor-pointer shrink-0"
                            >
                                Cambiar
                            </button>
                        </div>
                    )}

                    {/* 2. Selector de Causa / Motivo de Pérdida */}
                    <div className="space-y-2">
                        <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                            2. Seleccione el Motivo Específico de Pérdida
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {reasonsConfig.map(r => (
                                <button
                                    key={r.id}
                                    type="button"
                                    onClick={() => setReason(r.id)}
                                    className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                        reason === r.id 
                                            ? 'bg-rose-500/10 dark:bg-rose-500/20 border-rose-500 shadow-md ring-2 ring-rose-500/20' 
                                            : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-white/10 hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-lg">{r.icon}</span>
                                        {reason === r.id && <Check size={16} className="text-rose-500" strokeWidth={3} />}
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase leading-tight">
                                            {r.label}
                                        </h4>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium line-clamp-1 mt-0.5">
                                            {r.desc}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 3. Cantidad e Impacto Financiero en Vivo */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Selector opcional de Presentación */}
                        {selectedProduct?.Presentations && selectedProduct.Presentations.length > 0 && (
                            <div className="space-y-1.5 sm:col-span-2 mb-1">
                                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                    Empaque / Presentación de la Baja
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedPresentation(null)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                            !selectedPresentation
                                                ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                                                : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                                        }`}
                                    >
                                        Unidad Base ({selectedProduct.stockUnit || 'UND'} x1)
                                    </button>
                                    {selectedProduct.Presentations.map(pres => (
                                        <button
                                            key={pres.id}
                                            type="button"
                                            onClick={() => setSelectedPresentation(pres)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                                selectedPresentation?.id === pres.id
                                                    ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                                                    : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                                            }`}
                                        >
                                            {pres.name} (x{pres.factorConversion})
                                        </button>
                                    ))}
                                </div>
                                {selectedPresentation && (
                                    <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                                        1 {selectedPresentation.name} descontará {selectedPresentation.factorConversion} {selectedProduct.stockUnit || 'unidades base'} en inventario
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                3. Cantidad a Dar de Baja ({selectedPresentation ? selectedPresentation.name : (selectedProduct?.stockUnit || 'UND')})
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="any"
                                    min="0.001"
                                    value={quantity}
                                    onChange={(e) => setQuantity(e.target.value)}
                                    placeholder="Ej: 2"
                                    className="w-full px-4 py-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl text-lg font-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400 uppercase">
                                    {selectedProduct?.stockUnit || 'UND'}
                                </span>
                            </div>
                            {selectedProduct && (
                                <p className="text-[11px] font-bold text-slate-500">
                                    Stock resultante: <strong className="text-slate-900 dark:text-white font-mono">{formatStock(projectedStock)} {selectedProduct.stockUnit || 'UND'}</strong>
                                </p>
                            )}
                        </div>

                        {/* Impacto Financiero */}
                        <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-100/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex flex-col justify-center">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                Impacto Financiero de la Pérdida
                            </span>
                            <div className="mt-1 flex items-baseline gap-2">
                                <span className="text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400">
                                    ${totalCostLoss.toFixed(2)}
                                </span>
                                <span className="text-xs font-bold text-slate-500">
                                    al Costo
                                </span>
                            </div>
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1">
                                Valor comercial dejado de percibir: <strong className="text-slate-800 dark:text-slate-200">${totalRetailLoss.toFixed(2)}</strong>
                            </p>
                        </div>
                    </div>

                    {/* 4. Justificación de Auditoría Obligatoria */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                4. Justificación Obligatoria para Auditoría *
                            </label>
                            <span className="text-[10px] font-bold text-slate-400">
                                Mínimo 3 caracteres ({notes.trim().length} ingresados)
                            </span>
                        </div>
                        <textarea
                            rows={3}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Describa el motivo exacto para auditoría (ej: 2 botellas quebradas por caída de anaquel al reponer, empaque roto durante descarga, etc.)..."
                            className="w-full px-4 py-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl text-xs sm:text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                        />
                    </div>

                    {/* 5. Responsable */}
                    <div className="space-y-2">
                        <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                            5. Responsable / Autorizado por
                        </label>
                        <div className="relative">
                            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                value={responsibleName}
                                onChange={(e) => setResponsibleName(e.target.value)}
                                placeholder="Nombre del auditor o supervisor..."
                                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                            />
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="pt-2">
                        <button
                            type="button"
                            onClick={handleSubmitWaste}
                            disabled={submitting || !selectedProduct || numQty <= 0 || notes.trim().length < 3}
                            className="w-full py-4 px-6 bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 hover:from-rose-500 hover:to-red-600 disabled:opacity-50 text-white rounded-2xl font-black text-xs sm:text-sm uppercase tracking-wider transition-all shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                        >
                            {submitting ? (
                                <RefreshCw size={18} className="animate-spin" />
                            ) : (
                                <TrendingDown size={18} />
                            )}
                            <span>{submitting ? 'Procesando Baja...' : 'Registrar Pérdida y Descontar del Stock'}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* TAB 2: AUDITORÍA & HISTORIAL */}
            {activeTab === 'history' && (
                <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 custom-scrollbar">
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20">
                            <span className="text-[9px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
                                Pérdida Total (Costo)
                            </span>
                            <h3 className="text-lg sm:text-xl font-black text-rose-700 dark:text-rose-300 mt-1">
                                ${summary.totalCostUSD.toFixed(2)}
                            </h3>
                        </div>
                        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                            <span className="text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                Unidades Dadas de Baja
                            </span>
                            <h3 className="text-lg sm:text-xl font-black text-amber-700 dark:text-amber-300 mt-1">
                                {summary.totalUnits} <span className="text-xs font-bold text-amber-500">unds</span>
                            </h3>
                        </div>
                        <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20">
                            <span className="text-[9px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                Total Registros
                            </span>
                            <h3 className="text-lg sm:text-xl font-black text-blue-700 dark:text-blue-300 mt-1">
                                {summary.totalRecords}
                            </h3>
                        </div>
                        <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex flex-col justify-center">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleExportExcel}
                                    className="flex-1 py-2 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                                    title="Exportar planilla Excel para contador o auditor"
                                >
                                    <FileSpreadsheet size={13} /> Excel
                                </button>
                                <button
                                    onClick={fetchHistory}
                                    className="p-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-700 dark:text-white rounded-xl transition-all cursor-pointer"
                                    title="Refrescar datos"
                                >
                                    <RefreshCw size={13} className={loadingHistory ? 'animate-spin' : ''} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Filtros */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-slate-50 dark:bg-white/5 p-2.5 rounded-2xl border border-slate-200 dark:border-white/10">
                        {/* Rango de Fecha */}
                        <div className="flex items-center gap-1 overflow-x-auto">
                            {[
                                { id: 'today', label: 'Hoy' },
                                { id: '7d', label: '7 Días' },
                                { id: 'month', label: 'Este Mes' },
                                { id: 'all', label: 'Todo' }
                            ].map(btn => (
                                <button
                                    key={btn.id}
                                    type="button"
                                    onClick={() => setDateFilter(btn.id)}
                                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                        dateFilter === btn.id 
                                            ? 'bg-rose-500 text-white shadow-sm' 
                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                                    }`}
                                >
                                    {btn.label}
                                </button>
                            ))}
                        </div>

                        {/* Filtro por Motivo */}
                        <select
                            value={reasonFilter}
                            onChange={(e) => setReasonFilter(e.target.value)}
                            className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none"
                        >
                            <option value="all">Todos los Motivos</option>
                            <option value="rotura">Rotura / Daño</option>
                            <option value="caducidad">Caducidad / Vencimiento</option>
                            <option value="consumo_interno">Consumo Interno</option>
                            <option value="merma">Merma Operativa</option>
                            <option value="extravio">Extravío / Descuadre</option>
                            <option value="ajuste_positivo">Sobrante / Entrada</option>
                        </select>

                        {/* Buscador de texto */}
                        <div className="relative flex-1 sm:max-w-xs">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                            <input
                                type="text"
                                value={historySearch}
                                onChange={(e) => setHistorySearch(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && fetchHistory()}
                                placeholder="Buscar en historial..."
                                className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none"
                            />
                        </div>
                    </div>

                    {/* Tabla de Historial */}
                    {loadingHistory ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3">
                            <RefreshCw size={24} className="animate-spin text-rose-500" />
                            <span className="text-xs font-bold text-slate-500">Cargando registros de auditoría...</span>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 space-y-2">
                            <ShieldAlert size={36} className="mx-auto text-slate-300 dark:text-slate-600" />
                            <p className="text-xs font-bold uppercase tracking-wider">No hay mermas registradas en este período</p>
                        </div>
                    ) : (
                        <div className="border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden bg-white dark:bg-slate-900/60 shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                            <th className="px-3.5 py-3">Fecha</th>
                                            <th className="px-3.5 py-3">Producto</th>
                                            <th className="px-3.5 py-3">Motivo</th>
                                            <th className="px-3.5 py-3 text-center">Baja</th>
                                            <th className="px-3.5 py-3 text-right">Pérdida ($)</th>
                                            <th className="px-3.5 py-3">Justificación de Auditoría</th>
                                            <th className="px-3.5 py-3">Responsable</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                        {history.map((mov) => {
                                            const reasonConf = reasonsConfig.find(r => r.id === mov.category || r.label === mov.reason) || {
                                                label: mov.reason || 'Merma',
                                                badgeBg: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                                            };
                                            const dateObj = new Date(mov.date || mov.createdAt || Date.now());
                                            const formattedDate = dateObj.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
                                            const formattedTime = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

                                            return (
                                                <tr key={mov.id} className="hover:bg-slate-50/80 dark:hover:bg-white/5 transition-colors">
                                                    <td className="px-3.5 py-3 whitespace-nowrap">
                                                        <div className="font-bold text-slate-900 dark:text-white">{formattedDate}</div>
                                                        <div className="text-[10px] text-slate-400 font-mono">{formattedTime}</div>
                                                    </td>
                                                    <td className="px-3.5 py-3 max-w-[200px]">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                                                {mov.Product?.imageUri ? (
                                                                    <img src={getImageUrl(mov.Product.imageUri)} alt="" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <Package size={14} className="text-slate-400" />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <h4 className="font-black text-slate-900 dark:text-white truncate uppercase">
                                                                    {mov.Product?.name || 'Producto'}
                                                                </h4>
                                                                <span className="text-[10px] font-mono text-slate-400 font-bold block truncate">
                                                                    {mov.Product?.barcode || mov.Product?.id || ''}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-3.5 py-3 whitespace-nowrap">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${reasonConf.badgeBg}`}>
                                                            {reasonConf.label}
                                                        </span>
                                                    </td>
                                                    <td className="px-3.5 py-3 text-center whitespace-nowrap font-mono font-black text-rose-600 dark:text-rose-400">
                                                        -{formatStock(mov.quantity)} {mov.Product?.stockUnit || 'UND'}
                                                    </td>
                                                    <td className="px-3.5 py-3 text-right whitespace-nowrap font-mono font-black text-slate-900 dark:text-white">
                                                        ${(Number(mov.totalCost) || (Number(mov.quantity) * Number(mov.costPrice || mov.Product?.cost || 0))).toFixed(2)}
                                                    </td>
                                                    <td className="px-3.5 py-3 max-w-xs text-[11px] text-slate-600 dark:text-slate-300 italic">
                                                        "{mov.notes || mov.reason || 'Sin justificación'}"
                                                    </td>
                                                    <td className="px-3.5 py-3 whitespace-nowrap text-[11px] font-bold text-slate-700 dark:text-slate-400">
                                                        {mov.responsibleName || mov.User?.name || mov.User?.username || 'Auditor'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </BaseModal>
    );
}
