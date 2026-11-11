const net = require('net');
const os = require('os');

/**
 * Servicio para Impresoras Térmicas de Red (Ethernet / Wi-Fi) vía Socket RAW (Puerto 9100)
 * Incluye escaneo automático de subred (Auto-Discovery), enrutamiento por roles y diagnóstico en clúster.
 */
class NetworkPrinterService {

    /**
     * Envía un búfer o string RAW a una impresora de red
     * @param {string} host - IP de la impresora (ej. 192.168.1.50)
     * @param {number} port - Puerto RAW (normalmente 9100)
     * @param {Buffer|string} data - Comandos ESC/POS o texto plano
     * @param {number} timeoutMs - Timeout de conexión en ms (default 4000)
     * @returns {Promise<{success: boolean, error?: string, durationMs?: number}>}
     */
    /**
     * Envía comandos ESC/POS a una impresora de red con sondeo bidireccional y drenado de buffer.
     * @param {string} host - IP de la impresora
     * @param {number} port - Puerto RAW (default 9100)
     * @param {Buffer|string} bufferPayload - Datos ESC/POS a imprimir
     * @param {number} timeoutMs - Timeout total en ms
     */
    static async printNetwork(host, port = 9100, bufferPayload, timeoutMs = 4000) {
        return new Promise((resolve, reject) => {
            if (!host || typeof host !== 'string' || !host.trim()) {
                return reject(new Error('PRINTER_ERROR: Dirección IP de impresora no válida o vacía.'));
            }

            const socket = new net.Socket();
            const safePort = Number(port) || 9100;
            const safeHost = host.trim();
            const payload = Buffer.isBuffer(bufferPayload) ? bufferPayload : Buffer.from(bufferPayload || '', 'utf8');
            let isFinalized = false;
            let statusChecked = false;
            let statusTimeout = null;

            const cleanup = () => {
                if (statusTimeout) clearTimeout(statusTimeout);
                if (!socket.destroyed) socket.destroy();
            };

            socket.setTimeout(timeoutMs);

            socket.on('timeout', () => {
                cleanup();
                if (!isFinalized) {
                    isFinalized = true;
                    reject(new Error(`PRINTER_TIMEOUT: Tiempo de espera agotado al conectar con ${safeHost}:${safePort}`));
                }
            });

            socket.on('error', (err) => {
                cleanup();
                if (!isFinalized) {
                    isFinalized = true;
                    reject(new Error(`PRINTER_CONNECTION_ERROR: ${err.message}`));
                }
            });

            const sendPayloadAndDrain = () => {
                if (isFinalized) return;
                const flushed = socket.write(payload);
                if (!flushed) {
                    // Si el buffer de red está lleno, esperar al evento drain
                    socket.once('drain', () => {
                        setTimeout(() => {
                            if (!isFinalized) {
                                isFinalized = true;
                                socket.end();
                                resolve({ success: true, message: `Ticket enviado y drenado exitosamente en ${safeHost}:${safePort}` });
                            }
                        }, 250);
                    });
                } else {
                    // Breve gracia de 250ms para garantizar transmisión de los últimos paquetes gráficos/corte
                    setTimeout(() => {
                        if (!isFinalized) {
                            isFinalized = true;
                            socket.end();
                            resolve({ success: true, message: `Ticket enviado exitosamente a ${safeHost}:${safePort}` });
                        }
                    }, 250);
                }
            };

            socket.connect(safePort, safeHost, () => {
                // 1. Comando DLE EOT 4: Consulta de estado de papel (ESC/POS estándar: 0x10, 0x04, 0x04)
                const statusCheck = Buffer.from([0x10, 0x04, 0x04]);
                try {
                    socket.write(statusCheck);
                } catch (_) {}

                // Esperar respuesta de estado con timeout corto de 400ms (para no bloquear impresoras unidireccionales)
                statusTimeout = setTimeout(() => {
                    if (!statusChecked) {
                        statusChecked = true;
                        sendPayloadAndDrain();
                    }
                }, 400);

                socket.once('data', (statusByte) => {
                    if (statusChecked) return;
                    statusChecked = true;
                    if (statusTimeout) clearTimeout(statusTimeout);

                    const status = statusByte[0];
                    // Bit 5 y Bit 6 indican falta de papel en ESC/POS (0x60)
                    const paperOut = (status & 0x60) === 0x60;
                    if (paperOut) {
                        cleanup();
                        if (!isFinalized) {
                            isFinalized = true;
                            return reject(new Error('PRINTER_WARNING: La impresora reporta falta de papel (PAPER_OUT).'));
                        }
                    }

                    sendPayloadAndDrain();
                });
            });
        });
    }

