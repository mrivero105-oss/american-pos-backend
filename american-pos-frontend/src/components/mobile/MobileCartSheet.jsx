import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { ShoppingCart, Trash2, X, User, UserCheck, Percent, PauseCircle, Store, ArrowRight, Utensils } from 'lucide-react';
import { getRegionConfig } from '../../utils/regionConfig';

const cleanProdId = (rawId) => String(rawId || '').replace(/__bulk$|__mid$|__pres_.*$|__wpres_.*$|__srv_.*$/, '');
const getPackFactor = (prod) => {
  if (!prod) return 1;
  const f = Number(prod.factorConversion || prod.unitsMultiplier || 0);
  if (f > 1) return f;
  if (prod.isBulk) return Math.max(1, Number(prod.unitsPerBulk) || 1);
  if (prod.isMidBulk) return Math.max(1, Number(prod.unitsPerMidBulk) || 1);
  return 1;
};

export default function MobileCartSheet({
  productsMap = null,
  isOpen,
  onClose,
  T,
  triggerHaptic = () => {},
  totalItemsCount,
  cart,
  enrichedCart,
  products,
  isUnlimitedStockProduct,
  clearCart,
  customerName,
  customerDoc,
  onOpenCustomerSelect,
  onOpenManualItem,
  heldSales,
  onOpenHeldSales,
  updateQuantity,
  openQuantityModal,
  removeFromCart,
  cartDiscountPercent,
  handleApplyDiscount,
  cartDiscountAmountUSD,
  taxUSD,
  taxLabel = null,
  effectiveIvaRate = null,
  isIvaEnabled = true,
  isDollarCountry = false,
  totalUSD,
  totalBS,
  handleHoldSale,
  handleSendPreSaleToMainRegister,
  onProceedToCheckout,
  selectedTable = null,
  orderNotes = '',
  onOpenTableSelect
}) {
  const dragControls = useDragControls();
  const regionCfg = getRegionConfig();
  const resolvedTaxLabel = taxLabel || regionCfg.taxLabel || 'IVA';
  const resolvedTaxRate = effectiveIvaRate !== null && effectiveIvaRate !== undefined ? effectiveIvaRate : regionCfg.defaultTaxRate;
  return (
    <AnimatePresence>
      {isOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4">
            {/* Backdrop oscuro interactivo con Fade out y tap-to-dismiss */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => onClose()}
              className="fixed inset-0 bg-black/80" 
            />

            {/* Panel Bottom Sheet con Arrastre Físico (Drag-Down to Dismiss) */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              drag="y"
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.05, bottom: 0.7 }}
              onDragEnd={(e, { offset, velocity }) => {
                if (offset.y > 90 || velocity.y > 350) {
                  triggerHaptic(20);
                  onClose();
                }
              }}
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
              className={`w-full max-w-lg mx-auto ${T.modalCard} border-t sm:border sm:rounded-xl rounded-t-xl max-h-[90dvh] flex flex-col shadow-2xl relative z-10 overflow-hidden`}
            >
              {/* Barra de Arrastre Ergonómica (Pill Grabber Handle) */}
              <div onPointerDown={(e) => dragControls.start(e)} className="w-full flex flex-col items-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing select-none shrink-0 touch-none">
                <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 transition-colors" />
                <span className="text-[9px] font-bold text-slate-400/60 uppercase tracking-widest mt-0.5">
                  Desliza hacia abajo para cerrar
                </span>
              </div>
              
              {/* Cabecera del Carrito */}
              <div className={`px-3.5 py-2.5 border-b ${T.border} flex items-center justify-between shrink-0`}>
                <div className={`flex items-center gap-2 font-extrabold text-sm ${T.textPrimary}`}>
                  <ShoppingCart size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <span>Ticket de Venta ({totalItemsCount})</span>
                </div>
                <div className="flex items-center gap-2">
                  {heldSales && heldSales.length > 0 && (
                    <button 
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        onClose();
                        onOpenHeldSales();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-2xs"
                      title="Ver ventas en espera"
                    >
                      <PauseCircle size={14} className="text-amber-500 shrink-0" />
                      <span className="font-mono">{heldSales.length}</span>
                      <span className="hidden sm:inline text-[11px]">En espera</span>
                    </button>
                  )}
                  {cart.length > 0 && (
                    <button 
                      onClick={() => {
                        clearCart();
                      }}
                      className={`p-1.5 rounded-lg text-slate-400 hover:text-rose-500 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 active:scale-95`}
                      title="Vaciar carrito"
                    >
                      <Trash2 size={14} />
                      <span className="hidden sm:inline">Vaciar</span>
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      triggerHaptic(10);
                      onClose();
                    }}
                    className={`p-1.5 rounded-[6px] ${T.btnGhost} cursor-pointer active:scale-95`}
                    title="Cerrar carrito"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Selector de Cliente en Carrito */}
              <div className={`px-3.5 py-2 border-b ${T.border} ${T.modalSubCard} flex items-center justify-between gap-2 text-xs shrink-0`}>
                <div 
                  onClick={() => {
                    onOpenCustomerSelect()
                  }}
                  className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer active:opacity-75 transition-opacity"
                  title="Toca para seleccionar cliente"
                >
                  <div className="w-7 h-7 rounded-[6px] bg-slate-900 text-white dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <User size={13} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`${T.textSecondary} text-[10px]`}>Cliente:</span>
                      <span className={`font-bold ${T.textPrimary} text-xs truncate`}>{customerName}</span>
                    </div>
                    <span className={`text-[10px] ${T.textMuted} block truncate font-mono`}>{customerDoc || 'Sin documento'}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onOpenCustomerSelect()
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-[#0a0d12] hover:bg-[#161c26] dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-white font-bold text-[11px] border border-[#1e242e] shadow-2xs transition-all shrink-0 cursor-pointer"
                >
                  <UserCheck size={13} />
                  <span>Cambiar Cliente</span>
                </button>
              </div>

              {/* Selector Táctil de Mesa y Comandera */}
              <div className={`px-3.5 py-1.5 border-b ${T.border} bg-slate-500/5 flex items-center justify-between gap-2 text-xs shrink-0`}>
                <div 
                  onClick={() => {
                    triggerHaptic(10);
                    if (onOpenTableSelect) onOpenTableSelect();
                  }}
                  className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer active:opacity-75 transition-opacity"
                  title="Toca para asignar mesa o notas de comanda"
                >
                  <div className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 ${
                    selectedTable 
                      ? 'bg-amber-500 text-slate-950 font-bold' 
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  }`}>
                    <Utensils size={12} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-[11px] text-amber-500">
                        {selectedTable || 'Sin Mesa (Venta Libre)'}
                      </span>
                      {orderNotes && (
                        <span className="text-[10px] text-slate-400 truncate italic">
                          • &ldquo;{orderNotes}&rdquo;
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    if (onOpenTableSelect) onOpenTableSelect();
                  }}
                  className="px-2 py-1 rounded-[5px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 text-[10px] font-bold border border-amber-500/30 cursor-pointer active:scale-95 transition-all"
                >
                  {selectedTable ? 'Cambiar Mesa' : '+ Asignar Mesa'}
                </button>
              </div>

              {/* Lista de Productos en el Carrito con Gesto Swipe to Delete */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {cart.length === 0 ? (
                  <div className="py-8 flex flex-col items-center justify-center text-center text-slate-500 space-y-2">
                    <div className="w-12 h-12 rounded-full bg-slate-200/70 dark:bg-slate-800/40 flex items-center justify-center text-slate-400">
                      <ShoppingCart size={22} />
                    </div>
                    <p className={`font-extrabold text-xs ${T.textPrimary}`}>El ticket de venta está vacío</p>
                    <p className="text-[11px] text-slate-500 max-w-xs">Toca productos en el catálogo o agrega un ítem rápido manual.</p>
                    <div className="flex gap-2 pt-2">
                      <button 
                        onClick={() => { onClose(); onOpenManualItem(); }}
                        className="px-3 py-1.5 rounded-[6px] bg-[#0a0d12] text-white text-xs font-bold cursor-pointer active:scale-95"
                      >
                        + Ítem Rápido
                      </button>
                      {heldSales.length > 0 && (
                        <button 
                          onClick={() => { onClose(); onOpenHeldSales(); }}
                          className="px-3 py-1.5 rounded-[6px] bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-xs font-bold cursor-pointer active:scale-95"
                        >
                          ⏸️ {heldSales.length} En Espera
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  enrichedCart.map((item) => {
                    const prod = item?.product;
                    if (!prod || !prod.id) return null;
                    const unlimited = isUnlimitedStockProduct(prod);
                    const baseId = cleanProdId(prod.productId || prod.id);
                    const latestProd = (!unlimited)
                      ? (productsMap ? (productsMap.get(baseId) || prod) : (Array.isArray(products) ? (products.find(p => String(p.id) === baseId) || prod) : prod))
                      : prod;
                    const packFactor = getPackFactor(prod);
                    const rawBaseStock = Math.max(0, Number(latestProd.stockQuantity ?? latestProd.stock ?? 0));
                    const itemMaxStock = unlimited ? Infinity : (packFactor > 1 ? Math.floor(rawBaseStock / packFactor) : rawBaseStock);
                    const atMaxStock = !unlimited && item.quantity >= itemMaxStock;

                    return (
                    <div key={String(prod.id)} className="relative overflow-hidden rounded-[7px] group select-none">
                      {/* Fondo de Acción Roja que se revela al deslizar a la izquierda */}
                      <div 
                        className="absolute inset-y-0 right-0 w-24 bg-rose-600 flex items-center justify-center text-white cursor-pointer transition-colors active:bg-rose-700 select-none z-0"
                        onClick={() => {
                          triggerHaptic(20);
                          removeFromCart(item.product.id);
                        }}
                      >
                        <div className="flex flex-col items-center justify-center text-[10px] font-black leading-none">
                          <Trash2 size={15} className="mb-0.5" />
                          <span>Eliminar</span>
                        </div>
                      </div>

                      {/* Tarjeta del Producto con Soporte de Gesto Swipe-to-Delete */}
                      <motion.div
                        drag="x"
                        dragConstraints={{ left: -75, right: 0 }}
                        dragElastic={{ left: 0.25, right: 0.05 }}
                        onDragEnd={(e, { offset, velocity }) => {
                          if (offset.x < -60 || velocity.x < -300) {
                            triggerHaptic(25);
                            removeFromCart(item.product.id);
                          }
                        }}
                        className={`pos-ticket-item ${T.ticketItemBg} p-2.5 flex items-center justify-between gap-2 relative z-10 touch-pan-y`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className={`font-bold text-xs ${T.textPrimary} truncate`}>{item.product.name || item.product.nombre}</h4>
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
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold">Manual</span>
                            )}
                          </div>
                          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-extrabold mt-0.5 font-mono">
                            ${Number(item.finalSubtotal).toFixed(2)}
                            <span className={`${T.textMuted} text-[10px] ml-1 font-sans`}>
                              (${Number(item.product.price).toFixed(2)} c/u{!unlimited ? ` • Disp: ${itemMaxStock}` : ''})
                            </span>
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => updateQuantity(item.product.id, -1)} className={`w-6 h-6 ${T.btnGhost} rounded-[5px] flex items-center justify-center font-bold text-xs cursor-pointer active:scale-90`}>-</button>
                          <button
                            type="button"
                            onClick={() => openQuantityModal(item)}
                            className={`font-black text-xs px-2 py-0.5 rounded-[5px] border ${T.border} ${T.btnGhost} cursor-pointer hover:border-emerald-600 active:scale-95 transition-all text-center min-w-[34px] font-mono`}
                            title="Tocar para teclado numérico y pesaje a granel"
                          >
                            {item.quantity}
                          </button>
                          <button
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className={`w-6 h-6 ${T.btnGhost} rounded-[5px] flex items-center justify-center font-bold text-xs cursor-pointer active:scale-90 ${atMaxStock ? 'opacity-35' : ''}`}
                            title={atMaxStock ? `Stock máximo alcanzado (${itemMaxStock})` : 'Aumentar cantidad'}
                          >+</button>
                          <button onClick={() => removeFromCart(item.product.id)} className={`p-1 ${T.textMuted} hover:text-rose-500 cursor-pointer active:scale-90`}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  );
                  })
                )}
              </div>

              {/* Barra de Descuento Rápido en Carrito */}
              {cart.length > 0 && (
                <div className={`flex items-center justify-between px-3.5 py-1.5 border-t ${T.border} ${T.modalSubCard} shrink-0`}>
                  <span className={`text-[10px] font-bold ${T.textMuted} flex items-center gap-1`}>
                    <Percent size={11} /> Descuento:
                  </span>
                  <div className="flex items-center gap-1">
                    {[0, 5, 10, 15, 20].map(pct => (
                      <button
                        key={pct}
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

              {/* Resumen Financiero y Acciones (Módulo Totalizador en Carbón Anodizado idéntico a Escritorio) */}
              <div className={`p-3 ${T.subPanelBg} border-t ${T.border} space-y-2 shrink-0`}>
                <div className="cart-summary-card bg-[#0a0d12] border border-[#1e242e] rounded-[8px] p-3 text-[#f8fafc] space-y-1 shadow-sm">
                  {cartDiscountPercent > 0 && (
                    <div className="flex justify-between text-xs text-emerald-400 font-bold">
                      <span>Descuento aplicado ({cartDiscountPercent}%):</span>
                      <span className="font-mono">-${cartDiscountAmountUSD.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[11px] text-[#94a3b8]">
                    <span>{isIvaEnabled && resolvedTaxRate > 0 ? `${resolvedTaxLabel} (${resolvedTaxRate}% Incluido):` : `${resolvedTaxLabel} (Exento):`}</span>
                    <span className="font-bold text-white font-mono">${taxUSD.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-baseline pt-0.5">
                    <span className="font-extrabold text-xs text-[#cbd5e1] tracking-wide">TOTAL USD:</span>
                    <span className="font-black text-lg text-[#34d399] font-mono tabular-nums">${totalUSD.toFixed(2)}</span>
                  </div>
                  {!isDollarCountry && (
                    <div className="flex justify-between items-baseline text-xs text-[#fbbf24] font-bold">
                      <span>TOTAL BS:</span>
                      <span className="font-mono tabular-nums">Bs. {totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>

                {cart.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleHoldSale}
                        className={`flex-1 py-2.5 px-3 rounded-[7px] border ${T.btnGhost} font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95`}
                        title="Pausar venta localmente para atender a otro cliente"
                      >
                        <PauseCircle size={15} className="text-amber-500" />
                        <span>Pausar</span>
                      </button>
                      <button
                        onClick={handleSendPreSaleToMainRegister}
                        className="flex-1 py-2.5 px-3 rounded-[7px] bg-[#0a0d12] hover:bg-[#161c26] text-white border border-[#1e242e] font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-xs transition-all"
                        title="Enviar preventa a la PC de Caja Principal para que el cliente pague allí"
                      >
                        <Store size={15} />
                        <span>Enviar a Caja</span>
                      </button>
                    </div>
                    <button 
                      onClick={() => {
                        onProceedToCheckout()
                      }}
                      className="pos-checkout-btn w-full min-h-[46px] bg-[#059669] hover:bg-[#047857] active:scale-[0.99] text-white font-black py-2.5 rounded-[8px] text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
                    >
                      <span>Cobrar en Terminal Móvil</span>
                      <ArrowRight size={15} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      triggerHaptic(10);
                      onClose();
                    }}
                    className={`w-full py-2.5 rounded-[7px] border ${T.btnGhost} text-xs font-bold cursor-pointer active:scale-95`}
                  >
                    Cerrar y volver al catálogo
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
    </AnimatePresence>
  );
}
