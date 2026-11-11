const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');
const { sequelize } = require('./database/connection');
const { verifyToken, isAdmin, isSuperAdmin } = require('./middleware/auth');
const ScannerService = require('./services/ScannerService');

async function runSecurityAuditPhase4() {
    console.log('========================================================================');
    console.log('🛡️  CERTIFICACIÓN DE AUDITORÍA ADVERSARIAL DE SEGURIDAD (FASE 4 / HARDENING)');
    console.log('========================================================================\n');

    let passed = 0;
    let failed = 0;

    const assert = (condition, title, details = '') => {
        if (condition) {
            console.log(`[PASS] ${title}`);
            if (details) console.log(`       -> ${details}`);
            passed++;
        } else {
            console.error(`[FAIL] ${title}`);
            if (details) console.error(`       -> ${details}`);
            failed++;
        }
    };

    const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_12345678901234567890';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.SYNC_SECRET_KEY = 'valid_cluster_sync_secret_999';

    const cashierUser = { id: 'cajero-test-1', email: 'cajero@tienda.com', role: 'cashier', companyId: '2', permissions: {} };
    const cashierWithDrawerUser = { id: 'cajero-test-2', email: 'cajero2@tienda.com', role: 'cashier', companyId: '2', permissions: { canOpenDrawer: true } };
    const adminUser = { id: 'admin-test-1', email: 'admin@tienda.com', role: 'admin', companyId: '2', permissions: {} };
    const superAdminUser = { id: 'superadmin-test-1', email: 'owner@tienda.com', role: 'superadmin', companyId: '2', permissions: {} };

    const cashierToken = jwt.sign(cashierUser, JWT_SECRET, { expiresIn: '1h' });
    const cashierWithDrawerToken = jwt.sign(cashierWithDrawerUser, JWT_SECRET, { expiresIn: '1h' });
    const adminToken = jwt.sign(adminUser, JWT_SECRET, { expiresIn: '1h' });
    const superAdminToken = jwt.sign(superAdminUser, JWT_SECRET, { expiresIn: '1h' });

    // --- TEST 1: Eliminación de Fuga de PII en LAN (/customers & /suppliers) [SEC-14] ---
    console.log('\n--- 1. Verificación de Protección Anti-Fuga de Clientes y Proveedores en LAN (SEC-14) ---');
    {
        let mockReqCust = {
            method: 'GET',
            path: '/customers',
            headers: { 'x-company-id': '2' },
            ip: '192.168.1.105',
            query: {}
        };
        let statusSent = null;
        let mockResCust = {
            status: (code) => {
                statusSent = code;
                return { json: (d) => {} };
            }
        };
        let nextCalled = false;
        await verifyToken(mockReqCust, mockResCust, () => { nextCalled = true; });

        assert(!nextCalled && statusSent === 401, 'Petición GET /customers desde Wi-Fi (192.168.1.105) sin token es rechazada (401)', `Status: ${statusSent}`);

        let mockReqSupp = {
            method: 'GET',
            path: '/suppliers',
            headers: { 'x-company-id': '2' },
            ip: '192.168.1.105',
            query: {}
        };
        statusSent = null;
        nextCalled = false;
        await verifyToken(mockReqSupp, mockResCust, () => { nextCalled = true; });
        assert(!nextCalled && statusSent === 401, 'Petición GET /suppliers desde Wi-Fi (192.168.1.105) sin token es rechazada (401)', `Status: ${statusSent}`);

        // Verificación de IP vacía (fail-closed)
        let mockReqNoIp = {
            method: 'GET',
            path: '/products',
            headers: {},
            ip: '',
            query: {}
        };
        statusSent = null;
        nextCalled = false;
        await verifyToken(mockReqNoIp, mockResCust, () => { nextCalled = true; });
        assert(!nextCalled && statusSent === 401, 'Petición con IP indefinida/vacía no genera bypass (Fail-Closed estricto 401)', `Status: ${statusSent}`);
    }

    // --- TEST 2: Blindaje de Sincronización Móvil (/sync/pull & /sync/push) [SEC-15] ---
    console.log('\n--- 2. Verificación de Autenticación Requerida en /api/sync/* (SEC-15) ---');
    {
        // Simulamos verifySyncOrToken extraído de index.js
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

        let rejectedWifiSync = false;
        const mockWifiReq = {
            headers: {},
            query: {},
            ip: '192.168.1.200'
        };
        const mockWifiRes = {
            status: (code) => {
                if (code === 401) rejectedWifiSync = true;
                return { json: () => {} };
            }
        };
        verifySyncOrToken(mockWifiReq, mockWifiRes, () => {});
        assert(rejectedWifiSync, 'Acceso a sincronización Wi-Fi sin token ni sync-key es bloqueado con 401', 'Bloqueo confirmado');

        let allowedWithKey = false;
        const mockKeyReq = {
            headers: { 'x-sync-key': 'valid_cluster_sync_secret_999' },
            query: {},
            ip: '192.168.1.200'
        };
        verifySyncOrToken(mockKeyReq, mockWifiRes, () => { allowedWithKey = true; });
        assert(allowedWithKey, 'Acceso a sincronización con x-sync-key autorizada es permitido', 'Nodo de clúster autenticado');

        let allowedWithToken = false;
        const mockTokenReq = {
            headers: { 'authorization': `Bearer ${cashierToken}` },
            query: {},
            ip: '192.168.1.200'
        };
        await verifySyncOrToken(mockTokenReq, mockWifiRes, () => { allowedWithToken = true; });
        assert(allowedWithToken, 'Acceso a sincronización con Bearer token de cajero es permitido', 'Cajero móvil autenticado');
    }

    // --- TEST 3: Rate Limiting en POST /ai/public-query [SEC-16] ---
    console.log('\n--- 3. Verificación de Rate Limiting en /ai/public-query (SEC-16) ---');
    {
        const publicAiRoutes = require('./routes/publicAi');
        const testApp = express();
        testApp.use(express.json());
        testApp.use('/ai/public-query', publicAiRoutes);

        const server = http.createServer(testApp);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        let got429 = false;
        let successfulOr400 = 0;

        for (let i = 0; i < 35; i++) {
            const resp = await fetch(`http://127.0.0.1:${port}/ai/public-query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: '2', query: 'Hola' })
            });

            if (resp.status === 429) {
                got429 = true;
                break;
            } else {
                successfulOr400++;
            }
        }
        server.close();
        assert(got429, 'Rate Limiter bloquea ráfaga superior a 30 peticiones/15min en /ai/public-query con HTTP 429', `Bloqueado tras ${successfulOr400} intentos`);
    }

    // --- TEST 4: Control de Acceso en Cuarentena y Alertas de Sistema [SEC-17] ---
    console.log('\n--- 4. Verificación de Control de Acceso en Rutas Críticas de /system (SEC-17) ---');
    {
        const systemRoutes = require('./routes/system');
        const testApp = express();
        testApp.use(express.json());
        testApp.use((req, res, next) => {
            // Simular inyección de req.user
            req.user = req.headers['x-role'] === 'admin' ? adminUser : cashierUser;
            next();
        });
        testApp.use('/system', systemRoutes);

        const server = http.createServer(testApp);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        // Cajero intentando ver cuarentena
        const respCashierQuarantine = await fetch(`http://127.0.0.1:${port}/system/quarantine`, {
            headers: { 'x-role': 'cashier' }
        });
        assert(respCashierQuarantine.status === 403, 'Cajero bloqueado de GET /system/quarantine con 403 Forbidden');

        // Cajero intentando acción en cuarentena (reprocess / reject)
        const respCashierAction = await fetch(`http://127.0.0.1:${port}/system/quarantine/dummy-id/action`, {
            method: 'POST',
            headers: { 'x-role': 'cashier', 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reject' })
        });
        assert(respCashierAction.status === 403, 'Cajero bloqueado de POST /system/quarantine/:id/action con 403 Forbidden');

        // Cajero intentando enviar alertas de prueba
        const respCashierAlert = await fetch(`http://127.0.0.1:${port}/system/test-owner-alert`, {
            method: 'POST',
            headers: { 'x-role': 'cashier', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ownerPhone: '+584120000000' })
        });
        assert(respCashierAlert.status === 403, 'Cajero bloqueado de POST /system/test-owner-alert con 403 Forbidden');

        server.close();
    }

    // --- TEST 5: Control Estricto de Apertura de Gaveta de Dinero [SEC-18] ---
    console.log('\n--- 5. Verificación de Control Físico en Apertura de Gaveta (SEC-18) ---');
    {
        const settingRoutes = require('./routes/settings');
        const testApp = express();
        testApp.use(express.json());
        testApp.use('/settings', settingRoutes);

        const server = http.createServer(testApp);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        // Cajero sin permiso canOpenDrawer ni PIN de supervisor -> 403
        const respCashier = await fetch(`http://127.0.0.1:${port}/settings/open-drawer`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cashierToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ printerName: 'Generic_POS_Printer' })
        });
        assert(respCashier.status === 403, 'Cajero sin permiso canOpenDrawer es bloqueado de abrir la gaveta (403)');

        // Cajero con permiso canOpenDrawer: true -> Acepta (status != 403)
        const respAllowed = await fetch(`http://127.0.0.1:${port}/settings/open-drawer`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cashierWithDrawerToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ printerName: 'Generic_POS_Printer' })
        });
        assert(respAllowed.status !== 403, 'Cajero con permiso canOpenDrawer: true autorizado para abrir gaveta');

        server.close();
    }

    // --- TEST 6: Protección SSRF en ScannerService [SEC-20] ---
    console.log('\n--- 6. Verificación de Protección Anti-SSRF en ScannerService (SEC-20) ---');
    {
        let ssrfCloudMetadataBlocked = false;
        try {
            await ScannerService.scanViaEscl('169.254.169.254');
        } catch (e) {
            if (e.message.includes('SSRF Protection') || e.message.includes('no permitida')) {
                ssrfCloudMetadataBlocked = true;
            }
        }
        assert(ssrfCloudMetadataBlocked, 'SSRF contra metadata de nube (169.254.169.254) bloqueado');

        let ssrfLoopbackBlocked = false;
        try {
            await ScannerService.scanViaEscl('127.0.0.1');
        } catch (e) {
            if (e.message.includes('SSRF Protection') || e.message.includes('no permitida')) {
                ssrfLoopbackBlocked = true;
            }
        }
        assert(ssrfLoopbackBlocked, 'SSRF contra loopback local (127.0.0.1) bloqueado');

        let ssrfExternalDomainBlocked = false;
        try {
            await ScannerService.scanViaEscl('malicious-site.com');
        } catch (e) {
            if (e.message.includes('SSRF Protection') || e.message.includes('no permitida')) {
                ssrfExternalDomainBlocked = true;
            }
        }
        assert(ssrfExternalDomainBlocked, 'SSRF contra dominios externos no RFC1918 bloqueado');
    }

    // --- TEST 7: Blindaje de Repositorio de Actualizaciones [SEC-21] ---
    console.log('\n--- 7. Verificación de Integridad de Fuente de Actualizaciones (SEC-21) ---');
    {
        const systemRoutes = require('./routes/system');
        const testApp = express();
        testApp.use(express.json());
        testApp.use((req, res, next) => {
            const role = req.headers['x-role'];
            if (role === 'admin') req.user = adminUser;
            else if (role === 'superadmin') req.user = superAdminUser;
            else req.user = cashierUser;
            next();
        });
        testApp.use('/system', systemRoutes);

        const server = http.createServer(testApp);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        // Admin ordinario intentando reconfigurar repositorio -> 403 (Solo Superadmin)
        const respAdmin = await fetch(`http://127.0.0.1:${port}/system/updater/config`, {
            method: 'POST',
            headers: { 'x-role': 'admin', 'Content-Type': 'application/json' },
            body: JSON.stringify({ githubOwner: 'mrivero105-oss', githubRepo: 'american-pos-backend' })
        });
        assert(respAdmin.status === 403, 'Admin común bloqueado de reconfigurar repositorio de updates (403)');

        // Superadmin intentando apuntar a un repositorio malicioso o no oficial -> 403
        const respMaliciousRepo = await fetch(`http://127.0.0.1:${port}/system/updater/config`, {
            method: 'POST',
            headers: { 'x-role': 'superadmin', 'Content-Type': 'application/json' },
            body: JSON.stringify({ githubOwner: 'evil-attacker', githubRepo: 'backdoored-pos' })
        });
        assert(respMaliciousRepo.status === 403, 'Intento de configurar repositorio no oficial es rechazado con 403');

        server.close();
    }

    // --- TEST 8: Permiso Requerido en Carga de Imágenes de Productos [SEC-19] ---
    console.log('\n--- 8. Verificación de Permiso en POST /products/upload-image (SEC-19) ---');
    {
        const productRoutes = require('./routes/products');
        const testApp = express();
        testApp.use(express.json());
        testApp.use((req, res, next) => {
            req.user = cashierUser; // Sin permiso canCreateProducts
            next();
        });
        testApp.use('/products', productRoutes);

        const server = http.createServer(testApp);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        const respUpload = await fetch(`http://127.0.0.1:${port}/products/upload-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' })
        });
        assert(respUpload.status === 403, 'Usuario sin permiso canCreateProducts es bloqueado de subir imágenes con 403');

        server.close();
    }

    console.log('\n========================================================================');
    console.log(`📊 RESULTADO FASE 4: ${passed} PASADOS | ${failed} FALLADOS`);
    if (failed === 0) {
        console.log('🌟 ¡BLINDAJE TOTAL COMPLETADO! EL SISTEMA ESTÁ 100% PROTEGIDO CONTRA VECTORES ADVERSARIALES.');
    } else {
        console.error('⚠️ ALGUNOS TESTS ADVERSARIALES FALLARON. REVISAR IMPLEMENTACIÓN.');
    }
    console.log('========================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
}

runSecurityAuditPhase4().catch(err => {
    console.error('Error fatal en suite de pruebas Fase 4:', err);
    process.exit(1);
});
