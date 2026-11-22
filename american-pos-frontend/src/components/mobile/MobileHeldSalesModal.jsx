import { useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { PauseCircle, X, Clock, Trash2, PlayCircle, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';

export default function MobileHeldSalesModal({
  isOpen,
  onClose,
  T,
  heldSales = [],
  currentCartCount = 0,
  handleDeleteHeldSale,
  handleRestoreHeldSale,
  triggerHaptic = () => {}
}) {
  const dragControls = useDragControls();
  const [confirmingSaleId, setConfirmingSaleId] = useState(null); // id de la venta para la que se pide confirmación de swap
  const [deletingSaleId, setDeletingSaleId] = useState(null); // id de la venta en confirmación de borrado

  if (!isOpen) return null;

  const handleStartRestore = (saleId) => {
    triggerHaptic(15);
    if (currentCartCount > 0) {
      setConfirmingSaleId(saleId);
    } else {
      handleRestoreHeldSale(saleId);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4">
        {/* Backdrop con tap-to-dismiss */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => {
            triggerHaptic(10);
            onClose();
          }}
          className="fixed inset-0 bg-black/80 backdrop-blur-xs"
        />

        {/* Panel Bottom Sheet con gesto de arrastre */}
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
          {/* Pill Grabber Handle */}
          <div
            onPointerDown={(e) => dragControls.start(e)}
            className="w-full flex flex-col items-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing select-none shrink-0 touch-none"
          >
            <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 transition-colors" />
            <span className="text-[9px] font-bold text-slate-400/60 uppercase tracking-widest mt-0.5">
              Desliza hacia abajo para cerrar
            </span>
          </div>

          {/* Header */}
          <div className={`px-4 py-2.5 border-b ${T.border} flex items-center justify-between shrink-0`}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center">
                <PauseCircle size={16} />
              </div>
              <div>
                <h3 className={`font-black text-sm ${T.textPrimary}`}>
                  Ventas en Espera ({heldSales.length})
                </h3>
                <p className="text-[10px] text-slate-400">
                  Tickets pausados temporalmente para atender otros clientes
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                onClose();
              }}
              className={`p-1.5 rounded-[6px] ${T.btnGhost} cursor-pointer active:scale-95`}
              title="Cerrar modal"
            >
              <X size={16} />
            </button>
          </div>

          {/* Contenido / Lista de Ventas */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar min-h-0">
            {heldSales.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
                  <PauseCircle size={28} />
                </div>
                <div className="space-y-1">
                  <p className={`font-extrabold text-sm ${T.textPrimary}`}>No hay ventas en espera</p>
                  <p className="text-xs text-slate-400 max-w-xs">
                    Cuando tengas un cliente indeciso o necesite buscar más artículos, toca el botón <b>Pausar</b> en el carrito.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white dark:bg-slate-800 text-xs font-bold cursor-pointer active:scale-95 transition-all shadow-xs"
                >
                  Volver al Catálogo
                </button>
              </div>
            ) : (
              heldSales.map((sale) => {
                const isSelectedForConfirm = confirmingSaleId === sale.id;
                const isSelectedForDelete = deletingSaleId === sale.id;
                const totalUsdVal = Number(sale.totalUSD || 0);
                const totalBsVal = Number(sale.totalBS || 0);
                const itemsList = Array.isArray(sale.items) ? sale.items : [];
                const itemsCount = itemsList.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0) || sale.itemCount || 1;

                return (
                  <div
                    key={sale.id}
                    className={`rounded-xl border ${T.border} ${T.modalSubCard} p-3 space-y-2.5 transition-all shadow-2xs`}
                  >
                    {/* Fila superior: Hora y Totales */}
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-[11px] font-bold font-mono">
                        <Clock size={12} />
                        {sale.date || 'Reciente'}
                      </span>
                      <div className="text-right">
                        <div className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                          ${totalUsdVal.toFixed(2)}
                        </div>
                        {totalBsVal > 0 && (
                          <div className="font-mono text-[10px] text-slate-400">
                            Bs. {totalBsVal.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Cliente y Cantidad de Productos */}
                    <div className="space-y-1">
                      <div className="text-xs">
                        <span className="text-slate-400 text-[11px]">Cliente: </span>
                        <span className={`font-bold ${T.textPrimary}`}>
                          {sale.customerName || 'Consumidor Final'}
                        </span>
                        {sale.customerDoc && sale.customerDoc !== 'V-00000000' && (
                          <span className="text-[10px] font-mono text-slate-400 ml-1">
                            ({sale.customerDoc})
                          </span>
                        )}
                      </div>

                      {/* Resumen de ítems contenidos */}
                      <div className="text-[11px] text-slate-400 bg-slate-100/60 dark:bg-slate-800/60 rounded-md p-1.5 border border-slate-200/50 dark:border-slate-700/50">
                        <span className="font-semibold text-slate-300">
                          📦 {itemsCount} ítem(s):{' '}
                        </span>
                        <span className="italic">
                          {itemsList.slice(0, 3).map((it) => `${it.product?.name || 'Ítem'} (x${it.quantity})`).join(', ')}
                          {itemsList.length > 3 ? ` + ${itemsList.length - 3} más` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Panel de Confirmación de Conflicto de Carrito (Si el carrito actual tiene productos) */}
                    {isSelectedForConfirm && (
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2 animate-fadeIn">
                        <div className="flex items-start gap-2 text-amber-500">
                          <AlertCircle size={15} className="shrink-0 mt-0.5" />
                          <div className="text-xs">
                            <span className="font-bold block">Hay {currentCartCount} ítem(s) en tu carrito activo.</span>
                            <span className="text-[11px] text-slate-300">¿Cómo deseas proceder?</span>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic(20);
                              setConfirmingSaleId(null);
                              handleRestoreHeldSale(sale.id, { swapCurrent: true });
                            }}
                            className="flex-1 py-1.5 px-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer active:scale-95 flex items-center justify-center gap-1 shadow-xs"
                          >
                            <RefreshCw size={13} />
                            <span>Pausar actual y reanudar esta</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic(20);
                              setConfirmingSaleId(null);
                              handleRestoreHeldSale(sale.id, { swapCurrent: false });
                            }}
                            className="py-1.5 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs cursor-pointer active:scale-95"
                          >
                            Reemplazar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic(10);
                              setConfirmingSaleId(null);
                            }}
                            className="py-1.5 px-2 rounded-lg border border-slate-700 text-slate-300 font-bold text-xs cursor-pointer active:scale-95"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Panel de Confirmación de Borrado */}
                    {isSelectedForDelete && (
                      <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2 animate-fadeIn">
                        <span className="text-xs font-bold text-rose-400">
                          ¿Eliminar permanentemente este ticket?
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic(20);
                              setDeletingSaleId(null);
                              handleDeleteHeldSale(sale.id);
                            }}
                            className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-black cursor-pointer active:scale-95"
                          >
                            Sí, eliminar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic(10);
                              setDeletingSaleId(null);
                            }}
                            className="px-2 py-1 rounded-md text-slate-300 hover:text-white text-xs cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Barra de Acciones */}
                    {!isSelectedForConfirm && !isSelectedForDelete && (
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/50 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            setDeletingSaleId(sale.id);
                          }}
                          className="px-2 py-1 rounded-lg text-slate-400 hover:text-rose-500 text-xs font-semibold cursor-pointer active:scale-95 flex items-center gap-1 transition-colors"
                          title="Eliminar ticket en espera"
                        >
                          <Trash2 size={13} />
                          <span>Descartar</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartRestore(sale.id)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                        >
                          <PlayCircle size={14} />
                          <span>Reanudar Venta</span>
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
