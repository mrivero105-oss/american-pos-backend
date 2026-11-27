import { describe, it, expect, vi, beforeEach } from 'vitest';
import VortexMathEngine from '../../src/utils/VortexMathEngine';
import { canonicalizeMobilePaymentMethod } from '../../src/hooks/mobile/useMobileCheckoutFlow';
import { getMobileRegisterId, getActiveMobileRegisterId, setTerminalId } from '../../src/utils/terminalIdentity';
import { db as primaryDb } from '../../src/services/db';

describe('Fase 1 — Integridad Financiera y Aritmética BigInt (VortexMathEngine)', () => {
  it('evita deriva IEEE-754 y soporta notación científica (1e-7, 2.5e3)', () => {
    expect(VortexMathEngine.add([0.1, 0.2])).toBe(0.3);
    expect(VortexMathEngine.multiply(19.99, 3)).toBe(59.97);
    expect(VortexMathEngine.add([1e-7, 1])).toBeCloseTo(1.0000001, 7);
    expect(VortexMathEngine.multiply('2.5e3', 2)).toBe(5000);
    expect(VortexMathEngine.divide(10, '2e1')).toBe(0.5);
    expect(VortexMathEngine.round(1.005, 2)).toBe(1.01);
  });

  it('rechaza entradas corruptas sin producir NaN silencioso', () => {
    expect(() => VortexMathEngine.toScaledBigInt('12abc')).toThrow();
    expect(VortexMathEngine.add(['abc', 5])).toBe(5);
  });

  it('normaliza métodos de pago multimoneda incluyendo Efectivo EUR y Binance USDT', () => {
    expect(canonicalizeMobilePaymentMethod('Efectivo EUR')).toBe('cash_eur');
    expect(canonicalizeMobilePaymentMethod('EUR')).toBe('cash_eur');
    expect(canonicalizeMobilePaymentMethod('Binance')).toBe('binance_usdt');
    expect(canonicalizeMobilePaymentMethod('Pago Móvil')).toBe('pago_movil');
    expect(canonicalizeMobilePaymentMethod('Crédito')).toBe('fiado');
  });
});

describe('Fase 1 — Identidad de Caja Única por Dispositivo Móvil y BD Local', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('genera registerId único MOB-XXXXXX por terminal y respeta turno legado abierto', () => {
    setTerminalId('TERM-AB12-CD34-EF99');
    expect(getMobileRegisterId()).toBe('MOB-34EF99');
    expect(getActiveMobileRegisterId()).toBe('MOB-34EF99');

    localStorage.setItem('pos_mobile_current_shift', JSON.stringify({
      id: 'shift-legacy-1',
      status: 'open',
      registerId: 'Caja Móvil'
    }));
    expect(getActiveMobileRegisterId()).toBe('Caja Móvil');
  });

  it('expone putBatch como alias de putAll en primaryDb', () => {
    expect(typeof primaryDb.putAll).toBe('function');
    expect(typeof primaryDb.putBatch).toBe('function');
  });
});

