const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const { Client: PgClient } = require('pg');
const { BASE_PATH } = require('./paths');
const {
    defaultMachineMaterial,
    getOrCreateSharedDpapiAesKey,
    protectString,
    unprotectString
} = require('../utils/dpapiCrypto');

const CONFIG_FILE_PATH = path.join(BASE_PATH, 'db-config.json');
const DPAPI_KEY_FILE_PATH = path.join(BASE_PATH, '.dbcfg.key.dpapi');
const DB_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]{1,63}$/;

function getDbCryptoOptions() {
    const explicitKey = process.env.DB_CONFIG_KEY ? String(process.env.DB_CONFIG_KEY).trim() : '';
    return {
        keyFilePath: DPAPI_KEY_FILE_PATH,
        fallbackMaterial: explicitKey || defaultMachineMaterial(BASE_PATH, 'isaac-db-cfg-v1'),
        fallbackSalt: 'isaac-pos-dbcfg-salt-2026',
        skipIfEnvKey: true,
        allowSafeStorageFallback: true
    };
}

function encryptDbPassword(plainPassword) {
    const res = protectString(plainPassword, getDbCryptoOptions());
    return {
        passwordEncrypted: true,
        passwordEncScheme: res.scheme,
        passwordCipher: res.cipher
    };
}

function decryptDbPassword(fileConfig) {
    if (!fileConfig || typeof fileConfig !== 'object') return undefined;
    if (fileConfig.passwordEncScheme === 'empty') return '';

    if (fileConfig.passwordCipher && fileConfig.passwordEncScheme) {
        try {
            return unprotectString(fileConfig.passwordCipher, fileConfig.passwordEncScheme, getDbCryptoOptions());
        } catch (err) {
            if (fileConfig.passwordEncScheme === 'aes256gcm_dpapi') {
                throw new Error('Clave maestra DPAPI (.dbcfg.key.dpapi) no disponible para descifrar db-config.json');
            }
            if (fileConfig.passwordEncScheme === 'dpapi') {
                throw new Error('safeStorage DPAPI (solo Electron) no disponible para descifrar db-config.json legado desde Node puro');
            }
            throw err;
        }
    }

    if (fileConfig.password !== undefined) {
        return String(fileConfig.password);
    }
    return undefined;
}

const DEFAULT_CONFIG = {
    mode: 'server', // 'server' (localhost) o 'client' (terminal de venta LAN)
    dialect: 'postgres',
    host: '127.0.0.1',
    port: 5432,
    database: 'americanpos',
    user: 'postgres',
    password: 'postgres'
};

/**
 * Gestor Centralizado y Resiliente de Configuración de Base de Datos para Isaac POS.
 * Almacena y recupera los parámetros fuera del directorio empaquetado de la app (en %AppData%\isaac-pos),
 * cifrando credenciales con DPAPI (Electron safeStorage) o AES-256-GCM.
 */
class DbConfigManager {
    static getConfigFilePath() {
        return CONFIG_FILE_PATH;
    }

    static validateDatabaseName(dbName) {
        const name = String(dbName || '').trim();
        if (!DB_IDENTIFIER_REGEX.test(name)) {
            throw new Error(`Nombre de base de datos inválido: '${name}'. Solo se permiten letras, números y guión bajo (máx 63).`);
        }
        return name;
    }

    static toPublicConfig(cfg) {
        if (!cfg) return null;
        return {
            mode: cfg.mode,
            dialect: cfg.dialect || 'postgres',
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            user: cfg.user,
            hasPassword: Boolean(cfg.password),
            passwordEncrypted: true,
            updatedAt: cfg.updatedAt || null
        };
    }

    static getPublicConfig() {
        return this.toPublicConfig(this.getConfig());
    }

