import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Share2, Copy, Check, Utensils, QrCode } from 'lucide-react';
import JsBarcode from 'jsbarcode';

export default function MobilePreSaleSentModal({
  preSaleSentModal,
  onClose,
  T,
  businessInfo = {},
  printPreSaleBluetoothReceipt,
  showToast,
  onOpenThermalPrinterSettings,
  sharePreSaleWhatsApp,
  triggerHaptic = () => {}
}) {
  const barcodeRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (preSaleSentModal && preSaleSentModal.code && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, String(preSaleSentModal.code), {
          format: "CODE128",
          width: 2,
          height: 48,
          displayValue: false,
          margin: 0,
          background: "#ffffff",
          lineColor: "#0f172a"
        });
      } catch (err) {
        console.warn('Fallo renderizando código de barras de preventa:', err);
      }
    }
  }, [preSaleSentModal]);

  const handleCopyCode = async () => {
    if (!preSaleSentModal?.code) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(preSaleSentModal.code);
      }
      setCopied(true);
      triggerHaptic(20);
      if (showToast) showToast(`📋 Código ${preSaleSentModal.code} copiado`);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AnimatePresence>
      {preSaleSentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 animate-fadeIn">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className={`w-full max-w-sm ${T.modalCard} rounded-2xl p-5 shadow-2xl border border-indigo-500/40 space-y-3.5 text-center max-h-[92dvh] overflow-y-auto custom-scrollbar`}
          >
            {/* Header Icon */}
            <div className="w-13 h-13 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 mx-auto flex items-center justify-center shadow-lg shadow-indigo-500/10">
              <Store size={30} />
            </div>

            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 block mb-0.5">
                {preSaleSentModal.table ? 'COMANDA DESPACHADA A CAJA' : 'PREVENTA DESPACHADA'}
              </span>
              <h3 className={`text-base font-black ${T.textPrimary}`}>
                Enviada a Caja Principal
              </h3>
              <p className={`text-xs ${T.textSecondary} mt-0.5`}>
                Disponible al instante en la PC de caja para cobro rápido.
              </p>
            </div>

            {/* Si viene con Mesa / Comandera */}
            {preSaleSentModal.table && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 font-black text-xs">
                <Utensils size={13} className="shrink-0" />
                <span>{preSaleSentModal.table}</span>
              </div>
            )}

            {/* Código de barras visual para pistola óptica de caja */}
            <div className="bg-white rounded-xl p-3 shadow-inner border border-slate-200 flex flex-col items-center justify-center">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1">
                <QrCode size={11} /> Escanear con pistola láser en PC
              </span>
              <div className="w-full flex items-center justify-center overflow-hidden py-1">
                <svg ref={barcodeRef} className="max-w-full h-auto" />
              </div>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className="font-mono text-base font-black text-slate-900 tracking-wider">
                  {preSaleSentModal.code}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-90 transition-all cursor-pointer"
                  title="Copiar código"
                >
                  {copied ? <Check size={13} className="text-emerald-600 font-bold" /> : <Copy size={13} />}
                </button>
              </div>
            </div>

            {/* Resumen Financiero */}
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-1">
              <div className="text-xs font-bold text-slate-300">
                {preSaleSentModal.items?.length || 0} productos • ${Number(preSaleSentModal.totalUSD || 0).toFixed(2)} USD
              </div>
              <div className="text-xs font-semibold text-amber-400 font-mono">
                Bs. {Number(preSaleSentModal.totalBS || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* Info de Cliente y Vendedor */}
            <div className={`p-2.5 rounded-xl ${T.subPanelBg} text-left text-xs space-y-1 border ${T.border}`}>
              <div className="flex justify-between text-[11px]">
                <span className={T.textMuted}>Cliente:</span>
                <span className={`font-bold ${T.textPrimary} truncate max-w-[170px]`}>{preSaleSentModal.customerName}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className={T.textMuted}>Vendedor:</span>
                <span className={`font-bold ${T.textPrimary}`}>{preSaleSentModal.sellerName}</span>
              </div>
              {preSaleSentModal.orderNotes && (
                <div className="flex justify-between text-[11px] pt-0.5 border-t border-slate-500/20">
                  <span className={T.textMuted}>Nota cocina:</span>
                  <span className="font-bold text-amber-400 truncate max-w-[170px] italic">"{preSaleSentModal.orderNotes}"</span>
                </div>
              )}
            </div>

            {/* Acciones */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(15);
                  const mesaInfo = preSaleSentModal.table ? `🍽️ *Ubicación:* ${preSaleSentModal.table}\n` : '';
                  const notasInfo = preSaleSentModal.orderNotes ? `📝 *Nota:* ${preSaleSentModal.orderNotes}\n` : '';
                  const text = `🛒 *TICKET DE PREVENTA - ${businessInfo.name || 'Isaac POS'}*\n` +
                    `🔖 Ticket: *${preSaleSentModal.code}*\n` +
                    mesaInfo +
                    `👤 Cliente: *${preSaleSentModal.customerName}*\n` +
                    notasInfo +
                    `📦 Total: *${preSaleSentModal.items?.length || 0} productos ($${Number(preSaleSentModal.totalUSD || 0).toFixed(2)} / Bs. ${Number(preSaleSentModal.totalBS || 0).toFixed(2)})*\n` +
                    `ℹ️ Presenta este código en Caja Principal para pagar tu compra.`;
                  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
                  window.open(url, '_blank');
                }}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-600/30 active:scale-95 transition-all"
              >
                <Share2 size={15} />
                <span>Compartir Código por WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  onClose();
                }}
                className={`w-full py-2.5 rounded-xl border ${T.btnGhost} font-bold text-xs cursor-pointer active:scale-95`}
              >
                Continuar / Nueva Venta
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
