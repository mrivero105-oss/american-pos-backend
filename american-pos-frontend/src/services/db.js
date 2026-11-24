/**
 * Motor Unificado de Persistencia para Isaac POS (SQLite Nativo Android WAL + Fallback Web Zero-Lock)
 * - En Android Nativo (Capacitor): Opera directamente sobre SQLite C++ nativo (IsaacPosNativeStorage.db en modo WAL)
 *   mediante PosNativeHardwarePlugin, eliminando las limitaciones y bloqueos de IndexedDB.
 * - En Navegador Web / Desktop: Opera sobre una única base unificada (IsaacPosUnifiedDB) con caché en memoria
 *   y autocuración garantizada para todas las colecciones.
 * - Al iniciar, rescata cualquier venta pendiente de las antiguas bases de datos (IsaacPosDB / IsaacPOSPharmacyDB)
 *   y elimina las bases antiguas duplicadas.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ensureStoragePersistence } from './storagePersistence';

const UNIFIED_DB_NAME = 'IsaacPosUnifiedDB';
const UNIFIED_DB_VERSION = 1;
const LEGACY_DB_NAMES = ['IsaacPosDB', 'IsaacPOSPharmacyDB'];
const LEGACY_CLEANUP_FLAG = 'isaac_pos_legacy_idb_purged_v1';

const STORE_KEY_PATHS = {
    products: 'id',
    variants: 'id',
    customers: 'id',
    suppliers: 'id',
    categories: 'name',
    metadata: 'key',
    sales: 'id',
    syncQueue: 'id',
    imageCache: 'uri',
    promotions: 'id',
    expenses: 'id',
    cashShifts: 'id'
};

const ALL_STORES = Object.keys(STORE_KEY_PATHS);

// Espejo en memoria para lecturas instantáneas y tolerancia total a bloqueos entre pestañas
const memoryMirror = new Map();
ALL_STORES.forEach((storeName) => {
    memoryMirror.set(storeName, new Map());
});

const getMirrorMap = (storeName) => {
    if (!memoryMirror.has(storeName)) {
        memoryMirror.set(storeName, new Map());
    }
    return memoryMirror.get(storeName);
};

const getKeyPath = (storeName) => STORE_KEY_PATHS[storeName] || 'id';

const extractRecordKey = (storeName, item) => {
    if (!item || typeof item !== 'object') return null;
    const keyField = getKeyPath(storeName);
    let rawKey = item[keyField];
    if (rawKey === undefined || rawKey === null || rawKey === '') {
        if (storeName === 'sales' || storeName === 'syncQueue' || storeName === 'variants') {
            rawKey = `${storeName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            item[keyField] = rawKey;
        } else {
            return null;
        }
    }
    return String(rawKey);
};

const buildSearchText = (storeName, item) => {
    if (!item || typeof item !== 'object') return '';
    if (storeName === 'products') {
        return `${item.name || item.nombre || ''} ${item.barcode || item.codigo_barras || ''} ${item.category || item.categoria || ''}`.trim();
    }
    if (storeName === 'customers') {
        return `${item.name || ''} ${item.idDocument || item.cedula || ''}`.trim();
    }
    if (storeName === 'suppliers') {
        return `${item.name || ''} ${item.rif || ''}`.trim();
    }
    return String(item.name || item.key || item.id || '');
};

const getNativePlugin = () => {
    try {
        if (typeof window === 'undefined') return null;
        if (!Capacitor?.isNativePlatform || !Capacitor.isNativePlatform()) return null;
        if (window.__posNativeHardwarePlugin) return window.__posNativeHardwarePlugin;
        const plugin = registerPlugin('PosNativeHardware');
        window.__posNativeHardwarePlugin = plugin;
        return plugin;
    } catch (_) {
        return null;
    }
};

let nativeSqliteVerified = null; // null = unknown, true = active, false = unavailable

const isNativeSqliteAvailable = async () => {
    if (nativeSqliteVerified !== null) return nativeSqliteVerified;
    const plugin = getNativePlugin();
    if (!plugin || typeof plugin.sqliteGetStats !== 'function') {
        nativeSqliteVerified = false;
        return false;
    }
    try {
        const stats = await plugin.sqliteGetStats();
        nativeSqliteVerified = Boolean(stats && stats.engine === 'ANDROID_NATIVE_SQLITE_WAL');
        if (nativeSqliteVerified) {
            console.log('⚡ [SQLite Nativo] Motor Android SQLite WAL conectado exitosamente.');
        }
        return nativeSqliteVerified;
    } catch (_) {
        nativeSqliteVerified = false;
        return false;
    }
};

// ============================================================================
// MOTOR INDEXEDDB UNIFICADO (RESPALDO PARA SIMULADOR WEB / ESCRITORIO)
// ============================================================================
let dbInstance = null;
let initPromise = null;

const createAllStores = (db) => {
    if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'id' });
        productStore.createIndex('name', 'name', { unique: false });
        productStore.createIndex('barcode', 'barcode', { unique: false });
        productStore.createIndex('category', 'category', { unique: false });
    }
    if (!db.objectStoreNames.contains('variants')) {
        const variantStore = db.createObjectStore('variants', { keyPath: 'id', autoIncrement: true });
        variantStore.createIndex('producto_id', 'producto_id', { unique: false });
    }
    if (!db.objectStoreNames.contains('customers')) {
        const customerStore = db.createObjectStore('customers', { keyPath: 'id' });
        customerStore.createIndex('name', 'name', { unique: false });
        customerStore.createIndex('idDocument', 'idDocument', { unique: false });
        customerStore.createIndex('status', 'status', { unique: false });
    }
    if (!db.objectStoreNames.contains('suppliers')) {
        const supplierStore = db.createObjectStore('suppliers', { keyPath: 'id' });
        supplierStore.createIndex('name', 'name', { unique: false });
        supplierStore.createIndex('status', 'status', { unique: false });
    }
    if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'name' });
    }
    if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('sales')) {
        const salesStore = db.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
        salesStore.createIndex('status', 'status', { unique: false });
        salesStore.createIndex('timestamp', 'timestamp', { unique: false });
    }
    if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains('imageCache')) {
        db.createObjectStore('imageCache', { keyPath: 'uri' });
    }
    if (!db.objectStoreNames.contains('promotions')) {
        const promoStore = db.createObjectStore('promotions', { keyPath: 'id' });
        promoStore.createIndex('type', 'type', { unique: false });
        promoStore.createIndex('isActive', 'isActive', { unique: false });
    }
    if (!db.objectStoreNames.contains('expenses')) {
        const expenseStore = db.createObjectStore('expenses', { keyPath: 'id' });
        expenseStore.createIndex('status', 'status', { unique: false });
    }
    if (!db.objectStoreNames.contains('cashShifts')) {
        const shiftStore = db.createObjectStore('cashShifts', { keyPath: 'id' });
        shiftStore.createIndex('status', 'status', { unique: false });
    }
};

/**
 * Rescata cualquier venta o cola pendiente de las bases antiguas (IsaacPosDB / IsaacPOSPharmacyDB)
 * y luego elimina definitivamente ambas bases de datos heredadas.
 */
