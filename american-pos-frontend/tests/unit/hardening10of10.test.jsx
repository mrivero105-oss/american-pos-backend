import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatServerUrl } from '../../src/services/api';
import { persistCollectionAtomically, getPendingOfflineStockDeductions } from '../../src/services/syncService';
import unifiedDb from '../../src/services/db';

describe('Hardening 10/10 Frontend Regressions', () => {
    beforeEach(async () => {
        localStorage.clear();
        sessionStorage.clear();
        await unifiedDb.clear('products');
        await unifiedDb.clear('customers');
        await unifiedDb.clear('sales');
    });

    it('formatServerUrl preserva https:// explícito sin forzar :3005 y agrega http://+puerto solo a hosts sin esquema', () => {
        expect(formatServerUrl('https://pos.miempresa.com')).toBe('https://pos.miempresa.com');
        expect(formatServerUrl('https://pos.miempresa.com:8443/')).toBe('https://pos.miempresa.com:8443');
        expect(formatServerUrl('192.168.1.50')).toBe('http://192.168.1.50:3005');
        expect(formatServerUrl('192.168.1.50:3010')).toBe('http://192.168.1.50:3010');
    });

    it('persistCollectionAtomically preserva registros offline pendientes (off_prod_ / cust_off_ / isOffline) al sincronizar catálogo', async () => {
        await unifiedDb.put('products', {
            id: 'off_prod_999',
            name: 'Producto Creado Offline',
            price: 10,
            isOffline: true
        });
        await unifiedDb.put('products', {
            id: 'srv_old_1',
            name: 'Producto Viejo del Servidor',
            price: 5
        });

        await persistCollectionAtomically('products', [
            { id: 'srv_new_1', name: 'Producto Nuevo Servidor', price: 8 }
        ]);

        const stored = await unifiedDb.getAll('products');
        const ids = stored.map((p) => p.id);
        expect(ids).toContain('srv_new_1');
        expect(ids).toContain('off_prod_999');
        expect(ids).not.toContain('srv_old_1');
    });

    it('getPendingOfflineStockDeductions deduce correctamente tanto item.productId como item.product.id', async () => {
        await unifiedDb.put('sales', {
            id: 'sale-off-1',
            status: 'pending_sync',
            items: [
                { productId: 'prod-A', quantity: 2 },
                { product: { id: 'prod-B' }, quantity: 3 }
            ]
        });

        const deductions = await getPendingOfflineStockDeductions();
        expect(deductions.get('prod-A')).toBe(2);
        expect(deductions.get('prod-B')).toBe(3);
    });

    it('getPendingOfflineStockDeductions ignora ventas ya sincronizadas y evita sobre-deducción', async () => {
        vi.restoreAllMocks();
        await unifiedDb.put('sales', {
            id: 'sale-off-single',
            status: 'pending_sync',
            items: [{ productId: 'prod-X', quantity: 4 }]
        });
        await unifiedDb.put('sales', {
            id: 'sale-synced-1',
            status: 'synced',
            items: [{ productId: 'prod-X', quantity: 10 }]
        });
        const deductions = await getPendingOfflineStockDeductions();
        expect(deductions.get('prod-X')).toBe(4);
    });
});
