import { memo, useEffect, useRef } from 'react';
import { Minus, Package, Plus } from 'lucide-react';
import { CachedImage } from '../CachedImage';
import { triggerHaptic } from '../../utils/haptics';

/**
 * MobileProductCard — Next-Gen Tactical UI (60/120 FPS Hardware Accelerated)
 * - React.memo estricto + CSS containment (`contain: content`) sin blur en scroll para cero lag.
 * - Estado activo iluminado cuando el producto está en el ticket (`committedInCart > 0`).
 * - Stepper táctil en vivo `[-] cant [+]` directo sobre la tarjeta (Lista y Cuadrícula).
 */
function MobileProductCardComponent({
  product,
  layout = 'grid',
  cartQuantity = 0,
  exchangeRate,
  businessMode,
  posMode,
  isLight,
  onAddToCart,
  onDecrementFromCart,
  onOpenBulkPicker,
  onPriceCheck,
  onEditProduct,
  onPreviewImage
}) {
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const lastImageTapRef = useRef(0);

  // Limpiar temporizador de long-press si la tarjeta se desmonta durante scroll virtualizado
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  const priceUSD = Number(product.price || product.precio || 0);
  const priceBS = Number(product.priceBs) > 0 ? Number(product.priceBs) : (priceUSD * (exchangeRate || 1));
  const committedInCart = Number(cartQuantity || 0);
  const isSelected = committedInCart > 0;
  const physicalStock = Number(product.stockQuantity ?? product.stock ?? 0);
  const availableStock = Math.max(0, physicalStock - committedInCart);
  const isExhausted = availableStock <= 0;
  const rawImage = product.imageUrl || product.imageUri || product.image || '';
  const hasImage = Boolean(rawImage && String(rawImage).trim());

  const unitsPerBulk = Number(product.unitsPerBulk) || 1;
  const bulkPriceUSD = Number(product.bulkPrice) || 0;
  const unitsPerMidBulk = Number(product.unitsPerMidBulk) || 0;
  const hasBulk = unitsPerBulk > 1 || bulkPriceUSD > 0 || unitsPerMidBulk > 0;

  const hasVariants = (Array.isArray(product.Variantes) && product.Variantes.length > 0) ||
                      (Array.isArray(product.variants) && product.variants.length > 0) ||
                      (businessMode === 'CLOTHING');

  const handleTouchStart = (e) => {
    const touch = e.touches?.[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      triggerHaptic(30);
      if (onEditProduct) onEditProduct(product);
    }, 600);
  };

  const handleTouchMove = (e) => {
    const touch = e.touches?.[0];
    if (touch && touchStartRef.current) {
      const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
      const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
      if (deltaX > 8 || deltaY > 8) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (posMode === 'PRICE_CHECKER') {
      if (onPriceCheck) onPriceCheck(product);
    } else {
      if (hasBulk && onOpenBulkPicker && !isSelected) {
        onOpenBulkPicker(product);
      } else if (onAddToCart) {
        onAddToCart(product);
      }
    }
  };

  const handleDecrement = (e) => {
    e.stopPropagation();
    if (onDecrementFromCart) {
      onDecrementFromCart(product);
    }
  };

  const handleIncrement = (e) => {
    e.stopPropagation();
    if (onAddToCart) {
      onAddToCart(product);
    }
  };

  const categoryLabel = product.category || product.categoria || 'General';

  const handleContextMenu = (e) => {
    if (onEditProduct) {
      e.preventDefault();
      e.stopPropagation();
      triggerHaptic(25);
      onEditProduct(product);
    }
  };

  const handleImageAreaClick = (e) => {
    if (!hasImage || !onPreviewImage) return;
    const now = Date.now();
    if (now - lastImageTapRef.current < 320) {
      e.stopPropagation();
      lastImageTapRef.current = 0;
      triggerHaptic(15);
      onPreviewImage({
        product,
        name: product.name || product.nombre,
        url: rawImage,
        priceUSD,
        priceBS,
        barcode: product.barcode || '',
        stock: availableStock
      });
      return;
    }
    lastImageTapRef.current = now;
  };

  // ---------------------------------------------------------------------------
  // VISTA 1: LISTA TÁCTICA DE ALTA DENSIDAD CON STEPPER EN VIVO
  // ---------------------------------------------------------------------------
  if (layout === 'list') {
    return (
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchCancel={handleTouchEnd}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        className={`w-full min-w-0 border rounded-2xl p-2.5 sm:p-3 flex items-center justify-between gap-2.5 transition-transform duration-75 active:scale-[0.99] cursor-pointer select-none relative ${
          isSelected
            ? (isLight
                ? 'bg-emerald-50/60 border-emerald-500 ring-1 ring-emerald-500/25 shadow-xs'
                : 'bg-[#0f1c18] border-emerald-500/70 ring-1 ring-emerald-500/25 shadow-xs')
            : isExhausted
              ? (isLight ? 'opacity-60 bg-[#f8f9fb] border-[#e2e5eb]' : 'opacity-55 bg-[#0f1319] border-[#1c222d]')
              : (isLight
                  ? 'bg-white hover:bg-slate-50 border-[#e2e8f0] shadow-2xs'
                  : 'bg-[#121720] hover:bg-[#171e29] border-[#1f2735]')
        }`}
        style={{ contain: 'content' }}
      >
        {/* 1. Miniatura con Indicador de Selección */}
        <div className={`w-12 h-12 rounded-xl shrink-0 overflow-hidden relative border flex items-center justify-center p-0.5 ${
          isSelected
            ? 'border-emerald-500/50 bg-emerald-950/30'
            : (isLight ? 'bg-[#f8fafc] border-[#e2e8f0]' : 'bg-[#0b0e14] border-[#1c2330]')
        }`}>
          {hasImage ? (
            <CachedImage
              src={rawImage}
              alt={product.name || product.nombre}
              className="w-full h-full object-contain pointer-events-none select-none"
              loading="lazy"
              decoding="async"
              draggable={false}
              fallback={
                <span className="font-mono text-[11px] font-black tracking-wider uppercase text-slate-400">
                  {(product.name || 'P').substring(0, 2)}
                </span>
              }
            />
          ) : (
            <span className="font-mono text-[11px] font-black tracking-wider uppercase text-slate-400">
              {(product.name || 'P').substring(0, 2)}
            </span>
          )}
          {isSelected && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-bl-lg bg-emerald-500 text-slate-950 font-mono font-black text-[10px] flex items-center justify-center">
              {committedInCart}
            </span>
          )}
        </div>

        {/* 2. Columna Central: Nombre, Categoría, Stock y Empaques */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
          <h3 className={`font-extrabold text-[12.5px] sm:text-[13.5px] leading-tight truncate ${
            isLight ? 'text-[#0a0d12]' : 'text-[#f8fafc]'
          }`}>
            {product.name || product.nombre}
          </h3>

          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className={`text-[9.5px] font-bold uppercase tracking-wider truncate max-w-[100px] ${
              isLight ? 'text-[#64748b]' : 'text-[#8e9bb0]'
            }`}>
              {categoryLabel}
            </span>
            <span className="text-slate-300 dark:text-slate-700 text-[10px]">•</span>
            <span className={`text-[9.5px] font-black px-1.5 py-0.5 rounded-md border leading-none ${
              isExhausted
                ? (isLight ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-rose-950/80 text-rose-300 border-rose-800/70')
                : availableStock <= 5
                ? (isLight ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-amber-950/80 text-amber-300 border-amber-800/70')
                : (isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-[#1a2230] text-slate-300 border-[#283244]')
            }`}>
              {isExhausted ? 'AGOTADO' : `${availableStock.toFixed(0)} disp.`}
            </span>

            {hasVariants && (
              <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border leading-none ${
                isLight ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60'
              }`}>
                Tallas
              </span>
            )}
            {product.principio_activo && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border truncate max-w-[85px] leading-none ${
                isLight ? 'bg-cyan-50 text-cyan-800 border-cyan-200' : 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60'
              }`}>
                {product.principio_activo}
              </span>
            )}
          </div>

          {hasBulk && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenBulkPicker) onOpenBulkPicker(product);
                }}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border flex items-center gap-1 cursor-pointer transition-colors active:scale-95 ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                    : 'bg-[#1a2230] hover:bg-[#232d3f] text-slate-200 border-[#2b364a]'
                }`}
                title={`Vender por ${product.bulkUnitName || 'Caja'}`}
              >
                <Package size={10} className="shrink-0 text-amber-400" />
                <span className="truncate">{product.bulkUnitName || 'Caja'} ({unitsPerBulk}u):</span>
                <span className="font-mono font-black text-emerald-400">
                  ${(bulkPriceUSD > 0 ? bulkPriceUSD : priceUSD * unitsPerBulk).toFixed(2)}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* 3. Columna Derecha: Precios Duales + Control Táctil (Stepper si está en carrito o Botón +) */}
        <div className="flex items-center gap-2 shrink-0 pl-1">
          <div className="flex flex-col items-end justify-center">
            <span className={`text-[14px] font-black font-mono leading-none tracking-tight tabular-nums ${
              isLight ? 'text-[#0a0d12]' : 'text-white'
            }`}>
              ${priceUSD.toFixed(2)}
            </span>
            <span className={`mt-1 text-[10.5px] font-bold font-mono leading-none tabular-nums ${
              isLight ? 'text-slate-500' : 'text-amber-300/90'
            }`}>
              Bs. {priceBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {isSelected && onDecrementFromCart ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center bg-emerald-500 text-slate-950 rounded-xl p-0.5 shadow-xs"
            >
              <button
                type="button"
                onClick={handleDecrement}
                className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-black/10 active:scale-90 transition-transform cursor-pointer"
                title="Restar 1"
              >
                <Minus size={16} className="stroke-[2.8]" />
              </button>
              <span className="px-1.5 font-mono font-black text-xs tabular-nums min-w-[22px] text-center">
                {committedInCart}
              </span>
              <button
                type="button"
                onClick={handleIncrement}
                disabled={isExhausted}
                className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-black/10 active:scale-90 transition-transform cursor-pointer disabled:opacity-40"
                title="Sumar 1"
              >
                <Plus size={16} className="stroke-[2.8]" />
              </button>
            </div>
          ) : (
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-2xs ${
              isExhausted
                ? 'opacity-40 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-400'
                : (isLight
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600'
                    : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/40')
            }`}>
              <Plus size={17} className="stroke-[2.6]" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VISTA 2: CUADRÍCULA TÁCTICA DE ÚLTIMA GENERACIÓN (OBSIDIAN CARDS)
  // ---------------------------------------------------------------------------
  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchEnd}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      className={`min-w-0 border rounded-2xl overflow-hidden flex flex-col justify-between transition-transform duration-75 active:scale-[0.98] cursor-pointer select-none relative ${
        isSelected
          ? (isLight
              ? 'bg-emerald-50/50 border-emerald-500 ring-2 ring-emerald-500/25 shadow-sm'
              : 'bg-[#0e1a17] border-emerald-500/80 ring-1 ring-emerald-500/30 shadow-sm')
          : isExhausted
            ? (isLight ? 'opacity-60 bg-[#f8f9fb] border-[#e2e5eb]' : 'opacity-55 bg-[#0f1319] border-[#1c222d]')
            : (isLight
                ? 'bg-white border-[#e2e8f0] shadow-2xs'
                : 'bg-[#121720] border-[#1f2735]')
      }`}
      style={{ contain: 'content' }}
    >
      {/* 1. Cabecera Visual: Imagen 100% Despejada (Sin botones circulares que saturen la vista) */}
      <div
        onClick={handleImageAreaClick}
        className={`w-full h-28 sm:h-32 flex items-center justify-center relative overflow-hidden border-b p-2.5 ${
          isSelected
            ? (isLight ? 'bg-emerald-50/40 border-emerald-200' : 'bg-[#0b1512] border-emerald-900/50')
            : (isLight ? 'bg-[#f8fafc] border-[#edf2f7]' : 'bg-[#0b0e14] border-[#19202c]')
        }`}
      >
        {hasImage ? (
          <CachedImage
            src={rawImage}
            alt={product.name || product.nombre}
            className="w-full h-full object-contain pointer-events-none select-none"
            loading="lazy"
            decoding="async"
            draggable={false}
            fallback={
              <div className="flex flex-col items-center justify-center text-slate-400 pointer-events-none select-none">
                <span className="font-mono text-xs font-black tracking-wider uppercase">
                  {(product.name || 'P').substring(0, 2)}
                </span>
              </div>
            }
          />
        ) : (
          <div className="w-11 h-11 rounded-2xl bg-slate-500/10 border border-slate-500/20 flex items-center justify-center text-slate-400 pointer-events-none select-none">
            <span className="font-mono text-xs font-black tracking-wider uppercase">
              {(product.name || 'P').substring(0, 2)}
            </span>
          </div>
        )}

        {/* Solo mostrar etiqueta sobre la imagen cuando esté agotado */}
        {isExhausted && (
          <div className="absolute top-2 left-2 z-10 pointer-events-none">
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border uppercase tracking-wider ${
              isLight ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-rose-950/95 text-rose-300 border-rose-800'
            }`}>
              Agotado
            </span>
          </div>
        )}
      </div>

      {/* 2. Cuerpo: Nombre + Fila Integrada de Categoría y Disponibilidad */}
      <div className="p-2.5 flex-1 flex flex-col justify-between min-w-0">
        <div>
          <h3 className={`font-extrabold text-[12.5px] sm:text-[13px] leading-snug line-clamp-2 ${
            isLight ? 'text-[#0a0d12]' : 'text-[#f8fafc]'
          }`}>
            {product.name || product.nombre}
          </h3>
          <div className="flex items-center justify-between gap-1.5 mt-1">
            <span className={`text-[9.5px] font-bold uppercase tracking-wider truncate ${
              isLight ? 'text-[#64748b]' : 'text-[#8e9bb0]'
            }`}>
              {categoryLabel}
            </span>
            <span className={`text-[9.5px] font-extrabold font-mono shrink-0 ${
              isExhausted
                ? (isLight ? 'text-rose-600' : 'text-rose-400')
                : availableStock <= 5
                ? (isLight ? 'text-amber-600' : 'text-amber-400')
                : (isLight ? 'text-slate-500' : 'text-slate-400')
            }`}>
              {isExhausted ? '0 disp.' : `${availableStock.toFixed(0)} disp.`}
            </span>
          </div>
        </div>

        {(hasVariants || product.principio_activo || product.es_controlado) && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {hasVariants && (
              <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border ${
                isLight ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60'
              }`}>
                Tallas/Colores
              </span>
            )}
            {product.principio_activo && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border truncate max-w-full ${
                isLight ? 'bg-cyan-50 text-cyan-800 border-cyan-200' : 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60'
              }`}>
                {product.principio_activo}
              </span>
            )}
            {product.es_controlado && (
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border ${
                isLight ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-amber-950/60 text-amber-300 border-amber-800/60'
              }`}>
                Controlado
              </span>
            )}
          </div>
        )}
      </div>

      {/* 3. Pie de Tarjeta: Presentación por Caja + Barra de Precio Dual o Stepper Táctil Activo */}
      <div className="w-full mt-auto">
        {hasBulk && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenBulkPicker) onOpenBulkPicker(product);
            }}
            className={`w-full px-2.5 py-1.5 flex items-center justify-between text-[10px] font-extrabold transition-colors border-t cursor-pointer ${
              isLight
                ? 'border-[#e2e8f0] bg-slate-50 hover:bg-slate-100 text-slate-700'
                : 'border-[#1f2735] bg-[#161d29] hover:bg-[#1d2636] text-slate-200'
            }`}
            title={`Vender por ${product.bulkUnitName || 'Caja'}`}
          >
            <span className="flex items-center gap-1 truncate">
              <Package size={11} className="shrink-0 text-amber-400" />
              <span className="truncate">{product.bulkUnitName || 'Caja'} ({unitsPerBulk}u)</span>
            </span>
            <span className="font-mono font-black text-emerald-400 shrink-0">
              ${(bulkPriceUSD > 0 ? bulkPriceUSD : priceUSD * unitsPerBulk).toFixed(2)}
            </span>
          </button>
        )}

        {isSelected && onDecrementFromCart ? (
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full px-2 py-1.5 border-t border-emerald-500/40 bg-emerald-500 text-slate-950 flex items-center justify-between gap-1"
          >
            <button
              type="button"
              onClick={handleDecrement}
              className="w-10 h-11 rounded-lg bg-black/15 hover:bg-black/25 flex items-center justify-center active:scale-90 transition-transform cursor-pointer shrink-0"
              title="Restar 1"
            >
              <Minus size={15} className="stroke-[2.8]" />
            </button>
            <div className="flex flex-col items-center leading-none min-w-0">
              <span className="font-mono font-black text-xs tabular-nums">
                {committedInCart} en ticket
              </span>
              <span className="text-[9.5px] font-extrabold font-mono opacity-85 tabular-nums truncate">
                ${(priceUSD * committedInCart).toFixed(2)}
              </span>
            </div>
            <button
              type="button"
              onClick={handleIncrement}
              disabled={isExhausted}
              className="w-10 h-11 rounded-lg bg-black/15 hover:bg-black/25 flex items-center justify-center active:scale-90 transition-transform cursor-pointer shrink-0 disabled:opacity-40"
              title="Sumar 1"
            >
              <Plus size={15} className="stroke-[2.8]" />
            </button>
          </div>
        ) : (
          <div className={`w-full px-2.5 py-2 flex items-center justify-between gap-1 border-t ${
            isLight ? 'border-[#e2e8f0] bg-white' : 'border-[#1f2735] bg-[#0f141c]'
          }`}>
            <div className="flex flex-col min-w-0 leading-none">
              <span className={`text-[13.5px] sm:text-[14.5px] font-black font-mono tracking-tight tabular-nums truncate ${
                isLight ? 'text-[#0a0d12]' : 'text-white'
              }`}>
                ${priceUSD.toFixed(2)}
              </span>
              <span className={`text-[10px] font-bold font-mono mt-0.5 tabular-nums truncate ${
                isLight ? 'text-slate-500' : 'text-amber-300/90'
              }`}>
                Bs. {priceBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
              isExhausted
                ? 'opacity-40 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-400'
                : (isLight
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40')
            }`}>
              <Plus size={14} className="stroke-[2.6]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const MobileProductCard = memo(MobileProductCardComponent, (prev, next) => {
  return (
    prev.cartQuantity === next.cartQuantity &&
    prev.layout === next.layout &&
    prev.product.id === next.product.id &&
    prev.product.stockQuantity === next.product.stockQuantity &&
    prev.product.stock === next.product.stock &&
    prev.product.price === next.product.price &&
    prev.product.precio === next.product.precio &&
    prev.product.priceBs === next.product.priceBs &&
    prev.product.unitsPerBulk === next.product.unitsPerBulk &&
    prev.product.bulkPrice === next.product.bulkPrice &&
    prev.product.unitsPerMidBulk === next.product.unitsPerMidBulk &&
    prev.product.midBulkPrice === next.product.midBulkPrice &&
    prev.product.name === next.product.name &&
    prev.product.nombre === next.product.nombre &&
    prev.product.imageUrl === next.product.imageUrl &&
    prev.product.imageUri === next.product.imageUri &&
    prev.product.image === next.product.image &&
    prev.exchangeRate === next.exchangeRate &&
    prev.isLight === next.isLight &&
    prev.posMode === next.posMode &&
    prev.businessMode === next.businessMode
  );
});

export default MobileProductCard;
