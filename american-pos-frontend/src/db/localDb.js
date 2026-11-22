/**
 * Adaptador Unificado de Base de Datos Local (Compatible con API Dexie)
 * Delega todas las operaciones al motor unificado (`src/services/db.js`: SQLite Nativo Android WAL + UnifiedDB)
 * con transacciones serializadas usando undo-log por deltas (O(k) sobre claves tocadas).
 */
import { db as unifiedDb } from '../services/db';

const STORE_KEY_FIELDS = {
    products: 'id',
    variants: 'id',
    customers: 'id',
    suppliers: 'id',
    sales: 'id',
    imageCache: 'uri',
    promotions: 'id',
    expenses: 'id',
    cashShifts: 'id',
    categories: 'name',
    metadata: 'key',
    syncQueue: 'id'
};

let txChain = Promise.resolve();
let activeUndoLog = null;

const cloneValue = (val) => {
    if (val === undefined || val === null) return val;
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(val);
    }
    return JSON.parse(JSON.stringify(val));
};

const extractKey = (storeName, item) => {
    const keyField = STORE_KEY_FIELDS[storeName] || 'id';
    return item?.[keyField] ?? item?.id ?? item?.uri ?? item?.name ?? item?.key;
};

async function recordSingleDelta(storeName, key) {
    if (!activeUndoLog || key === undefined || key === null) return;
    const prev = await unifiedDb.getById(storeName, key).catch(() => undefined);
    activeUndoLog.push({
        type: 'key',
        storeName,
        key,
        existed: prev !== undefined && prev !== null,
        prevItem: prev ? cloneValue(prev) : null
    });
}

async function txPut(storeName, item) {
    if (activeUndoLog) {
        const key = extractKey(storeName, item);
        await recordSingleDelta(storeName, key);
    }
    return await unifiedDb.put(storeName, item);
}

async function txPutAll(storeName, items = []) {
    if (activeUndoLog && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
            const key = extractKey(storeName, item);
            await recordSingleDelta(storeName, key);
        }
    }
    return await unifiedDb.putAll(storeName, items);
}

async function txDelete(storeName, id) {
    if (activeUndoLog) {
        await recordSingleDelta(storeName, id);
    }
    return await unifiedDb.delete(storeName, id);
}

async function txClear(storeName) {
    if (activeUndoLog) {
        const prevAll = await unifiedDb.getAll(storeName).catch(() => []);
        activeUndoLog.push({
            type: 'clear',
            storeName,
            prevItems: cloneValue(Array.isArray(prevAll) ? prevAll : [])
        });
    }
    return await unifiedDb.clear(storeName);
}

const createWhereClause = (storeName, fieldName) => {
    const matchItems = async (predicate) => {
        const all = await unifiedDb.getAll(storeName);
        return all.filter(predicate);
    };

    const buildCollection = (fetcher) => ({
        toArray: () => fetcher(),
        limit: (count) => buildCollection(async () => {
            const list = await fetcher();
            return Number.isFinite(count) && count >= 0 ? list.slice(0, count) : list;
        }),
        reverse: () => buildCollection(async () => {
            const list = await fetcher();
            return [...list].reverse();
        }),
        first: async () => {
            const list = await fetcher();
            return list[0] || undefined;
        },
        count: async () => {
            const list = await fetcher();
            return list.length;
        },
        delete: async () => {
            const list = await fetcher();
            let deleted = 0;
            for (const item of list) {
                const id = extractKey(storeName, item);
                if (id !== undefined && id !== null) {
                    await txDelete(storeName, id);
                    deleted++;
                }
            }
            return deleted;
        },
        modify: async (modifier) => {
            const list = await fetcher();
            const updated = [];
            for (const item of list) {
                const clone = { ...item };
                if (typeof modifier === 'function') {
                    modifier(clone);
                } else if (modifier && typeof modifier === 'object') {
                    Object.assign(clone, modifier);
                }
                updated.push(clone);
            }
            if (updated.length > 0) {
                await txPutAll(storeName, updated);
            }
            return updated.length;
        }
    });

    return {
        equals: (val) => buildCollection(() => {
            if (fieldName === 'status') {
                return unifiedDb.getByIndex(storeName, 'status', val);
            }
            return matchItems((item) => item?.[fieldName] === val || String(item?.[fieldName]) === String(val));
        }),
        anyOf: (vals = []) => {
            const set = new Set((Array.isArray(vals) ? vals : [vals]).map(v => String(v)));
            return buildCollection(() => matchItems((item) => set.has(String(item?.[fieldName]))));
        },
        startsWithIgnoreCase: (prefix = '') => {
            const clean = String(prefix).toLowerCase();
            return buildCollection(() => matchItems((item) => String(item?.[fieldName] || '').toLowerCase().startsWith(clean)));
        }
    };
};

