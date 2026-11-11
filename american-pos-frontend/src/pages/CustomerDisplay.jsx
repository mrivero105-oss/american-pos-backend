import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    QrCode,
    Check,
    ChevronLeft,
    ChevronRight,
    Pause,
    Play,
    Maximize2,
    Minimize2,
    Columns2,
    Grid2x2,
    Cpu,
    Loader2,
    Tag,
    Package,
    CreditCard,
    Smartphone,
    Wallet,
    Send,
    Fingerprint,
    Banknote,
    Layers,
    ArrowRight,
    ShieldCheck,
    CheckCircle2,
    Clock,
    AlertCircle,
    User,
    DollarSign
} from 'lucide-react';
import { io } from 'socket.io-client';
import api, { formatServerUrl } from '../services/api';
import { getImageUrl } from '../utils/imageUtils';
import { formatBs, formatUSD, formatStock, isDollarOnlyCountry, isUsdOnlyMode, precisionRound } from '../utils/format';
import {
    generatePagoMovilQR,
    getBankNameByCode,
    cleanPhone,
    cleanIdNumber,
    formatPhoneDisplay,
    formatIdDisplay
} from '../utils/pagoMovilQR';
import { generateBinanceQR } from '../utils/binanceQR';

const VALID_ARCH_THEMES = ['studio', 'swiss', 'titanium'];

const normalizeArchTheme = (raw) => {
    if (VALID_ARCH_THEMES.includes(raw)) return raw;
    if (raw === 'swiss') return 'swiss';
    if (raw === 'oled' || raw === 'dark') return 'titanium';
    if (raw === 'light') return 'studio';
    return 'studio';
};

const DEFAULT_DISPLAY_CONFIG = {
    layoutMode: 'split',
    intervalSeconds: 8,
    imageFit: 'contain',
    autoIncludePromotions: true,
    autoIncludeProducts: true,
    maxAutoProducts: 10,
    institutionalTagline: 'Precios calculados a tasa oficial vigente',
    slides: []
};

const getBusinessInitials = (name) => {
    const clean = String(name || 'POS').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
};

