const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Printers
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    printSilent: (content, printerName) => ipcRenderer.invoke('print-silent', content, printerName),
    printRaw: (content, printerName) => ipcRenderer.invoke('print-raw', content, printerName),
    openDrawer: (printerName, sequence) => ipcRenderer.invoke('open-drawer', printerName, sequence),
    // Scale (Future)
    getScaleWeight: () => ipcRenderer.invoke('get-scale-weight'),
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
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdaterEvent: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('updater-event', subscription);
        return () => ipcRenderer.removeListener('updater-event', subscription);
    }
});
