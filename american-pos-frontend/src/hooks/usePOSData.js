import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { db } from '../services/db';
import { cacheAllProductImages } from '../services/imageCache';

// Helper to extract numeric product stock safely
export const getProductStock = (p) => {
    if (!p) return 0;
    if (p.isService || String(p.category || '').trim().toLowerCase() === 'servicios') return 999999;
    if (p.BranchStocks && Array.isArray(p.BranchStocks) && p.BranchStocks.length > 0) {
        return p.BranchStocks.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
    }
    return Number(p.stockQuantity ?? p.stock ?? p.stock_total ?? 0);
};

// Helper to ensure deterministic sorting: Products with stock first, out-of-stock last (A-Z in each group)
export const sortProductsAlphabetically = (items) => {
    if (!Array.isArray(items)) return [];
    const normalized = items.map(item => {
        if (item && (item.isService || String(item.category || '').trim().toLowerCase() === 'servicios')) {
            return {
                ...item,
                isService: true,
                isSoldByWeight: false,
                isFractional: false,
                stockUnit: 'un',
                unitsPerBulk: 1,
                bulkPrice: 0,
                unitsPerMidBulk: 0,
                midBulkPrice: 0,
                stockQuantity: 0,
                allowNegative: true
            };
        }
        return item;
    });
    return normalized.sort((a, b) => {
        const stockA = getProductStock(a);
        const stockB = getProductStock(b);
        const outA = stockA <= 0 ? 1 : 0;
        const outB = stockB <= 0 ? 1 : 0;

        // Regla: Productos agotados van al final
        if (outA !== outB) return outA - outB;

        const nameA = String(a?.name || a?.nombre || '').trim();
        const nameB = String(b?.name || b?.nombre || '').trim();
        return nameA.localeCompare(nameB, 'es', { sensitivity: 'base', numeric: true });
    });
};

// In-Memory L1 Cache for zero-ms instantaneous Frame-1 product render
let cachedProductsL1 = null;
try {
    const raw = sessionStorage.getItem('pos_products_l1');
    if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
            cachedProductsL1 = sortProductsAlphabetically(parsed);
        }
    }
} catch (_e) {}

