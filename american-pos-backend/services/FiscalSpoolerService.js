const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const LocalPrinterService = require('./LocalPrinterService');
const { Sale, SaleItem, Customer, FiscalBookRecord, AuditLog } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

/**
 * FiscalSpoolerService
 * Driver de alto rendimiento para comunicación directa con máquinas e impresoras fiscales
 * Homologadas (The Factory HKA, Bixolon SRP-350 / 812, Custom, BMC, Dascom, Aclas)
 * Vía puertos COM (Serial RS232 / USB Virtual COM) y WinSpool RAW.
 */
class FiscalSpoolerService {

    /**
     * Detecta todos los puertos seriales/COM y las impresoras de Windows instaladas
     */
    static async getAvailableFiscalDevices() {
        const ports = await this.getComPorts();
        const printers = await LocalPrinterService.getSystemPrinters();
        return {
            comPorts: ports,
            printers: printers || [],
            spoolerPresets: [
                { name: 'The Factory HKA Direct Spooler', defaultFolder: 'C:\\IntTFHKA\\Factura.txt' },
                { name: 'Bixolon Fiscal Spooler', defaultFolder: 'C:\\BixolonFiscal\\Spooler.txt' },
                { name: 'Direct COM / RS232 / USB', defaultFolder: '' }
            ]
        };
    }

