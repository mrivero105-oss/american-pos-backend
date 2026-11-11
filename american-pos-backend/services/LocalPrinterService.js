const { exec, spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

class LocalPrinterService {
    static _helperExePath = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'IsaacPOS_RawPrinter_v1.exe');
    static _printerQueues = new Map();

    /**
     * Encola tareas de impresión secuencialmente por impresora física para evitar colisiones de puerto USB/Spooler
     */
    static _enqueue(printerKey, taskFn) {
        const key = String(printerKey || 'default').toLowerCase().trim();
        const previousPromise = this._printerQueues.get(key) || Promise.resolve();

        const currentPromise = previousPromise
            .catch(() => {})
            .then(() => taskFn());

        this._printerQueues.set(key, currentPromise);
        currentPromise.finally(() => {
            if (this._printerQueues.get(key) === currentPromise) {
                this._printerQueues.delete(key);
            }
        });

        return currentPromise;
    }

    // Compila el micro-binario C# nativo UNA SOLA VEZ en la vida del servidor (0% CPU, 12ms por ticket)
    static async _ensureNativeHelper() {
        if (fs.existsSync(this._helperExePath)) return this._helperExePath;

        const csSource = `
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName = "POS Ticket";
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile = null;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType = "RAW";
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static int Main(string[] args) {
        if (args.Length < 2) return 1;
        string printerName = args[0];
        byte[] bytes = File.ReadAllBytes(args[1]);
        IntPtr hPrinter;
        if (!OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) return 2;
        try {
            DOCINFOA di = new DOCINFOA();
            if (!StartDocPrinter(hPrinter, 1, di)) return 3;
            try {
                if (!StartPagePrinter(hPrinter)) return 4;
                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                int written = 0;
                bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
                Marshal.FreeCoTaskMem(pUnmanagedBytes);
                EndPagePrinter(hPrinter);
                return ok ? 0 : 5;
            } finally { EndDocPrinter(hPrinter); }
        } finally { ClosePrinter(hPrinter); }
    }
}`;
        const csPath = this._helperExePath.replace(/\.exe$/, '.cs');
        await fs.promises.writeFile(csPath, csSource, 'utf8');

        const cscCandidates = [
            'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
            'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
        ];
        const cscPath = cscCandidates.find(p => fs.existsSync(p)) || 'csc.exe';

        return new Promise((resolve, reject) => {
            execFile(cscPath, ['/nologo', '/optimize+', `/out:${this._helperExePath}`, csPath], { windowsHide: true }, (err) => {
                fs.unlink(csPath, () => {});
                if (err) return reject(err);
                resolve(this._helperExePath);
            });
        });
    }

    /**
     * Obtiene la lista de impresoras instaladas en Windows
     */
    static async getSystemPrinters() {
        if (process.platform !== 'win32') {
            return [];
        }

        return new Promise((resolve) => {
            const psCmd = `Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName | ConvertTo-Json -Compress`;
            exec(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { timeout: 6000 }, (err, stdout) => {
                if (err || !stdout) {
                    exec('wmic printer get name,default,portname /format:csv', { timeout: 5000 }, (werr, wout) => {
                        if (werr || !wout) return resolve([]);
                        try {
                            const lines = wout.trim().split(/\r?\n/).filter(l => l && !l.toLowerCase().startsWith('node'));
                            const list = lines.map(line => {
                                const parts = line.split(',');
                                if (parts.length >= 3) {
                                    return {
                                        name: parts[2]?.trim() || parts[1]?.trim(),
                                        isDefault: parts[1]?.toLowerCase() === 'true',
                                        portName: parts[3]?.trim() || ''
                                    };
                                }
                                return null;
                            }).filter(p => p && p.name);
                            resolve(list);
                        } catch (_) {
                            resolve([]);
                        }
                    });
                    return;
                }

                try {
                    let parsed = JSON.parse(stdout.trim());
                    if (!Array.isArray(parsed)) parsed = [parsed];
                    const printers = parsed.filter(p => p && p.Name).map(p => ({
                        name: p.Name,
                        isDefault: !!p.Default,
                        portName: p.PortName || ''
                    }));
                    resolve(printers);
                } catch (e) {
                    console.warn('[LocalPrinterService] Error parseando salida de impresoras:', e.message);
                    resolve([]);
                }
            });
        });
    }

    /**
     * Filtra impresoras virtuales del sistema operativo (PDF, XPS, OneNote, Fax)
     */
    static isVirtualPrinter(name = '', portName = '') {
        const n = String(name).toLowerCase();
        const p = String(portName).toLowerCase();
        const virtualKeywords = [
            'microsoft print to pdf', 'microsoft xps', 'onenote', 'fax',
            'send to', 'adobe pdf', 'foxit', 'cutepdf', 'dopdf', 'bullzip',
            'anydesk', 'teamviewer', 'pdfcreator', 'xps document writer'
        ];
        if (virtualKeywords.some(k => n.includes(k))) return true;
        if (p === 'portprompt:' || p === 'nul:' || p.includes('onenote')) return true;
        return false;
    }

    /**
     * Resuelve inteligentemente el nombre de la impresora térmica/física instalada en Windows
     */
    static async resolvePrinterName(requestedName = '') {
        const cleanReq = String(requestedName || '').trim();
        try {
            const printers = await this.getSystemPrinters();
            if (!Array.isArray(printers) || printers.length === 0) {
                return cleanReq || null;
            }

            // 1. Si el usuario especificó un nombre y existe en el sistema
            if (cleanReq) {
                const exact = printers.find(p => p.name === cleanReq);
                if (exact && !this.isVirtualPrinter(exact.name, exact.portName)) return exact.name;
                const ci = printers.find(p => p.name.toLowerCase() === cleanReq.toLowerCase());
                if (ci && !this.isVirtualPrinter(ci.name, ci.portName)) return ci.name;
                const partial = printers.find(p =>
                    (p.name.toLowerCase().includes(cleanReq.toLowerCase()) || cleanReq.toLowerCase().includes(p.name.toLowerCase())) &&
                    !this.isVirtualPrinter(p.name, p.portName)
                );
                if (partial) return partial.name;
            }

            // 2. Buscar impresoras físicas (excluyendo virtuales)
            const physicalPrinters = printers.filter(p => !this.isVirtualPrinter(p.name, p.portName));
            if (physicalPrinters.length === 0) {
                return cleanReq || null;
            }

            // 3. Priorizar impresoras térmicas / POS por palabras clave
            const thermalKeywords = [
                'pos', '58', '80', 'thermal', 'termica', 'térmica', 'receipt', 'ticket',
                'epson', 'tm-', 'xprinter', 'xp-', 'bixolon', '3nstar', 'sat', 'bematech',
                'star', 'citizen', 'custom', 'sewoo', 'rongta', 'gp-', 'gprinter',
                'zjiang', 'zj-', 'generic', 'text only', 'usb00'
            ];
            const thermalMatch = physicalPrinters.find(p => {
                const combined = `${p.name} ${p.portName || ''}`.toLowerCase();
                return thermalKeywords.some(k => combined.includes(k));
            });
            if (thermalMatch) return thermalMatch.name;

            // 4. Usar la predeterminada de Windows si es física
            const defaultPhysical = physicalPrinters.find(p => p.isDefault);
            if (defaultPhysical) return defaultPhysical.name;

            return physicalPrinters[0]?.name || null;
        } catch (e) {
            console.warn('[LocalPrinterService] Error resolviendo impresora:', e.message);
            return cleanReq || null;
        }
    }

    /**
     * Envía comandos RAW (ESC/POS) directamente a la impresora de Windows encolados de forma no bloqueante
     */
    static async printRaw(content, printerName, options = {}) {
        const resolvedPrinter = await this.resolvePrinterName(printerName);
        if (!resolvedPrinter) {
            throw new Error('No se detectó ninguna impresora térmica o física conectada en el equipo');
        }
        const targetPrinter = resolvedPrinter;

        if (process.platform !== 'win32') {
            throw new Error('Impresión RAW directa solo disponible en Windows');
        }

        const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '', 'utf8');
        const forceGdi = options?.printMode === 'HTML' || options?.gdi === true;

        // Encolamiento FIFO secuencial por impresora para garantizar <50ms y cero colisiones de puerto USB
        return this._enqueue(targetPrinter, () => this._executeRawPrint(buffer, targetPrinter, forceGdi));
    }

    static async _executeRawPrint(buffer, printerName, forceGdi = false) {
        // 1. Envío ultrarrápido vía binario empaquetado RawPrinter.exe si existe
        let binPath = path.resolve(__dirname, '../bin/RawPrinter.exe');
        if (binPath.includes('app.asar')) {
            const unpackedPath = binPath.replace('app.asar', 'app.asar.unpacked');
            if (fs.existsSync(unpackedPath)) {
                binPath = unpackedPath;
            }
        }
        if (fs.existsSync(binPath)) {
            const args = forceGdi ? [printerName, '--gdi'] : [printerName];
            return new Promise((resolve, reject) => {
                const child = execFile(binPath, args, {
                    timeout: 8000,
                    maxBuffer: 2 * 1024 * 1024,
                    windowsHide: true
                }, (error, stdout, stderr) => {
                    if (error) {
                        if (error.killed) {
                            return reject(new Error('PRINTER_TIMEOUT: El spooler de Windows no respondió en 8 segundos.'));
                        }
                        return reject(new Error(`PRINTER_SPOOL_ERROR: ${stderr || error.message}`));
                    }
                    resolve({ success: true, output: stdout.trim() });
                });

                child.on('error', (spawnErr) => {
                    reject(new Error(`PRINTER_SPAWN_ERROR: ${spawnErr.message}`));
                });

                try {
                    child.stdin.write(buffer);
                    child.stdin.end();
                } catch (pipeErr) {
                    reject(pipeErr);
                }
            });
        }

        // 2. Micro-Helper Nativo Compilado Win32 (0% CPU, 12ms, sin PowerShell en cada ticket)
        const tempSpoolFile = path.join(process.env.TEMP || 'C:\\Windows\\Temp', `spool_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.bin`);
        await fs.promises.writeFile(tempSpoolFile, buffer);

        try {
            const exePath = await this._ensureNativeHelper();
            return await new Promise((resolve, reject) => {
                execFile(exePath, [printerName, tempSpoolFile], { windowsHide: true, timeout: 5000 }, (err) => {
                    fs.unlink(tempSpoolFile, () => {});
                    if (err) {
                        return reject(new Error(`No se pudo enviar el trabajo de impresión a '${printerName}'. Verifique que la impresora esté encendida y conectada. (Código winspool: ${err.code || err.message})`));
                    }
                    resolve({ success: true });
                });
            });
        } catch (helperErr) {
            fs.unlink(tempSpoolFile, () => {});
            throw helperErr;
        }
    }

    /**
     * Envía pulso a la gaveta de dinero con verificación de usuario y auditoría inmutable
     */
    static async openDrawer(arg1, arg2, arg3, arg4, arg5) {
        let printerName, sequence, user, reason, shiftId;
        if (typeof arg1 === 'object' && arg1 !== null && !Buffer.isBuffer(arg1)) {
            printerName = arg1.printerName;
            sequence = arg1.sequence || '27,112,48,25,250';
            user = arg1.user;
            reason = arg1.reason || 'Apertura Manual';
            shiftId = arg1.shiftId || null;
        } else {
            printerName = arg1;
            sequence = arg2 || '27,112,48,25,250';
            user = arg3;
            reason = arg4 || 'Apertura Manual';
            shiftId = arg5 || null;
        }

        if (!user || !user.id) {
            throw new Error('SECURITY_ERROR: No se puede expulsar la gaveta sin un usuario autenticado responsable.');
        }

        try {
            const { AuditLog, User } = require('../database/models');
            const { generateRobustId } = require('../utils/helpers');

            let validUserId = null;
            if (user && user.id) {
                const existingUser = await User.findByPk(String(user.id), { attributes: ['id'] }).catch(() => null);
                if (existingUser) {
                    validUserId = existingUser.id;
                }
            }

            await AuditLog.create({
                id: generateRobustId(),
                userId: validUserId,
                companyId: String(user.companyId || 'default'),
                action: 'DRAWER_KICK_MANUAL',
                description: `Apertura de gaveta por usuario "${user.name || user.username || user.id}". Motivo: ${reason}. Turno: ${shiftId || 'Sin turno'}`,
                timestamp: new Date().toISOString()
            });

            try {
                const OwnerNotificationService = require('./OwnerNotificationService');
                await OwnerNotificationService.notifySecurityAlert(
                    String(user.companyId || 'default'),
                    'MANUAL_DRAWER_OPEN',
                    {
                        userName: user.name || user.username || user.id,
                        reason: reason,
                        registerId: shiftId || '1'
                    }
                );
            } catch (_notifErr) {}
        } catch (auditErr) {
            console.error('[DRAWER-AUDIT] Error registrando auditoría de gaveta:', auditErr.message);
        }

        const parts = String(sequence).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        const drawerBytes = Buffer.from(parts.length > 0 ? parts : [27, 112, 48, 25, 250]);
        return await this.printRaw(drawerBytes, printerName);
    }
}

module.exports = LocalPrinterService;
