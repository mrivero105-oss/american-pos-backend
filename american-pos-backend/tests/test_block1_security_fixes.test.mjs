import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'TEST_BLOCK1_JWT_SECRET_2026_ULTRA_SAFE';
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'TEST_BLOCK1_SYNC_KEY_2026_ULTRA_SAFE';
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || 'TEST_BLOCK1_OWNER_KEY_2026_ULTRA_SAFE';
delete process.env.ALLOW_LEGACY_MASTER_KEY;

const require = createRequire(import.meta.url);
const express = require('express');
const jwt = require('jsonwebtoken');

function runMockMiddleware(mw, reqOpts = {}) {
    return new Promise((resolve) => {
        const req = {
            headers: {},
            query: {},
            body: {},
            params: {},
            path: '/',
            baseUrl: '',
            method: 'GET',
            ip: '192.168.1.50',
            user: null,
            ...reqOpts
        };
        let statusCode = 200;
        let payload = null;
        let resolved = false;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                payload = data;
                if (!resolved) {
                    resolved = true;
                    resolve({ statusCode, payload, nextCalled: false, req });
                }
                return this;
            }
        };
        Promise.resolve(mw(req, res, () => {
            if (!resolved) {
                resolved = true;
                resolve({ statusCode, payload, nextCalled: true, req });
            }
        })).catch((err) => {
            if (!resolved) {
                resolved = true;
                resolve({ statusCode: 500, payload: { error: err.message }, nextCalled: false, req, err });
            }
        });
    });
}

function sendAppRequest(app, { method = 'GET', url = '/', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            const rawBody = body ? JSON.stringify(body) : null;
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: url,
                method,
                headers: {
                    ...(rawBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody) } : {}),
                    ...headers
                }
            }, (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    server.close(() => {
                        let parsed = data;
                        try { parsed = JSON.parse(data); } catch (_) {}
                        resolve({ status: res.statusCode, body: parsed });
                    });
                });
            });
            req.on('error', (err) => server.close(() => reject(err)));
            if (rawBody) req.write(rawBody);
            req.end();
        });
    });
}

test('1A. CryptoService y LicenseUtils rechazan el secreto estático antiguo y restringen llaves maestras v1', async () => {
    const cryptoService = require('../utils/crypto-service.js');
    const licenseUtils = require('../utils/licenseUtils.js');

    const forgedPayload = JSON.stringify({ mid: 'MASTER-UNLOCK', master: true, exp: 'never', v: 1 });
    const legacyDefaultSig = crypto.createHmac('sha256', 'MasterOwnerSecret2026').update(forgedPayload).digest('hex');

    const cryptoCheck = cryptoService.verifyLicenseSignature(forgedPayload, legacyDefaultSig, 1);
    assert.equal(cryptoCheck.isValid, false, 'La firma con MasterOwnerSecret2026 debe ser rechazada');

    const ownerSig = crypto.createHmac('sha256', process.env.OWNER_SECRET_KEY).update(forgedPayload).digest('hex');
    const forgedB64 = Buffer.from(`${forgedPayload}.${ownerSig}`).toString('base64');
    const keyValidation = await licenseUtils.validateKey(forgedB64, 'TERM-AAAA-BBBB-CCCC');
    assert.equal(keyValidation.valid, false, 'Una llave maestra v1 no debe aplicar universalmente sin ALLOW_LEGACY_MASTER_KEY');
});

test('1B. ScannerService y FiscalSpoolerService bloquean inyecciones RCE y escritura arbitraria de archivos', async () => {
    const ScannerService = require('../services/ScannerService.js');
    const FiscalSpoolerService = require('../services/FiscalSpoolerService.js');

    await assert.rejects(
        () => ScannerService.scanDocument({ deviceId: "ESCL_NET_127.0.0.1'; calc; '" }),
        /inválido/i
    );

    await assert.rejects(
        () => FiscalSpoolerService.sendToComPort('COM1; calc.exe', 9600, 'I0'),
        /Puerto COM inválido/i
    );

    await assert.rejects(
        () => FiscalSpoolerService.sendToComPort('COM3', 999999, 'I0'),
        /baudRate no permitida/i
    );

    await assert.rejects(
        () => FiscalSpoolerService.sendToSpoolerFile('C:\\Windows\\System32\\evil.txt', 'TEST'),
        /fuera de directorios fiscales autorizados/i
    );

    await assert.rejects(
        () => FiscalSpoolerService.sendToSpoolerFile('C:\\IntTFHKA\\payload.exe', 'TEST'),
        /Extensión de archivo spooler no permitida/i
    );
});

