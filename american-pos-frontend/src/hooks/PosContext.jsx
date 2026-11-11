import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { db } from '../services/db';
import { isDollarOnlyCountry, isUsdOnlyMode } from '../utils/format';
import { evaluateCartPromotions } from '../utils/promotionsEngine';

const PosContext = globalThis.__ISAAC_POS_CONTEXT__ || (globalThis.__ISAAC_POS_CONTEXT__ = createContext());

const INITIAL_STATE = {
    cart: [],
    selectedCustomer: '',
    selectedCustomerInfo: null,
    discountActive: 0
};

export function PosProvider({ children }) {
    const { user } = useAuth();
    const isReady = useRef(false);
    const [isHydrating, setIsHydrating] = useState(true);

    const [posState, setPosState] = useState(INITIAL_STATE);
    const [searchTerm, setSearchTerm] = useState('');
    const [heldSales, setHeldSales] = useState([]);
    const [country, setCountry] = useState(() => localStorage.getItem('pos_country') || 'Venezuela');

    // Motor de Promociones y Combos en Tiempo Real
    const [activePromotions, setActivePromotions] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pos_active_promotions') || '[]');
        } catch {
            return [];
        }
    });
    const isDollarCountry = isDollarOnlyCountry(country);

    const [exchangeRate, setExchangeRate] = useState(() => {
        if (isDollarCountry) return 1;
        const saved = localStorage.getItem('pos_exchange_rate');
        return saved ? Number(saved) : 1;
    });
    const [currencyMode, setCurrencyMode] = useState(() => {
        if (isDollarCountry) return 'USD';
        return localStorage.getItem('pos_currency_mode') || 'VES';
    });
    const [businessMode, setBusinessMode] = useState(() => localStorage.getItem('pos_business_mode') || 'STANDARD');
    const [globalSettings, setGlobalSettings] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pos_global_settings') || '{}');
        } catch {
            return {};
        }
    });
    const { socket } = useSocket();

    useEffect(() => {
        const handleModeChange = () => {
            setBusinessMode(localStorage.getItem('pos_business_mode') || 'STANDARD');
        };
        window.addEventListener('business_mode_changed', handleModeChange);

        api.get('/settings/business').then(res => {
            if (res.data && res.data.businessMode) {
                localStorage.setItem('pos_business_mode', res.data.businessMode);
                if (res.data.country) {
                    localStorage.setItem('pos_country', res.data.country);
                    setCountry(res.data.country);
                }
                setBusinessMode(res.data.businessMode);
            }
        }).catch(err => {
            const cached = localStorage.getItem('pos_business_mode') || 'STANDARD';
            setBusinessMode(cached);
        });

        return () => window.removeEventListener('business_mode_changed', handleModeChange);
    }, []);

    const refreshActivePromotions = useCallback(async () => {
        if (!localStorage.getItem('auth_token')) return;
        try {
            const { data } = await api.get('/promotions/active');
            if (data.success && Array.isArray(data.promotions)) {
                setActivePromotions(data.promotions);
                localStorage.setItem('pos_active_promotions', JSON.stringify(data.promotions));
            }
        } catch (err) {
            console.warn('[POS] Error al consultar promociones activas (usando cache local):', err.message);
        }
    }, []);

    useEffect(() => {
        refreshActivePromotions();
        if (socket) {
            socket.on('promotions_updated', refreshActivePromotions);
            return () => socket.off('promotions_updated', refreshActivePromotions);
        }
    }, [socket, refreshActivePromotions]);

    // Evaluación automática instantánea de promociones en carrito (0ms)
    const promoEvaluation = useMemo(() => {
        return evaluateCartPromotions(posState.cart || [], activePromotions);
    }, [posState.cart, activePromotions]);

    const isElectronEnv = typeof window !== 'undefined' && (!!window.electronAPI || (navigator?.userAgent && navigator.userAgent.includes('Electron')));

    const resolveStationHardwareInfo = () => {
        const savedServerIp = typeof window !== 'undefined'
            ? (localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip') || '').replace(/^https?:\/\//, '').split(':')[0].trim()
            : '';
        const hasRemoteServerIp = Boolean(savedServerIp && savedServerIp !== '127.0.0.1' && savedServerIp !== 'localhost');
        const isClientRole = typeof window !== 'undefined' && (
            localStorage.getItem('isaac_pos_node_role') === 'client' ||
            hasRemoteServerIp ||
            (window.location?.hostname && !['localhost', '127.0.0.1'].includes(window.location.hostname))
        );
        const termId = typeof window !== 'undefined' ? (localStorage.getItem('isaac_pos_terminal_id') || '') : '';
        try {
            if (typeof window !== 'undefined' && window.electronAPI) {
                if (typeof window.electronAPI.getStationIdentity === 'function') {
                    const identity = window.electronAPI.getStationIdentity();
                    if (identity && typeof identity === 'object') {
                        return {
                            hwid: identity.hwid || termId || '',
                            hostname: identity.hostname || '',
                            mode: (identity.mode === 'client' || isClientRole) ? 'client' : 'server'
                        };
                    }
                }
                if (typeof window.electronAPI.getMachineId === 'function') {
                    const hwid = window.electronAPI.getMachineId();
                    if (hwid) return { hwid: String(hwid), hostname: '', mode: isClientRole ? 'client' : 'server' };
                }
            }
        } catch (_) {}
        return { hwid: termId, hostname: typeof window !== 'undefined' ? (window.location?.hostname || '') : '', mode: isClientRole ? 'client' : 'server' };
    };

    const computeDeterministicDeviceCode = (seedStr) => {
        const str = String(seedStr || '');
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
    };

    const [registerId, setRegisterId] = useState(() => {
        const stationHw = resolveStationHardwareInfo();
        const isSecondaryClient = stationHw.mode === 'client' || (typeof window !== 'undefined' && window.location?.hostname && !['localhost', '127.0.0.1'].includes(window.location.hostname));
        const savedBoundHwid = localStorage.getItem('pos_bound_hwid') || '';
        const isIsolatedV2 = localStorage.getItem('pos_station_hw_isolated_v2') === 'true';

        let id = localStorage.getItem('pos_device_id');

        // Si es una caja secundaria (Cliente LAN) que aún no había sido aislada de la clonación de turno,
        // o si el HWID de esta máquina física cambió respecto al guardado, asignar un ID único propio de esta estación
        if (
            !id ||
            id === 'DEV-YKXNRG' ||
            id === 'DEV-APP-02' ||
            (isSecondaryClient && !isIsolatedV2) ||
            (stationHw.hwid && savedBoundHwid && savedBoundHwid !== stationHw.hwid)
        ) {
            const seed = stationHw.hwid
                ? `${stationHw.hwid}_${isSecondaryClient ? 'CLIENT' : 'STATION'}`
                : `${stationHw.hostname || 'TERM'}_${Math.random().toString(36).substring(2, 8)}`;
            const candidateId = stationHw.hwid
                ? `DEV-${computeDeterministicDeviceCode(seed)}`
                : `DEV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            id = (isSecondaryClient && candidateId === id)
                ? `DEV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
                : candidateId;
            localStorage.setItem('pos_device_id', id);
        }

        if (stationHw.hwid) {
            localStorage.setItem('pos_bound_hwid', stationHw.hwid);
        }
        localStorage.setItem('pos_station_hw_isolated_v2', 'true');
        return id;
    });

    const [registerDisplayName, setRegisterDisplayName] = useState(() => {
        const stationHw = resolveStationHardwareInfo();
        const isSecondaryClient = stationHw.mode === 'client' || (typeof window !== 'undefined' && window.location?.hostname && !['localhost', '127.0.0.1'].includes(window.location.hostname));
        const isNameIsolatedV2 = localStorage.getItem('pos_register_name_isolated_v2') === 'true';
        let name = (localStorage.getItem('pos_register_name') || '').trim();

        // Si es una terminal secundaria y tenía "Caja 1" auto-asignado por el bug anterior, separar a "Caja 2"
        if (isSecondaryClient && !isNameIsolatedV2 && (name === 'Caja 1' || name === 'Caja Principal')) {
            name = 'Caja 2';
            localStorage.setItem('pos_register_name', name);
        }
        localStorage.setItem('pos_register_name_isolated_v2', 'true');
        return name;
    });
    const [posViewMode, setPosViewMode] = useState(() => {
        if (localStorage.getItem('pos_view_mode') === 'EXPERT') {
            localStorage.setItem('pos_view_mode', 'NORMAL');
        }
        return 'NORMAL';
    });

    // 🎯 Categorías permitidas para esta terminal / máquina (Modo Estación)
    const [allowedCategories, setAllowedCategoriesState] = useState(() => {
        try {
            const raw = localStorage.getItem('pos_allowed_categories');
            if (raw) {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {
            console.warn('[POS] Error al parsear pos_allowed_categories:', e);
        }
        return [];
    });

    const setAllowedCategories = useCallback((categories) => {
        const list = Array.isArray(categories) ? categories.filter(Boolean) : [];
        setAllowedCategoriesState(list);
        try {
            localStorage.setItem('pos_allowed_categories', JSON.stringify(list));
        } catch (e) {
            console.error('[POS] Error al guardar pos_allowed_categories:', e);
        }
    }, []);

    // 🎯 Productos específicos permitidos para esta terminal / máquina (Modo Estación Multiproducto)
    const [allowedProducts, setAllowedProductsState] = useState(() => {
        try {
            const raw = localStorage.getItem('pos_allowed_products');
            if (raw) {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {
            console.warn('[POS] Error al parsear pos_allowed_products:', e);
        }
        return [];
    });

    const setAllowedProducts = useCallback((products) => {
        const list = Array.isArray(products) ? products.filter(Boolean) : [];
        setAllowedProductsState(list);
        try {
            localStorage.setItem('pos_allowed_products', JSON.stringify(list));
        } catch (e) {
            console.error('[POS] Error al guardar pos_allowed_products:', e);
        }
    }, []);

    // Garantizar aislamiento de identidad por estación física (sin sobrescribir por usuario logueado)
    useEffect(() => {
        let active = true;
        if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.getDbConfig === 'function') {
            window.electronAPI.getDbConfig().then((cfg) => {
                if (!active || !cfg) return;
                if (cfg.mode === 'client') {
                    const alreadyClientIsolated = localStorage.getItem('pos_client_mode_isolated_v2') === 'true';
                    if (!alreadyClientIsolated) {
                        const hwid = window.electronAPI.getMachineId ? window.electronAPI.getMachineId() : '';
                        const newDevId = hwid
                            ? `DEV-${computeDeterministicDeviceCode(hwid + '_CLIENT_NODE')}`
                            : `DEV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                        setRegisterId(newDevId);
                        localStorage.setItem('pos_device_id', newDevId);
                        if (!registerDisplayName || registerDisplayName === 'Caja 1' || registerDisplayName === 'Caja Principal') {
                            setRegisterDisplayName('Caja 2');
                            localStorage.setItem('pos_register_name', 'Caja 2');
                        }
                        localStorage.setItem('pos_client_mode_isolated_v2', 'true');
                    }
                } else {
                    localStorage.setItem('pos_client_mode_isolated_v2', 'true');
                }
            }).catch(() => {});
        }
        return () => { active = false; };
    }, []);

    // Async Hydration from IndexedDB
    useEffect(() => {
        const hydrate = async () => {
            try {
                // Priority: Active Session
                const sessionDoc = await db.getById('metadata', 'pos_active_session');
                if (sessionDoc && sessionDoc.value) {
                    const data = sessionDoc.value;
                    if (data && typeof data === 'object') {
                        if (!Array.isArray(data.cart)) data.cart = [];
                        setPosState(data);
                    }
                }
                
                // Background: Held Sales
                db.getById('metadata', 'pos_held_sales').then(doc => {
                    if (doc && Array.isArray(doc.value)) {
                        setHeldSales(doc.value);
                    }
                });

                // Fallback check for offline exchange rate in IndexedDB if localStorage was wiped
                const rateDoc = await db.getById('metadata', 'pos_exchange_rate');
                if (rateDoc && rateDoc.value && (!localStorage.getItem('pos_exchange_rate') || Number(localStorage.getItem('pos_exchange_rate')) === 1)) {
                    setExchangeRate(Number(rateDoc.value));
                    localStorage.setItem('pos_exchange_rate', String(rateDoc.value));
                }
            } catch (e) {
                console.error("📦 PosContext: Error hydrating from IndexedDB:", e);
            } finally {
                setIsHydrating(false);
                isReady.current = true;
            }
        };
        hydrate();
    }, []);

    // Sincronización Real-time via Sockets
    useEffect(() => {
        if (!socket) return;

        const handleSettingsChange = (data) => {
            if (data && data.type === 'rate') {
                console.log('🔄 POS: Actualización de tasa recibida via socket:', data);
                setExchangeRate(data.exchangeRate);
                setCurrencyMode(data.currencyMode);
                localStorage.setItem('pos_exchange_rate', String(data.exchangeRate));
                localStorage.setItem('pos_currency_mode', data.currencyMode);
                const newSettings = { rate: data.exchangeRate, currencyMode: data.currencyMode };
                setGlobalSettings(newSettings);
                localStorage.setItem('pos_global_settings', JSON.stringify(newSettings));
                try { db.put('metadata', { key: 'pos_exchange_rate', value: data.exchangeRate }); } catch (_e) {}

                if (data.currencyMode !== 'SINGLE') {
                    toast.success(`Tasa de cambio actualizada: ${data.exchangeRate}`, {
                        id: 'rate-update-toast',
                        icon: '💱',
                        style: {
                            borderRadius: '1rem',
                            background: '#1e293b',
                            color: '#fff',
                            border: '1px solid rgba(16, 185, 129, 0.4)'
                        }
                    });
                }
            }
            if (data && data.type === 'region') {
                console.log('🌎 POS: Cambio de región recibido via socket:', data);
                setExchangeRate(data.exchangeRate);
                setCurrencyMode(data.currencyMode);
                setCountry(data.country);
                localStorage.setItem('pos_exchange_rate', String(data.exchangeRate));
                localStorage.setItem('pos_currency_mode', data.currencyMode);
                localStorage.setItem('pos_country', data.country);
                const newSettings = { rate: data.exchangeRate, currencyMode: data.currencyMode, country: data.country };
                setGlobalSettings(newSettings);
                localStorage.setItem('pos_global_settings', JSON.stringify(newSettings));
                try { db.put('metadata', { key: 'pos_exchange_rate', value: data.exchangeRate }); } catch (_e) {}

                toast.success(`Región actualizada: ${data.country?.toUpperCase()}`, {
                    id: 'region-update-toast',
                    icon: '🌎',
                    duration: 4000
                });
                // Force page reload to apply all regional changes
                setTimeout(() => window.location.reload(), 2000);
            }
        };

        socket.on('settings_changed', handleSettingsChange);
        return () => socket.off('settings_changed', handleSettingsChange);
    }, [socket]);

    const seenRemoteSalesRef = useRef(new Set());

    const formatIncomingRemoteSale = useCallback((remoteSale) => {
        const custName = remoteSale.customer?.name || remoteSale.customerName || 'Consumidor Final';
        const custDoc = remoteSale.customer?.doc || remoteSale.customer?.idDocument || remoteSale.customer?.identification || remoteSale.customerDoc || '';
        const custId = remoteSale.customer?.id || remoteSale.customerId || null;
        const customerObj = remoteSale.customer || {
            id: custId,
            name: custName,
            doc: custDoc,
            idDocument: custDoc,
            documentId: custDoc,
            identification: custDoc
        };

        return {
            id: remoteSale.id || `remote_${Date.now()}`,
            code: remoteSale.code || `PV-${Math.floor(100 + Math.random() * 900)}`,
            type: 'remote_preventa',
            source: remoteSale.source || 'Móvil',
            sellerName: remoteSale.sellerName || 'Vendedor Móvil',
            table: remoteSale.table || remoteSale.tableNumber || null,
            orderNotes: remoteSale.orderNotes || '',
            timestamp: remoteSale.timestamp || Date.now(),
            date: remoteSale.date || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            customerId: custId,
            customerName: custName,
            customerDoc: custDoc,
            customer: customerObj,
            items: remoteSale.items,
            totalUSD: Number(remoteSale.totalUSD || 0),
            totalBS: Number(remoteSale.totalBS || 0),
            discount: remoteSale.discount || 0,
            note: (remoteSale.note && !remoteSale.note.includes('📱 Preventa')) ? remoteSale.note : (remoteSale.table ? `🍽️ ${remoteSale.table}` : '')
        };
    }, []);

    // Hidratar preventas remotas activas del servidor al iniciar o reconectar
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        api.get('/sales/remote-held-sales', { timeout: 4000 })
            .then(res => {
                if (cancelled) return;
                const list = res.data?.sales;
                if (!Array.isArray(list) || list.length === 0) return;
                setHeldSales(prev => {
                    const existingIds = new Set(prev.map(s => String(s.id)));
                    const existingCodes = new Set(prev.map(s => String(s.code || '').toUpperCase()).filter(Boolean));
                    const fresh = [];
                    for (const rs of list) {
                        if (!rs || !Array.isArray(rs.items) || rs.items.length === 0) continue;
                        const idKey = String(rs.id);
                        const codeKey = String(rs.code || '').toUpperCase();
                        seenRemoteSalesRef.current.add(idKey);
                        if (!existingIds.has(idKey) && (!codeKey || !existingCodes.has(codeKey))) {
                            fresh.push(formatIncomingRemoteSale(rs));
                        }
                    }
                    if (fresh.length === 0) return prev;
                    const updated = [...fresh, ...prev];
                    db.put('metadata', { key: 'pos_held_sales', value: updated }).catch(() => {});
                    try { localStorage.setItem('pos_held_sales', JSON.stringify(updated)); } catch (_) {}
                    return updated;
                });
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [user, socket?.connected, formatIncomingRemoteSale]);

    // 📱 Recepción en Tiempo Real de Preventas despachadas desde Terminales Móviles hacia Caja Principal
    useEffect(() => {
        if (!socket) return;

        const handleRemoteHeldSale = (remoteSale) => {
            if (!remoteSale || !Array.isArray(remoteSale.items) || remoteSale.items.length === 0) return;
            const saleId = String(remoteSale.id || remoteSale.code || '');
            if (saleId && seenRemoteSalesRef.current.has(saleId)) return;
            if (saleId) seenRemoteSalesRef.current.add(saleId);

            setHeldSales(prev => {
                if (prev.some(s => String(s.id) === saleId || (remoteSale.code && String(s.code || '').toUpperCase() === String(remoteSale.code).toUpperCase()))) {
                    return prev;
                }
                const formattedSale = formatIncomingRemoteSale(remoteSale);
                const updated = [formattedSale, ...prev];
                db.put('metadata', { key: 'pos_held_sales', value: updated }).catch(() => {});
                try { localStorage.setItem('pos_held_sales', JSON.stringify(updated)); } catch (_) {}
                return updated;
            });

            const tableMsg = remoteSale.table ? ` [${remoteSale.table}]` : '';
            toast.success(`📥 ¡Nueva ${remoteSale.table ? 'Comanda' : 'Preventa'} Móvil! Ticket ${remoteSale.code || ''}${tableMsg} ($${Number(remoteSale.totalUSD || 0).toFixed(2)}) por ${remoteSale.sellerName || 'Vendedor'}`, {
                id: `preventa-${remoteSale.id || Date.now()}`,
                duration: 6000,
                icon: '📱',
                style: {
                    borderRadius: '1rem',
                    background: '#1e1b4b',
                    color: '#e0e7ff',
                    border: '1px solid rgba(99, 102, 241, 0.5)'
                }
            });

            try {
                const audio = new Audio('/sounds/beep.mp3');
                audio.play().catch(() => {});
            } catch (_) {}
        };

        const handleRemoteHeldSaleClaimed = (claimInfo) => {
            if (!claimInfo) return;
            const targetId = claimInfo.id ? String(claimInfo.id) : null;
            const targetCode = claimInfo.code ? String(claimInfo.code).toUpperCase() : null;
            setHeldSales(prev => {
                const next = prev.filter(s => {
                    if (targetId && String(s.id) === targetId) return false;
                    if (targetCode && String(s.code || '').toUpperCase() === targetCode) return false;
                    return true;
                });
                if (next.length === prev.length) return prev;
                db.put('metadata', { key: 'pos_held_sales', value: next }).catch(() => {});
                try { localStorage.setItem('pos_held_sales', JSON.stringify(next)); } catch (_) {}
                return next;
            });
        };

        socket.on('remote_held_sale', handleRemoteHeldSale);
        socket.on('remote_held_sale_claimed', handleRemoteHeldSaleClaimed);
        return () => {
            socket.off('remote_held_sale', handleRemoteHeldSale);
            socket.off('remote_held_sale_claimed', handleRemoteHeldSaleClaimed);
        };
    }, [socket, formatIncomingRemoteSale]);

    const fetchExchangeRate = useCallback(async () => {
        try {
            const [rateRes, bizRes] = await Promise.all([
                api.get('/settings/rate').catch(() => null),
                api.get('/settings/business').catch(() => null)
            ]);
            if (rateRes && rateRes.data) {
                const newCountry = bizRes?.data?.country || '';
                const isDollar = isDollarOnlyCountry(newCountry);
                const newRate = isDollar ? 1 : (rateRes.data.rate || 1);
                const newMode = isDollar ? 'USD' : (rateRes.data.currencyMode || 'BOTH');
                setExchangeRate(newRate);
                setCurrencyMode(newMode);
                localStorage.setItem('pos_exchange_rate', String(newRate));
                localStorage.setItem('pos_currency_mode', newMode);
                if (newCountry) {
                    setCountry(newCountry);
                    localStorage.setItem('pos_country', newCountry);
                }
                if (bizRes?.data?.businessMode) {
                    setBusinessMode(bizRes.data.businessMode);
                    localStorage.setItem('pos_business_mode', bizRes.data.businessMode);
                }
                const newSettings = { rate: newRate, currencyMode: newMode, country: newCountry, businessInfo: bizRes?.data };
                setGlobalSettings(newSettings);
                localStorage.setItem('pos_global_settings', JSON.stringify(newSettings));
                try { db.put('metadata', { key: 'pos_exchange_rate', value: newRate }); } catch (_e) {}
            } else {
                // Servidor local no disponible (Ej: teléfono en Internet/Datos Móviles). Consultar Supabase Cloud 24/7
                let cloudLoaded = false;
                try {
                    const cloudRes = await fetch('https://puvqiipussyktfmgafgv.supabase.co/rest/v1/cloud_configuracion?id=eq.general&select=*', {
                        headers: {
                            'apikey': 'sb_publishable_qphH7VeJGgcTsgMp6NZjDw_zmGnOAi6',
                            'Authorization': 'Bearer sb_publishable_qphH7VeJGgcTsgMp6NZjDw_zmGnOAi6'
                        }
                    });
                    if (cloudRes.ok) {
                        const cloudRows = await cloudRes.json();
                        if (Array.isArray(cloudRows) && cloudRows.length > 0 && cloudRows[0].tasa_cambio) {
                            const cfg = cloudRows[0];
                            const cloudRate = Number(cfg.tasa_cambio);
                            const cloudMode = cfg.modo_moneda || 'BOTH';
                            setExchangeRate(cloudRate);
                            setCurrencyMode(cloudMode);
                            localStorage.setItem('pos_exchange_rate', String(cloudRate));
                            localStorage.setItem('pos_currency_mode', cloudMode);
                            try { db.put('metadata', { key: 'pos_exchange_rate', value: cloudRate }); } catch (_e) {}
                            cloudLoaded = true;
                            console.log(`[PosContext] ☁️ Tasa sincronizada desde Supabase Cloud 24/7: ${cloudRate} Bs/$`);
                        }
                    }
                } catch (cloudErr) {
                    console.warn('[PosContext] Cloud rate fetch error:', cloudErr?.message || cloudErr);
                }

                if (!cloudLoaded) {
                    // Offline fallback: restore from localStorage
                    const savedCountry = localStorage.getItem('pos_country') || '';
                    const isDollar = isDollarOnlyCountry(savedCountry);
                    const savedRate = isDollar ? 1 : Number(localStorage.getItem('pos_exchange_rate'));
                    if (savedRate && !isNaN(savedRate)) setExchangeRate(savedRate);
                    const savedMode = isDollar ? 'USD' : localStorage.getItem('pos_currency_mode');
                    if (savedMode) setCurrencyMode(savedMode);
                }
            }
        } catch (error) {
            console.error("Error fetching exchange rate:", error);
            const savedRate = Number(localStorage.getItem('pos_exchange_rate'));
            if (savedRate && !isNaN(savedRate)) setExchangeRate(savedRate);
        }
    }, []);

    const [isShiftOpen, setIsShiftOpen] = useState(false);
    const [currentShift, setCurrentShift] = useState(null);

    const promptOpenCashShift = useCallback(() => {
        toast.error('⚠️ CAJA CERRADA: Debes abrir el turno de caja antes de realizar una venta.', { id: 'caja-cerrada-toast', duration: 4000 });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('open_cash_modal'));
        }
    }, []);

    const fetchShiftStatus = useCallback(async () => {
        try {
            const response = await api.get(`/cash/current?registerId=${registerId}`);
            const shiftData = response.data || null;
            setCurrentShift(shiftData);
            setIsShiftOpen(!!shiftData);
        } catch (error) {
            console.error("Error fetching shift status:", error);
            setIsShiftOpen(false);
            setCurrentShift(null);
        }
    }, [registerId]);

    useEffect(() => {
        const handleShiftChanged = (e) => {
            if (e && e.detail && typeof e.detail.isOpen === 'boolean') {
                setIsShiftOpen(e.detail.isOpen);
                setCurrentShift(e.detail.shift || null);
            } else {
                fetchShiftStatus();
            }
        };
        window.addEventListener('shift_status_changed', handleShiftChanged);
        return () => window.removeEventListener('shift_status_changed', handleShiftChanged);
    }, [fetchShiftStatus]);

    useEffect(() => {
        if (registerDisplayName) {
            localStorage.setItem('pos_register_name', registerDisplayName);
        }
    }, [registerDisplayName]);

    useEffect(() => {
        localStorage.setItem('pos_view_mode', posViewMode);
    }, [posViewMode]);

    useEffect(() => {
        if (!user) return;
        
        fetchExchangeRate();
        fetchShiftStatus();
        
        let lastFetch = Date.now();
        const handleWakeUp = () => {
            const now = Date.now();
            if (now - lastFetch > 10000 && (document.visibilityState === 'visible' || document.hasFocus())) {
                lastFetch = now;
                fetchExchangeRate();
            }
        };
        window.addEventListener('focus', handleWakeUp);
        document.addEventListener('visibilitychange', handleWakeUp);
        return () => {
            window.removeEventListener('focus', handleWakeUp);
            document.removeEventListener('visibilitychange', handleWakeUp);
        };
    }, [fetchExchangeRate, fetchShiftStatus, user]);

    useEffect(() => {
        const handlePosDataSynced = () => {
            fetchExchangeRate();
            fetchShiftStatus();
        };

        const handleRateUpdated = (e) => {
            if (e?.detail?.rate) {
                const newRate = Number(e.detail.rate);
                if (!isNaN(newRate) && newRate > 0) {
                    setExchangeRate(newRate);
                    if (e.detail.mode) setCurrencyMode(e.detail.mode);
                    console.log(`[PosContext] ⚡ Tasa actualizada al instante: ${newRate} Bs/$`);
                }
            }
        };

        window.addEventListener('pos-data-synced', handlePosDataSynced);
        window.addEventListener('pos-exchange-rate-updated', handleRateUpdated);

        // Polling de tasa en la nube si estamos desconectados del socket local (modo Internet / 4G)
        const cloudInterval = setInterval(() => {
            if (!socket || !socket.connected) {
                fetchExchangeRate();
            }
        }, 15000);

        return () => {
            window.removeEventListener('pos-data-synced', handlePosDataSynced);
            window.removeEventListener('pos-exchange-rate-updated', handleRateUpdated);
            clearInterval(cloudInterval);
        };
    }, [fetchExchangeRate, fetchShiftStatus, socket]);

    // Sincronización Local -> IndexedDB
    useEffect(() => {
        if (!isReady.current || isHydrating) return;
        db.put('metadata', { key: 'pos_active_session', value: posState }).catch(e => console.error("Error saving session", e));
    }, [posState, isHydrating]);

    useEffect(() => {
        if (!isReady.current || isHydrating) return;
        db.put('metadata', { key: 'pos_held_sales', value: heldSales }).catch(e => console.error("Error saving held sales", e));
    }, [heldSales, isHydrating]);

    // Resolver datos del cliente seleccionado desde IndexedDB o API si solo se tiene el ID
    useEffect(() => {
        const custId = posState.selectedCustomer;
        if (!custId) return;
        if (
            posState.selectedCustomerInfo &&
            String(posState.selectedCustomerInfo.id) === String(custId) &&
            posState.selectedCustomerInfo.name
        ) {
            return;
        }
        let cancelled = false;
        const resolveCust = async () => {
            try {
                const localList = await db.getAll('customers');
                if (!cancelled && Array.isArray(localList)) {
                    const found = localList.find(c => String(c.id) === String(custId));
                    if (found) {
                        setPosState(prev => (String(prev.selectedCustomer) === String(custId) ? {
                            ...prev,
                            selectedCustomerInfo: {
                                id: found.id,
                                name: found.name || '',
                                idDocument: found.idDocument || found.identification || found.document || found.rif || ''
                            }
                        } : prev));
                        return;
                    }
                }
                if (!localStorage.getItem('auth_token')) return;
                const res = await api.get('/customers');
                const list = res.data?.customers || res.data;
                if (!cancelled && Array.isArray(list)) {
                    const found = list.find(c => String(c.id) === String(custId));
                    if (found) {
                        setPosState(prev => (String(prev.selectedCustomer) === String(custId) ? {
                            ...prev,
                            selectedCustomerInfo: {
                                id: found.id,
                                name: found.name || '',
                                idDocument: found.idDocument || found.identification || found.document || found.rif || ''
                            }
                        } : prev));
                    }
                }
            } catch (_) {}
        };
        resolveCust();
        return () => { cancelled = true; };
    }, [posState.selectedCustomer, posState.selectedCustomerInfo]);

    // 📺 Transmisión en Tiempo Real al Visor de Cliente (Triple Sincronización: Socket + BroadcastChannel + LocalStorage)
    const broadcastDisplayCart = useCallback(() => {
        try {
            const rawCart = Array.isArray(posState.cart) ? posState.cart : [];
            const subtotal = rawCart.reduce((acc, it) => acc + ((Number(it.price) || 0) * (Number(it.quantity) || 0)), 0);
            const discountPercent = Number(posState.discountActive || 0);
            const promoSavings = Number(promoEvaluation?.totalPromoSavings || 0);
            const manualDiscount = Math.max(0, subtotal - promoSavings) * (discountPercent / 100);
            const discount = promoSavings + manualDiscount;
            const total = Math.max(0, subtotal - discount);

            const isDollarCountryNow = isDollarOnlyCountry(country);
            const isUsdOnlyNow = isDollarCountryNow || isUsdOnlyMode({ currencyMode, country });
            const effRate = isUsdOnlyNow ? 1 : (exchangeRate || 1);
            const effMode = isUsdOnlyNow ? 'USD' : currencyMode;

            const activeCustInfo = (
                posState.selectedCustomer &&
                posState.selectedCustomerInfo &&
                String(posState.selectedCustomerInfo.id) === String(posState.selectedCustomer)
            ) ? posState.selectedCustomerInfo : null;

            const displayPayload = {
                companyId: user?.companyId || '1',
                businessName: globalSettings?.businessInfo?.name || '',
                businessLogo: globalSettings?.businessInfo?.logo || '',
                cashierName: user?.name || user?.username || 'Cajero',
                registerName: registerDisplayName || 'Caja 1',
                registerId: registerId || '1',
                customerId: posState.selectedCustomer || null,
                customerName: activeCustInfo?.name || '',
                customerDoc: activeCustInfo?.idDocument || '',
                items: rawCart.map(it => ({
                    id: it.id,
                    name: it.name,
                    price: Number(it.price) || 0,
                    quantity: Number(it.quantity) || 0,
                    subtotal: (Number(it.price) || 0) * (Number(it.quantity) || 0),
                    imageUrl: it.imageUrl || it.imageUri || '',
                    category: it.category || '',
                    presentationName: it.selectedPresentation?.name || it.presentationName || ''
                })),
                itemCount: rawCart.length,
                subtotalUSD: subtotal,
                discountUSD: discount,
                totalUSD: total,
                totalBs: isUsdOnlyNow ? 0 : total * effRate,
                exchangeRate: effRate,
                currencyMode: effMode,
                timestamp: Date.now()
            };

            // 1. Guardar en localStorage para disponibilidad instantánea al abrir visor en misma PC
            try {
                localStorage.setItem('isaac_pos_display_sync', JSON.stringify(displayPayload));
            } catch (_) {}

            // 2. BroadcastChannel para sincronización inter-procesos/doble monitor (0ms latencia)
            try {
                if (typeof BroadcastChannel !== 'undefined') {
                    const bc = new BroadcastChannel('isaac_pos_display_sync');
                    bc.postMessage({ type: 'CART_UPDATE', payload: displayPayload });
                    bc.close();
                }
            } catch (_) {}

            // 3. Socket.io para pantallas en red LAN / tablet / Wi-Fi / otros navegadores
            if (socket && socket.connected) {
                socket.emit('customer_display_cart_update', displayPayload);
            }

            // 4. CustomEvent en ventana
            try {
                window.dispatchEvent(new CustomEvent('isaac_pos_display_local_update', { detail: displayPayload }));
            } catch (_) {}
        } catch (_e) {}
    }, [posState.cart, posState.discountActive, posState.selectedCustomer, posState.selectedCustomerInfo, promoEvaluation?.totalPromoSavings, exchangeRate, currencyMode, country, socket, user, registerDisplayName, registerId, globalSettings]);

    // Transmitir cada vez que cambie el carrito o los montos
    useEffect(() => {
        broadcastDisplayCart();
    }, [broadcastDisplayCart]);

    // Responder a solicitudes del Visor (cuando el visor recién se abre o se reconecta)
    useEffect(() => {
        let bc = null;
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                bc = new BroadcastChannel('isaac_pos_display_sync');
                bc.onmessage = (event) => {
                    if (event.data?.type === 'REQUEST_INITIAL_STATE') {
                        broadcastDisplayCart();
                    }
                };
            }
        } catch (_) {}

        if (socket) {
            socket.on('request_customer_display_cart', broadcastDisplayCart);
        }

        return () => {
            if (bc) {
                try { bc.close(); } catch (_) {}
            }
            if (socket) {
                socket.off('request_customer_display_cart', broadcastDisplayCart);
            }
        };
    }, [socket, broadcastDisplayCart]);

    // Helpers
    const setCart = useCallback((updater) => {
        setPosState(prev => {
            const currentCart = Array.isArray(prev.cart) ? prev.cart : [];
            const newCart = typeof updater === 'function' ? updater(currentCart) : updater;
            return { ...prev, cart: Array.isArray(newCart) ? newCart : [] };
        });
    }, []);

    const setSelectedCustomer = useCallback((val, customerObj = null) => {
        setPosState(prev => {
            if (!val) {
                if (!prev.selectedCustomer && !prev.selectedCustomerInfo) return prev;
                return { ...prev, selectedCustomer: '', selectedCustomerInfo: null };
            }
            if (typeof val === 'object' && val !== null) {
                const newId = val.id || val.identification || val.idDocument || val.name || '';
                const newInfo = {
                    id: val.id || newId,
                    name: val.name || val.nombre || '',
                    idDocument: val.idDocument || val.identification || val.document || val.rif || val.doc || '',
                    phone: val.phone || val.telefono || ''
                };
                if (
                    String(prev.selectedCustomer) === String(newId) &&
                    prev.selectedCustomerInfo?.name === newInfo.name &&
                    prev.selectedCustomerInfo?.idDocument === newInfo.idDocument
                ) {
                    return prev;
                }
                return { ...prev, selectedCustomer: newId, selectedCustomerInfo: newInfo };
            }
            const nextInfo = (customerObj && typeof customerObj === 'object')
                ? {
                    id: customerObj.id || val,
                    name: customerObj.name || customerObj.nombre || '',
                    idDocument: customerObj.idDocument || customerObj.identification || customerObj.document || customerObj.rif || customerObj.doc || '',
                    phone: customerObj.phone || customerObj.telefono || ''
                }
                : (prev.selectedCustomerInfo && String(prev.selectedCustomerInfo.id) === String(val)
                    ? prev.selectedCustomerInfo
                    : null);
            if (
                String(prev.selectedCustomer) === String(val) &&
                prev.selectedCustomerInfo?.name === nextInfo?.name &&
                prev.selectedCustomerInfo?.idDocument === nextInfo?.idDocument
            ) {
                return prev;
            }
            return { ...prev, selectedCustomer: val, selectedCustomerInfo: nextInfo };
        });
    }, []);

    const setDiscountActive = useCallback((val) => {
        setPosState(prev => ({ ...prev, discountActive: val }));
    }, []);

    const setSearchTermVal = useCallback((val) => {
        setSearchTerm(val);
    }, []);

    const clearPosState = useCallback(() => {
        db.delete('metadata', 'pos_active_session').catch(()=>{}); // Limpiamos disco asíncronamente
        setPosState(INITIAL_STATE);
    }, []);

    const handleSetCurrencyMode = useCallback((newMode) => {
        const isDollar = isDollarOnlyCountry(country);
        const finalMode = isDollar ? 'USD' : newMode;
        setCurrencyMode(finalMode);
        localStorage.setItem('pos_currency_mode', finalMode);
        setGlobalSettings(prev => {
            const updated = { ...prev, currencyMode: finalMode };
            localStorage.setItem('pos_global_settings', JSON.stringify(updated));
            return updated;
        });
        window.dispatchEvent(new CustomEvent('currency_mode_changed', { detail: finalMode }));
    }, [country]);

    const isDollarCountryActive = isDollarOnlyCountry(country);
    const isUsdOnlyActive = isDollarCountryActive || isUsdOnlyMode({ currencyMode, country });
    const activeEffectiveRate = isUsdOnlyActive ? 1 : exchangeRate;
    const activeEffectiveMode = isUsdOnlyActive ? 'USD' : currencyMode;

    const value = useMemo(() => ({
        isHydrating,
        cart: posState.cart,
        setCart,
        selectedCustomer: posState.selectedCustomer,
        selectedCustomerInfo: posState.selectedCustomerInfo,
        setSelectedCustomer,
        discountActive: posState.discountActive,
        setDiscountActive,
        searchTerm: searchTerm,
        setSearchTerm: setSearchTermVal,
        heldSales,
        setHeldSales,
        clearPosState,
        exchangeRate: activeEffectiveRate,
        currencyMode: activeEffectiveMode,
        isUsdOnly: isUsdOnlyActive,
        isDollarCountry: isDollarCountryActive,
        setCurrencyMode: handleSetCurrencyMode,
        country,
        setCountry,
        globalSettings,
        setGlobalSettings,
        businessMode,
        setBusinessMode,
        registerId,
        setRegisterId,
        registerDisplayName,
        setRegisterDisplayName,
        allowedCategories,
        setAllowedCategories,
        allowedProducts,
        setAllowedProducts,
        fetchExchangeRate,
        fetchShiftStatus,
        posViewMode,
        setPosViewMode,
        isShiftOpen,
        currentShift,
        promptOpenCashShift,
        activePromotions,
        refreshActivePromotions,
        promoEvaluation,
        appliedPromotions: promoEvaluation.appliedPromotions,
        totalPromoSavings: promoEvaluation.totalPromoSavings
    }), [
        posState, searchTerm, heldSales, activeEffectiveRate, activeEffectiveMode, isUsdOnlyActive, isDollarCountryActive, country, globalSettings, businessMode,
        registerId, registerDisplayName, allowedCategories, setAllowedCategories, allowedProducts, setAllowedProducts, posViewMode, isHydrating, isShiftOpen, currentShift,
        activePromotions, refreshActivePromotions, promoEvaluation,
        setCart, setSelectedCustomer, setDiscountActive, setSearchTermVal, 
        clearPosState, handleSetCurrencyMode, fetchExchangeRate, fetchShiftStatus, promptOpenCashShift
    ]);

    return (
        <PosContext.Provider value={value}>
            {children}
        </PosContext.Provider>
    );
}

export const usePos = () => {
    const context = useContext(PosContext);
    if (!context) throw new Error('usePos debe usarse dentro de PosProvider');
    return context;
};
