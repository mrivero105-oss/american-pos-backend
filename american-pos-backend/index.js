const path = require('path');
const fs = require('fs');
const os = require('os');

// Polyfill global fetch for Node 16 / Electron 22 environments (required by @google/generative-ai, pdf-parse, etc.)
if (typeof globalThis.fetch === 'undefined') {
    try {
        const nodeFetch = require('node-fetch');
        globalThis.fetch = nodeFetch;
        global.fetch = nodeFetch;
        if (!globalThis.Headers) globalThis.Headers = nodeFetch.Headers;
        if (!global.Headers) global.Headers = nodeFetch.Headers;
        if (!globalThis.Request) globalThis.Request = nodeFetch.Request;
        if (!global.Request) global.Request = nodeFetch.Request;
        if (!globalThis.Response) globalThis.Response = nodeFetch.Response;
        if (!global.Response) global.Response = nodeFetch.Response;
        console.log('[SYSTEM] Polyfilled global fetch using node-fetch');
    } catch (e) {
        // Fallback garantizado con Axios para Node 16 / Electron 22 en Windows 7/8.1
        try {
            const axios = require('axios');
            const axiosFetch = async (url, options = {}) => {
                const method = options.method || 'GET';
                const headers = options.headers || {};
                const res = await axios({
                    url,
                    method,
                    headers,
                    data: options.body,
                    validateStatus: () => true,
                    responseType: options.responseType || 'text'
                });
                return {
                    ok: res.status >= 200 && res.status < 300,
                    status: res.status,
                    statusText: res.statusText,
                    json: async () => typeof res.data === 'object' ? res.data : JSON.parse(res.data),
                    text: async () => typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
                    headers: {
                        get: (headerName) => res.headers[headerName.toLowerCase()] || null
                    }
                };
            };
            globalThis.fetch = axiosFetch;
            global.fetch = axiosFetch;
            console.log('[SYSTEM] Polyfilled global fetch using axios fallback for Node 16 / Electron 22');
        } catch (axiosErr) {
            console.warn('[SYSTEM] Warning: Could not polyfill global fetch:', axiosErr.message);
        }
    }
}


const handleEpipe = (err) => {
    if (err.code === 'EPIPE') return;
    throw err;
};
process.stdout.on('error', handleEpipe);
process.stderr.on('error', handleEpipe);

// GLOBAL CRASH PREVENTION
process.on('uncaughtException', (err) => {
    if (global.logger) {
        global.logger.error(`🔥 [CRITICAL] Uncaught Exception: ${err.message}\n${err.stack}`);
    } else {
        console.error('🔥 [CRITICAL] Uncaught Exception:', err.message, err.stack);
    }
    if (typeof process.send === 'function') {
        try { process.send({ type: 'CRITICAL_ERROR', error: err.message, stack: err.stack }); } catch (e) {}
    }
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    if (global.logger) {
        global.logger.error(`⚠️ [NON-FATAL REJECTION] Unhandled Rejection at: ${promise} reason: ${reason}`);
    } else {
        console.error('⚠️ [NON-FATAL REJECTION] Unhandled Rejection at:', promise, 'reason:', reason);
    }
    if (typeof process.send === 'function') {
        try { process.send({ type: 'NON_FATAL_ERROR', reason: String(reason) }); } catch (e) {}
    }
    // Servidor POS no se apaga ante fallos en promesas secundarias en segundo plano
});

// Global patch for console to prevent crashes when stdout/stderr are closed
const { formatLogMessage } = require('./utils/formatLogArgs');
const patchConsole = (method) => {
    const original = console[method];
    console[method] = (...args) => {
        try {
            original.apply(console, args);
            if (global.logger) {
                const msg = formatLogMessage(args);
                if (method === 'log') global.logger.info(msg);
                else if (global.logger[method]) global.logger[method](msg);
            }
        } catch (err) {
            if (err.code !== 'EPIPE') {
                // Ignore
            }
        }
    };
};
['log', 'error', 'warn', 'info', 'debug'].forEach(patchConsole);

// 🔒 CARGA RESILIENTE DE VARIABLES DE ENTORNO (.env local, AppData, y fallbacks de seguridad)
const loadEnvFile = (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return false;
    try {
        require('dotenv').config({ path: filePath });
        return true;
    } catch (dotenvErr) {
        try {
            const envLines = fs.readFileSync(filePath, 'utf8').split('\n');
            envLines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx > 0) {
                        const key = trimmed.substring(0, eqIdx).trim();
                        let val = trimmed.substring(eqIdx + 1).trim();
                        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                        if (!process.env[key]) process.env[key] = val;
                    }
                }
            });
            return true;
        } catch (e) {
            return false;
        }
    }
};

// 1. Cargar .env de desarrollo en la carpeta local del repositorio si existe (solo lectura)
const localRepoEnvPath = path.join(__dirname, '.env');
const hasLocalRepoEnv = fs.existsSync(localRepoEnvPath);
loadEnvFile(localRepoEnvPath);

// 2. Bóveda DPAPI + carga/migración de AppData/UserData (.env heredados pasan a secrets.vault.json cifrado)
// En tests aislados (ISAAC_TEST_ISOLATED=1 con USER_DATA_PATH dedicado), omitir AppData del usuario real.
const isTestIsolatedEnv = process.env.ISAAC_TEST_ISOLATED === '1' && Boolean(process.env.USER_DATA_PATH);
const cryptoNode = require('crypto');
const SecretVault = require('./config/secretVault');
const requiredBootSecrets = ['JWT_SECRET', 'SYNC_SECRET_KEY', 'BACKUP_ENCRYPTION_KEY', 'AUDIT_HMAC_SECRET'];

