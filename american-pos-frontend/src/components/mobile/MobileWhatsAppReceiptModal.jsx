import { motion, AnimatePresence } from 'framer-motion';
import { Share2, X, Phone, Copy, Smartphone } from 'lucide-react';

export default function MobileWhatsAppReceiptModal({
  whatsAppModalData,
  onClose,
  T,
  whatsAppPhoneInput,
  setWhatsAppPhoneInput,
  generateEcoReceiptText = () => '',
  cleanWhatsAppPhone = (p) => String(p || '').replace(/\D/g, ''),
  showToast = () => {},
  triggerHaptic = () => {}
}) {
  return (
    <AnimatePresence>
        {whatsAppModalData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 animate-fadeIn">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={`w-full max-w-sm ${T.modalCard} rounded-xl p-5 shadow-2xl border border-emerald-500/40 space-y-3.5 max-h-[92dvh] overflow-y-auto`}
            >
              <div className="flex items-center justify-between border-b pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <Share2 size={16} />
                  </div>
                  <div>
                    <h3 className={`text-xs font-black uppercase tracking-wider ${T.textPrimary}`}>
                      Recibo Digital WhatsApp
                    </h3>
                    <p className="text-[10px] text-emerald-400 font-bold">100% Ecológico • Sin papel térmico</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onClose()}
                  className="p-1 rounded-full text-slate-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Teléfono del Cliente */}
              <div className="space-y-1">
                <label className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                  Número de WhatsApp del Cliente:
                </label>
                <div className="relative">
                  <Phone size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted}`} />
                  <input
                    type="tel"
                    placeholder="Ej: 0414 1234567 o +58..."
                    value={whatsAppPhoneInput}
                    onChange={(e) => setWhatsAppPhoneInput(e.target.value)}
                    className={`w-full ${T.inputBg} border rounded-xl pl-9 pr-3 py-2.5 text-xs font-mono font-bold outline-none focus:border-emerald-500`}
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  Si no indicas número, WhatsApp te permitirá seleccionar cualquier contacto.
                </p>
              </div>

              {/* Vista Previa del Recibo */}
              <div className="space-y-1">
                <span className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                  Vista Previa del Comprobante:
                </span>
                <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 text-[10px] font-mono text-slate-300 max-h-36 overflow-y-auto custom-scrollbar whitespace-pre-wrap leading-relaxed select-all">
                  {generateEcoReceiptText(whatsAppModalData)}
                </div>
              </div>

              {/* Botones de Acción */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(20);
                    const fullText = generateEcoReceiptText(whatsAppModalData);
                    const cleanPhone = cleanWhatsAppPhone(whatsAppPhoneInput);
                    const encoded = encodeURIComponent(fullText);
                    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
                    window.open(url, '_blank');
                    showToast('📲 Abriendo WhatsApp...');
                    onClose();
                  }}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
                >
                  <Share2 size={15} />
                  <span>Enviar Recibo a WhatsApp</span>
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      const fullText = generateEcoReceiptText(whatsAppModalData);
                      try {
                        navigator.clipboard.writeText(fullText);
                        showToast('📋 Recibo copiado al portapapeles');
                      } catch (_) {
                        showToast('No se pudo copiar');
                      }
                    }}
                    className={`flex-1 py-2.5 rounded-xl border ${T.btnGhost} text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95`}
                  >
                    <Copy size={13} />
                    <span>Copiar Texto</span>
                  </button>

                  {typeof navigator !== 'undefined' && navigator.share && (
                    <button
                      type="button"
                      onClick={async () => {
                        triggerHaptic(15);
                        const fullText = generateEcoReceiptText(whatsAppModalData);
                        try {
                          await navigator.share({
                            title: `Comprobante ${whatsAppModalData.invoiceNumber || 'Venta'}`,
                            text: fullText
                          });
                          onClose();
                        } catch (caughtErr) { if (caughtErr?.name !== 'AbortError') console.warn('[MobileWhatsAppReceiptModal] Error al compartir comprobante:', caughtErr?.message || caughtErr); }
                      }}
                      className={`flex-1 py-2.5 rounded-xl border ${T.btnGhost} text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 text-blue-400 border-blue-500/30`}
                    >
                      <Smartphone size={13} />
                      <span>Compartir App</span>
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
    </AnimatePresence>
  );
}