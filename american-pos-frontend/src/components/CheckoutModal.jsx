import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { X, Banknote, CreditCard, User, CheckCircle2, Send, DollarSign, Zap, Wallet, Search, Coins, Layers, QrCode, Fingerprint, Copy, Check, Loader2, Smartphone, RefreshCcw, ArrowRight, CornerDownLeft, Sparkles, ChevronDown, CheckCheck, Maximize2, Minimize2, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import api from '../services/api';
import { db } from '../services/db';
import VortexMathEngine from '../utils/VortexMathEngine';
import { formatMoney as utilFormatMoney, formatBs, formatUSD, precisionRound, isSingleCurrencyMode, isUsdOnlyMode, isVesOnlyMode, isDollarOnlyCountry } from '../utils/format';
import { playSuccessSound } from '../utils/sounds';
import BaseModal from './BaseModal';
import { useAuth } from '../hooks/AuthContext';
import { usePos } from '../hooks/PosContext';
import { useSocket } from '../hooks/SocketContext';
import { calculatePaymentMethodDiscounts, evaluateCartPromotions, matchesPaymentMethod } from '../utils/promotionsEngine';
import { 
    generatePagoMovilQR, 
    getBankNameByCode, 
    cleanPhone, 
    cleanIdNumber, 
    formatPhoneDisplay, 
    formatIdDisplay 
} from '../utils/pagoMovilQR';
import { generateBinanceQR, buildBinancePayString } from '../utils/binanceQR';

export const cleanMethodName = (name) => {
    if (!name || typeof name !== 'string') return '';
    return name
        .replace(/CrÃ©dito/gi, 'Crédito')
        .replace(/DÃ©bito/gi, 'Débito')
        .replace(/MÃ³vil/gi, 'Móvil')
        .replace(/Ã©/g, 'é')
        .replace(/Ã¡/g, 'á')
        .replace(/Ã­/g, 'í')
        .replace(/Ã³/g, 'ó')
        .replace(/Ãº/g, 'ú')
        .replace(/Ã±/g, 'ñ')
        .replace(/Ã‰/g, 'É')
        .replace(/Ã“/g, 'Ó')
        .replace(/Ã/g, 'Á')
        .trim();
};

const DEFAULT_PAYMENT_METHODS = [
    { id: 'cash_usd', name: 'Efectivo USD', currency: 'USD', isCash: true, active: true },
    { id: 'cash_bs', name: 'Efectivo Bs', currency: 'VES', isCash: true, active: true },
    { id: 'debit', name: 'Punto de Venta', currency: 'VES', isCash: false, active: true },
    { id: 'pago_movil', name: 'Pago Móvil', currency: 'VES', isCash: false, active: true },
    { id: 'binance_usdt', name: 'Binance Pay (USDT)', currency: 'USDT', isCash: false, active: true },
    { id: 'zelle', name: 'Zelle', currency: 'USD', isCash: false, active: true },
    { id: 'biopago', name: 'Biopago BDV', currency: 'VES', isCash: false, active: true },
    { id: 'transfer', name: 'Transferencia Bancaria', currency: 'VES', isCash: false, active: true },
    { id: 'fiado', name: 'Crédito / Fiado', currency: 'USD', type: 'CREDIT', active: true }
];

export default function CheckoutModal({
    isOpen,
    onClose,
    onConfirm,
    total,
    taxAmount = 0,
    subtotal = 0,
    taxableBase = 0,
    exemptBase = 0,
    discountAmount = 0,
    discountPercent = 0,
    taxInfo = { exemptBase: 0, taxableBase: 0 },
    ivaRate = 16,
    igtfRate = 3,
    igtfEnabled = false,
    exchangeRate,
    currencyMode = 'BOTH',
    processing,
    initialCustomerId = '',
    customerName = '',
    registerId = '1',
    registerDisplayName = '',
    businessSettings = {},
    cartItems = [],
    basePromoDiscount = 0,
    baseAppliedPromotions = []
}) {
    const { user } = useAuth();
    const effectiveCountry = businessSettings?.country || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = isDollarCountry || isUsdOnlyMode({ currencyMode, country: effectiveCountry, ...businessSettings });
    const isVesOnly = !isUsdOnly && isVesOnlyMode({ currencyMode, country: effectiveCountry, ...businessSettings });
    const isDual = !isUsdOnly && !isVesOnly;
    const isSingle = isUsdOnly;
    const effectiveCurrencyMode = isUsdOnly ? 'SINGLE' : (isVesOnly ? 'VES' : 'BOTH');
    
    // Modo de Interfaz: 'express' (1-clic ultra rápido) o 'split' (pago mixto / multi-método)
    const [viewMode, setViewMode] = useState('express');
    // Modal expandido por defecto para máxima responsividad y visualización panorámica completa
    const [isMaximized, setIsMaximized] = useState(true);
    const [payments, setPayments] = useState({});
    const [paymentReferences, setPaymentReferences] = useState({});
    const [customers, setCustomers] = useState([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [customerSearch, setCustomerSearch] = useState('');
    const [documentType, setDocumentType] = useState('factura');
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [methods, setMethods] = useState([]);
    const [loadingMethods, setLoadingMethods] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [transactionId, setTransactionId] = useState(null);
    const [lockedExchangeRate, setLockedExchangeRate] = useState(null);

    // Estados para el Modal Visual de Pago Móvil & Código QR
    const [qrModalMethod, setQrModalMethod] = useState(null);
    const [qrModalUrl, setQrModalUrl] = useState('');
    const [generatingQrModal, setGeneratingQrModal] = useState(false);
    const [qrModalReference, setQrModalReference] = useState('');
    const [copiedField, setCopiedField] = useState(null);
    const [focusedExpressMethodId, setFocusedExpressMethodId] = useState('');

    const { socket } = useSocket();

    const activeExchangeRate = isUsdOnly ? 1 : (lockedExchangeRate || exchangeRate || 1);
    const liveExchangeRateRef = useRef(activeExchangeRate);
    liveExchangeRateRef.current = activeExchangeRate;

    // Promociones y Ofertas activas en tiempo real
    const posContext = usePos() || {};
    const effectivePromotions = posContext?.activePromotions || [];
    const effectiveCart = (Array.isArray(cartItems) && cartItems.length > 0) 
        ? cartItems 
        : (posContext?.posState?.cart || []);
    
    // Oferta por método de pago seleccionada para la venta
    const [activePaymentPromo, setActivePaymentPromo] = useState(null);

    // Mapa de descuentos potenciales calculados por método de pago para los productos del carrito
    const paymentMethodDiscounts = useMemo(() => {
        return calculatePaymentMethodDiscounts(effectiveCart, effectivePromotions);
    }, [effectiveCart, effectivePromotions]);

    const getMethodPromo = useCallback((methodId, methodName) => {
        if (!paymentMethodDiscounts || Object.keys(paymentMethodDiscounts).length === 0) return null;
        const idKey = (methodId || '').toLowerCase().trim();
        if (paymentMethodDiscounts[idKey]) return paymentMethodDiscounts[idKey];
        for (const [key, promoData] of Object.entries(paymentMethodDiscounts)) {
            if (matchesPaymentMethod([key], idKey) || matchesPaymentMethod([key], methodName)) {
                return promoData;
            }
        }
        return null;
    }, [paymentMethodDiscounts]);

    useEffect(() => {
        if (isOpen) {
            setLockedExchangeRate(exchangeRate || 1);
            fetchCustomers();
            fetchMethods();
            setPayments({});
            setPaymentReferences({});
            setSelectedCustomerId(initialCustomerId || '');
            setCustomerSearch('');
            setDocumentType('factura');
            setSelectedIndex(0);
            setViewMode('express');
            setTransactionId(null);
            setQrModalMethod(null);
            setQrModalUrl('');
            setQrModalReference('');
            setCopiedField(null);
            setActivePaymentPromo(null);
            setFocusedExpressMethodId('');
        } else {
            setLockedExchangeRate(null);
            setQrModalMethod(null);
            setActivePaymentPromo(null);
            setFocusedExpressMethodId('');
        }
    }, [isOpen, exchangeRate]);

    const fetchCustomers = async () => {
        try {
            setLoadingCustomers(true);
            let custs = [];
            try {
                const { data } = await api.get('/customers?limit=1000', { timeout: 3000 });
                custs = Array.isArray(data) ? data : (data?.customers || []);
                if (custs.length > 0) {
                    try { await db.putAll('customers', custs); } catch {}
                }
            } catch (netErr) {
                console.warn('CheckoutModal: error de red al obtener clientes, cargando de IndexedDB:', netErr.message);
            }

            if (!custs || custs.length === 0) {
                try {
                    const localCusts = await db.getAll('customers');
                    if (Array.isArray(localCusts) && localCusts.length > 0) {
                        custs = localCusts;
                    }
                } catch (dbErr) {
                    console.error('CheckoutModal: error leyendo clientes de IndexedDB:', dbErr);
                }
            }

            setCustomers(custs || []);
        } catch (error) { 
            console.error('Error fetching customers:', error); 
        } finally { 
            setLoadingCustomers(false); 
        }
    };

    const fetchMethods = async () => {
        try {
            setLoadingMethods(true);
            let meths = [];
            try {
                const { data } = await api.get('/settings/payment-methods', { timeout: 3000 });
                meths = Array.isArray(data) ? data : [];
                if (meths.length > 0) {
                    try { localStorage.setItem('pos_payment_methods', JSON.stringify(meths)); } catch {}
                }
            } catch (netErr) {
                console.warn('CheckoutModal: error de red al obtener métodos de pago, usando caché/valores por defecto:', netErr.message);
            }

            if (!meths || meths.length === 0) {
                try {
                    const cached = JSON.parse(localStorage.getItem('pos_payment_methods') || '[]');
                    if (Array.isArray(cached) && cached.length > 0) {
                        meths = cached;
                    }
                } catch {}
            }

            if (!meths || meths.length === 0) {
                meths = DEFAULT_PAYMENT_METHODS;
            }

            if (isUsdOnly) {
                meths = meths.filter(m => {
                    const idLower = (m.id || '').toLowerCase();
                    const nameLower = (m.name || '').toLowerCase();
                    const curr = (m.currency || m.defaultCurrency || '').toUpperCase();
                    if (curr === 'VES' || curr === 'BS') return false;
                    if (['cash_bs', 'efectivo_bs', 'pago_movil', 'biopago'].includes(idLower)) return false;
                    if (nameLower.includes(' bs') || nameLower.includes('ves') || nameLower.includes('pago móvil') || nameLower.includes('pago movil') || nameLower.includes('biopago')) return false;
                    return true;
                });
                if (meths.length === 0) {
                    meths = [
                        { id: 'cash', name: 'Efectivo', currency: 'USD', isCash: true, active: true },
                        { id: 'card', name: 'Tarjeta / Débito', currency: 'USD', isCash: false, active: true },
                        { id: 'transfer', name: 'Transferencia', currency: 'USD', isCash: false, active: true },
                        { id: 'fiado', name: 'Crédito', currency: 'USD', type: 'CREDIT', active: true }
                    ];
                }
            }

            setMethods(meths.map(m => ({ ...m, name: cleanMethodName(m.name) })));
        } catch (error) { 
            console.error('Error fetching methods:', error); 
            setMethods(DEFAULT_PAYMENT_METHODS.map(m => ({ ...m, name: cleanMethodName(m.name) })));
        } finally { 
            setLoadingMethods(false); 
        }
    };

    // Helper para mapear y encontrar el método de pago por categoría (Blindado para Modo Offline)
    const findMethodKey = useCallback((typeKey) => {
        const pool = (Array.isArray(methods) && methods.length > 0) ? methods : DEFAULT_PAYMENT_METHODS;
        const tk = typeKey.toLowerCase();
        if (tk === 'cash_usd') {
            return pool.find(m => m.id === 'cash' || m.id === 'cash_usd' || m.id === 'efectivo_usd' || (!m.id.includes('bs') && !m.id.includes('ves') && (m.id.includes('cash') || m.id.includes('efectivo')))) || pool[0];
        }
        if (tk === 'cash_bs') {
            return pool.find(m => m.id === 'cash_bs' || m.id === 'efectivo_bs' || m.id.includes('cash_bs') || m.id.includes('bs') || m.id.includes('ves')) || pool.find(m => m.name.toLowerCase().includes('bs')) || pool[0];
        }
        if (tk === 'debit') {
            return pool.find(m => m.id === 'debit' || m.id === 'card' || m.id === 'tarjeta' || m.id === 'punto_de_venta' || m.id.includes('debito') || m.id.includes('punto')) || pool.find(m => m.name.toLowerCase().includes('tarjeta') || m.name.toLowerCase().includes('punto')) || pool[0];
        }
        if (tk === 'transfer') {
            return pool.find(m => m.id === 'zelle' || m.id === 'transfer' || m.id.includes('zelle') || m.id.includes('transfer')) || pool.find(m => m.name.toLowerCase().includes('zelle') || m.name.toLowerCase().includes('transferencia')) || pool[0];
        }
        if (tk === 'credit') {
            return pool.find(m => m.id === 'credit' || m.id === 'credito' || m.id.includes('credit')) || pool.find(m => m.name.toLowerCase().includes('crédito') || m.name.toLowerCase().includes('credito') || m.name.toLowerCase().includes('fiado')) || pool[0];
        }
        if (tk === 'movil') {
            return pool.find(m => m.id === 'pago_movil' || m.id.includes('movil') || m.id.includes('transfer')) || pool.find(m => m.name.toLowerCase().includes('móvil') || m.name.toLowerCase().includes('movil')) || pool[0];
        }
        if (tk === 'binance' || tk === 'usdt') {
            return pool.find(m => m.id === 'binance_usdt' || m.id === 'binance' || m.id.includes('binance') || m.id.includes('usdt')) || pool.find(m => m.name.toLowerCase().includes('binance') || m.name.toLowerCase().includes('usdt')) || pool[0];
        }
        if (tk === 'biopago') {
            return pool.find(m => m.id === 'biopago' || m.id.includes('biopago') || m.id.includes('bio')) || pool.find(m => m.name.toLowerCase().includes('biopago') || m.name.toLowerCase().includes('huella')) || pool.find(m => m.id === 'debit') || pool[0];
        }
        return pool[0];
    }, [methods]);

    // === VORTEX MATH ENGINE REFACTOR (BigInt exact 10^8 precision) ===
    const toInt = (val) => Number(VortexMathEngine.toBigInt(val));
    const fromInt = (val) => VortexMathEngine.fromBigInt(BigInt(Math.round(val)));

    // Helper unificado para Binance Pay (USDT): paridad 1:1 con USD (1 USDT = $1.00 USD = activeExchangeRate Bs)
    const getEffectiveBinanceRate = useCallback(() => {
        return activeExchangeRate > 0 ? activeExchangeRate : 1;
    }, [activeExchangeRate]);

    const stats = useMemo(() => {
        const totalUsdInt = toInt(total);
        const totalVesInt = toInt(precisionRound(total * activeExchangeRate, 2));

        let usableUsdInt = 0;
        let usableVesInt = 0;
        let igtfUsdInt = 0;
        let activeBinanceRateUsed = 0;

        Object.entries(payments).forEach(([methodId, data]) => {
            const amountInt = toInt(data.amount);
            if (amountInt === 0) return;

            const isBinance = data.currency === 'USDT' || methodId === 'binance_usdt' || methodId.includes('binance');
            if (isBinance) {
                activeBinanceRateUsed = activeExchangeRate;
                const amountUsdInt = amountInt;
                const amountVesInt = Math.round(amountInt * activeExchangeRate);

                const isCryptoIgtfApplicable = igtfEnabled && businessSettings?.binanceIgtfEnabled === true;
                if (isCryptoIgtfApplicable) {
                    const requiredPrincipal = Math.max(0, totalUsdInt - usableUsdInt);
                    const maxUsableFromBill = Math.round(amountUsdInt / (1 + (igtfRate / 100)));
                    const appliedPrincipal = Math.min(requiredPrincipal, maxUsableFromBill);
                    const tax = Math.round(appliedPrincipal * (igtfRate / 100));
                    const usable = amountUsdInt - tax;

                    igtfUsdInt += tax;
                    usableUsdInt += usable;
                    usableVesInt += Math.round(usable * activeExchangeRate);
                } else {
                    usableUsdInt += amountUsdInt;
                    usableVesInt += amountVesInt;
                }
            } else if (data.currency === 'USD') {
                const isIgtfApplicable = igtfEnabled && data.currency === 'USD' && methodId !== 'zelle' && methodId !== 'fiado';
                if (isIgtfApplicable) {
                    const requiredPrincipal = Math.max(0, totalUsdInt - usableUsdInt);
                    const maxUsableFromBill = Math.round(amountInt / (1 + (igtfRate / 100)));
                    const appliedPrincipal = Math.min(requiredPrincipal, maxUsableFromBill);
                    const tax = Math.round(appliedPrincipal * (igtfRate / 100));
                    const usable = amountInt - tax;
                    
                    igtfUsdInt += tax;
                    usableUsdInt += usable;
                    usableVesInt += Math.round(usable * activeExchangeRate);
                } else {
                    usableUsdInt += amountInt;
                    usableVesInt += Math.round(amountInt * activeExchangeRate);
                }
            } else {
                usableVesInt += amountInt;
                usableUsdInt += Math.round(amountInt / activeExchangeRate);
            }
        });

        const hasBinancePayment = Object.entries(payments).some(([k, v]) => (v.currency === 'USDT' || k.includes('binance')) && toInt(v.amount) > 0);
        // Tolerancia proporcional al redondeo de 2 decimales de USDT (±0.006 USDT) para evitar residuos fantasma como "$0.00 / Bs 0,57"
        const baseBinanceTolBs = Number(businessSettings?.binanceRoundingToleranceBs ?? 0.50);
        const effBinRate = activeBinanceRateUsed > 0 ? activeBinanceRateUsed : getEffectiveBinanceRate();
        const dynamicBinanceTolBs = Math.max(baseBinanceTolBs, effBinRate * 0.006, activeExchangeRate * 0.006);
        const roundingToleranceBs = hasBinancePayment ? dynamicBinanceTolBs : 0.0005;
        const toleranceInt = toInt(roundingToleranceBs);

        const isInsufficient = (totalVesInt - usableVesInt) > toleranceInt;
        const rawChangeBsInt = !isInsufficient ? Math.max(0, usableVesInt - totalVesInt) : 0;
        const rawChangeUsdInt = !isInsufficient ? Math.max(0, usableUsdInt - totalUsdInt) : 0;

        // Si el excedente es meramente por redondeo de medio centavo de USDT, no generar vuelto artificial
        const changeBsInt = (hasBinancePayment && rawChangeBsInt <= toleranceInt) ? 0 : rawChangeBsInt;
        const changeUsdInt = (hasBinancePayment && rawChangeBsInt <= toleranceInt) ? 0 : rawChangeUsdInt;

        const remainingBsInt = isInsufficient ? Math.max(0, totalVesInt - usableVesInt) : 0;
        const remainingUsdInt = isInsufficient ? Math.max(0, totalUsdInt - usableUsdInt) : 0;

        return {
            isInsufficient,
            currentIgtfUsd: fromInt(igtfUsdInt),
            totalToPayUsd: fromInt(totalUsdInt + igtfUsdInt),
            totalToPayVes: fromInt(totalVesInt + Math.round(igtfUsdInt * activeExchangeRate)),
            receivedVes: fromInt(usableVesInt + Math.round(igtfUsdInt * activeExchangeRate)),
            receivedUsd: fromInt(usableUsdInt + igtfUsdInt),
            changeBs: fromInt(changeBsInt),
            changeUsd: fromInt(changeUsdInt),
            remainingBs: fromInt(remainingBsInt),
            remainingUsd: fromInt(remainingUsdInt)
        };
    }, [payments, total, activeExchangeRate, igtfEnabled, igtfRate, businessSettings, getEffectiveBinanceRate]);

    const {
        isInsufficient,
        currentIgtfUsd,
        totalToPayUsd,
        totalToPayVes,
        changeBs,
        changeUsd,
        remainingBs,
        remainingUsd
    } = stats;

    const handleAmountChange = (methodId, value, currency) => {
        const normalizedValue = value.toString().replace(',', '.');
        const isBinance = currency === 'USDT' || methodId === 'binance_usdt' || methodId.toLowerCase().includes('binance');
        setPayments(prev => ({
            ...prev,
            [methodId]: {
                amount: normalizedValue,
                currency: isBinance ? 'USDT' : currency,
                cryptoRate: isBinance ? getEffectiveBinanceRate(methodId, prev[methodId]?.cryptoRate) : undefined
            }
        }));
    };

    const handleFlashFill = useCallback((methodId, methodType, remBs, remUsd) => {
        if (remBs <= 0) return;
        const method = methods.find(m => m.id === methodId);
        const isBinance = methodId === 'binance_usdt' || methodId.toLowerCase().includes('binance') || (method?.currency || '').toUpperCase() === 'USDT';

        if (isBinance) {
            const existingUsdt = parseFloat(payments[methodId]?.amount) || 0;
            const exactUsdt = precisionRound(remUsd + existingUsdt, 2);
            const targetBs = precisionRound(exactUsdt * activeExchangeRate, 2);

            setPayments(prev => ({
                ...prev,
                [methodId]: {
                    amount: exactUsdt.toFixed(2),
                    currency: 'USDT',
                    cryptoRate: activeExchangeRate,
                    coveredBs: targetBs
                }
            }));
            return;
        }

        const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(methodId.toLowerCase()) || methodId.toLowerCase().includes('bs') || methodId.toLowerCase().includes('ves') || methodId.toLowerCase().includes('movil'));
        const currency = isSingle ? 'USD' : (method?.currency || method?.defaultCurrency || (isVesKey ? 'VES' : 'USD'));
        const existingVal = parseFloat(payments[methodId]?.amount) || 0;
        const amount = currency === 'USD' ? (remUsd + existingVal) : (remBs + existingVal);

        setPayments(prev => ({
            ...prev,
            [methodId]: {
                amount: currency === 'USD' ? precisionRound(amount, 4).toFixed(2) : precisionRound(amount, 2).toFixed(2),
                currency
            }
        }));
    }, [methods, isSingle, payments, getEffectiveBinanceRate]);

    // Ejecutar Pago Exprés en 1-Clic
    const executeExpressPayment = useCallback((typeKey, autoSubmit = true) => {
        const targetMethod = findMethodKey(typeKey);
        if (typeKey === 'binance' || typeKey === 'binance_usdt' || targetMethod?.currency === 'USDT') {
            openBinanceQr(targetMethod || { id: 'binance_usdt', name: 'Binance Pay', currency: 'USDT' });
            return;
        }
        if (typeKey === 'movil' || typeKey === 'pago_movil' || (targetMethod?.id || '').toLowerCase().includes('movil')) {
            openPagoMovilQr(targetMethod || { id: 'pago_movil', name: 'Pago Móvil', currency: 'VES' });
            return;
        }
        if (!targetMethod) return;

        // Comprobar si este método de pago goza de una promoción/descuento activo
        const promo = getMethodPromo(targetMethod.id, targetMethod.name);
        const promoSavings = promo ? promo.savings : 0;
        setActivePaymentPromo(promo || null);

        const netUsd = Math.max(0, totalToPayUsd - promoSavings);
        const netVes = precisionRound(netUsd * activeExchangeRate, 2);

        const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(targetMethod.id.toLowerCase()) || targetMethod.id.toLowerCase().includes('bs') || targetMethod.id.toLowerCase().includes('ves') || targetMethod.id.toLowerCase().includes('movil'));
        const currency = isSingle ? 'USD' : (targetMethod.currency || targetMethod.defaultCurrency || (isVesKey ? 'VES' : 'USD'));
        const exactAmount = currency === 'USD' ? netUsd : netVes;

        // Limpiar otros métodos y dejar 100% en el seleccionado
        setPayments({
            [targetMethod.id]: {
                amount: currency === 'USD' ? exactAmount.toFixed(4) : exactAmount.toFixed(2),
                currency
            }
        });

        if (autoSubmit) {
            // Se envía de inmediato en el siguiente micro-tick de React
            setTimeout(() => {
                const form = document.getElementById('checkout-form');
                if (form) form.requestSubmit();
            }, 50);
        }
    }, [findMethodKey, isSingle, totalToPayUsd, totalToPayVes, activeExchangeRate, getMethodPromo]);

    const [updatingBinanceRate, setUpdatingBinanceRate] = useState(false);

    const handleUpdateBinanceRate = async (newRate = null, targetMethodId = null) => {
        try {
            setUpdatingBinanceRate(true);
            let rateToApply = newRate;
            if (rateToApply === null || rateToApply === undefined) {
                const res = await api.get('/settings/binance/rate');
                if (res.data && res.data.rate) {
                    rateToApply = Number(res.data.rate);
                } else {
                    throw new Error('No se pudo obtener la tasa P2P');
                }
            }

            const validRate = Number(rateToApply);
            if (!validRate || validRate <= 0) {
                if (newRate === 0) return;
                toast.error('Tasa inválida');
                return;
            }

            // 1. Actualizar en la lista local de métodos de pago
            setMethods(prev => prev.map(m => {
                if (m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT' || m.id === targetMethodId) {
                    return { ...m, binanceRate: validRate };
                }
                return m;
            }));

            // 2. Si el modal QR de Binance está abierto, recalcular monto y regenerar QR
            if (qrModalMethod && qrModalMethod.isBinance) {
                const amountBs = Number(qrModalMethod.amountBs || (remainingBs > 0 ? remainingBs : totalToPayVes));
                const newAmountUsdt = precisionRound(amountBs / validRate, 2);
                const updated = {
                    ...qrModalMethod,
                    binanceRate: validRate,
                    amountUsdt: newAmountUsdt
                };
                setQrModalMethod(updated);

                if (updated.binanceQrMode !== 'IMAGE') {
                    setGeneratingQrModal(true);
                    generateBinanceQR({
                        payId: updated.binancePayId,
                        email: updated.binanceEmail,
                        amountUsdt: newAmountUsdt,
                        customImage: updated.binanceQrImage,
                        mode: updated.binanceQrMode
                    }).then(url => {
                        setQrModalUrl(url || updated.binanceQrImage || '');
                        setGeneratingQrModal(false);
                    }).catch(() => setGeneratingQrModal(false));
                }
            }

            // 3. Sincronizar en segundo plano con el backend
            api.post('/settings/binance/rate', { rate: validRate }).catch(() => {});

            if (newRate === null || newRate === undefined) {
                toast.success(`Tasa P2P actualizada: ${validRate.toFixed(2)} Bs/USDT`);
            }
        } catch (err) {
            console.error('Error actualizando tasa Binance:', err);
            toast.error('Error al consultar tasa P2P');
        } finally {
            setUpdatingBinanceRate(false);
        }
    };

    // Apertura y control del Modal Visual de Pago Móvil & Código QR
    const openBinanceQr = (targetMethod) => {
        if (!targetMethod) return;
        setFocusedExpressMethodId(targetMethod.id || 'binance_usdt');
        const payId = targetMethod.binancePayId || businessSettings?.binancePayId || '';
        const email = targetMethod.binanceEmail || businessSettings?.binanceEmail || '';
        const customImage = targetMethod.binanceQrImage || businessSettings?.binanceQrImage || '';
        const mode = targetMethod.binanceQrMode || (customImage ? 'IMAGE' : 'AUTO');

        // Paridad 1:1 con USD (1 USDT = $1.00 USD)
        let amountUsdt = precisionRound(remainingUsd > 0 ? remainingUsd : totalToPayUsd, 2);
        if (viewMode === 'split' && parseFloat(payments[targetMethod.id]?.amount) > 0) {
            amountUsdt = precisionRound(parseFloat(payments[targetMethod.id].amount), 2);
        }
        const effectiveRate = activeExchangeRate > 0 ? activeExchangeRate : 1;
        const amountBs = precisionRound(amountUsdt * effectiveRate, 2);

        const methodWithData = {
            ...targetMethod,
            isBinance: true,
            binancePayId: payId,
            binanceEmail: email,
            binanceRate: effectiveRate,
            binanceQrImage: customImage,
            binanceQrMode: mode,
            amountBs,
            amountUsdt
        };

        setQrModalMethod(methodWithData);
        setQrModalReference(paymentReferences[targetMethod.id] || '');
        setGeneratingQrModal(true);

        if (mode === 'IMAGE' && customImage) {
            setQrModalUrl(customImage);
            setGeneratingQrModal(false);
        } else {
            generateBinanceQR({
                payId,
                email,
                amountUsdt,
                customImage,
                mode
            }).then(url => {
                setQrModalUrl(url || customImage || '');
                setGeneratingQrModal(false);
            }).catch(() => {
                setGeneratingQrModal(false);
            });
        }
    };

    const openPagoMovilQr = (targetMethod) => {
        if (!targetMethod) return;
        setFocusedExpressMethodId(targetMethod.id || 'pago_movil');
        const qmBank = targetMethod.pagoMovilBank || businessSettings?.pagoMovilBank || '';
        const rawPhone = targetMethod.pagoMovilPhone || businessSettings?.pagoMovilPhone || businessSettings?.phone || '';
        const qmPhone = cleanPhone(rawPhone);
        const rawId = targetMethod.pagoMovilId || businessSettings?.pagoMovilId || businessSettings?.rif || '';
        const qmId = cleanIdNumber(rawId);
        const qmMode = targetMethod.pagoMovilQrMode || 'AUTO';
        const qmCustomImage = targetMethod.pagoMovilQrImage || '';
        const includeAmount = targetMethod.pagoMovilIncludeAmount !== false;

        let currentAmountBs = 0;
        if (viewMode === 'split' && parseFloat(payments[targetMethod.id]?.amount) > 0) {
            currentAmountBs = targetMethod.currency === 'USD' 
                ? precisionRound(parseFloat(payments[targetMethod.id].amount) * activeExchangeRate, 2)
                : parseFloat(payments[targetMethod.id].amount);
        } else {
            currentAmountBs = remainingBs > 0 ? remainingBs : totalToPayVes;
        }

        const methodWithData = {
            ...targetMethod,
            pagoMovilBank: qmBank,
            pagoMovilPhone: qmPhone,
            pagoMovilId: qmId,
            pagoMovilQrMode: qmMode,
            pagoMovilQrImage: qmCustomImage,
            pagoMovilIncludeAmount: includeAmount,
            amountBs: currentAmountBs
        };

        setQrModalMethod(methodWithData);
        setQrModalReference(paymentReferences[targetMethod.id] || '');
        setGeneratingQrModal(true);

        if (qmMode === 'IMAGE' && qmCustomImage) {
            setQrModalUrl(qmCustomImage);
            setGeneratingQrModal(false);
        } else {
            generatePagoMovilQR({
                bankCode: qmBank,
                phone: qmPhone,
                idNumber: qmId,
                amountBs: currentAmountBs,
                customImage: qmCustomImage,
                mode: qmMode,
                includeAmount: includeAmount
            }).then(url => {
                setQrModalUrl(url || '');
                setGeneratingQrModal(false);
            }).catch(() => {
                setGeneratingQrModal(false);
            });
        }
    };

    const handleCopyText = (text, fieldKey) => {
        if (!text) return;
        navigator.clipboard.writeText(String(text));
        setCopiedField(fieldKey);
        toast.success('Copiado al portapapeles');
        setTimeout(() => setCopiedField(null), 2000);
    };

    const handleCopyAll = () => {
        if (!qrModalMethod) return;
        const text = qrModalMethod.isBinance
            ? `*DATOS DE BINANCE PAY (USDT)*\n🟡 Pay ID: ${qrModalMethod.binancePayId || '-'}\n📧 Correo: ${qrModalMethod.binanceEmail || '-'}\n💵 Total a Transferir: ${Number(qrModalMethod.amountUsdt || 0).toFixed(2)} USDT (Paridad 1:1 USD · Equiv: ${formatBs(qrModalMethod.amountBs || 0)})`
            : `*DATOS DE PAGO MÓVIL*\n🏦 Banco: ${getBankNameByCode(qrModalMethod.pagoMovilBank)}\n📱 Teléfono: ${formatPhoneDisplay(qrModalMethod.pagoMovilPhone)}\n🪪 C.I/RIF: ${formatIdDisplay(qrModalMethod.pagoMovilId)}\n💵 Monto: ${formatBs(qrModalMethod.amountBs || 0)}`;
        navigator.clipboard.writeText(text);
        setCopiedField('all');
        toast.success('Datos copiados para WhatsApp');
        setTimeout(() => setCopiedField(null), 2000);
    };

    const handleConfirmQrPayment = () => {
        if (!qrModalMethod) return;

        const cleanRef = (qrModalReference || '').trim();
        if (!cleanRef) {
            toast.error('⚠️ El número de referencia / comprobante es obligatorio para confirmar el pago.');
            const refInput = document.getElementById('qr-modal-reference-input');
            if (refInput) refInput.focus();
            return;
        }

        if (qrModalMethod.isBinance) {
            const targetMethod = qrModalMethod;
            const amountUsdt = Number(targetMethod.amountUsdt || 0);
            const binRate = Number(targetMethod.binanceRate || activeExchangeRate);
            const targetBs = Number(targetMethod.amountBs || 0);

            if (viewMode === 'express') {
                setPayments({
                    [targetMethod.id]: {
                        amount: amountUsdt.toFixed(2),
                        currency: 'USDT',
                        cryptoRate: binRate,
                        coveredBs: targetBs > 0 ? targetBs : undefined,
                        reference: cleanRef
                    }
                });
                setPaymentReferences(prev => ({ ...prev, [targetMethod.id]: cleanRef }));
                setQrModalMethod(null);
                setTimeout(() => {
                    const form = document.getElementById('checkout-form');
                    if (form) form.requestSubmit();
                }, 60);
            } else {
                setPayments(prev => ({
                    ...prev,
                    [targetMethod.id]: {
                        amount: amountUsdt.toFixed(2),
                        currency: 'USDT',
                        cryptoRate: binRate,
                        coveredBs: targetBs > 0 ? targetBs : undefined,
                        reference: cleanRef
                    }
                }));
                setPaymentReferences(prev => ({ ...prev, [targetMethod.id]: cleanRef }));
                setQrModalMethod(null);
                toast.success(`Binance Pay registrado: ${amountUsdt.toFixed(2)} USDT (Ref: ${cleanRef})`);
            }
            return;
        }

        const targetMethod = qrModalMethod;
        const promo = getMethodPromo(targetMethod.id, targetMethod.name);
        const promoSavings = promo ? promo.savings : 0;
        if (promo) setActivePaymentPromo(promo);

        const amountBs = targetMethod.amountBs || (remainingBs > 0 ? remainingBs : totalToPayVes);
        const amountUsd = precisionRound(amountBs / activeExchangeRate, 4);

        if (viewMode === 'express') {
            const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(targetMethod.id.toLowerCase()) || targetMethod.id.toLowerCase().includes('bs') || targetMethod.id.toLowerCase().includes('ves') || targetMethod.id.toLowerCase().includes('movil'));
            const currency = isSingle ? 'USD' : (targetMethod.currency || targetMethod.defaultCurrency || (isVesKey ? 'VES' : 'USD'));
            const netUsd = Math.max(0, totalToPayUsd - promoSavings);
            const netVes = precisionRound(netUsd * activeExchangeRate, 2);
            const exactAmount = currency === 'USD' ? netUsd : netVes;

            setPayments({
                [targetMethod.id]: {
                    amount: currency === 'USD' ? exactAmount.toFixed(4) : exactAmount.toFixed(2),
                    currency,
                    reference: cleanRef
                }
            });

            setPaymentReferences(prev => ({ ...prev, [targetMethod.id]: cleanRef }));

            setQrModalMethod(null);
            setTimeout(() => {
                const form = document.getElementById('checkout-form');
                if (form) form.requestSubmit();
            }, 60);
        } else {
            // Modo Split
            const currency = targetMethod.currency || 'VES';
            setPayments(prev => ({
                ...prev,
                [targetMethod.id]: {
                    amount: currency === 'USD' ? amountUsd.toFixed(4) : amountBs.toFixed(2),
                    currency,
                    reference: cleanRef
                }
            }));

            setPaymentReferences(prev => ({ ...prev, [targetMethod.id]: cleanRef }));

            setQrModalMethod(null);
            toast.success(`Pago Móvil registrado: ${formatBs(amountBs)} (Ref: ${cleanRef})`);
        }
    };

    const handleQuickAmount = (amountInUsd) => {
        const method = methods[selectedIndex] || findMethodKey('cash_usd');
        if (!method) return;
        const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(method.id.toLowerCase()) || method.id.toLowerCase().includes('bs') || method.id.toLowerCase().includes('ves') || method.id.toLowerCase().includes('movil'));
        const currency = isSingle ? 'USD' : (method.currency || method.defaultCurrency || (isVesKey ? 'VES' : 'USD'));
        
        const valueToSet = currency === 'VES' ? precisionRound(amountInUsd * activeExchangeRate, 2) : amountInUsd;
        
        setPayments({
            [method.id]: { amount: valueToSet.toString(), currency }
        });
    };

    const handleKeyDown = useCallback((e) => {
        if (!isOpen) return;

        // Teclas Rápidas de Cobro Directo 1-Clic
        if (e.key === 'F1') {
            e.preventDefault();
            executeExpressPayment('cash_usd', true);
            return;
        }
        if (e.key === 'F2') {
            e.preventDefault();
            executeExpressPayment('cash_bs', true);
            return;
        }
        if (e.key === 'F3') {
            e.preventDefault();
            executeExpressPayment('debit', true);
            return;
        }
        if (e.key === 'F4') {
            e.preventDefault();
            executeExpressPayment('movil', true);
            return;
        }
        if (e.key === 'F5' && viewMode === 'express') {
            e.preventDefault();
            executeExpressPayment('biopago', true);
            return;
        }
        if (e.key === 'F6' && viewMode === 'express') {
            e.preventDefault();
            const bMeth = findMethodKey('binance');
            if (bMeth) openBinanceQr(bMeth);
            return;
        }
        if (e.key === 'F12') {
            e.preventDefault();
            setViewMode(prev => prev === 'express' ? 'split' : 'express');
            return;
        }

        if (viewMode === 'split') {
            if (e.key === 'ArrowRight' && !e.ctrlKey) {
                e.preventDefault();
                const method = methods[selectedIndex];
                if (method) {
                    const btn = document.getElementById(`flash-fill-${method.id}`);
                    if (btn) btn.click();
                }
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 3, methods.length - 1));
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 3, 0));
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            }
        }

        if (e.key === 'Enter') {
            const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
            const isAmountInput = e.target.id && e.target.id.startsWith('payment-amount-');

            if (isAmountInput) {
                e.preventDefault();
                if (selectedIndex < methods.length - 1) {
                    setSelectedIndex(prev => prev + 1);
                } else {
                    const form = document.getElementById('checkout-form');
                    if (form) form.requestSubmit();
                }
            } else if (!isInput) {
                e.preventDefault();
                const form = document.getElementById('checkout-form');
                if (form) form.requestSubmit();
            }
        }
    }, [isOpen, viewMode, methods, selectedIndex, executeExpressPayment]);

    useEffect(() => {
        if (!isOpen) return;
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, handleKeyDown]);

    const suggestedChange = useMemo(() => {
        if (isInsufficient || changeUsd <= 0) return null;
        const bills = [100, 50, 20, 10, 5, 1];
        let remaining = changeUsd;
        const suggestion = [];
        bills.forEach(bill => {
            const count = Math.floor(remaining / bill);
            if (count > 0) {
                suggestion.push({ bill, count });
                remaining = precisionRound(remaining - (count * bill), 2);
            }
        });
        return suggestion;
    }, [changeUsd, isInsufficient]);

    // 📺 Sincronización en tiempo real hacia el Visor de Cliente (Socket.io + BroadcastChannel + LocalStorage)
    const broadcastPaymentSelection = useCallback((customPayload = null) => {
        try {
            let payload = customPayload;
            if (!payload) {
                if (!isOpen) {
                    payload = {
                        isCheckoutOpen: false,
                        activeMethod: null,
                        qrModalMethod: null,
                        timestamp: Date.now()
                    };
                } else {
                    let activeMethodObj = null;

                    // Lista estructurada de abonos ingresados para Pago Mixto
                    const activeSplitList = Object.entries(payments || {})
                        .filter(([_, p]) => p && Number(p.amount) > 0)
                        .map(([mId, p]) => {
                            const m = (methods || []).find(x => x.id === mId) || findMethodKey(mId);
                            const amountNum = Number(p.amount) || 0;
                            const curr = (p.currency || m?.currency || 'USD').toUpperCase();
                            const isUsd = curr === 'USD';
                            const isVes = curr === 'VES' || curr === 'BS';
                            const isUsdt = curr === 'USDT' || mId.includes('binance');

                            let equivBs = 0;
                            let equivUsd = 0;
                            if (isUsd) {
                                equivUsd = amountNum;
                                equivBs = precisionRound(amountNum * activeExchangeRate, 2);
                            } else if (isVes) {
                                equivBs = amountNum;
                                equivUsd = activeExchangeRate > 0 ? precisionRound(amountNum / activeExchangeRate, 2) : 0;
                            } else if (isUsdt) {
                                equivUsd = amountNum;
                                equivBs = (p.coveredBs && Math.abs(amountNum - precisionRound(Number(p.coveredBs) / activeExchangeRate, 2)) < 0.001)
                                    ? Number(p.coveredBs)
                                    : precisionRound(amountNum * activeExchangeRate, 2);
                            }

                            return {
                                id: mId,
                                name: m?.name || cleanMethodName(mId),
                                currency: curr,
                                amount: amountNum,
                                equivBs,
                                equivUsd,
                                isCash: Boolean(m?.isCash || mId.includes('cash') || mId.includes('efectivo')),
                                isBinance: isUsdt,
                                isPagoMovil: Boolean(mId.includes('movil') || m?.pagoMovilPhone || m?.pagoMovilId),
                                isDebit: Boolean(mId.includes('debit') || mId.includes('punto') || mId.includes('card')),
                                reference: paymentReferences[mId] || p.reference || '',
                                pagoMovilBank: m?.pagoMovilBank || '',
                                pagoMovilPhone: m?.pagoMovilPhone || '',
                                pagoMovilId: m?.pagoMovilId || '',
                                binancePayId: m?.binancePayId || '',
                                binanceEmail: m?.binanceEmail || ''
                            };
                        });

                    if (qrModalMethod) {
                        activeMethodObj = {
                            ...qrModalMethod,
                            isQrModal: true,
                            qrUrl: qrModalUrl || qrModalMethod.binanceQrImage || qrModalMethod.pagoMovilQrImage || ''
                        };
                    } else if (viewMode === 'split' && methods[selectedIndex]) {
                        const m = methods[selectedIndex];
                        const p = payments[m.id];
                        const isBin = (m.id || '').toLowerCase().includes('binance') || (m.currency || '').toUpperCase() === 'USDT';
                        const isPM = (m.id || '').toLowerCase().includes('movil') || Boolean(m.pagoMovilPhone || m.pagoMovilId);
                        activeMethodObj = {
                            ...m,
                            isBinance: isBin,
                            isPagoMovil: isPM,
                            appliedAmount: p?.amount || '',
                            appliedCurrency: p?.currency || m.currency || 'USD',
                            requiresReference: m.requiresReference || false
                        };
                    } else {
                        // Modo Express: buscar el enfocado o el primer método relevante
                        const targetId = focusedExpressMethodId || (isUsdOnly ? 'cash_usd' : 'pago_movil');
                        const m = methods.find(x => x.id === targetId) || findMethodKey(targetId) || methods[0];
                        if (m) {
                            const isBin = (m.id || '').toLowerCase().includes('binance') || (m.currency || '').toUpperCase() === 'USDT';
                            const isPM = (m.id || '').toLowerCase().includes('movil') || Boolean(m.pagoMovilPhone || m.pagoMovilId);
                            activeMethodObj = {
                                ...m,
                                isBinance: isBin,
                                isPagoMovil: isPM,
                                isExpress: true,
                                ...(isBin ? {
                                    amountUsdt: precisionRound(stats?.totalToPayUsd ?? total, 2),
                                    amountBs: precisionRound(stats?.totalToPayVes ?? (total * activeExchangeRate), 2),
                                    binanceRate: activeExchangeRate
                                } : {})
                            };
                        }
                    }

                    const currentCust = (selectedCustomerId && Array.isArray(customers))
                        ? customers.find(c => String(c.id) === String(selectedCustomerId))
                        : null;
                    const resolvedCustName = currentCust?.name || (selectedCustomerId && String(selectedCustomerId) === String(initialCustomerId) ? (customerName || '') : '');
                    const resolvedCustDoc = currentCust?.idDocument || currentCust?.identification || '';

                    payload = {
                        isCheckoutOpen: true,
                        viewMode,
                        isSplit: viewMode === 'split' || activeSplitList.length > 1,
                        splitPayments: activeSplitList,
                        focusedMethodId: methods[selectedIndex]?.id || null,
                        activeMethod: activeMethodObj,
                        qrModalMethod: qrModalMethod ? {
                            ...qrModalMethod,
                            isQrModal: true,
                            qrUrl: qrModalUrl || qrModalMethod.binanceQrImage || qrModalMethod.pagoMovilQrImage || ''
                        } : null,
                        customerId: currentCust?.id || selectedCustomerId || null,
                        customerName: resolvedCustName,
                        customerDoc: resolvedCustDoc,
                        totals: {
                            totalToPayUsd: stats?.totalToPayUsd ?? total,
                            totalToPayVes: stats?.totalToPayVes ?? (total * activeExchangeRate),
                            currentIgtfUsd: stats?.currentIgtfUsd ?? 0,
                            receivedUsd: stats?.receivedUsd ?? 0,
                            receivedVes: stats?.receivedVes ?? 0,
                            remainingUsd: stats?.remainingUsd ?? total,
                            remainingBs: stats?.remainingBs ?? (total * activeExchangeRate),
                            changeUsd: stats?.changeUsd ?? 0,
                            changeBs: stats?.changeBs ?? 0,
                            isInsufficient: stats?.isInsufficient ?? true
                        },
                        payments,
                        activePaymentPromo,
                        companyId: user?.companyId || '1',
                        registerId: registerId || '1',
                        timestamp: Date.now()
                    };
                }
            }

            // 1. LocalStorage para lectura instantánea en la misma estación
            try {
                localStorage.setItem('isaac_pos_display_payment_sync', JSON.stringify(payload));
            } catch (_) {}

            // 2. BroadcastChannel para sincronización inter-procesos/doble monitor (0ms)
            try {
                if (typeof BroadcastChannel !== 'undefined') {
                    const bc = new BroadcastChannel('isaac_pos_display_sync');
                    bc.postMessage({ type: 'PAYMENT_SELECTION_UPDATE', payload });
                    bc.close();
                }
            } catch (_) {}

            // 3. Socket.io para pantallas en red Wi-Fi / IP LAN
            if (socket && socket.connected) {
                socket.emit('customer_display_payment_update', payload);
            }

            // 4. CustomEvent local en ventana
            try {
                window.dispatchEvent(new CustomEvent('isaac_pos_display_payment_local_update', { detail: payload }));
            } catch (_) {}
        } catch (_) {}
    }, [isOpen, qrModalMethod, qrModalUrl, viewMode, methods, selectedIndex, focusedExpressMethodId, payments, paymentReferences, stats, activePaymentPromo, total, activeExchangeRate, user, registerId, socket, findMethodKey, isUsdOnly, businessSettings, getEffectiveBinanceRate, selectedCustomerId, customers, initialCustomerId, customerName]);

    useEffect(() => {
        broadcastPaymentSelection();
    }, [broadcastPaymentSelection]);

    useEffect(() => {
        if (!isOpen) {
            broadcastPaymentSelection({
                isCheckoutOpen: false,
                activeMethod: null,
                qrModalMethod: null,
                timestamp: Date.now()
            });
        }
    }, [isOpen, broadcastPaymentSelection]);

    const [isLocalSubmitting, setIsLocalSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (processing || isLocalSubmitting || isInsufficient) return;

        const isOfflineExplicit = typeof window !== 'undefined' && (localStorage.getItem('isaac_pos_is_offline_mode') === 'true' || !navigator.onLine);
        if (!isOfflineExplicit) {
            try {
                const shiftCheck = await api.get('/cash/current', { params: { registerId }, timeout: 1500 });
                if (shiftCheck.data === false || (shiftCheck.data && shiftCheck.data.status === 'closed')) {
                    toast.error('⚠️ CAJA CERRADA: Debes abrir el turno de caja antes de realizar una venta.', { id: 'caja-cerrada-submit-toast', duration: 4000 });
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('open_cash_modal'));
                    }
                    onClose();
                    return;
                }
            } catch (err) {
                console.warn('Verificación de turno omitida o sin conexión:', err.message);
            }
        }

        // Validar obligatoriedad de número de referencia en pagos electrónicos (Binance Pay, Pago Móvil, Zelle, Transferencias)
        for (const [id, p] of Object.entries(payments)) {
            if (parseFloat(p.amount) > 0) {
                const method = methods.find(m => m.id === id);
                const idLower = (id || '').toLowerCase();
                const nameLower = (method?.name || '').toLowerCase();
                const isRefRequired = Boolean(
                    method?.requiresReference ||
                    p.currency === 'USDT' ||
                    idLower.includes('binance') ||
                    idLower.includes('movil') ||
                    idLower.includes('zelle') ||
                    idLower.includes('transfer') ||
                    nameLower.includes('binance') ||
                    nameLower.includes('móvil') ||
                    nameLower.includes('movil') ||
                    nameLower.includes('zelle') ||
                    nameLower.includes('transfer')
                );
                const refVal = (paymentReferences[id] || p.reference || '').trim();
                if (isRefRequired && !refVal) {
                    toast.error(`⚠️ El número de referencia / comprobante es obligatorio para ${method?.name || id}.`);
                    const refInput = document.getElementById(`payment-reference-${id}`);
                    if (refInput) refInput.focus();
                    return;
                }
            }
        }

        const hasFiado = Object.entries(payments).some(([id, p]) => {
            const method = methods.find(m => m.id === id);
            return (method?.type === 'CREDIT' || method?.id === 'fiado') && (parseFloat(p.amount) > 0);
        });

        if (hasFiado && !selectedCustomerId) {
            toast.error('¡Debe seleccionar un cliente para procesar pagos a crédito (Fiado)!');
            return;
        }

        setIsLocalSubmitting(true);
        const customer = Array.isArray(customers) ? customers.find(c => String(c.id) === String(selectedCustomerId)) : null;

        if (hasFiado && customer) {
            if (customer.isCreditBlocked) {
                toast.error('🚫 ¡VENTA A CRÉDITO BLOQUEADA! El cliente tiene el crédito suspendido por morosidad.');
                setIsLocalSubmitting(false);
                return;
            }

            try {
                const { data: profData } = await api.get(`/collections/customer-profile/${customer.id}`, { timeout: 1500 });
                if (profData?.success && profData.profile?.trafficLight === 'RED' && !profData.profile?.canSellCredit) {
                    toast.error(`🚫 ¡CRÉDITO DENEGADO! ${profData.profile.blockReason || 'Cliente en semáforo rojo.'}`);
                    setIsLocalSubmitting(false);
                    return;
                }
            } catch (err) {
                console.warn('Error al verificar perfil de cobranza en CheckoutModal:', err);
            }

            const fiadoAmountUsd = Object.entries(payments).reduce((sum, [id, p]) => {
                const method = methods.find(m => m.id === id);
                if (method?.type === 'CREDIT' || method?.id === 'fiado') {
                    const amount = parseFloat(p.amount) || 0;
                    return sum + (p.currency === 'VES' ? amount / activeExchangeRate : amount);
                }
                return sum;
            }, 0);

            const availableCredit = (customer.creditLimit || 0) - (customer.creditBalance || 0);

            if ((customer.creditLimit || 0) <= 0 && fiadoAmountUsd > 0) {
                toast.error('¡El cliente seleccionado no tiene límite de crédito habilitado!');
                setIsLocalSubmitting(false);
                return;
            }
            if (fiadoAmountUsd > availableCredit) {
                toast.error(`¡Crédito insuficiente! Límite disponible: ${renderFormatMoney(availableCredit, 'USD')}`);
                setIsLocalSubmitting(false);
                return;
            }
        }

        let currentTxId = transactionId;
        if (!currentTxId) {
            currentTxId = uuidv4();
            setTransactionId(currentTxId);
        }

        const finalPaymentMethods = Object.entries(payments)
            .filter(([_, p]) => parseFloat(p.amount) > 0)
            .map(([id, p]) => {
                const isBin = p.currency === 'USDT' || id === 'binance_usdt' || id.includes('binance');
                const binRate = isBin ? getEffectiveBinanceRate(id, p.cryptoRate) : undefined;
                const amt = parseFloat(p.amount);
                const covBs = isBin
                    ? ((p.coveredBs && Math.abs(amt - precisionRound(Number(p.coveredBs) / binRate, 2)) < 0.001)
                        ? Number(p.coveredBs)
                        : precisionRound(amt * binRate, 2))
                    : undefined;
                return {
                    method: id,
                    amount: amt,
                    currency: isBin ? 'USDT' : p.currency,
                    cryptoRate: binRate,
                    convertedAmountBs: covBs,
                    reference: (paymentReferences[id] || p.reference || '').trim()
                };
            });

        const primaryMethod = finalPaymentMethods[0]?.method;
        const matchedPromo = activePaymentPromo || (primaryMethod ? getMethodPromo(primaryMethod, methods.find(m => m.id === primaryMethod)?.name) : null);

        let finalItems = effectiveCart;
        let additionalPromoDiscount = 0;
        let additionalAppliedPromos = [];

        if (matchedPromo) {
            const evalResult = evaluateCartPromotions(effectiveCart, effectivePromotions, primaryMethod);
            if (evalResult.itemsWithPromotions?.length > 0) {
                finalItems = evalResult.itemsWithPromotions;
            }
            additionalPromoDiscount = matchedPromo.savings;
            additionalAppliedPromos = [{
                id: matchedPromo.promoId,
                name: matchedPromo.promoName,
                type: 'PAYMENT_METHOD_DISCOUNT',
                savings: matchedPromo.savings
            }];
        }

        const calculatedFinalTotal = matchedPromo 
            ? Math.max(0, precisionRound(totalToPayUsd - additionalPromoDiscount, 2))
            : totalToPayUsd;

        try {
            await onConfirm({
                clientTransactionId: currentTxId,
                exchangeRate: liveExchangeRateRef.current,
                paymentMethods: finalPaymentMethods,
                customerId: customer?.id || selectedCustomerId || null,
                customerName: customer?.name || customerName || 'Cliente Ocasional',
                paymentMethod: finalPaymentMethods[0]?.method || 'cash',
                total: calculatedFinalTotal,
                subtotal: subtotal || total,
                tax: taxAmount || 0,
                igtfAmount: currentIgtfUsd,
                discount: discountAmount || 0,
                promoDiscount: precisionRound((basePromoDiscount || 0) + additionalPromoDiscount, 2),
                appliedPromotions: [...(baseAppliedPromotions || []), ...additionalAppliedPromos],
                items: finalItems,
                taxInfo: {
                    ...taxInfo,
                    igtfAmount: currentIgtfUsd
                },
                taxRate: ivaRate,
                documentType: documentType,
                registerId: registerId,
                registerName: registerDisplayName || 'Caja 1',
                cashierName: user?.name || user?.username || 'Cajero'
            });

            playSuccessSound();

            // 📺 Notificar al Visor de Cliente que la venta finalizó con éxito
            try {
                const saleSuccessPayload = {
                    totalUSD: stats?.totalToPayUsd || total,
                    totalBs: stats?.totalToPayVes || (total * activeExchangeRate),
                    changeUSD: stats?.changeUsd || 0,
                    changeBs: stats?.changeBs || 0,
                    receivedUSD: stats?.receivedUsd || total,
                    receivedBs: stats?.receivedVes || 0,
                    customerName: customer?.name || customerName || '',
                    customerDoc: customer?.idDocument || customer?.identification || '',
                    timestamp: Date.now()
                };
                if (typeof BroadcastChannel !== 'undefined') {
                    const bc = new BroadcastChannel('isaac_pos_display_sync');
                    bc.postMessage({ type: 'SALE_COMPLETED', payload: saleSuccessPayload });
                    bc.close();
                }
                localStorage.setItem('isaac_pos_display_sync_sale_completed', JSON.stringify(saleSuccessPayload));
                if (socket && socket.connected) {
                    socket.emit('customer_display_sale_completed', saleSuccessPayload);
                }
            } catch (_) {}

            setShowSuccess(true);
            setTransactionId(null);
            setTimeout(() => {
                setShowSuccess(false);
                onClose();
                setIsLocalSubmitting(false);
            }, 1500);
        } catch (err) {
            setIsLocalSubmitting(false);
            setTransactionId(null);
            console.error('Checkout error:', err);
            const errMsg = err?.response?.data?.error || err?.message || 'Error al procesar el cobro.';
            toast.error(errMsg, { id: 'checkout-submit-error', duration: 4000 });
        }
    };

    const DynamicIcon = ({ name, size = 20, className = "" }) => {
        const icons = { Banknote, CreditCard, User, Send, DollarSign, X, Wallet, Fingerprint, QrCode, Coins };
        const IconComp = icons[name] || (name === 'Fingerprint' ? Fingerprint : CreditCard);
        return <IconComp size={size} className={className} />;
    };

    const renderFormatMoney = (val, mode = null) => utilFormatMoney(val, mode, { rate: activeExchangeRate, currencyMode });

    const activeCustomer = useMemo(() => {
        if (selectedCustomerId && Array.isArray(customers)) {
            return customers.find(c => String(c.id) === String(selectedCustomerId));
        }
        return null;
    }, [selectedCustomerId, customers]);

    const handleResetPayment = useCallback(() => {
        setPayments({});
        setActivePaymentPromo(null);
        setFocusedExpressMethodId('');
    }, []);

    if (!isOpen) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth={isMaximized ? "max-w-[98vw] w-[98vw] 2xl:max-w-[1520px]" : "max-w-[96vw] lg:max-w-[1080px] xl:max-w-[1200px] 2xl:max-w-[1340px]"}
            className={`${isMaximized ? "h-[94vh] max-h-[94vh]" : "h-[90vh] max-h-[860px]"} overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl sm:rounded-2xl transition-all duration-200`}
        >
            {/* Header del Modal con Selector de Modo Industrial y Control de Pantalla */}
            <div className="px-4 sm:px-6 py-2.5 sm:py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white flex justify-between items-center gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 bg-slate-900 dark:bg-slate-800 text-emerald-400 rounded-xl flex items-center justify-center shrink-0 border border-slate-700/80 shadow-inner">
                        <CreditCard size={18} strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
                                Cobro de Venta
                            </h2>
                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hidden xs:inline-block">
                                Terminal POS
                            </span>
                        </div>
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate hidden xs:block">
                            Selección de forma de cobro y calculadora de vuelto en vivo
                        </p>
                    </div>
                </div>

                {/* Controles de Header: Selector de Modo + Maximizar + Cerrar */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Selector de Modo Segmentado Monocromático */}
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200/90 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setViewMode('express')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer select-none ${
                                viewMode === 'express' 
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-extrabold' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Cobro Directo 1-Clic [F12]"
                        >
                            <Zap size={13} className={viewMode === 'express' ? 'text-amber-500 fill-amber-500' : 'text-slate-400'} />
                            <span>1-Clic Directo</span>
                            <span className="hidden sm:inline-block px-1.5 py-0.2 text-[8.5px] font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded border border-slate-300/80 dark:border-slate-700">F12</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('split')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer select-none ${
                                viewMode === 'split' 
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-extrabold' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Pago Mixto / Múltiple [F12]"
                        >
                            <Layers size={13} className={viewMode === 'split' ? 'text-sky-500' : 'text-slate-400'} />
                            <span>Pago Mixto</span>
                            <span className="hidden sm:inline-block px-1.5 py-0.2 text-[8.5px] font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded border border-slate-300/80 dark:border-slate-700">F12</span>
                        </button>
                    </div>

                    {/* Botón Maximizar / Restaurar Pantalla */}
                    <button
                        type="button"
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0 flex items-center justify-center cursor-pointer"
                        title={isMaximized ? "Restaurar tamaño normal" : "Maximizar a pantalla completa"}
                        aria-label="Maximizar o restaurar tamaño"
                    >
                        {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>

                    {/* Botón Cerrar */}
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0 flex items-center justify-center cursor-pointer"
                        disabled={processing}
                        title="Cerrar [Esc]"
                        aria-label="Cerrar modal"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans">
                {/* Banner Principal de Totales y Vuelto - Ledger Contable Unificado */}
                <div className="p-2.5 sm:p-3 bg-slate-100/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-2.5 shrink-0">
                    {/* Columna Total a Pagar */}
                    <div className="bg-white dark:bg-slate-900 p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5">
                            <span className="flex items-center gap-1.5">
                                <Coins size={12} className="text-slate-400" />
                                <span>TOTAL A COBRAR (VENTA)</span>
                            </span>
                            {isDual && (
                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <span className="text-slate-700 dark:text-slate-300 font-mono font-bold text-[10px]">Tasa: {formatBs(activeExchangeRate)}/$</span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                            {!isVesOnly && (
                                <h3 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums font-mono">
                                    {formatUSD(totalToPayUsd)}
                                </h3>
                            )}
                            {!isUsdOnly && (
                                <span className={`${isVesOnly ? 'text-2xl sm:text-3xl text-slate-900 dark:text-white font-black' : 'text-base sm:text-xl font-bold text-slate-600 dark:text-slate-300'} tracking-tight tabular-nums font-mono`}>
                                    {formatBs(totalToPayVes)}
                                </span>
                            )}
                        </div>
                        
                        {/* Renglones Fiscales Contables */}
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {taxableBase > 0 && <span>Base: <strong className="text-slate-700 dark:text-slate-300 tabular-nums">{renderFormatMoney(taxableBase)}</strong></span>}
                            {taxAmount > 0 && <span>IVA ({ivaRate}%): <strong className="text-slate-700 dark:text-slate-300 tabular-nums">{renderFormatMoney(taxAmount)}</strong></span>}
                            {exemptBase > 0 && <span>Exento: <strong className="text-slate-700 dark:text-slate-300 tabular-nums">{renderFormatMoney(exemptBase)}</strong></span>}
                            {currentIgtfUsd > 0 && !isVesOnly && <span className="text-amber-700 dark:text-amber-400 font-bold">IGTF: {formatUSD(currentIgtfUsd)}</span>}
                        </div>

                        {/* Indicador de Oferta por Método de Pago */}
                        {activePaymentPromo && (
                            <div className="flex items-center justify-between text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 px-2 py-0.5 rounded-md mt-1.5">
                                <span className="flex items-center gap-1.5">
                                    <Tag size={11} className="text-amber-600 dark:text-amber-400" />
                                    <span>Descuento ({activePaymentPromo.promoName}):</span>
                                </span>
                                <span className="font-mono font-black">-${activePaymentPromo.savings.toFixed(2)}</span>
                            </div>
                        )}
                    </div>

                    {/* Columna Estado de Pago o CAMBIO / VUELTO */}
                    {!isInsufficient && (changeBs > 0 || changeUsd > 0) ? (
                        /* PLACA MAESTRA DE VUELTO A ENTREGAR */
                        <div className="bg-emerald-600 text-white p-2.5 sm:p-3 rounded-xl shadow-md flex flex-col justify-between border-2 border-emerald-400">
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-100 flex items-center gap-1.5">
                                    <CheckCircle2 size={13} className="text-white" />
                                    <span>VUELTO A ENTREGAR</span>
                                </span>
                                {suggestedChange && !isVesOnly && (
                                    <div className="flex gap-1 flex-wrap">
                                        {suggestedChange.map(({ bill, count }) => (
                                            <span key={bill} className="bg-white/20 backdrop-blur-xs text-white text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border border-white/20">
                                                {count}x ${bill}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-baseline justify-between gap-3 mt-0.5">
                                {!isVesOnly && (
                                    <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight tabular-nums font-mono drop-shadow-sm">
                                        +{formatUSD(changeUsd)}
                                    </h3>
                                )}
                                {!isUsdOnly && (
                                    <span className={`${isVesOnly ? 'text-2xl sm:text-3xl text-white font-black' : 'text-base sm:text-xl font-bold text-emerald-100'} tabular-nums font-mono`}>
                                        +{formatBs(changeBs)}
                                    </span>
                                )}
                            </div>
                            <div className="text-[10px] font-bold text-emerald-100 uppercase tracking-wide mt-1.5 pt-1.5 border-t border-emerald-500/80 flex items-center justify-between">
                                <span>Entregar cambio de gaveta</span>
                                <span className="bg-white/20 px-1.5 py-0.2 rounded text-[9px] font-black">CONFIRMAR CON [ENTER]</span>
                            </div>
                        </div>
                    ) : viewMode === 'express' ? (
                        /* MONITOR DE DESPACHO 1-CLIC */
                        <div className="bg-slate-900 text-white p-2.5 sm:p-3 rounded-xl border border-slate-700/80 shadow-2xs flex flex-col justify-between">
                            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-0.5">
                                <span className="flex items-center gap-1.5 text-emerald-400">
                                    <Zap size={12} className="fill-emerald-400" />
                                    <span>DESPACHO DIRECTO 1-CLIC</span>
                                </span>
                                <span className="font-mono text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.2 rounded border border-slate-700">
                                    [F1 - F6]
                                </span>
                            </div>
                            <div className="my-0.5">
                                <p className="text-xs sm:text-[13px] font-semibold text-slate-200 leading-snug">
                                    Toca una forma de pago abajo o presiona F1 - F6 para liquidar al instante.
                                </p>
                                <p className="text-[10.5px] text-slate-400 mt-0.5">
                                    Para billetes mayores, toca la denominación en el calculador inferior.
                                </p>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1.5 border-t border-slate-800">
                                <span>Saldo pendiente:</span>
                                <span className="font-black text-emerald-400 tabular-nums">{formatUSD(totalToPayUsd)} / {formatBs(totalToPayVes)}</span>
                            </div>
                        </div>
                    ) : (
                        /* ESTADO DE SALDO PENDIENTE EN MODO MIXTO */
                        <div className="bg-amber-50 dark:bg-amber-950/40 p-2.5 sm:p-3 rounded-xl border border-amber-200 dark:border-amber-800/80 shadow-2xs flex flex-col justify-between">
                            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400 mb-0.5">
                                <span>SALDO RESTANTE POR CUBRIR</span>
                                <span className="font-mono text-amber-700 dark:text-amber-300 font-bold">FALTANTE</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-3">
                                {!isVesOnly && (
                                    <h3 className="text-2xl sm:text-3xl font-extrabold text-amber-700 dark:text-amber-400 tracking-tight tabular-nums font-mono">
                                        {formatUSD(remainingUsd)}
                                    </h3>
                                )}
                                {!isUsdOnly && (
                                    <span className={`${isVesOnly ? 'text-2xl sm:text-3xl text-amber-700 dark:text-amber-400 font-extrabold' : 'text-base sm:text-xl font-bold text-amber-700 dark:text-amber-300'} tabular-nums font-mono`}>
                                        {formatBs(remainingBs)}
                                    </span>
                                )}
                            </div>
                            <span className="text-[9.5px] font-medium text-amber-800/80 dark:text-amber-400/80 uppercase tracking-wide mt-1.5 pt-1.5 border-t border-amber-200/60 dark:border-amber-900/40">
                                Selecciona métodos para cubrir el monto faltante
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 custom-scrollbar flex flex-col gap-2.5">
                    {/* Barra de Documento y Cliente Unificada (Cero Redundancias) */}
                    <div className="py-2 px-3 sm:px-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Comprobante:</span>
                            <select
                                value={documentType}
                                onChange={(e) => setDocumentType(e.target.value)}
                                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none font-bold text-xs text-slate-800 dark:text-slate-100 cursor-pointer transition-colors"
                            >
                                <option value="factura">Factura / Recibo</option>
                                <option value="nota_entrega">Nota de Entrega</option>
                            </select>
                        </div>

                        {/* Control de Cliente Unificado Profesional */}
                        <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                            <div className="relative flex items-center w-full max-w-sm sm:max-w-md bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs focus-within:ring-1 focus-within:ring-primary-500 focus-within:border-primary-500">
                                <User size={14} className="text-primary-500 shrink-0 mr-2" />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-2 shrink-0 hidden sm:inline">Cliente:</span>
                                <select
                                    value={selectedCustomerId}
                                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                                    className="w-full bg-transparent font-semibold text-slate-800 dark:text-slate-200 outline-none cursor-pointer truncate"
                                    title="Seleccionar o cambiar cliente"
                                >
                                    <option value="" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                                        Cliente Ocasional (Consumidor Final)
                                    </option>
                                    {Array.isArray(customers) && customers.slice(0, 100).map((c, idx) => (
                                        <option key={`${c.id || 'cust'}-${idx}`} value={c.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                                            {c.name} {c.idDocument ? `(${c.idDocument})` : ''}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={12} className="text-slate-400 shrink-0 pointer-events-none ml-1" />
                            </div>
                        </div>
                    </div>

                    {/* VISTA 1: MODO EXPRESS 1-CLIC */}
                    {viewMode === 'express' ? (
                        <form id="checkout-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
                            {/* Grilla de Cobro Directo 1-Clic */}
                            {(() => {
                                const promoCashUsd = getMethodPromo('cash_usd', 'Efectivo USD');
                                const promoCashBs = getMethodPromo('cash_bs', 'Efectivo Bs');
                                const promoDebit = getMethodPromo('debit', 'Punto de Venta');
                                const promoMovil = getMethodPromo('pago_movil', 'Pago Móvil');
                                const promoTransfer = getMethodPromo('transfer', 'Transfer / Zelle');
                                const promoBiopago = getMethodPromo('biopago', 'Biopago');
                                const promoCredit = getMethodPromo('fiado', 'Crédito / Fiado');

                                const netCashUsd = promoCashUsd ? Math.max(0, totalToPayUsd - promoCashUsd.savings) : totalToPayUsd;
                                const netCashBs = promoCashBs ? Math.max(0, totalToPayVes - precisionRound(promoCashBs.savings * activeExchangeRate, 2)) : totalToPayVes;
                                const netDebit = promoDebit ? Math.max(0, totalToPayVes - precisionRound(promoDebit.savings * activeExchangeRate, 2)) : totalToPayVes;
                                const netMovil = promoMovil ? Math.max(0, totalToPayVes - precisionRound(promoMovil.savings * activeExchangeRate, 2)) : totalToPayVes;
                                const netBiopago = promoBiopago ? Math.max(0, totalToPayVes - precisionRound(promoBiopago.savings * activeExchangeRate, 2)) : totalToPayVes;
                                const netTransfer = promoTransfer ? Math.max(0, totalToPayUsd - promoTransfer.savings) : totalToPayUsd;
                                const netCredit = promoCredit ? Math.max(0, totalToPayUsd - promoCredit.savings) : totalToPayUsd;

                                return (
                                <div className={`grid grid-cols-2 sm:grid-cols-3 ${isUsdOnly ? 'lg:grid-cols-4' : 'lg:grid-cols-6'} gap-2.5 sm:gap-3`}>
                                    {/* F1: EFECTIVO $ */}
                                    <button
                                        type="button"
                                        onMouseEnter={() => setFocusedExpressMethodId('cash_usd')}
                                        onFocus={() => setFocusedExpressMethodId('cash_usd')}
                                        onClick={() => executeExpressPayment('cash_usd', true)}
                                        className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoCashUsd ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                <Banknote size={17} strokeWidth={2.2} />
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {promoCashUsd && (
                                                    <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                        -{promoCashUsd.discountPercentage}%
                                                    </span>
                                                )}
                                                <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                    [F1]
                                                </span>
                                            </div>
                                        </div>
                                        <div className="mt-1">
                                            <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">{isUsdOnly ? 'EFECTIVO' : 'EFECTIVO $'}</h4>
                                            <div className="flex items-baseline gap-1.5">
                                                <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoCashUsd ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                    {formatUSD(netCashUsd)}
                                                </p>
                                                {promoCashUsd && (
                                                    <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                        {formatUSD(totalToPayUsd)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                            {promoCashUsd ? `Ahorras $${promoCashUsd.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                        </div>
                                    </button>

                                    {/* F2: EFECTIVO BS */}
                                    {isUsdOnly ? (
                                        <button
                                            type="button"
                                            onMouseEnter={() => setFocusedExpressMethodId('debit')}
                                            onFocus={() => setFocusedExpressMethodId('debit')}
                                            onClick={() => executeExpressPayment('debit', true)}
                                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoDebit ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                    <CreditCard size={17} strokeWidth={2.2} />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {promoDebit && (
                                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                            -{promoDebit.discountPercentage}%
                                                        </span>
                                                    )}
                                                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                        [F2]
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">TARJETA / DÉBITO</h4>
                                                <div className="flex items-baseline gap-1.5">
                                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoDebit ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                        {formatUSD(netDebit)}
                                                    </p>
                                                    {promoDebit && (
                                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                            {formatUSD(totalToPayUsd)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                                {promoDebit ? `Ahorras $${promoDebit.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                            </div>
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onMouseEnter={() => setFocusedExpressMethodId('cash_bs')}
                                            onFocus={() => setFocusedExpressMethodId('cash_bs')}
                                            onClick={() => executeExpressPayment('cash_bs', true)}
                                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoCashBs ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                    <Wallet size={17} strokeWidth={2.2} />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {promoCashBs && (
                                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                            -{promoCashBs.discountPercentage}%
                                                        </span>
                                                    )}
                                                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                        [F2]
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">EFECTIVO BS.</h4>
                                                <div className="flex items-baseline gap-1.5">
                                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoCashBs ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                        {formatBs(netCashBs)}
                                                    </p>
                                                    {promoCashBs && (
                                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                            {formatBs(totalToPayVes)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                                {promoCashBs ? `Ahorras $${promoCashBs.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                            </div>
                                        </button>
                                    )}

                                    {/* F3: PUNTO DE VENTA */}
                                    {isUsdOnly ? (
                                        <button
                                            type="button"
                                            onMouseEnter={() => setFocusedExpressMethodId('transfer')}
                                            onFocus={() => setFocusedExpressMethodId('transfer')}
                                            onClick={() => executeExpressPayment('transfer', true)}
                                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoTransfer ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                    <Send size={17} strokeWidth={2.2} />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {promoTransfer && (
                                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                            -{promoTransfer.discountPercentage}%
                                                        </span>
                                                    )}
                                                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                        [F3]
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">TRANSFER / ZELLE</h4>
                                                <div className="flex items-baseline gap-1.5">
                                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoTransfer ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                        {formatUSD(netTransfer)}
                                                    </p>
                                                    {promoTransfer && (
                                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                            {formatUSD(totalToPayUsd)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                                {promoTransfer ? `Ahorras $${promoTransfer.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                            </div>
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onMouseEnter={() => setFocusedExpressMethodId('debit')}
                                            onFocus={() => setFocusedExpressMethodId('debit')}
                                            onClick={() => executeExpressPayment('debit', true)}
                                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoDebit ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                    <CreditCard size={17} strokeWidth={2.2} />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {promoDebit && (
                                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                            -{promoDebit.discountPercentage}%
                                                        </span>
                                                    )}
                                                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                        [F3]
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">PUNTO DE VENTA</h4>
                                                <div className="flex items-baseline gap-1.5">
                                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoDebit ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                        {formatBs(netDebit)}
                                                    </p>
                                                    {promoDebit && (
                                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                            {formatBs(totalToPayVes)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                                {promoDebit ? `Ahorras $${promoDebit.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                            </div>
                                        </button>
                                    )}

                                    {/* F4: PAGO MÓVIL */}
                                    {isUsdOnly ? (
                                        <button
                                            type="button"
                                            onMouseEnter={() => setFocusedExpressMethodId('credit')}
                                            onFocus={() => setFocusedExpressMethodId('credit')}
                                            onClick={() => executeExpressPayment('credit', true)}
                                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoCredit ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                    <User size={17} strokeWidth={2.2} />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {promoCredit && (
                                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                            -{promoCredit.discountPercentage}%
                                                        </span>
                                                    )}
                                                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                        [F4]
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">CRÉDITO / FIADO</h4>
                                                <div className="flex items-baseline gap-1.5">
                                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoCredit ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                        {formatUSD(netCredit)}
                                                    </p>
                                                    {promoCredit && (
                                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                            {formatUSD(totalToPayUsd)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                                Cobro Directo 1-Clic
                                            </div>
                                        </button>
                                    ) : (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onMouseEnter={() => setFocusedExpressMethodId('pago_movil')}
                                            onFocus={() => setFocusedExpressMethodId('pago_movil')}
                                            onClick={() => executeExpressPayment('movil', true)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    executeExpressPayment('movil', true);
                                                }
                                            }}
                                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoMovil ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer select-none`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                    <Send size={17} strokeWidth={2.2} />
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {promoMovil && (
                                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                            -{promoMovil.discountPercentage}%
                                                        </span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openPagoMovilQr(findMethodKey('movil') || { id: 'pago_movil', name: 'Pago Móvil', currency: 'VES' });
                                                        }}
                                                        className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[9.5px] font-bold uppercase tracking-wide flex items-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer z-10 shadow-2xs"
                                                        title="Ver Código QR de Pago Móvil"
                                                    >
                                                        <QrCode size={11} />
                                                        <span>QR</span>
                                                    </button>
                                                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                        [F4]
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">PAGO MÓVIL</h4>
                                                <div className="flex items-baseline gap-1.5">
                                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoMovil ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                        {formatBs(netMovil)}
                                                    </p>
                                                    {promoMovil && (
                                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                            {formatBs(totalToPayVes)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                                {promoMovil ? `Ahorras $${promoMovil.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                            </div>
                                        </div>
                                    )}

                                    {/* F5: BIOPAGO */}
                                    {!isUsdOnly && (
                                        <button
                                            type="button"
                                            onMouseEnter={() => setFocusedExpressMethodId('biopago')}
                                            onFocus={() => setFocusedExpressMethodId('biopago')}
                                            onClick={() => executeExpressPayment('biopago', true)}
                                            className={`group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border ${promoBiopago ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-500/20' : 'border-slate-200 dark:border-slate-700/80'} hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                    <Fingerprint size={17} strokeWidth={2.2} />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {promoBiopago && (
                                                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9.5px] font-bold rounded border border-amber-500/30 tabular-nums">
                                                            -{promoBiopago.discountPercentage}%
                                                        </span>
                                                    )}
                                                    <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                        [F5]
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">BIOPAGO</h4>
                                                <div className="flex items-baseline gap-1.5">
                                                    <p className={`text-sm sm:text-base font-black tabular-nums tracking-tight ${promoBiopago ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                                        {formatBs(netBiopago)}
                                                    </p>
                                                    {promoBiopago && (
                                                        <span className="text-[10px] line-through text-slate-400 font-medium tabular-nums">
                                                            {formatBs(totalToPayVes)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500">
                                                {promoBiopago ? `Ahorras $${promoBiopago.savings.toFixed(2)}` : 'Cobro Directo 1-Clic'}
                                            </div>
                                        </button>
                                    )}

                                    {/* F6: BINANCE PAY (USDT) */}
                                    {(() => {
                                        const binMethod = findMethodKey('binance') || { id: 'binance_usdt', name: 'Binance Pay', currency: 'USDT' };
                                        const amountUsdt = precisionRound(totalToPayUsd, 2);
                                        return (
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                onMouseEnter={() => setFocusedExpressMethodId(binMethod.id || 'binance_usdt')}
                                                onFocus={() => setFocusedExpressMethodId(binMethod.id || 'binance_usdt')}
                                                onClick={() => openBinanceQr(binMethod)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        openBinanceQr(binMethod);
                                                    }
                                                }}
                                                className="group relative bg-white dark:bg-slate-850 hover:bg-slate-50/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-slate-400 dark:hover:border-slate-500 rounded-xl p-3 text-left transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between min-h-[84px] sm:min-h-[88px] cursor-pointer select-none"
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors">
                                                        <Wallet size={17} strokeWidth={2.2} />
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openBinanceQr(binMethod);
                                                            }}
                                                            className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[9.5px] font-bold uppercase tracking-wide flex items-center gap-1 border border-slate-200 dark:border-slate-700 cursor-pointer z-10 shadow-2xs"
                                                            title="Ver Código QR de Binance Pay"
                                                        >
                                                            <QrCode size={11} />
                                                            <span>QR</span>
                                                        </button>
                                                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold rounded border border-slate-200 dark:border-slate-700 shadow-2xs">
                                                            [F6]
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="mt-1">
                                                    <h4 className="text-xs font-bold uppercase tracking-tight text-slate-700 dark:text-slate-300">BINANCE PAY</h4>
                                                    <p className="text-sm sm:text-base font-black tabular-nums tracking-tight text-slate-900 dark:text-white">
                                                        {amountUsdt.toFixed(2)} USDT
                                                    </p>
                                                </div>
                                                <div className="flex items-center justify-between text-[9.5px] font-medium text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                                                    <span>Paridad: <strong className="font-mono text-slate-700 dark:text-slate-300">1 USDT = $1.00</strong></span>
                                                    <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[9px] font-bold border border-slate-200 dark:border-slate-700">
                                                        1:1 USD
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                                );
                            })()}

                            {/* Smart Tender Pad: Selección Rápida de Billetes en USD con Cálculo de Vuelto en Vivo */}
                            <div className="bg-white dark:bg-slate-900 p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Banknote size={15} className="text-slate-700 dark:text-slate-300" />
                                        <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                            Billetes Frecuentes · Vuelto Rápido USD
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {parseFloat(payments[findMethodKey('cash_usd')?.id]?.amount) > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleResetPayment}
                                                className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-colors uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                                                title="Limpiar billete seleccionado"
                                            >
                                                <RefreshCcw size={11} />
                                                <span>Restablecer</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-2.5">
                                    {/* Botón Exacto */}
                                    <button
                                        type="button"
                                        onClick={() => handleQuickAmount(totalToPayUsd)}
                                        className={`p-2.5 sm:p-3 rounded-xl border transition-all text-left shadow-2xs cursor-pointer flex flex-col justify-between min-h-[56px] sm:min-h-[60px] ${
                                            Math.abs((parseFloat(payments[findMethodKey('cash_usd')?.id]?.amount) || 0) - totalToPayUsd) < 0.005
                                                ? 'bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-400/50 shadow-sm'
                                                : 'bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/70 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[10px] font-black uppercase tracking-wider opacity-85">Monto</span>
                                            <span className="text-[9px] font-mono font-black px-1.5 py-0.2 rounded bg-black/10 dark:bg-white/10 uppercase">Exacto</span>
                                        </div>
                                        <div className="mt-1">
                                            <span className="text-sm sm:text-base font-black tracking-tight tabular-nums block">
                                                {formatUSD(totalToPayUsd)}
                                            </span>
                                            <span className="text-[9.5px] opacity-80 truncate block">Sin cambio</span>
                                        </div>
                                    </button>

                                    {/* Billetes Estándar */}
                                    {[1, 5, 10, 20, 50, 100].map(amt => {
                                        const currentSelected = parseFloat(payments[findMethodKey('cash_usd')?.id]?.amount) === amt;
                                        const isExact = Math.abs(amt - totalToPayUsd) < 0.005;
                                        const isOver = amt > totalToPayUsd;
                                        const isUnder = amt < totalToPayUsd && !isExact;
                                        const changeDiff = isOver ? precisionRound(amt - totalToPayUsd, 2) : 0;
                                        const underDiff = isUnder ? precisionRound(totalToPayUsd - amt, 2) : 0;

                                        return (
                                            <button
                                                key={amt}
                                                type="button"
                                                onClick={() => handleQuickAmount(amt)}
                                                className={`p-2.5 sm:p-3 rounded-xl border transition-all text-left shadow-2xs cursor-pointer flex flex-col justify-between min-h-[56px] sm:min-h-[60px] ${
                                                    currentSelected
                                                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white ring-2 ring-emerald-500 shadow-sm'
                                                        : isOver
                                                            ? 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                                                            : 'bg-slate-50/80 dark:bg-slate-850 hover:bg-slate-100 border-slate-200/60 dark:border-slate-750 text-slate-500 opacity-75'
                                                }`}
                                            >
                                                <div className="flex items-baseline justify-between gap-1.5 w-full">
                                                    <span className="text-sm sm:text-base font-black tracking-tight">${amt}</span>
                                                    {!isUsdOnly && (
                                                        <span className="text-[9.5px] font-mono text-slate-400 dark:text-slate-400 tabular-nums shrink-0">
                                                            {formatBs(precisionRound(amt * activeExchangeRate, 0))}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-1">
                                                    {isOver ? (
                                                        <span className={`text-[10px] sm:text-[10.5px] font-bold tabular-nums block ${currentSelected ? 'text-emerald-300 dark:text-emerald-700' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                            Vuelto: ${changeDiff.toFixed(2)}
                                                        </span>
                                                    ) : isExact ? (
                                                        <span className="text-[10px] sm:text-[10.5px] font-bold text-sky-500 block">Monto Exacto</span>
                                                    ) : (
                                                        <span className="text-[9.5px] text-slate-400 tabular-nums block">Falta ${underDiff.toFixed(2)}</span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </form>
                    ) : (
                        /* VISTA 2: MODO PAGO MIXTO / MULTI-MÉTODO */
                        <form id="checkout-form" onSubmit={handleSubmit} className={`grid grid-cols-1 md:grid-cols-2 ${isMaximized ? 'xl:grid-cols-3' : ''} gap-2.5 sm:gap-3`}>
                            {Array.isArray(methods) && methods.filter(method => {
                                if (isUsdOnly) {
                                    const idLower = (method.id || '').toLowerCase();
                                    const nameLower = (method.name || '').toLowerCase();
                                    const curr = (method.currency || method.defaultCurrency || '').toUpperCase();
                                    if (curr === 'VES' || curr === 'BS') return false;
                                    if (['cash_bs', 'efectivo_bs', 'pago_movil', 'biopago'].includes(idLower)) return false;
                                    if (nameLower.includes(' bs') || nameLower.includes('ves') || nameLower.includes('pago móvil') || nameLower.includes('pago movil') || nameLower.includes('biopago')) return false;
                                }
                                return true;
                            }).map((method, index) => {
                                const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(method.id.toLowerCase()) || method.id.toLowerCase().includes('bs') || method.id.toLowerCase().includes('ves') || method.id.toLowerCase().includes('movil'));
                                const defaultCurrency = isSingle ? 'USD' : (method.currency || method.defaultCurrency || (isVesKey ? 'VES' : 'USD'));
                                const payment = payments[method.id] || { amount: '', currency: defaultCurrency };
                                const hasAmount = parseFloat(payment.amount) > 0;
                                const cleanName = cleanMethodName(method.name);
                                const methodPromo = getMethodPromo(method.id, cleanName);
                                const isBinanceCard = payment.currency === 'USDT' || (method.id || '').toLowerCase().includes('binance') || (method.name || '').toLowerCase().includes('binance');
                                const cardBinRate = isBinanceCard ? getEffectiveBinanceRate(method.id, payment.cryptoRate) : 0;
                                const cardEquivBs = isBinanceCard && hasAmount
                                    ? (payment.coveredBs && Math.abs(parseFloat(payment.amount) - precisionRound(Number(payment.coveredBs) / cardBinRate, 2)) < 0.001
                                        ? Number(payment.coveredBs)
                                        : precisionRound(parseFloat(payment.amount) * cardBinRate, 2))
                                    : 0;

                                return (
                                    <div
                                        key={method.id}
                                        className={`group relative bg-white dark:bg-slate-800 rounded-xl border transition-all p-3 sm:p-3.5 shadow-2xs ${index === selectedIndex
                                                ? 'border-sky-500 ring-2 ring-sky-500/30 z-10'
                                                : methodPromo
                                                    ? 'border-amber-400/80 dark:border-amber-500/50 hover:border-amber-500'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                            } ${hasAmount ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-500/70 dark:border-emerald-600/70' : ''}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
                                                <div className={`shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-colors ${hasAmount ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-600/60'}`}>
                                                    <DynamicIcon name={method.icon} size={18} />
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <h3 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100 uppercase tracking-tight truncate" title={cleanName}>
                                                        {cleanName}
                                                    </h3>
                                                    <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                                                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded uppercase tracking-wider ${payment.currency === 'VES' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/60' : isBinanceCard ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/60' : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 border border-sky-200/70 dark:border-sky-800/60'}`}>
                                                            {payment.currency}
                                                        </span>
                                                        {isBinanceCard && (
                                                            <span className="text-[9.5px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                                                                {hasAmount ? `≈ ${formatBs(cardEquivBs)} (1:1 USD)` : 'Paridad 1:1 USD'}
                                                            </span>
                                                        )}
                                                        {methodPromo && (
                                                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 tabular-nums">
                                                                -{methodPromo.discountPercentage}% (-${methodPromo.savings.toFixed(2)})
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <div className="relative">
                                                    <input
                                                        id={`payment-amount-${method.id}`}
                                                        type="text"
                                                        inputMode="decimal"
                                                        step="any"
                                                        value={payment.amount}
                                                        onChange={(e) => handleAmountChange(method.id, e.target.value, payment.currency)}
                                                        onFocus={() => setSelectedIndex(index)}
                                                        placeholder="0.00"
                                                        className="w-28 sm:w-32 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-right font-mono font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all text-sm shadow-2xs"
                                                    />
                                                </div>

                                                <button
                                                    type="button"
                                                    id={`flash-fill-${method.id}`}
                                                    onClick={() => handleFlashFill(method.id, method.type, remainingBs, remainingUsd)}
                                                    disabled={!isInsufficient}
                                                    className={`min-w-[36px] min-h-[36px] p-2 rounded-lg border transition-all flex items-center justify-center cursor-pointer ${isInsufficient
                                                        ? 'border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 active:scale-95'
                                                        : 'border-slate-200/50 dark:border-slate-800 text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-850 cursor-not-allowed'}`}
                                                    title="Auto-liquidar restante"
                                                    aria-label="Liquidar Restante"
                                                >
                                                    <Zap size={16} fill="currentColor" />
                                                </button>

                                                {/* Botón QR en Fila Mixta si es Binance Pay */}
                                                {isBinanceCard && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openBinanceQr(method)}
                                                        className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800 transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-2xs"
                                                        title="Mostrar Código QR de Binance Pay"
                                                        aria-label="Ver Código QR Binance"
                                                    >
                                                        <QrCode size={16} />
                                                    </button>
                                                )}

                                                {/* Botón QR en Fila Mixta si es método VES o Pago Móvil */}
                                                {!isUsdOnly && !isBinanceCard && (
                                                    payment.currency === 'VES' || 
                                                    (method.id || '').toLowerCase().includes('movil') || 
                                                    (method.name || '').toLowerCase().includes('movil') ||
                                                    method.pagoMovilPhone || 
                                                    method.pagoMovilId
                                                ) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openPagoMovilQr(method)}
                                                        className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-2xs"
                                                        title="Mostrar Código QR y Datos Bancarios"
                                                        aria-label="Ver Código QR"
                                                    >
                                                        <QrCode size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {(() => {
                                            const mIdLower = (method.id || '').toLowerCase();
                                            const mNameLower = (method.name || '').toLowerCase();
                                            const needsRef = Boolean(
                                                method.requiresReference ||
                                                isBinanceCard ||
                                                mIdLower.includes('movil') ||
                                                mIdLower.includes('zelle') ||
                                                mIdLower.includes('transfer') ||
                                                mNameLower.includes('móvil') ||
                                                mNameLower.includes('movil') ||
                                                mNameLower.includes('zelle') ||
                                                mNameLower.includes('transfer')
                                            );
                                            const currentRef = (paymentReferences[method.id] || payment.reference || '').trim();
                                            if (!needsRef || !hasAmount) return null;
                                            return (
                                                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                                                    <input
                                                        id={`payment-reference-${method.id}`}
                                                        type="text"
                                                        required
                                                        value={paymentReferences[method.id] ?? payment.reference ?? ''}
                                                        onChange={(e) => setPaymentReferences(prev => ({ ...prev, [method.id]: e.target.value }))}
                                                        placeholder={isBinanceCard ? "Nº Order ID / Referencia Binance (Obligatorio) *" : "Nº de Referencia / Comprobante (Obligatorio) *"}
                                                        className={`w-full bg-slate-50 dark:bg-slate-900 border ${!currentRef ? 'border-amber-400 dark:border-amber-500/70' : 'border-emerald-400 dark:border-emerald-500/70'} rounded-lg px-3 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-sky-500 transition-colors`}
                                                    />
                                                </div>
                                            );
                                        })()}
                                    </div>
                                );
                            })}
                        </form>
                    )}
                </div>
            </div>

            {/* Footer con Acciones */}
            <div className="px-4 sm:px-6 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex gap-3 shrink-0 font-sans pb-safe">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={processing}
                    className="py-2.5 px-4 rounded-xl font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors uppercase tracking-wider text-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                    <span>Cancelar</span>
                    <kbd className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hidden sm:inline">Esc</kbd>
                </button>
                
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={processing || isLocalSubmitting || isInsufficient}
                    className={`flex-1 py-3 px-5 rounded-xl font-black text-white transition-all flex items-center justify-center gap-2.5 uppercase tracking-wider text-xs sm:text-sm cursor-pointer shadow-md ${
                        isInsufficient
                            ? 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-60 shadow-none'
                            : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] ring-2 ring-emerald-500/40'
                    }`}
                >
                    {(processing || isLocalSubmitting) ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                    ) : (
                        <>
                            <CheckCircle2 size={18} className="shrink-0" />
                            <span className="truncate">
                                {!isInsufficient && changeUsd > 0 ? (
                                    <span>✓ COBRAR Y ENTREGAR VUELTO (+{formatUSD(changeUsd)})</span>
                                ) : (
                                    <span>✓ COBRAR Y EMITIR COMPROBANTE ({formatUSD(totalToPayUsd)})</span>
                                )}
                            </span>
                            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold bg-black/25 text-white rounded border border-white/20">
                                ENTER
                            </kbd>
                        </>
                    )}
                </button>
            </div>

            {/* Overlay de Venta Exitosa (Sobrio y sin encandilamiento ocular) */}
            <AnimatePresence>
                {showSuccess && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/85 dark:bg-slate-950/90 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center gap-3"
                        >
                            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-center">
                                <CheckCircle2 size={32} className="text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                                Venta Procesada
                            </h2>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal Emergente de Pago Móvil & Código QR en Caja */}
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

                            {/* Datos de Cobro Binance Pay */}
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
        </BaseModal>
    );
}