const resolveVaultBaseDir = () => {
    if (process.env.USER_DATA_PATH) {
        return process.env.USER_DATA_PATH.trim().replace(/^["']|["']$/g, '');
    }
    if (isTestIsolatedEnv || process.env.NODE_ENV === 'test') {
        return null;
    }
    if (process.platform === 'win32' && process.env.APPDATA) {
        return path.join(process.env.APPDATA, 'isaac-pos');
    }
    return null;
};

const vaultBaseDir = resolveVaultBaseDir();
const appDataEnvCandidates = (!isTestIsolatedEnv && process.platform === 'win32' && process.env.APPDATA)
    ? [
        path.join(process.env.APPDATA, 'isaac-pos', '.env'),
        path.join(process.env.APPDATA, 'Isaac POS', '.env'),
        path.join(process.env.APPDATA, 'americanpos', '.env')
    ]
    : [];
const userDataEnvPath = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH.trim().replace(/^["']|["']$/g, ''), '.env')
    : null;

const candidateEnvPaths = [
    ...(!isTestIsolatedEnv && hasLocalRepoEnv ? [localRepoEnvPath] : []),
    ...(userDataEnvPath ? [userDataEnvPath] : []),
    ...appDataEnvCandidates
];
const migrateEnvPaths = process.env.ISAAC_TEST_ISOLATED === '1'
    ? (userDataEnvPath ? [userDataEnvPath] : [])
    : [
        ...(userDataEnvPath ? [userDataEnvPath] : []),
        ...appDataEnvCandidates
    ];

if (vaultBaseDir) {
    try {
        SecretVault.provisionAndLoadSecrets({
            baseDir: vaultBaseDir,
            requiredKeys: process.env.ISAAC_TEST_ISOLATED === '1' ? [] : requiredBootSecrets,
            candidateEnvPaths,
            migrateEnvPaths,
            stripMigratedEnv: true
        });
    } catch (vaultErr) {
        console.warn('[SECURITY] Aviso cargando bóveda DPAPI:', vaultErr.message);
        for (const p of candidateEnvPaths) loadEnvFile(p);
    }
}

for (const envKey of requiredBootSecrets) {
    if (!process.env[envKey] || String(process.env[envKey]).trim().length === 0) {
        process.env[envKey] = cryptoNode.randomBytes(32).toString('hex');
        console.warn(`[SECURITY] ${envKey} generado en memoria para la sesión actual.`);
    }
}
if (!process.env.PORT) {
    process.env.PORT = '3005,5005,8080';
}
if (!process.env.DB_DIALECT) {
    process.env.DB_DIALECT = 'postgres';
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { verifyToken, isSuperAdmin } = require('./middleware/auth');
const { verifyLicense } = require('./middleware/licenseMiddleware');
const cookieParser = require('cookie-parser');
const logger = require('./utils/logger');
global.logger = logger;

// High-speed lazy router loader: delays heavy file imports and dependency trees until first request
const lazyRouter = (routePath) => {
    let routerInstance = null;
    return (req, res, next) => {
        if (!routerInstance) {
            routerInstance = require(routePath);
        }
        return routerInstance(req, res, next);
    };
};

// Eager load routers that instantiate express-rate-limit at module init (required by express-rate-limit v7+)
const authRoutes = require('./routes/auth');
const productRoutes = lazyRouter('./routes/products');
const salesRoutes = lazyRouter('./routes/sales');
const customerRoutes = lazyRouter('./routes/customers');
const supplierRoutes = lazyRouter('./routes/suppliers');
const cashRoutes = lazyRouter('./routes/cash');
const reportRoutes = lazyRouter('./routes/reports');
const settingRoutes = lazyRouter('./routes/settings');

const purchaseOrderRoutes = lazyRouter('./routes/purchaseOrders');
const refundRoutes = lazyRouter('./routes/refunds');
const userRoutes = lazyRouter('./routes/users');
const backupRoutes = lazyRouter('./routes/backup');
const debugRoutes = lazyRouter('./routes/debug');
const licenseRoutes = require('./routes/license');
const expenseRoutes = lazyRouter('./routes/expenses');
const serviceRoutes = lazyRouter('./routes/services');

const branchesRoutes = lazyRouter('./routes/branches');
const quotationRoutes = lazyRouter('./routes/quotations');
const deliveryNoteRoutes = lazyRouter('./routes/deliveryNotes');
const auditRoutes = lazyRouter('./routes/audit');
const stockIntelligenceRoutes = lazyRouter('./routes/stockIntelligence');
const catalogRoutes = lazyRouter('./routes/catalog');
const aiRoutes = lazyRouter('./routes/ai');
const messageRoutes = lazyRouter('./routes/messages');
const systemRoutes = lazyRouter('./routes/system');
const fiscalRoutes = lazyRouter('./routes/fiscal');
const warehousesRoutes = lazyRouter('./routes/warehouses');
const biRoutes = lazyRouter('./routes/executiveBI');
const accountingRoutes = lazyRouter('./routes/accounting');
const payrollRoutes = lazyRouter('./routes/payroll');
const productionRoutes = lazyRouter('./routes/production');
const collectionsRoutes = lazyRouter('./routes/collections');
const fixedAssetsRoutes = lazyRouter('./routes/fixedAssets');
const promotionsRoutes = lazyRouter('./routes/promotions');
const stockAlertsRoutes = lazyRouter('./routes/stockAlerts');
const whatsappRoutes = lazyRouter('./routes/whatsapp');
const scannerRoutes = lazyRouter('./routes/scanner');
const syncRoutes = lazyRouter('./routes/sync');
const lanClusterRoutes = lazyRouter('./routes/lanCluster');
const publicCatalogRoutes = lazyRouter('./routes/publicCatalog');
const publicAiRoutes = require('./routes/publicAi');
const rechargesRoutes = lazyRouter('./routes/recharges');
const lotsRoutes = lazyRouter('./routes/lots');

// serveDynamicImages function removed to prevent directory traversal vulnerabilities

const startServer = (ports, userDataPath = null) => {
    return new Promise(async (resolve, reject) => {
        const portList = Array.isArray(ports) ? ports : [ports];
        const servers = [];

        try {
            console.log('--- STARTUP SEQUENCE INITIATED ---');
            const resolvedUserData = typeof userDataPath === 'string'
                ? userDataPath.trim()
                : (userDataPath && typeof userDataPath === 'object' && typeof userDataPath.userDataPath === 'string'
                    ? userDataPath.userDataPath.trim()
                    : '');
            if (resolvedUserData) {
                process.env.USER_DATA_PATH = resolvedUserData;
            }

            // High-Speed Database Pipeline in background (Non-blocking)
            let dbReady = false;
            let dbError = null;

            async function initDatabasePipeline() {
                try {
                    console.log('⚡ [DB Pipeline] Conectando base de datos en segundo plano...');
                    const { connectDB } = require('./database/connection');
                    await connectDB();
                    console.log('✅ [DB Pipeline] Base de datos conectada.');

                    const { runMigrations } = require('./database/migrate');
                    await runMigrations();
                    console.log('✅ [DB Pipeline] Automigraciones completadas.');
                    dbReady = true;
                    dbError = null;
                    return true;
                } catch (err) {
                    dbError = err;
                    dbReady = false;
                    console.error('❌ [DB Pipeline] Error en base de datos:', err);
                    return false;
                }
            }

            let dbInitPromise = initDatabasePipeline();

            const waitForDb = async (req, res, next) => {
                if (dbReady) return next();

                if (dbInitPromise) {
                    await dbInitPromise;
                    if (dbReady) return next();
                }

                // Reintento resiliente bajo demanda si la inicialización inicial falló
                console.log('🔄 [DB Pipeline] Reintentando conexión con base de datos bajo demanda...');
                dbInitPromise = initDatabasePipeline();
                await dbInitPromise;

                if (dbReady) return next();

                return res.status(503).json({
                    error: 'Base de datos temporalmente no disponible',
                    details: dbError ? dbError.message : 'Error conectando a PostgreSQL'
                });
            };

            const app = express();

            // Enterprise APM Telemetry Middleware (p50/p95/p99 latencia HTTP, ring-buffer acotado)
            const telemetryCollector = require('./utils/telemetryCollector');
            app.use(telemetryCollector.middleware());

            // Basic Request Logger (redacta parámetros sensibles en query string)
            app.use((req, res, next) => {
                const sanitizedUrl = String(req.url || '').replace(/([?&](?:token|sync_key|key|secret|password|pin)=)[^&]+/gi, '$1[REDACTED]');
                logger.info(`[${req.method}] ${sanitizedUrl}`);
                next();
            });

            // HTTPS Enforcement (Bypassed for local development, NetBIOS/mDNS hostnames and private LAN networks)
            app.use((req, res, next) => {
                const rawHost = req.hostname || req.headers.host || '';
                const host = rawHost.split(':')[0].toLowerCase();
                const myHost = os.hostname().toLowerCase();

                const isLocalOrLan = !host || 
                    host === 'localhost' || 
                    host === '127.0.0.1' || 
                    host === '::1' ||
                    host === myHost ||
                    host === `${myHost}.local` ||
                    !host.includes('.') ||              // Hostnames locales / NetBIOS de Windows (ej: "Manuel", "SERVIDOR-POS")
                    host.endsWith('.local') ||          // Dominios mDNS locales
                    host.endsWith('.lan') ||
                    host.endsWith('.home') ||
                    host.startsWith('fe80:') ||         // IPv6 Link-Local
                    /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);

                if (process.env.NODE_ENV === 'production' && !req.secure && !isLocalOrLan && Boolean(process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH)) {
                    const reqHost = req.headers.host || host;
                    return res.redirect(`https://${reqHost}${req.url}`);
                }
                next();
            });

            // Middleware - Security Headers (CSP compatible con React/Vite/Tailwind/Socket.IO/Electron/LAN)
            app.use(helmet({
                contentSecurityPolicy: {
                    directives: {
                        defaultSrc: ["'self'"],
                        scriptSrc: ["'self'", "'unsafe-inline'"],
                        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
                        imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
                        connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"],
                        mediaSrc: ["'self'", "data:", "blob:"],
                        workerSrc: ["'self'", "blob:"],
                        objectSrc: ["'none'"],
                        baseUri: ["'self'"],
                        formAction: ["'self'"],
                        frameAncestors: ["'none'"],
                        upgradeInsecureRequests: null
                    }
                },
                crossOriginResourcePolicy: { policy: "cross-origin" },
                crossOriginOpenerPolicy: false,
                originAgentCluster: false,
                hsts: {
                    maxAge: 31536000, // 1 year
                    includeSubDomains: true,
                    preload: true
                },
                frameguard: {
                    action: 'deny'
                },
                referrerPolicy: {
                    policy: 'strict-origin-when-cross-origin'
                },
                noSniff: true
            }));
            const allowedOrigins = process.env.ALLOWED_ORIGINS 
                ? process.env.ALLOWED_ORIGINS.split(',') 
                : [
                    'http://localhost:5173',
                    'http://localhost:5174',
                    'http://localhost:5175',
                    'http://127.0.0.1:5173',
                    'http://127.0.0.1:5174',
                    'http://127.0.0.1:5175',
                    'app://.',
                    'capacitor://localhost',
                    'http://localhost'
                ];

            // Registrar dinámicamente los propios puertos del servidor en allowedOrigins
            portList.forEach(port => {
                allowedOrigins.push(`http://localhost:${port}`);
                allowedOrigins.push(`http://127.0.0.1:${port}`);
            });

            const isOriginAllowed = (origin, callback) => {
                if (!origin) return callback(null, true);
                const originLower = origin.toLowerCase();
                const myHost = os.hostname().toLowerCase();

                if (allowedOrigins.includes(origin) || 
                    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) || 
                    origin.startsWith('app://') || 
                    origin.startsWith('capacitor://')) {
                    return callback(null, true);
                }
                if (originLower.includes('//' + myHost + ':') || originLower.endsWith('//' + myHost) ||
                    originLower.includes('//' + myHost + '.local:') || originLower.endsWith('//' + myHost + '.local')) {
                    return callback(null, true);
                }
                if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin)) {
                    return callback(null, true);
                }
                if (/^https?:\/\/[a-z0-9_-]+\.(local|lan|home|internal)(:\d+)?$/i.test(originLower)) {
                    return callback(null, true);
                }
                logger.warn(`[CORS REJECTED] Origin no autorizado bloqueado: ${origin}`);
                return callback(null, false);
            };

            const corsOptions = {
                origin: isOriginAllowed,
                credentials: true,
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
                allowedHeaders: [
                    'Content-Type', 'Authorization', 'x-company-id', 'X-Company-Id', 
                    'x-admin-token', 'X-Admin-Token', 'Accept', 'Origin', 'X-Requested-With',
                    'x-sync-key', 'X-Sync-Key',
                    'x-terminal-id', 'X-Terminal-Id',
                    'x-sync-timestamp', 'X-Sync-Timestamp', 'x-sync-signature', 'X-Sync-Signature',
                    'x-signature', 'X-Signature', 'x-timestamp', 'X-Timestamp',
                    'x-signature-timestamp', 'X-Signature-Timestamp'
                ],
                exposedHeaders: ['Content-Disposition'],
                optionsSuccessStatus: 200
            };

            app.use(cors(corsOptions));
            app.options('/{*splat}', cors(corsOptions));
            app.use(cookieParser());
            app.use(compression());

            const isLocalOrLanIp = (ip) => {
                if (!ip) return false;
                const cleanIp = ip.replace('::ffff:', '');
                return cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost' ||
                    /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(cleanIp);
            };

            const isLoopbackIp = (ip) => {
                if (!ip) return false;
                const cleanIp = ip.replace('::ffff:', '');
                return cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost' || cleanIp.startsWith('127.');
            };

            // 🛡️ SEGURIDAD: Rate Limiting para Autenticación (/auth/login y /auth/register)
            // Loopback local (Electron en el POS maestro) está exento.
            // Nodos en la red LAN (tablets, teléfonos móviles) tienen una cuota protectora de 100 intentos / 15 min
            // para bloquear ataques de fuerza bruta y rociado de contraseñas (Password Spraying).
            const authLimiter = rateLimit({
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: 100, // Techo seguro para operación de cajas móviles en LAN
                message: {
                    error: 'Demasiados intentos de autenticación desde esta dirección IP. Por favor, espere 15 minutos.'
                },
                standardHeaders: true,
                legacyHeaders: false,
                skip: (req) => isLoopbackIp(req.ip)
            });

            // Apply rate limiting to auth routes
            app.use('/auth/login', authLimiter);
            app.use('/auth/register', authLimiter);
            app.use('/auth/quick-unlock', authLimiter);
            app.use('/auth/biometrics/login', authLimiter);
            app.use('/auth/supervisor-authorize', authLimiter);
            app.use('/auth/supervisor_authorize', authLimiter);

            // Global Rate Limiter
            const globalLimiter = rateLimit({
                windowMs: 15 * 60 * 1000,
                max: 50000, // High ceiling for high-speed batch image downloads
                message: { error: 'Demasiadas peticiones desde esta IP. Por favor, espere 15 minutos.' },
                standardHeaders: true,
                legacyHeaders: false,
                skip: (req) => {
                    if (isLoopbackIp(req.ip)) return true;
                    if (req.path.startsWith('/product_images') || 
                        req.path.startsWith('/uploads') || 
                        req.path.startsWith('/supplier_logos') || 
                        req.path.startsWith('/invoices') || 
                        req.path.startsWith('/assets') ||
                        req.path.startsWith('/sync') ||
                        req.path.startsWith('/messages') ||
                        req.path.startsWith('/dist.zip') ||
                        req.path.startsWith('/Isaac-POS-Mobile.apk') ||
                        req.path.startsWith('/Isaac-POS.apk') ||
                        req.path.startsWith('/version.json') ||
                        req.path.startsWith('/api/app-update-info')) {
                        return true;
                    }
                    return false;
                }
            });
            app.use(globalLimiter);

            // Excepciones paginadas para rutas de sincronización y envío de facturas por WhatsApp (Mitigación DoS RAM)
            app.use('/whatsapp', express.json({ limit: '15mb' }));
            app.use('/sales/public-sync', express.json({ limit: '3mb' }));
            app.use('/catalog', express.json({ limit: '3mb' }));

            // Límite global restrictivo para prevenir DoS
            app.use(express.json({ limit: '2mb' }));
            app.use(express.urlencoded({ extended: true, limit: '2mb' }));

            // Detectar si la aplicación se ejecuta dentro de Electron y si está empaquetada
            let isPackaged = false;
            try {
                if (process.versions && process.versions.electron) {
                    const { app: electronApp } = require('electron');
                    isPackaged = electronApp.isPackaged;
                }
            } catch (e) {
                // No estamos en el entorno de Electron o no se puede cargar el módulo
            }

            // Static files - Prefer live synced public/ next to executable if present, then packed/unpacked paths
            const execPublicPath = process.execPath ? path.join(path.dirname(process.execPath), 'public') : null;
            let staticPath = (execPublicPath && fs.existsSync(path.join(execPublicPath, 'index.html')))
                ? execPublicPath
                : path.join(__dirname, 'public');
            if (!fs.existsSync(staticPath) && isPackaged) {
                staticPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'public');
            }

            const safeStaticMimeTypes = (req, res, next) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') return next();
                const lowerPath = String(req.path || '').toLowerCase();
                // Bloquear acceso público directo a herramientas administrativas de licenciamiento en /public
                if (lowerPath.includes('generador-licencias') || lowerPath.includes('pocket-license')) {
                    return res.status(403).json({ error: 'Acceso restringido. Utilice la ruta autenticada correspondiente.' });
                }
                const ext = path.extname(req.path).toLowerCase();
                if (ext) {
                    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.csv', '.xlsx', '.css', '.js', '.html', '.svg', '.woff', '.woff2', '.ttf', '.zip', '.json', '.ico', '.apk'];
                    if (!allowedExts.includes(ext)) {
                        return res.status(403).json({ error: 'Tipo de archivo estático no permitido' });
                    }
                }
                res.setHeader('X-Content-Type-Options', 'nosniff');
                next();
            };

            const safeUserMediaMimeTypes = (req, res, next) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') return next();
                const ext = path.extname(req.path).toLowerCase();
                const allowedMediaExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
                if (!ext || !allowedMediaExts.includes(ext)) {
                    return res.status(403).json({ error: 'Tipo de archivo multimedia no permitido' });
                }
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
                next();
            };

            // Endpoints directos para OTA móvil (version.json, dist.zip) y descarga del APK en LAN.
            // Se registran ANTES de express.static(staticPath) para respetar la prioridad:
            // %APPDATA%/isaac-pos/mobile-ota -> resources/mobile-ota (extraResources) -> staticPath/public.
            const { resolveMobileDistributionFile } = require('./utils/mobileDistributionPaths');

            app.get('/version.json', (req, res) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                const target = resolveMobileDistributionFile('version.json', { staticPath, baseDir: __dirname });
                if (target) return res.sendFile(target);
                res.status(404).json({ error: 'version.json no encontrado' });
            });

            app.get('/dist.zip', (req, res) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                const target = resolveMobileDistributionFile('dist.zip', { staticPath, baseDir: __dirname });
                if (target) {
                    res.setHeader('Content-Type', 'application/zip');
                    return res.sendFile(target);
                }
                res.status(404).json({ error: 'dist.zip no encontrado' });
            });

            app.get(['/Isaac-POS-Mobile.apk', '/Isaac-POS.apk', '/Isaac%20POS%20Mobile.apk'], (req, res) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                const target = resolveMobileDistributionFile(['Isaac-POS-Mobile.apk', 'Isaac-POS.apk'], { staticPath, baseDir: __dirname });
                if (target) {
                    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
                    return res.download(target, 'Isaac-POS-Mobile.apk');
                }
                res.status(404).json({ error: 'Isaac-POS-Mobile.apk no encontrado' });
            });

            app.use(safeStaticMimeTypes, express.static(staticPath, {
                etag: true,
                lastModified: true,
                setHeaders: (res, filePath) => {
                    const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
                    const isImmutableAsset = (
                        normalized.includes('/assets/') &&
                        /-[a-z0-9_-]{6,16}\.(js|css|png|jpg|jpeg|webp|svg|woff|woff2|ttf)$/i.test(normalized)
                    ) || normalized.includes('/fonts/');

                    if (isImmutableAsset) {
                        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                    } else {
                        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                        res.setHeader('Pragma', 'no-cache');
                        res.setHeader('Expires', '0');
                    }
                }
            }));

            // Fallback resiliente para /assets/: si un cliente o ServiceWorker tiene un index.html en caché con hashes previos,
            // servir automáticamente el chunk equivalente más reciente para evitar pantallas en blanco (404).
            app.get('/assets/:assetFile', (req, res, next) => {
                try {
                    const requested = req.params.assetFile || '';
                    const match = requested.match(/^([A-Za-z0-9_-]+)-[A-Za-z0-9_-]{6,12}\.(js|css)$/);
                    if (!match) return res.status(404).end();
                    const prefix = `${match[1]}-`;
                    const ext = `.${match[2]}`;
                    const assetsDir = path.join(staticPath, 'assets');
                    if (!fs.existsSync(assetsDir)) return res.status(404).end();

                    const candidates = fs.readdirSync(assetsDir)
                        .filter(f => f.startsWith(prefix) && f.endsWith(ext))
                        .map(f => {
                            const full = path.join(assetsDir, f);
                            return { file: full, mtime: fs.statSync(full).mtimeMs };
                        })
                        .sort((a, b) => b.mtime - a.mtime);

                    if (candidates.length > 0) {
                        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                        return res.sendFile(candidates[0].file);
                    }
                    return res.status(404).end();
                } catch (e) {
                    return res.status(404).end();
                }
            });

            app.use('/uploads', safeUserMediaMimeTypes, express.static(path.join(staticPath, 'uploads')));
            
            // Serve all existing media paths without crear directorios legacy vacíos en cada arranque
            const getValidCandidatePaths = (subfolder) => {
                const primaryUserDataDir = process.env.USER_DATA_PATH
                    ? path.join(process.env.USER_DATA_PATH, subfolder)
                    : path.join(__dirname, subfolder);
                if (!fs.existsSync(primaryUserDataDir)) {
                    try { fs.mkdirSync(primaryUserDataDir, { recursive: true }); } catch (e) {}
                }

                const candidates = [
                    primaryUserDataDir,
                    path.join(__dirname, subfolder),
                    isPackaged ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'isaacpos', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'american-pos-backend', subfolder) : null,
                ].filter(Boolean);

                return [...new Set(candidates)].filter(p => fs.existsSync(p));
            };

            const productImagesDirs = getValidCandidatePaths('product_images');
            productImagesDirs.forEach(dir => {
                app.use('/product_images', safeUserMediaMimeTypes, express.static(dir));
            });

            const supplierLogosDirs = getValidCandidatePaths('supplier_logos');
            supplierLogosDirs.forEach(dir => {
                app.use('/supplier_logos', safeUserMediaMimeTypes, express.static(dir));
            });

            const invoicesDirs = getValidCandidatePaths('invoices');
            const InvoiceService = require('./services/InvoiceService');
            const verifyInvoiceAccess = async (req, res, next) => {
                try {
                    const check = await InvoiceService.assertInvoiceAccess(req.user, req.path);
                    if (!check.allowed) {
                        return res.status(check.status || 403).json({ error: check.error || 'Acceso denegado a esta factura' });
                    }
                    return next();
                } catch (invErr) {
                    return res.status(403).json({ error: 'No autorizado para acceder a esta factura' });
                }
            };
            invoicesDirs.forEach(dir => {
                app.use('/invoices', verifyToken, verifyInvoiceAccess, safeUserMediaMimeTypes, express.static(dir));
            });

            const displayAdsDirs = getValidCandidatePaths('display_ads');
            displayAdsDirs.forEach(dir => {
                app.use('/display_ads', safeUserMediaMimeTypes, express.static(dir));
            });

            // Routes
            app.get('/', (req, res) => {
                if (req.headers.accept && req.headers.accept.includes('text/html')) {
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                    return res.sendFile(path.join(staticPath, 'index.html'));
                }
                res.json({
                    status: 'online',
                    service: 'isaac-pos-backend',
                    message: 'Isaac POS API Server Running',
                    timestamp: new Date().toISOString()
                });
            });

            // SPA Direct Browser Navigation for Mobile & Desktop
            app.get(['/mobile', '/mobile-pos', '/login', '/pos', '/dashboard', '/inventory', '/customers', '/sales-history', '/sales-manager', '/cash-register', '/recharges', '/display', '/customer-display', '/store{*splat}'], (req, res, next) => {
                // If it's an API request (requesting JSON, AJAX, or carrying auth/sync tokens), pass through to API routes
                const isApiRequest = req.headers.authorization || req.headers['x-sync-key'] || req.xhr || req.headers['x-requested-with'] || (req.headers.accept?.includes('application/json') && !req.headers.accept?.includes('text/html'));
                if (isApiRequest) {
                    return next();
                }
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                return res.sendFile(path.join(staticPath, 'index.html'));
            });

            // Endpoint de Información para Actualizaciones OTA (Capacitor Updater)
            app.get('/api/app-update-info', (req, res) => {
                try {
                    const versionFile = resolveMobileDistributionFile('version.json', { staticPath, baseDir: __dirname });
                    if (versionFile) {
                        const content = fs.readFileSync(versionFile, 'utf8');
                        const data = JSON.parse(content);
                        return res.json({
                            status: 'ok',
                            ...data
                        });
                    }
                    res.json({
                        status: 'ok',
                        version: '24.04.0.0',
                        bundleUrl: '/dist.zip',
                        apkUrl: '/Isaac-POS-Mobile.apk'
                    });
                } catch (e) {
                    res.status(500).json({ error: 'Error al consultar versión de actualización' });
                }
            });

            // Redirección directa para Visor de Cliente en segundo dispositivo
            app.get(['/display', '/customer-display'], (req, res) => {
                res.redirect('/#/display');
            });
            app.get('/hello', (req, res) => {
                const os = require('os');
                const interfaces = os.networkInterfaces();
                const localIps = [];
                for (const name of Object.keys(interfaces)) {
                    for (const iface of interfaces[name]) {
                        if ('IPv4' === iface.family && !iface.internal) {
                            localIps.push(iface.address);
                        }
                    }
                }
                res.json({
                    status: 'ready',
                    server: 'isaac-pos',
                    hostname: os.hostname(),
                    role: process.env.POS_NODE_ROLE || 'MASTER_CLOUD_HUB',
                    ips: localIps,
                    dbDialect: process.env.DB_DIALECT || 'postgres',
                    dbReady,
                    timestamp: Date.now()
                });
            });
            app.get(['/api/time', '/time'], (req, res) => res.json({
                success: true,
                timestamp: Date.now(),
                iso: new Date().toISOString()
            }));
            app.get('/health', verifyToken, isSuperAdmin, (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
            app.use('/auth', waitForDb, authRoutes);
            app.use('/license', waitForDb, licenseRoutes);
            app.use('/public-catalog', waitForDb, publicCatalogRoutes);
            app.use('/ai/public-query', waitForDb, publicAiRoutes);
            // Middleware de autenticación dual para nodos de sincronización LAN y terminales móviles
            const verifySyncOrToken = (req, res, next) => {
                const { runWithTenantContext } = require('./database/tenantContext');
                const authHeader = req.headers['authorization'];
                if ((authHeader && authHeader.startsWith('Bearer ')) || (req.cookies && req.cookies.authToken)) {
                    return verifyToken(req, res, next);
                }
                const syncKey = String(req.headers['x-sync-key'] || req.headers['X-Sync-Key'] || '');
                const expectedKey = String(process.env.SYNC_SECRET_KEY || '');
                if (syncKey && expectedKey) {
                    const crypto = require('crypto');
                    const hashA = crypto.createHash('sha256').update(syncKey, 'utf8').digest();
                    const hashB = crypto.createHash('sha256').update(expectedKey, 'utf8').digest();
                    if (crypto.timingSafeEqual(hashA, hashB)) {
                        const syncCompanyId = String(process.env.DEFAULT_COMPANY_ID || '2');
                        req.user = {
                            id: 'sync-node',
                            role: 'terminal_presale',
                            isSyncNode: true,
                            companyId: syncCompanyId,
                            permissions: {
                                canAccessPOS: true,
                                canSyncCatalog: true,
                                canViewCosts: false
                            }
                        };
                        return runWithTenantContext({
                            companyId: syncCompanyId,
                            userId: 'sync-node',
                            isSuperAdmin: false
                        }, () => next());
                    }
                }
                return res.status(401).json({ error: 'Acceso no autorizado a sincronización. Se requiere token Bearer o clave de sincronización autorizada.' });
            };

            app.get('/lan/peers', verifySyncOrToken, (req, res) => {
                const LANClusterService = require('./services/LANClusterService');
                const topology = LANClusterService.getClusterTopology();
                const userCompanyId = String(req.user?.companyId || 'default');
                const userRole = String(req.user?.role || '').toLowerCase();
                if (userRole !== 'superadmin' && Array.isArray(topology.peers)) {
                    topology.peers = topology.peers.filter(p => !p.companyId || String(p.companyId) === userCompanyId);
                    topology.clusterSize = topology.peers.length + (topology.localNode ? 1 : 0);
                }
                res.json({ success: true, ...topology });
            });

            // Helper para resolver estrictamente la empresa autorizada del usuario sin cruzar datos de otros tenants
            const resolveActiveCompanyId = async (explicitCompanyId) => {
                if (explicitCompanyId && explicitCompanyId !== 'undefined' && explicitCompanyId !== 'admin' && explicitCompanyId !== 'null') {
                    return String(explicitCompanyId);
                }
                return 'default';
            };

            // WiFi Sync Route for Mobile Terminal (Protected LAN sync)
            app.get(['/api/sync/pull', '/sync/pull'], waitForDb, verifySyncOrToken, verifyLicense, async (req, res) => {
                try {
                    const { Product, Sale, Customer, Supplier } = require('./database/models');
                    const { SETTINGS_FILE } = require('./config/paths');
                    const { readJson } = require('./utils/helpers');
                    
                    const userRole = String(req.user?.role || '').toLowerCase();
                    const allowExplicitCompany = userRole === 'superadmin';
                    const requestedCompanyId = allowExplicitCompany
                        ? (req.query.companyId || req.headers['x-company-id'] || req.user?.companyId)
                        : req.user?.companyId;
                    const companyId = await resolveActiveCompanyId(requestedCompanyId);
                    const canViewCosts = userRole === 'superadmin' || userRole === 'admin' || userRole === 'owner' || userRole === 'dueño' || req.user?.permissions?.canViewCosts === true;
                    const productAttributes = canViewCosts
                        ? ['id', 'name', 'price', 'cost', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs']
                        : ['id', 'name', 'price', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs'];

                    const products = await Product.findAll({
                        where: { status: 'active', companyId },
                        attributes: productAttributes,
                        raw: true
                    });

                    const sales = await Sale.findAll({
                        where: { companyId },
                        order: [['createdAt', 'DESC']],
                        limit: 500,
                        raw: true
                    });

                    const customers = await Customer.findAll({
                        where: { isActive: true, companyId },
                        raw: true
                    });

                    const suppliers = await Supplier.findAll({
                        where: { isActive: true, companyId },
                        raw: true
                    });

                    let exchangeRate = 1.0;
                    try {
                        const { getUserSettings } = require('./utils/helpers');
                        const settingsData = readJson(SETTINGS_FILE);
                        const userSettings = getUserSettings(settingsData, companyId);
                        exchangeRate = Number(userSettings.exchangeRate || userSettings.rate || (settingsData && settingsData.exchangeRate) || 1.0);
                    } catch (e) {}

                    res.json({
                        success: true,
                        pc_name: os.hostname(),
                        db_path: 'postgresql://americanpos',
                        products,
                        sales,
                        customers,
                        suppliers,
                        exchangeRate,
                        timestamp: new Date().toISOString()
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.post(['/api/sync/push', '/sync/push'], waitForDb, verifySyncOrToken, verifyLicense, async (req, res) => {
                try {
                    const { sales } = req.body || {};
                    const syncController = require('./controllers/syncController');
                    if (Array.isArray(sales) && sales.length > 0) {
                        return syncController.syncOfflineSales(req, res);
                    }
                    res.json({ success: true, message: 'Datos recibidos correctamente' });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get(['/api/sync/status', '/sync/status'], waitForDb, verifySyncOrToken, verifyLicense, async (req, res) => {
                try {
                    const { Product, Sale, Customer } = require('./database/models');
                    const companyId = req.user?.companyId || req.query.companyId || 'default';
                    const prodCount = await Product.count({ where: { companyId } });
                    const salesCount = await Sale.count({ where: { companyId } });
                    const custCount = await Customer.count({ where: { companyId } });
                    res.json({
                        online: true,
                        pc_name: os.hostname(),
                        db_path: 'postgresql://americanpos',
                        products_count: prodCount,
                        sales_count: salesCount,
                        customers_count: custCount,
                        version: 'v3005',
                        time: new Date().toISOString()
                    });
                } catch (err) {
                    res.json({ online: true, pc_name: os.hostname(), version: 'v3005', error: err.message });
                }
            });


            // Initial Adoption Sync for Mobile Devices (Requires terminal license and authorized sync/token)
            app.get(['/api/sync/initial-adoption', '/sync/initial-adoption'], waitForDb, verifySyncOrToken, verifyLicense, async (req, res) => {
                try {
                    const { Product, Customer, Supplier, User, BranchStock } = require('./database/models');
                    const { SETTINGS_FILE } = require('./config/paths');
                    const { readJson } = require('./utils/helpers');
                    const { Op } = require('sequelize');
                    
                    const userRole = String(req.user?.role || '').toLowerCase();
                    const allowExplicitCompany = userRole === 'superadmin';
                    const requestedCompanyId = allowExplicitCompany
                        ? (req.query.companyId || req.headers['x-company-id'] || req.user?.companyId)
                        : req.user?.companyId;
                    const companyId = await resolveActiveCompanyId(requestedCompanyId);
                    const canViewCosts = userRole === 'superadmin' || userRole === 'admin' || userRole === 'owner' || userRole === 'dueño' || req.user?.permissions?.canViewCosts === true;
                    const productAttributes = canViewCosts
                        ? ['id', 'name', 'price', 'cost', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs', 'allowNegative', 'isSoldByWeight']
                        : ['id', 'name', 'price', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs', 'allowNegative', 'isSoldByWeight'];

                    const rawProducts = await Product.findAll({
                        where: { status: 'active', companyId },
                        attributes: productAttributes,
                        include: [{ model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] }]
                    });

                    const products = (rawProducts || []).map(p => {
                        const plain = p.get({ plain: true });
                        if (plain.BranchStocks && plain.BranchStocks.length > 0) {
                            const total = plain.BranchStocks.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
                            plain.stockQuantity = total;
                            plain.stock = total;
                        } else {
                            const val = Number(plain.stockQuantity || plain.stock || 0);
                            plain.stockQuantity = val;
                            plain.stock = val;
                        }
                        return plain;
                    });

                    const customers = await Customer.findAll({
                        where: { isActive: true, companyId },
                        raw: true
                    });

                    const suppliers = await Supplier.findAll({
                        where: { isActive: true, companyId },
                        raw: true
                    });

                    const cashiers = await User.findAll({
                        where: {
                            status: 'active',
                            companyId,
                            role: { [Op.ne]: 'superadmin' }
                        },
                        attributes: ['id', 'username', 'name', 'role', 'avatarColor', 'companyId', 'defaultCurrency'],
                        raw: true
                    });

                    let settings = {};
                    try {
                        const rawSettings = readJson(SETTINGS_FILE) || {};
                        const companySettings = (rawSettings[companyId] && typeof rawSettings[companyId] === 'object')
                            ? { ...rawSettings[companyId] }
                            : {};
                        delete companySettings.jwtSecret;
                        delete companySettings.emailPassword;
                        delete companySettings.adminPin;
                        delete companySettings.licenseKey;
                        delete companySettings.dbPassword;
                        settings = {
                            companyId,
                            business: companySettings.businessInfo || {},
                            exchangeRate: companySettings.exchangeRate || 1.0,
                            rate: companySettings.exchangeRate || 1.0,
                            paymentMethods: companySettings.paymentMethods || []
                        };
                    } catch (e) {}

                    res.json({
                        success: true,
                        companyId,
                        pc_name: os.hostname(),
                        timestamp: new Date().toISOString(),
                        products,
                        customers,
                        suppliers,
                        cashiers,
                        settings
                    });
                } catch (err) {
                    console.error('[Sync] Error in initial-adoption route:', err);
                    res.status(500).json({ error: err.message });
                }
            });

            // --- CONFIGURACIÓN DE RED Y BASE DE DATOS RESILIENTE (Accesible sin requerir DB activa ni token) ---
            const DbConfigManager = require('./config/dbConfigManager');

            app.get(['/settings/network-info', '/api/network-info'], (req, res) => {
                try {
                    const interfaces = os.networkInterfaces();
                    const ips = [];
                    for (const name of Object.keys(interfaces)) {
                        for (const iface of interfaces[name] || []) {
                            if (iface.family === 'IPv4' && !iface.internal) {
                                ips.push({ name, address: iface.address });
                            }
                        }
                    }
                    const primaryIp = ips.length > 0 ? ips[0].address : '127.0.0.1';
                    res.json({
                        success: true,
                        primaryIp,
                        ips,
                        port: parseInt(process.env.PORT || '3005', 10),
                        hostname: os.hostname()
                    });
                } catch (err) {
                    res.status(500).json({ success: false, error: err.message });
                }
            });

            const isLocalLoopbackRequest = (req) => {
                const rawAddr = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim();
                return rawAddr === '127.0.0.1' || rawAddr === '::1' || rawAddr === '::ffff:127.0.0.1';
            };

            const authorizeDbConfigRequest = async (req, res) => {
                if (!isLocalLoopbackRequest(req)) {
                    res.status(403).json({
                        success: false,
                        error: 'Acceso restringido: la configuración física de base de datos solo puede consultarse o modificarse desde el equipo local.'
                    });
                    return false;
                }

                const { isCompanyAdminRole } = require('./constants/roles');
                const { verifyJwtResilient, extractBearerToken, verifySocketJwtUser } = require('./middleware/auth');
                const authHeader = req.headers?.authorization || req.headers?.Authorization;
                const token = extractBearerToken(authHeader) || req.cookies?.authToken;

                if (!token && (req.headers?.['x-sync-key'] || req.headers?.['X-Sync-Key'])) {
                    res.status(403).json({
                        success: false,
                        error: 'terminal_no_autorizada',
                        message: 'Las terminales móviles/LAN no tienen permiso para consultar ni modificar la configuración de base de datos.'
                    });
                    return false;
                }

                if (token) {
                    try {
                        const decoded = verifyJwtResilient(token);
                        const userCheck = await verifySocketJwtUser(decoded);
                        if (!userCheck.ok) {
                            res.status(401).json({ success: false, error: userCheck.error || 'Sesión inválida o expirada' });
                            return false;
                        }
                        const perms = decoded.permissions || {};
                        if (!isCompanyAdminRole(userCheck.role) && perms.canManageSettings !== true) {
                            res.status(403).json({
                                success: false,
                                error: 'Acceso denegado: Se requieren permisos de Administrador o Dueño para modificar la configuración de base de datos.'
                            });
                            return false;
                        }
                        return true;
                    } catch (_) {
                        res.status(401).json({ success: false, error: 'Token de sesión inválido o expirado' });
                        return false;
                    }
                }

                // Sin token: permitido únicamente en onboarding inicial o cuando la BD aún no responde / no tiene usuarios creados
                try {
                    const { sequelize, User } = require('./database/models');
                    await sequelize.authenticate();
                    const usersCount = await User.count();
                    if (usersCount > 0) {
                        res.status(401).json({
                            success: false,
                            error: 'Autenticación requerida: Inicia sesión como Administrador o Dueño para consultar o modificar la base de datos.'
                        });
                        return false;
                    }
                } catch (_) {
                    // BD no disponible todavía (p.ej. credenciales iniciales erróneas o terminal sin servidor configurado) -> permitir recuperación local
                }
                return true;
            };

            app.get(['/settings/db-config', '/api/db-config'], async (req, res) => {
                if (!(await authorizeDbConfigRequest(req, res))) return;
                try {
                    const cfg = DbConfigManager.getConfig();
                    res.json({
                        success: true,
                        config: {
                            mode: cfg.mode,
                            dialect: cfg.dialect,
                            host: cfg.host,
                            port: cfg.port,
                            database: cfg.database,
                            user: cfg.user,
                            hasPassword: Boolean(cfg.password)
                        }
                    });
                } catch (err) {
                    res.status(500).json({ success: false, error: err.message });
                }
            });

            app.post(['/settings/db-config', '/api/db-config'], async (req, res) => {
                if (!(await authorizeDbConfigRequest(req, res))) return;
                try {
                    const { mode, dialect, host, port, database, user, password } = req.body || {};
                    const cleanMode = mode === 'client' ? 'client' : 'server';
                    const cleanDialect = dialect && String(dialect).trim().toLowerCase() !== 'postgres' ? null : 'postgres';
                    if (!cleanDialect) {
                        return res.status(400).json({ success: false, error: 'Dialecto de base de datos no soportado. Solo se permite postgres.' });
                    }
                    const parsedPort = parseInt(port || 5432, 10);
                    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
                        return res.status(400).json({ success: false, error: 'Puerto TCP inválido (debe estar entre 1 y 65535).' });
                    }
                    const safeDbName = DbConfigManager.validateDatabaseName(database || 'americanpos');
                    const configToSave = {
                        mode: cleanMode,
                        dialect: cleanDialect,
                        host: host !== undefined ? String(host).replace(/[\r\n\0]/g, '').trim() : (cleanMode === 'client' ? '' : '127.0.0.1'),
                        port: parsedPort,
                        database: safeDbName,
                        user: user ? String(user).replace(/[\r\n\0]/g, '').trim() : 'postgres'
                    };
                    if (password !== undefined && password !== null) {
                        configToSave.password = password;
                    }

                    const saveResult = DbConfigManager.saveConfig(configToSave);
                    if (!saveResult.success) {
                        return res.status(500).json({ success: false, error: saveResult.error });
                    }

                    let testResult = null;
                    if (configToSave.mode === 'server') {
                        try {
                            testResult = await DbConfigManager.testConnection(saveResult.config);
                        } catch (testErr) {
                            testResult = { success: false, error: testErr.message };
                        }
                    }

                    res.json({
                        success: true,
                        message: 'Configuración guardada exitosamente en el disco.',
                        config: saveResult.publicConfig || DbConfigManager.getPublicConfig(),
                        test: testResult
                    });
                } catch (err) {
                    res.status(500).json({ success: false, error: err.message });
                }
            });

            // Endpoint HTTP universal para transmitir lecturas de código de barras desde el móvil o lector externo hacia la PC
            app.post(['/remote-scan', '/api/remote-scan'], verifySyncOrToken, (req, res) => {
                try {
                    const code = String(req.body?.barcode || req.body?.code || '').trim();
                    if (!code) {
                        return res.status(400).json({ success: false, error: 'Código de barras vacío' });
                    }
                    const companyId = String(req.user?.companyId || 'default');
                    const scanEvent = {
                        barcode: code,
                        companyId,
                        source: req.body?.source || 'mobile_http',
                        senderSocketId: req.body?.senderSocketId || null,
                        timestamp: Date.now()
                    };
                    const virtualIoRef = app.get('io');
                    if (virtualIoRef && typeof virtualIoRef.to === 'function') {
                        virtualIoRef.to(companyId).emit('remote_barcode_scan', scanEvent);
                    }
                    return res.json({ success: true, barcode: code });
                } catch (err) {
                    return res.status(500).json({ success: false, error: err.message });
                }
            });

            app.use(waitForDb);
            app.use(verifyToken);
            app.use(verifyLicense);

            app.use('/products', productRoutes);
            app.use('/sales', salesRoutes);
            app.use(['/customers', '/api/customers'], customerRoutes);
            app.use(['/suppliers', '/api/suppliers'], supplierRoutes);
            app.use('/cash', cashRoutes);
            app.use('/reports', reportRoutes);
            app.use('/settings', settingRoutes);
            app.use('/purchase-orders', purchaseOrderRoutes);
            app.use('/refunds', refundRoutes);
            app.use('/users', userRoutes);
            app.use('/backup', backupRoutes);
            app.use('/debug', debugRoutes);
            app.use('/branches', branchesRoutes);
            app.use('/quotations', quotationRoutes);
            app.use('/delivery-notes', deliveryNoteRoutes);
            app.use('/audit', auditRoutes);
            app.use('/stock-intelligence', stockIntelligenceRoutes);
            app.use('/catalog', catalogRoutes);
            app.use('/ai', aiRoutes);
            app.use('/expenses', expenseRoutes);
            app.use('/fiscal', fiscalRoutes);
            app.use('/warehouses', warehousesRoutes);
            app.use('/bi', biRoutes);
            app.use('/accounting', accountingRoutes);
            app.use('/payroll', payrollRoutes);
            app.use('/production', productionRoutes);
            app.use('/collections', collectionsRoutes);
            app.use('/assets', fixedAssetsRoutes);
            app.use('/promotions', promotionsRoutes);
            app.use('/stock-alerts', stockAlertsRoutes);
            app.use('/services', serviceRoutes);
            app.use('/messages', messageRoutes);
            app.use('/sync', syncRoutes);
            app.use('/lan', lanClusterRoutes);
            app.use('/system', systemRoutes);
            app.use('/scanner', scannerRoutes);
            app.use(['/recharges', '/api/recharges'], rechargesRoutes);
            app.use(['/lots', '/api/lots'], lotsRoutes);
            
            // 🔒 Endpoints de WhatsApp (Protegidos con verifyToken / RBAC)
            app.use(['/whatsapp', '/api/whatsapp'], whatsappRoutes);

            app.use((req, res) => {
                const apiPrefixes = [
                    '/auth', '/products', '/sales', '/customers', '/suppliers',
                    '/cash', '/reports', '/settings', '/purchase-orders', '/refunds',
                    '/users', '/backup', '/debug', '/branches', '/quotations',
                    '/delivery-notes', '/audit', '/stock-intelligence', '/catalog',
                    '/ai', '/expenses', '/fiscal', '/warehouses', '/bi',
                    '/accounting', '/payroll', '/production', '/collections',
                    '/assets', '/promotions', '/stock-alerts', '/services', '/messages', '/sync', '/lan', '/system',
                    '/scanner', '/recharges', '/lots', '/whatsapp', '/api'
                ];
                const isApiRoute = apiPrefixes.some(prefix => req.path.startsWith(prefix));
                if (isApiRoute) return res.status(404).json({ error: 'Endpoint no encontrado', path: req.path });
                if (req.method === 'GET') return res.sendFile(path.join(staticPath, 'index.html'));
                res.status(404).json({ error: 'Ruta no encontrada' });
            });

            // Global Error Middleware
            app.use((err, req, res, next) => {
                if (err.name === 'SequelizeForeignKeyConstraintError') {
                    return res.status(409).json({
                        code: "ENTITY_HAS_DEPENDENCIES",
                        error: "No se puede eliminar el registro porque tiene historial de dependencias (ej. ventas o inventario).",
                        suggestInactivation: true
                    });
                }
                if (err.name === 'MulterError') {
                    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
                    return res.status(status).json({ error: err.message || 'Archivo inválido o excede límite permitido', code: err.code });
                }
                const explicitStatus = Number(err.statusCode || err.status);
                if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus < 500) {
                    return res.status(explicitStatus).json({ error: err.message || 'Solicitud inválida' });
                }
                logger.error(`--- UNHANDLED ERROR --- ${err.message}`, { stack: err.stack });
                
                const response = { error: 'Error interno del servidor' };
                if (process.env.NODE_ENV !== 'production') {
                    response.details = err.message;
                }
                
                res.status(500).json(response);
            });

            // Start a server for each port
            
            const https = require('https');

            let sslOptions = null;
            let isHttps = false;
            
            if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
                try {
                    const keyPath = path.resolve(process.env.SSL_KEY_PATH);
                    const certPath = path.resolve(process.env.SSL_CERT_PATH);
                    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
                        sslOptions = {
                            key: fs.readFileSync(keyPath),
                            cert: fs.readFileSync(certPath)
                        };
                        isHttps = true;
                        console.log('✅ SSL certificates loaded successfully.');
                    } else {
                        console.warn(`⚠️ SSL files specified in .env not found. Falling back to HTTP.\nKey path: ${keyPath}\nCert path: ${certPath}`);
                    }
                } catch (sslErr) {
                    console.warn('⚠️ Failed to load SSL files, falling back to HTTP:', sslErr.message);
                }
            } else if (process.env.ENABLE_LAN_TLS !== 'false' && (
                process.env.ENABLE_LAN_TLS === 'true'
                || (userDataPath && typeof userDataPath === 'object' && userDataPath.enableLanTls === true)
                || (() => {
                    try {
                        const { SETTINGS_FILE } = require('./config/paths');
                        const cfgPath = resolvedUserData ? path.join(resolvedUserData, 'settings.json') : SETTINGS_FILE;
                        if (fs.existsSync(cfgPath)) {
                            const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                            return parsed?.enableLanTls === true || parsed?.network?.enableLanTls === true;
                        }
                    } catch (_e) {}
                    return false;
                })()
            )) {
                try {
                    const { BASE_PATH } = require('./config/paths');
                    const { ensureLanTlsCredentials } = require('./utils/lanTlsCert');
                    const certBundle = ensureLanTlsCredentials(resolvedUserData || BASE_PATH);
                    sslOptions = { key: certBundle.key, cert: certBundle.cert };
                    isHttps = true;
                    console.log(`🔒 TLS LAN automático activo (SHA-256: ${certBundle.fingerprint256}, SANs: ${certBundle.ips.join(', ')})`);
                } catch (lanTlsErr) {
                    console.warn('⚠️ No se pudo inicializar TLS LAN automático, continuando en HTTP:', lanTlsErr.message);
                }
            }

            const { setupSocketEvents, createVirtualIoHub } = require('./services/SocketGateway');
            const workerManager = require('./services/WorkerManager');
            const ioInstances = [];

            const bindSinglePort = (port) => {
                return new Promise((resPort) => {
                    const p = Number(port);
                    const httpServer = isHttps 
                        ? https.createServer(sslOptions, app)
                        : http.createServer(app);
                    
                    const io = new Server(httpServer, {
                        cors: corsOptions,
                        allowRequest: (req, callback) => {
                            const origin = req.headers?.origin;
                            if (!origin) return callback(null, true);
                            isOriginAllowed(origin, (err, allowed) => {
                                if (err || !allowed) {
                                    return callback('Origin not allowed', false);
                                }
                                return callback(null, true);
                            });
                        }
                    });

                    ioInstances.push(io);
                    setupSocketEvents(io, { logger });

                    httpServer.on('error', (err) => {
                        console.warn(`⚠️ Port ${p} is busy or could not be bound:`, err.message);
                        resPort(null);
                    });
                    httpServer.listen(p, '::', () => {
                        const boundAddress = typeof httpServer.address === 'function' ? httpServer.address() : null;
                        const actualPort = (boundAddress && typeof boundAddress === 'object' && boundAddress.port) ? boundAddress.port : p;
                        console.log(`🚀 Server running on port ${actualPort} (${isHttps ? 'HTTPS' : 'HTTP'})`);
                        const srvObj = { server: httpServer, port: actualPort };
                        servers.push(srvObj);
                        resPort(srvObj);
                    });
                });
            };

            // 1. Iniciar inmediatamente el puerto principal para que la UI cargue en < 500ms
            const boundPrimary = await bindSinglePort(portList[0]);
            const primaryPort = boundPrimary ? boundPrimary.port : portList[0];

            // Create a virtual "io" hub that forwards emissions to all port instances
            const virtualIo = createVirtualIoHub(ioInstances);
            app.set('io', virtualIo);
            global.io = virtualIo;

            let isShuttingDown = false;
            const stopServer = async ({ closeDb = true } = {}) => {
                if (isShuttingDown) return;
                isShuttingDown = true;

                await workerManager.stopAll({ logger });

                for (const ioInst of ioInstances) {
                    try {
                        await new Promise((resIo) => ioInst.close(() => resIo()));
                    } catch (err) {
                        console.warn('[Server Shutdown] Error cerrando Socket.IO:', err.message);
                    }
                }
                for (const sObj of servers) {
                    if (sObj && sObj.server) {
                        try {
                            if (typeof sObj.server.closeAllConnections === 'function') {
                                sObj.server.closeAllConnections();
                            }
                            if (sObj.server.listening) {
                                await new Promise((resSrv) => sObj.server.close(() => resSrv()));
                            }
                        } catch (err) {
                            console.warn('[Server Shutdown] Error cerrando HTTP server:', err.message);
                        }
                    }
                }
                if (closeDb) {
                    try {
                        const { sequelize } = require('./database/connection');
                        if (sequelize && typeof sequelize.close === 'function') {
                            await sequelize.close();
                        }
                    } catch (err) {
                        console.warn('[Server Shutdown] Error cerrando Sequelize:', err.message);
                    }
                }
            };

            // Resolve IMMEDIATELY so Launcher / Edge opens instantly!
            resolve({ servers, mainPort: primaryPort, app, ioInstances, dbInitPromise, isDbReady: () => Boolean(dbReady), stopServer, isHttps, protocol: isHttps ? 'https' : 'http' });

            // 2. Levantar puertos secundarios, precalentar HWID y servicios en segundo plano sin bloquear el arranque
            setImmediate(async () => {
                if (isShuttingDown) return;
                if (process.env.DISABLE_BACKGROUND_WORKERS !== 'true') {
                    try {
                        require('./utils/hardware-id').getStableNetId().catch(() => {});
                    } catch (_) {}
                }
                const secondaryPorts = portList.slice(1);
                for (const secPort of secondaryPorts) {
                    if (isShuttingDown) return;
                    await bindSinglePort(secPort);
                }

                await workerManager.startAll({
                    virtualIo,
                    primaryPort,
                    dbInitPromise,
                    shouldAbort: () => isShuttingDown,
                    logger
                });
            });
        } catch (error) {
            console.error('CRITICAL STARTUP ERROR:', error);
            reject(error);
        }
    });
};

const rawPort = process.env.PORT || "3005,5005,8080";
const ports = rawPort.toString().split(',').map(p => p.trim());

if (require.main === module) {
    startServer(ports).then((srvHandle) => {
        const gracefulShutdown = async (signal) => {
            console.log(`[Shutdown] Señal ${signal} recibida. Cerrando conexiones y workers...`);
            try {
                if (srvHandle && typeof srvHandle.stopServer === 'function') {
                    await srvHandle.stopServer();
                }
            } catch (err) {
                console.warn('[Shutdown] Error en drenaje:', err.message);
            } finally {
                process.exit(0);
            }
        };
        process.once('SIGINT', () => gracefulShutdown('SIGINT'));
        process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
    }).catch((err) => {
        console.error('CRITICAL STARTUP ERROR:', err);
        process.exit(1);
    });
}

module.exports = { startServer };