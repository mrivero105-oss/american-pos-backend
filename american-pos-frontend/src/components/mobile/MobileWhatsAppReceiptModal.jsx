import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, X, Phone, Copy, Smartphone, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { useMobileKeyboardViewport } from '../../hooks/useMobileKeyboardViewport';

/**
 * Renderiza un ticket térmico nítido en alta resolución (PNG base64) usando Canvas 2D nativo,
 * sin depender de DOM oculto ni html2canvas (ejecuta en <50ms en Android).
 */
function renderThermalReceiptToPngDataUrl(sale, businessInfo = {}, exchangeRate = 1) {
  if (typeof document === 'undefined') return null;

  const width = 640;
  const padX = 36;
  const lineH = 28;

  const companyName = String(businessInfo?.name || localStorage.getItem('company_name') || 'ISAAC POS').toUpperCase();
  const companyRif = String(businessInfo?.rif || localStorage.getItem('company_rif') || '');
  const companyPhone = String(businessInfo?.phone || '');
  const docLabel = sale?.documentType === 'nota_entrega'
    ? 'NOTA DE ENTREGA COMERCIAL'
    : sale?.documentType === 'cotizacion'
      ? 'PRESUPUESTO / COTIZACIÓN'
      : 'COMPROBANTE DE VENTA';
  const docNum = String(sale?.invoiceNumber || sale?.code || 'TICKET');
  const dateStr = sale?.date
    ? new Date(sale.date).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })
    : new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
  const customerName = String(sale?.customerName || 'Consumidor Final');
  const customerDoc = String(sale?.customerDoc || '');
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const totalUSD = Number(sale?.totalUSD ?? sale?.total ?? 0);
  const rate = Number(sale?.exchangeRate || exchangeRate || 1);
  const totalBS = Number(sale?.totalBS ?? (totalUSD * rate));
  const taxUSD = Number(sale?.tax ?? sale?.taxUSD ?? 0);
  const subtotalUSD = Number(sale?.subtotal ?? Math.max(0, totalUSD - taxUSD));
  const method = String(sale?.method || sale?.paymentMethod || 'Efectivo');
  const refCode = sale?.paymentReference || sale?.reference || '';

  // Calcular alto dinámico según ítems
  const baseRows = 16 + (companyRif ? 1 : 0) + (companyPhone ? 1 : 0) + (customerDoc ? 1 : 0) + (refCode ? 1 : 0);
  const height = Math.max(460, (baseRows + items.length * 1.45) * lineH + 90);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Fondo papel blanco limpio + borde sutil
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  let y = 52;
  const drawDivider = () => {
    ctx.save();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(width - padX, y);
    ctx.stroke();
    ctx.restore();
    y += 22;
  };

  const drawCentered = (text, font, color = '#0f172a', extraGap = lineH) => {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.fillText(String(text || '').slice(0, 44), width / 2, y);
    y += extraGap;
  };

  const drawRow = (left, right, font = '600 20px monospace', color = '#1e293b', extraGap = lineH) => {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.fillText(String(left || '').slice(0, 30), padX, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(right || ''), width - padX, y);
    y += extraGap;
  };

  // Encabezado
  drawCentered(companyName, '900 28px sans-serif', '#0f172a', 32);
  if (companyRif) drawCentered(`RIF: ${companyRif}`, '600 18px monospace', '#475569', 24);
  if (companyPhone) drawCentered(`Tel: ${companyPhone}`, '600 18px monospace', '#475569', 24);
  drawCentered(docLabel, '800 18px sans-serif', '#047857', 28);
  drawDivider();

  // Metadatos
  drawRow('Documento:', docNum, '700 19px monospace', '#0f172a', 26);
  drawRow('Fecha:', dateStr, '600 18px monospace', '#334155', 26);
  drawRow('Cliente:', customerName.slice(0, 24), '700 18px monospace', '#0f172a', 26);
  if (customerDoc && customerDoc !== 'V-00000000') {
    drawRow('CI / RIF:', customerDoc, '600 18px monospace', '#334155', 26);
  }
  drawDivider();

  // Productos
  drawRow('CANT  PRODUCTO', 'IMPORTE', '800 17px monospace', '#64748b', 26);
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    const name = String(item.product?.name || item.name || item.product?.nombre || 'Producto').trim();
    const sub = Number(item.finalSubtotal ?? (Number(item.price ?? item.product?.price ?? 0) * qty));
    const qtyText = Number.isInteger(qty) ? `${qty}x` : `${qty.toFixed(2)}x`;
    drawRow(`${qtyText} ${name.slice(0, 23)}`, `$${sub.toFixed(2)}`, '700 19px monospace', '#0f172a', 30);
  }

  y += 4;
  drawDivider();

  // Totales
  drawRow('SUBTOTAL:', `$${subtotalUSD.toFixed(2)}`, '700 19px monospace', '#475569', 26);
  if (taxUSD > 0) {
    drawRow('IMPUESTO:', `$${taxUSD.toFixed(2)}`, '700 19px monospace', '#475569', 26);
  }
  drawRow('TOTAL USD:', `$${totalUSD.toFixed(2)}`, '900 26px monospace', '#047857', 34);
  if (totalBS > 0) {
    drawRow(
      'TOTAL BS:',
      `Bs. ${totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      '800 22px monospace',
      '#0f172a',
      30
    );
  }
  drawRow('Forma de pago:', method.slice(0, 20), '600 18px monospace', '#334155', 26);
  if (refCode) {
    drawRow('Referencia:', `#${String(refCode).slice(0, 20)}`, '800 18px monospace', '#0f172a', 26);
  }

  y += 6;
  drawDivider();
  drawCentered('¡Gracias por su compra!', '800 20px sans-serif', '#0f172a', 26);
  drawCentered('Comprobante digital ecológico • Isaac POS', '600 15px sans-serif', '#64748b', 20);

  return canvas.toDataURL('image/png');
}