test('1C. Middleware Auth bloquea spoofing x-company-id, bypass LAN /products, rutas admin con x-sync-key y replay/dominio cruzado de SupervisorApproval', async () => {
    const { verifyToken, requirePermission, invalidateUserAuthCache } = require('../middleware/auth.js');
    const { SupervisorApproval, User } = require('../database/models/index.js');

    const origUserFindByPk = User.findByPk;
    const origFindOne = SupervisorApproval.findOne;
    const origUpdate = SupervisorApproval.update;

    try {
        invalidateUserAuthCache('cash-1');
        invalidateUserAuthCache('sup-1');
        User.findByPk = async (id) => {
            if (String(id) === 'cash-1') {
                return { id: 'cash-1', status: 'active', role: 'cashier', companyId: 'default', permissions: {} };
            }
            if (String(id) === 'sup-1') {
                return { id: 'sup-1', status: 'active', role: 'superadmin', companyId: 'default', permissions: {} };
            }
            return origUserFindByPk.call(User, id);
        };

        // 1. Spoofing x-company-id por cajero autenticado
        const cashierToken = jwt.sign(
            { id: 'cash-1', username: 'cajero1', role: 'cashier', companyId: 'default' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        const spoofRes = await runMockMiddleware(verifyToken, {
            headers: { authorization: `Bearer ${cashierToken}`, 'x-company-id': 'otra-empresa-99' },
            path: '/products',
            method: 'GET'
        });
        assert.equal(spoofRes.nextCalled, true);
        assert.equal(spoofRes.req.user.companyId, 'default', 'Un cajero no debe poder cambiar su companyId via x-company-id');

        // 2. Superadmin sí puede seleccionar contexto multiempresa explícito
        const superToken = jwt.sign(
            { id: 'sup-1', username: 'owner1', role: 'superadmin', companyId: 'default' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        const superRes = await runMockMiddleware(verifyToken, {
            headers: { authorization: `Bearer ${superToken}`, 'x-company-id': 'empresa-2' },
            path: '/products',
            method: 'GET'
        });
        assert.equal(superRes.nextCalled, true);
        assert.equal(superRes.req.user.companyId, 'empresa-2');

        // 3. Bloqueo de /products sin autenticación en LAN incluso enviando x-terminal-id
        const lanBypassRes = await runMockMiddleware(verifyToken, {
            headers: { 'x-terminal-id': 'TERM-FAKE', 'x-company-id': '2' },
            ip: '192.168.1.45',
            path: '/products',
            method: 'GET'
        });
        assert.equal(lanBypassRes.nextCalled, false);
        assert.equal(lanBypassRes.statusCode, 401);

        // 4. Bloqueo x-sync-key en rutas administrativas críticas (/fiscal, /payroll, /whatsapp)
        for (const adminPath of ['/fiscal/sales-book', '/payroll/employees', '/whatsapp/start']) {
            const syncBlock = await runMockMiddleware(verifyToken, {
                headers: { 'x-sync-key': process.env.SYNC_SECRET_KEY },
                baseUrl: '/api',
                path: adminPath,
                method: 'GET'
            });
            assert.equal(syncBlock.nextCalled, false, `x-sync-key debe ser bloqueada en ${adminPath}`);
            assert.equal(syncBlock.statusCode, 403);
        }

        // 5. requirePermission array + SupervisorApproval ámbito y consumo atómico
        SupervisorApproval.findOne = async () => ({
            id: 'app-discount-1',
            companyId: '2',
            actionType: 'HIGH_DISCOUNT',
            used: false,
            expiresAt: null
        });
        let updateCalls = 0;
        SupervisorApproval.update = async () => {
            updateCalls++;
            return [1];
        };

        const crossDomainRes = await runMockMiddleware(requirePermission('canCreateProducts'), {
            user: { id: 'cash-1', role: 'cashier', companyId: '2', permissions: {} },
            body: { supervisorApprovalId: 'app-discount-1' }
        });
        assert.equal(crossDomainRes.nextCalled, false, 'HIGH_DISCOUNT no debe autorizar canCreateProducts');
        assert.equal(crossDomainRes.statusCode, 403);
        assert.equal(updateCalls, 0, 'No debe consumir el token si el dominio no coincide');

        SupervisorApproval.findOne = async () => ({
            id: 'app-bulk-1',
            companyId: '2',
            actionType: 'ACTUALIZACIÓN MASIVA DE PRECIOS',
            used: false,
            expiresAt: null
        });
        const validDomainRes = await runMockMiddleware(requirePermission('canCreateProducts'), {
            user: { id: 'cash-1', role: 'cashier', companyId: '2', permissions: {} },
            body: { supervisorApprovalId: 'app-bulk-1' }
        });
        assert.equal(validDomainRes.nextCalled, true);
        assert.equal(updateCalls, 1, 'Debe consumir atómicamente con SupervisorApproval.update');

        // Simular condición de carrera (ya consumido concurrentemente => update devuelve [0])
        SupervisorApproval.update = async () => [0];
        const replayRes = await runMockMiddleware(requirePermission('canCreateProducts'), {
            user: { id: 'cash-1', role: 'cashier', companyId: '2', permissions: {} },
            body: { supervisorApprovalId: 'app-bulk-1' }
        });
        assert.equal(replayRes.nextCalled, false, 'Si UPDATE atómico afecta 0 filas debe denegar 403');
        assert.equal(replayRes.statusCode, 403);

        // Permiso en array (['canManagePurchases', 'canManageSuppliers'])
        const arrayPermPass = await runMockMiddleware(requirePermission(['canManagePurchases', 'canManageSuppliers']), {
            user: { id: 'inv-1', role: 'inventory', companyId: '2', permissions: { canManageSuppliers: true } }
        });
        assert.equal(arrayPermPass.nextCalled, true);
    } finally {
        User.findByPk = origUserFindByPk;
        SupervisorApproval.findOne = origFindOne;
        SupervisorApproval.update = origUpdate;
        invalidateUserAuthCache('cash-1');
        invalidateUserAuthCache('sup-1');
    }
});

test('1D. Control de acceso RBAC en rutas administrativas, users (owner) y aislamiento estático/RLS', async () => {
    const fiscalRouter = require('../routes/fiscal.js');
    const payrollRouter = require('../routes/payroll.js');
    const collectionsRouter = require('../routes/collections.js');
    const assetsRouter = require('../routes/fixedAssets.js');
    const poRouter = require('../routes/purchaseOrders.js');
    const deliveryNotesRouter = require('../routes/deliveryNotes.js');
    const suppliersRouter = require('../routes/suppliers.js');
    const whatsappRouter = require('../routes/whatsapp.js');
    const systemRouter = require('../routes/system.js');
    const usersRouter = require('../routes/users.js');
    const { User } = require('../database/models/index.js');
    const { invalidateUserAuthCache } = require('../middleware/auth.js');

    const cashierPermissions = {
        canAccessPOS: true,
        canViewSalesHistory: true,
        canManageCashShift: true,
        canManageCustomers: true
    };

    const origUserFindByPk = User.findByPk;
    const origUserFindOne = User.findOne;
    invalidateUserAuthCache('c1');
    invalidateUserAuthCache('i1');
    invalidateUserAuthCache('adm-1');
    invalidateUserAuthCache('owner-1');

    User.findByPk = async (id) => {
        if (String(id) === 'c1') return { id: 'c1', status: 'active', role: 'cashier', companyId: '2', permissions: cashierPermissions };
        if (String(id) === 'i1') return { id: 'i1', status: 'active', role: 'inventory', companyId: '2', permissions: { canManageInventory: true } };
        if (String(id) === 'adm-1') return { id: 'adm-1', status: 'active', role: 'admin', companyId: '2', permissions: { canManageUsers: true } };
        if (String(id) === 'owner-1') return { id: 'owner-1', status: 'active', role: 'dueño', companyId: '2', email: 'owner@demo.com', username: 'dueno', permissions: {} };
        return null;
    };
    User.findOne = async (opts) => {
        if (opts && opts.where && String(opts.where.id || '') === 'owner-1') {
            return { id: 'owner-1', status: 'active', role: 'dueño', companyId: '2', email: 'owner@demo.com', username: 'dueno', permissions: {} };
        }
        return null;
    };

    const makeTestApp = (injectUser) => {
        const app = express();
        const bearerToken = jwt.sign(injectUser, process.env.JWT_SECRET, { expiresIn: '1h' });
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = injectUser;
            if (!req.headers.authorization) {
                req.headers.authorization = `Bearer ${bearerToken}`;
            }
            next();
        });
        app.use('/fiscal', fiscalRouter);
        app.use('/payroll', payrollRouter);
        app.use('/collections', collectionsRouter);
        app.use('/assets', assetsRouter);
        app.use('/purchase-orders', poRouter);
        app.use('/delivery-notes', deliveryNotesRouter);
        app.use('/suppliers', suppliersRouter);
        app.use('/whatsapp', whatsappRouter);
        app.use('/system', systemRouter);
        app.use('/users', usersRouter);
        return app;
    };

    try {
        const cashierApp = makeTestApp({ id: 'c1', role: 'cashier', companyId: '2', permissions: cashierPermissions });
        for (const ep of [
            ['GET', '/fiscal/sales-book'],
            ['GET', '/payroll/employees'],
            ['GET', '/collections/aging'],
            ['GET', '/assets/'],
            ['GET', '/purchase-orders/'],
            ['GET', '/suppliers/'],
            ['DELETE', '/delivery-notes/dn-1'],
            ['GET', '/system/health'],
            ['GET', '/system/updater/status']
        ]) {
            const res = await sendAppRequest(cashierApp, { method: ep[0], url: ep[1] });
            assert.equal(res.status, 403, `Cajero sin permiso debe recibir 403 en ${ep[0]} ${ep[1]}`);
        }

        // Usuario sin canAccessPOS bloqueado en /whatsapp/send-media
        const invOnlyApp = makeTestApp({ id: 'i1', role: 'inventory', companyId: '2', permissions: { canManageInventory: true } });
        const waBlocked = await sendAppRequest(invOnlyApp, { method: 'POST', url: '/whatsapp/send-media', body: { phone: '0414', imageBase64: 'x' } });
        assert.equal(waBlocked.status, 403);

        // Admin estándar NO puede modificar o eliminar a un dueño/owner/dueño
        const adminApp = makeTestApp({ id: 'adm-1', role: 'admin', companyId: '2', permissions: { canManageUsers: true } });

        const createOwner = await sendAppRequest(adminApp, {
            method: 'POST',
            url: '/users',
            body: { username: 'newowner', name: 'Owner', password: 'Password123!', role: 'owner' }
        });
        assert.equal(createOwner.status, 403);

        const editOwner = await sendAppRequest(adminApp, {
            method: 'PUT',
            url: '/users/owner-1',
            body: { name: 'Hack' }
        });
        assert.equal(editOwner.status, 403);

        const pinOwner = await sendAppRequest(adminApp, {
            method: 'POST',
            url: '/users/owner-1/supervisor-pin',
            body: { pin: '9999' }
        });
        assert.equal(pinOwner.status, 404, 'supervisor-pin oculta cuentas owner/superadmin con 404');

        const toggleOwner = await sendAppRequest(adminApp, {
            method: 'PATCH',
            url: '/users/owner-1/toggle-status'
        });
        assert.equal(toggleOwner.status, 404, 'toggle-status oculta cuentas owner/superadmin con 404');

        const delOwner = await sendAppRequest(adminApp, {
            method: 'DELETE',
            url: '/users/owner-1'
        });
        assert.equal(delOwner.status, 403);
    } finally {
        User.findByPk = origUserFindByPk;
        User.findOne = origUserFindOne;
        invalidateUserAuthCache('c1');
        invalidateUserAuthCache('i1');
        invalidateUserAuthCache('adm-1');
        invalidateUserAuthCache('owner-1');
    }

    // Verificación estática de cierre RLS fail-closed y cero fugas cross-tenant
    const tenantSrc = fs.readFileSync(path.join(process.cwd(), 'database/tenantContext.js'), 'utf8');
    assert.ok(!tenantSrc.includes("COALESCE(current_setting('app.current_company_id', true), '') = ''"), 'RLS no debe permitir bypass cuando app.current_company_id está vacío');
    assert.ok(tenantSrc.includes("NULLIF(current_setting('app.current_company_id', true), '')"), 'RLS debe exigir app.current_company_id válida o superadmin');

    const semSrc = fs.readFileSync(path.join(process.cwd(), 'services/SemanticSearchService.js'), 'utf8');
    assert.ok(!semSrc.includes("OR \"companyId\" = '2'") && !semSrc.includes("OR :companyId IS NULL"), 'SemanticSearchService no debe filtrar ni leer productos de otros tenants');

    const pubCatSrc = fs.readFileSync(path.join(process.cwd(), 'routes/publicCatalog.js'), 'utf8');
    assert.ok(!pubCatSrc.includes('dbCompanyIds') && !pubCatSrc.includes('companyCandidates'), 'publicCatalog.js no debe consultar ni mezclar productos de otros tenants');
});

after(async () => {
    try {
        const { sequelize } = require('../database/connection.js');
        if (sequelize && typeof sequelize.close === 'function') {
            await sequelize.close();
        }
    } catch (_) {}
});
