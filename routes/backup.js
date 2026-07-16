const express = require('express');
const router = express.Router();
const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { isAdmin } = require('../middleware/auth');
const { sequelize } = require('../database/connection');

// El directorio de respaldos debe estar en UserData para ser escribible en producción
const backupDir = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'backups')
    : path.join(process.cwd(), 'backups');

if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// Configurar multer para subida manual de respaldos
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, backupDir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            // Asegurar que el nombre pase el check de seguridad (empieza por master_snapshot_ o backup_)
            if (ext === '.zip') {
                cb(null, `master_snapshot_manual_${timestamp}.zip`);
            } else if (ext === '.sqlite') {
                cb(null, `backup_manual_${timestamp}.sqlite`);
            } else {
                cb(null, `backup_manual_${timestamp}${ext}`);
            }
        }
    }),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.zip' || ext === '.sqlite' || ext === '.sql') {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no soportado. Debe ser .zip, .sqlite o .sql'));
        }
    }
});

// Helper to find pg_dump on Windows if not in PATH
const getPgDumpCommand = () => {
    if (process.platform !== 'win32') return 'pg_dump';

    // Check if it's in PATH already
    try {
        require('child_process').execSync('pg_dump --version');
        return 'pg_dump';
    } catch (e) {
        // Not in PATH, check common locations
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
    }
    return 'pg_dump'; // Fallback to raw command
};

// Helper to find psql on Windows if not in PATH
const getPsqlCommand = () => {
    if (process.platform !== 'win32') return 'psql';

    // Check if it's in PATH already
    try {
        require('child_process').execSync('psql --version');
        return 'psql';
    } catch (e) {
        // Not in PATH, check common locations
        const commonPaths = [
            'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
            'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
            'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
            'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
            'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe'
        ];

        for (const p of commonPaths) {
            if (fs.existsSync(p)) return p;
        }
    }
    return 'psql'; // Fallback
};

router.use(isAdmin);

// Ruta para abrir la carpeta de respaldos en el explorador de archivos
router.post('/explore', (req, res) => {
    console.log('[Backup Route] POST /explore triggered');
    try {
        if (process.platform === 'win32') {
            exec(`explorer "${backupDir}"`);
        } else if (process.platform === 'darwin') {
            exec(`open "${backupDir}"`);
        } else {
            exec(`xdg-open "${backupDir}"`);
        }
        res.status(200).json({ success: true, message: 'Carpeta de respaldos abierta.' });
    } catch (error) {
        console.error('Explore backup folder error:', error);
        res.status(500).json({ error: 'No se pudo abrir la carpeta de respaldos.' });
    }
});

// Ruta para subir un respaldo manualmente
router.post('/upload', upload.single('file'), (req, res) => {
    console.log('[Backup Route] POST /upload triggered');
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió ningún archivo.' });
        }
        res.status(200).json({
            success: true,
            message: 'Archivo de respaldo subido exitosamente.',
            file: req.file.filename
        });
    } catch (error) {
        console.error('Backup upload error:', error);
        res.status(500).json({ error: 'Error al subir el archivo de respaldo.' });
    }
});

router.post('/generate', async (req, res) => {
    console.log('[Backup Route] POST /generate triggered');
    try {
        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        
        // Ensure backup directory exists in the specific context of the request
        const currentBackupDir = path.join(userDataPath, 'backups');
        if (!fs.existsSync(currentBackupDir)) {
            console.log(`[Backup Route] Creating missing backup directory: ${currentBackupDir}`);
            fs.mkdirSync(currentBackupDir, { recursive: true });
        }

        if (sequelize.getDialect() === 'postgres') {
            const { createPostgresBackup } = require('../utils/backupHelper');
            const backupPath = await createPostgresBackup();
            const fileName = path.basename(backupPath);
            console.log(`[Backup System] PostgreSQL Backup generated: ${fileName}`);
            return res.status(200).json({
                success: true, 
                message: 'Respaldo PostgreSQL generado exitosamente',
                file: fileName
            });
        } 

        // SQLite / Default Backup - FORCE MASTER SNAPSHOT for manual triggers
        const { createMasterSnapshot } = require('../utils/snapshotHelper');
        const snapshotPath = await createMasterSnapshot(userDataPath);
        const fileName = path.basename(snapshotPath);
        
        console.log(`[Backup System] SQLite Master Snapshot generated successfully: ${fileName}`);
        res.status(200).json({
            success: true,
            message: 'Instantánea Maestra (Base de Datos + Imágenes) generada exitosamente',
            file: fileName
        });

    } catch (error) {
        console.error('Backup generation error:', error.message);
        if (error.stack) console.error(error.stack);
        
        // Detailed debug file in the active user data path
        try {
            const baseLogDir = process.env.USER_DATA_PATH || process.cwd();
            const debugLog = path.join(baseLogDir, 'backup_error_debug.log');
            const logEntry = `[${new Date().toISOString()}] ROUTE_ERROR: ${error.message}\nSTACK: ${error.stack}\n\n`;
            fs.appendFileSync(debugLog, logEntry);
        } catch (e) {}

        res.status(500).json({ 
            error: 'Fallo al generar el respaldo', 
            details: error.message 
        });
    }
});