export const usePOSData = (socket, fetchExchangeRate, location, setCart, setSelectedCustomer, setActiveQuotationId) => {
    const [allProducts, setAllProducts] = useState(() => cachedProductsL1 || []);
    const [loading, setLoading] = useState(() => !cachedProductsL1 || cachedProductsL1.length === 0);
    const [categories, setCategories] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pos_categories') || '["Todas"]');
        } catch {
            return ['Todas'];
        }
    });
    const [customers, setCustomers] = useState([]);
    const [businessSettings, setBusinessSettings] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pos_business_settings') || '{}');
        } catch {
            return {};
        }
    });
    const [taxSettings, setTaxSettings] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pos_tax_settings') || '{"ivaEnabled":true,"ivaRate":16,"igtfEnabled":true,"igtfRate":3}');
        } catch {
            return { ivaEnabled: true, ivaRate: 16, igtfEnabled: true, igtfRate: 3 };
        }
    });
    const [paymentMethods, setPaymentMethods] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pos_payment_methods') || '[]');
        } catch {
            return [];
        }
    });
    const [stockIntelligence, setStockIntelligence] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pos_stock_intelligence') || '{}');
        } catch {
            return {};
        }
    });
    const quoteLoadedRef = useRef(false);

    const isDisconnectedOrCleared = () => {
        if (typeof window !== 'undefined' && localStorage.getItem('isaac_pos_is_offline_mode') === 'true') {
            return false;
        }
        const isCleared = typeof window !== 'undefined' && localStorage.getItem('isaac_pos_server_ip_explicitly_cleared') === 'true';
        const currentRole = typeof window !== 'undefined' ? (localStorage.getItem('isaac_pos_node_role') || 'client') : 'client';
        const savedIp = typeof window !== 'undefined' ? localStorage.getItem('isaac_pos_server_ip') : '';
        return isCleared || (currentRole === 'client' && !savedIp);
    };

    const fetchProducts = useCallback(async () => {
        try {
            // Priority 1: Load from IndexedDB immediately (Fast Access & Offline)
            const localProducts = await db.getAll('products');
            if (localProducts && localProducts.length > 0) {
                const sortedLocal = sortProductsAlphabetically(localProducts);
                cachedProductsL1 = sortedLocal;
                setAllProducts(sortedLocal);
                setLoading(false); // Unblock UI early
                try {
                    sessionStorage.setItem('pos_products_l1', JSON.stringify(sortedLocal));
                } catch (_e) {}
            } else if (isDisconnectedOrCleared()) {
                setAllProducts([]);
                setLoading(false);
                return;
            }

            if (isDisconnectedOrCleared() && localStorage.getItem('isaac_pos_is_offline_mode') !== 'true') {
                setLoading(false);
                return;
            }

            // Priority 2: Sync with API in background
            const response = await api.get('/products?minimal=true', { timeout: 10000 });
            const serverProducts = response.data.products || response.data;
            if (Array.isArray(serverProducts)) {
                if (serverProducts.length === 0) {
                    cachedProductsL1 = [];
                    setAllProducts([]);
                    try {
                        sessionStorage.removeItem('pos_products_l1');
                    } catch (_e) {}
                    await db.clear('products');
                    db.put('metadata', { key: 'last_product_sync', value: new Date().toISOString() });
                } else {
                    const sortedServer = sortProductsAlphabetically(serverProducts);
                    cachedProductsL1 = sortedServer;
                    setAllProducts(sortedServer);
                    try {
                        sessionStorage.setItem('pos_products_l1', JSON.stringify(sortedServer));
                    } catch (_e) {}
                    // MASTER SYNC: Persist everything to IndexedDB in a single atomic transaction
                    await db.replaceAllAtomic('products', sortedServer);
                    db.put('metadata', { key: 'last_product_sync', value: new Date().toISOString() });
                }
            }
        } catch (_error) {
            console.warn('[usePOSData] Failed to fetch server products, staying with local data');
            const finalLocal = await db.getAll('products');
            if (finalLocal && finalLocal.length > 0) {
                const sortedFinal = sortProductsAlphabetically(finalLocal);
                cachedProductsL1 = sortedFinal;
                setAllProducts(sortedFinal);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchCategories = useCallback(async () => {
        try {
            if (isDisconnectedOrCleared()) {
                setCategories(['Todas']);
                return;
            }

            // Local First
            const cachedCats = JSON.parse(localStorage.getItem('pos_categories') || '["Todas"]');
            if (cachedCats && cachedCats.length > 1) setCategories(cachedCats);

            const response = await api.get('/products/categories');
            const uniqueCats = [...new Set((response.data || []).map(c => c?.trim()))].filter(Boolean).sort();
            const finalCats = ['Todas', ...uniqueCats];
            setCategories(finalCats);
            localStorage.setItem('pos_categories', JSON.stringify(finalCats));
        } catch (_error) {
            setCategories(prev => prev.length > 1 ? prev : ['Todas']);
        }
    }, []);

    const fetchCustomers = useCallback(async (searchQuery = '') => {
        try {
            if (isDisconnectedOrCleared()) {
                setCustomers([]);
                return;
            }

            const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
            const response = await api.get(`/customers${params}`);
            const list = response.data?.customers || response.data;
            if (Array.isArray(list)) {
                setCustomers(list);
            } else if (list && Array.isArray(list.customers)) {
                setCustomers(list.customers);
            } else {
                console.warn('[usePOSData] Received non-array customers response:', typeof list);
                const localCustomers = await db.getAll('customers');
                setCustomers(Array.isArray(localCustomers) ? localCustomers : []);
            }
        } catch (_error) {
            const localCustomers = await db.getAll('customers');
            setCustomers(Array.isArray(localCustomers) ? localCustomers : []);
        }
    }, []);

    const fetchStockIntelligence = useCallback(async () => {
        try {
            if (isDisconnectedOrCleared()) return;
            const storedCompany = localStorage.getItem('companyId');
            const companyId = (storedCompany && storedCompany !== 'null' && storedCompany !== 'undefined') ? storedCompany : '2';

            const response = await api.get(`/stock-intelligence/status?companyId=${encodeURIComponent(companyId)}`, { timeout: 12000 });
            const intelMap = {};
            (response.data || []).forEach(item => {
                intelMap[item.productId] = item;
            });
            setStockIntelligence(intelMap);
            localStorage.setItem('pos_stock_intelligence', JSON.stringify(intelMap));
        } catch (error) {
            console.warn('[usePOSData] Stock intelligence deferred:', error.message);
        }
    }, []);

    const fetchInitialData = useCallback(async () => {
        try {
            setLoading(true);

            // Phase 1: ESSENTIAL DATA (Always load local data immediately)
            const localProducts = await db.getAll('products');
            if (localProducts && localProducts.length > 0) {
                const sortedLocal = sortProductsAlphabetically(localProducts);
                setAllProducts(sortedLocal);
                setLoading(false); // Unblock UI early!
            } else {
                setAllProducts([]);
            }

            const localCustomers = await db.getAll('customers');
            if (Array.isArray(localCustomers) && localCustomers.length > 0) {
                setCustomers(localCustomers);
            } else {
                setCustomers([]);
            }

            const cachedCats = JSON.parse(localStorage.getItem('pos_categories') || '["Todas"]');
            if (cachedCats && cachedCats.length > 0) {
                setCategories(cachedCats);
            }

            if (isDisconnectedOrCleared() && localStorage.getItem('isaac_pos_is_offline_mode') !== 'true') {
                if (!localProducts || localProducts.length === 0) setAllProducts([]);
                if (!localCustomers || localCustomers.length === 0) setCustomers([]);
                setCategories(['Todas']);
                setLoading(false);
                return;
            }

            // Phase 2: SYNC EVERYTHING
            // We fire background sync for everything else
            fetchCategories();
            fetchProducts(); // This will update state when server responds
            
            // Phase 3: SECONDARY DATA (Non-blocking)
            // Fire these and let them finish in the background
            Promise.all([
                fetchCustomers().catch(e => console.warn('Background fetch failed: Customers', e.message)),
                api.get('/settings/business').then(r => {
                    if (r.data) {
                        setBusinessSettings(r.data);
                        localStorage.setItem('pos_business_settings', JSON.stringify(r.data));
                    }
                }).catch(e => console.warn('Background fetch failed: Business', e.message)),
                api.get('/settings/taxes').then(r => {
                    if (r.data) {
                        setTaxSettings(r.data);
                        localStorage.setItem('pos_tax_settings', JSON.stringify(r.data));
                    }
                }).catch(e => console.warn('Background fetch failed: Taxes', e.message)),
                api.get('/settings/payment-methods').then(r => {
                    if (r.data) {
                        setPaymentMethods(r.data);
                        localStorage.setItem('pos_payment_methods', JSON.stringify(r.data));
                    }
                }).catch(e => console.warn('Background fetch failed: Payments', e.message)),
                fetchExchangeRate().catch(e => console.warn('Background fetch failed: Rate', e.message)),
                fetchStockIntelligence().catch(e => console.warn('Background fetch failed: Intel', e.message))
            ]).then(() => {
                console.log('[usePOSData] Secondary background data loaded successfully');
            });

            // Handle Quotation Loading (only if successful)
            if (location?.state?.fromQuote && !quoteLoadedRef.current) {
                const quote = location.state.fromQuote;
                quoteLoadedRef.current = true;
                if (quote.items) setCart(quote.items);
                if (quote.customerId) setSelectedCustomer(quote.customerId);
                if (quote.id) setActiveQuotationId(quote.id);
                window.history.replaceState({}, document.title);
            }
        } catch (e) {
            console.error('Error in POS initialization:', e);
            setLoading(false);
        }
    }, [fetchCustomers, fetchCategories, fetchExchangeRate, fetchProducts, location, setCart, setSelectedCustomer, setActiveQuotationId, fetchStockIntelligence]);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        const handlePosDataSynced = async () => {
            console.log('⚡ Evento pos-data-synced detectado. Hidratando datos locales en POS sin duplicar llamadas HTTP...');
            try {
                const [localProducts, localCustomers] = await Promise.all([
                    db.getAll('products'),
                    db.getAll('customers')
                ]);
                if (Array.isArray(localProducts) && localProducts.length > 0) {
                    const sortedLocal = sortProductsAlphabetically(localProducts);
                    cachedProductsL1 = sortedLocal;
                    setAllProducts(sortedLocal);
                }
                if (Array.isArray(localCustomers) && localCustomers.length > 0) {
                    setCustomers(localCustomers);
                }
                const cachedCats = JSON.parse(localStorage.getItem('pos_categories') || '["Todas"]');
                if (Array.isArray(cachedCats) && cachedCats.length > 0) {
                    setCategories(cachedCats);
                }
                const cachedBiz = localStorage.getItem('pos_business_settings');
                if (cachedBiz) {
                    try { setBusinessSettings(JSON.parse(cachedBiz)); } catch (_e) {}
                }
            } catch (_err) {}
        };
        window.addEventListener('pos-data-synced', handlePosDataSynced);
        return () => {
            window.removeEventListener('pos-data-synced', handlePosDataSynced);
        };
    }, []);

    useEffect(() => {
        if (!socket) return;
        const handleRemoteUpdate = () => {
             console.log('⚡ Cambio detectado. Refrescando catálogo local...');
             fetchProducts();
        };
        const handleProductUpdated = (updatedProduct) => {
             console.log('⚡ Producto actualizado recibido por socket:', updatedProduct.name);
             setAllProducts(prev => {
                 let stockQty = updatedProduct.stockQuantity;
                 if (updatedProduct.BranchStocks) {
                     stockQty = updatedProduct.BranchStocks.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
                 }
                 return prev.map(p => p.id === updatedProduct.id ? { 
                     ...p, 
                     ...updatedProduct,
                     stockQuantity: Number(stockQty)
                 } : p);
             });
        };
        const handleSettingsUpdate = (data) => {
             if (data.type === 'rate') {
                 fetchExchangeRate();
             }
        };

        socket.on('inventory_changed', handleRemoteUpdate);
        socket.on('product_updated', handleProductUpdated);
        socket.on('settings_changed', handleSettingsUpdate);
        return () => {
            socket.off('inventory_changed', handleRemoteUpdate);
            socket.off('product_updated', handleProductUpdated);
            socket.off('settings_changed', handleSettingsUpdate);
        };
    }, [socket, fetchProducts, fetchExchangeRate]);

    // Escuchar actualizaciones de stock propagadas por la red LAN (P2P multicaja)
    useEffect(() => {
        const handleLanStockUpdate = (event) => {
            const items = event.detail;
            if (!Array.isArray(items) || items.length === 0) return;

            const itemMap = new Map();
            items.forEach(it => {
                const id = String(it.productId || it.producto_id || it.id || '').trim();
                const qty = Number(it.quantity || it.qty || 0);
                if (id && qty > 0) {
                    itemMap.set(id, (itemMap.get(id) || 0) + qty);
                }
            });
            if (itemMap.size === 0) return;

            setAllProducts(prev => prev.map(p => {
                const pId = String(p.id).trim();
                if (itemMap.has(pId)) {
                    const deduct = itemMap.get(pId);
                    const cur = Number(p.stockQuantity ?? p.stock ?? 0);
                    const updated = Math.max(0, cur - deduct);
                    return { ...p, stockQuantity: updated, stock: updated };
                }
                return p;
            }));
        };

        window.addEventListener('lan-stock-update-received', handleLanStockUpdate);
        return () => {
            window.removeEventListener('lan-stock-update-received', handleLanStockUpdate);
        };
    }, []);

    return {
        loading,
        allProducts,
        setAllProducts,
        categories,
        customers,
        businessSettings,
        taxSettings,
        paymentMethods,
        stockIntelligence,
        fetchProducts,
        fetchCustomers,
        quoteLoadedRef,
        refreshData: fetchInitialData
    };
};
