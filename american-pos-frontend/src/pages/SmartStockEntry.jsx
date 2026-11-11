import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
    Search,
    Plus,
    Trash2,
    Package,
    ShoppingCart,
    Save,
    Layers,
    Barcode,
    AlertTriangle,
    TrendingUp,
    CheckCircle2,
    Clock,
    RefreshCw,
    Check
} from 'lucide-react';
const MobileIntakeItemCard = ({ item, updateItem, removeItem, calculateTotalUnits }) => {
    return (
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm space-y-3">
            {/* Header: Product Name + Current Stock + Delete */}
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-800 dark:text-white text-sm leading-snug">
                        {item.name}
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                        Stock Actual: <span className="font-bold text-slate-600 dark:text-slate-300">{item.currentStock}</span>
                    </p>
                </div>
                <button
                    onClick={() => removeItem(item.id)}
                    className="p-2 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all active:scale-90 shrink-0 cursor-pointer"
                    title="Quitar de la lista"
                >
                    <Trash2 size={16} />
                </button>
            </div>

            {/* Type selector & Units count */}
            <div className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex bg-slate-200/70 dark:bg-slate-800 p-1 rounded-lg">
                    <button
                        type="button"
                        onClick={() => updateItem(item.id, 'type', 'units')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer ${
                            item.type === 'units'
                                ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400'
                        }`}
                    >
                        Unidades
                    </button>
                    <button
                        type="button"
                        onClick={() => updateItem(item.id, 'type', 'bulks')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer ${
                            item.type === 'bulks'
                                ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400'
                        }`}
                    >
                        {item.bulkUnitName || 'Bulto'}
                    </button>
                </div>

                <div className="text-right">
                    <span className="text-sm font-black text-slate-800 dark:text-white font-mono">
                        +{calculateTotalUnits(item)}
                    </span>
                    <span className="block text-[9px] font-bold text-slate-400 uppercase">Unid. Netas</span>
                </div>
            </div>

            {/* Quantity Stepper & Inputs */}
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Cantidad a Ingresar
                    </label>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(e) => {
                            let val = e.target.value;
                            if (typeof val === 'string') val = val.replace(',', '.');
                            updateItem(item.id, 'quantity', val);
                        }}
                        className="w-full text-center px-2 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-base font-black text-primary-600 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all font-mono"
                    />
                </div>

                <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Lote / Referencia
                    </label>
                    <input
                        type="text"
                        placeholder="Nro Lote"
                        value={item.batchNumber}
                        onChange={(e) => updateItem(item.id, 'batchNumber', e.target.value)}
                        className="w-full text-center px-2 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-base sm:text-xs min-h-[38px] sm:min-h-[32px] font-bold text-slate-700 dark:text-slate-200 outline-none uppercase"
                    />
                </div>
            </div>

            {/* Expiration date */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Vencimiento:</span>
                <input
                    type="date"
                    value={item.expirationDate}
                    onChange={(e) => updateItem(item.id, 'expirationDate', e.target.value)}
                    className="text-center px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-base sm:text-xs min-h-[38px] sm:min-h-[32px] font-bold text-slate-700 dark:text-slate-200 outline-none"
                />
            </div>
        </div>
    );
};

