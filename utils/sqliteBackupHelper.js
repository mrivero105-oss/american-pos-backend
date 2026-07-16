const path = require('path');
const fs = require('fs');
const { sequelize } = require('../database/connection');

/**
 * Performs an atomic, binary backup of the SQLite database.
 * This is significantly more resilient than JSON exports as it ensures 
 * consistency via SQLite's native snapshot capabilities.
 * 
 * @param {string} userDataPath Path where Electron stores user data.
 * @returns {Promise<string>} Path to the generated .sqlite backup.
 */
async function performSqliteBackup(userDataPath) {
    if (!userDataPath) throw new Error('UserData path not provided');

    const backupsDir = path.join(userDataPath, 'auto-backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    const dbPath = path.join(userDataPath, 'pos_v1.sqlite');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFilename = `backup_atómico_${dateStr}.sqlite`;
    const backupPath = path.join(backupsDir, backupFilename);
    const logFile = path.join(backupsDir, 'backup_history.log');

    const logMsg = (msg) => {
        const entry = `[${new Date().toISOString()}] ${msg}\n`;
        try { fs.appendFileSync(logFile, entry); } catch (e) {}
        console.log(`[BackupService] ${msg}`);
    };

    try {
        logMsg(`Initiating atomic snapshot: ${backupFilename}`);

        // Zero-Day Protection: Check DB Integrity before backing up to prevent copying a corrupted DB
        try {
            const [checkRes] = await sequelize.query('PRAGMA integrity_check;');
            const isOk = checkRes && checkRes.some(r => Object.values(r).includes('ok'));
            if (!isOk) {
                const errMsg = 'CRITICAL ALERTA ROJA: La base de datos falló PRAGMA integrity_check. Respaldo abortado para evitar propagación de corrupción.';
                logMsg(errMsg);
                throw new Error(errMsg);
            }
        } catch (checkErr) {
            if (checkErr.message.includes('CRITICAL ALERTA ROJA')) throw checkErr;
            logMsg(`Warning: integrity check query encountered issues: ${checkErr.message}`);
        }

        // Try Native SQLite Snapshot (VACUUM INTO) - Atomic and consistent
        const tmpBackupPath = `${backupPath}.tmp`;
        const escapedPath = tmpBackupPath.replace(/'/g, "''");
        
        try {
            if (fs.existsSync(tmpBackupPath)) fs.unlinkSync(tmpBackupPath);
            await sequelize.query(`VACUUM INTO '${escapedPath}'`);
            if (fs.existsSync(tmpBackupPath)) {
                fs.renameSync(tmpBackupPath, backupPath);
            }
            logMsg('Success: Native VACUUM INTO completed.');
        } catch (vacuumErr) {
            logMsg(`Warning: VACUUM INTO failed (${vacuumErr.message}). Falling back to stream copy.`);
            // Fallback to stream copy to temporary file followed by atomic rename
            await new Promise((resolve, reject) => {
                const rd = fs.createReadStream(dbPath);
                const wr = fs.createWriteStream(tmpBackupPath);
                rd.on('error', reject);
                wr.on('error', reject);
                wr.on('finish', () => {
                    try {
                        if (fs.existsSync(tmpBackupPath)) fs.renameSync(tmpBackupPath, backupPath);
                        resolve();
                    } catch (renErr) {
                        reject(renErr);
                    }
                });
                rd.pipe(wr);
            });
            logMsg('Success: Stream copy completed.');
        }

        // Clean up using Enterprise GFS (Grandfather-Father-Son) retention scheme
        // Prevents Backup Trap by keeping 10 hourly/recent, 7 daily, and 4 weekly snapshots
        const allBackups = fs.readdirSync(backupsDir)
            .filter(f => f.startsWith('backup_atómico_') && f.endsWith('.sqlite'))
            .map(f => ({
                name: f,
                time: fs.statSync(path.join(backupsDir, f)).mtime.getTime(),
                dateObj: fs.statSync(path.join(backupsDir, f)).mtime
            }))
            .sort((a, b) => b.time - a.time);

        const keepFiles = new Set();

        // 1. Son: Keep 10 most recent snapshots
        allBackups.slice(0, 10).forEach(b => keepFiles.add(b.name));

        // 2. Father: Keep 1 snapshot per day for the last 7 days
        const seenDays = new Set();
        allBackups.forEach(b => {
            const dayKey = b.dateObj.toISOString().slice(0, 10);
            if (seenDays.size < 7 && !seenDays.has(dayKey)) {
                seenDays.add(dayKey);
                keepFiles.add(b.name);
            }
        });

        // 3. Grandfather: Keep 1 snapshot per week for the last 4 weeks
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

        // Delete any file not preserved by GFS
        allBackups.forEach(b => {
            if (!keepFiles.has(b.name)) {
                try { fs.unlinkSync(path.join(backupsDir, b.name)); } catch (e) {}
            }
        });

        return backupPath;
    } catch (err) {
        logMsg(`CRITICAL ERROR: Backup failed: ${err.message}`);
        throw err;
    }
}

module.exports = { performSqliteBackup };
