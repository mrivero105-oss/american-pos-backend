const fs = require('fs');
const path = require('path');

/**
 * Resuelve archivos de distribución móvil (dist.zip, version.json, Isaac-POS-Mobile.apk)
 * tanto en desarrollo como en instalaciones empaquetadas de Electron (donde `app.asar`
 * excluye *.zip y *.apk y los entrega vía `resources/mobile-ota` o overrides en `%APPDATA%`).
 *
 * Orden de prioridad:
 * 1. Override en USER_DATA_PATH/mobile-ota (permite actualizar OTA/APK en caliente sin reinstalar)
 * 2. Override en %APPDATA%/isaac-pos/mobile-ota
 * 3. Recursos empaquetados del instalador: process.resourcesPath/mobile-ota (extraResources)
 * 4. Carpeta public/ junto al ejecutable (instalaciones personalizadas)
 * 5. staticPath y backend/public (desarrollo / web local)
 * 6. dist_installers/ (raíz del monorepo en desarrollo)
 */
function getMobileDistributionCandidates(fileNames, options = {}) {
    const names = Array.isArray(fileNames) ? fileNames : [fileNames];
    const staticPath = options.staticPath || null;
    const baseDir = options.baseDir || path.resolve(__dirname, '..');
    const resourcesPath = options.resourcesPath !== undefined ? options.resourcesPath : process.resourcesPath;
    const userDataPath = options.userDataPath !== undefined ? options.userDataPath : process.env.USER_DATA_PATH;
    const appDataPath = options.appDataPath !== undefined ? options.appDataPath : process.env.APPDATA;
    const execPath = options.execPath !== undefined ? options.execPath : process.execPath;

    const dirs = [
        userDataPath ? path.join(userDataPath, 'mobile-ota') : null,
        appDataPath ? path.join(appDataPath, 'isaac-pos', 'mobile-ota') : null,
        resourcesPath ? path.join(resourcesPath, 'mobile-ota') : null,
        resourcesPath ? path.join(resourcesPath, 'public') : null,
        execPath ? path.join(path.dirname(execPath), 'public') : null,
        staticPath,
        path.join(baseDir, 'public'),
        path.resolve(baseDir, '..', 'dist_installers'),
        path.join(process.cwd(), 'public'),
        path.join(process.cwd(), 'dist_apk')
    ].filter(Boolean);

    const seen = new Set();
    const candidates = [];
    for (const dir of dirs) {
        for (const name of names) {
            const fullPath = path.join(dir, name);
            if (!seen.has(fullPath)) {
                seen.add(fullPath);
                candidates.push(fullPath);
            }
        }
    }
    return candidates;
}

function resolveMobileDistributionFile(fileNames, options = {}) {
    const candidates = getMobileDistributionCandidates(fileNames, options);
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        } catch (_err) {}
    }
    return null;
}

module.exports = {
    getMobileDistributionCandidates,
    resolveMobileDistributionFile
};
