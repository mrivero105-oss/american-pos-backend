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
const patchConsole = (method) => {
    const original = console[method];
    console[method] = (...args) => {
        try {
            original.apply(console, args);
            if (global.logger) {
                const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
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

// 1. Cargar .env en la carpeta local de la aplicación
loadEnvFile(path.join(__dirname, '.env'));

// 2. Cargar .env permanente en AppData (donde Electron y las instalaciones guardan la configuración real)
if (process.platform === 'win32' && process.env.APPDATA) {
    loadEnvFile(path.join(process.env.APPDATA, 'isaac-pos', '.env'));
    loadEnvFile(path.join(process.env.APPDATA, 'Isaac POS', '.env'));
    loadEnvFile(path.join(process.env.APPDATA, 'americanpos', '.env'));
}
if (process.env.USER_DATA_PATH) {
    loadEnvFile(path.join(process.env.USER_DATA_PATH, '.env'));
}

// 3. Fallbacks seguros con generación criptográfica aleatoria si faltan en entorno
if (!process.env.JWT_SECRET) {
    const crypto = require('crypto');
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('[SECURITY] JWT_SECRET no configurado en entorno. Se generó un secreto efímero aleatorio para esta sesión.');
}
if (!process.env.SYNC_SECRET_KEY) {
    const crypto = require('crypto');
    process.env.SYNC_SECRET_KEY = crypto.randomBytes(32).toString('hex');
    console.warn('[SECURITY] SYNC_SECRET_KEY no configurado en entorno. Se generó un secreto efímero aleatorio para esta sesión.');
}
if (!process.env.PORT) {
    process.env.PORT = '3005,5005,8080';
}
if (!process.env.DB_DIALECT) {
    process.env.DB_DIALECT = 'postgres';
}
const express = require('express');
require('express-async-errors');
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

// Route declarations using lazy loading
const authRoutes = lazyRouter('./routes/auth');
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
const licenseRoutes = lazyRouter('./routes/license');
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
const bankRoutes = lazyRouter('./routes/bankAccounts');
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
const publicAiRoutes = lazyRouter('./routes/publicAi');
const rechargesRoutes = lazyRouter('./routes/recharges');
const lotsRoutes = lazyRouter('./routes/lots');

// serveDynamicImages function removed to prevent directory traversal vulnerabilities

const startServer = (ports, userDataPath = null) => {
    return new Promise(async (resolve, reject) => {
        const portList = Array.isArray(ports) ? ports : [ports];
        const servers = [];

        try {
            console.log('--- STARTUP SEQUENCE INITIATED ---');
            if (userDataPath) {
                process.env.USER_DATA_PATH = userDataPath;
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

            // Basic Request Logger
            app.use((req, res, next) => {
                logger.info(`[${req.method}] ${req.url}`);
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

            // Middleware - Security Headers
            app.use(helmet({
                contentSecurityPolicy: false, // Disabled for Electron app compatibility
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

            const corsOptions = {
                origin: (origin, callback) => {
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
                    if (/^https?:\/\/[a-z0-9_-]+(\.(local|lan|home|internal))?(:\d+)?$/i.test(originLower)) {
                        return callback(null, true);
                    }
                    logger.warn(`[CORS REJECTED] Origin no autorizado bloqueado: ${origin}`);
                    return callback(null, false);
                },
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
            app.options('*', cors(corsOptions));
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
                const ext = path.extname(req.path).toLowerCase();
                if (ext) {
                    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.csv', '.xlsx', '.css', '.js', '.html', '.svg', '.woff', '.woff2', '.ttf', '.zip', '.sql', '.json', '.ico', '.apk'];
                    if (!allowedExts.includes(ext)) {
                        return res.status(403).json({ error: 'Tipo de archivo estático no permitido' });
                    }
                }
                next();
            };

            app.use(safeStaticMimeTypes, express.static(staticPath, {
                etag: false,
                maxAge: 0,
                setHeaders: (res, path) => {
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
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

            app.use('/uploads', safeStaticMimeTypes, express.static(path.join(staticPath, 'uploads')));
            
            // Serve all possible media paths (local, electron unpacked, and any existing AppData folders)
            const getValidCandidatePaths = (subfolder) => {
                const candidates = [
                    path.join(__dirname, subfolder),
                    isPackaged ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), subfolder) : null,
                    process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'isaacpos', subfolder) : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'american-pos-backend', subfolder) : null,
                ].filter(Boolean);

                candidates.forEach(p => {
                    if (!fs.existsSync(p)) {
                        try { fs.mkdirSync(p, { recursive: true }); } catch (e) {}
                    }
                });

                return [...new Set(candidates)].filter(p => fs.existsSync(p));
            };

            const productImagesDirs = getValidCandidatePaths('product_images');
            productImagesDirs.forEach(dir => {
                app.use('/product_images', safeStaticMimeTypes, express.static(dir));
            });

            const supplierLogosDirs = getValidCandidatePaths('supplier_logos');
            supplierLogosDirs.forEach(dir => {
                app.use('/supplier_logos', safeStaticMimeTypes, express.static(dir));
            });

            const invoicesDirs = getValidCandidatePaths('invoices');
            invoicesDirs.forEach(dir => {
                app.use('/invoices', safeStaticMimeTypes, express.static(dir));
            });

            const displayAdsDirs = getValidCandidatePaths('display_ads');
            displayAdsDirs.forEach(dir => {
                app.use('/display_ads', safeStaticMimeTypes, express.static(dir));
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
            app.get(['/mobile', '/mobile-pos', '/login', '/pos', '/dashboard', '/inventory', '/customers', '/sales-history', '/sales-manager', '/cash-register', '/recharges', '/display', '/customer-display', '/store*'], (req, res, next) => {
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

            // Endpoint directo para version.json y dist.zip (OTA)
            app.get('/version.json', (req, res) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                const p = path.join(staticPath, 'version.json');
                const fallback = path.join(__dirname, 'public', 'version.json');
                const target = fs.existsSync(p) ? p : fallback;
                if (fs.existsSync(target)) return res.sendFile(target);
                res.status(404).json({ error: 'version.json no encontrado' });
            });

            app.get('/dist.zip', (req, res) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                const p = path.join(staticPath, 'dist.zip');
                const fallback = path.join(__dirname, 'public', 'dist.zip');
                const target = fs.existsSync(p) ? p : fallback;
                if (fs.existsSync(target)) return res.sendFile(target);
                res.status(404).json({ error: 'dist.zip no encontrado' });
            });

            // Endpoint de Información para Actualizaciones OTA (Capacitor Updater)
            app.get('/api/app-update-info', (req, res) => {
                try {
                    const versionFile = path.join(staticPath, 'version.json');
                    if (fs.existsSync(versionFile)) {
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
            app.get('/lan/peers', (req, res) => {
                const LANClusterService = require('./services/LANClusterService');
                res.json({ success: true, ...LANClusterService.getClusterTopology() });
            });

            // Middleware de autenticación dual para nodos de sincronización LAN y terminales móviles
            const verifySyncOrToken = (req, res, next) => {
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    return verifyToken(req, res, next);
                }
                const syncKey = req.headers['x-sync-key'] || req.query.sync_key;
                const expectedKey = process.env.SYNC_SECRET_KEY || process.env.JWT_SECRET;
                if (syncKey && expectedKey && syncKey === expectedKey) {
                    req.user = { id: 'sync-node', role: 'admin', companyId: req.query.companyId || req.headers['x-company-id'] || 'default' };
                    return next();
                }
                return res.status(401).json({ error: 'Acceso no autorizado a sincronización. Se requiere token Bearer o clave de sincronización autorizada.' });
            };

            // Helper para resolver dinámicamente la empresa activa del negocio
            const resolveActiveCompanyId = async (explicitCompanyId) => {
                if (explicitCompanyId && explicitCompanyId !== 'default' && explicitCompanyId !== 'undefined' && explicitCompanyId !== 'admin') {
                    try {
                        const { Product } = require('./database/models');
                        const count = await Product.count({ where: { companyId: String(explicitCompanyId) } });
                        if (count > 0) return String(explicitCompanyId);
                    } catch (e) {}
                }
                try {
                    const { SETTINGS_FILE } = require('./config/paths');
                    const { readJson } = require('./utils/helpers');
                    const rawSettings = readJson(SETTINGS_FILE) || {};
                    if (rawSettings['2']) return '2';
                } catch (e) {}
                return '2';
            };

            // WiFi Sync Route for Mobile Terminal (Protected LAN sync)
            app.get(['/api/sync/pull', '/sync/pull'], waitForDb, verifySyncOrToken, verifyLicense, async (req, res) => {
                try {
                    const { Product, Sale, Customer, Supplier } = require('./database/models');
                    const { SETTINGS_FILE } = require('./config/paths');
                    const { readJson } = require('./utils/helpers');
                    
                    const requestedCompanyId = req.user?.companyId || req.query.companyId || req.headers['x-company-id'];
                    const companyId = await resolveActiveCompanyId(requestedCompanyId);
                    const canViewCosts = req.user?.role === 'superadmin' || req.user?.permissions?.canViewCosts === true;
                    const productAttributes = canViewCosts
                        ? ['id', 'name', 'price', 'cost', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs']
                        : ['id', 'name', 'price', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs'];

                    let products = await Product.findAll({
                        where: { status: 'active', companyId },
                        attributes: productAttributes,
                        raw: true
                    });
                    if (!products || products.length === 0) {
                        products = await Product.findAll({ where: { status: 'active' }, attributes: productAttributes, raw: true });
                    }

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
                    
                    const requestedCompanyId = req.user?.companyId || req.query.companyId || req.headers['x-company-id'];
                    const companyId = await resolveActiveCompanyId(requestedCompanyId);
                    const canViewCosts = req.user?.role === 'superadmin' || req.user?.permissions?.canViewCosts === true;
                    const productAttributes = canViewCosts
                        ? ['id', 'name', 'price', 'cost', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs', 'allowNegative', 'isSoldByWeight']
                        : ['id', 'name', 'price', 'stockQuantity', 'stock', 'category', 'barcode', 'imageUri', 'minStock', 'priceBs', 'allowNegative', 'isSoldByWeight'];

                    let rawProducts = await Product.findAll({
                        where: { status: 'active', companyId },
                        attributes: productAttributes,
                        include: [{ model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] }]
                    });

                    // Si no hay productos bajo ese companyId exacto, traer los del catálogo activo
                    if (!rawProducts || rawProducts.length === 0) {
                        rawProducts = await Product.findAll({
                            where: { status: 'active' },
                            attributes: productAttributes,
                            include: [{ model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] }]
                        });
                    }

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

                    let customers = await Customer.findAll({
                        where: { isActive: true, companyId },
                        raw: true
                    });
                    if (!customers || customers.length === 0) {
                        customers = await Customer.findAll({ where: { isActive: true }, raw: true });
                    }

                    let suppliers = await Supplier.findAll({
                        where: { isActive: true, companyId },
                        raw: true
                    });
                    if (!suppliers || suppliers.length === 0) {
                        suppliers = await Supplier.findAll({ where: { isActive: true }, raw: true });
                    }

                    const cashiers = await User.findAll({
                        where: { 
                            status: 'active',
                            role: { [Op.ne]: 'superadmin' },
                            [Op.or]: [
                                { companyId },
                                { role: { [Op.in]: ['cashier', 'seller', 'user', 'admin', 'supervisor'] } }
                            ]
                        },
                        attributes: ['id', 'username', 'name', 'role', 'avatarColor', 'companyId', 'defaultCurrency'],
                        raw: true
                    });

                    let settings = {};
                    try {
                        const rawSettings = readJson(SETTINGS_FILE) || {};
                        settings = { ...rawSettings };
                        if (rawSettings[companyId]) {
                            settings.business = rawSettings[companyId].businessInfo || {};
                            settings.exchangeRate = rawSettings[companyId].exchangeRate || 1.0;
                            settings.rate = rawSettings[companyId].exchangeRate || 1.0;
                            settings.paymentMethods = rawSettings[companyId].paymentMethods || [];
                        }
                        delete settings.jwtSecret;
                        delete settings.emailPassword;
                        delete settings.adminPin;
                        delete settings.licenseKey;
                        delete settings.dbPassword;
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

            app.get(['/settings/db-config', '/api/db-config'], (req, res) => {
                if (!isLocalLoopbackRequest(req)) {
                    return res.status(403).json({
                        success: false,
                        error: 'Acceso restringido: la configuración física de base de datos solo puede consultarse desde el equipo local.'
                    });
                }
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
                if (!isLocalLoopbackRequest(req)) {
                    return res.status(403).json({
                        success: false,
                        error: 'Acceso restringido: la configuración física de base de datos solo puede modificarse desde el equipo local.'
                    });
                }
                try {
                    const { mode, dialect, host, port, database, user, password } = req.body;
                    const configToSave = {
                        mode: mode || 'server',
                        dialect: dialect || 'postgres',
                        host: host !== undefined ? host : (mode === 'client' ? '' : '127.0.0.1'),
                        port: parseInt(port || 5432, 10),
                        database: database || 'americanpos',
                        user: user || 'postgres'
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
                        config: saveResult.config,
                        test: testResult
                    });
                } catch (err) {
                    res.status(500).json({ success: false, error: err.message });
                }
            });

            // Endpoint HTTP universal para transmitir lecturas de código de barras desde el móvil o lector externo hacia la PC
            app.post(['/remote-scan', '/api/remote-scan'], (req, res) => {
                try {
                    const code = String(req.body?.barcode || req.body?.code || '').trim();
                    if (!code) {
                        return res.status(400).json({ success: false, error: 'Código de barras vacío' });
                    }
                    const scanEvent = {
                        barcode: code,
                        source: req.body?.source || 'mobile_http',
                        senderSocketId: req.body?.senderSocketId || null,
                        timestamp: Date.now()
                    };
                    const virtualIoRef = app.get('io');
                    if (virtualIoRef && typeof virtualIoRef.emit === 'function') {
                        virtualIoRef.emit('remote_barcode_scan', scanEvent);
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
            app.use('/banks', bankRoutes);
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

            app.all('*', (req, res) => {
                const apiPrefixes = [
                    '/auth', '/products', '/sales', '/customers', '/suppliers',
                    '/cash', '/reports', '/settings', '/purchase-orders', '/refunds',
                    '/users', '/backup', '/debug', '/branches', '/quotations',
                    '/delivery-notes', '/audit', '/stock-intelligence', '/catalog',
                    '/ai', '/expenses', '/banks', '/fiscal', '/warehouses', '/bi',
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
            }

            const ioInstances = [];

            const setupSocketEvents = (io) => {
                // 🔒 SEGURIDAD MULTI-TENANT: Middleware de autenticación para WebSockets
                io.use((socket, next) => {
                    try {
                        const token = socket.handshake.auth?.token || 
                                      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/, '') || 
                                      socket.handshake.query?.token;
                        if (token) {
                            const { verifyJwtResilient } = require('./middleware/auth');
                            const decoded = verifyJwtResilient(token);
                            if (decoded) {
                                socket.user = decoded;
                                socket.companyId = String(decoded.companyId || '1');
                            }
                        }
                    } catch (_) {}
                    next();
                });

                io.on('connection', (socket) => {
                    let userCompanyId = socket.companyId || null;
                    socket.on('join_company', (companyId) => {
                        // Si el socket está autenticado con JWT, forzar aislamiento a su empresa real
                        if (socket.user && socket.user.companyId) {
                            userCompanyId = String(socket.user.companyId);
                        } else if (companyId) {
                            userCompanyId = String(companyId);
                        }
                        if (userCompanyId) {
                            socket.join(userCompanyId);
                        }
                    });
                    
                    // Typing events for internal chat (Aislados por empresa)
                    socket.on('internal_chat_typing', (data) => {
                        const targetRoom = data?.companyId || userCompanyId;
                        if (targetRoom) socket.to(targetRoom).emit('internal_chat_typing', data);
                    });
                    socket.on('internal_chat_stop_typing', (data) => {
                        const targetRoom = data?.companyId || userCompanyId;
                        if (targetRoom) socket.to(targetRoom).emit('internal_chat_stop_typing', data);
                    });

                    // LAN Cluster P2P Socket Events
                    socket.on('lan_announce', (peerData) => {
                        try {
                            const LANClusterService = require('./services/LANClusterService');
                            if (peerData && peerData.nodeId) {
                                LANClusterService.peers.set(`${peerData.nodeId}`, {
                                    ...peerData,
                                    lastSeen: Date.now()
                                });
                                LANClusterService.notifyTopologyChange();
                            }
                        } catch (e) {}
                    });

                    socket.on('lan_stock_update', async (data) => {
                        try {
                            const targetRoom = data?.companyId || userCompanyId;
                            if (targetRoom) socket.to(targetRoom).emit('lan_stock_update', data);
                            socket.broadcast.emit('lan_stock_update', data);
                        } catch (e) {}
                    });

                    socket.on('lan_sale_sync', async (payload) => {
                        try {
                            const targetRoom = payload?.companyId || userCompanyId;
                            if (targetRoom) socket.to(targetRoom).emit('lan_sale_sync', payload);
                            socket.broadcast.emit('lan_sale_sync', payload);
                        } catch (e) {}
                    });

                    // Retransmisión en tiempo real de cambios originados en terminales móviles o secundarias
                    socket.on('product_updated', (payload) => {
                        try {
                            socket.broadcast.emit('product_updated', payload);
                        } catch (e) {}
                    });

                    socket.on('inventory_changed', (payload) => {
                        try {
                            socket.broadcast.emit('inventory_changed', payload || { timestamp: Date.now() });
                        } catch (e) {}
                    });

                    socket.on('customers_changed', (payload) => {
                        try {
                            socket.broadcast.emit('customers_changed', payload || { timestamp: Date.now() });
                        } catch (e) {}
                    });

                    socket.on('expenses_changed', (payload) => {
                        try {
                            socket.broadcast.emit('expenses_changed', payload || { timestamp: Date.now() });
                        } catch (e) {}
                    });

                    socket.on('cash_updated', (payload) => {
                        try {
                            socket.broadcast.emit('cash_updated', payload || { timestamp: Date.now() });
                        } catch (e) {}
                    });

                    // Visor de Cliente en Tiempo Real (Customer-Facing Display)
                    socket.on('join_customer_display', (info) => {
                        try {
                            socket.join('customer_displays');
                            if (info?.registerId) socket.join(`register_${info.registerId}`);
                            if (info?.companyId) socket.join(String(info.companyId));
                        } catch (e) {}
                    });

                    socket.on('request_customer_display_cart', (data) => {
                        try {
                            socket.broadcast.emit('request_customer_display_cart', data);
                        } catch (e) {}
                    });

                    socket.on('customer_display_cart_update', (payload) => {
                        try {
                            const targetRoom = payload?.companyId || userCompanyId;
                            if (targetRoom) {
                                socket.to(String(targetRoom)).emit('customer_display_cart_update', payload);
                            }
                            if (payload?.registerId) {
                                socket.to(`register_${payload.registerId}`).emit('customer_display_cart_update', payload);
                            }
                            // Reenviar a cualquier visor suscrito
                            io.to('customer_displays').emit('customer_display_cart_update', payload);
                            // Broadcast universal para cualquier otra ventana o dispositivo en la LAN
                            socket.broadcast.emit('customer_display_cart_update', payload);
                        } catch (e) {}
                    });

                    socket.on('customer_display_payment_update', (payload) => {
                        try {
                            const targetRoom = payload?.companyId || userCompanyId;
                            if (targetRoom) {
                                socket.to(String(targetRoom)).emit('customer_display_payment_update', payload);
                            }
                            if (payload?.registerId) {
                                socket.to(`register_${payload.registerId}`).emit('customer_display_payment_update', payload);
                            }
                            io.to('customer_displays').emit('customer_display_payment_update', payload);
                            socket.broadcast.emit('customer_display_payment_update', payload);
                        } catch (e) {}
                    });

                    socket.on('customer_display_sale_completed', (payload) => {
                        try {
                            io.to('customer_displays').emit('customer_display_sale_completed', payload);
                            socket.broadcast.emit('customer_display_sale_completed', payload);
                        } catch (e) {}
                    });

                    socket.on('customer_display_ads_updated', (payload) => {
                        try {
                            io.to('customer_displays').emit('customer_display_ads_updated', payload);
                            socket.broadcast.emit('customer_display_ads_updated', payload);
                        } catch (e) {}
                    });

                    // 📱 Preventa Remota Móvil -> Despacho instantáneo a Caja Principal (PC)
                    socket.on('remote_held_sale', (payload) => {
                        try {
                            if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) return;
                            const reg = global.__remoteHeldSalesRegistry || (global.__remoteHeldSalesRegistry = { items: new Map(), recentBroadcasts: new Map() });
                            const now = Date.now();
                            const saleId = String(payload.id || payload.code || `presale_${now}`);
                            const enriched = {
                                ...payload,
                                id: saleId,
                                companyId: String(payload.companyId || userCompanyId || '1'),
                                timestamp: payload.timestamp || now
                            };
                            reg.items.set(saleId, enriched);

                            // Limpieza de preventas vencidas (>12h) o exceso de memoria (>100)
                            for (const [k, v] of reg.items.entries()) {
                                if (now - (v.timestamp || 0) > 12 * 3600 * 1000) reg.items.delete(k);
                            }
                            while (reg.items.size > 100) {
                                const oldestKey = reg.items.keys().next().value;
                                reg.items.delete(oldestKey);
                            }

                            const lastSent = reg.recentBroadcasts.get(saleId) || 0;
                            if (now - lastSent > 6000) {
                                reg.recentBroadcasts.set(saleId, now);
                                io.emit('remote_held_sale', enriched);
                            }
                        } catch (e) {}
                    });

                    // 📡 Escáner de Código de Barras Remoto (Teléfono / Terminal -> PC Principal)
                    socket.on('remote_barcode_scan', (payload) => {
                        try {
                            const code = String(payload?.barcode || payload?.code || '').trim();
                            if (!code) return;
                            const scanEvent = {
                                barcode: code,
                                source: payload?.source || 'mobile_socket',
                                senderSocketId: socket.id,
                                timestamp: payload?.timestamp || Date.now()
                            };
                            socket.broadcast.emit('remote_barcode_scan', scanEvent);
                        } catch (e) {}
                    });
                });
            };

            const bindSinglePort = (port) => {
                return new Promise((resPort) => {
                    const p = Number(port);
                    const httpServer = isHttps 
                        ? https.createServer(sslOptions, app)
                        : http.createServer(app);
                    
                    const io = new Server(httpServer, {
                        cors: { 
                            origin: true,
                            credentials: true,
                            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
                        }
                    });

                    ioInstances.push(io);
                    setupSocketEvents(io);

                    httpServer.on('error', (err) => {
                        console.warn(`⚠️ Port ${p} is busy or could not be bound:`, err.message);
                        resPort(null);
                    });
                    httpServer.listen(p, '::', () => {
                        console.log(`🚀 Server running on port ${p} (${isHttps ? 'HTTPS' : 'HTTP'})`);
                        const srvObj = { server: httpServer, port: p };
                        servers.push(srvObj);
                        resPort(srvObj);
                    });
                });
            };

            // 1. Iniciar inmediatamente el puerto principal para que la UI cargue en < 500ms
            const primaryPort = portList[0];
            await bindSinglePort(primaryPort);

            // Create a virtual "io" hub that forwards emissions to all port instances
            const virtualIo = {
                to: (room) => ({
                    emit: (event, ...args) => {
                        ioInstances.forEach(instance => {
                            instance.to(room).emit(event, ...args);
                        });
                    }
                }),
                in: (room) => ({
                    emit: (event, ...args) => {
                        ioInstances.forEach(instance => {
                            instance.in(room).emit(event, ...args);
                        });
                    }
                }),
                emit: (event, ...args) => {
                    ioInstances.forEach(instance => {
                        instance.emit(event, ...args);
                    });
                }
            };
            app.set('io', virtualIo);
            global.io = virtualIo;

            // Resolve IMMEDIATELY so Launcher / Edge opens instantly!
            resolve({ servers, mainPort: primaryPort });

            // 2. Levantar puertos secundarios y servicios en segundo plano sin bloquear el arranque
            setImmediate(async () => {
                const secondaryPorts = portList.slice(1);
                for (const secPort of secondaryPorts) {
                    await bindSinglePort(secPort);
                }

                // Initialize LAN Cluster Service (P2P Discovery & Sync)
                try {
                    const LANClusterService = require('./services/LANClusterService');
                    LANClusterService.init(virtualIo, Number(primaryPort));
                } catch (lanErr) {
                    console.warn('⚠️ Error al iniciar LAN Cluster Service:', lanErr.message);
                }

                // Start WhatsApp Bot asynchronously in background
                try {
                    await dbInitPromise;
                    const WhatsappBotService = require('./services/WhatsappBotService');
                    const { User } = require('./database/models');
                    const firstUser = await User.findOne({ where: { role: ['superadmin', 'admin'] } }) || await User.findOne();
                    const companyId = firstUser?.companyId || 'default';
                    
                    WhatsappBotService.init(companyId);
                    console.log(`✅ WhatsApp Bot background init completed (Company: ${companyId}).`);
                } catch (err) {
                    console.warn('⚠️ WhatsApp Bot background init notice:', err.message);
                }

                // Initialize Auto-Maintenance Service (Nightly Vacuum, Engine Tuning & Backup Rotation)
                try {
                    const AutoMaintenanceService = require('./services/AutoMaintenanceService');
                    AutoMaintenanceService.init();
                } catch (maintErr) {
                    console.warn('⚠️ Error al iniciar AutoMaintenanceService:', maintErr.message);
                }

                // Initialize PostgreSQL 16 Native Realtime Bus (LISTEN / NOTIFY)
                try {
                    const PostgresRealtimeService = require('./services/PostgresRealtimeService');
                    await PostgresRealtimeService.init(virtualIo);
                } catch (pgRtErr) {
                    console.warn('⚠️ Error al iniciar PostgresRealtimeService:', pgRtErr.message);
                }

                // Initialize BCV Auto-Sync Service (Official Exchange Rate Automation)
                try {
                    const BCVAutoSyncService = require('./services/BCVAutoSyncService');
                    BCVAutoSyncService.init(virtualIo);
                } catch (bcvErr) {
                    console.warn('⚠️ Error al iniciar BCVAutoSyncService:', bcvErr.message);
                }

                // Initialize Supabase Cloud Sync Worker (Outbox Processor 24/7)
                try {
                    const SupabaseSyncService = require('./services/SupabaseSyncService');
                    SupabaseSyncService.start(15000);
                    console.log('✅ Supabase Cloud Sync Worker iniciado (24/7).');
                } catch (syncWorkerErr) {
                    console.warn('⚠️ Error al iniciar SupabaseSyncService:', syncWorkerErr.message);
                }
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
    startServer(ports);
}

module.exports = { startServer };