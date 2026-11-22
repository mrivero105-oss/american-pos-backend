import { useState, useMemo } from 'react';
import { X, Check, ShoppingBag, Shirt, Plus, Minus } from 'lucide-react';
import { motion } from 'framer-motion';

const COLOR_MAP = {
  negro: 'bg-black text-white border-slate-700',
  blanco: 'bg-white text-slate-900 border-slate-300 shadow-xs',
  azul: 'bg-blue-600 text-white border-blue-700',
  rojo: 'bg-red-600 text-white border-red-700',
  verde: 'bg-emerald-600 text-white border-emerald-700',
  amarillo: 'bg-amber-400 text-slate-900 border-amber-500',
  rosa: 'bg-pink-500 text-white border-pink-600',
  morado: 'bg-purple-600 text-white border-purple-700',
  gris: 'bg-slate-500 text-white border-slate-600',
  beige: 'bg-stone-200 text-stone-800 border-stone-300',
  marron: 'bg-amber-900 text-white border-amber-950'
};

export default function MobileVariantPickerModal({
  product,
  isOpen,
  onClose,
  onAddToCart,
  exchangeRate = 1,
  T
}) {
  const variants = useMemo(() => {
    if (Array.isArray(product?.Variantes) && product.Variantes.length > 0) return product.Variantes;
    if (Array.isArray(product?.variants) && product.variants.length > 0) return product.variants;
    // Variantes por defecto si el producto es de moda pero no tiene variantes desglosadas
    return [
      { id: 'v1', talla: 'S', color: 'Único', stock: product?.stockQuantity || product?.stock || 10, precio_adicional: 0 },
      { id: 'v2', talla: 'M', color: 'Único', stock: product?.stockQuantity || product?.stock || 10, precio_adicional: 0 },
      { id: 'v3', talla: 'L', color: 'Único', stock: product?.stockQuantity || product?.stock || 10, precio_adicional: 0 },
      { id: 'v4', talla: 'XL', color: 'Único', stock: product?.stockQuantity || product?.stock || 5, precio_adicional: 0 },
    ];
  }, [product]);

  const tallas = useMemo(() => Array.from(new Set(variants.map(v => v.talla).filter(Boolean))), [variants]);
  const colores = useMemo(() => Array.from(new Set(variants.map(v => v.color).filter(Boolean))), [variants]);

  const [selectedTalla, setSelectedTalla] = useState(tallas[0] || '');
  const [selectedColor, setSelectedColor] = useState(() => {
    const firstMatch = variants.find(v => (!tallas[0] || v.talla === tallas[0]) && Number(v.stock || 0) > 0);
    return firstMatch ? firstMatch.color : (colores[0] || '');
  });
  const [quantity, setQuantity] = useState(1);

  const selectedVariant = useMemo(() => {
    return variants.find(v => v.talla === selectedTalla && v.color === selectedColor) || null;
  }, [variants, selectedTalla, selectedColor]);

  if (!isOpen || !product) return null;

  const basePrice = Number(product?.precio ?? product?.price ?? product?.priceUSD ?? 0);
  const extraPrice = Number(selectedVariant?.precio_adicional || 0);
  const finalUnitPrice = basePrice + extraPrice;
  const currentStock = selectedVariant ? Number(selectedVariant.stock ?? 0) : 0;

  const handleConfirm = () => {
    if (!selectedVariant || currentStock <= 0) return;
    onAddToCart({
      ...product,
      id: `${product.id}-${selectedVariant.id}`,
      originalProductId: product.id,
      varianteId: selectedVariant.id,
      nombre: `${product.nombre || product.name || 'Artículo'} (${selectedVariant.talla} / ${selectedVariant.color})`,
      name: `${product.name || product.nombre || 'Artículo'} (${selectedVariant.talla} / ${selectedVariant.color})`,
      precio: finalUnitPrice,
      price: finalUnitPrice,
      priceUSD: finalUnitPrice,
      stockQuantity: currentStock,
      stock: currentStock,
      selectedVariant: {
        talla: selectedVariant.talla,
        color: selectedVariant.color,
        sku: selectedVariant.sku_variante || selectedVariant.sku || ''
      }
    }, quantity);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/85 cursor-pointer"
      />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md ${T?.modalCard || 'bg-slate-900'} rounded-t-xl sm:rounded-xl p-4 sm:p-5 shadow-2xl relative z-10 border-t sm:border border-slate-700/60 max-h-[90vh] overflow-y-auto space-y-4`}
      >
        {/* Handle bar móvil */}
        <div className="w-full flex justify-center pb-1 sm:hidden">
          <div className="w-12 h-1 rounded-full bg-slate-600" />
        </div>

        {/* Cabecera del Producto */}
        <div className="flex items-center justify-between border-b border-slate-700/50 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/20 shrink-0">
              <Shirt size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-white truncate">
                {product.nombre || product.name || 'Seleccionar Variante'}
              </h3>
              <p className="text-[10px] text-slate-400 truncate">
                Boutique & Calzado • Variantes de Talla y Color
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Selector de Talla */}
        {tallas.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-300">
              1. Selecciona Talla:
            </label>
            <div className="flex flex-wrap gap-2">
              {tallas.map(t => {
                const isSelected = selectedTalla === t;
                const availableForTalla = variants.filter(v => v.talla === t && Number(v.stock || 0) > 0);
                const hasStock = availableForTalla.length > 0;

                return (
                  <button
                    key={t}
                    disabled={!hasStock}
                    onClick={() => {
                      setSelectedTalla(t);
                      const matchingVariant = variants.find(v => v.talla === t && v.color === selectedColor && Number(v.stock || 0) > 0)
                        || availableForTalla[0];
                      if (matchingVariant) setSelectedColor(matchingVariant.color);
                    }}
                    className={`min-w-[44px] h-10 px-3 rounded-lg font-bold text-xs border transition-colors active:scale-95 cursor-pointer flex items-center justify-center ${
                      isSelected
                        ? 'bg-purple-600 border-purple-400 text-white shadow-sm'
                        : hasStock
                        ? 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-500'
                        : 'bg-slate-900 border-slate-800 text-slate-600 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selector de Color */}
        {colores.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
              2. Selecciona Color:
            </label>
            <div className="flex flex-wrap gap-2">
              {colores.map(c => {
                const isSelected = selectedColor === c;
                const variantMatch = variants.find(v => v.talla === selectedTalla && v.color === c);
                const hasStock = variantMatch ? Number(variantMatch.stock || 0) > 0 : false;
                const cKey = (c || '').toLowerCase();
                const colorClass = COLOR_MAP[cKey] || 'bg-slate-700 text-white border-slate-600';

                return (
                  <button
                    key={c}
                    disabled={!hasStock}
                    onClick={() => setSelectedColor(c)}
                    className={`px-3.5 py-2 rounded-lg text-xs font-semibold border flex items-center gap-2 transition-colors active:scale-95 cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-purple-500 border-white text-white font-bold shadow-sm'
                        : hasStock
                        ? 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                        : 'bg-slate-900 border-slate-800 text-slate-600 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border border-black/20 ${colorClass}`} />
                    <span>{c}</span>
                    {isSelected && <Check size={13} className="text-purple-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Resumen de la variante seleccionada: Stock y Precio */}
        <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Precio Unitario</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-base font-bold text-emerald-400">${finalUnitPrice.toFixed(2)}</span>
              {exchangeRate > 1 && (
                <span className="text-[11px] font-semibold text-amber-400">
                  Bs. {(finalUnitPrice * exchangeRate).toFixed(2)}
                </span>
              )}
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400">Stock Disponible</span>
            <p className={`text-xs font-bold mt-0.5 ${currentStock > 3 ? 'text-blue-400' : currentStock > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
              {currentStock > 0 ? `${currentStock} unidades` : 'Agotado'}
            </p>
          </div>
        </div>

        {/* Selector de Cantidad */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs font-semibold text-slate-300">Cantidad a agregar:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95 transition-colors"
            >
              <Minus size={14} />
            </button>
            <span className="w-8 text-center font-bold text-sm text-white">{quantity}</span>
            <button
              onClick={() => setQuantity(q => Math.min(currentStock || 999, q + 1))}
              disabled={quantity >= currentStock}
              className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Botón de Confirmación */}
        <button
          onClick={handleConfirm}
          disabled={!selectedVariant || currentStock <= 0}
          className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95 transition-colors"
        >
          <ShoppingBag size={16} />
          <span>Agregar {quantity}x al Carrito (${(finalUnitPrice * quantity).toFixed(2)})</span>
        </button>
      </motion.div>
    </div>
  );
}
