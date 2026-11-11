import React, { useState, useEffect } from 'react';
import { X, Check, Trash2, Scale, Box, ArrowRight, CornerDownLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const triggerHaptic = (ms = 12) => {
  try {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(ms);
    }
  } catch (_) {}
};

/**
 * MobileQuantityModal
 * High-performance, tactile numeric & decimal keypad for quick multiple quantities
 * and bulk/weighed products (e.g. 0.450 kg, 24 units).
 */
export default function MobileQuantityModal({
  isOpen,
  onClose,
  item,
  onApplyQuantity,
  T = {},
  isLight = false
}) {
  const [valStr, setValStr] = useState('1');

  useEffect(() => {
    if (isOpen && item) {
      const initialQty = item.quantity !== undefined ? String(item.quantity) : '1';
      setValStr(initialQty);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const product = item.product || {};
  const price = Number(product.price || product.precio || 0);
  const isUnlimited = Boolean(
    product.isCustom ||
    product.allowNegative ||
    product.stockQuantity === '∞' ||
    String(product.id || '').startsWith('manual_')
  );
  const baseStock = isUnlimited ? Infinity : Math.max(0, Number(product.stockQuantity ?? product.stock ?? 0));
  const mult = product.isBulk ? (Number(product.unitsPerBulk) || 1) : (product.isMidBulk ? (Number(product.unitsPerMidBulk) || 1) : 1);
  const maxStock = isUnlimited ? Infinity : (mult > 1 ? Math.floor(baseStock / mult) : baseStock);
  const currentNum = parseFloat(valStr) || 0;
  const exceedsStock = !isUnlimited && currentNum > maxStock;
  const effectiveNum = exceedsStock ? maxStock : currentNum;
  const subtotal = (effectiveNum * price).toFixed(2);

  // Determinar si es producto pesado / a granel por categoría o nombre
  const isBulkProduct = Boolean(
    product.aGranel || 
    product.unidad_medida === 'KG' || 
    product.unit === 'KG' || 
    /kg|kilo|peso|gramo|pesable|queso|carne|pollo|jamon|fruta|verdura/i.test(product.name || product.nombre || '') ||
    /kg|peso/i.test(product.category || product.categoria || '')
  );

  const formatQtyValue = (val) => {
    return isBulkProduct || String(val).includes('.')
      ? Number(val).toFixed(3).replace(/\.?0+$/, '')
      : String(Math.round(val));
  };

  const handleDigit = (digit) => {
    triggerHaptic(10);
    setValStr(prev => {
      let nextStr = prev;
      // Si el valor inicial es '1' o '0' y el usuario presiona un dígito (sin punto), reemplazar
      if (prev === '0' || (prev === '1' && digit !== '.' && valStr === String(item.quantity))) {
        nextStr = digit;
      } else if (digit === '.') {
        if (prev.includes('.')) return prev;
        nextStr = prev + '.';
      } else {
        // Limitar a 3 decimales después del punto
        if (prev.includes('.')) {
          const parts = prev.split('.');
          if (parts[1] && parts[1].length >= 3) return prev;
        }
        // Limitar longitud total
        if (prev.replace('.', '').length >= 5) return prev;
        nextStr = prev + digit;
      }

      const parsed = parseFloat(nextStr);
      if (!isUnlimited && !isNaN(parsed) && parsed > maxStock && maxStock > 0) {
        triggerHaptic(25);
        return formatQtyValue(maxStock);
      }
      return nextStr;
    });
  };

  const handleBackspace = () => {
    triggerHaptic(12);
    setValStr(prev => {
      if (prev.length <= 1) return '0';
      return prev.slice(0, -1);
    });
  };

  const handleClear = () => {
    triggerHaptic(15);
    setValStr('1');
  };

  const handleAddPreset = (delta) => {
    triggerHaptic(12);
    setValStr(prev => {
      const current = parseFloat(prev) || 0;
      const rawNext = Math.max(0.001, current + delta);
      const next = !isUnlimited ? Math.min(maxStock, rawNext) : rawNext;
      return formatQtyValue(next);
    });
  };

  const handleSetExactPreset = (exact) => {
    triggerHaptic(15);
    const clamped = !isUnlimited ? Math.min(maxStock, exact) : exact;
    setValStr(formatQtyValue(clamped));
  };

  const handleConfirm = () => {
    triggerHaptic(15);
    const finalQty = parseFloat(valStr);
    if (isNaN(finalQty) || finalQty <= 0) {
      onApplyQuantity(product.id, 0); // Quitar del carrito
    } else {
      const clamped = !isUnlimited ? Math.min(maxStock, finalQty) : finalQty;
      // Si es entero, redondear; si es decimal, hasta 3 decimales
      const sanitized = isBulkProduct ? Number(clamped.toFixed(3)) : Math.round(clamped * 1000) / 1000;
      onApplyQuantity(product.id, sanitized);
    }
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 animate-fadeIn">
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 280 }}
          className={`w-full max-w-sm rounded-t-xl sm:rounded-xl border border-slate-800 shadow-2xl overflow-y-auto flex flex-col ${
            isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-slate-100'
          }`}
          style={{ maxHeight: '92dvh', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {/* Header del Modal */}
          <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between shrink-0 bg-slate-950/40">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shrink-0">
                {isBulkProduct ? <Scale size={18} /> : <Box size={18} />}
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-xs sm:text-sm truncate leading-tight">
                  {product.name || product.nombre || 'Ajustar Cantidad'}
                </h3>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                  Precio: <b className="text-emerald-400">${price.toFixed(2)}</b> c/u
                  {!isUnlimited ? ` • Stock disp: ${maxStock}` : (isBulkProduct ? ' • (Pesaje a granel)' : ' • (Unidades)')}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer active:scale-95 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Display Principal Monospace de Alta Visibilidad */}
          <div className="p-3.5 text-center bg-slate-950/60 border-b border-slate-800/60 shrink-0">
            <div className="flex items-baseline justify-center gap-2">
              <span className="font-mono font-black text-4xl sm:text-5xl tracking-tight text-white select-none">
                {valStr}
              </span>
              <span className="text-xs font-black uppercase text-emerald-400 tracking-wider">
                {product.isBulk ? (product.bulkUnitName || 'CAJAS') : product.isMidBulk ? (product.midBulkUnitName || 'MEDIAS') : (isBulkProduct ? 'KG' : 'UND')}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-center gap-2 text-xs">
              <span className="text-slate-400 text-[11px]">Subtotal Estimado:</span>
              <span className="font-black text-emerald-400 font-mono text-sm">
                ${subtotal} USD
              </span>
              {!isUnlimited && currentNum >= maxStock && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">
                  Máx: {maxStock}
                </span>
              )}
            </div>
          </div>

          {/* Fila de Chips de Incremento Rápido */}
          <div className="p-2 px-3 border-b border-slate-800/40 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 bg-slate-950/20">
            {isBulkProduct ? (
              <>
                {[0.100, 0.250, 0.500, 1.000].map(delta => (
                  <button
                    key={delta}
                    type="button"
                    disabled={!isUnlimited && currentNum >= maxStock}
                    onClick={() => handleAddPreset(delta)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-emerald-400 border border-slate-700/60 font-bold text-[11px] whitespace-nowrap active:scale-95 cursor-pointer"
                  >
                    +{delta.toFixed(3)} kg
                  </button>
                ))}
                {[0.250, 0.500, 1.000].map(exact => (
                  <button
                    key={`exact-${exact}`}
                    type="button"
                    disabled={!isUnlimited && exact > maxStock}
                    onClick={() => handleSetExactPreset(exact)}
                    className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-35 text-blue-300 border border-blue-500/30 font-bold text-[11px] whitespace-nowrap active:scale-95 cursor-pointer"
                  >
                    {exact.toFixed(3)} kg
                  </button>
                ))}
              </>
            ) : (
              <>
                {[1, 5, 10, 12, 24].map(delta => (
                  <button
                    key={delta}
                    type="button"
                    disabled={!isUnlimited && currentNum >= maxStock}
                    onClick={() => handleAddPreset(delta)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-emerald-400 border border-slate-700/60 font-bold text-[11px] whitespace-nowrap active:scale-95 cursor-pointer"
                  >
                    +{delta}
                  </button>
                ))}
                {[6, 12, 24, 48].map(exact => (
                  <button
                    key={`exact-${exact}`}
                    type="button"
                    disabled={!isUnlimited && exact > maxStock}
                    onClick={() => handleSetExactPreset(exact)}
                    className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-35 text-blue-300 border border-blue-500/30 font-bold text-[11px] whitespace-nowrap active:scale-95 cursor-pointer"
                  >
                    {exact} {exact === 12 ? '(Doc)' : exact === 24 ? '(Caja)' : ''}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Teclado Numérico Táctil Ergonómico */}
          <div className="p-2.5 sm:p-3 grid grid-cols-3 gap-2 flex-1 select-none">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
              <button
                key={digit}
                type="button"
                onClick={() => handleDigit(digit)}
                className="h-12 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-bold text-xl border border-slate-700/50 shadow-sm flex items-center justify-center cursor-pointer active:scale-95 transition-colors"
              >
                {digit}
              </button>
            ))}

            <button
              type="button"
              onClick={() => handleDigit('.')}
              className="h-12 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-bold text-2xl border border-slate-700/50 shadow-sm flex items-center justify-center cursor-pointer active:scale-95 transition-colors"
            >
              .
            </button>

            <button
              type="button"
              onClick={() => handleDigit('0')}
              className="h-12 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-bold text-xl border border-slate-700/50 shadow-sm flex items-center justify-center cursor-pointer active:scale-95 transition-colors"
            >
              0
            </button>

            <button
              type="button"
              onClick={handleBackspace}
              className="h-12 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-amber-400 font-mono font-bold text-base border border-slate-700/50 shadow-sm flex items-center justify-center cursor-pointer active:scale-95 transition-colors"
              title="Borrar dígito"
            >
              ⌫
            </button>
          </div>

          {/* Botones de Acción de Pie */}
          <div className="p-3 pt-1 border-t border-slate-800/80 bg-slate-950/40 grid grid-cols-2 gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClear}
              className="h-10 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-colors"
            >
              Restablecer (1)
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              className="h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm cursor-pointer active:scale-95 transition-colors"
            >
              <Check size={16} /> Aplicar
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
