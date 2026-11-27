import { useState, useEffect, useRef, useCallback } from 'react';
import { X, History, ArrowUpRight, ArrowDownLeft, Calendar, FileText, RefreshCcw, Download } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import api from '../services/api';
import { formatMoney } from '../utils/format';
import { escapeHtml } from '../utils/escapeHtml';
import { useAuth } from '../hooks/AuthContext';
import BaseModal from './BaseModal';

export default function CreditHistoryModal({ isOpen, onClose, customerId, onViewReceipt }) {
    const [history, setHistory] = useState([]);
    const [customerInfo, setCustomerInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [printing, setPrinting] = useState(false);
    const pdfRef = useRef(null);
    const { user } = useAuth();

    const fetchHistory = useCallback(async () => {
        if (!customerId) return;
        try {
            setLoading(true);
            const res = await api.get(`/customers/${customerId}/credit-history`);
            setHistory(res.data.history || []);
            setCustomerInfo(res.data.customer || null);
        } catch (error) {
            console.error('Error fetching credit history:', error);
        } finally {
            setLoading(false);
        }
    }, [customerId]);

    useEffect(() => {
        if (isOpen && customerId) {
            fetchHistory();
        }
    }, [isOpen, customerId, fetchHistory]);

    const generatePDF = async () => {
        if (!pdfRef.current || !customerInfo) return;
        
        try {
            setPrinting(true);
            const printContent = pdfRef.current.innerHTML;
            const printWindow = window.open('', '_blank');
            if (!printWindow) return;
            try { printWindow.opener = null; } catch { /* noop */ }
            const safeTitleName = escapeHtml(String(customerInfo.name || '').replace(/\s+/g, '_'));
            
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                    <head>
                        <meta charset="utf-8" />
                        <title>Estado_Cuenta_${safeTitleName}</title>
                        <style>
                            * { box-sizing: border-box; }
                            body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; background: #fff; color: #1e293b; margin: 0; padding: 16px; }
                            .max-w-4xl { max-width: 896px; margin: 0 auto; }
                            .pt-8 { padding-top: 2rem; }
                            .p-5 { padding: 1.25rem; }
                            .p-12 { padding: 2rem; }
                            .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
                            .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
                            .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
                            .py-4 { padding-top: 1rem; padding-bottom: 1rem; }
                            .pb-2 { padding-bottom: 0.5rem; }
                            .pb-6 { padding-bottom: 1.5rem; }
                            .mb-4 { margin-bottom: 1rem; }
                            .mb-8 { margin-bottom: 2rem; }
                            .mb-10 { margin-bottom: 2.5rem; }
                            .mt-1 { margin-top: 0.25rem; }
                            .mt-2 { margin-top: 0.5rem; }
                            .mt-12 { margin-top: 3rem; }
                            .ml-2 { margin-left: 0.5rem; }
                            .flex { display: flex; }
                            .flex-1 { flex: 1; }
                            .justify-between { justify-content: space-between; }
                            .items-start { align-items: flex-start; }
                            .gap-4 { gap: 1rem; }
                            .inline-block { display: inline-block; }
                            .w-full { width: 100%; }
                            .text-left { text-align: left; }
                            .text-right { text-align: right; }
                            .text-center { text-align: center; }
                            .uppercase { text-transform: uppercase; }
                            .font-black { font-weight: 800; }
                            .font-bold { font-weight: 700; }
                            .font-medium { font-weight: 500; }
                            .text-3xl { font-size: 1.75rem; line-height: 2rem; margin: 0; }
                            .text-xl { font-size: 1.25rem; line-height: 1.75rem; margin: 0; }
                            .text-sm { font-size: 0.875rem; }
                            .text-xs { font-size: 0.75rem; }
                            .text-\\[10px\\] { font-size: 10px; }
                            .tracking-tighter { letter-spacing: -0.04em; }
                            .tracking-tight { letter-spacing: -0.02em; }
                            .tracking-widest { letter-spacing: 0.08em; }
                            .tracking-wider { letter-spacing: 0.05em; }
                            .bg-slate-50 { background: #f8fafc; }
                            .bg-slate-100 { background: #f1f5f9; }
                            .bg-red-100 { background: #fee2e2; }
                            .bg-emerald-100 { background: #d1fae5; }
                            .text-slate-900 { color: #0f172a; }
                            .text-slate-800 { color: #1e293b; }
                            .text-slate-700 { color: #334155; }
                            .text-slate-600 { color: #475569; }
                            .text-slate-500 { color: #64748b; }
                            .text-red-600, .text-red-500 { color: #dc2626; }
                            .text-emerald-600, .text-emerald-500 { color: #059669; }
                            .rounded-lg { border-radius: 0.5rem; }
                            .rounded-xl { border-radius: 0.75rem; }
                            .rounded-2xl { border-radius: 1rem; }
                            .border { border: 1px solid #e2e8f0; }
                            .border-b { border-bottom: 1px solid #e2e8f0; }
                            .border-b-2 { border-bottom: 2px solid #f1f5f9; }
                            .border-b-\\[3px\\] { border-bottom: 3px solid #e2e8f0; }
                            .border-slate-100 { border-color: #f1f5f9; }
                            .border-slate-200 { border-color: #e2e8f0; }
                            table { width: 100%; border-collapse: collapse; }
                            @media print {
                                @page { size: A4 portrait; margin: 20mm; }
                                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                            }
                        </style>
                    </head>
                    <body class="bg-white">
                        <div class="max-w-4xl mx-auto pt-8">
                            ${printContent}
                        </div>
                        <script>
                            window.onload = () => {
                                setTimeout(() => {
                                    window.print();
                                    // window.close() let the user close it manually after saving or printing
                                }, 800);
                            };
                        </script>
                    </body>
                </html>
            `);
            printWindow.document.close();
        } catch (error) {
            console.error('PDF Generation Error:', error);
        } finally {
            setPrinting(false);
        }
    };

    const formatMoneyLocal = (val) => formatMoney(val, 'USD');
    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {/* Hidden PDF Template Pipeline */}
            {isOpen && (
                <div className="absolute -left-[9999px] top-0 opacity-0 pointer-events-none">
                    <div ref={pdfRef} className="w-[800px] p-12 bg-white text-slate-800 font-sans">
                        {/* Header */}
                        <div className="flex justify-between items-start border-b-[3px] border-slate-200 pb-6 mb-8">
                            <div>
                                <h1 className="text-3xl font-black uppercase text-slate-900 tracking-tighter">{user?.companyName || 'Isaac POS'}</h1>
                                <div className="mt-2 inline-block px-3 py-1 bg-slate-100 rounded-lg">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Estado de Cuenta Oficial</p>
                                </div>
                                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-2 uppercase tracking-widest">Generado: {new Date().toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                                <h2 className="text-xl font-black uppercase text-slate-800">{customerInfo?.name || 'Cliente'}</h2>
                                <p className="text-xs font-bold text-slate-500 mt-1">DOC: {customerInfo?.document || customerInfo?.rif || 'N/A'}</p>
                                {customerInfo?.phone && <p className="text-xs font-bold text-slate-500 mt-1">TEL: {customerInfo.phone}</p>}
                            </div>
                        </div>

                        {/* Summary */}
                        <div className="flex gap-4 mb-10">
                            <div className="flex-1 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                <p className="text-[10px] uppercase font-black text-slate-500 dark:text-slate-400 tracking-widest">Total Deuda Actual</p>
                                <p className={`text-3xl font-black tracking-tighter mt-1 ${customerInfo?.creditBalance > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                    {customerInfo ? formatMoneyLocal(customerInfo.creditBalance) : '$0.00'}
                                </p>
                            </div>
                            <div className="flex-1 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                <p className="text-[10px] uppercase font-black text-slate-500 dark:text-slate-400 tracking-widest">Límite Aprobado</p>
                                <p className="text-3xl font-black tracking-tighter text-slate-700 mt-1">
                                    {customerInfo ? formatMoneyLocal(customerInfo.creditLimit) : '$0.00'}
                                </p>
                            </div>
                            <div className="flex-1 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                <p className="text-[10px] uppercase font-black text-slate-500 dark:text-slate-400 tracking-widest">Estado de Morosidad</p>
                                <p className={`text-xl font-black mt-2 uppercase tracking-widest px-3 py-1 inline-block rounded-xl ${customerInfo?.creditBalance > customerInfo?.creditLimit ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                    {customerInfo?.creditBalance > customerInfo?.creditLimit ? 'Excedido' : 'Al Día'}
                                </p>
                            </div>
                        </div>

                        {/* Transactions Table */}
                        <div className="mb-4">
                            <h3 className="text-xs font-black uppercase tracking-widest text-slate-800 mb-4 border-b-2 border-slate-100 pb-2">Historial de Movimientos</h3>
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="text-[10px] uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200">
                                        <th className="py-3 font-black tracking-widest">Fecha</th>
                                        <th className="py-3 font-black tracking-widest">Concepto</th>
                                        <th className="py-3 font-black tracking-widest text-right">Monto</th>
                                        <th className="py-3 font-black tracking-widest text-right">Saldo Final</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map((entry, idx) => (
                                        <tr key={entry.id || idx} className="border-b border-slate-100">
                                            <td className="py-4 font-medium text-slate-600 text-xs uppercase tracking-wider">{formatDate(entry.timestamp)}</td>
                                            <td className="py-4">
                                                <span className="font-black text-slate-800 text-xs uppercase tracking-tight">
                                                    {entry.type === 'payment' ? 'Abono Registrado' : (entry.saleId ? `Cargo por Venta #${entry.saleId}` : entry.description || 'Cargo / Ajuste')}
                                                </span>
                                                {entry.paymentMethod && <span className="ml-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">({entry.paymentMethod})</span>}
                                            </td>
                                            <td className={`py-4 font-black text-right text-sm ${entry.type === 'payment' ? 'text-emerald-500' : 'text-red-500'}`}>
                                                {entry.type === 'payment' ? 'Abono ' : 'Cargo '}{formatMoneyLocal(entry.amount)}
                                            </td>
                                            <td className="py-4 font-black text-slate-800 text-right text-sm">{formatMoneyLocal(entry.balanceAfter)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        
                        <div className="mt-12 text-center text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">
                            -- Fin del Estado de Cuenta --
                        </div>
                    </div>
                </div>
            )}
            
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                maxWidth="max-w-4xl"
                className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90dvh] pb-safe"
            >
                        {/* Header */}
                        <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900/50 shrink-0">
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="p-2.5 sm:p-3 bg-violet-500/10 rounded-xl shrink-0">
                                    <History size={24} className="text-violet-600 dark:text-violet-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white uppercase tracking-tight">Historial de Crédito</h2>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">
                                        {customerInfo?.name || 'Cargando...'}
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Summary bar */}
                        {customerInfo && (
                            <div className="px-4 sm:px-8 py-3 sm:py-4 bg-slate-50 dark:bg-slate-900/40 grid grid-cols-2 gap-3 sm:gap-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
                                <div className="bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider block">Límite Permitido</span>
                                    <p className="text-base sm:text-lg font-bold text-slate-700 dark:text-slate-200">{formatMoneyLocal(customerInfo.creditLimit)}</p>
                                </div>
                                <div className="bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider block">Deuda Actual</span>
                                    <p className={`text-base sm:text-lg font-bold ${customerInfo.creditBalance > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                        {formatMoneyLocal(customerInfo.creditBalance)}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-60">
                                    <div className="w-10 h-10 border-[3px] border-violet-500/30 border-t-violet-500 rounded-full animate-spin"></div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cargando transacciones...</span>
                                </div>
                            ) : history.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-xl">
                                        <Calendar size={36} className="text-slate-500 dark:text-slate-400" />
                                    </div>
                                    <div className="text-center">
                                        <h3 className="font-bold text-sm uppercase tracking-tight text-slate-700 dark:text-slate-300">Sin historial</h3>
                                        <p className="text-xs text-slate-500 mt-1">Este cliente no posee movimientos registrados.</p>
                                    </div>
                                </div>
                            ) : (
                                history.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-3 rounded-xl flex-shrink-0 ${entry.type === 'payment'
                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                                }`}>
                                                {entry.type === 'payment' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-black text-slate-800 dark:text-slate-100 tracking-tight">
                                                        {entry.type === 'payment' ? 'Abono / Pago' : (entry.saleId ? 'Cargo (Venta)' : 'Ajuste / Cargo')}
                                                    </span>
                                                    <span className="text-[9px] text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                                                        {entry.paymentMethod || 'Sistema'}
                                                    </span>
                                                    {entry.saleId && (
                                                        <button
                                                            onClick={() => onViewReceipt(entry.saleId)}
                                                            className="flex items-center gap-1.5 px-2 py-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-full text-[9px] font-black uppercase tracking-widest transition-all hover:bg-primary-100"
                                                        >
                                                            <FileText size={11} /> Ver Recibo
                                                        </button>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                    <Calendar size={11} /> {formatDate(entry.timestamp)}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-3 sm:mt-0 text-right">
                                            <p className={`text-lg font-black ${entry.type === 'payment' ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {entry.type === 'payment' ? '-' : '+'} {formatMoneyLocal(entry.amount)}
                                            </p>
                                            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tighter">
                                                Saldo: <span className="text-slate-600 dark:text-slate-300">{formatMoneyLocal(entry.balanceAfter)}</span>
                                            </p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-4 sm:px-8 py-3.5 sm:py-5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 shrink-0">
                            <button onClick={onClose} className="min-h-[44px] px-6 py-2.5 sm:py-3.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center">
                                Cerrar
                            </button>
                            
                            {customerInfo && (
                                <button 
                                    onClick={generatePDF} 
                                    disabled={printing || loading || history.length === 0}
                                    className="min-h-[44px] px-6 py-2.5 sm:py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                                >
                                    {printing ? <div className="w-3.5 h-3.5 border-2 border-emerald-300 border-t-white rounded-full animate-spin"></div> : <Download size={14} />}
                                    {printing ? 'Generando PDF...' : 'Estado de Cuenta'}
                                </button>
                            )}

                            <button onClick={fetchHistory} className="min-h-[44px] px-6 py-2.5 sm:py-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-violet-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer">
                                <RefreshCcw size={14} /> Actualizar
                            </button>
                        </div>
            </BaseModal>
        </AnimatePresence>
    );
}