export default function MobileWhatsAppReceiptModal({
  whatsAppModalData,
  onClose,
  T,
  businessInfo = {},
  exchangeRate = 1,
  whatsAppPhoneInput,
  setWhatsAppPhoneInput,
  generateEcoReceiptText = () => '',
  cleanWhatsAppPhone = (p) => String(p || '').replace(/\D/g, ''),
  showToast = () => {},
  triggerHaptic = () => {}
}) {
  const [isSendingImage, setIsSendingImage] = useState(false);
  const {
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    handleFieldFocusCapture
  } = useMobileKeyboardViewport({ enabled: Boolean(whatsAppModalData) });

  const handleSendTextWhatsApp = () => {
    if (!whatsAppModalData) return;
    triggerHaptic(20);
    const fullText = generateEcoReceiptText(whatsAppModalData);
    const cleanPhone = cleanWhatsAppPhone(whatsAppPhoneInput);
    const encoded = encodeURIComponent(fullText);
    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
    showToast('📲 Abriendo WhatsApp...');
    onClose();
  };

  const handleSendImageWhatsApp = async () => {
    if (!whatsAppModalData || isSendingImage) return;
    triggerHaptic(20);
    setIsSendingImage(true);
    try {
      const dataUrl = renderThermalReceiptToPngDataUrl(whatsAppModalData, businessInfo, exchangeRate);
      if (!dataUrl) {
        throw new Error('No se pudo renderizar la imagen del ticket');
      }
      const fullText = generateEcoReceiptText(whatsAppModalData);
      const cleanPhone = cleanWhatsAppPhone(whatsAppPhoneInput);
      const docNum = String(whatsAppModalData.invoiceNumber || whatsAppModalData.code || 'Ticket').replace(/[^a-zA-Z0-9_-]/g, '');

      // 1. Android Nativo (Capacitor): Intent directo a WhatsApp con imagen PNG adjunta
      if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.shareImageToWhatsApp) {
        await window.Capacitor.Plugins.PosNativeHardware.shareImageToWhatsApp({
          imageBase64: dataUrl,
          phone: cleanPhone,
          text: fullText,
          title: `Comprobante #${docNum}`
        });
        showToast('🖼️ Abriendo WhatsApp con imagen del ticket...');
        onClose();
        return;
      }

      // 2. Web Share API con soporte de archivos PNG
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const pngFile = new File([blob], `Ticket_${docNum}.png`, { type: 'image/png' });
      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [pngFile] })) {
        await navigator.share({
          files: [pngFile],
          title: `Comprobante #${docNum}`,
          text: fullText
        });
        showToast('🖼️ Imagen del ticket compartida');
        onClose();
        return;
      }

      // 3. Fallback navegador/PC: descargar PNG limpio
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `Ticket_${docNum}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('🖼️ Ticket guardado como imagen PNG');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('[MobileWhatsAppReceiptModal] Error compartiendo imagen:', err?.message || err);
        showToast('⚠️ No se pudo generar la imagen, usa envío por texto');
      }
    } finally {
      setIsSendingImage(false);
    }
  };

  return (
    <AnimatePresence>
        {whatsAppModalData && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/85 animate-fadeIn overflow-y-auto"
            style={modalOverlayStyle}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={`w-full max-w-sm ${T.modalCard} rounded-2xl sm:rounded-xl p-5 shadow-2xl border border-emerald-500/40 space-y-3.5 max-h-[92dvh] overflow-y-auto my-auto`}
              style={modalCardMaxHeightStyle}
              onFocusCapture={handleFieldFocusCapture}
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
                    <p className="text-[10px] text-emerald-400 font-bold">100% Ecológico • Texto o Imagen PNG</p>
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
                    inputMode="tel"
                    enterKeyHint="send"
                    placeholder="Ej: 0414 1234567 o +58..."
                    value={whatsAppPhoneInput}
                    onChange={(e) => setWhatsAppPhoneInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.keyCode === 13) {
                        e.preventDefault();
                        handleSendTextWhatsApp();
                      }
                    }}
                    className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl pl-9 pr-3 py-2.5 text-base sm:text-sm font-mono font-bold outline-none focus:border-emerald-500`}
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  Pulsa Enter para enviar directo o déjalo vacío para elegir cualquier contacto en WhatsApp.
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
                  onClick={handleSendImageWhatsApp}
                  disabled={isSendingImage}
                  className="w-full min-h-[46px] py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-600/30 active:scale-95 transition-all"
                >
                  {isSendingImage ? <RefreshCw size={15} className="animate-spin" /> : <ImageIcon size={15} />}
                  <span>{isSendingImage ? 'Generando imagen...' : 'Enviar Ticket como Imagen'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendTextWhatsApp}
                  className="w-full min-h-[46px] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
                >
                  <Share2 size={15} />
                  <span>Enviar Recibo en Texto (WhatsApp)</span>
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
