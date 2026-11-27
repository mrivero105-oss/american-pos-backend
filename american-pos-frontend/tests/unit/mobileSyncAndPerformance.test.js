import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIo, mockSocketHandlers, mockSocket, mockDbProducts, mockDbMetadata } = vi.hoisted(() => {
  const handlers = {};
  const socket = {
    id: 'sock-self-1',
    connected: true,
    active: true,
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(() => {
      socket.connected = false;
      socket.active = false;
    })
  };
  const productsMap = new Map();
  const metadataMap = new Map();

  return {
    mockIo: vi.fn(() => {
      socket.connected = true;
      socket.active = true;
      return socket;
    }),
    mockSocketHandlers: handlers,
    mockSocket: socket,
    mockDbProducts: productsMap,
    mockDbMetadata: metadataMap
  };
});

vi.mock('socket.io-client', () => ({
  io: mockIo
}));

vi.mock('../../src/services/api', () => ({
  default: {
    defaults: { baseURL: 'http://192.168.1.10:3005' },
    get: vi.fn().mockResolvedValue({ data: { success: true, peers: [], clusterSize: 1 } })
  }
}));

vi.mock('../../src/db/localDb', () => ({
  default: {
    products: {
      get: vi.fn(async (id) => mockDbProducts.get(String(id)) || null),
      where: vi.fn(() => ({
        equals: () => ({ first: async () => null })
      })),
      update: vi.fn(async (id, patch) => {
        const key = String(id);
        const cur = mockDbProducts.get(key);
        if (cur) mockDbProducts.set(key, { ...cur, ...patch });
      })
    },
    sales: {
      put: vi.fn().mockResolvedValue(undefined)
    }
  }
}));

vi.mock('../../src/services/db', () => ({
  db: {
    getById: vi.fn(async (store, key) => {
      if (store === 'metadata') return mockDbMetadata.get(String(key)) || null;
      return null;
    }),
    put: vi.fn(async (store, doc) => {
      if (store === 'metadata' && doc?.key) {
        mockDbMetadata.set(String(doc.key), doc);
      }
    })
  }
}));

vi.mock('../../src/utils/secureMobileStorage', () => ({
  default: {
    getToken: vi.fn(() => 'jwt-token-test'),
    getUserProfile: vi.fn(() => ({ id: 'u-1', companyId: '2' }))
  }
}));

import api from '../../src/services/api';
import lanSyncService from '../../src/services/lanSyncService';
import { cacheImage, resetImageCacheRuntimeForTests } from '../../src/services/imageCache';
import { useMobilePosStore } from '../../src/store/useMobilePosStore';