const createUnifiedTable = (storeName, keyPath = 'id') => ({
    name: storeName,
    toArray: () => unifiedDb.getAll(storeName),
    get: (id) => unifiedDb.getById(storeName, id),
    put: (item) => txPut(storeName, item),
    add: (item) => txPut(storeName, item),
    bulkPut: (items) => txPutAll(storeName, items),
    bulkAdd: (items) => txPutAll(storeName, items),
    delete: (id) => txDelete(storeName, id),
    bulkDelete: async (ids = []) => {
        if (!Array.isArray(ids)) return;
        for (let i = 0; i < ids.length; i++) {
            await txDelete(storeName, ids[i]);
        }
    },
    clear: () => txClear(storeName),
    count: async () => {
        const all = await unifiedDb.getAll(storeName);
        return all.length;
    },
    update: async (id, changes = {}) => {
        const existing = await unifiedDb.getById(storeName, id);
        if (!existing) return 0;
        await txPut(storeName, { ...existing, ...changes });
        return 1;
    },
    where: (fieldName) => createWhereClause(storeName, fieldName),
    filter: (predicate) => ({
        toArray: async () => {
            const all = await unifiedDb.getAll(storeName);
            return all.filter(predicate);
        }
    }),
    orderBy: (fieldName) => {
        const sortAsc = (items) => [...items].sort((a, b) => {
            const va = a?.[fieldName] ?? '';
            const vb = b?.[fieldName] ?? '';
            return va > vb ? 1 : (va < vb ? -1 : 0);
        });
        const sortDesc = (items) => [...items].sort((a, b) => {
            const va = a?.[fieldName] ?? '';
            const vb = b?.[fieldName] ?? '';
            return va < vb ? 1 : (va > vb ? -1 : 0);
        });
        return {
            toArray: async () => sortAsc(await unifiedDb.getAll(storeName)),
            limit: (count) => ({
                toArray: async () => {
                    const sorted = sortAsc(await unifiedDb.getAll(storeName));
                    return Number.isFinite(count) && count >= 0 ? sorted.slice(0, count) : sorted;
                }
            }),
            reverse: () => ({
                toArray: async () => sortDesc(await unifiedDb.getAll(storeName)),
                limit: (count) => ({
                    toArray: async () => {
                        const sorted = sortDesc(await unifiedDb.getAll(storeName));
                        return Number.isFinite(count) && count >= 0 ? sorted.slice(0, count) : sorted;
                    }
                })
            })
        };
    },
    toCollection: () => ({
        toArray: () => unifiedDb.getAll(storeName),
        primaryKeys: async () => {
            const all = await unifiedDb.getAll(storeName);
            return all
                .map((item) => item?.[keyPath])
                .filter((k) => k !== undefined && k !== null);
        }
    })
});

const localDb = {
    products: createUnifiedTable('products', 'id'),
    variants: createUnifiedTable('variants', 'id'),
    customers: createUnifiedTable('customers', 'id'),
    suppliers: createUnifiedTable('suppliers', 'id'),
    sales: createUnifiedTable('sales', 'id'),
    imageCache: createUnifiedTable('imageCache', 'uri'),
    promotions: createUnifiedTable('promotions', 'id'),
    expenses: createUnifiedTable('expenses', 'id'),
    cashShifts: createUnifiedTable('cashShifts', 'id'),
    categories: createUnifiedTable('categories', 'name'),
    metadata: createUnifiedTable('metadata', 'key'),
    syncQueue: createUnifiedTable('syncQueue', 'id'),

    transaction: async (mode, ...args) => {
        const callback = args[args.length - 1];
        if (typeof callback !== 'function') return;

        const isWriteTx = typeof mode === 'string' && (mode.includes('w') || mode === 'readwrite');

        const runAtomic = async () => {
            const undoLog = isWriteTx ? [] : null;
            const prevActive = activeUndoLog;
            if (isWriteTx) {
                activeUndoLog = undoLog;
            }
            try {
                return await callback();
            } catch (txErr) {
                if (undoLog && undoLog.length > 0) {
                    for (let i = undoLog.length - 1; i >= 0; i--) {
                        const entry = undoLog[i];
                        try {
                            if (entry.type === 'clear') {
                                await unifiedDb.replaceAllAtomic(entry.storeName, entry.prevItems);
                            } else if (entry.existed && entry.prevItem) {
                                await unifiedDb.put(entry.storeName, entry.prevItem);
                            } else {
                                await unifiedDb.delete(entry.storeName, entry.key);
                            }
                        } catch (rbErr) {
                            console.warn(`[localDb] Error revertiendo delta en "${entry.storeName}":`, rbErr?.message || rbErr);
                        }
                    }
                }
                throw txErr;
            } finally {
                activeUndoLog = prevActive;
            }
        };

        const nextTx = txChain.then(runAtomic, runAtomic);
        txChain = nextTx.catch(() => {});
        return nextTx;
    },
    open: async () => localDb,
    isOpen: () => true,
    close: () => {}
};

export default localDb;
