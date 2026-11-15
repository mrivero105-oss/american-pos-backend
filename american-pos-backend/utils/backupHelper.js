const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { BASE_PATH, SETTINGS_FILE, PAYMENT_METHODS_FILE } = require('../config/paths');
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
        const baseDir = process.env.USER_DATA_PATH || BASE_PATH || process.cwd();
        const backupDir = path.join(baseDir, 'backups');

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sqlFileName = `db_dump_${timestamp}.sql`;
        const sqlPath = path.join(backupDir, sqlFileName);
        const zipFileName = `master_snapshot_${timestamp}.zip`;
        const zipPath = path.join(backupDir, zipFileName);

        let host = process.env.DB_HOST || '127.0.0.1';
        let port = process.env.DB_PORT || '5432';
        let user = process.env.DB_USER || 'postgres';
        let dbName = process.env.DB_NAME || 'americanpos';
        let password = process.env.DB_PASSWORD || '';

        try {
            const DbConfigManager = require('../config/dbConfigManager');
            const cfg = DbConfigManager ? DbConfigManager.getConfig() : null;
            if (cfg) {
                if (cfg.host) host = cfg.host;
                if (cfg.port) port = String(cfg.port);
                if (cfg.user) user = cfg.user;
                if (cfg.database) dbName = cfg.database;
                if (cfg.password !== undefined) password = cfg.password;
            }
        } catch (_cfgErr) {}

        const logMsg = (msg) => {
            console.log(`[Backup System] ${msg}`);
            try {
                fs.appendFileSync(path.join(baseDir, 'backup_debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
            } catch (e) { }
        };

        logMsg(`Iniciando respaldo en ${backupDir}`);

        const dumpArgs = ['-h', String(host), '-p', String(port), '-U', String(user), '-d', String(dbName), '-F', 'p', '-f', sqlFileName];
        const childEnv = { ...process.env, PGPASSWORD: password };

        execFile(PG_DUMP_PATH, dumpArgs, { cwd: backupDir, env: childEnv }, (error, stdout, stderr) => {
            if (error) {
                const errMsg = stderr || error.message;
                logMsg(`SQL Dump error: ${errMsg}`);
                try {
                    fs.appendFileSync(path.join(baseDir, 'backup_error_debug.log'), `[${new Date().toISOString()}] (Postgres) ERROR: ${errMsg}\n`);
                } catch (e) { }
                return reject(new Error(`Error en pg_dump: ${errMsg}`));
            }

            logMsg(`SQL Dump generado. Comprimiendo...`);

            // Copiar temporalmente archivos de configuración para incluirlos limpiamente en la raíz del ZIP
            const tempSettingsInBackup = path.join(backupDir, 'settings.json');
            const tempPaymentsInBackup = path.join(backupDir, 'payment_methods.json');
            let hasSettings = false;
            let hasPayments = false;

            try {
                if (SETTINGS_FILE && fs.existsSync(SETTINGS_FILE)) {
                    fs.copyFileSync(SETTINGS_FILE, tempSettingsInBackup);
                    hasSettings = true;
                }
                if (PAYMENT_METHODS_FILE && fs.existsSync(PAYMENT_METHODS_FILE)) {
                    fs.copyFileSync(PAYMENT_METHODS_FILE, tempPaymentsInBackup);
                    hasPayments = true;
                }
            } catch (copyErr) {
                console.warn('[Backup System] Aviso copiando settings al respaldo:', copyErr.message);
            }

            // Use tar available in Windows 10+ via parameterized execFile
            const tarArgs = ['-ac', '-f', zipFileName, sqlFileName];
            if (hasSettings) {
                tarArgs.push('settings.json');
            }
            if (hasPayments) {
                tarArgs.push('payment_methods.json');
            }
            if (fs.existsSync(path.join(baseDir, 'product_images'))) {
                tarArgs.push('../product_images');
            }
            if (fs.existsSync(path.join(baseDir, 'supplier_logos'))) {
                tarArgs.push('../supplier_logos');
            }
            if (fs.existsSync(path.join(baseDir, 'invoices'))) {
                tarArgs.push('../invoices');
            }

            execFile('tar', tarArgs, { cwd: backupDir }, (zipError) => {
                // Cleanup temporary uncompressed SQL file and config copies
                try { if (fs.existsSync(sqlPath)) fs.unlinkSync(sqlPath); } catch (e) {}
                try { if (hasSettings && fs.existsSync(tempSettingsInBackup)) fs.unlinkSync(tempSettingsInBackup); } catch (e) {}
                try { if (hasPayments && fs.existsSync(tempPaymentsInBackup)) fs.unlinkSync(tempPaymentsInBackup); } catch (e) {}

                if (zipError) {
                    logMsg(`Compression error: ${zipError.message}`);
                    return reject(zipError);
                }

                // Automatic rotation: keep 10 latest snapshots to protect disk space
                try {
                    cleanupOldBackups(backupDir, 10);
                } catch (rotErr) {
                    console.warn('[Backup System] Warning during backup rotation:', rotErr.message);
                }

                // Replicar automáticamente a Carpeta Espejo Cloud (Google Drive / OneDrive / MEGA / Local)
                try {
                    const cloudMirrorService = require('../services/CloudMirrorService');
                    const mirrorRes = cloudMirrorService.mirrorBackupFile(zipPath);
                    if (mirrorRes && mirrorRes.targetPath) {
                        logMsg(`✅ Copia sincronizada en carpeta espejo: ${mirrorRes.targetPath}`);
                    }
                } catch (copyErr) {
                    console.warn('[Backup System] Aviso al replicar a carpeta espejo Cloud:', copyErr.message);
                }

                logMsg(`Respaldo completado: ${zipPath}`);
                resolve(zipPath);
            });
        });
    });
}

/**
 * Retains only the newest N backups and removes older files
 */
function cleanupOldBackups(backupDir, keepCount = 10) {
    if (!fs.existsSync(backupDir)) return;
    const files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.zip') || f.endsWith('.sql') || f.endsWith('.json') || f.endsWith('.enc'))
        .map(f => ({
            name: f,
            path: path.join(backupDir, f),
            time: fs.statSync(path.join(backupDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

    if (files.length > keepCount) {
        const toDelete = files.slice(keepCount);
        toDelete.forEach(f => {
            try {
                fs.unlinkSync(f.path);
                console.log(`[Backup System] Purgado respaldo antiguo: ${f.name}`);
            } catch (e) {}
        });
    }
}

/**
 * Non-blocking automatic backup triggered on shift closing
 */
function autoBackupOnShiftClose(shiftId) {
    if (process.env.ISAAC_TEST_ISOLATED === '1' || process.env.NODE_ENV === 'test' || process.env.DISABLE_BACKGROUND_WORKERS === 'true') {
        return;
    }
    const timer = setTimeout(async () => {
        try {
            console.log(`[Backup System] 🛡️ Disparando auto-respaldo de cierre para turno: ${shiftId}`);
            const zipPath = await createPostgresBackup();
            console.log(`[Backup System] ✅ Auto-respaldo de cierre guardado: ${path.basename(zipPath)}`);
        } catch (err) {
            console.warn(`[Backup System] ⚠️ Error no fatal en auto-respaldo de cierre:`, err.message);
        }
    }, 2000); // 2 second delay so closing response completes immediately
    if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { 
    createPostgresBackup,
    cleanupOldBackups,
    autoBackupOnShiftClose
};
