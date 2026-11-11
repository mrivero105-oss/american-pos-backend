import { useState, useEffect, useRef } from 'react';
import { X, Printer, Download, MessageCircle, FileText, Calendar, DollarSign, ArrowUpRight, ArrowDownLeft, Building2, User, CreditCard } from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import { formatMoney } from '../utils/format';

export default function AccountStatementModal({ isOpen, onClose, customer, businessSettings = {}, exchangeRate = 1 }) {
    const [statement, setStatement] = useState(null);
    const [loading, setLoading] = useState(true);
    const printRef = useRef();

    useEffect(() => {
        if (isOpen && customer?.id) {
            fetchStatement();
        } else {
            setStatement(null);
        }
    }, [isOpen, customer]);

    const fetchStatement = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/customers/${customer.id}/statement`);
            setStatement(res.data);
        } catch (error) {
            console.error('Error fetching statement:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !customer) return null;

    const summary = statement?.summary || {};
    const history = statement?.history || [];
    const recentSales = statement?.recentSales || [];

    const handlePrint = () => {
        const printContent = printRef.current;
        if (!printContent) return;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Estado de Cuenta - ${customer.name}</title>
                <meta charset="utf-8" />
                <style>
                    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 30px; color: #0f172a; line-height: 1.5; }
                    .header { border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-start; }
                    .title { font-size: 24px; font-weight: 900; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: 0.05em; }
                    .biz-name { font-size: 20px; font-weight: 900; text-transform: uppercase; margin: 0 0 6px 0; color: #0f172a; }
                    .subtitle { font-size: 12px; color: #475569; margin: 2px 0; font-weight: 600; }
                    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
                    .card { padding: 16px; border: 1px solid #cbd5e1; border-radius: 12px; background: #f8fafc; }
                    .card-title { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 6px; letter-spacing: 0.05em; }
                    .card-val { font-size: 22px; font-weight: 900; color: #0f172a; }
                    .card-val.danger { color: #e11d48; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
                    th { background: #0f172a; color: white; text-align: left; padding: 10px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; }
                    td { padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
                    .text-right { text-align: right; }
                    .text-center { text-align: center; }
                    .footer { margin-top: 50px; padding-top: 20px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #64748b; text-align: center; font-weight: 600; }
                    @media print {
                        body { margin: 15px; }
                    }
                </style>
            </head>
            <body>
                ${printContent.innerHTML}
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 300);
    };

    const handleSendWhatsApp = () => {
        if (!customer.phone) return;
        const debtUsd = parseFloat(customer.creditBalance) || 0;
        const debtBs = (debtUsd * exchangeRate).toFixed(2);
        const bizName = businessSettings.name || 'Isaac POS';
        
        let msg = `*ESTADO DE CUENTA OFICIAL - ${bizName}*\n\n`;
        msg += `Estimado(a) *${customer.name}* (Doc: ${customer.idDocument || '---'})\n\n`;
        msg += `Le informamos el estado actual de su cuenta:\n`;
        msg += `• *Saldo Pendiente:* $${debtUsd.toFixed(2)} USD (${debtBs} Bs)\n`;
        msg += `• *Límite de Crédito:* $${(parseFloat(customer.creditLimit) || 0).toFixed(2)} USD\n\n`;
        if (debtUsd > 0) {
            msg += `Para realizar su abono o cancelación, por favor remitir el comprobante por este medio.\n`;
        }
        msg += `¡Gracias por su preferencia!`;

        const phone = customer.phone.replace(/[^0-9]/g, '');
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    };

    return (
        <BaseModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
            <div className="relative bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92dvh] overflow-y-auto custom-scrollbar pb-safe">
                {/* Actions Toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 mb-6">
                    <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
                            <FileText size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-lg font-bold uppercase tracking-tight text-slate-900 dark:text-white">Estado de Cuenta Oficial</h2>
                                <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider rounded border border-slate-200 dark:border-slate-700">
                                    VISTA PREVIA
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Cliente: <span className="text-slate-900 dark:text-white font-bold">{customer.name}</span> • Doc: <span className="text-slate-700 dark:text-slate-300">{customer.idDocument || '---'}</span></p>
                        </div>
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 w-full sm:w-auto">
                        {customer.phone && (
                            <button
                                onClick={handleSendWhatsApp}
                                className="min-h-[40px] flex-1 sm:flex-none justify-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                            >
                                <MessageCircle size={15} /> WhatsApp
                            </button>
                        )}
                        <button
                            onClick={handlePrint}
                            className="min-h-[40px] flex-1 sm:flex-none justify-center px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                        >
                            <Printer size={15} /> Imprimir / PDF
                        </button>
                        <button 
                            onClick={onClose} 
                            className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                            aria-label="Cerrar"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="py-20 text-center">
                        <div className="inline-flex items-center gap-2.5 text-sky-600 dark:text-sky-400 font-bold text-xs uppercase tracking-wider">
                            <div className="w-2.5 h-2.5 bg-sky-600 dark:bg-sky-400 rounded-full animate-pulse"></div>
                            Cargando Libro Mayor y Estado de Cuenta...
                        </div>
                    </div>
                ) : (
                    <div ref={printRef} className="space-y-6 bg-slate-50 dark:bg-slate-800/50 p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        {/* Letterhead Header */}
                        <div className="header grid grid-cols-1 md:grid-cols-2 gap-6 items-start border-b border-slate-200 dark:border-slate-700 pb-6">
                            {/* Business Info */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 mb-1">
                                    <Building2 size={16} />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Emisor Comercial</span>
                                </div>
                                <h1 className="biz-name text-xl font-bold uppercase text-slate-900 dark:text-white tracking-tight">
                                    {businessSettings.name || 'Isaac POS'}
                                </h1>
                                <div className="space-y-0.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                                    <p className="subtitle">RIF: <span className="text-slate-800 dark:text-slate-200">{businessSettings.rif || 'J-XXXXXXXX-X'}</span></p>
                                    <p className="subtitle">Dirección: <span className="text-slate-800 dark:text-slate-200">{businessSettings.address || 'Principal'}</span></p>
                                    <p className="subtitle">Teléfono: <span className="text-slate-800 dark:text-slate-200">{businessSettings.phone || '---'}</span></p>
                                </div>
                            </div>

                            {/* Statement Details & Customer Box */}
                            <div className="md:text-right flex flex-col md:items-end space-y-3">
                                <div>
                                    <div className="title text-base font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">ESTADO DE CUENTA</div>
                                    <p className="subtitle text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Fecha de Emisión: <span className="text-slate-900 dark:text-white font-bold">{new Date().toLocaleDateString()}</span></p>
                                </div>
                                
                                <div className="w-full sm:w-auto min-w-[240px] bg-white dark:bg-slate-800 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-left">
                                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                        <User size={12} className="text-sky-600 dark:text-sky-400" /> Datos del Cliente
                                    </div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-white uppercase">{customer.name}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Doc / Cédula: <span className="text-slate-800 dark:text-slate-200">{customer.idDocument || '---'}</span></div>
                                    {customer.phone && <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Tel: <span className="text-slate-800 dark:text-slate-200">{customer.phone}</span></div>}
                                </div>
                            </div>
                        </div>

                        {/* Summary Cards */}
                        <div className="cards grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="card bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                                <div className="card-title text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider">Límite Aprobado</div>
                                <div className="card-val text-xl font-bold text-slate-900 dark:text-white tracking-tight mt-1 tabular-nums">{formatMoney(summary.creditLimit, 'USD')}</div>
                                <span className="text-[10px] text-slate-400 font-medium">Capacidad total autorizada</span>
                            </div>

                            <div className="card bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                                <div className="card-title text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider">Total Facturado a Crédito</div>
                                <div className="card-val text-xl font-bold text-slate-900 dark:text-white tracking-tight mt-1 tabular-nums">{formatMoney(summary.totalCharges, 'USD')}</div>
                                <span className="text-[10px] text-slate-400 font-medium">Volumen histórico financiado</span>
                            </div>

                            <div className="card bg-rose-50 dark:bg-rose-950/30 p-4 rounded-lg border border-rose-200 dark:border-rose-900/50">
                                <div className="card-title text-[10px] font-bold uppercase text-rose-700 dark:text-rose-400 tracking-wider">Saldo Pendiente de Pago</div>
                                <div className="card-val text-2xl font-bold text-rose-600 dark:text-rose-400 tracking-tight mt-1 tabular-nums">{formatMoney(summary.currentBalance, 'USD')}</div>
                                <div className="text-xs font-semibold text-rose-700/80 dark:text-rose-300/80 mt-0.5">≈ {(summary.currentBalance * exchangeRate).toFixed(2)} Bs</div>
                            </div>
                        </div>

                        {/* Transactions Table */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <CreditCard size={14} className="text-sky-600 dark:text-sky-400" /> Movimientos del Libro Mayor
                                </h3>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    {history.length} Operaciones
                                </span>
                            </div>

                            {/* Desktop Table */}
                            <div className="hidden sm:block overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                                            <th className="py-2.5 px-3.5">Fecha</th>
                                            <th className="py-2.5 px-3.5 text-center">Tipo</th>
                                            <th className="py-2.5 px-3.5">Descripción de la Operación</th>
                                            <th className="py-2.5 px-3.5 text-right">Monto</th>
                                            <th className="py-2.5 px-3.5 text-right">Saldo Resultante</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {history.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="py-8 text-center text-slate-400 font-medium">
                                                    Sin movimientos de cargos ni abonos registrados
                                                </td>
                                            </tr>
                                        ) : (
                                            history.map((h, i) => {
                                                const isCharge = h.type === 'charge' || h.type === 'debit';
                                                return (
                                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                                                        <td className="py-2.5 px-3.5 text-slate-500 dark:text-slate-400">{new Date(h.timestamp || h.createdAt).toLocaleDateString()}</td>
                                                        <td className="py-2.5 px-3.5 text-center">
                                                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                                                                isCharge 
                                                                ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50' 
                                                                : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50'
                                                            }`}>
                                                                {isCharge ? 'Cargo (+)' : 'Abono (-)'}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 px-3.5 text-slate-800 dark:text-slate-200 font-medium">{h.description || 'Operación'}</td>
                                                        <td className={`py-2.5 px-3.5 text-right font-bold tabular-nums ${isCharge ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                            {isCharge ? '+' : '-'}{formatMoney(h.amount, 'USD')}
                                                        </td>
                                                        <td className="py-2.5 px-3.5 text-right text-slate-900 dark:text-white font-bold tabular-nums">{formatMoney(h.balanceAfter, 'USD')}</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Cards */}
                            <div className="block sm:hidden space-y-2">
                                {history.length === 0 ? (
                                    <div className="py-6 text-center text-slate-400 font-medium text-xs bg-white dark:bg-slate-800 rounded-lg p-3">
                                        Sin movimientos de cargos ni abonos registrados
                                    </div>
                                ) : (
                                    history.map((h, i) => {
                                        const isCharge = h.type === 'charge' || h.type === 'debit';
                                        return (
                                            <div key={i} className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1.5">
                                                <div className="flex justify-between items-start">
                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                                                        isCharge 
                                                        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50' 
                                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50'
                                                    }`}>
                                                        {isCharge ? 'Cargo (+)' : 'Abono (-)'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-mono">
                                                        {new Date(h.timestamp || h.createdAt).toLocaleDateString()}
                                                    </span>
                                                </div>
                                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{h.description || 'Operación'}</p>
                                                <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-100 dark:border-slate-700">
                                                    <div>
                                                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Monto</span>
                                                        <span className={`text-xs font-bold tabular-nums ${isCharge ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                            {isCharge ? '+' : '-'}{formatMoney(h.amount, 'USD')}
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Saldo Resultante</span>
                                                        <span className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                                                            {formatMoney(h.balanceAfter, 'USD')}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Formal Footer */}
                        <div className="footer text-center text-xs text-slate-500 dark:text-slate-400 font-medium pt-4 border-t border-slate-200 dark:border-slate-700 space-y-0.5">
                            <p>Documento oficial emitido por el sistema <span className="text-slate-900 dark:text-white font-bold">Isaac POS</span></p>
                            <p className="text-[10px] text-slate-400">Para consultas o conciliación de saldos comuníquese con administración al {businessSettings.phone || 'comercio'}</p>
                        </div>
                    </div>
                )}
            </div>
        </BaseModal>
    );
}
