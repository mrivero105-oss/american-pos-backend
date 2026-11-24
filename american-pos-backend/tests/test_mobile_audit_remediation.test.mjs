import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Aislamiento estricto antes de cargar cualquier módulo del backend
const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-mobile-m2-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'm2-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || 'm2-owner-' + crypto.randomBytes(16).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'm2-bkp-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'm2-aud-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'm2-sync-' + crypto.randomBytes(24).toString('hex');
process.env.LAN_CLUSTER_SECRET = process.env.LAN_CLUSTER_SECRET || 'm2-lan-' + crypto.randomBytes(24).toString('hex');

const { publicKey: testRsaPub, privateKey: testRsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env.LICENSE_PUBLIC_KEY_PEM = testRsaPub;
process.env.LICENSE_PRIVATE_KEY_PEM = testRsaPriv;
delete process.env.ALLOW_LEGACY_HMAC_LICENSES;

const bcrypt = require('bcryptjs');
const { startServer } = require('../index');
const licenseUtils = require('../utils/licenseUtils');
const { clearLicenseCache } = require('../middleware/licenseMiddleware');
const AccountingEngineService = require('../services/AccountingEngineService');
const { canonicalizePaymentMethodId, isVesPaymentMethod } = require('../services/cash/cashHelpers');
const { SETTINGS_FILE } = require('../config/paths');
const { readJson, writeJson } = require('../utils/helpers');
const cache = require('../utils/cacheService');

let srvHandle = null;
const cleanupIds = {
    users: [],
    products: [],
    licenses: [],
    shifts: [],
    expenses: []
};
let priorActiveLicenseIds = [];

test.after(async () => {
    try {
        const models = require('../database/models');
        if (cleanupIds.expenses.length && models.Expense) {
            await models.Expense.destroy({ where: { id: cleanupIds.expenses } }).catch(() => {});
        }
        if (cleanupIds.shifts.length && models.CashShift) {
            await models.CashShift.destroy({ where: { id: cleanupIds.shifts } }).catch(() => {});
        }
        if (cleanupIds.products.length && models.Product) {
            await models.Product.destroy({ where: { id: cleanupIds.products } }).catch(() => {});
        }
        if (cleanupIds.licenses.length && models.License) {
            await models.License.destroy({ where: { id: cleanupIds.licenses } }).catch(() => {});
        }
        if (priorActiveLicenseIds.length && models.License) {
            await models.License.update({ status: 'active' }, { where: { id: priorActiveLicenseIds } }).catch(() => {});
        }
        if (cleanupIds.users.length && models.User) {
            await models.User.destroy({ where: { id: cleanupIds.users } }).catch(() => {});
        }
    } catch (_) {}

    clearLicenseCache();
    if (srvHandle?.stopServer) await srvHandle.stopServer();
    try { fs.rmSync(isolatedUserDataDir, { recursive: true, force: true }); } catch (_) {}
});

test('Suite Integral Fase M1+M2: Biometría ECDSA v2, RBAC Móvil, Modo Ciego, Gastos VES y Contabilidad', async (t) => {
    await t.test('1. AccountingEngineService y cashHelpers normalizan métodos con tildes y espacios', () => {
        assert.equal(AccountingEngineService._isBankMethod('Pago Móvil'), true);
        assert.equal(AccountingEngineService._isBankMethod('pago_movil'), true);
        assert.equal(AccountingEngineService._isBankMethod('Punto de Venta'), true);
        assert.equal(AccountingEngineService._isBankMethod('Efectivo USD'), false);

        assert.equal(canonicalizePaymentMethodId('Pago Móvil'), 'pago_movil');
        assert.equal(canonicalizePaymentMethodId('Punto de Venta'), 'debit');
        assert.equal(canonicalizePaymentMethodId('Efectivo Bs.'), 'cash_bs');
        assert.equal(isVesPaymentMethod('Pago Móvil'), true);
        assert.equal(isVesPaymentMethod('Efectivo USD'), false);
    });

    srvHandle = await startServer([0], isolatedUserDataDir);
    const dbOk = await srvHandle.dbInitPromise;
    assert.equal(dbOk, true);
    const posUrl = `http://127.0.0.1:${srvHandle.mainPort}`;
    const models = require('../database/models');
    const { User, License, Product, Expense } = models;

    const serverMachineId = await licenseUtils.getMachineId();
    const existingActives = await License.findAll({ where: { machineId: serverMachineId, status: 'active' } });
    priorActiveLicenseIds = existingActives.map((l) => l.id);

    const ts = Date.now();
    const companyId = `m2_comp_${ts}`;
    const pwd = 'M2_Password_' + crypto.randomBytes(6).toString('hex');
    const pwdHash = bcrypt.hashSync(pwd, 8);

    const adminUser = await User.create({
        id: `m2-admin-${ts}`,
        username: `m2_admin_${ts}`,
        name: 'Admin M2',
        email: `m2_admin_${ts}@test.local`,
        password: pwdHash,
        role: 'master',
        status: 'active',
        companyId,
        permissions: { canManageInventory: true, canCreateProducts: true, canManageExpenses: true, canManageCashShift: true, canViewCosts: true, canManageSettings: true }
    });
    const cashierUser = await User.create({
        id: `m2-cashier-${ts}`,
        username: `m2_cashier_${ts}`,
        name: 'Cajero M2',
        email: `m2_cashier_${ts}@test.local`,
        password: pwdHash,
        role: 'cashier',
        status: 'active',
        companyId,
        permissions: { canAccessPOS: true, canManageCashShift: true, canViewCosts: false, canCreateProducts: false, canManageInventory: false, canManageExpenses: false, canManageSettings: false }
    });
    const waiterUser = await User.create({
        id: `m2-waiter-${ts}`,
        username: `m2_waiter_${ts}`,
        name: 'Mesero M2',
        email: `m2_waiter_${ts}@test.local`,
        password: pwdHash,
        role: 'waiter',
        status: 'active',
        companyId,
        permissions: { canAccessPOS: true, canManageCashShift: false, canViewCosts: false, canManageExpenses: false }
    });
    cleanupIds.users.push(adminUser.id, cashierUser.id, waiterUser.id);

    const loginAs = async (username) => {
        const res = await fetch(`${posUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: pwd })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        return data.token;
    };

    const adminToken = await loginAs(adminUser.username);
    const cashierToken = await loginAs(cashierUser.username);
    const waiterToken = await loginAs(waiterUser.username);

    // Activar licencia en el servidor de pruebas
    const baseKey = licenseUtils.generateKeyV2(serverMachineId, 365);
    const actRes = await fetch(`${posUrl}/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ key: baseKey, machineId: serverMachineId })
    });
    assert.equal(actRes.status, 200);
    const actBody = await actRes.json();
    cleanupIds.licenses.push(actBody.license.id);

    await t.test('2. Biometría ECDSA P-256 v2: corte inmediato de v1, registro SPKI, reto único y anti-replay', async () => {
        // Rechazar registro v1 con biometricToken plano
        const legacyReg = await fetch(`${posUrl}/auth/biometrics/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierToken}` },
            body: JSON.stringify({ biometricToken: 'a'.repeat(64), deviceName: 'Legacy Phone' })
        });
        assert.equal(legacyReg.status, 400);

        // Rechazar login v1 sin challengeId/signature
        const legacyLogin = await fetch(`${posUrl}/auth/biometrics/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: cashierUser.id, biometricToken: 'a'.repeat(64) })
        });
        assert.equal(legacyLogin.status, 401);
        const legacyLoginBody = await legacyLogin.json();
        assert.equal(legacyLoginBody.code, 'BIOMETRIC_V2_REQUIRED');

        // Generar par ECDSA P-256 simulando AndroidKeyStore
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const spkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

        // Registrar clave pública SPKI
        const regRes = await fetch(`${posUrl}/auth/biometrics/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierToken}` },
            body: JSON.stringify({ publicKeySpki: spkiBase64, deviceName: 'Android TEE StrongBox' })
        });
        assert.equal(regRes.status, 200);
        const regBody = await regRes.json();
        assert.equal(regBody.version, 2);

        // Estado biométrico debe reportar enrolled=true, version=2
        const statusRes = await fetch(`${posUrl}/auth/biometrics/status`, {
            headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.equal(statusRes.status, 200);
        const statusBody = await statusRes.json();
        assert.equal(statusBody.enrolled, true);
        assert.equal(statusBody.version, 2);

        // Solicitar reto de un solo uso
        const chRes = await fetch(`${posUrl}/auth/biometrics/challenge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: cashierUser.id, username: cashierUser.username })
        });
        assert.equal(chRes.status, 200);
        const { challengeId, challenge } = await chRes.json();
        assert.ok(challengeId && challenge);

        // Firmar el reto con ECDSA SHA-256 (DER estándar, idéntico a Android SHA256withECDSA)
        const signatureBase64 = crypto.sign('sha256', Buffer.from(challenge, 'utf8'), privateKey).toString('base64');

        // Login biométrico exitoso
        const bioLoginRes = await fetch(`${posUrl}/auth/biometrics/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: cashierUser.id, challengeId, signature: signatureBase64 })
        });
        assert.equal(bioLoginRes.status, 200);
        const bioLoginBody = await bioLoginRes.json();
        assert.equal(bioLoginBody.success, true);
        assert.equal(bioLoginBody.version, 2);
        assert.ok(bioLoginBody.token);

        // Anti-replay: reutilizar el mismo challengeId debe fallar con 401
        const replayRes = await fetch(`${posUrl}/auth/biometrics/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: cashierUser.id, challengeId, signature: signatureBase64 })
        });
        assert.equal(replayRes.status, 401);

        // Firma falsificada sobre un reto nuevo debe fallar con 401
        const ch2Res = await fetch(`${posUrl}/auth/biometrics/challenge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: cashierUser.id })
        });
        const ch2 = await ch2Res.json();
        const { privateKey: attackerKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const forgedSig = crypto.sign('sha256', Buffer.from(ch2.challenge, 'utf8'), attackerKey).toString('base64');
        const forgedRes = await fetch(`${posUrl}/auth/biometrics/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: cashierUser.id, challengeId: ch2.challengeId, signature: forgedSig })
        });
        assert.equal(forgedRes.status, 401);
    });

    await t.test('3. RBAC Productos: /products/public-sync bloquea cajero (403) y GET /products/:id oculta costos', async () => {
        const prod = await Product.create({
            id: `m2-prod-${ts}`,
            name: 'Café Molido 500g',
            barcode: `CAFE-${ts}`,
            price: 10,
            cost: 6.25,
            margin: 60,
            stock: 20,
            stockQuantity: 20,
            companyId,
            status: 'active'
        });
        cleanupIds.products.push(prod.id);

        // Cajero sin permiso de catálogo no puede sincronizar/crear productos vía /public-sync
        const syncDeny = await fetch(`${posUrl}/products/public-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierToken}` },
            body: JSON.stringify({ products: [{ id: 'local-1', name: 'Hack', price: 0.01, stock: 100 }] })
        });
        assert.equal(syncDeny.status, 403);

        // Cajero sin canViewCosts no ve cost ni margin en GET /products/:id
        const getByCashier = await fetch(`${posUrl}/products/${prod.id}`, {
            headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.equal(getByCashier.status, 200);
        const prodCashier = await getByCashier.json();
        assert.equal(prodCashier.cost, undefined);
        assert.equal(prodCashier.margin, undefined);

        // Admin sí ve cost en GET /products/:id
        const getByAdmin = await fetch(`${posUrl}/products/${prod.id}`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(getByAdmin.status, 200);
        const prodAdmin = await getByAdmin.json();
        assert.equal(Number(prodAdmin.cost), 6.25);
    });

    await t.test('4. RBAC Caja + Modo Ciego en GET /cash/x-report', async () => {
        // Configurar modo BLIND + secretos en SETTINGS_FILE para esta empresa
        const allSettings = readJson(SETTINGS_FILE) || {};
        allSettings[companyId] = {
            ...(allSettings[companyId] || {}),
            cashClosureMode: 'BLIND',
            geminiApiKey: 'sk-test-secret-gemini',
            smtpPass: 'super-secret-smtp-pass',
            businessInfo: { name: 'Tienda Test M2', country: 'Venezuela' }
        };
        writeJson(SETTINGS_FILE, allSettings);
        cache.del('all_settings');

        // Mesero sin canManageCashShift recibe 403 en /cash/open, /cash/movement, /cash/x-report y /cash/history
        const openDeny = await fetch(`${posUrl}/cash/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${waiterToken}` },
            body: JSON.stringify({ amount: 50, registerId: 'M2-TEST' })
        });
        assert.equal(openDeny.status, 403);

        const xDeny = await fetch(`${posUrl}/cash/x-report?registerId=M2-TEST`, {
            headers: { Authorization: `Bearer ${waiterToken}` }
        });
        assert.equal(xDeny.status, 403);

        const histDeny = await fetch(`${posUrl}/cash/history`, {
            headers: { Authorization: `Bearer ${waiterToken}` }
        });
        assert.equal(histDeny.status, 403);

        // Cajero con canManageCashShift abre turno y consulta GET /cash/x-report -> modo ciego oculta esperados
        const openOk = await fetch(`${posUrl}/cash/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierToken}` },
            body: JSON.stringify({ amount: 100, registerId: 'M2-TEST' })
        });
        assert.equal(openOk.status, 201);
        const openedShift = await openOk.json();
        cleanupIds.shifts.push(openedShift.id);

        const xCashier = await fetch(`${posUrl}/cash/x-report?registerId=M2-TEST`, {
            headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.equal(xCashier.status, 200);
        const xData = await xCashier.json();
        assert.equal(xData.isBlindClose, true);
        assert.equal(xData.expectedAmount, null);
        assert.equal(xData.theoreticalTotalUsd, null);
        assert.equal(xData.expectedCashUsd, null);
        assert.equal(xData.expectedBreakdown, null);

        // Verificar sanitización de GET /settings para cajero sin canManageSettings
        const settingsCashierRes = await fetch(`${posUrl}/settings`, {
            headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.equal(settingsCashierRes.status, 200);
        const settingsCashier = await settingsCashierRes.json();
        assert.equal(settingsCashier.geminiApiKey, undefined);
        assert.equal(settingsCashier.smtpPass, undefined);
        assert.equal(settingsCashier.businessInfo?.name, 'Tienda Test M2');

        const settingsAdminRes = await fetch(`${posUrl}/settings`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(settingsAdminRes.status, 200);
        const settingsAdmin = await settingsAdminRes.json();
        assert.equal(settingsAdmin.geminiApiKey, 'sk-test-secret-gemini');
    });

    await t.test('5. Gastos: requirePermission array en GET /expenses y normalización BS -> VES en POST /expenses/public-sync', async () => {
        // Cajero con canManageCashShift (pero sin canManageExpenses) ahora SÍ puede leer GET /expenses y /summary
        const listRes = await fetch(`${posUrl}/expenses`, {
            headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.equal(listRes.status, 200);

        const sumRes = await fetch(`${posUrl}/expenses/summary`, {
            headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.equal(sumRes.status, 200);

        // Pero el cajero sin canManageExpenses NO puede crear gastos por public-sync
        const syncExpDeny = await fetch(`${posUrl}/expenses/public-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierToken}` },
            body: JSON.stringify({ expenses: [{ description: 'No autorizado', amount: 10, currency: 'BS' }] })
        });
        assert.equal(syncExpDeny.status, 403);

        // Admin sincroniza gasto en 'BS' -> ExpenseService.syncExpenses lo guarda como 'VES' sin crash y con idempotencia
        const expId = `m2-exp-${ts}`;
        const syncExpOk = await fetch(`${posUrl}/expenses/public-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({
                expenses: [{
                    id: expId,
                    description: 'Compra hielo tienda',
                    category: 'Operativo',
                    amount: 3500,
                    currency: 'BS',
                    paymentMethod: 'Pago Móvil'
                }]
            })
        });
        assert.equal(syncExpOk.status, 200);
        const syncExpBody = await syncExpOk.json();
        assert.equal(syncExpBody.success, true);
        assert.equal(syncExpBody.syncedCount, 1);
        assert.equal(syncExpBody.synced[0].action, 'created');
        const createdId = syncExpBody.synced[0].id;

        const savedExp = await Expense.findByPk(createdId);
        assert.ok(savedExp, 'El gasto sincronizado debe existir en BD');
        cleanupIds.expenses.push(savedExp.id);
        assert.equal(savedExp.currency, 'VES', 'Moneda BS debe normalizarse a VES en BD');

        // Reenvío idempotente del mismo ID no duplica
        const syncExpDup = await fetch(`${posUrl}/expenses/public-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({
                expenses: [{
                    id: createdId,
                    description: 'Compra hielo tienda',
                    category: 'Operativo',
                    amount: 3500,
                    currency: 'BS'
                }]
            })
        });
        assert.equal(syncExpDup.status, 200);
        const syncExpDupBody = await syncExpDup.json();
        assert.equal(syncExpDupBody.synced[0].action, 'skipped_existing');
    });
});
