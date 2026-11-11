const net = require('net');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Checks if a TCP port is open and accepting connections
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function isPortOpen(host, port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = false;

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            status = true;
            socket.destroy();
        });

        socket.on('timeout', () => {
            socket.destroy();
        });

        socket.on('error', () => {
            socket.destroy();
        });

        socket.on('close', () => {
            resolve(status);
        });

        try {
            socket.connect(port, host);
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * Finds the postgres.exe executable path
 * @returns {string|null}
 */
function findPostgresExecutable() {
    const candidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '16', 'bin', 'postgres.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '15', 'bin', 'postgres.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '14', 'bin', 'postgres.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'PostgreSQL', '16', 'bin', 'postgres.exe')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    const basePg = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    if (fs.existsSync(basePg)) {
        try {
            const subdirs = fs.readdirSync(basePg);
            for (const sub of subdirs) {
                const p = path.join(basePg, sub, 'bin', 'postgres.exe');
                if (fs.existsSync(p)) return p;
            }
        } catch (e) {}
    }

    return null;
}

function findPgCtlExecutable() {
    const candidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '16', 'bin', 'pg_ctl.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '17', 'bin', 'pg_ctl.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '15', 'bin', 'pg_ctl.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '14', 'bin', 'pg_ctl.exe')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Finds the PostgreSQL data cluster directory
 * @returns {string|null}
 */
function findPostgresDataDir() {
    const candidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '16', 'data'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '17', 'data'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '15', 'data'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '14', 'data'),
        path.join(process.env.APPDATA || '', 'PostgreSQL', 'data')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'PG_VERSION'))) {
            return candidate;
        }
    }

    return null;
}

/**
 * Cleans an orphaned postmaster.pid file if the recorded PID is dead
 * @param {string} dataDir
 */
