import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/services/db';
import localDb from '../../src/db/localDb';

const EXPECTED_STORES = [
    'products',
    'variants',
    'customers',
    'suppliers',
    'categories',
    'metadata',
    'sales',
    'syncQueue',
    'imageCache',
    'promotions',
    'expenses',
    'cashShifts'
];

function keyFieldFor(store) {
    if (store === 'categories') return 'name';
    if (store === 'metadata') return 'key';
    if (store === 'imageCache') return 'uri';
    return 'id';
}

describe('IsaacPosUnifiedDB + localDb (fake-indexeddb real)', () => {
    beforeEach(async () => {
        for (const store of EXPECTED_STORES) {
            await db.clear(store);
        }
    });

    it('declara y opera CRUD real en los 12 stores unificados', async () => {
        for (const store of EXPECTED_STORES) {
            const kf = keyFieldFor(store);
            const record = {
                title: `Item ${store}`,
                name: `Item ${store}`,
                [kf]: `${store}_rec_1`,
                status: 'pending_sync',
                total: 12.5
            };
            await db.put(store, record);
            const loaded = await db.getById(store, `${store}_rec_1`);
            expect(loaded).toBeTruthy();
            expect(loaded[kf]).toBe(`${store}_rec_1`);

            const list = await db.getAll(store);
            expect(list).toHaveLength(1);
        }

        const byIdx = await db.getByIndex('sales', 'status', 'pending_sync');
        expect(byIdx).toHaveLength(1);
        expect(byIdx[0].id).toBe('sales_rec_1');

        const hits = await db.search('products', 'name', 'Item products');
        expect(hits).toHaveLength(1);

        await db.delete('products', 'products_rec_1');
        expect(await db.getById('products', 'products_rec_1')).toBeNull();
    });

    it('reemplaza colecciones atómicamente con replaceAllAtomic', async () => {
        await db.putAll('categories', [{ name: 'Bebidas' }, { name: 'Obsoleta' }]);
        await db.replaceAllAtomic('categories', [{ name: 'Víveres' }, { name: 'Lácteos' }], 'name');

        const all = await db.getAll('categories');
        const names = all.map(c => c.name).sort();
        expect(names).toEqual(['Lácteos', 'Víveres']);
    });

    it('ejecuta rollback O(k) real en localDb.transaction ante fallo parcial sin perder registros intactos', async () => {
        await localDb.products.put({ id: 'p_keep', name: 'Harina', stockQuantity: 10 });
        await localDb.products.put({ id: 'p_intact', name: 'Café Intacto', stockQuantity: 99 });
        await localDb.sales.put({ id: 's_existing', total: 5, status: 'synced' });

        await expect(
            localDb.transaction('rw', localDb.products, localDb.sales, async () => {
                await localDb.products.update('p_keep', { stockQuantity: 3 });
                await localDb.sales.put({ id: 's_aborted', total: 40, status: 'pending_sync' });
                throw new Error('Fallo simulado mitad de transacción');
            })
        ).rejects.toThrow('Fallo simulado mitad de transacción');

        const revertedKeep = await localDb.products.get('p_keep');
        expect(revertedKeep.stockQuantity).toBe(10);

        const abortedSale = await localDb.sales.get('s_aborted');
        expect(abortedSale).toBeNull();

        const intactProd = await localDb.products.get('p_intact');
        expect(intactProd.stockQuantity).toBe(99);

        const existingSale = await localDb.sales.get('s_existing');
        expect(existingSale).toBeTruthy();
    });

    it('soporta rollback de clear() dentro de localDb.transaction', async () => {
        await localDb.promotions.bulkPut([
            { id: 'pr1', name: '2x1 Refresco', isActive: true },
            { id: 'pr2', name: '10% Efectivo', isActive: true }
        ]);

        await expect(
            localDb.transaction('rw', localDb.promotions, async () => {
                await localDb.promotions.clear();
                throw new Error('Abortar luego de clear');
            })
        ).rejects.toThrow('Abortar luego de clear');

        const restored = await localDb.promotions.toArray();
        expect(restored.map(r => r.id).sort()).toEqual(['pr1', 'pr2']);
    });
});
