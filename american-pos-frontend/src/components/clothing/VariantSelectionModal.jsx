import { useState, useMemo } from 'react';
import { X, Check, ShoppingBag, Shirt, AlertCircle } from 'lucide-react';

const COLOR_MAP = {
  negro: 'bg-black text-white border-slate-700',
  blanco: 'bg-white text-slate-900 border-slate-300 shadow-sm',
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

export default function VariantSelectionModal({ product, onClose, onAddToCart, exchangeRate = 1, showDual = true }) {
  const variants = useMemo(() => {
    if (Array.isArray(product?.Variantes) && product.Variantes.length > 0) return product.Variantes;
    if (Array.isArray(product?.variants) && product.variants.length > 0) return product.variants;
    // Fallback mock variants if none loaded
    return [
      { id: 1, talla: 'S', color: 'Negro', stock: 12, precio_adicional: 0, sku_variante: `${product?.codigo_barras || 'CLOTH'}-S-BLK` },
      { id: 2, talla: 'M', color: 'Negro', stock: 8, precio_adicional: 0, sku_variante: `${product?.codigo_barras || 'CLOTH'}-M-BLK` },
      { id: 3, talla: 'L', color: 'Negro', stock: 5, precio_adicional: 2.00, sku_variante: `${product?.codigo_barras || 'CLOTH'}-L-BLK` },
      { id: 4, talla: 'S', color: 'Blanco', stock: 15, precio_adicional: 0, sku_variante: `${product?.codigo_barras || 'CLOTH'}-S-WHT` },
      { id: 5, talla: 'M', color: 'Blanco', stock: 0, precio_adicional: 0, sku_variante: `${product?.codigo_barras || 'CLOTH'}-M-WHT` },
      { id: 6, talla: 'L', color: 'Azul', stock: 4, precio_adicional: 3.50, sku_variante: `${product?.codigo_barras || 'CLOTH'}-L-BLU` },
    ];
  }, [product]);

  const tallas = useMemo(() => Array.from(new Set(variants.map(v => v.talla).filter(Boolean))), [variants]);
  const colores = useMemo(() => Array.from(new Set(variants.map(v => v.color).filter(Boolean))), [variants]);

  const [selectedTalla, setSelectedTalla] = useState(tallas[0] || '');
  const [selectedColor, setSelectedColor] = useState(() => {
    const firstAvailable = variants.find(v => (!tallas[0] || v.talla === tallas[0]) && v.stock > 0);
    return firstAvailable ? firstAvailable.color : (colores[0] || '');
  });
  const [quantity, setQuantity] = useState(1);

  const selectedVariant = useMemo(() => {
    return variants.find(v => v.talla === selectedTalla && v.color === selectedColor) || null;
  }, [variants, selectedTalla, selectedColor]);

  const basePrice = Number(product?.precio ?? product?.price ?? 0);
  const extraPrice = Number(selectedVariant?.precio_adicional || 0);
  const finalUnitPrice = basePrice + extraPrice;
  const currentStock = selectedVariant ? Number(selectedVariant.stock) : 0;

  const handleAdd = () => {
    if (!selectedVariant || currentStock <= 0) return;
    onAddToCart({
      ...product,
      id: `${product.id || 'p'}-${selectedVariant.id}`,
      producto_id: product.id,
      variante_id: selectedVariant.id,
      nombre: `${product.nombre || product.name || 'Artículo'} (${selectedVariant.talla} / ${selectedVariant.color})`,
      precio: finalUnitPrice,
      price: finalUnitPrice,
      stock: currentStock,
      sku: selectedVariant.sku_variante || product.codigo_barras,
      quantity
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 animate-fade-in">
      <div className="relative w-full max-w-xl overflow-hidden bg-slate-900 border border-slate-800 rounded-xl shadow-2xl">
        <div className="relative p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700 mb-2">
                <Shirt size={14} className="text-pink-400" /> Seleccionar Talla y Color
              </span>
              <h3 className="text-2xl font-black text-white">{product?.nombre || product?.name || 'Prenda de Moda'}</h3>
              <p className="text-sm text-slate-400 font-medium mt-1">Código: {selectedVariant?.sku_variante || product?.codigo_barras || 'N/A'}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 transition-colors rounded-full hover:text-white hover:bg-slate-800"
            >
              <X size={24} />
            </button>
          </div>

          {/* Tallas Selection */}
          <div className="mb-6">
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-3">
              1. Selecciona Talla
            </label>
            <div className="flex flex-wrap gap-2.5">
              {tallas.map(talla => {
                const isSelected = selectedTalla === talla;
                const hasStock = variants.some(v => v.talla === talla && v.stock > 0);
                return (
                  <button
                    key={talla}
                    onClick={() => {
                      setSelectedTalla(talla);
                      const avail = variants.find(v => v.talla === talla && v.stock > 0);
                      if (avail) setSelectedColor(avail.color);
                    }}
                    disabled={!hasStock}
                    className={`min-w-[3.5rem] px-4 py-2.5 rounded-xl font-black text-sm transition-all flex items-center justify-center border ${
                      isSelected
                        ? 'bg-pink-600 text-white border-pink-500 shadow-lg shadow-pink-600/30 scale-105'
                        : hasStock
                        ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700'
                        : 'bg-slate-900 text-slate-600 border-slate-800 opacity-50 cursor-not-allowed line-through'
                    }`}
                  >
                    {talla}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colores Selection */}
          <div className="mb-8">
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-3">
              2. Selecciona Color
            </label>
            <div className="flex flex-wrap gap-3">
              {colores.map(color => {
                const isSelected = selectedColor === color;
                const variantMatch = variants.find(v => v.talla === selectedTalla && v.color === color);
                const hasStock = variantMatch && variantMatch.stock > 0;
                const colorKey = color.toLowerCase().trim();
                const colorClass = COLOR_MAP[colorKey] || 'bg-slate-700 text-white border-slate-600';

                return (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    disabled={!hasStock}
                    className={`px-4 py-2 rounded-full font-bold text-xs transition-all flex items-center gap-2 border ${colorClass} ${
                      isSelected
                        ? 'ring-2 ring-pink-500 ring-offset-2 ring-offset-slate-900 scale-105 font-black'
                        : hasStock
                        ? 'opacity-90 hover:opacity-100'
                        : 'opacity-30 cursor-not-allowed line-through'
                    }`}
                  >
                    {isSelected && <Check size={14} className="shrink-0" />}
                    {color}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stock & Price Summary Panel */}
          <div className="p-4 mb-5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Disponibilidad</span>
              {selectedVariant ? (
                currentStock > 0 ? (
                  <span className="text-lg font-black text-emerald-400 flex items-center gap-1.5 mt-0.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    {currentStock} unidades en stock
                  </span>
                ) : (
                  <span className="text-lg font-black text-red-400 flex items-center gap-1.5 mt-0.5">
                    <AlertCircle size={18} /> Agotado en esta combinación
                  </span>
                )
              ) : (
                <span className="text-sm font-bold text-amber-400 mt-0.5 block">Combinación no disponible</span>
              )}
            </div>

            <div className="text-left sm:text-right">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Precio Unitario</span>
              <div className="text-2xl font-black text-pink-400">
                ${finalUnitPrice.toFixed(2)}
              </div>
              {showDual && (
                <div className="text-xs font-mono font-bold text-cyan-400">
                  Bs {(finalUnitPrice * exchangeRate).toFixed(2)}
                </div>
              )}
            </div>
          </div>

          {/* Quantity and Action */}
          <div className="flex items-center gap-4">
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1 shrink-0">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors flex items-center justify-center text-sm"
              >
                -
              </button>
              <span className="w-10 text-center font-bold text-base text-white">{quantity}</span>
              <button
                onClick={() => setQuantity(q => Math.min(currentStock || 1, q + 1))}
                disabled={quantity >= currentStock}
                className="w-9 h-9 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold transition-colors flex items-center justify-center text-sm"
              >
                +
              </button>
            </div>

            <button
              onClick={handleAdd}
              disabled={!selectedVariant || currentStock <= 0}
              className="flex-1 h-11 px-6 rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-pink-600 hover:bg-pink-700 text-white shadow-sm"
            >
              <ShoppingBag size={18} /> Añadir al Carrito
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
