import { useState, useEffect } from 'react';
import api from '../services/api';
import { Search, Eye, CheckCircle2, X, FileText, Trash2, Printer } from 'lucide-react';
import { formatMoney, fetchGlobalSettings, formatDate as formatDateSafe, formatStock } from '../utils/format';
import ReceiptModal from '../components/ReceiptModal';
import ActionDialog from '../components/ActionDialog';
import toast from 'react-hot-toast';

export default function DeliveryNotes() {
    const [notes, setNotes] = useState([]);
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    const [businessSettings, setBusinessSettings] = useState({});
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [processing, setProcessing] = useState(false);

    // Modal state
    const [selectedNote, setSelectedNote] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);

    // Action Dialog state
    const [actionDialog, setActionDialog] = useState({ isOpen: false, type: '', data: null });

    useEffect(() => {
        fetchNotes();
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

    const fetchNotes = async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/delivery-notes');
            setNotes(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching delivery notes:', error);
            toast.error('Error al cargar albaranes');
        } finally {
            setLoading(false);
        }
    };

    const handleViewDetails = (note) => {
        setSelectedNote(note);
        setIsModalOpen(true);
    };

    const handlePrint = (note) => {
        setSelectedNote(note);
        setIsReceiptModalOpen(true);
    };

    const handleConvert = (id) => {
        setActionDialog({
            isOpen: true,
            type: 'CONVERT_NOTE',
            data: { id }
        });
    };

    const confirmConvert = async (id) => {
        try {
            setProcessing(true);
            const { data } = await api.put(`/delivery-notes/${id}/convert`);
            toast.success(data.message || 'Albarán convertido con éxito');
            fetchNotes(); // Refresh list
            setIsModalOpen(false);
            setActionDialog({ isOpen: false, type: '', data: null });
        } catch (error) {
            console.error('Error converting note:', error);
            toast.error(error.response?.data?.error || 'Error al convertir albarán');
        } finally {
            setProcessing(false);
        }
    };

    const handleCancel = (id) => {
        setActionDialog({
            isOpen: true,
            type: 'CANCEL_NOTE',
            data: { id }
        });
    };

    const confirmCancel = async (id) => {
        try {
            setProcessing(true);
            await api.delete(`/delivery-notes/${id}`);
            toast.success('Nota de entrega anulada correctamente');
            fetchNotes();
            setIsModalOpen(false);
            setActionDialog({ isOpen: false, type: '', data: null });
        } catch (error) {
            console.error('Error cancelling note:', error);
            toast.error('Error al anular albarán');
        } finally {
            setProcessing(false);
        }
    };

    const filteredNotes = (notes || []).filter(n => {
        const term = searchTerm.toLowerCase();
        return (n.customerName || '').toLowerCase().includes(term) ||
            (n.id || '').toLowerCase().includes(term);
    });

    const renderFormatMoney = (val) => formatMoney(val, null, settings);

    const formatDateLocal = (dateString) => {
        if (!dateString) return 'N/A';
        return formatDateSafe(dateString, {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div className="flex-1 p-4 sm:p-8 pb-safe">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-3">
                            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
                                <FileText size={24} className="text-amber-600" />
                            </div>
                            Notas de Entrega (Albaranes)
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Gestiona entregas pendientes de facturación.</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                    <div className="relative flex-1">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por cliente o número de nota..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-10 py-2.5 min-h-[44px] border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 text-base sm:text-sm focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 outline-none transition-all shadow-sm"
                        />
                    </div>
                </div>

                {/* Grid/Table */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar [overscroll-behavior-y:auto]">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700">
                                    <th className="px-6 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fecha</th>
                                    <th className="px-6 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nota #</th>
                                    <th className="px-6 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cliente</th>
                                    <th className="px-6 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Total</th>
                                    <th className="px-6 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {loading ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                                        </td>
                                    </tr>
                                ) : filteredNotes.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4 text-slate-500 dark:text-slate-400">
                                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-full">
                                                    <FileText size={48} className="opacity-20" />
                                                </div>
                                                <div>
                                                    <p className="text-lg font-bold text-slate-600 dark:text-slate-400">No hay notas de entrega</p>
                                                    <p className="text-sm">Las notas que generes en el POS aparecerán aquí.</p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredNotes.map((note) => (
                                        <tr key={note.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800 dark:bg-slate-800/50 transition-colors group">
                                            <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{formatDateLocal(note.date)}</td>
                                            <td className="px-6 py-4 text-sm font-mono text-slate-700 dark:text-slate-300">{note.id.split('-')[0]}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-800 dark:text-slate-200">{note.customerName || 'Cliente Ocasional'}</td>
                                            <td className="px-6 py-4 text-sm font-black text-slate-800 dark:text-white text-right">{renderFormatMoney(note.total)}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => handleConvert(note.id)}
                                                        className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-xl transition-colors cursor-pointer"
                                                        title="Convertir a Factura"
                                                    >
                                                        <CheckCircle2 size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleViewDetails(note)}
                                                        className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-xl transition-colors cursor-pointer"
                                                        title="Ver detalles"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handlePrint(note)}
                                                        className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors cursor-pointer"
                                                        title="Imprimir"
                                                    >
                                                        <Printer size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleCancel(note.id)}
                                                        className="w-9 h-9 min-w-[36px] min-h-[36px] sm:w-10 sm:h-10 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer"
                                                        title="Anular Albarán"
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

            </div>

            {/* Modal de Detalle */}
            {isModalOpen && selectedNote && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white dark:bg-slate-900/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90dvh] border dark:border-slate-700 pb-safe">
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800 shrink-0">
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Detalles de Nota de Entrega</h2>
                            <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400 cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Cliente</p>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{selectedNote.customerName}</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Fecha</p>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatDateLocal(selectedNote.date)}</p>
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
                                        {(selectedNote.SaleItems || []).map((item, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/30 dark:hover:bg-slate-800 dark:bg-slate-800/30">
                                                <td className="py-2 px-4 font-medium">{item.name}</td>
                                                <td className="py-2 px-4 text-center font-bold">{formatStock(item.quantity)}</td>
                                                <td className="py-2 px-4 text-right">{renderFormatMoney(item.price)}</td>
                                                <td className="py-2 px-4 text-right font-black text-slate-900 dark:text-white">{renderFormatMoney(item.subtotal)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex justify-end pt-4 border-t dark:border-slate-700">
                                <div className="text-right">
                                    <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-widest">TOTAL ALBARÁN</p>
                                    <p className="text-3xl font-black text-primary-600 dark:text-primary-500">{renderFormatMoney(selectedNote.total)}</p>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                            <button
                                onClick={() => handleCancel(selectedNote.id)}
                                disabled={processing}
                                className="min-h-[48px] px-5 py-2.5 font-bold text-red-600 bg-red-50 dark:bg-red-500/10 rounded-xl hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center"
                            >
                                Anular Nota
                            </button>
                            <button
                                onClick={() => handleConvert(selectedNote.id)}
                                disabled={processing}
                                className="min-h-[48px] px-5 py-2.5 font-bold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center"
                            >
                                {processing ? 'Procesando...' : 'Confirmar Venta'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ReceiptModal
                isOpen={isReceiptModalOpen}
                onClose={() => setIsReceiptModalOpen(false)}
                sale={selectedNote}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
                currencyMode={settings.currencyMode}
                paymentMethods={paymentMethods}
            />

            <ActionDialog
                isOpen={actionDialog.isOpen}
                onClose={() => setActionDialog({ isOpen: false, type: '', data: null })}
                type={actionDialog.type}
                data={actionDialog.data}
                exchangeRate={settings.rate}
                currencyMode={settings.currencyMode}
                onSubmit={() => {
                    if (actionDialog.type === 'CONVERT_NOTE') {
                        confirmConvert(actionDialog.data.id);
                    } else if (actionDialog.type === 'CANCEL_NOTE') {
                        confirmCancel(actionDialog.data.id);
                    }
                }}
            />
        </div>
    );
}
