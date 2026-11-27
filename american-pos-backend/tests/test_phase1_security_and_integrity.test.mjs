import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-p1-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'p1-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || 'p1-owner-' + crypto.randomBytes(16).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'p1-backup-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'p1-audit-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'p1-sync-' + crypto.randomBytes(24).toString('hex');
process.env.LAN_CLUSTER_SECRET = process.env.LAN_CLUSTER_SECRET || 'p1-lan-' + crypto.randomBytes(24).toString('hex');

const { publicKey: rsaPub, privateKey: rsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env.LICENSE_PUBLIC_KEY_PEM = rsaPub;
process.env.LICENSE_PRIVATE_KEY_PEM = rsaPriv;

const DbConfigManager = require('../config/dbConfigManager');
const { startServer } = require('../index');
const bcrypt = require('bcryptjs');
const licenseUtils = require('../utils/licenseUtils');
const { safeSecretEqual } = require('../utils/helpers');
const { runWithTenantContext } = require('../database/tenantContext');
const SettingsStoreService = require('../services/SettingsStoreService');

let srvHandle = null;
const cleanup = {
    users: [],
    products: [],
    branches: [],
    sales: [],
    customers: [],
    companies: [],
    licenses: []
};

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    assert.equal(res.status, 200, `Login falló para ${username}: status=${res.status}`);
    return await res.json();
}