router.get('/list', (req, res) => {
    console.log('[Backup Route] GET /list triggered');
    try {
        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        const autoBackupDir = path.join(userDataPath, 'auto-backups');
        
        let allFiles = [];
        
        // Scan standard backups
        if (fs.existsSync(backupDir)) {
            const files = fs.readdirSync(backupDir)
                .filter(f => (f.startsWith('backup_') || f.startsWith('master_snapshot_')) && (f.endsWith('.sql') || f.endsWith('.zip') || f.endsWith('.sqlite')))
                .map(f => {
                    const stats = fs.statSync(path.join(backupDir, f));
                    return { name: f, size: stats.size, date: stats.mtime, type: 'manual' };
                });
            allFiles = [...allFiles, ...files];
        }

        // Scan auto-backups (SQLite Atomic)
        if (fs.existsSync(autoBackupDir)) {
            const autoFiles = fs.readdirSync(autoBackupDir)
                .filter(f => f.startsWith('backup_atómico_') && f.endsWith('.sqlite'))
                .map(f => {
                    const stats = fs.statSync(path.join(autoBackupDir, f));
                    return { name: f, size: stats.size, date: stats.mtime, type: 'auto' };
                });
            allFiles = [...allFiles, ...autoFiles];
        }

        res.json({ backups: allFiles.sort((a, b) => b.date - a.date) });
    } catch (error) {
        console.error('List backups error:', error);
        res.status(500).json({ error: 'No se pudo leer el directorio de respaldos.' });
    }
});

router.get('/download/:filename', (req, res) => {
    try {
        const { filename } = req.params;

        // Security check
        const isValid = (filename.startsWith('backup_') || filename.startsWith('master_snapshot_')) && 
                        (filename.endsWith('.sql') || filename.endsWith('.zip') || filename.endsWith('.sqlite')) && 
                        !filename.includes('..');

        if (!isValid) {
            return res.status(403).json({ error: 'Nombre de archivo inválido.' });
        }

        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        const autoBackupDir = path.join(userDataPath, 'auto-backups');
        
        let filePath = path.join(backupDir, filename);
        if (!fs.existsSync(filePath)) {
            filePath = path.join(autoBackupDir, filename);
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'El archivo de respaldo no existe.' });
        }

        res.download(filePath, filename);
    } catch (error) {
        console.error('Download backup error:', error);
        res.status(500).json({ error: 'Fallo al procesar la descarga del respaldo.' });
    }
});

