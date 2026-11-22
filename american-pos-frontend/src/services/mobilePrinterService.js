/**
 * Universal Mobile Printer Service
 * Supports:
 *  1. Web Bluetooth API (Direct wireless printing to 58mm/80mm Bluetooth thermal printers)
 *  2. Android RawBT Intent Protocol (Silent background thermal printing on Android)
 *  3. Silent Iframe Web Print (Standard browser fallback without blank popup windows)
 */

import { Capacitor } from '@capacitor/core';
import { formatSaleToEscPos } from '../utils/escposFormatter';
import { PosNativeHardware } from './api';

class MobilePrinterService {
    constructor() {
        this.bluetoothDevice = null;
        this.characteristic = null;
        this.isBluetoothConnecting = false;
        this.printQueue = [];
        this.isProcessingQueue = false;
        this.queueListeners = new Set();
    }

    /**
     * Check if Web Bluetooth is supported in the current browser
     */
    isBluetoothSupported() {
        return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    }

    /**
     * Connect to a Bluetooth ESC/POS printer
     */
    async connectBluetooth() {
        if (!this.isBluetoothSupported()) {
            throw new Error('Web Bluetooth no está soportado en este navegador. Utiliza Google Chrome en Android.');
        }

        this.isBluetoothConnecting = true;
        try {
            // Common Bluetooth Printer Service UUIDs
            const optionalServices = [
                '000018f0-0000-1000-8000-00805f9b34fb', // Standard Printer Service
                'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Pos-58/80
                '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC SPP
                '0000ff00-0000-1000-8000-00805f9b34fb',
                '0000fee7-0000-1000-8000-00805f9b34fb',
                '0000fff0-0000-1000-8000-00805f9b34fb'
            ];

            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices
            });

            this.bluetoothDevice = device;

            device.addEventListener('gattserverdisconnected', () => {
                console.log('[BluetoothPrinter] Dispositivo desconectado');
                this.characteristic = null;
            });

            const server = await device.gatt.connect();

            // Find valid writable characteristic across services
            for (const serviceUuid of optionalServices) {
                try {
                    const service = await server.getPrimaryService(serviceUuid);
                    const characteristics = await service.getCharacteristics();
                    for (const char of characteristics) {
                        if (char.properties.write || char.properties.writeWithoutResponse) {
                            this.characteristic = char;
                            break;
                        }
                    }
                    if (this.characteristic) break;
                } catch { /* Servicio GATT opcional no presente en este dispositivo */ }
            }

            if (!this.characteristic) {
                // Fallback: try all discovered services
                const services = await server.getPrimaryServices().catch(() => []);
                for (const service of services) {
                    const characteristics = await service.getCharacteristics().catch(() => []);
                    for (const char of characteristics) {
                        if (char.properties.write || char.properties.writeWithoutResponse) {
                            this.characteristic = char;
                            break;
                        }
                    }
                    if (this.characteristic) break;
                }
            }

            if (!this.characteristic) {
                throw new Error('No se encontró un canal de escritura compatible en la impresora Bluetooth.');
            }