const buildPromoBadge = (promo) => {
    if (!promo) return 'OFERTA ACTIVA';
    const type = String(promo.type || '').toUpperCase();
    if (type === 'BUY_X_GET_Y' && promo.buyQuantity > 0 && promo.payQuantity > 0) {
        return `PROMOCIÓN ${promo.buyQuantity}x${promo.payQuantity}`;
    }
    if ((type === 'PERCENTAGE' || type === 'PERCENT_DISCOUNT' || promo.discountPercentage > 0) && promo.discountPercentage > 0) {
        return `-${promo.discountPercentage}% DESCUENTO`;
    }
    if (promo.fixedPrice && Number(promo.fixedPrice) > 0) {
        return 'PRECIO ESPECIAL';
    }
    if (type.includes('COMBO')) {
        return 'COMBO ESPECIAL';
    }
    return 'PROMOCIÓN VIGENTE';
};

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
        } catch (_) {}
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
        } catch (_) {}
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
        } catch (_) {}
    };

    const [currentTime, setCurrentTime] = useState(() => new Date());
    const [isConnected, setIsConnected] = useState(false);

    // Datos públicos del feed de señalización digital
    const [displayConfig, setDisplayConfig] = useState(() => {
        try {
            const cached = localStorage.getItem('pos_customer_display_config');
            if (cached) return { ...DEFAULT_DISPLAY_CONFIG, ...JSON.parse(cached) };
        } catch (_) {}
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
        } catch (_) {}
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
    }, [checkoutPayment, allPaymentMethods, displayRate, checkoutActiveMethod, binanceSettings]);

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
        } catch (_) {}

        try {
            const cachedCart = localStorage.getItem('isaac_pos_display_sync');
            if (cachedCart) {
                const parsed = JSON.parse(cachedCart);
                if (parsed && (Date.now() - (parsed.timestamp || 0)) < 2700000) {
                    handleCartUpdate(parsed);
                }
            }
        } catch (_) {}

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
        } catch (_) {}

        const handleStorage = (e) => {
            if (e.key === 'isaac_pos_display_sync' && e.newValue) {
                try { handleCartUpdate(JSON.parse(e.newValue)); } catch (_) {}
            } else if (e.key === 'isaac_pos_display_sync_sale_completed' && e.newValue) {
                try { handleSaleCompleted(JSON.parse(e.newValue)); } catch (_) {}
            } else if (e.key === 'isaac_pos_display_payment_sync') {
                if (!e.newValue) {
                    setCheckoutPayment(null);
                } else {
                    try { handlePaymentSelectionUpdate(JSON.parse(e.newValue)); } catch (_) {}
                }
            } else if (e.key === 'pos_payment_methods' && e.newValue) {
                try { applyPaymentMethods(JSON.parse(e.newValue)); } catch (_) {}
            } else if (e.key === 'pos_customer_display_config' && e.newValue) {
                try {
                    const cfg = JSON.parse(e.newValue);
                    setDisplayConfig(prev => ({
                        ...DEFAULT_DISPLAY_CONFIG,
                        ...prev,
                        ...cfg,
                        slides: Array.isArray(cfg.slides) ? cfg.slides.filter(s => s && s.enabled !== false) : []
                    }));
                } catch (_) {}
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

        const socket = io(socketUrl, {
            reconnection: true,
            reconnectionDelay: 1500,
            timeout: 8000
        });

        socket.on('connect', () => {
            setIsConnected(true);
            const urlParams = new URLSearchParams(window.location.search);
            const companyId = urlParams.get('companyId') || localStorage.getItem('pos_company_id') || '2';
            const registerId = urlParams.get('registerId') || urlParams.get('caja') || '1';

            socket.emit('join_customer_display', { registerId, companyId });
            socket.emit('join_company', companyId);
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
                try { bc.close(); } catch (_) {}
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
    const isStudio = archTheme === 'studio';
    const isSwiss = archTheme === 'swiss';
    const isTitanium = archTheme === 'titanium';

    const rootBg = isTitanium
        ? 'bg-[#090B0E] text-[#F1F5F9]'
        : isSwiss
            ? 'bg-[#F7F8FA] text-[#090D14]'
            : 'bg-[#EFF2F6] text-[#0B0F17]';

    const headerStyle = isTitanium
        ? 'bg-[#0E1217] border-[#212834] text-[#F8FAFC] divide-[#212834]'
        : isSwiss
            ? 'bg-white border-[#C8D0DC] text-[#090D14] divide-[#C8D0DC]'
            : 'bg-[#0A0D12] border-[#1E2530] text-white divide-[#1E2530]';

    const headerMuted = isSwiss ? 'text-[#5A6577]' : 'text-[#8E9BAE]';

    const stagePanelStyle = isTitanium
        ? 'bg-[#0E1217] border-[#212834] text-[#F8FAFC]'
        : isSwiss
            ? 'bg-white border-[#C8D0DC] text-[#090D14]'
            : 'bg-white border-[#D4DCE6] text-[#0B0F17]';

    const railPanelStyle = isTitanium
        ? 'bg-[#11161D] border-[#212834] text-[#F8FAFC] divide-[#212834]'
        : isSwiss
            ? 'bg-[#F7F8FA] border-[#C8D0DC] text-[#090D14] divide-[#C8D0DC]'
            : 'bg-[#0A0D12] border-[#1E2530] text-white divide-[#1E2530]';

    const railMuted = isSwiss ? 'text-[#5A6577]' : 'text-[#8E9BAE]';

    const footerStyle = isTitanium
        ? 'bg-[#0E1217] border-[#212834] text-[#8B96A8]'
        : isSwiss
            ? 'bg-white border-[#C8D0DC] text-[#5A6577]'
            : 'bg-[#0A0D12] border-[#1E2530] text-[#94A3B8]';

    const resolvedBizLogo = getImageUrl(bizSettings.logo);
    const rateFormattedClean = formatBs(displayRate).replace(/^Bs\.?S?\s*/i, '').trim();

    return (
        <div className={`min-h-dvh h-dvh font-sans flex flex-col select-none overflow-hidden ${rootBg}`}>
            {/* BARRA SUPERIOR ORTOGONAL DE PRECISIÓN */}
            <header className={`h-[62px] border-b flex items-stretch justify-between shrink-0 ${headerStyle}`}>
                {/* Identidad del Comercio y Estación */}
                <div className="px-4 sm:px-6 flex items-center gap-3.5 min-w-0">
                    {resolvedBizLogo ? (
                        <div className={`w-10 h-10 rounded-md border p-1 flex items-center justify-center shrink-0 overflow-hidden ${
                            isSwiss ? 'bg-[#F7F8FA] border-[#C8D0DC]' : 'bg-white border-white/15'
                        }`}>
                            <img
                                src={resolvedBizLogo}
                                alt={bizSettings.name}
                                className="w-full h-full object-contain"
                            />
                        </div>
                    ) : (
                        <div className={`w-10 h-10 rounded-md border flex items-center justify-center font-mono font-black text-sm tracking-tight shrink-0 ${
                            isSwiss
                                ? 'bg-[#090D14] text-white border-[#090D14]'
                                : 'bg-[#161D27] text-white border-[#2A3444]'
                        }`}>
                            {getBusinessInitials(bizSettings.name)}
                        </div>
                    )}

                    <div className="min-w-0">
                        <h1 className="text-sm sm:text-base font-extrabold uppercase tracking-tight leading-none truncate">
                            {bizSettings.name}
                        </h1>
                        <div className={`text-[11px] font-mono mt-1 flex items-center gap-2 truncate ${headerMuted}`}>
                            <span className="font-bold uppercase">{cartData.registerName || 'CAJA 1'}</span>
                            <span>/</span>
                            <span className="truncate">
                                OPERADOR: <strong className={isSwiss ? 'text-[#090D14]' : 'text-white'}>{cartData.cashierName || 'ESTACIÓN ACTIVA'}</strong>
                            </span>
                        </div>
                    </div>
                </div>

                {/* Celdas Tabulares Derechas */}
                <div className={`flex items-stretch divide-x border-l ${
                    isTitanium ? 'border-[#212834] divide-[#212834]' : isSwiss ? 'border-[#C8D0DC] divide-[#C8D0DC]' : 'border-[#1E2530] divide-[#1E2530]'
                }`}>
                    {/* Tasa BCV */}
                    {!isUsdOnly && displayRate > 1 && (
                        <div className="hidden md:flex flex-col justify-center px-4 lg:px-5">
                            <span className={`text-[9px] font-mono font-bold uppercase tracking-[0.14em] ${headerMuted}`}>
                                Tasa Oficial BCV
                            </span>
                            <span className={`text-xs lg:text-sm font-mono font-bold tabular-nums mt-0.5 ${
                                isSwiss ? 'text-[#047857]' : 'text-emerald-400'
                            }`}>
                                Bs {rateFormattedClean} / USD
                            </span>
                        </div>
                    )}

                    {/* Cronómetro */}
                    <div className="hidden sm:flex flex-col justify-center px-4 lg:px-5">
                        <span className={`text-[9px] font-mono font-bold uppercase tracking-[0.14em] ${headerMuted}`}>
                            {formattedDate}
                        </span>
                        <span className="text-xs lg:text-sm font-mono font-bold tabular-nums mt-0.5">
                            {displayTime}
                        </span>
                    </div>

                    {/* Estado de Sincronización */}
                    <div className="flex items-center gap-2 px-3.5 lg:px-4">
                        <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
                            {isConnected ? 'En Línea' : 'Local'}
                        </span>
                    </div>

                    {/* Conmutador de las 3 Arquitecturas + Pantalla Completa */}
                    <div className="flex items-center gap-1 px-3">
                        <div className={`flex items-center p-0.5 rounded border ${
                            isSwiss ? 'bg-[#EFF2F6] border-[#C8D0DC]' : 'bg-[#141A23] border-[#263040]'
                        }`}>
                            <button
                                type="button"
                                onClick={() => setArchTheme('studio')}
                                title="Arquitectura Studio Bimodal"
                                className={`w-7 h-7 rounded-xs flex items-center justify-center transition-colors cursor-pointer ${
                                    isStudio
                                        ? 'bg-blue-600 text-white'
                                        : isSwiss ? 'text-[#5A6577] hover:text-[#090D14]' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <Columns2 size={13} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setArchTheme('swiss')}
                                title="Arquitectura Swiss Grid"
                                className={`w-7 h-7 rounded-xs flex items-center justify-center transition-colors cursor-pointer ${
                                    isSwiss
                                        ? 'bg-[#090D14] text-white'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <Grid2x2 size={13} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setArchTheme('titanium')}
                                title="Arquitectura Titanium Console"
                                className={`w-7 h-7 rounded-xs flex items-center justify-center transition-colors cursor-pointer ${
                                    isTitanium
                                        ? 'bg-[#2B3544] text-white'
                                        : isSwiss ? 'text-[#5A6577] hover:text-[#090D14]' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <Cpu size={13} />
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={toggleFullscreen}
                            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa (F11)'}
                            className={`w-8 h-8 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                                isSwiss
                                    ? 'bg-[#F7F8FA] border-[#C8D0DC] text-[#090D14] hover:bg-[#EAECEF]'
                                    : 'bg-[#141A23] border-[#263040] text-slate-300 hover:text-white'
                            }`}
                        >
                            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                        </button>
                    </div>
                </div>
            </header>

            {/* ESTADO 1: COMPROBANTE DE OPERACIÓN FINALIZADA */}
            {completedSale ? (
                <main className="flex-1 flex items-center justify-center p-6 sm:p-10 overflow-hidden">
                    <div className={`w-full max-w-3xl border rounded-md overflow-hidden shadow-lg ${stagePanelStyle}`}>
                        {/* Cabecera del Comprobante */}
                        <div className={`px-6 sm:px-8 py-5 border-b flex items-center justify-between ${
                            isTitanium ? 'bg-[#131922] border-[#212834]' : isSwiss ? 'bg-[#F7F8FA] border-[#C8D0DC]' : 'bg-[#0A0D12] text-white border-[#1E2530]'
                        }`}>
                            <div className="flex items-center gap-3.5">
                                <div className="w-10 h-10 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0">
                                    <Check size={22} strokeWidth={2.8} />
                                </div>
                                <div>
                                    <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-emerald-500 block">
                                        Transacción Registrada
                                    </span>
                                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                                        {(completedSale.customerName || cartData.customerName)
                                            ? `Gracias por su compra, ${completedSale.customerName || cartData.customerName}`
                                            : 'Gracias por su compra'}
                                    </h2>
                                </div>
                            </div>

                            <div className="text-right font-mono">
                                <span className={`text-[10px] uppercase tracking-wider block ${isStudio ? 'text-slate-400' : headerMuted}`}>
                                    Estación
                                </span>
                                <span className="text-xs font-bold uppercase">
                                    {cartData.registerName || 'CAJA 1'}
                                </span>
                            </div>
                        </div>

                        {/* Celdas Contables: Total Facturado vs Cambio / Vuelto */}
                        <div className={`grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x ${
                            isTitanium ? 'divide-[#212834]' : isSwiss ? 'divide-[#C8D0DC]' : 'divide-[#D4DCE6]'
                        }`}>
                            <div className="p-6 sm:p-8">
                                <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-2 ${
                                    isTitanium ? 'text-[#8B96A8]' : 'text-[#5A6577]'
                                }`}>
                                    Total Facturado
                                </span>
                                {!isUsdOnly && (completedSale.totalBs || 0) > 0 ? (
                                    <>
                                        <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight">
                                            {formatBs(completedSale.totalBs)}
                                        </div>
                                        <div className={`text-sm font-mono font-semibold tabular-nums mt-1.5 ${
                                            isTitanium ? 'text-[#94A3B8]' : 'text-[#5A6577]'
                                        }`}>
                                            Ref. {formatUSD(completedSale.totalUSD || 0)}
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight">
                                        {formatUSD(completedSale.totalUSD || 0)}
                                    </div>
                                )}
                            </div>

                            <div className={`p-6 sm:p-8 ${
                                isTitanium ? 'bg-emerald-950/20' : 'bg-emerald-50/60'
                            }`}>
                                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400 block mb-2">
                                    Su Cambio / Vuelto
                                </span>
                                {!isUsdOnly && (completedSale.changeBs || 0) > 0 ? (
                                    <>
                                        <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                                            {formatBs(completedSale.changeBs)}
                                        </div>
                                        <div className="text-sm font-mono font-semibold tabular-nums mt-1.5 text-emerald-700/80 dark:text-emerald-300/80">
                                            Ref. {formatUSD(completedSale.changeUSD || 0)}
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                                        {formatUSD(completedSale.changeUSD || 0)}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Pie del Comprobante */}
                        <div className={`px-6 sm:px-8 py-3.5 border-t flex items-center justify-between text-xs ${
                            isTitanium ? 'bg-[#0B0E13] border-[#212834] text-[#8B96A8]' : 'bg-slate-50 border-[#D4DCE6] text-[#5A6577]'
                        }`}>
                            <span>Verifique su comprobante antes de retirarse de la estación.</span>
                            <span className="font-mono font-bold uppercase">{bizSettings.name}</span>
                        </div>
                    </div>
                </main>
            ) : !hasItems ? (
                /* ESTADO 2: CARRUSEL DE PUBLICIDAD Y SEÑALIZACIÓN DIGITAL COMERCIAL */
                <main className={`flex-1 min-h-0 grid grid-cols-1 ${
                    displayConfig.layoutMode === 'fullscreen' ? 'lg:grid-cols-12 p-0' : 'lg:grid-cols-12 p-3 sm:p-4 gap-3 sm:gap-4'
                } overflow-hidden`}>
                    {/* ESCENARIO PRINCIPAL PUBLICITARIO */}
                    <section className={`${
                        displayConfig.layoutMode === 'fullscreen'
                            ? 'lg:col-span-12 border-0 rounded-none'
                            : 'lg:col-span-8 border rounded-md'
                    } relative flex flex-col min-h-0 overflow-hidden ${stagePanelStyle}`}>
                        {activeSlide ? (
                            activeSlide.kind === 'poster' ? (
                                /* MODO FLYER / POSTER GRÁFICO PURO A SANGRE */
                                <div className={`flex-1 min-h-0 relative flex items-center justify-center overflow-hidden ${
                                    isTitanium ? 'bg-[#090B0E]' : 'bg-[#0F131A]'
                                }`}>
                                    <img
                                        key={activeSlide.id}
                                        src={activeSlide.imageUrl}
                                        alt={activeSlide.badge || bizSettings.name}
                                        className={`absolute inset-0 w-full h-full ${
                                            activeSlide.imageFit === 'cover' ? 'object-cover' : 'object-contain'
                                        }`}
                                    />
                                    {activeSlide.badge && (
                                        <div className="absolute top-5 left-5 px-3 py-1 bg-[#0A0D12]/90 text-white border border-white/15 text-[11px] font-mono font-bold uppercase tracking-[0.14em]">
                                            {activeSlide.badge}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* MODO VITRINA EDITORIAL SUIZA (PRODUCTO / OFERTA / CAMPAÑA CON PRECIO DINÁMICO) */
                                <div key={activeSlide.id} className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
                                    {/* Marco Visual / Fotográfico */}
                                    <div className={`md:col-span-6 h-full min-h-0 flex flex-col p-4 sm:p-6 overflow-hidden border-b md:border-b-0 md:border-r ${
                                        isTitanium
                                            ? 'bg-[#0B0E13] border-[#212834]'
                                            : isSwiss
                                                ? 'bg-[#F7F8FA] border-[#C8D0DC]'
                                                : 'bg-[#F6F8FA] border-[#E2E8F0]'
                                    }`}>
                                        {/* Índice Editorial Superior Izquierdo */}
                                        <div className="shrink-0 mb-3 flex items-center gap-2">
                                            <span className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest border ${
                                                isTitanium
                                                    ? 'bg-[#141A23] border-[#283242] text-[#CBD5E1]'
                                                    : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                                            }`}>
                                                {String(currentSlideIdx + 1).padStart(2, '0')} / {String(playlist.length).padStart(2, '0')}
                                            </span>
                                            <span className={`text-[10px] font-mono uppercase tracking-wider ${
                                                isTitanium ? 'text-[#64748B]' : 'text-[#64748B]'
                                            }`}>
                                                {activeSlide.sourceLabel}
                                            </span>
                                        </div>

                                        {activeSlide.imageUrl ? (
                                            <div className={`relative flex-1 min-h-[220px] w-full rounded-md border overflow-hidden bg-white ${
                                                isTitanium ? 'border-[#212834]' : 'border-[#CBD5E1]'
                                            }`}>
                                                <img
                                                    src={activeSlide.imageUrl}
                                                    alt={activeSlide.title}
                                                    className="absolute inset-0 w-full h-full object-contain p-4 sm:p-6 select-none"
                                                />
                                            </div>
                                        ) : (
                                            <div className={`flex-1 min-h-[220px] w-full flex flex-col items-center justify-center p-6 border border-dashed rounded-md ${
                                                isTitanium ? 'border-[#252E3D]' : 'border-[#CBD5E1]'
                                            }`}>
                                                <Tag size={44} strokeWidth={1.5} className={isTitanium ? 'text-blue-400 mb-3' : 'text-blue-700 mb-3'} />
                                                <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-center">
                                                    {activeSlide.badge}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Ficha Tipográfica y Bloque Monetario */}
                                    <div className="md:col-span-6 p-6 sm:p-8 lg:p-10 flex flex-col justify-between overflow-hidden">
                                        <div className="space-y-4">
                                            {activeSlide.badge && (
                                                <div className="inline-flex items-center gap-2">
                                                    <span className={`px-2.5 py-1 text-[10.5px] font-mono font-bold uppercase tracking-[0.14em] rounded-xs ${
                                                        activeSlide.kind === 'promo'
                                                            ? 'bg-blue-600 text-white'
                                                            : isTitanium
                                                                ? 'bg-[#1A222E] text-blue-400 border border-[#2B374A]'
                                                                : 'bg-[#0B0F17] text-white'
                                                    }`}>
                                                        {activeSlide.badge}
                                                    </span>
                                                </div>
                                            )}

                                            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-[1.08] line-clamp-3">
                                                {activeSlide.title}
                                            </h2>

                                            {activeSlide.subtitle && (
                                                <p className={`text-xs sm:text-sm leading-relaxed line-clamp-2 ${
                                                    isTitanium ? 'text-[#94A3B8]' : 'text-[#526075]'
                                                }`}>
                                                    {activeSlide.subtitle}
                                                </p>
                                            )}

                                            {/* Tabla de Presentaciones / Empaques si el producto las posee */}
                                            {Array.isArray(activeSlide.presentations) && activeSlide.presentations.length > 0 && (
                                                <div className="pt-2 space-y-1.5">
                                                    <span className={`text-[9.5px] font-mono font-bold uppercase tracking-[0.14em] block ${
                                                        isTitanium ? 'text-[#8B96A8]' : 'text-[#64748B]'
                                                    }`}>
                                                        Formatos & Presentaciones Disponibles
                                                    </span>
                                                    <div className="grid grid-cols-1 gap-1.5">
                                                        {activeSlide.presentations.map(pres => (
                                                            <div
                                                                key={pres.id}
                                                                className={`px-3 py-1.5 rounded-xs border flex items-center justify-between text-xs font-mono ${
                                                                    isTitanium
                                                                        ? 'bg-[#141922] border-[#242D3C] text-[#E2E8F0]'
                                                                        : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#0F172A]'
                                                                }`}
                                                            >
                                                                <span className="font-bold uppercase truncate pr-2">{pres.name}</span>
                                                                <div className="flex items-baseline gap-2 shrink-0 tabular-nums">
                                                                    {!isUsdOnly ? (
                                                                        <>
                                                                            <span className="font-extrabold">
                                                                                {formatBs(pres.price * displayRate)}
                                                                            </span>
                                                                            <span className="text-[10.5px] opacity-65">
                                                                                {formatUSD(pres.price)}
                                                                            </span>
                                                                        </>
                                                                    ) : (
                                                                        <span className="font-extrabold">{formatUSD(pres.price)}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Bloque Monumental de Precio */}
                                        {activeSlide.priceUSD !== null && activeSlide.priceUSD > 0 ? (
                                            <div className={`mt-6 pt-5 border-t ${
                                                isTitanium ? 'border-[#212834]' : 'border-[#D4DCE6]'
                                            }`}>
                                                <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-1 ${
                                                    isTitanium ? 'text-[#8B96A8]' : 'text-[#64748B]'
                                                }`}>
                                                    {activeSlide.unitLabel || 'PRECIO DE VENTA'}
                                                </span>

                                                {!isUsdOnly ? (
                                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                        <div className="text-3xl sm:text-4xl lg:text-[42px] font-black font-mono tabular-nums tracking-tight leading-none">
                                                            {formatBs(activeSlide.priceUSD * displayRate)}
                                                        </div>
                                                        <span className={`px-2.5 py-1 rounded-xs font-mono text-sm font-bold tabular-nums border ${
                                                            isTitanium
                                                                ? 'bg-[#141A23] border-[#283242] text-emerald-400'
                                                                : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#0F172A]'
                                                        }`}>
                                                            Ref. {formatUSD(activeSlide.priceUSD)}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="text-3xl sm:text-4xl lg:text-[42px] font-black font-mono tabular-nums tracking-tight leading-none">
                                                        {formatUSD(activeSlide.priceUSD)}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className={`mt-6 pt-4 border-t flex items-center justify-between text-xs font-mono ${
                                                isTitanium ? 'border-[#212834] text-[#8B96A8]' : 'border-[#D4DCE6] text-[#64748B]'
                                            }`}>
                                                <span>CONSULTE EN ESTACIÓN DE COBRO</span>
                                                <span className="font-bold uppercase">{bizSettings.name}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        ) : (
                            /* FALLBACK INSTITUCIONAL SOBRIO (SI NO HAY SLIDES NI PRODUCTOS CON FOTO) */
                            <div className="flex-1 flex flex-col justify-between p-8 sm:p-12">
                                <div className="flex items-center justify-between border-b pb-4 border-current/10">
                                    <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] opacity-60">
                                        ESTACIÓN DE ATENCIÓN AL CLIENTE
                                    </span>
                                    <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] opacity-60">
                                        {cartData.registerName || 'CAJA 1'}
                                    </span>
                                </div>

                                <div className="my-auto py-8 max-w-2xl">
                                    {resolvedBizLogo && (
                                        <img
                                            src={resolvedBizLogo}
                                            alt={bizSettings.name}
                                            className="h-24 w-auto object-contain mb-6"
                                        />
                                    )}
                                    <h2 className="text-3xl sm:text-5xl font-black tracking-tight uppercase leading-none mb-4">
                                        {bizSettings.name}
                                    </h2>
                                    <p className={`text-sm sm:text-base leading-relaxed ${
                                        isTitanium ? 'text-[#94A3B8]' : 'text-[#526075]'
                                    }`}>
                                        Estación habilitada para facturación inmediata. Todos los importes y conversiones se auditan en pantalla en tiempo real.
                                    </p>
                                </div>

                                <div className="text-[11px] font-mono uppercase tracking-wider opacity-60">
                                    {displayConfig.institutionalTagline}
                                </div>
                            </div>
                        )}

                        {/* Barra Inferior de Control de Carrusel y Progreso Lineal Milimétrico */}
                        {playlist.length > 0 && (
                            <div className={`shrink-0 border-t ${
                                isTitanium
                                    ? 'bg-[#0B0E13] border-[#212834] text-[#CBD5E1]'
                                    : 'bg-[#F8FAFC] border-[#D4DCE6] text-[#0F172A]'
                            }`}>
                                <div className="h-10 px-4 flex items-center justify-between gap-4">
                                    {/* Indicadores de segmento */}
                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                        <span className="text-[11px] font-mono font-bold tabular-nums mr-2 shrink-0">
                                            {String(currentSlideIdx + 1).padStart(2, '0')} / {String(playlist.length).padStart(2, '0')}
                                        </span>
                                        <div className="hidden sm:flex items-center gap-1">
                                            {playlist.slice(0, 14).map((sl, i) => (
                                                <button
                                                    key={sl.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setCurrentSlideIdx(i);
                                                        setProgressPct(0);
                                                    }}
                                                    className={`h-1.5 transition-all cursor-pointer ${
                                                        i === currentSlideIdx
                                                            ? 'w-6 bg-blue-600'
                                                            : isTitanium
                                                                ? 'w-2 bg-[#283242] hover:bg-[#3B495E]'
                                                                : 'w-2 bg-[#CBD5E1] hover:bg-[#94A3B8]'
                                                    }`}
                                                    aria-label={`Ir a diapositiva ${i + 1}`}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    {/* Controles táctiles discretos */}
                                    {playlist.length > 1 && (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                type="button"
                                                onClick={goPrevSlide}
                                                className={`w-7 h-7 rounded-xs border flex items-center justify-center transition-colors cursor-pointer ${
                                                    isTitanium
                                                        ? 'border-[#263040] hover:bg-[#18202C]'
                                                        : 'border-[#CBD5E1] bg-white hover:bg-slate-100'
                                                }`}
                                                title="Anterior"
                                            >
                                                <ChevronLeft size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setIsPaused(p => !p)}
                                                className={`w-7 h-7 rounded-xs border flex items-center justify-center transition-colors cursor-pointer ${
                                                    isTitanium
                                                        ? 'border-[#263040] hover:bg-[#18202C]'
                                                        : 'border-[#CBD5E1] bg-white hover:bg-slate-100'
                                                }`}
                                                title={isPaused ? 'Reanudar rotación' : 'Pausar rotación'}
                                            >
                                                {isPaused ? <Play size={12} /> : <Pause size={12} />}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={goNextSlide}
                                                className={`w-7 h-7 rounded-xs border flex items-center justify-center transition-colors cursor-pointer ${
                                                    isTitanium
                                                        ? 'border-[#263040] hover:bg-[#18202C]'
                                                        : 'border-[#CBD5E1] bg-white hover:bg-slate-100'
                                                }`}
                                                title="Siguiente"
                                            >
                                                <ChevronRight size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Línea de tiempo continua de 2px */}
                                <div className={`h-[2px] w-full ${isTitanium ? 'bg-[#18202B]' : 'bg-[#E2E8F0]'}`}>
                                    <div
                                        className="h-full bg-blue-600 transition-none"
                                        style={{ width: `${isPaused || playlist.length <= 1 ? 100 : progressPct}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    </section>

                    {/* RAIL INSTITUCIONAL DERECHO (VISIBLE EN MODO SPLIT) */}
                    {displayConfig.layoutMode !== 'fullscreen' && (
                        <aside className={`lg:col-span-4 border rounded-md flex flex-col divide-y overflow-hidden ${railPanelStyle}`}>
                            {/* Celda 1: Cotización Oficial Vigente */}
                            {!isUsdOnly && displayRate > 1 ? (
                                <div className="p-5 shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] ${railMuted}`}>
                                            Tipo de Cambio Oficial
                                        </span>
                                        <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                            BCV Vigente
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight">
                                            Bs {rateFormattedClean}
                                        </span>
                                        <span className={`text-xs font-mono font-semibold ${railMuted}`}>
                                            por 1,00 USD
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-5 shrink-0">
                                    <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-1 ${railMuted}`}>
                                        Estación Habilitada
                                    </span>
                                    <div className="text-xl font-extrabold tracking-tight">
                                        {cartData.registerName || 'Caja Principal'}
                                    </div>
                                </div>
                            )}

                            {/* Celda 2: Canales de Pago Habilitados */}
                            <div className="p-5 shrink-0">
                                <div className="flex items-center gap-2 mb-3">
                                    <CreditCard size={13} className={railMuted} />
                                    <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] ${railMuted}`}>
                                        Canales de Pago Aceptados
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {visiblePaymentLabels.map((label) => (
                                        <span
                                            key={label}
                                            className={`px-2.5 py-1 text-[11px] font-semibold rounded-xs border ${
                                                isSwiss
                                                    ? 'bg-white border-[#C8D0DC] text-[#090D14]'
                                                    : 'bg-[#151B24] border-[#263040] text-slate-200'
                                            }`}
                                        >
                                            {label}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Celda 3: Cola de Señalización ("A continuación") o Datos Rápidos Pago Móvil */}
                            <div className="p-5 flex-1 flex flex-col justify-between overflow-hidden">
                                {upcomingSlides.length > 0 ? (
                                    <div className="space-y-2.5 overflow-hidden">
                                        <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block ${railMuted}`}>
                                            Siguiente en Vitrina
                                        </span>
                                        <div className="space-y-2">
                                            {upcomingSlides.map(({ slide, index }) => (
                                                <button
                                                    key={slide.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setCurrentSlideIdx(index);
                                                        setProgressPct(0);
                                                    }}
                                                    className={`w-full p-2.5 rounded-xs border flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer ${
                                                        isSwiss
                                                            ? 'bg-white border-[#C8D0DC] hover:bg-[#EFF2F6]'
                                                            : 'bg-[#141A23] border-[#242E3D] hover:bg-[#1A222E]'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <span className={`text-[10px] font-mono font-bold shrink-0 ${railMuted}`}>
                                                            {String(index + 1).padStart(2, '0')}
                                                        </span>
                                                        {slide.imageUrl ? (
                                                            <div className="w-9 h-9 rounded-xs bg-white p-0.5 border border-black/10 shrink-0 flex items-center justify-center overflow-hidden">
                                                                <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" />
                                                            </div>
                                                        ) : (
                                                            <div className={`w-9 h-9 rounded-xs border shrink-0 flex items-center justify-center ${
                                                                isSwiss ? 'border-[#C8D0DC]' : 'border-[#2A3547]'
                                                            }`}>
                                                                <Package size={14} className={railMuted} />
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <div className="text-xs font-bold truncate">
                                                                {slide.title || slide.badge || 'Anuncio Comercial'}
                                                            </div>
                                                            <div className={`text-[10px] font-mono uppercase truncate ${railMuted}`}>
                                                                {slide.badge || slide.sourceLabel}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {slide.priceUSD !== null && slide.priceUSD > 0 && (
                                                        <div className="text-right font-mono shrink-0 tabular-nums">
                                                            <div className="text-xs font-extrabold">
                                                                {!isUsdOnly ? formatBs(slide.priceUSD * displayRate) : formatUSD(slide.priceUSD)}
                                                            </div>
                                                            {!isUsdOnly && (
                                                                <div className={`text-[10px] ${railMuted}`}>
                                                                    {formatUSD(slide.priceUSD)}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="my-auto">
                                        <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-1.5 ${railMuted}`}>
                                            Atención en Mostrador
                                        </span>
                                        <p className={`text-xs leading-relaxed ${railMuted}`}>
                                            Al iniciar el escaneo de sus productos, verá el detalle línea por línea junto al código QR exacto para su pago.
                                        </p>
                                    </div>
                                )}

                                <div className={`pt-3 mt-3 border-t text-[10.5px] font-mono flex items-center justify-between ${
                                    isSwiss ? 'border-[#C8D0DC] text-[#5A6577]' : 'border-[#1E2530] text-[#8E9BAE]'
                                }`}>
                                    <span>AUDITORÍA DE PRECIOS EN VIVO</span>
                                    <span className="font-bold">{playlist.length} ÍTEMS</span>
                                </div>
                            </div>
                        </aside>
                    )}
                </main>
            ) : (
                /* ESTADO 3: CONSOLA ACTIVA DE FACTURACIÓN Y COBRO AUDITADO EN TIEMPO REAL */
                <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 p-3 sm:p-4 overflow-hidden">
                    {/* CINTA CONTABLE DE ARTÍCULOS ESCANEADOS (7 COLUMNAS) */}
                    <section className={`lg:col-span-7 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                        {/* Placa de Identificación del Cliente / Titular de la Operación */}
                        {(() => {
                            const activeCustName = (isCheckoutActive && checkoutPayment?.customerName)
                                ? checkoutPayment.customerName
                                : (cartData.customerName || '');
                            const activeCustDoc = (isCheckoutActive && checkoutPayment?.customerDoc)
                                ? checkoutPayment.customerDoc
                                : (cartData.customerDoc || '');
                            const hasRegisteredCustomer = Boolean(activeCustName && activeCustName.trim() && activeCustName.toLowerCase() !== 'cliente ocasional');

                            return (
                                <div className={`px-4 sm:px-5 py-2.5 border-b flex items-center justify-between gap-3 shrink-0 ${
                                    hasRegisteredCustomer
                                        ? isTitanium
                                            ? 'bg-blue-950/30 border-[#212834]'
                                            : 'bg-blue-50/70 border-[#D4DCE6]'
                                        : isTitanium
                                            ? 'bg-[#0F141C] border-[#212834]'
                                            : 'bg-white border-[#D4DCE6]'
                                }`}>
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className={`w-7 h-7 rounded-xs border flex items-center justify-center shrink-0 ${
                                            hasRegisteredCustomer
                                                ? isTitanium
                                                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                                                    : 'bg-blue-600 border-blue-600 text-white'
                                                : isTitanium
                                                    ? 'bg-[#18202C] border-[#2B374A] text-[#94A3B8]'
                                                    : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]'
                                        }`}>
                                            <User size={14} strokeWidth={2.3} />
                                        </div>
                                        <div className="min-w-0">
                                            <span className={`text-[9.5px] font-mono font-bold uppercase tracking-[0.14em] block leading-none mb-0.5 ${
                                                hasRegisteredCustomer
                                                    ? isTitanium ? 'text-blue-400' : 'text-blue-700'
                                                    : isTitanium ? 'text-[#8B96A8]' : 'text-[#64748B]'
                                            }`}>
                                                Cliente Titular
                                            </span>
                                            <div className="text-xs sm:text-sm font-extrabold tracking-tight truncate">
                                                {hasRegisteredCustomer ? activeCustName : 'Cliente Ocasional'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="shrink-0 flex items-center gap-1.5">
                                        {hasRegisteredCustomer ? (
                                            <span className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold uppercase border ${
                                                isTitanium
                                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                            }`}>
                                                {activeCustDoc ? `DOC: ${activeCustDoc}` : 'REGISTRADO'}
                                            </span>
                                        ) : (
                                            <span className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-semibold uppercase border ${
                                                isTitanium
                                                    ? 'bg-[#161C26] border-[#263040] text-[#8B96A8]'
                                                    : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#64748B]'
                                            }`}>
                                                Consumidor Final
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Cabecera Tabular de la Hoja Contable */}
                        <div className={`px-4 sm:px-5 py-2.5 border-b flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-[0.14em] shrink-0 ${
                            isTitanium
                                ? 'bg-[#121720] border-[#212834] text-[#8B96A8]'
                                : 'bg-[#F8FAFC] border-[#D4DCE6] text-[#5A6577]'
                        }`}>
                            <div className="flex items-center gap-2">
                                <span>Detalle de Facturación</span>
                                <span className={`px-1.5 py-0.5 rounded-xs text-[10px] ${
                                    isTitanium ? 'bg-[#1D2532] text-white' : 'bg-[#0B0F17] text-white'
                                }`}>
                                    {cartData.items.length}
                                </span>
                            </div>
                            <span>Importe</span>
                        </div>

                        {/* Lista de Líneas con Auto-Scroll */}
                        <div
                            ref={itemsListRef}
                            className={`flex-1 overflow-y-auto divide-y custom-scrollbar ${
                                isTitanium ? 'divide-[#1C232E]' : 'divide-[#E2E8F0]'
                            }`}
                        >
                            {cartData.items.map((item, idx) => {
                                const isLatest = idx === cartData.items.length - 1;
                                const itemImg = getImageUrl(item.imageUrl);
                                const lineUsd = Number(item.subtotal) || ((Number(item.price) || 0) * (Number(item.quantity) || 0));
                                const lineBs = lineUsd * (cartData.exchangeRate || displayRate || 1);

                                return (
                                    <div
                                        key={`${item.id || idx}_${idx}`}
                                        className={`px-4 sm:px-5 py-3 flex items-center justify-between gap-3 transition-colors relative ${
                                            isLatest
                                                ? isTitanium
                                                    ? 'bg-blue-950/25'
                                                    : 'bg-blue-50/60'
                                                : ''
                                        }`}
                                    >
                                        {isLatest && (
                                            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-600" />
                                        )}

                                        <div className="flex items-center gap-3 min-w-0">
                                            {/* Índice o Miniatura del Producto */}
                                            {itemImg ? (
                                                <div className="w-10 h-10 rounded-xs bg-white border border-slate-200 p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
                                                    <img src={itemImg} alt={item.name} className="w-full h-full object-contain" />
                                                </div>
                                            ) : (
                                                <div className={`w-10 h-10 rounded-xs border flex items-center justify-center font-mono text-xs font-bold shrink-0 ${
                                                    isTitanium
                                                        ? 'bg-[#141A23] border-[#263040] text-[#94A3B8]'
                                                        : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]'
                                                }`}>
                                                    {String(idx + 1).padStart(2, '0')}
                                                </div>
                                            )}

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h4 className="text-sm sm:text-[15px] font-bold leading-snug truncate">
                                                        {item.name}
                                                    </h4>
                                                    {item.presentationName && (
                                                        <span className={`px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase rounded-xs border ${
                                                            isTitanium
                                                                ? 'bg-[#18202C] border-[#2B374A] text-blue-300'
                                                                : 'bg-slate-100 border-slate-300 text-slate-700'
                                                        }`}>
                                                            {item.presentationName}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className={`text-xs font-mono tabular-nums mt-0.5 flex items-center gap-2 ${
                                                    isTitanium ? 'text-[#8B96A8]' : 'text-[#5A6577]'
                                                }`}>
                                                    <span className="font-bold">
                                                        {formatStock(item.quantity)} und
                                                    </span>
                                                    <span>×</span>
                                                    <span>
                                                        {!isUsdOnly
                                                            ? `${formatBs((Number(item.price) || 0) * (cartData.exchangeRate || displayRate || 1))} (${formatUSD(item.price)})`
                                                            : formatUSD(item.price)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-right font-mono tabular-nums shrink-0">
                                            {!isUsdOnly ? (
                                                <>
                                                    <span className="text-base sm:text-lg font-extrabold block leading-tight">
                                                        {formatBs(lineBs)}
                                                    </span>
                                                    <span className={`text-xs font-semibold block ${
                                                        isTitanium ? 'text-[#8B96A8]' : 'text-[#5A6577]'
                                                    }`}>
                                                        {formatUSD(lineUsd)}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="text-base sm:text-lg font-extrabold block">
                                                    {formatUSD(lineUsd)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* CONSOLA FINANCIERA DERECHA: TOTALIZADOR + CANAL DE PAGO ACTIVO / MINI-VITRINA (5 COLUMNAS) */}
                    <section className="lg:col-span-5 flex flex-col gap-3 sm:gap-4 overflow-hidden">
                        {/* Totalizador Monumental */}
                        {(() => {
                            const finalTotalUSD = isCheckoutActive && checkoutPayment.totals?.totalToPayUsd !== undefined
                                ? checkoutPayment.totals.totalToPayUsd
                                : cartData.totalUSD;
                            const finalTotalBs = isCheckoutActive && checkoutPayment.totals?.totalToPayVes !== undefined
                                ? checkoutPayment.totals.totalToPayVes
                                : cartData.totalBs;
                            const hasIgtf = isCheckoutActive && (checkoutPayment.totals?.currentIgtfUsd > 0);
                            const paymentPromo = isCheckoutActive ? checkoutPayment.activePaymentPromo : null;
                            const receivedUsd = isCheckoutActive ? (checkoutPayment.totals?.receivedUsd || 0) : 0;
                            const receivedVes = isCheckoutActive ? (checkoutPayment.totals?.receivedVes || 0) : 0;
                            const changeUsd = isCheckoutActive ? (checkoutPayment.totals?.changeUsd || 0) : 0;
                            const changeBs = isCheckoutActive ? (checkoutPayment.totals?.changeBs || 0) : 0;
                            const remainingUsd = isCheckoutActive ? (checkoutPayment.totals?.remainingUsd || 0) : 0;
                            const remainingBs = isCheckoutActive ? (checkoutPayment.totals?.remainingBs || 0) : 0;
                            const isInsufficient = isCheckoutActive ? checkoutPayment.totals?.isInsufficient : false;

                            return (
                                <div className={`border rounded-md p-5 shrink-0 ${
                                    isSwiss
                                        ? 'bg-[#090D14] border-[#090D14] text-white'
                                        : isTitanium
                                            ? 'bg-[#11161D] border-[#242E3D] text-white'
                                            : 'bg-[#0A0D12] border-[#1E2530] text-white'
                                }`}>
                                    {/* Indicadores de Ofertas o Subtotales */}
                                    {(cartData.discountUSD > 0 || paymentPromo || hasIgtf) && (
                                        <div className="pb-2.5 mb-2.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-300">
                                            {cartData.discountUSD > 0 && (
                                                <span className="text-emerald-400 font-bold">
                                                    DESC: -{!isUsdOnly ? formatBs((cartData.discountUSD || 0) * displayRate) : formatUSD(cartData.discountUSD)}
                                                </span>
                                            )}
                                            {paymentPromo && (
                                                <span className="text-amber-400 font-bold flex items-center gap-1">
                                                    <span>PROMO {paymentPromo.promoName}:</span>
                                                    <span>-{formatUSD(paymentPromo.savings)}</span>
                                                </span>
                                            )}
                                            {hasIgtf && (
                                                <span className="text-sky-400 font-bold">
                                                    +3% IGTF: {formatUSD(checkoutPayment.totals.currentIgtfUsd)}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[10.5px] font-mono font-bold uppercase tracking-[0.16em] text-slate-400 flex items-center gap-1.5">
                                            {isCheckoutActive && checkoutActiveMethod && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            )}
                                            <span>{isCheckoutActive ? 'Total a Percibir' : 'Total a Pagar'}</span>
                                        </span>
                                        {!isUsdOnly && (
                                            <span className="text-[10.5px] font-mono text-slate-400 tabular-nums">
                                                BCV: Bs {rateFormattedClean}
                                            </span>
                                        )}
                                    </div>

                                    {!isUsdOnly ? (
                                        <div className="flex flex-col">
                                            <div className="text-3xl sm:text-5xl font-black font-mono tabular-nums tracking-tight leading-none text-white">
                                                {formatBs(finalTotalBs)}
                                            </div>
                                            <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between font-mono tabular-nums">
                                                <span className="text-[11px] uppercase tracking-wider text-slate-400">
                                                    Equivalente Divisas
                                                </span>
                                                <span className="text-xl sm:text-2xl font-extrabold text-emerald-400">
                                                    {formatUSD(finalTotalUSD)}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-4xl sm:text-5xl font-black font-mono tabular-nums tracking-tight leading-none text-white">
                                            {formatUSD(finalTotalUSD)}
                                        </div>
                                    )}

                                    {/* Placa de Abonos Parciales / Vuelto en Tiempo Real */}
                                    {isCheckoutActive && (receivedUsd > 0 || isSplitActive) && (
                                        <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center justify-between text-xs font-mono tabular-nums">
                                            {isInsufficient ? (
                                                <>
                                                    <span className="text-slate-300">
                                                        ABONADO: <strong className="text-white">{formatUSD(receivedUsd)}</strong>
                                                    </span>
                                                    <span className="text-amber-400 font-bold">
                                                        RESTANTE: {formatUSD(remainingUsd)} ({formatBs(remainingBs)})
                                                    </span>
                                                </>
                                            ) : changeUsd > 0.001 || changeBs > 0.01 ? (
                                                <>
                                                    <span className="text-slate-300">
                                                        RECIBIDO: <strong className="text-white">{formatUSD(receivedUsd)}</strong>
                                                    </span>
                                                    <span className="text-emerald-400 font-black text-sm">
                                                        SU VUELTO: {formatUSD(changeUsd)} ({formatBs(changeBs)})
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                                                        <CheckCircle2 size={13} className="text-emerald-400" />
                                                        PAGO CUBIERTO AL 100%
                                                    </span>
                                                    <span className="text-white font-bold">
                                                        ABONADO: {formatUSD(receivedUsd > 0 ? receivedUsd : finalTotalUSD)} ({formatBs(receivedVes > 0 ? receivedVes : finalTotalBs)})
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Panel Inferior: Canal de Cobro Seleccionado por el Cajero o Vitrina */}
                        {(() => {
                            // CASO ESPECIAL: PAGO MIXTO / MULTICANAL ACTIVO
                            if (isSplitActive) {
                                const totalUsd = checkoutPayment?.totals?.totalToPayUsd ?? (cartData.totalUSD || 0);
                                const totalBs = checkoutPayment?.totals?.totalToPayVes ?? (cartData.totalBs || 0);
                                const receivedUsdVal = checkoutPayment?.totals?.receivedUsd ?? 0;
                                const receivedVesVal = checkoutPayment?.totals?.receivedVes ?? 0;
                                const remUsd = checkoutPayment?.totals?.remainingUsd ?? 0;
                                const remBs = checkoutPayment?.totals?.remainingBs ?? 0;
                                const chgUsd = checkoutPayment?.totals?.changeUsd ?? 0;
                                const chgBs = checkoutPayment?.totals?.changeBs ?? 0;
                                const isInsuff = checkoutPayment?.totals?.isInsufficient ?? false;
                                const pct = totalUsd > 0
                                    ? Math.min(100, Math.max(0, Math.round((receivedUsdVal / totalUsd) * 100)))
                                    : (!isInsuff ? 100 : 0);
                                const debitItem = splitList.find(x => x.isDebit);

                                return (
                                    <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                        {/* Barra Superior Técnica de Pago Mixto */}
                                        <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                            isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                        }`}>
                                            <div className="flex items-center gap-2">
                                                <Layers size={15} className="text-blue-500" />
                                                <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                    Pago Mixto · Abonos Multicanal
                                                </span>
                                            </div>

                                            {/* Badge Dinámico de Estado */}
                                            {!isInsuff ? (
                                                chgUsd > 0.001 || chgBs > 0.01 ? (
                                                    <span className="px-2.5 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-sky-500/15 text-sky-400 rounded-xs border border-sky-500/30 flex items-center gap-1">
                                                        <CheckCircle2 size={11} /> VUELTO: {formatUSD(chgUsd)} ({formatBs(chgBs)})
                                                    </span>
                                                ) : (
                                                    <span className="px-2.5 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-emerald-500/15 text-emerald-400 rounded-xs border border-emerald-500/30 flex items-center gap-1">
                                                        <CheckCircle2 size={11} /> 100% CUBIERTO · SALDADO
                                                    </span>
                                                )
                                            ) : (
                                                <span className="px-2.5 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-amber-500/15 text-amber-400 rounded-xs border border-amber-500/30 flex items-center gap-1">
                                                    <Clock size={11} /> FALTAN: {formatUSD(remUsd)} ({formatBs(remBs)})
                                                </span>
                                            )}
                                        </div>

                                        {/* Contenido Modular: Progreso + Desglose de Abonos */}
                                        <div className="flex-1 p-3.5 flex flex-col gap-3 overflow-hidden">
                                            {/* Placa de Progreso Tabular */}
                                            <div className={`p-2.5 rounded-xs border shrink-0 ${
                                                isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                            }`}>
                                                <div className="flex items-center justify-between text-[10px] font-mono uppercase mb-1.5 opacity-80">
                                                    <span className="flex items-center gap-1.5">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${!isInsuff ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                                                        <span>Cobertura de la cuenta</span>
                                                    </span>
                                                    <span className="font-bold tabular-nums">
                                                        {pct}% ({splitList.length} {splitList.length === 1 ? 'método abonado' : 'métodos abonados'})
                                                    </span>
                                                </div>
                                                <div className="w-full h-2 rounded-full bg-slate-700/30 overflow-hidden">
                                                    <div
                                                        className={`h-full transition-all duration-300 ${
                                                            !isInsuff ? 'bg-emerald-500' : 'bg-amber-500'
                                                        }`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Lista de Abonos Ingresados por el Cajero */}
                                            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                                                {splitList.length === 0 ? (
                                                    <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400">
                                                        <Layers size={28} className="mb-2 opacity-50 text-blue-400" />
                                                        <span className="text-xs font-mono">Esperando abonos en caja...</span>
                                                    </div>
                                                ) : (
                                                    splitList.map((item, idx) => {
                                                        const isDebit = item.isDebit;
                                                        const isPM = item.isPagoMovil;
                                                        const isBin = item.isBinance;
                                                        const isCash = item.isCash;

                                                        return (
                                                            <div
                                                                key={item.id || idx}
                                                                className={`p-2.5 rounded-xs border flex items-center justify-between gap-3 transition-colors ${
                                                                    isTitanium
                                                                        ? 'bg-[#181E29] border-[#2B374A] hover:border-slate-600'
                                                                        : 'bg-white border-[#D4DCE6] shadow-xs'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2.5 min-w-0">
                                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                                                        isBin ? 'bg-amber-500/15 text-amber-500' :
                                                                        isPM ? 'bg-blue-500/15 text-blue-500' :
                                                                        isDebit ? 'bg-sky-500/15 text-sky-400' :
                                                                        isCash ? 'bg-emerald-500/15 text-emerald-400' :
                                                                        'bg-purple-500/15 text-purple-400'
                                                                    }`}>
                                                                        {isBin ? <Wallet size={16} /> :
                                                                         isPM ? <Smartphone size={16} /> :
                                                                         isDebit ? <CreditCard size={16} /> :
                                                                         isCash ? <Banknote size={16} /> :
                                                                         <Send size={15} />}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="text-xs font-bold truncate flex items-center gap-1.5">
                                                                            <span>{item.name}</span>
                                                                            <span className="text-[9px] font-mono font-normal opacity-60">
                                                                                [Abono #{idx + 1}]
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-[10px] font-mono opacity-65 flex items-center gap-2">
                                                                            <span>
                                                                                {item.currency === 'USD'
                                                                                    ? `Equiv: ${formatBs(item.equivBs)}`
                                                                                    : item.currency === 'USDT'
                                                                                    ? `Equiv: ${formatBs(item.equivBs)}`
                                                                                    : `Ref: ${formatUSD(item.equivUsd)}`}
                                                                            </span>
                                                                            {item.reference && (
                                                                                <span className="text-emerald-400 font-bold">Ref: {item.reference}</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="text-right shrink-0 font-mono">
                                                                    <div className="text-sm font-black tabular-nums text-slate-100 dark:text-white">
                                                                        {item.currency === 'USD'
                                                                            ? formatUSD(item.amount)
                                                                            : item.currency === 'USDT'
                                                                            ? `${item.amount.toFixed(2)} USDT`
                                                                            : formatBs(item.amount)}
                                                                    </div>
                                                                    <span className="text-[9px] font-bold text-emerald-400 flex items-center justify-end gap-1">
                                                                        <Check size={10} /> Registrado
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>

                                            {/* Sub-placa informativa de terminal bancario para Punto de Venta */}
                                            {debitItem && (
                                                <div className={`p-2 rounded-xs border flex items-center justify-between gap-2 text-xs font-mono shrink-0 ${
                                                    isTitanium ? 'bg-blue-950/30 border-blue-500/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-900'
                                                }`}>
                                                    <span className="flex items-center gap-1.5 text-[10.5px]">
                                                        <CreditCard size={14} className="text-blue-400" />
                                                        <span>Terminal bancario: Pase o acerque su tarjeta en caja</span>
                                                    </span>
                                                    <span className="font-black tabular-nums text-blue-400">
                                                        {formatBs(debitItem.amount)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            }

                            // SI HAY UN MÉTODO SELECCIONADO POR EL CAJERO EN CHECKOUTMODAL (MODO EXPRESS / INDIVIDUAL)
                            if (isCheckoutActive && checkoutActiveMethod) {
                                const methodId = (checkoutActiveMethod.id || '').toLowerCase();
                                const methodName = (checkoutActiveMethod.name || '').toLowerCase();
                                const methodCurr = (checkoutActiveMethod.currency || '').toUpperCase();

                                // CASO 1: BINANCE PAY (USDT)
                                if (isBinanceActive) {
                                    const fallbackUsd = checkoutPayment?.totals?.totalToPayUsd ?? cartData.totalUSD ?? 0;
                                    const effectiveAmountBs = checkoutActiveMethod.amountBs || checkoutPayment?.totals?.totalToPayVes || cartData.totalBs;
                                    const effectiveUsdt = checkoutActiveMethod.amountUsdt !== undefined && checkoutActiveMethod.amountUsdt !== null
                                        ? Number(checkoutActiveMethod.amountUsdt)
                                        : precisionRound(fallbackUsd, 2);
                                    const payId = checkoutActiveMethod.binancePayId || binanceSettings.payId;
                                    const email = checkoutActiveMethod.binanceEmail || binanceSettings.email;

                                    return (
                                        <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                                isTitanium ? 'bg-[#151208] border-[#362A14]' : 'bg-[#FFFBEB] border-[#FDE68A]'
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    <Wallet size={15} className="text-amber-500" />
                                                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                                                        Binance Pay & Código QR (USDT)
                                                    </span>
                                                </div>
                                                <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-xs border border-amber-500/30">
                                                    RED BEP-20 / PAY ID
                                                </span>
                                            </div>

                                            <div className="flex-1 p-4 flex flex-col sm:flex-row items-center gap-4 overflow-y-auto">
                                                {/* Marco Blanco de Lectura Óptica QR */}
                                                <div className="p-2.5 bg-white rounded border border-slate-300 shrink-0 flex flex-col items-center shadow-xs">
                                                    {generatingBinanceQr ? (
                                                        <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-700 gap-2">
                                                            <Loader2 size={22} className="animate-spin text-amber-600" />
                                                            <span className="text-[9px] font-mono font-bold uppercase">Generando QR</span>
                                                        </div>
                                                    ) : binanceQrUrl ? (
                                                        <img
                                                            src={binanceQrUrl}
                                                            alt="Código QR Binance Pay"
                                                            className="w-32 h-32 sm:w-36 sm:h-36 object-contain"
                                                        />
                                                    ) : (
                                                        <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-400 text-center p-2">
                                                            <Wallet size={22} className="text-amber-500 mb-1" />
                                                            <span className="text-[9.5px] font-mono">Use Binance Pay ID</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Placa Técnica Binance Pay */}
                                                <div className="flex-1 w-full space-y-2 text-xs">
                                                    {payId && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#181E29] border-[#2B374A]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">Binance Pay ID</span>
                                                            <span className="font-mono font-black text-sm tracking-wide text-amber-500">{payId}</span>
                                                        </div>
                                                    )}
                                                    {email && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#181E29] border-[#2B374A]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">Correo Binance</span>
                                                            <span className="font-mono font-bold truncate max-w-[200px]">{email}</span>
                                                        </div>
                                                    )}
                                                    <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                        isTitanium ? 'bg-[#181E29] border-[#2B374A]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                    }`}>
                                                        <span className="text-[10px] font-mono uppercase opacity-65">Paridad Cambiaria</span>
                                                        <span className="font-mono font-bold tabular-nums">1 USDT = $1.00 USD</span>
                                                    </div>

                                                    {/* Monto Exacto en USDT */}
                                                    <div className={`px-3 py-2 rounded-xs border flex items-center justify-between gap-2 ${
                                                        isTitanium
                                                            ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                                                            : 'bg-amber-50 border-amber-300 text-amber-950'
                                                    }`}>
                                                        <div>
                                                            <span className="text-[10px] font-mono font-bold uppercase block">Total a Transferir</span>
                                                            <span className="text-[10px] font-mono opacity-70">
                                                                Equiv: {formatBs(effectiveAmountBs)}
                                                            </span>
                                                        </div>
                                                        <span className="font-mono font-black text-base sm:text-lg tabular-nums text-amber-600 dark:text-amber-400">
                                                            {effectiveUsdt.toFixed(2)} USDT
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // CASO 2: PAGO MÓVIL
                                const isPM = checkoutActiveMethod.isPagoMovil || methodId.includes('movil') || methodName.includes('móvil') || Boolean(checkoutActiveMethod.pagoMovilPhone || checkoutActiveMethod.pagoMovilId);
                                if (isPM) {
                                    const pmBank = checkoutActiveMethod.pagoMovilBank || activeBank;
                                    const pmPhone = checkoutActiveMethod.pagoMovilPhone || activePhone;
                                    const pmId = checkoutActiveMethod.pagoMovilId || activeId;
                                    const pmAmountBs = checkoutActiveMethod.amountBs || cartData.totalBs;

                                    return (
                                        <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                                isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    <QrCode size={15} className="text-blue-600 dark:text-blue-400" />
                                                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                        Pago Móvil Directo
                                                    </span>
                                                </div>
                                                <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600/15 text-blue-600 dark:text-blue-400 rounded-xs border border-blue-600/30">
                                                    BANCA NACIONAL
                                                </span>
                                            </div>

                                            <div className="flex-1 p-4 flex flex-col sm:flex-row items-center gap-4 overflow-y-auto">
                                                <div className="p-2.5 bg-white rounded border border-slate-300 shrink-0 flex flex-col items-center">
                                                    {generatingQr ? (
                                                        <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-700 gap-2">
                                                            <Loader2 size={22} className="animate-spin" />
                                                            <span className="text-[9px] font-mono font-bold uppercase">Generando</span>
                                                        </div>
                                                    ) : qrCodeUrl ? (
                                                        <img
                                                            src={qrCodeUrl}
                                                            alt="QR Pago Móvil"
                                                            className="w-32 h-32 sm:w-36 sm:h-36 object-contain"
                                                        />
                                                    ) : (
                                                        <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-400 text-center p-2">
                                                            <Smartphone size={22} />
                                                            <span className="text-[9px] font-mono mt-1">Datos incompletos</span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex-1 w-full space-y-2 text-xs">
                                                    {pmBank && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">Banco</span>
                                                            <span className="font-bold text-right truncate">{getBankNameByCode(pmBank)}</span>
                                                        </div>
                                                    )}
                                                    {pmId && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">RIF / C.I.</span>
                                                            <span className="font-mono font-bold tabular-nums">{formatIdDisplay(pmId)}</span>
                                                        </div>
                                                    )}
                                                    {pmPhone && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">Teléfono</span>
                                                            <span className="font-mono font-bold tabular-nums">{formatPhoneDisplay(pmPhone)}</span>
                                                        </div>
                                                    )}
                                                    <div className={`px-3 py-2 rounded-xs border flex items-center justify-between gap-2 ${
                                                        isTitanium
                                                            ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                                                            : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                                    }`}>
                                                        <span className="text-[10px] font-mono font-bold uppercase">Monto Exacto</span>
                                                        <span className="font-mono font-black text-sm tabular-nums">
                                                            {formatBs(pmAmountBs)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // CASO 3: PUNTO DE VENTA / DÉBITO
                                if (methodId.includes('debit') || methodId.includes('punto') || methodName.includes('punto') || methodName.includes('débito')) {
                                    const amountBs = checkoutActiveMethod.appliedAmount ? Number(checkoutActiveMethod.appliedAmount) : cartData.totalBs;
                                    return (
                                        <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                                isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    <CreditCard size={15} className="text-blue-500" />
                                                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                        Punto de Venta · Tarjeta de Débito
                                                    </span>
                                                </div>
                                                <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600/15 text-blue-600 dark:text-blue-400 rounded-xs border border-blue-600/30">
                                                    TERMINAL BDV / BANCARIO
                                                </span>
                                            </div>

                                            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                                <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                                    <CreditCard size={32} strokeWidth={2} />
                                                </div>
                                                <div className="space-y-1">
                                                    <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                        Acerque o inserte su tarjeta
                                                    </h3>
                                                    <p className="text-xs opacity-70 max-w-xs font-mono">
                                                        Presente su tarjeta de débito en el terminal de punto de venta en caja.
                                                    </p>
                                                </div>
                                                <div className="mt-2 px-5 py-2.5 bg-blue-500/10 border border-blue-500/30 rounded-md font-mono">
                                                    <span className="text-[10px] uppercase opacity-70 block">Monto a procesar</span>
                                                    <span className="text-xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                                                        {formatBs(amountBs)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // CASO 4: BIOPAGO BDV
                                if (methodId.includes('biopago') || methodName.includes('biopago') || methodName.includes('huella')) {
                                    return (
                                        <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                                isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    <Fingerprint size={15} className="text-emerald-500" />
                                                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                        Biopago BDV · Huella Dactilar
                                                    </span>
                                                </div>
                                                <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 rounded-xs border border-emerald-600/30">
                                                    BIOMÉTRICO
                                                </span>
                                            </div>

                                            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                                    <Fingerprint size={34} strokeWidth={2} />
                                                </div>
                                                <div className="space-y-1">
                                                    <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                        Coloque su huella en el sensor
                                                    </h3>
                                                    <p className="text-xs opacity-70 max-w-xs font-mono">
                                                        Autenticación biométrica rápida sin necesidad de tarjeta plástica.
                                                    </p>
                                                </div>
                                                <div className="mt-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-md font-mono">
                                                    <span className="text-[10px] uppercase opacity-70 block">Monto a autorizar</span>
                                                    <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        {formatBs(cartData.totalBs)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // CASO 5: EFECTIVO ($ O BS)
                                if (checkoutActiveMethod.isCash || methodId.includes('cash') || methodName.includes('efectivo')) {
                                    const isCashUsd = methodCurr === 'USD' || methodId.includes('usd');
                                    return (
                                        <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                                isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    <Banknote size={15} className="text-emerald-500" />
                                                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                        {isCashUsd ? 'Efectivo en Divisas (USD)' : 'Efectivo en Bolívares (VES)'}
                                                    </span>
                                                </div>
                                                <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 rounded-xs border border-emerald-600/30">
                                                    PAGO FÍSICO
                                                </span>
                                            </div>

                                            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                                    <Banknote size={34} strokeWidth={2} />
                                                </div>
                                                <div className="space-y-1">
                                                    <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                        Entrega en ventanilla de caja
                                                    </h3>
                                                    <p className="text-xs opacity-70 max-w-xs font-mono">
                                                        {isCashUsd ? 'Se reciben billetes en buen estado.' : 'Verificación y conteo en caja.'}
                                                    </p>
                                                </div>
                                                <div className="mt-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-md font-mono">
                                                    <span className="text-[10px] uppercase opacity-70 block">Monto a cancelar</span>
                                                    <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        {isCashUsd ? formatUSD(cartData.totalUSD) : formatBs(cartData.totalBs)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // CASO 6: ZELLE / TRANSFERENCIA
                                if (methodId.includes('zelle') || methodId.includes('transfer')) {
                                    return (
                                        <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                                isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    <Send size={15} className="text-purple-500" />
                                                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                        Transferencia / Zelle
                                                    </span>
                                                </div>
                                                <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-purple-600/15 text-purple-600 dark:text-purple-400 rounded-xs border border-purple-600/30">
                                                    ELECTRÓNICO
                                                </span>
                                            </div>

                                            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                                <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                                                    <Send size={30} strokeWidth={2} />
                                                </div>
                                                <div className="space-y-1">
                                                    <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                        Transferencia directa
                                                    </h3>
                                                    <p className="text-xs opacity-70 max-w-xs font-mono">
                                                        Muestre su comprobante al cajero para registrar el número de confirmación.
                                                    </p>
                                                </div>
                                                <div className="mt-2 px-5 py-2.5 bg-purple-500/10 border border-purple-500/30 rounded-md font-mono">
                                                    <span className="text-[10px] uppercase opacity-70 block">Monto a transferir</span>
                                                    <span className="text-xl font-black text-purple-600 dark:text-purple-400 tabular-nums">
                                                        {methodCurr === 'USD' ? formatUSD(cartData.totalUSD) : formatBs(cartData.totalBs)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // CASO GENÉRICO / PAGO MIXTO
                                return (
                                    <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                        <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                            isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                        }`}>
                                            <div className="flex items-center gap-2">
                                                <Layers size={15} className="text-blue-500" />
                                                <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                    {checkoutActiveMethod.name || 'Canal de Pago'}
                                                </span>
                                            </div>
                                            <span className="px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600/15 text-blue-600 dark:text-blue-400 rounded-xs border border-blue-600/30">
                                                SELECCIONADO EN CAJA
                                            </span>
                                        </div>

                                        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
                                            <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                                <Layers size={32} strokeWidth={2} />
                                            </div>
                                            <div className="space-y-1">
                                                <h3 className="text-base font-extrabold uppercase tracking-tight">
                                                    {checkoutActiveMethod.name}
                                                </h3>
                                                <p className="text-xs opacity-70 max-w-xs font-mono">
                                                    Canal de pago activado en la estación del operador.
                                                </p>
                                            </div>
                                            <div className="mt-2 px-5 py-2.5 bg-blue-500/10 border border-blue-500/30 rounded-md font-mono">
                                                <span className="text-[10px] uppercase opacity-70 block">Total a percibir</span>
                                                <span className="text-xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                                                    {formatBs(cartData.totalBs)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            // VISTA POR DEFECTO: SI NO HAY CHECKOUT ACTIVO, MOSTRAR PAGO MÓVIL DIRECTO O VITRINA
                            if (hasPagoMovil) {
                                return (
                                    <div className={`flex-1 border rounded-md flex flex-col overflow-hidden ${stagePanelStyle}`}>
                                        {/* Barra de cabecera Pago Móvil + Selector de cuentas o Vitrina */}
                                        <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                                            isTitanium ? 'bg-[#121720] border-[#212834]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                        }`}>
                                            <div className="flex items-center gap-2">
                                                <QrCode size={15} className="text-blue-600 dark:text-blue-400" />
                                                <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                                                    {checkoutRightTab === 'qr' ? 'Pago Móvil Directo' : 'Oferta Destacada'}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1">
                                                {pagoMovilMethods.length > 1 && checkoutRightTab === 'qr' && (
                                                    <div className="flex items-center gap-1 mr-1">
                                                        {pagoMovilMethods.map(m => (
                                                            <button
                                                                key={m.id}
                                                                type="button"
                                                                onClick={() => setSelectedMethodId(m.id)}
                                                                className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-xs border cursor-pointer ${
                                                                    selectedMethodId === m.id
                                                                        ? 'bg-blue-600 text-white border-blue-600'
                                                                        : isTitanium
                                                                            ? 'border-[#263040] text-slate-400'
                                                                            : 'border-slate-300 text-slate-600 bg-white'
                                                                }`}
                                                            >
                                                                {m.name || 'PM'}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                {playlist.length > 0 && (
                                                    <div className={`flex items-center p-0.5 rounded-xs border text-[10px] font-mono font-bold ${
                                                        isTitanium ? 'border-[#263040] bg-[#0B0E13]' : 'border-slate-300 bg-white'
                                                    }`}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCheckoutRightTab('qr')}
                                                            className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                                                                checkoutRightTab === 'qr' ? 'bg-blue-600 text-white' : 'opacity-65'
                                                            }`}
                                                        >
                                                            QR
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCheckoutRightTab('promo')}
                                                            className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                                                                checkoutRightTab === 'promo' ? 'bg-blue-600 text-white' : 'opacity-65'
                                                            }`}
                                                        >
                                                            INFO
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {checkoutRightTab === 'qr' ? (
                                            <div className="flex-1 p-4 flex flex-col sm:flex-row items-center gap-4 overflow-y-auto">
                                                {/* Marco Blanco Puro de Lectura Óptica QR */}
                                                <div className="p-2.5 bg-white rounded border border-slate-300 shrink-0 flex flex-col items-center">
                                                    {generatingQr ? (
                                                        <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-700 gap-2">
                                                            <Loader2 size={22} className="animate-spin" />
                                                            <span className="text-[9px] font-mono font-bold uppercase">Generando</span>
                                                        </div>
                                                    ) : qrCodeUrl ? (
                                                        <img
                                                            src={qrCodeUrl}
                                                            alt="QR Pago Móvil"
                                                            className="w-32 h-32 sm:w-36 sm:h-36 object-contain"
                                                        />
                                                    ) : (
                                                        <div className="w-32 h-32 sm:w-36 sm:h-36 flex flex-col items-center justify-center text-slate-400 text-center p-2">
                                                            <Smartphone size={22} />
                                                            <span className="text-[9px] font-mono mt-1">Datos incompletos</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Datos Bancarios Tabulares */}
                                                <div className="flex-1 w-full space-y-2 text-xs">
                                                    {activeBank && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">Banco</span>
                                                            <span className="font-bold text-right truncate">{getBankNameByCode(activeBank)}</span>
                                                        </div>
                                                    )}
                                                    {activeId && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">RIF / C.I.</span>
                                                            <span className="font-mono font-bold tabular-nums">{formatIdDisplay(activeId)}</span>
                                                        </div>
                                                    )}
                                                    {activePhone && (
                                                        <div className={`px-3 py-1.5 rounded-xs border flex items-center justify-between gap-2 ${
                                                            isTitanium ? 'bg-[#141A23] border-[#242E3D]' : 'bg-[#F8FAFC] border-[#D4DCE6]'
                                                        }`}>
                                                            <span className="text-[10px] font-mono uppercase opacity-65">Teléfono</span>
                                                            <span className="font-mono font-bold tabular-nums">{formatPhoneDisplay(activePhone)}</span>
                                                        </div>
                                                    )}
                                                    <div className={`px-3 py-2 rounded-xs border flex items-center justify-between gap-2 ${
                                                        isTitanium
                                                            ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                                                            : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                                    }`}>
                                                        <span className="text-[10px] font-mono font-bold uppercase">Monto Exacto</span>
                                                        <span className="font-mono font-black text-sm tabular-nums">
                                                            {formatBs(cartData.totalBs)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : activeSlide ? (
                                            <div className="flex-1 p-4 flex items-center gap-4 overflow-hidden">
                                                {activeSlide.imageUrl && (
                                                    <div className="w-24 h-24 rounded bg-white border border-slate-200 p-1 shrink-0 flex items-center justify-center overflow-hidden">
                                                        <img src={activeSlide.imageUrl} alt={activeSlide.title} className="w-full h-full object-contain" />
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    {activeSlide.badge && (
                                                        <span className="inline-block px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600 text-white rounded-xs mb-1">
                                                            {activeSlide.badge}
                                                        </span>
                                                    )}
                                                    <h4 className="text-sm font-extrabold truncate">{activeSlide.title || bizSettings.name}</h4>
                                                    {activeSlide.priceUSD !== null && activeSlide.priceUSD > 0 && (
                                                        <div className="mt-1 font-mono font-black text-base tabular-nums">
                                                            {formatBs(activeSlide.priceUSD * displayRate)}{' '}
                                                            <span className="text-xs font-semibold opacity-65">({formatUSD(activeSlide.priceUSD)})</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            }

                            if (activeSlide) {
                                return (
                                    <div className={`flex-1 border rounded-md p-4 flex items-center gap-4 overflow-hidden ${stagePanelStyle}`}>
                                        {activeSlide.imageUrl && (
                                            <div className="w-28 h-28 rounded bg-white border border-slate-200 p-1.5 shrink-0 flex items-center justify-center overflow-hidden">
                                                <img src={activeSlide.imageUrl} alt={activeSlide.title} className="w-full h-full object-contain" />
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <span className="inline-block px-2 py-0.5 text-[9.5px] font-mono font-bold uppercase bg-blue-600 text-white rounded-xs">
                                                {activeSlide.badge || 'DESTACADO'}
                                            </span>
                                            <h4 className="text-base font-extrabold line-clamp-2">{activeSlide.title || bizSettings.name}</h4>
                                            {activeSlide.subtitle && (
                                                <p className="text-xs opacity-70 line-clamp-2">{activeSlide.subtitle}</p>
                                            )}
                                            {activeSlide.priceUSD !== null && activeSlide.priceUSD > 0 && (
                                                <div className="pt-1 font-mono font-black text-lg tabular-nums">
                                                    {!isUsdOnly ? formatBs(activeSlide.priceUSD * displayRate) : formatUSD(activeSlide.priceUSD)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            }

                            return null;
                        })()}
                    </section>
                </main>
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
