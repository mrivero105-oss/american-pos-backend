import { useState, useEffect, useRef, useMemo, memo, lazy, Suspense } from 'react';
import { 
    Search, 
    RefreshCw, 
    Zap, 
    X,
    LayoutGrid,
    List,
    Square,
    Circle,
    Scan,
    PackageX,
    PackageCheck,
    CloudOff,
    Users,
    UserPlus,
    ChevronDown,
    CheckCircle2,
    Pencil,
    Filter
} from 'lucide-react';
import ProductItem from './ProductItem';
import StationProductView from './StationProductView';
import { groupProductsByFamily } from '../utils/productFamilies';
const MobileBarcodeScannerModal = lazy(() => import('./MobileBarcodeScannerModal'));
import { usePos } from '../hooks/PosContext';
import useHorizontalScroll from '../hooks/useHorizontalScroll';
import { hapticTap } from '../utils/haptics';
import { isUsdOnlyMode, isDollarOnlyCountry } from '../utils/format';

// Native-speed uncontrolled SearchBox with zero IME/keyboard interference
const SearchBox = memo(({ searchTerm, onSearchChange, onBarcodeScan, searchInputRef, onKeyDown, onOpenScanner, totalCount }) => {
    const internalRef = useRef(null);
    const inputRef = searchInputRef || internalRef;
    const [hasText, setHasText] = useState(Boolean(searchTerm));
    const debounceTimerRef = useRef(null);
    const isComposingRef = useRef(false);

    // Sync external changes (e.g. F4 clear, barcode scanner) without interrupting active typing
    useEffect(() => {
        if (inputRef.current) {
            const currentVal = inputRef.current.value;
            const targetVal = searchTerm || '';
            if (targetVal === '') {
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                    debounceTimerRef.current = null;
                }
                if (currentVal !== '') {
                    inputRef.current.value = '';
                }
                setHasText(false);
            } else if (currentVal !== targetVal && document.activeElement !== inputRef.current) {
                inputRef.current.value = targetVal;
                setHasText(Boolean(targetVal));
            }
        }
    }, [searchTerm, inputRef]);

    const [isMobileScreen, setIsMobileScreen] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobileScreen(window.innerWidth < 768);
        const handleScannerClear = () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
            if (inputRef.current) {
                inputRef.current.value = '';
            }
            setHasText(false);
            onSearchChange('');
        };
        window.addEventListener('resize', handleResize);
        window.addEventListener('pos-scanner-clear', handleScannerClear);
        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('pos-scanner-clear', handleScannerClear);
        };
    }, [inputRef, onSearchChange]);

    const dispatchSearch = (val) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        
        if (!val || val.trim().length === 0) {
            onSearchChange('');
        } else {
            const delay = isMobileScreen ? 120 : 40;
            debounceTimerRef.current = setTimeout(() => {
                onSearchChange(val);
            }, delay);
        }
    };

    const handleInput = (e) => {
        const val = e.target.value;
        setHasText(Boolean(val));

        if (!isComposingRef.current) {
            dispatchSearch(val);
        }
    };

    const handleCompositionStart = () => {
        isComposingRef.current = true;
    };

    const handleCompositionEnd = (e) => {
        isComposingRef.current = false;
        dispatchSearch(e.target.value);
    };

    const handleClear = () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (inputRef.current) {
            inputRef.current.value = '';
            inputRef.current.focus();
        }
        setHasText(false);
        onSearchChange('');
    };

    return (
        <div className="search-bar-container relative flex-1 min-w-0 group bg-[#fafbfd] hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-900 !p-0 overflow-hidden !rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:border-slate-500 dark:focus-within:border-slate-500 transition-colors flex items-center h-10">
            <div className="pl-3 flex items-center pointer-events-none z-20 shrink-0">
                <Search className="text-slate-400 group-focus-within:text-slate-700 dark:group-focus-within:text-slate-200 transition-colors" size={16} />
            </div>
            <input
                ref={inputRef}
                type="text"
                data-pos-search="true"
                defaultValue={searchTerm || ''}
                placeholder={isMobileScreen ? "Buscar..." : "Buscar producto o escanear..."}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                inputMode="search"
                className="block w-full pl-2.5 pr-2 py-2 bg-transparent border-none outline-none font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-xs sm:text-sm tracking-normal truncate shadow-none focus:ring-0 focus:outline-none focus:border-none"
                onInput={handleInput}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onPaste={(e) => {
                    const pasted = (e.clipboardData?.getData('text') || '').trim();
                    if (pasted && pasted.length >= 4 && /^\S+$/.test(pasted) && onBarcodeScan) {
                        const handled = onBarcodeScan(pasted, { fromSearchInput: true, silentIfNotFound: true });
                        if (handled) {
                            e.preventDefault();
                            if (debounceTimerRef.current) {
                                clearTimeout(debounceTimerRef.current);
                                debounceTimerRef.current = null;
                            }
                            if (inputRef.current) {
                                inputRef.current.value = '';
                                inputRef.current.focus();
                            }
                            setHasText(false);
                            onSearchChange('');
                        }
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
                        if (debounceTimerRef.current) {
                            clearTimeout(debounceTimerRef.current);
                            debounceTimerRef.current = null;
                        }
                        const rawVal = (inputRef.current?.value || '').trim();
                        if (rawVal && onBarcodeScan) {
                            const handled = onBarcodeScan(rawVal, { fromSearchInput: true });
                            if (handled) {
                                e.preventDefault();
                                e.stopPropagation();
                                if (inputRef.current) {
                                    inputRef.current.value = '';
                                    inputRef.current.focus();
                                }
                                setHasText(false);
                                onSearchChange('');
                                return;
                            }
                        }
                        onSearchChange(rawVal);
                    }
                    if (onKeyDown) onKeyDown(e);
                }}
                autoFocus
            />
            <div className="flex items-center gap-1 sm:gap-1.5 pr-2 pointer-events-none shrink-0 select-none">
                {typeof totalCount === 'number' && !isMobileScreen && (
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 tabular-nums hidden 2xl:inline">
                        {totalCount} {totalCount === 1 ? 'ítem' : 'ítems'}
                    </span>
                )}
                <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded">
                    F4
                </kbd>
            </div>
            {hasText && (
                <button
                    type="button"
                    onClick={handleClear}
                    className="p-1.5 flex items-center justify-center text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 bg-transparent hover:bg-slate-200 dark:hover:bg-slate-800 border-0 outline-none z-20 shrink-0 cursor-pointer btn-ghost btn-icon transition-colors"
                    title="Limpiar búsqueda"
                    aria-label="Limpiar búsqueda"
                >
                    <X size={15} strokeWidth={2.5} />
                </button>
            )}
            <button
                type="button"
                onClick={onOpenScanner}
                title="Escanear Código de Barras"
                aria-label="Escanear Código de Barras"
                className="mr-1.5 p-1.5 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 border-0 outline-none active:scale-95 transition-all shrink-0 z-20 cursor-pointer btn-ghost btn-icon"
            >
                <Scan size={15} strokeWidth={2.2} />
            </button>
        </div>
    );
});

