import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { db } from '../services/db';
import {
    fetchBusinessSettingsCached,
    fetchTaxSettingsCached,
    fetchPaymentMethodsCached
} from '../utils/format';

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
} catch (err) {
    console.warn('[usePOSData] No se pudo hidratar caché L1:', err?.message);
}

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
    const inFlightProductsRef = useRef(null);
    const inFlightCategoriesRef = useRef(null);
    const inFlightCustomersRef = useRef(null);
    const inFlightStockIntelRef = useRef(null);

    const isDisconnectedOrCleared = () => {
        if (typeof window !== 'undefined' && localStorage.getItem('isaac_pos_is_offline_mode') === 'true') {
            return false;
        }
        const isCleared = typeof window !== 'undefined' && localStorage.getItem('isaac_pos_server_ip_explicitly_cleared') === 'true';
        const currentRole = typeof window !== 'undefined' ? (localStorage.getItem('isaac_pos_node_role') || 'client') : 'client';
        const savedIp = typeof window !== 'undefined' ? localStorage.getItem('isaac_pos_server_ip') : '';
        return isCleared || (currentRole === 'client' && !savedIp);
    };

    const fetchProducts = useCallback(async (opts = {}) => {
        const forceFull = Boolean(opts && opts.forceFull);
        if (!forceFull && inFlightProductsRef.current) {
            return inFlightProductsRef.current;
        }
        const task = (async () => {
        try {
            const preloadedLocal = Array.isArray(opts?.preloadedLocalProducts) ? opts.preloadedLocalProducts : null;
            // Priority 1: Load from IndexedDB immediately (salvo que fetchInitialData ya lo hidrató)
            const localProducts = preloadedLocal !== null ? preloadedLocal : await db.getAll('products');
            const hasLocalProducts = Array.isArray(localProducts) && localProducts.length > 0;
            if (preloadedLocal === null) {
                if (hasLocalProducts) {
                    const sortedLocal = sortProductsAlphabetically(localProducts);
                    cachedProductsL1 = sortedLocal;
                    setAllProducts(sortedLocal);
                    setLoading(false); // Unblock UI early
                    try {
                        sessionStorage.setItem('pos_products_l1', JSON.stringify(sortedLocal));
                    } catch (err) {
                        console.warn('[usePOSData] No se pudo escribir caché L1 (pos_products_l1):', err?.message);
                    }
                } else if (isDisconnectedOrCleared()) {
                    setAllProducts([]);
                    setLoading(false);
                    return;
                }
            }

            if (isDisconnectedOrCleared() && localStorage.getItem('isaac_pos_is_offline_mode') !== 'true') {
                setLoading(false);
                return;
            }

            // Priority 2: Sincronización Delta (?since=) cuando ya tenemos catálogo local + serverTime previo
            let lastSyncMeta = null;
            if (!forceFull && hasLocalProducts) {
                try {
                    lastSyncMeta = await db.getById('metadata', 'last_product_sync');
                } catch (_) {
                    lastSyncMeta = null;
                }
            }

            let requestUrl = '/products?minimal=true&delta=true';
            if (!forceFull && hasLocalProducts && lastSyncMeta?.value) {
                const parsedLast = new Date(lastSyncMeta.value);
                if (!Number.isNaN(parsedLast.getTime())) {
                    // Margen de 2s para absorber concurrencia entre commits simultáneos en servidor
                    const safeSince = new Date(Math.max(0, parsedLast.getTime() - 2000)).toISOString();
                    requestUrl = `/products?minimal=true&since=${encodeURIComponent(safeSince)}`;
                }
            }

            const response = await api.get(requestUrl, { timeout: 10000 });
            const payload = response.data;
            const nextServerTime = payload?.serverTime || new Date().toISOString();

            // Rama Delta Real: Solo fusionar los productos modificados/eliminados sin reescribir todo el catálogo
            if (payload && payload.delta === true && Array.isArray(payload.products) && hasLocalProducts) {
                const changedProducts = payload.products;
                const deletedIds = Array.isArray(payload.deletedIds) ? payload.deletedIds : [];

                if (changedProducts.length === 0 && deletedIds.length === 0) {
                    db.put('metadata', { key: 'last_product_sync', value: nextServerTime });
                    return;
                }

                const mergedMap = new Map();
                for (let i = 0; i < localProducts.length; i++) {
                    const p = localProducts[i];
                    if (p && p.id !== undefined && p.id !== null) {
                        mergedMap.set(String(p.id), p);
                    }
                }
                for (let i = 0; i < deletedIds.length; i++) {
                    mergedMap.delete(String(deletedIds[i]));
                }
                for (let i = 0; i < changedProducts.length; i++) {
                    const cp = changedProducts[i];
                    if (cp && cp.id !== undefined && cp.id !== null) {
                        mergedMap.set(String(cp.id), cp);
                    }
                }

                const sortedMerged = sortProductsAlphabetically(Array.from(mergedMap.values()));
                cachedProductsL1 = sortedMerged;
                setAllProducts(sortedMerged);
                try {
                    sessionStorage.setItem('pos_products_l1', JSON.stringify(sortedMerged));
                } catch (err) {
                    console.warn('[usePOSData] No se pudo actualizar caché L1 delta:', err?.message);
                }

                if (changedProducts.length > 0) {
                    await db.putAll('products', changedProducts);
                }
                if (deletedIds.length > 0) {
                    await Promise.all(deletedIds.map(id => db.delete('products', id)));
                }
                db.put('metadata', { key: 'last_product_sync', value: nextServerTime });
                return;
            }

            // Rama Full Sync (primer arranque, post-reinicio del servidor, o backend legacy)
            const serverProducts = Array.isArray(payload) ? payload : payload?.products;
            if (Array.isArray(serverProducts)) {
                if (serverProducts.length === 0) {
                    cachedProductsL1 = [];
                    setAllProducts([]);
                    try {
                        sessionStorage.removeItem('pos_products_l1');
                    } catch (err) {
                        console.warn('[usePOSData] No se pudo limpiar caché L1:', err?.message);
                    }
                    await db.clear('products');
                    db.put('metadata', { key: 'last_product_sync', value: nextServerTime });
                } else {
                    const sortedServer = sortProductsAlphabetically(serverProducts);
                    cachedProductsL1 = sortedServer;
                    setAllProducts(sortedServer);
                    try {
                        sessionStorage.setItem('pos_products_l1', JSON.stringify(sortedServer));
                    } catch (err) {
                        console.warn('[usePOSData] No se pudo actualizar caché L1:', err?.message);
                    }
                    // MASTER SYNC: Persist everything to IndexedDB in a single atomic transaction
                    await db.replaceAllAtomic('products', sortedServer);
                    db.put('metadata', { key: 'last_product_sync', value: nextServerTime });
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
            if (inFlightProductsRef.current === task) {
                inFlightProductsRef.current = null;
            }
        }
        })();
        if (!forceFull) {
            inFlightProductsRef.current = task;
        }
        return task;
    }, []);

    const fetchCategories = useCallback(async () => {
        if (inFlightCategoriesRef.current) return inFlightCategoriesRef.current;
        const task = (async () => {
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
        } finally {
            if (inFlightCategoriesRef.current === task) inFlightCategoriesRef.current = null;
        }
        })();
        inFlightCategoriesRef.current = task;
        return task;
    }, []);

    const fetchCustomers = useCallback(async (searchQuery = '') => {
        if (!searchQuery && inFlightCustomersRef.current) return inFlightCustomersRef.current;
        const task = (async () => {
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
        } finally {
            if (!searchQuery && inFlightCustomersRef.current === task) inFlightCustomersRef.current = null;
        }
        })();
        if (!searchQuery) inFlightCustomersRef.current = task;
        return task;
    }, []);

    const fetchStockIntelligence = useCallback(async () => {
        if (inFlightStockIntelRef.current) return inFlightStockIntelRef.current;
        const task = (async () => {
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
        } finally {
            if (inFlightStockIntelRef.current === task) inFlightStockIntelRef.current = null;
        }
        })();
        inFlightStockIntelRef.current = task;
        return task;
    }, []);

    const fetchInitialData = useCallback(async () => {
        try {
            if (!cachedProductsL1 || cachedProductsL1.length === 0) {
                setLoading(true);
            }

            // Phase 1: ESSENTIAL DATA (Always load local data immediately, una sola lectura + orden)
            const localProducts = await db.getAll('products');
            if (localProducts && localProducts.length > 0) {
                const sortedLocal = sortProductsAlphabetically(localProducts);
                cachedProductsL1 = sortedLocal;
                setAllProducts(sortedLocal);
                setLoading(false); // Unblock UI early!
                try {
                    sessionStorage.setItem('pos_products_l1', JSON.stringify(sortedLocal));
                } catch (err) {
                    console.warn('[usePOSData] No se pudo escribir caché L1 (pos_products_l1):', err?.message);
                }
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

            // Phase 2: SYNC EVERYTHING (delta reutilizando los productos locales ya leídos)
            fetchCategories();
            fetchProducts({ preloadedLocalProducts: localProducts || [] });
            
            // Phase 3: SECONDARY DATA (Non-blocking, coalescencia con caché compartido)
            Promise.all([
                fetchCustomers().catch(e => console.warn('Background fetch failed: Customers', e.message)),
                fetchBusinessSettingsCached().then(bData => {
                    if (bData) {
                        setBusinessSettings(bData);
                    }
                }).catch(e => console.warn('Background fetch failed: Business', e.message)),
                fetchTaxSettingsCached().then(tData => {
                    if (tData) {
                        setTaxSettings(tData);
                        localStorage.setItem('pos_tax_settings', JSON.stringify(tData));
                    }
                }).catch(e => console.warn('Background fetch failed: Taxes', e.message)),
                fetchPaymentMethodsCached().then(pData => {
                    if (pData) {
                        setPaymentMethods(pData);
                        localStorage.setItem('pos_payment_methods', JSON.stringify(pData));
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
                    try { setBusinessSettings(JSON.parse(cachedBiz)); } catch (err) { console.warn('[usePOSData] Error parseando pos_business_settings:', err?.message); }
                }
            } catch (err) {
                console.warn('[usePOSData] Error hidratando tras pos-data-synced:', err?.message);
            }
        };
        window.addEventListener('pos-data-synced', handlePosDataSynced);
        return () => {
            window.removeEventListener('pos-data-synced', handlePosDataSynced);
        };
    }, []);

    useEffect(() => {
        if (!socket) return;
        let remoteSyncTimer = null;
        const handleRemoteUpdate = () => {
             if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
             remoteSyncTimer = setTimeout(() => {
                 remoteSyncTimer = null;
                 console.log('⚡ Cambio detectado. Sincronizando delta de catálogo local...');
                 fetchProducts();
             }, 250);
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
                 fetchExchangeRate(true);
             }
        };

        socket.on('inventory_changed', handleRemoteUpdate);
        socket.on('product_updated', handleProductUpdated);
        socket.on('settings_changed', handleSettingsUpdate);
        return () => {
            if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
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
