const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Creates a "Master Snapshot" (.zip) for SQLite
 * containing the .sqlite database, product_images, and supplier_logos.
 * @param {string} userDataPath Path where Electron stores user data.
 * @returns {Promise<string>} Path to the generated ZIP file
 */
async function createMasterSnapshot(userDataPath) {
    return new Promise(async (resolve, reject) => {
        if (!userDataPath) {
            userDataPath = process.env.USER_DATA_PATH || process.cwd();
        }
        
        const backupDir = path.join(userDataPath, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipFileName = `master_snapshot_${timestamp}.zip`;
        const zipPath = path.join(backupDir, zipFileName);
        // Correct path for local development context
        const { sequelize } = require('../database/connection');
        const dbPath = sequelize.options.storage;

        const logMsg = (msg) => {
            console.log(`[Snapshot System] ${msg}`);
        };

        logMsg(`Iniciando Instantánea Maestra en ${backupDir}`);

        // We will use 'tar' which is available in Windows 10+
        // Components to include
        let components = [];
        
        // 1. Database (Make a temporary copy to avoid locking issues)
        const tempDbPath = path.join(userDataPath, 'pos_v1_backup.sqlite');
        try {
            fs.copyFileSync(dbPath, tempDbPath);
            components.push('"pos_v1_backup.sqlite"');
        } catch (e) {
            logMsg(`Warning: Could not copy database: ${e.message}`);
        }

        // 2. Images
        if (fs.existsSync(path.join(userDataPath, 'product_images'))) {
            components.push('"product_images"');
        }
        if (fs.existsSync(path.join(userDataPath, 'supplier_logos'))) {
            components.push('"supplier_logos"');
        }

        if (components.length === 0) {
            return reject(new Error('No hay componentes para respaldar.'));
        }

        const zipCommand = `tar -ac -f "backups/${zipFileName}" -C "${userDataPath}" ${components.join(' ')}`;
        
        exec(zipCommand, { cwd: userDataPath }, (zipError) => {
            // Cleanup temp DB
            try { if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath); } catch (e) {}

            if (zipError) {
                logMsg(`Compression error: ${zipError.message}`);
                return reject(zipError);
            }

            // Cleanup: Keep only last 5 master snapshots
            const allSnapshots = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('master_snapshot_') && f.endsWith('.zip'))
                .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
                .sort((a, b) => b.time - a.time);

            if (allSnapshots.length > 5) {
                allSnapshots.slice(5).forEach(f => {
                    try { fs.unlinkSync(path.join(backupDir, f.name)); } catch (e) {}
                });
            }

            logMsg(`Instantánea Maestra completada: ${zipPath}`);
            resolve(zipPath);
        });
    });
}

module.exports = { createMasterSnapshot };
