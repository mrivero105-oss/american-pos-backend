import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db as primaryDb } from '../../src/services/db';
import localDb from '../../src/db/localDb';

const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();
const mockApiGet = vi.fn();

vi.mock('../../src/services/api', () => ({
    default: {
        defaults: { baseURL: 'http://127.0.0.1:3005' },
        post: (...args) => mockApiPost(...args),
        put: (...args) => mockApiPut(...args),
        delete: (...args) => mockApiDelete(...args),
        get: (...args) => mockApiGet(...args)
    }
}));

describe('SyncManager Offline Engine (Colas, Reconciliación y Cuarentena 4xx)', () => {
    beforeEach(async () => {
        mockApiPost.mockReset();
        mockApiPut.mockReset();
        mockApiDelete.mockReset();
        mockApiGet.mockReset();
        for (const s of ['sales', 'syncQueue', 'customers', 'products', 'cashShifts']) {
            await primaryDb.clear(s);
        }
    });

    it('envía ventas pendientes al backend y las marca como synced', async () => {
        const { syncManager } = await import('../../src/services/syncManager');
        syncManager.stopAutoSync();

        await localDb.sales.put({
            id: 'off_sale_100',
            total: 25.0,
            status: 'pending_sync',
            isOffline: true,
            items: [{ id: 'p1', productId: 'p1', quantity: 1, price: 25 }]
        });

        mockApiPost.mockResolvedValueOnce({
            status: 200,
            data: { details: { success: [{ id: 'off_sale_100' }], errors: [] } }
        });

        const res = await syncManager.executeBatchSync();
        expect(res.syncedSales).toBe(1);

        const updatedSale = await localDb.sales.get('off_sale_100');
        expect(updatedSale.status).toBe('synced');
        expect(updatedSale.isOffline).toBe(false);

        const pending = await syncManager.getPendingCount();
        expect(pending.total).toBe(0);
    });

    it('envía a cuarentena los 4xx de syncQueue tras 3 intentos fallidos sin perder la trazabilidad', async () => {
        const { syncManager } = await import('../../src/services/syncManager');
        const quarantinedEvents = [];
        const onQueueErr = (e) => quarantinedEvents.push(e.detail);
        window.addEventListener('sync-queue-error', onQueueErr);

        await primaryDb.put('syncQueue', {
            id: 'sq_bad_1',
            endpoint: '/customers',
            method: 'POST',
            payload: { name: 'Roto' },
            retryCount: 2,
            timestamp: Date.now()
        });

        mockApiPost.mockRejectedValueOnce({
            message: 'Request failed with status code 400',
            response: { status: 400, data: { error: 'Documento RIF inválido' } }
        });

        await syncManager.executeBatchSync();
        window.removeEventListener('sync-queue-error', onQueueErr);

        const itemAfter = await primaryDb.getById('syncQueue', 'sq_bad_1');
        expect(itemAfter.status).toBe('sync_error');
        expect(itemAfter.failedPermanent).toBe(true);
        expect(itemAfter.retryCount).toBe(3);
        expect(quarantinedEvents).toHaveLength(1);
        expect(quarantinedEvents[0].error).toBe('Documento RIF inválido');

        const counts = await syncManager.getPendingCount();
        expect(counts.queueCount).toBe(0);
        expect(counts.syncErrorCount).toBe(1);
        expect(counts.quarantinedCount).toBe(1);
    });

    it('reconcilia cliente temporal offline con ID real y actualiza ventas pendientes vinculadas', async () => {
        const { syncManager } = await import('../../src/services/syncManager');
        await localDb.customers.put({ id: 'cust_off_123', name: 'Carlos', idDocument: 'V12345', status: 'pending_sync' });
        await localDb.sales.put({ id: 'off_sale_cust', customerId: 'cust_off_123', total: 10, status: 'pending_sync' });

        await syncManager.reconcileOfflineCustomer(
            { name: 'Carlos', idDocument: 'V12345' },
            { id: '9001', name: 'Carlos', idDocument: 'V12345' },
            'cust_off_123'
        );

        expect(await localDb.customers.get('cust_off_123')).toBeNull();
        const realCust = await localDb.customers.get('9001');
        expect(realCust.name).toBe('Carlos');

        const updatedSale = await localDb.sales.get('off_sale_cust');
        expect(updatedSale.customerId).toBe('9001');
    });

    it('detiene auto-sync ante 401 preservando ventas en pending_sync y emitiendo auth-unauthorized', async () => {
        const { syncManager } = await import('../../src/services/syncManager');
        const unauthEvents = [];
        const onUnauth = (e) => unauthEvents.push(e.detail);
        window.addEventListener('auth-unauthorized', onUnauth);

        await localDb.sales.put({ id: 'off_sale_401', total: 15, status: 'pending_sync' });
        mockApiPost.mockRejectedValueOnce({ message: 'Unauthorized', response: { status: 401 } });

        const out = await syncManager.executeBatchSync();
        window.removeEventListener('auth-unauthorized', onUnauth);

        expect(out.unauthorized).toBe(true);
        expect(unauthEvents).toHaveLength(1);
        const keptSale = await localDb.sales.get('off_sale_401');
        expect(keptSale.status).toBe('pending_sync');
    });
});
