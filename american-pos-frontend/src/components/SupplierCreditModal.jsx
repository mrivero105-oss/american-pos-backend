import { useState, useEffect } from 'react';
import { X, History, CreditCard, DollarSign, Calendar, Info, ArrowUpCircle, ArrowDownCircle, Eye, FileText, FilePlus, TrendingUp, Banknote, CheckCircle2, RefreshCw, Edit2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import api from '../services/api';
import toast from 'react-hot-toast';
import { formatMoney, fetchGlobalSettings, isDollarOnlyCountry } from '../utils/format';
import BaseModal from './BaseModal';
import InvoiceViewerModal from './InvoiceViewerModal';
import RegisterSupplierInvoiceModal from './RegisterSupplierInvoiceModal';

export default function SupplierCreditModal({ isOpen, onClose, supplier, onUpdate }) {
    const effectiveCountry = localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);

    const [supplierData, setSupplierData] = useState(supplier);
    const [history, setHistory] = useState([]);
    const [pendingInvoices, setPendingInvoices] = useState([]);
    const [paidInvoices, setPaidInvoices] = useState([]);
    const [viewFilter, setViewFilter] = useState('PENDING'); // 'PENDING' | 'ALL'
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    const [paymentCurrency, setPaymentCurrency] = useState('USD'); // 'USD' | 'VES'
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentDescription, setPaymentDescription] = useState('');
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().substring(0, 10));
    const [customRate, setCustomRate] = useState('');
    const [isEditingRate, setIsEditingRate] = useState(false);
    const [bcvLoading, setBcvLoading] = useState(false);
    const [bcvVerified, setBcvVerified] = useState(false);
    const [bcvSource, setBcvSource] = useState('');
    const [bcvDate, setBcvDate] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [viewerInvoice, setViewerInvoice] = useState({ isOpen: false, url: '', details: {} });
    const [isRegisterInvoiceOpen, setIsRegisterInvoiceOpen] = useState(false);
    const [mobileTab, setMobileTab] = useState('invoices'); // 'invoices' | 'payment'

    useEffect(() => {
        fetchGlobalSettings().then(s => {
            setSettings(s);
            if (s.rate && !customRate) setCustomRate(s.rate);
        });
    }, []);

    useEffect(() => {
        if (isOpen && supplier) {
            setSupplierData(supplier);
            setMobileTab('invoices');
            fetchHistory();
            if (!isDollarCountry) {
                verifyBCVRate(paymentDate);
            }
        }
    }, [isOpen, supplier?.id, isDollarCountry]);

    if (!isOpen || !supplier) return null;

    const activeRate = Number(customRate) > 0 ? Number(customRate) : Number(settings.rate || 1);

    const verifyBCVRate = async (targetDate) => {
        if (isDollarCountry) return;
        try {
            setBcvLoading(true);
            const dateToQuery = targetDate || paymentDate || new Date().toISOString().substring(0, 10);
            const res = await api.get('/suppliers/bcv-rate', {
                params: { date: dateToQuery }
            });
            if (res.data && res.data.rate > 0) {
                const officialRate = Number(res.data.rate);
                setCustomRate(officialRate);
                setBcvVerified(true);
                setBcvSource(res.data.source || 'BCV Oficial');
                setBcvDate(res.data.date || dateToQuery);
                toast.success(`Tasa BCV oficial verificada para ${res.data.date || dateToQuery}: ${officialRate.toFixed(4)} Bs/$`, { id: 'bcv-sync' });
            }
        } catch (error) {
            console.error('Error verificando tasa BCV:', error);
            if (settings.rate) {
                setCustomRate(settings.rate);
            }
            toast.error('No se pudo conectar en vivo con el BCV, usando tasa configurada');
        } finally {
            setBcvLoading(false);
        }
    };

    const fetchHistory = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/suppliers/${supplier.id}/credit-history`);
            if (res.data.supplier) {
                setSupplierData(res.data.supplier);
            }
            setHistory(res.data.history || []);
            setPendingInvoices(res.data.pendingInvoices || []);
            setPaidInvoices(res.data.paidInvoices || []);
        } catch (error) {
            console.error('Error fetching supplier history:', error);
            toast.error('Error al cargar historial');
        } finally {
            setLoading(false);
        }
    };

    const handleFillTotal = () => {
        const debtUsd = Number(supplierData?.creditBalance || 0);
        if (paymentCurrency === 'USD') {
            setPaymentAmount(debtUsd.toFixed(2));
        } else {
            setPaymentAmount((debtUsd * activeRate).toFixed(2));
        }
    };

    const handleSelectInvoiceToPay = (inv) => {
        const remainingUsd = Number(inv.balanceRemaining || inv.amount || 0);
        const refNo = inv.orderReference || inv.referenceNumber || inv.description || 'S/N';
        if (paymentCurrency === 'USD') {
            setPaymentAmount(remainingUsd.toFixed(2));
        } else {
            setPaymentAmount((remainingUsd * activeRate).toFixed(2));
        }
        setPaymentDescription(`Pago Factura #${refNo}`);
        setMobileTab('payment');
        toast.success(`Monto de Factura #${refNo} cargado al formulario`);
    };

    const handlePayment = async (e) => {
        e.preventDefault();
        const numVal = parseFloat(paymentAmount);
        if (!numVal || numVal <= 0) {
            return toast.error('Ingrese un monto válido');
        }

        try {
            setIsSubmitting(true);
            await api.post(`/suppliers/${supplier.id}/payment`, {
                amount: numVal,
                currency: paymentCurrency,
                exchangeRate: activeRate,
                paymentDate: paymentDate,
                description: paymentDescription ? `${paymentDescription} (Tasa BCV: ${activeRate.toFixed(4)} Bs/$)` : `Pago según Tasa BCV ${activeRate.toFixed(4)} Bs/$ (${paymentDate})`,
                method: paymentCurrency === 'VES' ? 'transfer' : 'cash'
            });
            toast.success('Pago liquidado y registrado correctamente');
            setPaymentAmount('');
            setPaymentDescription('');
            fetchHistory();
            setMobileTab('invoices');
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Error registering payment:', error);
            toast.error('Error al registrar pago');
        } finally {
            setIsSubmitting(false);
        }
    };

    const displayList = viewFilter === 'PENDING' ? pendingInvoices : history;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-5xl"
            className="flex flex-col h-[92dvh] sm:h-[85vh] max-h-[92dvh] pb-safe border border-slate-200 dark:border-white/10 overflow-hidden"
        >
            {/* Header */}
            <div className="relative px-3 sm:px-10 py-3 sm:py-8 flex justify-between items-center group overflow-hidden shrink-0 border-b border-slate-100 dark:border-white/5">
                <div className="absolute inset-0 bg-gradient-to-r from-amber-600/10 to-transparent dark:from-amber-400/5 pointer-events-none" />
                <div className="relative flex items-center gap-2.5 sm:gap-5 min-w-0">
                    <div className="p-2 sm:p-3.5 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl shadow-xs shrink-0">
                        <History size={20} className="sm:w-6 sm:h-6" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase truncate">Estado de Cuenta</h2>
                        <p className="text-[9px] sm:text-[10px] font-black text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wider truncate max-w-[160px] sm:max-w-lg">
                            Alianza Comercial: {supplier?.name}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={() => setIsRegisterInvoiceOpen(true)}
                        className="flex items-center gap-1 min-h-[40px] sm:min-h-[36px] px-2.5 sm:px-4 py-1.5 sm:py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg sm:rounded-xl font-black text-[9px] uppercase tracking-wider shadow-md shadow-amber-500/20 transition-all active:scale-95 cursor-pointer"
                    >
                        <FilePlus size={14} />
                        <span className="hidden xs:inline sm:inline">+ Factura</span>
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 sm:p-3 text-slate-500 dark:text-slate-400 hover:text-red-500 transition-colors cursor-pointer rounded-xl"
                    >
                        <X size={20} className="sm:w-6 sm:h-6" />
                    </button>
                </div>
            </div>

            {/* 📱 Mobile Segmented Tab Switcher (Visible on screens < lg) */}
            <div className="lg:hidden flex items-center border-b border-slate-200 dark:border-white/10 bg-slate-100/90 dark:bg-slate-900/90 p-1.5 gap-1.5 shrink-0 backdrop-blur-md">
                <button
                    type="button"
                    onClick={() => setMobileTab('invoices')}
                    className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        mobileTab === 'invoices'
                            ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                >
                    <History size={16} />
                    <span>Facturas ({pendingInvoices.length})</span>
                </button>
                <button
                    type="button"
                    onClick={() => setMobileTab('payment')}
                    className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        mobileTab === 'payment'
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                >
                    <Banknote size={16} />
                    <span>Abonar / Liquidar</span>
                </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
                {/* Left: Invoices / History List */}
                <div className={`flex-1 flex-col min-h-0 min-w-0 border-r border-slate-100 dark:border-white/5 ${
                    mobileTab === 'invoices' ? 'flex' : 'hidden lg:flex'
                }`}>
                    {/* Filter Tabs & Total Debt */}
                    <div className="px-3 sm:px-6 py-2.5 sm:py-4 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap justify-between items-center gap-2 sm:gap-3 backdrop-blur-sm border-b border-slate-100 dark:border-white/5 shrink-0">
                        <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl">
                            <button
                                type="button"
                                onClick={() => setViewFilter('PENDING')}
                                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${viewFilter === 'PENDING' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                            >
                                <span>Pendientes</span>
                                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${viewFilter === 'PENDING' ? 'bg-black/20 text-white' : 'bg-slate-300 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                                    {pendingInvoices.length}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewFilter('ALL')}
                                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${viewFilter === 'ALL' ? 'bg-slate-800 text-white dark:bg-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                            >
                                <span>Historial</span>
                            </button>
                        </div>

                        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl shadow-sm border border-slate-100 dark:border-white/5">
                            <span className="text-[8.5px] sm:text-[9px] font-black text-slate-400 uppercase tracking-tight">Pasivo:</span>
                            <span className={`text-xs sm:text-sm font-black font-mono tracking-tight ${Number(supplierData?.creditBalance || 0) > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                ${Number(supplierData?.creditBalance || 0).toFixed(2)} USD
                            </span>
                            {Number(supplierData?.creditBalance || 0) > 0 && activeRate > 1 && (
                                <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 font-mono hidden sm:inline">
                                    ≈ Bs. {(Number(supplierData?.creditBalance || 0) * activeRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Movement Items List */}
                    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-6 space-y-3 sm:space-y-4 custom-scrollbar bg-slate-50/20 dark:bg-slate-950/10">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
                                <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-amber-500/30 border-t-amber-500"></div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Consultando Ledger...</span>
                            </div>
                        ) : displayList.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                                <div className="p-4 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20 shadow-sm">
                                    <CheckCircle2 size={36} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider">
                                    {viewFilter === 'PENDING' ? '¡Sin Facturas Pendientes!' : 'Sin Registros'}
                                </h4>
                                <p className="text-xs font-bold text-slate-400 max-w-[280px]">
                                    {viewFilter === 'PENDING' 
                                        ? 'Todas las facturas de este proveedor se encuentran 100% solventes y pagadas.'
                                        : 'No hay transacciones registradas para este proveedor.'}
                                </p>
                            </div>
                        ) : (
                            displayList.map((item, idx) => {
                                const isCharge = item.type === 'charge';
                                const isPaid = item.invoiceStatus === 'PAID' || (isCharge && item.balanceRemaining !== undefined && item.balanceRemaining !== null && Number(item.balanceRemaining) <= 0.005);
                                const isPartial = item.invoiceStatus === 'PARTIAL';
                                const remainingUsd = isCharge ? Number(item.balanceRemaining !== undefined && item.balanceRemaining !== null ? item.balanceRemaining : (isPaid ? 0 : item.amount)) : 0;
                                const originalUsd = Number(item.amount || 0);

                                return (
                                    <motion.div 
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.04 }}
                                        key={item.id} 
                                        className={`relative p-5 rounded-xl border transition-colors group overflow-hidden ${
                                            isCharge && !isPaid 
                                                ? 'bg-amber-500/5 dark:bg-amber-500/[0.03] border-amber-500/30 hover:border-amber-500/60 shadow-sm' 
                                                : isCharge && isPaid
                                                ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-80'
                                                : 'bg-emerald-500/5 dark:bg-emerald-500/[0.03] border-emerald-500/20'
                                        }`}
                                    >
                                        <div className="relative z-10 flex justify-between items-start gap-5">
                                            <div className="flex items-start gap-3.5 flex-1 min-w-0">
                                                <div className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center shadow-xs ${
                                                    isCharge && !isPaid
                                                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                                        : isCharge && isPaid
                                                        ? 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                                        : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                                }`}>
                                                    {isCharge && !isPaid ? (
                                                        <AlertCircle size={20} strokeWidth={2.5} />
                                                    ) : isCharge && isPaid ? (
                                                        <CheckCircle2 size={20} strokeWidth={2.5} />
                                                    ) : (
                                                        <ArrowDownCircle size={20} strokeWidth={2.5} />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-black uppercase tracking-tight ${
                                                            isCharge && !isPaid ? 'text-amber-600 dark:text-amber-400' : isCharge && isPaid ? 'text-slate-500 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400'
                                                        }`}>
                                                            {isCharge && !isPaid 
                                                                ? (isPartial ? 'Factura con Pago Parcial' : 'Obligación Pendiente de Pago')
                                                                : isCharge && isPaid 
                                                                ? 'Factura Liquidada / Pagada' 
                                                                : 'Abono / Pago Realizado'}
                                                        </span>
                                                        {isCharge && !isPaid && (
                                                            <span className="text-[9px] font-black uppercase px-2 py-0.2 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 animate-pulse">
                                                                Por Pagar
                                                            </span>
                                                        )}
                                                        {isCharge && isPaid && (
                                                            <span className="text-[9px] font-black uppercase px-2 py-0.2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                                                Solvente
                                                            </span>
                                                        )}
                                                    </div>

                                                    <p className="text-[11px] font-black text-slate-700 dark:text-slate-200 mt-1 line-clamp-2 uppercase tracking-tight">
                                                        {item.description || 'Factura de compra'}
                                                    </p>

                                                    <div className="flex flex-wrap items-center gap-2 mt-3">
                                                        <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                                                            <Calendar size={11} className="opacity-50" /> {item.arrivalDate || (item.timestamp ? item.timestamp.split('T')[0] : 'N/A')}
                                                        </span>
                                                        {item.exchangeRate && Number(item.exchangeRate) > 1 && (
                                                            <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
                                                                Tasa llegada: {Number(item.exchangeRate).toFixed(2)} Bs/$
                                                            </span>
                                                        )}
                                                        {item.dueDate && (
                                                            <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg flex items-center gap-1">
                                                                Vence: {item.dueDate}
                                                            </span>
                                                        )}
                                                        {item.invoiceUrl && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setViewerInvoice({
                                                                    isOpen: true,
                                                                    url: item.invoiceUrl,
                                                                    details: {
                                                                        referenceNumber: item.referenceNumber || item.orderReference || item.purchaseOrderId || 'N/A',
                                                                        supplierName: supplier?.name,
                                                                        date: item.arrivalDate || (item.timestamp ? item.timestamp.split('T')[0] : 'N/A')
                                                                    }
                                                                })}
                                                                className="min-h-[36px] text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 rounded-lg uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105"
                                                            >
                                                                <Eye size={13} />
                                                                <span>Ver Factura Real</span>
                                                            </button>
                                                        )}
                                                        {isCharge && !isPaid && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSelectInvoiceToPay(item)}
                                                                className="min-h-[36px] text-[10px] font-black text-amber-700 dark:text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-3 py-1.5 rounded-lg uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                                                            >
                                                                <CreditCard size={13} />
                                                                <span>Abonar a esta Factura</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right Values */}
                                            <div className="text-right shrink-0">
                                                {isCharge && !isPaid ? (
                                                    <>
                                                        <div className="text-base font-black font-mono text-rose-600 dark:text-rose-400 tracking-tight tabular-nums">
                                                            -${remainingUsd.toFixed(2)} USD
                                                        </div>
                                                        {!isDollarCountry && (
                                                            <>
                                                                <div className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                                                                    Bs. {(remainingUsd * activeRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                                                </div>
                                                                <div className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">
                                                                    (Tasa BCV: {activeRate.toFixed(2)})
                                                                </div>
                                                            </>
                                                        )}
                                                    </>
                                                ) : isCharge && isPaid ? (
                                                    <>
                                                        <div className="text-sm font-black font-mono text-slate-400 tracking-tight tabular-nums line-through">
                                                            ${originalUsd.toFixed(2)} USD
                                                        </div>
                                                        <div className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 mt-0.5 uppercase">
                                                            $0.00 Pendiente
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400 tracking-tight tabular-nums">
                                                            +${originalUsd.toFixed(2)} USD
                                                        </div>
                                                        {!isDollarCountry && (
                                                            <div className="text-[10px] font-mono font-bold text-emerald-600/70 mt-0.5">
                                                                +Bs. {(originalUsd * (Number(item.exchangeRate) || activeRate)).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })
                        )}
                    </div>

                    {/* 📱 Mobile Sticky Quick-Pay Footer for Invoices View */}
                    <div className="lg:hidden p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 flex items-center justify-between gap-3 shrink-0 shadow-lg">
                        <div className="min-w-0">
                            <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Deuda Pendiente:</span>
                            <span className="text-sm font-black text-rose-500 font-mono">
                                ${Number(supplierData?.creditBalance || 0).toFixed(2)} USD
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => { handleFillTotal(); setMobileTab('payment'); }}
                            className="min-h-[44px] px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                        >
                            <Banknote size={16} />
                            <span>Abonar Saldo</span>
                        </button>
                    </div>
                </div>

                {/* Right: Payment Form */}
                <div className={`w-full lg:w-[430px] p-4 sm:p-8 lg:p-10 bg-white dark:bg-slate-900 lg:dark:bg-slate-950/50 flex-col shrink-0 overflow-y-auto custom-scrollbar ${
                    mobileTab === 'payment' ? 'flex flex-1' : 'hidden lg:flex'
                }`}>
                    <div className="lg:hidden mb-2">
                        <button
                            type="button"
                            onClick={() => setMobileTab('invoices')}
                            className="text-[11px] font-black text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white uppercase tracking-wider flex items-center gap-1 cursor-pointer py-1"
                        >
                            ← Volver a Facturas del Proveedor
                        </button>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                        <div className="p-2.5 sm:p-3 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-2xl shrink-0">
                            <Banknote size={22} className="sm:w-6 sm:h-6" strokeWidth={2.5} />
                        </div>
                        <div>
                            <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">
                                {isDollarCountry ? 'Abonar a Proveedor' : 'Abonar / Liquidar'}
                            </h4>
                            <p className="text-[9.5px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-tight opacity-60 mt-0.5">
                                {isDollarCountry ? 'Registro de Pago Directo en USD' : 'Verificación Oficial con el BCV'}
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handlePayment} className="space-y-5 flex-1">
                        {/* Moneda de Pago */}
                        {!isDollarCountry && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest ml-1">
                                    Moneda de Cancelación
                                </label>
                                <div className="grid grid-cols-2 gap-2 bg-slate-200/60 dark:bg-slate-900 p-1 rounded-2xl">
                                    <button
                                        type="button"
                                        onClick={() => { setPaymentCurrency('USD'); setPaymentAmount(''); }}
                                        className={`min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${paymentCurrency === 'USD' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                    >
                                        <DollarSign size={16} />
                                        <span>Dólares (USD)</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setPaymentCurrency('VES'); setPaymentAmount(''); }}
                                        className={`min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${paymentCurrency === 'VES' ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                    >
                                        <Banknote size={16} />
                                        <span>Bolívares (Bs)</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Tasa BCV del Día de Pago (Verificada en vivo) */}
                        {!isDollarCountry && (
                            <div className="p-3.5 sm:p-4 bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-transparent border border-indigo-500/25 rounded-2xl space-y-3 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <TrendingUp size={16} className="text-indigo-500 shrink-0" />
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                                            Tasa BCV Día de Pago
                                        </span>
                                    </div>
                                    
                                    <button
                                        type="button"
                                        onClick={() => verifyBCVRate(paymentDate)}
                                        disabled={bcvLoading}
                                        className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm shadow-indigo-600/20 active:scale-95"
                                        title="Verificar y sincronizar tasa oficial con el BCV en tiempo real"
                                    >
                                        <RefreshCw size={12} className={bcvLoading ? 'animate-spin' : ''} />
                                        <span>{bcvLoading ? 'Verificando...' : 'Verificar BCV'}</span>
                                    </button>
                                </div>

                                {/* Fecha de Pago & Estado de Verificación */}
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-indigo-500/15 text-[10px]">
                                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-bold">
                                        <Calendar size={13} className="text-indigo-400 shrink-0" />
                                        <span className="text-[9.5px] uppercase">Fecha:</span>
                                        <input
                                            type="date"
                                            value={paymentDate}
                                            onChange={(e) => {
                                                 setPaymentDate(e.target.value);
                                                 verifyBCVRate(e.target.value);
                                            }}
                                            className="min-h-[36px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-base sm:text-[10px] font-mono font-black text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
                                        />
                                    </div>
                                    
                                    {bcvVerified && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                                            <CheckCircle2 size={12} />
                                            <span>Oficial BCV</span>
                                        </span>
                                    )}
                                </div>

                                {/* Visualizador / Editor de la Tasa */}
                                <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-xl border border-indigo-500/20 shadow-inner">
                                    <div>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Tasa Oficial Aplicable</span>
                                        {isEditingRate ? (
                                            <div className="flex items-center gap-1 mt-1">
                                                <span className="text-xs font-mono font-bold text-slate-400">Bs.</span>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    value={customRate}
                                                    onChange={(e) => setCustomRate(e.target.value)}
                                                    onBlur={() => setIsEditingRate(false)}
                                                    autoFocus
                                                    className="w-24 min-h-[36px] px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded font-mono font-black text-base sm:text-sm text-indigo-600 dark:text-indigo-400 outline-none border border-indigo-500"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setIsEditingRate(false)}
                                                    className="min-h-[36px] text-[10px] font-bold text-emerald-600 uppercase px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 rounded cursor-pointer"
                                                >
                                                    OK
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-sm sm:text-base font-black font-mono text-indigo-600 dark:text-indigo-400">
                                                    Bs. {activeRate.toFixed(4)} <span className="text-[10px] font-normal text-slate-400">/ USD</span>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setIsEditingRate(true)}
                                                    className="min-h-[36px] min-w-[36px] flex items-center justify-center p-1 text-slate-400 hover:text-indigo-500 transition-colors cursor-pointer"
                                                    title="Modificar tasa manualmente si aplica otra tasa pactada"
                                                >
                                                    <Edit2 size={13} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {supplierData?.creditBalance > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleFillTotal}
                                            className="min-h-[36px] px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-md shadow-indigo-600/30"
                                        >
                                            Pagar Todo
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Campo Monto */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center ml-1">
                                <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                    Monto a Transferir ({paymentCurrency === 'USD' ? '$' : 'Bs.'}) *
                                </label>
                            </div>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                    <span className="text-xl font-black text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                                        {paymentCurrency === 'USD' ? '$' : 'Bs.'}
                                    </span>
                                </div>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full min-h-[52px] pl-16 pr-5 py-3 sm:py-4 border-none bg-white dark:bg-slate-900 rounded-2xl text-xl sm:text-2xl font-black text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-slate-700 focus:ring-4 focus:ring-emerald-500/20 transition-all shadow-inner tabular-nums outline-none"
                                    required
                                />
                            </div>

                            {/* Equivalencia en Vivo */}
                            {!isDollarCountry && parseFloat(paymentAmount) > 0 && (
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl animate-in fade-in duration-300">
                                    {paymentCurrency === 'USD' ? (
                                        <div className="text-center">
                                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Monto en Bolívares a transferir al proveedor:</span>
                                            <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                                                Bs. {(parseFloat(paymentAmount) * activeRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                            </span>
                                            <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                                                (Calculado a tasa BCV: {activeRate.toFixed(4)} Bs/$)
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="text-center">
                                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Deducción de la deuda en USD:</span>
                                            <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                                                ${(parseFloat(paymentAmount) / activeRate).toFixed(2)} USD
                                            </span>
                                            <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                                                (Calculado a tasa BCV: {activeRate.toFixed(4)} Bs/$)
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Justificativo / Referencia */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest ml-1">
                                {isDollarCountry ? 'Referencia / Detalle del Pago' : 'Referencia Bancaria / Justificativo'}
                            </label>
                            <textarea
                                value={paymentDescription}
                                onChange={(e) => setPaymentDescription(e.target.value)}
                                placeholder={isDollarCountry ? "N° TRANSFERENCIA, CHEQUE O NOTA..." : "N° TRANSFERENCIA, PAGO MÓVIL O NOTA..."}
                                rows="3"
                                className="w-full px-4 sm:px-5 py-3 sm:py-4 bg-white dark:bg-slate-900 border-none rounded-2xl text-base sm:text-[10px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider focus:ring-4 focus:ring-emerald-500/20 transition-all shadow-inner resize-none leading-relaxed placeholder-slate-300 dark:placeholder-slate-700 outline-none"
                            />
                        </div>

                        <motion.button
                            whileHover={{ scale: 1.01, y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            type="submit"
                            disabled={isSubmitting || !paymentAmount}
                            className="relative w-full min-h-[48px] py-3.5 sm:py-4.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-emerald-600/20 transition-all flex items-center justify-center gap-3 group/btn overflow-hidden cursor-pointer"
                        >
                            {isSubmitting ? (
                                <div className="h-5 w-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <CreditCard size={18} strokeWidth={2.5} />
                                    <span>Confirmar Pago al Proveedor</span>
                                </>
                            )}
                        </motion.button>
                    </form>

                    {!isDollarCountry && (
                        <div className="mt-5 p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-200/50 dark:border-amber-900/20 relative overflow-hidden group">
                            <div className="relative z-10 flex items-start gap-3 text-amber-800 dark:text-amber-400">
                                <Info size={15} className="shrink-0 mt-0.5 opacity-80" />
                                <p className="text-[9px] font-bold uppercase tracking-wider leading-relaxed">
                                    Según la práctica comercial venezolana, los pagos en Bs. amortizan la obligación en divisas calculada a la tasa oficial del día de la transferencia.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal Visor de Factura Real */}
            <InvoiceViewerModal
                isOpen={viewerInvoice.isOpen}
                onClose={() => setViewerInvoice(prev => ({ ...prev, isOpen: false }))}
                imageUrl={viewerInvoice.url}
                title="Factura Real del Proveedor"
                invoiceDetails={viewerInvoice.details}
            />

            {/* Modal Registro de Factura */}
            <RegisterSupplierInvoiceModal
                isOpen={isRegisterInvoiceOpen}
                onClose={() => setIsRegisterInvoiceOpen(false)}
                onSuccess={() => {
                    fetchHistory();
                    if (onUpdate) onUpdate();
                }}
                defaultSupplier={supplier}
            />
        </BaseModal>
    );
}
