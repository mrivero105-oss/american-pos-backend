import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { X, CreditCard, CheckCircle2, Zap, Coins, Layers, ChevronDown, Maximize2, Minimize2, Tag, User } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { db } from '../services/db';
import VortexMathEngine from '../utils/VortexMathEngine';
import { formatMoney as utilFormatMoney, formatBs, formatUSD, precisionRound, isUsdOnlyMode, isVesOnlyMode, isDollarOnlyCountry } from '../utils/format';
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
import { generateBinanceQR } from '../utils/binanceQR';
import { cleanMethodName, DEFAULT_PAYMENT_METHODS } from './checkout/checkoutUtils';
import CheckoutExpressView from './checkout/CheckoutExpressView';
import CheckoutSplitView from './checkout/CheckoutSplitView';
import CheckoutSuccessOverlay from './checkout/CheckoutSuccessOverlay';
import CheckoutPaymentQrModal from './checkout/CheckoutPaymentQrModal';

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
    
    // Modo de Interfaz: 'express' (1-clic ultra rápido) o 'split' (pago mixto / multi-método)
    const [viewMode, setViewMode] = useState('express');
    // Modal expandido por defecto para máxima responsividad y visualización panorámica completa
    const [isMaximized, setIsMaximized] = useState(true);
    const [payments, setPayments] = useState({});
    const [paymentReferences, setPaymentReferences] = useState({});
    const [customers, setCustomers] = useState([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [documentType, setDocumentType] = useState('factura');
    const [methods, setMethods] = useState([]);
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
    const effectivePromotions = useMemo(
        () => posContext?.activePromotions || [],
        [posContext?.activePromotions]
    );
    const effectiveCart = useMemo(() => {
        if (Array.isArray(cartItems) && cartItems.length > 0) return cartItems;
        return posContext?.cart || posContext?.posState?.cart || [];
    }, [cartItems, posContext?.cart, posContext?.posState?.cart]);
    
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

    const fetchCustomers = useCallback(async () => {
        try {
            let custs = [];
            try {
                const { data } = await api.get('/customers?limit=1000', { timeout: 3000 });
                custs = Array.isArray(data) ? data : (data?.customers || []);
                if (custs.length > 0) {
                    try { await db.putAll('customers', custs); } catch (caughtErr) { console.warn('[CheckoutModal] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
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
        }
    }, []);

    const fetchMethods = useCallback(async () => {
        try {
            let meths = [];
            try {
                const { data } = await api.get('/settings/payment-methods', { timeout: 3000 });
                meths = Array.isArray(data) ? data : [];
                if (meths.length > 0) {
                    try { localStorage.setItem('pos_payment_methods', JSON.stringify(meths)); } catch (caughtErr) { console.warn('[CheckoutModal] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
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
                } catch (caughtErr) { console.warn('[CheckoutModal] Error parseando JSON local:', caughtErr?.message || caughtErr); }
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
        }
    }, [isUsdOnly]);

    const wasOpenRef = useRef(false);
    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            wasOpenRef.current = true;
            setLockedExchangeRate(exchangeRate || 1);
            fetchCustomers();
            fetchMethods();
            setPayments({});
            setPaymentReferences({});
            setSelectedCustomerId(initialCustomerId || '');
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
        } else if (!isOpen && wasOpenRef.current) {
            wasOpenRef.current = false;
            setLockedExchangeRate(null);
            setQrModalMethod(null);
            setActivePaymentPromo(null);
            setFocusedExpressMethodId('');
        }
    }, [isOpen, exchangeRate, initialCustomerId, fetchCustomers, fetchMethods]);

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

    // Helper unificado para Binance Pay (USDT): respeta tasa P2P pactada si existe, o paridad 1:1 con BCV por defecto
    const getEffectiveBinanceRate = useCallback((methodId = null, explicitCryptoRate = null) => {
        const exp = Number(explicitCryptoRate);
        if (exp > 0) return exp;
        const targetMethod = methodId
            ? methods.find(m => m.id === methodId || m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT')
            : methods.find(m => m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT');
        const methodBinRate = Number(targetMethod?.binanceRate);
        if (methodBinRate > 0) return methodBinRate;
        const settingsBinRate = Number(businessSettings?.binanceRate);
        if (settingsBinRate > 0) return settingsBinRate;
        return activeExchangeRate > 0 ? activeExchangeRate : 1;
    }, [methods, businessSettings?.binanceRate, activeExchangeRate]);

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
                const binRate = getEffectiveBinanceRate(methodId, data.cryptoRate);
                activeBinanceRateUsed = binRate;
                const amountVesInt = Math.round(amountInt * binRate);
                const amountUsdInt = activeExchangeRate > 0 ? Math.round(amountVesInt / activeExchangeRate) : amountInt;

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

    // Apertura y control del Modal Visual de Pago Móvil & Código QR
    const openBinanceQr = useCallback((targetMethod) => {
        if (!targetMethod) return;
        setFocusedExpressMethodId(targetMethod.id || 'binance_usdt');
        const payId = targetMethod.binancePayId || businessSettings?.binancePayId || '';
        const email = targetMethod.binanceEmail || businessSettings?.binanceEmail || '';
        const customImage = targetMethod.binanceQrImage || businessSettings?.binanceQrImage || '';
        const mode = targetMethod.binanceQrMode || (customImage ? 'IMAGE' : 'AUTO');

        const effectiveRate = getEffectiveBinanceRate(targetMethod.id, payments[targetMethod.id]?.cryptoRate || targetMethod.binanceRate);
        let amountBs = precisionRound(remainingBs > 0 ? remainingBs : totalToPayVes, 2);
        let amountUsdt = effectiveRate > 0 ? precisionRound(amountBs / effectiveRate, 2) : precisionRound(remainingUsd > 0 ? remainingUsd : totalToPayUsd, 2);
        if (viewMode === 'split' && parseFloat(payments[targetMethod.id]?.amount) > 0) {
            amountUsdt = precisionRound(parseFloat(payments[targetMethod.id].amount), 2);
            amountBs = precisionRound(amountUsdt * effectiveRate, 2);
        }

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
    }, [businessSettings?.binancePayId, businessSettings?.binanceEmail, businessSettings?.binanceQrImage, getEffectiveBinanceRate, payments, remainingBs, totalToPayVes, remainingUsd, totalToPayUsd, viewMode, paymentReferences]);

    const openPagoMovilQr = useCallback((targetMethod) => {
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
    }, [businessSettings?.pagoMovilBank, businessSettings?.pagoMovilPhone, businessSettings?.phone, businessSettings?.pagoMovilId, businessSettings?.rif, viewMode, payments, activeExchangeRate, remainingBs, totalToPayVes, paymentReferences]);

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
            const binRate = getEffectiveBinanceRate(methodId, payments[methodId]?.cryptoRate);
            const methodAppliesIgtf = igtfEnabled && businessSettings?.binanceIgtfEnabled === true;
            const igtfFactor = methodAppliesIgtf ? (1 + ((Number(igtfRate) || 3) / 100)) : 1;
            const existingUsdt = parseFloat(payments[methodId]?.amount) || 0;
            const remainingUsdtEquiv = binRate > 0 ? (remBs / binRate) : remUsd;
            let exactUsdt = precisionRound(existingUsdt + (remainingUsdtEquiv * igtfFactor), methodAppliesIgtf ? 4 : 2);
            if (methodAppliesIgtf && remainingUsdtEquiv > 0 && Math.round(toInt(exactUsdt) / igtfFactor) < toInt((existingUsdt / igtfFactor) + remainingUsdtEquiv)) {
                exactUsdt = precisionRound(exactUsdt + 0.0001, 4);
            }
            const targetBs = precisionRound(exactUsdt * binRate, 2);

            setPayments(prev => ({
                ...prev,
                [methodId]: {
                    amount: methodAppliesIgtf
                        ? exactUsdt.toFixed(4).replace(/(\.\d{2})00$/, '$1')
                        : exactUsdt.toFixed(2),
                    currency: 'USDT',
                    cryptoRate: binRate,
                    coveredBs: targetBs
                }
            }));
            return;
        }

        const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(methodId.toLowerCase()) || methodId.toLowerCase().includes('bs') || methodId.toLowerCase().includes('ves') || methodId.toLowerCase().includes('movil'));
        const currency = isSingle ? 'USD' : (method?.currency || method?.defaultCurrency || (isVesKey ? 'VES' : 'USD'));
        const existingVal = parseFloat(payments[methodId]?.amount) || 0;

        if (currency === 'USD') {
            const methodAppliesIgtf = igtfEnabled && methodId !== 'zelle' && methodId !== 'fiado';
            const igtfFactor = methodAppliesIgtf ? (1 + ((Number(igtfRate) || 3) / 100)) : 1;
            let exactAmount = precisionRound(existingVal + (remUsd * igtfFactor), 4);
            if (methodAppliesIgtf && remUsd > 0) {
                const targetTotalUsable = toInt((existingVal / igtfFactor) + remUsd);
                if (Math.round(toInt(exactAmount) / igtfFactor) < targetTotalUsable) {
                    exactAmount = precisionRound(exactAmount + 0.0001, 4);
                }
            }
            setPayments(prev => ({
                ...prev,
                [methodId]: {
                    amount: exactAmount.toFixed(4).replace(/(\.\d{2})00$/, '$1'),
                    currency
                }
            }));
            return;
        }

        const amountVes = precisionRound(remBs + existingVal, 2);
        setPayments(prev => ({
            ...prev,
            [methodId]: {
                amount: amountVes.toFixed(2),
                currency
            }
        }));
    }, [methods, isSingle, payments, igtfEnabled, igtfRate, businessSettings, getEffectiveBinanceRate]);

    // Bandera determinista para auto-enviar cuando React confirme stats.isInsufficient === false
    const pendingAutoSubmitRef = useRef(false);

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

        // Calcular siempre sobre la base imponible neta del carrito (sin IGTF residual previo)
        const netUsd = Math.max(0, precisionRound((Number(total) || 0) - promoSavings, 4));
        const netVes = precisionRound(netUsd * activeExchangeRate, 2);

        const isVesKey = !isSingle && (['debit', 'debito', 'tarjeta_debito', 'punto_de_venta', 'pago_movil', 'cash_bs', 'transfer', 'transferencia', 'transfer_bs', 'biopago'].includes(targetMethod.id.toLowerCase()) || targetMethod.id.toLowerCase().includes('bs') || targetMethod.id.toLowerCase().includes('ves') || targetMethod.id.toLowerCase().includes('movil'));
        const currency = isSingle ? 'USD' : (targetMethod.currency || targetMethod.defaultCurrency || (isVesKey ? 'VES' : 'USD'));

        const methodAppliesIgtf = igtfEnabled && currency === 'USD' && targetMethod.id !== 'zelle' && targetMethod.id !== 'fiado';
        const igtfFactor = methodAppliesIgtf ? (1 + ((Number(igtfRate) || 3) / 100)) : 1;
        let exactAmount = currency === 'USD'
            ? precisionRound(netUsd * igtfFactor, 4)
            : netVes;

        if (methodAppliesIgtf && netUsd > 0) {
            const principalInt = toInt(netUsd);
            if (Math.round(toInt(exactAmount) / igtfFactor) < principalInt) {
                exactAmount = precisionRound(exactAmount + 0.0001, 4);
            }
        }

        if (autoSubmit) {
            pendingAutoSubmitRef.current = true;
        }

        // Limpiar otros métodos y dejar 100% en el seleccionado
        setPayments({
            [targetMethod.id]: {
                amount: currency === 'USD' ? exactAmount.toFixed(4) : exactAmount.toFixed(2),
                currency
            }
        });
    }, [findMethodKey, isSingle, total, activeExchangeRate, getMethodPromo, igtfEnabled, igtfRate, openBinanceQr, openPagoMovilQr]);



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

        // Teclas Rápidas de Cobro Directo 1-Clic (F1 deshabilitado a petición del usuario)
        if (e.key === 'F1') {
            e.preventDefault();
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
    }, [isOpen, viewMode, methods, selectedIndex, executeExpressPayment, findMethodKey, openBinanceQr]);

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
            } catch (caughtErr) { console.warn('[CheckoutModal] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }

            // 2. BroadcastChannel para sincronización inter-procesos/doble monitor (0ms)
            try {
                if (typeof BroadcastChannel !== 'undefined') {
                    const bc = new BroadcastChannel('isaac_pos_display_sync');
                    bc.postMessage({ type: 'PAYMENT_SELECTION_UPDATE', payload });
                    bc.close();
                }
            } catch (caughtErr) { console.warn('[CheckoutModal] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }

            // 3. Socket.io para pantallas en red Wi-Fi / IP LAN
            if (socket && socket.connected) {
                socket.emit('customer_display_payment_update', payload);
            }

            // 4. CustomEvent local en ventana
            try {
                window.dispatchEvent(new CustomEvent('isaac_pos_display_payment_local_update', { detail: payload }));
            } catch (caughtErr) { console.warn('[CheckoutModal] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }
        } catch (caughtErr) { console.warn('[CheckoutModal] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
    }, [isOpen, qrModalMethod, qrModalUrl, viewMode, methods, selectedIndex, focusedExpressMethodId, payments, paymentReferences, stats, activePaymentPromo, total, activeExchangeRate, user, registerId, socket, findMethodKey, isUsdOnly, selectedCustomerId, customers, initialCustomerId, customerName]);

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

        const netPrincipalUsd = matchedPromo
            ? Math.max(0, precisionRound((Number(total) || 0) - additionalPromoDiscount, 2))
            : (Number(total) || 0);
        const finalIgtfUsd = (matchedPromo && currentIgtfUsd > 0 && (Number(total) || 0) > 0)
            ? precisionRound(Math.min(currentIgtfUsd, netPrincipalUsd * ((Number(igtfRate) || 3) / 100)), 2)
            : currentIgtfUsd;
        const calculatedFinalTotal = matchedPromo
            ? Math.max(0, precisionRound(netPrincipalUsd + finalIgtfUsd, 2))
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
                igtfAmount: finalIgtfUsd,
                discount: discountAmount || 0,
                promoDiscount: precisionRound((basePromoDiscount || 0) + additionalPromoDiscount, 2),
                appliedPromotions: [...(baseAppliedPromotions || []), ...additionalAppliedPromos],
                items: finalItems,
                taxInfo: {
                    ...taxInfo,
                    igtfAmount: finalIgtfUsd
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
            } catch (caughtErr) { console.warn('[CheckoutModal] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }

            setShowSuccess(true);
            setTransactionId(null);
            setTimeout(() => {
                setShowSuccess(false);
                onClose();
                setIsLocalSubmitting(false);
            }, 1500);
        } catch (err) {
            setIsLocalSubmitting(false);
            // Preservar transactionId ante fallos para garantizar idempotencia en reintentos del mismo cobro
            console.error('Checkout error:', err);
            const errMsg = err?.response?.data?.error || err?.message || 'Error al procesar el cobro.';
            toast.error(errMsg, { id: 'checkout-submit-error', duration: 4000 });
        }
    };

    useEffect(() => {
        if (!isOpen) {
            pendingAutoSubmitRef.current = false;
            return;
        }
        if (!pendingAutoSubmitRef.current || processing || isLocalSubmitting) return;
        if (!isInsufficient && Object.keys(payments).length > 0) {
            pendingAutoSubmitRef.current = false;
            const form = document.getElementById('checkout-form');
            if (form) form.requestSubmit();
        }
    }, [isOpen, payments, isInsufficient, processing, isLocalSubmitting]);

    const renderFormatMoney = (val, mode = null) => utilFormatMoney(val, mode, { rate: activeExchangeRate, currencyMode });


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
                                    [F2 - F6]
                                </span>
                            </div>
                            <div className="my-0.5">
                                <p className="text-xs sm:text-[13px] font-semibold text-slate-200 leading-snug">
                                    Toca una forma de pago abajo o presiona F2 - F6 para liquidar al instante.
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

                    {/* VISTA 1: MODO EXPRESS 1-CLIC | VISTA 2: MODO PAGO MIXTO */}
                    {viewMode === 'express' ? (
                        <CheckoutExpressView
                            handleSubmit={handleSubmit}
                            getMethodPromo={getMethodPromo}
                            total={total}
                            activeExchangeRate={activeExchangeRate}
                            findMethodKey={findMethodKey}
                            igtfEnabled={igtfEnabled}
                            isSingle={isSingle}
                            igtfRate={igtfRate}
                            isUsdOnly={isUsdOnly}
                            setFocusedExpressMethodId={setFocusedExpressMethodId}
                            executeExpressPayment={executeExpressPayment}
                            totalToPayUsd={totalToPayUsd}
                            totalToPayVes={totalToPayVes}
                            openPagoMovilQr={openPagoMovilQr}
                            openBinanceQr={openBinanceQr}
                            payments={payments}
                            handleResetPayment={handleResetPayment}
                            handleQuickAmount={handleQuickAmount}
                        />
                    ) : (
                        <CheckoutSplitView
                            handleSubmit={handleSubmit}
                            isMaximized={isMaximized}
                            methods={methods}
                            isUsdOnly={isUsdOnly}
                            isSingle={isSingle}
                            payments={payments}
                            getMethodPromo={getMethodPromo}
                            getEffectiveBinanceRate={getEffectiveBinanceRate}
                            selectedIndex={selectedIndex}
                            setSelectedIndex={setSelectedIndex}
                            handleAmountChange={handleAmountChange}
                            handleFlashFill={handleFlashFill}
                            remainingBs={remainingBs}
                            remainingUsd={remainingUsd}
                            isInsufficient={isInsufficient}
                            openBinanceQr={openBinanceQr}
                            openPagoMovilQr={openPagoMovilQr}
                            paymentReferences={paymentReferences}
                            setPaymentReferences={setPaymentReferences}
                        />
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

            <CheckoutSuccessOverlay showSuccess={showSuccess} />

            <CheckoutPaymentQrModal
                qrModalMethod={qrModalMethod}
                setQrModalMethod={setQrModalMethod}
                generatingQrModal={generatingQrModal}
                qrModalUrl={qrModalUrl}
                handleCopyText={handleCopyText}
                copiedField={copiedField}
                handleCopyAll={handleCopyAll}
                qrModalReference={qrModalReference}
                setQrModalReference={setQrModalReference}
                handleConfirmQrPayment={handleConfirmQrPayment}
            />
        </BaseModal>
    );
}
