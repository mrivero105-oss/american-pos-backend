const path = require('path');
const fs = require('fs');

let BASE_PATH = process.env.USER_DATA_PATH;

if (!BASE_PATH && process.platform === 'win32') {
    const appDataPath = path.join(process.env.APPDATA, 'american-pos-backend');
    if (fs.existsSync(appDataPath)) {
        BASE_PATH = appDataPath;
        console.log('Path Detection: Using Windows AppData path:', BASE_PATH);
    }
}

if (!BASE_PATH) {
    console.error('CRITICAL ERROR: USER_DATA_PATH not defined and AppData not found. Falling back to temporary directory for safety.');
}

const DB_FILE = BASE_PATH ? path.join(BASE_PATH, 'db.json') : path.join(require('os').tmpdir(), 'pos_emergency_db.json');
const SETTINGS_FILE = BASE_PATH ? path.join(BASE_PATH, 'settings.json') : path.join(require('os').tmpdir(), 'pos_emergency_settings.json');
const PAYMENT_METHODS_FILE = BASE_PATH ? path.join(BASE_PATH, 'payment_methods.json') : path.join(require('os').tmpdir(), 'pos_emergency_methods.json');

module.exports = {
    BASE_PATH,
    DB_FILE,
    SETTINGS_FILE,
    PAYMENT_METHODS_FILE
};
