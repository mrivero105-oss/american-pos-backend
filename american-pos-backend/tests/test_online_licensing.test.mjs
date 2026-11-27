import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Aislamiento estricto antes de cargar módulos del backend
const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-online-lic-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.ALLOW_ONLINE_LICENSE_TEST = '1';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ol-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || 'ol-owner-' + crypto.randomBytes(16).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'ol-backup-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'ol-audit-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'ol-sync-' + crypto.randomBytes(24).toString('hex');
process.env.LAN_CLUSTER_SECRET = process.env.LAN_CLUSTER_SECRET || 'ol-lan-' + crypto.randomBytes(24).toString('hex');

const { publicKey: testRsaPub, privateKey: testRsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env.LICENSE_PUBLIC_KEY_PEM = testRsaPub;
process.env.LICENSE_PRIVATE_KEY_PEM = testRsaPriv;
delete process.env.ALLOW_LEGACY_HMAC_LICENSES;

const { startServer } = require('../index');
const bcrypt = require('bcryptjs');
const licenseUtils = require('../utils/licenseUtils');
const OnlineLicenseService = require('../services/OnlineLicenseService');
const { clearLicenseCache } = require('../middleware/licenseMiddleware');
const {
    createLicenseGatewayApp,
    signRemoteLease,
    hashAdminPasswordScrypt,
    verifyAdminPassword,
    parseGraceDays
} = require('../../cloud_license_server/node-server/server');
const { LicenseStore } = require('../../cloud_license_server/node-server/licenseStore');

let posSrvHandle = null;
let gatewayServer = null;
let gatewayStore = null;
const createdUserIds = [];
const createdLicenseIds = [];
let priorActiveLicenseIds = [];
let targetMachineIdForCleanup = null;

async function loginAndGetToken(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    assert.equal(res.status, 200, `Login falló para ${username}: status=${res.status}`);
    const body = await res.json();
    assert.ok(body.token, 'Token JWT esperado en login');
    return body.token;
}

test.after(async () => {
    try {
        const models = require('../database/models');
        if (createdLicenseIds.length && models.License) {
            await models.License.destroy({ where: { id: createdLicenseIds } }).catch(() => {});
        }
        if (priorActiveLicenseIds.length && models.License) {
            await models.License.update({ status: 'active' }, { where: { id: priorActiveLicenseIds } }).catch(() => {});
        }
        if (createdUserIds.length && models.User) {
            await models.User.destroy({ where: { id: createdUserIds } }).catch(() => {});
        }
    } catch (_) {}

    if (targetMachineIdForCleanup) {
        try { clearLicenseCache(targetMachineIdForCleanup); } catch (_) {}
    }

    if (posSrvHandle && typeof posSrvHandle.stopServer === 'function') {
        await posSrvHandle.stopServer();
    }
    if (gatewayServer) {
        await new Promise((resolve) => gatewayServer.close(() => resolve()));
    }
    if (gatewayStore) {
        await gatewayStore.close();
    }
    try {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('Validación en Línea, Gracia Offline, Anti-Tamper y Suspensión Remota (POS <-> Cloud Gateway)', async (t) => {
    // 1. Iniciar Cloud License Gateway (node-server real con RSA-2048 efímero)
    const adminEmail = 'provider@isaacpos.test';
    const adminPassword = 'GwSecret_' + crypto.randomBytes(8).toString('hex');
    const adminApiSecret = 'gw-api-' + crypto.randomBytes(12).toString('hex');
    gatewayStore = new LicenseStore({
        jsonPath: path.join(isolatedUserDataDir, 'gateway_licenses.db.json')
    });
    const { app: gatewayApp } = await createLicenseGatewayApp({
        store: gatewayStore,
        privateKeyPem: testRsaPriv,
        adminEmail,
        adminPassword,
        adminJwtSecret: crypto.randomBytes(32).toString('hex'),
        adminApiSecret,
        defaultGraceDays: 7,
        autoRegisterActive: true
    });

    gatewayServer = await new Promise((resolve) => {
        const s = gatewayApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const gatewayPort = gatewayServer.address().port;
    const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

    // 2. Iniciar Backend POS en americanpos_test
    posSrvHandle = await startServer([0], isolatedUserDataDir);
    const dbOk = await posSrvHandle.dbInitPromise;
    assert.equal(dbOk, true, 'americanpos_test debe inicializar');
    const posUrl = `http://127.0.0.1:${posSrvHandle.mainPort}`;

    const models = require('../database/models');
    const { User, License } = models;
    const serverMachineId = await licenseUtils.getMachineId();
    targetMachineIdForCleanup = serverMachineId;

    // Respaldar posibles licencias activas previas de americanpos_test para no alterar suites vecinas
    const existingActive = await License.findAll({
        where: { machineId: serverMachineId, status: 'active' }
    });
    priorActiveLicenseIds = existingActive.map((l) => l.id);

    // Crear usuarios master y cashier aislados
    const ts = Date.now();
    const companyId = `ol_comp_${ts}`;
    const testPwd = 'OL_Test_' + crypto.randomBytes(8).toString('hex');
    const pwdHash = bcrypt.hashSync(testPwd, 8);

    const masterUser = await User.create({
        id: `ol-master-${ts}`,
        username: `ol_master_${ts}`,
        name: 'OL Master',
        email: `ol_master_${ts}@test.local`,
        password: pwdHash,
        role: 'master',
        status: 'active',
        companyId,
        permissions: {}
    });
    const cashierUser = await User.create({
        id: `ol-cashier-${ts}`,
        username: `ol_cashier_${ts}`,
        name: 'OL Cashier',
        email: `ol_cashier_${ts}@test.local`,
        password: pwdHash,
        role: 'cashier',
        status: 'active',
        companyId,
        permissions: {}
    });
    createdUserIds.push(masterUser.id, cashierUser.id);

    const masterToken = await loginAndGetToken(posUrl, masterUser.username, testPwd);
    const cashierToken = await loginAndGetToken(posUrl, cashierUser.username, testPwd);

    // Activar localmente el servidor con llave RSA v2
    const validKey = licenseUtils.generateKey(serverMachineId, 365);
    const actRes = await fetch(`${posUrl}/license/activate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${masterToken}`
        },
        body: JSON.stringify({ key: validKey, machineId: serverMachineId })
    });
    assert.equal(actRes.status, 200);
    const actBody = await actRes.json();
    assert.equal(actBody.success, true);
    assert.ok(actBody.license?.id);
    createdLicenseIds.push(actBody.license.id);

    await t.test('1. Modo 100% offline sin Gateway configurado permite operar sin restricciones remotas', async () => {
        OnlineLicenseService.saveGatewayUrl('');
        clearLicenseCache(serverMachineId);

        const stRes = await fetch(`${posUrl}/license/status`);
        assert.equal(stRes.status, 200);
        const stBody = await stRes.json();
        assert.equal(stBody.activated, true);
        assert.equal(stBody.gatewayConfigured, false);

        const prodRes = await fetch(`${posUrl}/products`, {
            headers: { Authorization: `Bearer ${masterToken}` }
        });
        assert.equal(prodRes.status, 200);
    });

    await t.test('2. Configuración segura del Gateway en /license/online-config (solo Master y URL válida)', async () => {
        const deniedCashier = await fetch(`${posUrl}/license/online-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cashierToken}`
            },
            body: JSON.stringify({ gatewayUrl })
        });
        assert.equal(deniedCashier.status, 403);

        const badScheme = await fetch(`${posUrl}/license/online-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${masterToken}`
            },
            body: JSON.stringify({ gatewayUrl: 'javascript:alert(1)' })
        });
        assert.equal(badScheme.status, 400);

        const saveOk = await fetch(`${posUrl}/license/online-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${masterToken}`
            },
            body: JSON.stringify({ gatewayUrl })
        });
        assert.equal(saveOk.status, 200);
        const saveBody = await saveOk.json();
        assert.equal(saveBody.gatewayUrl, gatewayUrl);

        const cfgRes = await fetch(`${posUrl}/license/online-config`, {
            headers: { Authorization: `Bearer ${masterToken}` }
        });
        assert.equal(cfgRes.status, 200);
        const cfgBody = await cfgRes.json();
        assert.equal(cfgBody.gatewayUrl, gatewayUrl);
        assert.equal(cfgBody.graceDays, 7);
    });

    let validLeaseToken = '';
    await t.test('3. Heartbeat firmado RSA-2048 emite leaseToken con gracia offline de 7 días', async () => {
        const syncRes = await fetch(`${posUrl}/license/sync-online`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: serverMachineId })
        });
        assert.equal(syncRes.status, 200);
        const syncBody = await syncRes.json();
        assert.equal(syncBody.success, true);
        assert.equal(syncBody.status, 'active');
        assert.equal(syncBody.suspended, false);
        assert.equal(syncBody.allowed, true);
        assert.ok(syncBody.graceUntil);

        const stored = await License.findByPk(actBody.license.id);
        assert.equal(stored.status, 'active');
        assert.ok(stored.meta?.onlineLeaseToken);
        assert.equal(stored.meta?.onlineLease?.status, 'active');
        validLeaseToken = stored.meta.onlineLeaseToken;

        const stRes = await fetch(`${posUrl}/license/status`);
        const stBody = await stRes.json();
        assert.equal(stBody.activated, true);
        assert.equal(stBody.onlinePolicy?.onlineVerified, true);
        assert.equal(stBody.onlinePolicy?.graceDays, 7);

        // Simular desconexión temporal del Gateway (puerto inalcanzable) dentro del periodo de gracia de 7 días
        OnlineLicenseService.saveGatewayUrl('http://127.0.0.1:59997');
        const offlineSync = await (await fetch(`${posUrl}/license/sync-online`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: serverMachineId })
        })).json();
        assert.equal(offlineSync.offline, true);

        const prodWhileGrace = await fetch(`${posUrl}/products`, {
            headers: { Authorization: `Bearer ${masterToken}` }
        });
        assert.equal(prodWhileGrace.status, 200, 'Dentro de los 7 días de gracia debe seguir operando offline');

        OnlineLicenseService.saveGatewayUrl(gatewayUrl);
    });

    await t.test('4. Protección criptográfica: rechaza leaseToken manipulado, asignado a otro HWID o firmado con clave falsa', async () => {
        const wrongMachineCheck = licenseUtils.verifyRemoteLeaseToken(validLeaseToken, 'OTHER-MACHINE-999');
        assert.equal(wrongMachineCheck.valid, false);

        const rawDecoded = Buffer.from(validLeaseToken, 'base64').toString('utf8');
        const tamperedB64 = Buffer.from(rawDecoded.replace('"active"', '"suspended"'), 'utf8').toString('base64');
        const tamperedCheck = licenseUtils.verifyRemoteLeaseToken(tamperedB64, serverMachineId);
        assert.equal(tamperedCheck.valid, false);

        // Firmar con una llave privada RSA ajena
        const { privateKey: roguePrivKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        const rogueSigned = signRemoteLease({
            machineId: serverMachineId,
            status: 'active',
            graceDays: 30
        }, roguePrivKey);
        const rogueVerify = licenseUtils.verifyRemoteLeaseToken(rogueSigned.leaseToken, serverMachineId);
        assert.equal(rogueVerify.valid, false);
    });

    await t.test('5. Suspensión remota por Proveedor bloquea /status y middleware HTTP con 403 y motivo exacto', async () => {
        const badLogin = await fetch(`${gatewayUrl}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminEmail, password: 'wrong-password' })
        });
        assert.equal(badLogin.status, 401);

        const okLogin = await fetch(`${gatewayUrl}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminEmail, password: adminPassword })
        });
        assert.equal(okLogin.status, 200);
        const { token: gwAdminToken } = await okLogin.json();
        assert.ok(gwAdminToken);

        const suspendReason = 'Falta de pago factura #2045';
        const suspRes = await fetch(`${gatewayUrl}/admin/licenses/${encodeURIComponent(serverMachineId)}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${gwAdminToken}`
            },
            body: JSON.stringify({ status: 'suspended', reason: suspendReason })
        });
        assert.equal(suspRes.status, 200);

        const syncAfterSuspend = await (await fetch(`${posUrl}/license/sync-online`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: serverMachineId })
        })).json();
        assert.equal(syncAfterSuspend.status, 'suspended');
        assert.equal(syncAfterSuspend.suspended, true);
        assert.equal(syncAfterSuspend.allowed, false);
        assert.equal(syncAfterSuspend.reason, suspendReason);

        const statusRes = await fetch(`${posUrl}/license/status`);
        const statusBody = await statusRes.json();
        assert.equal(statusBody.activated, false);
        assert.equal(statusBody.suspended, true);
        assert.equal(statusBody.blockLocalBypass, true);
        assert.equal(statusBody.reason, suspendReason);

        const blockedApiRes = await fetch(`${posUrl}/products`, {
            headers: { Authorization: `Bearer ${masterToken}` }
        });
        assert.equal(blockedApiRes.status, 403);
        const blockedBody = await blockedApiRes.json();
        assert.equal(blockedBody.error, 'licencia_suspendida');
        assert.equal(blockedBody.suspended, true);
        assert.equal(blockedBody.reason, suspendReason);
    });

    await t.test('6. Reactivación remota desde Gateway desbloquea el POS vía ?forceSync=1 sin re-pegar clave', async () => {
        const reactivateRes = await fetch(`${gatewayUrl}/admin/licenses/${encodeURIComponent(serverMachineId)}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-secret': adminApiSecret
            },
            body: JSON.stringify({ status: 'active' })
        });
        assert.equal(reactivateRes.status, 200);

        const statusForceRes = await fetch(`${posUrl}/license/status?forceSync=1`);
        const statusForceBody = await statusForceRes.json();
        assert.equal(statusForceBody.activated, true);
        assert.equal(Boolean(statusForceBody.suspended), false);

        const restoredApiRes = await fetch(`${posUrl}/products`, {
            headers: { Authorization: `Bearer ${masterToken}` }
        });
        assert.equal(restoredApiRes.status, 200);
    });

    await t.test('7. Expiración de gracia offline y detección de retroceso de reloj (anti-rollback)', async () => {
        const record = await License.findByPk(actBody.license.id);
        const eightDaysLaterMs = Date.now() + 8 * 86400000;
        const expiredEval = OnlineLicenseService.evaluateLocalLicenseWithOnlinePolicy(
            record,
            serverMachineId,
            eightDaysLaterMs,
            { gatewayUrl }
        );
        assert.equal(expiredEval.allowed, false);
        assert.equal(expiredEval.graceExpired, true);
        assert.equal(expiredEval.code, 'licencia_verificacion_requerida');

        // Simular retroceso de reloj de > 2 horas frente a maxObservedLocalMs
        const pastClockMs = Date.now() - 3 * 3600000;
        const skewEval = OnlineLicenseService.evaluateLocalLicenseWithOnlinePolicy(
            record,
            serverMachineId,
            pastClockMs,
            { gatewayUrl }
        );
        assert.equal(skewEval.allowed, false);
        assert.equal(skewEval.clockSkew, true);
        assert.equal(skewEval.graceExpired, true);

        // Validación HTTP E2E con un lease cuya fecha graceUntil ya expiró
        const expiredLeaseToken = licenseUtils.signRemoteLease({
            mid: serverMachineId,
            status: 'active',
            graceDays: 0,
            iat: Date.now() - 10 * 86400000,
            serverTime: Date.now() - 10 * 86400000,
            graceUntil: Date.now() - 10000
        }, testRsaPriv);

        await record.update({
            meta: {
                ...(record.meta || {}),
                onlineLeaseToken: expiredLeaseToken,
                onlineLease: {
                    ...(record.meta?.onlineLease || {}),
                    status: 'active',
                    graceUntil: Date.now() - 10000
                }
            }
        });
        clearLicenseCache(serverMachineId);

        const graceExpiredStatus = await (await fetch(`${posUrl}/license/status`)).json();
        assert.equal(graceExpiredStatus.activated, false);
        assert.equal(graceExpiredStatus.graceExpired, true);
        assert.equal(graceExpiredStatus.blockLocalBypass, true);

        const graceExpiredApi = await fetch(`${posUrl}/products`, {
            headers: { Authorization: `Bearer ${masterToken}` }
        });
        assert.equal(graceExpiredApi.status, 403);
        const graceExpiredBody = await graceExpiredApi.json();
        assert.equal(graceExpiredBody.error, 'licencia_verificacion_requerida');
        assert.equal(graceExpiredBody.graceExpired, true);

        // Recuperar mediante sincronización en línea exitosa
        const recoverRes = await (await fetch(`${posUrl}/license/sync-online`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: serverMachineId })
        })).json();
        assert.equal(recoverRes.allowed, true);
        assert.equal(recoverRes.status, 'active');
    });

    await t.test('8. Fase 2: Soporte real de graceDays=0 y validación estricta de expiración (expires_at / exp)', async () => {
        const zeroRes = await fetch(`${gatewayUrl}/admin/licenses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-secret': adminApiSecret
            },
            body: JSON.stringify({
                machineId: serverMachineId,
                status: 'active',
                graceDays: 0
            })
        });
        assert.equal(zeroRes.status, 200);
        const zeroBody = await zeroRes.json();
        assert.equal(zeroBody.license.grace_days, 0, 'graceDays=0 no debe convertirse en 7');
        assert.equal(parseGraceDays('0', 7), 0);

        const futurePlusTenMs = Date.now() + 10000;
        const expiredLeaseTok = licenseUtils.signRemoteLease({
            mid: serverMachineId,
            status: 'active',
            graceDays: 0,
            exp: Date.now() - 5000
        }, testRsaPriv);
        const parsedExpired = licenseUtils.verifyRemoteLeaseToken(expiredLeaseTok, serverMachineId);
        assert.equal(parsedExpired.valid, true);
        const evalExpired = OnlineLicenseService.evaluateLocalLicenseWithOnlinePolicy({
            id: 'tmp-exp',
            status: 'active',
            meta: {
                requiresOnlineValidation: true,
                onlineLeaseToken: expiredLeaseTok
            }
        }, serverMachineId, futurePlusTenMs, { gatewayUrl });
        assert.equal(evalExpired.allowed, false);
        assert.equal(evalExpired.expired, true);

        // Expiración en el Gateway auto-suspende el siguiente heartbeat
        const expiredMachineId = `POS-EXP-${Date.now()}`;
        await fetch(`${gatewayUrl}/admin/licenses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-secret': adminApiSecret
            },
            body: JSON.stringify({
                machineId: expiredMachineId,
                status: 'active',
                graceDays: 7,
                expiresAt: new Date(Date.now() - 60000).toISOString()
            })
        });
        const hbExp = await fetch(`${gatewayUrl}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: expiredMachineId })
        });
        assert.equal(hbExp.status, 200);
        const hbExpBody = await hbExp.json();
        assert.equal(hbExpBody.status, 'suspended');
        assert.equal(hbExpBody.graceDays, 0);
    });

    await t.test('9. Fase 2: Anti-DoS, prueba RSA en auto-registro, scrypt, events endpoint, rotación kid y anti-clonación HWID', async () => {
        // 9a. Auto-registro sin licenseKey debe rechazarse con 403
        const rogueMid = `POS-ROGUE-${Date.now()}`;
        const noKeyRes = await fetch(`${gatewayUrl}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: rogueMid, expiresAt: '2099-01-01T00:00:00.000Z' })
        });
        assert.equal(noKeyRes.status, 403, 'Auto-registro sin prueba RSA debe ser rechazado con 403');

        // 9b. Auto-registro con licenseKey RSA válida ignora expiresAt malicioso en body
        const legitimateNewMid = `POS-AUTO-${Date.now()}`;
        const signedKeyShort = licenseUtils.generateKeyV2(legitimateNewMid, 30);
        const okRegRes = await fetch(`${gatewayUrl}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                machineId: legitimateNewMid,
                licenseKey: signedKeyShort,
                expiresAt: '2099-12-31T00:00:00.000Z'
            })
        });
        assert.equal(okRegRes.status, 200);
        const regListRes = await fetch(`${gatewayUrl}/admin/licenses?q=${encodeURIComponent(legitimateNewMid)}`, {
            headers: { 'x-admin-secret': adminApiSecret }
        });
        assert.equal(regListRes.status, 200);
        const regListBody = await regListRes.json();
        const foundReg = regListBody.licenses.find((l) => l.machine_id === legitimateNewMid);
        assert.ok(foundReg);
        assert.notEqual(String(foundReg.expires_at).slice(0, 4), '2099', 'expires_at no debe aceptar valor arbitrario del cliente');

        // 9c. Eventos administrativos por máquina
        const evRes = await fetch(`${gatewayUrl}/admin/licenses/${encodeURIComponent(legitimateNewMid)}/events`, {
            headers: { 'x-admin-secret': adminApiSecret }
        });
        assert.equal(evRes.status, 200);
        const evBody = await evRes.json();
        assert.ok(Array.isArray(evBody.events) && evBody.events.length >= 1);

        // 9d. Autenticación scrypt en Gateway
        const scryptHash = hashAdminPasswordScrypt('Sup3r_Gw_Pass!');
        assert.equal(verifyAdminPassword('Sup3r_Gw_Pass!', scryptHash, '', false), true);
        assert.equal(verifyAdminPassword('wrong', scryptHash, '', false), false);
        assert.equal(verifyAdminPassword('plainPass', '', 'plainPass', false), false);

        // 9e. Cabeceras defensivas + rate-limit anti-DoS (429)
        const secHeaders = await fetch(`${gatewayUrl}/admin/licenses`, {
            headers: { 'x-admin-secret': adminApiSecret }
        });
        assert.equal(secHeaders.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(secHeaders.headers.get('x-frame-options'), 'DENY');
        assert.match(String(secHeaders.headers.get('cache-control') || ''), /no-store/);

        const tightStore = new LicenseStore({
            jsonPath: path.join(isolatedUserDataDir, 'tight_rl.db.json')
        });
        const { app: tightApp } = await createLicenseGatewayApp({
            store: tightStore,
            privateKeyPem: testRsaPriv,
            adminEmail,
            adminPassword,
            adminJwtSecret: crypto.randomBytes(32).toString('hex'),
            adminApiSecret,
            heartbeatRateLimitMax: 5,
            requireLicenseProofOnAutoRegister: false
        });
        const tightSrv = await new Promise((r) => { const s = tightApp.listen(0, '127.0.0.1', () => r(s)); });
        try {
            const tightUrl = `http://127.0.0.1:${tightSrv.address().port}`;
            let got429 = false;
            for (let i = 0; i < 8; i++) {
                const r = await fetch(`${tightUrl}/heartbeat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ machineId: `POS-RL-${Date.now()}` })
                });
                if (r.status === 429) { got429 = true; break; }
            }
            assert.equal(got429, true, 'Rate limiter en /heartbeat debe bloquear ráfagas con 429');
        } finally {
            await new Promise((r) => tightSrv.close(() => r()));
            await tightStore.close();
        }

        // 9f. Rotación multi-llave RSA con kid
        const { publicKey: nextPub, privateKey: nextPriv } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        process.env.LICENSE_PUBLIC_KEYS_JSON = JSON.stringify({ 'v2-next': nextPub });
        const rotatedTok = licenseUtils.signRemoteLease({
            kid: 'v2-next',
            mid: serverMachineId,
            status: 'active',
            graceDays: 5
        }, nextPriv);
        const rotatedCheck = licenseUtils.verifyRemoteLeaseToken(rotatedTok, serverMachineId);
        assert.equal(rotatedCheck.valid, true, 'verifyRemoteLeaseToken debe soportar rotación de llave vía kid');
        delete process.env.LICENSE_PUBLIC_KEYS_JSON;

        // 9g. Anti-clonación de .hwid_sticky entre máquinas distintas
        const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-hwid-clone-'));
        try {
            fs.writeFileSync(path.join(cloneDir, '.hwid_sticky'), 'POS-FOREIGN-CLONE-9999', 'utf8');
            fs.writeFileSync(path.join(cloneDir, '.hwid_sticky.sig'), '0'.repeat(64), 'utf8');
            const HardwareIdentityCtor = require('../utils/hardware-id').constructor;
            const prevUd = process.env.USER_DATA_PATH;
            process.env.USER_DATA_PATH = cloneDir;
            const hwidInstance = new HardwareIdentityCtor();
            const resolvedHwid = await hwidInstance.getStableNetId();
            process.env.USER_DATA_PATH = prevUd;
            assert.notEqual(resolvedHwid, 'POS-FOREIGN-CLONE-9999', 'HWID clonado de otra PC debe rechazarse por HMAC mismatch');
            assert.equal(fs.existsSync(path.join(cloneDir, '.hwid_sticky.sig')), true);
        } finally {
            fs.rmSync(cloneDir, { recursive: true, force: true });
        }
    });
});
