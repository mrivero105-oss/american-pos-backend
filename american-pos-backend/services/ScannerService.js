const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const InvoiceService = require('./InvoiceService');

const isSafePrivateIp = (ipStr) => {
    if (!ipStr || typeof ipStr !== 'string') return false;
    const clean = ipStr.trim();
    if (clean === '127.0.0.1' || clean === 'localhost' || clean.startsWith('127.') || clean.startsWith('169.254.')) {
        return false;
    }
    const rfc1918Regex = /^(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;
    return rfc1918Regex.test(clean);
};

class ScannerService {
    /**
     * Cache de dispositivos eSCL descubiertos en la red local
     */
    static esclCache = [];
    static lastDiscovery = 0;

    /**
     * Descubre escáneres eSCL (Apple AirPrint / Mopria / Canon / HP / Epson) en la red LAN
     */
    static async discoverEsclDevices() {
        const now = Date.now();
        if (this.esclCache.length > 0 && (now - this.lastDiscovery < 300000)) {
            return this.esclCache;
        }

        const candidates = ['192.168.1.27', '192.168.1.2', '192.168.1.5', '192.168.1.10', '192.168.1.11', '192.168.1.15', '192.168.1.20', '192.168.1.25', '192.168.1.50', '192.168.1.100'];
        const found = [];

        await Promise.all(candidates.map(async (ip) => {
            try {
                const res = await axios.get(`http://${ip}/eSCL/ScannerCapabilities`, { timeout: 1500 });
                if (res.status === 200 && res.data && res.data.includes('ScannerCapabilities')) {
                    const makeModelMatch = res.data.match(/<pwg:MakeAndModel>(.*?)<\/pwg:MakeAndModel>/);
                    const name = makeModelMatch ? `Canon ${makeModelMatch[1]}` : `Escáner de Red (${ip})`;
                    found.push({
                        id: `ESCL_NET_${ip}`,
                        ip: ip,
                        name: name,
                        manufacturer: 'Canon / eSCL Network',
                        type: 'HARDWARE_SCANNER',
                        status: 'Listo',
                        capabilitiesXml: res.data
                    });
                }
            } catch (e) {}
        }));

        this.esclCache = found;
        this.lastDiscovery = now;
        return found;
    }

    /**
     * Obtener lista de escáneres e impresoras multifuncionales conectados
     */
    static async listScanners() {
        return this.getConnectedScanners();
    }

    /**
     * Obtener lista de escáneres e impresoras multifuncionales conectados (WIA + eSCL)
     */
    static async getConnectedScanners() {
        const defaultOption = {
            id: 'DEFAULT_WIA_SCANNER',
            name: 'Selección Automática (Escáner o Impresora Predeterminada)',
            manufacturer: 'Windows WIA / eSCL',
            type: 'GENERIC',
            status: 'Listo'
        };

        const esclDevices = await this.discoverEsclDevices().catch(() => []);

        if (process.platform !== 'win32') {
            return [defaultOption, ...esclDevices];
        }

        return new Promise((resolve) => {
            const psScript = `
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    $list = @()
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
        $info = $dm.DeviceInfos.Item($i)
        $name = $info.Properties.Item('Name').Value
        $manufacturer = try { $info.Properties.Item('Manufacturer').Value } catch { 'WIA Scanner' }
        $id = $info.DeviceID
        $list += [PSCustomObject]@{
            id = $id
            name = $name
            manufacturer = $manufacturer
            type = 'HARDWARE_SCANNER'
            status = 'Listo'
        }
    }
    $list | ConvertTo-Json -Compress
} catch {
    Write-Output "[]"
}
`;
            const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
            const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript]);
            let stdout = '';
            let isDone = false;

            const timer = setTimeout(() => {
                if (!isDone) {
                    isDone = true;
                    try { child.kill(); } catch (_) {}
                    resolve([defaultOption, ...esclDevices]);
                }
            }, 8000);

            child.stdout.on('data', (d) => { stdout += d.toString(); });
            child.on('error', () => {
                if (!isDone) {
                    isDone = true;
                    clearTimeout(timer);
                    resolve([defaultOption, ...esclDevices]);
                }
            });
            child.on('close', () => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timer);

                let wiaDevices = [];
                if (stdout) {
                    try {
                        const trimmed = stdout.trim();
                        if (trimmed && trimmed !== '[]') {
                            const parsed = JSON.parse(trimmed);
                            const items = Array.isArray(parsed) ? parsed : [parsed];
                            wiaDevices = items.map(d => ({
                                id: d.id || 'DEFAULT_WIA_SCANNER',
                                name: d.name || 'Escáner WIA',
                                manufacturer: d.manufacturer || 'Windows WIA',
                                type: 'HARDWARE_SCANNER',
                                status: 'Listo'
                            }));
                        }
                    } catch (e) {}
                }

                // Fusionar sin duplicados
                const combined = [defaultOption];
                for (const d of [...esclDevices, ...wiaDevices]) {
                    if (!combined.some(x => x.id === d.id || x.name === d.name)) {
                        combined.push(d);
                    }
                }

                resolve(combined);
            });
        });
    }

    /**
     * Escanea directamente utilizando el protocolo nativo eSCL de la impresora
     */
    static async scanViaEscl(ip, options = {}) {
        if (!isSafePrivateIp(ip)) {
            throw new Error('Dirección IP de escáner no permitida o fuera de la red local autorizada (SSRF Protection).');
        }

        const { dpi = 300, colorMode = 'color' } = options;
        const colorModeXml = (colorMode === 'bw' || colorMode === 'monochrome') ? 'Grayscale8' : 'RGB24';
        const resolution = Number(dpi) || 300;

        // 1. Verificar si el escáner está ocupado y esperar si es necesario (hasta 20s)
        console.log(`[ScannerService] Verificando estado del escáner en http://${ip}/eSCL/ScannerStatus...`);
        for (let attempt = 1; attempt <= 10; attempt++) {
            try {
                const statusRes = await axios.get(`http://${ip}/eSCL/ScannerStatus`, { timeout: 4000 });
                if (statusRes.status === 200 && typeof statusRes.data === 'string') {
                    const isBusy = statusRes.data.includes('<pwg:State>Processing</pwg:State>') || 
                                   statusRes.data.includes('<pwg:State>Testing</pwg:State>') || 
                                   statusRes.data.includes('JobScanning');
                    if (!isBusy) {
                        break;
                    }
                    console.log(`[ScannerService] Escáner ocupado con un escaneo previo. Esperando que termine... (intento ${attempt}/10)`);
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    break;
                }
            } catch (e) {
                // Si la consulta de estado falla brevemente, continuamos
                break;
            }
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>2550</pwg:Width>
      <pwg:Height>3508</pwg:Height>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <scan:InputSource>Platen</scan:InputSource>
  <scan:ColorMode>${colorModeXml}</scan:ColorMode>
  <scan:XResolution>${resolution}</scan:XResolution>
  <scan:YResolution>${resolution}</scan:YResolution>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
</scan:ScanSettings>`;

        // 2. Enviar trabajo de escaneo con reintentos si está temporalmente ocupado
        let jobLocation = null;
        let lastError = null;

        for (let jobAttempt = 1; jobAttempt <= 3; jobAttempt++) {
            try {
                console.log(`[ScannerService] Enviando trabajo eSCL a http://${ip}/eSCL/ScanJobs (DPI: ${resolution}, Intento ${jobAttempt})...`);
                const res = await axios.post(`http://${ip}/eSCL/ScanJobs`, xml, {
                    headers: { 'Content-Type': 'text/xml' },
                    timeout: 30000
                });

                if (res.status === 201 && res.headers.location) {
                    jobLocation = res.headers.location;
                    break;
                }
            } catch (err) {
                lastError = err;
                console.warn(`[ScannerService] Intento ${jobAttempt} falló al crear trabajo:`, err.message);
                if (jobAttempt < 3) {
                    await new Promise(r => setTimeout(r, 2500));
                }
            }
        }

        if (!jobLocation) {
            throw new Error(`La impresora/escáner no aceptó el trabajo de escaneo (${lastError?.message || 'Ocupada'}). Verifica que esté encendida y no esté ocupada con otra copia o impresión.`);
        }

        let jobUrl;
        if (jobLocation.startsWith('http://') || jobLocation.startsWith('https://')) {
            try {
                const parsed = new URL(jobLocation);
                if (parsed.hostname !== ip) {
                    throw new Error('SSRF Blocked: El escáner redirigió a un host o IP no autorizada.');
                }
                jobUrl = jobLocation;
            } catch (e) {
                throw new Error('URL de trabajo de escaneo inválida: ' + e.message);
            }
        } else {
            jobUrl = `http://${ip}${jobLocation.startsWith('/') ? '' : '/'}${jobLocation}`;
        }
        console.log(`[ScannerService] Trabajo aceptado. Descargando imagen desde: ${jobUrl}/NextDocument...`);

        // 3. Descargar el documento escaneado (a 600 DPI puede tomar más de 80s)
        const docTimeoutMs = resolution >= 600 ? 180000 : 120000;
        const startTime = Date.now();
        let docBuffer = null;

        while (Date.now() - startTime < docTimeoutMs) {
            try {
                const docRes = await axios.get(`${jobUrl}/NextDocument`, {
                    responseType: 'arraybuffer',
                    timeout: docTimeoutMs,
                    validateStatus: (status) => status === 200 || status === 503 || status === 404
                });

                if (docRes.status === 200 && docRes.data && docRes.data.length > 0) {
                    docBuffer = Buffer.from(docRes.data);
                    break;
                }

                // 503 o 404 indican que el escáner sigue procesando la óptica de la hoja
                console.log(`[ScannerService] Escaneando documento... (esperando óptica, status ${docRes.status})`);
                await new Promise(r => setTimeout(r, 2500));
            } catch (fetchErr) {
                console.warn(`[ScannerService] Esperando transferencia del escáner:`, fetchErr.message);
                await new Promise(r => setTimeout(r, 2500));
            }
        }

        if (!docBuffer || docBuffer.length === 0) {
            throw new Error('El escáner tardó demasiado en transferir la imagen o la operación fue cancelada.');
        }

        console.log(`[ScannerService] Imagen escaneada exitosamente (${docBuffer.length} bytes, tiempo: ${((Date.now() - startTime) / 1000).toFixed(1)}s).`);
        return docBuffer;
    }

    /**
     * Adquirir documento escaneado desde la impresora/escáner físico
     */
    static async scanDocument(options = {}) {
        const { deviceId, dpi = 300, colorMode = 'color' } = options;
        const timestamp = Date.now();
        const filename = `invoice_scan_${timestamp}.jpg`;

        // Destino garantizado en directorio persistente de facturas (NUNCA dentro de app.asar)
        const invoicesDir = InvoiceService.getInvoicesDir();
        const outputPath = path.join(invoicesDir, filename);

        // 1. INTENTO VÍA eSCL DIRECTO
        const isExplicitEscl = deviceId && deviceId.startsWith('ESCL_NET_');
        let targetIp = null;
        if (isExplicitEscl) {
            targetIp = deviceId.replace('ESCL_NET_', '');
        } else if (!deviceId || deviceId === 'DEFAULT_WIA_SCANNER') {
            const esclDevs = await this.discoverEsclDevices().catch(() => []);
            if (esclDevs.length > 0) {
                targetIp = esclDevs[0].ip;
            }
        }

        if (targetIp) {
            try {
                console.log(`[ScannerService] Intentando escaneo ultra-rápido por eSCL en ${targetIp}...`);
                const imgBuffer = await this.scanViaEscl(targetIp, { dpi, colorMode });
                fs.writeFileSync(outputPath, imgBuffer);
                console.log(`[ScannerService] Factura escaneada por eSCL guardada con éxito en: ${outputPath} (${imgBuffer.length} bytes)`);

                return {
                    success: true,
                    invoiceUrl: `/invoices/${filename}`,
                    filename: filename,
                    path: outputPath,
                    toString() { return outputPath; }
                };
            } catch (esclErr) {
                // Si el usuario seleccionó explícitamente este escáner de red, NO caer a otro WIA aleatorio
                if (isExplicitEscl) {
                    console.error(`[ScannerService] Error definitivo en escáner de red eSCL:`, esclErr.message);
                    throw new Error(`Error en escáner de red (${targetIp}): ${esclErr.message}`);
                }
                console.warn(`[ScannerService] eSCL falló (${esclErr.message}), recurriendo a Windows WIA...`);
            }
        }

        // 2. FALLBACK A WINDOWS WIA NATIVO CON CONVERTIDOR DE IMAGEN
        return new Promise((resolve, reject) => {
            if (process.platform !== 'win32') {
                return reject(new Error('El escaneo por hardware solo está disponible en Windows.'));
            }

            let wiaIntent = 1; // Default Color
            if (colorMode === 'bw' || colorMode === 'monochrome') wiaIntent = 4;
            else if (colorMode === 'gray' || colorMode === 'grayscale') wiaIntent = 2;

            const safeDeviceId = (deviceId && !deviceId.startsWith('DEFAULT') && !deviceId.startsWith('ESCL_')) 
                ? String(deviceId).replace(/[`$"\\]/g, '') 
                : '';
            const safeDpi = Math.max(75, Math.min(Number(dpi) || 300, 1200));
            const safeIntent = [1, 2, 4].includes(wiaIntent) ? wiaIntent : 1;
            const safeOutputPath = outputPath.replace(/'/g, "''");

            const psScript = `
Add-Type -AssemblyName System.Drawing
$outPath = '${safeOutputPath}'
$targetDeviceId = '${safeDeviceId}'
$targetDpi = ${safeDpi}
$targetIntent = ${safeIntent}

try {
    $dm = New-Object -ComObject WIA.DeviceManager
    if ($dm.DeviceInfos.Count -eq 0) {
        Write-Output "ERROR:No se detectó ningún escáner o impresora multifuncional conectada."
        exit 1
    }

    $selectedDeviceInfo = $null
    if ($targetDeviceId -and $targetDeviceId -ne "") {
        for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
            $curr = $dm.DeviceInfos.Item($i)
            if ($curr.DeviceID -eq $targetDeviceId) {
                $selectedDeviceInfo = $curr
                break
            }
        }
    }

    if (-not $selectedDeviceInfo) {
        $selectedDeviceInfo = $dm.DeviceInfos.Item(1)
    }

    $dev = $selectedDeviceInfo.Connect()
    $item = $dev.Items.Item(1)

    try { $item.Properties.Item('6146').Value = $targetIntent } catch {}
    try {
        $item.Properties.Item('6147').Value = $targetDpi
        $item.Properties.Item('6148').Value = $targetDpi
    } catch {}

    $image = $item.Transfer()
    
    $tempBmp = "$outPath.tmp.bmp"
    if (Test-Path $tempBmp) { Remove-Item $tempBmp -Force }
    $image.SaveFile($tempBmp)

    $bmp = [System.Drawing.Bitmap]::FromFile($tempBmp)
    if (Test-Path $outPath) { Remove-Item $outPath -Force }
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
    if (Test-Path $tempBmp) { Remove-Item $tempBmp -Force }

    Write-Output "SUCCESS:$outPath"
} catch {
    Write-Output "ERROR:$($_.Exception.Message)"
} finally {
    if ($dev) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dev) | Out-Null }
    if ($dm) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dm) | Out-Null }
    [System.GC]::Collect()
}
`;

            const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
            const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript]);
            let stdout = '';
            let stderr = '';
            let isDone = false;

            const timer = setTimeout(() => {
                if (!isDone) {
                    isDone = true;
                    try { child.kill(); } catch (_) {}
                    reject(new Error('El escáner tardó demasiado o está ocupado.'));
                }
            }, 180000);

            child.stdout.on('data', (d) => { stdout += d.toString(); });
            child.stderr.on('data', (d) => { stderr += d.toString(); });
            child.on('error', (err) => {
                if (!isDone) {
                    isDone = true;
                    clearTimeout(timer);
                    reject(err);
                }
            });
            child.on('close', () => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timer);

                const output = (stdout || '') + (stderr || '');

                if (fs.existsSync(outputPath)) {
                    return resolve({
                        success: true,
                        invoiceUrl: `/invoices/${filename}`,
                        filename: filename,
                        path: outputPath,
                        toString() { return outputPath; }
                    });
                }

                if (output.includes('ERROR:')) {
                    const msg = output.split('ERROR:')[1].split('\n')[0].trim();
                    return reject(new Error(msg || 'Error al comunicarse con la impresora/escáner.'));
                }

                reject(new Error('No se pudo completar el escaneo. Verifica que la impresora esté encendida.'));
            });
        });
    }
}

module.exports = ScannerService;
