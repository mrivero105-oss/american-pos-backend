const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const logFile = path.join(app.getPath('desktop'), 'pos_startup_log.txt');

function log(message) {
    try {
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch (e) {
        // Fallback
    }
}

log(`Starting main.js execution. UserData: ${app.getPath('userData')}`);

// const { startServer } = require('./index.js'); // Moved to whenReady


let mainWindow;

function createWindow(serverPort) {
    log('Entering createWindow function...');
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'public/assets/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        autoHideMenuBar: true,
        show: true // Force show
    });

    // Cargar la app desde el servidor local usando el puerto dinámico
    const portToUse = serverPort || 3000;
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
        log('Renderer process CRASHED.');
    });

    mainWindow.on('ready-to-show', () => {
        log('Window ready-to-show event fired.');
        mainWindow.show();
    });

    mainWindow.on('closed', function () {
        log('Window closed.');
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // 1. Obtener ruta de datos persistente de Electron
    const userDataPath = app.getPath('userData');
    console.log('Ruta de datos de usuario:', userDataPath);
    process.env.USER_DATA_PATH = userDataPath;
    log('Set USER_DATA_PATH env var.');

    try {
        log('Attempting to require ./index.js');
        // 2. Iniciar el servidor Express (require here to ensure env var is set)
        const { startServer } = require('./index.js');
        log('./index.js requires successfully.');

        startServer(3000, userDataPath).then(({ port }) => {
            log(`Servidor iniciado en puerto: ${port}`);
            createWindow(port);
        }).catch(err => {
            log(`Error al iniciar el servidor: ${err.message}\n${err.stack}`);
            console.error('Error al iniciar el servidor:', err);
            app.quit();
        });
    } catch (error) {
        log(`CRITICAL ERROR during startup: ${error.message}\n${error.stack}`);
        dialog.showErrorBox('Error de Inicio', `Error crítico:\n${error.message}`);
        app.quit();
    }

    // 3. Crear la ventana (Manejado dentro de startServer callback arriba)
    // createWindow();

    app.on('activate', function () {
        if (mainWindow === null) createWindow(3000); // Fallback port reuse if activated from dock, though uncommon in current flow
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
