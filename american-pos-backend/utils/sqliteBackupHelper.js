const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

/**
 * Ejecuta un respaldo atómico de PostgreSQL usando pg_dump.
 * Si pg_dump no está disponible en el sistema, exporta todas las tablas vía Sequelize en formato JSON.
 * Mantiene retención empresarial GFS (10 recientes, 7 diarios, 4 semanales) y réplica en Cloud Mirror.
 *
 * @param {string} userDataPath Ruta de UserData donde almacenar auto-backups.
 * @returns {Promise<string|null>} Ruta al respaldo generado (.sql o .json).
 */
async function performPostgresBackup(userDataPath) {
    if (!userDataPath) throw new Error('UserData path not provided');

    const backupsDir = path.join(userDataPath, 'auto-backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFilename = `backup_pg_${dateStr}.sql`;
    const backupPath = path.join(backupsDir, backupFilename);
    const logFile = path.join(backupsDir, 'backup_history.log');

    const logMsg = (msg) => {
        const entry = `[${new Date().toISOString()}] ${msg}\n`;
        try {
            fs.appendFileSync(logFile, entry);
        } catch (logErr) {
            console.warn('[BackupService-PG] Log write notice:', logErr.message);
        }
        console.log(`[BackupService-PG] ${msg}`);
    };

    try {
        logMsg(`Initiating PostgreSQL backup: ${backupFilename}`);

        let dbName = process.env.DB_NAME || 'americanpos';
        let dbUser = process.env.DB_USER || 'postgres';
        let dbHost = process.env.DB_HOST || '127.0.0.1';
        let dbPort = process.env.DB_PORT || 5432;
        let dbPassword = process.env.DB_PASSWORD || '';

        try {
            const DbConfigManager = require('../config/dbConfigManager');
            const cfg = DbConfigManager ? DbConfigManager.getConfig() : null;
            if (cfg) {
                if (cfg.host) dbHost = cfg.host;
                if (cfg.port) dbPort = cfg.port;
                if (cfg.user) dbUser = cfg.user;
                if (cfg.database) dbName = cfg.database;
                if (cfg.password !== undefined) dbPassword = cfg.password;
            }
        } catch (cfgErr) {
            logMsg(`Notice reading DbConfigManager: ${cfgErr.message}`);
        }

        const commonPaths = [
            'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
            'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
            'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
            'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
            'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe'
        ];
        let pgDumpBin = 'pg_dump';
        for (const p of commonPaths) {
            if (fs.existsSync(p)) {
                pgDumpBin = p;
                break;
            }
        }

        // Ejecutar pg_dump vía execFile parametrizado hacia archivo temporal .tmp y renombrar atómicamente al concluir
        const tmpBackupPath = `${backupPath}.tmp`;
        await new Promise((resolve, reject) => {
            const env = { ...process.env, PGPASSWORD: dbPassword };
            const args = ['-h', String(dbHost), '-p', String(dbPort), '-U', String(dbUser), '-F', 'p', '-b', '-f', tmpBackupPath, String(dbName)];
            execFile(pgDumpBin, args, { env, timeout: 120000 }, (error) => {
                if (error) {
                    logMsg(`pg_dump failed: ${error.message}. Falling back to Sequelize JSON export.`);
                    try {
                        if (fs.existsSync(tmpBackupPath)) fs.unlinkSync(tmpBackupPath);
                        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
                    } catch (_unlinkErr) {
                        // Ignore cleanup error
                    }
                    reject(error);
                } else {
                    try {
                        fs.renameSync(tmpBackupPath, backupPath);
                    } catch (renErr) {
                        return reject(renErr);
                    }
                    logMsg(`pg_dump completed successfully: ${backupPath}`);
                    resolve();
                }
            });
        }).catch(async () => {
            const models = require('../database/models');
            const { runWithTenantContext } = require('../database/tenantContext');
            const exportData = await runWithTenantContext({ companyId: '', userId: 'system-backup', isSuperAdmin: true }, async () => {
                const data = {};
                for (const [name, model] of Object.entries(models)) {
                    if (model && typeof model.findAll === 'function') {
                        try {
                            data[name] = await model.findAll({ raw: true });
                        } catch (modelErr) {
                            logMsg(`Warning exporting table ${name}: ${modelErr.message}`);
                            data[name] = [];
                        }
                    }
                }
                return data;
            });
            const jsonPath = backupPath.replace('.sql', '.json');
            fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
            logMsg(`JSON export completed: ${jsonPath}`);
        });

        // Retención GFS (10 recientes, 7 diarios, 4 semanales)
        const allBackups = fs.readdirSync(backupsDir)
            .filter(f => f.startsWith('backup_pg_') && (f.endsWith('.sql') || f.endsWith('.json')))
            .map(f => ({
                name: f,
                time: fs.statSync(path.join(backupsDir, f)).mtime.getTime(),
                dateObj: fs.statSync(path.join(backupsDir, f)).mtime
            }))
            .sort((a, b) => b.time - a.time);

        const keepFiles = new Set();
        allBackups.slice(0, 10).forEach(b => keepFiles.add(b.name));

        const seenDays = new Set();
        allBackups.forEach(b => {
            const dayKey = b.dateObj.toISOString().slice(0, 10);
            if (seenDays.size < 7 && !seenDays.has(dayKey)) {
                seenDays.add(dayKey);
                keepFiles.add(b.name);
            }
        });

        const seenWeeks = new Set();
        allBackups.forEach(b => {
            const d = new Date(b.time);
            const weekNo = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
            const weekKey = `${d.getFullYear()}-W${weekNo}`;
            if (seenWeeks.size < 4 && !seenWeeks.has(weekKey)) {
                seenWeeks.add(weekKey);
                keepFiles.add(b.name);
            }
        });

        allBackups.forEach(b => {
            if (!keepFiles.has(b.name)) {
                try {
                    fs.unlinkSync(path.join(backupsDir, b.name));
                } catch (delErr) {
                    logMsg(`Notice deleting rotated backup ${b.name}: ${delErr.message}`);
                }
            }
        });

        const finalGeneratedPath = fs.existsSync(backupPath)
            ? backupPath
            : backupPath.replace('.sql', '.json');

        try {
            if (fs.existsSync(finalGeneratedPath)) {
                const cloudMirrorService = require('../services/CloudMirrorService');
                cloudMirrorService.mirrorBackupFile(finalGeneratedPath);
            }
        } catch (mirrorErr) {
            logMsg(`Cloud mirror notice: ${mirrorErr.message}`);
        }

        return finalGeneratedPath;
    } catch (err) {
        logMsg(`WARNING: PostgreSQL backup encountered issues: ${err.message}`);
        return null;
    }
}

// Alias conservado para compatibilidad con invocadores existentes en Electron (main.js)
const performSqliteBackup = performPostgresBackup;

module.exports = {
    performSqliteBackup,
    performPostgresBackup
};