    /**
     * Envía un búfer o string RAW a una impresora de red (Adaptador con compatibilidad backwards)
     * @param {string} host - IP de la impresora (ej. 192.168.1.50)
     * @param {number} port - Puerto RAW (normalmente 9100)
     * @param {Buffer|string} data - Comandos ESC/POS o texto plano
     * @param {number} timeoutMs - Timeout de conexión en ms (default 4000)
     * @returns {Promise<{success: boolean, error?: string, durationMs?: number}>}
     */
    static async printRaw(host, port = 9100, data, timeoutMs = 4000) {
        const startTime = Date.now();
        try {
            const res = await this.printNetwork(host, port, data, timeoutMs);
            return { ...res, durationMs: Date.now() - startTime };
        } catch (err) {
            return { success: false, error: err.message, durationMs: Date.now() - startTime };
        }
    }

    /**
     * Escaneo de red rápido (Auto-Discovery) para encontrar impresoras con puerto 9100 abierto
     * @param {number} port - Puerto a buscar (default 9100)
     * @param {number} probeTimeoutMs - Timeout por host (default 350ms)
     * @returns {Promise<Array<{ip: string, port: number, latencyMs: number, label: string}>>}
     */
    static async scanSubnetForPrinters(port = 9100, probeTimeoutMs = 350) {
        const found = [];
        const interfaces = os.networkInterfaces();
        const baseSubnets = new Set();

        // Detectar subredes IPv4 activas
        for (const ifaceName in interfaces) {
            for (const addr of interfaces[ifaceName]) {
                if (addr.family === 'IPv4' && !addr.internal && addr.address) {
                    const parts = addr.address.split('.');
                    if (parts.length === 4) {
                        baseSubnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
                    }
                }
            }
        }

        const targets = [];
        // Agregar localhost por si hay emulador local en pruebas
        targets.push('127.0.0.1');

        for (const subnet of baseSubnets) {
            // Escanear rango habitual DHCP / impresoras (1 al 254)
            for (let i = 1; i <= 254; i++) {
                targets.push(`${subnet}.${i}`);
            }
        }

        const probeHost = (ip) => {
            return new Promise((resolve) => {
                const start = Date.now();
                const socket = new net.Socket();
                let finished = false;

                const finish = (online) => {
                    if (finished) return;
                    finished = true;
                    socket.destroy();
                    if (online) {
                        resolve({
                            ip,
                            port,
                            latencyMs: Date.now() - start,
                            label: `Impresora Térmica RAW (${ip}:${port})`
                        });
                    } else {
                        resolve(null);
                    }
                };

                socket.setTimeout(probeTimeoutMs);
                socket.on('connect', () => finish(true));
                socket.on('timeout', () => finish(false));
                socket.on('error', () => finish(false));

                try {
                    socket.connect(port, ip);
                } catch (e) {
                    finish(false);
                }
            });
        };

        // Procesar en lotes de 30 para no agotar descriptores de archivo del sistema operativo
        const BATCH_SIZE = 30;
        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            const batch = targets.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(probeHost));
            for (const r of batchResults) {
                if (r) found.push(r);
            }
        }

        return found;
    }

    /**
     * Envía un ticket de diagnóstico y calibración a la impresora de red
     */
    static async testPrint(host, port = 9100, businessName = 'Isaac POS') {
        const ESC = '\x1b';
        const GS = '\x1d';

        const INIT = ESC + '@';
        const ALIGN_CENTER = ESC + 'a\x01';
        const ALIGN_LEFT = ESC + 'a\x00';
        const BOLD_ON = ESC + 'E\x01';
        const BOLD_OFF = ESC + 'E\x00';
        const DOUBLE_ON = GS + '!\x11';
        const DOUBLE_OFF = GS + '!\x00';
        const CUT = GS + 'V\x01';

        const now = new Date();
        const dateStr = now.toLocaleDateString('es-VE') + ' ' + now.toLocaleTimeString('es-VE');

        let testContent = '';
        testContent += INIT;
        testContent += ALIGN_CENTER;
        testContent += DOUBLE_ON + BOLD_ON + (businessName || 'ISAAC POS').toUpperCase() + '\n' + DOUBLE_OFF + BOLD_OFF;
        testContent += 'CALIBRACION DE IMPRESORA DE RED\n';
        testContent += '================================\n';
        testContent += ALIGN_LEFT;
        testContent += `IP Impresora: ${host}:${port}\n`;
        testContent += `Fecha/Hora:   ${dateStr}\n`;
        testContent += `Modo:         Socket TCP RAW (9100)\n`;
        testContent += `Estado:       CONEXION EXITOSA\n`;
        testContent += '--------------------------------\n';
        testContent += ALIGN_CENTER;
        testContent += 'Esta impresora de red recibira\n';
        testContent += 'copia de las ventas registradas\n';
        testContent += 'por Isaac POS en tiempo real.\n\n';
        testContent += '*** CALIBRACION EXITOSA ***\n\n\n\n';
        testContent += CUT;

        return await this.printRaw(host, port, testContent, 5000);
    }

    /**
     * Genera comandos ESC/POS y envía una venta a la impresora de red según el Rol configurado:
     * - MIRROR: Copia idéntica con precios y pagos
     * - DISPATCH: Ticket de despacho para almacén/bodega (sin precios monetarios)
     * - KITCHEN: Comanda de preparación
     */
    static async printSale(host, port = 9100, sale, businessInfo = {}) {
        if (!host) return { success: false, error: 'IP de red no configurada' };

        const ESC = '\x1b';
        const GS = '\x1d';

        const INIT = ESC + '@';
        const ALIGN_CENTER = ESC + 'a\x01';
        const ALIGN_LEFT = ESC + 'a\x00';
        const ALIGN_RIGHT = ESC + 'a\x02';
        const BOLD_ON = ESC + 'E\x01';
        const BOLD_OFF = ESC + 'E\x00';
        const DOUBLE_ON = GS + '!\x11';
        const DOUBLE_OFF = GS + '!\x00';
        const CUT = GS + 'V\x01';

        const role = businessInfo.networkPrinterRole || 'MIRROR'; // 'MIRROR' | 'DISPATCH' | 'KITCHEN'
        const bizName = (businessInfo.name || 'ISAAC POS').toUpperCase();
        const bizRif = businessInfo.rif || '';
        const bizAddress = businessInfo.address || '';
        const bizPhone = businessInfo.phone || '';
        const headerMsg = businessInfo.receiptHeader || '';
        const footerMsg = businessInfo.receiptFooter || 'GRACIAS POR SU COMPRA';

        const dailyTicketNum = sale.dailyTicketNumber || (sale.taxInfo && sale.taxInfo.dailyTicketNumber) || null;
        const invoiceNo = sale.invoiceNumber || sale.id || 'N/A';
        const dateStr = sale.date ? new Date(sale.date).toLocaleString('es-VE') : new Date().toLocaleString('es-VE');
        const customerName = sale.customerName || (sale.customer && sale.customer.name) || 'CLIENTE OCASIONAL';

        let content = '';
        content += INIT;
        content += ALIGN_CENTER;

        if (role === 'DISPATCH') {
            content += DOUBLE_ON + BOLD_ON + 'ORDEN DE DESPACHO\n' + DOUBLE_OFF + BOLD_OFF;
            content += `[ ALMACEN / BODEGA ]\n`;
            content += '================================\n';
            content += ALIGN_LEFT;
            if (dailyTicketNum) content += BOLD_ON + `NUMERO DE TICKET: #${dailyTicketNum}\n` + BOLD_OFF;
            content += BOLD_ON + `COMPROBANTE: #${invoiceNo}\n` + BOLD_OFF;
            content += `Fecha: ${dateStr}\n`;
            content += `Cliente: ${customerName}\n`;
            content += '--------------------------------\n';
            content += BOLD_ON + 'CANT  PRODUCTO\n' + BOLD_OFF;
            content += '--------------------------------\n';

            const items = sale.items || sale.saleItems || [];
            for (const item of items) {
                const name = (item.productName || item.name || 'Producto').substring(0, 26);
                const qty = item.quantity || 1;
                content += `${String(qty).padEnd(5)} ${name}\n`;
            }

            content += '================================\n';
            content += ALIGN_CENTER;
            content += 'VERIFICADO POR ALMACEN: [   ]\n\n\n\n';
            content += CUT;
        } else if (role === 'KITCHEN') {
            content += DOUBLE_ON + BOLD_ON + 'COMANDA DE COCINA\n' + DOUBLE_OFF + BOLD_OFF;
            content += '================================\n';
            content += ALIGN_LEFT;
            if (dailyTicketNum) content += BOLD_ON + `NUMERO DE TICKET: #${dailyTicketNum}\n` + BOLD_OFF;
            content += BOLD_ON + `ORDEN: #${invoiceNo}\n` + BOLD_OFF;
            content += `Hora: ${dateStr}\n`;
            content += `Cliente / Mesa: ${customerName}\n`;
            content += '--------------------------------\n';

            const items = sale.items || sale.saleItems || [];
            for (const item of items) {
                const name = (item.productName || item.name || 'Producto').substring(0, 26);
                const qty = item.quantity || 1;
                content += DOUBLE_ON + `${qty}x ` + DOUBLE_OFF + `${name}\n`;
            }

            content += '================================\n\n\n';
            content += CUT;
        } else {
            // MODO ESPEJO: Ticket Comercial Completo
            content += DOUBLE_ON + BOLD_ON + bizName + '\n' + DOUBLE_OFF + BOLD_OFF;
            if (bizRif) content += `RIF: ${bizRif}\n`;
            if (bizAddress) content += `${bizAddress}\n`;
            if (bizPhone) content += `Tel: ${bizPhone}\n`;
            if (headerMsg) content += `${headerMsg}\n`;
            content += '================================\n';
            if (dailyTicketNum) content += BOLD_ON + `NUMERO DE TICKET: #${dailyTicketNum}\n` + BOLD_OFF;
            content += BOLD_ON + `COMPROBANTE: #${invoiceNo}\n` + BOLD_OFF;
            content += `Fecha: ${dateStr}\n`;
            content += `Cliente: ${customerName}\n`;
            content += '--------------------------------\n';
            content += ALIGN_LEFT;

            const items = sale.items || sale.saleItems || [];
            for (const item of items) {
                const name = (item.productName || item.name || 'Producto').substring(0, 24);
                const qty = item.quantity || 1;
                const price = Number(item.unitPrice || item.price || 0).toFixed(2);
                const sub = Number(item.subtotal || (qty * price) || 0).toFixed(2);

                content += `${name}\n`;
                content += `  ${qty} x $${price} = $${sub}\n`;
            }

            content += '--------------------------------\n';
            content += ALIGN_RIGHT;
            const totalUsd = Number(sale.total || sale.totalAmount || 0).toFixed(2);
            content += BOLD_ON + DOUBLE_ON + `TOTAL: $${totalUsd}\n` + DOUBLE_OFF + BOLD_OFF;

            const countryRaw = businessInfo.country || sale.country || '';
            const normCountry = String(countryRaw)
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '');
            const isUsdOnly = ['ecuador', 'panama', 'usa', 'eeuu', 'estadosunidos', 'unitedstates', 'us'].includes(normCountry) ||
                              sale.currencyMode === 'SINGLE' ||
                              (Number(sale.exchangeRate || 1) <= 1.0);

            if (!isUsdOnly && sale.exchangeRate && Number(sale.exchangeRate) > 1.0) {
                const totalBs = (Number(totalUsd) * Number(sale.exchangeRate)).toFixed(2);
                content += `TOTAL BS: Bs. ${totalBs}\n`;
                content += `Tasa: Bs. ${Number(sale.exchangeRate).toFixed(2)}/$\n`;
            }

            content += ALIGN_CENTER;
            content += '================================\n';
            content += `${footerMsg}\n`;
            content += '[ COPIA DE DESPACHO / RED ]\n\n\n\n';
            content += CUT;
        }

        return await this.printRaw(host, port, content, 5000);
    }
}

module.exports = NetworkPrinterService;