const MobileRadarSuggestionCard = ({ item, inQueue, isOutOfStock, statusLabel, badgeStyle, addToEntry }) => {
    return (
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm space-y-3">
            {/* Top row: Name & Urgency Badge */}
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-snug">
                        {item.name}
                    </h4>
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black border mt-1 ${badgeStyle}`}>
                        {statusLabel}
                    </div>
                </div>

                <div className="shrink-0">
                    {inQueue ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                            <Check size={14} /> En Cola
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={() => addToEntry(item, item.suggestedPurchase > 0 ? item.suggestedPurchase : 10)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 shadow-sm cursor-pointer ${
                                isOutOfStock || item.status === 'CRITICAL'
                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                    : 'bg-primary-600 hover:bg-primary-700 text-white'
                            }`}
                        >
                            <Plus size={14} /> Reponer ({item.suggestedPurchase > 0 ? item.suggestedPurchase : 10})
                        </button>
                    )}
                </div>
            </div>

            {/* 4-Metric Grid */}
            <div className="grid grid-cols-4 gap-1.5 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60 text-center">
                <div>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Stock:</span>
                    <span className={`text-xs font-black font-mono ${isOutOfStock ? 'text-red-500' : 'text-slate-700 dark:text-slate-200'}`}>
                        {item.currentStock}
                    </span>
                </div>

                <div>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Vtas 30d:</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 font-mono">
                        {item.totalSold30d}
                    </span>
                </div>

                <div>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Vel/día:</span>
                    <span className="text-xs font-bold text-indigo-500 font-mono">
                        {item.dailyVelocity}
                    </span>
                </div>

                <div>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Días:</span>
                    <span className={`text-xs font-black font-mono ${
                        isOutOfStock || Number(item.daysRemaining) === 0 ? 'text-red-500' : Number(item.daysRemaining) < 7 ? 'text-amber-500' : 'text-emerald-500'
                    }`}>
                        {isOutOfStock ? '0d' : item.daysRemaining === '∞' ? '∞' : `${item.daysRemaining}d`}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default function SmartStockEntry() {
    // Search & Intake State
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [entryItems, setEntryItems] = useState([]);
    const [saving, setSaving] = useState(false);
    const [searching, setSearching] = useState(false);
    const searchRef = useRef(null);

    // Smart Suggestions State
    const [suggestions, setSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(true);
    const [suggestionSearch, setSuggestionSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('ALL'); // 'ALL', 'CRITICAL', 'WARNING'

    // Fetch Smart Suggestions
    const fetchSuggestions = useCallback(async () => {
        try {
            setLoadingSuggestions(true);
            const res = await api.get('/stock-intelligence/suggestions');
            setSuggestions(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error('Error fetching stock intelligence:', error);
        } finally {
            setLoadingSuggestions(false);
        }
    }, []);

    useEffect(() => {
        fetchSuggestions();
    }, [fetchSuggestions]);

    // Live Product Search for Barcode/Name
    const performSearch = useCallback(async () => {
        try {
            setSearching(true);
            const res = await api.get(`/products?search=${encodeURIComponent(searchTerm)}&minimal=true&limit=5`);
            setSearchResults(Array.isArray(res.data?.products) ? res.data.products : []);
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setSearching(false);
        }
    }, [searchTerm]);

    useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            if (searchTerm.trim().length > 1) {
                performSearch();
            } else {
                setSearchResults([]);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, performSearch]);

    // Add Product to Intake Queue
    const addToEntry = (product, initialQty = null) => {
        const exists = entryItems.find(item => item.id === product.id);
        if (exists) {
            toast.error(`"${product.name}" ya está en la lista de ingreso`);
            return;
        }

        const defaultQty = initialQty !== null && initialQty > 0 
            ? initialQty 
            : (product.suggestedPurchase > 0 ? product.suggestedPurchase : 1);

        setEntryItems(prev => [...prev, {
            id: product.id,
            name: product.name,
            currentStock: product.currentStock !== undefined ? product.currentStock : (product.stockQuantity || 0),
            unitsPerBulk: product.unitsPerBulk || 1,
            bulkUnitName: product.bulkUnitName || 'Bulto',
            quantity: defaultQty,
            type: 'units', // 'units' or 'bulks'
            batchNumber: '',
            expirationDate: ''
        }]);

        setSearchTerm('');
        setSearchResults([]);
        toast.success(`Añadido "${product.name}" a la lista de ingreso`);
    };

    // 1-Click Auto-Fill with All Critical Items
    const handleAutoFillCritical = () => {
        const criticalItems = suggestions.filter(s => (s.status === 'CRITICAL' || s.currentStock <= 0));
        if (criticalItems.length === 0) {
            toast.success('No hay productos en estado crítico actualmente');
            return;
        }

        let addedCount = 0;
        setEntryItems(prev => {
            const currentIds = new Set(prev.map(i => i.id));
            const newItems = [];

            criticalItems.forEach(s => {
                if (!currentIds.has(s.id)) {
                    newItems.push({
                        id: s.id,
                        name: s.name,
                        currentStock: s.currentStock,
                        unitsPerBulk: s.unitsPerBulk || 1,
                        bulkUnitName: s.bulkUnitName || 'Bulto',
                        quantity: s.suggestedPurchase > 0 ? s.suggestedPurchase : 10,
                        type: 'units',
                        batchNumber: '',
                        expirationDate: ''
                    });
                    addedCount++;
                }
            });

            return [...prev, ...newItems];
        });

        if (addedCount > 0) {
            toast.success(`Se agregaron ${addedCount} productos críticos a la lista de ingreso`);
        } else {
            toast('Todos los productos críticos ya estaban en la lista de ingreso');
        }
    };

    const removeItem = (id) => {
        setEntryItems(prev => prev.filter(item => item.id !== id));
    };

    const updateItem = (id, field, value) => {
        setEntryItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ));
    };

    const calculateTotalUnits = (item) => {
        const qty = parseFloat(item.quantity) || 0;
        if (item.type === 'bulks') {
            const upb = parseFloat(item.unitsPerBulk) || 1;
            return Math.round(qty * upb * 1000) / 1000;
        }
        return Math.round(qty * 1000) / 1000;
    };

    const totalQueueUnits = entryItems.reduce((acc, item) => acc + calculateTotalUnits(item), 0);

    // Save All Stock Intake
    const handleSave = async () => {
        if (entryItems.length === 0) {
            toast.error('La lista de ingreso está vacía');
            return;
        }

        try {
            setSaving(true);
            const payload = {
                items: entryItems.map(item => ({
                    productId: item.id,
                    quantity: parseFloat(item.quantity) || 0,
                    type: item.type,
                    batchNumber: item.batchNumber,
                    expirationDate: item.expirationDate
                }))
            };

            await api.post('/products/bulk-stock-increase', payload);
            toast.success('¡Mercancía ingresada y registrada en Kardex correctamente!');
            setEntryItems([]);
            fetchSuggestions();
        } catch (error) {
            console.error('Save error:', error);
            toast.error('Error al procesar ingreso: ' + (error.response?.data?.error || error.message));
        } finally {
            setSaving(false);
        }
    };

    // Barcode Scanner Enter Key
    const handleSearchKeyDown = async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const term = searchTerm.trim();
            if (!term) return;

            if (searchResults.length > 0) {
                const exact = searchResults.find(p => p.barcode === term) || searchResults[0];
                addToEntry(exact);
                return;
            }

            try {
                setSearching(true);
                const res = await api.get(`/products?search=${encodeURIComponent(term)}&minimal=true&limit=1`);
                if (res.data?.products?.length > 0) {
                    addToEntry(res.data.products[0]);
                } else {
                    toast.error('Producto no encontrado por código de barras');
                }
            } catch (err) {
                console.error('Scan error:', err);
                toast.error('Error al buscar código');
            } finally {
                setSearching(false);
            }
        }
    };

    // Filtered suggestions for the radar table
    const filteredSuggestions = suggestions.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(suggestionSearch.toLowerCase());
        if (!matchesSearch) return false;

        if (filterStatus === 'CRITICAL') return item.status === 'CRITICAL' || item.currentStock <= 0;
        if (filterStatus === 'WARNING') return item.status === 'WARNING';
        return true;
    });

    const criticalCount = suggestions.filter(s => s.status === 'CRITICAL' || s.currentStock <= 0).length;
    const suggestedCount = suggestions.filter(s => s.suggestedPurchase > 0 || s.currentStock <= 0).length;

    return (
        <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500 pb-28 sm:pb-20 pb-safe">
            {/* Top KPI Cards & Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden group">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-lg text-rose-600 dark:text-rose-400 shrink-0">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Existencia Crítica</p>
                            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                                {criticalCount} <span className="text-xs font-medium text-slate-500">Productos</span>
                            </p>
                        </div>
                    </div>
                    {criticalCount > 0 && (
                        <button
                            onClick={handleAutoFillCritical}
                            className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-3 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold transition-colors border border-rose-200 dark:border-rose-800/40 cursor-pointer"
                        >
                            <AlertTriangle size={14} /> Cargar Críticos a la Lista ({criticalCount})
                        </button>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg text-indigo-600 dark:text-indigo-400 shrink-0">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Sugerencias Compra</p>
                            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                                {suggestedCount} <span className="text-xs font-medium text-slate-500">Por Reponer</span>
                            </p>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2.5">
                        Cálculo automático según ritmo de ventas de 30 días.
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between sm:col-span-2 lg:col-span-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg text-emerald-600 dark:text-emerald-400 shrink-0">
                            <Layers size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">En Cola de Ingreso</p>
                            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                                {entryItems.length} <span className="text-xs font-medium text-slate-500">items (+{totalQueueUnits} unid)</span>
                            </p>
                        </div>
                    </div>
                    {entryItems.length > 0 && (
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-3 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                            Confirmar Ingreso Ahora
                        </button>
                    )}
                </div>
            </div>

            {/* Unified Search & Barcode Intake Section */}
            <div className="relative z-[50]">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4">
                        <div className="flex items-center gap-2.5">
                            <Barcode className="text-primary-600 shrink-0" size={24} />
                            <div>
                                <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">Carga Rápida & Escáner</h2>
                                <p className="text-[11px] sm:text-xs text-slate-400">Escanea códigos de barra o escribe el nombre del producto</p>
                            </div>
                        </div>

                        {entryItems.length > 0 && (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-2xl font-black text-sm transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50 active:scale-95 cursor-pointer"
                            >
                                {saving ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                ) : (
                                    <><Save size={16} /> Confirmar Ingreso ({entryItems.length})</>
                                )}
                            </button>
                        )}
                    </div>

                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                            ref={searchRef}
                            type="text"
                            placeholder="Buscar por nombre o disparar código de barras con lector..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            className="w-full pl-12 pr-4 py-4 border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-primary-500 outline-none transition-all text-base font-medium"
                        />
                        {searching && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
                            </div>
                        )}
                    </div>

                    {/* Quick Search Results Dropdown */}
                    {searchResults.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 overflow-hidden z-[100] animate-in slide-in-from-top-4 duration-200">
                            {searchResults.map(p => {
                                const inQueue = entryItems.some(i => i.id === p.id);
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => addToEntry(p)}
                                        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/50 border-b border-slate-50 dark:border-slate-800 last:border-0 transition-colors group text-left"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl group-hover:scale-110 transition-transform">
                                                <Package size={20} className="text-slate-500" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-slate-800 dark:text-white">{p.name}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg flex items-center gap-1">
                                                        <Barcode size={12} /> {p.barcode || 'Sin SKU'}
                                                    </span>
                                                    <span className="text-xs text-indigo-500 font-bold">Stock Actual: {p.stockQuantity}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {inQueue ? (
                                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 rounded-xl flex items-center gap-1">
                                                    <Check size={14} /> En Cola
                                                </span>
                                            ) : (
                                                <span className="text-xs font-bold text-primary-600 bg-primary-50 dark:bg-primary-500/10 px-3 py-1.5 rounded-xl flex items-center gap-1 group-hover:bg-primary-600 group-hover:text-white transition-all">
                                                    <Plus size={14} /> Agregar
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Active Intake Table (Mercancía por Ingresar) */}
            {entryItems.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden animate-in slide-in-from-top-4 duration-300">
                    <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/50 dark:bg-slate-800/20">
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2 text-lg">
                                <ShoppingCart size={20} className="text-primary-600" /> Lista de Mercancía a Ingresar
                            </h3>
                            <p className="text-xs text-slate-400">Revisa cantidades, lotes y vencimientos antes de confirmar.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="px-3.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-black text-slate-700 dark:text-slate-200">
                                {entryItems.length} {entryItems.length === 1 ? 'producto' : 'productos'} (+{totalQueueUnits} unid)
                            </span>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-5 py-2 rounded-xl text-xs font-black transition-all shadow-md shadow-primary-500/20 disabled:opacity-50"
                            >
                                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                                Confirmar
                            </button>
                        </div>
                    </div>

                    {/* 📱 Mobile Cards View (Visible on screens < md) */}
                    <div className="md:hidden p-3 space-y-3">
                        {entryItems.map((item) => (
                            <MobileIntakeItemCard
                                key={`mobile-intake-${item.id}`}
                                item={item}
                                updateItem={updateItem}
                                removeItem={removeItem}
                                calculateTotalUnits={calculateTotalUnits}
                            />
                        ))}
                    </div>

                    {/* 🖥️ Desktop Table View (Hidden on mobile) */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                                    <th className="px-6 py-4 text-xs font-black uppercase tracking-wider">Producto</th>
                                    <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Tipo Entrada</th>
                                    <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Lote / Venc.</th>
                                    <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Cantidad</th>
                                    <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Unidades Totales</th>
                                    <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {entryItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-slate-800 dark:text-white">{item.name}</p>
                                            <p className="text-xs text-slate-400">Stock Actual: {item.currentStock}</p>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <div className="flex justify-center">
                                                <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex gap-1">
                                                    <button
                                                        onClick={() => updateItem(item.id, 'type', 'units')}
                                                        className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${item.type === 'units' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                                    >
                                                        Unidades
                                                    </button>
                                                    <button
                                                        onClick={() => updateItem(item.id, 'type', 'bulks')}
                                                        className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${item.type === 'bulks' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                                    >
                                                        {item.bulkUnitName}
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <div className="flex flex-col gap-1.5 items-center">
                                                <input
                                                    type="text"
                                                    placeholder="Nro Lote"
                                                    value={item.batchNumber}
                                                    onChange={(e) => updateItem(item.id, 'batchNumber', e.target.value)}
                                                    className="w-28 text-center px-2 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all uppercase"
                                                />
                                                <input
                                                    type="date"
                                                    value={item.expirationDate}
                                                    onChange={(e) => updateItem(item.id, 'expirationDate', e.target.value)}
                                                    className="w-28 text-center px-2 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all uppercase"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={item.quantity}
                                                onChange={(e) => {
                                                    let val = e.target.value;
                                                    if (typeof val === 'string') val = val.replace(',', '.');
                                                    updateItem(item.id, 'quantity', val);
                                                }}
                                                className="w-24 text-center px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-base font-black text-primary-600 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all"
                                            />
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="text-base font-black text-slate-800 dark:text-white">+{calculateTotalUnits(item)}</span>
                                            <span className="block text-[10px] font-bold text-slate-400 uppercase">Unid. Netas</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => removeItem(item.id)}
                                                className="p-2.5 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Smart Inventory & Replenishment Radar Table */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2 text-lg">
                            <TrendingUp className="text-primary-600" size={22} /> Monitoreo de Stock & Sugerencias de Reposición
                        </h3>
                        <p className="text-xs text-slate-400">Cálculo analítico basado en velocidad de ventas de los últimos 30 días.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto">
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold w-full sm:w-auto overflow-x-auto no-scrollbar">
                            <button
                                onClick={() => setFilterStatus('ALL')}
                                className={`px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] flex-1 sm:flex-none text-center rounded-lg transition-all ${filterStatus === 'ALL' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Todos
                            </button>
                            <button
                                onClick={() => setFilterStatus('CRITICAL')}
                                className={`px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] flex-1 sm:flex-none text-center rounded-lg transition-all ${filterStatus === 'CRITICAL' ? 'bg-red-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Críticos ({criticalCount})
                            </button>
                            <button
                                onClick={() => setFilterStatus('WARNING')}
                                className={`px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] flex-1 sm:flex-none text-center rounded-lg transition-all ${filterStatus === 'WARNING' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Alerta
                            </button>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
                            <div className="relative flex-1 md:w-60">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                <input
                                    type="text"
                                    placeholder="Filtrar radar..."
                                    value={suggestionSearch}
                                    onChange={(e) => setSuggestionSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl text-base sm:text-xs min-h-[44px] sm:min-h-[36px] text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>

                            <button
                                onClick={fetchSuggestions}
                                className="p-2 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-500 hover:text-primary-600 transition-colors shrink-0 cursor-pointer"
                                title="Refrescar análisis"
                            >
                                <RefreshCw size={16} className={loadingSuggestions ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* 📱 Mobile Cards View (Visible on screens < md) */}
                <div className="md:hidden p-3 space-y-3">
                    {loadingSuggestions ? (
                        Array(3).fill(0).map((_, i) => (
                            <div key={i} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 animate-pulse h-28"></div>
                        ))
                    ) : filteredSuggestions.length === 0 ? (
                        <div className="flex flex-col items-center py-10 text-slate-400 gap-2">
                            <CheckCircle2 size={32} className="opacity-30 text-emerald-500" />
                            <p className="text-xs font-bold uppercase">Todo en orden en este filtro</p>
                        </div>
                    ) : (
                        filteredSuggestions.map((item) => {
                            const inQueue = entryItems.some(i => i.id === item.id);
                            const isOutOfStock = Number(item.currentStock) <= 0;
                            const statusLabel = isOutOfStock ? 'AGOTADO' : item.status === 'CRITICAL' ? 'CRÍTICO' : item.status === 'WARNING' ? 'ALERTA' : 'ÓPTIMO';
                            const badgeStyle = isOutOfStock || item.status === 'CRITICAL'
                                ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20'
                                : item.status === 'WARNING'
                                    ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
                                    : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';

                            return (
                                <MobileRadarSuggestionCard
                                    key={`mobile-radar-${item.id}`}
                                    item={item}
                                    inQueue={inQueue}
                                    isOutOfStock={isOutOfStock}
                                    statusLabel={statusLabel}
                                    badgeStyle={badgeStyle}
                                    addToEntry={addToEntry}
                                />
                            );
                        })
                    )}
                </div>

                {/* 🖥️ Desktop Table View (Hidden on mobile) */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider">Producto</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Stock Actual</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Ventas (30d)</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Velocidad</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Días Stock</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-right">Acción de Reposición</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loadingSuggestions ? (
                                Array(5).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan="6" className="px-6 py-4">
                                            <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-full"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : filteredSuggestions.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-16 text-center">
                                        <div className="flex flex-col items-center gap-3 text-slate-400">
                                            <CheckCircle2 size={40} className="opacity-30 text-emerald-500" />
                                            <p className="text-base font-bold">Todo en orden</p>
                                            <p className="text-xs">No hay productos pendientes que coincidan con este filtro.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredSuggestions.map((item) => {
                                    const inQueue = entryItems.some(i => i.id === item.id);
                                    const isOutOfStock = Number(item.currentStock) <= 0;
                                    const statusLabel = isOutOfStock ? 'AGOTADO' : item.status === 'CRITICAL' ? 'CRÍTICO' : item.status === 'WARNING' ? 'ALERTA' : 'ÓPTIMO';
                                    const badgeStyle = isOutOfStock || item.status === 'CRITICAL'
                                        ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20'
                                        : item.status === 'WARNING'
                                            ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
                                            : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';

                                    return (
                                        <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-bold text-slate-800 dark:text-slate-100">{item.name}</p>
                                                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border mt-1 ${badgeStyle}`}>
                                                        {statusLabel}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`text-sm font-bold ${isOutOfStock ? 'text-red-500 font-black' : item.currentStock <= item.minStock ? 'text-amber-500' : 'text-slate-600 dark:text-slate-400'}`}>
                                                    {item.currentStock}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.totalSold30d}</span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5 text-slate-500 dark:text-slate-400">
                                                    <TrendingUp size={14} className="text-indigo-500" />
                                                    <span className="text-xs font-bold">{item.dailyVelocity} / día</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex flex-col items-center">
                                                    <span className={`text-sm font-black ${isOutOfStock || Number(item.daysRemaining) === 0 ? 'text-red-500' : Number(item.daysRemaining) < 3 ? 'text-red-500' : Number(item.daysRemaining) < 7 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                                        {isOutOfStock ? '0 días (Agotado)' : item.daysRemaining === '∞' ? 'Sin rotación' : `${item.daysRemaining} días`}
                                                    </span>
                                                    <Clock size={12} className="opacity-30" />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {inQueue ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                                                        <Check size={14} /> En Cola
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={() => addToEntry(item, item.suggestedPurchase > 0 ? item.suggestedPurchase : 10)}
                                                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 ${
                                                            isOutOfStock || item.status === 'CRITICAL'
                                                                ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm'
                                                                : item.suggestedPurchase > 0
                                                                    ? 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm'
                                                                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                                                        }`}
                                                    >
                                                        <Plus size={14} />
                                                        {item.suggestedPurchase > 0 ? `Reponer (+${item.suggestedPurchase})` : isOutOfStock ? 'Reponer Stock' : 'Cargar'}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
