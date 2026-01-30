const path = require('path');
const fs = require('fs');

const BASE_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
const DB_FILE = path.join(BASE_PATH, 'db.json');
const SETTINGS_FILE = path.join(BASE_PATH, 'settings.json');
const PAYMENT_METHODS_FILE = path.join(BASE_PATH, 'payment_methods.json');

module.exports = {
    BASE_PATH,
    DB_FILE,
    SETTINGS_FILE,
    PAYMENT_METHODS_FILE
};
