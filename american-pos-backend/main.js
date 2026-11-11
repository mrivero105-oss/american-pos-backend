const { app, BrowserWindow, dialog, session, shell } = require('electron');
const path = require('path');

// Configuración de Renderizado Gráfico
// Se utiliza el motor gráfico nativo de Chromium con aceleración GPU y renderizado nítido de fuentes DirectWrite.
const osRelease = require('os').release();
const isLegacyWin = process.platform === 'win32' && /^6\./.test(osRelease);
const isWin11 = process.platform === 'win32' && parseInt((osRelease.split('.')[2] || '0'), 10) >= 22000;

if (isLegacyWin || process.env.DISABLE_GPU === 'true') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('disable-software-rasterizer');
} else {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('font-render-hinting', 'medium');
    app.commandLine.appendSwitch('enable-smooth-scrolling');
    app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
    app.commandLine.appendSwitch('force_high_performance_gpu');
    if (isWin11) {
        app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,UseSkiaRenderer');
    }
}

const totalRamGb = Math.round(require('os').totalmem() / (1024 ** 3));
const is64BitArch = process.arch === 'x64' || process.arch === 'arm64';
const maxOldSpaceSizeMb = (is64BitArch && totalRamGb > 4) ? 2048 : 768;
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${maxOldSpaceSizeMb}`);
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-print-preview');
app.commandLine.appendSwitch('kiosk-printing');
app.commandLine.appendSwitch('default-background-color', 'ff070d1e');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,AutofillAddressProfileSavePrompt,AutofillCreditCardUpload,PasswordManager');
app.commandLine.appendSwitch('disable-save-password-bubble');
app.commandLine.appendSwitch('disable-single-click-autofill');

// Handle Squirrel events for Windows immediately on startup
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
        process.exit(0);
    }
} catch (e) { }

let mainWindow = null;
let isQuittingAfterBackup = false;
let electronUpdaterInstance = null;

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
const LOGS_ENABLED = true;

let logStream = null;
try {
    const fs = require('fs');
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'pos_startup_log.txt');
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
} catch (e) { }

function log(message) {
    if (!LOGS_ENABLED || !logStream) return;
    try {
        const timestamp = new Date().toISOString();
        logStream.write(`[${timestamp}] ${message}\n`);
    } catch (e) { }
}

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
                if (LOGS_ENABLED && logStream) {
                    try { logStream.write(`[ERR] Failed to log console.${method}: ${err.message}\n`); } catch (e) { }
                }
            }
        }
    };
};
['log', 'error', 'warn', 'info', 'debug'].forEach(patchConsole);

// Load environment variables immediately to ensure DB_DIALECT and other settings are available
try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (dotenvErr) {
    try {
        const fs = require('fs');
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
            envLines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx > 0) {
                        const key = trimmed.substring(0, eqIdx).trim();
                        let val = trimmed.substring(eqIdx + 1).trim();
                        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                        if (!process.env[key]) process.env[key] = val;
                    }
                }
            });
        }
    } catch (e) { }
}

const fs = require('fs');
const os = require('os');

try {
    log(`Starting main.js execution. UserData: ${app.getPath('userData')}`);
} catch (e) {
    // Silent fail if log fails early
}

// const { startServer } = require('./index.js'); // Moved to whenReady

async function performFastDbBackupOnly() {
    log('Fast Exit: Running PostgreSQL database backup...');
    try {
        const userDataPath = app.getPath('userData');
        const { performPostgresBackup } = require('./utils/sqliteBackupHelper');
        const backupFile = await performPostgresBackup(userDataPath);
        log(`Fast Exit: PostgreSQL backup completed: ${backupFile}`);
        return true;
    } catch (dbErr) {
        log(`Error in fast PostgreSQL backup: ${dbErr.message}`);
        return false;
    }
}

/**
 * Performs an automatic backup of both:
 * 1. PostgreSQL dump (auto-backups/)
 * 2. Master Snapshot (.zip with PostgreSQL dump, product images & supplier logos in backups/)
 */
async function performAutoBackup() {
    log('Auto-backup: Initiating automatic dual backups (PostgreSQL Dump + Master Snapshot)...');
    try {
        const userDataPath = app.getPath('userData');
        const { performPostgresBackup } = require('./utils/sqliteBackupHelper');
        const { createMasterSnapshot } = require('./utils/snapshotHelper');

        log('Running 1/2: PostgreSQL backup...');
        try {
            const backupFile = await performPostgresBackup(userDataPath);
            log(`PostgreSQL backup completed: ${backupFile}`);
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
    log(`Entering createWindow function. serverPort: ${serverPort}`);
    session.defaultSession.clearCache().then(() => {
        log('Web cache cleared successfully.');
    });
    session.defaultSession.clearStorageData({ storages: ['cookies', 'serviceworkers', 'cachestorage'] }).then(() => {
        log('Session cookies cleared successfully on app startup.');
    }).catch(() => {});
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (serverPort) {
            log(`Redirecting existing window to http://localhost:${serverPort}`);
            mainWindow.loadURL(`http://localhost:${serverPort}`);
        }
        return;
    }

    const windowOptions = {
        width: 1200,
        height: 800,
        minWidth: 1024,
        minHeight: 728,
        resizable: true,
        maximizable: true,
        minimizable: true,
        fullscreenable: true,
        backgroundColor: '#070d1e',
        icon: path.join(__dirname, 'public/assets/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            scrollBounce: false,
            webviewTag: true
        },
        autoHideMenuBar: true,
        show: false
    };

    if (isWin11) {
        try {
            // native frame
        } catch (e) {}
    }

    mainWindow = new BrowserWindow(windowOptions);
    try {
        mainWindow.setResizable(true);
        mainWindow.setMaximizable(true);
    } catch (_) {}

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // 🔒 SEGURIDAD: Interceptar navegación en el frame principal (Prevenir navegación forzada externa)
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        try {
            const parsedUrl = new URL(navigationUrl);
            const isLocal = (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') || parsedUrl.protocol === 'file:';
            if (!isLocal) {
                event.preventDefault();
                log(`[SECURITY] Intercepted navigation to untrusted URL: ${navigationUrl}`);
                if (navigationUrl.startsWith('http:') || navigationUrl.startsWith('https:')) {
                    shell.openExternal(navigationUrl);
                }
            }
        } catch (e) {
            event.preventDefault();
            log(`[SECURITY] Prevented navigation to malformed URL: ${navigationUrl}`);
        }
    });

    // 🔒 SEGURIDAD: Prevenir apertura de DevTools y recargas accidentales en modo producción
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (app.isPackaged) {
            const isDevTools = (input.control && input.shift && input.key.toLowerCase() === 'i');
            // F5 y F12 son teclas operativas esenciales del POS (F5: Pausar/Espera, F12: Modo de Cobro)
            const isReload = (input.control && input.key.toLowerCase() === 'r') || (input.control && input.key === 'F5');
            if (isDevTools || isReload) {
                event.preventDefault();
            }
        }
    });

    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setResizable(true);
            mainWindow.setMaximizable(true);
            mainWindow.show();
            mainWindow.maximize();
        }
    });

    // Create Logic Menu
    const { Menu } = require('electron');
    const menuTemplate = [
        {
            label: 'Archivo',
            submenu: [
                {
                    label: 'Configurar Conexión de Servidor...',
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            const setupPath = path.join(__dirname, 'public', 'server-setup.html');
                            mainWindow.loadFile(setupPath);
                        }
                    }
                },
                { type: 'separator' },
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
                    label: 'Verificar Actualizaciones de Isaac POS...',
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

    // Deshabilitar y eliminar por completo la barra de menú nativa (Archivo, Editar, Ver, Ayuda) para modo POS Kiosco limpio
    Menu.setApplicationMenu(null);
    if (mainWindow) {
        mainWindow.removeMenu();
        mainWindow.setMenuBarVisibility(false);
    }

    // Cargar el splash screen oscuro de inmediato (0.1s response time) y cambiar al servidor HTTP al estar listo
    const indexPath = path.join(__dirname, 'public', 'index.html');
    const splashFile = path.join(__dirname, 'public', 'splash.html');

    if (serverPort) {
        const url = `http://localhost:${serverPort}`;
        mainWindow.loadURL(url, { extraHeaders: 'pragma: no-cache\n' });
    } else if (fs.existsSync(splashFile)) {
        mainWindow.loadFile(splashFile);
    } else if (fs.existsSync(indexPath)) {
        mainWindow.loadFile(indexPath);
    } else {
        mainWindow.loadURL('http://localhost:3005', { extraHeaders: 'pragma: no-cache\n' });
    }

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
                log(`Fast auto-backup result: ${success ? 'SUCCESS' : 'FAILED/TIMEOUT'}. Closing process.`);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.destroy();
                }
                app.quit();
                setTimeout(() => process.exit(0), 300);
            });
        }
    });
}

