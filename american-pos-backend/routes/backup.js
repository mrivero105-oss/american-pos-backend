const express = require('express');
const router = express.Router();
const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requirePermission } = require('../middleware/auth');
const { sequelize } = require('../database/connection');

// El directorio de respaldos debe estar en UserData para ser escribible en producción
const backupDir = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'backups')
    : path.join(process.cwd(), 'backups');

if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// Obtiene credenciales activas de PostgreSQL desde DbConfigManager con respaldo a variables de entorno
const getActivePgConnectionParams = () => {
    let host = process.env.DB_HOST || '127.0.0.1';
    let port = String(process.env.DB_PORT || '5432');
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
    } catch (_cfgErr) {
        // Fallback a variables de entorno ya asignadas
    }

    return { host, port, user, dbName, password };
};

// Configurar multer para subida manual de respaldos PostgreSQL
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, backupDir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            if (ext === '.zip') {
                cb(null, `master_snapshot_manual_${timestamp}.zip`);
            } else {
                cb(null, `backup_manual_${timestamp}${ext}`);
            }
        }
    }),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.zip' || ext === '.sql' || ext === '.json' || ext === '.enc') {
            cb(null, true);
        } else {
            cb(new Error('Formato no soportado. El sistema opera exclusivamente con respaldos PostgreSQL (.zip, .sql, .json o .enc).'));
        }
    }
});

// Validación centralizada de nombres de archivo de respaldo soportados por la bóveda PostgreSQL
const isValidBackupFilename = (filename) => {
    if (!filename || typeof filename !== 'string' || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return false;
    }
    const validPrefix = filename.startsWith('backup_') || filename.startsWith('backup_atómico_') || filename.startsWith('master_snapshot_');
    const validExt = filename.endsWith('.sql') || filename.endsWith('.zip') || filename.endsWith('.json') || filename.endsWith('.enc');
    return validPrefix && validExt;
};

// Localiza todas las rutas donde existe una copia del archivo de respaldo
const resolveBackupPaths = (filename) => {
    const userDataPath = process.env.USER_DATA_PATH || process.cwd();
    const autoBackupDir = path.join(userDataPath, 'auto-backups');
    const candidates = [
        path.join(backupDir, filename),
        path.join(autoBackupDir, filename)
    ];
    try {
        const cloudMirrorService = require('../services/CloudMirrorService');
        const mirrorCfg = cloudMirrorService.getConfig();
        if (mirrorCfg?.mirrorPath) {
            candidates.push(path.join(mirrorCfg.mirrorPath, filename));
        }
    } catch (_mirrorErr) {
        // Ignore if CloudMirrorService is unavailable
    }
    if (process.platform === 'win32') {
        candidates.push(path.join('C:\\IsaacPOS_Respaldos', filename));
    }
    return [...new Set(candidates)].filter(p => fs.existsSync(p));
};

// Restaura un respaldo en formato JSON exportado por Sequelize (backup_pg_*.json)
const restoreSequelizeJsonBackup = async (jsonFilePath) => {
    const rawContent = fs.readFileSync(jsonFilePath, 'utf8');
    const parsedData = JSON.parse(rawContent);
    if (!parsedData || typeof parsedData !== 'object') {
        throw new Error('El archivo JSON de respaldo no contiene una estructura válida.');
    }

    const models = require('../database/models');
    let totalRestored = 0;

    await sequelize.transaction(async (t) => {
        for (const [modelName, rows] of Object.entries(parsedData)) {
            const model = models[modelName];
            if (model && typeof model.bulkCreate === 'function' && Array.isArray(rows) && rows.length > 0) {
                const updateFields = Object.keys(model.rawAttributes || {}).filter(k => k !== 'id');
                await model.bulkCreate(rows, {
                    transaction: t,
                    ...(updateFields.length > 0 ? { updateOnDuplicate: updateFields } : { ignoreDuplicates: true })
                });
                totalRestored += rows.length;
            }
        }
    });

    return totalRestored;
};