    /**
     * Carga la configuración activa de conexión.
     * Prioridad:
     * 1. Archivo en disco %AppData%\isaac-pos\db-config.json
     * 2. Variables de entorno process.env
     * 3. Valores por defecto seguros (127.0.0.1:5432)
     */
    static getConfig() {
        const isTestMode = process.env.ISAAC_TEST_ISOLATED === '1' || process.env.NODE_ENV === 'test';
        const explicitUserData = Boolean(process.env.USER_DATA_PATH);
        let fileConfig = {};
        let loadedFromPrimaryPath = false;
        let decryptedPassword;
        try {
            const candidatePaths = (isTestMode || explicitUserData)
                ? [CONFIG_FILE_PATH]
                : [
                    CONFIG_FILE_PATH,
                    path.join(process.env.APPDATA || '', 'isaac-pos', 'db-config.json'),
                    path.join(process.env.APPDATA || '', 'Isaac POS', 'db-config.json'),
                    path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'isaac-pos', 'db-config.json')
                ];
            for (const cPath of candidatePaths) {
                if (cPath && fs.existsSync(cPath)) {
                    const raw = fs.readFileSync(cPath, 'utf8');
                    fileConfig = JSON.parse(raw);
                    loadedFromPrimaryPath = path.resolve(cPath) === path.resolve(CONFIG_FILE_PATH);
                    break;
                }
            }
            decryptedPassword = decryptDbPassword(fileConfig);
        } catch (e) {
            console.warn('[DbConfigManager] Aviso leyendo db-config.json:', e.message);
        }

        const isClient = (fileConfig.mode || (process.env.POS_NODE_ROLE === 'LAN_SPOKE' ? 'client' : 'server')) === 'client';
        let resolvedHost = fileConfig.host !== undefined ? fileConfig.host : (process.env.DB_HOST || (isClient ? '' : DEFAULT_CONFIG.host));

        // Normalización IPv4: Si el host apunta al hostname de esta máquina o a 'localhost', forzar '127.0.0.1'
        if (resolvedHost && (resolvedHost.toLowerCase() === os.hostname().toLowerCase() || resolvedHost.toLowerCase() === 'localhost')) {
            resolvedHost = '127.0.0.1';
        }

        const forcedDb = process.env.DB_NAME_FORCE || (isTestMode && process.env.DB_NAME ? process.env.DB_NAME : '');
        const rawDatabase = forcedDb || fileConfig.database || process.env.DB_NAME || DEFAULT_CONFIG.database;
        const resolvedDatabase = this.validateDatabaseName(rawDatabase);
        if (isTestMode && resolvedDatabase === 'americanpos') {
            throw new Error('[DbConfigManager] Bloqueado: un entorno de test intentó usar la base de datos de producción "americanpos".');
        }

        const resolvedConfig = {
            mode: fileConfig.mode || (process.env.POS_NODE_ROLE === 'LAN_SPOKE' ? 'client' : 'server'),
            dialect: 'postgres',
            host: resolvedHost,
            port: parseInt(fileConfig.port || process.env.DB_PORT || DEFAULT_CONFIG.port, 10),
            database: resolvedDatabase,
            user: fileConfig.user || process.env.DB_USER || DEFAULT_CONFIG.user,
            password: decryptedPassword !== undefined
                ? decryptedPassword
                : (process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : DEFAULT_CONFIG.password),
            updatedAt: fileConfig.updatedAt || null
        };