            return {
                name: device.name || 'Impresora Bluetooth',
                id: device.id,
                connected: true
            };
        } finally {
            this.isBluetoothConnecting = false;
        }
    }

    /**
     * Print binary ESC/POS data directly over Web Bluetooth
     */
    async printBluetooth(escPosData) {
        if (!this.characteristic || !this.bluetoothDevice?.gatt?.connected) {
            await this.connectBluetooth();
        }

        if (!this.characteristic) {
            throw new Error('Impresora Bluetooth no conectada');
        }

        // Convert string to Uint8Array if needed
        let bytes;
        if (typeof escPosData === 'string') {
            const encoder = new TextEncoder();
            bytes = encoder.encode(escPosData);
        } else if (escPosData instanceof Uint8Array) {
            bytes = escPosData;
        } else {
            bytes = new Uint8Array(escPosData);
        }

        // Bluetooth MTU chunks (typically 100-512 bytes per packet)
        const CHUNK_SIZE = 120;
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.slice(i, i + CHUNK_SIZE);
            if (this.characteristic.writeValueWithoutResponse) {
                await this.characteristic.writeValueWithoutResponse(chunk);
            } else {
                await this.characteristic.writeValue(chunk);
            }
            // Minimal pause to prevent buffer overrun on budget thermal printers
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        return true;
    }

    /**
     * Print via Android RawBT intent
     */
    printRawBT(escPosData) {
        let base64;
        if (typeof escPosData === 'string') {
            base64 = btoa(unescape(encodeURIComponent(escPosData)));
        } else if (escPosData instanceof Uint8Array) {
            let binary = '';
            for (let i = 0; i < escPosData.byteLength; i++) {
                binary += String.fromCharCode(escPosData[i]);
            }
            base64 = btoa(binary);
        }

        const rawbtUrl = `rawbt:data:base64,${base64}`;
        window.location.href = rawbtUrl;
        return true;
    }

    /**
     * Print HTML content invisibly via iframe
     */
    printIframe(htmlContent) {
        if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.printSilent === 'function') {
            const activePrinter = (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_station_printer') : '') || '';
            return window.electronAPI.printSilent(htmlContent, activePrinter);
        }

        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.top = '-9999px';
            iframe.style.left = '-9999px';
            iframe.style.width = '0px';
            iframe.style.height = '0px';
            iframe.style.border = '0';
            iframe.style.visibility = 'hidden';
            document.body.appendChild(iframe);

            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(htmlContent);
            doc.close();

            iframe.contentWindow.focus();
            setTimeout(() => {
                try {
                    iframe.contentWindow.print();
                } catch (e) {
                    console.error('[MobilePrinter] Error triggering print:', e);
                }
                setTimeout(() => {
                    if (iframe.parentNode) {
                        iframe.parentNode.removeChild(iframe);
                    }
                    resolve(true);
                }, 1000);
            }, 300);
        });
    }

    /**
     * Check if running inside Capacitor native mobile application
     */
    isNativePlatform() {
        return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
    }

    /**
     * Get paired Bluetooth printers (Native Android)
     */
    async getPairedPrinters() {
        if (this.isNativePlatform()) {
            try {
                const res = await PosNativeHardware.getPairedPrinters();
                return res?.printers || [];
            } catch (err) {
                console.warn('[NativePrinter] Error getting paired printers:', err);
                return [];
            }
        }
        return [];
    }

    /**
     * Convert string or Uint8Array to base64 preserving raw ESC/POS byte values
     */
    toBase64(data) {
        if (typeof data === 'string') {
            let binary = '';
            for (let i = 0; i < data.length; i++) {
                binary += String.fromCharCode(data.charCodeAt(i) & 0xff);
            }
            return window.btoa(binary);
        } else if (data instanceof Uint8Array) {
            let binary = '';
            for (let i = 0; i < data.length; i++) {
                binary += String.fromCharCode(data[i]);
            }
            return window.btoa(binary);
        }
        return '';
    }

    /**
     * Complete Universal Print Dispatcher for Mobile
     */
    async printSaleMobile({ sale, businessSettings, exchangeRate, currencyMode, paymentMethods, htmlContent }) {
        // 1. If Electron environment, let Electron handle it
        if (window.electronAPI && businessSettings?.printerName) {
            return false; // Hand off to desktop driver
        }

        // 2. Generate ESC/POS commands
        const escPosContent = formatSaleToEscPos(
            sale,
            businessSettings,
            exchangeRate,
            currencyMode,
            paymentMethods
        );

        // 3. Ultra-Fast Direct Native Capacitor Android Hardware Plugin
        // Direct RFCOMM SPP socket (<80ms, no RawBT redirect, no chunk delays)
        if (this.isNativePlatform()) {
            try {
                let targetMac = businessSettings?.printerMac || localStorage.getItem('pos_mobile_bt_printer') || localStorage.getItem('pos_mobile_bt_printer_last') || '';

                // Si no hay MAC configurada, auto-seleccionar la primera impresora emparejada en el dispositivo
                if (!targetMac) {
                    try {
                        const paired = await this.getPairedPrinters();
                        if (Array.isArray(paired) && paired.length > 0) {
                            targetMac = paired[0].address;
                            localStorage.setItem('pos_mobile_bt_printer_last', targetMac);
                            console.log('[NativePrinter] Auto-detectada impresora vinculada:', paired[0].name, targetMac);
                        }
                    } catch (pErr) {
                        console.warn('[NativePrinter] No se pudo consultar impresoras vinculadas:', pErr?.message);
                    }
                }

                const base64Data = this.toBase64(escPosContent);
                console.log('[NativePrinter] Direct SPP socket print to:', targetMac || 'Default Bonded');
                const result = await PosNativeHardware.printBluetooth({
                    address: targetMac,
                    data: base64Data
                });
                if (result?.success) {
                    if (targetMac) localStorage.setItem('pos_mobile_bt_printer_last', targetMac);
                    return true;
                }
            } catch (nativeErr) {
                console.warn('[NativePrinter] Native socket printing failed, falling back to Web BT/RawBT:', nativeErr);
            }
        }

        // 4. Check selected print mode
        const mobileMode = businessSettings?.mobilePrintMode || localStorage.getItem('pos_mobile_print_mode') || 'BLUETOOTH';

        if (mobileMode === 'RAWBT') {
            return this.printRawBT(escPosContent);
        }

        if (mobileMode === 'BLUETOOTH' && this.isBluetoothSupported()) {
            try {
                return await this.printBluetooth(escPosContent);
            } catch (err) {
                console.warn('[MobilePrinter] Bluetooth print error, falling back to RawBT/Iframe:', err);
                if (/Android/i.test(navigator.userAgent)) {
                    return this.printRawBT(escPosContent);
                }
            }
        }

        // 5. Default Fallback: Silent Iframe
        return await this.printIframe(htmlContent);
    }

    /**
     * Asynchronous Background Spooler: Enqueue a sale to print in background without blocking UI
     * Returns instantly ({ queued: true, jobId }) so cashier can ring up the next customer immediately.
     */
    enqueueSalePrint(printJobOptions) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const job = {
            id: jobId,
            options: printJobOptions,
            invoiceNumber: printJobOptions?.sale?.invoiceNumber || 'Ticket',
            status: 'queued', // 'queued' | 'printing' | 'completed' | 'failed'
            retries: 0,
            maxRetries: 2,
            createdAt: Date.now(),
            error: null
        };

        this.printQueue.push(job);
        this.notifyQueueChange();

        // Launch consumer in background non-blocking promise
        setTimeout(() => {
            this.processQueue().catch(err => {
                console.warn('[PrintSpooler] Error en hilo de fondo:', err);
            });
        }, 10);

        return { queued: true, jobId };
    }

    /**
     * Asynchronous FIFO queue consumer
     */
    async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;
        this.notifyQueueChange();

        try {
            while (this.printQueue.some(j => j.status === 'queued')) {
                const job = this.printQueue.find(j => j.status === 'queued');
                if (!job) break;

                job.status = 'printing';
                this.notifyQueueChange();

                try {
                    console.log(`[PrintSpooler] Imprimiendo en segundo plano ticket #${job.invoiceNumber}...`);
                    const result = await this.printSaleMobile(job.options);
                    job.status = result !== false ? 'completed' : 'failed';
                    job.error = null;
                } catch (printErr) {
                    job.retries += 1;
                    console.warn(`[PrintSpooler] Reintento ${job.retries}/${job.maxRetries} para ticket #${job.invoiceNumber}:`, printErr.message);
                    if (job.retries <= job.maxRetries) {
                        job.status = 'queued'; // volver a encolar
                        await new Promise(r => setTimeout(r, 350));
                    } else {
                        job.status = 'failed';
                        job.error = printErr.message || 'Error de transmisión Bluetooth';
                    }
                }
                this.notifyQueueChange();
            }
        } finally {
            this.isProcessingQueue = false;
            // Mantener solo los últimos 8 trabajos en memoria para evitar crecimiento del heap
            if (this.printQueue.length > 8) {
                this.printQueue = this.printQueue.slice(-8);
            }
            this.notifyQueueChange();
        }
    }

    /**
     * Inspect current background spooler state
     */
    getQueueStatus() {
        const pendingCount = this.printQueue.filter(j => j.status === 'queued' || j.status === 'printing').length;
        const activeJob = this.printQueue.find(j => j.status === 'printing') || null;
        return {
            isProcessing: this.isProcessingQueue,
            pendingCount,
            activeJob,
            totalJobs: this.printQueue.length,
            recentJobs: [...this.printQueue]
        };
    }

    /**
     * Subscribe to spooler status changes
     */
    subscribeQueue(callback) {
        if (typeof callback !== 'function') return () => {};
        this.queueListeners.add(callback);
        return () => {
            this.queueListeners.delete(callback);
        };
    }

    notifyQueueChange() {
        const status = this.getQueueStatus();
        for (const listener of this.queueListeners) {
            try {
                listener(status);
            } catch (err) {
                console.warn('[PrinterSpooler] Error en listener de cola:', err?.message);
            }
        }
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('pos-printer-spooler-status', { detail: status }));
        }
    }
}

export const mobilePrinterService = new MobilePrinterService();
export default mobilePrinterService;
