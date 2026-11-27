import { useState, useRef } from 'react';
import { X, CheckCircle2, Calendar, Printer, Eye, Truck, ShieldCheck, ExternalLink, TrendingUp } from 'lucide-react';
import BaseModal from './BaseModal';
import InvoiceViewerModal from './InvoiceViewerModal';
import { isDollarOnlyCountry } from '../utils/format';

export default function SupplierPaymentVoucherModal({ isOpen, onClose, invoice, settings, onOpenSupplierHistory }) {
    const effectiveCountry = settings?.country || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);

    const [viewerInvoice, setViewerInvoice] = useState({ isOpen: false, url: '', details: {} });
    const printRef = useRef();

    if (!isOpen || !invoice) return null;

    const arrivalRate = Number(invoice.arrivalExchangeRate || invoice.exchangeRate || 1);
    const paymentRate = Number(invoice.paymentExchangeRate || invoice.exchangeRate || 1);
    const amountUsd = Number(invoice.amountUsd || 0);

    const arrivalAmountVes = Number(invoice.amountVes || (amountUsd * arrivalRate).toFixed(2));
    const paymentAmountVes = Number(invoice.paymentAmountVes || (amountUsd * paymentRate).toFixed(2));
    const diffVes = Number((paymentAmountVes - arrivalAmountVes).toFixed(2));


    const formatDateTime = (dateStr) => {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateStr;
        }
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <>
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                maxWidth="max-w-2xl"
                zIndex="z-[1050]"
                className="overflow-hidden border border-slate-200 dark:border-slate-800 max-h-[92dvh] pb-safe flex flex-col"
            >
                {/* Header */}
                <div className="relative px-4 sm:px-8 py-3.5 sm:py-6 bg-gradient-to-r from-emerald-600/10 via-emerald-500/5 to-transparent border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="p-2.5 sm:p-3 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-2xl shadow-inner shrink-0">
                            <ShieldCheck size={22} className="sm:w-6 sm:h-6" strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                                    Comprobante Oficial de Pago
                                </span>
                            </div>
                            <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase mt-0.5 truncate">
                                Factura #{invoice.referenceNumber}
                            </h2>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all cursor-pointer shrink-0"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 sm:p-8 overflow-y-auto space-y-4 sm:space-y-6 custom-scrollbar flex-1 min-h-0" ref={printRef}>
                    {/* Hero Card Status */}
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 relative overflow-hidden text-center shadow-sm">
                        <div className="inline-flex p-3 bg-emerald-500 text-white rounded-xl shadow-sm mb-3">
                            <CheckCircle2 size={30} strokeWidth={2.5} />
                        </div>
                        <h3 className="text-lg font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                            {isDollarCountry ? 'Comprobante de Pago Liquidado' : 'Obligación Liquidada en Bolívares'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">
                            {isDollarCountry ? 'Comprobante de liquidación a proveedor emitido en Dólares (USD).' : 'Calculado según la Tasa Oficial BCV vigente en la fecha de pago.'}
                        </p>

                        <div className={`mt-5 pt-5 border-t border-emerald-500/15 flex flex-col ${isDollarCountry ? 'items-center justify-center' : 'sm:flex-row items-center justify-around'} gap-4`}>
                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{isDollarCountry ? 'Total Pagado USD' : 'Total Obligación USD'}</span>
                                <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                                    ${amountUsd.toFixed(2)}
                                </p>
                            </div>
                            {!isDollarCountry && (
                                <>
                                    <div className="hidden sm:block w-px h-12 bg-emerald-500/20" />
                                    <div>
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Monto Transferido en Bs. (Tasa de Pago)</span>
                                        <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight font-mono">
                                            Bs. {paymentAmountVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                        </p>
                                        <span className="text-[10px] font-mono font-medium text-slate-400">
                                            Tasa de Pago: {paymentRate.toFixed(4)} Bs/$
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Comparativa de Tasas: Día de Llegada vs Día de Pago */}
                    {!isDollarCountry && (
                        <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-5 border border-slate-200/60 dark:border-slate-700/60 space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    <TrendingUp size={14} className="text-indigo-500" /> Auditoría de Tasas de Cambio (BCV)
                                </span>
                                {diffVes !== 0 && (
                                    <span className="text-[9px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-mono">
                                        Variación: {diffVes > 0 ? `+Bs. ${diffVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : `-Bs. ${Math.abs(diffVes).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`}
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Tasa Llegada */}
                                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black text-slate-400 uppercase">1. Día de Recepción (Factura)</span>
                                        <span className="text-[10px] font-mono text-slate-500 font-bold">{invoice.arrivalDate || 'N/A'}</span>
                                    </div>
                                    <p className="text-base font-black font-mono text-slate-700 dark:text-slate-300">
                                        Bs. {arrivalRate.toFixed(4)} <span className="text-xs font-normal text-slate-400">/ USD</span>
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-mono">
                                        Valor inicial: Bs. {arrivalAmountVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>

                                {/* Tasa Pago */}
                                <div className="p-4 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-sm space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase">2. Día de Liquidación (Pago)</span>
                                        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                                            {formatDateTime(invoice.paidAt || invoice.timestamp).split(',')[0]}
                                        </span>
                                    </div>
                                    <p className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                                        Bs. {paymentRate.toFixed(4)} <span className="text-xs font-normal text-emerald-600/70">/ USD</span>
                                    </p>
                                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                                        Monto pagado: Bs. {paymentAmountVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Details Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-1">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Truck size={13} className="text-amber-500" /> Proveedor / Beneficiario
                            </span>
                            <p className="text-sm font-black text-slate-800 dark:text-white uppercase truncate">
                                {invoice.supplierName}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold">
                                {isDollarCountry ? 'RUC / Identificación' : 'RIF / ID'}: {invoice.supplierRif || 'N/A'}
                            </p>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-1">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Calendar size={13} className="text-indigo-500" /> Fechas & Registro
                            </span>
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 space-y-0.5">
                                <p>Llegada Mercancía: <span className="text-slate-900 dark:text-white font-mono">{invoice.arrivalDate || 'N/A'}</span></p>
                                <p>Fecha Liquidación: <span className="text-emerald-600 dark:text-emerald-400 font-mono">{formatDateTime(invoice.paidAt || invoice.timestamp)}</span></p>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-1">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                Método de Pago
                            </span>
                            <p className="text-sm font-black text-slate-800 dark:text-white uppercase">
                                {invoice.paymentMethod === 'cash' ? 'Efectivo / Transferencia' : invoice.paymentMethod || 'Liquidación Contable'}
                            </p>
                            <p className="text-[10px] text-slate-500">
                                Transacción asentada en tesorería
                            </p>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-1">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                Auditoría & Referencia
                            </span>
                            <p className="text-sm font-black text-slate-800 dark:text-white uppercase font-mono">
                                {invoice.id ? invoice.id.split('-')[0] : 'CONFIRMADO'}
                            </p>
                            <p className="text-[10px] text-slate-500">
                                Estado: 100% Solvente
                            </p>
                        </div>
                    </div>

                    {/* Description Note */}
                    {invoice.description && (
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-700/40">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                Concepto / Detalle Registrado
                            </span>
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-1">
                                {invoice.description}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="px-4 sm:px-8 py-3.5 sm:py-5 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
                    <div>
                        {onOpenSupplierHistory && (
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    onOpenSupplierHistory({ id: invoice.supplierId, name: invoice.supplierName });
                                }}
                                className="min-h-[40px] sm:min-h-[36px] py-2 text-[10px] font-black text-slate-500 hover:text-amber-500 uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                                <span>Ver Estado de Cuenta Completo del Proveedor</span>
                                <ExternalLink size={13} />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2.5 sm:gap-3">
                        {invoice.invoiceUrl && (
                            <button
                                type="button"
                                onClick={() => setViewerInvoice({
                                    isOpen: true,
                                    url: invoice.invoiceUrl,
                                    details: {
                                        referenceNumber: invoice.referenceNumber,
                                        supplierName: invoice.supplierName,
                                        date: invoice.arrivalDate
                                    }
                                })}
                                className="flex-1 sm:flex-none min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-black uppercase transition-all cursor-pointer active:scale-95"
                            >
                                <Eye size={15} />
                                <span>Factura Real</span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={handlePrint}
                            className="flex-1 sm:flex-none min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-700 dark:hover:bg-slate-600 rounded-xl text-xs font-black uppercase transition-all shadow-md cursor-pointer active:scale-95"
                        >
                            <Printer size={15} />
                            <span>Imprimir</span>
                        </button>
                    </div>
                </div>
            </BaseModal>

            {/* Viewer Modal */}
            <InvoiceViewerModal
                isOpen={viewerInvoice.isOpen}
                onClose={() => setViewerInvoice({ isOpen: false, url: '', details: {} })}
                imageUrl={viewerInvoice.url}
                invoiceDetails={viewerInvoice.details}
            />
        </>
    );
}
