const net = require('net');
const { spawn, exec, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const recentVerifiedHosts = new Map(); // "host:port" -> timestamp ms
const VERIFY_CACHE_TTL_MS = 15000;

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
 * Comprueba si el PID registrado en postmaster.pid corresponde a una instancia viva de PostgreSQL.
 * En Windows, `process.kill(pid, 0)` devuelve EPERM cuando el proceso pertenece a SYSTEM/NetworkService,
 * por lo que NUNCA debe interpretarse EPERM como proceso muerto.
 */
function isPostgresPidAlive(pid, { platform = process.platform, killFn = process.kill, execFileSyncFn = execFileSync } = {}) {
    if (!pid || Number.isNaN(Number(pid))) return false;

    if (platform === 'win32') {
        try {
            const out = execFileSyncFn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
                timeout: 2500,
                encoding: 'utf8',
                windowsHide: true
            });
            const normalized = String(out || '').trim().toLowerCase();
            if (normalized.includes('postgres')) {
                return true;
            }
            // Si tasklist respondió explícitamente sin registros para ese PID, confirmar con kill
            if (normalized.includes('informaci') || normalized.includes('no tasks')) {
                try {
                    killFn(pid, 0);
                    return false;
                } catch (killErr) {
                    return killErr && killErr.code === 'EPERM';
                }
            }
            // PID existe pero pertenece a otro ejecutable ajeno (PID reciclado)
            return false;
        } catch (_taskErr) {
            // Ante fallo consultando tasklist, usar process.kill tratando EPERM como proceso vivo (fail-safe)
            try {
                killFn(pid, 0);
                return true;
            } catch (killErr) {
                return Boolean(killErr && killErr.code === 'EPERM');
            }
        }
    }

    try {
        killFn(pid, 0);
        return true;
    } catch (killErr) {
        return Boolean(killErr && killErr.code === 'EPERM');
    }
}

/**
 * Cleans an orphaned postmaster.pid file ONLY if the recorded PID is genuinely dead/non-postgres.
 * @param {string} dataDir
 * @param {object} [opts]
 * @returns {boolean} true si se eliminó un pidfile huérfano
 */
function cleanStalePid(dataDir, opts = {}) {
    if (!dataDir) return false;
    const pidFile = path.join(dataDir, 'postmaster.pid');
    if (!fs.existsSync(pidFile)) return false;

    try {
        const content = fs.readFileSync(pidFile, 'utf8').split('\n');
        const pid = parseInt(content[0]?.trim(), 10);
        if (!pid || Number.isNaN(pid)) return false;

        if (isPostgresPidAlive(pid, opts)) {
            return false;
        }

        console.log(`[PostgreSQL Launcher] 🧹 Limpiando postmaster.pid huérfano (PID ${pid} inactivo o ajeno)...`);
        try {
            fs.unlinkSync(pidFile);
            return true;
        } catch (unErr) {
            console.warn('[PostgreSQL Launcher] No se pudo borrar postmaster.pid:', unErr.message);
            return false;
        }
    } catch (e) {
        console.warn('[PostgreSQL Launcher] Aviso verificando postmaster.pid:', e.message);
        return false;
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
    const cacheKey = `${host}:${port}`;
    const cachedAt = recentVerifiedHosts.get(cacheKey);
    if (cachedAt && (Date.now() - cachedAt) < VERIFY_CACHE_TTL_MS) {
        return true;
    }

    // 1. Check if already open (2 intentos cortos para evitar falsos negativos bajo picos de CPU/I/O)
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await isPortOpen(host, port, 1500)) {
            recentVerifiedHosts.set(cacheKey, Date.now());
            console.log(`[PostgreSQL Launcher] ✅ PostgreSQL ya está activo y escuchando en ${host}:${port}`);
            return true;
        }
        if (attempt === 0) {
            await new Promise(r => setTimeout(r, 250));
        }
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
                    path.join(process.resourcesPath || '', 'scripts', 'instalar_postgresql.ps1'),
                    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'scripts', 'instalar_postgresql.ps1'),
                    path.join(__dirname, '..', 'scripts', 'instalar_postgresql.ps1'),
                    path.join(__dirname, '..', '..', 'scripts', 'instalar_postgresql.ps1'),
                    path.join(__dirname, '..', '..', 'instalar_postgresql.ps1')
                ];
                
                let runScript = null;
                for (const sc of scriptCandidates) {
                    if (sc && fs.existsSync(sc)) {
                        runScript = sc;
                        break;
                    }
                }

                const { execSync } = require('child_process');
                if (!runScript) {
                    throw new Error('No se encontró scripts/instalar_postgresql.ps1 en la instalación para instalar PostgreSQL de forma verificada.');
                }
                execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList \\"-NoProfile -ExecutionPolicy Bypass -File \\\\\`"${runScript}\\\\\`"\\" -Verb RunAs -Wait"`);

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
            recentVerifiedHosts.set(cacheKey, Date.now());
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
                    recentVerifiedHosts.set(cacheKey, Date.now());
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
        recentVerifiedHosts.set(cacheKey, Date.now());
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
    isPostgresPidAlive,
    cleanStalePid,
    ensurePostgresRunning
};
