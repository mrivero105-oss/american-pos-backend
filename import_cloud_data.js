const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'database', 'pos.sqlite');
const SQL_FILE = path.join(__dirname, 'cloud_export.sql');

if (fs.existsSync(DB_PATH)) {
    console.log('Existing pos.sqlite found. Removing it...');
    fs.unlinkSync(DB_PATH);
}

console.log('Creating new database...');
const db = new sqlite3.Database(DB_PATH);

console.log('Reading SQL file...');
const sql = fs.readFileSync(SQL_FILE, 'utf8');

db.serialize(() => {
    // Cloudflare exports usually use transaction statements, 
    // but enabling strict foreign key constraints is good practice.
    db.run("PRAGMA foreign_keys = OFF;");

    // Execute the big chunk. sqlite3 exec can handle multiple statements.
    db.exec(sql, (err) => {
        if (err) {
            console.error('Error executing SQL:', err);
            process.exit(1);
        } else {
            console.log('Import successful!');
            db.close();
        }
    });
});
