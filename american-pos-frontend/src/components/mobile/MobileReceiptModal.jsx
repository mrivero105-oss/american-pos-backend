import { motion, AnimatePresence } from 'framer-motion';
import { Printer, Settings, Share2, CheckCircle2, X } from 'lucide-react';
import { getRegionConfig } from '../../utils/regionConfig';

export default function MobileReceiptModal({
  receipt,
  onClose,
  businessInfo,
  user,
  onPrintBluetooth,
  onOpenThermalPrinterSettings,
  onShareWhatsApp,
  triggerHaptic = () => {}
}) {
  if (!receipt) return null;

  const printedReceipt = receipt;
  const companyName = businessInfo?.name || localStorage.getItem('company_name') || 'Isaac POS';
  const companyRif = businessInfo?.rif || localStorage.getItem('company_rif') || '';
  const regionCfg = getRegionConfig(businessInfo?.country);
  const taxLabel = businessInfo?.taxConfig?.taxLabel || businessInfo?.taxLabel || regionCfg.taxLabel || 'IVA';
  const taxRate = Number(businessInfo?.taxConfig?.ivaRate ?? businessInfo?.ivaRate ?? regionCfg.defaultTaxRate);
  const taxEnabled = businessInfo?.taxConfig?.ivaEnabled !== undefined ? Boolean(businessInfo.taxConfig.ivaEnabled) : (businessInfo?.ivaEnabled !== false);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-xs">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            triggerHaptic(10);
            onClose();
          }}
          className="fixed inset-0 cursor-pointer"
        />

        {/* Tarjeta de Ticket Térmico Animada */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          transition={{ type: 'spring', damping: 25, stiffness: 320 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-xs bg-white text-slate-950 font-mono text-[11px] p-5 rounded-2xl shadow-2xl space-y-2.5 border-dashed border-2 border-slate-300 max-h-[92dvh] overflow-y-auto custom-scrollbar select-none z-10"
        >
          {/* Botón flotante para cerrar */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              onClose();
            }}
            className="absolute top-3 right-3 text-slate-400 hover:text-slate-800 p-1 rounded-full cursor-pointer transition-colors"
            title="Cerrar recibo"
          >
            <X size={16} />
          </button>

          {/* Encabezado del Comercio */}
          <div className="text-center border-b border-dashed border-slate-300 pb-2.5 pt-1">
            <div className="flex items-center justify-center gap-1.5 text-emerald-600 mb-1">
              <CheckCircle2 size={18} />
              <span className="font-sans font-black text-xs tracking-wider uppercase">¡Venta Exitosa!</span>
            </div>
            <h2 className="font-black text-base tracking-tight leading-tight">{companyName}</h2>
            {companyRif && (
              <p className="text-[10px] text-slate-600 font-sans">{companyRif}</p>
            )}
            <p className="text-[9.5px] text-emerald-700 font-bold font-sans mt-0.5">
              {printedReceipt.documentType === 'nota_entrega' ? 'Nota de Entrega Comercial' : 'Comprobante de Venta Fiscal'}
            </p>
          </div>

          {/* Datos Generales de la Venta */}
          <div className="text-[10px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Nº Documento:</span>
              <span className="font-bold">{printedReceipt.invoiceNumber || printedReceipt.code || 'TICKET'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Fecha:</span>
              <span>{printedReceipt.date || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Cajero:</span>
              <span>{user?.name || user?.username || 'Cajero'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Cliente:</span>
              <span className="font-bold truncate max-w-[170px]">{printedReceipt.customerName || 'Consumidor Final'}</span>
            </div>
            {printedReceipt.customerDoc && printedReceipt.customerDoc !== 'V-00000000' && (
              <div className="flex justify-between">
                <span className="text-slate-500">CI / RIF:</span>
                <span>{printedReceipt.customerDoc}</span>
              </div>
            )}
          </div>

          {/* Desglose de Productos */}
          <div className="border-t border-b border-dashed border-slate-300 py-2 space-y-1">
            {Array.isArray(printedReceipt.items) && printedReceipt.items.map((item, idx) => {
              const qty = Number(item.quantity) || 1;
              const name = item.product?.name || item.name || item.product?.nombre || 'Producto';
              const price = Number(item.finalSubtotal || (Number(item.price || item.product?.price || 0) * qty)).toFixed(2);
              return (
                <div key={item.product?.id || item.productId || item.id || idx} className="text-[10px] flex justify-between gap-1">
                  <span className="truncate max-w-[170px]">{qty}x {name}</span>
                  <span className="font-bold shrink-0">${price}</span>
                </div>
              );
            })}
          </div>

          {/* Totales y Liquidación */}
          <div className="space-y-0.5 text-[10px] font-bold text-right">
            <div className="flex justify-between">
              <span className="text-slate-500">SUBTOTAL:</span>
              <span>${Number(printedReceipt.subtotal || printedReceipt.totalUSD || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>{taxEnabled && taxRate > 0 ? `${taxLabel} (${taxRate}% INCLUIDO):` : `${taxLabel} (EXENTO):`}</span>
              <span>${Number(printedReceipt.tax || printedReceipt.taxUSD || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-emerald-800 font-black text-xs pt-0.5">
              <span>TOTAL USD:</span>
              <span>${Number(printedReceipt.totalUSD || printedReceipt.total || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-800 font-bold">
              <span>TOTAL BS:</span>
              <span>Bs. {Number(printedReceipt.totalBS || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-[9px] text-slate-600 pt-0.5">
              <span>Forma de Pago:</span>
              <span>{printedReceipt.method || printedReceipt.paymentMethod || 'Efectivo'}</span>
            </div>
            {(() => {
              const directRef = printedReceipt.paymentReference || printedReceipt.reference ||
                (Array.isArray(printedReceipt.paymentMethods) && printedReceipt.paymentMethods[0]?.reference) ||
                (typeof printedReceipt.notes === 'string' && printedReceipt.notes.toLowerCase().startsWith('ref:') ? printedReceipt.notes.substring(4).trim() : '');
              return directRef ? (
                <div className="flex justify-between text-[9px] text-slate-900 font-black">
                  <span>Ref. Operación:</span>
                  <span>#{directRef}</span>
                </div>
              ) : null;
            })()}
          </div>

          <div className="text-center pt-2 border-t border-dashed border-slate-300 font-sans">
            <p className="font-bold text-[10px] text-slate-700">¡Gracias por su compra!</p>
          </div>

          {/* Acciones de Entrega */}
          <div className="space-y-2 pt-1 font-sans">
            <button 
              type="button"
              onClick={() => {
                triggerHaptic(15);
                onPrintBluetooth(printedReceipt);
              }}
              className="w-full bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
            >
              <Printer size={14} /> Imprimir Térmica Bluetooth
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                onOpenThermalPrinterSettings();
              }}
              className="w-full text-slate-500 hover:text-slate-800 text-[10px] font-bold py-0.5 flex items-center justify-center gap-1 cursor-pointer"
            >
              <Settings size={11} /> Ajustar Impresora Térmica
            </button>
            <button 
              type="button"
              onClick={() => {
                triggerHaptic(15);
                onShareWhatsApp(printedReceipt);
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-emerald-600/25 active:scale-95"
            >
              <Share2 size={14} /> 📲 Recibo Ecológico WhatsApp
            </button>
            <button 
              type="button"
              onClick={() => {
                triggerHaptic(10);
                onClose();
              }}
              className="w-full bg-slate-200 text-slate-900 font-bold py-2 rounded-xl text-xs hover:bg-slate-300 active:scale-95 transition-all cursor-pointer"
            >
              Cerrar y Nueva Venta
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
