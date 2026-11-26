import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeEscPosCp858, ESC_INIT_CP858 } from '../../src/utils/escposFormatter';
import api from '../../src/services/api';
import mobilePrinterService from '../../src/services/mobilePrinterService';

describe('Fase M3 — Hardware Móvil: ESC/POS CP858, BLE y Impresión de Red/Reportes', () => {
    beforeEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
        mobilePrinterService.bluetoothDevice = null;
        mobilePrinterService.characteristic = null;
        vi.restoreAllMocks();
    });

    it('encodeEscPosCp858 preserva caracteres españoles reales (ñ, Ñ, tildes, ¿¡, €) y bytes ESC/POS', () => {
        const raw = `${ESC_INIT_CP858}Café Niño ¿Sí? ¡Ñ! €`;
        const bytes = encodeEscPosCp858(raw);

        expect(bytes).toBeInstanceOf(Uint8Array);
        // Inicio: ESC @ FS . ESC t 0x13
        expect(Array.from(bytes.slice(0, 7))).toEqual([0x1B, 0x40, 0x1C, 0x2E, 0x1B, 0x74, 0x13]);
        // Verificar bytes exactos CP858 sin basura UTF-8 (0xC3)
        expect(bytes.includes(0xC3)).toBe(false);
        expect(bytes.includes(0x82)).toBe(true); // é
        expect(bytes.includes(0xA4)).toBe(true); // ñ
        expect(bytes.includes(0xA8)).toBe(true); // ¿
        expect(bytes.includes(0xA1)).toBe(true); // í
        expect(bytes.includes(0xAD)).toBe(true); // ¡
        expect(bytes.includes(0xA5)).toBe(true); // Ñ
        expect(bytes.includes(0xD5)).toBe(true); // €
    });

    it('printBluetooth respeta characteristic.properties.writeWithoutResponse antes de elegir el método de escritura BLE', async () => {
        const writeWithout = vi.fn().mockResolvedValue(undefined);
        const writeWith = vi.fn().mockResolvedValue(undefined);

        mobilePrinterService.bluetoothDevice = { gatt: { connected: true } };
        mobilePrinterService.characteristic = {
            properties: { write: true, writeWithoutResponse: false },
            writeValueWithoutResponse: writeWithout,
            writeValueWithResponse: writeWith
        };

        await mobilePrinterService.printBluetooth('Ticket Niño');
        expect(writeWithout).not.toHaveBeenCalled();
        expect(writeWith).toHaveBeenCalledTimes(1);
        const sentChunk = writeWith.mock.calls[0][0];
        expect(sentChunk.includes(0xA4)).toBe(true); // ñ en CP858

        // Ahora con writeWithoutResponse=true
        writeWithout.mockClear();
        writeWith.mockClear();
        mobilePrinterService.characteristic.properties.writeWithoutResponse = true;

        await mobilePrinterService.printBluetooth('Ticket 2');
        expect(writeWithout).toHaveBeenCalledTimes(1);
        expect(writeWith).not.toHaveBeenCalled();
    });

    it('printBluetooth con allowConnectPrompt=false (spooler) rechaza sin invocar requestDevice sin gesto de usuario', async () => {
        const requestDeviceSpy = vi.fn();
        Object.defineProperty(globalThis.navigator, 'bluetooth', {
            value: { requestDevice: requestDeviceSpy },
            configurable: true
        });

        await expect(
            mobilePrinterService.printBluetooth('Ticket Spooler', { allowConnectPrompt: false })
        ).rejects.toThrow(/desconectada|manualmente/i);
        expect(requestDeviceSpy).not.toHaveBeenCalled();
    });

    it('printNetwork y printRawEscPosText despachan ESC/POS CP858 en Base64 vía /settings/print-network-raw', async () => {
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } });
        localStorage.setItem('pos_printer_config', JSON.stringify({
            type: 'network',
            ip: '192.168.1.99',
            port: 9100
        }));

        const ok = await mobilePrinterService.printRawEscPosText('CORTE X — Mañana');
        expect(ok).toBe(true);
        expect(postSpy).toHaveBeenCalledTimes(1);
        const [endpoint, body] = postSpy.mock.calls[0];
        expect(endpoint).toBe('/settings/print-network-raw');
        expect(body.ip).toBe('192.168.1.99');
        expect(body.port).toBe(9100);
        expect(typeof body.dataBase64).toBe('string');
        expect(body.dataBase64.length).toBeGreaterThan(10);
    });

    it('Bloque 2: discoverBluetoothPrinters delega en PosNativeHardware y printNetwork prioriza TCP 9100 directo offline', async () => {
        const mockNativePlugin = {
            discoverBluetoothPrinters: vi.fn().mockResolvedValue({
                printers: [
                    { name: 'POS-58-BLE', address: 'AA:BB:CC:DD:EE:01', bonded: true, transport: 'BLE', rssi: -48 },
                    { name: 'Xprinter XP-P300', address: 'AA:BB:CC:DD:EE:02', bonded: false, transport: 'CLASSIC', rssi: -62 }
                ]
            }),
            printNetworkTcp: vi.fn().mockResolvedValue({ success: true, transport: 'TCP_DIRECT' }),
            printBluetooth: vi.fn().mockResolvedValue({ success: true, transport: 'BLE_GATT' })
        };
        const prevCap = window.Capacitor;
        window.Capacitor = {
            isNativePlatform: () => true,
            Plugins: { PosNativeHardware: mockNativePlugin }
        };
        vi.spyOn(mobilePrinterService, 'isNativePlatform').mockReturnValue(true);
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } });

        try {
            const list = await mobilePrinterService.discoverBluetoothPrinters({ durationMs: 3000 });
            expect(list).toHaveLength(2);
            expect(list[0].transport).toBe('BLE');

            // 1. TCP directo nativo exitoso NO necesita relay al backend PC
            const tcpOk = await mobilePrinterService.printNetwork('192.168.1.210', 9100, 'Ticket Directo');
            expect(tcpOk).toBe(true);
            expect(mockNativePlugin.printNetworkTcp).toHaveBeenCalledTimes(1);
            expect(postSpy).not.toHaveBeenCalled();

            // 2. Si TCP directo falla, hace fallback automático al relay PC
            mockNativePlugin.printNetworkTcp.mockRejectedValueOnce(new Error('No route to host'));
            const fallbackOk = await mobilePrinterService.printNetwork('192.168.1.210', 9100, 'Ticket Relay');
            expect(fallbackOk).toBe(true);
            expect(postSpy).toHaveBeenCalledTimes(1);

            // 3. Impresión BLE nativa pasa transport: 'ble'
            localStorage.setItem('pos_printer_config', JSON.stringify({
                type: 'bluetooth',
                btAddress: 'AA:BB:CC:DD:EE:01',
                btTransport: 'ble'
            }));
            const bleOk = await mobilePrinterService.printRawEscPosText('PRUEBA BLE');
            expect(bleOk).toBe(true);
            expect(mockNativePlugin.printBluetooth).toHaveBeenCalledWith(expect.objectContaining({
                address: 'AA:BB:CC:DD:EE:01',
                transport: 'ble'
            }));
        } finally {
            window.Capacitor = prevCap;
        }
    });
});
