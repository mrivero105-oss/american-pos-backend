import { AnimatePresence, motion } from 'framer-motion';
import { Check, CheckCircle2, Copy, Loader2, QrCode, Smartphone, X } from 'lucide-react';
import { formatBs } from '../../utils/format';
import { formatIdDisplay, formatPhoneDisplay, getBankNameByCode } from '../../utils/pagoMovilQR';

export default function CheckoutPaymentQrModal({
    qrModalMethod,
    setQrModalMethod,
    generatingQrModal,
    qrModalUrl,
    handleCopyText,
    copiedField,
    handleCopyAll,
    qrModalReference,
    setQrModalReference,
    handleConfirmQrPayment
}) {
    return (
        <AnimatePresence>
            {qrModalMethod && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[90] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md"
                    onClick={() => setQrModalMethod(null)}
                >
                    <motion.div
                        initial={{ scale: 0.95, y: 10 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.95, y: 10 }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xl relative flex flex-col gap-4 text-slate-900 dark:text-white font-sans max-h-[92vh] overflow-y-auto custom-scrollbar"
                    >
                        {/* Cabecera */}
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-xs">
                                    <QrCode size={19} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold uppercase tracking-tight text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                        {qrModalMethod.isBinance ? 'Binance Pay & Código QR (USDT)' : 'Pago Móvil & Código QR'}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                                        {qrModalMethod.name || 'Pago Móvil'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setQrModalMethod(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Código QR Central */}
                        <div className="flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
                            <div className="relative p-2.5 bg-white rounded-lg border border-slate-200 shadow-sm">
                                {generatingQrModal ? (
                                    <div className="w-44 h-44 flex flex-col items-center justify-center text-slate-800 gap-2">
                                        <Loader2 size={28} className="animate-spin text-sky-600" />
                                        <span className="text-[10px] font-bold tracking-wider text-slate-500">GENERANDO QR...</span>
                                    </div>
                                ) : qrModalUrl ? (
                                    <img
                                        src={qrModalUrl}
                                        alt="Código QR Pago Móvil"
                                        className="w-44 h-44 object-contain rounded-md"
                                    />
                                ) : (
                                    <div className="w-44 h-44 flex flex-col items-center justify-center text-slate-400 gap-2 text-center p-2">
                                        <Smartphone size={32} className="text-slate-300" />
                                        <span className="text-xs font-semibold text-slate-600">Completa teléfono y RIF para generar el QR</span>
                                    </div>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-2 text-center">
                                Muestra la pantalla al cliente para que escanee con su app bancaria
                            </p>
                        </div>

                        {/* Datos de Cobro Binance Pay o Pago Móvil */}
                        {qrModalMethod.isBinance ? (
                            <div className="space-y-2">
                                {qrModalMethod.binancePayId && (
                                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60">
                                        <span className="text-xs text-amber-900 dark:text-amber-300 font-semibold">Binance Pay ID:</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                                                {qrModalMethod.binancePayId}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyText(qrModalMethod.binancePayId, 'payId')}
                                                className="p-1 hover:bg-amber-100 dark:hover:bg-amber-900 rounded text-amber-700 dark:text-amber-400 transition-colors cursor-pointer"
                                                title="Copiar Pay ID"
                                            >
                                                {copiedField === 'payId' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {qrModalMethod.binanceEmail && (
                                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Correo Binance:</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-100">
                                                {qrModalMethod.binanceEmail}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyText(qrModalMethod.binanceEmail, 'email')}
                                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
                                                title="Copiar correo"
                                            >
                                                {copiedField === 'email' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Paridad 1:1 USD */}
                                <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60">
                                    <span className="text-xs text-amber-900 dark:text-amber-300 font-semibold">Paridad Cambiaria:</span>
                                    <span className="text-xs font-mono font-bold text-amber-800 dark:text-amber-200">
                                        1 USDT = $1.00 USD
                                    </span>
                                </div>

                                <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                                    <div>
                                        <span className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold block">Total a Transferir:</span>
                                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                            Equivalente: {formatBs(qrModalMethod.amountBs || 0)} (${Number(qrModalMethod.amountUsdt || 0).toFixed(2)} USD)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-base font-mono font-black text-emerald-700 dark:text-emerald-400">
                                            {Number(qrModalMethod.amountUsdt || 0).toFixed(2)} USDT
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyText(Number(qrModalMethod.amountUsdt || 0).toFixed(2), 'amount')}
                                            className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded text-emerald-700 dark:text-emerald-400 transition-colors cursor-pointer"
                                            title="Copiar monto en USDT"
                                        >
                                            {copiedField === 'amount' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {/* Datos Bancarios con botones de Copiar */}
                                {qrModalMethod.pagoMovilBank && (
                                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Banco:</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-[220px]">
                                                {getBankNameByCode(qrModalMethod.pagoMovilBank)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyText(qrModalMethod.pagoMovilBank, 'bank')}
                                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                                title="Copiar código de banco"
                                            >
                                                {copiedField === 'bank' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {qrModalMethod.pagoMovilPhone && (
                                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Teléfono:</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-100">
                                                {formatPhoneDisplay(qrModalMethod.pagoMovilPhone)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyText(qrModalMethod.pagoMovilPhone, 'phone')}
                                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                                title="Copiar teléfono"
                                            >
                                                {copiedField === 'phone' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {qrModalMethod.pagoMovilId && (
                                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">C.I. / RIF:</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-100">
                                                {formatIdDisplay(qrModalMethod.pagoMovilId)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyText(qrModalMethod.pagoMovilId, 'id')}
                                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                                title="Copiar documento"
                                            >
                                                {copiedField === 'id' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                                    <span className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold">Monto Exacto:</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-mono font-extrabold text-emerald-700 dark:text-emerald-400">
                                            {formatBs(qrModalMethod.amountBs || 0)}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyText(Number(qrModalMethod.amountBs || 0).toFixed(2), 'amount')}
                                            className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded text-emerald-700 dark:text-emerald-400 transition-colors cursor-pointer"
                                            title="Copiar monto en Bs"
                                        >
                                            {copiedField === 'amount' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Botón para Copiar Todo para WhatsApp */}
                        <button
                            type="button"
                            onClick={handleCopyAll}
                            className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                        >
                            {copiedField === 'all' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            <span>Copiar Todos los Datos (Para WhatsApp / Chat)</span>
                        </button>

                        {/* Campo de Referencia y Botón de Cobro */}
                        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                            <div>
                                <label htmlFor="qr-modal-reference-input" className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center justify-between mb-1">
                                    <span>Nº de Referencia / Comprobante <span className="text-rose-500">*</span></span>
                                    <span className="text-[9.5px] font-mono text-amber-600 dark:text-amber-400">OBLIGATORIO</span>
                                </label>
                                <input
                                    id="qr-modal-reference-input"
                                    type="text"
                                    required
                                    autoFocus
                                    value={qrModalReference}
                                    onChange={(e) => setQrModalReference(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleConfirmQrPayment();
                                        }
                                    }}
                                    placeholder="Ej: 123456 (ingrese los dígitos del comprobante)"
                                    className={`w-full bg-slate-50 dark:bg-slate-900 border ${!qrModalReference.trim() ? 'border-amber-400 dark:border-amber-600 focus:border-amber-500' : 'border-emerald-500 dark:border-emerald-500'} rounded-lg px-3 py-2 text-xs font-mono font-bold text-slate-800 dark:text-slate-100 outline-none transition-colors`}
                                />
                            </div>

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setQrModalMethod(null)}
                                    className="py-2.5 px-4 rounded-lg font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs transition-colors uppercase tracking-wider cursor-pointer"
                                >
                                    Cerrar
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirmQrPayment}
                                    disabled={!qrModalReference.trim()}
                                    title={!qrModalReference.trim() ? 'Ingrese el número de referencia para habilitar el cobro' : 'Confirmar y cobrar venta'}
                                    className="flex-1 py-2.5 px-4 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed text-xs transition-colors uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                                >
                                    <CheckCircle2 size={16} />
                                    <span>Confirmar y Cobrar Venta</span>
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