describe('Fase M4 — Sincronización LAN, Caché de Imágenes y Store Móvil', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbProducts.clear();
    mockDbMetadata.clear();
    localStorage.clear();
    lanSyncService.stop();
    api.defaults.baseURL = 'http://192.168.1.10:3005';
    localStorage.setItem('pos_terminal_id', 'Caja-Movil-A');
    localStorage.setItem('isaac_pos_node_role', 'client');
  });

  it('lanSyncService ignora su propio eco lan_stock_update y aplica factorConversion de otros nodos', async () => {
    mockDbProducts.set('prod-1', { id: 'prod-1', name: 'Refresco', stockQuantity: 50, stock: 50 });

    lanSyncService.init();
    expect(mockIo).toHaveBeenCalledWith('http://192.168.1.10:3005', expect.any(Object));
    expect(typeof mockSocketHandlers.lan_stock_update).toBe('function');

    // Eco de la misma terminal -> NO debe descontar
    await mockSocketHandlers.lan_stock_update({
      sourceTerminalId: 'Caja-Movil-A',
      sourceSocketId: 'sock-self-1',
      items: [{ productId: 'prod-1', quantity: 2, factorConversion: 12 }]
    });
    expect(mockDbProducts.get('prod-1').stock).toBe(50);

    // Evento de OTRA caja vendiendo 2 bultos x 12 unidades -> debe descontar 24 unidades
    await mockSocketHandlers.lan_stock_update({
      sourceTerminalId: 'Caja-Movil-B',
      sourceSocketId: 'sock-other-2',
      items: [{ productId: 'prod-1', quantity: 2, factorConversion: 12 }]
    });
    expect(mockDbProducts.get('prod-1').stock).toBe(26);
    expect(mockDbProducts.get('prod-1').stockQuantity).toBe('26');
  });

  it('lanSyncService reconecta el socket cuando cambia la IP del servidor PC', () => {
    lanSyncService.init();
    expect(mockIo).toHaveBeenCalledTimes(1);
    expect(mockIo).toHaveBeenLastCalledWith('http://192.168.1.10:3005', expect.any(Object));

    api.defaults.baseURL = 'http://192.168.1.99:3005';
    window.dispatchEvent(new CustomEvent('api-base-url-changed', { detail: { baseUrl: 'http://192.168.1.99:3005' } }));

    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(mockIo).toHaveBeenCalledTimes(2);
    expect(mockIo).toHaveBeenLastCalledWith('http://192.168.1.99:3005', expect.any(Object));
  });

  it('lanSyncService.broadcastSale envía sourceTerminalId, sourceSocketId y factorConversion por ítem', () => {
    lanSyncService.init();
    lanSyncService.broadcastSale({
      id: 'sale-100',
      items: [
        { id: 'prod-9__bulk', productId: 'prod-9', quantity: 3, isBulk: true, unitsPerBulk: 6 }
      ]
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'lan_stock_update',
      expect.objectContaining({
        sourceTerminalId: 'Caja-Movil-A',
        sourceSocketId: 'sock-self-1',
        items: [
          expect.objectContaining({
            productId: 'prod-9',
            quantity: 3,
            factorConversion: 6
          })
        ]
      })
    );
  });

  it('imageCache revoca URLs blob: al limpiar o eviccionar entradas de memoria', async () => {
    resetImageCacheRuntimeForTests();
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/test-img-1');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const origFileReader = globalThis.FileReader;
    const origFetch = globalThis.fetch;

    try {
      // Forzar fallback a blob: URL deshabilitando FileReader temporalmente
      globalThis.FileReader = undefined;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        blob: async () => new Blob(['fake-png-bytes'], { type: 'image/png' })
      });

      const resolved = await cacheImage('http://192.168.1.10:3005/uploads/p1.png');
      expect(resolved).toBe('blob:http://localhost/test-img-1');

      resetImageCacheRuntimeForTests();
      expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/test-img-1');
    } finally {
      globalThis.FileReader = origFileReader;
      globalThis.fetch = origFetch;
      createSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });

  it('useMobilePosStore.hydrateFromDb recupera carrito y ventas en espera desde metadata DB', async () => {
    mockDbMetadata.set('isaac_mobile_active_cart_v1', {
      key: 'isaac_mobile_active_cart_v1',
      value: [{ product: { id: 'p-hyd', name: 'Harina', price: 2.5 }, quantity: 2 }]
    });
    mockDbMetadata.set('pos_held_sales', {
      key: 'pos_held_sales',
      value: [{ id: 'held-1', items: [{ id: 'p-hyd', name: 'Harina', price: 2.5, quantity: 1 }] }]
    });

    useMobilePosStore.setState({ cart: [], heldSales: [] });
    await useMobilePosStore.getState().hydrateFromDb();

    expect(useMobilePosStore.getState().cart).toHaveLength(1);
    expect(useMobilePosStore.getState().cart[0].product.name).toBe('Harina');
    expect(useMobilePosStore.getState().heldSales).toHaveLength(1);
  });

  it('lanSyncService aplica backoff exponencial acotado (45s->90s->180s->300s), anti-spam de warn y pausa en segundo plano', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.get.mockRejectedValue(new Error('timeout of 8000ms exceeded'));

    try {
      expect(lanSyncService.getPeerPollBackoffMs()).toBe(45000);

      await lanSyncService.fetchLANPeers();
      expect(lanSyncService.getPeerPollBackoffMs()).toBe(90000);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Segundo y tercer fallo con mismo mensaje NO deben spamear console.warn
      await lanSyncService.fetchLANPeers();
      expect(lanSyncService.getPeerPollBackoffMs()).toBe(180000);
      await lanSyncService.fetchLANPeers();
      expect(lanSyncService.getPeerPollBackoffMs()).toBe(300000);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Cuarto fallo sí vuelve a emitir 1 aviso periódico y mantiene tope 300s
      await lanSyncService.fetchLANPeers();
      expect(lanSyncService.getPeerPollBackoffMs()).toBe(300000);
      expect(warnSpy).toHaveBeenCalledTimes(2);

      // Con app oculta en segundo plano, fetchLANPeers NO consulta red
      const callsBeforeHidden = api.get.mock.calls.length;
      const origVis = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      try {
        await lanSyncService.fetchLANPeers();
        expect(api.get.mock.calls.length).toBe(callsBeforeHidden);
      } finally {
        if (origVis) Object.defineProperty(document, 'visibilityState', origVis);
        else Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      }

      // Al recuperarse el servidor, el backoff vuelve inmediatamente a 45s
      api.get.mockResolvedValueOnce({ data: { success: true, peers: [], clusterSize: 1 } });
      await lanSyncService.fetchLANPeers();
      expect(lanSyncService.getPeerPollBackoffMs()).toBe(45000);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