test.after(async () => {
    try {
        const models = require('../database/models');
        await runWithTenantContext({ companyId: '', userId: 'p1-cleanup', isSuperAdmin: true }, async () => {
            if (cleanup.sales.length) {
                await models.SaleItem?.destroy({ where: { saleId: cleanup.sales } }).catch(() => {});
                await models.Sale?.destroy({ where: { id: cleanup.sales } }).catch(() => {});
            }
            if (cleanup.products.length) {
                await models.StockMovement?.destroy({ where: { productId: cleanup.products } }).catch(() => {});
                await models.BranchStock?.destroy({ where: { productId: cleanup.products } }).catch(() => {});
                await models.Product?.destroy({ where: { id: cleanup.products } }).catch(() => {});
            }
            if (cleanup.branches.length) {
                await models.Branch?.destroy({ where: { id: cleanup.branches } }).catch(() => {});
            }
            if (cleanup.customers.length) {
                await models.Customer?.destroy({ where: { id: cleanup.customers } }).catch(() => {});
            }
            if (cleanup.companies.length && models.BusinessSetting) {
                await models.BusinessSetting.destroy({ where: { companyId: cleanup.companies } }).catch(() => {});
            }
            if (cleanup.licenses.length && models.License) {
                await models.License.destroy({ where: { id: cleanup.licenses } }).catch(() => {});
            }
            if (cleanup.users.length) {
                await models.User?.destroy({ where: { id: cleanup.users } }).catch(() => {});
            }
        });
    } catch (_) {}

    if (srvHandle && typeof srvHandle.stopServer === 'function') {
        await srvHandle.stopServer();
    }
    try {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('Fase 1: Seguridad IDOR, RBAC, x-sync-key allowlist, fail-closed Bearer, BranchStock, Sync Zero-Trust y BusinessSettings', async () => {
    assert.equal(DbConfigManager.getConfig().database, 'americanpos_test');
    srvHandle = await startServer([0], isolatedUserDataDir);
    const dbReady = await srvHandle.dbInitPromise;
    assert.equal(dbReady, true);
    const baseUrl = `http://127.0.0.1:${srvHandle.mainPort}`;

    const mid = await licenseUtils.getMachineId();
    const { License, User, Product, Branch, BranchStock, Sale, Customer, BusinessSetting } = require('../database/models');
    const licKey = licenseUtils.generateKeyV2(mid, 365);
    const ts = Date.now();
    const p1LicenseId = `p1-lic-${ts}`;
    cleanup.licenses.push(p1LicenseId);
    await runWithTenantContext({ companyId: '', userId: 'p1-seed', isSuperAdmin: true }, async () => {
        await License.update(
            { status: 'revoked' },
            { where: { machineId: mid, status: 'active' } }
        );
        await License.create({
            id: p1LicenseId,
            licenseKey: licKey,
            machineId: mid,
            status: 'active',
            activatedAt: new Date().toISOString()
        });
    });
    const compA = `p1_compA_${ts}`;
    const compB = `p1_compB_${ts}`;
    cleanup.companies.push(compA, compB);

    const pwd = 'P1_Strong_' + crypto.randomBytes(8).toString('hex');
    const pwdHash = bcrypt.hashSync(pwd, 8);

    const adminA = `p1-admin-a-${ts}`;
    const adminB = `p1-admin-b-${ts}`;
    const cashierA = `p1-cashier-a-${ts}`;
    cleanup.users.push(adminA, adminB, cashierA);

    await runWithTenantContext({ companyId: '', userId: 'p1-seed', isSuperAdmin: true }, async () => {
        await User.create({
            id: adminA,
            username: `p1_admina_${ts}`,
            email: `p1_admina_${ts}@test.local`,
            name: 'Admin A',
            password: pwdHash,
            role: 'admin',
            status: 'active',
            companyId: compA,
            permissions: { canManageInventory: true, canManageSettings: true, canAccessPOS: true }
        });
        await User.create({
            id: adminB,
            username: `p1_adminb_${ts}`,
            email: `p1_adminb_${ts}@test.local`,
            name: 'Admin B',
            password: pwdHash,
            role: 'admin',
            status: 'active',
            companyId: compB,
            permissions: { canManageInventory: true, canManageSettings: true, canAccessPOS: true }
        });
        await User.create({
            id: cashierA,
            username: `p1_cashiera_${ts}`,
            email: `p1_cashiera_${ts}@test.local`,
            name: 'Cashier A',
            password: pwdHash,
            role: 'cashier',
            status: 'active',
            companyId: compA,
            permissions: { canAccessPOS: true, canManageInventory: false, canManageSettings: false, canAdjustStock: false, canCreateProducts: false }
        });
    });

    const authAdminA = await login(baseUrl, `p1_admina_${ts}`, pwd);
    const authCashierA = await login(baseUrl, `p1_cashiera_${ts}`, pwd);

    // 1. safeSecretEqual longitud variable
    assert.equal(safeSecretEqual('secret123', 'secret123'), true);
    assert.equal(safeSecretEqual('123', '123456'), false);
    assert.equal(safeSecretEqual(null, '123'), false);

    // 2. Bearer inválido es fail-closed (401)
    const badBearerRes = await fetch(`${baseUrl}/products`, {
        headers: { Authorization: 'Bearer invalid.jwt.signature' }
    });
    assert.equal(badBearerRes.status, 401, 'Bearer inválido debe retornar 401 fail-closed');

    // 3. x-sync-key allowlist estricta (permite /products, bloquea mutaciones administrativas)
    const syncAllowed = await fetch(`${baseUrl}/products`, {
        headers: { 'x-sync-key': process.env.SYNC_SECRET_KEY, 'x-company-id': compA }
    });
    assert.equal(syncAllowed.status, 200, 'x-sync-key debe permitir GET /products');

    for (const blocked of [
        { method: 'POST', url: `/products/fake-id/lots`, body: { lotNumber: 'L1', quantity: 5 } },
        { method: 'PUT', url: `/cash/station-categories`, body: { registerId: '1', allowedCategories: ['General'] } },
        { method: 'POST', url: `/production/recipes`, body: { recipeName: 'R1', targetProductId: 'p1', items: [{ componentProductId: 'p2', quantityRequired: 1 }] } },
        { method: 'POST', url: `/settings/test-network-printer`, body: { ip: '192.168.1.50', port: 9100 } },
        { method: 'POST', url: `/settings/taxes`, body: { ivaRate: 16 } },
        { method: 'POST', url: `/settings/db-config`, body: { mode: 'client', host: '10.0.0.2' } }
    ]) {
        const res = await fetch(`${baseUrl}${blocked.url}`, {
            method: blocked.method,
            headers: {
                'Content-Type': 'application/json',
                'x-sync-key': process.env.SYNC_SECRET_KEY
            },
            body: JSON.stringify(blocked.body)
        });
        assert.equal(res.status, 403, `x-sync-key debe recibir 403 en ${blocked.method} ${blocked.url}, recibió ${res.status}`);
    }

    // 4. RBAC negativo con JWT de Cajero
    for (const denied of [
        { method: 'POST', url: `/products/fake-id/lots`, body: { lotNumber: 'L1', quantity: 5 } },
        { method: 'PUT', url: `/cash/station-categories`, body: { registerId: '1', allowedCategories: ['General'] } },
        { method: 'POST', url: `/production/recipes`, body: { recipeName: 'R1', targetProductId: 'p1', items: [{ componentProductId: 'p2', quantityRequired: 1 }] } },
        { method: 'POST', url: `/settings/test-network-printer`, body: { ip: '192.168.1.50', port: 9100 } }
    ]) {
        const res = await fetch(`${baseUrl}${denied.url}`, {
            method: denied.method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authCashierA.token}`
            },
            body: JSON.stringify(denied.body)
        });
        assert.equal(res.status, 403, `Cajero sin permiso debe recibir 403 en ${denied.method} ${denied.url}, recibió ${res.status}`);
    }

    // 5. Validación Zod (400 Bad Request)
    const emptyLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '123' })
    });
    assert.equal(emptyLogin.status, 400, 'Login sin username/email debe fallar con Zod 400');

    const negativeMovement = await fetch(`${baseUrl}/cash/movement`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authAdminA.token}`
        },
        body: JSON.stringify({ type: 'out', amount: -50 })
    });
    assert.equal(negativeMovement.status, 400, 'Movimiento con monto negativo debe fallar con Zod 400');

    // 6. Cierre de IDOR cross-tenant en POST /sales/:id/email y remote-held-sale
    const saleBId = `p1-sale-b-${ts}`;
    cleanup.sales.push(saleBId);
    await runWithTenantContext({ companyId: compB, userId: adminB, isSuperAdmin: false }, async () => {
        await Sale.create({
            id: saleBId,
            companyId: compB,
            userId: adminB,
            total: 42.5,
            subtotal: 42.5,
            tax: 0,
            discount: 0,
            paymentMethod: 'cash',
            paymentMethods: [{ method: 'cash', amount: 42.5, currency: 'USD' }],
            status: 'completed',
            date: new Date().toISOString(),
            timestamp: new Date().toISOString()
        });
    });

    const idorEmailRes = await fetch(`${baseUrl}/sales/${saleBId}/email`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authAdminA.token}`
        },
        body: JSON.stringify({ recipientEmail: 'attacker@evil.local' })
    });
    assert.equal(idorEmailRes.status, 404, 'Admin de CompA NO puede acceder ni enviar correo de venta de CompB');

    // 7. Transferencia BranchStock (/products/transfer) con columnas reales en PG16
    const prodAId = `p1-prod-a-${ts}`;
    const br1Id = `p1-br1-${ts}`;
    const br2Id = `p1-br2-${ts}`;
    cleanup.products.push(prodAId);
    cleanup.branches.push(br1Id, br2Id);

    await runWithTenantContext({ companyId: compA, userId: adminA, isSuperAdmin: false }, async () => {
        await Branch.create({ id: br1Id, companyId: compA, userId: adminA, name: 'Sucursal 1', isMain: true });
        await Branch.create({ id: br2Id, companyId: compA, userId: adminA, name: 'Sucursal 2', isMain: false });
        await Product.create({
            id: prodAId,
            companyId: compA,
            userId: adminA,
            name: `Harina Test ${ts}`,
            price: 12.5,
            cost: 8.0,
            stock: 20,
            stockQuantity: 20,
            taxStatus: 'exento',
            status: 'active',
            barcode: `P1-${ts}`
        });
        await BranchStock.create({
            productId: prodAId,
            branchId: br1Id,
            companyId: compA,
            quantity: 20
        });
    });

    const transferRes = await fetch(`${baseUrl}/products/transfer`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authAdminA.token}`
        },
        body: JSON.stringify({
            productId: prodAId,
            fromBranchId: br1Id,
            toBranchId: br2Id,
            quantity: 7,
            reason: 'Prueba de transferencia P1'
        })
    });
    assert.equal(transferRes.status, 200, 'POST /products/transfer debe funcionar usando columna quantity de BranchStocks');

    await runWithTenantContext({ companyId: compA, userId: adminA, isSuperAdmin: false }, async () => {
        const bs1 = await BranchStock.findOne({ where: { productId: prodAId, branchId: br1Id } });
        const bs2 = await BranchStock.findOne({ where: { productId: prodAId, branchId: br2Id } });
        assert.equal(Number(bs1.quantity), 13);
        assert.equal(Number(bs2.quantity), 7);
    });

    // 8. Motor Zero-Trust unificado en POST /sync/offline-sales
    // 8a: Cajero sin canModifyPrices intenta manipular price: 0.01 -> debe ser rechazado (errors)
    const tamperedOfflineId = `p1-off-tampered-${ts}`;
    const tamperedRes = await fetch(`${baseUrl}/sync/offline-sales`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authCashierA.token}`
        },
        body: JSON.stringify({
            sales: [{
                id: tamperedOfflineId,
                items: [{ productId: prodAId, name: 'Hacked', quantity: 2, price: 0.01 }],
                total: 0.02,
                paymentMethods: [{ method: 'cash', amount: 0.02, currency: 'USD' }],
                exchangeRate: 40
            }]
        })
    });
    assert.equal(tamperedRes.status, 200);
    const tamperedBody = await tamperedRes.json();
    assert.equal(tamperedBody.syncedIds.length, 0, 'Venta offline con precio manipulado por cajero NO debe sincronizarse');
    assert.equal(tamperedBody.errors.length, 1, 'Debe registrar error Zero-Trust de precio');

    // 8b: Cajero envía venta offline válida -> SaleService recalcula total real ($25) desde BD
    const offlineSaleId = `p1-off-${ts}`;
    cleanup.sales.push(offlineSaleId);
    const syncSaleRes = await fetch(`${baseUrl}/sync/offline-sales`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authCashierA.token}`
        },
        body: JSON.stringify({
            sales: [{
                id: offlineSaleId,
                items: [{ productId: prodAId, name: 'Harina Test', quantity: 2 }],
                total: 25,
                paymentMethods: [{ method: 'zelle', amount: 25, currency: 'USD' }],
                exchangeRate: 40
            }]
        })
    });
    assert.equal(syncSaleRes.status, 200, 'POST /sync/offline-sales debe responder 200');
    const syncBody = await syncSaleRes.json();
    assert.equal(syncBody.success, true);
    assert.ok(syncBody.syncedIds.includes(offlineSaleId), 'La venta offline válida debe quedar en syncedIds');

    await runWithTenantContext({ companyId: compA, userId: adminA, isSuperAdmin: false }, async () => {
        const storedSale = await Sale.findByPk(offlineSaleId);
        assert.ok(storedSale, 'La venta offline debe persistirse en PostgreSQL');
        assert.equal(Number(storedSale.total), 25, 'SaleService Zero-Trust debe recalcular total real (2 * $12.50 = $25), no $0.02');
        const updatedProd = await Product.findByPk(prodAId);
        assert.equal(Number(updatedProd.stockQuantity), 18, 'Stock debe descontarse a 18 tras venta offline');
    });

    // 9. BusinessSettings en PostgreSQL con bloqueo y RLS
    await SettingsStoreService.persistCompanySettings(compA, {
        exchangeRate: 64.5,
        businessInfo: { name: 'Comercio Fase 1 Test' }
    });
    const dbSetting = await runWithTenantContext({ companyId: compA, userId: adminA, isSuperAdmin: false }, async () => {
        return await BusinessSetting.findOne({ where: { companyId: compA } });
    });
    assert.ok(dbSetting, 'BusinessSetting debe guardarse en PostgreSQL');
    assert.equal(dbSetting.settings.exchangeRate, 64.5);

    const crossTenantSetting = await runWithTenantContext({ companyId: compB, userId: adminB, isSuperAdmin: false }, async () => {
        return await BusinessSetting.findOne({ where: { companyId: compA } });
    });
    assert.equal(crossTenantSetting, null, 'RLS en BusinessSettings debe aislar CompA de CompB');
});
