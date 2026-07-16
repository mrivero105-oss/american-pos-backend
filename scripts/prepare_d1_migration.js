const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../db.json');
const SETTINGS_FILE = path.join(__dirname, '../settings.json');
const PAYMENT_METHODS_FILE = path.join(__dirname, '../payment_methods.json');
const OUTPUT_FILE = path.join(__dirname, '../init.sql');

function escapeSql(str) {
    return str.replace(/'/g, "''");
}

const dbData = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE, 'utf8') : '{}';
const settingsData = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, 'utf8') : '{}';
const paymentMethodsData = fs.existsSync(PAYMENT_METHODS_FILE) ? fs.readFileSync(PAYMENT_METHODS_FILE, 'utf8') : '[]';

const sql = `
CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT);

INSERT OR REPLACE INTO kv_store (key, value) VALUES ('db', '${escapeSql(dbData)}');
INSERT OR REPLACE INTO kv_store (key, value) VALUES ('settings', '${escapeSql(settingsData)}');
INSERT OR REPLACE INTO kv_store (key, value) VALUES ('payment_methods', '${escapeSql(paymentMethodsData)}');
`;

fs.writeFileSync(OUTPUT_FILE, sql);
console.log('Migration SQL generated at init.sql');