        // Migración automática:
        // 1) Contraseña en texto plano -> esquema cifrado actual
        // 2) Esquema 'dpapi' exclusivo de Electron -> 'aes256gcm_dpapi' interoperable con Node puro (Edición Ultra)
        const needsPlainMigration = fileConfig.password !== undefined && !fileConfig.passwordEncrypted;
        const needsDpapiUpgrade = !isTestMode
            && fileConfig.passwordEncScheme === 'dpapi'
            && decryptedPassword !== undefined
            && getOrCreateSharedDpapiAesKey(DPAPI_KEY_FILE_PATH, { allowCreate: true, skipIfEnvKey: true }) !== null;
        if (loadedFromPrimaryPath && (needsPlainMigration || needsDpapiUpgrade)) {
            try {
                const enc = encryptDbPassword(resolvedConfig.password);
                const migratedDisk = {
                    mode: resolvedConfig.mode,
                    dialect: 'postgres',
                    host: resolvedConfig.host,
                    port: resolvedConfig.port,
                    database: resolvedConfig.database,
                    user: resolvedConfig.user,
                    ...enc,
                    updatedAt: new Date().toISOString()
                };
                const tempPath = `${CONFIG_FILE_PATH}.tmp`;
                fs.writeFileSync(tempPath, JSON.stringify(migratedDisk, null, 2), 'utf8');
                fs.renameSync(tempPath, CONFIG_FILE_PATH);
            } catch (_) {}
        }

        // Sincronizar variables de entorno para compatibilidad global con Sequelize y librerías heredadas
        this.applyToEnv(resolvedConfig);

