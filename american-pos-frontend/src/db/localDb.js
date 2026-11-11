/**
 * Adaptador Unificado de Base de Datos Local (Compatible con API Dexie)
 * Reemplaza la antigua base de datos duplicada 'IsaacPOSPharmacyDB' delegando todas las
 * operaciones al motor unificado de persistencia (`src/services/db.js`: SQLite Nativo Android WAL + UnifiedDB).
 */
import { db as unifiedDb } from '../services/db';

const createWhereClause = (storeName, fieldName) => {
    const matchItems = async (predicate) => {
        const all = await unifiedDb.getAll(storeName);
        return all.filter(predicate);
    };

    const buildCollection = (fetcher) => ({
        toArray: () => fetcher(),
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
                const id = item?.id ?? item?.uri ?? item?.name ?? item?.key;
                if (id !== undefined && id !== null) {
                    await unifiedDb.delete(storeName, id);
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
                await unifiedDb.putAll(storeName, updated);
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
    put: (item) => unifiedDb.put(storeName, item),
    add: (item) => unifiedDb.put(storeName, item),
    bulkPut: (items) => unifiedDb.putAll(storeName, items),
    bulkAdd: (items) => unifiedDb.putAll(storeName, items),
    delete: (id) => unifiedDb.delete(storeName, id),
    bulkDelete: async (ids = []) => {
        if (!Array.isArray(ids)) return;
        for (let i = 0; i < ids.length; i++) {
            await unifiedDb.delete(storeName, ids[i]);
        }
    },
    clear: () => unifiedDb.clear(storeName),
    count: async () => {
        const all = await unifiedDb.getAll(storeName);
        return all.length;
    },
    update: async (id, changes = {}) => {
        const existing = await unifiedDb.getById(storeName, id);
        if (!existing) return 0;
        await unifiedDb.put(storeName, { ...existing, ...changes });
        return 1;
    },
    where: (fieldName) => createWhereClause(storeName, fieldName),
    filter: (predicate) => ({
        toArray: async () => {
            const all = await unifiedDb.getAll(storeName);
            return all.filter(predicate);
        }
    }),
    orderBy: (fieldName) => ({
        toArray: async () => {
            const all = await unifiedDb.getAll(storeName);
            return [...all].sort((a, b) => (a?.[fieldName] > b?.[fieldName] ? 1 : -1));
        },
        reverse: () => ({
            toArray: async () => {
                const all = await unifiedDb.getAll(storeName);
                return [...all].sort((a, b) => (a?.[fieldName] < b?.[fieldName] ? 1 : -1));
            }
        })
    }),
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

    transaction: async (_mode, ...args) => {
        const callback = args[args.length - 1];
        if (typeof callback === 'function') {
            return await callback();
        }
    },
    open: async () => localDb,
    isOpen: () => true,
    close: () => {}
};

export default localDb;
