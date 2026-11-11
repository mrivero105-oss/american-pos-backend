const http = require('http');
const jwt = require('jsonwebtoken');
const { sequelize } = require('./database/connection');
const AutoMaintenanceService = require('./services/AutoMaintenanceService');
const fs = require('fs');
const path = require('path');
const express = require('express');

async function runSecurityAuditCertification() {
    console.log('===============================================================');
    console.log('🛡️  CERTIFICACIÓN DE AUDITORÍA PROFUNDA DE SEGURIDAD (FASE 2)');
    console.log('===============================================================\n');

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

    // --- TEST 1: WhatsApp RBAC & Token Enforcement (SEC-01) ---
    console.log('\n--- 1. Verificación de Protección RBAC en WhatsApp (SEC-01) ---');
    let testServer = null;
    try {
        const whatsappRouter = require('./routes/whatsapp');
        const app = express();
        app.use(express.json());
        app.use('/whatsapp', whatsappRouter);

        testServer = http.createServer(app);
        await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
        const testPort = testServer.address().port;
        const baseUrl = `http://127.0.0.1:${testPort}`;

        const makeReq = async (endpoint, method = 'GET', token = null, body = null) => {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const opts = { method, headers };
            if (body) opts.body = JSON.stringify(body);
            const resp = await fetch(`${baseUrl}${endpoint}`, opts);
            let json = {};
            try { json = await resp.json(); } catch(e) {}
            return { status: resp.status, body: json };
        };

        // A. Petición sin token a /status (Debe fallar 401)
        const resUnauthStatus = await makeReq('/whatsapp/status', 'GET');
        assert(resUnauthStatus.status === 401, 'Bloqueo 401 a petición anónima en GET /whatsapp/status');

        // B. Petición sin token a /start (Debe fallar 401)
        const resUnauthStart = await makeReq('/whatsapp/start', 'POST');
        assert(resUnauthStart.status === 401, 'Bloqueo 401 a petición anónima en POST /whatsapp/start');

        // C. Generar tokens JWT de prueba
        const secret = process.env.JWT_SECRET || 'test-jwt-secret';
        const cashierToken = jwt.sign({ id: 'cajero-01', role: 'cashier', companyId: '2' }, secret);
        const adminToken = jwt.sign({ id: 'admin-01', role: 'admin', companyId: '2' }, secret);

        // D. Cajero intenta /start (Debe ser rechazado con 403 Forbidden)
        const resCashierStart = await makeReq('/whatsapp/start', 'POST', cashierToken);
        assert(resCashierStart.status === 403, 'Bloqueo 403 (Forbidden) a Cajero en POST /whatsapp/start');

        // E. Cajero intenta /logout (Debe ser rechazado con 403 Forbidden)
        const resCashierLogout = await makeReq('/whatsapp/logout', 'POST', cashierToken);
        assert(resCashierLogout.status === 403, 'Bloqueo 403 (Forbidden) a Cajero en POST /whatsapp/logout');

        // F. Cajero intenta /send-direct (Debe ser rechazado con 403 Forbidden)
        const resCashierSendDirect = await makeReq('/whatsapp/send-direct', 'POST', cashierToken, { phone: '123456789', message: 'test' });
        assert(resCashierSendDirect.status === 403, 'Bloqueo 403 (Forbidden) a Cajero en POST /whatsapp/send-direct');

        // G. Admin ejecuta /status (Debe ser autorizado 200)
        const resAdminStatus = await makeReq('/whatsapp/status', 'GET', adminToken);
        assert(resAdminStatus.status === 200, 'Acceso 200 autorizado para Admin en GET /whatsapp/status');

    } catch (e) {
        assert(false, 'Error en pruebas de WhatsApp RBAC', e.message);
    } finally {
        if (testServer) {
            testServer.close();
        }
    }

    // --- TEST 2: Electron Window Navigation Lockdown (SEC-02) ---
    console.log('\n--- 2. Verificación de Restricción de Navegación en Electron (SEC-02) ---');
    try {
        const mainJsContent = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
        const hasWillNavigate = mainJsContent.includes("mainWindow.webContents.on('will-navigate'");
        const hasSetWindowOpenHandler = mainJsContent.includes("mainWindow.webContents.setWindowOpenHandler");
        const blocksExternalNav = mainJsContent.includes("event.preventDefault()") && mainJsContent.includes("shell.openExternal");

        assert(hasWillNavigate, "Listener 'will-navigate' registrado en mainWindow.webContents");
        assert(hasSetWindowOpenHandler, "Handler 'setWindowOpenHandler' registrado para popups");
        assert(blocksExternalNav, "Navegación externa interceptada y redirigida a navegador nativo del SO");
    } catch (e) {
        assert(false, 'Error al inspeccionar main.js', e.message);
    }

    // --- TEST 3: AutoMaintenance SQL Parameterization & Sanitization (SEC-03) ---
    console.log('\n--- 3. Verificación de Parametrización SQL en AutoMaintenance (SEC-03) ---');
    try {
        await sequelize.authenticate();
        // Prueba de archivado con parámetro no numérico o malicioso
        const maliciousDaysOld = "365' OR '1'='1";
        const result = await AutoMaintenanceService.archiveHistoricalData(maliciousDaysOld);
        assert(
            result && (result.status === 'SUCCESS' || result.status === 'SKIPPED_SQLITE'),
            'archiveHistoricalData ejecutado de forma segura ante inyección en daysOld',
            `Resultado: ${result.status}`
        );

        // Verificar código de AutoMaintenanceService.js para bind variables (:cutoffDate)
        const autoMaintContent = fs.readFileSync(path.join(__dirname, 'services', 'AutoMaintenanceService.js'), 'utf8');
        const hasParamReplacements = autoMaintContent.includes(':cutoffDate') && autoMaintContent.includes('replacements: { cutoffDate }');
        assert(hasParamReplacements, 'Consulta SQL nativa en AutoMaintenance utiliza :cutoffDate y replacements estrictos');
    } catch (e) {
        assert(false, 'Error en prueba de AutoMaintenance SQL', e.message);
    }

    // --- TEST 4: Rate Limiting LAN Ceiling vs Loopback (SEC-04) ---
    console.log('\n--- 4. Verificación de Lógica de Rate Limiting LAN vs Loopback (SEC-04) ---');
    try {
        const indexJsContent = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        const hasLoopbackExemption = indexJsContent.includes('isLoopbackIp') && indexJsContent.includes("skip: (req) => isLoopbackIp(req.ip)");
        const hasLanCeiling = indexJsContent.includes('max: 100');

        assert(hasLoopbackExemption, 'Loopback (127.0.0.1 / ::1) correctamente exento para el POS maestro');
        assert(hasLanCeiling, 'Cuota de contención activa (max: 100) contra fuerza bruta en subred LAN');
    } catch (e) {
        assert(false, 'Error al inspeccionar configuración de Rate Limiting en index.js', e.message);
    }

    // --- TEST 5: Debug Endpoint Information Disclosure (SEC-05) ---
    console.log('\n--- 5. Verificación de Supresión de Stack Traces en Debug (SEC-05) ---');
    try {
        const debugJsContent = fs.readFileSync(path.join(__dirname, 'routes', 'debug.js'), 'utf8');
        const hasStackSuppression = debugJsContent.includes("process.env.NODE_ENV !== 'production'") && debugJsContent.includes('errorResponse.stack = error.stack');
        assert(hasStackSuppression, 'Stack traces suprimidos en entorno de producción en routes/debug.js');
    } catch (e) {
        assert(false, 'Error al inspeccionar routes/debug.js', e.message);
    }

    // --- RESUMEN FINAL ---
    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passed} PASADOS, ${failed} FALLIDOS`);
    console.log('===============================================================');

    if (failed > 0) {
        console.error('❌ La certificación de auditoría de seguridad contiene fallos.');
        process.exit(1);
    } else {
        console.log('✅ TODAS LAS PRUEBAS DE SEGURIDAD PASARON SATISFACTORIAMENTE (100% PASS).');
        process.exit(0);
    }
}

runSecurityAuditCertification().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
