const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Path to pg_dump.exe identified during planning
// Help to find pg_dump on Windows if not in PATH
const getPgDumpPath = () => {
    const commonPaths = [
        'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe'
    ];

    for (const p of commonPaths) {
        if (fs.existsSync(p)) return p;
    }
    return 'pg_dump'; // Fallback to system PATH
};

const PG_DUMP_PATH = getPgDumpPath();

/**
 * Creates a "Master Snapshot" (.zip) containing the SQL dump and media folders
 * @returns {Promise<string>} Path to the generated ZIP file
 */
async function createPostgresBackup() {
    return new Promise(async (resolve, reject) => {
        const baseDir = process.env.USER_DATA_PATH || process.cwd();
        const backupDir = path.join(baseDir, 'backups');

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sqlFileName = `db_dump_${timestamp}.sql`;
        const sqlPath = path.join(backupDir, sqlFileName);
        const zipFileName = `master_snapshot_${timestamp}.zip`;
        const zipPath = path.join(backupDir, zipFileName);

        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || '5432';
        const user = process.env.DB_USER || 'postgres';
        const dbName = process.env.DB_NAME || 'americanpos';
        const password = process.env.DB_PASSWORD || '';

        const logMsg = (msg) => {
            console.log(`[Backup System] ${msg}`);
            try {
                fs.appendFileSync(path.join(baseDir, 'backup_debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
            } catch (e) { }
        };

        logMsg(`Iniciando respaldo en ${backupDir}`);

        // Construct command with relative output file and cd
        const dumpCommand = `"${PG_DUMP_PATH}" -h "${host}" -p "${port}" -U "${user}" -d "${dbName}" -F p -f "${sqlFileName}"`;

        // We set PGPASSWORD on the current process so the child inherits the FULL environment
        // This fixes the "spawn ENOENT" issue on Windows caused by missing SystemRoot/PATH
        const originalPgPassword = process.env.PGPASSWORD;
        process.env.PGPASSWORD = password;

        exec(dumpCommand, { cwd: backupDir }, (error, stdout, stderr) => {
            // Restore original password
            process.env.PGPASSWORD = originalPgPassword;

            if (error) {
                const errMsg = stderr || error.message;
                logMsg(`SQL Dump error: ${errMsg}`);
                try {
                    fs.appendFileSync(path.join(baseDir, 'backup_error_debug.log'), `[${new Date().toISOString()}] (Postgres) ERROR: ${errMsg}\n`);
                } catch (e) { }
                return reject(new Error(`Error en pg_dump: ${errMsg}`));
            }

            logMsg(`SQL Dump generado. Comprimiendo...`);

            // Use tar available in Windows 10+
            let components = [`"${sqlFileName}"`];
            if (fs.existsSync(path.join(baseDir, 'product_images'))) {
                components.push(`"../product_images"`);
            }
            if (fs.existsSync(path.join(baseDir, 'supplier_logos'))) {
                components.push(`"../supplier_logos"`);
            }

            const zipCommand = `tar -ac -f "${zipFileName}" ${components.join(' ')}`;
            
            exec(zipCommand, { cwd: backupDir }, (zipError) => {
                // Cleanup SQL
                try { if (fs.existsSync(sqlPath)) fs.unlinkSync(sqlPath); } catch (e) {}

                if (zipError) {
                    logMsg(`Compression error: ${zipError.message}`);
                    return reject(zipError);
                }

                logMsg(`Respaldo completado: ${zipPath}`);
                resolve(zipPath);
            });
        });
    });
}

module.exports = { createPostgresBackup };
