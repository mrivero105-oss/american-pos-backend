/**
 * SCALE SERVICE (Balanza / Báscula de Mostrador RS-232 / USB)
 * Protocolo de lectura continua, detección de peso estable (ST vs US) y comando de Tara/Cero.
 * Soporta estándares Toledo 8217, CAS, Torrey, Dibal, Magellan y genéricos POS.
 */

const { exec } = require('child_process');
const precision = require('../utils/precision');

class ScaleService {
    /**
     * Lista los puertos COM disponibles en Windows
     */
    static async listPorts() {
        return new Promise((resolve) => {
            if (process.platform !== 'win32') return resolve([]);
            const psCmd = `[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress`;
            exec(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { timeout: 3000, windowsHide: true }, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                try {
                    let parsed = JSON.parse(stdout.trim());
                    if (!Array.isArray(parsed)) parsed = [parsed];
                    resolve(parsed.filter(Boolean));
                } catch (_) {
                    resolve([]);
                }
            });
        });
    }

    /**
     * Parsea la trama enviada por la balanza según estándares de la industria
     * Formatos habituales:
     * - Toledo / CAS / Dibal: "ST,GS,+00.250kg\r\n" o "US,GS,+00.245kg\r\n"
     * - Torrey: "  0.250 kg\r" o "P 0.250 kg\r"
     */
    static parseScaleFrame(rawFrame) {
        if (!rawFrame || typeof rawFrame !== 'string') {
            return { success: false, error: 'Trama de balanza vacía o ilegible' };
        }

        const clean = rawFrame.trim();

        // 1. Detección de estabilidad (ST = Stable, US = Unstable)
        let isStable = true;
        let isOverload = false;
        let isNet = false;
        let unit = 'kg';

        if (clean.includes('US') || clean.includes('MOT') || clean.includes('UNSTABLE')) {
            isStable = false;
        } else if (clean.includes('ST') || clean.includes('EST') || clean.includes('STABLE')) {
            isStable = true;
        }

        if (clean.includes('OL') || clean.includes('OVER')) {
            isOverload = true;
        }

        if (clean.includes('NT') || clean.includes('NET')) {
            isNet = true;
        }

        if (clean.toLowerCase().includes('lb')) {
            unit = 'lb';
        }

        // 2. Extracción numérica del peso
        const numMatch = clean.match(/[-+]?\s*(\d+(\.\d+)?)/);
        if (!numMatch) {
            return {
                success: false,
                raw: clean,
                error: 'No se pudo interpretar el valor numérico de la balanza'
            };
        }

        let rawWeight = parseFloat(numMatch[1]);
        if (clean.includes('-')) {
            rawWeight = -rawWeight;
        }

        const weight = precision.round(rawWeight, 3);
        const isZero = Math.abs(weight) <= 0.002;

        return {
            success: true,
            weight,
            unit,
            isStable,
            isZero,
            isOverload,
            isNet,
            raw: clean,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Lee el peso actual desde el puerto serie especificado
     */
    static async readWeight(portName = 'COM1', baudRate = 9600, timeoutMs = 2500) {
        return new Promise((resolve, reject) => {
            if (process.platform !== 'win32') {
                return reject(new Error('Lectura de balanza RS-232 disponible en entornos Windows.'));
            }

            const safePort = String(portName || 'COM1').trim().toUpperCase();
            if (!/^COM\d{1,3}$/.test(safePort)) {
                return resolve({
                    success: false,
                    error: `Puerto serial inválido: ${portName}. Debe tener el formato COM1, COM2, etc.`,
                    portName
                });
            }
            const safeBaud = parseInt(baudRate, 10) || 9600;
            const safeTimeout = Math.min(Math.max(parseInt(timeoutMs, 10) || 2500, 500), 10000);

            const psScript = `
$port = New-Object System.IO.Ports.SerialPort '${safePort}', ${safeBaud}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One
$port.ReadTimeout = ${safeTimeout}
try {
    $port.Open()
    # Leer línea o búfer recibido
    $line = $port.ReadLine()
    Write-Output $line
} catch {
    Write-Error $_.Exception.Message
} finally {
    if ($port.IsOpen) { $port.Close() }
}
`;
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
                timeout: safeTimeout + 1000,
                windowsHide: true
            }, (err, stdout, stderr) => {
                if (err) {
                    return resolve({
                        success: false,
                        error: `No se pudo comunicar con la balanza en ${safePort}: ${stderr || err.message}`,
                        portName: safePort
                    });
                }

                const parsed = ScaleService.parseScaleFrame(stdout);
                if (parsed.success && !parsed.isStable) {
                    parsed.warning = 'SCALE_UNSTABLE: La lectura es inestable (en movimiento). Espere a que el peso se estabilice.';
                }
                resolve(parsed);
            });
        });
    }

    /**
     * Envía comando de Tara (T) o Cero (Z) a la balanza
     */
    static async sendCommand(portName = 'COM1', cmd = 'T', baudRate = 9600) {
        return new Promise((resolve, reject) => {
            const safePort = String(portName || 'COM1').trim().toUpperCase();
            if (!/^COM\d{1,3}$/.test(safePort)) {
                return reject(new Error(`Puerto serial inválido: ${portName}. Debe tener el formato COM1, COM2, etc.`));
            }
            const safeBaud = parseInt(baudRate, 10) || 9600;
            const safeCmd = cmd.toUpperCase() === 'Z' ? 'Z' : 'T';
            const psScript = `
$port = New-Object System.IO.Ports.SerialPort '${safePort}', ${safeBaud}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One
try {
    $port.Open()
    $port.WriteLine('${safeCmd}')
    Write-Output "OK"
} catch {
    Write-Error $_.Exception.Message
} finally {
    if ($port.IsOpen) { $port.Close() }
}
`;
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { timeout: 3000, windowsHide: true }, (err, stdout) => {
                if (err) return reject(new Error(`Fallo al enviar comando '${safeCmd}' a balanza: ${err.message}`));
                resolve({ success: true, command: safeCmd, message: `Comando ${safeCmd} enviado a ${safePort}` });
            });
        });
    }
}

module.exports = ScaleService;
