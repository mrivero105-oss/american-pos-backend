import api, { checkServerHealth } from './api';
import { db } from './db';
import localDb from '../db/localDb';
import { cacheAllProductImages } from './imageCache';
import { getSupabaseHeaders, getSupabaseRestUrl, hasSupabaseConfig } from '../config/supabaseConfig';
import {
    fetchBusinessSettingsCached,
    fetchTaxSettingsCached,
    fetchExchangeRateCached,
    fetchPaymentMethodsCached
} from '../utils/format';

const SYNC_METADATA_KEY = 'last_sync_timestamp';
let inFlightAutoSyncPromise = null;
let lastAutoSyncCompletedAt = 0;

/**
 * Calcula las unidades comprometidas en ventas locales pendientes de sincronización (pending_sync)
 * para evitar que una descarga de catálogo sobreescriba el stock descontado offline antes de que SyncManager suba la cola.
 */
async function getPendingOfflineStockDeductions() {
    const deductions = new Map();
    const seenSaleIds = new Set();

    const accumulateFromSales = (salesList) => {
        if (!Array.isArray(salesList)) return;
        for (const sale of salesList) {
            if (!sale || (sale.status !== 'pending_sync' && !sale.isOffline)) continue;
            const saleKey = String(sale.id || '');
            if (saleKey && seenSaleIds.has(saleKey)) continue;
            if (saleKey) seenSaleIds.add(saleKey);

            const items = Array.isArray(sale.items)
                ? sale.items
                : (Array.isArray(sale.SaleItems) ? sale.SaleItems : []);
            for (const item of items) {
                const rawProdId = item?.productId ?? item?.producto_id ?? item?.id;
                const qty = Number(item?.quantity ?? item?.qty ?? 0);
                if (!rawProdId || !Number.isFinite(qty) || qty <= 0) continue;
                const key = String(rawProdId).trim();
                deductions.set(key, (deductions.get(key) || 0) + qty);
            }
        }
    };

    try {
        const primaryPending = await db.getByIndex('sales', 'status', 'pending_sync').catch(() => []);
        accumulateFromSales(primaryPending);
    } catch (e1) {
        console.warn('[SyncService] Aviso leyendo ventas pendientes en UnifiedDB:', e1?.message || e1);
    }

    try {
        if (localDb && localDb.sales) {
            const dexiePending = await localDb.sales.where('status').equals('pending_sync').toArray();
            accumulateFromSales(dexiePending);
        }
    } catch (e2) {
        console.warn('[SyncService] Aviso leyendo ventas pendientes en Dexie:', e2?.message || e2);
    }

    return deductions;
}

/**
 * Persiste una colección de forma atómica en el motor unificado (SQLite Nativo Android WAL / UnifiedDB).
 */
async function persistCollectionAtomically(storeName, items = [], keyPath = 'id') {
    const safeItems = Array.isArray(items) ? items : [];
    await db.replaceAllAtomic(storeName, safeItems, keyPath);
}

/**
 * Persiste el catálogo de productos de forma atómica preservando los descuentos de stock de ventas offline pendientes
 * y ordenando los productos disponibles primero y los agotados al final.
 */
async function persistProductsWithOfflineProtection(formattedProducts = []) {
    const deductions = await getPendingOfflineStockDeductions();
    const adjustedProducts = (deductions.size === 0
        ? [...formattedProducts]
        : formattedProducts.map(p => {
            const pendingQty = deductions.get(String(p.id).trim()) || 0;
            if (pendingQty <= 0) return p;
            const adjustedStock = Math.max(0, Number((Number(p.stockQuantity || 0) - pendingQty).toFixed(3)));
            return {
                ...p,
                stock: adjustedStock,
                stockQuantity: adjustedStock
            };
        })
    ).sort((a, b) => {
        const isServiceA = Boolean(a.isService || String(a.category || a.categoria || '').trim().toLowerCase() === 'servicios');
        const isServiceB = Boolean(b.isService || String(b.category || b.categoria || '').trim().toLowerCase() === 'servicios');
        const stockA = Number(a.stockQuantity ?? a.stock ?? 0);
        const stockB = Number(b.stockQuantity ?? b.stock ?? 0);
        const outA = (!isServiceA && stockA <= 0) ? 1 : 0;
        const outB = (!isServiceB && stockB <= 0) ? 1 : 0;
        if (outA !== outB) return outA - outB;
        const nameA = (a.name || a.nombre || '').toLowerCase();
        const nameB = (b.name || b.nombre || '').toLowerCase();
        return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });

    await persistCollectionAtomically('products', adjustedProducts, 'id');
    return adjustedProducts;
}