function setupStartupShortcut(exePath, enable = true) {
    if (process.platform !== 'win32') return;
    try {
        const { execSync } = require('child_process');
        const startupDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        const shortcutPath = path.join(startupDir, 'Isaac POS.lnk');
        const legacyShortcutPath = path.join(startupDir, 'American POS.lnk');

        // Limpiar acceso directo legacy si existe
        if (fs.existsSync(legacyShortcutPath)) {
            try { fs.unlinkSync(legacyShortcutPath); } catch (e) { }
        }

        if (enable && exePath && fs.existsSync(exePath)) {
            const workDir = path.dirname(exePath);
            const psScript = `$wshell = New-Object -ComObject WScript.Shell; $shortcut = $wshell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); $shortcut.TargetPath = '${exePath.replace(/'/g, "''")}'; $shortcut.WorkingDirectory = '${workDir.replace(/'/g, "''")}'; $shortcut.IconLocation = '${exePath.replace(/'/g, "''")}, 0'; $shortcut.Save()`;
            execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
            log(`Startup shortcut created at: ${shortcutPath}`);
        } else {
            if (fs.existsSync(shortcutPath)) {
                fs.unlinkSync(shortcutPath);
                log(`Startup shortcut removed at: ${shortcutPath}`);
            }
        }
    } catch (err) {
        log(`Error configuring startup shortcut: ${err.message}`);
    }
}

