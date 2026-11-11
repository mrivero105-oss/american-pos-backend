const path = require('path');
const fs = require('fs');
const os = require('os');

let BASE_PATH = process.env.USER_DATA_PATH ? process.env.USER_DATA_PATH.trim().replace(/^["']|["']$/g, '') : null;


if (!BASE_PATH) {
    if (process.platform === 'win32' && process.env.APPDATA) {
        let appDataPath = path.join(process.env.APPDATA, 'isaac-pos');
        if (!fs.existsSync(appDataPath)) {
            if (fs.existsSync(path.join(process.env.APPDATA, 'Isaac POS'))) {
                appDataPath = path.join(process.env.APPDATA, 'Isaac POS');
            } else if (fs.existsSync(path.join(process.env.APPDATA, 'isaacpos'))) {
                appDataPath = path.join(process.env.APPDATA, 'isaacpos');
            } else if (fs.existsSync(path.join(process.env.APPDATA, 'americanpos'))) {
                appDataPath = path.join(process.env.APPDATA, 'americanpos');
            } else if (fs.existsSync(path.join(process.env.APPDATA, 'american-pos-backend'))) {
                appDataPath = path.join(process.env.APPDATA, 'american-pos-backend');
            } else {
                fs.mkdirSync(appDataPath, { recursive: true });
            }
        }
        BASE_PATH = appDataPath;
        console.log('Path Detection: Using Windows AppData path:', BASE_PATH);
    } else {
        // Fallback automático para Linux / Render / MacOS / Cloud
        const baseDir = os.homedir() || '/tmp';
        let cloudPath = path.join(baseDir, '.isaac-pos');
        if (!fs.existsSync(cloudPath) && fs.existsSync(path.join(baseDir, '.americanpos'))) {
            cloudPath = path.join(baseDir, '.americanpos');
        }
        BASE_PATH = cloudPath;
        console.log('Path Detection: Using Linux/Cloud POS Data path:', BASE_PATH);
    }
}

try {
    if (!fs.existsSync(BASE_PATH)) {
        fs.mkdirSync(BASE_PATH, { recursive: true });
    }
} catch (e) {
    throw new Error(`FATAL SECURITY ERROR: No se pudo crear o acceder al directorio permanente BASE_PATH (${BASE_PATH}): ${e.message}`);
}

const DB_FILE = path.join(BASE_PATH, 'db.json');
const SETTINGS_FILE = path.join(BASE_PATH, 'settings.json');
const PAYMENT_METHODS_FILE = path.join(BASE_PATH, 'payment_methods.json');

module.exports = {
    BASE_PATH,
    DB_FILE,
    SETTINGS_FILE,
    PAYMENT_METHODS_FILE
};