export const syncService = {
    /**
     * Sincroniza el desfase de reloj (Clock Drift) contra el servidor central (ARQ-004)
     */
    syncClockDrift: async () => {
        try {
            const start = Date.now();
            const response = await api.get('/time');
            const rtt = Date.now() - start;
            const serverTime = response.data?.timestamp || Date.now();
            const drift = Math.round(serverTime - (start + rtt / 2));
            localStorage.setItem('isaac_pos_clock_drift', drift);
            console.log(`[ClockDrift] Desfase calculado: ${drift} ms`);
            return drift;
        } catch (_error) {
            return Number(localStorage.getItem('isaac_pos_clock_drift') || localStorage.getItem('american_pos_clock_drift') || 0);
        }
    },

    /**
     * Sincroniza productos y variantes a IndexedDB (services/db y localDb)
     */
    syncProducts: async () => {
        try {
            console.log('Sync: Starting product sync...');
            let rawProducts = [];
            
            try {
                const response = await api.get('/products?limit=0');
                rawProducts = Array.isArray(response.data) ? response.data : (response.data.products || []);
            } catch (err) {
                if (err.response?.status === 401 || !rawProducts.length) {
                    console.log('Sync: Retrying products via initial-adoption / pull endpoint...');
                    try {
                        const initRes = await api.get('/sync/initial-adoption');
                        if (initRes.data?.products) rawProducts = initRes.data.products;
                    } catch (_e) {
                        try {
                            const pullRes = await api.get('/sync/pull');
                            if (pullRes.data?.products) rawProducts = pullRes.data.products;
                        } catch (_e2) {
                            try {
                                const companyId = localStorage.getItem('companyId') || '2';
                                const catRes = await api.get(`/public-catalog/${companyId}`);
                                if (catRes.data?.products) rawProducts = catRes.data.products;
                            } catch (_e3) {
                                console.warn('[Sync] Fallback a catálogo público falló:', _e3.message);
                            }
                        }
                    }
                } else {
                    throw err;
                }
            }

            if (Array.isArray(rawProducts)) {
                if (rawProducts.length === 0) {
                    console.log('Sync: Catálogo en servidor está vacío (0 productos). Limpiando IndexedDB local...');
                    await persistCollectionAtomically('products', [], 'id');
                    await db.replaceAllAtomic('categories', [], 'name');
                    localStorage.setItem('pos_categories', JSON.stringify(['Todas']));
                    try {
                        if (localDb && localDb.variants) await localDb.variants.clear();
                    } catch (err) {
                        console.warn('[Sync] Error limpiando variantes locales:', err?.message);
                    }
                    window.dispatchEvent(new CustomEvent('pos-data-synced', { detail: { timestamp: new Date().toISOString(), count: 0 } }));
                    return { products: [], count: 0 };
                }

                // Formateo uniforme para que sea compatible con todos los rubros (Estándar, Farmacia, Ropa)
                const formattedProducts = rawProducts.map(p => {
                    const stockVal = Number(p.stockQuantity !== undefined ? p.stockQuantity : (p.stock !== undefined ? p.stock : 0));
                    const priceVal = Number(p.price !== undefined ? p.price : (p.precio !== undefined ? p.precio : 0));
                    const nameVal = p.name || p.nombre || 'Producto';
                    const barcodeVal = p.barcode || p.codigo_barras || '';
                    const imageVal = p.imageUri || p.imageUrl || p.image || null;

                    return {
                        ...p,
                        id: p.id,
                        name: nameVal,
                        nombre: nameVal,
                        price: priceVal,
                        precio: priceVal,
                        stock: stockVal,
                        stockQuantity: stockVal,
                        barcode: barcodeVal,
                        codigo_barras: barcodeVal,
                        imageUri: imageVal,
                        imageUrl: imageVal,
                        category: p.category || p.categoria || 'General',
                        categoria: p.category || p.categoria || 'General',
                        taxStatus: p.taxStatus || 'gravable',
                        isSoldByWeight: Boolean(p.isSoldByWeight),
                        es_controlado: Boolean(p.es_controlado),
                        principio_activo: p.principio_activo || null
                    };
                });

                // 1 & 2. Guardar atómicamente en services/db y localDb preservando descuentos offline pendientes
                await persistProductsWithOfflineProtection(formattedProducts);

                // 3. Extraer y guardar variantes si existen
                try {
                    const allVariants = [];
                    formattedProducts.forEach(p => {
                        if (p.Variantes && Array.isArray(p.Variantes)) {
                            p.Variantes.forEach(v => allVariants.push({ ...v, producto_id: p.id }));
                        }
                    });
                    if (allVariants.length > 0 && localDb && localDb.variants) {
                        await localDb.transaction('rw', localDb.variants, async () => {
                            await localDb.variants.clear();
                            await localDb.variants.bulkPut(allVariants);
                        });
                    }
                } catch (varErr) {
                    console.warn('[Sync] Advertencia al escribir variantes:', varErr);
                }

                // 4. Extraer y guardar categorías únicas de forma atómica
                const uniqueCategories = [...new Set(formattedProducts.map(p => p.category).filter(Boolean))];
                await db.replaceAllAtomic('categories', uniqueCategories.map(name => ({ name })), 'name');
                const catsList = ['Todas', ...uniqueCategories];
                localStorage.setItem('pos_categories', JSON.stringify(catsList));
            }

            console.log(`Sync: ${rawProducts.length} productos y variantes sincronizados.`);
            return { success: true, count: rawProducts.length, products: rawProducts };
        } catch (error) {
            console.error('Sync: Error sincronizando productos:', error);
            throw error;
        }
    },

    /**
     * Sincroniza clientes a IndexedDB (services/db y localDb)
     */
    syncCustomers: async () => {
        try {
            console.log('Sync: Starting customer sync...');
            let rawCustomers = [];
            try {
                const response = await api.get('/customers?limit=0');
                rawCustomers = Array.isArray(response.data) ? response.data : (response.data.customers || []);
            } catch (err) {
                if (err.response?.status === 401) {
                    try {
                        const initRes = await api.get('/sync/initial-adoption');
                        if (initRes.data?.customers) rawCustomers = initRes.data.customers;
                    } catch (_e) {
                        try {
                            const pullRes = await api.get('/sync/pull');
                            if (pullRes.data?.customers) rawCustomers = pullRes.data.customers;
                        } catch (_e2) {
                            console.warn('[SyncService] Fallback /sync/pull de clientes no disponible:', _e2?.message || _e2);
                        }
                    }
                } else {
                    throw err;
                }
            }

            if (rawCustomers.length > 0) {
                await persistCollectionAtomically('customers', rawCustomers, 'id');
            }

            console.log(`Sync: ${rawCustomers.length} clientes sincronizados.`);
            return { success: true, count: rawCustomers.length };
        } catch (error) {
            console.error('Sync: Error sincronizando clientes:', error);
            return { success: true, count: 0 };
        }
    },

    /**
     * Sincroniza proveedores a IndexedDB y localDb
     */
    syncSuppliers: async () => {
        try {
            console.log('Sync: Starting supplier sync...');
            let rawSuppliers = [];
            try {
                const response = await api.get('/suppliers');
                rawSuppliers = Array.isArray(response.data) ? response.data : (response.data.suppliers || []);
            } catch (err) {
                if (err.response?.status === 401) {
                    try {
                        const initRes = await api.get('/sync/initial-adoption');
                        if (initRes.data?.suppliers) rawSuppliers = initRes.data.suppliers;
                    } catch (_e) {
                        const pullRes = await api.get('/sync/pull');
                        if (pullRes.data?.suppliers) rawSuppliers = pullRes.data.suppliers;
                    }
                }
            }

            if (rawSuppliers.length > 0) {
                await persistCollectionAtomically('suppliers', rawSuppliers, 'id');
            }

            console.log(`Sync: ${rawSuppliers.length} proveedores sincronizados.`);
            return { success: true, count: rawSuppliers.length };
        } catch (error) {
            console.warn('Sync: Proveedores no disponibles o vacíos:', error.message);
            return { success: true, count: 0 };
        }
    },

    /**
     * Sincroniza promociones y ofertas activas (2x1, combos, precios por volumen) a IndexedDB
     */
    syncPromotions: async () => {
        try {
            console.log('Sync: Starting promotions sync...');
            let rawPromos = [];
            try {
                const response = await api.get('/promotions');
                rawPromos = Array.isArray(response.data) ? response.data : (response.data?.promotions || []);
            } catch (err) {
                console.warn('Sync: Fallback getting promotions:', err.message);
            }

            if (rawPromos.length > 0) {
                try {
                    await persistCollectionAtomically('promotions', rawPromos, 'id');
                } catch (pErr) {
                    console.warn('[Sync] Advertencia al guardar promociones:', pErr);
                }
            }

            console.log(`Sync: ${rawPromos.length} promociones sincronizadas.`);
            return { success: true, count: rawPromos.length, promotions: rawPromos };
        } catch (error) {
            console.warn('Sync: Promociones no disponibles o vacías:', error.message);
            return { success: true, count: 0, promotions: [] };
        }
    },

    /**
     * Sincroniza configuraciones de empresa, monedas, tasas, impuestos y métodos de pago
     */
    syncSettings: async (forceRefresh = false) => {
        try {
            console.log('Sync: Starting settings sync...');
            const [busRes, taxRes, rateRes, payRes] = await Promise.allSettled([
                fetchBusinessSettingsCached(forceRefresh),
                fetchTaxSettingsCached(forceRefresh),
                fetchExchangeRateCached(forceRefresh),
                fetchPaymentMethodsCached(forceRefresh)
            ]);

            if (busRes.status === 'fulfilled' && busRes.value) {
                localStorage.setItem('pos_business_settings', JSON.stringify(busRes.value));
                if (busRes.value.businessMode) {
                    localStorage.setItem('pos_business_mode', busRes.value.businessMode);
                }
                if (busRes.value.country) {
                    localStorage.setItem('pos_country', busRes.value.country);
                }
            }

            if (taxRes.status === 'fulfilled' && taxRes.value) {
                localStorage.setItem('pos_tax_settings', JSON.stringify(taxRes.value));
            }

            if (rateRes.status === 'fulfilled' && rateRes.value) {
                const rateData = rateRes.value;
                const finalRate = rateData.rate || rateData.exchangeRate || 1.0;
                localStorage.setItem('pos_exchange_rate', String(finalRate));
                if (rateData.currencyMode) {
                    localStorage.setItem('pos_currency_mode', rateData.currencyMode);
                }
            } else {
                // Fallback Supabase Cloud para tasa 24/7 en Internet
                if (hasSupabaseConfig()) {
                    try {
                        const cloudRes = await fetch(getSupabaseRestUrl('cloud_configuracion?id=eq.general&select=*'), {
                            headers: getSupabaseHeaders()
                        });
                    if (cloudRes.ok) {
                        const cloudRows = await cloudRes.json();
                        if (Array.isArray(cloudRows) && cloudRows.length > 0 && cloudRows[0].tasa_cambio) {
                            const finalRate = Number(cloudRows[0].tasa_cambio);
                            localStorage.setItem('pos_exchange_rate', String(finalRate));
                            if (cloudRows[0].modo_moneda) {
                                localStorage.setItem('pos_currency_mode', cloudRows[0].modo_moneda);
                            }
                            console.log('Sync: Tasa de cambio sincronizada desde Supabase Cloud:', finalRate);
                        }
                    }
                    } catch (_cloudErr) {
                        console.warn('[SyncService] Fallback tasa Supabase Cloud no disponible:', _cloudErr?.message || _cloudErr);
                    }
                }
            }

            if (payRes.status === 'fulfilled' && Array.isArray(payRes.value)) {
                localStorage.setItem('pos_payment_methods', JSON.stringify(payRes.value));
            }

            console.log('Sync: Configuraciones y monedas sincronizadas exitosamente.');
            return { success: true };
        } catch (error) {
            console.warn('Sync: Error obteniendo configuraciones:', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * Sincroniza cajeros y usuarios públicos para inicio de sesión 100% offline
     */
    syncCashiers: async () => {
        try {
            console.log('Sync: Starting cashiers sync...');
            let cashiers = [];
            try {
                const res = await api.get('/auth/public-cashiers');
                cashiers = res.data && Array.isArray(res.data) ? res.data : [];
            } catch (_e) {
                try {
                    const initRes = await api.get('/sync/initial-adoption');
                    if (initRes.data?.cashiers) cashiers = initRes.data.cashiers;
                } catch (_e2) {
                    console.warn('[SyncService] Fallback cajeros initial-adoption no disponible:', _e2?.message || _e2);
                }
            }

            if (cashiers.length > 0) {
                localStorage.setItem('isaac_pos_cached_cashiers', JSON.stringify(cashiers));
            }
            console.log(`Sync: ${cashiers.length} cajeros cacheados para acceso offline.`);
            return { success: true, count: cashiers.length };
        } catch (error) {
            console.warn('Sync: Error obteniendo cajeros:', error.message);
            return { success: true, count: 0 };
        }
    },

    /**
     * Operación de Sincronización Inicial Profunda y Adopción de BD Local
     * Descarga catálogo, variantes, clientes, proveedores, configuraciones, usuarios
     * y TODAS las imágenes de los productos persistiendo en IndexedDB con callbacks de progreso.
     * 
     * @param {Object} options - { onProgress: fn }
     */
    performDeepInitialSync: async (options = {}) => {
        const { onProgress = null, skipImages = false } = options || {};
        console.log('🚀 [DeepSync] Iniciando Sincronización Inicial y Adopción de Base de Datos Local...');
        
        const notify = (data) => {
            if (onProgress) onProgress(data);
        };

        // 1. Sincronizar desfase de reloj
        notify({ phase: 'clock', message: 'Sincronizando reloj con el servidor...', percent: 5 });
        await syncService.syncClockDrift();

        // 2. Intentar Adopción Atómica por Endpoint Unificado (/sync/initial-adoption)
        let adoptionSuccess = false;
        let productsList = [];
        let custCount = 0;
        let suppCount = 0;
        let cashiersCount = 0;

        try {
            notify({ phase: 'bundle', message: 'Descargando base de datos completa del servidor...', percent: 15 });
            const activeCompany = localStorage.getItem('companyId') || '2';
            const adoptionRes = await api.get(`/sync/initial-adoption?companyId=${activeCompany}`);
            const data = adoptionRes.data;

            if (data && data.success && Array.isArray(data.products)) {
                if (data.companyId) {
                    localStorage.setItem('companyId', String(data.companyId));
                }
                const rawProducts = data.products;
                if (rawProducts.length === 0) {
                    await persistCollectionAtomically('products', [], 'id');
                    await db.replaceAllAtomic('categories', [], 'name');
                    localStorage.setItem('pos_categories', JSON.stringify(['Todas']));
                    try {
                        if (localDb && localDb.variants) await localDb.variants.clear();
                    } catch (err) {
                        console.warn('[Sync] Error limpiando variantes locales:', err?.message);
                    }
                    productsList = [];
                } else {
                    const formattedProducts = rawProducts.map(p => {
                        const stockVal = Number(p.stockQuantity !== undefined ? p.stockQuantity : (p.stock !== undefined ? p.stock : 0));
                        const priceVal = Number(p.price !== undefined ? p.price : (p.precio !== undefined ? p.precio : 0));
                        const nameVal = p.name || p.nombre || 'Producto';
                        const barcodeVal = p.barcode || p.codigo_barras || '';
                        const imageVal = p.imageUri || p.imageUrl || p.image || null;

                        return {
                            ...p,
                            id: p.id,
                            name: nameVal,
                            nombre: nameVal,
                            price: priceVal,
                            precio: priceVal,
                            stock: stockVal,
                            stockQuantity: stockVal,
                            barcode: barcodeVal,
                            codigo_barras: barcodeVal,
                            imageUri: imageVal,
                            imageUrl: imageVal,
                            category: p.category || p.categoria || 'General',
                            categoria: p.category || p.categoria || 'General',
                            taxStatus: p.taxStatus || 'gravable',
                            isSoldByWeight: Boolean(p.isSoldByWeight),
                            es_controlado: Boolean(p.es_controlado),
                            principio_activo: p.principio_activo || null
                        };
                    });

                    // Guardar productos en ambos IndexedDB de forma atómica con protección de stock offline
                    productsList = await persistProductsWithOfflineProtection(formattedProducts);

                    // Categorías
                    const uniqueCategories = [...new Set(formattedProducts.map(p => p.category).filter(Boolean))];
                    await db.replaceAllAtomic('categories', uniqueCategories.map(name => ({ name })), 'name');
                    localStorage.setItem('pos_categories', JSON.stringify(['Todas', ...uniqueCategories]));
                }

                // Guardar Clientes
                if (Array.isArray(data.customers)) {
                    await persistCollectionAtomically('customers', data.customers, 'id');
                    custCount = data.customers.length;
                }

                // Guardar Proveedores
                if (Array.isArray(data.suppliers)) {
                    await persistCollectionAtomically('suppliers', data.suppliers, 'id');
                    suppCount = data.suppliers.length;
                }

                // Guardar Cajeros
                if (Array.isArray(data.cashiers) && data.cashiers.length > 0) {
                    localStorage.setItem('isaac_pos_cached_cashiers', JSON.stringify(data.cashiers));
                    cashiersCount = data.cashiers.length;
                }

                // Guardar Ajustes
                if (data.settings) {
                    if (data.settings.business) {
                        localStorage.setItem('pos_business_settings', JSON.stringify(data.settings.business));
                    }
                    if (data.settings.taxes) {
                        localStorage.setItem('pos_tax_settings', JSON.stringify(data.settings.taxes));
                    }
                    const activeCompanyId = localStorage.getItem('companyId') || '2';
                    const matchedRate = data.settings[activeCompanyId]?.exchangeRate 
                        || data.settings['2']?.exchangeRate 
                        || data.settings['default']?.exchangeRate 
                        || data.settings['1']?.exchangeRate 
                        || data.settings?.exchangeRate 
                        || data.settings?.rate;
                    if (matchedRate) {
                        localStorage.setItem('pos_exchange_rate', String(matchedRate));
                    }
                }

                adoptionSuccess = true;
                notify({ 
                    phase: 'bundle_done', 
                    message: `Base de datos descargada: ${productsList.length} productos y ${custCount} clientes`, 
                    percent: 65 
                });
            }
        } catch (adoptErr) {
            console.warn('[DeepSync] Error al descargar paquete unificado, usando flujo paso a paso:', adoptErr.message);
        }

        // Fallback paso a paso si el paquete unificado no respondió
        if (!adoptionSuccess) {
            notify({ phase: 'products', message: 'Descargando catálogo de productos...', percent: 20 });
            const prodResult = await syncService.syncProducts();
            productsList = prodResult.products || [];

            notify({ phase: 'customers', message: 'Descargando clientes...', percent: 40 });
            const custResult = await syncService.syncCustomers();
            custCount = custResult.count;

            notify({ phase: 'suppliers', message: 'Descargando proveedores...', percent: 50 });
            const suppResult = await syncService.syncSuppliers();
            suppCount = suppResult.count;

            notify({ phase: 'promotions', message: 'Descargando promociones y ofertas...', percent: 55 });
            await syncService.syncPromotions();

            notify({ phase: 'settings', message: 'Configurando moneda y perfil de empresa...', percent: 60 });
            await syncService.syncSettings();

            notify({ phase: 'cashiers', message: 'Configurando cajeros para acceso offline...', percent: 70 });
            const cashierResult = await syncService.syncCashiers();
            cashiersCount = cashierResult.count;
        }

        // 7. Descarga y Persistencia de Imágenes (Optimizado para Alto Rendimiento)
        const isMobileDevice = typeof window !== 'undefined' && Boolean(
            !/Windows NT|Macintosh|Linux x86_64/i.test(navigator.userAgent) &&
            ((window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) || 
             window.location.protocol === 'capacitor:' || 
             /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))
        );

        let imageStats = { total: productsList.length, cached: productsList.length, alreadyCached: 0 };

        if (!skipImages && productsList.length > 0) {
            notify({ 
                phase: 'images_start', 
                message: 'Iniciando descarga y almacenamiento de imágenes en la base de datos local...', 
                percent: 70 
            });

            try {
                imageStats = await cacheAllProductImages(productsList, {
                    concurrency: isMobileDevice ? 6 : 8,
                    onProgress: (imgProgress) => {
                        const mappedPercent = 70 + Math.round((imgProgress.percent * 0.25));
                        notify({
                            phase: 'images',
                            message: `Descargando imágenes de productos: ${imgProgress.current} de ${imgProgress.total} (${imgProgress.percent}%)`,
                            ...imgProgress,
                            percent: mappedPercent
                        });
                    }
                });
            } catch (imgErr) {
                console.warn('[DeepSync] Error al descargar imágenes (no fatal):', imgErr);
            }
        } else {
            notify({ 
                phase: 'images_done', 
                message: 'Catálogo optimizado con aceleración de caché nativo (sin retrasos).', 
                stats: imageStats,
                percent: 95 
            });
        }

        // 8. Finalización y Adopción de la Base de Datos Local
        const timestamp = new Date().toISOString();
        await db.put('metadata', { key: SYNC_METADATA_KEY, value: timestamp });
        await db.put('metadata', { key: 'initial_mobile_sync_completed', value: 'true' });
        
        localStorage.setItem('isaac_pos_initial_sync_done', 'true');
        localStorage.setItem('initial_mobile_sync_completed', 'true');
        localStorage.setItem('initial_setup_completed', 'true');
        localStorage.setItem('last_sync_timestamp', timestamp);

        notify({ 
            phase: 'completed', 
            message: '¡Base de datos local y catálogo con imágenes adoptados exitosamente!', 
            percent: 100,
            summary: {
                products: productsList.length,
                customers: custCount,
                suppliers: suppCount,
                cashiers: cashiersCount,
                images: imageStats
            }
        });

        console.log('✅ [DeepSync] Sincronización Inicial Completada. Dispositivo 100% Autónomo.');

        return {
            success: true,
            timestamp,
            results: {
                products: { count: productsList.length, products: productsList },
                customers: { count: custCount },
                suppliers: { count: suppCount },
                cashiers: { count: cashiersCount },
                images: imageStats
            }
        };
    },

    /**
     * Sincronización Automática de Inicio de Sesión y Arranque (No bloqueante, ultrarrápida)
     * Se ejecuta automáticamente al colocar usuario/contraseña o al abrir el sistema.
     * Sincroniza catálogo completo, precios calculados, tasa de cambio, clientes, métodos de pago y ajustes.
     */
    autoSyncOnLogin: async (options = {}) => {
        if (!options.force && inFlightAutoSyncPromise) {
            return inFlightAutoSyncPromise;
        }
        if (!options.force && Date.now() - lastAutoSyncCompletedAt < 5000) {
            return { success: true, cached: true };
        }

        inFlightAutoSyncPromise = (async () => {
        try {
            const storedCompany = localStorage.getItem('companyId');
            const activeCompany = (storedCompany && storedCompany.length < 10 && storedCompany !== 'null' && storedCompany !== 'undefined') ? storedCompany : '2';
            if (activeCompany !== storedCompany) {
                localStorage.setItem('companyId', activeCompany);
            }
            
            // 1. Reloj con servidor
            syncService.syncClockDrift().catch(() => {});

            // 2. Descargar lote unificado atómico
            let adoptionSuccess = false;
            let productsList = [];
            try {
                const adoptionRes = await api.get(`/sync/initial-adoption?companyId=${activeCompany}`, { timeout: 12000 });
                const data = adoptionRes.data;

                if (data && data.success && Array.isArray(data.products)) {
                    if (data.companyId) {
                        localStorage.setItem('companyId', String(data.companyId));
                    }
                    const rawProducts = data.products;
                    if (rawProducts.length === 0) {
                        await persistCollectionAtomically('products', [], 'id');
                        await db.replaceAllAtomic('categories', [], 'name');
                        localStorage.setItem('pos_categories', JSON.stringify(['Todas']));
                        try {
                            if (localDb && localDb.variants) await localDb.variants.clear();
                        } catch (err) {
                            console.warn('[AutoSync] Error limpiando variantes locales:', err?.message);
                        }
                        productsList = [];
                    } else {
                        const formattedProducts = rawProducts.map(p => {
                            const stockVal = Number(p.stockQuantity !== undefined ? p.stockQuantity : (p.stock !== undefined ? p.stock : 0));
                            const priceVal = Number(p.price !== undefined ? p.price : (p.precio !== undefined ? p.precio : 0));
                            const nameVal = p.name || p.nombre || 'Producto';
                            const barcodeVal = p.barcode || p.codigo_barras || '';
                            const imageVal = p.imageUri || p.imageUrl || p.image || null;

                            return {
                                ...p,
                                id: p.id,
                                name: nameVal,
                                nombre: nameVal,
                                price: priceVal,
                                precio: priceVal,
                                stock: stockVal,
                                stockQuantity: stockVal,
                                barcode: barcodeVal,
                                codigo_barras: barcodeVal,
                                imageUri: imageVal,
                                imageUrl: imageVal,
                                category: p.category || p.categoria || 'General',
                                categoria: p.category || p.categoria || 'General',
                                taxStatus: p.taxStatus || 'gravable',
                                isSoldByWeight: Boolean(p.isSoldByWeight),
                                es_controlado: Boolean(p.es_controlado),
                                principio_activo: p.principio_activo || null
                            };
                        });

                        // Guardar productos en ambos IndexedDB de forma atómica con protección de stock offline
                        productsList = await persistProductsWithOfflineProtection(formattedProducts);

                        // Categorías
                        const uniqueCategories = [...new Set(formattedProducts.map(p => p.category).filter(Boolean))];
                        await db.replaceAllAtomic('categories', uniqueCategories.map(name => ({ name })), 'name');
                        localStorage.setItem('pos_categories', JSON.stringify(['Todas', ...uniqueCategories]));
                    }

                    // Clientes
                    if (Array.isArray(data.customers)) {
                        await persistCollectionAtomically('customers', data.customers, 'id');
                    }

                    // Proveedores
                    if (Array.isArray(data.suppliers)) {
                        await persistCollectionAtomically('suppliers', data.suppliers, 'id');
                    }

                    // Cajeros
                    if (Array.isArray(data.cashiers) && data.cashiers.length > 0) {
                        localStorage.setItem('isaac_pos_cached_cashiers', JSON.stringify(data.cashiers));
                    }

                    // Ajustes, Tasa y Negocio
                    if (data.settings) {
                        if (data.settings.business) {
                            localStorage.setItem('pos_business_settings', JSON.stringify(data.settings.business));
                        }
                        if (data.settings.taxes) {
                            localStorage.setItem('pos_tax_settings', JSON.stringify(data.settings.taxes));
                        }
                        const matchedRate = data.settings[activeCompany]?.exchangeRate 
                            || data.settings['2']?.exchangeRate 
                            || data.settings['default']?.exchangeRate 
                            || data.settings['1']?.exchangeRate 
                            || data.settings?.exchangeRate 
                            || data.settings?.rate;
                        if (matchedRate) {
                            localStorage.setItem('pos_exchange_rate', String(matchedRate));
                            db.put('metadata', { key: 'pos_exchange_rate', value: matchedRate }).catch((err) => {
                                console.warn('[AutoSync] Error guardando tasa en IDB:', err?.message);
                            });
                        }
                    }

                    adoptionSuccess = true;
                }
            } catch (bundleErr) {
                console.warn('[AutoSync] Error en paquete unificado, usando sincronización modular:', bundleErr.message);
            }

            // Fallback modular si no respondió el paquete unificado
            if (!adoptionSuccess) {
                const [prodRes] = await Promise.allSettled([
                    syncService.syncProducts(),
                    syncService.syncCustomers(),
                    syncService.syncSuppliers(),
                    syncService.syncPromotions(),
                    syncService.syncSettings(),
                    syncService.syncCashiers()
                ]);
                if (prodRes.status === 'fulfilled' && prodRes.value?.products) {
                    productsList = prodRes.value.products;
                }
            }

            // Descarga de imágenes en segundo plano asíncrono (no congela pantalla de login)
            const isMobileDevice = typeof window !== 'undefined' && Boolean(
                !/Windows NT|Macintosh|Linux x86_64/i.test(navigator.userAgent) &&
                ((window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) || 
                 window.location.protocol === 'capacitor:' || 
                 /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))
            );

            // Descarga incremental y persistencia de imágenes en segundo plano (SQLite WAL en Android + CacheStorage)
            // Salta instantáneamente las imágenes ya guardadas y cede el hilo en móvil para mantener 60/120 FPS.
            if (!options.skipImages && productsList.length > 0) {
                setTimeout(async () => {
                    try {
                        await cacheAllProductImages(productsList, {
                            concurrency: 2,
                            yieldMs: isMobileDevice ? 25 : 0
                        });
                    } catch (err) {
                        console.warn('[AutoSync] Error en precarga secundaria de imágenes:', err?.message);
                    }
                }, isMobileDevice ? 2000 : 4000);
            }

            const timestamp = new Date().toISOString();
            await db.put('metadata', { key: SYNC_METADATA_KEY, value: timestamp });
            localStorage.setItem('last_sync_timestamp', timestamp);
            localStorage.setItem('isaac_pos_initial_sync_done', 'true');
            lastAutoSyncCompletedAt = Date.now();

            window.dispatchEvent(new CustomEvent('pos-data-synced', { detail: { timestamp, count: productsList.length } }));
            console.log(`✅ [AutoSync] Sesión sincronizada con éxito: ${productsList.length} productos listos.`);
            return { success: true, count: productsList.length };
        } catch (err) {
            console.warn('[AutoSync] Conexión fuera de línea o error no fatal en sincronización:', err.message);
            return { success: false, error: err.message };
        } finally {
            inFlightAutoSyncPromise = null;
        }
        })();

        return inFlightAutoSyncPromise;
    },

    /**
     * Sincronización estándar rápida (usada desde SyncModal o periódica)
     */
    performFullSync: async (options = {}) => {
        return syncService.performDeepInitialSync(options);
    },

    /**
     * Obtiene la fecha y hora de la última sincronización
     */
    getLastSync: async () => {
        try {
            const meta = await db.getById('metadata', SYNC_METADATA_KEY);
            if (meta && meta.value) return meta.value;
        } catch (err) {
            console.warn('[Sync] Error leyendo última marca de sincronización:', err?.message);
        }
        return localStorage.getItem('last_sync_timestamp') || null;
    },

    /**
     * Estadísticas de sincronización en la nube
     */
    getCloudSyncStats: async () => {
        try {
            const response = await api.get('/sync/stats');
            return response.data;
        } catch (error) {
            console.debug('[Sync] Fallback de estado de sincronización:', error?.message);
            const isOfflineFlag = localStorage.getItem('isaac_pos_is_offline_mode') === 'true';
            if (isOfflineFlag) {
                return { stats: { PENDING: 0, SYNCED: 0, RETRYING: 0, FAILED: 0 }, isOnline: false };
            }
            try {
                const healthy = await checkServerHealth();
                return { stats: { PENDING: 0, SYNCED: 0, RETRYING: 0, FAILED: 0 }, isOnline: Boolean(healthy) };
            } catch (_) {
                return { stats: { PENDING: 0, SYNCED: 0, RETRYING: 0, FAILED: 0 }, isOnline: false };
            }
        }
    }
};

export default syncService;