const migrateAndPurgeLegacyDatabases = async () => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
    if (localStorage.getItem(LEGACY_CLEANUP_FLAG) === 'true') return;

    const readLegacyStore = (dbName, storeName) => new Promise((resolve) => {
        try {
            const req = indexedDB.open(dbName);
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ ok: false, items: [] });
                }
            }, 2500);
            req.onsuccess = (ev) => {
                clearTimeout(timer);
                const legacyDb = ev.target.result;
                if (!legacyDb.objectStoreNames.contains(storeName)) {
                    try { legacyDb.close(); } catch { /* Conexión ya cerrada */ }
                    if (!settled) { settled = true; resolve({ ok: true, items: [] }); }
                    return;
                }
                try {
                    const tx = legacyDb.transaction(storeName, 'readonly');
                    const getAllReq = tx.objectStore(storeName).getAll();
                    getAllReq.onsuccess = () => {
                        const res = Array.isArray(getAllReq.result) ? getAllReq.result : [];
                        try { legacyDb.close(); } catch { /* Conexión ya cerrada */ }
                        if (!settled) { settled = true; resolve({ ok: true, items: res }); }
                    };
                    getAllReq.onerror = () => {
                        try { legacyDb.close(); } catch { /* Conexión ya cerrada */ }
                        if (!settled) { settled = true; resolve({ ok: false, items: [] }); }
                    };
                } catch {
                    try { legacyDb.close(); } catch { /* Conexión ya cerrada */ }
                    if (!settled) { settled = true; resolve({ ok: false, items: [] }); }
                }
            };
            req.onerror = () => {
                clearTimeout(timer);
                if (!settled) { settled = true; resolve({ ok: false, items: [] }); }
            };
        } catch (_) {
            resolve({ ok: false, items: [] });
        }
    });

    try {
        let allLegacyMigrated = true;
        for (const legacyName of LEGACY_DB_NAMES) {
            let migrationOk = true;
            const salesRead = await readLegacyStore(legacyName, 'sales');
            if (!salesRead.ok) migrationOk = false;
            const pendingSales = salesRead.items.filter(s => s && (s.status === 'pending_sync' || s.isOffline));
            for (const sale of pendingSales) {
                try {
                    await db.put('sales', sale);
                } catch (putErr) {
                    migrationOk = false;
                    console.warn(`[Storage Migration] Error migrando venta pendiente desde ${legacyName}:`, putErr?.message || putErr);
                }
            }

            const queueRead = await readLegacyStore(legacyName, 'syncQueue');
            if (!queueRead.ok) migrationOk = false;
            for (const qItem of queueRead.items) {
                try {
                    await db.put('syncQueue', qItem);
                } catch (qErr) {
                    migrationOk = false;
                    console.warn(`[Storage Migration] Error migrando syncQueue desde ${legacyName}:`, qErr?.message || qErr);
                }
            }

            if (migrationOk) {
                try {
                    indexedDB.deleteDatabase(legacyName);
                } catch (delErr) {
                    console.warn(`[Storage Migration] No se pudo eliminar ${legacyName}:`, delErr?.message || delErr);
                }
            } else {
                allLegacyMigrated = false;
                console.warn(`[Storage Migration] Se conserva ${legacyName} por error o timeout al migrar registros pendientes.`);
            }
        }
        if (allLegacyMigrated) {
            localStorage.setItem(LEGACY_CLEANUP_FLAG, 'true');
            console.log('🧹 [Storage Migration] Bases de datos antiguas de IndexedDB procesadas tras verificar migración.');
        }
    } catch (migErr) {
        console.warn('[Storage Migration] Error en limpieza de bases legadas:', migErr?.message || migErr);
    }
};