const ProductGrid = memo(({
    loading,
    allProducts,
    filteredProducts,
    categories,
    category,
    setCategory,
    searchTerm,
    handleAddToCart,
    handleQuickEdit,
    isAdmin,
    currencyMode,
    exchangeRate,
    selectedIndex,
    setSelectedIndex,
    searchInputRef,
    posViewMode,
    setPosViewMode,
    viewLayout = 'grid',
    setViewLayout,
    onSearchChange,
    onBarcodeScan,
    stockIntelligence = {},
    allowedCategories: propAllowedCategories = [],
    allowedProducts: propAllowedProducts = [],
    activeCustomer,
    onSelectCustomer,
    onOpenNewCustomer,
    onEditCustomer,
    customers = []
}) => {
    const categoryRef = useHorizontalScroll();
    const gridContainerRef = useRef(null);
    const customerDropdownRef = useRef(null);
    const customerSearchInputRef = useRef(null);
    const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
    const [customerSearchTerm, setCustomerSearchTerm] = useState('');
    const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(-1);
    const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 640;
    const [visibleLimit, setVisibleLimit] = useState(isMobileDevice ? 30 : 120);
    const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);

    // Filtrar clientes para el selector de cabecera
    const filteredCustomersList = useMemo(() => {
        if (!Array.isArray(customers)) return [];
        const q = (customerSearchTerm || '').toLowerCase().trim();
        if (!q) return customers.slice(0, 30);
        return customers.filter(c => 
            (c.name || '').toLowerCase().includes(q) || 
            (c.idDocument || c.identification || '').includes(q) ||
            (c.phone || '').includes(q)
        ).slice(0, 30);
    }, [customers, customerSearchTerm]);

    // Cerrar dropdown de cliente al hacer click fuera
    useEffect(() => {
        if (!isCustomerDropdownOpen) return;
        const handleClickOutside = (e) => {
            if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target)) {
                setIsCustomerDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isCustomerDropdownOpen]);

    // Auto-enfocar el input del buscador de clientes al abrir el dropdown
    useEffect(() => {
        if (isCustomerDropdownOpen) {
            const timer = setTimeout(() => {
                customerSearchInputRef.current?.focus();
                customerSearchInputRef.current?.select();
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [isCustomerDropdownOpen]);

    // Atajos globales del POS (F8: Asignar Cliente, F4: Buscador de Productos)
    useEffect(() => {
        const handlePosShortcuts = (e) => {
            // F8: Enfocar directamente el buscador de cliente
            if (e.key === 'F8') {
                e.preventDefault();
                setIsCustomerDropdownOpen(true);
                setTimeout(() => {
                    customerSearchInputRef.current?.focus();
                    customerSearchInputRef.current?.select();
                }, 30);
            }
            // F4: Enfocar buscador de productos
            else if (e.key === 'F4') {
                e.preventDefault();
                setIsCustomerDropdownOpen(false);
                if (searchInputRef?.current) {
                    searchInputRef.current.focus();
                    searchInputRef.current.select();
                }
            }
            // Escape: Cerrar selector de cliente si está abierto
            else if (e.key === 'Escape' && isCustomerDropdownOpen) {
                e.preventDefault();
                setIsCustomerDropdownOpen(false);
                searchInputRef?.current?.focus();
            }
        };

        window.addEventListener('keydown', handlePosShortcuts);
        return () => window.removeEventListener('keydown', handlePosShortcuts);
    }, [isCustomerDropdownOpen, searchInputRef]);
    const { 
        setCurrencyMode: setContextCurrencyMode, 
        isUsdOnly, 
        country, 
        allowedCategories: posAllowedCategories,
        allowedProducts: posAllowedProducts
    } = usePos();
    const effectiveAllowed = propAllowedCategories?.length > 0 ? propAllowedCategories : (posAllowedCategories || []);
    const effectiveAllowedProducts = propAllowedProducts?.length > 0 ? propAllowedProducts : (posAllowedProducts || []);
    const hasStationLimit = effectiveAllowed.length > 0 || effectiveAllowedProducts.length > 0;

    // 1 Producto Físico = 1 Tarjeta comercial independiente (Detal + Mayor)
    const unifiedProducts = filteredProducts;

    // Conteo rápido de productos por categoría para mostrar en el riel tipo Square POS
    const categoryCounts = useMemo(() => {
        const counts = { __all__: 0, __nostock__: 0 };
        if (!Array.isArray(allProducts)) return counts;
        const norm = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        for (let i = 0; i < allProducts.length; i++) {
            const p = allProducts[i];
            if (!p) continue;
            counts.__all__++;
            const stock = (p.BranchStocks && Array.isArray(p.BranchStocks) && p.BranchStocks.length > 0)
                ? p.BranchStocks.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)
                : Number(p.stockQuantity ?? p.stock ?? p.stock_total ?? 0);
            if (stock <= 0) counts.__nostock__++;
            const catKey = norm(p.category);
            if (catKey) {
                counts[catKey] = (counts[catKey] || 0) + 1;
            }
        }
        return counts;
    }, [allProducts]);

    // Modo Estación Ampliado: Cuando la caja está restringida a una estación o hay pocas familias de productos
    const isStationSingleProduct = useMemo(() => {
        if (viewLayout === 'list') return false;
        if (hasStationLimit && unifiedProducts.length <= 3) return true;
        if (unifiedProducts.length === 1 && (
            unifiedProducts[0]?.isFamily ||
            (Array.isArray(unifiedProducts[0]?.Presentations) && unifiedProducts[0].Presentations.length > 0) ||
            Number(unifiedProducts[0]?.unitsPerBulk) > 1
        )) return true;
        return false;
    }, [hasStationLimit, unifiedProducts, viewLayout]);


    // Reset visible limit on search or category filter to minimize DOM footprint
    useEffect(() => {
        setVisibleLimit(isMobileDevice ? 30 : 120);
        if (gridContainerRef.current) {
            gridContainerRef.current.scrollTop = 0;
        }
    }, [searchTerm, category, isMobileDevice]);


    // Auto-scroll to selected index if keyboard navigation is used
    useEffect(() => {
        if (selectedIndex !== -1) {
            if (selectedIndex >= visibleLimit - 8) {
                setVisibleLimit(prev => Math.max(prev + (isMobileDevice ? 24 : 48), selectedIndex + 20));
            }
            if (gridContainerRef.current) {
                const selectedEl = document.getElementById(`product-${unifiedProducts[selectedIndex]?.id}`);
                if (selectedEl) {
                    selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }
    }, [selectedIndex, unifiedProducts, visibleLimit, isMobileDevice]);

    const scrollTickingRef = useRef(false);

    const handleGridScroll = (e) => {
        if (!scrollTickingRef.current) {
            scrollTickingRef.current = true;
            const target = e.currentTarget;
            requestAnimationFrame(() => {
                if (target) {
                    const { scrollTop, scrollHeight, clientHeight } = target;
                    if (scrollHeight - scrollTop - clientHeight < 450) {
                        setVisibleLimit(prev => Math.min(prev + (isMobileDevice ? 16 : 32), unifiedProducts.length));
                    }
                }
                scrollTickingRef.current = false;
            });
        }
    };

    return (
        <div className="pos-catalog-shell flex-1 flex flex-col min-h-0 bg-[#e4e9f0] dark:bg-slate-900 relative overflow-hidden">
            {/* Header: Search & Categories */}
            <div className="pos-catalog-toolbar px-3 sm:px-3.5 pt-1 pb-2 bg-[#eef2f6] dark:bg-slate-900 z-10 shrink-0">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 w-full">
                        {/* 1. Buscador Responsivo */}
                        <div className="flex-[1.3] min-w-[180px]">
                            <SearchBox 
                                searchTerm={searchTerm} 
                                onSearchChange={onSearchChange} 
                                onBarcodeScan={onBarcodeScan}
                                searchInputRef={searchInputRef} 
                                totalCount={unifiedProducts.length}
                                onOpenScanner={() => setIsBarcodeModalOpen(true)}
                                onKeyDown={(e) => {
                                    if ((e.key === 'Enter' || e.key === 'NumpadEnter') && filteredProducts.length > 0) {
                                        e.preventDefault();
                                        if (filteredProducts.length === 1 && handleAddToCart) {
                                            handleAddToCart(filteredProducts[0]);
                                            if (searchInputRef?.current) {
                                                searchInputRef.current.value = '';
                                                searchInputRef.current.focus();
                                            }
                                            onSearchChange('');
                                        } else {
                                            setSelectedIndex(0);
                                            e.target.blur();
                                        }
                                    }
                                }}
                            />
                        </div>

                        {/* 2. Módulo de Clientes: Buscador / Combobox Directo */}
                        <div className="flex-1 min-w-[200px] max-w-[360px] flex items-center gap-1.5 relative" ref={customerDropdownRef}>
                            {activeCustomer ? (
                                /* Chip de Cliente Activo */
                                <div 
                                    className="flex-1 min-w-0 h-10 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center justify-between gap-1.5 select-none shadow-2xs group"
                                    title={`Cliente asignado: ${activeCustomer.name} (${activeCustomer.idDocument || activeCustomer.identification || 'Sin documento'})`}
                                >
                                    <div 
                                        className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                                        onClick={() => {
                                            setIsCustomerDropdownOpen(true);
                                            setTimeout(() => {
                                                customerSearchInputRef.current?.focus();
                                                customerSearchInputRef.current?.select();
                                            }, 30);
                                        }}
                                    >
                                        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700">
                                            <Users size={13} strokeWidth={2.2} />
                                        </div>
                                        <div className="flex flex-col text-left truncate min-w-0">
                                            <span className="text-xs sm:text-[12.5px] font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">
                                                {activeCustomer.name}
                                            </span>
                                            {(activeCustomer.idDocument || activeCustomer.identification) && (
                                                <span className="text-[10px] font-mono font-medium text-slate-400 dark:text-slate-500 truncate leading-none">
                                                    {activeCustomer.idDocument || activeCustomer.identification}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-0.5 shrink-0 ml-1">
                                        {onEditCustomer && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onEditCustomer(activeCustomer);
                                                }}
                                                className="p-1 hover:bg-primary-100 dark:hover:bg-primary-900/50 text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 rounded transition-colors cursor-pointer"
                                                title={`Editar datos de ${activeCustomer.name}`}
                                            >
                                                <Pencil size={12.5} />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (onSelectCustomer) onSelectCustomer(null, null);
                                                setCustomerSearchTerm('');
                                                setIsCustomerDropdownOpen(false);
                                                searchInputRef?.current?.focus();
                                            }}
                                            className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                            title="Desasignar cliente (volver a Cliente Ocasional)"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* Input Directo de Búsqueda de Cliente */
                                <div className="flex-1 min-w-0 h-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#fafbfd] hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-800 transition-colors flex items-center px-2.5 gap-2 shadow-2xs focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:border-primary-500 dark:focus-within:border-primary-500">
                                    <Users size={14} className="text-slate-400 shrink-0" />
                                    <input
                                        ref={customerSearchInputRef}
                                        type="text"
                                        value={customerSearchTerm}
                                        placeholder="Buscar cliente (cédula o nombre)... F8"
                                        onFocus={() => {
                                            setIsCustomerDropdownOpen(true);
                                            setHighlightedCustomerIndex(-1);
                                        }}
                                        onChange={(e) => {
                                            setCustomerSearchTerm(e.target.value);
                                            setIsCustomerDropdownOpen(true);
                                            setHighlightedCustomerIndex(-1);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'ArrowDown') {
                                                e.preventDefault();
                                                setIsCustomerDropdownOpen(true);
                                                setHighlightedCustomerIndex(prev => 
                                                    prev < filteredCustomersList.length - 1 ? prev + 1 : 0
                                                );
                                            } else if (e.key === 'ArrowUp') {
                                                e.preventDefault();
                                                setIsCustomerDropdownOpen(true);
                                                setHighlightedCustomerIndex(prev => 
                                                    prev > 0 ? prev - 1 : filteredCustomersList.length - 1
                                                );
                                            } else if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (highlightedCustomerIndex >= 0 && filteredCustomersList[highlightedCustomerIndex]) {
                                                    const chosen = filteredCustomersList[highlightedCustomerIndex];
                                                    if (onSelectCustomer) onSelectCustomer(chosen.id, chosen);
                                                    setIsCustomerDropdownOpen(false);
                                                    setCustomerSearchTerm('');
                                                    searchInputRef?.current?.focus();
                                                } else if (filteredCustomersList.length > 0) {
                                                    const first = filteredCustomersList[0];
                                                    if (onSelectCustomer) onSelectCustomer(first.id, first);
                                                    setIsCustomerDropdownOpen(false);
                                                    setCustomerSearchTerm('');
                                                    searchInputRef?.current?.focus();
                                                } else if (customerSearchTerm.trim() && onOpenNewCustomer) {
                                                    const cleanTerm = customerSearchTerm.trim();
                                                    const isDoc = /\d/.test(cleanTerm) || /^[vVeEjJgGpP]-?/i.test(cleanTerm);
                                                    onOpenNewCustomer(isDoc ? { idDocument: cleanTerm } : { name: cleanTerm });
                                                    setIsCustomerDropdownOpen(false);
                                                    setCustomerSearchTerm('');
                                                }
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                setIsCustomerDropdownOpen(false);
                                                searchInputRef?.current?.focus();
                                            }
                                        }}
                                        className="w-full bg-transparent border-none outline-none text-xs sm:text-[12.5px] font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 tracking-normal truncate p-0 focus:ring-0 focus:outline-none"
                                    />
                                    {customerSearchTerm ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCustomerSearchTerm('');
                                                customerSearchInputRef.current?.focus();
                                            }}
                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded cursor-pointer"
                                            title="Limpiar búsqueda"
                                        >
                                            <X size={12} />
                                        </button>
                                    ) : (
                                        <span className="text-[10px] font-mono font-semibold text-slate-400 dark:text-slate-500 shrink-0 select-none">
                                            F8
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Botón "+ Cliente" para Registrar Cliente Inmediatamente */}
                            {onOpenNewCustomer && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const cleanTerm = customerSearchTerm.trim();
                                        if (cleanTerm) {
                                            const isDoc = /\d/.test(cleanTerm) || /^[vVeEjJgGpP]-?/i.test(cleanTerm);
                                            onOpenNewCustomer(isDoc ? { idDocument: cleanTerm } : { name: cleanTerm });
                                        } else {
                                            onOpenNewCustomer(null);
                                        }
                                    }}
                                    className="h-10 px-2.5 sm:px-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all shrink-0 cursor-pointer"
                                    title="Registrar nuevo cliente"
                                >
                                    <UserPlus size={14} strokeWidth={2.2} />
                                    <span className="hidden xl:inline">+ Cliente</span>
                                </button>
                            )}

                            {/* Dropdown Flotante de Sugerencias de Clientes */}
                            {isCustomerDropdownOpen && (
                                <div className="absolute top-full left-0 right-0 mt-1 min-w-[320px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                                    <div className="max-h-64 overflow-y-auto no-scrollbar">
                                        {/* Opción 1: Consumidor Final (Ocasional) */}
                                        <button 
                                            type="button"
                                            onClick={() => { 
                                                if (onSelectCustomer) onSelectCustomer(null, null); 
                                                setIsCustomerDropdownOpen(false);
                                                setCustomerSearchTerm('');
                                                searchInputRef?.current?.focus();
                                            }}
                                            className={`w-full p-2.5 text-left border-b border-slate-100 dark:border-slate-800 transition-all flex items-center justify-between group cursor-pointer ${!activeCustomer ? 'bg-primary-50 dark:bg-primary-500/10' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <Users size={13} className={!activeCustomer ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'} />
                                                <span className={`text-[11px] font-black uppercase tracking-tight ${!activeCustomer ? 'text-primary-600 dark:text-primary-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                                    Consumidor Final (Ocasional)
                                                </span>
                                            </div>
                                            {!activeCustomer && <CheckCircle2 size={14} className="text-primary-500 dark:text-primary-400" />}
                                        </button>

                                        {/* Opción contextual: Cédula o nombre no encontrado -> Registrar de inmediato */}
                                        {customerSearchTerm.trim() && filteredCustomersList.length === 0 && onOpenNewCustomer && (
                                            <button 
                                                type="button"
                                                onClick={() => { 
                                                    const cleanTerm = customerSearchTerm.trim();
                                                    const isDoc = /\d/.test(cleanTerm) || /^[vVeEjJgGpP]-?/i.test(cleanTerm);
                                                    onOpenNewCustomer(isDoc ? { idDocument: cleanTerm } : { name: cleanTerm }); 
                                                    setIsCustomerDropdownOpen(false);
                                                    setCustomerSearchTerm('');
                                                }}
                                                className="w-full p-3 text-left border-b border-slate-100 dark:border-slate-800 bg-primary-50/70 hover:bg-primary-100 dark:bg-primary-950/30 dark:hover:bg-primary-900/50 text-primary-700 dark:text-primary-300 transition-all flex items-center gap-2 cursor-pointer"
                                            >
                                                <UserPlus size={15} className="shrink-0 text-primary-600" />
                                                <div className="flex flex-col text-left">
                                                    <span className="text-[11px] font-black uppercase tracking-wider">
                                                        + Registrar &quot;{customerSearchTerm}&quot; como nuevo cliente
                                                    </span>
                                                    <span className="text-[9.5px] text-primary-600/80 dark:text-primary-400/80">
                                                        Presiona Enter o haz clic para abrir formulario con esta cédula
                                                    </span>
                                                </div>
                                            </button>
                                        )}

                                        {/* Lista de clientes coincidentes */}
                                        {filteredCustomersList.map((c, idx) => (
                                            <div
                                                key={`${c.id || 'cust'}-${idx}`}
                                                className={`w-full px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 transition-all flex items-center justify-between group ${
                                                    highlightedCustomerIndex === idx 
                                                        ? 'bg-primary-100/70 dark:bg-primary-900/40' 
                                                        : activeCustomer?.id === c.id 
                                                            ? 'bg-primary-50 dark:bg-primary-500/10' 
                                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                                }`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => { 
                                                        if (onSelectCustomer) onSelectCustomer(c.id, c); 
                                                        setIsCustomerDropdownOpen(false);
                                                        setCustomerSearchTerm('');
                                                        searchInputRef?.current?.focus();
                                                    }}
                                                    className="flex-1 text-left min-w-0 pr-2 flex items-center justify-between cursor-pointer py-1"
                                                >
                                                    <span className="text-[11.5px] font-bold uppercase tracking-tight text-slate-800 dark:text-slate-200 truncate">
                                                        {c.name}
                                                    </span>
                                                    {(c.idDocument || c.identification) && (
                                                        <span className="text-[10px] font-mono font-semibold text-slate-400 dark:text-slate-500 shrink-0 ml-2">
                                                            {c.idDocument || c.identification}
                                                        </span>
                                                    )}
                                                </button>

                                                {onEditCustomer && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onEditCustomer(c);
                                                            setIsCustomerDropdownOpen(false);
                                                        }}
                                                        className="p-1.5 rounded-md text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-slate-700 dark:hover:text-primary-400 transition-colors shrink-0 cursor-pointer ml-1 opacity-0 group-hover:opacity-100"
                                                        title={`Editar datos de ${c.name}`}
                                                    >
                                                        <Pencil size={13} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 3. Controles rápidos de vista (Desktop/Tablet) */}
                        {setViewLayout && (
                            <div className="pos-view-switcher hidden sm:flex items-center h-10 p-0.5 rounded-lg bg-[#fafbfd] dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setViewLayout('grid');
                                        if (setPosViewMode) setPosViewMode('NORMAL');
                                    }}
                                    title="Vista de cuadrícula con tarjetas"
                                    className={`h-full px-2 sm:px-2.5 rounded-md flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        viewLayout !== 'list'
                                            ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-2xs'
                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    <LayoutGrid size={15} />
                                    <span className="hidden 2xl:inline">Tarjetas</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setViewLayout('list');
                                        if (setPosViewMode) setPosViewMode('NORMAL');
                                    }}
                                    title="Vista compacta en lista"
                                    className={`h-full px-2 sm:px-2.5 rounded-md flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                        viewLayout === 'list'
                                            ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-2xs'
                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    <List size={15} />
                                    <span className="hidden 2xl:inline">Lista</span>
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                        {hasStationLimit && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-black shrink-0 shadow-2xs">
                                <Filter size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                <span>
                                    Estación: {[
                                        effectiveAllowed?.length > 0 ? effectiveAllowed.join(', ') : '',
                                        effectiveAllowedProducts?.length > 0 ? `${effectiveAllowedProducts.length} prod(s)` : ''
                                    ].filter(Boolean).join(' • ')}
                                </span>
                            </div>
                        )}
                        <div className="pos-category-strip flex items-center p-1 rounded-xl bg-[#fafbfd] dark:bg-slate-950/70 border border-slate-300/90 dark:border-slate-800 shadow-2xs flex-1 min-w-0">
                            <div 
                                ref={categoryRef}
                                className="flex overflow-x-auto gap-1 px-0.5 no-scrollbar select-none scroll-smooth flex-1 items-center"
                            >
                                {categories.map(cat => {
                                    const isNoStockCat = cat.toLowerCase().includes('sin stock');
                                    const isSelected = category === cat;
                                    const normKey = String(cat || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                                    const count = cat === 'Todas'
                                        ? categoryCounts.__all__
                                        : isNoStockCat
                                            ? categoryCounts.__nostock__
                                            : (categoryCounts[normKey] ?? 0);

                                    return (
                                        <button
                                            key={cat}
                                            type="button"
                                            onClick={() => setCategory(cat)}
                                            className={`px-2.5 py-1 rounded-lg border shrink-0 transition-all font-bold text-xs flex items-center gap-1.5 cursor-pointer select-none active:scale-[0.98] ${
                                                isSelected
                                                    ? 'bg-sky-600 dark:bg-sky-500 border-sky-600 dark:border-sky-400 text-white shadow-xs'
                                                    : isNoStockCat
                                                        ? 'bg-transparent text-rose-600 dark:text-rose-400 border-dashed border-rose-400/50 hover:bg-rose-500/10'
                                                        : 'bg-transparent text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800/90 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            <span>{cat}</span>
                                            {count > 0 && (
                                                <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-extrabold tabular-nums leading-tight ${
                                                    isSelected
                                                        ? 'bg-white/20 text-white'
                                                        : isNoStockCat
                                                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                                            : 'bg-slate-200/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                                }`}>
                                                    {count}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Standard Robust Grid with Native Scrolling */}
            <div 
                ref={gridContainerRef}
                onScroll={handleGridScroll}
                className="pos-catalog-canvas flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-3.5 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 overscroll-contain no-scrollbar bg-[#e4e9f0] dark:bg-slate-950/70"
            >
                {loading && allProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <RefreshCw className="text-primary-500 animate-spin" size={32} />
                        <span className="font-black uppercase tracking-[0.2em] text-[10px] text-primary-500">Sincronizando...</span>
                    </div>
                ) : allProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12 max-w-md mx-auto">
                        <div className="w-14 h-14 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center mb-4 text-amber-600 dark:text-amber-400">
                            <CloudOff size={26} strokeWidth={1.8} />
                        </div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider mb-1.5">
                            Catálogo Vacío (Sin Sincronizar)
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-5">
                            Esta caja terminal no tiene productos cargados. Conéctela a la red local del Servidor Principal para descargar el catálogo y comenzar a facturar.
                        </p>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-xs font-medium">
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            <span>Esperando primera sincronización LAN</span>
                        </div>
                    </div>
                ) : filteredProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        {category && category.toLowerCase().includes('sin stock') ? (
                            <>
                                <PackageX size={48} strokeWidth={1.5} className="text-slate-400" />
                                <p className="font-bold uppercase tracking-wider mt-3 text-slate-700 dark:text-slate-300 text-xs">
                                    No hay productos sin stock
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Todo el inventario cuenta con stock disponible
                                </p>
                            </>
                        ) : (
                            <>
                                <Search size={48} strokeWidth={1.5} className="text-slate-400" />
                                <p className="font-bold uppercase tracking-wider mt-3 text-slate-700 dark:text-slate-300 text-xs">Sin resultados</p>
                            </>
                        )}
                    </div>
                ) : isStationSingleProduct ? (
                    <div className="flex flex-col gap-6 max-w-5xl mx-auto py-2 px-1">
                        {unifiedProducts.map((product) => (
                            <StationProductView
                                key={product.id}
                                product={product}
                                onAdd={handleAddToCart}
                                onEdit={handleQuickEdit}
                                isAdmin={isAdmin}
                                currencyMode={currencyMode}
                                exchangeRate={exchangeRate}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={
                        viewLayout === 'list' 
                            ? 'flex flex-col gap-2' 
                            : viewLayout === 'grid_round'
                                ? 'grid gap-3 sm:gap-3.5 grid-cols-[repeat(auto-fill,minmax(215px,1fr))]'
                                : 'grid gap-2.5 sm:gap-3 grid-cols-[repeat(auto-fill,minmax(215px,1fr))]'
                    }>
                        {unifiedProducts.slice(0, visibleLimit).map((product, index) => (
                            <div
                                key={product.id}
                                className={
                                    (viewLayout === 'list' ? 'min-h-[68px] h-auto cv-auto-row' : 
                                    viewLayout === 'grid_round' ? 'aspect-square w-full max-w-[350px] mx-auto cv-auto-card' : 
                                    'h-full flex flex-col cv-auto-card')
                                }
                            >
                                <ProductItem
                                    product={product}
                                    onAdd={handleAddToCart}
                                    onEdit={handleQuickEdit}
                                    isAdmin={isAdmin}
                                    currencyMode={currencyMode}
                                    exchangeRate={exchangeRate}
                                    isSelected={index === selectedIndex}
                                    viewMode="NORMAL"
                                    viewLayout={viewLayout}
                                    intelligence={stockIntelligence[product.id]}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Mobile Camera Barcode & Visual Scanner (Lazy-Loaded off-startup) */}
            {isBarcodeModalOpen && (
                <Suspense fallback={null}>
                    <MobileBarcodeScannerModal
                        isOpen={isBarcodeModalOpen}
                        onClose={() => setIsBarcodeModalOpen(false)}
                        products={allProducts || []}
                        onVisionMatch={(prod) => {
                            if (prod) handleAddToCart(prod);
                        }}
                        onBarcodeScanned={(code) => {
                            if (!code) return;
                            const cleanCode = String(code).trim();
                            if (onBarcodeScan && onBarcodeScan(cleanCode)) {
                                return;
                            }
                            const exactProduct = allProducts?.find(p => 
                                p.barcode === cleanCode || 
                                p.sku === cleanCode || 
                                p.barcode?.endsWith(cleanCode) || 
                                p.sku?.endsWith(cleanCode)
                            );
                            if (exactProduct) {
                                handleAddToCart(exactProduct);
                            } else {
                                onSearchChange(cleanCode);
                            }
                        }}
                    />
                </Suspense>
            )}

            {/* Quick Barcode Scanner FAB (Thumb-zone ergonomic button for Mobile) */}
            <button
                type="button"
                onClick={() => {
                    hapticTap();
                    setIsBarcodeModalOpen(true);
                }}
                className="fixed bottom-36 sm:bottom-40 right-4 sm:right-6 z-[45] lg:hidden flex items-center justify-center w-12 h-12 rounded-xl bg-slate-900 text-white shadow-md border border-slate-700 active:scale-95 transition-all cursor-pointer"
                title="Escanear Código de Barras (Cámara)"
                aria-label="Escanear Código de Barras con Cámara"
            >
                <Scan size={22} strokeWidth={2} />
            </button>
        </div>
    );
});

export default ProductGrid;
