import { motion, AnimatePresence } from 'framer-motion';
import { Edit3, X } from 'lucide-react';
import CachedImage from '../CachedImage';

export default function MobileImagePreviewModal({
  previewProductImage,
  onClose,
  onEditProduct,
  triggerHaptic = () => {},
  T,
  isDollarCountry
}) {
  return (
    <AnimatePresence>
      {previewProductImage && (
          <div className="fixed inset-0 z-60 flex flex-col items-center justify-center p-3 sm:p-5">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => {
                triggerHaptic(10);
                onClose();
              }}
              className="fixed inset-0 bg-black/90 cursor-pointer"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.2, bottom: 0.7 }}
              onDragEnd={(e, { offset, velocity }) => {
                if (Math.abs(offset.y) > 80 || Math.abs(velocity.y) > 350) {
                  triggerHaptic(20);
                  onClose();
                }
              }}
              onClick={(e) => e.stopPropagation()} 
              className={`w-full max-w-sm sm:max-w-md ${T.modalCard} rounded-xl p-4 sm:p-5 shadow-2xl space-y-3.5 border border-white/10 relative z-10 overflow-hidden select-none max-h-[92dvh] overflow-y-auto`}
            >
              {/* Drag Handle */}
              <div className="w-full flex justify-center pb-0.5 cursor-grab">
                <div className="w-10 h-1 rounded-full bg-slate-400/40" />
              </div>

              {/* Cabecera */}
              <div className={`flex items-center justify-between border-b ${T.border} pb-2.5`}>
                <div className="min-w-0 pr-2">
                  <h3 className={`font-black text-sm sm:text-base ${T.textPrimary} truncate`}>
                    {previewProductImage.name}
                  </h3>
                  {previewProductImage.barcode && (
                    <p className={`text-[10px] font-mono ${T.textMuted}`}>
                      {previewProductImage.barcode}
                    </p>
                  )}
                </div>
                <button 
                  onClick={() => {
                    triggerHaptic(10);
                    onClose();
                  }}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer active:scale-95 transition-all"
                  title="Cerrar vista HD"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Contenedor de la Imagen HD Completa (Sin recorte) */}
              <div className="w-full h-60 sm:h-80 rounded-2xl bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 flex items-center justify-center p-3 overflow-hidden shadow-inner relative group">
                <CachedImage 
                  src={previewProductImage.url} 
                  alt={previewProductImage.name}
                  className="max-h-full max-w-full object-contain rounded-xl drop-shadow-md transition-transform duration-300 hover:scale-105 pointer-events-none select-none"
                  style={{ imageRendering: '-webkit-optimize-contrast' }}
                />
              </div>

              {/* Barra inferior con detalles y precio */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex flex-col">
                  <span className={`text-[10px] font-bold ${T.textMuted} uppercase tracking-wider`}>Precio</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base sm:text-lg font-black text-emerald-500">
                      ${previewProductImage.priceUSD ? previewProductImage.priceUSD.toFixed(2) : '0.00'}
                    </span>
                    {!isDollarCountry && previewProductImage.priceBS > 0 && (
                      <span className="text-xs sm:text-sm font-bold text-amber-500">
                        Bs {previewProductImage.priceBS.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {onEditProduct && previewProductImage.product && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        const prod = previewProductImage.product;
                        onClose();
                        onEditProduct(prod);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs cursor-pointer active:scale-95 transition-all flex items-center gap-1.5 border border-white/10"
                    >
                      <Edit3 size={14} />
                      <span>Editar</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer active:scale-95 transition-all shadow-md shadow-blue-600/25"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
    </AnimatePresence>
  );
}