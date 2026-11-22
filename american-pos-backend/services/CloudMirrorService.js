const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const backupEncryptionService = require('./BackupEncryptionService');

const DEFAULT_LOCAL_MIRROR = 'C:\\IsaacPOS_Respaldos';
const SUBFOLDER_NAME = 'IsaacPOS_Respaldos';

class CloudMirrorService {
    constructor() {
        this._configCache = null;
    }

    _getConfigFilePath() {
        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        return path.join(userDataPath, 'cloud_mirror_config.json');
    }

    /**
     * Detecta clientes de almacenamiento en la nube instalados en Windows (Google Drive, OneDrive, MEGA, Dropbox)
     */
    detectInstalledCloudProviders() {
        const homeDir = os.homedir();
        const providers = [];

        // 1. Google Drive para Escritorio (Unidades virtuales G:, H:, I: o carpetas en %USERPROFILE%)
        const gDriveCandidates = [
            'G:\\Mi unidad',
            'G:\\My Drive',
            'H:\\Mi unidad',
            'H:\\My Drive',
            'I:\\Mi unidad',
            'I:\\My Drive',
            path.join(homeDir, 'Google Drive', 'Mi unidad'),
            path.join(homeDir, 'Google Drive'),
            path.join(homeDir, 'Mi unidad'),
            path.join(homeDir, 'My Drive')
        ];
        const foundGDrive = gDriveCandidates.find(p => {
            try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
        });
        const hasGDriveDrive = fs.existsSync('G:\\');
        providers.push({
            id: 'gdrive',
            name: 'Google Drive',
            detected: Boolean(foundGDrive),
            basePath: foundGDrive || (hasGDriveDrive ? 'G:\\Mi unidad' : path.join(homeDir, 'Google Drive')),
            suggestedMirrorPath: foundGDrive 
                ? path.join(foundGDrive, SUBFOLDER_NAME) 
                : (hasGDriveDrive ? path.join('G:\\Mi unidad', SUBFOLDER_NAME) : path.join(homeDir, 'Google Drive', SUBFOLDER_NAME))
        });

        // 2. Microsoft OneDrive
        const oneDriveCandidates = [
            process.env.OneDriveCommercial,
            process.env.OneDriveConsumer,
            process.env.OneDrive,
            path.join(homeDir, 'OneDrive')
        ].filter(Boolean);
        const foundOneDrive = oneDriveCandidates.find(p => {
            try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
        });
        providers.push({
            id: 'onedrive',
            name: 'Microsoft OneDrive',
            detected: Boolean(foundOneDrive),
            basePath: foundOneDrive || path.join(homeDir, 'OneDrive'),
            suggestedMirrorPath: foundOneDrive ? path.join(foundOneDrive, SUBFOLDER_NAME) : path.join(homeDir, 'OneDrive', SUBFOLDER_NAME)
        });

        // 3. MEGA
        const megaCandidates = [
            path.join(homeDir, 'MEGA'),
            path.join(homeDir, 'Mega'),
            path.join(homeDir, 'MEGAsync')
        ];
        const foundMega = megaCandidates.find(p => {
            try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
        });
        providers.push({
            id: 'mega',
            name: 'MEGA Cloud',
            detected: Boolean(foundMega),
            basePath: foundMega || path.join(homeDir, 'MEGA'),
            suggestedMirrorPath: foundMega ? path.join(foundMega, SUBFOLDER_NAME) : path.join(homeDir, 'MEGA', SUBFOLDER_NAME)
        });

        // 4. Dropbox
        const dropboxCandidates = [
            path.join(homeDir, 'Dropbox')
        ];
        const foundDropbox = dropboxCandidates.find(p => {
            try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
        });
        providers.push({
            id: 'dropbox',
            name: 'Dropbox',
            detected: Boolean(foundDropbox),
            basePath: foundDropbox || path.join(homeDir, 'Dropbox'),
            suggestedMirrorPath: foundDropbox ? path.join(foundDropbox, SUBFOLDER_NAME) : path.join(homeDir, 'Dropbox', SUBFOLDER_NAME)
        });

        // 5. Carpeta Espejo Local en Disco C:
        providers.push({
            id: 'local_c',
            name: 'Disco Local (C:\\IsaacPOS_Respaldos)',
            detected: true,
            basePath: DEFAULT_LOCAL_MIRROR,
            suggestedMirrorPath: DEFAULT_LOCAL_MIRROR
        });

        return providers;
    }

