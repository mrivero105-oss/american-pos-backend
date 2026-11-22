import { useMemo, memo, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Package, Edit, Scale, Layers, ShoppingBag, Zap, Box, X, ArrowLeft, ChevronRight } from 'lucide-react';
import { formatMoney, formatStock, formatStockUnit, isUsdOnlyMode, isDollarOnlyCountry, formatPhysicalStock } from '../utils/format';
import { CachedImage } from './CachedImage';
import { getImageUrl } from '../utils/imageUtils';

const ProductItem = memo(function ProductItem({ product, onAdd, onEdit, isAdmin, currencyMode, exchangeRate, isSelected, viewMode = 'NORMAL', viewLayout = 'grid', intelligence }) {
    const isUsdOnly = isUsdOnlyMode({ currencyMode }) || isDollarOnlyCountry(localStorage.getItem('pos_country'));
    const isService = Boolean(product.isService || String(product.category || '').trim().toLowerCase() === 'servicios');
    const isCashAdvance = isService && /\bavance\b/i.test(String(product.name || ''));
    const isWeighed = !isService && !!(product.isSoldByWeight || product.stockUnit === 'kg' || product.isFractional);
    const weightUnit = formatStockUnit(product.stockUnit, isWeighed);

    const resolvedImageUrl = useMemo(() => {
        const raw = product.imageUrl || product.imageUri;
        return raw ? getImageUrl(raw) : null;
    }, [product.imageUrl, product.imageUri]);

    const priceFormatted = useMemo(() => 
        formatMoney(product.price, null, { rate: exchangeRate, currencyMode }),
    [product.price, exchangeRate, currencyMode]);

    const bsPriceFormatted = useMemo(() => 
        formatMoney(product.price, 'VES', { rate: exchangeRate, currencyMode: 'VES' }),
    [product.price, exchangeRate]);

    const usdPriceFormatted = useMemo(() => 
        formatMoney(product.price, 'USD', { rate: exchangeRate, currencyMode: 'USD' }),
    [product.price, exchangeRate]);

    const hasDynamicPresentations = useMemo(() => 
        Array.isArray(product.Presentations) && product.Presentations.length > 0,
    [product.Presentations]);

    const getPresentationUnits = useCallback((pres) => {
        const fc = Number(pres?.factorConversion);
        if (fc > 0) return fc;
        const match = String(pres?.name || '').match(/(\d+(?:\.\d+)?)\s*(?:un|und|unid|unidades|pza|pzas)/i);
        if (match) return Number(match[1]);
        return Number(pres?.price) || Number(pres?.orderIndex) || 0;
    }, []);

    const sortPresentationsAsc = useCallback((list) => {
        if (!Array.isArray(list)) return [];
        return [...list].sort((a, b) => {
            const diff = getPresentationUnits(a) - getPresentationUnits(b);
            if (diff !== 0) return diff;
            return (Number(a?.price) || 0) - (Number(b?.price) || 0);
        });
    }, [getPresentationUnits]);

    const sortedPresentations = useMemo(() => {
        if (!hasDynamicPresentations) return [];
        return sortPresentationsAsc(product.Presentations);
    }, [hasDynamicPresentations, product.Presentations, sortPresentationsAsc]);

    const bulkPriceFormatted = useMemo(() => {
        if (isService || hasDynamicPresentations) return null;
        if (!product.unitsPerBulk || Number(product.unitsPerBulk) <= 1) return null;
        const bPrice = Number(product.bulkPrice) > 0 ? Number(product.bulkPrice) : (Number(product.price) * Number(product.unitsPerBulk));
        return formatMoney(bPrice, null, { rate: exchangeRate, currencyMode });
    }, [isService, hasDynamicPresentations, product.bulkPrice, product.price, product.unitsPerBulk, exchangeRate, currencyMode]);

    const midBulkPriceFormatted = useMemo(() => {
        if (isService || hasDynamicPresentations) return null;
        if (!product.unitsPerMidBulk || Number(product.unitsPerMidBulk) <= 0) return null;
        const mbPrice = Number(product.midBulkPrice) > 0 ? Number(product.midBulkPrice) : (Number(product.price) * Number(product.unitsPerMidBulk));
        return formatMoney(mbPrice, null, { rate: exchangeRate, currencyMode });
    }, [isService, hasDynamicPresentations, product.midBulkPrice, product.price, product.unitsPerMidBulk, exchangeRate, currencyMode]);


    const humanStockFormatted = useMemo(() => {
        if (isService) return '∞ Servicio';
        const total = Number(product.stockQuantity || 0);
        if (total <= 0) return 'Agotado';
        if (isWeighed) {
            const primaryPres = Array.isArray(product.Presentations) && product.Presentations.length > 0
                ? (product.Presentations.find(p => p.isDefaultPurchase) || product.Presentations[0])
                : null;
            const pieceFactor = Number(primaryPres?.factorConversion || (Number(product.unitsPerBulk) !== 1 ? product.unitsPerBulk : 0));
            const pieceName = (primaryPres?.name || product.bulkUnitName || 'Pieza').trim();
            const exactUnits = Number(product.stockUnits);
            if (exactUnits > 0 && pieceName && pieceName.toLowerCase() !== 'bulto') {
                const pieces = Math.round(exactUnits * 10) / 10;
                return `${pieces} ${pieceName}${pieces === 1 ? '' : 's'} · ${formatStock(total)} ${weightUnit}`;
            }
            if (pieceFactor > 0 && pieceName && pieceName.toLowerCase() !== 'bulto') {
                const pieces = Math.round((total / pieceFactor) * 10) / 10;
                return `${pieces} ${pieceName}${pieces === 1 ? '' : 's'} · ${formatStock(total)} ${weightUnit}`;
            }
            return `${formatStock(total)} ${weightUnit}`;
        }
        const unitsPerBulk = Number(product.unitsPerBulk || 1);
        const unitsPerMidBulk = Number(product.unitsPerMidBulk || 0);
        if (Array.isArray(product.Presentations) && product.Presentations.length > 0) {
            return formatPhysicalStock(total, product.Presentations, weightUnit);
        }
        if (unitsPerBulk <= 1 && unitsPerMidBulk <= 0) return `${formatStock(total)} ${weightUnit}`;
        
        if (unitsPerBulk > 1) {
            const bulks = Math.floor(total / unitsPerBulk);
            const loose = Math.round((total % unitsPerBulk) * 100) / 100;
            const bulkName = product.bulkUnitName || 'Paq.';
            
            if (bulks > 0 && loose > 0) {
                if (unitsPerMidBulk > 0 && loose >= unitsPerMidBulk) {
                    const mids = Math.floor(loose / unitsPerMidBulk);
                    const remLoose = Math.round((loose % unitsPerMidBulk) * 100) / 100;
                    return remLoose > 0 
                        ? `${bulks} ${bulkName} + ${mids} ${product.midBulkUnitName || 'med.'} + ${remLoose} un`
                        : `${bulks} ${bulkName} + ${mids} ${product.midBulkUnitName || 'med.'}`;
                }
                return `${bulks} ${bulkName} + ${loose} un`;
            }
            if (bulks > 0) {
                return `${bulks} ${bulks === 1 ? bulkName : `${bulkName}s`} (${total} un)`;
            }
            if (unitsPerMidBulk > 0 && loose >= unitsPerMidBulk) {
                const mids = Math.floor(loose / unitsPerMidBulk);
                const remLoose = Math.round((loose % unitsPerMidBulk) * 100) / 100;
                return remLoose > 0 
                    ? `${mids} ${product.midBulkUnitName || 'med.'} + ${remLoose} un`
                    : `${mids} ${product.midBulkUnitName || 'med.'} (${total} un)`;
            }
            return `${total} un`;
        }

        if (unitsPerMidBulk > 0) {
            const mids = Math.floor(total / unitsPerMidBulk);
            const loose = Math.round((total % unitsPerMidBulk) * 100) / 100;
            const midName = product.midBulkUnitName || 'Media';
            if (mids > 0 && loose > 0) return `${mids} ${midName} + ${loose} un`;
            if (mids > 0) return `${mids} ${mids === 1 ? midName : `${midName}s`} (${total} un)`;
            return `${total} un`;
        }

        return `${total} un`;
    }, [isService, product.stockQuantity, product.stockUnits, product.Presentations, product.unitsPerBulk, product.bulkUnitName, product.unitsPerMidBulk, product.midBulkUnitName, isWeighed, weightUnit]);

    const shortStockFormatted = useMemo(() => {
        if (!humanStockFormatted) return '';
        // Elimina especificaciones largas entre paréntesis ej: "(12 Cartones / 360 un)" -> queda "2 Cajas Completas"
        return humanStockFormatted.replace(/\s*\([^)]*\)/g, '').trim();
    }, [humanStockFormatted]);

    const handleAddWithSound = useCallback((e) => {
        if (!isService && product.stockQuantity <= 0 && !product.allowNegative) {
            e?.preventDefault();
            e?.stopPropagation();
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(25); } catch { /* Vibración háptica opcional no soportada */ }
        }
        onAdd(product);
    }, [isService, onAdd, product]);

    const handleAddDirect = useCallback((e, isBulk = false, isMidBulk = false, presentation = null) => {
        e?.preventDefault();
        e?.stopPropagation();
        if (!isService && product.stockQuantity <= 0 && !product.allowNegative) return;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(30); } catch { /* Vibración háptica opcional no soportada */ }
        }
        onAdd(product, 1, false, isBulk, isMidBulk, presentation);
    }, [isService, onAdd, product]);

    // Context Menu (Right Click) logic for instant presentation sell
    const [contextMenu, setContextMenu] = useState(null);
    const [isFamilyPickerOpen, setIsFamilyPickerOpen] = useState(false);
    const [selectedVariantForPres, setSelectedVariantForPres] = useState(null);

    const handleCloseFamilyPicker = useCallback(() => {
        setIsFamilyPickerOpen(false);
        setSelectedVariantForPres(null);
    }, []);

    // Long Press (Mantener Presionado) logic to open edit menu
    const timerRef = useRef(null);
    const isLongPressRef = useRef(false);
    const startPosRef = useRef({ x: 0, y: 0 });
    const [isHolding, setIsHolding] = useState(false);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const startPress = useCallback((clientX, clientY) => {
        isLongPressRef.current = false;
        startPosRef.current = { x: clientX, y: clientY };
        setIsHolding(true);

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            setIsHolding(false);
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try { navigator.vibrate(60); } catch { /* Vibración háptica opcional no soportada */ }
            }
            if (onEdit) {
                onEdit(product);
            }
        }, 500); // 500ms long press standard threshold
    }, [onEdit, product]);

    const cancelPress = useCallback(() => {
        setIsHolding(false);
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const handleTouchStart = useCallback((e) => {
        const touch = e.touches[0];
        if (touch) {
            startPress(touch.clientX, touch.clientY);
        }
    }, [startPress]);

    const handleTouchMove = useCallback((e) => {
        const touch = e.touches[0];
        if (touch) {
            const deltaX = Math.abs(touch.clientX - startPosRef.current.x);
            const deltaY = Math.abs(touch.clientY - startPosRef.current.y);
            // Cancel hold if finger scrolls catalog
            if (deltaX > 10 || deltaY > 10) {
                cancelPress();
            }
        }
    }, [cancelPress]);

    const handleTouchEnd = useCallback((e) => {
        cancelPress();
        if (isLongPressRef.current) {
            e.preventDefault();
        }
    }, [cancelPress]);

    const handleMouseDown = useCallback((e) => {
        if (e.button === 0) { // Left click
            startPress(e.clientX, e.clientY);
        }
    }, [startPress]);

    const handleMouseMove = useCallback((e) => {
        const deltaX = Math.abs(e.clientX - startPosRef.current.x);
        const deltaY = Math.abs(e.clientY - startPosRef.current.y);
        if (deltaX > 10 || deltaY > 10) {
            cancelPress();
        }
    }, [cancelPress]);

    const handleMouseUp = useCallback(() => {
        cancelPress();
    }, [cancelPress]);

    const handleMouseLeave = useCallback(() => {
        cancelPress();
    }, [cancelPress]);

    const handleContextMenu = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelPress();

        const menuWidth = 260;
        const menuHeight = 280;
        const x = typeof window !== 'undefined' ? Math.min(e.clientX, window.innerWidth - menuWidth - 10) : e.clientX;
        const y = typeof window !== 'undefined' ? Math.min(e.clientY, window.innerHeight - menuHeight - 10) : e.clientY;

        setContextMenu({ x: Math.max(10, x), y: Math.max(10, y) });
    }, [cancelPress]);

    useEffect(() => {
        if (!contextMenu) return;
        const handleClose = () => setContextMenu(null);
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setContextMenu(null);
        };
        window.addEventListener('click', handleClose);
        window.addEventListener('scroll', handleClose, true);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('click', handleClose);
            window.removeEventListener('scroll', handleClose, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [contextMenu]);

    useEffect(() => {
        if (!isFamilyPickerOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                const hasMultipleFamilyVariants = Boolean(product.isFamily && Array.isArray(product.variants) && product.variants.length > 1);
                if (selectedVariantForPres && hasMultipleFamilyVariants) {
                    setSelectedVariantForPres(null);
                } else {
                    handleCloseFamilyPicker();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFamilyPickerOpen, selectedVariantForPres, handleCloseFamilyPicker, product.isFamily, product.variants]);

    const handleClick = useCallback((e) => {
        if (isLongPressRef.current) {
            e.preventDefault();
            e.stopPropagation();
            setTimeout(() => {
                isLongPressRef.current = false;
            }, 300);
            return;
        }
        if (product.isFamily && Array.isArray(product.variants) && product.variants.length > 1) {
            e.preventDefault();
            e.stopPropagation();
            setSelectedVariantForPres(null);
            setIsFamilyPickerOpen(true);
            return;
        }
        if (!isWeighed && Array.isArray(product.Presentations) && product.Presentations.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            setSelectedVariantForPres(product);
            setIsFamilyPickerOpen(true);
            return;
        }
        handleAddWithSound(e);
    }, [handleAddWithSound, product, isWeighed]);

    const isExpert = viewMode === 'EXPERT';
    const isList = viewLayout === 'list';

    // Context Menu Floating Dropdown (rendered via portal directly in body to escape all clipping)
    const contextMenuPortal = contextMenu && typeof document !== 'undefined' ? createPortal(
        <div 
            className="fixed inset-0 z-[9999] select-none"
            onClick={(e) => { e.stopPropagation(); setContextMenu(null); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu(null); }}
        >
            <div 
                style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
                className="absolute w-64 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-1.5 text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-0.5 z-[10000]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-3 py-2 border-b border-slate-100 dark:border-white/10 mb-1">
                    <div className="flex items-center gap-1.5 text-primary-500 dark:text-primary-400">
                        <Zap size={13} className="fill-current" />
                        <span className="text-[10px] font-black uppercase tracking-wider">Venta Ultrarrápida</span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate mt-0.5" title={product.name}>
                        {product.name}
                    </p>
                </div>

                {/* Option 1: Detal */}
                <button
                    type="button"
                    onClick={(e) => {
                        setContextMenu(null);
                        handleAddDirect(e, false, false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-primary-500/10 dark:hover:bg-primary-500/20 text-slate-800 dark:text-slate-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center justify-between group cursor-pointer"
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0">
                            <ShoppingBag size={12} />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[11px] font-black">Vender al Detal</span>
                            <span className="text-[9px] text-slate-400">1 unidad</span>
                        </div>
                    </div>
                    <span className="text-[11px] font-black tabular-nums text-slate-900 dark:text-white shrink-0">
                        {priceFormatted}
                    </span>
                </button>

                {/* Option 2: Media Presentación */}
                {midBulkPriceFormatted && (
                    <button
                        type="button"
                        onClick={(e) => {
                            setContextMenu(null);
                            handleAddDirect(e, false, true);
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-amber-500/10 dark:hover:bg-amber-500/20 text-slate-800 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center justify-between group cursor-pointer"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                                <Layers size={12} />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[11px] font-black truncate max-w-[110px]">
                                    {product.midBulkUnitName || 'Media'}
                                </span>
                                <span className="text-[9px] text-amber-600 dark:text-amber-400 font-semibold">
                                    x{product.unitsPerMidBulk} un
                                </span>
                            </div>
                        </div>
                        <span className="text-[11px] font-black tabular-nums text-amber-600 dark:text-amber-400 shrink-0">
                            {midBulkPriceFormatted}
                        </span>
                    </button>
                )}

                {/* Option 3: Presentación Mayor / Caja */}
                {bulkPriceFormatted && (
                    <button
                        type="button"
                        onClick={(e) => {
                            setContextMenu(null);
                            handleAddDirect(e, true, false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20 text-slate-800 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center justify-between group cursor-pointer"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                <Package size={12} />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[11px] font-black truncate max-w-[110px]">
                                    {product.bulkUnitName || 'Caja / Bulto'}
                                </span>
                                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                    x{product.unitsPerBulk} un
                                </span>
                            </div>
                        </div>
                        <span className="text-[11px] font-black tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                            {bulkPriceFormatted}
                        </span>
                    </button>
                )}

                {/* Dynamic Presentations (N-Niveles ordenadas de menor a mayor) */}
                {sortedPresentations.map((pres) => {
                    const presPrice = Number(pres.price);
                    const formatted = formatMoney(presPrice, null, { rate: exchangeRate, currencyMode });
                    return (
                        <button
                            key={pres.id}
                            type="button"
                            onClick={(e) => {
                                setContextMenu(null);
                                handleAddDirect(e, false, false, pres);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors flex items-center justify-between group cursor-pointer"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                                    <Box size={12} />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[11px] font-black truncate max-w-[110px]">
                                        {pres.name}
                                    </span>
                                    <span className="text-[9px] text-slate-500 dark:text-slate-400 font-semibold">
                                        {isWeighed ? `~${pres.factorConversion} ${weightUnit}` : `${pres.factorConversion} un`}
                                    </span>
                                </div>
                            </div>
                            <span className="text-[11px] font-black tabular-nums text-slate-900 dark:text-white shrink-0">
                                {formatted}
                            </span>
                        </button>
                    );
                })}

                {/* Option 4: Editar Ficha Técnica o Presentaciones Directas */}
                {isAdmin && onEdit && (
                    <>
                        <div className="h-px bg-slate-100 dark:bg-white/10 my-1" />
                        {product.isFamily && Array.isArray(product.variants) && product.variants.length > 1 ? (
                            <>
                                <span className="px-3 py-1 text-[9px] font-black uppercase tracking-wider text-slate-400 block">
                                    Editar Presentación:
                                </span>
                                {product.variants.map((v) => (
                                    <button
                                        key={`edit-var-${v.id}`}
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setContextMenu(null);
                                            onEdit({ ...v, _familyVariants: product.variants });
                                        }}
                                        className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors flex items-center justify-between cursor-pointer"
                                    >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <Edit size={11} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            <span className="text-[11px] font-bold truncate">Editar {v.presentationLabel || v.name}</span>
                                        </div>
                                        <span className="text-[10px] font-mono opacity-70 shrink-0">
                                            {formatMoney(v.price, null, { rate: exchangeRate, currencyMode })}
                                        </span>
                                    </button>
                                ))}
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setContextMenu(null);
                                    onEdit(product);
                                }}
                                className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-2 cursor-pointer"
                            >
                                <Edit size={12} />
                                <span className="text-[11px] font-bold">Editar Ficha Técnica</span>
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>,
        document.body
    ) : null;

    // Family & Presentations Selector Modal (rendered via portal directly in body)
    const isMultiVariantFamily = Boolean(product.isFamily && Array.isArray(product.variants) && product.variants.length > 1);
    const familyPickerPortal = isFamilyPickerOpen && (isMultiVariantFamily || selectedVariantForPres) && typeof document !== 'undefined' ? createPortal(
        <div 
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md select-none animate-in fade-in duration-150"
            onClick={(e) => { e.stopPropagation(); handleCloseFamilyPicker(); }}
        >
            <div 
                className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-900/60">
                    <div className="flex items-center gap-3 min-w-0">
                        {selectedVariantForPres && isMultiVariantFamily ? (
                            <button
                                type="button"
                                onClick={() => setSelectedVariantForPres(null)}
                                className="w-10 h-10 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
                                title="Volver a seleccionar tipo"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        ) : (
                            <div className="w-12 h-12 min-w-[48px] min-h-[48px] aspect-square rounded-2xl overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center border border-slate-200 dark:border-slate-700 shadow-xs">
                                {resolvedImageUrl ? (
                                    <CachedImage 
                                        src={resolvedImageUrl} 
                                        alt={product.name}
                                        className="w-full h-full object-cover object-center block"
                                        fallback={<Package size={22} className="text-slate-400 opacity-60" />}
                                    />
                                ) : (
                                    <Package size={22} className="text-slate-400 opacity-60" />
                                )}
                            </div>
                        )}
                        <div className="min-w-0">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {selectedVariantForPres ? (isMultiVariantFamily ? 'Paso 2: Presentación de Venta' : 'Seleccionar Presentación') : 'Paso 1: Seleccionar Tipo'}
                            </span>
                            <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white truncate" title={selectedVariantForPres ? selectedVariantForPres.name : product.name}>
                                {selectedVariantForPres ? (selectedVariantForPres.presentationLabel ? `${product.name} • ${selectedVariantForPres.presentationLabel}` : selectedVariantForPres.name) : product.name}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {selectedVariantForPres ? '¿En qué presentación deseas agregar al carrito?' : '¿Cuál tipo o presentación deseas elegir?'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleCloseFamilyPicker}
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                        title="Cerrar (Esc)"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="p-3 sm:p-4 overflow-y-auto custom-scrollbar flex flex-col gap-2">
                    {!selectedVariantForPres ? (
                        // VISTA PASO 1: Listado de Tipos / Calibres
                        product.variants.map((v) => {
                            const vStock = Number(v.stockQuantity || 0);
                            const isOutOfStock = vStock <= 0 && !v.allowNegative;
                            const hasPresentations = Array.isArray(v.Presentations) && v.Presentations.length > 0;
                            const vPriceFormatted = formatMoney(v.price, null, { rate: exchangeRate, currencyMode });
                            const vBsPrice = formatMoney(v.price, 'VES', { rate: exchangeRate, currencyMode: 'VES' });
                            const vUsdPrice = formatMoney(v.price, 'USD', { rate: exchangeRate, currencyMode: 'USD' });

                            return (
                                <button
                                    key={v.id}
                                    type="button"
                                    disabled={isOutOfStock}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (isOutOfStock) return;
                                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                            try { navigator.vibrate(25); } catch { /* Vibración háptica opcional no soportada */ }
                                        }
                                        if (hasPresentations) {
                                            setSelectedVariantForPres(v);
                                        } else {
                                            onAdd(v, 1, false, false, false);
                                            handleCloseFamilyPicker();
                                        }
                                    }}
                                    className={`w-full text-left p-3.5 rounded-xl border transition-colors flex items-center justify-between gap-3 cursor-pointer group ${
                                        isOutOfStock 
                                            ? 'opacity-40 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                                            : 'bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/80 hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs active:scale-[0.99]'
                                    }`}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300">
                                            <Box size={18} />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                                                    {v.presentationLabel || v.name}
                                                </span>
                                                {v.presentationLabel && v.name !== v.presentationLabel && (
                                                    <span className="text-[11px] text-slate-400 truncate max-w-[140px] hidden sm:inline">
                                                        {v.name}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className={`text-[11px] font-medium ${isOutOfStock ? 'text-red-500 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                                                    {isOutOfStock ? 'Sin stock' : `${vStock} un disponible${vStock === 1 ? '' : 's'}`}
                                                </span>
                                                {hasPresentations && (
                                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                                        {v.Presentations.length} empaques
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0 pl-2">
                                        <div className="flex flex-col items-end">
                                            <span className="text-base font-black text-slate-900 dark:text-white font-mono tabular-nums">
                                                {currencyMode === 'BOTH' ? vBsPrice : vPriceFormatted}
                                            </span>
                                            {currencyMode === 'BOTH' && exchangeRate > 1 && (
                                                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                                    {vUsdPrice}
                                                </span>
                                            )}
                                        </div>
                                        {hasPresentations && (
                                            <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">
                                                <ChevronRight size={16} />
                                            </div>
                                        )}
                                    </div>
                                </button>
                            );
                        })
                    ) : (
                        // VISTA PASO 2: Opciones de empaque y unidad ordenadas de MENOR A MAYOR cantidad
                        <>
                            {/* Opción 1: 1 Unidad Suelta (Al Detal) */}
                            <button
                                type="button"
                                disabled={Number(selectedVariantForPres.stockQuantity || 0) <= 0 && !selectedVariantForPres.allowNegative}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                        try { navigator.vibrate(25); } catch { /* Vibración háptica opcional no soportada */ }
                                    }
                                    onAdd(selectedVariantForPres, 1, false, false, false);
                                    handleCloseFamilyPicker();
                                }}
                                className="w-full text-left p-3.5 rounded-xl border bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/80 hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs transition-colors flex items-center justify-between gap-3 cursor-pointer group active:scale-[0.99]"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200">
                                        1 un
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                                            1 Unidad Suelta (Al Detal)
                                        </span>
                                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                            Venta por unidad individual • Stock: {formatStock(selectedVariantForPres.stockQuantity)} un
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-col items-end shrink-0 pl-2">
                                    <span className="text-base font-black text-slate-900 dark:text-white font-mono tabular-nums">
                                        {currencyMode === 'BOTH' 
                                            ? formatMoney(selectedVariantForPres.price, 'VES', { rate: exchangeRate, currencyMode: 'VES' }) 
                                            : formatMoney(selectedVariantForPres.price, null, { rate: exchangeRate, currencyMode })}
                                    </span>
                                    {currencyMode === 'BOTH' && exchangeRate > 1 && (
                                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                            {formatMoney(selectedVariantForPres.price, 'USD', { rate: exchangeRate, currencyMode: 'USD' })}
                                        </span>
                                    )}
                                </div>
                            </button>

                            {/* Opciones 2+: Presentaciones ordenadas de MENOR A MAYOR cantidad de unidades */}
                            {sortPresentationsAsc(selectedVariantForPres.Presentations).map((pres) => {
                                const presPrice = Number(pres.price);
                                const factor = getPresentationUnits(pres) || 1;
                                const formattedPrice = formatMoney(presPrice, null, { rate: exchangeRate, currencyMode });
                                const presBsPrice = formatMoney(presPrice, 'VES', { rate: exchangeRate, currencyMode: 'VES' });
                                const presUsdPrice = formatMoney(presPrice, 'USD', { rate: exchangeRate, currencyMode: 'USD' });
                                const unitEq = factor > 0 ? (presPrice / factor) : 0;
                                const unitEqFormatted = formatMoney(unitEq, null, { rate: exchangeRate, currencyMode });

                                return (
                                    <button
                                        key={pres.id}
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                                try { navigator.vibrate(25); } catch { /* Vibración háptica opcional no soportada */ }
                                            }
                                            onAdd(selectedVariantForPres, 1, false, false, false, pres);
                                            handleCloseFamilyPicker();
                                        }}
                                        className="w-full text-left p-3.5 rounded-xl border bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/80 hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs transition-colors flex items-center justify-between gap-3 cursor-pointer group active:scale-[0.99]"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[11px] shrink-0 bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200 tabular-nums">
                                                {factor} un
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                                                    {pres.name}
                                                </span>
                                                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                                    Contiene {factor} un • Sale a {unitEqFormatted}/un
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end shrink-0 pl-2">
                                            <span className="text-base font-black text-slate-900 dark:text-white font-mono tabular-nums">
                                                {currencyMode === 'BOTH' ? presBsPrice : formattedPrice}
                                            </span>
                                            {currencyMode === 'BOTH' && exchangeRate > 1 && (
                                                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                                    {presUsdPrice}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>

                {/* Footer hint */}
                <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="truncate pr-2">
                        {selectedVariantForPres 
                            ? 'Toca cualquier presentación para agregarla directamente al carrito.'
                            : 'Tip: También puedes tocar directamente los botones de la tarjeta.'}
                    </span>
                    <button
                        type="button"
                        onClick={handleCloseFamilyPicker}
                        className="font-bold text-slate-700 dark:text-slate-200 hover:underline cursor-pointer shrink-0"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    ) : null;

    // LIST VIEW (Minimalist & High Density — Elastic Height for Multi-Presentation Products)
    if (isList) {
        const hasListPills = Boolean(
            (product.isFamily && Array.isArray(product.variants) && product.variants.length > 0) ||
            (!product.isFamily && midBulkPriceFormatted) ||
            bulkPriceFormatted ||
            sortedPresentations.length > 0
        );

        return (
        <>
            <div 
                id={`product-${product.id}`}
                onClick={handleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={cancelPress}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onContextMenu={handleContextMenu}
                title={`${product.name} (Clic derecho o mantén presionado para venta rápida)`}
                className={`group card-tactical px-4 sm:px-5 py-2.5 min-h-[68px] h-auto flex items-center justify-between gap-4 sm:gap-5 transition-all select-none touch-manipulation ${
                    isSelected ? 'selected-gold' : ''
                } ${isHolding ? 'scale-[0.98] ring-2 ring-primary-500/60 shadow-lg' : ''} ${product.stockQuantity <= 0 && !product.allowNegative ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-pointer'}`}
                style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
            >
                <div className={`w-1.5 h-6 rounded-full transition-colors shrink-0 ${
                    isSelected ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700 group-hover:bg-primary-500/50'
                }`}></div>

                <div className="w-10 h-10 min-w-[40px] min-h-[40px] aspect-square rounded-lg overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-900 flex items-center justify-center border border-slate-200 dark:border-white/20 shadow-sm">
                    {(product.imageUrl || product.imageUri) ? (
                        <CachedImage 
                            src={product.imageUrl || product.imageUri} 
                            alt={product.name}
                            loading="lazy"
                            className="w-full h-full object-cover object-center block saturate-[1.1] contrast-[1.05]"
                            fallback={<Package size={20} className="text-slate-400 opacity-50" strokeWidth={1.5} />}
                        />
                    ) : (
                        <Package size={20} className="text-slate-400 opacity-50" strokeWidth={1.5} />
                    )}
                </div>

                <div className="flex flex-col justify-center min-w-0 flex-1 py-0.5">
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <h3 className="font-extrabold text-[12px] sm:text-[13px] tracking-tight text-slate-900 dark:text-white leading-snug break-words uppercase" title={product.name}>
                            {product.name}
                        </h3>
                        {hasListPills && (
                            <span className="text-[9.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0">
                                • {product.category || 'Sin Categoría'}
                            </span>
                        )}
                    </div>

                    {!hasListPills ? (
                        <span className="text-[9.5px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight mt-0.5 break-words">
                            {product.category || 'Sin Categoría'}
                        </span>
                    ) : (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {product.isFamily && Array.isArray(product.variants) && product.variants.map((v) => {
                                const vPrice = formatMoney(v.price, null, { rate: exchangeRate, currencyMode });
                                return (
                                    <button
                                        key={v.id}
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                                try { navigator.vibrate(25); } catch { /* Vibración háptica opcional no soportada */ }
                                            }
                                            onAdd(v, 1, false, false, false);
                                        }}
                                        className="font-bold text-[9.5px] uppercase tracking-tight text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200/90 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] active:scale-95 border border-slate-300/90 dark:border-white/10 px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                                        title={`Vender directamente: ${v.name} (${vPrice})`}
                                    >
                                        <span>{v.presentationLabel || v.name}</span>
                                        <span className="font-mono font-black text-slate-950 dark:text-white tabular-nums">{vPrice}</span>
                                    </button>
                                );
                            })}
                            {(!product.isFamily) && midBulkPriceFormatted && (
                                <button
                                    type="button"
                                    onClick={(e) => handleAddDirect(e, false, true)}
                                    className="font-bold text-[9.5px] uppercase tracking-tight text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200/90 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] active:scale-95 border border-slate-300/90 dark:border-white/10 px-2 py-0.5 rounded-md inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                                    title={`Vender directamente: ${product.midBulkUnitName || 'Media'} (x${product.unitsPerMidBulk})`}
                                >
                                    <Layers size={9.5} className="text-slate-400 dark:text-slate-500 shrink-0" />
                                    <span>{product.midBulkUnitName || 'Med'} x{product.unitsPerMidBulk}:</span>
                                    <span className="font-mono font-black text-slate-950 dark:text-white tabular-nums">{midBulkPriceFormatted}</span>
                                </button>
                            )}
                            {bulkPriceFormatted && (
                                <button
                                    type="button"
                                    onClick={(e) => handleAddDirect(e, true, false)}
                                    className="font-bold text-[9.5px] uppercase tracking-tight text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200/90 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] active:scale-95 border border-slate-300/90 dark:border-white/10 px-2 py-0.5 rounded-md inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                                    title={`Vender directamente: ${product.bulkUnitName || 'Paq'} (x${product.unitsPerBulk})`}
                                >
                                    <Package size={9.5} className="text-slate-400 dark:text-slate-500 shrink-0" />
                                    <span>{product.bulkUnitName || 'Paq'} x{product.unitsPerBulk}:</span>
                                    <span className="font-mono font-black text-slate-950 dark:text-white tabular-nums">{bulkPriceFormatted}</span>
                                </button>
                            )}
                            {sortedPresentations.map((pres) => {
                                const presPrice = Number(pres.price);
                                const factor = Number(pres.factorConversion) || 1;
                                const formatted = formatMoney(presPrice, null, { rate: exchangeRate, currencyMode });
                                const unitEq = factor > 0 ? (presPrice / factor) : 0;
                                const unitEqFormatted = formatMoney(unitEq, null, { rate: exchangeRate, currencyMode });
                                
                                const baseUnitPrice = Number(product.price) || 0;
                                const retailEquivalent = factor * baseUnitPrice;
                                const savingsPct = retailEquivalent > presPrice && retailEquivalent > 0
                                    ? Math.round(((retailEquivalent - presPrice) / retailEquivalent) * 100)
                                    : 0;

                                return (
                                    <button
                                        key={pres.id}
                                        type="button"
                                        onClick={(e) => handleAddDirect(e, false, false, pres)}
                                        className="font-bold text-[9.5px] uppercase tracking-tight text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200/90 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] active:scale-95 border border-slate-300/90 dark:border-white/10 px-2 py-0.5 rounded-md inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                                        title={`Vender directamente: ${pres.name} (x${pres.factorConversion}) • Sale a ${unitEqFormatted}/un${savingsPct > 0 ? ` • Ahorra ${savingsPct}%` : ''}`}
                                    >
                                        <Box size={9.5} className="text-slate-400 dark:text-slate-500 shrink-0" />
                                        <span>{pres.name}:</span>
                                        <span className="font-mono font-black text-slate-950 dark:text-white tabular-nums">{formatted}</span>
                                        {savingsPct > 0 && (
                                            <span className="text-[8px] font-extrabold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1 py-0.2 rounded-sm ml-0.5 tabular-nums">
                                                -{savingsPct}%
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="hidden sm:flex flex-col items-center justify-center min-w-[80px] px-3 border-x border-slate-100 dark:border-white/5 shrink-0">
                    <span className={`text-[10px] font-black tabular-nums tracking-widest ${
                        product.stockQuantity <= 0 ? 'text-red-500' : 'text-slate-400'
                    }`}>
                        {formatStock(product.stockQuantity)}
                    </span>
                    {intelligence && intelligence.daysRemaining <= 14 && (
                        <span className={`text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tighter ${
                            intelligence.status === 'critical' ? 'bg-red-500 text-white' : 
                            intelligence.status === 'warning' ? 'bg-amber-500 text-white' : 
                            'bg-blue-500/20 text-blue-400'
                        }`}>
                            {intelligence.daysRemaining === 0 ? 'Agotado' : `${intelligence.daysRemaining}d`}
                        </span>
                    )}
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter flex items-center gap-0.5">
                        {isWeighed && <Scale size={10} className="text-amber-500 shrink-0" />}
                        {weightUnit}
                    </span>
                </div>

                <div className="flex flex-col items-end justify-center shrink-0">
                    <span className={`text-sm font-black tracking-tight tabular-nums ${isUsdOnly ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                        {isUsdOnly ? usdPriceFormatted : (currencyMode === 'USD' ? usdPriceFormatted : bsPriceFormatted)}
                        {isWeighed && <span className="text-[10px] font-bold text-slate-400 ml-0.5">/{weightUnit}</span>}
                    </span>
                    {!isUsdOnly && currencyMode === 'BOTH' && exchangeRate > 1 && (
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-tighter tabular-nums">
                            {usdPriceFormatted}
                            {isWeighed && <span className="text-[8.5px] font-bold opacity-75 ml-0.5">/{weightUnit}</span>}
                        </span>
                    )}
                </div>

                {isAdmin && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onEdit(product); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="min-w-[40px] min-h-[40px] p-2 flex items-center justify-center text-slate-400 hover:text-primary-500 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-all shrink-0 cursor-pointer"
                        title="Editar producto (o mantén presionado)"
                        aria-label="Editar producto"
                    >
                        <Edit size={16} />
                    </button>
                )}
            </div>
            {contextMenuPortal}
            {familyPickerPortal}
        </>
        );
    }

    // GRID VIEW (Default & Visual)
    const getBorderRadius = () => {
        switch (viewLayout) {
            case 'grid_round': return '10px';
            case 'glassmorphism': return '8px';
            case 'grid_compact': return '6px';
            default: return '8px';
        }
    };

    return (
        <>
        <div 
            id={`product-${product.id}`}
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={cancelPress}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onContextMenu={handleContextMenu}
            title={`${product.name} ${isService ? '(Servicio)' : (isWeighed ? '(Venta por Peso)' : '')}`}
            className={`group relative overflow-hidden transition-all duration-150 h-full flex flex-col items-stretch justify-start w-full select-none touch-manipulation bg-white hover:bg-white dark:bg-slate-900 dark:hover:bg-slate-900/90 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs hover:shadow-xs hover:border-slate-300 dark:hover:border-slate-700 active:scale-[0.985] ${
                isSelected ? 'ring-2 ring-slate-800 dark:ring-slate-300 border-slate-800 dark:border-slate-300' : ''
            } ${isHolding ? 'scale-[0.98] ring-2 ring-slate-400' : ''} ${isExpert ? 'p-1.5 sm:p-2' : ''} ${
                !isService && product.stockQuantity <= 0 && !product.allowNegative ? 'opacity-40 grayscale cursor-not-allowed' : 'cursor-pointer'
            }`}
            style={{ borderRadius: getBorderRadius(), WebkitTouchCallout: 'none', userSelect: 'none' }}
        >
            {!isExpert && (
                <div className="w-full h-28 sm:h-32 relative flex items-center justify-center overflow-hidden shrink-0 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800/80 transition-colors">
                    {resolvedImageUrl ? (
                        <CachedImage 
                            src={resolvedImageUrl} 
                            alt={product.name} 
                            loading="lazy"
                            className="w-full h-full object-contain p-2.5 select-none transition-transform duration-200 group-hover:scale-105"
                            fallback={<Package size={28} strokeWidth={1.4} className="opacity-40 text-slate-400" />}
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-600 gap-1 select-none">
                            <Package size={30} strokeWidth={1.2} className="opacity-50" />
                        </div>
                    )}
                    
                    {/* Stock Indicator Label - Clean High-Contrast Retail Badge */}
                    <div className="absolute z-20 top-2 left-2 max-w-[calc(100%-38px)] pointer-events-none">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono tracking-tight transition-all border shadow-2xs truncate ${
                            isService
                                ? 'bg-slate-100/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80 font-bold'
                                : product.stockQuantity <= 0 
                                    ? 'bg-rose-50/90 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900 font-bold' 
                                    : product.stockQuantity <= 5 && !isWeighed
                                        ? 'bg-amber-50/90 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800 font-bold'
                                        : isWeighed
                                            ? 'bg-amber-50/90 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800 font-semibold'
                                            : 'bg-white/95 dark:bg-slate-800/95 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80 font-semibold'
                        }`} title={humanStockFormatted}>
                            {isWeighed && <Scale size={11} className="text-amber-700 dark:text-amber-400 shrink-0" />}
                            <span className="truncate">{shortStockFormatted}</span>
                        </span>
                    </div>

                    {/* Prediction Badge */}
                    {!isService && intelligence && intelligence.daysRemaining <= 14 && (
                        <div className={`absolute z-20 flex flex-col items-end gap-1 top-2 ${isAdmin ? 'right-10' : 'right-2'}`}>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-tight border ${
                                intelligence.status === 'critical' ? 'bg-rose-600 text-white border-rose-700' :
                                intelligence.status === 'warning' ? 'bg-amber-600 text-white border-amber-700' :
                                'bg-slate-700 text-white border-slate-800'
                            }`}>
                                ~{intelligence.daysRemaining}d
                            </span>
                        </div>
                    )}

                    {/* Quick Edit - Admin only (Clean hover appearance) */}
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={(e) => { 
                                e.preventDefault();
                                e.stopPropagation(); 
                                onEdit(product); 
                            }}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            className="absolute min-w-[28px] min-h-[28px] p-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg border border-slate-200/90 dark:border-slate-700 z-50 cursor-pointer flex items-center justify-center shadow-xs top-2 right-2 active:scale-90 transition-all opacity-0 group-hover:opacity-100"
                            title="Editar ficha técnica"
                            aria-label="Editar producto"
                        >
                            <Edit size={13} />
                        </button>
                    )}
                </div>
            )}

            {/* Content Area */}
            <div className="flex flex-col flex-1 justify-between w-full min-w-0">
                <div className="p-2.5 sm:px-3 sm:pt-2.5 sm:pb-2 flex flex-col min-w-0 w-full">
                    <h3 className="font-extrabold text-[13.5px] sm:text-[14.5px] leading-snug line-clamp-2 text-slate-900 dark:text-slate-100 min-h-[36px]" title={product.name}>
                        {product.name}
                    </h3>
                    <div className="mt-1 flex items-center justify-between gap-1 w-full min-w-0 text-[10px] sm:text-[10.5px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                        <span className="truncate">{product.category || 'General'}</span>
                        {isService ? (
                            <span className={`inline-flex items-center gap-0.5 font-bold shrink-0 text-[9.5px] px-1.5 py-0.5 rounded ${
                                isCashAdvance
                                    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-500/20'
                                    : 'text-sky-700 dark:text-sky-300 bg-sky-500/10 dark:bg-sky-500/20'
                            }`}>
                                <Zap size={10} /> {isCashAdvance ? 'Comisión %' : 'Monto libre'}
                            </span>
                        ) : isWeighed ? (
                            <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400 font-bold shrink-0 text-[9.5px] bg-amber-500/10 dark:bg-amber-500/20 px-1.5 py-0.5 rounded">
                                <Scale size={10} /> Balanza
                            </span>
                        ) : null}
                    </div>
                </div>

                {/* Bloque Inferior Comercial: Empaques al Mayor integrados + Precio Unitario (Detal) */}
                <div className="w-full mt-auto flex flex-col">
                    {(midBulkPriceFormatted || bulkPriceFormatted || (Array.isArray(product.Presentations) && product.Presentations.length > 0)) && (
                        <div className="flex flex-col w-full border-t border-slate-200/80 dark:border-slate-800/90 divide-y divide-slate-200/60 dark:divide-slate-800/70 bg-slate-100/70 dark:bg-slate-800/40">
                            {midBulkPriceFormatted && (
                                <button
                                    type="button"
                                    onClick={(e) => handleAddDirect(e, false, true)}
                                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11.5px] sm:text-[12px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    title={`Vender ${product.midBulkUnitName || 'Media'} (${product.unitsPerMidBulk} un) • ${midBulkPriceFormatted}`}
                                >
                                    <span className="text-left leading-tight truncate min-w-0 flex-1">
                                        {product.midBulkUnitName || 'Media'} {Number(product.unitsPerMidBulk) > 1 ? `(${product.unitsPerMidBulk}u)` : ''}
                                    </span>
                                    <span className="font-extrabold font-mono text-[11.5px] sm:text-[12.5px] text-slate-900 dark:text-white tabular-nums shrink-0 whitespace-nowrap">
                                        {midBulkPriceFormatted}
                                    </span>
                                </button>
                            )}
                            {bulkPriceFormatted && (
                                <button
                                    type="button"
                                    onClick={(e) => handleAddDirect(e, true, false)}
                                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11.5px] sm:text-[12px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    title={`Vender ${product.bulkUnitName || 'Bulto'} (${product.unitsPerBulk} un) • ${bulkPriceFormatted}`}
                                >
                                    <span className="text-left leading-tight truncate min-w-0 flex-1">
                                        {product.bulkUnitName || 'Bulto'} {Number(product.unitsPerBulk) > 1 ? `(${product.unitsPerBulk}u)` : ''}
                                    </span>
                                    <span className="font-extrabold font-mono text-[11.5px] sm:text-[12.5px] text-slate-900 dark:text-white tabular-nums shrink-0 whitespace-nowrap">
                                        {bulkPriceFormatted}
                                    </span>
                                </button>
                            )}
                            {sortedPresentations.map((pres) => {
                                const presPrice = Number(pres.price);
                                const factor = Number(pres.factorConversion) || 1;
                                const formatted = formatMoney(presPrice, null, { rate: exchangeRate, currencyMode });
                                const unitEq = factor > 0 ? (presPrice / factor) : 0;
                                const unitEqFormatted = formatMoney(unitEq, null, { rate: exchangeRate, currencyMode });

                                const cleanName = pres.name
                                    .replace(/\bcomplet[ao]s?\b/gi, '')
                                    .replace(/\s*\(\d+\s*Cartones\s*\/\s*/i, ' (')
                                    .replace(/\(\s*(\d+(?:\.\d+)?)\s*(?:unidades|unidad|unid|unds|und|un|pzas|pza)\s*\)/gi, '($1u)')
                                    .replace(/\s+/g, ' ')
                                    .trim();

                                const hasFactorInName = /\(\d+/.test(cleanName) || /x\s*\d+/i.test(cleanName);

                                return (
                                    <button
                                        key={pres.id}
                                        type="button"
                                        onClick={(e) => handleAddDirect(e, false, false, pres)}
                                        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11.5px] sm:text-[12px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                        title={`Vender ${pres.name} (${factor} un) • ${formatted} (Sale a ${unitEqFormatted}/un)`}
                                    >
                                        <span className="text-left leading-tight truncate min-w-0 flex-1">
                                            {cleanName}{!hasFactorInName && factor > 1 ? ` (${factor}u)` : ''}
                                        </span>
                                        <span className="font-extrabold font-mono text-[11.5px] sm:text-[12.5px] text-slate-900 dark:text-white tabular-nums shrink-0 whitespace-nowrap">
                                            {formatted}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Precio Unitario (Detal) */}
                    <div className="w-full px-2.5 py-2 border-t border-slate-100 dark:border-slate-800/90 flex items-center justify-between gap-1.5 bg-slate-50/50 dark:bg-slate-900/40">
                        {isCashAdvance ? (
                            <>
                                <span className="text-[13px] sm:text-[14px] font-extrabold text-slate-900 dark:text-white tracking-tight leading-none whitespace-nowrap">
                                    Calcular Avance
                                </span>
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0 ml-auto">
                                    + % Com.
                                </span>
                            </>
                        ) : isUsdOnly ? (
                            <span className="text-[15px] sm:text-[16px] font-black text-slate-950 dark:text-white font-mono tabular-nums tracking-tight leading-none whitespace-nowrap">
                                {usdPriceFormatted}
                                {isWeighed && <span className="text-[10px] font-semibold text-slate-400 ml-0.5 font-sans">/{weightUnit}</span>}
                            </span>
                        ) : currencyMode === 'BOTH' ? (
                            <>
                                <span className="text-[15px] sm:text-[16px] font-black text-slate-950 dark:text-white font-mono tabular-nums tracking-tight leading-none whitespace-nowrap">
                                    {bsPriceFormatted}
                                    {isWeighed && <span className="text-[10px] font-semibold text-slate-400 ml-0.5 font-sans">/{weightUnit}</span>}
                                </span>
                                {exchangeRate > 1 && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 tabular-nums shrink-0 ml-auto" title={`Referencia: ${usdPriceFormatted}`}>
                                        {usdPriceFormatted}
                                        {isWeighed && <span className="text-[9px] font-normal opacity-70 ml-0.5 font-sans">/{weightUnit}</span>}
                                    </span>
                                )}
                            </>
                        ) : (
                            <span className="text-[15px] sm:text-[16px] font-black text-slate-950 dark:text-white font-mono tabular-nums tracking-tight leading-none whitespace-nowrap">
                                {priceFormatted}
                                {isWeighed && <span className="text-[10px] font-semibold text-slate-400 ml-0.5 font-sans">/{weightUnit}</span>}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
        {contextMenuPortal}
        {familyPickerPortal}
        </>
    );
}, (prev, next) => {
    return (
        prev.product?.id === next.product?.id &&
        prev.product?.stockQuantity === next.product?.stockQuantity &&
        prev.product?.price === next.product?.price &&
        prev.product?.name === next.product?.name &&
        prev.product?.imageUrl === next.product?.imageUrl &&
        prev.product?.imageUri === next.product?.imageUri &&
        prev.currencyMode === next.currencyMode &&
        prev.exchangeRate === next.exchangeRate &&
        prev.isSelected === next.isSelected &&
        prev.viewMode === next.viewMode &&
        prev.viewLayout === next.viewLayout &&
        prev.isAdmin === next.isAdmin &&
        prev.intelligence === next.intelligence &&
        prev.product?.isSoldByWeight === next.product?.isSoldByWeight &&
        prev.product?.stockUnit === next.product?.stockUnit &&
        prev.product?.bulkPrice === next.product?.bulkPrice &&
        prev.product?.unitsPerBulk === next.product?.unitsPerBulk &&
        prev.product?.bulkUnitName === next.product?.bulkUnitName &&
        prev.product?.midBulkPrice === next.product?.midBulkPrice &&
        prev.product?.unitsPerMidBulk === next.product?.unitsPerMidBulk &&
        prev.product?.midBulkUnitName === next.product?.midBulkUnitName &&
        prev.product?.Presentations === next.product?.Presentations &&
        prev.product?.isFamily === next.product?.isFamily &&
        prev.product?.variants === next.product?.variants
    );
});

export default ProductItem;
