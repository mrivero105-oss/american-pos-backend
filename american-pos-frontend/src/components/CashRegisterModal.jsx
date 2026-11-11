import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/AuthContext';
import { 
    DollarSign, ArrowUpRight, ArrowDownRight, RefreshCcw, Lock, X, 
    Banknote, User, CreditCard, Clock, FileText, History, CheckCircle, 
    Coins, Receipt, Plus, Calculator, Shield, Zap, AlertCircle, ArrowRight,
    Store, Monitor, Printer, Unlock, ArrowDownLeft, Building2, Check, RotateCcw
} from 'lucide-react';
import CashShiftDetails from './CashShiftDetails';
import ZReportModal from './ZReportModal';
import BaseModal from './BaseModal';
import CloseShiftModal from './CloseShiftModal';
import StationConfigPanel from './StationConfigPanel';
import { formatDate as formatDateSafe, formatBs, formatUSD, isSingleCurrencyMode, isUsdOnlyMode, isVesOnlyMode, isDollarOnlyCountry } from '../utils/format';
import { printOpeningReceipt, printXReportReceipt, printCashMovementReceipt } from '../utils/printCashReceipts';
import { usePos } from '../hooks/PosContext';

const isVesMethod = (m, isSingle = false) => {
    if (!m || isSingle) return false;
    const effectiveCountry = localStorage.getItem('pos_country') || '';
    if (isDollarOnlyCountry(effectiveCountry)) return false;
    const id = (typeof m === 'string' ? m : m.id || '').toLowerCase();
    const knownVesKeys = ['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'pagomovil', 'cash_bs', 'efectivo_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'];
    if (knownVesKeys.includes(id) || id.includes('bs') || id.includes('ves') || id.includes('movil')) return true;
    if (typeof m === 'object' && (m.defaultCurrency === 'VES' || m.currency === 'VES')) return true;
    return false;
};
export default function CashRegisterModal({ isOpen, onClose, businessSettings = {} }) {
    const { 
        registerId, 
        setRegisterId, 
        registerDisplayName, 
        setRegisterDisplayName, 
        allowedCategories, 
        setAllowedCategories,
        allowedProducts,
        setAllowedProducts 
    } = usePos();
    const [registerNameInput, setRegisterNameInput] = useState(registerDisplayName || '');
    const [showStationConfig, setShowStationConfig] = useState(false);

    useEffect(() => {
        if (registerDisplayName) {
            setRegisterNameInput(registerDisplayName);
        }
    }, [registerDisplayName]);
    const [currentShift, setCurrentShift] = useState(null);
    const [loading, setLoading] = useState(true);

    // Opening Shift States
    const [openMode, setOpenMode] = useState('DIRECT'); // 'DIRECT' | 'DENOMINATIONS'
    const [amountInputUsd, setAmountInputUsd] = useState('');
    const [amountInputVes, setAmountInputVes] = useState('');
    const [cashierNameInput, setCashierNameInput] = useState('');
    const [openingNotes, setOpeningNotes] = useState('');
    const [lastClosedShift, setLastClosedShift] = useState(null);
    const [printOpeningTicketOnStart, setPrintOpeningTicketOnStart] = useState(false);
    const [kickDrawerOnStart, setKickDrawerOnStart] = useState(false);

    // Denominations Counter for Opening
    const [openDenomsUsd, setOpenDenomsUsd] = useState({
        '100': 0, '50': 0, '20': 0, '10': 0, '5': 0, '1': 0,
        '0.50': 0, '0.25': 0, '0.10': 0, '0.05': 0, '0.01': 0,
        looseCoins: 0
    });
    const [openDenomsVes, setOpenDenomsVes] = useState({
        '100': 0, '50': 0, '20': 0, '10': 0, '5': 0
    });

    const [processing, setProcessing] = useState(false);
    const [exchangeRate, setExchangeRate] = useState(1);
    const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState(false);

    // Movement Modal State
    const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
    const [movementType, setMovementType] = useState('expense'); // 'in' | 'expense' | 'out'
    const [movementCategory, setMovementCategory] = useState('EXPENSE');
    const [movementAmount, setMovementAmount] = useState('');
    const [movementReason, setMovementReason] = useState('');
    const [movementCurrency, setMovementCurrency] = useState('USD');
    const [printMovementVoucher, setPrintMovementVoucher] = useState(true);
    const [currencyMode, setCurrencyMode] = useState('BOTH');
    const [paymentMethods, setPaymentMethods] = useState([]);
    const { user } = useAuth();

    const effectiveCountry = businessSettings?.country || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = isDollarCountry || isUsdOnlyMode({ currencyMode, country: effectiveCountry, ...businessSettings });
    const isVesOnly = !isUsdOnly && isVesOnlyMode({ currencyMode, ...businessSettings });
    const isDual = !isUsdOnly && !isVesOnly;
    const isSingle = isUsdOnly;

    // Tabs State
    const [activeTab, setActiveTab] = useState('operaciones'); 
    const [xReport, setXReport] = useState(null);
    const [historyShifts, setHistoryShifts] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedHistoryShift, setSelectedHistoryShift] = useState(null);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [closedShiftReport, setClosedShiftReport] = useState(null);
    const [isZReportOpen, setIsZReportOpen] = useState(false);

    useEffect(() => {
        if (user && !cashierNameInput) {
            setCashierNameInput(user.name || user.username || '');
        }
    }, [user, cashierNameInput]);

    useEffect(() => {
        const handleShiftChanged = (e) => {
            if (e && e.detail && typeof e.detail.isOpen === 'boolean') {
                if (e.detail.shift !== undefined) {
                    setCurrentShift(e.detail.shift || null);
                } else if (isOpen) {
                    fetchCurrentShift(true);
                }
            } else if (isOpen) {
                fetchCurrentShift(true);
            }
        };
        if (isOpen) {
            fetchCurrentShift();
            fetchRate();
            fetchPaymentMethods();
            fetchLastClosedShift();
            window.addEventListener('shift_status_changed', handleShiftChanged);
        } else {
            setActiveTab('operaciones');
            setXReport(null);
            setHistoryShifts([]);
            setSelectedHistoryShift(null);
        }
        return () => window.removeEventListener('shift_status_changed', handleShiftChanged);
    }, [isOpen, registerId]);

    useEffect(() => {
        if (activeTab === 'corte_x') {
            fetchXReport();
        } else if (activeTab === 'historial') {
            fetchHistory();
        }
    }, [activeTab, startDate, endDate]);

    if (!isOpen) return null;

    const fetchLastClosedShift = async () => {
        try {
            const { data } = await api.get('/cash/last-closed', { params: { registerId } });
            setLastClosedShift(data || null);
        } catch (e) {
            console.error('Error fetching last shift summary', e);
        }
    };

    const fetchXReport = async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/cash/x-report', { params: { registerId } });
            setXReport(data);
        } catch (error) {
            console.error('Error fetching X report:', error);
            toast.error('Error al cargar Corte X');
        } finally {
            setLoading(false);
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
            setHistoryShifts(data);
        } catch (error) {
            console.error('Error fetching history:', error);
            toast.error('Error al cargar historial');
        } finally {
            setHistoryLoading(false);
        }
    };

    const fetchPaymentMethods = async () => {
        try {
            const { data } = await api.get('/settings/payment-methods');
            setPaymentMethods(data);
        } catch (e) { console.error('Error fetching methods', e); }
    };

    const fetchRate = async () => {
        try {
            const res = await api.get('/settings/rate');
            setExchangeRate(res.data.rate || 1);
            setCurrencyMode(res.data.currencyMode || 'BOTH');
        } catch (e) { console.error('Error fetching rate', e); }
    };

    const fetchCurrentShift = async (silent = false) => {
        try {
            setLoading(true);
            const { data } = await api.get('/cash/current', { params: { registerId } });
            setCurrentShift(data);
            if (!silent && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('shift_status_changed', { detail: { isOpen: !!data, shift: data || null } }));
            }
        } catch (error) {
            console.error('Error fetching shift:', error);
        } finally {
            setLoading(false);
        }
    };

    // Calculate USD from denominations in opening
    const denomsUsdTotal = () => {
        const bills = ['100', '50', '20', '10', '5', '1'].reduce(
            (acc, b) => acc + (Number(b) * (Number(openDenomsUsd[b]) || 0)), 0
        );
        const coins = ['0.50', '0.25', '0.10', '0.05', '0.01'].reduce(
            (acc, c) => acc + (Number(c) * (Number(openDenomsUsd[c]) || 0)), 0
        );
        return Math.round((bills + coins + (Number(openDenomsUsd.looseCoins) || 0)) * 100) / 100;
    };

    const denomsVesTotal = () => {
        return ['100', '50', '20', '10', '5'].reduce(
            (acc, b) => acc + (Number(b) * (Number(openDenomsVes[b]) || 0)), 0
        );
    };

    const handleApplyLastShiftBalance = () => {
        if (!lastClosedShift) return;
        const finalUsd = Number(lastClosedShift.finalAmount) || 0;
        setOpenMode('DIRECT');
        setAmountInputUsd(finalUsd > 0 ? String(finalUsd) : '');
        toast.success(`Fondo del turno anterior aplicado ($${finalUsd.toFixed(2)})`);
    };

    const handleOpenShift = async (e) => {
        e.preventDefault();
        if (!cashierNameInput.trim()) {
            toast.error('Debes ingresar el nombre del cajero/responsable');
            return;
        }

        try {
            setProcessing(true);
            let usd = 0;
            let ves = 0;

            if (openMode === 'DENOMINATIONS') {
                usd = denomsUsdTotal();
                ves = denomsVesTotal();
            } else {
                usd = parseFloat(amountInputUsd) || 0;
                ves = parseFloat(amountInputVes) || 0;
            }

            const totalBaseUsd = usd + (ves / exchangeRate);

            const initialBreakdown = {};
            const cashUsdMethod = paymentMethods.find(m => (m.id.toLowerCase().includes('cash') || m.id.toLowerCase().includes('efectivo')) && !isVesMethod(m, isSingle));
            const cashVesMethod = paymentMethods.find(m => (m.id.toLowerCase().includes('cash') || m.id.toLowerCase().includes('efectivo')) && isVesMethod(m, isSingle));

            if (cashUsdMethod && usd > 0) initialBreakdown[cashUsdMethod.id] = usd;
            if (cashVesMethod && ves > 0) initialBreakdown[cashVesMethod.id] = ves;
            
            if (Object.keys(initialBreakdown).length === 0) {
                initialBreakdown['cash'] = totalBaseUsd;
            }

            const finalRegName = registerNameInput.trim() || registerDisplayName || 'Caja 1';
            setRegisterDisplayName(finalRegName);
            localStorage.setItem('pos_register_name', finalRegName);

            const { data } = await api.post('/cash/open', { 
                amount: totalBaseUsd, 
                initialBreakdown,
                userName: cashierNameInput.trim(),
                userId: user?.id,
                registerId: registerId,
                registerName: finalRegName,
                notes: openingNotes,
                allowedCategories: allowedCategories || [],
                allowedProducts: allowedProducts || []
            });

            toast.success('¡Caja abierta exitosamente!');

            if (printOpeningTicketOnStart) {
                printOpeningReceipt({ shift: data, user, settings: businessSettings, kickDrawer: kickDrawerOnStart });
            } else if (kickDrawerOnStart) {
                handleKickDrawer();
            }

            setAmountInputUsd('');
            setAmountInputVes('');
            setOpeningNotes('');
            await fetchCurrentShift();
        } catch (error) {
            console.error('Error opening shift:', error);
            toast.error(error.response?.data?.message || error.response?.data?.error || 'Error al abrir caja');
        } finally {
            setProcessing(false);
        }
    };

    const handleCloseShiftSuccess = (closedShift) => {
        setIsCloseShiftModalOpen(false);
        setCurrentShift(null);
        setClosedShiftReport(closedShift);
        setIsZReportOpen(true);
        toast.success('Auditoría completada exitosamente.');
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('shift_status_changed', { detail: { isOpen: false, shift: null } }));
        }
        if (isOpen) fetchCurrentShift(true);
    };

    const handleAddMovement = async (e) => {
        e.preventDefault();
        if (!movementAmount || Number(movementAmount) <= 0) {
            toast.error('Ingresa un monto válido');
            return;
        }
        if (!movementReason.trim()) {
            toast.error('Indica el motivo del movimiento');
            return;
        }

        try {
            setProcessing(true);
            const cashMethod = paymentMethods.find(m => 
                (m.id.toLowerCase().includes('cash') || m.id.toLowerCase().includes('efectivo')) &&
                (movementCurrency === 'VES' ? isVesMethod(m, isSingle) : !isVesMethod(m, isSingle))
            );

            const { data } = await api.post('/cash/movement', {
                type: movementType,
                category: movementCategory,
                amount: Number(movementAmount),
                currency: movementCurrency,
                paymentMethodId: cashMethod?.id || 'cash',
                reason: movementReason.trim(),
                registerId: registerId
            });

            toast.success('Movimiento registrado correctamente');

            if (printMovementVoucher && data.movement) {
                printCashMovementReceipt({
                    movement: data.movement,
                    shift: currentShift,
                    user,
                    settings: businessSettings,
                    kickDrawer: true
                });
            } else {
                handleKickDrawer();
            }

            setIsMovementModalOpen(false);
            setMovementAmount('');
            setMovementReason('');
            setMovementCurrency('USD');
            setMovementCategory('EXPENSE');
            await fetchCurrentShift();
        } catch (error) {
            console.error('Error registering movement:', error);
            toast.error(error.response?.data?.error || 'Error al registrar movimiento');
        } finally {
            setProcessing(false);
        }
    };

    const handleKickDrawer = async () => {
        const targetPrinter = localStorage.getItem('pos_station_printer') || businessSettings?.printerName || '';
        if (window.electronAPI) {
            try {
                await window.electronAPI.openDrawer(targetPrinter, businessSettings?.drawerSequence);
                toast.success('Gaveta de dinero abierta');
            } catch (err) {
                console.error("Failed to kick drawer", err);
            }
        } else {
            try {
                await api.post('/settings/open-drawer', {
                    printerName: targetPrinter,
                    sequence: businessSettings?.drawerSequence
                });
                toast.success('Gaveta de dinero abierta');
            } catch (err) {
                console.error("Failed to kick drawer via API", err);
                toast('Gaveta de dinero activada (modo simulación)');
            }
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return formatDateSafe(dateString, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // Category presets for Movement Modal
    const categoryOptions = movementType === 'in' ? [
        { id: 'INCOME', label: 'Ingreso Extraordinario' },
        { id: 'CHANGE_SUPPLY', label: 'Suministro de Cambio' },
        { id: 'PETTY_CASH', label: 'Reposición Caja Chica' },
        { id: 'OTHER', label: 'Otro Ingreso' }
    ] : movementType === 'drop' ? [
        { id: 'DRAWER_DROP', label: 'Retiro a Caja Fuerte / Sangría' }
    ] : [
        { id: 'EXPENSE', label: 'Gasto Operativo' },
        { id: 'SUPPLIER_PAYMENT', label: 'Pago a Proveedor' },
        { id: 'DRAWER_DROP', label: 'Retiro a Caja Fuerte (Sangría)' },
        { id: 'SALARY_ADVANCE', label: 'Adelanto de Sueldo' },
        { id: 'PETTY_CASH', label: 'Gasto Menor / Caja Chica' },
        { id: 'OTHER', label: 'Otro Egreso' }
    ];

    return (
        <>
            <BaseModal 
                isOpen={isOpen} 
                onClose={onClose} 
                maxWidth={!currentShift ? 'max-w-2xl' : 'max-w-5xl'} 
                className="overflow-hidden flex flex-col font-sans"
                disableOutsideClick={true}
            >
                {/* Header */}
                <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-10">
                    <div className="flex items-center gap-2.5 sm:gap-3">
                        <div className="p-2 bg-primary-500/10 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400 rounded-xl border border-primary-500/20 shrink-0">
                            <Banknote size={22} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">Caja Registradora</h2>
                                <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-black rounded-md uppercase shrink-0">
                                    {registerDisplayName || `Caja ${registerId}`}
                                </span>
                            </div>
                            <p className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                {loading ? 'Sincronizando...' : currentShift ? `Turno Activo • ${currentShift.userName}${isDual ? ` • Tasa: ${exchangeRate}` : ''}` : `Caja Cerrada${isDual ? ` • Tasa: ${exchangeRate}` : ''}`}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="min-w-[44px] min-h-[44px] p-2.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-all active:scale-95 flex items-center justify-center shrink-0 cursor-pointer"
                        aria-label="Cerrar modal"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Main Content Area */}
                <div className="p-4 sm:p-8 flex-1 relative min-h-0 overflow-y-auto custom-scrollbar flex flex-col pb-safe">
                    {loading && (
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-slate-500"
                        >
                            <RefreshCcw className="animate-spin mb-4 text-primary-500" size={36} />
                            <span className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Sincronizando Estado Financiero...</span>
                        </motion.div>
                    )}

                    <AnimatePresence mode="wait">
                        {!currentShift ? (
                            /* ==================== CLOSED STATE: OPENING WIZARD ==================== */
                            <motion.div 
                                key="closed-form"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="space-y-5"
                            >
                                {/* Header / Título de la sección */}
                                <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center border border-primary-500/20 shrink-0">
                                            <Coins size={20} />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-slate-900 dark:text-white">
                                                Apertura de Turno de Caja
                                            </h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                                Declara los fondos iniciales en gaveta para habilitar la facturación.
                                            </p>
                                        </div>
                                    </div>
                                    {isDual && exchangeRate > 0 && (
                                        <div className="hidden sm:flex flex-col items-end">
                                            <span className="text-[10px] uppercase font-semibold text-slate-400">Tasa de Cambio</span>
                                            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                                {formatBs(exchangeRate)}/USD
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Banner de Saldo del Turno Anterior (si existe) */}
                                {lastClosedShift && Number(lastClosedShift.finalAmount) > 0 && (
                                    <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-primary-50/70 dark:bg-primary-950/30 border border-primary-200 dark:border-primary-800/50 text-xs">
                                        <span className="text-slate-600 dark:text-slate-300">
                                            Saldo final del turno previo: <strong className="text-primary-700 dark:text-primary-300 font-mono">${Number(lastClosedShift.finalAmount).toFixed(2)} USD</strong>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleApplyLastShiftBalance}
                                            className="px-2.5 py-1 rounded-lg bg-primary-600 text-white font-semibold text-[11px] hover:bg-primary-700 transition-colors cursor-pointer shadow-2xs"
                                        >
                                            Cargar Saldo Previo
                                        </button>
                                    </div>
                                )}

                                {/* Selector de Modo de Declaración (Segmented Control) */}
                                <div className="flex p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <button
                                        type="button"
                                        onClick={() => setOpenMode('DIRECT')}
                                        className={`flex-1 py-2 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                            openMode === 'DIRECT' 
                                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold' 
                                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        <Coins size={14} className={openMode === 'DIRECT' ? 'text-primary-500' : ''} />
                                        <span>Monto Directo</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOpenMode('DENOMINATIONS')}
                                        className={`flex-1 py-2 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                            openMode === 'DENOMINATIONS' 
                                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold' 
                                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        <Calculator size={14} className={openMode === 'DENOMINATIONS' ? 'text-primary-500' : ''} />
                                        <span>Conteo por Billetes</span>
                                    </button>
                                </div>

                                <form onSubmit={handleOpenShift} className="space-y-4">
                                    {/* Ficha de Estación y Cajero */}
                                    <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-700/80 space-y-3">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {/* Terminal / Punto de Venta */}
                                            <div>
                                                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mb-1">
                                                    <Monitor size={13} className="text-slate-400" />
                                                    <span>Terminal / Punto de Venta</span>
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={registerNameInput}
                                                        onChange={(e) => setRegisterNameInput(e.target.value)}
                                                        className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-primary-500 transition-colors shadow-2xs"
                                                        placeholder="Nombre de Caja (ej. Caja 1)"
                                                    />
                                                    <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1.5 rounded-lg shrink-0" title="ID de Hardware">
                                                        #{registerId}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Cajero Responsable */}
                                            <div>
                                                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mb-1">
                                                    <User size={13} className="text-slate-400" />
                                                    <span>Cajero Responsable</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={cashierNameInput}
                                                    onChange={(e) => setCashierNameInput(e.target.value)}
                                                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-primary-500 transition-colors shadow-2xs"
                                                    placeholder="Nombre del cajero"
                                                />
                                            </div>
                                        </div>

                                        {/* Modo de Estación */}
                                        <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                                <Store size={14} className="text-slate-400 shrink-0" />
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400">Modo de Estación:</span>
                                                <span className="font-semibold text-slate-700 dark:text-slate-200">
                                                    {(allowedCategories?.length > 0 || allowedProducts?.length > 0) 
                                                        ? `Especializada (${[
                                                            allowedCategories?.length > 0 ? `${allowedCategories.length} cat(s)` : '',
                                                            allowedProducts?.length > 0 ? `${allowedProducts.length} prod(s)` : ''
                                                          ].filter(Boolean).join(' • ')})` 
                                                        : 'Catálogo General (Ventas completas)'}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowStationConfig(!showStationConfig)}
                                                className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                                            >
                                                {showStationConfig ? 'Ocultar' : 'Configurar'}
                                            </button>
                                        </div>

                                        {showStationConfig && (
                                            <StationConfigPanel
                                                currentShiftId={currentShift?.id}
                                                registerId={registerId}
                                                allowedCategories={allowedCategories}
                                                setAllowedCategories={setAllowedCategories}
                                                allowedProducts={allowedProducts}
                                                setAllowedProducts={setAllowedProducts}
                                                onClose={() => setShowStationConfig(false)}
                                            />
                                        )}
                                    </div>

                                    {/* Direct Mode Inputs */}
                                    {openMode === 'DIRECT' ? (
                                        <div className="space-y-3">
                                            <div className={`grid ${isSingle ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} gap-3.5`}>
                                                {!isVesOnly && (
                                                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 space-y-2 shadow-2xs">
                                                        <div className="flex items-center justify-between">
                                                            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                                                Dólares en Efectivo
                                                            </label>
                                                            <span className="text-[10px] font-bold text-slate-500 uppercase bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                                                                USD
                                                            </span>
                                                        </div>
                                                        <div className="relative">
                                                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-lg">$</span>
                                                            <input
                                                                type="number"
                                                                inputMode="decimal"
                                                                step="any"
                                                                min="0"
                                                                value={amountInputUsd}
                                                                onChange={(e) => setAmountInputUsd(e.target.value)}
                                                                className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-lg font-bold font-mono text-slate-900 dark:text-white outline-none focus:border-primary-500 focus:bg-white dark:focus:bg-slate-900 transition-all"
                                                                placeholder="0.00"
                                                            />
                                                        </div>

                                                        {/* Quick Chips */}
                                                        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                                                            {[10, 20, 50, 100].map(val => (
                                                                <button
                                                                    key={val}
                                                                    type="button"
                                                                    onClick={() => setAmountInputUsd(String((parseFloat(amountInputUsd) || 0) + val))}
                                                                    className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[11px] transition-colors cursor-pointer"
                                                                >
                                                                    +${val}
                                                                </button>
                                                            ))}
                                                            {amountInputUsd && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setAmountInputUsd('')}
                                                                    className="px-2 py-0.5 rounded-md bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold text-[11px] transition-colors cursor-pointer"
                                                                >
                                                                    Limpiar
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                {!isUsdOnly && (
                                                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 space-y-2 shadow-2xs">
                                                        <div className="flex items-center justify-between">
                                                            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                                                Bolívares en Efectivo
                                                            </label>
                                                            <span className="text-[10px] font-bold text-slate-500 uppercase bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                                                                VES
                                                            </span>
                                                        </div>
                                                        <div className="relative">
                                                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">Bs.</span>
                                                            <input
                                                                type="number"
                                                                inputMode="decimal"
                                                                step="any"
                                                                min="0"
                                                                value={amountInputVes}
                                                                onChange={(e) => setAmountInputVes(e.target.value)}
                                                                className="w-full pl-10 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-lg font-bold font-mono text-slate-900 dark:text-white outline-none focus:border-primary-500 focus:bg-white dark:focus:bg-slate-900 transition-all"
                                                                placeholder="0.00"
                                                            />
                                                        </div>

                                                        {/* Quick Chips */}
                                                        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                                                            {[100, 500, 1000].map(val => (
                                                                <button
                                                                    key={val}
                                                                    type="button"
                                                                    onClick={() => setAmountInputVes(String((parseFloat(amountInputVes) || 0) + val))}
                                                                    className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[11px] transition-colors cursor-pointer"
                                                                >
                                                                    +{val} Bs
                                                                </button>
                                                            ))}
                                                            {amountInputVes && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setAmountInputVes('')}
                                                                    className="px-2 py-0.5 rounded-md bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold text-[11px] transition-colors cursor-pointer"
                                                                >
                                                                    Limpiar
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Resumen de Fondo Consolidado */}
                                            <div className="px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between text-xs">
                                                <span className="text-slate-500 dark:text-slate-400 font-medium">Fondo Total Declarado:</span>
                                                <div className="flex items-center gap-2 font-mono font-bold">
                                                    <span className="text-sm text-slate-900 dark:text-white">
                                                        ${((parseFloat(amountInputUsd) || 0) + ((parseFloat(amountInputVes) || 0) / (exchangeRate || 1))).toFixed(2)} USD
                                                    </span>
                                                    {isDual && (
                                                        <span className="text-slate-400 text-xs">
                                                            ≈ {formatBs(((parseFloat(amountInputUsd) || 0) * (exchangeRate || 1)) + (parseFloat(amountInputVes) || 0))}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Denominations Mode */
                                        <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div className="space-y-2">
                                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Billetes en Dólares ($)</p>
                                                    {['100', '50', '20', '10', '5', '1'].map(bill => (
                                                        <div key={bill} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/80 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">${bill}</span>
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setOpenDenomsUsd(prev => ({ ...prev, [bill]: (prev[bill] || 0) + 1 }))}
                                                                    className="px-2 py-0.5 bg-white dark:bg-slate-700 text-[10px] font-bold rounded border border-slate-200 dark:border-slate-600 cursor-pointer"
                                                                >
                                                                    +1
                                                                </button>
                                                                <input
                                                                    type="number"
                                                                    inputMode="numeric"
                                                                    pattern="[0-9]*"
                                                                    min="0"
                                                                    value={openDenomsUsd[bill] || ''}
                                                                    onChange={(e) => setOpenDenomsUsd({ ...openDenomsUsd, [bill]: parseInt(e.target.value) || 0 })}
                                                                    className="w-14 text-right bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-xs font-bold outline-none"
                                                                    placeholder="0"
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="space-y-2">
                                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Monedas / Fracción ($)</p>
                                                    <div className="bg-slate-50 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                                                        <label className="text-[10px] font-semibold text-slate-500 uppercase">Monto Total Suelto ($)</label>
                                                        <input
                                                            type="number"
                                                            inputMode="decimal"
                                                            step="0.01"
                                                            min="0"
                                                            value={openDenomsUsd.looseCoins || ''}
                                                            onChange={(e) => setOpenDenomsUsd({ ...openDenomsUsd, looseCoins: parseFloat(e.target.value) || 0 })}
                                                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 font-bold text-sm"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                    <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-500/20 text-center">
                                                        <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Total Calculado</p>
                                                        <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 font-mono mt-0.5">
                                                            ${denomsUsdTotal().toFixed(2)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Opciones Operativas (Sin Emojis) */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setPrintOpeningTicketOnStart(!printOpeningTicketOnStart)}
                                            className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                                                printOpeningTicketOnStart
                                                    ? 'bg-primary-500/[0.06] border-primary-500/80 ring-1 ring-primary-500/30 text-slate-900 dark:text-white'
                                                    : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div className={`p-2 rounded-lg ${printOpeningTicketOnStart ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                                                    <Printer size={15} />
                                                </div>
                                                <span className="text-xs font-semibold">Imprimir Comprobante</span>
                                            </div>
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${printOpeningTicketOnStart ? 'bg-primary-500 border-primary-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                                {printOpeningTicketOnStart && <Check size={12} strokeWidth={3} />}
                                            </div>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setKickDrawerOnStart(!kickDrawerOnStart)}
                                            className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                                                kickDrawerOnStart
                                                    ? 'bg-primary-500/[0.06] border-primary-500/80 ring-1 ring-primary-500/30 text-slate-900 dark:text-white'
                                                    : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div className={`p-2 rounded-lg ${kickDrawerOnStart ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                                                    <Unlock size={15} />
                                                </div>
                                                <span className="text-xs font-semibold">Abrir Gaveta al Iniciar</span>
                                            </div>
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${kickDrawerOnStart ? 'bg-primary-500 border-primary-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                                {kickDrawerOnStart && <Check size={12} strokeWidth={3} />}
                                            </div>
                                        </button>
                                    </div>

                                    {/* Botón Principal */}
                                    <button
                                        type="submit"
                                        disabled={processing}
                                        className="w-full h-11 bg-primary-600 hover:bg-primary-700 active:scale-95 text-white font-bold rounded-xl transition-all shadow-sm text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                    >
                                        {processing ? (
                                            <RefreshCcw size={16} className="animate-spin" />
                                        ) : (
                                            <>
                                                <CheckCircle size={16} />
                                                <span>Confirmar Apertura e Iniciar Turno</span>
                                            </>
                                        )}
                                    </button>
                                </form>
                            </motion.div>
                        ) : (
                            /* ==================== OPEN STATE: DASHBOARD ==================== */
                            <motion.div 
                                key="open-dashboard"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="space-y-6"
                            >
                                {/* TABS NAVIGATION */}
                                <div className="flex gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg border border-slate-200 dark:border-slate-700 w-full sm:w-fit overflow-x-auto no-scrollbar scroll-smooth">
                                    <button
                                        onClick={() => { setActiveTab('operaciones'); fetchCurrentShift(); }}
                                        className={`shrink-0 px-3.5 py-2 rounded-md font-bold text-xs transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'operaciones' ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-2xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                                    >
                                        <Banknote size={14} /> OPERACIONES EN VIVO
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('corte_x')}
                                        className={`shrink-0 px-3.5 py-2 rounded-md font-bold text-xs transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'corte_x' ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-2xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                                    >
                                        <FileText size={14} /> CORTE X (PARCIAL)
                                    </button>
                                    <button
                                        onClick={() => { setActiveTab('historial'); setSelectedHistoryShift(null); }}
                                        className={`shrink-0 px-3.5 py-2 rounded-md font-bold text-xs transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'historial' ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-2xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                                    >
                                        <History size={14} /> HISTORIAL / CIERRES Z
                                    </button>
                                </div>

                                {activeTab === 'operaciones' && (
                                    <div className="space-y-5">
                                        {/* Status & Actions Hero Bar */}
                                        <div className="bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col md:flex-row justify-between items-center gap-4 shadow-xs">
                                            <div className="flex items-center gap-3 w-full">
                                                <div className="h-10 w-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                                                    <Clock size={20} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                                        <h3 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-tight">Turno en Curso</h3>
                                                    </div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                                        Cajero: <strong className="text-slate-800 dark:text-slate-200">{currentShift.userName}</strong> • Apertura: {new Date(currentShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
                                                <button
                                                    onClick={handleKickDrawer}
                                                    className="px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                                    title="Abrir gaveta de dinero"
                                                >
                                                    <Unlock size={14} className="text-slate-500" />
                                                    <span>Gaveta</span>
                                                </button>
                                                <button
                                                    onClick={() => setIsMovementModalOpen(true)}
                                                    className="px-3.5 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                                >
                                                    <Plus size={15} />
                                                    <span>Movimiento / Vale</span>
                                                </button>
                                                <button
                                                    onClick={() => setIsCloseShiftModalOpen(true)}
                                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 uppercase tracking-wider shadow-2xs cursor-pointer"
                                                >
                                                    <Lock size={14} />
                                                    <span>Cerrar Caja</span>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Modo de Estación (Configuración activa en caliente) */}
                                        <div className="bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 rounded-xl p-3.5 space-y-3">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="p-2 bg-amber-500/20 text-amber-800 dark:text-amber-300 rounded-lg">
                                                        <Store size={18} />
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 block">Modo de Estación (Esta PC)</span>
                                                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                                            {(allowedCategories?.length > 0 || allowedProducts?.length > 0) ? (
                                                                <>Estación Especializada: <span className="text-amber-700 dark:text-amber-400 font-black">
                                                                    {[
                                                                        allowedCategories?.length > 0 ? `Categorías: ${allowedCategories.join(', ')}` : '',
                                                                        allowedProducts?.length > 0 ? `${allowedProducts.length} producto(s) específico(s)` : ''
                                                                    ].filter(Boolean).join(' • ')}
                                                                </span></>
                                                            ) : (
                                                                'Catálogo General (Vende todo el inventario sin restricción)'
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowStationConfig(!showStationConfig)}
                                                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer self-start sm:self-auto shrink-0"
                                                >
                                                    {showStationConfig ? 'Ocultar' : 'Configurar Estación'}
                                                </button>
                                            </div>

                                            {showStationConfig && (
                                                <StationConfigPanel
                                                    currentShiftId={currentShift?.id}
                                                    registerId={registerId}
                                                    allowedCategories={allowedCategories}
                                                    setAllowedCategories={setAllowedCategories}
                                                    allowedProducts={allowedProducts}
                                                    setAllowedProducts={setAllowedProducts}
                                                    onClose={() => setShowStationConfig(false)}
                                                />
                                            )}
                                        </div>

                                        {/* Metric Cards Grid */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                            {/* Efectivo Gaveta USD */}
                                            <div className="bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Efectivo en Gaveta ($)</span>
                                                    <div className="p-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-md">
                                                        <DollarSign size={14} />
                                                    </div>
                                                </div>
                                                <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                                                    ${(Number(currentShift?.expectedCashUsd) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                                <p className="text-[10px] font-medium text-slate-400 mt-1">
                                                    Base inicial: ${Number(currentShift?.initialAmount || 0).toFixed(2)}
                                                </p>
                                            </div>

                                            {/* Efectivo Gaveta VES */}
                                            {!isSingle && (
                                                <div className="bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Efectivo en Gaveta (Bs)</span>
                                                        <div className="p-1 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 rounded-md">
                                                            <Banknote size={14} />
                                                        </div>
                                                    </div>
                                                    <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                                                        Bs. {(Number(currentShift?.expectedCashBs) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-[10px] font-medium text-slate-400 mt-1">
                                                        ~ ${((Number(currentShift?.expectedCashBs) || 0) / exchangeRate).toFixed(2)} USD
                                                    </p>
                                                </div>
                                            )}

                                            {/* Total Ventas del Turno */}
                                            <div className="bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Ventas</span>
                                                    <div className="p-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md">
                                                        <Receipt size={14} />
                                                    </div>
                                                </div>
                                                <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                                                    ${(Number(currentShift?.totalSalesAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                                <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 mt-1">
                                                    {currentShift?.salesCount || 0} operaciones facturadas
                                                </p>
                                            </div>

                                            {/* Salidas / Gastos */}
                                            <div className="bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Movimientos Netos</span>
                                                    <div className="p-1 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-md">
                                                        <ArrowUpRight size={14} />
                                                    </div>
                                                </div>
                                                <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                                                    {(currentShift?.CashMovements || currentShift?.movements || []).length} movs
                                                </p>
                                                <p className="text-[10px] font-medium text-slate-400 mt-1">
                                                    Ingresos y egresos en gaveta
                                                </p>
                                            </div>
                                        </div>

                                        {/* Sales by Payment Method Bar */}
                                        <div className="space-y-2">
                                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Desglose por Métodos de Pago</span>
                                            <div className="flex overflow-x-auto gap-2.5 pb-2 custom-scrollbar">
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

                                                    const eb = currentShift?.expectedBreakdown || {};
                                                    const pbn = currentShift?.paymentBreakdownNative || currentShift?.paymentBreakdown || {};
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

                                                    if (isSingle && isVesMethod(pm)) return null;
                                                    const isVes = isVesMethod(pm, isSingle);
                                                    const usdRef = isVes ? valNative / exchangeRate : valNative;
                                                    if (valNative === 0 && !pm.id.includes('cash')) return null;

                                                    return (
                                                        <div key={pm.id} className="min-w-[140px] bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex flex-col gap-1 shadow-2xs">
                                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                                <div className="p-1 rounded bg-white dark:bg-slate-800 text-slate-500">
                                                                    {pm.id.includes('cash') ? <DollarSign size={13} /> : <CreditCard size={13} />}
                                                                </div>
                                                                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase truncate">{pm.name}</span>
                                                            </div>
                                                            <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                                                                {isVes ? `Bs. ${valNative.toLocaleString(undefined, { minimumFractionDigits: 0 })}` : `$${valNative.toFixed(2)}`}
                                                            </span>
                                                            {isVes && (
                                                                <span className="text-[9px] text-slate-400 font-mono">~ ${usdRef.toFixed(2)} USD</span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Live Activity & Movements Timeline */}
                                        <div className="bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-2xs">
                                            <div className="flex justify-between items-center mb-3">
                                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                                    Auditoría de Movimientos en Vivo
                                                </h4>
                                                <button
                                                    onClick={() => setIsMovementModalOpen(true)}
                                                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <Plus size={14} /> Registrar Movimiento
                                                </button>
                                            </div>

                                            <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                                                {(currentShift.CashMovements || currentShift.movements || []).length === 0 ? (
                                                    <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-wider">
                                                        No hay movimientos manuales registrados en este turno
                                                    </div>
                                                ) : (
                                                    [...(currentShift.CashMovements || currentShift.movements || [])].reverse().map((m, i) => {
                                                        const isIncome = m.type === 'in';
                                                        return (
                                                            <div key={m.id || i} className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-4">
                                                                <div className="flex items-center gap-3">
                                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isIncome ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                                        {isIncome ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-xs font-black text-slate-900 dark:text-white">
                                                                            {m.reason || 'Sin motivo'}
                                                                        </p>
                                                                        <p className="text-[10px] text-slate-500 font-bold uppercase">
                                                                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {m.category || (isIncome ? 'Ingreso' : 'Egreso')}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <span className={`text-sm font-black font-mono ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                                        {isIncome ? '+' : '-'}{m.currency === 'VES' ? formatBs(m.amount) : formatUSD(m.amount)}
                                                                    </span>
                                                                    <button
                                                                        onClick={() => printCashMovementReceipt({ movement: m, shift: currentShift, user, settings: businessSettings })}
                                                                        className="p-1.5 text-slate-400 hover:text-primary-500 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                                                        title="Reimprimir Vale Térmico"
                                                                    >
                                                                        <Receipt size={16} />
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

                                {activeTab === 'corte_x' && (
                                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                        {xReport ? (
                                            <CashShiftDetails 
                                                shift={xReport} 
                                                title="CORTE X (ARQUEO PARCIAL)" 
                                                paymentMethods={paymentMethods} 
                                                exchangeRate={exchangeRate}
                                                onPrint={() => printXReportReceipt({ shift: xReport, stats: xReport, settings: businessSettings })}
                                            />
                                        ) : (
                                            <div className="py-20 text-center text-slate-400">
                                                <RefreshCcw className="animate-spin mx-auto mb-3" size={32} />
                                                <p className="text-xs font-black uppercase tracking-widest">Generando Corte X...</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'historial' && (
                                    <div className="space-y-6">
                                        {!selectedHistoryShift ? (
                                            <div className="space-y-4">
                                                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                                                    <span className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">Filtrar por Rango de Fechas:</span>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="date"
                                                            value={startDate}
                                                            onChange={(e) => setStartDate(e.target.value)}
                                                            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none"
                                                        />
                                                        <span className="text-xs text-slate-400">-</span>
                                                        <input
                                                            type="date"
                                                            value={endDate}
                                                            onChange={(e) => setEndDate(e.target.value)}
                                                            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none"
                                                        />
                                                        {(startDate || endDate) && (
                                                            <button
                                                                onClick={() => { setStartDate(''); setEndDate(''); }}
                                                                className="px-2.5 py-1.5 text-xs text-red-500 font-black hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors"
                                                            >
                                                                Limpiar
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {historyLoading ? (
                                                    <div className="py-20 text-center text-slate-400">
                                                        <RefreshCcw className="animate-spin mx-auto mb-3" size={32} />
                                                        <p className="text-xs font-black uppercase tracking-widest">Cargando Historial...</p>
                                                    </div>
                                                ) : historyShifts.length === 0 ? (
                                                    <div className="text-center py-12 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-400 text-xs font-bold uppercase tracking-wider">
                                                        No hay cierres registrados en el periodo seleccionado
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {historyShifts.map(s => {
                                                            const diff = Number(s.difference) || 0;
                                                            const isMatch = diff === 0;
                                                            return (
                                                                <div
                                                                    key={s.id}
                                                                    onClick={() => setSelectedHistoryShift(s)}
                                                                    className="bg-white dark:bg-slate-900/60 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors flex items-center justify-between group shadow-2xs"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={`w-9 h-9 rounded-md flex items-center justify-center ${isMatch ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800'}`}>
                                                                            <FileText size={17} />
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase">
                                                                                Cierre #{s.id.substring(0, 8)} • {s.user?.name || s.userName || 'Cajero'}
                                                                            </p>
                                                                            <p className="text-[10px] font-mono text-slate-400">
                                                                                {formatDate(s.closedAt)}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <span className="text-sm font-bold font-mono block text-slate-900 dark:text-white">
                                                                            ${Number(s.finalAmount || 0).toFixed(2)}
                                                                        </span>
                                                                        <span className={`text-[10px] font-bold uppercase ${isMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                                            {isMatch ? 'Cuadrado' : `Dif: ${diff > 0 ? '+' : ''}$${diff.toFixed(2)}`}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div>
                                                <button
                                                    onClick={() => setSelectedHistoryShift(null)}
                                                    className="mb-4 text-xs font-black text-primary-600 dark:text-primary-400 uppercase tracking-wider hover:underline"
                                                >
                                                    ← Volver al listado
                                                </button>
                                                <CashShiftDetails 
                                                    shift={selectedHistoryShift} 
                                                    title="DETALLE DE CIERRE FISCAL" 
                                                    paymentMethods={paymentMethods} 
                                                    exchangeRate={exchangeRate}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </BaseModal>

            {/* Movement Modal */}
            <BaseModal
                isOpen={isMovementModalOpen}
                onClose={() => setIsMovementModalOpen(false)}
                maxWidth="max-w-md"
                zIndex="z-[1100]"
                className="p-6 font-sans"
            >
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                        Nuevo Movimiento de Caja
                    </h3>
                    <button 
                        onClick={() => setIsMovementModalOpen(false)}
                        className="p-1.5 text-slate-400 hover:text-red-500 rounded-xl"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleAddMovement} className="space-y-5">
                    {/* Type Buttons */}
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => { setMovementType('in'); setMovementCategory('INCOME'); }}
                            className={`py-2.5 px-2 rounded-xl font-bold text-xs uppercase tracking-wider border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                movementType === 'in'
                                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-black ring-1 ring-emerald-500/30'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                        >
                            <ArrowDownLeft size={14} />
                            <span>Ingreso</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { setMovementType('expense'); setMovementCategory('EXPENSE'); }}
                            className={`py-2.5 px-2 rounded-xl font-bold text-xs uppercase tracking-wider border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                movementType === 'expense'
                                    ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-black ring-1 ring-rose-500/30'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                        >
                            <ArrowUpRight size={14} />
                            <span>Egreso</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { setMovementType('drop'); setMovementCategory('DRAWER_DROP'); }}
                            className={`py-2.5 px-2 rounded-xl font-bold text-xs uppercase tracking-wider border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                movementType === 'drop'
                                    ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-black ring-1 ring-amber-500/30'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                        >
                            <Building2 size={14} />
                            <span>Sangría</span>
                        </button>
                    </div>

                    {/* Category Selector */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Categoría del Movimiento</label>
                        <select
                            value={movementCategory}
                            onChange={(e) => setMovementCategory(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none text-slate-800 dark:text-white"
                        >
                            {categoryOptions.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Currency & Amount */}
                    <div className="grid grid-cols-3 gap-3">
                        {!isSingle && (
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Moneda</label>
                                <select
                                    value={movementCurrency}
                                    onChange={(e) => setMovementCurrency(e.target.value)}
                                    className="w-full px-3 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-black outline-none"
                                >
                                    <option value="USD">USD ($)</option>
                                    <option value="VES">VES (Bs)</option>
                                </select>
                            </div>
                        )}
                        <div className={`space-y-1 ${isSingle ? 'col-span-3' : 'col-span-2'}`}>
                            <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Monto</label>
                            <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                min="0"
                                required
                                value={movementAmount}
                                onChange={(e) => setMovementAmount(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-black font-mono outline-none focus:border-primary-500"
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    {/* Reason */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Motivo / Justificación</label>
                        <textarea
                            required
                            rows="2"
                            value={movementReason}
                            onChange={(e) => setMovementReason(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none resize-none focus:border-primary-500"
                            placeholder="Ej. Pago a distribuidor de lácteos..."
                        />
                    </div>

                    {/* Print Voucher Option */}
                    <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                        <input
                            type="checkbox"
                            checked={printMovementVoucher}
                            onChange={(e) => setPrintMovementVoucher(e.target.checked)}
                            className="w-4 h-4 accent-primary-600 rounded"
                        />
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Printer size={13} className="text-slate-500" />
                            <span>Imprimir Vale Térmico Inmediato</span>
                        </span>
                    </label>

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={processing}
                        className="w-full py-3.5 sm:py-4 min-h-[48px] bg-primary-600 hover:bg-primary-700 text-white font-black rounded-2xl uppercase tracking-widest text-xs shadow-xl shadow-primary-600/20 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                    >
                        {processing ? 'Guardando...' : 'REGISTRAR MOVIMIENTO'}
                    </button>
                </form>
            </BaseModal>

            {/* Z Report Modal */}
            <ZReportModal 
                isOpen={isZReportOpen} 
                onClose={() => { setIsZReportOpen(false); onClose(); }} 
                shift={closedShiftReport} 
                businessSettings={businessSettings} 
                exchangeRate={exchangeRate} 
                paymentMethods={paymentMethods}
                currencyMode={currencyMode}
            />

            {/* Close Shift Modal */}
            {currentShift && (
                <CloseShiftModal
                    isOpen={isCloseShiftModalOpen}
                    onClose={() => setIsCloseShiftModalOpen(false)}
                    currentShift={currentShift}
                    onSuccess={handleCloseShiftSuccess}
                    businessSettings={businessSettings}
                    paymentMethods={paymentMethods}
                    exchangeRate={exchangeRate}
                    currencyMode={currencyMode}
                />
            )}
        </>
    );
}
