const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { Client: PgClient } = require('pg');
const { BASE_PATH } = require('./paths');

const CONFIG_FILE_PATH = path.join(BASE_PATH, 'db-config.json');

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
 * Almacena y recupera los parámetros fuera del directorio empaquetado de la app (en %AppData%\isaac-pos).
 */
class DbConfigManager {
    static getConfigFilePath() {
        return CONFIG_FILE_PATH;
    }

    /**
     * Carga la configuración activa de conexión.
     * Prioridad:
     * 1. Archivo en disco %AppData%\isaac-pos\db-config.json
     * 2. Variables de entorno process.env
     * 3. Valores por defecto seguros (127.0.0.1:5432)
     */
    static getConfig() {
        let fileConfig = {};
        try {
            const candidatePaths = [
                CONFIG_FILE_PATH,
                path.join(process.env.APPDATA || '', 'isaac-pos', 'db-config.json'),
                path.join(process.env.APPDATA || '', 'Isaac POS', 'db-config.json'),
                path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'isaac-pos', 'db-config.json')
            ];
            for (const cPath of candidatePaths) {
                if (cPath && fs.existsSync(cPath)) {
                    const raw = fs.readFileSync(cPath, 'utf8');
                    fileConfig = JSON.parse(raw);
                    break;
                }
            }
        } catch (e) {
            console.warn('[DbConfigManager] Aviso leyendo db-config.json:', e.message);
        }

        const isClient = (fileConfig.mode || (process.env.POS_NODE_ROLE === 'LAN_SPOKE' ? 'client' : 'server')) === 'client';
        let resolvedHost = fileConfig.host !== undefined ? fileConfig.host : (process.env.DB_HOST || (isClient ? '' : DEFAULT_CONFIG.host));

        // Normalización IPv4: Si el host apunta al hostname de esta máquina o a 'localhost', forzar '127.0.0.1'
        // Esto evita que Node.js resuelva a una dirección IPv6 (fe80::) que PostgreSQL rechaza en pg_hba.conf
        const os = require('os');
        if (resolvedHost && (resolvedHost.toLowerCase() === os.hostname().toLowerCase() || resolvedHost.toLowerCase() === 'localhost')) {
            resolvedHost = '127.0.0.1';
        }

        const resolvedConfig = {
            mode: fileConfig.mode || (process.env.POS_NODE_ROLE === 'LAN_SPOKE' ? 'client' : 'server'),
            dialect: 'postgres',
            host: resolvedHost,
            port: parseInt(fileConfig.port || process.env.DB_PORT || DEFAULT_CONFIG.port, 10),
            database: fileConfig.database || process.env.DB_NAME || DEFAULT_CONFIG.database,
            user: fileConfig.user || process.env.DB_USER || DEFAULT_CONFIG.user,
            password: fileConfig.password !== undefined ? fileConfig.password : (process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : DEFAULT_CONFIG.password)
        };

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
     * Guarda la configuración de forma atómica en el directorio de usuario (AppData).
     */
    static saveConfig(newConfig) {
        try {
            if (!fs.existsSync(BASE_PATH)) {
                fs.mkdirSync(BASE_PATH, { recursive: true });
            }

            const current = this.getConfig();
            const merged = {
                ...current,
                ...newConfig,
                dialect: 'postgres',
                port: parseInt(newConfig.port || current.port, 10),
                updatedAt: new Date().toISOString()
            };

            const tempPath = `${CONFIG_FILE_PATH}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2), 'utf8');
            fs.renameSync(tempPath, CONFIG_FILE_PATH);

            this.applyToEnv(merged);
            console.log(`[DbConfigManager] Configuración guardada con éxito en: ${CONFIG_FILE_PATH}`);
            return { success: true, config: merged };
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
        const config = candidateConfig ? { ...candidateConfig } : this.getConfig();
        const client = new PgClient({
            host: config.host || '127.0.0.1',
            port: parseInt(config.port || 5432, 10),
            database: config.database || 'americanpos',
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
                message: `Conexión exitosa a la base de datos '${res.rows[0]?.db || config.database}'`,
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
                            const crypto = require('crypto');
                            const secret = process.env.LAN_CLUSTER_SECRET || 'isaac_pos_lan_cluster_hmac_v1';
                            const canonical = `${data.type}|${data.nodeId}|${data.ip}|${data.httpPort}|${data.role}|${data.timestamp}`;
                            const expectedSig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
                            if (!data.sig || data.sig !== expectedSig) {
                                return; // Ignorar beacon UDP sin firma HMAC válida
                            }
                            // Ignorar si el paquete viene de localhost en modo no servidor
                            clearTimeout(timer);
                            finish({
                                found: true,
                                serverIp: data.ip,
                                serverName: data.nodeName || 'Servidor Isaac POS',
                                role: data.role,
                                httpPort: data.httpPort || 3005,
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
