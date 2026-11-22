const { app, BrowserWindow, dialog, session, shell, nativeImage } = require('electron');

// 🔒 Identificador AUMID de Windows para anclaje e icono de barra de tareas oficial
app.setAppUserModelId('com.isaacpos.frontend');
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

// Handle Squirrel events for Windows only when Squirrel CLI flags are present (NSIS installers don't use them)
if (process.platform === 'win32' && process.argv.some((arg) => /^--squirrel/i.test(String(arg)))) {
    try {
        if (require('electron-squirrel-startup')) {
            app.quit();
            process.exit(0);
        }
    } catch (e) { }
}

let mainWindow = null;
let isQuittingAfterBackup = false;
let electronUpdaterInstance = null;
let activeServerHandle = null;
let startupSessionCleaned = false;
let gracefulShutdownPromise = null;
let isCleanShutdownCompleted = false;

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

const { formatLogMessage } = require('./utils/formatLogArgs');

const MAX_STARTUP_LOG_BYTES = 5 * 1024 * 1024;
let logStream = null;
let startupLogDir = null;
let startupLogFile = null;
let startupLogBytes = 0;

function rotateStartupLogIfNeeded() {
    if (!startupLogFile || startupLogBytes <= MAX_STARTUP_LOG_BYTES) return;
    try {
        const fs = require('fs');
        if (logStream) {
            try { logStream.end(); } catch (_endErr) {}
            logStream = null;
        }
        const rotatedLog = path.join(startupLogDir, 'pos_startup_log.old.txt');
        try { if (fs.existsSync(rotatedLog)) fs.unlinkSync(rotatedLog); } catch (_e) {}
        if (fs.existsSync(startupLogFile)) {
            fs.renameSync(startupLogFile, rotatedLog);
        }
        startupLogBytes = 0;
        logStream = fs.createWriteStream(startupLogFile, { flags: 'a' });
    } catch (_rotErr) {}
}

try {
    const fs = require('fs');
    startupLogDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(startupLogDir)) {
        fs.mkdirSync(startupLogDir, { recursive: true });
    }
    startupLogFile = path.join(startupLogDir, 'pos_startup_log.txt');
    try {
        if (fs.existsSync(startupLogFile)) {
            const stats = fs.statSync(startupLogFile);
            startupLogBytes = stats.size || 0;
            rotateStartupLogIfNeeded();
        }
    } catch (_rotErr) {}
    if (!logStream) {
        logStream = fs.createWriteStream(startupLogFile, { flags: 'a' });
    }
} catch (e) { }

