const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
const OUTPUT_FILE = path.join(__dirname, 'update_kv.sql');

if (!fs.existsSync(DB_FILE)) {
    console.error('db.json not found!');
    process.exit(1);
}

const dbContent = fs.readFileSync(DB_FILE, 'utf8');
const minifiedContent = JSON.stringify(JSON.parse(dbContent));
// Escape single quotes for SQL
const escapedContent = minifiedContent.replace(/'/g, "''");

const sql = `INSERT OR REPLACE INTO kv_store (key, value) VALUES ('db', '${escapedContent}');`;

fs.writeFileSync(OUTPUT_FILE, sql);
console.log(`Generated ${OUTPUT_FILE} with size ${(sql.length / 1024).toFixed(2)} KB`);
