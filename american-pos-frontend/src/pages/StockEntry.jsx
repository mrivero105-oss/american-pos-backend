import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Search,
    Plus,
    Trash2,
    Package,
    ShoppingCart,
    Save,
    ArrowLeft,
    Layers,
    Barcode
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function StockEntry() {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [entryItems, setEntryItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searching, setSearching] = useState(false);
    const searchRef = useRef(null);

    const performSearch = useCallback(async () => {
        try {
            setSearching(true);
            const res = await api.get(`/products?search=${searchTerm}&minimal=true&limit=5`);
            setSearchResults(Array.isArray(res.data.products) ? res.data.products : []);
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setSearching(false);
        }
    }, [searchTerm]);

    // Search products
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

    const addToEntry = (product) => {
        const exists = Array.isArray(entryItems) && entryItems.find(item => item.id === product.id);
        if (exists) {
            toast.error('Este producto ya está en la lista de ingreso');
            return;
        }

        setEntryItems([...entryItems, {
            id: product.id,
            name: product.name,
            currentStock: product.stockQuantity,
            unitsPerBulk: product.unitsPerBulk || 1,
            bulkUnitName: product.bulkUnitName || 'Bulto',
            quantity: 1,
            type: 'units', // 'units' or 'bulks'
            batchNumber: '',
            expirationDate: ''
        }]);
        setSearchTerm('');
        setSearchResults([]);
        searchRef.current?.focus();
    };

    const removeItem = (id) => {
        setEntryItems(Array.isArray(entryItems) ? entryItems.filter(item => item.id !== id) : []);
    };

    const updateItem = (id, field, value) => {
        setEntryItems(Array.isArray(entryItems) ? entryItems.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ) : []);
    };

    const handleSave = async () => {
        if (entryItems.length === 0) {
            toast.error('La lista de ingreso está vacía');
            return;
        }

        try {
            setLoading(true);
            const payload = {
                items: (Array.isArray(entryItems) ? entryItems : []).map(item => ({
                    productId: item.id,
                    quantity: parseFloat(item.quantity) || 0,
                    type: item.type,
                    batchNumber: item.batchNumber,
                    expirationDate: item.expirationDate
                }))
            };

            await api.post('/products/bulk-stock-increase', payload);
            toast.success('Mercancía ingresada correctamente');
            setEntryItems([]);
        } catch (error) {
            console.error('Save error:', error);
            toast.error('Error al procesar ingreso: ' + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    const calculateTotalUnits = (item) => {
        const qty = parseFloat(item.quantity) || 0;
        if (item.type === 'bulks') {
            const upb = parseFloat(item.unitsPerBulk) || 1;
            return Math.round(qty * upb * 1000) / 1000;
        }
        return Math.round(qty * 1000) / 1000;
    };

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
                    toast.error('Producto no encontrado');
                }
            } catch (err) {
                console.error('Scan error:', err);
                toast.error('Error al buscar código de barras');
            } finally {
                setSearching(false);
            }
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6 p-1 sm:p-0 pb-28 sm:pb-16 pb-safe animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 dark:text-slate-400 cursor-pointer"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                            <Layers className="text-primary-600" size={24} /> Ingreso de Mercancía
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Carga rápida de stock por unidades o bultos mayoristas.</p>
                    </div>
                </div>

                <button
                    onClick={handleSave}
                    disabled={loading || entryItems.length === 0}
                    className="w-full sm:w-auto min-h-[38px] flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-5 py-2 rounded-lg font-semibold text-xs transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                    {loading ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    ) : (
                        <><Save size={16} /> Confirmar Ingreso</>
                    )}
                </button>
            </div>

            {/* Search Section */}
            <div className="relative z-[50]">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            ref={searchRef}
                            autoFocus
                            type="text"
                            placeholder="Buscar por nombre o escanear código de barras..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary-500 outline-none transition-colors text-sm font-medium"
                        />
                        {searching && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                            </div>
                        )}
                    </div>

                    {/* Quick Search Results Dropdown */}
                    {searchResults.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 overflow-hidden z-[100] animate-in slide-in-from-top-4 duration-200">
                            {Array.isArray(searchResults) && searchResults.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => addToEntry(p)}
                                    className="w-full flex items-center justify-between p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors group cursor-pointer text-left"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                            <Package size={18} className="text-slate-500" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white text-sm">{p.name}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[11px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex items-center gap-1 font-mono">
                                                    <Barcode size={11} /> {p.barcode || 'Sin SKU'}
                                                </span>
                                                <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">Stock: {p.stockQuantity}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <Plus className="text-primary-600 opacity-0 group-hover:opacity-100 transition-opacity" size={16} />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Entry Items List */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/20">
                    <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-sm sm:text-base">
                        <ShoppingCart size={18} className="text-primary-600" /> Lista para Ingresar
                    </h3>
                    <span className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-semibold text-slate-600 dark:text-slate-300">{entryItems.length} items</span>
                </div>

                {/* 📱 Mobile Cards View (block md:hidden) */}
                <div className="block md:hidden p-3 space-y-3">
                    {entryItems.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                                <Search size={36} className="opacity-30" />
                            </div>
                            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Busca productos para empezar el ingreso</p>
                        </div>
                    ) : (
                        Array.isArray(entryItems) && entryItems.map((item) => (
                            <div key={item.id} className="p-4 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-slate-800 dark:text-white text-base truncate">{item.name}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Stock Actual: {item.currentStock}</p>
                                    </div>
                                    <button
                                        onClick={() => removeItem(item.id)}
                                        className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all cursor-pointer"
                                        title="Eliminar fila"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                </div>

                                {/* Unit / Bulk selector */}
                                <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex gap-1">
                                    <button
                                        onClick={() => updateItem(item.id, 'type', 'units')}
                                        className={`flex-1 py-2 min-h-[38px] rounded-lg text-xs font-black transition-all cursor-pointer ${item.type === 'units' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                                    >
                                        Unidades
                                    </button>
                                    <button
                                        onClick={() => updateItem(item.id, 'type', 'bulks')}
                                        className={`flex-1 py-2 min-h-[38px] rounded-lg text-xs font-black transition-all cursor-pointer ${item.type === 'bulks' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                                    >
                                        {item.bulkUnitName || 'Bulto'}
                                    </button>
                                </div>

                                {/* Batch & Expiration */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Lote</label>
                                        <input
                                            type="text"
                                            placeholder="Nro Lote"
                                            value={item.batchNumber}
                                            onChange={(e) => updateItem(item.id, 'batchNumber', e.target.value)}
                                            className="w-full text-center px-2 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-base sm:text-xs min-h-[40px] sm:min-h-[36px] font-bold text-slate-700 dark:text-slate-200 outline-none uppercase"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Vencimiento</label>
                                        <input
                                            type="date"
                                            value={item.expirationDate}
                                            onChange={(e) => updateItem(item.id, 'expirationDate', e.target.value)}
                                            className="w-full text-center px-2 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-base sm:text-xs min-h-[40px] sm:min-h-[36px] font-bold text-slate-700 dark:text-slate-200 outline-none uppercase"
                                        />
                                    </div>
                                </div>

                                {/* Quantity & Total units */}
                                <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cantidad</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            min="1"
                                            value={item.quantity}
                                            onChange={(e) => {
                                                let val = e.target.value;
                                                if (typeof val === 'string') val = val.replace(',', '.');
                                                updateItem(item.id, 'quantity', val);
                                            }}
                                            className="w-28 text-center px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-lg font-black text-primary-600 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all min-h-[44px]"
                                        />
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xl font-black text-slate-800 dark:text-white">+{calculateTotalUnits(item)}</span>
                                        <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Unid. Netas</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* 🖥️ Desktop Table View (hidden md:block) */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                                <th className="px-8 py-4 text-xs font-black uppercase tracking-wider">Producto</th>
                                <th className="px-8 py-4 text-xs font-black uppercase tracking-wider text-center">Tipo Entrada</th>
                                <th className="px-8 py-4 text-xs font-black uppercase tracking-wider text-center">Lote / Venc.</th>
                                <th className="px-8 py-4 text-xs font-black uppercase tracking-wider text-center">Cantidad</th>
                                <th className="px-8 py-4 text-xs font-black uppercase tracking-wider text-center">Unidades Totales</th>
                                <th className="px-8 py-4 text-xs font-black uppercase tracking-wider text-right"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                            {entryItems.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-16 text-center">
                                        <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
                                            <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-xl">
                                                <Search size={32} className="opacity-40" />
                                            </div>
                                            <p className="text-sm font-semibold">Busca productos para empezar el ingreso</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                Array.isArray(entryItems) && entryItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60 dark:bg-slate-800/30 transition-colors animate-in slide-in-from-left-4 duration-300">
                                        <td className="px-8 py-6">
                                            <p className="font-bold text-slate-800 dark:text-white text-lg">{item.name}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Stock Actual: {item.currentStock}</p>
                                        </td>
                                        <td className="px-8 py-6 text-center">
                                            <div className="flex justify-center">
                                                <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex gap-1">
                                                    <button
                                                        onClick={() => updateItem(item.id, 'type', 'units')}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${item.type === 'units' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                                    >
                                                        Unidades
                                                    </button>
                                                    <button
                                                        onClick={() => updateItem(item.id, 'type', 'bulks')}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${item.type === 'bulks' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                                    >
                                                        {item.bulkUnitName}
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 text-center">
                                            <div className="flex flex-col gap-2">
                                                <input
                                                    type="text"
                                                    placeholder="Nro Lote"
                                                    value={item.batchNumber}
                                                    onChange={(e) => updateItem(item.id, 'batchNumber', e.target.value)}
                                                    className="w-28 text-center px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-base sm:text-xs min-h-[36px] font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all uppercase"
                                                />
                                                <input
                                                    type="date"
                                                    value={item.expirationDate}
                                                    onChange={(e) => updateItem(item.id, 'expirationDate', e.target.value)}
                                                    className="w-28 text-center px-2 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-base sm:text-[10px] min-h-[36px] font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all uppercase"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 text-center">
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                min="1"
                                                value={item.quantity}
                                                onChange={(e) => {
                                                    let val = e.target.value;
                                                    if (typeof val === 'string') val = val.replace(',', '.');
                                                    updateItem(item.id, 'quantity', val);
                                                }}
                                                className="w-24 text-center px-4 py-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-2xl text-lg font-black text-primary-600 outline-none focus:ring-2 focus:ring-primary-500/50 transition-all"
                                            />
                                        </td>
                                        <td className="px-8 py-6 text-center">
                                            <div className="flex flex-col items-center">
                                                <span className="text-xl font-black text-slate-800 dark:text-white">+{calculateTotalUnits(item)}</span>
                                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Unid. Netas</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 text-right">
                                            <button
                                                onClick={() => removeItem(item.id)}
                                                className="p-3 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-2xl transition-all cursor-pointer min-h-[44px] min-w-[44px]"
                                            >
                                                <Trash2 size={20} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