export const initDB = () => {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            initPromise = null;
            resolve(null);
            return;
        }

        const request = indexedDB.open(UNIFIED_DB_NAME, UNIFIED_DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            createAllStores(database);
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            dbInstance.onclose = () => {
                dbInstance = null;
                initPromise = null;
            };
            dbInstance.onversionchange = () => {
                try { dbInstance.close(); } catch { /* Cierre en cambio de versión */ }
                dbInstance = null;
                initPromise = null;
            };
            ensureStoragePersistence().catch(() => {});
            initPromise = null;
            // Ejecutar limpieza asíncrona de bases antiguas sin bloquear el arranque
            setTimeout(() => {
                migrateAndPurgeLegacyDatabases().catch(() => {});
            }, 300);
            resolve(dbInstance);
        };

        request.onerror = () => {
            initPromise = null;
            resolve(null);
        };
    });

    return initPromise;
};

const getStore = async (storeName, mode = 'readonly') => {
    const database = await initDB();
    if (!database || !database.objectStoreNames.contains(storeName)) {
        return null;
    }
    try {
        const transaction = database.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    } catch (_) {
        return null;
    }
};

const notifyQueueUpdated = (storeName, action) => {
    if (typeof window !== 'undefined' && (storeName === 'syncQueue' || storeName === 'sales')) {
        window.dispatchEvent(new CustomEvent('sync-queue-updated', { detail: { storeName, action } }));
    }
};