describe('Fase 1 — DAG de SyncManager (Orden Estricto, Reconciliación y Cortocircuito)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sube clientes y apertura antes que ventas, y cierre Z únicamente después de ventas', async () => {
    const callOrder = [];

    const { default: api } = await import('../../src/services/api');
    const { default: localDb } = await import('../../src/db/localDb');
    const { default: syncManager } = await import('../../src/services/syncManager');

    const queueStore = new Map([
      ['q_close', { id: 'q_close', endpoint: '/cash/close-blind', method: 'POST', payload: { shiftId: 'shift_off_1', declaration: { usd: 50 } }, createdAt: '2026-01-01T10:00:00Z' }],
      ['q_open', { id: 'q_open', tempLocalId: 'shift_off_1', endpoint: '/cash/open', method: 'POST', payload: { registerId: 'MOB-111111' }, createdAt: '2026-01-01T08:00:00Z' }],
      ['q_cust', { id: 'q_cust', tempLocalId: 'cust_off_1', endpoint: '/customers', method: 'POST', payload: { name: 'Ana Test' }, createdAt: '2026-01-01T08:05:00Z' }]
    ]);

    const pendingSales = [
      { id: 'sale_off_1', status: 'pending_sync', total: 25, customerId: 'cust_off_1', cashShiftId: 'shift_off_1', items: [] }
    ];

    vi.spyOn(primaryDb, 'getAll').mockImplementation(async (store) => {
      if (store === 'syncQueue') return Array.from(queueStore.values());
      if (store === 'sales') return [...pendingSales];
      return [];
    });
    vi.spyOn(primaryDb, 'getById').mockImplementation(async (store, id) => {
      if (store === 'syncQueue') return queueStore.get(id) || null;
      if (store === 'sales') return pendingSales.find(s => s.id === id) || null;
      return null;
    });
    vi.spyOn(primaryDb, 'getByIndex').mockResolvedValue([]);
    vi.spyOn(primaryDb, 'put').mockImplementation(async (store, obj) => {
      if (store === 'syncQueue') queueStore.set(obj.id, obj);
      return obj;
    });
    vi.spyOn(primaryDb, 'delete').mockImplementation(async (store, id) => {
      if (store === 'syncQueue') queueStore.delete(id);
    });

    vi.spyOn(localDb.customers, 'where').mockReturnValue({
      equals: () => ({ limit: () => ({ toArray: async () => [] }) })
    });
    vi.spyOn(localDb.customers, 'toArray').mockResolvedValue([]);
    vi.spyOn(localDb.customers, 'put').mockResolvedValue();
    vi.spyOn(localDb.customers, 'delete').mockResolvedValue();

    vi.spyOn(localDb.sales, 'where').mockReturnValue({
      equals: (status) => ({
        limit: () => ({ toArray: async () => (status === 'pending_sync' ? pendingSales.filter(s => s.status === 'pending_sync') : []) }),
        toArray: async () => (status === 'pending_sync' ? pendingSales.filter(s => s.status === 'pending_sync') : []),
        count: async () => pendingSales.filter(s => s.status === status).length
      }),
      anyOf: (ids) => ({
        modify: async (patch) => {
          pendingSales.forEach(s => {
            if (ids.includes(s.id)) Object.assign(s, patch);
          });
        }
      })
    });
    vi.spyOn(localDb.sales, 'update').mockImplementation(async (id, patch) => {
      const target = pendingSales.find(s => s.id === id);
      if (target) Object.assign(target, patch);
    });
    vi.spyOn(localDb, 'transaction').mockImplementation(async (_mode, _table, cb) => cb());

    vi.spyOn(api, 'post').mockImplementation(async (endpoint, payload) => {
      callOrder.push({ endpoint, payload });
      if (endpoint === '/customers') {
        return { status: 201, data: { customer: { id: 'cust-real-99', name: 'Ana Test' } } };
      }
      if (endpoint === '/cash/open') {
        return { status: 201, data: { shift: { id: 'shift-real-77', status: 'open', registerId: 'MOB-111111' } } };
      }
      if (endpoint === '/sales/public-sync') {
        return { status: 200, data: { details: { success: [{ id: 'sale_off_1' }], errors: [] } } };
      }
      if (endpoint === '/cash/close-blind') {
        return { status: 200, data: { success: true } };
      }
      return { status: 200, data: {} };
    });

    const result = await syncManager.executeBatchSync();

    expect(result.syncedSales).toBe(1);
    expect(result.syncedQueue).toBe(3);
    expect(callOrder.map(c => c.endpoint)).toEqual([
      '/customers',
      '/cash/open',
      '/sales/public-sync',
      '/cash/close-blind'
    ]);
    // Verificar que la reconciliación de shift_off_1 actualizó shiftId antes de enviar /cash/close-blind
    const closeCall = callOrder.find(c => c.endpoint === '/cash/close-blind');
    expect(closeCall.payload.shiftId).toBe('shift-real-77');
    // Verificar que la reconciliación de cust_off_1 actualizó customerId antes de enviar /sales/public-sync
    const saleCall = callOrder.find(c => c.endpoint === '/sales/public-sync');
    expect(saleCall.payload.sales[0].customerId).toBe('cust-real-99');
  });

  it('corta el lote inmediatamente ante error 503 sin iterar todos los ítems', async () => {
    const { default: api } = await import('../../src/services/api');
    const { default: syncManager } = await import('../../src/services/syncManager');

    const queueStore = new Map([
      ['q1', { id: 'q1', endpoint: '/customers', method: 'POST', payload: { name: 'C1' }, createdAt: '2026-01-01T08:00:00Z' }],
      ['q2', { id: 'q2', endpoint: '/customers', method: 'POST', payload: { name: 'C2' }, createdAt: '2026-01-01T08:01:00Z' }]
    ]);

    vi.spyOn(primaryDb, 'getAll').mockImplementation(async (store) => (store === 'syncQueue' ? Array.from(queueStore.values()) : []));
    vi.spyOn(primaryDb, 'getById').mockImplementation(async (store, id) => (store === 'syncQueue' ? queueStore.get(id) : null));
    const postSpy = vi.spyOn(api, 'post').mockRejectedValue({
      message: 'Service Unavailable',
      response: { status: 503 }
    });

    const res = await syncManager.executeBatchSync();
    expect(res.pausedByNetwork).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);
    syncManager.clearRetryTimer();
  });
});
