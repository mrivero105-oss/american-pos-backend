const assert = require('assert');
const path = require('path');

// Mock dotenv/environment variables
process.env.SYNC_SECRET_KEY = 'TEST_SYNC_SECRET_2026';
process.env.JWT_SECRET = 'TEST_JWT_SECRET_VERY_SECURE_KEY_12345';

const authMiddleware = require('../middleware/auth');
const { verifyToken, isAdmin, isSuperAdmin, isMaster, requirePermission } = authMiddleware;

function createMockReqRes(options = {}) {
    const req = {
        headers: options.headers || {},
        query: options.query || {},
        body: options.body || {},
        path: options.path || '/products',
        baseUrl: options.baseUrl || '',
        method: options.method || 'GET',
        ip: options.ip || '192.168.1.50',
        user: options.user || null
    };

    let statusCode = 200;
    let responseBody = null;
    let nextCalled = false;

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(data) {
            responseBody = data;
            return this;
        }
    };

    const next = () => {
        nextCalled = true;
    };

    return { req, res, next, getResult: () => ({ statusCode, responseBody, nextCalled }) };
}

async function runSecurityTests() {
    console.log('\n--- INICIANDO SUITE DE PRUEBAS DE SEGURIDAD LAN & ZERO-TRUST ---\n');
    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`❌ [FAIL] ${name}: ${err.message}`);
            failed++;
        }
    }

    // TEST 1: Petición legítima de terminal móvil con x-sync-key a catálogo
    await test('Terminal con x-sync-key recibe rol "terminal_presale" y permisos restringidos', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            headers: { 'x-sync-key': 'TEST_SYNC_SECRET_2026', 'x-company-id': '2' },
            path: '/products',
            method: 'GET'
        });

        await verifyToken(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, true, 'Next debe haber sido llamado');
        assert.ok(req.user, 'req.user debe estar definido');
        assert.strictEqual(req.user.role, 'terminal_presale', 'El rol DEBE ser "terminal_presale", NUNCA admin');
        assert.strictEqual(req.user.isSyncNode, true, 'isSyncNode debe ser true');
        assert.strictEqual(req.user.permissions.canCreatePresale, true, 'Debe tener permiso canCreatePresale');
        assert.strictEqual(req.user.permissions.canAccessAudit, false, 'NO debe tener permiso canAccessAudit');
        assert.strictEqual(req.user.permissions.canManageUsers, false, 'NO debe tener permiso canManageUsers');
    });

    // TEST 2: Intento de terminal móvil con x-sync-key de acceder a /api/users
    await test('Bloqueo 403 tajante si terminal móvil intenta acceder a /users', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            headers: { 'x-sync-key': 'TEST_SYNC_SECRET_2026' },
            baseUrl: '/api',
            path: '/users',
            method: 'GET'
        });

        await verifyToken(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, false, 'Next NO debe ser llamado');
        assert.strictEqual(result.statusCode, 403, 'Debe responder con 403 Forbidden');
        assert.strictEqual(result.responseBody?.error, 'terminal_no_autorizada');
    });

    // TEST 3: Intento de terminal móvil con x-sync-key de acceder a /backup
    await test('Bloqueo 403 tajante si terminal móvil intenta acceder a /backup', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            headers: { 'x-sync-key': 'TEST_SYNC_SECRET_2026' },
            baseUrl: '/api',
            path: '/backup/download',
            method: 'GET'
        });

        await verifyToken(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, false, 'Next NO debe ser llamado');
        assert.strictEqual(result.statusCode, 403, 'Debe responder con 403 Forbidden');
        assert.strictEqual(result.responseBody?.error, 'terminal_no_autorizada');
    });

    // TEST 4: Intento de terminal móvil de mutar configuración (PUT /settings)
    await test('Bloqueo 403 tajante si terminal móvil intenta mutar configuración (PUT /settings/business)', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            headers: { 'x-sync-key': 'TEST_SYNC_SECRET_2026' },
            baseUrl: '/api',
            path: '/settings/business',
            method: 'PUT'
        });

        await verifyToken(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, false, 'Next NO debe ser llamado');
        assert.strictEqual(result.statusCode, 403, 'Debe responder con 403 Forbidden');
        assert.strictEqual(result.responseBody?.error, 'terminal_no_autorizada');
    });

    // TEST 5: Intento de terminal móvil de borrar datos destructivamente (DELETE /products/123)
    await test('Bloqueo 403 tajante si terminal móvil intenta hacer DELETE de productos', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            headers: { 'x-sync-key': 'TEST_SYNC_SECRET_2026' },
            baseUrl: '/api',
            path: '/products/123',
            method: 'DELETE'
        });

        await verifyToken(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, false, 'Next NO debe ser llamado');
        assert.strictEqual(result.statusCode, 403, 'Debe responder con 403 Forbidden');
        assert.strictEqual(result.responseBody?.error, 'terminal_no_autorizada');
    });

    // TEST 6: Middleware isAdmin rechaza terminal_presale / isSyncNode
    await test('Middleware isAdmin rechaza estrictamente terminal_presale / isSyncNode', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            user: { id: '2', role: 'terminal_presale', isSyncNode: true }
        });

        isAdmin(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, false, 'Next NO debe ser llamado');
        assert.strictEqual(result.statusCode, 403, 'Debe responder con 403 Forbidden');
        assert.strictEqual(result.responseBody?.error, 'terminal_no_autorizada');
    });

    // TEST 7: Middleware isSuperAdmin rechaza terminal_presale / isSyncNode
    await test('Middleware isSuperAdmin rechaza estrictamente terminal_presale / isSyncNode', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            user: { id: '2', role: 'terminal_presale', isSyncNode: true }
        });

        isSuperAdmin(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, false, 'Next NO debe ser llamado');
        assert.strictEqual(result.statusCode, 403, 'Debe responder con 403 Forbidden');
        assert.strictEqual(result.responseBody?.error, 'terminal_no_autorizada');
    });

    // TEST 8: Middleware requirePermission rechaza acceso a auditoría desde terminal móvil
    await test('Middleware requirePermission("canAccessAudit") rechaza terminal móvil', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            user: { id: '2', role: 'terminal_presale', isSyncNode: true, permissions: { canAccessAudit: true } }
        });

        const middleware = requirePermission('canAccessAudit');
        await middleware(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, false, 'Next NO debe ser llamado');
        assert.strictEqual(result.statusCode, 403, 'Debe responder con 403 Forbidden');
        assert.strictEqual(result.responseBody?.error, 'forbidden');
    });

    // TEST 9: Usuario administrador legítimo en PC fija sigue teniendo acceso total a isAdmin
    await test('Usuario administrador legítimo en PC fija conserva acceso total (isAdmin: PASS)', async () => {
        const { req, res, next, getResult } = createMockReqRes({
            user: { id: '1', role: 'admin', isSyncNode: false }
        });

        isAdmin(req, res, next);
        const result = getResult();

        assert.strictEqual(result.nextCalled, true, 'Next DEBE ser llamado para admin legítimo');
        assert.strictEqual(result.statusCode, 200, 'Debe ser status 200');
    });

    console.log(`\n--- RESULTADOS: ${passed} PASADAS | ${failed} FALLIDAS ---`);
    if (failed > 0) {
        process.exit(1);
    }
}

runSecurityTests().catch(e => {
    console.error('Error fatal ejecutando pruebas:', e);
    process.exit(1);
});
