const path = require('path');
const fs = require('fs');

let BASE_PATH = process.env.USER_DATA_PATH;

if (!BASE_PATH && process.platform === 'win32' && process.env.APPDATA) {
    let appDataPath = path.join(process.env.APPDATA, 'americanpos');
    if (!fs.existsSync(appDataPath)) {
        appDataPath = path.join(process.env.APPDATA, 'american-pos-backend');
        if (!fs.existsSync(appDataPath)) {
            fs.mkdirSync(appDataPath, { recursive: true });
        }
    }
    BASE_PATH = appDataPath;
    console.log('Path Detection: Using Windows AppData path:', BASE_PATH);
}

if (!BASE_PATH) {
    throw new Error('FATAL SECURITY ERROR: DIRECTORIO DE DATOS INACCESIBLE. No se pudo determinar USER_DATA_PATH o APPDATA. El sistema se niega a iniciar en almacenamiento temporal volátil.');
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
