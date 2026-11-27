import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import {
  ESC_INIT_CP858,
  ESC_INIT,
  encodeEscPosCp858,
  formatSaleToEscPos,
  formatWarehouseDispatchSlip,
  formatBatchProductLabelsToEscPos,
  resolveEscPosEncoding
} from '../../src/utils/escposFormatter';
import {
  useMobileModalStore,
  selectHasActiveOverlay
} from '../../src/store/useMobileModalStore';
import {
  checkServerHealth,
  setPairedServerFingerprint
} from '../../src/services/api';

describe('Fase 3 — Hardware Android, ESC/POS CP858, LIFO Modal Stack y LAN Anti-Rogue', () => {
  beforeEach(() => {
    localStorage.clear();
    useMobileModalStore.getState().resetAllModals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPairedServerFingerprint(null);
  });

  describe('ESC/POS CP858 nativo en recibos, despachos y etiquetas', () => {
    it('emite ESC_INIT_CP858 por defecto y codifica ñ/Ñ/tildes a bytes CP858 reales', () => {
      expect(resolveEscPosEncoding()).toBe('cp858');

      const sale = {
        invoiceNumber: 'FAC-3001',
        totalUSD: 12.5,
        exchangeRate: 40,
        items: [
          { name: 'Piñata Año Nuevo con Jamón', quantity: 1, price: 12.5 }
        ],
        paymentMethod: 'Efectivo USD'
      };
      const raw = formatSaleToEscPos(sale, { name: 'Panadería Peña', receiptWidth: '58mm' }, 40, 'BOTH');
      expect(raw.startsWith(ESC_INIT_CP858)).toBe(true);
      expect(raw).toContain('PANADERÍA PEÑA');
      expect(raw).toContain('PIÑATA AÑO');
      expect(raw).toContain('¡GRACIAS POR SU COMPRA!');

      const bytes = encodeEscPosCp858('Piña Ñandú Café €');
      // ñ = 0xA4, Ñ = 0xA5, ú = 0xA3, é = 0x82, € = 0xD5
      expect(Array.from(bytes)).toContain(0xA4);
      expect(Array.from(bytes)).toContain(0xA5);
      expect(Array.from(bytes)).toContain(0xA3);
      expect(Array.from(bytes)).toContain(0x82);
      expect(Array.from(bytes)).toContain(0xD5);
    });

    it('soporta modo legacy ASCII cuando se configura explícitamente', () => {
      const sale = {
        invoiceNumber: 'FAC-3002',
        totalUSD: 5,
        items: [{ name: 'Café Mañanero', quantity: 1, price: 5 }]
      };
      const rawAscii = formatSaleToEscPos(sale, { name: 'Tienda Peña', escposEncoding: 'ascii' }, 40, 'USD');
      expect(rawAscii.startsWith(ESC_INIT)).toBe(true);
      expect(rawAscii).not.toContain('ñ');
      expect(rawAscii).not.toContain('Ñ');
      expect(rawAscii).toContain('MANANERO');
    });

    it('usa CP858 por defecto en comprobantes de despacho y etiquetas térmicas', () => {
      const slip = formatWarehouseDispatchSlip(
        {
          invoiceNumber: 'DESP-1',
          customerName: 'José Núñez',
          items: [{ name: 'Bulto Azúcar Cañaveral', isBulk: true, quantity: 2 }]
        },
        { name: 'Almacén Peña' }
      );
      expect(slip.startsWith(ESC_INIT_CP858)).toBe(true);
      expect(slip).toContain('Núñez');

      const labels = formatBatchProductLabelsToEscPos(
        [{ name: 'Jabón Piña', price: 3.5, barcode: '7591234567890' }],
        { paperWidth: '58mm', exchangeRate: 40 }
      );
      expect(labels.startsWith(ESC_INIT_CP858)).toBe(true);
      expect(labels).toContain('JABÓN PIÑA');
    });
  });

  describe('Pila LIFO real en useMobileModalStore', () => {
    it('cierra modales estrictamente en orden inverso de apertura y limpia payloads acoplados', () => {
      const store = useMobileModalStore.getState();

      store.setModalField('isSideNavOpen', true);
      store.setModalField('isCheckoutOpen', true);
      store.setModalField('quantityModalItem', { id: 'p1', name: 'Harina' });
      store.setModalField('isQuantityModalOpen', true);
      store.setModalField('unregisteredBarcodeNotice', { code: '7590001112223' });

      expect(selectHasActiveOverlay(useMobileModalStore.getState())).toBe(true);
      expect(useMobileModalStore.getState().overlayStack).toEqual([
        'isSideNavOpen',
        'isCheckoutOpen',
        'isQuantityModalOpen',
        'unregisteredBarcodeNotice'
      ]);

      // 1º cierre: aviso de código no registrado (último abierto)
      expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
      expect(useMobileModalStore.getState().unregisteredBarcodeNotice).toBeNull();
      expect(useMobileModalStore.getState().isQuantityModalOpen).toBe(true);

      // 2º cierre: modal de cantidad + limpia quantityModalItem
      expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
      expect(useMobileModalStore.getState().isQuantityModalOpen).toBe(false);
      expect(useMobileModalStore.getState().quantityModalItem).toBeNull();
      expect(useMobileModalStore.getState().isCheckoutOpen).toBe(true);

      // 3º cierre: checkout
      expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
      expect(useMobileModalStore.getState().isCheckoutOpen).toBe(false);
      expect(useMobileModalStore.getState().isSideNavOpen).toBe(true);

      // 4º cierre: side nav
      expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
      expect(useMobileModalStore.getState().isSideNavOpen).toBe(false);
      expect(selectHasActiveOverlay(useMobileModalStore.getState())).toBe(false);

      // 5º intento con pila vacía retorna false
      expect(useMobileModalStore.getState().closeTopOverlay()).toBe(false);
    });
  });

  describe('Autenticación LAN y anti-rogue server en checkServerHealth', () => {
    it('rechaza un servidor con serverFingerprint distinto al emparejado y emite rogue-server-detected', async () => {
      setPairedServerFingerprint('fp-servidor-legitimo-001');

      const rogueEvents = [];
      const handler = (ev) => rogueEvents.push(ev.detail);
      window.addEventListener('rogue-server-detected', handler);

      vi.spyOn(axios, 'get').mockResolvedValueOnce({
        status: 200,
        data: {
          status: 'ready',
          dbReady: true,
          hostname: 'ROGUE-PC',
          serverFingerprint: 'fp-atacante-999'
        }
      });

      const ok = await checkServerHealth('http://192.168.1.99:3005', {
        verifyPairedFingerprint: true
      });

      window.removeEventListener('rogue-server-detected', handler);

      expect(ok).toBe(false);
      expect(rogueEvents).toHaveLength(1);
      expect(rogueEvents[0].expectedFingerprint).toBe('fp-servidor-legitimo-001');
      expect(rogueEvents[0].remoteFingerprint).toBe('fp-atacante-999');
    });

    it('acepta el servidor cuando su serverFingerprint coincide con el emparejado', async () => {
      setPairedServerFingerprint('fp-servidor-legitimo-001');

      vi.spyOn(axios, 'get').mockResolvedValueOnce({
        status: 200,
        data: {
          status: 'ready',
          dbReady: true,
          hostname: 'CAJA-PRINCIPAL',
          serverFingerprint: 'fp-servidor-legitimo-001'
        }
      });

      const ok = await checkServerHealth('http://192.168.1.10:3005', {
        verifyPairedFingerprint: true
      });
      expect(ok).toBe(true);
    });
  });
});