    /**
     * Obtiene la configuración activa de la Carpeta Espejo Cloud
     */
    getConfig() {
        const configPath = this._getConfigFilePath();
        const providers = this.detectInstalledCloudProviders();
        const preferredCloud = providers.find(p => p.id !== 'local_c' && p.detected);

        const defaultConfig = {
            enabled: true,
            providerId: preferredCloud ? preferredCloud.id : 'local_c',
            mirrorPath: preferredCloud ? preferredCloud.suggestedMirrorPath : DEFAULT_LOCAL_MIRROR,
            autoSyncOnBackup: true,
            encryptMirrorCopies: true,
            maxMirrorCopies: 15,
            lastSyncAt: null,
            lastSyncedFile: null,
            lastSyncError: null
        };

        try {
            if (fs.existsSync(configPath)) {
                const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                return { ...defaultConfig, ...raw };
            }
        } catch (err) {
            console.warn('[CloudMirrorService] Error reading config:', err.message);
        }

        return defaultConfig;
    }

    /**
     * Valida que mirrorPath sea un directorio local seguro (sin UNC, sin rutas de sistema ni raíces de disco).
     */
    validateMirrorPath(rawPath) {
        if (!rawPath || typeof rawPath !== 'string') {
            return DEFAULT_LOCAL_MIRROR;
        }
        const trimmed = rawPath.trim();
        if (!trimmed || trimmed.includes('\0') || /[\r\n]/.test(trimmed)) {
            throw new Error('Ruta de carpeta espejo inválida.');
        }
        // Bloquear rutas UNC (\\host\share o //host/share) que filtran hashes NTLMv2 o escapan del host local
        if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
            throw new Error('No se permiten rutas de red UNC (\\\\servidor\\recurso) como carpeta espejo. Use una carpeta local sincronizada (OneDrive, Google Drive o disco local).');
        }
        const resolved = path.resolve(trimmed);
        const parsed = path.parse(resolved);
        // Bloquear raíz de unidad completa (ej. C:\ o /)
        if (resolved === parsed.root) {
            throw new Error('No se puede utilizar la raíz completa de una unidad como carpeta espejo. Seleccione una subcarpeta dedicada.');
        }
        if (process.platform === 'win32') {
            const lower = resolved.toLowerCase();
            const forbiddenPrefixes = [
                'c:\\windows',
                'c:\\program files',
                'c:\\program files (x86)',
                'c:\\programdata',
                'c:\\system volume information',
                'c:\\$recycle.bin'
            ];
            if (forbiddenPrefixes.some((p) => lower === p || lower.startsWith(`${p}\\`))) {
                throw new Error('No se permiten directorios críticos del sistema operativo como carpeta espejo.');
            }
        } else {
            const forbiddenUnix = ['/etc', '/bin', '/sbin', '/usr', '/var', '/proc', '/sys', '/dev', '/root'];
            if (forbiddenUnix.some((p) => resolved === p || resolved.startsWith(`${p}/`))) {
                throw new Error('No se permiten directorios críticos del sistema como carpeta espejo.');
            }
        }
        return resolved;
    }

    /**
     * Guarda y valida la configuración de la Carpeta Espejo Cloud
     */
    saveConfig(partialConfig = {}) {
        const current = this.getConfig();
        const next = {
            ...current,
            ...partialConfig
        };

        if (next.mirrorPath && typeof next.mirrorPath === 'string') {
            next.mirrorPath = this.validateMirrorPath(next.mirrorPath);
        } else {
            next.mirrorPath = DEFAULT_LOCAL_MIRROR;
        }

        next.maxMirrorCopies = Math.min(Math.max(Number(next.maxMirrorCopies) || 15, 3), 100);
        next.enabled = Boolean(next.enabled);
        next.autoSyncOnBackup = Boolean(next.autoSyncOnBackup);
        next.encryptMirrorCopies = Boolean(next.encryptMirrorCopies);

        // Verificar que la carpeta destino exista o pueda crearse si está habilitado
        if (next.enabled && next.mirrorPath) {
            const rootDrive = path.parse(next.mirrorPath).root;
            if (rootDrive && !fs.existsSync(rootDrive)) {
                throw new Error(`La unidad '${rootDrive}' no existe en esta computadora. Asegúrate de tener la aplicación de escritorio instalada y abierta, o selecciona Microsoft OneDrive que ya está disponible en tu equipo.`);
            }
            if (!fs.existsSync(next.mirrorPath)) {
                try {
                    fs.mkdirSync(next.mirrorPath, { recursive: true });
                } catch (mkdirErr) {
                    throw new Error(`No se pudo crear la carpeta en '${next.mirrorPath}': ${mkdirErr.message}`);
                }
            }
        }

        const configPath = this._getConfigFilePath();
        fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
        this._configCache = next;
        return next;
    }

    /**
     * Obtiene estadísticas e inventario de archivos dentro de la carpeta espejo actual
     */
    getMirrorStatus() {
        const config = this.getConfig();
        const providers = this.detectInstalledCloudProviders();
        let mirroredFiles = [];
        let totalSizeBytes = 0;
        let folderExists = false;

        try {
            if (config.mirrorPath && fs.existsSync(config.mirrorPath)) {
                folderExists = true;
                const entries = fs.readdirSync(config.mirrorPath);
                for (const name of entries) {
                    const validPrefix = name.startsWith('backup_') || name.startsWith('backup_atómico_') || name.startsWith('master_snapshot_');
                    const validExt = name.endsWith('.sql') || name.endsWith('.zip') || name.endsWith('.json') || name.endsWith('.enc');
                    if (!validPrefix || !validExt) continue;

                    const fullPath = path.join(config.mirrorPath, name);
                    const stat = fs.statSync(fullPath);
                    if (stat.isFile()) {
                        mirroredFiles.push({
                            name,
                            size: stat.size,
                            date: stat.mtime
                        });
                        totalSizeBytes += stat.size;
                    }
                }
                mirroredFiles.sort((a, b) => b.date - a.date);
            }
        } catch (err) {
            console.warn('[CloudMirrorService] Error inspecting mirror folder:', err.message);
        }

        return {
            config,
            providers,
            folderExists,
            mirroredCount: mirroredFiles.length,
            totalSizeBytes,
            mirroredFiles
        };
    }

    /**
     * Rota los respaldos antiguos en la carpeta espejo para no saturar la cuota de Google Drive / OneDrive
     */
    rotateMirrorFolder(mirrorDir, keepCount = 15) {
        if (!mirrorDir || !fs.existsSync(mirrorDir)) return;
        try {
            const files = fs.readdirSync(mirrorDir)
                .filter(f => (f.startsWith('backup_') || f.startsWith('backup_atómico_') || f.startsWith('master_snapshot_')) &&
                             (f.endsWith('.zip') || f.endsWith('.sql') || f.endsWith('.json') || f.endsWith('.enc')))
                .map(f => {
                    const p = path.join(mirrorDir, f);
                    return { name: f, path: p, time: fs.statSync(p).mtime.getTime() };
                })
                .sort((a, b) => b.time - a.time);

            if (files.length > keepCount) {
                files.slice(keepCount).forEach(f => {
                    try { fs.unlinkSync(f.path); } catch {}
                });
            }
        } catch (err) {
            console.warn('[CloudMirrorService] Warning rotating mirror folder:', err.message);
        }
    }

    /**
     * Replica un archivo de respaldo específico hacia la carpeta espejo Cloud configurada
     */
    mirrorBackupFile(sourceFilePath, { force = false } = {}) {
        if (
            process.env.ISAAC_TEST_ISOLATED === '1' ||
            process.env.DISABLE_EXTERNAL_BACKUPS === 'true' ||
            (process.env.NODE_ENV === 'test' && process.env.FORCE_MIRROR_IN_TEST !== 'true')
        ) {
            return { skipped: true, reason: 'Replicación externa deshabilitada en modo test/aislado' };
        }
        const config = this.getConfig();
        if (!force && (!config.enabled || !config.autoSyncOnBackup)) {
            return { skipped: true, reason: 'Sincronización automática desactivada' };
        }

        if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
            throw new Error('El archivo de respaldo origen no existe.');
        }

        const targetDir = config.mirrorPath || DEFAULT_LOCAL_MIRROR;
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const baseName = path.basename(sourceFilePath);
        let targetFileName = baseName;
        let targetPath = path.join(targetDir, targetFileName);

        try {
            if (config.encryptMirrorCopies && !baseName.endsWith('.enc')) {
                targetFileName = `${baseName}.enc`;
                targetPath = path.join(targetDir, targetFileName);
                backupEncryptionService.encryptFile(sourceFilePath, targetPath);
            } else {
                if (path.resolve(sourceFilePath) !== path.resolve(targetPath)) {
                    fs.copyFileSync(sourceFilePath, targetPath);
                }
            }

            // Mantener también copia redundante en C:\IsaacPOS_Respaldos respetando el cifrado configurado
            if (process.platform === 'win32' && path.resolve(targetDir) !== path.resolve(DEFAULT_LOCAL_MIRROR)) {
                try {
                    if (!fs.existsSync(DEFAULT_LOCAL_MIRROR)) {
                        fs.mkdirSync(DEFAULT_LOCAL_MIRROR, { recursive: true });
                    }
                    const localCopyName = config.encryptMirrorCopies ? targetFileName : baseName;
                    const localCopySource = config.encryptMirrorCopies ? targetPath : sourceFilePath;
                    const localCopyPath = path.join(DEFAULT_LOCAL_MIRROR, localCopyName);
                    if (path.resolve(localCopySource) !== path.resolve(localCopyPath)) {
                        fs.copyFileSync(localCopySource, localCopyPath);
                    }
                    this.rotateMirrorFolder(DEFAULT_LOCAL_MIRROR, config.maxMirrorCopies || 15);
                } catch {}
            }

            this.rotateMirrorFolder(targetDir, config.maxMirrorCopies || 15);

            const nowIso = new Date().toISOString();
            this.saveConfig({
                lastSyncAt: nowIso,
                lastSyncedFile: targetFileName,
                lastSyncError: null
            });

            return {
                success: true,
                targetPath,
                targetFileName,
                syncedAt: nowIso
            };
        } catch (err) {
            this.saveConfig({
                lastSyncError: err.message
            });
            throw err;
        }
    }

    /**
     * Sincroniza bajo demanda los respaldos recientes de la bóveda hacia la carpeta Cloud
     */
    syncRecentVaultBackups() {
        const config = this.getConfig();
        const userDataPath = process.env.USER_DATA_PATH || process.cwd();
        const backupDir = path.join(userDataPath, 'backups');
        const autoBackupDir = path.join(userDataPath, 'auto-backups');
        const targetDir = config.mirrorPath || DEFAULT_LOCAL_MIRROR;

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const candidateFiles = [];
        const collectFromDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const f of fs.readdirSync(dir)) {
                const validPrefix = f.startsWith('backup_') || f.startsWith('backup_atómico_') || f.startsWith('master_snapshot_');
                const validExt = f.endsWith('.sql') || f.endsWith('.zip') || f.endsWith('.json') || f.endsWith('.enc');
                if (!validPrefix || !validExt) continue;
                const fullPath = path.join(dir, f);
                const stat = fs.statSync(fullPath);
                if (stat.isFile()) {
                    candidateFiles.push({ name: f, fullPath, time: stat.mtime.getTime() });
                }
            }
        };

        collectFromDir(backupDir);
        collectFromDir(autoBackupDir);

        // Ordenar del más reciente al más antiguo y limitar a maxMirrorCopies
        candidateFiles.sort((a, b) => b.time - a.time);
        const uniqueRecent = [];
        const seenNames = new Set();
        for (const item of candidateFiles) {
            if (!seenNames.has(item.name)) {
                seenNames.add(item.name);
                uniqueRecent.push(item);
            }
            if (uniqueRecent.length >= (config.maxMirrorCopies || 15)) break;
        }

        let copiedCount = 0;
        let lastFile = null;

        for (const item of uniqueRecent) {
            const expectedName = (config.encryptMirrorCopies && !item.name.endsWith('.enc'))
                ? `${item.name}.enc`
                : item.name;
            const destPath = path.join(targetDir, expectedName);

            if (!fs.existsSync(destPath)) {
                this.mirrorBackupFile(item.fullPath, { force: true });
                copiedCount++;
                if (!lastFile) lastFile = expectedName;
            }
        }

        this.rotateMirrorFolder(targetDir, config.maxMirrorCopies || 15);
        const nowIso = new Date().toISOString();
        this.saveConfig({
            lastSyncAt: nowIso,
            ...(lastFile ? { lastSyncedFile: lastFile } : {}),
            lastSyncError: null
        });

        return {
            copiedCount,
            evaluatedCount: uniqueRecent.length,
            ...this.getMirrorStatus()
        };
    }

    /**
     * Abre el diálogo nativo de selección de carpeta en Windows
     */
    browseFolderDialog(initialDir = '') {
        return new Promise((resolve) => {
            if (process.platform !== 'win32') {
                return resolve({ canceled: true, error: 'Selector nativo disponible solo en Windows.' });
            }

            let safeInitialDir = '';
            try {
                if (initialDir && typeof initialDir === 'string') {
                    const validated = this.validateMirrorPath(initialDir);
                    if (fs.existsSync(validated)) safeInitialDir = validated;
                }
            } catch (_) {
                safeInitialDir = '';
            }

            // Script 100% estático: la ruta inicial viaja en variable de entorno (inmune a inyección ASCII/Unicode)
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dummy = New-Object System.Windows.Forms.Form
$dummy.TopMost = $true
$dummy.ShowInTaskbar = $false
$dummy.WindowState = 'Minimized'
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Selecciona tu carpeta de Google Drive, OneDrive, MEGA o unidad de respaldo'
$dialog.ShowNewFolderButton = $true
if ($env:ISAAC_INITIAL_DIR -and (Test-Path -LiteralPath $env:ISAAC_INITIAL_DIR)) {
    $dialog.SelectedPath = $env:ISAAC_INITIAL_DIR
}
$result = $dialog.ShowDialog($dummy)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
$dummy.Dispose()
`;
            const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

            execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript],
                {
                    timeout: 120000,
                    windowsHide: true,
                    env: { ...process.env, ISAAC_INITIAL_DIR: safeInitialDir }
                },
                (err, stdout) => {
                    if (err) {
                        return resolve({ canceled: true, error: err.message });
                    }
                    const selectedPath = String(stdout || '').trim();
                    if (!selectedPath) {
                        return resolve({ canceled: true });
                    }
                    return resolve({ canceled: false, folderPath: selectedPath });
                }
            );
        });
    }
}

module.exports = new CloudMirrorService();
