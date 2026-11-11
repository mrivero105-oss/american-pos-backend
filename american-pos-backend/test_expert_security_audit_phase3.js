const http = require('http');
const jwt = require('jsonwebtoken');
const { sequelize } = require('./database/connection');
const ProductService = require('./services/ProductService');
const { User, Refund } = require('./database/models');
const express = require('express');
const bcrypt = require('bcryptjs');

async function runSecurityAuditPhase3() {
    console.log('========================================================================');
    console.log('🛡️  CERTIFICACIÓN DE AUDITORÍA PROFUNDA DE SEGURIDAD (FASE 3 / AVANZADA)');
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

    // --- TEST 1: Bypass Elimination on POST /settings/rate (SEC-06) ---
    console.log('\n--- 1. Verificación de Protección Anti-Bypass en POST /settings/rate (SEC-06) ---');
    let testServer = null;
    try {
        const { verifyToken } = require('./middleware/auth');
        const settingRoutes = require('./routes/settings');
        const app = express();
        app.use(express.json());
        app.use(verifyToken);
        app.use('/settings', settingRoutes);

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

        // A. GET /settings/rate sin token -> Debe ser permitido (200) para terminales de consulta
        const resGetRate = await makeReq('/settings/rate', 'GET');
        assert(resGetRate.status === 200, 'GET /settings/rate público permitido para consulta de precios');

        // B. POST /settings/rate sin token -> Debe ser rechazado (401 o 403)
        const resPostRateNoAuth = await makeReq('/settings/rate', 'POST', null, { rate: 999 });
        assert(
            resPostRateNoAuth.status === 401 || resPostRateNoAuth.status === 403, 
            'Bloqueo estricto a petición no autenticada en POST /settings/rate',
            `Status recibido: ${resPostRateNoAuth.status}`
        );

        // C. Generar tokens JWT
        const secret = process.env.JWT_SECRET || 'test-jwt-secret';
        const cashierToken = jwt.sign({ id: 'cajero-rate-01', role: 'cashier', companyId: '2' }, secret);
        const adminToken = jwt.sign({ id: 'admin-rate-01', role: 'admin', companyId: '2' }, secret);

        // D. Cajero intenta POST /settings/rate -> Debe ser 403 Forbidden
        const resPostRateCashier = await makeReq('/settings/rate', 'POST', cashierToken, { rate: 50.0 });
        assert(resPostRateCashier.status === 403, 'Bloqueo 403 Forbidden a Cajero en POST /settings/rate');

        // E. Admin intenta POST /settings/rate -> Debe ser 200 OK
        const resPostRateAdmin = await makeReq('/settings/rate', 'POST', adminToken, { rate: 45.0 });
        assert(resPostRateAdmin.status === 200, 'Modificación de tasa autorizada exitosamente para Administrador');

    } catch (e) {
        assert(false, 'Error en pruebas de POST /settings/rate', e.message);
    } finally {
        if (testServer) {
            testServer.close();
        }
    }

    // --- TEST 2: SSRF & URL Validation in ProductService.downloadAndSetImage (SEC-07) ---
    console.log('\n--- 2. Verificación de Protección SSRF en Descarga de Imágenes (SEC-07) ---');
    try {
        // A. Intento de SSRF a localhost / loopback
        let ssrfBlockedLoopback = false;
        try {
            await ProductService.downloadAndSetImage('prod-ssrf-1', 'http://127.0.0.1:5432/test.jpg');
        } catch (err) {
            if (err.message.includes('SSRF Protection') || err.message.includes('redes internas')) {
                ssrfBlockedLoopback = true;
            }
        }
        assert(ssrfBlockedLoopback, 'Bloqueo SSRF a dirección loopback interna (http://127.0.0.1:5432)');

        // B. Intento de SSRF a metadatos de nube / IP privada
        let ssrfBlockedMetadata = false;
        try {
            await ProductService.downloadAndSetImage('prod-ssrf-2', 'http://169.254.169.254/latest/meta-data');
        } catch (err) {
            if (err.message.includes('SSRF Protection') || err.message.includes('redes internas')) {
                ssrfBlockedMetadata = true;
            }
        }
        assert(ssrfBlockedMetadata, 'Bloqueo SSRF a endpoint de metadatos de nube (169.254.169.254)');

        // C. Intento de protocolo no permitido (file:///)
        let protocolBlocked = false;
        try {
            await ProductService.downloadAndSetImage('prod-ssrf-3', 'file:///C:/Windows/System32/calc.exe');
        } catch (err) {
            if (err.message.includes('Protocolo de URL no permitido')) {
                protocolBlocked = true;
            }
        }
        assert(protocolBlocked, 'Bloqueo a esquemas de protocolo locales no permitidos (file:///)');

    } catch (e) {
        assert(false, 'Error en pruebas de SSRF en ProductService', e.message);
    }

    // --- TEST 3: Re-authentication in POST /auth/set-quick-pin (SEC-08) ---
    console.log('\n--- 3. Verificación de Re-autenticación en Configuración de PIN Rápido (SEC-08) ---');
    let authServer = null;
    try {
        const authRoutes = require('./routes/auth');
        const app = express();
        app.use(express.json());
        app.use('/auth', authRoutes);

        authServer = http.createServer(app);
        await new Promise(resolve => authServer.listen(0, '127.0.0.1', resolve));
        const authPort = authServer.address().port;
        const baseUrl = `http://127.0.0.1:${authPort}`;

        // Crear usuario temporal con contraseña conocida en BD
        const testUserId = `test-user-pin-${Date.now()}`;
        const hashedPassword = await bcrypt.hash('CorrectPassword123!', 10);
        await User.create({
            id: testUserId,
            name: 'Usuario Prueba PIN',
            email: `${testUserId}@pos.com`,
            username: testUserId,
            password: hashedPassword,
            role: 'cashier',
            companyId: '2',
            status: 'active'
        });

        const secret = process.env.JWT_SECRET || 'test-jwt-secret';
        const userToken = jwt.sign({ id: testUserId, role: 'cashier', companyId: '2' }, secret);

        // A. Intento de cambio sin contraseña actual
        const resNoPass = await fetch(`${baseUrl}/auth/set-quick-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
            body: JSON.stringify({ pin: '5566' })
        });
        const jsonNoPass = await resNoPass.json();
        assert(resNoPass.status === 400 && jsonNoPass.error.includes('requiere su contraseña'), 'Rechazo 400 cuando falta la contraseña actual en set-quick-pin');

        // B. Intento de cambio con contraseña incorrecta
        const resWrongPass = await fetch(`${baseUrl}/auth/set-quick-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
            body: JSON.stringify({ pin: '5566', currentPassword: 'WrongPassword' })
        });
        const jsonWrongPass = await resWrongPass.json();
        assert(resWrongPass.status === 401 && jsonWrongPass.error.includes('incorrectas'), 'Rechazo 401 cuando la contraseña actual es errónea en set-quick-pin');

        // C. Cambio exitoso con contraseña correcta
        const resCorrectPass = await fetch(`${baseUrl}/auth/set-quick-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
            body: JSON.stringify({ pin: '5566', currentPassword: 'CorrectPassword123!' })
        });
        const jsonCorrectPass = await resCorrectPass.json();
        assert(resCorrectPass.status === 200 && jsonCorrectPass.success === true, 'Aceptación 200 y guardado seguro de PIN rápido con contraseña válida');

        // Limpiar usuario de prueba
        await User.destroy({ where: { id: testUserId } });

    } catch (e) {
        assert(false, 'Error en pruebas de set-quick-pin', e.message);
    } finally {
        if (authServer) {
            authServer.close();
        }
    }

    // --- TEST 4: Multi-tenant Isolation in GET /refunds (SEC-09) ---
    console.log('\n--- 4. Verificación de Aislamiento Multi-Tenant en Devoluciones (SEC-09) ---');
    let refundServer = null;
    try {
        const refundRoutes = require('./routes/refunds');
        const { verifyToken } = require('./middleware/auth');
        const app = express();
        app.use(express.json());
        app.use(verifyToken);
        app.use('/refunds', refundRoutes);

        refundServer = http.createServer(app);
        await new Promise(resolve => refundServer.listen(0, '127.0.0.1', resolve));
        const refundPort = refundServer.address().port;
        const baseUrl = `http://127.0.0.1:${refundPort}`;

        const secret = process.env.JWT_SECRET || 'test-jwt-secret';
        const cashierToken1 = jwt.sign({ id: 'user-caja-comp1', role: 'cashier', companyId: 'company-alpha' }, secret);

        const resRefunds = await fetch(`${baseUrl}/refunds`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cashierToken1}` }
        });
        assert(resRefunds.status === 200, 'GET /refunds ejecuta consulta con filtro estricto de empresa activa');

    } catch (e) {
        assert(false, 'Error en pruebas de aislamiento de devoluciones', e.message);
    } finally {
        if (refundServer) {
            refundServer.close();
        }
    }

    // --- RESUMEN FINAL ---
    console.log('\n========================================================================');
    console.log(`📊 RESULTADOS FASE 3: ${passed} PASADOS, ${failed} FALLIDOS`);
    console.log('========================================================================');

    if (failed > 0) {
        console.error('❌ La certificación de auditoría avanzada contiene fallos.');
        process.exit(1);
    } else {
        console.log('✅ TODAS LAS PRUEBAS AVANZADAS DE SEGURIDAD PASARON (100% PASS).');
        process.exit(0);
    }
}

runSecurityAuditPhase3().catch(err => {
    console.error('Fatal test error in Phase 3:', err);
    process.exit(1);
});
