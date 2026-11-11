import { useState, useEffect, useMemo, useRef } from 'react';
import { 
    Layers, Package, Store, Search, Plus, X, RotateCcw, 
    Check, Filter, AlertCircle, CheckCircle2 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../services/db';
import api from '../services/api';
import { formatUSD } from '../utils/format';

/**
 * StationConfigPanel
 * Panel de configuración para terminales/estaciones especializadas de venta.
 * Permite limitar la caja a:
 *  1. Catálogo General (Sin restricciones)
 *  2. Categorías seleccionadas
 *  3. Productos específicos seleccionados
 *  4. Combinación de categorías y productos
 */
export default function StationConfigPanel({
    currentShiftId = null,
    registerId = '1',
    allowedCategories = [],
    setAllowedCategories,
    allowedProducts = [],
    setAllowedProducts,
    onClose,
    onSaved
}) {
    // Modo de trabajo en la UI: 'GENERAL' | 'CATEGORIES' | 'PRODUCTS' | 'MIXED'
    const initialMode = useMemo(() => {
        const hasCats = Array.isArray(allowedCategories) && allowedCategories.length > 0;
        const hasProds = Array.isArray(allowedProducts) && allowedProducts.length > 0;
        if (hasCats && hasProds) return 'MIXED';
        if (hasCats) return 'CATEGORIES';
        if (hasProds) return 'PRODUCTS';
        return 'GENERAL';
    }, [allowedCategories, allowedProducts]);

    const [activeTab, setActiveTab] = useState(initialMode === 'GENERAL' ? 'CATEGORIES' : initialMode);
    const [selectedCategories, setSelectedCategories] = useState(() => Array.isArray(allowedCategories) ? [...allowedCategories] : []);
    const [selectedProducts, setSelectedProducts] = useState(() => Array.isArray(allowedProducts) ? [...allowedProducts] : []);

    // Catálogos disponibles en el sistema
    const [availableCategories, setAvailableCategories] = useState([]);
    const [allProductsList, setAllProductsList] = useState([]);
    const [loadingData, setLoadingData] = useState(true);

    // Búsqueda de productos en tiempo real
    const [productSearchTerm, setProductSearchTerm] = useState('');
    const [isSearchingProduct, setIsSearchingProduct] = useState(false);
    const searchInputRef = useRef(null);

    // Cargar categorías y productos de IndexedDB con fallback de API
    useEffect(() => {
        let isMounted = true;
        const loadCatalogs = async () => {
            try {
                setLoadingData(true);
                // 1. Cargar productos desde IndexedDB
                let localProducts = [];
                try {
                    localProducts = await db.getAll('products');
                } catch (e) {
                    console.warn('[StationConfig] Error cargando productos locales:', e);
                }

                if ((!localProducts || localProducts.length === 0)) {
                    const res = await api.get('/products?limit=500');
                    localProducts = res.data?.products || res.data || [];
                }

                if (isMounted) {
                    setAllProductsList(Array.isArray(localProducts) ? localProducts : []);
                }

                // 2. Extraer categorías únicas
                const catSet = new Set();
                if (Array.isArray(localProducts)) {
                    localProducts.forEach(p => {
                        if (p?.category && typeof p.category === 'string' && p.category.trim()) {
                            catSet.add(p.category.trim());
                        }
                    });
                }

                // Fallback de categorías vía API
                if (catSet.size === 0) {
                    try {
                        const catRes = await api.get('/products/categories');
                        const apiCats = catRes.data?.categories || catRes.data || [];
                        if (Array.isArray(apiCats)) {
                            apiCats.forEach(c => {
                                const catName = typeof c === 'string' ? c : c.name;
                                if (catName) catSet.add(catName.trim());
                            });
                        }
                    } catch (e) {
                        console.warn('[StationConfig] Error cargando categorías de API:', e);
                    }
                }

                const sortedCats = Array.from(catSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
                if (isMounted) {
                    setAvailableCategories(sortedCats);
                }
            } catch (err) {
                console.error('[StationConfig] Error cargando catálogos:', err);
            } finally {
                if (isMounted) setLoadingData(false);
            }
        };

        loadCatalogs();
        return () => { isMounted = false; };
    }, []);

    // Conteo de productos por categoría
    const categoryCounts = useMemo(() => {
        const counts = {};
        allProductsList.forEach(p => {
            const cat = (p?.category || '').trim();
            if (cat) counts[cat] = (counts[cat] || 0) + 1;
        });
        return counts;
    }, [allProductsList]);

    // Filtrar productos para el buscador predictivo
    const searchResults = useMemo(() => {
        const term = productSearchTerm.trim().toLowerCase();
        if (!term || term.length < 2) return [];

        const selectedIds = new Set(selectedProducts.map(p => String(p?.id || p)));
        return allProductsList
            .filter(p => {
                if (selectedIds.has(String(p.id))) return false;
                const name = (p.name || p.nombre || '').toLowerCase();
                const barcode = (p.barcode || '').toLowerCase();
                const cat = (p.category || '').toLowerCase();
                return name.includes(term) || barcode.includes(term) || cat.includes(term);
            })
            .slice(0, 10);
    }, [productSearchTerm, allProductsList, selectedProducts]);

    // Toggle de selección de categoría
    const handleToggleCategory = (categoryName) => {
        setSelectedCategories(prev => {
            if (prev.includes(categoryName)) {
                return prev.filter(c => c !== categoryName);
            } else {
                return [...prev, categoryName];
            }
        });
    };

    // Agregar producto específico
    const handleAddProduct = (product) => {
        if (!product) return;
        const exists = selectedProducts.some(p => String(p.id || p) === String(product.id));
        if (exists) return;

        const compactProduct = {
            id: product.id,
            name: product.name || product.nombre || 'Producto',
            barcode: product.barcode || '',
            category: product.category || 'General',
            price: Number(product.price) || 0,
            hasPresentations: Array.isArray(product.Presentations) && product.Presentations.length > 0
        };

        setSelectedProducts(prev => [...prev, compactProduct]);
        setProductSearchTerm('');
        if (searchInputRef.current) searchInputRef.current.focus();
    };

    // Remover producto específico
    const handleRemoveProduct = (productId) => {
        setSelectedProducts(prev => prev.filter(p => String(p.id || p) !== String(productId)));
    };

    // Restablecer a Catálogo General
    const handleResetToGeneral = async () => {
        setSelectedCategories([]);
        setSelectedProducts([]);
        if (typeof setAllowedCategories === 'function') setAllowedCategories([]);
        if (typeof setAllowedProducts === 'function') setAllowedProducts([]);

        try {
            await api.put('/cash/station-categories', {
                shiftId: currentShiftId,
                registerId,
                allowedCategories: [],
                allowedProducts: []
            });
        } catch (e) {
            console.warn('[StationConfig] Sync notice:', e);
        }

        toast.success('Terminal configurada en Modo General (Vende todo el catálogo)');
        if (onSaved) onSaved({ allowedCategories: [], allowedProducts: [] });
        if (onClose) onClose();
    };

    // Guardar configuración actual
    const handleSaveConfig = async () => {
        const finalCategories = [...selectedCategories];
        const finalProducts = [...selectedProducts];

        if (typeof setAllowedCategories === 'function') {
            setAllowedCategories(finalCategories);
        }
        if (typeof setAllowedProducts === 'function') {
            setAllowedProducts(finalProducts);
        }

        try {
            await api.put('/cash/station-categories', {
                shiftId: currentShiftId,
                registerId,
                allowedCategories: finalCategories,
                allowedProducts: finalProducts
            });
        } catch (e) {
            console.warn('[StationConfig] Sync notice:', e);
        }

        const totalRestrictions = finalCategories.length + finalProducts.length;
        if (totalRestrictions === 0) {
            toast.success('Estación fijada a Catálogo General');
        } else {
            const parts = [];
            if (finalCategories.length > 0) parts.push(`${finalCategories.length} categoría(s)`);
            if (finalProducts.length > 0) parts.push(`${finalProducts.length} producto(s)`);
            toast.success(`Estación especializada guardada: ${parts.join(' y ')}`);
        }

        if (onSaved) onSaved({ allowedCategories: finalCategories, allowedProducts: finalProducts });
        if (onClose) onClose();
    };

    const hasAnyFilter = selectedCategories.length > 0 || selectedProducts.length > 0;

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 shadow-sm">
            {/* Header / Resumen */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 rounded-lg">
                        <Store size={18} />
                    </div>
                    <div>
                        <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">
                            Configuración de Estación de Trabajo
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Asigna qué rubros o productos despachará esta terminal específicamente.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 self-start sm:self-auto">
                    {hasAnyFilter ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                            <Filter size={12} />
                            Estación Especializada ({selectedCategories.length} cats, {selectedProducts.length} prods)
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 size={12} />
                            Catálogo General (Vende todo)
                        </span>
                    )}
                </div>
            </div>

            {/* Pestañas de Modo */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/70 rounded-lg text-xs font-bold">
                <button
                    type="button"
                    onClick={() => setActiveTab('CATEGORIES')}
                    className={`flex-1 py-1.5 px-3 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        activeTab === 'CATEGORIES'
                            ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <Layers size={14} />
                    <span>Por Categorías</span>
                    {selectedCategories.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.2 bg-primary-100 dark:bg-primary-900/60 text-primary-700 dark:text-primary-300 rounded-full text-[10px]">
                            {selectedCategories.length}
                        </span>
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('PRODUCTS')}
                    className={`flex-1 py-1.5 px-3 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        activeTab === 'PRODUCTS'
                            ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <Package size={14} />
                    <span>Por Productos Específicos</span>
                    {selectedProducts.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.2 bg-primary-100 dark:bg-primary-900/60 text-primary-700 dark:text-primary-300 rounded-full text-[10px]">
                            {selectedProducts.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Contenido: Pestaña Categorías */}
            {activeTab === 'CATEGORIES' && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Toca las categorías habilitadas para esta terminal:
                        </span>
                        {selectedCategories.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setSelectedCategories([])}
                                className="text-[11px] text-red-500 hover:underline cursor-pointer"
                            >
                                Desmarcar todas
                            </button>
                        )}
                    </div>

                    {loadingData ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                            Cargando categorías del sistema...
                        </div>
                    ) : availableCategories.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                            No se encontraron categorías registradas.
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto p-1 border border-slate-100 dark:border-slate-800 rounded-lg">
                            {availableCategories.map(cat => {
                                const isSelected = selectedCategories.includes(cat);
                                const count = categoryCounts[cat] || 0;
                                return (
                                    <button
                                        key={cat}
                                        type="button"
                                        onClick={() => handleToggleCategory(cat)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                                            isSelected
                                                ? 'bg-primary-600 text-white shadow-xs'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                        }`}
                                    >
                                        {isSelected && <Check size={13} className="stroke-[3]" />}
                                        <span>{cat}</span>
                                        {count > 0 && (
                                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                                isSelected ? 'bg-primary-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                            }`}>
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Contenido: Pestaña Productos Específicos */}
            {activeTab === 'PRODUCTS' && (
                <div className="space-y-3">
                    {/* Buscador de Producto */}
                    <div className="relative">
                        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
                            <Search size={15} className="text-slate-400" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={productSearchTerm}
                                onChange={(e) => setProductSearchTerm(e.target.value)}
                                placeholder="Escribe el nombre o código del producto a autorizar..."
                                className="flex-1 bg-transparent text-xs font-medium text-slate-900 dark:text-white outline-none"
                            />
                            {productSearchTerm && (
                                <button
                                    type="button"
                                    onClick={() => setProductSearchTerm('')}
                                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Dropdown de resultados predictivos */}
                        {searchResults.length > 0 && (
                            <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg divide-y divide-slate-100 dark:divide-slate-700/60">
                                {searchResults.map(prod => (
                                    <div
                                        key={prod.id}
                                        onClick={() => handleAddProduct(prod)}
                                        className="p-2.5 hover:bg-primary-50 dark:hover:bg-primary-950/40 cursor-pointer flex items-center justify-between gap-2 transition-colors"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                                {prod.name || prod.nombre}
                                            </div>
                                            <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                                <span>{prod.category || 'Sin categoría'}</span>
                                                {prod.barcode && <span>• Cód: {prod.barcode}</span>}
                                                {Array.isArray(prod.Presentations) && prod.Presentations.length > 0 && (
                                                    <span className="text-primary-600 dark:text-primary-400 font-bold">
                                                        • {prod.Presentations.length} presentaciones
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                                                ${Number(prod.price || 0).toFixed(2)}
                                            </span>
                                            <span className="p-1 bg-primary-100 dark:bg-primary-900/60 text-primary-700 dark:text-primary-300 rounded-md">
                                                <Plus size={13} />
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Lista de productos ya seleccionados */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                Productos autorizados ({selectedProducts.length}):
                            </span>
                            {selectedProducts.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setSelectedProducts([])}
                                    className="text-[11px] text-red-500 hover:underline cursor-pointer"
                                >
                                    Quitar todos
                                </button>
                            )}
                        </div>

                        {selectedProducts.length === 0 ? (
                            <div className="py-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-400">
                                No hay productos específicos agregados aún. Usa el buscador de arriba para añadir productos a esta terminal.
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto p-1 border border-slate-100 dark:border-slate-800 rounded-lg">
                                {selectedProducts.map(prod => {
                                    const id = prod?.id || prod;
                                    const name = prod?.name || prod?.nombre || `Producto #${id}`;
                                    const cat = prod?.category || '';
                                    return (
                                        <div
                                            key={id}
                                            className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-2 text-xs"
                                        >
                                            <div className="min-w-0 max-w-[200px]">
                                                <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">
                                                    {name}
                                                </span>
                                                {cat && <span className="text-[10px] text-slate-400 block">{cat}</span>}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveProduct(id)}
                                                className="p-0.5 text-slate-400 hover:text-red-500 rounded-md transition-colors cursor-pointer"
                                                title="Remover"
                                            >
                                                <X size={13} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Acciones del pie */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={handleResetToGeneral}
                    className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                    <RotateCcw size={13} />
                    <span>Todo el Catálogo (Sin Restricción)</span>
                </button>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 sm:flex-initial px-3.5 py-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-xs font-bold cursor-pointer"
                        >
                            Cancelar
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleSaveConfig}
                        className="flex-1 sm:flex-initial px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
                    >
                        Guardar Configuración
                    </button>
                </div>
            </div>
        </div>
    );
}
