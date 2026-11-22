import { ShoppingCart, Trash2, User, UserCheck, Percent, PauseCircle, ArrowRight } from 'lucide-react';

export default function MobileTabletCartPanel({
  T,
  totalItemsCount,
  cart,
  enrichedCart,
  products,
  isUnlimitedStockProduct,
  clearCart,
  customerName,
  customerDoc,
  onOpenCustomerSelect,
  updateQuantity,
  openQuantityModal,
  removeFromCart,
  cartDiscountPercent,
  handleApplyDiscount,
  cartDiscountAmountUSD,
  taxUSD,
  totalUSD,
  totalBS,
  handleHoldSale,
  onProceedToCheckout
}) {
  return (
          <aside className={`pos-ticket-panel hidden lg:flex lg:w-[340px] xl:w-[380px] shrink-0 flex-col h-full overflow-hidden ${T.ticketSidebar}`}>
            {/* Cabecera del Ticket en Tablet */}
            <div className={`px-3.5 py-2.5 border-b ${T.border} flex items-center justify-between shrink-0`}>
              <div className={`flex items-center gap-2 font-extrabold text-xs xl:text-sm ${T.textPrimary}`}>
                <ShoppingCart size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Ticket de Venta ({totalItemsCount})</span>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    clearCart();
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 active:scale-95"
                  title="Vaciar carrito"
                >
                  <Trash2 size={14} />
                  <span>Vaciar</span>
                </button>
              )}
            </div>

            {/* Selector de Cliente en Panel Lateral de Tablet */}
            <div className={`px-3.5 py-2 border-b ${T.border} ${T.modalSubCard} flex items-center justify-between gap-2 text-xs shrink-0`}>
              <div 
                onClick={() => {
                  onOpenCustomerSelect()
                }}
                className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer hover:opacity-80 transition-opacity"
                title="Toca para seleccionar cliente"
              >
                <User size={13} className={`${T.textSecondary} shrink-0`} />
                <span className={`font-bold ${T.textPrimary} truncate text-[11px]`}>{customerName}</span>
                <span className={`text-[10px] ${T.textMuted} shrink-0 font-mono`}>({customerDoc})</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenCustomerSelect()
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#0a0d12] hover:bg-[#161c26] active:scale-95 text-white font-bold text-[10px] border border-[#1e242e] shrink-0 cursor-pointer shadow-2xs transition-all"
              >
                <UserCheck size={12} />
                <span>Cambiar</span>
              </button>
            </div>

            {/* Lista de Productos en el Ticket de Tablet */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 space-y-2 p-4">
                  <div className="w-12 h-12 rounded-full bg-slate-200/70 dark:bg-slate-800/30 flex items-center justify-center text-slate-400">
                    <ShoppingCart size={22} />
                  </div>
                  <p className={`font-bold text-xs ${T.textSecondary}`}>Sin productos en el ticket</p>
                  <p className={`text-[11px] ${T.textMuted}`}>
                    Selecciona artículos del catálogo o escanea un código de barras para comenzar.
                  </p>
                </div>
              ) : (
                enrichedCart.map(item => {
                  const unlimited = isUnlimitedStockProduct(item.product);
                  const latestProd = (!unlimited && Array.isArray(products))
                    ? (products.find(p => String(p.id) === String(item.product.id)) || item.product)
                    : item.product;
                  const itemMaxStock = unlimited ? Infinity : Math.max(0, Number(latestProd.stockQuantity ?? latestProd.stock ?? 0));
                  const atMaxStock = !unlimited && item.quantity >= itemMaxStock;

                  return (
                    <div
                      key={item.product.id}
                      className={`pos-ticket-item ${T.ticketItemBg} rounded-[6px] p-2.5 flex items-center justify-between gap-2 select-none`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className={`font-bold text-xs ${T.textPrimary} truncate`}>
                            {item.product.name || item.product.nombre}
                          </h4>
                          {item.product.isBulk && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black">
                              📦 {item.product.bulkUnitName || 'Caja'} x{item.product.unitsPerBulk}
                            </span>
                          )}
                          {item.product.isMidBulk && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black">
                              📦 {item.product.midBulkUnitName || 'Media'} x{item.product.unitsPerMidBulk}
                            </span>
                          )}
                          {item.product.isCustom && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold">
                              Manual
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-extrabold mt-0.5 font-mono">
                          ${Number(item.finalSubtotal).toFixed(2)}
                          <span className={`${T.textMuted} text-[10px] ml-1 font-sans`}>
                            (${Number(item.product.price).toFixed(2)} c/u{!unlimited ? ` • Disp: ${itemMaxStock}` : ''})
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product.id, -1)}
                          className={`w-6 h-6 ${T.btnGhost} rounded-[5px] flex items-center justify-center font-bold text-xs cursor-pointer active:scale-90`}
                        >
                          -
                        </button>
                        <button
                          type="button"
                          onClick={() => openQuantityModal(item)}
                          className={`font-black text-xs px-2 py-0.5 rounded-[5px] border ${T.border} ${T.btnGhost} cursor-pointer hover:border-emerald-600 active:scale-95 transition-all text-center min-w-[34px] font-mono`}
                          title="Tocar para teclado numérico"
                        >
                          {item.quantity}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product.id, 1)}
                          className={`w-6 h-6 ${T.btnGhost} rounded-[5px] flex items-center justify-center font-bold text-xs cursor-pointer active:scale-90 ${atMaxStock ? 'opacity-35' : ''}`}
                          title={atMaxStock ? `Stock máximo alcanzado (${itemMaxStock})` : 'Aumentar cantidad'}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id)}
                          className={`p-1 ${T.textMuted} hover:text-rose-500 cursor-pointer active:scale-90`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Descuento Rápido en Panel de Tablet */}
            {cart.length > 0 && (
              <div className={`flex items-center justify-between px-3.5 py-1.5 border-t ${T.border} shrink-0`}>
                <span className={`text-[10px] font-bold ${T.textMuted} flex items-center gap-1`}>
                  <Percent size={11} /> Descuento:
                </span>
                <div className="flex items-center gap-1">
                  {[0, 5, 10, 15, 20].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleApplyDiscount(pct)}
                      className={`px-2 py-0.5 rounded-[5px] text-[10px] font-black transition-all cursor-pointer ${
                        cartDiscountPercent === pct
                          ? 'bg-[#0a0d12] text-white'
                          : `${T.btnGhost} text-slate-500`
                      }`}
                    >
                      {pct === 0 ? '0%' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Resumen Financiero y Acciones de Cobro en Tablet (Idéntico a Escritorio) */}
            <div
              className={`p-3 ${T.subPanelBg} border-t ${T.border} space-y-2 shrink-0`}
              style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom, 0px))' }}
            >
              <div className="cart-summary-card bg-[#0a0d12] border border-[#1e242e] rounded-[8px] p-3 text-[#f8fafc] space-y-1 shadow-sm">
                {cartDiscountPercent > 0 && (
                  <div className="flex justify-between text-xs text-emerald-400 font-bold">
                    <span>Descuento ({cartDiscountPercent}%):</span>
                    <span className="font-mono">-${cartDiscountAmountUSD.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[11px] text-[#94a3b8]">
                  <span>IVA (16% Incluido):</span>
                  <span className="font-bold text-white font-mono">${taxUSD.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-baseline pt-0.5">
                  <span className="font-extrabold text-xs text-[#cbd5e1] tracking-wide">TOTAL USD:</span>
                  <span className="font-black text-lg text-[#34d399] font-mono tabular-nums">${totalUSD.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-baseline text-xs text-[#fbbf24] font-bold">
                  <span>TOTAL BS:</span>
                  <span className="font-mono tabular-nums">Bs. {totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={handleHoldSale}
                  className={`py-2.5 px-3 rounded-[7px] border ${T.btnGhost} disabled:opacity-40 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95`}
                  title="Pausar venta"
                >
                  <PauseCircle size={15} className="text-amber-500" />
                  <span>Pausar</span>
                </button>
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={() => {
                    onProceedToCheckout()
                  }}
                  className="pos-checkout-btn flex-1 min-h-[44px] bg-[#059669] hover:bg-[#047857] disabled:opacity-40 active:scale-[0.99] text-white font-black py-2.5 rounded-[8px] text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>Cobrar</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </aside>
  );
}