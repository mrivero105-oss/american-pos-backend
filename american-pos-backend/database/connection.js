const { Sequelize } = require('sequelize');
const { Client: PgClient } = require('pg');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { BASE_PATH } = require('../config/paths');
try {
    if (!fs.existsSync(BASE_PATH)) {
        fs.mkdirSync(BASE_PATH, { recursive: true });
    }
} catch (e) {
    console.warn('[DB] Warning ensuring BASE_PATH directory:', e.message);
}

const DbConfigManager = require('../config/dbConfigManager');
const telemetryCollector = require('../utils/telemetryCollector');
const activeDbConfig = DbConfigManager.getConfig();

try {
    console.log('\n--- DATABASE CONNECTION DEBUG ---');
    console.log('Dialect: postgres');
    console.log('Host/DB:', `${activeDbConfig.host || '127.0.0.1'}/${activeDbConfig.database || 'americanpos'}`);
    console.log('---------------------------------\n');
} catch (e) { /* ignore console errors in packaged app */ }

console.log(`[DB] Current Mode: ${!!process.env.USER_DATA_PATH ? 'Packaged/Production' : 'Development'}`);
console.log('[DB] Database Connection Dialect: postgres');
console.log(`[DB] Database Target Host: ${activeDbConfig.host}:${activeDbConfig.port} (${activeDbConfig.mode === 'client' ? 'Caja Secundaria / Terminal' : 'Servidor Local'})`);

function attachTenantRlsConnectionHook(sequelizeInstance) {
    if (!sequelizeInstance || sequelizeInstance.__isaacRlsHookAttached) return sequelizeInstance;
    if (typeof sequelizeInstance.getDialect === 'function' && sequelizeInstance.getDialect() !== 'postgres') {
        sequelizeInstance.__isaacRlsHookAttached = true;
        return sequelizeInstance;
    }
    const cm = sequelizeInstance.connectionManager;
    if (!cm || typeof cm.getConnection !== 'function') return sequelizeInstance;

    const { getCurrentTenantContext } = require('./tenantContext');
    const originalGetConnection = cm.getConnection.bind(cm);

    cm.getConnection = async function wrappedGetConnection(options) {
        const connection = await originalGetConnection(options);
        const ctx = getCurrentTenantContext();
        try {
            if (ctx && (ctx.companyId || ctx.isSuperAdmin)) {
                const targetKey = `${String(ctx.companyId || '')}|${String(ctx.userId || '')}|${ctx.isSuperAdmin ? '1' : '0'}`;
                if (connection.__isaacRlsKey !== targetKey) {
                    await connection.query(
                        "SELECT set_config('role', 'isaac_app', false), set_config('app.current_company_id', $1, false), set_config('app.current_user_id', $2, false), set_config('app.is_superadmin', $3, false)",
                        [String(ctx.companyId || ''), String(ctx.userId || ''), ctx.isSuperAdmin ? 'true' : 'false']
                    );
                    connection.__isaacRlsKey = targetKey;
                    connection.__isaacRlsDirty = true;
                }
            } else if (connection.__isaacRlsDirty) {
                await connection.query(
                    "SELECT set_config('role', 'none', false), set_config('app.current_company_id', '', false), set_config('app.current_user_id', '', false), set_config('app.is_superadmin', 'false', false)"
                );
                connection.__isaacRlsKey = null;
                connection.__isaacRlsDirty = false;
            }
        } catch (rlsErr) {
            connection.__isaacRlsKey = null;
            if (cm.releaseConnection) {
                try { cm.releaseConnection(connection); } catch (_) {}
            }
            throw rlsErr;
        }
        return connection;
    };

    sequelizeInstance.__isaacRlsHookAttached = true;
    return sequelizeInstance;
}

function initSequelize(customConfig = null) {
    const cfg = customConfig ? { ...customConfig } : DbConfigManager.getConfig();
    const resolvedHost = (cfg.host && (cfg.host.toLowerCase() === os.hostname().toLowerCase() || cfg.host.toLowerCase() === 'localhost'))
        ? '127.0.0.1'
        : (cfg.host || '127.0.0.1');

    return attachTenantRlsConnectionHook(new Sequelize(
        cfg.database || 'americanpos',
        cfg.user || 'postgres',
        cfg.password || 'postgres',
        {
            host: resolvedHost,
            port: parseInt(cfg.port || 5432, 10),
            dialect: 'postgres',
            benchmark: true,
            logging: (sql, timingMs) => {
                telemetryCollector.recordDbQuery(sql, timingMs);
            },
            isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
            pool: {
                max: 30,           // Optimizado para operaciones concurrentes multi-caja y comanderas móviles
                min: 3,            // Mantiene conexiones calientes listas
                acquire: 30000,    // 30s timeout para reportes e importaciones masivas
                idle: 10000,
                evict: 5000        // Purga conexiones obsoletas cada 5s
            },
            dialectOptions: {
                connectTimeout: 10000,
                keepAlive: true,
                statement_timeout: 30000,
                lock_timeout: 15000,
                idle_in_transaction_session_timeout: 60000
            },
            retry: {
                match: [
                    /SequelizeConnectionError/,
                    /SequelizeConnectionRefusedError/,
                    /SequelizeHostNotFoundError/,
                    /SequelizeHostNotReachableError/,
                    /SequelizeInvalidConnectionError/,
                    /SequelizeConnectionTimedOutError/,
                    /Connection terminated unexpectedly/,
                    /timeout/
                ],
                max: 3
            }
        }
    ));
}