function cleanStalePid(dataDir) {
    if (!dataDir) return;
    const pidFile = path.join(dataDir, 'postmaster.pid');
    if (fs.existsSync(pidFile)) {
        try {
            const content = fs.readFileSync(pidFile, 'utf8').split('\n');
            const pid = parseInt(content[0]?.trim(), 10);
            if (pid && !isNaN(pid)) {
                let isPostgresAlive = false;
                try {
                    if (process.platform === 'win32') {
                        const { execSync } = require('child_process');
                        const output = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`, { timeout: 3000 }).toString().trim().toLowerCase();
                        isPostgresAlive = (output === 'postgres');
                    } else {
                        isPostgresAlive = process.kill(pid, 0);
                    }
                } catch (e) {
                    isPostgresAlive = false;
                }
                if (!isPostgresAlive) {
                    console.log(`[PostgreSQL Launcher] 🧹 Limpiando postmaster.pid huérfano (PID ${pid} inactivo o ajeno)...`);
                    try {
                        fs.unlinkSync(pidFile);
                    } catch (unErr) {
                        console.warn('[PostgreSQL Launcher] No se pudo borrar postmaster.pid:', unErr.message);
                    }
                }
            }
        } catch (e) {
            console.warn('[PostgreSQL Launcher] Aviso verificando postmaster.pid:', e.message);
        }
    }
}

/**
 * Ensures PostgreSQL is running before connecting.
 * If not running, launches it in the background and waits until port is ready.
 * @param {number} maxWaitSeconds
 * @returns {Promise<boolean>}
 */
async function ensurePostgresRunning(maxWaitSeconds = 25) {
    let dbConfig = null;
    try {
        const DbConfigManager = require('../config/dbConfigManager');
        dbConfig = DbConfigManager.getConfig();
    } catch (e) {}

    // En modo Caja Secundaria (Terminal LAN / Spoke), JAMÁS se debe instalar ni ejecutar PostgreSQL local
    const isClient = (dbConfig && dbConfig.mode === 'client') || process.env.POS_NODE_ROLE === 'LAN_SPOKE';
    if (isClient) {
        console.log('[PostgreSQL Launcher] ℹ️ Terminal configurada como Caja Secundaria (Cliente LAN). Omitiendo verificación e instalación de base de datos local.');
        return true;
    }

    const host = (dbConfig && dbConfig.host) || process.env.DB_HOST || '127.0.0.1';
    const port = parseInt((dbConfig && dbConfig.port) || process.env.DB_PORT || '5432', 10);

    // 1. Check if already open
    const alreadyOpen = await isPortOpen(host, port, 1000);
    if (alreadyOpen) {
        console.log(`[PostgreSQL Launcher] ✅ PostgreSQL ya está activo y escuchando en ${host}:${port}`);
        return true;
    }

    // Only attempt local auto-start if host is localhost / 127.0.0.1
    if (host !== '127.0.0.1' && host !== 'localhost') {
        console.log(`[PostgreSQL Launcher] ℹ️ Servidor remoto PostgreSQL (${host}:${port}) en espera de red. Omitiendo inicio local.`);
        return true;
    }

    console.log(`[PostgreSQL Launcher] 🚀 PostgreSQL no responde en ${host}:${port}. Iniciando servicio silencioso...`);

    const pgExe = findPostgresExecutable();
    const dataDir = findPostgresDataDir();

    // Si NO está instalado en absoluto, ofrecer descarga e instalación desatendida
    if (!pgExe && !dataDir) {
        console.warn('[PostgreSQL Launcher] ⚠️ No se detectó ninguna instalación de PostgreSQL.');
        
        let shouldInstall = true;
        try {
            const { dialog } = require('electron');
            if (dialog && typeof dialog.showMessageBoxSync === 'function') {
                const response = dialog.showMessageBoxSync({
                    type: 'question',
                    buttons: ['Instalar PostgreSQL 16 y pgAdmin 4', 'Cancelar'],
                    defaultId: 0,
                    cancelId: 1,
                    title: 'PostgreSQL no detectado - Isaac POS',
                    message: 'Isaac POS requiere PostgreSQL 16 y pgAdmin 4 para almacenar y sincronizar sus datos.\n\nNo se detectó PostgreSQL instalado en este equipo.\n\n¿Deseas descargarlo e instalarlo automáticamente ahora?'
                });
                shouldInstall = (response === 0);
            }
        } catch (e) { }

        if (shouldInstall) {
            console.log('[PostgreSQL Launcher] 🚀 Iniciando instalador automatizado de PostgreSQL...');
            try {
                const scriptCandidates = [
                    path.join(__dirname, '..', 'scripts', 'instalar_postgresql.ps1'),
                    path.join(__dirname, '..', '..', 'instalar_postgresql.ps1'),
                    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'scripts', 'instalar_postgresql.ps1'),
                    'C:\\Users\\WDAGUtilityAccount\\Desktop\\IsaacPOS_Setup\\instalar_postgresql.ps1'
                ];
                
                let runScript = null;
                for (const sc of scriptCandidates) {
                    if (fs.existsSync(sc)) {
                        runScript = sc;
                        break;
                    }
                }

                const { execSync } = require('child_process');
                if (runScript) {
                    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList \\"-NoProfile -ExecutionPolicy Bypass -File \\\\\`"${runScript}\\\\\`"\\" -Verb RunAs -Wait"`);
                } else {
                    const inlineCmd = `$url='https://get.enterprisedb.com/postgresql/postgresql-16.15-3-windows-x64.exe'; $out=\\"$env:TEMP\\\\pg_inst.exe\\"; curl.exe -L -o $out $url --progress-bar; Start-Process $out -ArgumentList '--mode unattended --unattendedmodeui minimal --superpassword postgres --serverport 5432' -Wait; sc.exe config postgresql-x64-16 start= auto; net start postgresql-x64-16; & 'C:\\\\Program Files\\\\PostgreSQL\\\\16\\\\bin\\\\createdb.exe' -U postgres -h 127.0.0.1 -p 5432 americanpos`;
                    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList \\"-NoProfile -ExecutionPolicy Bypass -Command \\\\\`"${inlineCmd}\\\\\`"\\" -Verb RunAs -Wait"`);
                }

                // Poll for port 5432
                for (let i = 0; i < 40; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    if (await isPortOpen(host, port, 1000)) {
                        console.log(`[PostgreSQL Launcher] ✅ PostgreSQL instalado y listo en ${host}:${port}`);
                        return true;
                    }
                }
            } catch (instErr) {
                console.error('[PostgreSQL Launcher] Error ejecutando instalador:', instErr.message);
            }
        }
    }

    if (dataDir) {
        cleanStalePid(dataDir);
    }

    // MÉTODO 1: Iniciar Servicio Nativo de Windows (Máxima estabilidad)
    const knownServices = ['postgresql-x64-16', 'postgresql-x64-17', 'postgresql-x64-15', 'postgresql-x64-14', 'postgresql'];
    for (const sName of knownServices) {
        try {
            exec(`sc.exe config ${sName} start= auto`, { windowsHide: true }, () => {});
            exec(`net start ${sName}`, { windowsHide: true }, () => {});
            exec(`sc.exe start ${sName}`, { windowsHide: true }, () => {});
        } catch (e) {}
    }

    // Esperar activamente a que el Servicio de Windows responda en el puerto
    const startTime = Date.now();
    const serviceWaitLimitMs = Math.max(maxWaitSeconds * 1000, 25000);
    while (Date.now() - startTime < serviceWaitLimitMs) {
        await new Promise(r => setTimeout(r, 600));
        if (await isPortOpen(host, port, 500)) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[PostgreSQL Launcher] ✅ PostgreSQL iniciado mediante Servicio de Windows en ${host}:${port} (${elapsed}s).`);
            return true;
        }
    }

    // MÉTODO 2: Iniciar mediante pg_ctl oficial si el servicio de Windows no respondió
    const pgCtl = findPgCtlExecutable();
    if (pgCtl && dataDir) {
        cleanStalePid(dataDir);
        try {
            const logDir = path.join(dataDir, 'log');
            if (!fs.existsSync(logDir)) {
                try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
            }
            const logFile = path.join(logDir, 'server.log');
            const pgChild = spawn(pgCtl, ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '15'], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            pgChild.unref();

            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 1000));
                if (await isPortOpen(host, port, 500)) {
                    console.log(`[PostgreSQL Launcher] ✅ PostgreSQL iniciado mediante pg_ctl en ${host}:${port}.`);
                    return true;
                }
            }
        } catch (e) {
            console.warn('[PostgreSQL Launcher] Aviso ejecutando pg_ctl:', e.message);
        }
    }

    // Comprobación final
    const finalCheck = await isPortOpen(host, port, 1000);
    if (finalCheck) {
        console.log(`[PostgreSQL Launcher] ✅ PostgreSQL conectado y listo en ${host}:${port}.`);
        return true;
    }

    console.warn(`[PostgreSQL Launcher] ⚠️ Tiempo de espera agotado (${maxWaitSeconds}s) esperando a PostgreSQL en ${host}:${port}.`);
    return false;
}

module.exports = {
    isPortOpen,
    findPostgresExecutable,
    findPostgresDataDir,
    cleanStalePid,
    ensurePostgresRunning
};
