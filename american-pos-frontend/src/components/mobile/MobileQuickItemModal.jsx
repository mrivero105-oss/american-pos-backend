import React from 'react';
import { Plus, X } from 'lucide-react';

export default function MobileQuickItemModal({
  isOpen,
  onClose,
  T,
  manualItemName,
  setManualItemName,
  manualItemPrice,
  setManualItemPrice,
  manualItemPriceBS,
  setManualItemPriceBS,
  manualItemQty,
  setManualItemQty,
  exchangeRate,
  handleAddManualItem
}) {
  if (!isOpen) return null;
  return (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3 animate-fadeIn">
          <div className={`w-full max-w-sm sm:max-w-md ${T.modalCard} rounded-xl p-4 sm:p-5 shadow-2xl space-y-3.5 max-h-[92dvh] overflow-y-auto`}>
            <div className={`flex items-center justify-between border-b ${T.border} pb-2.5`}>
              <div className="flex items-center gap-2">
                <Plus size={18} className="text-emerald-500" />
                <h3 className={`font-black text-sm ${T.textPrimary}`}>Agregar Ítem Rápido</h3>
              </div>
              <button 
                onClick={() => onClose()}
                className={`${T.textMuted} hover:${T.textPrimary} p-1 rounded-lg cursor-pointer`}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddManualItem} className="space-y-3">
              <div>
                <label className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>Descripción o Concepto</label>
                <input 
                  type="text" 
                  value={manualItemName}
                  onChange={(e) => setManualItemName(e.target.value)}
                  placeholder="Ej: Bolsa plástica, Recarga, Varios..."
                  className={`w-full ${T.inputBg} border rounded-xl px-3 py-2 text-xs font-bold outline-none`}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 block mb-1">
                    Precio USD ($) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-500">$</span>
                    <input 
                      type="number" 
                      step="0.01" 
                      value={manualItemPrice}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseFloat(val);
                        setManualItemPrice(val);
                        setManualItemPriceBS(!isNaN(num) && num > 0 ? (num * exchangeRate).toFixed(2) : '');
                      }}
                      placeholder="0.00"
                      className={`w-full ${T.inputBg} border rounded-xl pl-6 pr-3 py-2 text-xs font-black outline-none focus:border-emerald-500`}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-black text-amber-600 dark:text-amber-400 block mb-1">
                    Precio en Bs (Bs) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-amber-500">Bs</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={manualItemPriceBS}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseFloat(val);
                        setManualItemPriceBS(val);
                        setManualItemPrice(!isNaN(num) && num > 0 && exchangeRate > 0 ? (num / exchangeRate).toFixed(2) : '');
                      }}
                      placeholder="0.00"
                      className={`w-full ${T.inputBg} border rounded-xl pl-7 pr-3 py-2 text-xs font-black outline-none focus:border-amber-500`}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>Cantidad</label>
                <div className="flex items-center gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      const cur = parseFloat(manualItemQty) || 1;
                      setManualItemQty(String(Math.max(1, cur - 1)));
                    }}
                    className={`w-10 h-10 rounded-xl border ${T.btnGhost} font-black text-sm flex items-center justify-center shrink-0 cursor-pointer active:scale-95`}
                  >
                    -
                  </button>
                  <input 
                    type="number" 
                    step="1" 
                    min="1"
                    value={manualItemQty}
                    onChange={(e) => setManualItemQty(e.target.value)}
                    placeholder="1"
                    className={`flex-1 min-w-0 w-full h-10 ${T.inputBg} border rounded-xl px-2 text-xs font-black text-center outline-none`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cur = parseFloat(manualItemQty) || 1;
                      setManualItemQty(String(cur + 1));
                    }}
                    className={`w-10 h-10 rounded-xl border ${T.btnGhost} font-black text-sm flex items-center justify-center shrink-0 cursor-pointer active:scale-95`}
                  >
                    +
                  </button>
                </div>
              </div>

              {((parseFloat(manualItemPrice) > 0) || (parseFloat(manualItemPriceBS) > 0)) && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-bold">
                  <span className={T.textSecondary}>Total a agregar:</span>
                  <div className="text-right">
                    <span className="font-black text-emerald-600 dark:text-emerald-400">
                      ${(((parseFloat(manualItemPrice) || ((parseFloat(manualItemPriceBS) || 0) / exchangeRate)) * (parseFloat(manualItemQty) || 1))).toFixed(2)}
                    </span>
                    <span className="mx-1.5 text-slate-400">•</span>
                    <span className="font-black text-amber-600 dark:text-amber-400">
                      Bs. {(((parseFloat(manualItemPriceBS) || ((parseFloat(manualItemPrice) || 0) * exchangeRate)) * (parseFloat(manualItemQty) || 1))).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}

              <button 
                type="submit"
                className="w-full min-h-[44px] bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg cursor-pointer flex items-center justify-center gap-1.5 mt-2"
              >
                <Plus size={15} />
                <span>AGREGAR AL CARRITO</span>
              </button>
            </form>
          </div>
        </div>
  );
}