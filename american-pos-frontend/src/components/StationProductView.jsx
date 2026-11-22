import { useState, useEffect, useMemo, useCallback } from 'react';
import { Package, Box, Plus, Edit } from 'lucide-react';
import { formatMoney, formatStock, formatStockUnit, isUsdOnlyMode, isDollarOnlyCountry, formatPhysicalStock } from '../utils/format';
import { CachedImage } from './CachedImage';
import { getImageUrl } from '../utils/imageUtils';

export default function StationProductView({
    product,
    onAdd,
    onEdit,
    isAdmin,
    currencyMode = 'BOTH',
    exchangeRate = 1
}) {
    const hasVariants = Array.isArray(product?.variants) && product.variants.length > 1;

    // Estado para la variante de presentación activa (ej: 50g, 100g, 200g)
    const [activeVariantId, setActiveVariantId] = useState(() => {
        if (hasVariants) {
            const withStock = product.variants.find(v => Number(v.stockQuantity) > 0);
            return withStock ? withStock.id : product.variants[0].id;
        }
        return product?.id || null;
    });

    // Sincronizar si cambia la lista o producto padre
    useEffect(() => {
        if (!product) return;
        if (hasVariants) {
            const exists = product.variants.some(v => v.id === activeVariantId);
            if (!exists) {
                const withStock = product.variants.find(v => Number(v.stockQuantity) > 0) || product.variants[0];
                setActiveVariantId(withStock.id);
            }
        } else {
            setActiveVariantId(product.id);
        }
    }, [product, hasVariants, activeVariantId]);

    // Producto actualmente seleccionado para facturación
    const currentProduct = useMemo(() => {
        if (!product) return {};
        if (hasVariants) {
            return product.variants.find(v => v.id === activeVariantId) || product.variants[0] || product;
        }
        return product;
    }, [product, hasVariants, activeVariantId]);

    const isUsdOnly = isUsdOnlyMode({ currencyMode }) || isDollarOnlyCountry(localStorage.getItem('pos_country'));
    const isWeighed = !!(currentProduct?.isSoldByWeight || currentProduct?.stockUnit === 'kg' || currentProduct?.isFractional);
    const weightUnit = formatStockUnit(currentProduct?.stockUnit, isWeighed);

    const resolvedImageUrl = useMemo(() => {
        const raw = currentProduct?.imageUrl || currentProduct?.imageUri || product?.imageUrl || product?.imageUri;
        return raw ? getImageUrl(raw) : null;
    }, [currentProduct?.imageUrl, currentProduct?.imageUri, product?.imageUrl, product?.imageUri]);

    const unitPrice = Number(currentProduct?.price) || 0;
    const rate = Number(exchangeRate) || 1;

    // Precios formateados de la unidad base
    const usdPriceFormatted = useMemo(() => 
        formatMoney(unitPrice, 'USD', { rate, currencyMode: 'USD' }),
    [unitPrice, rate]);

    const bsPriceFormatted = useMemo(() => 
        formatMoney(unitPrice, 'VES', { rate, currencyMode: 'VES' }),
    [unitPrice, rate]);

    // Presentaciones ordenadas de menor a mayor cantidad de unidades
    const presentations = useMemo(() => {
        if (!Array.isArray(currentProduct?.Presentations)) return [];
        const getUnits = (pr) => {
            const fc = Number(pr?.factorConversion);
            if (fc > 0) return fc;
            const match = String(pr?.name || '').match(/(\d+(?:\.\d+)?)\s*(?:un|und|unid|unidades|pza|pzas)/i);
            if (match) return Number(match[1]);
            return Number(pr?.price) || 0;
        };
        return [...currentProduct.Presentations].sort((a, b) => getUnits(a) - getUnits(b));
    }, [currentProduct?.Presentations]);

    // Stock desglosado
    const stockDetails = useMemo(() => {
        const total = Number(currentProduct?.stockQuantity || 0);
        if (total <= 0) return { text: 'Sin Stock', isOutOfStock: true };
        if (isWeighed) {
            const primaryPres = presentations.find(p => p.isDefaultPurchase) || presentations[0] || null;
            const pieceFactor = Number(primaryPres?.factorConversion || (Number(currentProduct?.unitsPerBulk) !== 1 ? currentProduct?.unitsPerBulk : 0));
            const pieceName = (primaryPres?.name || currentProduct?.bulkUnitName || 'Pieza').trim();
            const exactUnits = Number(currentProduct?.stockUnits);
            if (exactUnits > 0 && pieceName && pieceName.toLowerCase() !== 'bulto') {
                const pieces = Math.round(exactUnits * 10) / 10;
                return { text: `${pieces} ${pieceName}${pieces === 1 ? '' : 's'} (${formatStock(total)} ${weightUnit})`, isOutOfStock: false };
            }
            if (pieceFactor > 0 && pieceName && pieceName.toLowerCase() !== 'bulto') {
                const pieces = Math.round((total / pieceFactor) * 10) / 10;
                return { text: `${pieces} ${pieceName}${pieces === 1 ? '' : 's'} (${formatStock(total)} ${weightUnit})`, isOutOfStock: false };
            }
            return { text: `${formatStock(total)} ${weightUnit}`, isOutOfStock: false };
        }

        if (presentations.length > 0) {
            const breakdown = formatPhysicalStock(total, presentations, {
                unitsPerBulk: currentProduct?.unitsPerBulk,
                bulkUnitName: currentProduct?.bulkUnitName
            });
            return { text: breakdown, totalUnits: total, isOutOfStock: false };
        }

        const unitsPerBulk = Number(currentProduct?.unitsPerBulk || 1);
        if (unitsPerBulk > 1) {
            const bulks = Math.floor(total / unitsPerBulk);
            const loose = total % unitsPerBulk;
            const bName = currentProduct?.bulkUnitName || 'Bulto';
            const txt = bulks > 0 && loose > 0
                ? `${bulks} ${bName}s + ${loose} un`
                : bulks > 0 ? `${bulks} ${bName}s` : `${loose} un`;
            return { text: txt, totalUnits: total, isOutOfStock: false };
        }

        return { text: `${formatStock(total)} ${weightUnit}`, totalUnits: total, isOutOfStock: false };
    }, [currentProduct?.stockQuantity, currentProduct?.stockUnits, presentations, currentProduct?.unitsPerBulk, currentProduct?.bulkUnitName, isWeighed, weightUnit]);

    // Manejador de agregar con vibración táctil (abre el selector de cantidad/peso)
    const handleAdd = useCallback((qty = 1, isBulk = false, isMidBulk = false, pres = null) => {
        if (!currentProduct || (currentProduct.stockQuantity <= 0 && !currentProduct.allowNegative)) return;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(25); } catch { /* Vibración háptica opcional no soportada */ }
        }
        onAdd(currentProduct, qty, false, isBulk, isMidBulk, pres);
    }, [onAdd, currentProduct]);

    if (!product) return null;

    return (
        <div className="w-full max-w-5xl mx-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-sm p-5 sm:p-7 space-y-6 animate-fadeIn">
            
            {/* Header del Producto en Estación */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4 sm:gap-5">
                    {/* Imagen Grande de Alta Calidad */}
                    <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 flex items-center justify-center shrink-0 shadow-xs relative overflow-hidden group">
                        {resolvedImageUrl ? (
                            <CachedImage 
                                src={resolvedImageUrl} 
                                alt={currentProduct.name} 
                                loading="lazy"
                                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                                fallback={<Package size={36} className="text-slate-300 dark:text-slate-600" />}
                            />
                        ) : (
                            <Package size={40} className="text-slate-300 dark:text-slate-600" strokeWidth={1.5} />
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2.5 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 text-[11px] font-bold tracking-wide uppercase border border-blue-200 dark:border-blue-900">
                                {currentProduct.category || product.category || 'General'}
                            </span>

                            {hasVariants && (
                                <span className="px-2.5 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 text-[11px] font-black uppercase border border-amber-200 dark:border-amber-900">
                                    {product.variants.length} Presentaciones
                                </span>
                            )}
                            
                            {/* Stock Físico Desglosado */}
                            <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-lg text-xs font-bold border shadow-2xs ${
                                stockDetails.isOutOfStock
                                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900'
                                    : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                            }`}>
                                <Package size={13} className="shrink-0" />
                                <span>Stock: {stockDetails.text}</span>
                                {stockDetails.totalUnits !== undefined && (
                                    <span className="opacity-75 font-normal">({stockDetails.totalUnits} un)</span>
                                )}
                            </span>
                        </div>

                        <div className="flex items-baseline gap-2.5 flex-wrap">
                            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white leading-tight">
                                {product.isFamily ? product.name : currentProduct.name}
                            </h2>
                            {hasVariants && currentProduct.presentationLabel && (
                                <span className="text-sm font-black text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950/50 px-2 py-0.5 rounded-md border border-primary-200 dark:border-primary-800">
                                    {currentProduct.presentationLabel}
                                </span>
                            )}
                        </div>

                        <div className="flex items-baseline gap-2 pt-0.5">
                            <span className="text-xs font-medium text-slate-500">Detal individual:</span>
                            <span className="text-base font-bold text-slate-900 dark:text-white">
                                {isUsdOnly ? usdPriceFormatted : bsPriceFormatted}
                            </span>
                            {!isUsdOnly && (
                                <span className="text-xs font-medium text-slate-400">
                                    ({usdPriceFormatted})
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Acciones Rápidas del Admin */}
                {isAdmin && onEdit && (
                    <button
                        type="button"
                        onClick={() => onEdit({ ...currentProduct, _familyVariants: product.variants })}
                        className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-xs self-start sm:self-auto"
                        title="Modificar precios o presentaciones"
                    >
                        <Edit size={14} />
                        <span>Editar Producto</span>
                    </button>
                )}
            </div>

            {/* SECCIÓN 0: Botonera Táctil de Presentaciones / Gramajes de la Familia (50g, 100g, 200g, etc.) */}
            {hasVariants && (
                <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Presentación / Gramaje:
                        </span>
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                            Selecciona para facturar o ver empaques
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-2.5">
                        {product.variants.map((v) => {
                            const isCurrent = v.id === currentProduct.id;
                            const vStock = Number(v.stockQuantity || 0);
                            const vPrice = Number(v.price || 0);
                            const vPriceUsd = formatMoney(vPrice, 'USD', { rate, currencyMode: 'USD' });
                            const vPriceBs = formatMoney(vPrice, 'VES', { rate, currencyMode: 'VES' });
                            return (
                                <button
                                    key={v.id}
                                    type="button"
                                    onClick={() => setActiveVariantId(v.id)}
                                    className={`px-4 py-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 shadow-2xs active:scale-95 ${
                                        isCurrent
                                            ? 'bg-primary-600 text-white border-primary-600 shadow-sm ring-2 ring-primary-500/40'
                                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
                                    }`}
                                >
                                    <span className="text-sm font-black">{v.presentationLabel || v.name}</span>
                                    <div className="text-left shrink-0">
                                        <div className={`text-xs font-mono font-bold leading-tight whitespace-nowrap tabular-nums ${isCurrent ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                                            {isUsdOnly ? vPriceUsd : vPriceBs}
                                        </div>
                                        {!isUsdOnly && (
                                            <div className={`text-[10px] whitespace-nowrap tabular-nums ${isCurrent ? 'text-primary-100' : 'text-slate-400'}`}>
                                                {vPriceUsd}
                                            </div>
                                        )}
                                    </div>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ml-1 ${
                                        vStock > 0
                                            ? (isCurrent ? 'bg-primary-700 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40')
                                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40'
                                    }`}>
                                        {vStock > 0 ? `${vStock} disp` : 'Agotado'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* SECCIÓN 1: Botonera Táctil de Presentaciones Dinámicas (Cartones, Cajas, Bultos) */}
            {presentations.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Box className="text-blue-600 dark:text-blue-400" size={17} />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                Presentaciones por Empaque / Mayor
                            </h3>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">
                            Selecciona un empaque para indicar la cantidad
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        {presentations.map((pres) => {
                            const presPrice = Number(pres.price) || 0;
                            const factor = Number(pres.factorConversion) || 1;
                            const formattedBs = formatMoney(presPrice, 'VES', { rate, currencyMode: 'VES' });
                            const formattedUsd = formatMoney(presPrice, 'USD', { rate, currencyMode: 'USD' });
                            
                            const unitEq = factor > 0 ? (presPrice / factor) : 0;
                            const unitEqBs = formatMoney(unitEq, 'VES', { rate, currencyMode: 'VES' });
                            const unitEqUsd = formatMoney(unitEq, 'USD', { rate, currencyMode: 'USD' });
                            
                            const retailEquivalent = factor * unitPrice;
                            const savingsPct = retailEquivalent > presPrice && retailEquivalent > 0
                                ? Math.round(((retailEquivalent - presPrice) / retailEquivalent) * 100)
                                : 0;

                            const cleanName = pres.name
                                .replace(/\bcomplet[ao]s?\b/gi, '')
                                .replace(/\s+/g, ' ')
                                .trim();

                            return (
                                <button
                                    key={pres.id}
                                    type="button"
                                    onClick={() => handleAdd(1, false, false, pres)}
                                    className="group relative text-left p-4 rounded-2xl bg-slate-50/70 hover:bg-blue-50/50 dark:bg-slate-800/40 dark:hover:bg-blue-950/30 border border-slate-200 dark:border-slate-700/80 hover:border-blue-500/60 dark:hover:border-blue-500/60 transition-all duration-150 cursor-pointer shadow-xs active:scale-[0.98] flex items-center justify-between gap-4"
                                >
                                    <div className="space-y-1 min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                                {cleanName}
                                            </h4>
                                            {savingsPct > 0 && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 shrink-0">
                                                    -{savingsPct}% OFF
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 font-medium">
                                            <span>{isWeighed ? `Peso prom. ~${factor} ${weightUnit}` : `Contiene ${factor} unidades`}</span>
                                            <span>·</span>
                                            <span>Sale a {isUsdOnly ? unitEqUsd : unitEqBs} {isWeighed ? `/${weightUnit}` : 'c/u'}</span>
                                        </p>
                                    </div>

                                    {/* Precio Grande */}
                                    <div className="text-right shrink-0">
                                        <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white tabular-nums leading-tight">
                                            {isUsdOnly ? formattedUsd : formattedBs}
                                        </div>
                                        {!isUsdOnly && (
                                            <div className="text-xs font-bold text-slate-400 dark:text-slate-500 tabular-nums">
                                                {formattedUsd}
                                            </div>
                                        )}
                                    </div>

                                    {/* Botón flotante de añadir */}
                                    <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 flex items-center justify-center shrink-0 transition-colors shadow-2xs">
                                        <Plus size={16} strokeWidth={2.5} />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* SECCIÓN 2: Barra Táctil de Venta al Detal (Unidades Sueltas) */}
            <div className="pt-2">
                <div
                    onClick={() => handleAdd(1)}
                    className="p-4 rounded-2xl bg-slate-50 hover:bg-blue-50/40 dark:bg-slate-800/40 dark:hover:bg-blue-950/20 border border-slate-200 dark:border-slate-700 hover:border-blue-500/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 transition-all cursor-pointer group"
                >
                    <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-0.5">
                            {isWeighed
                                ? `Venta al Detal / Rebanado por Peso (${currentProduct.presentationLabel || currentProduct.name})`
                                : `Venta al Detal / Unidades Sueltas (${currentProduct.presentationLabel || currentProduct.name})`}
                        </span>
                        <div className="flex items-baseline gap-2">
                            <span className="text-lg font-black text-slate-900 dark:text-white">
                                {isUsdOnly ? usdPriceFormatted : bsPriceFormatted}
                            </span>
                            {!isUsdOnly && (
                                <span className="text-xs font-semibold text-slate-400">
                                    ({usdPriceFormatted}) por {isWeighed ? weightUnit : 'unidad'}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleAdd(1);
                            }}
                            className="h-10 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-xs active:scale-95"
                        >
                            <Plus size={14} strokeWidth={2.5} />
                            <span>{isWeighed ? `Pesar al Detal (${weightUnit} / Monto)` : 'Ingresar Cantidad (Unidades)'}</span>
                        </button>
                    </div>
                </div>
            </div>

        </div>
    );
}
