const path = require('path');
const fs = require('fs');

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
        global.logger.error(`🔥 [CRITICAL] Unhandled Rejection at: ${promise} reason: ${reason}`);
    } else {
        console.error('🔥 [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
    }
    if (typeof process.send === 'function') {
        try { process.send({ type: 'CRITICAL_ERROR', reason: String(reason) }); } catch (e) {}
    }
    setTimeout(() => process.exit(1), 1000);
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

require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
require('express-async-errors');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { sequelize, User, CashShift } = require('./database/models');
const { verifyToken, isSuperAdmin } = require('./middleware/auth');
const { verifyLicense } = require('./middleware/licenseMiddleware');
const cookieParser = require('cookie-parser');
const logger = require('./utils/logger');
global.logger = logger;

// Import Routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const customerRoutes = require('./routes/customers');
const supplierRoutes = require('./routes/suppliers');
const cashRoutes = require('./routes/cash');
const reportRoutes = require('./routes/reports');
const settingRoutes = require('./routes/settings');

const purchaseOrderRoutes = require('./routes/purchaseOrders');
const refundRoutes = require('./routes/refunds');
const userRoutes = require('./routes/users');
const backupRoutes = require('./routes/backup');
const debugRoutes = require('./routes/debug');
const licenseRoutes = require('./routes/license');
const expenseRoutes = require('./routes/expenses');
const serviceRoutes = require('./routes/services');

const branchesRoutes = require('./routes/branches');
const quotationRoutes = require('./routes/quotations');
const deliveryNoteRoutes = require('./routes/deliveryNotes');
const auditRoutes = require('./routes/audit');
const stockIntelligenceRoutes = require('./routes/stockIntelligence');
const catalogRoutes = require('./routes/catalog');
const aiRoutes = require('./routes/ai');
const messageRoutes = require('./routes/messages');
const systemRoutes = require('./routes/system');


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

            // 1. Ensure Database connection and sync FIRST
            const { connectDB } = require('./database/connection');
            await connectDB();
            console.log('✅ Database connection secured and synced.');

            // 2. Run Automigrations
            const { runMigrations } = require('./database/migrate');
            await runMigrations();
            console.log('✅ Automigrations completed.');

            const app = express();

            // Basic Request Logger
            app.use((req, res, next) => {
                logger.info(`[${req.method}] ${req.url}`);
                next();
            });

            // HTTPS Enforcement
            app.use((req, res, next) => {
                if (process.env.NODE_ENV === 'production' && !req.secure && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') {
                    const host = req.headers.host || req.hostname;
                    return res.redirect(`https://${host}${req.url}`);
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
                    // Permitir siempre cualquier origen para máxima compatibilidad POS en red local (LAN WiFi / terminales móviles / capacitor)
                    callback(null, true);
                },
                credentials: true,
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
                allowedHeaders: [
                    'Content-Type', 'Authorization', 'x-company-id', 'X-Company-Id', 
                    'x-admin-token', 'X-Admin-Token', 'Accept', 'Origin', 'X-Requested-With',
                    'x-sync-timestamp', 'X-Sync-Timestamp', 'x-sync-signature', 'X-Sync-Signature',
                    'x-signature', 'X-Signature', 'x-timestamp', 'X-Timestamp',
                    'x-signature-timestamp', 'X-Signature-Timestamp'
                ],
                exposedHeaders: ['Content-Disposition']
            };

            app.use(cors(corsOptions));
            app.use(cookieParser());
            app.use(compression());

            // Rate Limiting for Authentication Endpoints
            const authLimiter = rateLimit({
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: 5, // Limit each IP to 5 requests per windowMs
                message: {
                    error: 'Demasiados intentos de autenticación. Por favor, espere 15 minutos antes de intentar nuevamente.'
                },
                standardHeaders: true,
                legacyHeaders: false,
                skip: (req) => {
                    // Skip rate limiting for internal requests
                    return req.ip === '127.0.0.1' || req.ip === '::1';
                }
            });

            // Apply rate limiting to auth routes
            app.use('/auth/login', authLimiter);
            app.use('/auth/register', authLimiter);

            // Global Rate Limiter
            const globalLimiter = rateLimit({
                windowMs: 15 * 60 * 1000,
                max: 1000,
                message: { error: 'Demasiadas peticiones desde esta IP. Por favor, espere 15 minutos.' },
                standardHeaders: true,
                legacyHeaders: false,
                skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.path.startsWith('/messages') || req.path.startsWith('/system/updates')
            });
            app.use(globalLimiter);

            // Excepciones paginadas para rutas de sincronización (Mitigación DoS RAM)
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

            // Static files - Handle asar unpacked path for packaged apps
            const staticPath = isPackaged 
                ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'public')
                : path.join(__dirname, 'public');

            const safeStaticMimeTypes = (req, res, next) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') return next();
                const ext = path.extname(req.path).toLowerCase();
                if (ext) {
                    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.csv', '.xlsx', '.css', '.js', '.html', '.svg', '.woff', '.woff2', '.ttf', '.zip', '.sqlite', '.sql', '.json', '.ico'];
                    if (!allowedExts.includes(ext)) {
                        return res.status(403).json({ error: 'Tipo de archivo estático no permitido' });
                    }
                }
                next();
            };

            app.use(safeStaticMimeTypes, express.static(staticPath));
            app.use('/uploads', safeStaticMimeTypes, express.static(path.join(staticPath, 'uploads')));
            
            // Serve local images first (using unpacked path if packaged to prevent ASAR stream errors)
            const productImagesPath = isPackaged
                ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'product_images')
                : path.join(__dirname, 'product_images');
            const supplierLogosPath = isPackaged
                ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'supplier_logos')
                : path.join(__dirname, 'supplier_logos');

            app.use('/product_images', safeStaticMimeTypes, express.static(productImagesPath));
            app.use('/supplier_logos', safeStaticMimeTypes, express.static(supplierLogosPath));
            
            // Serve fallback images
            const appDataImagesPath = process.env.USER_DATA_PATH || (fs.existsSync(path.join(process.env.APPDATA || '', 'americanpos')) ? path.join(process.env.APPDATA || '', 'americanpos') : path.join(process.env.APPDATA || '', 'american-pos-backend'));
            if (appDataImagesPath) {
                app.use('/product_images', safeStaticMimeTypes, express.static(path.join(appDataImagesPath, 'product_images')));
                app.use('/supplier_logos', safeStaticMimeTypes, express.static(path.join(appDataImagesPath, 'supplier_logos')));
            }

            // Routes
            app.get('/hello', (req, res) => res.json({ status: 'ready', server: 'american-pos' }));
            app.get(['/api/time', '/time'], (req, res) => res.json({
                success: true,
                timestamp: Date.now(),
                iso: new Date().toISOString()
            }));
            app.get('/health', verifyToken, isSuperAdmin, (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
            app.use('/auth', authRoutes);
            app.use('/license', licenseRoutes);
            app.use('/public-catalog', require('./routes/publicCatalog'));
            app.use('/ai/public-query', require('./routes/publicAi'));

            app.use(verifyToken);
            app.use(verifyLicense);

            app.use('/products', productRoutes);
            app.use('/sales', salesRoutes);
            app.use('/customers', customerRoutes);
            app.use('/suppliers', supplierRoutes);
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
            app.use('/services', serviceRoutes);
            app.use('/messages', messageRoutes);
            app.use('/sync', require('./routes/sync'));
            app.use('/lan', require('./routes/lanCluster'));
            app.use('/system', systemRoutes);
            
            // Rutas que no requieren auth o tienen su propio manejo
            const whatsappRoutes = require('./routes/whatsapp');
            app.use('/whatsapp', whatsappRoutes);

            app.all('*', (req, res) => {
                const isApiRoute = req.path.startsWith('/auth/') || req.path.includes('/api/');
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
            
            for (const port of portList) {
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

                io.on('connection', (socket) => {
                    socket.on('join_company', (companyId) => {
                        if (companyId) socket.join(companyId);
                    });
                    
                    // Typing events for internal chat
                    socket.on('internal_chat_typing', (data) => {
                        socket.broadcast.emit('internal_chat_typing', data);
                    });
                    socket.on('internal_chat_stop_typing', (data) => {
                        socket.broadcast.emit('internal_chat_stop_typing', data);
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
                            socket.broadcast.emit('lan_stock_update', data);
                        } catch (e) {}
                    });

                    socket.on('lan_sale_sync', async (payload) => {
                        try {
                            socket.broadcast.emit('lan_sale_sync', payload);
                        } catch (e) {}
                    });
                });

                await new Promise((resPort) => {
                    httpServer.on('error', (err) => {
                        console.warn(`⚠️ Port ${p} is busy or could not be bound:`, err.message);
                        resPort();
                    });
                    httpServer.listen(p, () => {
                        console.log(`🚀 Server running on port ${p} (${isHttps ? 'HTTPS' : 'HTTP'})`);
                        servers.push({ server: httpServer, port: p });
                        resPort();
                    });
                });
            }

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

            // Initialize LAN Cluster Service (P2P Discovery & Sync)
            try {
                const LANClusterService = require('./services/LANClusterService');
                const primaryPort = portList[0] || 3000;
                LANClusterService.init(virtualIo, Number(primaryPort));
            } catch (lanErr) {
                console.warn('⚠️ Error al iniciar LAN Cluster Service:', lanErr.message);
            }

            // Start WhatsApp Bot automatically
            try {
                const WhatsappBotService = require('./services/WhatsappBotService');
                const { User } = require('./database/models');
                // Get the admin user to get the companyId
                const firstUser = await User.findOne({ where: { role: 'admin' } });
                const companyId = firstUser?.companyId || 'DEFAULT_COMPANY';
                
                WhatsappBotService.init(companyId);
                console.log('✅ WhatsApp Bot auto-start initiated.');
            } catch (err) {
                console.error('⚠️ Could not auto-start WhatsApp Bot:', err);
            }

            resolve({ servers, mainPort: portList[0] });
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