import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import api, { formatServerUrl } from '../services/api';
import secureMobileStorage from '../utils/secureMobileStorage';
import { getImageUrl } from '../utils/imageUtils';
import { formatBs, isDollarOnlyCountry, isUsdOnlyMode, precisionRound } from '../utils/format';
import {
    generatePagoMovilQR,
    cleanPhone,
    cleanIdNumber
} from '../utils/pagoMovilQR';
import { generateBinanceQR } from '../utils/binanceQR';
import {
    VALID_ARCH_THEMES,
    normalizeArchTheme,
    DEFAULT_DISPLAY_CONFIG,
    buildPromoBadge,
    getDisplayThemeTokens
} from '../components/customer-display/displayHelpers';
import CustomerDisplayHeader from '../components/customer-display/CustomerDisplayHeader';
import CustomerDisplaySaleCompleted from '../components/customer-display/CustomerDisplaySaleCompleted';
import CustomerDisplayAdShowcase from '../components/customer-display/CustomerDisplayAdShowcase';
import CustomerDisplayLiveCart from '../components/customer-display/CustomerDisplayLiveCart';

export default function CustomerDisplay() {
    const [cartData, setCartData] = useState({
        cashierName: '',
        registerName: 'Caja 1',
        registerId: '1',
        customerId: null,
        customerName: '',
        customerDoc: '',
        items: [],
        itemCount: 0,
        subtotalUSD: 0,
        discountUSD: 0,
        totalUSD: 0,
        totalBs: 0,
        exchangeRate: 1,
        currencyMode: 'BOTH'
    });

    const [completedSale, setCompletedSale] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const [bizSettings, setBizSettings] = useState(() => {
        let cachedName = '';
        let cachedLogo = '';
        let cachedCountry = '';
        try {
            const rawGlobal = localStorage.getItem('pos_global_settings');
            if (rawGlobal) {
                const parsed = JSON.parse(rawGlobal);
                cachedName = parsed.businessInfo?.name || '';
                cachedLogo = parsed.businessInfo?.logo || '';
                cachedCountry = parsed.businessInfo?.country || '';
            }
            if (!cachedName || !cachedLogo) {
                const rawBiz = localStorage.getItem('pos_business_info') || localStorage.getItem('pos_business_settings');
                if (rawBiz) {
                    const parsed = JSON.parse(rawBiz);
                    cachedName = cachedName || parsed.name || '';
                    cachedLogo = cachedLogo || parsed.logo || '';
                    cachedCountry = cachedCountry || parsed.country || '';
                }
            }
        } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
        return {
            name: cachedName || 'Isaac POS',
            logo: cachedLogo || '',
            country: cachedCountry || '',
            phone: '',
            rif: '',
            pagoMovilBank: '',
            pagoMovilPhone: '',
            pagoMovilId: '',
            pagoMovilQrMode: 'AUTO',
            pagoMovilQrImage: '',
            pagoMovilIncludeAmount: true
        };
    });

    // Arquitectura Visual: Studio Bimodal | Swiss Grid | Titanium Console
    const [archTheme, setArchTheme] = useState(() => {
        const savedDisplay = localStorage.getItem('customer_display_arch_theme');
        if (savedDisplay && VALID_ARCH_THEMES.includes(savedDisplay)) return savedDisplay;
        const appTheme = localStorage.getItem('app_theme');
        if (appTheme && VALID_ARCH_THEMES.includes(appTheme)) return appTheme;
        const legacy = localStorage.getItem('customer_display_theme');
        return normalizeArchTheme(legacy);
    });

    useEffect(() => {
        try {
            localStorage.setItem('customer_display_arch_theme', archTheme);
        } catch (caughtErr) { console.warn('[CustomerDisplay] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
    }, [archTheme]);

    useEffect(() => {
        const onFsChange = () => {
            setIsFullscreen(Boolean(document.fullscreenElement));
        };
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const toggleFullscreen = () => {
        try {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.();
            } else {
                document.exitFullscreen?.();
            }
        } catch { /* Pantalla completa opcional no soportada por el navegador */ }
    };

    const [currentTime, setCurrentTime] = useState(() => new Date());
    const [isConnected, setIsConnected] = useState(false);

    // Datos públicos del feed de señalización digital
    const [displayConfig, setDisplayConfig] = useState(() => {
        try {
            const cached = localStorage.getItem('pos_customer_display_config');
            if (cached) return { ...DEFAULT_DISPLAY_CONFIG, ...JSON.parse(cached) };
        } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
        return DEFAULT_DISPLAY_CONFIG;
    });
    const [activePromotions, setActivePromotions] = useState([]);
    const [featuredProducts, setFeaturedProducts] = useState([]);
    const [allPaymentMethods, setAllPaymentMethods] = useState([]);

    // Pago Móvil & QR Dinámico
    const [pagoMovilMethods, setPagoMovilMethods] = useState([]);
    const [selectedMethodId, setSelectedMethodId] = useState(null);
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [generatingQr, setGeneratingQr] = useState(false);
    const [checkoutRightTab, setCheckoutRightTab] = useState('qr'); // 'qr' | 'promo'

    // Sincronización en vivo del Método de Pago seleccionado en Caja (CheckoutModal)
    const [checkoutPayment, setCheckoutPayment] = useState(() => {
        try {
            const cached = localStorage.getItem('isaac_pos_display_payment_sync');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.isCheckoutOpen && (Date.now() - (parsed.timestamp || 0)) < 300000) {
                    return parsed;
                }
            }
        } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
        return null;
    });
    const [binanceSettings, setBinanceSettings] = useState({ payId: '', email: '', rate: 0, qrImage: '', mode: 'AUTO', name: 'Binance Pay' });
    const [binanceQrUrl, setBinanceQrUrl] = useState('');
    const [generatingBinanceQr, setGeneratingBinanceQr] = useState(false);

    // Estado del Carrusel
    const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [progressPct, setProgressPct] = useState(0);

    const itemsListRef = useRef(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Tasa de cambio activa
    const [defaultRate, setDefaultRate] = useState(() => {
        const local = parseFloat(localStorage.getItem('pos_exchange_rate'));
        return (!isNaN(local) && local > 1) ? local : 1;
    });

    const displayRate = (cartData.exchangeRate && cartData.exchangeRate > 1) ? cartData.exchangeRate : defaultRate;

    const effectiveCountry = bizSettings.country || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = isDollarCountry || isUsdOnlyMode({ country: effectiveCountry, currencyMode: cartData.currencyMode });

    const formattedDate = currentTime.toLocaleDateString('es-VE', {
        weekday: 'short',
        day: '2-digit',
        month: 'short'
    }).replace(/\./g, '').toUpperCase();

    const displayTime = currentTime.toLocaleTimeString('es-VE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const applyPaymentMethods = useCallback((methods) => {
        if (!Array.isArray(methods)) return;
        setAllPaymentMethods(methods.filter(m => m && m.enabled !== false));
        const pmList = methods.filter(m =>
            m && (
                m.pagoMovilPhone ||
                m.pagoMovilId ||
                m.pagoMovilQrImage ||
                m.id === 'pago_movil' ||
                (m.currency === 'VES' && m.type === 'DIGITAL' && /m[oó]vil/i.test(m.name || ''))
            )
        );
        setPagoMovilMethods(pmList);
        if (pmList.length > 0) {
            setSelectedMethodId(prev => (pmList.some(m => m.id === prev) ? prev : pmList[0].id));
        }
    }, []);

    // Cargar Feed Público Completo (funciona en PC local y en Tablets/Smart TVs Wi-Fi sin sesión JWT)
    const fetchDisplayFeed = useCallback(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const companyId = urlParams.get('companyId') || localStorage.getItem('pos_company_id') || '';

        api.get('/public-catalog/display/feed', {
            params: companyId ? { companyId } : {}
        })
            .then(res => {
                const data = res.data;
                if (!data || !data.success) return;

                if (data.business) {
                    setBizSettings(prev => ({
                        ...prev,
                        name: data.business.name || prev.name || 'Isaac POS',
                        logo: data.business.logo || prev.logo || '',
                        country: data.business.country || prev.country || '',
                        phone: data.business.phone || prev.phone || '',
                        rif: data.business.rif || prev.rif || ''
                    }));
                }

                if (data.exchangeRate && Number(data.exchangeRate) > 0) {
                    setDefaultRate(Number(data.exchangeRate));
                }

                if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
                    applyPaymentMethods(data.paymentMethods);
                }

                if (data.pagoMovil) {
                    setBizSettings(prev => ({
                        ...prev,
                        pagoMovilBank: data.pagoMovil.bank || prev.pagoMovilBank,
                        pagoMovilPhone: data.pagoMovil.phone || prev.pagoMovilPhone,
                        pagoMovilId: data.pagoMovil.idNumber || prev.pagoMovilId,
                        pagoMovilQrMode: data.pagoMovil.mode || prev.pagoMovilQrMode || 'AUTO',
                        pagoMovilQrImage: data.pagoMovil.customImage || prev.pagoMovilQrImage || '',
                        pagoMovilIncludeAmount: data.pagoMovil.includeAmount !== false
                    }));
                }

                if (data.binancePay) {
                    setBinanceSettings(prev => ({
                        ...prev,
                        payId: data.binancePay.payId || prev.payId,
                        email: data.binancePay.email || prev.email,
                        rate: Number(data.binancePay.rate || prev.rate),
                        qrImage: data.binancePay.qrImage || prev.qrImage,
                        mode: data.binancePay.mode || prev.mode || 'AUTO',
                        name: data.binancePay.name || prev.name || 'Binance Pay'
                    }));
                }

                if (Array.isArray(data.paymentMethods)) {
                    const binM = data.paymentMethods.find(m => m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT' || m.binancePayId);
                    if (binM) {
                        setBinanceSettings(prev => ({
                            ...prev,
                            payId: binM.binancePayId || prev.payId,
                            email: binM.binanceEmail || prev.email,
                            rate: Number(binM.binanceRate || prev.rate),
                            qrImage: binM.binanceQrImage || prev.qrImage,
                            mode: binM.binanceQrMode || prev.mode || 'AUTO',
                            name: binM.name || prev.name || 'Binance Pay'
                        }));
                    }
                }

                if (data.displayConfig) {
                    setDisplayConfig(prev => ({
                        ...DEFAULT_DISPLAY_CONFIG,
                        ...prev,
                        ...data.displayConfig,
                        slides: Array.isArray(data.displayConfig.slides) ? data.displayConfig.slides : []
                    }));
                }

                if (Array.isArray(data.activePromotions)) {
                    setActivePromotions(data.activePromotions);
                }

                if (Array.isArray(data.featuredProducts)) {
                    setFeaturedProducts(data.featuredProducts);
                }
            })
            .catch(() => {});
    }, [applyPaymentMethods]);

    // Datos activos de Pago Móvil
    const activeMethod = pagoMovilMethods.find(m => m.id === selectedMethodId) || pagoMovilMethods[0] || null;
    const activeBank = activeMethod?.pagoMovilBank || bizSettings.pagoMovilBank || '';
    const rawPhone = activeMethod?.pagoMovilPhone || bizSettings.pagoMovilPhone || '';
    const activePhone = cleanPhone(rawPhone) || cleanPhone(bizSettings.phone || '');
    const rawId = activeMethod?.pagoMovilId || bizSettings.pagoMovilId || '';
    const activeId = cleanIdNumber(rawId) || cleanIdNumber(bizSettings.rif || '');
    const activeQrMode = activeMethod?.pagoMovilQrMode || bizSettings.pagoMovilQrMode || 'AUTO';
    const activeCustomImage = activeMethod?.pagoMovilQrImage || bizSettings.pagoMovilQrImage || '';
    const includeAmount = activeMethod?.pagoMovilIncludeAmount !== undefined
        ? activeMethod.pagoMovilIncludeAmount
        : (bizSettings.pagoMovilIncludeAmount !== false);
    const hasPagoMovil = !isUsdOnly && (Boolean(activePhone) || Boolean(activeId) || Boolean(activeCustomImage));

    useEffect(() => {
        let isMounted = true;
        if (!hasPagoMovil) {
            setQrCodeUrl('');
            return;
        }
        if (activeQrMode === 'IMAGE' && activeCustomImage) {
            setQrCodeUrl(activeCustomImage);
            return;
        }

        setGeneratingQr(true);
        generatePagoMovilQR({
            bankCode: activeBank,
            phone: activePhone,
            idNumber: activeId,
            amountBs: cartData.totalBs || 0,
            customImage: activeCustomImage,
            mode: activeQrMode,
            includeAmount
        })
            .then(url => {
                if (isMounted) {
                    setQrCodeUrl(url || '');
                    setGeneratingQr(false);
                }
            })
            .catch(() => {
                if (isMounted) setGeneratingQr(false);
            });

        return () => { isMounted = false; };
    }, [hasPagoMovil, activeBank, activePhone, activeId, activeQrMode, activeCustomImage, includeAmount, cartData.totalBs]);

    // Detección de método activo de cobro enviado por el cajero
    const checkoutActiveMethod = checkoutPayment?.qrModalMethod || checkoutPayment?.activeMethod || null;
    const isCheckoutActive = Boolean(checkoutPayment?.isCheckoutOpen && (checkoutActiveMethod || checkoutPayment?.viewMode === 'split'));

    // Lista unificada de abonos registrados en Pago Mixto
    const splitList = useMemo(() => {
        if (Array.isArray(checkoutPayment?.splitPayments) && checkoutPayment.splitPayments.length > 0) {
            return checkoutPayment.splitPayments;
        }
        if (checkoutPayment?.payments && typeof checkoutPayment.payments === 'object') {
            return Object.entries(checkoutPayment.payments)
                .filter(([_, p]) => p && Number(p.amount) > 0)
                .map(([mId, p]) => {
                    const amountNum = Number(p.amount) || 0;
                    const m = (allPaymentMethods || []).find(x => x.id === mId) || { id: mId, name: mId, currency: p?.currency || 'USD' };
                    const curr = (p?.currency || m?.currency || 'USD').toUpperCase();
                    const isUsd = curr === 'USD';
                    const isVes = curr === 'VES' || curr === 'BS';
                    const isUsdt = curr === 'USDT' || mId.includes('binance');

                    let equivBs = 0;
                    let equivUsd = 0;
                    if (isUsd) {
                        equivUsd = amountNum;
                        equivBs = precisionRound(amountNum * displayRate, 2);
                    } else if (isVes) {
                        equivBs = amountNum;
                        equivUsd = displayRate > 0 ? precisionRound(amountNum / displayRate, 2) : 0;
                    } else if (isUsdt) {
                        equivUsd = amountNum;
                        equivBs = precisionRound(amountNum * displayRate, 2);
                    }

                    return {
                        id: mId,
                        name: m?.name || mId,
                        currency: curr,
                        amount: amountNum,
                        equivBs,
                        equivUsd,
                        isCash: Boolean(m?.isCash || mId.includes('cash') || mId.includes('efectivo')),
                        isBinance: isUsdt,
                        isPagoMovil: Boolean(mId.includes('movil') || m?.pagoMovilPhone),
                        isDebit: Boolean(mId.includes('debit') || mId.includes('punto') || mId.includes('card')),
                        reference: p?.reference || ''
                    };
                });
        }
        return [];
    }, [checkoutPayment, allPaymentMethods, displayRate]);

    // ¿Es un cobro mixto activo?
    const isSplitActive = Boolean(
        isCheckoutActive && (
            checkoutPayment?.viewMode === 'split' ||
            checkoutPayment?.isSplit ||
            splitList.length > 1
        ) && !checkoutPayment?.qrModalMethod
    );

    const isBinanceActive = Boolean(
        isCheckoutActive && !isSplitActive && (
            checkoutActiveMethod?.isBinance ||
            (checkoutActiveMethod?.currency || '').toUpperCase() === 'USDT' ||
            (checkoutActiveMethod?.id || '').toLowerCase().includes('binance') ||
            (checkoutActiveMethod?.name || '').toLowerCase().includes('binance')
        )
    );

    // Generación dinámica del QR de Binance Pay en el Visor
    useEffect(() => {
        let isMounted = true;
        if (!isBinanceActive) {
            setBinanceQrUrl('');
            setGeneratingBinanceQr(false);
            return;
        }

        if (checkoutActiveMethod?.qrUrl) {
            setBinanceQrUrl(checkoutActiveMethod.qrUrl);
            setGeneratingBinanceQr(false);
            return;
        }

        const payId = checkoutActiveMethod?.binancePayId || binanceSettings.payId || '';
        const email = checkoutActiveMethod?.binanceEmail || binanceSettings.email || '';
        const customImage = checkoutActiveMethod?.binanceQrImage || binanceSettings.qrImage || '';
        const mode = checkoutActiveMethod?.binanceQrMode || binanceSettings.mode || 'AUTO';
        const fallbackUsd = checkoutPayment?.totals?.totalToPayUsd ?? cartData.totalUSD ?? 0;
        const amountUsdt = checkoutActiveMethod?.amountUsdt !== undefined && checkoutActiveMethod?.amountUsdt !== null
            ? Number(checkoutActiveMethod.amountUsdt)
            : precisionRound(fallbackUsd, 2);

        if (mode === 'IMAGE' && customImage) {
            setBinanceQrUrl(customImage);
            setGeneratingBinanceQr(false);
            return;
        }

        setGeneratingBinanceQr(true);
        generateBinanceQR({
            payId,
            email,
            amountUsdt,
            customImage,
            mode
        }).then(url => {
            if (isMounted) {
                setBinanceQrUrl(url || customImage || '');
                setGeneratingBinanceQr(false);
            }
        }).catch(() => {
            if (isMounted) setGeneratingBinanceQr(false);
        });

        return () => { isMounted = false; };
    }, [isBinanceActive, checkoutActiveMethod, binanceSettings, displayRate, cartData.totalBs, cartData.totalUSD, checkoutPayment?.totals?.totalToPayUsd]);

    // Procesar actualización del carrito en tiempo real
    const handleCartUpdate = useCallback((data) => {
        if (!data || typeof data !== 'object') return;
        const actual = data.payload || data;
        if (!actual || typeof actual !== 'object') return;

        setCartData(prev => ({
            ...prev,
            ...actual,
            items: Array.isArray(actual.items) ? actual.items : []
        }));

        if (actual.businessName) {
            setBizSettings(prev => ({
                ...prev,
                name: actual.businessName,
                logo: actual.businessLogo || prev.logo
            }));
        }

        if (Array.isArray(actual.items) && actual.items.length > 0) {
            setCompletedSale(null);
        } else {
            setCheckoutPayment(null);
        }
    }, []);

    // Procesar selección y estado de método de pago en tiempo real desde CheckoutModal
    const handlePaymentSelectionUpdate = useCallback((data) => {
        if (!data || typeof data !== 'object') {
            setCheckoutPayment(null);
            return;
        }
        const actual = data.payload || data;
        if (!actual || actual.isCheckoutOpen === false || !actual.isCheckoutOpen) {
            setCheckoutPayment(null);
            return;
        }
        setCheckoutPayment(actual);
    }, []);

    // Procesar cierre de venta
    const saleTimeoutRef = useRef(null);
    const handleSaleCompleted = useCallback((saleData) => {
        if (!saleData) return;
        const actual = saleData.payload || saleData;
        setCompletedSale(actual);
        setCheckoutPayment(null);

        if (saleTimeoutRef.current) clearTimeout(saleTimeoutRef.current);
        saleTimeoutRef.current = setTimeout(() => {
            setCompletedSale(null);
            setCartData(prev => ({
                ...prev,
                customerId: null,
                customerName: '',
                customerDoc: '',
                items: [],
                itemCount: 0,
                subtotalUSD: 0,
                discountUSD: 0,
                totalUSD: 0,
                totalBs: 0
            }));
        }, 7000);
    }, []);

    useEffect(() => {
        return () => {
            if (saleTimeoutRef.current) clearTimeout(saleTimeoutRef.current);
        };
    }, []);

    // Inicializar Feed Público + Triple Sincronización (LocalStorage + BroadcastChannel + Socket.io)
    useEffect(() => {
        fetchDisplayFeed();

        // Refresco periódico silencioso del catálogo/ofertas cada 3 minutos para pantallas encendidas todo el día
        const feedRefreshTimer = setInterval(fetchDisplayFeed, 180000);

        try {
            const cachedPay = localStorage.getItem('pos_payment_methods');
            if (cachedPay) applyPaymentMethods(JSON.parse(cachedPay));
        } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }

        try {
            const cachedCart = localStorage.getItem('isaac_pos_display_sync');
            if (cachedCart) {
                const parsed = JSON.parse(cachedCart);
                if (parsed && (Date.now() - (parsed.timestamp || 0)) < 2700000) {
                    handleCartUpdate(parsed);
                }
            }
        } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }

        let bc = null;
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                bc = new BroadcastChannel('isaac_pos_display_sync');
                bc.onmessage = (event) => {
                    const msg = event.data;
                    if (!msg) return;
                    if (msg.type === 'SALE_COMPLETED') {
                        handleSaleCompleted(msg.payload);
                    } else if (msg.type === 'CART_UPDATE' || msg.items) {
                        handleCartUpdate(msg.payload || msg);
                    } else if (msg.type === 'PAYMENT_SELECTION_UPDATE') {
                        handlePaymentSelectionUpdate(msg.payload);
                    } else if (msg.type === 'PAYMENT_METHODS_UPDATED') {
                        applyPaymentMethods(msg.payload);
                    } else if (msg.type === 'DISPLAY_CONFIG_UPDATED' && msg.payload) {
                        setDisplayConfig(prev => ({
                            ...DEFAULT_DISPLAY_CONFIG,
                            ...prev,
                            ...msg.payload,
                            slides: Array.isArray(msg.payload.slides)
                                ? msg.payload.slides.filter(s => s && s.enabled !== false)
                                : []
                        }));
                        fetchDisplayFeed();
                    } else if (msg.type === 'BUSINESS_SETTINGS_UPDATED' && msg.payload) {
                        setBizSettings(prev => ({
                            ...prev,
                            name: msg.payload.name || prev.name,
                            logo: msg.payload.logo || prev.logo,
                            country: msg.payload.country || prev.country
                        }));
                    }
                };
                bc.postMessage({ type: 'REQUEST_INITIAL_STATE' });
            }
        } catch (caughtErr) { console.warn('[CustomerDisplay] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }

        const handleStorage = (e) => {
            if (e.key === 'isaac_pos_display_sync' && e.newValue) {
                try { handleCartUpdate(JSON.parse(e.newValue)); } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
            } else if (e.key === 'isaac_pos_display_sync_sale_completed' && e.newValue) {
                try { handleSaleCompleted(JSON.parse(e.newValue)); } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
            } else if (e.key === 'isaac_pos_display_payment_sync') {
                if (!e.newValue) {
                    setCheckoutPayment(null);
                } else {
                    try { handlePaymentSelectionUpdate(JSON.parse(e.newValue)); } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
                }
            } else if (e.key === 'pos_payment_methods' && e.newValue) {
                try { applyPaymentMethods(JSON.parse(e.newValue)); } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
            } else if (e.key === 'pos_customer_display_config' && e.newValue) {
                try {
                    const cfg = JSON.parse(e.newValue);
                    setDisplayConfig(prev => ({
                        ...DEFAULT_DISPLAY_CONFIG,
                        ...prev,
                        ...cfg,
                        slides: Array.isArray(cfg.slides) ? cfg.slides.filter(s => s && s.enabled !== false) : []
                    }));
                } catch (caughtErr) { console.warn('[CustomerDisplay] Error parseando JSON local:', caughtErr?.message || caughtErr); }
            } else if (e.key === 'app_theme' && e.newValue && VALID_ARCH_THEMES.includes(e.newValue)) {
                if (!localStorage.getItem('customer_display_arch_theme')) {
                    setArchTheme(e.newValue);
                }
            }
        };
        window.addEventListener('storage', handleStorage);

        const handleLocalCustomEvent = (e) => {
            if (e.detail) handleCartUpdate(e.detail);
        };
        window.addEventListener('isaac_pos_display_local_update', handleLocalCustomEvent);

        const handleLocalPaymentEvent = (e) => {
            if (e.detail) handlePaymentSelectionUpdate(e.detail);
        };
        window.addEventListener('isaac_pos_display_payment_local_update', handleLocalPaymentEvent);

        // Socket.io para segunda pantalla y dispositivos en red Wi-Fi
        const savedIp = localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip');
        let socketUrl = '';
        if (savedIp) {
            socketUrl = formatServerUrl(savedIp);
        } else {
            const currentPort = window.location.port;
            const targetPort = ['5173', '5174', '5175'].includes(currentPort) ? '3005' : (currentPort || '3005');
            socketUrl = `${window.location.protocol}//${window.location.hostname}:${targetPort}`;
        }

        const hashQueryIndex = typeof window !== 'undefined' ? window.location.hash.indexOf('?') : -1;
        const hashParams = new URLSearchParams(hashQueryIndex >= 0 ? window.location.hash.slice(hashQueryIndex + 1) : '');
        const urlParamsInit = new URLSearchParams(window.location.search);
        const initCompanyId = urlParamsInit.get('companyId') || hashParams.get('companyId') || localStorage.getItem('pos_company_id') || localStorage.getItem('companyId') || 'default';
        const initRegisterId = urlParamsInit.get('registerId') || urlParamsInit.get('caja') || hashParams.get('registerId') || hashParams.get('caja') || '1';
        const displayToken = urlParamsInit.get('dt') || hashParams.get('dt') || undefined;
        const authToken = secureMobileStorage.getToken() || undefined;

        const socket = io(socketUrl, {
            auth: {
                token: authToken,
                displayToken,
                mode: 'customer_display',
                companyId: initCompanyId,
                registerId: initRegisterId
            },
            reconnection: true,
            reconnectionDelay: 1500,
            timeout: 8000
        });

        socket.on('connect', () => {
            setIsConnected(true);
            const curHashIdx = window.location.hash.indexOf('?');
            const curHashParams = new URLSearchParams(curHashIdx >= 0 ? window.location.hash.slice(curHashIdx + 1) : '');
            const urlParams = new URLSearchParams(window.location.search);
            const companyId = urlParams.get('companyId') || curHashParams.get('companyId') || localStorage.getItem('pos_company_id') || localStorage.getItem('companyId') || 'default';
            const registerId = urlParams.get('registerId') || urlParams.get('caja') || curHashParams.get('registerId') || curHashParams.get('caja') || '1';

            socket.emit('join_customer_display', { registerId, companyId });
            if (authToken) {
                socket.emit('join_company', companyId);
            }
            socket.emit('request_customer_display_cart', { registerId, companyId });
        });

        socket.on('disconnect', () => {
            setIsConnected(false);
        });

        socket.on('customer_display_cart_update', handleCartUpdate);
        socket.on('customer_display_payment_update', handlePaymentSelectionUpdate);
        socket.on('customer_display_sale_completed', handleSaleCompleted);

        socket.on('customer_display_ads_updated', (newCfg) => {
            if (newCfg && typeof newCfg === 'object') {
                setDisplayConfig(prev => ({
                    ...DEFAULT_DISPLAY_CONFIG,
                    ...prev,
                    ...newCfg,
                    slides: Array.isArray(newCfg.slides) ? newCfg.slides.filter(s => s && s.enabled !== false) : []
                }));
            }
            fetchDisplayFeed();
        });

        socket.on('promotions_updated', fetchDisplayFeed);
        socket.on('settings_changed', (payload) => {
            if (payload?.exchangeRate && Number(payload.exchangeRate) > 0) {
                setDefaultRate(Number(payload.exchangeRate));
            }
            fetchDisplayFeed();
        });

        return () => {
            clearInterval(feedRefreshTimer);
            if (bc) {
                try { bc.close(); } catch { /* Canal o socket ya cerrado previamente */ }
            }
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('isaac_pos_display_local_update', handleLocalCustomEvent);
            window.removeEventListener('isaac_pos_display_payment_local_update', handleLocalPaymentEvent);
            socket.disconnect();
        };
    }, [fetchDisplayFeed, applyPaymentMethods, handleCartUpdate, handlePaymentSelectionUpdate, handleSaleCompleted]);

    // Auto-scroll suave al último producto agregado en el carrito
    useEffect(() => {
        if (itemsListRef.current && cartData.items?.length > 0) {
            try {
                itemsListRef.current.scrollTo({
                    top: itemsListRef.current.scrollHeight,
                    behavior: 'smooth'
                });
            } catch (_) {
                itemsListRef.current.scrollTop = itemsListRef.current.scrollHeight;
            }
        }
    }, [cartData.items?.length]);

    // Construcción de la cola de reproducción del Carrusel de Señalización Digital
    const playlist = useMemo(() => {
        const list = [];
        const usedProductIds = new Set();

        // 1. Anuncios / Flyers personalizados subidos por el comercio
        const customSlides = Array.isArray(displayConfig.slides)
            ? displayConfig.slides.filter(s => s && s.enabled !== false && (s.imageUrl || s.title))
            : [];

        customSlides.forEach((s) => {
            if (s.productId) usedProductIds.add(String(s.productId));
            const hasPrice = s.priceUSD !== '' && s.priceUSD !== null && s.priceUSD !== undefined && Number(s.priceUSD) > 0;
            const isPurePoster = Boolean(s.imageUrl) && !s.title && !hasPrice;
            const resolvedFit = (!s.imageFit || s.imageFit === 'inherit') ? (displayConfig.imageFit || 'contain') : s.imageFit;

            list.push({
                id: s.id,
                kind: isPurePoster ? 'poster' : 'editorial',
                sourceLabel: 'CAMPAÑA DESTACADA',
                badge: s.badge || (isPurePoster ? '' : 'DESTACADO'),
                title: s.title || '',
                subtitle: s.subtitle || '',
                imageUrl: getImageUrl(s.imageUrl),
                imageFit: resolvedFit,
                priceUSD: hasPrice ? Number(s.priceUSD) : null,
                unitLabel: s.unitLabel || 'PRECIO PROMOCIONAL',
                presentations: []
            });
        });

        // 2. Promociones activas del módulo Ofertas
        if (displayConfig.autoIncludePromotions !== false && Array.isArray(activePromotions)) {
            activePromotions.forEach((promo) => {
                const fixedUsd = promo.fixedPrice && Number(promo.fixedPrice) > 0
                    ? Number(promo.fixedPrice)
                    : (promo.previewProductPrice && Number(promo.previewProductPrice) > 0 ? Number(promo.previewProductPrice) : null);

                list.push({
                    id: `promo_${promo.id}`,
                    kind: 'promo',
                    sourceLabel: 'OFERTA VERIFICADA EN SISTEMA',
                    badge: buildPromoBadge(promo),
                    title: promo.name || 'Promoción Especial',
                    subtitle: promo.description || (promo.previewProductName ? `Aplica en ${promo.previewProductName}` : 'Consulte disponibilidad y condiciones en caja'),
                    imageUrl: promo.previewImage ? getImageUrl(promo.previewImage) : '',
                    imageFit: 'contain',
                    priceUSD: fixedUsd,
                    unitLabel: promo.fixedPrice ? 'PRECIO DE OFERTA' : 'PRECIO DE REFERENCIA',
                    presentations: []
                });
            });
        }

        // 3. Productos destacados del catálogo con fotografía y stock disponible
        if (displayConfig.autoIncludeProducts !== false && Array.isArray(featuredProducts)) {
            const limit = Math.max(2, Number(displayConfig.maxAutoProducts) || 10);
            featuredProducts
                .filter(p => p && !usedProductIds.has(String(p.id)))
                .slice(0, limit)
                .forEach((p) => {
                    list.push({
                        id: `prod_${p.id}`,
                        kind: 'product',
                        sourceLabel: 'CATÁLOGO EN TIENDA',
                        badge: String(p.category || 'DISPONIBLE').toUpperCase(),
                        title: p.name,
                        subtitle: p.unitType === 'kg' ? 'Venta por peso verificada en balanza' : 'Disponible para despacho inmediato en mostrador',
                        imageUrl: getImageUrl(p.imageUrl),
                        imageFit: 'contain',
                        priceUSD: Number(p.price) > 0 ? Number(p.price) : null,
                        unitLabel: p.unitType === 'kg' ? 'PRECIO POR KG' : 'PRECIO UNITARIO',
                        presentations: Array.isArray(p.presentations) ? p.presentations.slice(0, 4) : []
                    });
                });
        }

        return list;
    }, [displayConfig, activePromotions, featuredProducts]);

    useEffect(() => {
        if (currentSlideIdx >= playlist.length && playlist.length > 0) {
            setCurrentSlideIdx(0);
        }
    }, [playlist.length, currentSlideIdx]);

    const hasItems = Array.isArray(cartData.items) && cartData.items.length > 0;
    const intervalMs = Math.max(3000, (Number(displayConfig.intervalSeconds) || 8) * 1000);

    // Motor de avance y progreso lineal del carrusel
    useEffect(() => {
        if (completedSale || playlist.length <= 1 || isPaused) {
            setProgressPct(0);
            return;
        }

        let startTs = performance.now();
        let rafId = null;

        const tick = (now) => {
            const elapsed = now - startTs;
            if (elapsed >= intervalMs) {
                setCurrentSlideIdx(prev => (prev + 1) % playlist.length);
                startTs = now;
                setProgressPct(0);
            } else {
                setProgressPct(Math.min(100, (elapsed / intervalMs) * 100));
            }
            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [completedSale, playlist.length, isPaused, intervalMs, currentSlideIdx]);

    const goPrevSlide = () => {
        if (playlist.length <= 1) return;
        setCurrentSlideIdx(prev => (prev - 1 + playlist.length) % playlist.length);
        setProgressPct(0);
    };

    const goNextSlide = () => {
        if (playlist.length <= 1) return;
        setCurrentSlideIdx(prev => (prev + 1) % playlist.length);
        setProgressPct(0);
    };

    const activeSlide = playlist.length > 0 ? (playlist[currentSlideIdx] || playlist[0]) : null;

    const upcomingSlides = useMemo(() => {
        if (playlist.length <= 1) return [];
        const items = [];
        const count = Math.min(3, playlist.length - 1);
        for (let offset = 1; offset <= count; offset++) {
            const idx = (currentSlideIdx + offset) % playlist.length;
            items.push({ slide: playlist[idx], index: idx });
        }
        return items;
    }, [playlist, currentSlideIdx]);

    const visiblePaymentLabels = useMemo(() => {
        if (allPaymentMethods.length > 0) {
            const seen = new Set();
            return allPaymentMethods
                .map(m => String(m.name || '').trim())
                .filter(name => {
                    if (!name || /cr[eé]dito|fiado/i.test(name)) return false;
                    const key = name.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .slice(0, 6);
        }
        return isUsdOnly
            ? ['Efectivo USD', 'Tarjeta / Punto', 'Transferencia']
            : ['Pago Móvil', 'Punto de Venta', 'Efectivo Bs', 'Divisas USD'];
    }, [allPaymentMethods, isUsdOnly]);

    // Tokens de estilo ortogonal según las 3 arquitecturas profesionales
    const tokens = useMemo(() => getDisplayThemeTokens(archTheme), [archTheme]);
    const { rootBg, footerStyle } = tokens;

    const resolvedBizLogo = getImageUrl(bizSettings.logo);
    const rateFormattedClean = formatBs(displayRate).replace(/^Bs\.?S?\s*/i, '').trim();

    return (
        <div className={`min-h-dvh h-dvh font-sans flex flex-col select-none overflow-hidden ${rootBg}`}>
            <CustomerDisplayHeader
                bizSettings={bizSettings}
                resolvedBizLogo={resolvedBizLogo}
                cartData={cartData}
                tokens={tokens}
                isUsdOnly={isUsdOnly}
                displayRate={displayRate}
                rateFormattedClean={rateFormattedClean}
                formattedDate={formattedDate}
                displayTime={displayTime}
                isConnected={isConnected}
                setArchTheme={setArchTheme}
                isFullscreen={isFullscreen}
                toggleFullscreen={toggleFullscreen}
            />

            {completedSale ? (
                <CustomerDisplaySaleCompleted
                    completedSale={completedSale}
                    cartData={cartData}
                    bizSettings={bizSettings}
                    isUsdOnly={isUsdOnly}
                    tokens={tokens}
                />
            ) : !hasItems ? (
                <CustomerDisplayAdShowcase
                    displayConfig={displayConfig}
                    activeSlide={activeSlide}
                    playlist={playlist}
                    currentSlideIdx={currentSlideIdx}
                    setCurrentSlideIdx={setCurrentSlideIdx}
                    setProgressPct={setProgressPct}
                    isPaused={isPaused}
                    setIsPaused={setIsPaused}
                    goPrevSlide={goPrevSlide}
                    goNextSlide={goNextSlide}
                    progressPct={progressPct}
                    resolvedBizLogo={resolvedBizLogo}
                    bizSettings={bizSettings}
                    cartData={cartData}
                    isUsdOnly={isUsdOnly}
                    displayRate={displayRate}
                    rateFormattedClean={rateFormattedClean}
                    visiblePaymentLabels={visiblePaymentLabels}
                    upcomingSlides={upcomingSlides}
                    tokens={tokens}
                />
            ) : (
                <CustomerDisplayLiveCart
                    cartData={cartData}
                    checkoutPayment={checkoutPayment}
                    isCheckoutActive={isCheckoutActive}
                    checkoutActiveMethod={checkoutActiveMethod}
                    isSplitActive={isSplitActive}
                    splitList={splitList}
                    isBinanceActive={isBinanceActive}
                    binanceSettings={binanceSettings}
                    generatingBinanceQr={generatingBinanceQr}
                    binanceQrUrl={binanceQrUrl}
                    hasPagoMovil={hasPagoMovil}
                    pagoMovilMethods={pagoMovilMethods}
                    selectedMethodId={selectedMethodId}
                    setSelectedMethodId={setSelectedMethodId}
                    checkoutRightTab={checkoutRightTab}
                    setCheckoutRightTab={setCheckoutRightTab}
                    generatingQr={generatingQr}
                    qrCodeUrl={qrCodeUrl}
                    activeBank={activeBank}
                    activeId={activeId}
                    activePhone={activePhone}
                    activeSlide={activeSlide}
                    playlist={playlist}
                    displayRate={displayRate}
                    rateFormattedClean={rateFormattedClean}
                    isUsdOnly={isUsdOnly}
                    bizSettings={bizSettings}
                    itemsListRef={itemsListRef}
                    tokens={tokens}
                />
            )}

            {/* PIE INSTITUCIONAL TÉCNICO */}
            <footer className={`h-8 px-4 sm:px-6 border-t flex items-center justify-between text-[10.5px] font-mono shrink-0 ${footerStyle}`}>
                <span className="truncate pr-4">
                    {displayConfig.institutionalTagline || 'Precios calculados a tasa oficial vigente'}
                </span>
                <div className="flex items-center gap-2 shrink-0 uppercase">
                    <span className="font-bold">{bizSettings.name}</span>
                    <span>·</span>
                    <span>TERMINAL AUDITADO</span>
                </div>
            </footer>
        </div>
    );
}