export const db = {
    isNativeSqlite: () => Boolean(nativeSqliteVerified),

    get: async (storeName, id) => db.getById(storeName, id),

    put: async (storeName, data) => {
        if (!data || typeof data !== 'object') return null;
        const recordKey = extractRecordKey(storeName, data);
        const commitMirror = () => {
            // imageCache usa su propio caché LRU acotado en imageCache.js para no saturar RAM
            if (recordKey && storeName !== 'imageCache') {
                const mirror = getMirrorMap(storeName);
                mirror.set(recordKey, data);
            }
        };

        if (await isNativeSqliteAvailable()) {
            const plugin = getNativePlugin();
            await plugin.sqlitePut({
                storeName,
                recordId: recordKey || String(Date.now()),
                jsonPayload: JSON.stringify(data),
                status: String(data.status || ''),
                searchText: buildSearchText(storeName, data)
            });
            commitMirror();
            notifyQueueUpdated(storeName, 'put');
            return data[getKeyPath(storeName)] ?? recordKey;
        }

        const store = await getStore(storeName, 'readwrite');
        if (!store) {
            commitMirror();
            notifyQueueUpdated(storeName, 'put');
            return recordKey;
        }
        return new Promise((resolve, reject) => {
            try {
                const request = store.put(data);
                request.onsuccess = () => {
                    commitMirror();
                    notifyQueueUpdated(storeName, 'put');
                    resolve(request.result);
                };
                request.onerror = () => reject(request.error || new Error(`IndexedDB put error en ${storeName}`));
            } catch (putErr) {
                reject(putErr);
            }
        });
    },

    putAll: async (storeName, items = []) => {
        const safeItems = Array.isArray(items) ? items : [];
        if (safeItems.length === 0) return;

        const mirror = getMirrorMap(storeName);
        const preparedRecords = [];

        for (let i = 0; i < safeItems.length; i++) {
            const item = safeItems[i];
            if (!item || typeof item !== 'object') continue;
            const k = extractRecordKey(storeName, item);
            if (!k) continue;
            mirror.set(k, item);
            preparedRecords.push({
                k,
                v: JSON.stringify(item),
                s: String(item.status || ''),
                q: buildSearchText(storeName, item)
            });
        }

        if (await isNativeSqliteAvailable()) {
            const plugin = getNativePlugin();
            await plugin.sqlitePutBatch({
                storeName,
                records: preparedRecords
            });
            notifyQueueUpdated(storeName, 'putAll');
            return;
        }

        const database = await initDB();
        if (!database || !database.objectStoreNames.contains(storeName)) return;

        return new Promise((resolve) => {
            try {
                const transaction = database.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                for (let i = 0; i < safeItems.length; i++) {
                    if (safeItems[i] && typeof safeItems[i] === 'object') {
                        store.put(safeItems[i]);
                    }
                }
                transaction.oncomplete = () => {
                    notifyQueueUpdated(storeName, 'putAll');
                    resolve();
                };
                transaction.onerror = () => resolve();
            } catch (_) {
                resolve();
            }
        });
    },

    /**
     * Reemplaza o actualiza el contenido de una tabla en una ÚNICA transacción ACID
     * (tanto en SQLite Nativo Android como en el motor unificado web).
     */
    replaceAllAtomic: async (storeName, items = [], keyPath = null) => {
        const safeItems = Array.isArray(items) ? items : [];
        const resolvedKeyPath = keyPath || getKeyPath(storeName);
        const mirror = getMirrorMap(storeName);
        mirror.clear();

        const preparedRecords = [];
        const incomingKeys = new Set();

        for (let i = 0; i < safeItems.length; i++) {
            const item = safeItems[i];
            if (!item || typeof item !== 'object') continue;
            const rawKey = item[resolvedKeyPath] ?? extractRecordKey(storeName, item);
            if (rawKey === undefined || rawKey === null) continue;
            const k = String(rawKey);
            incomingKeys.add(rawKey);
            incomingKeys.add(k);
            mirror.set(k, item);
            preparedRecords.push({
                k,
                v: JSON.stringify(item),
                s: String(item.status || ''),
                q: buildSearchText(storeName, item)
            });
        }

        if (await isNativeSqliteAvailable()) {
            const plugin = getNativePlugin();
            await plugin.sqliteReplaceAllAtomic({
                storeName,
                records: preparedRecords
            });
            return;
        }

        const database = await initDB();
        if (!database || !database.objectStoreNames.contains(storeName)) return;

        return new Promise((resolve) => {
            try {
                const transaction = database.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);

                if (safeItems.length === 0) {
                    store.clear();
                } else {
                    const keysReq = store.getAllKeys();
                    keysReq.onsuccess = () => {
                        const existingKeys = keysReq.result || [];
                        for (let i = 0; i < existingKeys.length; i++) {
                            const existingKey = existingKeys[i];
                            if (!incomingKeys.has(existingKey) && !incomingKeys.has(String(existingKey))) {
                                store.delete(existingKey);
                            }
                        }
                        for (let i = 0; i < safeItems.length; i++) {
                            store.put(safeItems[i]);
                        }
                    };
                    keysReq.onerror = () => {
                        store.clear();
                        for (let i = 0; i < safeItems.length; i++) {
                            store.put(safeItems[i]);
                        }
                    };
                }

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => resolve();
            } catch (_) {
                resolve();
            }
        });
    },

    getAll: async (storeName) => {
        const mirror = getMirrorMap(storeName);

        if (await isNativeSqliteAvailable()) {
            try {
                const plugin = getNativePlugin();
                const res = await plugin.sqliteGetAll({ storeName });
                if (res && typeof res.jsonArray === 'string') {
                    const parsed = JSON.parse(res.jsonArray);
                    if (Array.isArray(parsed)) {
                        mirror.clear();
                        for (let i = 0; i < parsed.length; i++) {
                            const k = extractRecordKey(storeName, parsed[i]);
                            if (k) mirror.set(k, parsed[i]);
                        }
                        return parsed;
                    }
                }
            } catch (sqlErr) {
                console.warn(`[DB] Native sqliteGetAll fallo (${storeName}):`, sqlErr?.message);
            }
            return Array.from(mirror.values());
        }

        const store = await getStore(storeName, 'readonly');
        if (!store) {
            return Array.from(mirror.values());
        }
        return new Promise((resolve) => {
            try {
                const request = store.getAll();
                request.onsuccess = () => {
                    const list = Array.isArray(request.result) ? request.result : [];
                    mirror.clear();
                    for (let i = 0; i < list.length; i++) {
                        const k = extractRecordKey(storeName, list[i]);
                        if (k) mirror.set(k, list[i]);
                    }
                    resolve(list);
                };
                request.onerror = () => resolve(Array.from(mirror.values()));
            } catch (_) {
                resolve(Array.from(mirror.values()));
            }
        });
    },

    getById: async (storeName, id) => {
        if (id === undefined || id === null) return null;
        const keyStr = String(id);
        const useMirror = storeName !== 'imageCache';
        const mirror = useMirror ? getMirrorMap(storeName) : null;
        if (useMirror && mirror.has(keyStr)) {
            return mirror.get(keyStr);
        }

        if (await isNativeSqliteAvailable()) {
            try {
                const plugin = getNativePlugin();
                const res = await plugin.sqliteGetById({ storeName, recordId: keyStr });
                if (res && res.jsonPayload) {
                    const parsed = JSON.parse(res.jsonPayload);
                    if (useMirror) mirror.set(keyStr, parsed);
                    return parsed;
                }
            } catch (sqlErr) {
                console.warn(`[DB] Native sqliteGetById fallo (${storeName}):`, sqlErr?.message);
            }
            return null;
        }

        const store = await getStore(storeName, 'readonly');
        if (!store) return null;
        return new Promise((resolve) => {
            try {
                const request = store.get(id);
                request.onsuccess = () => {
                    if (request.result) {
                        if (useMirror) mirror.set(keyStr, request.result);
                        resolve(request.result);
                        return;
                    }
                    // Intentar búsqueda por clave numérica o string alternativo
                    const altId = typeof id === 'string' && !isNaN(Number(id)) ? Number(id) : String(id);
                    const altReq = store.get(altId);
                    altReq.onsuccess = () => {
                        if (altReq.result && useMirror) mirror.set(keyStr, altReq.result);
                        resolve(altReq.result || null);
                    };
                    altReq.onerror = () => resolve(null);
                };
                request.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
    },

    clear: async (storeName) => {
        getMirrorMap(storeName).clear();

        if (await isNativeSqliteAvailable()) {
            try {
                const plugin = getNativePlugin();
                await plugin.sqliteClear({ storeName });
            } catch (sqlErr) {
                console.warn(`[DB] Native sqliteClear fallo (${storeName}):`, sqlErr?.message);
            }
            notifyQueueUpdated(storeName, 'clear');
            return;
        }

        const store = await getStore(storeName, 'readwrite');
        if (!store) return;
        return new Promise((resolve) => {
            try {
                const request = store.clear();
                request.onsuccess = () => {
                    notifyQueueUpdated(storeName, 'clear');
                    resolve();
                };
                request.onerror = () => resolve();
            } catch (_) {
                resolve();
            }
        });
    },

    delete: async (storeName, id) => {
        if (id === undefined || id === null) return;
        const keyStr = String(id);
        getMirrorMap(storeName).delete(keyStr);

        if (await isNativeSqliteAvailable()) {
            try {
                const plugin = getNativePlugin();
                await plugin.sqliteDelete({ storeName, recordId: keyStr });
            } catch (sqlErr) {
                console.warn(`[DB] Native sqliteDelete fallo (${storeName}):`, sqlErr?.message);
            }
            notifyQueueUpdated(storeName, 'delete');
            return;
        }

        const store = await getStore(storeName, 'readwrite');
        if (!store) {
            notifyQueueUpdated(storeName, 'delete');
            return;
        }
        return new Promise((resolve) => {
            try {
                const request = store.delete(id);
                request.onsuccess = () => {
                    if (typeof id === 'string' && !isNaN(Number(id))) {
                        try { store.delete(Number(id)); } catch { /* Clave numérica opcional inexistente */ }
                    }
                    notifyQueueUpdated(storeName, 'delete');
                    resolve();
                };
                request.onerror = () => resolve();
            } catch {
                resolve();
            }
        });
    },

    search: async (storeName, indexName, value) => {
        const needle = String(value || '').toLowerCase();
        const all = await db.getAll(storeName);
        return all.filter((item) => {
            const fieldVal = String(item?.[indexName] || '').toLowerCase();
            return fieldVal.startsWith(needle) || fieldVal.includes(needle);
        });
    },

    getByIndex: async (storeName, indexName, value) => {
        if (await isNativeSqliteAvailable()) {
            if (indexName === 'status') {
                try {
                    const plugin = getNativePlugin();
                    const res = await plugin.sqliteGetByStatus({ storeName, status: String(value) });
                    if (res && typeof res.jsonArray === 'string') {
                        return JSON.parse(res.jsonArray);
                    }
                } catch (sqlErr) {
                    console.warn(`[DB] Native sqliteGetByStatus fallo (${storeName}):`, sqlErr?.message);
                }
            }
            const allNative = await db.getAll(storeName);
            return allNative.filter(item => item?.[indexName] === value);
        }

        const store = await getStore(storeName, 'readonly');
        if (store && store.indexNames && store.indexNames.contains(indexName)) {
            return new Promise((resolve) => {
                try {
                    const index = store.index(indexName);
                    const request = index.getAll(value);
                    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
                    request.onerror = async () => {
                        const all = await db.getAll(storeName);
                        resolve(all.filter(item => item?.[indexName] === value));
                    };
                } catch (_) {
                    resolve([]);
                }
            });
        }

        const all = await db.getAll(storeName);
        return all.filter(item => item?.[indexName] === value);
    }
};

export default db;
