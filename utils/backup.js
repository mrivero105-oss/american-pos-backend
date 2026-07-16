const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

/**
 * Creates a backup of the current database file.
 * Keeps only the last 7 backups to save space.
 * @param {string} sourcePath - Absolute path to the source database file.
 */
async function createDatabaseBackup(sourcePath) {
    try {
        if (!fs.existsSync(sourcePath)) {
            console.warn('[Backup] Source database not found, skipping backup:', sourcePath);
            return;
        }

        // 1. Ensure backup directory exists
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }

        // 2. Create timestamped backup file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupFileName = `backup_pos_v1_${timestamp}.sqlite`;
        const destPath = path.join(BACKUP_DIR, backupFileName);

        // 3. Copy file
        fs.copyFileSync(sourcePath, destPath);
        console.log(`[Backup] Created successfully: ${backupFileName}`);

        // 4. Rotate backups (Keep last 7)
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup_pos_v1_'))
            .sort((a, b) => {
                // Sort by name (which contains ISO timestamp) descending
                return b.localeCompare(a);
            });

        if (files.length > 7) {
            const filesToDelete = files.slice(7);
            filesToDelete.forEach(f => {
                fs.unlinkSync(path.join(BACKUP_DIR, f));
                console.log(`[Backup] Rotated: Deleted old backup ${f}`);
            });
        }
    } catch (error) {
        console.error('[Backup] FATAL Error creating backup:', error.message);
    }
}

module.exports = { createDatabaseBackup };
