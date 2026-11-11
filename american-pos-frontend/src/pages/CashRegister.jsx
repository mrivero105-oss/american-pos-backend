import { useState, useEffect } from 'react';
import { 
    Wallet, Lock, Unlock, ArrowDownToLine, ArrowUpFromLine, 
    Calculator, Info, FileText, CheckCircle2, AlertTriangle, User,
    DollarSign, Receipt, CreditCard, Banknote, Printer, Coins,
    Plus, History, RefreshCcw, Zap, ArrowRight, ArrowDownLeft,
    ArrowUpRight, Smartphone, Building2, TrendingUp, Check, Store,
    Clock, Monitor
} from 'lucide-react';
import api from '../services/api';
import { formatMoney as formatCurrency, formatUSD, formatBs, fetchGlobalSettings, getGlobalSettings, isSingleCurrencyMode, isVesOnlyMode, isUsdOnlyMode } from '../utils/format';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/AuthContext';
import { usePos } from '../hooks/PosContext';
import { printOpeningReceipt, printXReportReceipt, printZReportReceipt, printCashMovementReceipt } from '../utils/printCashReceipts';
import SupervisorAuthModal from '../components/SupervisorAuthModal';
import NetworkStatusIndicator from '../components/NetworkStatusIndicator';
import CloseShiftModal from '../components/CloseShiftModal';
import CashShiftDetails from '../components/CashShiftDetails';
import ZReportModal from '../components/ZReportModal';