// Helper to find psql on Windows if not in PATH
const getPsqlCommand = () => {
    if (process.platform !== 'win32') return 'psql';

    try {
        require('child_process').execSync('psql --version', { stdio: 'ignore' });
        return 'psql';
    } catch (_e) {
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
    return 'psql';
};

// Helper to extract ZIP archive using tar with pure JS fallback
const performZipExtraction = (zipFilePath, targetDir, callback) => {
    const { extractZipArchive } = require('../utils/snapshotHelper');
    execFile('tar', ['-xf', zipFilePath, '-C', targetDir], (unzipErr) => {
        if (unzipErr) {
            console.log(`[Backup System] tar extraction unavailable (${unzipErr.message}). Using Pure JS ZIP Extractor...`);
            try {
                extractZipArchive(zipFilePath, targetDir);
                return callback(null);
            } catch (jsErr) {
                console.error(`[Backup System] Pure JS Zip Extractor error: ${jsErr.message}`);
                return callback(jsErr);
            }
        }
        return callback(null);
    });
};

// Restaura el contenido descomprimido de un Master Snapshot (.zip) en PostgreSQL + carpetas multimedia
const restoreExtractedSnapshotDir = async (tempExtractPath, mediaRootDir) => {
    const extractedFiles = fs.readdirSync(tempExtractPath);
    const sqlFile = extractedFiles.find(f => f.endsWith('.sql'));
    const jsonFile = extractedFiles.find(f => f.endsWith('.json'));
    const sqliteFile = extractedFiles.find(f => f.endsWith('.sqlite'));

    if (!sqlFile && !jsonFile && sqliteFile) {
        throw new Error('Esta instantánea contiene únicamente un archivo legado .sqlite y no un volcado PostgreSQL (.sql/.json).');
    }

    if (sqlFile) {
        const sqlPath = path.join(tempExtractPath, sqlFile);
        const { host, port, user, dbName, password } = getActivePgConnectionParams();
        const psql = getPsqlCommand();
        console.log(`[Backup System] Restoring SQL from ZIP: ${sqlFile}`);

        await new Promise((resolve, reject) => {
            execFile(
                psql,
                ['-h', host, '-p', port, '-U', user, '-d', dbName, '-f', sqlPath],
                { env: { ...process.env, PGPASSWORD: password } },
                (err) => (err ? reject(err) : resolve())
            );
        });
    } else if (jsonFile) {
        const jsonPath = path.join(tempExtractPath, jsonFile);
        console.log(`[Backup System] Restoring JSON dump from ZIP: ${jsonFile}`);
        await restoreSequelizeJsonBackup(jsonPath);
    }

    const foldersToRestore = ['product_images', 'supplier_logos', 'invoices'];
    for (const folder of foldersToRestore) {
        const sourceFolder = path.join(tempExtractPath, folder);
        const destFolder = path.join(mediaRootDir, folder);

        if (fs.existsSync(sourceFolder)) {
            console.log(`[Backup System] Restoring media folder: ${folder}`);
            if (process.platform === 'win32') {
                await new Promise((resolve) =>
                    execFile('robocopy', [sourceFolder, destFolder, '/E', '/MOVE', '/NDL', '/NFL', '/NJH', '/NJS'], () => resolve())
                );
            } else {
                fs.cpSync(sourceFolder, destFolder, { recursive: true });
            }
        }
    }

    const configFilesToRestore = ['settings.json', 'payment_methods.json'];
    for (const file of configFilesToRestore) {
        const sourceFile = path.join(tempExtractPath, file);
        const destFile = path.join(mediaRootDir, file);
        if (fs.existsSync(sourceFile)) {
            console.log(`[Backup System] Restoring config file: ${file}`);
            fs.copyFileSync(sourceFile, destFile);
        }
    }
    try {
        const cache = require('../utils/cacheService');
        if (cache && typeof cache.del === 'function') cache.del('all_settings');
    } catch (_cErr) {}
};

router.use(requirePermission('canManageSettings'));

const getAllowedBackupRoots = () => {
    const os = require('os');
    const userDataPath = process.env.USER_DATA_PATH || path.join(__dirname, '..');
    const roots = [
        backupDir,
        path.join(userDataPath, 'auto-backups'),
        path.join(userDataPath, 'backups'),
        'C:\\IsaacPOS_Respaldos',
        path.join(os.homedir(), 'Documents', 'IsaacPOS_Backups')
    ];
    try {
        const cloudMirrorService = require('../services/CloudMirrorService');
        const mirrorCfg = cloudMirrorService.getConfig();
        if (mirrorCfg?.mirrorPath) roots.push(mirrorCfg.mirrorPath);
    } catch (_) {}
    return roots.filter(Boolean).map(r => path.resolve(r));
};

const isPathInsideRoots = (candidatePath, roots, allowExactRoot = false) => {
    if (typeof candidatePath !== 'string' || !candidatePath.trim() || candidatePath.includes('\0')) return false;
    const resolved = path.resolve(candidatePath.trim());
    return roots.some((root) => {
        const left = process.platform === 'win32' ? root.toLowerCase() : root;
        const right = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        const rel = path.relative(left, right);
        if (allowExactRoot && rel === '') return true;
        return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
};

// Ruta para abrir la carpeta de respaldos en el explorador de archivos
router.post('/explore', (req, res) => {
    console.log('[Backup Route] POST /explore triggered');
    try {
        const cloudMirrorService = require('../services/CloudMirrorService');
        const mirrorCfg = cloudMirrorService.getConfig();
        const allowedRoots = getAllowedBackupRoots();
        const requestedDir = req.body?.customPath;
        if (requestedDir && !isPathInsideRoots(requestedDir, allowedRoots, true)) {
            return res.status(403).json({ error: 'Directorio fuera de las carpetas de respaldo autorizadas.' });
        }
        const customDir = requestedDir ? path.resolve(String(requestedDir)) : (mirrorCfg?.mirrorPath || 'C:\\IsaacPOS_Respaldos');

        if (process.platform === 'win32') {
            if (!fs.existsSync(customDir)) {
                try {
                    fs.mkdirSync(customDir, { recursive: true });
                } catch (_mkdirErr) {
                    // Fallback to backupDir below
                }
            }
            const targetDir = fs.existsSync(customDir) ? customDir : backupDir;
            execFile('explorer.exe', [targetDir]);
        } else if (process.platform === 'darwin') {
            execFile('open', [backupDir]);
        } else {
            execFile('xdg-open', [backupDir]);
        }
        res.status(200).json({ success: true, message: 'Carpeta de respaldos abierta.' });
    } catch (error) {
        console.error('Explore backup folder error:', error);
        res.status(500).json({ error: 'No se pudo abrir la carpeta de respaldos.' });
    }
});

// ============================================================================
// RUTAS DE CARPETA ESPEJO EN NUBE (GOOGLE DRIVE / ONEDRIVE / MEGA / LOCAL)
// ============================================================================
router.get('/cloud-mirror/status', (req, res) => {
    try {
        const cloudMirrorService = require('../services/CloudMirrorService');
        res.json({
            success: true,
            ...cloudMirrorService.getMirrorStatus()
        });
    } catch (error) {
        console.error('Cloud mirror status error:', error);
        res.status(500).json({ error: 'No se pudo consultar el estado de la carpeta espejo en nube.' });
    }
});

router.put('/cloud-mirror/config', (req, res) => {
    try {
        const cloudMirrorService = require('../services/CloudMirrorService');
        cloudMirrorService.saveConfig(req.body || {});
        res.json({
            success: true,
            message: 'Configuración de Carpeta Espejo Cloud guardada correctamente.',
            ...cloudMirrorService.getMirrorStatus()
        });
    } catch (error) {
        console.error('Cloud mirror config save error:', error);
        res.status(500).json({ error: `No se pudo configurar la carpeta seleccionada: ${error.message}` });
    }
});

router.post('/cloud-mirror/browse', async (req, res) => {
    try {
        const cloudMirrorService = require('../services/CloudMirrorService');
        const currentCfg = cloudMirrorService.getConfig();
        const result = await cloudMirrorService.browseFolderDialog(req.body?.initialDir || currentCfg.mirrorPath);
        res.json(result);
    } catch (error) {
        console.error('Cloud mirror browse error:', error);
        res.status(500).json({ canceled: true, error: error.message });
    }
});

router.post('/cloud-mirror/sync-now', (req, res) => {
    try {
        const cloudMirrorService = require('../services/CloudMirrorService');
        const { filename } = req.body || {};

        if (filename) {
            if (!isValidBackupFilename(filename)) {
                return res.status(400).json({ error: 'Nombre de archivo inválido.' });
            }
            const existing = resolveBackupPaths(filename);
            if (existing.length === 0) {
                return res.status(404).json({ error: 'El respaldo especificado no se encontró.' });
            }
            const singleRes = cloudMirrorService.mirrorBackupFile(existing[0], { force: true });
            return res.json({
                success: true,
                message: `Respaldo ${singleRes.targetFileName} enviado a la carpeta en nube.`,
                copiedCount: 1,
                ...cloudMirrorService.getMirrorStatus()
            });
        }

        const syncRes = cloudMirrorService.syncRecentVaultBackups();
        res.json({
            success: true,
            message: syncRes.copiedCount > 0
                ? `${syncRes.copiedCount} respaldo(s) replicado(s) en la carpeta Cloud.`
                : 'Todos los respaldos recientes ya están sincronizados en la carpeta Cloud.',
            ...syncRes
        });
    } catch (error) {
        console.error('Cloud mirror sync-now error:', error);
        res.status(500).json({ error: `Fallo al sincronizar con la carpeta en nube: ${error.message}` });
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
            message: 'Archivo de respaldo PostgreSQL subido exitosamente.',
            file: req.file.filename
        });
    } catch (error) {
        console.error('Backup upload error:', error);
        res.status(500).json({ error: 'Error al subir el archivo de respaldo.' });
    }
});

let isGeneratingSnapshot = false;

router.post('/generate', async (req, res) => {
    console.log('[Backup Route] POST /generate triggered');
    if (isGeneratingSnapshot) {
        return res.status(429).json({ error: 'Ya hay un respaldo en proceso de generación. Por favor espere un momento.' });
    }

    if (req.setTimeout) req.setTimeout(600000);
    if (res.setTimeout) res.setTimeout(600000);

    isGeneratingSnapshot = true;
    try {
        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        const currentBackupDir = path.join(userDataPath, 'backups');
        if (!fs.existsSync(currentBackupDir)) {
            fs.mkdirSync(currentBackupDir, { recursive: true });
        }

        const { createPostgresBackup } = require('../utils/backupHelper');
        let backupPath;
        try {
            backupPath = await createPostgresBackup();
        } catch (pgHelperErr) {
            console.warn(`[Backup System] createPostgresBackup fallback to createMasterSnapshot: ${pgHelperErr.message}`);
            const { createMasterSnapshot } = require('../utils/snapshotHelper');
            backupPath = await createMasterSnapshot(userDataPath);
        }

        const fileName = path.basename(backupPath);
        console.log(`[Backup System] PostgreSQL Backup generated: ${fileName}`);
        return res.status(200).json({
            success: true,
            message: 'Respaldo Maestro PostgreSQL generado exitosamente',
            file: fileName
        });
    } catch (error) {
        console.error('Backup generation error:', error.message);
        if (error.stack) console.error(error.stack);

        try {
            const baseLogDir = process.env.USER_DATA_PATH || process.cwd();
            const debugLog = path.join(baseLogDir, 'backup_error_debug.log');
            const logEntry = `[${new Date().toISOString()}] ROUTE_ERROR: ${error.message}\nSTACK: ${error.stack}\n\n`;
            fs.appendFileSync(debugLog, logEntry);
        } catch (_logErr) {
            // Ignore log write error
        }

        res.status(500).json({
            error: 'Fallo al generar el respaldo PostgreSQL',
            details: error.message
        });
    } finally {
        isGeneratingSnapshot = false;
    }
});

router.get('/list', (req, res) => {
    console.log('[Backup Route] GET /list triggered');
    try {
        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        const autoBackupDir = path.join(userDataPath, 'auto-backups');

        let allFiles = [];
        const backupEncryptionService = require('../services/BackupEncryptionService');

        if (fs.existsSync(backupDir)) {
            const files = fs.readdirSync(backupDir)
                .filter(f => isValidBackupFilename(f))
                .map(f => {
                    const fullPath = path.join(backupDir, f);
                    const stats = fs.statSync(fullPath);
                    return {
                        name: f,
                        size: stats.size,
                        date: stats.mtime,
                        type: 'manual',
                        encrypted: f.endsWith('.enc') || backupEncryptionService.isEncrypted(fullPath)
                    };
                });
            allFiles = [...allFiles, ...files];
        }

        if (fs.existsSync(autoBackupDir)) {
            const autoFiles = fs.readdirSync(autoBackupDir)
                .filter(f => isValidBackupFilename(f))
                .filter(f => !allFiles.some(af => af.name === f))
                .map(f => {
                    const fullPath = path.join(autoBackupDir, f);
                    const stats = fs.statSync(fullPath);
                    return {
                        name: f,
                        size: stats.size,
                        date: stats.mtime,
                        type: 'auto',
                        encrypted: f.endsWith('.enc') || backupEncryptionService.isEncrypted(fullPath)
                    };
                });
            allFiles = [...allFiles, ...autoFiles];
        }

        const cloudMirrorService = require('../services/CloudMirrorService');
        const mirrorCfg = cloudMirrorService.getConfig();
        const mirrorDir = mirrorCfg?.mirrorPath;
        const mirroredFileNames = new Set();

        if (mirrorDir && fs.existsSync(mirrorDir)) {
            const mirrorFiles = fs.readdirSync(mirrorDir).filter(f => isValidBackupFilename(f));
            mirrorFiles.forEach(mf => {
                mirroredFileNames.add(mf);
                if (mf.endsWith('.enc')) {
                    mirroredFileNames.add(mf.slice(0, -4));
                }
            });

            const extraMirrorFiles = mirrorFiles
                .filter(f => !allFiles.some(af => af.name === f))
                .map(f => {
                    const fullPath = path.join(mirrorDir, f);
                    const stats = fs.statSync(fullPath);
                    return {
                        name: f,
                        size: stats.size,
                        date: stats.mtime,
                        type: 'cloud',
                        encrypted: f.endsWith('.enc') || backupEncryptionService.isEncrypted(fullPath)
                    };
                });
            allFiles = [...allFiles, ...extraMirrorFiles];
        }

        const publicBackupDir = 'C:\\IsaacPOS_Respaldos';
        if (process.platform === 'win32' && fs.existsSync(publicBackupDir)) {
            const pubFiles = fs.readdirSync(publicBackupDir)
                .filter(f => isValidBackupFilename(f))
                .filter(f => !allFiles.some(af => af.name === f))
                .map(f => {
                    const fullPath = path.join(publicBackupDir, f);
                    const stats = fs.statSync(fullPath);
                    return {
                        name: f,
                        size: stats.size,
                        date: stats.mtime,
                        type: 'manual',
                        encrypted: f.endsWith('.enc') || backupEncryptionService.isEncrypted(fullPath)
                    };
                });
            allFiles = [...allFiles, ...pubFiles];
        }

        const enrichedBackups = allFiles
            .map(b => ({
                ...b,
                inCloudMirror: mirroredFileNames.has(b.name)
            }))
            .sort((a, b) => b.date - a.date);

        res.json({ backups: enrichedBackups });
    } catch (error) {
        console.error('List backups error:', error);
        res.status(500).json({ error: 'No se pudo leer el directorio de respaldos.' });
    }
});

router.get('/download/:filename', (req, res) => {
    try {
        const { filename } = req.params;

        if (!isValidBackupFilename(filename)) {
            return res.status(403).json({ error: 'Nombre de archivo inválido.' });
        }

        const existingPaths = resolveBackupPaths(filename);
        if (existingPaths.length === 0) {
            return res.status(404).json({ error: 'El archivo de respaldo no existe.' });
        }

        res.download(existingPaths[0], filename);
    } catch (error) {
        console.error('Download backup error:', error);
        res.status(500).json({ error: 'Fallo al procesar la descarga del respaldo.' });
    }
});

/**
 * POST /encrypt - Cifra un archivo de respaldo existente con AES-256-GCM
 */
router.post('/encrypt', async (req, res) => {
    try {
        const { filename, password } = req.body;
        if (!filename) return res.status(400).json({ error: 'Nombre de archivo requerido' });

        const safeFilename = path.basename(filename);
        const existingPaths = resolveBackupPaths(safeFilename);
        if (existingPaths.length === 0) {
            return res.status(404).json({ error: 'Archivo de respaldo no encontrado' });
        }

        const sourcePath = existingPaths[0];
        const backupEncryptionService = require('../services/BackupEncryptionService');
        if (sourcePath.toLowerCase().endsWith('.enc') || backupEncryptionService.isEncrypted(sourcePath)) {
            return res.status(400).json({ error: 'Este archivo ya se encuentra cifrado (.enc).' });
        }
        const outputPath = `${sourcePath}.enc`;
        const result = backupEncryptionService.encryptFile(sourcePath, outputPath, password);

        res.json({
            success: true,
            message: 'Respaldo cifrado exitosamente con AES-256-GCM (Grado Bancario).',
            encryptedFilename: path.basename(outputPath),
            ...result
        });
    } catch (err) {
        console.error('[Backup Route] Encryption error:', err);
        res.status(500).json({ error: 'Error al cifrar el respaldo: ' + err.message });
    }
});

// Ruta para restaurar una copia de seguridad desde una ruta absoluta (seleccionada manualmente)
router.post('/restore-path', async (req, res) => {
    console.log('[Backup Route] POST /restore-path triggered');
    try {
        const { filePath } = req.body;

        if (!filePath || typeof filePath !== 'string' || filePath.includes('\0')) {
            return res.status(400).json({ error: 'No se especificó una ruta válida de archivo.' });
        }

        const resolvedRestorePath = path.resolve(filePath);
        const allowedRestoreExts = ['.sql', '.dump', '.zip', '.sqlite', '.db', '.backup', '.enc'];
        if (
            !isPathInsideRoots(resolvedRestorePath, getAllowedBackupRoots(), false) ||
            (!isValidBackupFilename(path.basename(resolvedRestorePath)) &&
             !allowedRestoreExts.includes(path.extname(resolvedRestorePath).toLowerCase()))
        ) {
            return res.status(403).json({ error: 'Ruta de restauración fuera de los directorios de respaldo autorizados.' });
        }

        if (!fs.existsSync(resolvedRestorePath)) {
            return res.status(404).json({ error: 'El archivo de respaldo especificado no existe.' });
        }

        let effectivePath = resolvedRestorePath;
        let tempDecryptedPath = null;
        const backupEncryptionService = require('../services/BackupEncryptionService');

        const cleanupTemp = () => {
            if (tempDecryptedPath && fs.existsSync(tempDecryptedPath)) {
                try {
                    fs.unlinkSync(tempDecryptedPath);
                } catch (_e) {
                    // Ignore temp file cleanup error
                }
            }
        };

        // Soporte de descifrado automático si el archivo está cifrado con AES-256-GCM
        if (path.extname(filePath).toLowerCase() === '.enc' || backupEncryptionService.isEncrypted(filePath)) {
            const os = require('os');
            const rawDecrypted = path.join(os.tmpdir(), `isaac_restore_plain_${Date.now()}.bin`);
            backupEncryptionService.decryptFile(filePath, rawDecrypted, req.body.password);

            const head = fs.readFileSync(rawDecrypted);
            if (head.subarray(0, 15).toString() === 'SQLite format 3') {
                try { fs.unlinkSync(rawDecrypted); } catch (_e) { /* ignore */ }
                return res.status(400).json({
                    error: 'El archivo cifrado corresponde a un respaldo SQLite legado retirado. Utilice respaldos PostgreSQL (.sql, .zip o .json).'
                });
            }

            let finalDecrypted = rawDecrypted + '.sql';
            if (head.subarray(0, 2).toString() === 'PK') {
                finalDecrypted = rawDecrypted + '.zip';
            } else if (head.subarray(0, 1).toString().trim() === '{') {
                finalDecrypted = rawDecrypted + '.json';
            }
            fs.renameSync(rawDecrypted, finalDecrypted);
            tempDecryptedPath = finalDecrypted;
            effectivePath = finalDecrypted;
        }

        const ext = path.extname(effectivePath).toLowerCase();
        if (ext === '.sqlite') {
            cleanupTemp();
            return res.status(400).json({
                error: 'El motor SQLite legado fue retirado. Utilice respaldos nativos PostgreSQL (.zip, .sql, .json o .enc).'
            });
        }

        if (ext !== '.zip' && ext !== '.sql' && ext !== '.json') {
            cleanupTemp();
            return res.status(400).json({
                error: 'Formato de archivo no soportado. Debe ser .zip, .sql, .json o .enc válido de PostgreSQL.'
            });
        }

        const filename = path.basename(effectivePath);

        if (ext === '.json') {
            try {
                const count = await restoreSequelizeJsonBackup(effectivePath);
                cleanupTemp();
                return res.status(200).json({
                    success: true,
                    message: `Instantánea JSON restaurada exitosamente en PostgreSQL (${count} registros sincronizados).`
                });
            } catch (jsonErr) {
                cleanupTemp();
                console.error('[Backup System] JSON restore error:', jsonErr);
                return res.status(500).json({ error: 'Error al restaurar el respaldo JSON: ' + jsonErr.message });
            }
        }

        if (ext === '.zip') {
            console.log('[Backup System] Restoring Master Snapshot (ZIP) from path...');
            const tempExtractPath = path.join(backupDir, 'temp_restore_' + Date.now());
            if (fs.existsSync(tempExtractPath)) fs.rmSync(tempExtractPath, { recursive: true, force: true });
            fs.mkdirSync(tempExtractPath, { recursive: true });

            performZipExtraction(effectivePath, tempExtractPath, async (unzipErr) => {
                cleanupTemp();
                if (unzipErr) {
                    console.error(`[Backup System] Unzip error: ${unzipErr.message}`);
                    return res.status(500).json({ error: 'Error al descomprimir el snapshot maestro: ' + unzipErr.message });
                }

                try {
                    const rootDir = process.env.USER_DATA_PATH || process.cwd();
                    await restoreExtractedSnapshotDir(tempExtractPath, rootDir);
                    fs.rmSync(tempExtractPath, { recursive: true, force: true });

                    console.log('[Backup System] Master Snapshot restored successfully.');
                    return res.status(200).json({
                        success: true,
                        message: 'Snapshot Maestro PostgreSQL restaurado exitosamente (Base de Datos + Imágenes).'
                    });
                } catch (innerErr) {
                    try { fs.rmSync(tempExtractPath, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
                    console.error('[Backup System] Restore processing error:', innerErr);
                    return res.status(500).json({ error: 'Error procesando los archivos extraídos: ' + innerErr.message });
                }
            });
            return;
        }

        // Restauración directa SQL en PostgreSQL via psql
        const { host, port, user, dbName, password } = getActivePgConnectionParams();
        const psql = getPsqlCommand();
        console.log(`[Backup System] Executing SQL restore from path... File: ${filename}`);

        execFile(
            psql,
            ['-h', host, '-p', port, '-U', user, '-d', dbName, '-f', effectivePath],
            { env: { ...process.env, PGPASSWORD: password } },
            (error) => {
                cleanupTemp();
                if (error) {
                    console.error(`[Backup System] psql exec error: ${error.message}`);
                    return res.status(500).json({ error: 'Error al ejecutar herramienta de restauración de PostgreSQL (psql).' });
                }

                console.log(`[Backup System] Restore completed successfully: ${filename}`);
                return res.status(200).json({
                    success: true,
                    message: 'Base de datos PostgreSQL restaurada exitosamente.'
                });
            }
        );
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Fallo interno al preparar la restauración.' });
    }
});

router.post('/restore/:filename', async (req, res) => {
    console.log(`[Backup Route] POST /restore/${req.params.filename} triggered`);
    try {
        const { filename } = req.params;

        if (!isValidBackupFilename(filename)) {
            return res.status(400).json({ error: 'Nombre o formato de archivo inválido para PostgreSQL.' });
        }

        const existingPaths = resolveBackupPaths(filename);
        if (existingPaths.length === 0) {
            return res.status(404).json({ error: 'El archivo de respaldo no existe.' });
        }

        const filePath = existingPaths[0];
        let effectivePath = filePath;
        let tempDecryptedPath = null;
        const backupEncryptionService = require('../services/BackupEncryptionService');

        const cleanupTemp = () => {
            if (tempDecryptedPath && fs.existsSync(tempDecryptedPath)) {
                try { fs.unlinkSync(tempDecryptedPath); } catch (_e) { /* ignore */ }
            }
        };

        if (filename.endsWith('.enc') || backupEncryptionService.isEncrypted(filePath)) {
            const os = require('os');
            const rawDecrypted = path.join(os.tmpdir(), `isaac_restore_vault_${Date.now()}.bin`);
            backupEncryptionService.decryptFile(filePath, rawDecrypted, req.body?.password);

            const head = fs.readFileSync(rawDecrypted);
            if (head.subarray(0, 15).toString() === 'SQLite format 3') {
                try { fs.unlinkSync(rawDecrypted); } catch (_e) { /* ignore */ }
                return res.status(400).json({
                    error: 'El archivo cifrado corresponde a un respaldo SQLite legado retirado. Utilice respaldos PostgreSQL (.sql, .zip o .json).'
                });
            }

            let finalDecrypted = rawDecrypted + '.sql';
            if (head.subarray(0, 2).toString() === 'PK') {
                finalDecrypted = rawDecrypted + '.zip';
            } else if (head.subarray(0, 1).toString().trim() === '{') {
                finalDecrypted = rawDecrypted + '.json';
            }
            fs.renameSync(rawDecrypted, finalDecrypted);
            tempDecryptedPath = finalDecrypted;
            effectivePath = finalDecrypted;
        }

        const effectiveExt = path.extname(effectivePath).toLowerCase();

        if (effectiveExt === '.json') {
            try {
                const count = await restoreSequelizeJsonBackup(effectivePath);
                cleanupTemp();
                return res.status(200).json({
                    success: true,
                    message: `Instantánea JSON restaurada exitosamente en PostgreSQL (${count} registros sincronizados).`
                });
            } catch (jsonErr) {
                cleanupTemp();
                console.error('[Backup System] JSON restore error:', jsonErr);
                return res.status(500).json({ error: 'Error al restaurar el respaldo JSON: ' + jsonErr.message });
            }
        }

        if (effectiveExt === '.zip') {
            console.log('[Backup System] Restoring Master Snapshot (ZIP)...');
            const tempExtractPath = path.join(backupDir, 'temp_restore_' + Date.now());
            if (fs.existsSync(tempExtractPath)) fs.rmSync(tempExtractPath, { recursive: true, force: true });
            fs.mkdirSync(tempExtractPath, { recursive: true });

            performZipExtraction(effectivePath, tempExtractPath, async (unzipErr) => {
                cleanupTemp();
                if (unzipErr) {
                    console.error(`[Backup System] Unzip error: ${unzipErr.message}`);
                    return res.status(500).json({ error: 'Error al descomprimir el snapshot maestro: ' + unzipErr.message });
                }

                try {
                    const rootDir = process.env.USER_DATA_PATH || process.cwd();
                    await restoreExtractedSnapshotDir(tempExtractPath, rootDir);
                    fs.rmSync(tempExtractPath, { recursive: true, force: true });

                    console.log('[Backup System] Master Snapshot restored successfully.');
                    return res.status(200).json({
                        success: true,
                        message: 'Snapshot Maestro PostgreSQL restaurado exitosamente (Base de Datos + Imágenes).'
                    });
                } catch (innerErr) {
                    try { fs.rmSync(tempExtractPath, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
                    console.error('[Backup System] Restore processing error:', innerErr);
                    return res.status(500).json({ error: 'Error procesando los archivos extraídos: ' + innerErr.message });
                }
            });
            return;
        }

        // Restauración SQL directa
        const { host, port, user, dbName, password } = getActivePgConnectionParams();
        const psql = getPsqlCommand();
        console.log(`[Backup System] Executing SQL restore... File: ${filename}`);

        execFile(
            psql,
            ['-h', host, '-p', port, '-U', user, '-d', dbName, '-f', effectivePath],
            { env: { ...process.env, PGPASSWORD: password } },
            (error) => {
                cleanupTemp();
                if (error) {
                    console.error(`[Backup System] psql exec error: ${error.message}`);
                    return res.status(500).json({ error: 'Error al ejecutar herramienta de restauración de PostgreSQL (psql).' });
                }

                console.log(`[Backup System] Restore completed successfully: ${filename}`);
                return res.status(200).json({
                    success: true,
                    message: 'Base de datos PostgreSQL restaurada exitosamente.'
                });
            }
        );
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Fallo interno al preparar la restauración.' });
    }
});

router.delete('/:filename', async (req, res) => {
    try {
        const { filename } = req.params;

        if (!isValidBackupFilename(filename)) {
            return res.status(403).json({ error: 'Nombre de archivo inválido.' });
        }

        const existingPaths = resolveBackupPaths(filename);
        if (existingPaths.length === 0) {
            return res.status(404).json({ error: 'El archivo no existe.' });
        }

        for (const targetPath of existingPaths) {
            try {
                fs.unlinkSync(targetPath);
            } catch (unlinkErr) {
                console.warn(`[Backup System] Could not delete ${targetPath}:`, unlinkErr.message);
            }
        }
        console.log(`[Backup System] File deleted successfully (${existingPaths.length} location(s)): ${filename}`);

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