// Ruta para restaurar una copia de seguridad desde una ruta absoluta (seleccionada manualmente)
router.post('/restore-path', async (req, res) => {
    console.log(`[Backup Route] POST /restore-path triggered`);
    try {
        const { filePath } = req.body;

        if (!filePath) {
            return res.status(400).json({ error: 'No se especificó la ruta del archivo.' });
        }

        // Security check: must exist and have valid extension
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.zip' && ext !== '.sqlite' && ext !== '.sql') {
            return res.status(400).json({ error: 'Formato de archivo no soportado. Debe ser .zip, .sqlite o .sql' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'El archivo de respaldo especificado no existe.' });
        }

        const filename = path.basename(filePath);

        if (ext === '.sqlite') {
            // SQLite Atomic Restore (File replacement)
            console.log(`[Backup System] Restoring SQLite Database from path: ${filePath}`);
            const dbPath = sequelize.options.storage;
            
            // 1. Close current connection
            await sequelize.close();
            
            try {
                // 2. Atomic Copy
                fs.copyFileSync(filePath, dbPath);
                console.log('[Backup System] SQLite Restoration successful. Rebooting sequence...');
                
                res.status(200).json({ 
                    success: true, 
                    message: 'Base de datos SQLite restaurada. El servidor se reiniciará para aplicar cambios.' 
                });
                
                setTimeout(() => process.exit(0), 1000);
            } catch (copyErr) {
                console.error('[Backup System] SQLite Copy Error:', copyErr);
                res.status(500).json({ error: 'Fallo crítico al copiar el archivo de base de datos.' });
            }
            return;
        }

        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || '5432';
        const user = process.env.DB_USER || 'postgres';
        const dbName = process.env.DB_NAME || 'americanpos';
        const password = process.env.DB_PASSWORD || '';
        const psql = getPsqlCommand();

        if (ext === '.zip') {
            // Master Snapshot Restore
            console.log('[Backup System] Restoring Master Snapshot (ZIP) from path...');
            const tempExtractPath = path.join(backupDir, 'temp_restore_' + Date.now());
            if (fs.existsSync(tempExtractPath)) fs.rmSync(tempExtractPath, { recursive: true });
            fs.mkdirSync(tempExtractPath);

            console.log('[Backup System] Extracting Master Snapshot with tar...');
            
            execFile('tar', ['-xf', filePath, '-C', tempExtractPath], async (unzipErr) => {
                if (unzipErr) {
                    console.error(`[Backup System] Unzip error: ${unzipErr.message}`);
                    return res.status(500).json({ error: 'Error al descomprimir el snapshot maestro.' });
                }

                try {
                    const extractedFiles = fs.readdirSync(tempExtractPath);
                    const sqlFile = extractedFiles.find(f => f.endsWith('.sql'));
                    const sqliteFile = extractedFiles.find(f => f.endsWith('.sqlite'));
                    let isSqliteRestored = false;

                    // 1. Restore database depending on dialect
                    if (sequelize.getDialect() === 'sqlite' && sqliteFile) {
                        const sqliteTempPath = path.join(tempExtractPath, sqliteFile);
                        const activeDbPath = sequelize.options.storage;
                        console.log(`[Backup System] Restoring SQLite from ZIP: ${sqliteFile} -> ${activeDbPath}`);
                        
                        await sequelize.close();
                        fs.copyFileSync(sqliteTempPath, activeDbPath);
                        isSqliteRestored = true;
                    } else if (sqlFile) {
                        const sqlPath = path.join(tempExtractPath, sqlFile);
                        console.log(`[Backup System] Restoring SQL from ZIP: ${sqlFile}`);
                        
                        await new Promise((resolve, reject) => {
                            execFile(psql, ['-h', host, '-p', port, '-U', user, '-d', dbName, '-f', sqlPath], { env: { ...process.env, PGPASSWORD: password } }, (err) => err ? reject(err) : resolve());
                        });
                    }

                    // 2. Restore media folders
                    const foldersToRestore = ['product_images', 'supplier_logos'];
                    const rootDir = process.cwd();

                    for (const folder of foldersToRestore) {
                        const sourceFolder = path.join(tempExtractPath, folder);
                        const destFolder = path.join(rootDir, folder);
                        
                        if (fs.existsSync(sourceFolder)) {
                            console.log(`[Backup System] Restoring media folder: ${folder}`);
                            await new Promise((resolve) => execFile('robocopy', [sourceFolder, destFolder, '/E', '/MOVE', '/NDL', '/NFL', '/NJH', '/NJS'], () => resolve())); 
                        }
                    }

                    // Cleanup temp
                    fs.rmSync(tempExtractPath, { recursive: true, force: true });
                    
                    console.log(`[Backup System] Master Snapshot restored successfully.`);
                    
                    if (isSqliteRestored) {
                        res.status(200).json({ 
                            success: true, 
                            message: 'Snapshot Maestro restaurado exitosamente. El servidor se reiniciará para aplicar cambios.' 
                        });
                        setTimeout(() => process.exit(0), 1000);
                    } else {
                        res.status(200).json({ 
                            success: true, 
                            message: 'Snapshot Maestro restaurado exitosamente (Base de Datos + Imágenes).' 
                        });
                    }

                } catch (innerErr) {
                    console.error('[Backup System] Restore processing error:', innerErr);
                    res.status(500).json({ error: 'Error procesando los archivos extraídos: ' + innerErr.message });
                }
            });

        } else {
            // Classic SQL Restore
            console.log(`[Backup System] Executing classic SQL restore from path... File: ${filename}`);

            execFile(psql, ['-h', host, '-p', port, '-U', user, '-d', dbName, '-f', filePath], { env: { ...process.env, PGPASSWORD: password } }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[Backup System] psql exec error: ${error.message}`);
                    return res.status(500).json({ error: 'Error al ejecutar herramienta de restauración de Postgres (psql).' });
                }
                
                console.log(`[Backup System] Restore completed successfully: ${filename}`);
                res.status(200).json({ 
                    success: true, 
                    message: 'Base de datos restaurada exitosamente.' 
                });
            });
        }

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Fallo interno al preparar la restauración.' });
    }
});

router.post('/restore/:filename', async (req, res) => {
    console.log(`[Backup Route] POST /restore/${req.params.filename} triggered`);
    try {
        const { filename } = req.params;

        // Security check
        const isValid = (filename.startsWith('backup_') || filename.startsWith('master_snapshot_')) && 
                        (filename.endsWith('.sql') || filename.endsWith('.zip') || filename.endsWith('.sqlite')) && 
                        !filename.includes('..');

        if (!isValid) {
            return res.status(400).json({ error: 'Nombre de archivo inválido.' });
        }

        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        const autoBackupDir = path.join(userDataPath, 'auto-backups');
        
        let filePath = path.join(backupDir, filename);
        if (!fs.existsSync(filePath)) {
            filePath = path.join(autoBackupDir, filename);
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'El archivo de respaldo no existe.' });
        }

        if (filename.endsWith('.sqlite')) {
            // SQLite Atomic Restore (File replacement)
            console.log(`[Backup System] Restoring SQLite Database from: ${filename}`);
            const dbPath = sequelize.options.storage;
            
            // 1. Close current connection
            await sequelize.close();
            
            try {
                // 2. Atomic Copy
                fs.copyFileSync(filePath, dbPath);
                console.log('[Backup System] SQLite Restoration successful. Rebooting sequence...');
                
                // Note: The process might need a restart or the caller will handle reconnection
                res.status(200).json({ 
                    success: true, 
                    message: 'Base de datos SQLite restaurada. El servidor se reiniciará para aplicar cambios.' 
                });
                
                // Graceful exit to allow PM2/Electron to restart the service
                setTimeout(() => process.exit(0), 1000);
            } catch (copyErr) {
                console.error('[Backup System] SQLite Copy Error:', copyErr);
                res.status(500).json({ error: 'Fallo crítico al copiar el archivo de base de datos.' });
            }
            return;
        }

        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || '5432';
        const user = process.env.DB_USER || 'postgres';
        const dbName = process.env.DB_NAME || 'americanpos';
        const password = process.env.DB_PASSWORD || '';
        const psql = getPsqlCommand();

        if (filename.endsWith('.zip')) {
            // Master Snapshot Restore
            console.log('[Backup System] Restoring Master Snapshot (ZIP)...');
            const tempExtractPath = path.join(backupDir, 'temp_restore_' + Date.now());
            if (fs.existsSync(tempExtractPath)) fs.rmSync(tempExtractPath, { recursive: true });
            fs.mkdirSync(tempExtractPath);

            // Unzip using tar (available in modern Windows)
            console.log('[Backup System] Extracting Master Snapshot with tar...');
            
            execFile('tar', ['-xf', filePath, '-C', tempExtractPath], async (unzipErr) => {
                if (unzipErr) {
                    console.error(`[Backup System] Unzip error: ${unzipErr.message}`);
                    return res.status(500).json({ error: 'Error al descomprimir el snapshot maestro.' });
                }

                try {
                    const extractedFiles = fs.readdirSync(tempExtractPath);
                    const sqlFile = extractedFiles.find(f => f.endsWith('.sql'));
                    const sqliteFile = extractedFiles.find(f => f.endsWith('.sqlite'));
                    let isSqliteRestored = false;

                    // 1. Restore database depending on dialect
                    if (sequelize.getDialect() === 'sqlite' && sqliteFile) {
                        const sqliteTempPath = path.join(tempExtractPath, sqliteFile);
                        const activeDbPath = sequelize.options.storage;
                        console.log(`[Backup System] Restoring SQLite from ZIP: ${sqliteFile} -> ${activeDbPath}`);
                        
                        await sequelize.close();
                        fs.copyFileSync(sqliteTempPath, activeDbPath);
                        isSqliteRestored = true;
                    } else if (sqlFile) {
                        const sqlPath = path.join(tempExtractPath, sqlFile);
                        console.log(`[Backup System] Restoring SQL from ZIP: ${sqlFile}`);
                        
                        await new Promise((resolve, reject) => {
                            execFile(psql, ['-h', host, '-p', port, '-U', user, '-d', dbName, '-f', sqlPath], { env: { ...process.env, PGPASSWORD: password } }, (err) => err ? reject(err) : resolve());
                        });
                    }

                    // 2. Restore media folders (product_images, supplier_logos)
                    const foldersToRestore = ['product_images', 'supplier_logos'];
                    const rootDir = process.cwd();

                    for (const folder of foldersToRestore) {
                        const sourceFolder = path.join(tempExtractPath, folder);
                        const destFolder = path.join(rootDir, folder);
                        
                        if (fs.existsSync(sourceFolder)) {
                            console.log(`[Backup System] Restoring media folder: ${folder}`);
                            // Robocopy for reliable folder restoration (move files from temp to dest)
                            await new Promise((resolve) => execFile('robocopy', [sourceFolder, destFolder, '/E', '/MOVE', '/NDL', '/NFL', '/NJH', '/NJS'], () => resolve())); 
                        }
                    }

                    // Cleanup temp
                    fs.rmSync(tempExtractPath, { recursive: true, force: true });
                    
                    console.log(`[Backup System] Master Snapshot restored successfully.`);
                    
                    if (isSqliteRestored) {
                        res.status(200).json({ 
                            success: true, 
                            message: 'Snapshot Maestro restaurado exitosamente. El servidor se reiniciará para aplicar cambios.' 
                        });
                        setTimeout(() => process.exit(0), 1000);
                    } else {
                        res.status(200).json({ 
                            success: true, 
                            message: 'Snapshot Maestro restaurado exitosamente (Base de Datos + Imágenes).' 
                        });
                    }

                } catch (innerErr) {
                    console.error('[Backup System] Restore processing error:', innerErr);
                    res.status(500).json({ error: 'Error procesando los archivos extraídos: ' + innerErr.message });
                }
            });

        } else {
            // Classic SQL Restore
            console.log(`[Backup System] Executing classic SQL restore... File: ${filename}`);

            execFile(psql, ['-h', host, '-p', port, '-U', user, '-d', dbName, '-f', filePath], { env: { ...process.env, PGPASSWORD: password } }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[Backup System] psql exec error: ${error.message}`);
                    return res.status(500).json({ error: 'Error al ejecutar herramienta de restauración de Postgres (psql).' });
                }
                
                console.log(`[Backup System] Restore completed successfully: ${filename}`);
                res.status(200).json({ 
                    success: true, 
                    message: 'Base de datos restaurada exitosamente.' 
                });
            });
        }

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Fallo interno al preparar la restauración.' });
    }
});

router.delete('/:filename', async (req, res) => {
    try {
        const { filename } = req.params;

        // Security check
        const isValid = (filename.startsWith('backup_') || filename.startsWith('master_snapshot_')) && 
                        (filename.endsWith('.sql') || filename.endsWith('.zip') || filename.endsWith('.sqlite')) && 
                        !filename.includes('..');

        if (!isValid) {
            return res.status(403).json({ error: 'Nombre de archivo inválido.' });
        }

        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        const autoBackupDir = path.join(userDataPath, 'auto-backups');
        
        let filePath = path.join(backupDir, filename);
        if (!fs.existsSync(filePath)) {
            filePath = path.join(autoBackupDir, filename);
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'El archivo no existe.' });
        }

        fs.unlinkSync(filePath);
        console.log(`[Backup System] File deleted successfully: ${filename}`);
        
        res.status(200).json({ 
            success: true, 
            message: 'Archivo eliminado correctamente.' 
        });
    } catch (error) {
        console.error('Delete backup error:', error);
        res.status(500).json({ error: 'Fallo al eliminar el archivo.' });
    }
});

module.exports = router;
