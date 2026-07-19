const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

// Handle Squirrel events for Windows immediately on startup
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
        process.exit(0);
    }
} catch (e) {}

// 🔒 SINGLE INSTANCE LOCK: Evitar doble inicio al encender la PC o al abrir el acceso directo varias veces
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Si Windows o el usuario intentan abrir una segunda instancia del POS, enfocamos la existente
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

const handleEpipe = (err) => {
    if (err.code === 'EPIPE') return;
    // Rethrow other errors
    throw err;
};
process.stdout.on('error', handleEpipe);
process.stderr.on('error', handleEpipe);

// Global patch for console to prevent crashes when stdout/stderr are closed
function sanitizePrinterName(name) {
    if (!name) return '';
    // Let's only remove newlines and quotes to prevent command injection,
    // but allow parentheses, spaces, hyphens, and other valid Windows printer characters.
    return name.replace(/[\n\r'"]/g, '').trim();
}

// AND to optionally redirect all logs to our persistent desktop log file.
const LOGS_ENABLED = process.env.ENABLE_FILE_LOGS === 'true';

const patchConsole = (method) => {
    const original = console[method];
    console[method] = (...args) => {
        try {
            if (LOGS_ENABLED) {
                // Log to our file first
                const msg = args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                ).join(' ');
                log(`[CONSOLE.${method.toUpperCase()}] ${msg}`);
            }

            if (original) {
                original.apply(console, args);
            }
        } catch (err) {
            // Silently ignore EPIPE, log nothing to avoid recursion
            if (err.code !== 'EPIPE' && method !== 'error') {
                if (LOGS_ENABLED) {
                    try { fs.appendFileSync(logFile, `[ERR] Failed to log console.${method}: ${err.message}\n`); } catch (e) { }
                }
            }
        }
    };
};
['log', 'error', 'warn', 'info', 'debug'].forEach(patchConsole);

// Load environment variables immediately to ensure DB_DIALECT and other settings are available
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const os = require('os');

const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) {
    try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) { }
}
const logFile = path.join(logDir, 'pos_startup_log.txt');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(message) {
    if (!LOGS_ENABLED) return;
    try {
        const timestamp = new Date().toISOString();
        logStream.write(`[${timestamp}] ${message}\n`);
    } catch (e) {
        // Fallback
    }
}

try {
    log(`Starting main.js execution. UserData: ${app.getPath('userData')}`);
} catch (e) {
    // Silent fail if log fails early
}

// const { startServer } = require('./index.js'); // Moved to whenReady


let mainWindow;
let isQuittingAfterBackup = false;

async function performFastDbBackupOnly() {
    log('Fast Exit: Running atomic SQLite database backup...');
    try {
        const userDataPath = app.getPath('userData');
        const { performSqliteBackup } = require('./utils/sqliteBackupHelper');
        const backupFile = await performSqliteBackup(userDataPath);
        log(`Fast Exit: Atomic DB backup completed: ${backupFile}`);
        return true;
    } catch (dbErr) {
        log(`Error in fast atomic DB backup: ${dbErr.message}`);
        return false;
    }
}

/**
 * Performs an automatic backup of both:
 * 1. Atomic SQLite database (auto-backups/)
 * 2. Master Snapshot (.zip with database, product images & supplier logos in backups/)
 */
async function performAutoBackup() {
    log('Auto-backup: Initiating automatic dual backups (Atomic DB + Master Snapshot)...');
    try {
        const userDataPath = app.getPath('userData');
        const { performSqliteBackup } = require('./utils/sqliteBackupHelper');
        const { createMasterSnapshot } = require('./utils/snapshotHelper');
        
        log('Running 1/2: Atomic SQLite backup...');
        try {
            const backupFile = await performSqliteBackup(userDataPath);
            log(`Atomic DB backup completed: ${backupFile}`);
        } catch (dbErr) {
            log(`Error in atomic DB backup: ${dbErr.message}`);
        }

        log('Running 2/2: Master Snapshot (.zip with images & logos)...');
        try {
            const snapshotFile = await createMasterSnapshot(userDataPath);
            log(`Master Snapshot completed: ${snapshotFile}`);
        } catch (snapErr) {
            log(`Warning: Master snapshot non-fatal error: ${snapErr.message}`);
        }

        log('Auto-backup sequence completed successfully.');
        return true;
    } catch (err) {
        log(`Auto-backup error: ${err.message}`);
        console.error('Auto-backup failed:', err);
        return false;
    }
}