function configureAutoLaunch(enabled = true) {
    if (process.platform !== 'win32') return { success: true, enabled };
    const { execSync } = require('child_process');

    // Limpieza de entradas de registro erróneas de desarrollo o legacy (evita ventana de consola de node.exe o Electron genérico)
    try {
        execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "American POS" /f', { stdio: 'ignore' });
    } catch (e) { }

    try {
        const regOutput = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Isaac POS"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        if (regOutput && (
            regOutput.toLowerCase().includes('node_modules') ||
            regOutput.toLowerCase().includes('node.exe') ||
            (regOutput.toLowerCase().includes('electron.exe') && !regOutput.toLowerCase().includes('isaac pos.exe'))
        )) {
            log('Limpiando entrada de registro errónea de node.exe/desarrollo para el autoinicio...');
            execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Isaac POS" /f', { stdio: 'ignore' });
        }
    } catch (e) { }

    let exePath = process.execPath;
    if (exePath.toLowerCase().includes('node.exe') || exePath.toLowerCase().includes('electron.exe')) {
        const v24Path = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Isaac POS V24.04', 'Isaac POS V24.04.exe');
        const defaultInstallPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Isaac POS', 'Isaac POS.exe');
        const altInstallPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'IsaacPOS', 'Isaac POS.exe');
        const legacyInstallPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'American POS', 'American POS.exe');
        if (fs.existsSync(v24Path)) {
            exePath = v24Path;
        } else if (fs.existsSync(defaultInstallPath)) {
            exePath = defaultInstallPath;
        } else if (fs.existsSync(altInstallPath)) {
            exePath = altInstallPath;
        } else if (fs.existsSync(legacyInstallPath)) {
            exePath = legacyInstallPath;
        }
    }

    const isDevExecutable = exePath.toLowerCase().includes('node.exe') || exePath.toLowerCase().includes('electron.exe');

    if (isDevExecutable && !app.isPackaged) {
        log('Modo desarrollo detectado. Omitiendo registro automático en Windows.');
        return { success: true, enabled: false };
    }

    log(`Configurando autoinicio (enabled: ${enabled}) para ejecutable: ${exePath}`);

    try {
        if (app.setLoginItemSettings && !isDevExecutable) {
            app.setLoginItemSettings({
                openAtLogin: enabled,
                path: exePath
            });
        }
    } catch (e) {
        log(`app.setLoginItemSettings error: ${e.message}`);
    }

    if (enabled && !isDevExecutable) {
        try {
            const targetCmd = `"${exePath}"`;
            execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Isaac POS" /t REG_SZ /d "${targetCmd.replace(/"/g, '\\"')}" /f`, { stdio: 'ignore' });
        } catch (e) {
            log(`Reg add error: ${e.message}`);
        }
        setupStartupShortcut(exePath, true);
    } else {
        try {
            execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Isaac POS" /f`, { stdio: 'ignore' });
        } catch (e) { }
        setupStartupShortcut(exePath, false);
    }

    try {
        const settingsPath = path.join(__dirname, 'settings.json');
        let settings = {};
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        settings.autoLaunch = enabled;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) { }

    return { success: true, enabled };
}


let ipcHandlersInitialized = false;
function setupIpcHandlers() {
    if (ipcHandlersInitialized) return;
    ipcHandlersInitialized = true;

    // --- IPC Hardware Hub ---
    const { ipcMain } = require('electron');

    // Validación estricta anti-falsificación de IPC: Garantiza que la llamada provenga del webContents legítimo
    const verifyIpcSender = (event) => {
        if (event.sender !== mainWindow?.webContents) {
            log('Acceso IPC denegado: El emisor no coincide con la ventana principal de la aplicación.');
            return false;
        }
        const url = event.senderFrame?.url;
        if (!url || (!url.startsWith('http://localhost:') && !url.startsWith('http://127.0.0.1:') && !url.startsWith('http://[::1]:') && !url.startsWith('file://'))) {
            log('Acceso IPC denegado por origen de URL no autorizado: ' + url);
            return false;
        }
        return true;
    };

    ipcMain.on('get-machine-id-sync', (event) => {
        if (!verifyIpcSender(event)) {
            event.returnValue = null;
            return;
        }
        try {
            const hardwareIdentity = require('./utils/hardware-id');
            const fsSync = require('fs');
            if (fsSync.existsSync(hardwareIdentity.hwidPath)) {
                event.returnValue = fsSync.readFileSync(hardwareIdentity.hwidPath, 'utf8').trim() || ('POS-' + os.hostname().toUpperCase().replace(/[^A-Z0-9]/g, ''));
            } else {
                event.returnValue = null;
            }
        } catch (e) {
            event.returnValue = null;
        }
    });

    ipcMain.on('get-station-identity-sync', (event) => {
        if (!verifyIpcSender(event)) {
            event.returnValue = null;
            return;
        }
        try {
            const hardwareIdentity = require('./utils/hardware-id');
            const DbConfigManager = require('./config/dbConfigManager');
            const fsSync = require('fs');
            let hwid = fsSync.existsSync(hardwareIdentity.hwidPath)
                ? fsSync.readFileSync(hardwareIdentity.hwidPath, 'utf8').trim()
                : '';
            if (!hwid) hwid = 'POS-' + os.hostname().toUpperCase().replace(/[^A-Z0-9]/g, '');
            const dbCfg = DbConfigManager.getConfig();
            event.returnValue = {
                hwid,
                hostname: os.hostname(),
                mode: (dbCfg && dbCfg.mode) ? dbCfg.mode : 'server'
            };
        } catch (e) {
            event.returnValue = {
                hwid: 'POS-' + os.hostname().toUpperCase().replace(/[^A-Z0-9]/g, ''),
                hostname: os.hostname(),
                mode: 'server'
            };
        }
    });

    ipcMain.handle('get-auto-launch', async (event) => {
        if (!verifyIpcSender(event)) return false;
        try {
            const { execSync } = require('child_process');
            let isOpenAtLogin = false;
            try {
                if (app.getLoginItemSettings) {
                    isOpenAtLogin = app.getLoginItemSettings().openAtLogin;
                }
            } catch (e) { }
            try {
                const regOutput = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Isaac POS"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
                if (regOutput && regOutput.includes('Isaac POS')) {
                    isOpenAtLogin = true;
                }
            } catch (e) { }
            const startupDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            const shortcutPath = path.join(startupDir, 'Isaac POS.lnk');
            if (fs.existsSync(shortcutPath)) {
                isOpenAtLogin = true;
            }
            return isOpenAtLogin;
        } catch (err) {
            log(`Error getting auto-launch: ${err.message}`);
            return false;
        }
    });

    ipcMain.handle('set-auto-launch', async (event, enabled) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Origen no autorizado' };
        try {
            return configureAutoLaunch(enabled);
        } catch (err) {
            log(`Error setting auto-launch: ${err.message}`);
            return { success: false, error: err.message };
        }
    });

    const isVirtualSystemPrinter = (name = '', description = '') => {
        const combined = `${name} ${description}`.toLowerCase();
        const virtualKeywords = [
            'microsoft print to pdf', 'microsoft xps', 'onenote', 'fax',
            'send to', 'adobe pdf', 'foxit', 'cutepdf', 'dopdf', 'bullzip',
            'anydesk', 'teamviewer', 'pdfcreator', 'xps document writer'
        ];
        return virtualKeywords.some(k => combined.includes(k));
    };

    const resolveTargetPrinter = async (requestedName = '') => {
        const cleanReq = sanitizePrinterName(requestedName);
        try {
            let printers = [];
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                printers = await mainWindow.webContents.getPrintersAsync().catch(() => []);
            }
            if (!Array.isArray(printers) || printers.length === 0) {
                try {
                    const LocalPrinterService = require('./services/LocalPrinterService');
                    return await LocalPrinterService.resolvePrinterName(cleanReq);
                } catch (_) {
                    return cleanReq || null;
                }
            }

            // 1. Si el usuario solicitó una impresora específica y está instalada
            if (cleanReq) {
                const exact = printers.find(p => p.name === cleanReq);
                if (exact && !isVirtualSystemPrinter(exact.name, exact.description)) return exact.name;
                const ci = printers.find(p => String(p.name || '').toLowerCase() === cleanReq.toLowerCase());
                if (ci && !isVirtualSystemPrinter(ci.name, ci.description)) return ci.name;
                const partial = printers.find(p => {
                    const pName = String(p.name || '').toLowerCase();
                    return (pName.includes(cleanReq.toLowerCase()) || cleanReq.toLowerCase().includes(pName)) &&
                        !isVirtualSystemPrinter(p.name, p.description);
                });
                if (partial) return partial.name;
            }

            // 2. Filtrar impresoras físicas reales (excluir PDF, XPS, OneNote, Fax)
            const physicalPrinters = printers.filter(p => p && p.name && !isVirtualSystemPrinter(p.name, p.description));
            if (physicalPrinters.length === 0) {
                return null;
            }

            // 3. Priorizar impresoras térmicas / POS
            const thermalKeywords = [
                'pos', '58', '80', 'thermal', 'termica', 'térmica', 'receipt', 'ticket',
                'epson', 'tm-', 'xprinter', 'xp-', 'bixolon', '3nstar', 'sat', 'bematech',
                'star', 'citizen', 'custom', 'sewoo', 'rongta', 'gp-', 'gprinter',
                'zjiang', 'zj-', 'generic', 'text only', 'usb'
            ];
            const thermalMatch = physicalPrinters.find(p => {
                const combined = `${p.name} ${p.displayName || ''} ${p.description || ''}`.toLowerCase();
                return thermalKeywords.some(k => combined.includes(k));
            });
            if (thermalMatch) return thermalMatch.name;

            // 4. Impresora predeterminada si es física
            const defaultPhysical = physicalPrinters.find(p => p.isDefault);
            if (defaultPhysical) return defaultPhysical.name;

            // 5. Primera impresora física disponible
            return physicalPrinters[0].name;
        } catch (err) {
            log(`Error resolving target printer: ${err.message}`);
            return cleanReq || null;
        }
    };

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

        const targetPrinter = await resolveTargetPrinter(printerName);
        log(`Print request received for printer: "${printerName || ''}" -> resolved: "${targetPrinter || 'NONE'}"`);
        if (!targetPrinter) {
            log('Print aborted: No physical/thermal printer found on system.');
            return { success: false, error: 'No se detectó una impresora física conectada' };
        }

        return new Promise((resolve) => {
            let settled = false;
            const safeResolve = (result) => {
                if (!settled) {
                    settled = true;
                    resolve(result);
                }
            };

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

                printWin.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                    log(`Print content load failed: ${errorDescription}`);
                    if (!printWin.isDestroyed()) printWin.close();
                    safeResolve({ success: false, error: `Error de carga en impresora: ${errorDescription}` });
                });

                printWin.webContents.on('did-finish-load', () => {
                    log(`Content loaded in hidden window, starting silent print to "${targetPrinter}"...`);
                    const printOptions = {
                        silent: true,
                        printBackground: true,
                        deviceName: targetPrinter,
                        margins: { marginType: 'none' },
                        pageSize: { width: 80000, height: 297000 }
                    };
                    printWin.webContents.print(printOptions, (success, failureReason) => {
                        if (success) {
                            log(`Print successful on ${targetPrinter}`);
                            safeResolve({ success: true, printerName: targetPrinter });
                        } else {
                            log(`Print failed on ${targetPrinter}: ${failureReason}`);
                            safeResolve({ success: false, error: failureReason });
                        }
                        if (!printWin.isDestroyed()) printWin.close();
                    });
                });

                // Safety timeout (4.5s)
                setTimeout(() => {
                    if (!printWin.isDestroyed()) {
                        log('Print operation timed out.');
                        printWin.close();
                    }
                    safeResolve({ success: false, error: 'Timeout de impresión' });
                }, 4500);

            } catch (err) {
                log(`Crash during print process: ${err.message}`);
                safeResolve({ success: false, error: err.message });
            }
        });
    });

    ipcMain.handle('open-drawer', async (event, printerName, sequence) => {
        if (!verifyIpcSender(event)) {
            return { success: false, error: 'Origen de IPC no autorizado ni autenticado' };
        }

        const safePrinterName = await resolveTargetPrinter(printerName);
        log(`Attempting to open drawer on printer: "${safePrinterName || 'NONE'}" (requested: "${printerName || ''}") with sequence: ${sequence || 'default'}`);
        if (!safePrinterName) {
            log('No physical printer available for open-drawer');
            return { success: false, error: 'No se detectó una impresora térmica conectada' };
        }

        // Default sequence (ESC p 0 25 250)
        const defaultCodes = [27, 112, 48, 25, 250];
        let bytes = defaultCodes;

        if (sequence) {
            try {
                bytes = String(sequence).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                if (bytes.length === 0) bytes = defaultCodes;
            } catch (e) {
                log(`Error parsing custom sequence: ${e.message}`);
                bytes = defaultCodes;
            }
        }

        // 1. Intento ultrarrápido vía LocalPrinterService (RawPrinter.exe nativo, <50ms)
        try {
            const LocalPrinterService = require('./services/LocalPrinterService');
            const drawerBuffer = Buffer.from(bytes);
            await LocalPrinterService.printRaw(drawerBuffer, safePrinterName);
            log(`Drawer signal sent successfully via RawPrinter on ${safePrinterName}`);
            return { success: true, printerName: safePrinterName };
        } catch (fastErr) {
            log(`Fast RawPrinter drawer kick notice (${fastErr.message}), trying fallback...`);
        }

        const byteString = bytes.join(',');

        return new Promise((resolve) => {
            try {
                const { spawn } = require('child_process');
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

                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

                log(`Spawning C# interop drawer process for: "${safePrinterName}"`);
                const child = spawn('powershell.exe', [
                    '-NoProfile',
                    '-ExecutionPolicy', 'Bypass',
                    '-EncodedCommand', encodedScript
                ], { windowsHide: true });

                child.on('error', (err) => {
                    log(`[CRITICAL] Error al lanzar proceso hijo (PowerShell) en open-drawer: ${err.message}`);
                    resolve({ success: false, error: 'Fallo al inicializar componente de hardware (open-drawer).' });
                });

                let stderr = '';
                child.stderr.on('data', (data) => { stderr += data.toString(); });

                child.on('close', (code) => {
                    if (code === 0) {
                        log(`Drawer signal sent successfully via C# interop on ${safePrinterName}`);
                        resolve({ success: true, printerName: safePrinterName });
                    } else {
                        log(`PowerShell spawn method failed for ${safePrinterName} with code ${code}. Stderr: ${stderr}`);
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
                }, 5000);

            } catch (err) {
                log(`Drawer open handler crashed: ${err.message}`);
                resolve({ success: false, error: err.message });
            }
        });
    });

    // --- ⚖️ BALANZA DIGITAL SERIAL / USB-COM (NCI, Torrey, CAS, Toledo, Dibal) ---
    ipcMain.handle('list-serial-ports', async (event) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Origen no autorizado' };
        return new Promise((resolve) => {
            if (process.platform !== 'win32') {
                return resolve({ success: true, ports: [] });
            }
            const { exec } = require('child_process');
            exec('powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames()"', (err, stdout) => {
                if (err) {
                    return resolve({ success: true, ports: [] });
                }
                const ports = stdout.split(/[\r\n]+/).map(p => p.trim()).filter(Boolean);
                resolve({ success: true, ports: Array.from(new Set(ports)) });
            });
        });
    });

    ipcMain.handle('get-scale-weight', async (event, config = {}) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Origen no autorizado' };
        return new Promise((resolve) => {
            const rawPort = String(config.port || 'COM1').trim().toUpperCase();
            if (!/^(?:\\\\\.\\)?COM\d{1,3}$/.test(rawPort)) {
                return resolve({ success: false, error: 'Puerto serial inválido (formato esperado: COM1..COM999).' });
            }
            const portName = rawPort;
            const allowedBauds = [1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200];
            const parsedBaud = parseInt(config.baudRate, 10);
            const baudRate = allowedBauds.includes(parsedBaud) ? parsedBaud : 9600;

            if (process.platform !== 'win32') {
                return resolve({ success: false, error: 'Lectura de balanza serial disponible en Windows.' });
            }

            const { spawn } = require('child_process');
            // Script de lectura de puerto serie continuo con timeout de 1.5s
            const psScaleScript = `
try {
    $port = New-Object System.IO.Ports.SerialPort '${portName}', ${baudRate}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One
    $port.ReadTimeout = 1500
    $port.Open()
    $line = $port.ReadLine()
    $port.Close()
    Write-Output $line
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;
            const encodedScript = Buffer.from(psScaleScript, 'utf16le').toString('base64');
            const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript]);
            
            let output = '';
            let errorOut = '';
            child.stdout.on('data', (d) => { output += d.toString(); });
            child.stderr.on('data', (d) => { errorOut += d.toString(); });

            child.on('close', (code) => {
                if (code === 0 && output) {
                    // Extraer valor numérico del flujo continuo (ej. "ST,GS,+  1.250kg" -> 1.250)
                    const match = output.match(/[-+]?\s*(\d+(?:\.\d+)?)/);
                    if (match) {
                        const weight = parseFloat(match[1]);
                        return resolve({ success: true, weight, raw: output.trim(), unit: output.toLowerCase().includes('lb') ? 'lb' : 'kg' });
                    }
                    return resolve({ success: true, weight: 0, raw: output.trim(), unit: 'kg' });
                }
                resolve({ success: false, error: errorOut.trim() || 'No se recibió respuesta de la balanza en ' + portName });
            });

            setTimeout(() => {
                if (!child.killed) {
                    child.kill();
                    resolve({ success: false, error: 'Tiempo de espera agotado al leer la balanza.' });
                }
            }, 3000);
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

        const safePrinterName = await resolveTargetPrinter(printerName);
        log(`RAW Print request received for printer: "${safePrinterName || 'NONE'}" (requested: "${printerName || ''}")`);
        if (!safePrinterName) {
            log('No physical printer available for print-raw');
            return { success: false, error: 'No se detectó una impresora térmica conectada' };
        }

        // 1. Intento ultrarrápido vía LocalPrinterService (RawPrinter.exe nativo, <50ms)
        try {
            const LocalPrinterService = require('./services/LocalPrinterService');
            const rawBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '', 'utf8');
            await LocalPrinterService.printRaw(rawBuffer, safePrinterName);
            log(`RAW Print successful via RawPrinter.exe on ${safePrinterName}`);
            return { success: true, printerName: safePrinterName };
        } catch (fastErr) {
            log(`Fast RawPrinter print notice (${fastErr.message}), trying fallback...`);
        }

        return new Promise((resolve) => {
            try {
                const { spawn } = require('child_process');

                // Content to Bytes (UTF8 or ASCII)
                const bytes = Buffer.from(content, 'utf8');
                const byteString = Array.from(bytes).join(',');

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
$success = [RawPrinterHelper]::SendBytesToPrinter('${escapedPrinterName}', [byte[]]('${byteString}' -split ','));
if ($success) { exit 0 } else { exit 1 }`;

                // Encode to avoid newline/quote parsing errors
                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

                const child = spawn('powershell.exe', [
                    '-NoProfile',
                    '-ExecutionPolicy', 'Bypass',
                    '-EncodedCommand', encodedScript
                ], { windowsHide: true });

                child.on('error', (err) => {
                    log(`[CRITICAL] Error al lanzar proceso hijo (PowerShell) en print-raw: ${err.message}`);
                    resolve({ success: false, error: 'Fallo al inicializar componente de hardware (print-raw).' });
                });

                let stderr = '';
                child.stderr.on('data', (data) => { stderr += data.toString(); });

                child.on('close', (code) => {
                    if (code === 0) {
                        log(`RAW Print successful on ${safePrinterName}`);
                        resolve({ success: true, printerName: safePrinterName });
                    } else {
                        log(`RAW Print failed on ${safePrinterName} with code ${code}. Stderr: ${stderr}`);
                        resolve({ success: false, error: `Fallo al imprimir (Código ${code})` });
                    }
                });

                setTimeout(() => {
                    if (!child.killed) {
                        child.kill();
                        resolve({ success: false, error: 'Timeout de impresión RAW' });
                    }
                }, 6000);

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
                    { name: 'Archivos de Respaldo PostgreSQL (*.zip, *.sql, *.json, *.enc)', extensions: ['zip', 'sql', 'json', 'enc'] }
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
        if (!verifyIpcSender(event)) return null;
        return app.getVersion() || '2.0.9';
    });

    ipcMain.handle('is-windows-7', async (event) => {
        if (!verifyIpcSender(event)) return false;
        try {
            const os = require('os');
            return os.platform() === 'win32' && os.release().startsWith('6.1');
        } catch (e) {
            return false;
        }
    });

    try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        electronUpdaterInstance = autoUpdater;

        autoUpdater.on('checking-for-update', () => {
            log('Electron AutoUpdater: Buscando actualizaciones...');
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'checking' });
        });
        autoUpdater.on('update-available', (info) => {
            log(`Electron AutoUpdater: Nueva versión disponible v${info.version}. Descargando silenciosamente en segundo plano...`);
            if (mainWindow) mainWindow.webContents.send('updater-event', { status: 'available', info });
        });
        autoUpdater.on('update-not-available', (info) => {
            log('Electron AutoUpdater: El sistema está actualizado.');
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
            log(`Electron AutoUpdater: Actualización v${info.version} descargada. Se instalará automáticamente de forma silenciosa al salir o reiniciar.`);
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
            const OFFICIAL_RELEASE_PREFIX = 'https://github.com/mrivero105-oss/american-pos-backend/releases/download/';
            if (url && typeof url === 'string') {
                try {
                    const parsed = new URL(url);
                    if (parsed.protocol !== 'https:' || !url.startsWith(OFFICIAL_RELEASE_PREFIX)) {
                        log(`[SECURITY] Blocked download-update from untrusted URL: ${url}`);
                        return { success: false, error: 'URL de actualización no autorizada. Solo se permiten descargas desde el repositorio oficial verificado.' };
                    }
                } catch (e) {
                    return { success: false, error: 'URL de actualización inválida.' };
                }
            }

            if (!url || typeof url !== 'string') {
                const res = await axios.get('https://github.com/mrivero105-oss/american-pos-backend/releases/latest/download/latest.yml', {
                    timeout: 6000,
                    headers: { 'User-Agent': 'IsaacPOS-Updater-Service/2.0' }
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
                const exePath = path.join(tempDir, `IsaacPOS-Update-${Date.now()}.exe`);
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
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            const tempDir = os.tmpdir();
            const resolvedPath = path.resolve(global.downloadedUpdatePath);
            const isValidPath = resolvedPath.startsWith(path.resolve(tempDir)) && 
                                resolvedPath.endsWith('.exe') && 
                                path.basename(resolvedPath).startsWith('IsaacPOS-Update-') && 
                                fs.existsSync(resolvedPath);
            if (!isValidPath) {
                log(`[SECURITY] Blocked execution of invalid update path: ${global.downloadedUpdatePath}`);
                return { success: false, error: 'Ruta de actualización no confiable o archivo corrupto' };
            }

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

    // --- Dynamic Database & Server Network Setup IPC ---
    ipcMain.handle('get-db-config', async (event) => {
        if (!verifyIpcSender(event)) return null;
        try {
            const DbConfigManager = require('./config/dbConfigManager');
            return DbConfigManager.getConfig();
        } catch (err) {
            log(`Error in get-db-config IPC: ${err.message}`);
            return null;
        }
    });

    ipcMain.handle('test-db-connection', async (event, config) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        try {
            const DbConfigManager = require('./config/dbConfigManager');
            return await DbConfigManager.testConnection(config);
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('discover-lan-server', async (event, timeoutMs) => {
        if (!verifyIpcSender(event)) return { found: false, error: 'Acceso denegado' };
        try {
            const DbConfigManager = require('./config/dbConfigManager');
            return await DbConfigManager.discoverServer(timeoutMs || 3500);
        } catch (err) {
            return { found: false, error: err.message };
        }
    });

    ipcMain.handle('save-db-config-and-restart', async (event, config) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        try {
            const DbConfigManager = require('./config/dbConfigManager');
            const saveRes = DbConfigManager.saveConfig(config);
            if (!saveRes.success) return saveRes;

            log('Nueva configuración de BD guardada en AppData. Reiniciando runtime de la aplicación...');
            app.relaunch();
            app.exit(0);
            return { success: true };
        } catch (err) {
            log(`Error guardando configuración de BD: ${err.message}`);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('close-app', async (event) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        app.quit();
        return { success: true };
    });
}


app.whenReady().then(async () => {
    // Inicializar manejadores IPC una sola vez
    setupIpcHandlers();

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
                `# Isaac POS - Archivo de Configuración Local`,
                `JWT_SECRET=${newSecret}`,
                `LEGACY_HMAC_SECRET=${legacySecret}`,
                `SYNC_SECRET_KEY=${syncSecret}`,
                `PORT=3005,5005,8080`,
                `DB_DIALECT=postgres`,
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
        if (typeof configureAutoLaunch === 'function') {
            configureAutoLaunch(true);
        }
        log('Checking user media directories...');
        const fs = require('fs');
        const APP_VERSION = '2.1.5';

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

        // Auto-migración desde 'americanpos' a 'isaac-pos' si existen datos previos
        const legacyAppData = path.join(process.env.APPDATA || '', 'americanpos');
        if (fs.existsSync(legacyAppData) && legacyAppData !== userDataPath) {
            const legacyImages = path.join(legacyAppData, 'product_images');
            if (fs.existsSync(legacyImages)) {
                try {
                    const currentImgs = fs.existsSync(imagesPath) ? fs.readdirSync(imagesPath) : [];
                    if (currentImgs.length === 0) {
                        fs.cpSync(legacyImages, imagesPath, { recursive: true });
                        log('[Migration] Migradas imágenes de productos desde americanpos a isaac-pos');
                    }
                } catch (e) {
                    log(`[Migration] Error copiando imágenes legacy: ${e.message}`);
                }
            }
            const legacyInvoices = path.join(legacyAppData, 'invoices');
            const invoicesPath = path.join(userDataPath, 'invoices');
            if (fs.existsSync(legacyInvoices) && !fs.existsSync(invoicesPath)) {
                try {
                    fs.cpSync(legacyInvoices, invoicesPath, { recursive: true });
                } catch (e) {}
            }
        }

        // PostgreSQL manages database creation and migrations automatically on connectDB()

        // 1. Mostrar ventana principal de inmediato con pantalla de carga Splash (0.2s response time)
        createWindow();

        // 🔒 Cargar configuración de base de datos activa antes de inicializar servicios
        let activeDbConfig = null;
        try {
            const DbConfigManager = require('./config/dbConfigManager');
            activeDbConfig = DbConfigManager.getConfig();
            log(`[DB Config] Modo: ${activeDbConfig.mode} | Destino: ${activeDbConfig.host}:${activeDbConfig.port}`);
        } catch (dbCfgErr) {
            log(`[DB Config] Aviso cargando configuración: ${dbCfgErr.message}`);
        }

        const isClientTerminal = (activeDbConfig && activeDbConfig.mode === 'client') || process.env.POS_NODE_ROLE === 'LAN_SPOKE';
        const dialect = 'postgres';

        // Solo el Servidor Principal (Master / Localhost) debe verificar/iniciar el motor PostgreSQL local
        if (dialect === 'postgres' && !isClientTerminal) {
            try {
                log('Verifying PostgreSQL instance status for Main Server...');
                const { ensurePostgresRunning } = require('./utils/postgresLauncher');
                await ensurePostgresRunning();
            } catch (pgLaunchErr) {
                log(`[Main] Warning checking PostgreSQL launcher: ${pgLaunchErr.message}`);
            }
        } else if (isClientTerminal) {
            log('[Main] Terminal iniciada en modo Caja Secundaria (Cliente LAN). Verificación de PostgreSQL local omitida.');
        }

        log('Attempting to require ./index.js');
        // 2. Iniciar el servidor Express en paralelo
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

            // Verificación y descarga 100% automática y silenciosa de actualizaciones a los 10 segundos del inicio
            if (electronUpdaterInstance) {
                setTimeout(() => {
                    log('Verificación automática de actualizaciones iniciada (10s post-arranque)...');
                    electronUpdaterInstance.checkForUpdatesAndNotify().catch(e => {
                        log(`Notice auto-update check: ${e.message}`);
                    });
                }, 10000);
            }
        }).catch(err => {
            log(`Aviso / Error al iniciar el servidor: ${err.message}\n${err.stack}`);
            console.error('Aviso / Error al iniciar el servidor:', err.message);

            // Si el error es por base de datos inalcanzable, conexión rechazada o timeout:
            // ¡NO CERRAR LA APLICACIÓN! Cargar el asistente visual de configuración de servidor.
            const isDbConnError = err.code === 'ERR_DB_UNREACHABLE' || 
                err.code === 'ECONNREFUSED' || 
                err.name === 'SequelizeConnectionRefusedError' ||
                err.name === 'SequelizeConnectionError' ||
                err.name === 'SequelizeHostNotFoundError' ||
                (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('timeout expired') || err.message.includes('base de datos') || err.message.includes('PostgreSQL')));

            const setupFile = path.join(__dirname, 'public', 'server-setup.html');

            if (isDbConnError && fs.existsSync(setupFile)) {
                log(`[Resilient Startup] Redirigiendo a pantalla de Asistente de Servidor: ${setupFile}`);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.loadFile(setupFile);
                } else {
                    createWindow();
                    if (mainWindow) mainWindow.loadFile(setupFile);
                }
            } else {
                // Fallo crítico distinto a configuración de base de datos
                try {
                    require('fs').writeFileSync(require('path').join(require('os').homedir(), 'Desktop', 'server_error.txt'), err.stack || err.message);
                } catch (e) { }
                dialog.showErrorBox('Error del Servidor', `Fallo al iniciar el servidor local:\n${err.message}\nRevisa server_error.txt en el escritorio.`);
                app.quit();
            }
        });
    } catch (error) {
        log(`CRITICAL ERROR during startup: ${error.message}\n${error.stack}`);
        try {
            require('fs').writeFileSync(require('path').join(require('os').homedir(), 'Desktop', 'error.txt'), error.stack);
        } catch (e) { }
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
    log('All windows closed. Terminating process.');
    if (process.platform !== 'darwin') {
        app.quit();
        process.exit(0);
    }
});