let sequelize = initSequelize(activeDbConfig);

const {
    TARGET_SCHEMA_VERSION,
    repairSchema,
    migratePlaintextPasswords,
    runPostConnectMigrations
} = require('./schemaMigrator');

async function ensurePostgresDatabaseExists() {
    const cfg = DbConfigManager.getConfig();
    const dbName = cfg.database || process.env.DB_NAME || 'americanpos';
    let host = cfg.host || process.env.DB_HOST || '127.0.0.1';
    if (host.toLowerCase() === os.hostname().toLowerCase() || host.toLowerCase() === 'localhost') {
        host = '127.0.0.1';
    }
    const port = parseInt(cfg.port || process.env.DB_PORT || '5432', 10);
    const user = cfg.user || process.env.DB_USER || 'postgres';
    const password = cfg.password || process.env.DB_PASSWORD || '';

    try {
        const client = new PgClient({
            host,
            port,
            user,
            password,
            database: 'postgres',
            connectionTimeoutMillis: 5000
        });

        if (!/^[a-zA-Z0-9_]{1,63}$/.test(String(dbName || ''))) {
            throw new Error(`Nombre de base de datos inválido o inseguro: '${dbName}'. Solo se permiten letras, números y guión bajo.`);
        }
        await client.connect();
        const checkRes = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (checkRes.rowCount === 0) {
            console.log(`[DB] Base de datos '${dbName}' no existe en PostgreSQL. Creándola automáticamente...`);
            await client.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8';`);
            console.log(`[DB] ✅ Base de datos '${dbName}' creada exitosamente.`);
        }
        await client.end();
    } catch (err) {
        console.warn(`[DB] Verificación de base de datos '${dbName}': ${err.message}`);
    }
}

const connectDB = async () => {
    try {
        try {
            const { ensurePostgresRunning } = require('../utils/postgresLauncher');
            await ensurePostgresRunning();
        } catch (launcherErr) {
            console.warn('[DB] Warning checking PostgreSQL launcher:', launcherErr.message);
        }

        try {
            await ensurePostgresDatabaseExists();
        } catch (dbExistErr) {
            console.warn('[DB] Warning ensuring database exists:', dbExistErr.message);
        }

        // Autenticación resiliente con reintentos durante el arranque de PostgreSQL (código 57P03)
        let authenticated = false;
        let authAttempts = 0;
        const maxAuthAttempts = 30;
        while (!authenticated && authAttempts < maxAuthAttempts) {
            try {
                await sequelize.authenticate();
                authenticated = true;
            } catch (authErr) {
                authAttempts++;
                const isStartingUp = authErr.original?.code === '57P03' ||
                    (authErr.message && (authErr.message.includes('iniciándose') || authErr.message.includes('starting up') || authErr.message.includes('ECONNREFUSED')));
                if (authAttempts < maxAuthAttempts && isStartingUp) {
                    console.log(`[DB] Esperando inicialización del motor PostgreSQL (${authAttempts}/${maxAuthAttempts})...`);
                    await new Promise(r => setTimeout(r, 1000));
                } else if (authAttempts < maxAuthAttempts) {
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    const targetHost = process.env.DB_HOST || '127.0.0.1';
                    const targetPort = process.env.DB_PORT || 5432;
                    const cleanErr = new Error(`No se pudo conectar con el motor PostgreSQL en ${targetHost}:${targetPort}. ${authErr.message}`);
                    cleanErr.code = 'ERR_DB_UNREACHABLE';
                    cleanErr.host = targetHost;
                    cleanErr.port = targetPort;
                    cleanErr.originalError = authErr;
                    throw cleanErr;
                }
            }
        }

        console.log('[DB] Connection to postgres has been established successfully.');

        // Registrar modelos y asociaciones antes de sincronizar esquema
        require('./models');

        await runPostConnectMigrations(sequelize, 'postgres');

        try {
            const SettingsStoreService = require('../services/SettingsStoreService');
            await SettingsStoreService.hydrateAllFromDb();
        } catch (_hydrateErr) {
            // Non-blocking hydration fallback to atomic JSON
        }
    } catch (error) {
        console.error('❌ DATABASE CONNECTION ERROR:', error.message);
        throw error;
    }
};

function reconfigureDB(customConfig) {
    sequelize = initSequelize(customConfig);
    module.exports.sequelize = sequelize;
    return attachTenantRlsConnectionHook(sequelize);
}

module.exports = {
    sequelize,
    connectDB,
    initSequelize,
    reconfigureDB,
    repairSchema,
    TARGET_SCHEMA_VERSION
};
