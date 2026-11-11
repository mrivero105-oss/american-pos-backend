import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { FileText, Plus, Search, Trash2, ExternalLink, Calendar, CheckCircle, Clock, Eye, Printer, X } from 'lucide-react';
import { formatMoney, fetchGlobalSettings, formatStock } from '../utils/format';
import ConfirmModal from '../components/ConfirmModal';
import ReceiptModal from '../components/ReceiptModal';

export default function Quotations() {
    const navigate = useNavigate();
    const [quotations, setQuotations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [confirmConfig, setConfirmConfig] = useState({ isOpen: false });

    // Detail & Print states
    const [selectedQuote, setSelectedQuote] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    const [businessSettings, setBusinessSettings] = useState({});
    const [paymentMethods, setPaymentMethods] = useState([]);

    useEffect(() => {
        fetchQuotations();
        fetchBusinessSettings();
        fetchSettings();
        fetchPaymentMethods();
    }, []);

    const fetchBusinessSettings = async () => {
        try {
            const res = await api.get('/settings/business');
            setBusinessSettings(res.data || {});
        } catch (e) { console.error('Error fetching settings', e); }
    };

    const fetchSettings = async () => {
        const s = await fetchGlobalSettings();
        setSettings(s);
    };

    const fetchPaymentMethods = async () => {
        try {
            const { data } = await api.get('/settings/payment-methods');
            setPaymentMethods(data || []);
        } catch (e) { console.error('Error fetching payment methods:', e); }
    };

    const fetchQuotations = async () => {
        try {
            setLoading(true);
            const res = await api.get('/quotations');
            setQuotations(res.data);
        } catch (error) {
            console.error('Error fetching quotations:', error);
            toast.error('Error al cargar cotizaciones');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = (id) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Cotización',
            message: '¿Está seguro de eliminar esta cotización?',
            variant: 'danger',
            confirmText: 'Eliminar',
            action: async () => {
                try {
                    await api.delete(`/quotations/${id}`);
                    toast.success('Cotización eliminada');
                    fetchQuotations();
                } catch (_error) {
                    toast.error('Error al eliminar');
                }
            }
        });
    };

    const handleConvertToSale = (quote) => {
        // We'll pass the quote data to POS via state or localStorage
        // For a seamless experience, we'll use navigation state
        navigate('/pos', { state: { fromQuote: quote } });
    };

    const handleViewDetails = (quote) => {
        setSelectedQuote(quote);
        setIsModalOpen(true);
    };

    const handlePrint = (quote) => {
        // Enforce documentType as cotizacion for proper formatting in ReceiptModal
        setSelectedQuote({
            ...quote,
            documentType: 'cotizacion'
        });
        setIsReceiptModalOpen(true);
    };

    const filtered = (Array.isArray(quotations) ? quotations : []).filter(q =>
        q.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.customerDocument?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.id.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6 pb-safe">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <FileText size={28} className="text-primary-600" /> Cotizaciones / Presupuestos
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Gestione presupuestos para sus clientes antes de la venta.</p>
                </div>
                <button
                    onClick={() => navigate('/pos')}
                    className="min-h-[44px] flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl font-semibold shadow-sm shadow-primary-500/30 transition-all cursor-pointer"
                >
                    <Plus size={18} /> Nueva Cotización
                </button>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-4 justify-between items-center">
                    <div className="relative w-full sm:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por cliente o folio..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 min-h-[44px] border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-base sm:text-sm outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto custom-scrollbar [overscroll-behavior-y:auto]">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-100 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4">Folio / Fecha</th>
                                <th className="px-6 py-4">Cliente</th>
                                <th className="px-6 py-4">Total</th>
                                <th className="px-6 py-4">Estado</th>
                                <th className="px-6 py-4 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center">
                                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                                    </td>
                                </tr>
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-slate-500">No se encontraron cotizaciones.</td>
                                </tr>
                            ) : (
                                Array.isArray(filtered) && filtered.map(quote => (
                                    <tr key={quote.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/50 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-slate-800 dark:text-white uppercase">#{quote.id.slice(-6)}</span>
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
                                                    <Calendar size={10} /> {new Date(quote.date).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-700 dark:text-slate-200">
                                            <div className="font-medium">{quote.customerName || 'Cliente General'}</div>
                                            {quote.customerDocument && (
                                                <div className="text-[10px] text-slate-500 font-medium">{quote.customerDocument}</div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                                            {formatMoney(quote.total)}
                                        </td>
                                        <td className="px-6 py-4">
                                            {quote.status === 'converted' ? (
                                                <span className="px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 w-fit">
                                                    <CheckCircle size={10} /> Vendida
                                                </span>
                                            ) : (
                                                <span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 w-fit">
                                                    <Clock size={10} /> Pendiente
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleConvertToSale(quote)}
                                                    className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors cursor-pointer"
                                                    title="Convertir a Venta"
                                                >
                                                    <ExternalLink size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleViewDetails(quote)}
                                                    className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors cursor-pointer"
                                                    title="Ver Detalles"
                                                >
                                                    <Eye size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handlePrint(quote)}
                                                    className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900/20 rounded-lg transition-colors cursor-pointer"
                                                    title="Imprimir Cotización"
                                                >
                                                    <Printer size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(quote.id)}
                                                    className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal de Detalle */}
            {isModalOpen && selectedQuote && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white dark:bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90dvh] border dark:border-slate-700 animate-in zoom-in-95 duration-300 pb-safe">
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800 shrink-0">
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Detalles de Cotización</h2>
                            <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400 cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Cliente</p>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{selectedQuote.customerName || 'Cliente General'}</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Fecha</p>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{new Date(selectedQuote.date).toLocaleString()}</p>
                                </div>
                            </div>

                            <div className="overflow-x-auto no-scrollbar">
                                <table className="w-full text-left text-sm min-w-[400px]">
                                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                                        <tr>
                                            <th className="py-2 px-4 font-bold uppercase text-[10px]">Producto</th>
                                            <th className="py-2 px-4 text-center font-bold uppercase text-[10px]">Cant</th>
                                            <th className="py-2 px-4 text-right font-bold uppercase text-[10px]">Precio</th>
                                            <th className="py-2 px-4 text-right font-bold uppercase text-[10px]">Subtotal</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                                        {Array.isArray(selectedQuote.items) && selectedQuote.items.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/30 dark:hover:bg-slate-800 dark:bg-slate-800/30">
                                                <td className="py-2 px-4 font-medium">{item.name}</td>
                                                <td className="py-2 px-4 text-center font-bold">{formatStock(item.quantity)}</td>
                                                <td className="py-2 px-4 text-right">{formatMoney(item.price)}</td>
                                                <td className="py-2 px-4 text-right font-black text-slate-900 dark:text-white">{formatMoney(item.subtotal || (item.price * item.quantity))}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {selectedQuote.notes && (
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Notas</p>
                                    <p className="text-sm text-slate-700 dark:text-slate-300">{selectedQuote.notes}</p>
                                </div>
                            )}

                            <div className="flex justify-end pt-4 border-t dark:border-slate-700">
                                <div className="text-right">
                                    <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-widest">TOTAL COTIZADO</p>
                                    <p className="text-3xl font-black text-primary-600 dark:text-primary-500">{formatMoney(selectedQuote.total)}</p>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                            <button
                                onClick={() => handlePrint(selectedQuote)}
                                className="min-h-[48px] px-5 py-2.5 font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-850 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer flex items-center justify-center"
                            >
                                Imprimir Comprobante
                            </button>
                            <button
                                onClick={() => { setIsModalOpen(false); handleConvertToSale(selectedQuote); }}
                                className="min-h-[48px] px-5 py-2.5 font-bold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/20 cursor-pointer flex items-center justify-center"
                            >
                                Convertir a Venta
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ReceiptModal
                isOpen={isReceiptModalOpen}
                onClose={() => setIsReceiptModalOpen(false)}
                sale={selectedQuote}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
                currencyMode={settings.currencyMode}
                paymentMethods={paymentMethods}
            />

            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.action}
                title={confirmConfig.title}
                message={confirmConfig.message}
                variant={confirmConfig.variant}
                confirmText={confirmConfig.confirmText}
            />
        </div>
    );
}
