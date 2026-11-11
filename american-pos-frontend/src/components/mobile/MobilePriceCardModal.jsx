import React from 'react';
import { Tag, X, Box, ShoppingCart, Scan } from 'lucide-react';

export default function MobilePriceCardModal({
  product,
  onClose,
  T,
  getImageUrl,
  exchangeRate,
  addToCart,
  showToast,
  onOpenScanner
}) {
  if (!product) return null;
  const priceCheckerProduct = product;
  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 animate-fadeIn">
          <div className={`w-full max-w-sm sm:max-w-md ${T.modalCard} rounded-xl p-4 sm:p-5 shadow-2xl border ${T.border} flex flex-col space-y-4 max-h-[92dvh] overflow-y-auto`}>
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <Tag size={18} className="text-amber-500" />
                <h3 className={`text-xs font-black uppercase tracking-wider ${T.textPrimary}`}>
                  Consultor de Precios
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onClose()}
                className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Foto & Info */}
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                {priceCheckerProduct.imageUrl || priceCheckerProduct.imageUri || priceCheckerProduct.image ? (
                  <img
                    src={getImageUrl(priceCheckerProduct.imageUrl || priceCheckerProduct.imageUri || priceCheckerProduct.image)}
                    alt={priceCheckerProduct.name}
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <Box size={24} className="text-slate-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">
                  {priceCheckerProduct.category || 'General'}
                </span>
                <h4 className={`text-sm font-black ${T.textPrimary} leading-tight line-clamp-2`}>
                  {priceCheckerProduct.name || priceCheckerProduct.nombre}
                </h4>
                {priceCheckerProduct.barcode && (
                  <span className="text-[10px] font-mono text-slate-400 mt-1 block">
                    {priceCheckerProduct.barcode}
                  </span>
                )}
              </div>
            </div>

            {/* Precios Gigantes */}
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
                PRECIO AL PÚBLICO
              </span>
              <div className="text-2xl font-black text-emerald-400 font-mono">
                ${Number(priceCheckerProduct.price || priceCheckerProduct.precio || 0).toFixed(2)}
              </div>
              <div className="text-sm font-black text-amber-400 font-mono">
                Bs. {(Number(priceCheckerProduct.price || priceCheckerProduct.precio || 0) * exchangeRate).toFixed(2)}
              </div>
            </div>

            {/* Stock disponible */}
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className={T.textMuted}>Disponibilidad:</span>
              <span className={`font-black ${
                Number(priceCheckerProduct.stockQuantity ?? priceCheckerProduct.stock ?? 0) > 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}>
                {Number(priceCheckerProduct.stockQuantity ?? priceCheckerProduct.stock ?? 0) > 0
                  ? `🟢 En Stock (${priceCheckerProduct.stockQuantity ?? priceCheckerProduct.stock} unid)`
                  : '🔴 Sin Existencias'}
              </span>
            </div>

            {/* Acciones */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  addToCart(priceCheckerProduct);
                  onClose();
                  showToast(`🛒 +1 ${priceCheckerProduct.name || priceCheckerProduct.nombre}`);
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
              >
                <ShoppingCart size={14} />
                <span>Agregar</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenScanner();
                }}
                className="px-3.5 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold uppercase flex items-center justify-center gap-1 cursor-pointer active:scale-95 border border-blue-500/30"
              >
                <Scan size={14} />
                <span>Otro</span>
              </button>
            </div>
          </div>
        </div>
  );
}