function createWindow(serverPort) {
    log('Entering createWindow function...');
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'public/assets/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true, // Ocultar barra de menú (presionar Alt para mostrar temporalmente)
        show: true // Force show
    });

    // Create Logic Menu
    const { Menu } = require('electron');
    const menuTemplate = [
        {
            label: 'Archivo',
            submenu: [
                { role: 'quit', label: 'Salir' }
            ]
        },
        {
            label: 'Editar',
            submenu: [
                { role: 'undo', label: 'Deshacer' },
                { role: 'redo', label: 'Rehacer' },
                { type: 'separator' },
                { role: 'cut', label: 'Cortar' },
                { role: 'copy', label: 'Copiar' },
                { role: 'paste', label: 'Pegar' }
            ]
        },
        {
            label: 'Ver',
            submenu: [
                { role: 'reload', label: 'Recargar' },
                { role: 'forceReload', label: 'Recargar Forzado' },
                { role: 'toggleDevTools', label: 'Herramientas de Desarrollo' },
                { type: 'separator' },
                { role: 'resetZoom', label: 'Tamaño Real' },
                { role: 'zoomIn', label: 'Acercar' },
                { role: 'zoomOut', label: 'Alejar' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Pantalla Completa' }
            ]
        },
        {
            label: 'Ayuda',
            submenu: [
                {
                    label: 'Verificar Actualizaciones de American POS...',
                    click: async () => {
                        if (mainWindow) {
                            if (electronUpdaterInstance) {
                                mainWindow.webContents.send('updater-event', { status: 'checking' });
                                electronUpdaterInstance.checkForUpdates().catch(e => {
                                    log(`Check for updates error: ${e.message}`);
                                    mainWindow.webContents.send('updater-event', { status: 'error', error: e.message });
                                });
                            }
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Acerca de...',
                    click: async () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('show-about');
                        }
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
    if (mainWindow) {
        mainWindow.setMenuBarVisibility(false);
    }

    // Cargar la app desde el servidor local usando el puerto dinámico
    const portToUse = serverPort || 3005;
    const url = `http://localhost:${portToUse}`;
    log(`Loading URL: ${url}`);

    mainWindow.loadURL(url);

    mainWindow.webContents.on('did-finish-load', () => {
        log('Page loaded successfully.');
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        log(`FAILED TO LOAD: ${errorCode} - ${errorDescription}`);
    });

    mainWindow.webContents.on('crashed', () => {
        log('Renderer process CRASHED. Attempting recovery...');
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.reload();
            }
        }, 1000);
    });

    mainWindow.on('ready-to-show', () => {
        log('Window ready-to-show event fired.');
        mainWindow.show();
    });

    mainWindow.on('closed', function () {
        log('Window closed.');
        mainWindow = null;
    });

    // --- AUTO-BACKUP ON CLOSE ---
    mainWindow.on('close', (event) => {
        // Only intercept if we haven't already done the backup
        if (!isQuittingAfterBackup) {
            event.preventDefault(); // Prevent immediate close
            isQuittingAfterBackup = true;
            log('Window close intercepted. Running fast DB backup before quit...');

            // Race the fast backup against a 1.5-second timeout for instant shutdown
            const backupTimeout = new Promise(resolve => setTimeout(() => resolve(false), 1500));
            Promise.race([performFastDbBackupOnly(), backupTimeout]).then((success) => {
                log(`Fast auto-backup result: ${success ? 'SUCCESS' : 'FAILED/TIMEOUT'}. Closing now.`);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.close(); // Now allow the real close
                } else {
                    app.quit();
                }
            });
        }
    });

    // --- IPC Hardware Hub ---
    const { ipcMain } = require('electron');

    // Validación estricta anti-falsificación de IPC: Garantiza que la llamada provenga del webContents legítimo
    const verifyIpcSender = (event) => {
        if (event.sender !== mainWindow?.webContents) {
            log('Acceso IPC denegado: El emisor no coincide con la ventana principal de la aplicación.');
            return false;
        }
        const url = event.senderFrame?.url;
        if (!url || (!url.startsWith('http://localhost:') && !url.startsWith('file://'))) {
            log('Acceso IPC denegado por origen de URL no autorizado: ' + url);
            return false;
        }
        return true;
    };

    ipcMain.handle('get-auto-launch', async (event) => {
        if (!verifyIpcSender(event)) return false;
        try {
            const { execSync } = require('child_process');
            let isOpenAtLogin = false;
            try {
                if (app.getLoginItemSettings) {
                    isOpenAtLogin = app.getLoginItemSettings().openAtLogin;
                }
            } catch (e) {}
            try {
                const regOutput = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "American POS"', { encoding: 'utf-8' });
                if (regOutput && regOutput.includes('American POS')) {
                    isOpenAtLogin = true;
                }
            } catch (e) {}
            return isOpenAtLogin;
        } catch (err) {
            log(`Error getting auto-launch: ${err.message}`);
            return false;
        }
    });

    ipcMain.handle('set-auto-launch', async (event, enabled) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Origen no autorizado' };
        try {
            const exePath = process.execPath;
            log(`Setting auto-launch to ${enabled} with path: ${exePath}`);

            try {
                if (app.setLoginItemSettings) {
                    app.setLoginItemSettings({
                        openAtLogin: enabled,
                        path: exePath,
                        args: []
                    });
                }
            } catch (e) {
                log(`app.setLoginItemSettings error: ${e.message}`);
            }

            const { execSync } = require('child_process');
            if (enabled) {
                try {
                    let targetPath = exePath;
                    if (exePath.toLowerCase().includes('node.exe') || exePath.toLowerCase().includes('electron.exe')) {
                        const defaultInstallPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'AmericanPOS', 'American POS.exe');
                        if (fs.existsSync(defaultInstallPath)) {
                            targetPath = defaultInstallPath;
                        }
                    }
                    execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "American POS" /t REG_SZ /d "\\"${targetPath}\\"" /f`, { stdio: 'ignore' });
                } catch (e) {
                    log(`Reg add error: ${e.message}`);
                }
            } else {
                try {
                    execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "American POS" /f`, { stdio: 'ignore' });
                } catch (e) {
                    log(`Reg delete error: ${e.message}`);
                }
            }

            try {
                const settingsPath = path.join(__dirname, 'settings.json');
                let settings = {};
                if (fs.existsSync(settingsPath)) {
                    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                }
                settings.autoLaunch = enabled;
                fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            } catch (e) {}

            log(`Auto-launch set successfully to ${enabled}`);
            return { success: true, enabled };
        } catch (err) {
            log(`Error setting auto-launch: ${err.message}`);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('get-printers', async (event) => {
        if (!verifyIpcSender(event)) return [];
        try {
            return await mainWindow.webContents.getPrintersAsync();
        } catch (error) {
            log(`Error getting printers: ${error.message}`);
            return [];
        }
    });

    ipcMain.handle('print-silent', async (event, content, printerName) => {
        if (!verifyIpcSender(event)) {
            return { success: false, error: 'Origen de IPC no autorizado ni autenticado' };
        }
        
        log(`Print request received for printer: ${printerName}`);
        return new Promise((resolve) => {
            try {
                let printWin = new BrowserWindow({
                    show: false,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        sandbox: true,
                        javascript: false // No scripts needed for printing raw HTML
                    }
                });

                printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`);

                printWin.webContents.on('did-finish-load', () => {
                    log(`Content loaded in hidden window, starting silent print to ${printerName}...`);
                    printWin.webContents.print({
                        silent: true,
                        deviceName: printerName,
                        margins: { marginType: 'printableArea' }
                    }, (success, failureReason) => {
                        if (success) {
                            log(`Print successful on ${printerName}`);
                            resolve({ success: true });
                        } else {
                            log(`Print failed on ${printerName}: ${failureReason}`);
                            resolve({ success: false, error: failureReason });
                        }
                        printWin.close();
                    });
                });

                // Safety timeout
                setTimeout(() => {
                    if (!printWin.isDestroyed()) {
                        log('Print operation timed out.');
                        printWin.close();
                        resolve({ success: false, error: 'Timeout de impresión' });
                    }
                }, 10000);

            } catch (err) {
                log(`Crash during print process: ${err.message}`);
                resolve({ success: false, error: err.message });
            }
        });
    });
    ipcMain.handle('open-drawer', async (event, printerName, sequence) => {
        if (!verifyIpcSender(event)) {
            return { success: false, error: 'Origen de IPC no autorizado ni autenticado' };
        }

        const safePrinterName = sanitizePrinterName(printerName);
        log(`Attempting to open drawer on printer: ${safePrinterName} with sequence: ${sequence || 'default'}`);
        if (!safePrinterName) {
            log('No printer name provided for open-drawer');
            return { success: false, error: 'No se ha configurado una impresora' };
        }

        // Default sequence (ESC p 0 25 250)
        const defaultCodes = [27, 112, 48, 25, 250];
        let bytes = defaultCodes;

        if (sequence) {
            try {
                bytes = sequence.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                if (bytes.length === 0) bytes = defaultCodes;
            } catch (e) {
                log(`Error parsing custom sequence: ${e.message}`);
                bytes = defaultCodes;
            }
        }

        const byteString = bytes.join(',');

        return new Promise((resolve) => {
            try {
                const { spawn } = require('child_process');
                
                // Enhanced PowerShell script using C# Interop to send TRUE RAW BYTES to the printer
                // We inject the printer name and byte string directly into the script since
                // -EncodedCommand does NOT support -args for positional parameters ($args[0], $args[1]).
                const escapedPrinterName = safePrinterName.replace(/'/g, "''");
                const psScript = `
$code = @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
    public static bool SendBytesToPrinter(string szPrinterName, byte[] lpBytes) {
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOW di = new DOCINFOW();
        bool bSuccess = false;
        di.pDocName = "RAW Open Drawer";
        di.pDataType = "RAW";
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(lpBytes.Length);
                    Marshal.Copy(lpBytes, 0, pUnmanagedBytes, lpBytes.Length);
                    Int32 dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, lpBytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        return bSuccess;
    }
}
'@; 
Add-Type -TypeDefinition $code; 
$success = [RawPrinterHelper]::SendBytesToPrinter('${escapedPrinterName}', [byte[]]('${byteString}' -split ','));
if ($success) { exit 0 } else { exit 1 }`;

                // To avoid here-string newline issues in spawn, we encode the script
                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

                log(`Spawning C# interop drawer process for: "${safePrinterName}"`);
                const child = spawn('powershell.exe', [
                    '-NoProfile', 
                    '-ExecutionPolicy', 'Bypass', 
                    '-EncodedCommand', encodedScript
                ]);

                child.on('error', (err) => {
                    log(`[CRITICAL] Error al lanzar proceso hijo (PowerShell) en open-drawer: ${err.message}`);
                    resolve({ success: false, error: 'Fallo al inicializar componente de hardware (open-drawer).' });
                });

                let stderr = '';
                child.stderr.on('data', (data) => { stderr += data.toString(); });

                child.on('close', (code) => {
                    if (code === 0) {
                        log(`Drawer signal sent successfully via C# interop on ${printerName}`);
                        resolve({ success: true });
                    } else {
                        log(`PowerShell spawn method failed for ${printerName} with code ${code}. Stderr: ${stderr}`);
                        let userError = `Fallo al abrir cajón.`;
                        if (stderr.includes('not found') || stderr.includes('no existe')) {
                            userError = `Impresora "${safePrinterName}" no encontrada. Verifique el nombre en Ajustes.`;
                        } else if (code === 1) {
                            userError = `La impresora "${safePrinterName}" rechazó el comando de apertura. Verifique que el cajón esté conectado al puerto RJ11/DK de la impresora.`;
                        } else {
                            userError = `Fallo al abrir cajón (Código ${code}). Verifique la conexión de la impresora y el cajón.`;
                        }
                        resolve({ success: false, error: userError });
                    }
                });

                // Safety timeout
                setTimeout(() => {
                    if (!child.killed) {
                        log('Drawer operation timed out.');
                        child.kill();
                        resolve({ success: false, error: 'Timeout de apertura' });
                    }
                }, 8000);

            } catch (err) {
                log(`Drawer open handler crashed: ${err.message}`);
                resolve({ success: false, error: err.message });
            }
        });
    });

    ipcMain.handle('print-raw', async (event, content, printerName) => {
        if (!verifyIpcSender(event)) {
            return { success: false, error: 'Origen de IPC no autorizado ni autenticado' };
        }

        // Límite de Payload DoS (2MB aprox)
        if (content && content.length > 2 * 1024 * 1024) {
            log('Acceso denegado a print-raw: El payload excede el límite de 2MB');
            return { success: false, error: 'El documento es demasiado grande para impresión RAW (Máx 2MB).' };
        }

        const safePrinterName = sanitizePrinterName(printerName);
        log(`RAW Print request received for printer: ${safePrinterName}`);
        if (!safePrinterName) {
            log('No printer name provided for print-raw');
            return { success: false, error: 'No se ha configurado una impresora' };
        }

        return new Promise((resolve) => {
            try {
                const { spawn } = require('child_process');
                
                // Content to Bytes (UTF8 or ASCII)
                const bytes = Buffer.from(content, 'utf8');
                const byteString = Array.from(bytes).join(',');

                const psScript = `
$code = @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
    public static bool SendBytesToPrinter(string szPrinterName, byte[] lpBytes) {
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOW di = new DOCINFOW();
        bool bSuccess = false;
        di.pDocName = "RAW Print Job";
        di.pDataType = "RAW";
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(lpBytes.Length);
                    Marshal.Copy(lpBytes, 0, pUnmanagedBytes, lpBytes.Length);
                    Int32 dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, lpBytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        return bSuccess;
    }
}
'@; 
Add-Type -TypeDefinition $code; 
$success = [RawPrinterHelper]::SendBytesToPrinter($args[0], [byte[]]($args[1] -split ','));
if ($success) { exit 0 } else { exit 1 }`;

                // Encode to avoid newline/quote parsing errors
                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

                const child = spawn('powershell.exe', [
                    '-NoProfile', 
                    '-ExecutionPolicy', 'Bypass', 
                    '-EncodedCommand', encodedScript,
                    '-args', safePrinterName, byteString
                ]);

                child.on('error', (err) => {
                    log(`[CRITICAL] Error al lanzar proceso hijo (PowerShell) en print-raw: ${err.message}`);
                    resolve({ success: false, error: 'Fallo al inicializar componente de hardware (print-raw).' });
                });

                let stderr = '';
                child.stderr.on('data', (data) => { stderr += data.toString(); });

                child.on('close', (code) => {
                    if (code === 0) {
                        log(`RAW Print successful on ${printerName}`);
                        resolve({ success: true });
                    } else {
                        log(`RAW Print failed on ${printerName} with code ${code}. Stderr: ${stderr}`);
                        resolve({ success: false, error: `Fallo al imprimir (Código ${code})` });
                    }
                });

                setTimeout(() => {
                    if (!child.killed) {
                        child.kill();
                        resolve({ success: false, error: 'Timeout de impresión RAW' });
                    }
                }, 15000);

            } catch (err) {
                log(`RAW Print crash: ${err.message}`);
                resolve({ success: false, error: err.message });
            }
        });
    });

    ipcMain.handle('select-backup-file', async (event) => {
        if (!verifyIpcSender(event)) {
            return { canceled: true, error: 'Origen de IPC no autorizado ni autenticado' };
        }
        
        try {
            const userDataPath = app.getPath('userData');
            const backupDir = path.join(userDataPath, 'backups');
            
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            log(`Opening file dialog for backup restore starting in: ${backupDir}`);
            
            const result = await dialog.showOpenDialog(mainWindow, {
                title: 'Seleccionar Copia de Seguridad',
                defaultPath: backupDir,
                properties: ['openFile'],
                filters: [
                    { name: 'Archivos de Respaldo (*.zip, *.sqlite)', extensions: ['zip', 'sqlite'] }
                ]
            });

            if (result.canceled || result.filePaths.length === 0) {
                log('File dialog was canceled by the user.');
                return { canceled: true };
            }

            const selectedPath = result.filePaths[0];
            log(`User selected backup file: ${selectedPath}`);
            return { filePath: selectedPath };
        } catch (error) {
            log(`Error in select-backup-file IPC: ${error.message}`);
            return { error: error.message };
        }
    });

    ipcMain.handle('get-app-version', async (event) => {
        return app.getVersion() || '2.0.9';
    });

    let electronUpdaterInstance = null;
    try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = false;
        electronUpdaterInstance = autoUpdater;

        autoUpdater.on('checking-for-update', () => {
            log('Electron AutoUpdater: Checking for update...');
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'checking' });
        });
        autoUpdater.on('update-available', (info) => {
            log(`Electron AutoUpdater: Update available ${info.version}`);
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'available', info });
        });
        autoUpdater.on('update-not-available', (info) => {
            log('Electron AutoUpdater: Update not available.');
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'not-available', info });
        });
        autoUpdater.on('error', (err) => {
            log(`Electron AutoUpdater error: ${err.message}`);
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'error', error: err.message });
        });
        autoUpdater.on('download-progress', (progressObj) => {
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'downloading', progress: progressObj.percent });
        });
        autoUpdater.on('update-downloaded', (info) => {
            log(`Electron AutoUpdater: Update downloaded ${info.version}`);
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'downloaded', info });
        });
    } catch (updaterErr) {
        log(`Electron autoUpdater initialization notice: ${updaterErr.message}`);
    }

    ipcMain.handle('check-for-updates', async (event) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        if (electronUpdaterInstance) {
            try {
                const res = await Promise.race([
                    electronUpdaterInstance.checkForUpdates(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Consulta nativa expirada (15s, usando verificación API)')), 15000))
                ]);
                return { success: true, res };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
        return { success: false, error: 'Soporte de actualización nativa no activo (usando API web)' };
    });

    ipcMain.handle('download-update', async (event, downloadUrl) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        if (electronUpdaterInstance) {
            try {
                await electronUpdaterInstance.downloadUpdate();
                return { success: true };
            } catch (e) {
                log(`electronUpdaterInstance error: ${e.message}`);
            }
        }
        try {
            const axios = require('axios');
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            const { shell } = require('electron');
            let url = downloadUrl;
            if (!url || typeof url !== 'string') {
                const res = await axios.get('https://github.com/mrivero105-oss/american-pos-backend/releases/latest/download/latest.yml', {
                    timeout: 6000,
                    headers: { 'User-Agent': 'AmericanPOS-Updater-Service/2.0' }
                });
                const ymlText = res.data || '';
                const versionMatch = ymlText.match(/version:\s*([^\s\n\r]+)/);
                const remoteTag = versionMatch ? versionMatch[1] : null;
                const pathMatch = ymlText.match(/path:\s*([^\s\n\r]+)/);
                const pathVal = pathMatch ? pathMatch[1] : null;
                if (remoteTag && pathVal) {
                    url = `https://github.com/mrivero105-oss/american-pos-backend/releases/download/v${remoteTag}/${pathVal}`;
                }
            }
            if (url) {
                log(`Fallback download: descargando ${url} manualmente en segundo plano...`);
                const tempDir = os.tmpdir();
                const exePath = path.join(tempDir, `AmericanPOS-Update-${Date.now()}.exe`);
                const writer = fs.createWriteStream(exePath);
                
                try {
                    const response = await axios({
                        url,
                        method: 'GET',
                        responseType: 'stream',
                        timeout: 30000 // 30s connection timeout
                    });
                    
                    const totalSize = parseInt(response.headers['content-length'], 10);
                    let downloaded = 0;
                    
                    response.data.on('data', (chunk) => {
                        downloaded += chunk.length;
                        const percent = totalSize ? Math.round((downloaded * 100) / totalSize) : 0;
                        if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'downloading', info: { percent } });
                    });
                    
                    response.data.pipe(writer);
                    
                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });
                    
                    log(`Descarga manual completa en: ${exePath}`);
                    if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'downloaded' });
                    global.downloadedUpdatePath = exePath;
                    return { success: true };
                } catch (dlErr) {
                    log(`Error descargando fallback en segundo plano: ${dlErr.message}`);
                    log(`Abriendo fallback en navegador externo...`);
                    await shell.openExternal(url);
                    return { success: true, fallbackWeb: true };
                }
            }
        } catch (err) {
            log(`Error general en fallback de descarga: ${err.message}`);
        }
        return { success: false, error: 'Modo escritorio de descarga no disponible en este entorno' };
    });

    ipcMain.handle('install-update', async (event) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        if (global.downloadedUpdatePath) {
            log(`Instalando actualizacion manual desde: ${global.downloadedUpdatePath}`);
            try {
                const { spawn } = require('child_process');
                spawn(global.downloadedUpdatePath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
                app.quit();
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
        if (electronUpdaterInstance) {
            electronUpdaterInstance.quitAndInstall();
            return { success: true };
        }
        return { success: false, error: 'Instalador automático no disponible' };
    });
}

app.whenReady().then(async () => {
    // Interceptar aperturas de ventanas nuevas (target="_blank") y redirigirlas al navegador del SO
    app.on('web-contents-created', (event, contents) => {
        contents.setWindowOpenHandler(({ url }) => {
            require('electron').shell.openExternal(url);
            return { action: 'deny' };
        });
    });

    // 1. Obtener ruta de datos persistente de Electron
    const userDataPath = app.getPath('userData');
    console.log('Ruta de datos de usuario:', userDataPath);
    process.env.USER_DATA_PATH = userDataPath;
    log('Set USER_DATA_PATH env var.');

    // 🔒 Cargar o generar el archivo .env en UserData para producción
    const userEnvPath = path.join(userDataPath, '.env');
    if (!process.env.JWT_SECRET) {
        log(`JWT_SECRET not in environment. Checking UserData .env at: ${userEnvPath}`);
        if (fs.existsSync(userEnvPath)) {
            log('Loading environment variables from UserData .env...');
            require('dotenv').config({ path: userEnvPath });
        }
        
        // Si aún no está definido (o el archivo no existía/estaba vacío), lo generamos
        if (!process.env.JWT_SECRET) {
            log('No JWT_SECRET found in UserData .env. Generating a new secure one...');
            const crypto = require('crypto');
            const newSecret = crypto.randomBytes(32).toString('hex');
            const legacySecret = crypto.randomBytes(32).toString('hex');
            const syncSecret = crypto.randomBytes(32).toString('hex');
            const defaultEnvContent = [
                `# American POS - Archivo de Configuración Local`,
                `JWT_SECRET=${newSecret}`,
                `LEGACY_HMAC_SECRET=${legacySecret}`,
                `SYNC_SECRET_KEY=${syncSecret}`,
                `PORT=3005,5005,8080`,
                `DB_DIALECT=sqlite`,
                `GOOGLE_API_KEY=`
            ].join('\n');
            
            try {
                fs.writeFileSync(userEnvPath, defaultEnvContent, 'utf8');
                log('UserData .env file created successfully.');
                // Volver a cargar el .env recién creado
                require('dotenv').config({ path: userEnvPath });
            } catch (envWriteErr) {
                log(`Error writing UserData .env file: ${envWriteErr.message}`);
                // Fallback en memoria si no se puede escribir el archivo
                process.env.JWT_SECRET = newSecret;
            }
        }
    }

    try {
        log('Checking database...');
        const fs = require('fs');
        const APP_VERSION = '2.1.5';
        const dbPath = path.join(userDataPath, 'pos_v1.sqlite');
        // Source DB path handling for asar environments
        let sourceDb = path.join(__dirname, 'database', 'pos_v1.sqlite');
        if (app.isPackaged) {
            // When packaged, we need to point to the unpacked version of the DB
            sourceDb = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'database', 'pos_v1.sqlite');
        }

        const imagesPath = path.join(userDataPath, 'product_images');
        let sourceImages = path.join(__dirname, 'product_images');
        if (app.isPackaged) {
            sourceImages = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'product_images');
        }

        // Create images directory if not exists
        if (!fs.existsSync(imagesPath)) {
            log('Creating product_images directory in UserData...');
            fs.mkdirSync(imagesPath, { recursive: true });
        }

        // REMOVED: Default database copying.
        // The application should always start with a clean database and run migrations
        // if dbPath doesn't exist. This prevents developer data leakage.
        if (!fs.existsSync(dbPath)) {
            log('Database not found in UserData. A fresh one will be created via migrations.');
        }

        log('Attempting to require ./index.js');
        // 2. Iniciar el servidor Express (require here to ensure env var is set)
        const { startServer } = require('./index.js');
        log('./index.js requires successfully.');

        const rawPort = process.env.PORT || "3005,5005,8080";
        const ports = rawPort.toString().split(',').map(p => p.trim());
        
        startServer(ports, userDataPath).then(({ mainPort }) => {
            log(`Servidor iniciado en múltiples puertos. Principal: ${mainPort}`);
            createWindow(mainPort);

            // Background async tasks after window is open
            setImmediate(async () => {
                // Bootstrap: Sync images from bundle to userData
                try {
                    if (fs.existsSync(sourceImages)) {
                        const bundleImages = fs.readdirSync(sourceImages).filter(f => f !== '.gitkeep');
                        let syncCount = 0;
                        bundleImages.forEach(file => {
                            const srcPath = path.join(sourceImages, file);
                            const destPath = path.join(imagesPath, file);
                            if (!fs.existsSync(destPath)) {
                                fs.copyFileSync(srcPath, destPath);
                                syncCount++;
                            }
                        });
                        if (syncCount > 0) log(`Image sync complete: ${syncCount} copied.`);
                    }
                } catch (imgErr) {
                    log(`Warning during images bootstrap: ${imgErr.message}`);
                }

                // AUTO-RELINK: Fix missing links if files exist
                try {
                    const { Product } = require('./database/models');
                    const files = fs.readdirSync(imagesPath);
                    const products = await Product.findAll({ where: { imageUri: [null, ''] } });
                    if (products.length > 0) {
                        let count = 0;
                        for (const p of products) {
                            const sanitized = p.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                            const match = files.find(f => f.startsWith(sanitized));
                            if (match) {
                                p.imageUri = `/product_images/${match}`;
                                await p.save();
                                count++;
                            }
                        }
                        if (count > 0) log(`Auto-relink: Successfully linked ${count} products.`);
                    }
                } catch (relErr) {
                    log(`Warning during auto-relink: ${relErr.message}`);
                }
            });

            // Programar respaldo automático doble en segundo plano cada 4 horas mientras el POS está abierto 24/7
            setInterval(() => {
                log('Ejecutando respaldo automático doble periódico cada 4 horas en segundo plano...');
                performAutoBackup().catch(e => log(`Error en auto-backup periódico: ${e.message}`));
            }, 4 * 60 * 60 * 1000);
        }).catch(err => {
            log(`Error al iniciar el servidor: ${err.message}\n${err.stack}`);
            console.error('Error al iniciar el servidor:', err);
            try {
                require('fs').writeFileSync(require('path').join(require('os').homedir(), 'Desktop', 'server_error.txt'), err.stack || err.message);
            } catch (e) {}
            dialog.showErrorBox('Error del Servidor', `Fallo al iniciar el servidor local:\n${err.message}\nRevisa server_error.txt en el escritorio.`);
            app.quit();
        });
    } catch (error) {
        log(`CRITICAL ERROR during startup: ${error.message}\n${error.stack}`);
        try {
            require('fs').writeFileSync(require('path').join(require('os').homedir(), 'Desktop', 'error.txt'), error.stack);
        } catch (e) {}
        dialog.showErrorBox('Error de Inicio', `Error crítico:\n${error.message}\n\nRevisa el archivo error.txt en tu Escritorio para ver el detalle.`);
        app.quit();
    }

    // 3. Crear la ventana (Manejado dentro de startServer callback arriba)
    // createWindow();

    app.on('activate', function () {
        if (mainWindow === null) createWindow(3005); // Fallback port reuse if activated from dock, though uncommon in current flow
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
