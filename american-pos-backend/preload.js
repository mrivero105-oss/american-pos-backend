const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Hardware ID
    getMachineId: () => ipcRenderer.sendSync('get-machine-id-sync'),
    getStationIdentity: () => ipcRenderer.sendSync('get-station-identity-sync'),
    // Printers
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    printSilent: (content, printerName) => ipcRenderer.invoke('print-silent', content, printerName),
    printRaw: (content, printerName) => ipcRenderer.invoke('print-raw', content, printerName),
    openDrawer: (printerName, sequence) => ipcRenderer.invoke('open-drawer', printerName, sequence),
    // Scale & Serial Hardware
    getScaleWeight: (config) => ipcRenderer.invoke('get-scale-weight', config),
    listSerialPorts: () => ipcRenderer.invoke('list-serial-ports'),
    // Backups
    selectBackupFile: () => ipcRenderer.invoke('select-backup-file'),
    // Auto Launch (Startup)
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
    // About Modal
    onShowAbout: (callback) => {
        const subscription = () => callback();
        ipcRenderer.on('show-about', subscription);
        return () => ipcRenderer.removeListener('show-about', subscription);
    },
    // Updater & App Info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    isWindows7: () => ipcRenderer.invoke('is-windows-7'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdaterEvent: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('updater-event', subscription);
        return () => ipcRenderer.removeListener('updater-event', subscription);
    },
    // Database & Server Network Setup
    getDbConfig: () => ipcRenderer.invoke('get-db-config'),
    testDbConnection: (config) => ipcRenderer.invoke('test-db-connection', config),
    discoverLanServer: (timeoutMs) => ipcRenderer.invoke('discover-lan-server', timeoutMs),
    saveDbConfigAndRestart: (config) => ipcRenderer.invoke('save-db-config-and-restart', config),
    closeApp: () => ipcRenderer.invoke('close-app')
});