function log(message) {
    if (!LOGS_ENABLED || !logStream) return;
    try {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${message}\n`;
        const lineBytes = Buffer.byteLength(line, 'utf8');
        if (startupLogBytes + lineBytes > MAX_STARTUP_LOG_BYTES) {
            startupLogBytes += lineBytes;
            rotateStartupLogIfNeeded();
        } else {
            startupLogBytes += lineBytes;
        }
        if (logStream) {
            logStream.write(line);
        }
    } catch (e) { }
}

const patchConsole = (method) => {
    const original = console[method];
    console[method] = (...args) => {
        try {
            if (LOGS_ENABLED) {
                // Log to our file first (compact formatting avoids expensive pretty JSON indentation in startup/runtime)
                const msg = formatLogMessage(args, { pretty: false });
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
console.__isaacMainPatched = true;

// Asegurar fetch global en Electron 22 (Node 16) antes de operaciones de red o auto-update
try {
    require('./utils/ensureFetchPolyfill').ensureFetchPolyfill();
} catch (e) { }

// En desarrollo local cargamos .env del proyecto; en empaquetado usamos exclusivamente %APPDATA%\isaac-pos\.env
if (!app.isPackaged) {
    try {
        require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
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

async function performGracefulShutdown() {
    if (gracefulShutdownPromise) return gracefulShutdownPromise;
    gracefulShutdownPromise = (async () => {
        try {
            const backupTimeout = new Promise(resolve => setTimeout(() => resolve(false), 8000));
            const success = await Promise.race([performFastDbBackupOnly(), backupTimeout]);
            log(`Fast auto-backup result: ${success ? 'SUCCESS' : 'FAILED/TIMEOUT'}.`);
        } catch (bkErr) {
            log(`Warning during exit backup: ${bkErr.message}`);
        }

        if (activeServerHandle && typeof activeServerHandle.stopServer === 'function') {
            try {
                log('Stopping backend server and background workers cleanly...');
                const stopTimeout = new Promise(resolve => setTimeout(resolve, 4000));
                await Promise.race([activeServerHandle.stopServer(), stopTimeout]);
                log('Backend server stopped cleanly.');
            } catch (stopErr) {
                log(`Warning during stopServer: ${stopErr.message}`);
            }
        }
        isCleanShutdownCompleted = true;
    })();
    return gracefulShutdownPromise;
}

function createWindow(serverPort) {
    log(`Entering createWindow function. serverPort: ${serverPort}`);
    const loadTargetUrl = () => {
        if (mainWindow && !mainWindow.isDestroyed() && serverPort) {
            log(`Redirecting existing window to http://localhost:${serverPort}`);
            mainWindow.loadURL(`http://localhost:${serverPort}`);
        }
    };

    if (serverPort && !startupSessionCleaned) {
        startupSessionCleaned = true;
        // Limpiar únicamente cookies de sesión sin destruir el caché de Service Workers ni bloquear la carga
        session.defaultSession.clearStorageData({ storages: ['cookies'] }).then(() => {
            log('Session cookies cleared cleanly once on startup.');
        }).catch(() => {}).finally(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                loadTargetUrl();
            }
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
            return;
        }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        loadTargetUrl();
        return;
    }

    // Resolver icono oficial de la aplicación en alta definición (priorizar .ico externo y contenedor nativo)
    let resolvedAppIcon = null;
    try {
        const externalIco = path.join(path.dirname(app.getPath('exe')), 'app_icon_fhd.ico');
        const internalIco = path.join(__dirname, 'build', 'icon.ico');
        const fallbackFavicon = path.join(__dirname, 'public', 'favicon.ico');
        const emblemPng = path.join(__dirname, 'public', 'isaac-emblem.png');
        
        let chosenIconPath = null;
        if (fs.existsSync(externalIco)) {
            chosenIconPath = externalIco;
        } else if (fs.existsSync(internalIco)) {
            chosenIconPath = internalIco;
        } else if (fs.existsSync(fallbackFavicon)) {
            chosenIconPath = fallbackFavicon;
        } else if (fs.existsSync(emblemPng)) {
            chosenIconPath = emblemPng;
        }

        if (chosenIconPath) {
            resolvedAppIcon = nativeImage.createFromPath(chosenIconPath);
        }
    } catch (_icoErr) {
        resolvedAppIcon = path.join(__dirname, 'public', 'isaac-emblem.png');
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
        icon: resolvedAppIcon,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
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
        if (resolvedAppIcon && typeof mainWindow.setIcon === 'function') {
            mainWindow.setIcon(resolvedAppIcon);
        }
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

    // 🔒 SEGURIDAD: Prevenir apertura de DevTools, recargas y atajo F1
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // Bloquear F1 nativo en todo el sistema para evitar ayuda del OS y acciones no deseadas
        if (input.key === 'F1') {
            event.preventDefault();
            return;
        }

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
        log('Window ready-to-show event fired.');
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
                            const updater = typeof global.__getIsaacAutoUpdater === 'function' ? global.__getIsaacAutoUpdater() : electronUpdaterInstance;
                            if (updater) {
                                mainWindow.webContents.send('updater-event', { status: 'checking' });
                                updater.checkForUpdates().catch(e => {
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

    mainWindow.on('closed', function () {
        log('Window closed.');
        mainWindow = null;
    });

    // --- AUTO-BACKUP & GRACEFUL SHUTDOWN ON CLOSE ---
    mainWindow.on('close', (event) => {
        if (!isQuittingAfterBackup) {
            event.preventDefault();
            isQuittingAfterBackup = true;
            log('Window close intercepted. Running fast DB backup and graceful server shutdown...');

            performGracefulShutdown().finally(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.destroy();
                }
                app.quit();
            });
        }
    });
}

const autoLaunchManager = require('./utils/autoLaunchManager');

function getAutoLaunchPreference() {
    return autoLaunchManager.getAutoLaunchPreference(app.getPath('userData'));
}

async function configureAutoLaunch(enabled = true) {
    return autoLaunchManager.configureWindowsAutoLaunch(enabled, {
        userDataPath: app.getPath('userData'),
        isPackaged: app.isPackaged,
        processExecPath: process.execPath,
        app,
        logFn: log
    });
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
        if (!url || (
            !url.startsWith('http://localhost:') &&
            !url.startsWith('https://localhost:') &&
            !url.startsWith('http://127.0.0.1:') &&
            !url.startsWith('https://127.0.0.1:') &&
            !url.startsWith('http://[::1]:') &&
            !url.startsWith('https://[::1]:') &&
            !url.startsWith('file://')
        )) {
            log('Acceso IPC denegado por origen de URL no autorizado: ' + url);
            return false;
        }
        return true;
    };

    // Verifica sesión JWT activa desde la cookie httpOnly de Electron (evita uso de IPC sensibles por XSS/sesión anónima)
    const getAuthenticatedIpcUser = async () => {
        try {
            const secret = process.env.JWT_SECRET;
            if (!secret) return null;
            const cookies = await session.defaultSession.cookies.get({ name: 'authToken' });
            if (!Array.isArray(cookies) || cookies.length === 0) return null;
            const jwt = require('jsonwebtoken');
            for (const c of cookies) {
                if (!c || !c.value) continue;
                try {
                    const decoded = jwt.verify(c.value, secret, { algorithms: ['HS256'] });
                    if (decoded && (decoded.id || decoded.userId)) {
                        return decoded;
                    }
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    };

    const isPrivilegedIpcRole = (user) => {
        if (!user) return false;
        const role = String(user.role || '').toLowerCase().trim();
        return ['admin', 'superadmin', 'owner', 'dueño', 'dueno', 'supervisor', 'gerente'].includes(role);
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
            return await autoLaunchManager.getWindowsAutoLaunchStatus({
                userDataPath: app.getPath('userData'),
                app
            });
        } catch (err) {
            log(`Error getting auto-launch: ${err.message}`);
            return false;
        }
    });

    ipcMain.handle('set-auto-launch', async (event, enabled) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Origen no autorizado' };
        try {
            return await configureAutoLaunch(enabled);
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
        const ipcUser = await getAuthenticatedIpcUser();
        if (!ipcUser) {
            log('[SECURITY] Bloqueado IPC open-drawer sin sesión autenticada.');
            return { success: false, error: 'Sesión autenticada requerida para abrir la gaveta.' };
        }

        const safePrinterName = await resolveTargetPrinter(printerName);
        log(`Attempting to open drawer on printer: "${safePrinterName || 'NONE'}" by user=${ipcUser.id || ipcUser.userId} (requested: "${printerName || ''}") with sequence: ${sequence || 'default'}`);
        if (!safePrinterName) {
            log('No physical printer available for open-drawer');
            return { success: false, error: 'No se detectó una impresora térmica conectada' };
        }

        // Default sequence (ESC p 0 25 250)
        const defaultCodes = [27, 112, 48, 25, 250];
        let bytes = defaultCodes;

        if (sequence) {
            try {
                bytes = String(sequence).split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n >= 0 && n <= 255);
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

        const bytesBase64 = Buffer.from(bytes).toString('base64');

        return new Promise((resolve) => {
            try {
                const { spawn } = require('child_process');
                // Script PowerShell 100% estático: impresora y bytes viajan por variables de entorno (inmune a inyección ASCII/Unicode)
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
$printerTarget = $env:ISAAC_PRINTER_NAME;
$rawBytes = [Convert]::FromBase64String($env:ISAAC_RAW_B64);
$success = [RawPrinterHelper]::SendBytesToPrinter($printerTarget, $rawBytes);
if ($success) { exit 0 } else { exit 1 }`;

                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

                log(`Spawning C# interop drawer process for: "${safePrinterName}"`);
                const child = spawn('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy', 'Bypass',
                    '-EncodedCommand', encodedScript
                ], {
                    windowsHide: true,
                    env: {
                        ...process.env,
                        ISAAC_PRINTER_NAME: safePrinterName,
                        ISAAC_RAW_B64: bytesBase64
                    }
                });

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

            const safePort = String(portName || 'COM1').trim().toUpperCase().replace(/^\\\\\.\\/, '');
            if (!/^COM\d{1,3}$/.test(safePort)) {
                return resolve({ success: false, error: `Puerto serial inválido: ${portName}` });
            }
            const safeBaud = parseInt(baudRate, 10) || 9600;
            const { spawn } = require('child_process');
            // Script de lectura de puerto serie continuo con timeout de 1.5s y cierre garantizado en finally
            const psScaleScript = `
$port = $null
try {
    $port = New-Object System.IO.Ports.SerialPort $env:ISAAC_SCALE_PORT, ([int]$env:ISAAC_SCALE_BAUD), [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One
    $port.ReadTimeout = 1500
    $port.Open()
    $line = $port.ReadLine()
    Write-Output $line
} catch {
    Write-Error $_.Exception.Message
    exit 1
} finally {
    if ($port -ne $null -and $port.IsOpen) { $port.Close() }
}
`;
            const encodedScript = Buffer.from(psScaleScript, 'utf16le').toString('base64');
            const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript], {
                windowsHide: true,
                env: { ...process.env, ISAAC_SCALE_PORT: safePort, ISAAC_SCALE_BAUD: String(safeBaud) }
            });
            
            let output = '';
            let errorOut = '';
            let settled = false;
            child.stdout.on('data', (d) => { output += d.toString(); });
            child.stderr.on('data', (d) => { errorOut += d.toString(); });

            const killTimer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    try { child.kill(); } catch (_e) {}
                    resolve({ success: false, error: 'Tiempo de espera agotado al leer la balanza.' });
                }
            }, 3000);

            child.on('close', (code) => {
                clearTimeout(killTimer);
                if (settled) return;
                settled = true;
                if (code === 0 && output) {
                    const match = output.match(/([-+])?\s*(\d+(?:\.\d+)?)/);
                    if (match) {
                        let weight = parseFloat(match[2]);
                        if (match[1] === '-') weight = -weight;
                        return resolve({ success: true, weight, raw: output.trim(), unit: output.toLowerCase().includes('lb') ? 'lb' : 'kg' });
                    }
                    return resolve({ success: true, weight: 0, raw: output.trim(), unit: 'kg' });
                }
                resolve({ success: false, error: errorOut.trim() || 'No se recibió respuesta de la balanza en ' + safePort });
            });
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

                // Payload vía stdin Base64 e impresora vía env (elimina RCE Unicode y límite de 32KB de CreateProcess)
                const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content || '', 'utf8');
                const payloadB64 = bytes.toString('base64');

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
$rawB64 = [Console]::In.ReadToEnd().Trim();
$rawBytes = [Convert]::FromBase64String($rawB64);
$success = [RawPrinterHelper]::SendBytesToPrinter($env:ISAAC_PRINTER_NAME, $rawBytes);
if ($success) { exit 0 } else { exit 1 }`;

                const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

                const child = spawn('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy', 'Bypass',
                    '-EncodedCommand', encodedScript
                ], {
                    windowsHide: true,
                    env: { ...process.env, ISAAC_PRINTER_NAME: safePrinterName }
                });
                if (child.stdin) {
                    child.stdin.end(payloadB64, 'utf8');
                }

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

    const getAutoUpdater = () => {
        if (electronUpdaterInstance) return electronUpdaterInstance;
        try {
            const { autoUpdater } = require('electron-updater');
            autoUpdater.autoDownload = true;
            autoUpdater.autoInstallOnAppQuit = true;
            autoUpdater.allowDowngrade = false;
            const electronVer = String(process.versions?.electron || '');
            if (/^22\./.test(electronVer)) {
                autoUpdater.channel = 'legacy';
            } else if (electronVer) {
                autoUpdater.channel = 'modern';
            }
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
            return electronUpdaterInstance;
        } catch (updaterErr) {
            log(`Electron autoUpdater initialization notice: ${updaterErr.message}`);
            return null;
        }
    };
    global.__getIsaacAutoUpdater = getAutoUpdater;

    ipcMain.handle('check-for-updates', async (event) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        const updater = getAutoUpdater();
        if (updater) {
            try {
                const res = await Promise.race([
                    updater.checkForUpdates(),
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
        const updater = getAutoUpdater();
        if (updater) {
            try {
                await updater.downloadUpdate();
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
            const OFFICIAL_RELEASE_ORIGIN = 'https://github.com';
            const OFFICIAL_RELEASE_PATH_PREFIX = '/mrivero105-oss/american-pos-backend/releases/download/';
            if (url && typeof url === 'string') {
                try {
                    const parsed = new URL(url.trim());
                    const normalizedHref = parsed.href;
                    const safePathSegments = parsed.pathname.split('/').filter(Boolean);
                    const hasTraversal = safePathSegments.some((seg) => seg === '.' || seg === '..') || url.includes('..');
                    if (
                        parsed.protocol !== 'https:' ||
                        parsed.origin !== OFFICIAL_RELEASE_ORIGIN ||
                        !parsed.pathname.startsWith(OFFICIAL_RELEASE_PATH_PREFIX) ||
                        hasTraversal ||
                        !normalizedHref.startsWith(`${OFFICIAL_RELEASE_ORIGIN}${OFFICIAL_RELEASE_PATH_PREFIX}`)
                    ) {
                        log(`[SECURITY] Blocked download-update from untrusted/traversal URL: ${url}`);
                        return { success: false, error: 'URL de actualización no autorizada. Solo se permiten descargas desde el repositorio oficial verificado.' };
                    }
                    url = normalizedHref;
                } catch (e) {
                    return { success: false, error: 'URL de actualización inválida.' };
                }
            }

            const extractSha512FromYml = (ymlText, targetFileName = '') => {
                const raw = String(ymlText || '');
                if (targetFileName) {
                    const escaped = targetFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const fileBlock = raw.match(new RegExp(`url:\\s*${escaped}[\\s\\S]{0,300}?sha512:\\s*([A-Za-z0-9+/=]{64,})`, 'm'));
                    if (fileBlock && fileBlock[1]) return fileBlock[1].trim();
                }
                const globalMatch = raw.match(/^sha512:\s*([A-Za-z0-9+/=]{64,})/m);
                return globalMatch ? globalMatch[1].trim() : null;
            };

            let ymlText = null;
            let expectedSha512 = null;
            const channelYml = (/^22\./.test(String(process.versions?.electron || ''))) ? 'legacy.yml' : 'modern.yml';
            if (!url || typeof url !== 'string') {
                let res = null;
                for (const ymlName of [channelYml, 'latest.yml']) {
                    try {
                        res = await axios.get(`https://github.com/mrivero105-oss/american-pos-backend/releases/latest/download/${ymlName}`, {
                            timeout: 6000,
                            headers: { 'User-Agent': 'IsaacPOS-Updater-Service/2.0' }
                        });
                        if (res?.data) break;
                    } catch (_e) {}
                }
                ymlText = res?.data || '';
                const versionMatch = ymlText.match(/version:\s*([^\s\n\r]+)/);
                const remoteTag = versionMatch ? versionMatch[1] : null;
                const pathMatch = ymlText.match(/path:\s*([^\s\n\r]+)/);
                const pathVal = pathMatch ? pathMatch[1] : null;
                expectedSha512 = extractSha512FromYml(ymlText, pathVal || '');
                if (remoteTag && pathVal) {
                    url = `https://github.com/mrivero105-oss/american-pos-backend/releases/download/v${remoteTag}/${pathVal}`;
                }
            } else {
                try {
                    const parsedUrl = new URL(url);
                    const fileName = path.basename(parsedUrl.pathname);
                    const releaseDir = parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/'));
                    for (const ymlName of [channelYml, 'latest.yml']) {
                        try {
                            const ymlRes = await axios.get(`${parsedUrl.origin}${releaseDir}/${ymlName}`, {
                                timeout: 6000,
                                headers: { 'User-Agent': 'IsaacPOS-Updater-Service/2.0' }
                            });
                            ymlText = ymlRes?.data || '';
                            expectedSha512 = extractSha512FromYml(ymlText, fileName);
                            if (expectedSha512) break;
                        } catch (_e) {}
                    }
                } catch (ymlErr) {
                    log(`[SECURITY] No se pudo obtener yml para verificar SHA-512 de ${url}: ${ymlErr.message}`);
                }
            }

            if (url) {
                if (!expectedSha512) {
                    log(`[SECURITY] Blocked fallback download because SHA-512 digest is unavailable for ${url}`);
                    return { success: false, error: 'No se pudo obtener la firma de integridad SHA-512 oficial (latest.yml) para esta actualización.' };
                }

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
                    global.downloadedUpdateMeta = { exePath, expectedSha512, url };
                    return { success: true };
                } catch (dlErr) {
                    try { if (fs.existsSync(exePath)) fs.unlinkSync(exePath); } catch (_) {}
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
            const crypto = require('crypto');
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

            const expectedSha512 = global.downloadedUpdateMeta && global.downloadedUpdateMeta.exePath === global.downloadedUpdatePath
                ? global.downloadedUpdateMeta.expectedSha512
                : null;
            if (!expectedSha512 || typeof expectedSha512 !== 'string') {
                log(`[SECURITY] Blocked execution of update without expected SHA-512 hash: ${resolvedPath}`);
                try { fs.unlinkSync(resolvedPath); } catch (_) {}
                global.downloadedUpdatePath = null;
                return { success: false, error: 'Actualización bloqueada: falta huella SHA-512 oficial verificada.' };
            }

            try {
                const actualDigest = await new Promise((resolve, reject) => {
                    const hash = crypto.createHash('sha512');
                    const stream = fs.createReadStream(resolvedPath);
                    stream.on('data', (chunk) => hash.update(chunk));
                    stream.on('end', () => resolve(hash.digest()));
                    stream.on('error', reject);
                });
                const expectedDigest = Buffer.from(expectedSha512.trim(), 'base64');
                if (expectedDigest.length !== 64 || actualDigest.length !== expectedDigest.length || !crypto.timingSafeEqual(actualDigest, expectedDigest)) {
                    log(`[SECURITY] Blocked corrupted/tampered update binary (SHA-512 mismatch): ${resolvedPath}`);
                    try { fs.unlinkSync(resolvedPath); } catch (_) {}
                    global.downloadedUpdatePath = null;
                    global.downloadedUpdateMeta = null;
                    return { success: false, error: 'Actualización bloqueada: la verificación de integridad SHA-512 falló.' };
                }

                if (process.platform === 'win32') {
                    const { execFile } = require('child_process');
                    const sigStatus = await new Promise((resolve) => {
                        execFile(
                            'powershell.exe',
                            ['-NoProfile', '-NonInteractive', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:ISAAC_UPD_FILE).Status'],
                            { env: { ...process.env, ISAAC_UPD_FILE: resolvedPath }, timeout: 10000 },
                            (err, stdout) => {
                                resolve(err ? 'Unknown' : String(stdout || '').trim());
                            }
                        );
                    });
                    if (sigStatus === 'HashMismatch' || sigStatus === 'NotTrusted' || sigStatus === 'UnknownError') {
                        log(`[SECURITY] Blocked update with compromised Authenticode status (${sigStatus}): ${resolvedPath}`);
                        try { fs.unlinkSync(resolvedPath); } catch (_) {}
                        global.downloadedUpdatePath = null;
                        global.downloadedUpdateMeta = null;
                        return { success: false, error: `Actualización bloqueada por firma Authenticode inválida (${sigStatus}).` };
                    }
                    if (sigStatus !== 'Valid') {
                        if (process.env.REQUIRE_AUTHENTICODE_SIGNATURE === 'true') {
                            log(`[SECURITY] Blocked unsigned update (${sigStatus}) because REQUIRE_AUTHENTICODE_SIGNATURE=true`);
                            try { fs.unlinkSync(resolvedPath); } catch (_) {}
                            global.downloadedUpdatePath = null;
                            global.downloadedUpdateMeta = null;
                            return { success: false, error: `Instalador sin firma Authenticode válida (${sigStatus}).` };
                        }
                        // Sin firma Authenticode válida, exigir confirmación interactiva explícita del usuario en el proceso principal (nunca ejecución silenciosa por XSS)
                        const confirmRes = await dialog.showMessageBox(mainWindow || undefined, {
                            type: 'warning',
                            buttons: ['Cancelar instalación', 'Instalar actualización oficial'],
                            defaultId: 0,
                            cancelId: 0,
                            title: 'Verificación de Seguridad de Actualización',
                            message: 'El instalador descargado pasó la verificación SHA-512 oficial, pero no posee firma Authenticode comercial.',
                            detail: `Estado de firma: ${sigStatus}\nOrigen: ${global.downloadedUpdateMeta?.url || 'GitHub Releases Oficial'}\n\n¿Desea continuar con la instalación?`
                        });
                        if (confirmRes.response !== 1) {
                            log(`[SECURITY] Usuario canceló instalación sin firma Authenticode (${sigStatus}).`);
                            return { success: false, error: 'Instalación cancelada por el usuario (sin firma Authenticode).' };
                        }
                    }
                }
            } catch (hashErr) {
                log(`[SECURITY] Error verificando integridad del instalador: ${hashErr.message}`);
                return { success: false, error: 'Error verificando integridad SHA-512 de la actualización.' };
            }

            log(`Instalando actualización verificada (SHA-512 OK) desde: ${resolvedPath}`);
            try {
                const { spawn } = require('child_process');
                spawn(resolvedPath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
                app.quit();
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
        const updater = typeof global.__getIsaacAutoUpdater === 'function' ? global.__getIsaacAutoUpdater() : electronUpdaterInstance;
        if (updater) {
            updater.quitAndInstall();
            return { success: true };
        }
        return { success: false, error: 'Instalador automático no disponible' };
    });

    // --- Dynamic Database & Server Network Setup IPC ---
    ipcMain.handle('get-db-config', async (event) => {
        if (!verifyIpcSender(event)) return null;
        try {
            const DbConfigManager = require('./config/dbConfigManager');
            return DbConfigManager.getPublicConfig();
        } catch (err) {
            log(`Error in get-db-config IPC: ${err.message}`);
            return null;
        }
    });

    ipcMain.handle('test-db-connection', async (event, config) => {
        if (!verifyIpcSender(event)) return { success: false, error: 'Acceso denegado' };
        const ipcUser = await getAuthenticatedIpcUser();
        const dbCurrentlyUp = Boolean(activeServerHandle && typeof activeServerHandle.isDbReady === 'function' ? activeServerHandle.isDbReady() : true);
        if (dbCurrentlyUp && !isPrivilegedIpcRole(ipcUser)) {
            log('[SECURITY] Bloqueado IPC test-db-connection sin rol privilegiado.');
            return { success: false, error: 'Se requiere sesión de Administrador para probar conexiones de base de datos.' };
        }
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
        const ipcUser = await getAuthenticatedIpcUser();
        const dbCurrentlyUp = Boolean(activeServerHandle && typeof activeServerHandle.isDbReady === 'function' ? activeServerHandle.isDbReady() : true);
        if (dbCurrentlyUp && !isPrivilegedIpcRole(ipcUser)) {
            log('[SECURITY] Bloqueado IPC save-db-config-and-restart sin rol privilegiado.');
            return { success: false, error: 'Se requiere sesión de Administrador para modificar la configuración de base de datos.' };
        }
        try {
            const DbConfigManager = require('./config/dbConfigManager');
            const saveRes = DbConfigManager.saveConfig(config);
            if (!saveRes.success) return saveRes;

            log('Nueva configuración de BD guardada en AppData. Reiniciando runtime de la aplicación...');
            if (activeServerHandle && typeof activeServerHandle.stopServer === 'function') {
                await Promise.race([
                    activeServerHandle.stopServer().catch(() => {}),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);
            }
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

    // Interceptar aperturas de ventanas nuevas (target="_blank") y adjuntos <webview>
    const isAllowedMovilwayUrl = (rawUrl) => {
        const src = String(rawUrl || '').trim();
        if (!src || src === 'about:blank') return true;
        try {
            const parsed = new URL(src);
            const host = parsed.hostname.toLowerCase();
            return parsed.protocol === 'https:' && (
                host === 'movilway.net' || host.endsWith('.movilway.net') ||
                host === 'movilway.com' || host.endsWith('.movilway.com')
            );
        } catch (_) {
            return false;
        }
    };

    app.on('web-contents-created', (event, contents) => {
        if (typeof contents.getType === 'function' && contents.getType() === 'webview') {
            contents.on('will-navigate', (navEvent, targetUrl) => {
                if (!isAllowedMovilwayUrl(targetUrl)) {
                    log(`[SECURITY] Bloqueada navegación de <webview> hacia origen no autorizado: ${targetUrl}`);
                    navEvent.preventDefault();
                }
            });
        }

        contents.on('will-attach-webview', (waEvent, webPreferences, params) => {
            delete webPreferences.preload;
            delete webPreferences.preloadURL;
            webPreferences.nodeIntegration = false;
            webPreferences.nodeIntegrationInSubFrames = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.webSecurity = true;

            const src = String(params?.src || '').trim();
            if (!isAllowedMovilwayUrl(src)) {
                log(`[SECURITY] Bloqueado <webview> hacia origen no autorizado: ${src}`);
                waEvent.preventDefault();
            }
        });

        contents.setWindowOpenHandler(({ url }) => {
            try {
                const parsed = new URL(url);
                if (['http:', 'https:', 'mailto:', 'whatsapp:'].includes(parsed.protocol)) {
                    require('electron').shell.openExternal(url);
                }
            } catch (_e) {}
            return { action: 'deny' };
        });
    });

    // 1. Obtener ruta de datos persistente de Electron
    const userDataPath = app.getPath('userData');
    console.log('Ruta de datos de usuario:', userDataPath);
    process.env.USER_DATA_PATH = userDataPath;
    log('Set USER_DATA_PATH env var.');

    try {
        // 2. Mostrar ventana principal de inmediato con pantalla de carga Splash ANTES de cualquier bóveda DPAPI o BD
        createWindow();
        await new Promise((resolve) => setImmediate(resolve));

        // 🔒 Bóveda DPAPI para secretos de instancia (usa sidecar safeStorage en Electron para < 1ms tras el primer run)
        const userEnvPath = path.join(userDataPath, '.env');
        try {
            const SecretVault = require('./config/secretVault');
            const vaultStatus = SecretVault.provisionAndLoadSecrets({
                baseDir: userDataPath,
                requiredKeys: ['JWT_SECRET', 'LEGACY_HMAC_SECRET', 'SYNC_SECRET_KEY', 'BACKUP_ENCRYPTION_KEY', 'AUDIT_HMAC_SECRET'],
                candidateEnvPaths: [userEnvPath],
                migrateEnvPaths: [userEnvPath],
                stripMigratedEnv: true
            });
            log(`SecretVault activo (${vaultStatus.scheme || 'existing'}): ${vaultStatus.totalSecrets} secreto(s) cifrado(s) en ${vaultStatus.vaultPath}`);
            if (vaultStatus.strippedFiles.length > 0) {
                log(`Secretos heredados migrados desde UserData .env hacia bóveda DPAPI y removidos de texto plano.`);
            }
        } catch (vaultErr) {
            log(`Aviso inicializando SecretVault DPAPI: ${vaultErr.message}`);
            if (fs.existsSync(userEnvPath)) {
                require('dotenv').config({ path: userEnvPath });
            }
            const cryptoFallback = require('crypto');
            for (const k of ['JWT_SECRET', 'LEGACY_HMAC_SECRET', 'SYNC_SECRET_KEY', 'BACKUP_ENCRYPTION_KEY', 'AUDIT_HMAC_SECRET']) {
                if (!process.env[k] || String(process.env[k]).trim().length === 0) {
                    process.env[k] = cryptoFallback.randomBytes(32).toString('hex');
                }
            }
        }

        // Sincronizar autoinicio único en Windows de forma totalmente asíncrona y no bloqueante
        const desiredAutoLaunch = getAutoLaunchPreference();
        setImmediate(() => {
            configureAutoLaunch(desiredAutoLaunch).catch((alErr) => {
                log(`Notice configuring async auto-launch: ${alErr.message}`);
            });
        });

        log('Checking user media directories...');
        const imagesPath = path.join(userDataPath, 'product_images');
        let sourceImages = path.join(__dirname, 'product_images');
        if (app.isPackaged) {
            sourceImages = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'product_images');
        }

        if (!fs.existsSync(imagesPath)) {
            log('Creating product_images directory in UserData...');
            fs.mkdirSync(imagesPath, { recursive: true });
        }

        // Auto-migración desde 'americanpos' a 'isaac-pos' si existen datos previos (en segundo plano tras abrir el Splash)
        const legacyAppData = path.join(process.env.APPDATA || '', 'americanpos');
        if (fs.existsSync(legacyAppData) && legacyAppData !== userDataPath) {
            setImmediate(() => {
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
            });
        }

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

        // Lanzar verificación/inicio de PostgreSQL EN PARALELO con carga de Express/index.js para no bloquear el puerto HTTP
        let pgReadyPromise = Promise.resolve(true);
        if (dialect === 'postgres' && !isClientTerminal) {
            log('Verifying PostgreSQL instance status for Main Server (parallel)...');
            const { ensurePostgresRunning } = require('./utils/postgresLauncher');
            pgReadyPromise = ensurePostgresRunning().catch((pgLaunchErr) => {
                log(`[Main] Warning checking PostgreSQL launcher: ${pgLaunchErr.message}`);
                return false;
            });
        } else if (isClientTerminal) {
            log('[Main] Terminal iniciada en modo Caja Secundaria (Cliente LAN). Verificación de PostgreSQL local omitida.');
        }

        log('Attempting to require ./index.js');
        // 3. Iniciar el servidor Express en paralelo mientras PostgreSQL termina de verificarse
        const { startServer } = require('./index.js');
        log('./index.js requires successfully.');

        const rawPort = process.env.PORT || "3005,5005,8080";
        const ports = rawPort.toString().split(',').map(p => p.trim());

        startServer(ports, userDataPath).then((serverHandle) => {
            activeServerHandle = serverHandle;
            if (isQuittingAfterBackup || gracefulShutdownPromise) {
                log('Shutdown requested before server startup completed. Stopping server cleanly...');
                serverHandle.stopServer().catch(() => {});
                return;
            }
            const { mainPort, dbInitPromise } = serverHandle;
            log(`Servidor iniciado en múltiples puertos. Principal: ${mainPort}`);
            createWindow(mainPort);

            // Resiliencia: si Postgres y el pipeline de BD fallan al arrancar, redirigir al asistente de configuración
            Promise.all([pgReadyPromise, dbInitPromise]).then(([, dbOk]) => {
                if (dbOk === false && !isQuittingAfterBackup && !gracefulShutdownPromise) {
                    const setupFile = path.join(__dirname, 'public', 'server-setup.html');
                    if (fs.existsSync(setupFile) && mainWindow && !mainWindow.isDestroyed()) {
                        log(`[Resilient Startup] BD no disponible tras arranque paralelo; redirigiendo a Asistente de Servidor: ${setupFile}`);
                        mainWindow.loadFile(setupFile);
                    }
                }
            }).catch(() => {});

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
            });

            // AUTO-RELINK diferido 15s tras dbInitPromise y usando solo columnas mínimas
            const relinkTimer = setTimeout(async () => {
                if (isQuittingAfterBackup) return;
                try {
                    if (dbInitPromise) await dbInitPromise;
                    const files = fs.existsSync(imagesPath) ? fs.readdirSync(imagesPath) : [];
                    if (files.length === 0) return;
                    const { Product } = require('./database/models');
                    const { runWithTenantContext } = require('./database/tenantContext');
                    await runWithTenantContext({ companyId: '', userId: 'system-autorelink', isSuperAdmin: true }, async () => {
                        const products = await Product.findAll({
                            where: { imageUri: [null, ''] },
                            attributes: ['id', 'name', 'imageUri'],
                            raw: true
                        });
                        if (products.length > 0) {
                            let count = 0;
                            for (const p of products) {
                                const sanitized = String(p.name || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
                                if (!sanitized) continue;
                                const match = files.find(f => f.startsWith(sanitized));
                                if (match) {
                                    await Product.update({ imageUri: `/product_images/${match}` }, { where: { id: p.id } });
                                    count++;
                                }
                            }
                            if (count > 0) log(`Auto-relink: Successfully linked ${count} products.`);
                        }
                    });
                } catch (relErr) {
                    log(`Warning during auto-relink: ${relErr.message}`);
                }
            }, 15000);
            if (typeof relinkTimer.unref === 'function') relinkTimer.unref();

            // Programar respaldo automático doble en segundo plano cada 4 horas mientras el POS está abierto 24/7
            const autoBackupTimer = setInterval(() => {
                log('Ejecutando respaldo automático doble periódico cada 4 horas en segundo plano...');
                performAutoBackup().catch(e => log(`Error en auto-backup periódico: ${e.message}`));
            }, 4 * 60 * 60 * 1000);
            if (typeof autoBackupTimer.unref === 'function') autoBackupTimer.unref();

            // Verificación automática diferida de actualizaciones a los 10s (solo si existe app-update.yml empaquetado)
            const updTimer = setTimeout(() => {
                if (isQuittingAfterBackup) return;
                const appUpdateYml = path.join(process.resourcesPath || '', 'app-update.yml');
                if (app.isPackaged && !fs.existsSync(appUpdateYml)) {
                    return;
                }
                const updater = typeof global.__getIsaacAutoUpdater === 'function' ? global.__getIsaacAutoUpdater() : null;
                if (updater) {
                    log('Verificación automática de actualizaciones iniciada (10s post-arranque)...');
                    updater.checkForUpdatesAndNotify().catch(e => {
                        log(`Notice auto-update check: ${e.message}`);
                    });
                }
            }, 10000);
            if (typeof updTimer.unref === 'function') updTimer.unref();
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

app.on('before-quit', (event) => {
    if (!isCleanShutdownCompleted) {
        event.preventDefault();
        isQuittingAfterBackup = true;
        performGracefulShutdown().finally(() => {
            app.quit();
        });
    }
});

app.on('window-all-closed', function () {
    log('All windows closed. Terminating process cleanly.');
    if (process.platform !== 'darwin') {
        if (isCleanShutdownCompleted) {
            app.quit();
        } else {
            isQuittingAfterBackup = true;
            performGracefulShutdown().finally(() => {
                app.quit();
            });
        }
    }
});