        return resolvedConfig;
    }

    /**
     * Aplica la configuración a las variables de entorno de Node.js.
     */
    static applyToEnv(config) {
        process.env.DB_DIALECT = 'postgres';
        process.env.DB_HOST = config.host !== undefined ? config.host : (config.mode === 'client' ? '' : '127.0.0.1');
        process.env.DB_PORT = String(config.port || 5432);
        process.env.DB_NAME = config.database || 'americanpos';
        process.env.DB_USER = config.user || 'postgres';
        process.env.DB_PASSWORD = config.password || 'postgres';
        if (config.mode === 'client') {
            process.env.POS_NODE_ROLE = 'LAN_SPOKE';
        } else {
            process.env.POS_NODE_ROLE = 'MASTER_CLOUD_HUB';
        }
    }

    /**
     * Guarda la configuración de forma atómica cifrando la contraseña en el directorio de usuario (AppData).
     */
    static saveConfig(newConfig = {}) {
        try {
            if (!fs.existsSync(BASE_PATH)) {
                fs.mkdirSync(BASE_PATH, { recursive: true });
            }

            const current = this.getConfig();
            const targetDatabase = this.validateDatabaseName(
                newConfig.database !== undefined ? newConfig.database : current.database
            );

            const hasExplicitPassword = typeof newConfig.password === 'string' && newConfig.password.length > 0;
            const resolvedPassword = hasExplicitPassword
                ? newConfig.password
                : (newConfig.clearPassword === true ? '' : current.password);

            const merged = {
                ...current,
                ...newConfig,
                dialect: 'postgres',
                database: targetDatabase,
                port: parseInt(newConfig.port || current.port, 10),
                password: resolvedPassword,
                updatedAt: new Date().toISOString()
            };

            const encFields = encryptDbPassword(merged.password);
            const diskPayload = {
                mode: merged.mode,
                dialect: 'postgres',
                host: merged.host,
                port: merged.port,
                database: merged.database,
                user: merged.user,
                ...encFields,
                updatedAt: merged.updatedAt
            };

            const tempPath = `${CONFIG_FILE_PATH}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(diskPayload, null, 2), 'utf8');
            fs.renameSync(tempPath, CONFIG_FILE_PATH);

            this.applyToEnv(merged);
            console.log(`[DbConfigManager] Configuración cifrada guardada con éxito en: ${CONFIG_FILE_PATH} (${encFields.passwordEncScheme})`);
            return { success: true, config: merged, publicConfig: this.toPublicConfig(merged) };
        } catch (e) {
            console.error('[DbConfigManager] Error guardando db-config.json:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Prueba rápida de conexión PostgreSQL (timeout 3000ms).
     * No congela la app ni bloquea el proceso.
     */
    static async testConnection(candidateConfig = null) {
        const stored = this.getConfig();
        const config = candidateConfig ? {
            ...candidateConfig,
            password: (typeof candidateConfig.password === 'string' && candidateConfig.password.length > 0)
                ? candidateConfig.password
                : stored.password
        } : stored;
        const safeDb = this.validateDatabaseName(config.database || 'americanpos');
        const client = new PgClient({
            host: config.host || '127.0.0.1',
            port: parseInt(config.port || 5432, 10),
            database: safeDb,
            user: config.user || 'postgres',
            password: config.password || 'postgres',
            connectionTimeoutMillis: 3000
        });

        try {
            await client.connect();
            const res = await client.query('SELECT current_database() AS db, version() AS version, 1 AS alive');
            await client.end();
            return {
                success: true,
                message: `Conexión exitosa a la base de datos '${res.rows[0]?.db || safeDb}'`,
                database: res.rows[0]?.db,
                host: config.host,
                port: config.port
            };
        } catch (err) {
            try { await client.end(); } catch (_) { }
            return {
                success: false,
                error: err.message,
                code: err.code || 'CONNECTION_FAILED',
                host: config.host,
                port: config.port
            };
        }
    }

    /**
     * Descubrimiento P2P pasivo y activo en la red local.
     * Escucha durante timeoutMs en el puerto UDP 41234 para detectar heartbeats de la Caja Principal.
     */
    static discoverServer(timeoutMs = 3500) {
        return new Promise((resolve) => {
            const udpPort = 41234;
            let socket = null;
            let resolved = false;

            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                if (socket) {
                    try { socket.close(); } catch (_) { }
                }
                resolve(result);
            };

            const timer = setTimeout(() => {
                finish({ found: false, message: 'No se detectaron servidores Isaac POS activos en la red local en el tiempo límite.' });
            }, timeoutMs);

            try {
                socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

                socket.on('error', (err) => {
                    clearTimeout(timer);
                    finish({ found: false, error: err.message });
                });

                socket.on('message', (msg, rinfo) => {
                    try {
                        const data = JSON.parse(msg.toString());
                        if (data && data.type === 'LAN_HEARTBEAT' && data.ip) {
                            const secret = process.env.LAN_CLUSTER_SECRET || process.env.SYNC_SECRET_KEY;
                            if (!secret) {
                                return; // No procesar beacons si no hay clave de clúster configurada
                            }
                            // Validar ventana temporal anti-replay (máx 5 minutos)
                            const packetTs = Number(data.timestamp || 0);
                            if (!Number.isFinite(packetTs) || Math.abs(Date.now() - packetTs) > 5 * 60 * 1000) {
                                return;
                            }
                            // Validar IPv4 básica
                            const ipStr = String(data.ip).trim();
                            if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ipStr)) {
                                return;
                            }
                            const canonical = `${data.type}|${data.nodeId}|${data.ip}|${data.httpPort}|${data.role}|${data.timestamp}`;
                            const expectedSig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
                            const sigBuf = typeof data.sig === 'string' ? Buffer.from(data.sig, 'utf8') : null;
                            const expBuf = Buffer.from(expectedSig, 'utf8');
                            if (!sigBuf || sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                                return; // Ignorar beacon UDP sin firma HMAC válida en tiempo constante
                            }
                            clearTimeout(timer);
                            finish({
                                found: true,
                                serverIp: ipStr,
                                serverName: String(data.nodeName || 'Servidor Isaac POS').replace(/[<>"']/g, '').slice(0, 64),
                                role: data.role,
                                httpPort: Number(data.httpPort) || 3005,
                                dbPort: 5432,
                                discoveredFrom: rinfo.address
                            });
                        }
                    } catch (_) { }
                });

                socket.bind(udpPort, () => {
                    try { socket.setBroadcast(true); } catch (_) { }
                });
            } catch (err) {
                clearTimeout(timer);
                finish({ found: false, error: err.message });
            }
        });
    }
}

module.exports = DbConfigManager;