export default function CashRegister() {
    const { user } = useAuth();
    const { registerId, registerDisplayName } = usePos();
    const [loading, setLoading] = useState(true);
    const [shift, setShift] = useState(null);
    const [isAdmin] = useState(['admin', 'owner', 'superadmin'].includes(user?.role));
    const [settings, setSettings] = useState({ rate: 1, currencyMode: 'BOTH' });
    const [paymentMethods, setPaymentMethods] = useState([]);
    
    // View Tab
    const [activeTab, setActiveTab] = useState('operaciones'); // 'operaciones' | 'corte_x' | 'historial'
    const [xReport, setXReport] = useState(null);
    const [historyShifts, setHistoryShifts] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedHistoryShift, setSelectedHistoryShift] = useState(null);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Opening State
    const [openMode, setOpenMode] = useState('DIRECT'); // 'DIRECT' | 'DENOMINATIONS'
    const [openAmountUsd, setOpenAmountUsd] = useState('');
    const [openAmountBs, setOpenAmountBs] = useState('');
    const [openCashierName, setOpenCashierName] = useState(user?.name || user?.username || '');
    const [openNotes, setOpenNotes] = useState('');
    const [lastClosedShift, setLastClosedShift] = useState(null);
    const [openDenomsUsd, setOpenDenomsUsd] = useState({
        '100': 0, '50': 0, '20': 0, '10': 0, '5': 0, '1': 0,
        '0.50': 0, '0.25': 0, '0.10': 0, '0.05': 0, '0.01': 0,
        looseCoins: 0
    });
    const [printOpeningOnStart, setPrintOpeningOnStart] = useState(false);
    const [kickDrawerOnStart, setKickDrawerOnStart] = useState(false);

    // Movement Modal State
    const [movementModal, setMovementModal] = useState({ show: false, type: 'expense' });
    const [movementForm, setMovementForm] = useState({ 
        amount: '', 
        reason: '', 
        currency: 'USD', 
        paymentMethodId: 'cash', 
        category: 'EXPENSE' 
    });
    const [printMovementVoucher, setPrintMovementVoucher] = useState(true);
    
    // Closure Modal State
    const [closeModal, setCloseModal] = useState(false);
    const [zReportModalOpen, setZReportModalOpen] = useState(false);
    const [closedShiftData, setClosedShiftData] = useState(null);

    const isUsdOnly = isUsdOnlyMode(settings);
    const isVesOnly = isVesOnlyMode(settings);
    const isSingle = isSingleCurrencyMode(settings);

    const loadShift = async (silent = false) => {
        setLoading(true);
        try {
            const res = await api.get('/cash/current', { params: { registerId } });
            setShift(res.data || null);
            if (!silent && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('shift_status_changed', { detail: { isOpen: !!res.data, shift: res.data || null } }));
            }
        } catch (error) {
            console.error('Error fetching shift', error);
            setShift(null);
            if (!silent && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('shift_status_changed', { detail: { isOpen: false, shift: null } }));
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchLastClosedShift = async () => {
        try {
            const { data } = await api.get('/cash/last-closed', { params: { registerId } });
            setLastClosedShift(data || null);
        } catch (e) {
            console.error('Error fetching last closed shift', e);
        }
    };

    const fetchPaymentMethods = async () => {
        try {
            const { data } = await api.get('/settings/payment-methods');
            setPaymentMethods(data || []);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        loadShift();
        fetchLastClosedShift();
        fetchHistory();
        fetchPaymentMethods();
        fetchGlobalSettings().then(res => {
            if (res) setSettings({ ...res });
        });
        const handleShiftChanged = (e) => {
            if (e && e.detail && typeof e.detail.isOpen === 'boolean') {
                if (e.detail.shift !== undefined) {
                    setShift(e.detail.shift || null);
                } else {
                    loadShift(true);
                }
            } else {
                loadShift(true);
            }
        };
        window.addEventListener('shift_status_changed', handleShiftChanged);
        return () => window.removeEventListener('shift_status_changed', handleShiftChanged);
    }, [registerId]);

    useEffect(() => {
        if (activeTab === 'corte_x' && shift) {
            fetchXReport();
        } else if (activeTab === 'historial') {
            fetchHistory();
        }
    }, [activeTab, startDate, endDate]);

    const fetchXReport = async () => {
        try {
            const { data } = await api.get('/cash/x-report', { params: { registerId } });
            setXReport(data);
        } catch (e) {
            console.error('Error fetching x-report', e);
        }
    };

    const fetchHistory = async () => {
        try {
            setHistoryLoading(true);
            const params = { registerId };
            if (startDate && endDate) {
                params.startDate = startDate;
                params.endDate = endDate;
            }
            const { data } = await api.get('/cash/history', { params });
            setHistoryShifts(data || []);
        } catch (e) {
            console.error('Error fetching history', e);
        } finally {
            setHistoryLoading(false);
        }
    };

    const denomsUsdTotal = () => {
        const bills = ['100', '50', '20', '10', '5', '1'].reduce(
            (acc, b) => acc + (Number(b) * (Number(openDenomsUsd[b]) || 0)), 0
        );
        const coins = ['0.50', '0.25', '0.10', '0.05', '0.01'].reduce(
            (acc, c) => acc + (Number(c) * (Number(openDenomsUsd[c]) || 0)), 0
        );
        return Math.round((bills + coins + (Number(openDenomsUsd.looseCoins) || 0)) * 100) / 100;
    };

    const handleApplyLastShiftBalance = () => {
        if (!lastClosedShift) return;
        const finalUsd = Number(lastClosedShift.finalAmount) || 0;
        setOpenMode('DIRECT');
        setOpenAmountUsd(finalUsd > 0 ? String(finalUsd) : '');
        toast.success(`Fondo del turno anterior aplicado ($${finalUsd.toFixed(2)})`);
    };

    const handleKickDrawer = async () => {
        const targetPrinter = localStorage.getItem('pos_station_printer') || settings?.printerName || '';
        if (window.electronAPI) {
            try {
                await window.electronAPI.openDrawer(targetPrinter, settings?.drawerSequence);
                toast.success('Gaveta de dinero abierta');
            } catch (err) {
                console.error("Failed to kick drawer", err);
            }
        } else {
            try {
                await api.post('/settings/open-drawer', {
                    printerName: targetPrinter,
                    sequence: settings?.drawerSequence
                });
                toast.success('Gaveta de dinero abierta');
            } catch (err) {
                console.error("Failed to kick drawer via API", err);
                toast('Gaveta de dinero activada (modo simulación)');
            }
        }
    };

    const handleOpenShift = async (e) => {
        e.preventDefault();
        try {
            let usd = 0;
            let ves = 0;

            if (openMode === 'DENOMINATIONS') {
                usd = denomsUsdTotal();
            } else {
                usd = parseFloat(openAmountUsd) || 0;
                ves = parseFloat(openAmountBs) || 0;
            }

            const rate = Number(settings.rate) || 1;
            const totalBaseUsd = usd + (ves / rate);

            const initialBreakdown = {};
            if (usd > 0) initialBreakdown['cash'] = usd;
            if (ves > 0 && !isSingleCurrencyMode(settings)) initialBreakdown['cash_bs'] = ves;
            if (Object.keys(initialBreakdown).length === 0) {
                initialBreakdown['cash'] = totalBaseUsd;
            }

            const { data } = await api.post('/cash/open', { 
                registerId,
                registerName: registerDisplayName,
                amount: totalBaseUsd, 
                initialBreakdown,
                userName: openCashierName.trim() || user?.name || 'Cajero',
                userId: user?.id,
                notes: openNotes || 'Apertura desde Control de Caja' 
            });

            toast.success('¡Caja abierta exitosamente!');

            if (printOpeningOnStart) {
                printOpeningReceipt({ shift: data, user, settings, kickDrawer: kickDrawerOnStart });
            } else if (kickDrawerOnStart) {
                handleKickDrawer();
            }

            setOpenAmountUsd('');
            setOpenAmountBs('');
            setOpenNotes('');
            loadShift();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al abrir caja');
        }
    };

    const handleMovement = async (e) => {
        e.preventDefault();
        if (!movementForm.amount || Number(movementForm.amount) <= 0) {
            toast.error('Ingresa un monto válido');
            return;
        }
        if (!movementForm.reason.trim()) {
            toast.error('Indica el motivo del movimiento');
            return;
        }

        const cur = (movementForm.currency || 'USD').toUpperCase();
        const finalMethod = (cur === 'VES' || cur === 'BS') ? 'cash_bs' : 'cash';

        try {
            const { data } = await api.post('/cash/movement', {
                ...movementForm,
                amount: Number(movementForm.amount),
                currency: cur,
                paymentMethodId: finalMethod,
                registerId,
                type: movementModal.type
            });

            toast.success('Movimiento registrado');

            if (printMovementVoucher && data.movement) {
                printCashMovementReceipt({
                    movement: data.movement,
                    shift,
                    user,
                    settings,
                    kickDrawer: true
                });
            } else {
                handleKickDrawer();
            }

            setMovementModal({ show: false, type: 'expense' });
            setMovementForm({ amount: '', reason: '', currency: 'USD', paymentMethodId: 'cash', category: 'EXPENSE' });
            loadShift();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error registrando movimiento');
        }
    };

    const handleClosureSuccess = (closedShift) => {
        setCloseModal(false);
        setShift(null);
        setClosedShiftData(closedShift);
        setZReportModalOpen(true);
        toast.success('Turno de caja cerrado e impreso exitosamente');
        loadShift();
        fetchLastClosedShift();
        fetchHistory();
    };

    if (loading && !shift) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <RefreshCcw className="animate-spin text-primary-500" size={40} />
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Cargando Módulo de Caja...</p>
            </div>
        );
    }

    // STATE 1: Shift is Closed -> Opening Screen
    if (!shift) {
        return (
            <div className="max-w-xl mx-auto my-6 px-3 sm:px-4 animate-in fade-in duration-300">
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
                    <div className="text-center mb-6">
                        <div className="w-12 h-12 bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 rounded-lg flex items-center justify-center mx-auto mb-3 border border-primary-200 dark:border-primary-800/40">
                            <Lock size={24} />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Caja Cerrada</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {registerDisplayName || `Caja ${registerId}`} • Inicia un nuevo turno para facturar
                        </p>
                    </div>

                    {/* Mode Toggle */}
                    <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 mb-6">
                        <button
                            type="button"
                            onClick={() => setOpenMode('DIRECT')}
                            className={`flex-1 py-2 min-h-[38px] rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer ${
                                openMode === 'DIRECT' 
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs' 
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Zap size={14} /> Monto Directo
                        </button>
                        <button
                            type="button"
                            onClick={() => setOpenMode('DENOMINATIONS')}
                            className={`flex-1 py-2 min-h-[38px] rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer ${
                                openMode === 'DENOMINATIONS' 
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs' 
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Calculator size={14} /> Conteo por Billetes
                        </button>
                    </div>

                    <form onSubmit={handleOpenShift} className="space-y-6">
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Cajero Responsable</label>
                            <div className="relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input
                                    type="text"
                                    required
                                    value={openCashierName}
                                    onChange={(e) => setOpenCashierName(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:border-primary-500 font-bold text-base sm:text-sm outline-none text-slate-900 dark:text-white"
                                    placeholder="Nombre del cajero"
                                />
                            </div>
                        </div>

                        {openMode === 'DIRECT' ? (
                            <div className={`grid ${isSingleCurrencyMode(settings) ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 px-1">
                                        {isSingleCurrencyMode(settings) ? 'Fondo Inicial ($)' : 'Fondo Inicial ($ USD)'}
                                    </label>
                                    <div className="relative">
                                        <DollarSign size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="number"
                                            step="any"
                                            min="0"
                                            value={openAmountUsd}
                                            onChange={(e) => setOpenAmountUsd(e.target.value)}
                                            className="w-full pl-10 pr-3 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-lg font-black font-mono outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                            placeholder="0.00"
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                {!isSingleCurrencyMode(settings) && (
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 px-1">
                                            Fondo Inicial (Bs. VES)
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-black text-slate-400 text-xs">Bs</span>
                                            <input
                                                type="number"
                                                step="any"
                                                min="0"
                                                value={openAmountBs}
                                                onChange={(e) => setOpenAmountBs(e.target.value)}
                                                className="w-full pl-10 pr-3 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-lg font-black font-mono outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Billetes USD en Gaveta</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {['100', '50', '20', '10', '5', '1'].map(bill => (
                                        <div key={bill} className="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                                            <span className="text-xs font-black">${bill}</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={openDenomsUsd[bill] || ''}
                                                onChange={(e) => setOpenDenomsUsd({ ...openDenomsUsd, [bill]: parseInt(e.target.value) || 0 })}
                                                className="w-12 text-right bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-xs font-black outline-none"
                                                placeholder="0"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between items-center bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-xl border border-emerald-500/20">
                                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Total Contado:</span>
                                    <span className="text-lg font-black text-emerald-700 dark:text-emerald-300 font-mono">${denomsUsdTotal().toFixed(2)} USD</span>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="flex items-center gap-2.5 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-100/50 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={printOpeningOnStart}
                                    onChange={(e) => setPrintOpeningOnStart(e.target.checked)}
                                    className="w-4 h-4 accent-primary-600 rounded"
                                />
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <Printer size={14} className="text-slate-500" />
                                    <span>Imprimir Comprobante</span>
                                </span>
                            </label>
                            <label className="flex items-center gap-2.5 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-100/50 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={kickDrawerOnStart}
                                    onChange={(e) => setKickDrawerOnStart(e.target.checked)}
                                    className="w-4 h-4 accent-primary-600 rounded"
                                />
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <Unlock size={14} className="text-slate-500" />
                                    <span>Abrir Gaveta al Iniciar</span>
                                </span>
                            </label>
                        </div>

                        <button 
                            type="submit"
                            className="w-full h-11 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-xs cursor-pointer"
                        >
                            <CheckCircle2 size={16} /> Confirmar Apertura e Iniciar Turno
                        </button>
                    </form>
                </div>

                {/* Historial de Cierres visible también con Caja Cerrada */}
                <div className="mt-6 bg-white dark:bg-slate-900 rounded-xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <History size={18} className="text-primary-600 dark:text-primary-400" />
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                                Historial de Cierres de Caja (Corte Z)
                            </h3>
                        </div>
                        <button
                            type="button"
                            onClick={fetchHistory}
                            className="px-2.5 py-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/30 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                        >
                            <RefreshCcw size={13} className={historyLoading ? 'animate-spin' : ''} /> Actualizar
                        </button>
                    </div>

                    {historyLoading ? (
                        <div className="py-8 text-center text-slate-400">
                            <RefreshCcw className="animate-spin mx-auto mb-2 text-primary-500" size={22} />
                            <p className="text-xs font-semibold uppercase tracking-wider">Cargando Historial...</p>
                        </div>
                    ) : historyShifts.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                            No hay cierres registrados aún
                        </div>
                    ) : (
                        <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
                            {historyShifts.slice(0, 15).map(s => {
                                const diff = Number(s.difference) || 0;
                                const isMatch = Math.abs(diff) < 0.01;
                                const summaryObj = typeof s.salesSummary === 'string'
                                    ? (() => { try { return JSON.parse(s.salesSummary) || {}; } catch (_) { return {}; } })()
                                    : (s.salesSummary || {});
                                const salesUsd = Number(s.totalSalesAmount ?? summaryObj.totalSales ?? 0);
                                return (
                                    <div
                                        key={s.id}
                                        onClick={() => {
                                            setClosedShiftData(s);
                                            setZReportModalOpen(true);
                                        }}
                                        className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-primary-500/60 bg-slate-50/60 dark:bg-slate-800/40 cursor-pointer transition-all flex items-center justify-between gap-3"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isMatch ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                <FileText size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                    Cierre #{String(s.id || '').substring(0, 8)} • {s.user?.name || s.userName || 'Cajero'}
                                                </p>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                    {s.closedAt ? new Date(s.closedAt).toLocaleString() : 'Sin fecha'} • Ventas: ${salesUsd.toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2.5 shrink-0">
                                            <div className="text-right">
                                                <span className="text-xs sm:text-sm font-bold font-mono block text-slate-900 dark:text-white">
                                                    ${Number(s.finalAmount || 0).toFixed(2)}
                                                </span>
                                                <span className={`text-[10px] font-semibold ${isMatch ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {isMatch ? 'Cuadrado' : `Dif: ${diff > 0 ? '+' : ''}$${diff.toFixed(2)}`}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    printZReportReceipt({
                                                        shift: s,
                                                        settings,
                                                        businessSettings: settings,
                                                        exchangeRate: Number(s.exchangeRateAtClose || settings?.rate || 1),
                                                        currencyMode: settings?.currencyMode || 'BOTH'
                                                    });
                                                    toast.success('Imprimiendo Corte Z...');
                                                }}
                                                className="px-2.5 py-2 bg-white dark:bg-slate-800 hover:bg-primary-50 dark:hover:bg-primary-950/40 text-primary-600 dark:text-primary-400 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                                title="Reimprimir Ticket Corte Z"
                                            >
                                                <Printer size={14} /> <span className="hidden sm:inline">Imprimir Z</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Z Report Modal */}
                <ZReportModal 
                    isOpen={zReportModalOpen} 
                    onClose={() => setZReportModalOpen(false)} 
                    shift={closedShiftData} 
                    businessSettings={settings} 
                    exchangeRate={settings.rate || 1} 
                    paymentMethods={paymentMethods}
                    currencyMode={settings.currencyMode || 'BOTH'}
                />
            </div>
        );
    }

    // STATE 2: Shift is Open -> Command Center
    return (
        <div className="space-y-4 sm:space-y-6 pb-16 animate-in fade-in duration-300 w-full max-w-[1600px] mx-auto px-2 sm:px-4 lg:px-6">
            {/* Header / Hero Bar */}
            <div className="flex flex-col 2xl:flex-row justify-between items-start 2xl:items-center gap-4 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3.5 min-w-0">
                    <div className="h-11 w-11 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Banknote size={20} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Control de Caja</h1>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                Turno en curso
                            </span>
                            <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                #{shift.id.substring(0, 8)}
                            </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                                <User size={13} className="text-slate-400" />
                                Cajero: <strong className="text-slate-700 dark:text-slate-200 font-semibold">{shift.userName}</strong>
                            </span>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1">
                                <Monitor size={13} className="text-slate-400" />
                                {registerDisplayName || `Terminal ${registerId}`}
                            </span>
                            {shift.openedAt && (
                                <>
                                    <span>•</span>
                                    <span className="inline-flex items-center gap-1">
                                        <Clock size={13} className="text-slate-400" />
                                        Apertura: {new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Toolbar de Acciones */}
                <div className="flex items-center flex-wrap gap-2 w-full 2xl:w-auto justify-start 2xl:justify-end pt-2 2xl:pt-0 border-t 2xl:border-t-0 border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button 
                            onClick={handleKickDrawer}
                            className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            title="Abrir gaveta de dinero"
                        >
                            <Unlock size={14} className="text-slate-500" />
                            <span>Gaveta</span>
                        </button>
                        <button 
                            onClick={() => printXReportReceipt({ shift, stats: shift, settings })}
                            className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            title="Imprimir arqueo parcial Corte X"
                        >
                            <Printer size={14} className="text-slate-500" />
                            <span>Ticket Corte X</span>
                        </button>
                        <button 
                            onClick={() => setActiveTab('historial')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                                activeTab === 'historial'
                                    ? 'bg-primary-600 text-white border-primary-600'
                                    : 'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                            }`}
                        >
                            <History size={14} className={activeTab === 'historial' ? 'text-white' : 'text-slate-500'} />
                            <span>Historial Cierres</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button 
                            onClick={() => setMovementModal({ show: true, type: 'in' })}
                            className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl border border-emerald-200 dark:border-emerald-800/60 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                            <ArrowDownLeft size={14} />
                            <span>Ingreso</span>
                        </button>
                        <button 
                            onClick={() => setMovementModal({ show: true, type: 'expense' })}
                            className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl border border-rose-200 dark:border-rose-800/60 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                            <ArrowUpRight size={14} />
                            <span>Egreso</span>
                        </button>
                        <button 
                            onClick={() => setCloseModal(true)}
                            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-1.5 uppercase tracking-wider cursor-pointer active:scale-95"
                        >
                            <Lock size={14} />
                            <span>Cerrar Caja</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
                {/* 1. Fondo Inicial */}
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Fondo Inicial</span>
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                <Wallet size={16} />
                            </div>
                        </div>
                        <p className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-slate-900 dark:text-white mt-1 tabular-nums">
                            ${Number(shift.initialAmount || 0).toFixed(2)}
                            <span className="text-xs font-semibold text-slate-400 font-sans ml-1.5">USD</span>
                        </p>
                    </div>
                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Apertura de turno</span>
                        <span className="font-mono text-slate-400">Base</span>
                    </div>
                </div>

                {/* 2. Efectivo en Gaveta */}
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Efectivo en Gaveta</span>
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                <Banknote size={16} />
                            </div>
                        </div>
                        <p className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-slate-900 dark:text-white mt-1 tabular-nums">
                            ${(Number(shift.expectedCashUsd) || 0).toFixed(2)}
                            <span className="text-xs font-semibold text-slate-400 font-sans ml-1.5">USD</span>
                        </p>
                    </div>
                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
                        {!isSingle ? (
                            <>
                                <span className="text-slate-500">Equivalente local:</span>
                                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                                    Bs. {(Number(shift.expectedCashBs) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </>
                        ) : (
                            <span className="text-slate-400">Monto total disponible</span>
                        )}
                    </div>
                </div>

                {/* 3. Ventas Totales */}
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Ventas del Turno</span>
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                <TrendingUp size={16} />
                            </div>
                        </div>
                        <p className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-slate-900 dark:text-white mt-1 tabular-nums">
                            ${(Number(shift.totalSalesAmount) || 0).toFixed(2)}
                            <span className="text-xs font-semibold text-slate-400 font-sans ml-1.5">USD</span>
                        </p>
                    </div>
                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Operaciones cobradas</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {shift.salesCount || 0} tickets
                        </span>
                    </div>
                </div>

                {/* 4. Total Teórico */}
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Teórico</span>
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                <Calculator size={16} />
                            </div>
                        </div>
                        <p className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-slate-900 dark:text-white mt-1 tabular-nums">
                            ${(Number(shift.theoreticalTotalUsd) || 0).toFixed(2)}
                            <span className="text-xs font-semibold text-slate-400 font-sans ml-1.5">USD</span>
                        </p>
                    </div>
                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Consolidado general</span>
                        <span className="font-mono text-slate-400">Todos los medios</span>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center overflow-x-auto no-scrollbar gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 w-full sm:w-fit">
                <button
                    onClick={() => setActiveTab('operaciones')}
                    className={`shrink-0 px-4 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer flex items-center gap-2 ${
                        activeTab === 'operaciones'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <Banknote size={14} />
                    <span>Operaciones y Desglose</span>
                </button>
                <button
                    onClick={() => setActiveTab('corte_x')}
                    className={`shrink-0 px-4 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer flex items-center gap-2 ${
                        activeTab === 'corte_x'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <FileText size={14} />
                    <span>Arqueo Parcial (Corte X)</span>
                </button>
                <button
                    onClick={() => setActiveTab('historial')}
                    className={`shrink-0 px-4 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer flex items-center gap-2 ${
                        activeTab === 'historial'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <History size={14} />
                    <span>Historial de Cierres</span>
                    {historyShifts.length > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300">
                            {historyShifts.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Tab 1: Operaciones */}
            {activeTab === 'operaciones' && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
                    {/* Method Breakdown */}
                    <div className="xl:col-span-1 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Recaudación por Método</h3>
                                <p className="text-[11px] text-slate-500">Distribución de ingresos por canal de pago</p>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold">
                                {paymentMethods.length} métodos
                            </span>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50/50 dark:bg-slate-900/40">
                            {paymentMethods.map(pm => {
                                 const key = String(pm.id || '').toLowerCase().trim();
                                 const aliases = {
                                     'cash': ['cash', 'cash_usd', 'efectivo_usd'],
                                     'cash_bs': ['cash_bs', 'efectivo_bs', 'cash_ves', 'ves', 'bs'],
                                     'debit': ['debit', 'card', 'punto', 'punto_de_venta', 'debito', 'tarjeta'],
                                     'pago_movil': ['pago_movil', 'pagomovil', 'mobile'],
                                     'transfer': ['transfer', 'transferencia', 'transfer_bs'],
                                     'fiado': ['fiado', 'credito', 'credit'],
                                     'biopago': ['biopago']
                                 };
                                 const canon = ['credito', 'credit', 'fiado'].includes(key) ? 'fiado' :
                                               ['efectivo_bs', 'cash_bs', 'ves', 'bs'].includes(key) ? 'cash_bs' :
                                               ['efectivo_usd', 'cash_usd', 'cash'].includes(key) ? 'cash' :
                                               ['card', 'tarjeta', 'punto', 'debito', 'debit'].includes(key) ? 'debit' :
                                               ['pagomovil', 'mobile', 'pago_movil'].includes(key) ? 'pago_movil' : key;
                                 const targetKeys = aliases[canon] || [canon, pm.id];

                                 const eb = shift?.expectedBreakdown || {};
                                 const pbn = shift?.paymentBreakdownNative || shift?.paymentBreakdown || {};
                                 let valNative = 0;
                                 for (const k of targetKeys) {
                                     if (eb[k] !== undefined && eb[k] !== null && Number(eb[k]) > 0) {
                                        valNative = Number(eb[k]);
                                        break;
                                     }
                                 }
                                 if (valNative === 0) {
                                     for (const k of targetKeys) {
                                         if (pbn[k] !== undefined && pbn[k] !== null && Number(pbn[k]) > 0) {
                                             valNative = Number(pbn[k]);
                                             break;
                                         }
                                     }
                                 }

                                 if (isSingle && isVesOnlyMode(pm)) return null;
                                 const isVes = pm.currency === 'VES' || pm.defaultCurrency === 'VES';
                                 if (valNative === 0 && !pm.id.includes('cash')) return null;

                                 const getMethodIcon = (id) => {
                                     if (id.includes('cash')) return <Banknote size={15} />;
                                     if (id.includes('movil') || id.includes('mobile')) return <Smartphone size={15} />;
                                     if (id.includes('transfer') || id.includes('bank')) return <Building2 size={15} />;
                                     return <CreditCard size={15} />;
                                 };

                                 return (
                                     <div key={pm.id} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 transition-colors">
                                         <div className="flex items-center gap-2.5 min-w-0">
                                             <div className="p-1.5 bg-white dark:bg-slate-800 rounded-lg text-slate-500 border border-slate-200 dark:border-slate-700 shrink-0">
                                                 {getMethodIcon(pm.id)}
                                             </div>
                                             <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{pm.name}</span>
                                         </div>
                                         <span className="text-xs font-bold font-mono text-slate-900 dark:text-white shrink-0 whitespace-nowrap">
                                             {isVes ? `Bs. ${valNative.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${valNative.toFixed(2)}`}
                                         </span>
                                     </div>
                                 );
                            })}
                        </div>
                    </div>

                    {/* Movements Timeline */}
                    <div className="xl:col-span-2 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                        <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Movimientos de Caja en Vivo</h3>
                                <p className="text-[11px] text-slate-500">Registro auditable de ingresos, egresos y sangrías</p>
                            </div>
                            <button
                                onClick={() => setMovementModal({ show: true, type: 'expense' })}
                                className="h-8 px-3 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
                            >
                                <Plus size={14} />
                                <span>Nuevo Movimiento</span>
                            </button>
                        </div>

                        <div className="space-y-2 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
                            {(shift.CashMovements || shift.movements || []).length === 0 ? (
                                <div className="text-center py-16 text-slate-400 space-y-2">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                                        <Receipt size={18} />
                                    </div>
                                    <p className="text-xs font-semibold">Sin movimientos registrados en este turno</p>
                                    <p className="text-[11px] text-slate-400">Los ingresos manuales, gastos y sangrías aparecerán aquí</p>
                                </div>
                            ) : (
                                [...(shift.CashMovements || shift.movements || [])].reverse().map((m, i) => {
                                    const isIncome = m.type === 'in';
                                    const isOpening = (m.reason || '').toLowerCase().includes('apertura') || m.category === 'OPENING';
                                    const isDrop = m.category === 'DRAWER_DROP';

                                    const getBadgeColor = () => {
                                        if (isOpening) return 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';
                                        if (isDrop) return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
                                        if (isIncome) return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
                                        return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
                                    };

                                    const getCategoryLabel = () => {
                                        if (isOpening) return 'Apertura';
                                        if (isDrop) return 'Sangría / Bóveda';
                                        if (m.category === 'INCOME') return 'Ingreso';
                                        if (m.category === 'EXPENSE') return 'Gasto';
                                        if (m.category === 'CHANGE_SUPPLY') return 'Cambio';
                                        if (m.category === 'SUPPLIER_PAYMENT') return 'Proveedor';
                                        return m.category || (isIncome ? 'Ingreso' : 'Egreso');
                                    };

                                    return (
                                        <div 
                                            key={m.id || i} 
                                            className="p-3 bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors flex items-center justify-between gap-3"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                                                    isIncome 
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 border-emerald-200 dark:border-emerald-800' 
                                                        : isDrop
                                                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 border-amber-200 dark:border-amber-800'
                                                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 border-rose-200 dark:border-rose-800'
                                                }`}>
                                                    {isIncome ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                            {m.reason || 'Sin motivo'}
                                                        </p>
                                                        <span className={`text-[10px] font-semibold px-2 py-0.2 rounded-full border ${getBadgeColor()}`}>
                                                            {getCategoryLabel()}
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                                                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        {m.userName && ` • ${m.userName}`}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className={`text-sm font-bold font-mono ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    {isIncome ? '+' : '-'}{m.currency === 'VES' ? formatBs(m.amount) : formatUSD(m.amount)}
                                                </span>
                                                <button
                                                    onClick={() => printCashMovementReceipt({ movement: m, shift, user, settings })}
                                                    className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                                    title="Reimprimir Comprobante"
                                                >
                                                    <Receipt size={15} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Tab 2: Corte X */}
            {activeTab === 'corte_x' && (
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    {xReport ? (
                        <CashShiftDetails 
                            shift={xReport} 
                            title="CORTE X (ARQUEO PARCIAL)" 
                            paymentMethods={paymentMethods} 
                            exchangeRate={settings.rate || 1}
                            onPrint={() => printXReportReceipt({ shift: xReport, stats: xReport, settings })}
                        />
                    ) : (
                        <div className="py-20 text-center text-slate-400">
                            <RefreshCcw className="animate-spin mx-auto mb-3 text-primary-500" size={28} />
                            <p className="text-xs font-semibold uppercase tracking-wider">Generando Corte X...</p>
                        </div>
                    )}
                </div>
            )}

            {/* Tab 3: Historial */}
            {activeTab === 'historial' && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Filtrar por Rango de Fechas:</span>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="h-9 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-primary-500"
                            />
                            <span className="text-xs text-slate-400">-</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="h-9 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-primary-500"
                            />
                            {(startDate || endDate) && (
                                <button
                                    onClick={() => { setStartDate(''); setEndDate(''); }}
                                    className="h-9 px-3 text-xs text-rose-600 dark:text-rose-400 font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors cursor-pointer"
                                >
                                    Limpiar
                                </button>
                            )}
                        </div>
                    </div>

                    {historyLoading ? (
                        <div className="py-20 text-center text-slate-400">
                            <RefreshCcw className="animate-spin mx-auto mb-3 text-primary-500" size={28} />
                            <p className="text-xs font-semibold uppercase tracking-wider">Cargando Historial...</p>
                        </div>
                    ) : historyShifts.length === 0 ? (
                        <div className="text-center py-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider rounded-xl">
                            No hay cierres registrados en este periodo
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            {historyShifts.map(s => {
                                const diff = Number(s.difference) || 0;
                                const isMatch = Math.abs(diff) < 0.01;
                                const summaryObj = typeof s.salesSummary === 'string'
                                    ? (() => { try { return JSON.parse(s.salesSummary) || {}; } catch (_) { return {}; } })()
                                    : (s.salesSummary || {});
                                const salesUsd = Number(s.totalSalesAmount ?? summaryObj.totalSales ?? 0);
                                const salesCnt = Number(s.salesCount ?? summaryObj.salesCount ?? 0);
                                return (
                                    <div
                                        key={s.id}
                                        onClick={() => {
                                            setClosedShiftData(s);
                                            setZReportModalOpen(true);
                                        }}
                                        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-primary-500/60 transition-all flex items-center justify-between gap-3 group shadow-sm"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isMatch ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                <FileText size={19} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                    Cierre #{String(s.id || '').substring(0, 8)} • {s.user?.name || s.userName || 'Cajero'}
                                                </p>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                    {s.closedAt ? new Date(s.closedAt).toLocaleString() : 'Sin fecha'}
                                                </p>
                                                <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">
                                                    Ventas: ${salesUsd.toFixed(2)} ({salesCnt} op.)
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2.5 shrink-0">
                                            <div className="text-right">
                                                <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Declarado</span>
                                                <span className="text-sm font-bold font-mono block text-slate-900 dark:text-white">
                                                    ${Number(s.finalAmount || 0).toFixed(2)}
                                                </span>
                                                <span className={`text-[10px] font-semibold ${isMatch ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {isMatch ? 'Cuadrado' : `Dif: ${diff > 0 ? '+' : ''}$${diff.toFixed(2)}`}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    printZReportReceipt({
                                                        shift: s,
                                                        settings,
                                                        businessSettings: settings,
                                                        exchangeRate: Number(s.exchangeRateAtClose || settings?.rate || 1),
                                                        currencyMode: settings?.currencyMode || 'BOTH'
                                                    });
                                                    toast.success('Imprimiendo Corte Z...');
                                                }}
                                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-primary-50 dark:hover:bg-primary-950/40 text-primary-600 dark:text-primary-400 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                                title="Reimprimir Ticket Corte Z"
                                            >
                                                <Printer size={14} /> <span className="hidden md:inline">Imprimir Z</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Movement Modal */}
            {movementModal.show && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
                    <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMovementModal({ show: false })}></div>
                    <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md max-h-[90dvh] overflow-y-auto relative z-10 p-5 sm:p-6 shadow-xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
                        <h3 className="text-base font-bold tracking-tight mb-4 text-slate-900 dark:text-white">
                            {movementModal.type === 'in' ? 'Registrar Ingreso a Caja' : 'Registrar Egreso de Caja'}
                        </h3>

                        <form onSubmit={handleMovement} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Categoría</label>
                                <select
                                    value={movementForm.category}
                                    onChange={(e) => setMovementForm({ ...movementForm, category: e.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base sm:text-xs font-bold outline-none"
                                >
                                    {movementModal.type === 'in' ? (
                                        <>
                                            <option value="INCOME">Ingreso Extraordinario</option>
                                            <option value="CHANGE_SUPPLY">Suministro de Cambio</option>
                                            <option value="PETTY_CASH">Reposición Caja Chica</option>
                                            <option value="OTHER">Otro Ingreso</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="EXPENSE">Gasto Operativo</option>
                                            <option value="SUPPLIER_PAYMENT">Pago a Proveedor</option>
                                            <option value="DRAWER_DROP">Retiro a Caja Fuerte (Sangría)</option>
                                            <option value="SALARY_ADVANCE">Adelanto de Sueldo</option>
                                            <option value="PETTY_CASH">Caja Chica</option>
                                            <option value="OTHER">Otro Egreso</option>
                                        </>
                                    )}
                                </select>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                {!isSingleCurrencyMode(settings) && (
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Moneda</label>
                                        <select
                                            value={movementForm.currency}
                                            onChange={(e) => {
                                                const cur = e.target.value;
                                                const defaultMethod = (cur === 'VES' || cur === 'BS') ? 'cash_bs' : 'cash';
                                                setMovementForm({ ...movementForm, currency: cur, paymentMethodId: defaultMethod });
                                            }}
                                            className="w-full px-3 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base sm:text-sm font-black outline-none"
                                        >
                                            <option value="USD">USD ($)</option>
                                            <option value="VES">VES (Bs)</option>
                                        </select>
                                    </div>
                                )}
                                <div className={`space-y-1 ${isSingleCurrencyMode(settings) ? 'col-span-3' : 'col-span-2'}`}>
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Monto</label>
                                    <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        required
                                        value={movementForm.amount}
                                        onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base sm:text-lg font-black font-mono outline-none focus:border-primary-500"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Motivo / Concepto</label>
                                <textarea
                                    required
                                    rows="2"
                                    value={movementForm.reason}
                                    onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base sm:text-xs font-bold outline-none resize-none"
                                    placeholder="Detalle del movimiento..."
                                />
                            </div>

                            <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                                <input
                                    type="checkbox"
                                    checked={printMovementVoucher}
                                    onChange={(e) => setPrintMovementVoucher(e.target.checked)}
                                    className="w-4 h-4 accent-primary-600 rounded"
                                />
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <Printer size={13} className="text-slate-500" />
                                    <span>Imprimir Comprobante Térmico</span>
                                </span>
                            </label>

                            <div className="flex gap-2.5 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setMovementModal({ show: false })}
                                    className="w-1/3 h-11 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-xl text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer flex items-center justify-center"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="w-2/3 h-11 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl uppercase tracking-wider text-xs shadow-sm transition-colors cursor-pointer flex items-center justify-center"
                                >
                                    Registrar Movimiento
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Close Shift Modal */}
            {shift && (
                <CloseShiftModal
                    isOpen={closeModal}
                    onClose={() => setCloseModal(false)}
                    currentShift={shift}
                    onSuccess={handleClosureSuccess}
                    businessSettings={settings}
                    paymentMethods={paymentMethods}
                    exchangeRate={settings?.rate || 1}
                    currencyMode={settings?.currencyMode || 'BOTH'}
                />
            )}

            {/* Z Report Modal */}
            <ZReportModal 
                isOpen={zReportModalOpen} 
                onClose={() => setZReportModalOpen(false)} 
                shift={closedShiftData} 
                businessSettings={settings} 
                exchangeRate={settings.rate || 1} 
                paymentMethods={paymentMethods}
                currencyMode={settings.currencyMode || 'BOTH'}
            />
        </div>
    );
}