    /**
     * Obtiene la lista de puertos COM disponibles en Windows mediante .NET / PowerShell
     */
    static async getComPorts() {
        if (process.platform !== 'win32') {
            return ['COM1', 'COM2', 'COM3'];
        }

        return new Promise((resolve) => {
            const psCmd = `[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress`;
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { timeout: 4000, windowsHide: true }, (err, stdout) => {
                if (err || !stdout) {
                    return resolve(['COM1', 'COM2', 'COM3', 'COM4']);
                }
                try {
                    let parsed = JSON.parse(stdout.trim());
                    if (!Array.isArray(parsed)) parsed = [parsed];
                    const portList = parsed.filter(Boolean);
                    if (portList.length === 0) {
                        return resolve(['COM1', 'COM2', 'COM3', 'COM4']);
                    }
                    resolve(portList);
                } catch (e) {
                    resolve(['COM1', 'COM2', 'COM3', 'COM4']);
                }
            });
        });
    }

    /**
     * Construye comando para Reporte X (Lectura sin cierre)
     */
    static buildReporteXCommand(protocol = 'HKA_BIXOLON') {
        // En protocolo estándar HKA / Bixolon: I0X
        return 'I0X\n';
    }

    /**
     * Construye comando para Reporte Z (Cierre fiscal diario definitivo)
     */
    static buildReporteZCommand(protocol = 'HKA_BIXOLON') {
        // En protocolo estándar HKA / Bixolon: I0Z
        return 'I0Z\n';
    }

    /**
     * Construye comando para Cancelar Documento Fiscal en curso
     */
    static buildCancelCommand(protocol = 'HKA_BIXOLON') {
        return '7\n';
    }

    /**
     * Construye comando para Factura Fiscal completa homologada
     */
    static buildInvoiceCommands(sale, options = {}) {
        const {
            customerRif = 'V-00000000',
            customerName = 'Consumidor Final',
            customerAddress = 'Ciudad',
            customerPhone = ''
        } = options;

        const lines = [];

        // 1. Cabecera del cliente
        // Formato HKA / Bixolon:
        // iR*RIF
        // iS*Nombre
        // i00Direccion
        // i01Telefono
        lines.push(`iR*${customerRif.substring(0, 18)}`);
        lines.push(`iS*${customerName.substring(0, 38)}`);
        if (customerAddress) {
            lines.push(`i00${customerAddress.substring(0, 38)}`);
        }
        if (customerPhone) {
            lines.push(`i01Tel: ${customerPhone.substring(0, 30)}`);
        }

        // 2. Renglones de venta (Items)
        // Formato HKA / Bixolon para ítem:
        // Codigo de Tasa:
        //   ' ' (espacio) = Tasa General (16%)
        //   '!' = Tasa Reducida (8%)
        //   '"' = Tasa Adicional / Lujo (31%)
        //   'd0' o '1' = Exento (0%)
        const items = sale.SaleItems || sale.items || sale.saleItems || [];
        const saleCurrency = String(sale.currency || 'USD').toUpperCase();
        const fiscalRate = (saleCurrency === 'USD' && Number(sale.exchangeRate) > 1) ? Number(sale.exchangeRate) : 1;
        for (const item of items) {
            const rawQty = Math.max(0.001, Number(item.quantity || 1));
            const rawPrice = Number(item.price || item.unitPrice || 0) * fiscalRate;
            const isExempt = item.taxRate === 0 || item.isExempt || (sale.tax === 0 && !item.tax);

            // Formatear cantidad a 5 enteros y 3 decimales sin punto: 00001000 = 1.000
            const qtyInt = Math.round(rawQty * 1000);
            const qtyStr = qtyInt.toString().padStart(8, '0').slice(-8);

            // Formatear precio en moneda fiscal local (8 enteros y 2 decimales sin punto: 0000050000 = 500.00)
            const priceInt = Math.round(rawPrice * 100);
            const priceStr = priceInt.toString().padStart(10, '0').slice(-10);

            // Limpiar nombre del producto
            const cleanName = (item.name || item.productName || 'Producto')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9\s.-]/g, '')
                .substring(0, 38);

            if (isExempt) {
                // Renglón Exento: d0 (o 'd0' + precio + cantidad + descripción)
                lines.push(`d0${priceStr}${qtyStr}${cleanName}`);
            } else {
                // Renglón Tasa General 16%: espacio o ' '
                lines.push(` ${priceStr}${qtyStr}${cleanName}`);
            }
        }

        // 3. Descuento general si existe (ej. Promociones o Descuentos) en moneda fiscal local
        const promoDiscount = Number(sale.promoDiscount || sale.discount || 0) * fiscalRate;
        if (promoDiscount > 0) {
            const discInt = Math.round(promoDiscount * 100);
            const discStr = discInt.toString().padStart(10, '0').slice(-10);
            lines.push(`p-${discStr}`); // Descuento porcentual o monto directo
        }

        // 4. Medios de pago y totalización (TheFactoryHKA / Bixolon TFHKA)
        // 101 = Efectivo Bs | 105 = Divisas USD (sujeto a IGTF) | 109 = Punto de Venta / Débito | 110 = Transferencia / Pago Móvil | 120 = Cierre IGTF 3%
        const pm = String(sale.paymentMethod || 'efectivo_bs').toLowerCase();
        const igtfAmount = Number(sale.igtfAmount || 0);
        let paymentCode = '101';
        if (pm.includes('usd') || pm === 'cash' || pm.includes('zelle') || pm.includes('divisa') || igtfAmount > 0) {
            paymentCode = '105';
        } else if (pm.includes('punto') || pm.includes('tarjeta') || pm.includes('biopago') || pm.includes('card')) {
            paymentCode = '109';
        } else if (pm.includes('pago_movil') || pm.includes('transfer')) {
            paymentCode = '110';
        }
        lines.push(paymentCode);
        if (igtfAmount > 0) {
            lines.push('120'); // Cálculo y cobro fiscal de IGTF 3% (Providencia SENIAT SNAT/2022/000013)
        }
        lines.push('199'); // Fin de documento fiscal

        return lines.join('\n') + '\n';
    }

    /**
     * Envía comandos directamente al puerto serial COM vía PowerShell .NET
     */
    static async sendToComPort(portName, baudRate = 9600, rawCommands) {
        const cleanPort = String(portName || '').trim().toUpperCase();
        if (!/^COM\d{1,3}$/.test(cleanPort)) {
            throw new Error(`Nombre de puerto COM inválido: "${portName}"`);
        }

        const ALLOWED_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
        const numericBaud = Number(baudRate || 9600);
        if (!Number.isInteger(numericBaud) || !ALLOWED_BAUD_RATES.includes(numericBaud)) {
            throw new Error(`Velocidad baudRate no permitida: ${baudRate}`);
        }

        if (typeof rawCommands !== 'string' || rawCommands.length === 0) {
            throw new Error('Los comandos fiscales deben ser una cadena no vacía.');
        }

        return new Promise((resolve, reject) => {
            const base64Data = Buffer.from(rawCommands, 'utf8').toString('base64');

            const psScript = `
                $port = $null
                try {
                    $port = New-Object System.IO.Ports.SerialPort($env:ISAAC_FISCAL_PORT, [int]$env:ISAAC_FISCAL_BAUD, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
                    $port.ReadTimeout = 3000
                    $port.WriteTimeout = 3000
                    $port.Open()
                    $bytes = [System.Convert]::FromBase64String($env:ISAAC_FISCAL_B64)
                    $port.Write($bytes, 0, $bytes.Length)
                    Start-Sleep -Milliseconds 600
                    $response = ""
                    while ($port.BytesToRead -gt 0) {
                        $response += [char]$port.ReadByte()
                    }
                    Write-Output $response
                } finally {
                    if ($port -ne $null -and $port.IsOpen) { $port.Close() }
                }
            `;

            const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
            const child = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand
            ], {
                windowsHide: true,
                env: {
                    ...process.env,
                    ISAAC_FISCAL_PORT: cleanPort,
                    ISAAC_FISCAL_BAUD: String(numericBaud),
                    ISAAC_FISCAL_B64: base64Data
                }
            });

            let stdout = '';
            let stderr = '';
            let finished = false;
            const timer = setTimeout(() => {
                if (!finished) {
                    finished = true;
                    try { child.kill(); } catch (_) {}
                    reject(new Error(`Tiempo de espera agotado al comunicar con ${cleanPort}`));
                }
            }, 10000);

            child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            child.on('error', (err) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                reject(new Error(`Fallo de comunicación con puerto ${cleanPort}: ${err.message}`));
            });
            child.on('close', (code) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (code !== 0) {
                    console.error(`[FiscalSpooler] Error writing to ${cleanPort}:`, stderr);
                    return reject(new Error(`Fallo de comunicación con puerto ${cleanPort}: código ${code}`));
                }
                resolve({ success: true, port: cleanPort, response: stdout.trim() });
            });
        });
    }

    /**
     * Envía comandos a través del servicio de impresión de Windows (WinSpool RAW)
     */
    static async sendToWindowsPrinter(printerName, rawCommands) {
        await LocalPrinterService.printRaw(rawCommands, printerName);
        return { success: true, printerName };
    }

    /**
     * Envía comandos a un archivo de spooler (The Factory HKA o Bixolon Spooler)
     */
    static async sendToSpoolerFile(filePath, rawCommands) {
        if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
            throw new Error('Ruta de archivo spooler fiscal inválida.');
        }

        const resolvedPath = path.resolve(filePath.trim());
        const allowedExtensions = ['.txt', '.cmd', '.in', '.dat', '.prn'];
        if (!allowedExtensions.includes(path.extname(resolvedPath).toLowerCase())) {
            throw new Error('Extensión de archivo spooler no permitida (use .txt, .cmd, .in, .dat o .prn).');
        }

        const userDataBase = process.env.USER_DATA_PATH || path.join(__dirname, '..');
        const allowedRoots = [
            'C:\\IntTFHKA',
            'C:\\BixolonFiscal',
            'C:\\HKA',
            'C:\\TheFactory',
            'C:\\Spooler',
            path.join(userDataBase, 'spooler'),
            path.join(userDataBase, 'fiscal_spooler'),
            process.env.FISCAL_SPOOLER_DIR
        ].filter(Boolean).map(dir => path.resolve(dir));

        const isInsideAllowedRoot = allowedRoots.some((root) => {
            const rel = path.relative(
                process.platform === 'win32' ? root.toLowerCase() : root,
                process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
            );
            return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        });

        if (!isInsideAllowedRoot) {
            throw new Error('Ruta de spooler fuera de directorios fiscales autorizados (ej. C:\\IntTFHKA, C:\\BixolonFiscal).');
        }

        const targetDir = path.dirname(resolvedPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        await fs.promises.writeFile(resolvedPath, String(rawCommands || ''), { encoding: 'utf8' });
        return { success: true, filePath: resolvedPath };
    }

    /**
     * Despacha una acción fiscal (Reporte X, Reporte Z, Factura Fiscal, Cancelar)
     */
    static async executeFiscalAction({
        action,
        saleId = null,
        targetType = 'com', // 'com', 'printer', 'spooler_file'
        targetPort = 'COM1',
        baudRate = 9600,
        targetPrinter = '',
        spoolerPath = 'C:\\IntTFHKA\\Factura.txt',
        companyId,
        userId = null
    }) {
        let rawCommands = '';
        let documentLabel = '';

        if (action === 'REPORTE_X') {
            rawCommands = this.buildReporteXCommand();
            documentLabel = 'Reporte X (Lectura Diaria)';
        } else if (action === 'REPORTE_Z') {
            rawCommands = this.buildReporteZCommand();
            documentLabel = 'Reporte Z (Cierre Diario Definitivo)';
        } else if (action === 'CANCELAR') {
            rawCommands = this.buildCancelCommand();
            documentLabel = 'Cancelación de Documento Fiscal';
        } else if (action === 'FACTURA') {
            if (!saleId) throw new Error('Se requiere saleId para emitir factura fiscal');
            const sale = await Sale.findOne({
                where: { id: saleId, companyId },
                include: [{ model: SaleItem, as: 'SaleItems' }]
            });
            if (!sale) throw new Error(`Venta #${saleId} no encontrada`);

            rawCommands = this.buildInvoiceCommands(sale, {
                customerRif: sale.customerRif || 'V-00000000',
                customerName: sale.customerName || 'Consumidor Final',
                customerAddress: sale.customerAddress || '',
                customerPhone: sale.customerPhone || ''
            });
            documentLabel = `Factura Fiscal Venta #${sale.saleNumber || sale.id.slice(-6)}`;
        } else {
            throw new Error(`Acción fiscal desconocida: ${action}`);
        }

        // Ejecutar transmisión según tipo de destino
        let result = {};
        if (targetType === 'com') {
            result = await this.sendToComPort(targetPort, baudRate, rawCommands);
        } else if (targetType === 'printer') {
            result = await this.sendToWindowsPrinter(targetPrinter, rawCommands);
        } else if (targetType === 'spooler_file') {
            result = await this.sendToSpoolerFile(spoolerPath, rawCommands);
        } else {
            throw new Error(`Tipo de conexión fiscal inválido: ${targetType}`);
        }

        // Registrar en Auditoría del Sistema
        try {
            await AuditLog.create({
                id: generateRobustId(),
                companyId,
                userId: userId || 'system',
                action: `FISCAL_${action}`,
                description: `Comando fiscal ${documentLabel} emitido exitosamente hacia [${targetType.toUpperCase()}: ${targetPort || targetPrinter || spoolerPath}]`,
                timestamp: new Date().toISOString()
            });
        } catch (auditErr) {
            console.warn('[FiscalSpooler] Warning: No se pudo registrar log de auditoría:', auditErr.message);
        }

        return {
            success: true,
            action,
            documentLabel,
            connection: { targetType, targetPort, targetPrinter, spoolerPath },
            executedAt: new Date().toISOString(),
            rawCommandLength: rawCommands.length,
            result
        };
    }
}

module.exports = FiscalSpoolerService;
