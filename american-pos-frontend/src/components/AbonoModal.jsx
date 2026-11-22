import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
    X, 
    Save, 
    Banknote, 
    CreditCard, 
    DollarSign, 
    Calendar, 
    CheckCircle2, 
    Circle, 
    Wallet, 
    Send, 
    RefreshCcw, 
    QrCode, 
    Copy, 
    Check, 
    Maximize2, 
    Minimize2, 
    Building2, 
    Receipt, 
    Calculator, 
    MessageCircle, 
    CheckCheck, 
    Coins, 
    ShieldCheck
} from 'lucide-react';
import api from '../services/api';
import ConfirmModal from './ConfirmModal';
import {
    formatBs, 
    getGlobalSettings, 
    isSingleCurrencyMode, 
    isDollarOnlyCountry, 
    precisionRound
} from '../utils/format';
import { generateBinanceQR } from '../utils/binanceQR';
import BaseModal from './BaseModal';

export default function AbonoModal({ isOpen, onClose, onSave, customer = null, processing = false }) {
    // 🖥️ Modo de visualización: Gran Formato por defecto o Pantalla Completa Total
    const [isFullScreen, setIsFullScreen] = useState(false);

    // Formulario contable
    const [formData, setFormData] = useState({
        amount: '',
        method: 'cash',
        notes: 'Abono manual a cuenta de cliente'
    });

    // Facturas / Ventas pendientes a crédito
    const [pendingSales, setPendingSales] = useState([]);
    const [selectedSaleIds, setSelectedSaleIds] = useState([]);
    const [loadingSales, setLoadingSales] = useState(false);

    // 🪙 Parámetros para Binance Pay (USDT)
    const [binanceRate, setBinanceRate] = useState(0);
    const [loadingBinanceRate, setLoadingBinanceRate] = useState(false);
    const [binanceConfig, setBinanceConfig] = useState({ payId: '', email: '', qrImage: '', qrMode: 'AUTO' });
    const [binanceQrUrl, setBinanceQrUrl] = useState('');
    const [showBinanceQr, setShowBinanceQr] = useState(false);

    // 📱 Parámetros de la empresa (Pago Móvil / Transferencias / Zelle)
    const [businessInfo, setBusinessInfo] = useState({
        name: '',
        rif: '',
        phone: '',
        pagoMovilBank: '',
        pagoMovilPhone: '',
        pagoMovilId: '',
        zelleEmail: ''
    });

    // Referencia de la transacción (bancaria o de Binance)
    const [reference, setReference] = useState('');
    const [copiedField, setCopiedField] = useState(null);

    // 💵 Calculadora rápida de cambio/vuelto para pagos en efectivo
    const [cashReceived, setCashReceived] = useState('');

    // Modal de confirmación para abonos que exceden deuda
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        action: null,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar'
    });

    // Configuración general del sistema y tasas
    const globalSettings = getGlobalSettings();
    const exchangeRate = Number(globalSettings?.exchangeRate || globalSettings?.rate || 1);
    const effectiveBinanceRate = binanceRate > 0 ? binanceRate : exchangeRate;

    // Consultar configuraciones financieras de la empresa y Binance
    const fetchFinancialSettings = useCallback(async () => {
        try {
            const [binanceRes, businessRes] = await Promise.allSettled([
                api.get('/settings/binance'),
                api.get('/settings/business')
            ]);

            if (binanceRes.status === 'fulfilled' && binanceRes.value.data) {
                const b = binanceRes.value.data;
                setBinanceConfig({
                    payId: b.payId || '',
                    email: b.email || '',
                    qrImage: b.qrImage || '',
                    qrMode: b.qrMode || 'AUTO'
                });
                if (b.rate && Number(b.rate) > 0) {
                    setBinanceRate(Number(b.rate));
                }
            }

            if (businessRes.status === 'fulfilled' && businessRes.value.data) {
                const bInfo = businessRes.value.data;
                setBusinessInfo({
                    name: bInfo.name || '',
                    rif: bInfo.rif || '',
                    phone: bInfo.phone || '',
                    pagoMovilBank: bInfo.pagoMovilBank || '',
                    pagoMovilPhone: bInfo.pagoMovilPhone || bInfo.phone || '',
                    pagoMovilId: bInfo.pagoMovilId || bInfo.rif || '',
                    zelleEmail: bInfo.zelleEmail || bInfo.email || ''
                });
            }
        } catch (caughtErr) { console.warn('[AbonoModal] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
    }, []);

    // Cargar historial de ventas a crédito pendientes del cliente
    const fetchPendingSales = useCallback(async () => {
        if (!customer?.id) return;
        try {
            setLoadingSales(true);
            const { data } = await api.get(`/sales?customerId=${customer.id}&paymentMethod=fiado&status=completed`);
            const sales = data.data || [];
            const filtered = sales.filter(s => s.paymentStatus !== 'paid');
            setPendingSales(filtered);
        } catch (error) {
            console.error('Error fetching pending sales:', error);
        } finally {
            setLoadingSales(false);
        }
    }, [customer?.id]);

    // Reset y carga al abrir el modal
    useEffect(() => {
        if (isOpen) {
            setFormData({
                amount: '',
                method: 'cash',
                notes: 'Abono manual a cuenta de cliente'
            });
            setPendingSales([]);
            setSelectedSaleIds([]);
            setReference('');
            setCashReceived('');
            setShowBinanceQr(false);

            if (customer?.id) {
                fetchPendingSales();
            }
            fetchFinancialSettings();
        }
    }, [isOpen, customer?.id, fetchPendingSales, fetchFinancialSettings]);

    // Actualizar tasa P2P de Binance en vivo
    const handleFetchLiveBinanceRate = async () => {
        try {
            setLoadingBinanceRate(true);
            const res = await api.get('/settings/binance/rate');
            if (res.data && res.data.rate) {
                const newRate = Number(res.data.rate);
                setBinanceRate(newRate);
                toast.success(`Tasa Binance P2P actualizada: ${newRate.toFixed(2)} Bs/USDT`);
            } else {
                toast.error('No se pudo obtener la tasa en vivo');
            }
        } catch (err) {
            console.warn('[AbonoModal] Error capturado en operación:', err?.message || err);
            toast.error('Error al consultar tasa P2P');
        } finally {
            setLoadingBinanceRate(false);
        }
    };

    // Helper ultra-resiliente para obtener el importe real y seguro de una venta
    const getSaleAmount = (sale) => {
        if (!sale) return 0;
        const t = parseFloat(sale.total);
        if (!isNaN(t) && t > 0) return t;
        const s = parseFloat(sale.subtotal);
        if (!isNaN(s) && s > 0) return s;
        let pms = sale.paymentMethods;
        if (typeof pms === 'string') {
            try { pms = JSON.parse(pms); } catch (caughtErr) { console.warn('[AbonoModal] Error parseando JSON local:', caughtErr?.message || caughtErr); }
        }
        if (Array.isArray(pms) && pms.length > 0) {
            const pmSum = pms.reduce((acc, p) => acc + (parseFloat(p?.amount) || 0), 0);
            if (pmSum > 0) return pmSum;
        }
        const alt = parseFloat(sale.amount || sale.totalAmount);
        if (!isNaN(alt) && alt > 0) return alt;
        return 0;
    };

    // Manejo de selección de facturas vinculadas
    const toggleSaleSelection = (sale) => {
        const isSelected = selectedSaleIds.includes(sale.id);
        const newSelection = isSelected 
            ? selectedSaleIds.filter(id => id !== sale.id)
            : [...selectedSaleIds, sale.id];
        
        setSelectedSaleIds(newSelection);

        // Sumar automáticamente el importe de las facturas seleccionadas
        const newTotal = pendingSales
            .filter(s => newSelection.includes(s.id))
            .reduce((sum, s) => sum + getSaleAmount(s), 0);
        
        const cleanTotal = precisionRound(newTotal, 2);
        
        setFormData(prev => ({
            ...prev,
            amount: cleanTotal > 0 ? cleanTotal.toFixed(2) : ''
        }));
    };

    const handleSelectAllSales = () => {
        if (selectedSaleIds.length === pendingSales.length) {
            setSelectedSaleIds([]);
            setFormData(prev => ({ ...prev, amount: '' }));
        } else {
            const allIds = pendingSales.map(s => s.id);
            setSelectedSaleIds(allIds);
            const total = pendingSales.reduce((sum, s) => sum + getSaleAmount(s), 0);
            setFormData(prev => ({ ...prev, amount: precisionRound(total, 2).toFixed(2) }));
        }
    };

    // Accesos rápidos de monto basados en la deuda
    const currentDebt = Number(customer?.creditBalance) || 0;

    const handleSetFullDebt = () => {
        if (currentDebt > 0) {
            setFormData(prev => ({ ...prev, amount: currentDebt.toFixed(2) }));
        }
    };

    const handleSetHalfDebt = () => {
        if (currentDebt > 0) {
            setFormData(prev => ({ ...prev, amount: (currentDebt / 2).toFixed(2) }));
        }
    };

    const handleAddAmount = (addVal) => {
        const current = parseFloat(formData.amount || 0);
        const next = precisionRound(current + addVal, 2);
        setFormData(prev => ({ ...prev, amount: next.toFixed(2) }));
    };

    // Entrada de datos del formulario
    const handleChange = (e) => {
        let { name, value } = e.target;
        if (name === 'amount' && typeof value === 'string') {
            value = value.replace(',', '.');
        }
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Cálculos dinámicos
    const amountNum = parseFloat(formData.amount || 0) || 0;
    const amountBsEquivalent = precisionRound(amountNum * exchangeRate, 2);
    const amountUsdtEquivalent = effectiveBinanceRate > 0 ? precisionRound(amountBsEquivalent / effectiveBinanceRate, 2) : amountNum;

    // Simulación contable de balance proyectado
    const projectedBalance = precisionRound(currentDebt - amountNum, 2);
    const isFullyPaid = projectedBalance <= 0.001 && amountNum > 0;
    const isOverpaid = projectedBalance < -0.001;

    // Cálculo de vuelto en efectivo
    const cashReceivedNum = parseFloat(cashReceived || 0) || 0;
    const isVesMethod = formData.method === 'cash_bs' || formData.method === 'pago_movil';
    const requiredAmountForCash = isVesMethod ? amountBsEquivalent : amountNum;
    const cashChange = precisionRound(cashReceivedNum - requiredAmountForCash, 2);

    // Generar QR dinámico de Binance al activarse
    useEffect(() => {
        if (showBinanceQr && formData.method === 'binance_usdt') {
            if (binanceConfig.qrMode === 'IMAGE' && binanceConfig.qrImage) {
                setBinanceQrUrl(binanceConfig.qrImage);
            } else {
                generateBinanceQR({
                    payId: binanceConfig.payId,
                    email: binanceConfig.email,
                    amountUsdt: amountUsdtEquivalent,
                    customImage: binanceConfig.qrImage,
                    mode: binanceConfig.qrMode
                }).then(url => setBinanceQrUrl(url || ''));
            }
        }
    }, [showBinanceQr, formData.method, amountUsdtEquivalent, binanceConfig]);

    // Copiar al portapapeles
    const handleCopyText = (text, fieldKey) => {
        if (!text) return;
        navigator.clipboard.writeText(String(text));
        setCopiedField(fieldKey);
        toast.success('Copiado al portapapeles');
        setTimeout(() => setCopiedField(null), 2000);
    };

    // Envío del formulario
    const handleSubmit = (e) => {
        if (e) e.preventDefault();

        const amount = parseFloat(formData.amount);
        if (!amount || isNaN(amount) || amount <= 0) {
            toast.error('Por favor ingrese un monto válido mayor a 0');
            return;
        }

        // Validación estricta para Binance Pay
        if (formData.method === 'binance_usdt') {
            if (!reference.trim() || reference.trim().length < 6) {
                toast.error('Debe ingresar los últimos 6 dígitos del Order ID o confirmación de Binance');
                return;
            }
        }

        // Validación recomendada para Pago Móvil y Transferencia
        if (['pago_movil', 'transfer'].includes(formData.method) && !reference.trim()) {
            toast.error('Por favor ingrese el número de comprobante o referencia bancaria');
            return;
        }

        const executeSave = () => {
            onSave({
                customerId: customer.id,
                amount: amount,
                currency: 'USD',
                exchangeRate: exchangeRate,
                method: formData.method,
                notes: formData.notes,
                saleIds: selectedSaleIds,
                cryptoRate: formData.method === 'binance_usdt' ? effectiveBinanceRate : undefined,
                cryptoAmount: formData.method === 'binance_usdt' ? amountUsdtEquivalent : undefined,
                reference: reference.trim() || undefined
            });
        };

        const roundedBalance = customer ? Math.round(parseFloat(customer.creditBalance) * 100) / 100 : 0;
        if (customer && amount > roundedBalance) {
            setConfirmConfig({
                isOpen: true,
                title: 'Abono Excede Deuda Actual',
                message: `El monto ingresado ($${amount.toFixed(2)}) supera el saldo exigible ($${customer.creditBalance}). El excedente ($${Math.abs(projectedBalance).toFixed(2)}) quedará registrado formalmente como anticipo (saldo a favor del cliente). ¿Desea proceder?`,
                variant: 'primary',
                confirmText: 'Procesar Liquidación',
                action: executeSave
            });
            return;
        }

        executeSave();
    };

    // Métodos de pago disponibles
    const isSingleMode = isSingleCurrencyMode() || isDollarOnlyCountry(localStorage.getItem('pos_country'));
    const paymentMethodsList = useMemo(() => {
        return [
            { id: 'cash', label: isSingleMode ? 'Efectivo' : 'Efectivo USD', icon: Banknote, tag: 'USD' },
            { id: 'cash_bs', label: 'Efectivo Bs', icon: Banknote, tag: 'VES' },
            { id: 'pago_movil', label: 'Pago Móvil', icon: Send, tag: 'VES' },
            { id: 'card', label: isSingleMode ? 'Tarjeta / Débito' : 'Punto de Venta', icon: CreditCard, tag: 'VES' },
            { id: 'transfer', label: 'Transferencia', icon: Building2, tag: 'BANCO' },
            { id: 'zelle', label: 'Zelle', icon: DollarSign, tag: 'USD' },
            { id: 'binance_usdt', label: 'Binance Pay', icon: Wallet, tag: 'USDT', highlight: true }
        ].filter(m => {
            if (isSingleMode && (m.id === 'cash_bs' || m.id === 'pago_movil')) return false;
            return true;
        });
    }, [isSingleMode]);

    if (!isOpen || !customer) return null;

    return (
        <>
            <BaseModal
                isOpen={isOpen && !!customer}
                onClose={onClose}
                maxWidth={isFullScreen ? 'max-w-none' : 'max-w-6xl'}
                className={`flex flex-col bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-hidden border border-slate-200 dark:border-slate-800 shadow-2xl transition-all duration-200 ${
                    isFullScreen ? 'w-screen h-screen max-h-screen rounded-none' : 'w-full h-[90vh] max-h-[92vh] rounded-2xl'
                }`}
                padding={isFullScreen ? 'p-0' : 'p-3 sm:p-5'}
            >
                {/* 1. Header de Estación Contable */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850 select-none">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shadow-xs">
                            <Receipt size={19} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight uppercase">
                                    Registrar Abono y Cobranza
                                </h2>
                                <span className="hidden sm:inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                    CARTERA DE CLIENTES
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                <span>Tasa oficial: <strong className="font-mono text-emerald-600 dark:text-emerald-400">{exchangeRate.toFixed(2)} Bs/$</strong></span>
                                <span>•</span>
                                <span>Conciliación automática en caja</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {/* Botón Maximizar / Restaurar Pantalla Completa */}
                        <button
                            type="button"
                            onClick={() => setIsFullScreen(!isFullScreen)}
                            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title={isFullScreen ? "Restaurar tamaño normal" : "Expandir a pantalla completa"}
                        >
                            {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>

                        {/* Botón de cierre */}
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            title="Cerrar (Esc)"
                        >
                            <X size={17} />
                        </button>
                    </div>
                </div>

                {/* 2. Cuerpo en Dos Columnas Maestras (Layout ERP Balanceado) */}
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 p-4 sm:p-5 overflow-hidden bg-white dark:bg-slate-900">
                    
                    {/* COLUMNA IZQUIERDA (5 Columnas): Titular, Deuda y Facturas */}
                    <div className="lg:col-span-5 flex flex-col h-full overflow-hidden space-y-4">
                        
                        {/* Tarjeta Unificada: Titular y Deuda Pendiente */}
                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-0.5 min-w-0">
                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider block">
                                        Cliente / Razón Social
                                    </span>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white truncate" title={customer.name}>
                                        {customer.name}
                                    </h3>
                                    <div className="flex items-center gap-2 pt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                                        <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
                                            {customer.idDocument || 'Sin Documento'}
                                        </span>
                                        {customer.phone && (
                                            <span className="truncate">{customer.phone}</span>
                                        )}
                                    </div>
                                </div>

                                {customer.phone && (
                                    <a
                                        href={`https://wa.me/${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${customer.name}, le saludamos para coordinar la conciliación de su saldo pendiente en tienda.`)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors shrink-0"
                                        title="Enviar WhatsApp"
                                    >
                                        <MessageCircle size={15} />
                                    </a>
                                )}
                            </div>

                            {/* Fila de Saldo Exigible */}
                            <div className="pt-3 border-t border-slate-200 dark:border-slate-700/60 flex items-baseline justify-between">
                                <div>
                                    <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">
                                        Deuda Pendiente
                                    </span>
                                    <span className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400 tabular-nums">
                                        ${currentDebt.toFixed(2)}
                                    </span>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300 block">
                                        Ref. {formatBs(currentDebt * exchangeRate)}
                                    </span>
                                    <span className="text-[10px] text-slate-400">Tasa: {exchangeRate} Bs/$</span>
                                </div>
                            </div>

                            {/* Botones de acción rápida: Pagar Total y 50% */}
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={handleSetFullDebt}
                                    className="py-1.5 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                    <CheckCheck size={14} />
                                    <span>Pagar Total (${currentDebt.toFixed(2)})</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSetHalfDebt}
                                    className="py-1.5 px-3 rounded-lg bg-slate-100 dark:bg-slate-750 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-colors cursor-pointer text-center"
                                >
                                    50% (${(currentDebt / 2).toFixed(2)})
                                </button>
                            </div>
                        </div>

                        {/* Listado de Facturas / Ventas a Crédito Pendientes */}
                        <div className="flex-1 flex flex-col min-h-[160px] rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 p-3.5 overflow-hidden">
                            <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-700/60">
                                <div className="flex items-center gap-1.5">
                                    <Calendar size={14} className="text-slate-500 dark:text-slate-400" />
                                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                        Facturas Pendientes ({pendingSales.length})
                                    </span>
                                </div>
                                {pendingSales.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleSelectAllSales}
                                        className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                    >
                                        {selectedSaleIds.length === pendingSales.length ? 'Deseleccionar todas' : 'Vincular todas'}
                                    </button>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto mt-2 space-y-2 pr-1 custom-scrollbar">
                                {loadingSales ? (
                                    <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                                        <RefreshCcw size={18} className="animate-spin text-emerald-500" />
                                        <span>Consultando facturas del cliente...</span>
                                    </div>
                                ) : pendingSales.length === 0 ? (
                                    <div className="py-12 text-center text-xs text-slate-500 space-y-1">
                                        <p className="font-semibold text-slate-600 dark:text-slate-400">Sin facturas detalladas pendientes</p>
                                        <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                                            El abono se aplicará directamente a la deuda global de la cuenta corriente.
                                        </p>
                                    </div>
                                ) : (
                                    pendingSales.map(sale => {
                                        const isSelected = selectedSaleIds.includes(sale.id);
                                        const daysOld = Math.max(0, Math.floor((Date.now() - new Date(sale.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
                                        return (
                                            <div
                                                key={sale.id}
                                                onClick={() => toggleSaleSelection(sale)}
                                                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                                    isSelected
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-xs'
                                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    {isSelected ? (
                                                        <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                                    ) : (
                                                        <Circle size={18} className="text-slate-300 dark:text-slate-600 shrink-0" />
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                                                                Factura #{sale.taxInfo?.dailyTicketNumber || sale.id.slice(0, 8)}
                                                            </span>
                                                            {sale.paymentStatus === 'partial' && (
                                                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                                    Parcial
                                                                </span>
                                                            )}
                                                            {daysOld > 7 && (
                                                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                                    {daysOld}d
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                                            {new Date(sale.createdAt).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white block">
                                                        ${getSaleAmount(sale).toFixed(2)}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                                        {formatBs(getSaleAmount(sale) * exchangeRate)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                    </div>

                    {/* COLUMNA DERECHA (7 Columnas): Liquidación, Medios de Pago y Arqueo */}
                    <div className="lg:col-span-7 flex flex-col h-full overflow-y-auto space-y-4 pr-1 custom-scrollbar">
                        
                        {/* Tarjeta de Monto a Liquidar */}
                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Coins size={14} className="text-emerald-600 dark:text-emerald-400" />
                                    <span>Monto a Abonar ($) *</span>
                                </label>
                                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                                    Equivalente: <strong className="text-slate-900 dark:text-white">{formatBs(amountBsEquivalent)}</strong>
                                </span>
                            </div>

                            {/* Input de Monto Principal */}
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">$</span>
                                </div>
                                <input
                                    required
                                    type="text"
                                    inputMode="decimal"
                                    name="amount"
                                    value={formData.amount}
                                    onChange={handleChange}
                                    placeholder="0.00"
                                    autoFocus
                                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 dark:focus:border-emerald-500 rounded-xl text-3xl font-black font-mono text-slate-900 dark:text-white text-center tracking-tight outline-none shadow-xs transition-colors"
                                />
                            </div>

                            {/* Chips de monto rápido */}
                            <div className="flex items-center justify-center gap-1.5 flex-wrap pt-1">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mr-1">Rápidos:</span>
                                {[5, 10, 20, 50, 100].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => handleAddAmount(val)}
                                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold transition-colors cursor-pointer shadow-2xs"
                                    >
                                        +${val}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, amount: '' }))}
                                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                                >
                                    Limpiar
                                </button>
                            </div>

                            {/* Monitor Contable en una sola línea elegante */}
                            <div className="pt-2.5 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-xs font-mono">
                                <span className="text-slate-500">
                                    Deuda: <strong>${currentDebt.toFixed(2)}</strong>
                                </span>
                                <span className="text-slate-400">➜</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                    Abono: -${amountNum.toFixed(2)}
                                </span>
                                <span className="text-slate-400">➜</span>
                                <span className={`font-bold px-2 py-0.5 rounded ${
                                    isFullyPaid 
                                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                        : (isOverpaid
                                            ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300'
                                            : 'bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300')
                                }`}>
                                    {isFullyPaid && !isOverpaid ? 'Saldado Total ✅' : `Resta: $${Math.abs(projectedBalance).toFixed(2)}`}
                                </span>
                            </div>
                        </div>

                        {/* Selector de Instrumentos de Liquidación */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                Instrumento de Liquidación y Cobro
                            </label>
                            
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                {paymentMethodsList.map(method => {
                                    const isSelected = formData.method === method.id;
                                    const isBinance = method.id === 'binance_usdt';
                                    return (
                                        <button
                                            key={method.id}
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, method: method.id }))}
                                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between h-17 relative ${
                                                isSelected
                                                    ? (isBinance 
                                                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-900 dark:text-amber-200 shadow-sm ring-1 ring-amber-500/40 font-bold' 
                                                        : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-200 shadow-sm ring-1 ring-emerald-500/40 font-bold')
                                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <method.icon size={17} className={isSelected ? (isBinance ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400') : 'text-slate-400'} />
                                                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded ${
                                                    isSelected 
                                                        ? (isBinance ? 'bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200' : 'bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200')
                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                                }`}>
                                                    {method.tag}
                                                </span>
                                            </div>
                                            <span className="text-xs font-bold tracking-tight block mt-1">
                                                {method.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Paneles Contextuales Dinámicos según el Método Seleccionado */}
                        
                        {/* CASO A: BINANCE PAY (USDT) */}
                        {formData.method === 'binance_usdt' && (
                            <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 space-y-3 animate-fadeIn">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                                            <Wallet size={15} /> Tasa USDT P2P:
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleFetchLiveBinanceRate}
                                            disabled={loadingBinanceRate}
                                            className="px-2.5 py-1 rounded-lg bg-amber-200/60 dark:bg-amber-900/60 hover:bg-amber-200 text-amber-900 dark:text-amber-200 text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                                            title="Consultar tasa P2P en vivo"
                                        >
                                            <RefreshCcw size={11} className={loadingBinanceRate ? 'animate-spin' : ''} />
                                            <span>{loadingBinanceRate ? 'Consultando...' : 'P2P en Vivo'}</span>
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={binanceRate || ''}
                                            onChange={(e) => setBinanceRate(parseFloat(e.target.value) || 0)}
                                            className="w-28 px-2.5 py-1 text-xs font-mono font-bold text-right bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg text-slate-900 dark:text-white outline-none focus:border-amber-500"
                                            placeholder="Tasa Bs"
                                        />
                                        <span className="text-xs font-mono font-bold text-slate-500">Bs/USDT</span>
                                    </div>
                                </div>

                                {/* Monto a Transferir en USDT */}
                                <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/40">
                                    <div>
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                            Importe a Transferir en Binance
                                        </span>
                                        <span className="text-xs font-mono text-slate-400">
                                            Equivalente: {formatBs(amountBsEquivalent)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-mono font-black text-amber-600 dark:text-amber-400 tabular-nums">
                                            {amountUsdtEquivalent.toFixed(2)} USDT
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyText(amountUsdtEquivalent.toFixed(2), 'usdt')}
                                            className="p-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg text-amber-700 dark:text-amber-400 transition-colors"
                                            title="Copiar monto en USDT"
                                        >
                                            {copiedField === 'usdt' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowBinanceQr(!showBinanceQr)}
                                            className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors"
                                            title="Mostrar QR dinámico de pago"
                                        >
                                            <QrCode size={13} />
                                            <span>{showBinanceQr ? 'Ocultar QR' : 'Ver QR'}</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Desplegable QR Oficial de Binance */}
                                {showBinanceQr && (
                                    <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-800/40 flex flex-col sm:flex-row items-center justify-center gap-4">
                                        {binanceQrUrl ? (
                                            <img src={binanceQrUrl} alt="QR Binance" className="w-32 h-32 object-contain rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-1" />
                                        ) : (
                                            <div className="w-32 h-32 flex items-center justify-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-950 rounded-lg">Generando QR...</div>
                                        )}
                                        <div className="space-y-1.5 text-xs">
                                            {binanceConfig.payId && (
                                                <div className="flex items-center justify-between gap-3 p-1.5 bg-slate-50 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800">
                                                    <span className="text-slate-600 dark:text-slate-300 font-mono text-[11px]">Pay ID: {binanceConfig.payId}</span>
                                                    <button type="button" onClick={() => handleCopyText(binanceConfig.payId, 'payid')} className="text-amber-600 hover:text-amber-700">
                                                        {copiedField === 'payid' ? <Check size={12} /> : <Copy size={12} />}
                                                    </button>
                                                </div>
                                            )}
                                            {binanceConfig.email && (
                                                <div className="flex items-center justify-between gap-3 p-1.5 bg-slate-50 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800">
                                                    <span className="text-slate-600 dark:text-slate-300 font-mono text-[11px] truncate max-w-[180px]">{binanceConfig.email}</span>
                                                    <button type="button" onClick={() => handleCopyText(binanceConfig.email, 'bemail')} className="text-amber-600 hover:text-amber-700">
                                                        {copiedField === 'bemail' ? <Check size={12} /> : <Copy size={12} />}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Campo Obligatorio: Referencia de Binance Pay */}
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-amber-900 dark:text-amber-300 uppercase tracking-wider flex items-center justify-between">
                                        <span>Nº de Referencia / Order ID (Binance) *</span>
                                        <span className="text-[9px] text-slate-500">Últimos 6 dígitos del comprobante</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        placeholder="Ej: 948215"
                                        maxLength={30}
                                        className="w-full px-3.5 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 focus:border-amber-500 rounded-lg text-slate-900 dark:text-white outline-none"
                                    />
                                </div>
                            </div>
                        )}

                        {/* CASO B: PAGO MÓVIL o TRANSFERENCIA BANCARIA */}
                        {(formData.method === 'pago_movil' || formData.method === 'transfer') && (
                            <div className="p-4 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 space-y-3 animate-fadeIn">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-sky-900 dark:text-sky-300">
                                        <Building2 size={15} />
                                        <span>Datos Bancarios ({formData.method === 'pago_movil' ? 'Pago Móvil' : 'Transferencia'})</span>
                                    </div>
                                    <span className="text-xs font-mono font-bold text-sky-800 dark:text-sky-300">
                                        Total Bs: {formatBs(amountBsEquivalent)}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                        <div>
                                            <span className="text-[9px] text-slate-400 block uppercase">Banco</span>
                                            <span className="font-bold text-slate-700 dark:text-slate-200">{businessInfo.pagoMovilBank || 'Bancaribe / Banesco'}</span>
                                        </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                        <div>
                                            <span className="text-[9px] text-slate-400 block uppercase">RIF / C.I.</span>
                                            <span className="font-bold text-slate-700 dark:text-slate-200">{businessInfo.pagoMovilId || businessInfo.rif || 'V-12345678'}</span>
                                        </div>
                                        <button type="button" onClick={() => handleCopyText(businessInfo.pagoMovilId || businessInfo.rif, 'pm_id')} className="text-sky-600 hover:text-sky-700">
                                            {copiedField === 'pm_id' ? <Check size={12} /> : <Copy size={12} />}
                                        </button>
                                    </div>
                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                        <div>
                                            <span className="text-[9px] text-slate-400 block uppercase">Teléfono</span>
                                            <span className="font-bold text-slate-700 dark:text-slate-200">{businessInfo.pagoMovilPhone || businessInfo.phone || '0412-0000000'}</span>
                                        </div>
                                        <button type="button" onClick={() => handleCopyText(businessInfo.pagoMovilPhone || businessInfo.phone, 'pm_phone')} className="text-sky-600 hover:text-sky-700">
                                            {copiedField === 'pm_phone' ? <Check size={12} /> : <Copy size={12} />}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-sky-900 dark:text-sky-300 uppercase tracking-wider flex items-center justify-between">
                                        <span>Nº de Referencia / Comprobante Bancario *</span>
                                        <span className="text-[9px] text-slate-400">Últimos 4 a 6 dígitos</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        placeholder="Ej: 749210"
                                        maxLength={30}
                                        className="w-full px-3.5 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 focus:border-sky-500 rounded-lg text-slate-900 dark:text-white outline-none"
                                    />
                                </div>
                            </div>
                        )}

                        {/* CASO C: EFECTIVO (USD o BS) - Calculadora de Vuelto */}
                        {(formData.method === 'cash' || formData.method === 'cash_bs') && (
                            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-2.5 animate-fadeIn">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                                        <Calculator size={14} className="text-emerald-600 dark:text-emerald-400" />
                                        <span>Calculadora de Cambio / Vuelto en Efectivo</span>
                                    </div>
                                    <span className="text-xs font-mono text-slate-500">
                                        A cobrar: <strong className="text-slate-900 dark:text-white">{isVesMethod ? `${formatBs(amountBsEquivalent)} Bs` : `$${amountNum.toFixed(2)}`}</strong>
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3 items-center">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                            Recibido del Cliente ({isVesMethod ? 'Bs' : '$'})
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={cashReceived}
                                            onChange={(e) => setCashReceived(e.target.value)}
                                            placeholder={isVesMethod ? "Monto en Bs" : "Monto en $"}
                                            className="w-full px-3 py-1.5 text-sm font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                                        />
                                    </div>

                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-right">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                            Cambio a Devolver
                                        </span>
                                        <span className={`text-base font-mono font-black ${cashChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                            {cashChange > 0 
                                                ? (isVesMethod ? `${formatBs(cashChange)} Bs` : `$${cashChange.toFixed(2)}`)
                                                : '$0.00'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* CASO D: ZELLE */}
                        {formData.method === 'zelle' && (
                            <div className="p-3.5 rounded-xl bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 space-y-2.5 animate-fadeIn">
                                <div className="flex items-center justify-between text-xs text-purple-900 dark:text-purple-300 font-bold">
                                    <span>Zelle de la Empresa:</span>
                                    <span className="font-mono">{businessInfo.zelleEmail || 'pagos@empresa.com'}</span>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-purple-900 dark:text-purple-300 uppercase tracking-wider block">
                                        Nombre del Titular o Referencia Zelle
                                    </label>
                                    <input
                                        type="text"
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        placeholder="Ej: Juan Perez"
                                        className="w-full px-3.5 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 rounded-lg text-slate-900 dark:text-white outline-none"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Observaciones Contables */}
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                                Observaciones / Concepto de Cobro
                            </label>
                            <input
                                type="text"
                                name="notes"
                                value={formData.notes}
                                onChange={handleChange}
                                placeholder="Ej: Abono acordado o cancelación de saldo"
                                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:border-slate-400 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none transition-colors"
                            />
                        </div>

                    </div>
                </div>

                {/* 3. Footer de Auditoría y Ejecución */}
                <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
                        <span>Conciliación automática en libro de créditos y arqueo de caja</span>
                    </div>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={processing}
                            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-bold text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 uppercase tracking-wider transition-colors cursor-pointer"
                        >
                            Cancelar (Esc)
                        </button>
                        
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={processing || amountNum <= 0}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                        >
                            {processing ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                            ) : (
                                <>
                                    <Save size={16} />
                                    <span>Confirmar y Procesar Abono</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </BaseModal>

            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.action}
                title={confirmConfig.title}
                message={confirmConfig.message}
                variant={confirmConfig.variant}
                confirmText={confirmConfig.confirmText}
            />
        </>
    );
}
