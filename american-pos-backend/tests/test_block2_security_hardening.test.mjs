import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const frontendRequire = createRequire(path.resolve(process.cwd(), '../american-pos-frontend/package.json'));

// Aislamiento estricto antes de cargar módulos del backend
const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-b2-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'b2-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || 'b2-owner-' + crypto.randomBytes(16).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'b2-backup-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'b2-audit-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'b2-sync-' + crypto.randomBytes(24).toString('hex');
process.env.LAN_CLUSTER_SECRET = process.env.LAN_CLUSTER_SECRET || 'b2-lan-' + crypto.randomBytes(24).toString('hex');

const { publicKey: testRsaPub, privateKey: testRsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env.LICENSE_PUBLIC_KEY_PEM = testRsaPub;
process.env.LICENSE_PRIVATE_KEY_PEM = testRsaPriv;
delete process.env.ALLOW_LEGACY_HMAC_LICENSES;

const DbConfigManager = require('../config/dbConfigManager');
const { startServer } = require('../index');
const bcrypt = require('bcryptjs');
const licenseUtils = require('../utils/licenseUtils');
const BackupEncryptionService = require('../services/BackupEncryptionService');
const LANClusterService = require('../services/LANClusterService');
const ExcelJS = require('exceljs');
const { io: ioClient } = frontendRequire('socket.io-client');
const { runWithTenantContext } = require('../database/tenantContext');

let srvHandle = null;
const cleanupSockets = [];
const createdIds = {
    users: [],
    products: [],
    stockAlerts: [],
    services: [],
    recharges: [],
    quarantines: [],
    purchaseOrders: [],
    auditLogs: [],
    files: []
};

async function loginAndGetToken(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    assert.equal(res.status, 200, `Login falló para ${username}: status=${res.status}`);
    const body = await res.json();
    assert.ok(body.token, `Login de ${username} debe entregar JWT`);
    return body;
}

function connectSocket(baseUrl, auth, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const socket = ioClient(baseUrl, {
            auth,
            extraHeaders,
            transports: ['websocket'],
            reconnection: false
        });
        cleanupSockets.push(socket);
        const timer = setTimeout(() => {
            try { socket.disconnect(); } catch (_) {}
            reject(new Error('Timeout esperando respuesta de Socket.IO'));
        }, 5000);
        socket.on('connect', () => {
            clearTimeout(timer);
            resolve({ connected: true, socket });
        });
        socket.on('connect_error', (err) => {
            clearTimeout(timer);
            try { socket.disconnect(); } catch (_) {}
            resolve({ connected: false, error: err?.message || 'connect_error' });
        });
    });
}

test.after(async () => {
    for (const s of cleanupSockets) {
        try { s.disconnect(); } catch (_) {}
    }
    try {
        const models = require('../database/models');
        if (createdIds.auditLogs.length && models.AuditLog) {
            await models.AuditLog.destroy({ where: { id: createdIds.auditLogs } }).catch(() => {});
        }
        if (createdIds.quarantines.length && models.QuarantineSale) {
            await models.QuarantineSale.destroy({ where: { id: createdIds.quarantines } }).catch(() => {});
        }
        if (createdIds.stockAlerts.length && models.StockAlert) {
            await models.StockAlert.destroy({ where: { id: createdIds.stockAlerts } }).catch(() => {});
        }
        if (createdIds.services.length && models.ServiceOrder) {
            await models.ServiceOrder.destroy({ where: { id: createdIds.services } }).catch(() => {});
        }
        if (createdIds.recharges.length && models.TelecomRecharge) {
            await models.TelecomRecharge.destroy({ where: { id: createdIds.recharges } }).catch(() => {});
        }
        if (createdIds.purchaseOrders.length && models.PurchaseOrder) {
            await models.PurchaseOrder.destroy({ where: { id: createdIds.purchaseOrders } }).catch(() => {});
        }
        if (createdIds.products.length && models.Product) {
            await models.StockMovement?.destroy({ where: { productId: createdIds.products } }).catch(() => {});
            await models.BranchStock?.destroy({ where: { productId: createdIds.products } }).catch(() => {});
            await models.Product.destroy({ where: { id: createdIds.products } }).catch(() => {});
        }
        if (createdIds.users.length && models.User) {
            await models.User.destroy({ where: { id: createdIds.users } }).catch(() => {});
        }
    } catch (_) {}
    for (const f of createdIds.files) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
    if (srvHandle && typeof srvHandle.stopServer === 'function') {
        await srvHandle.stopServer();
    }
    try {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('Bloque 2 (2A-2D): Hardening Criptográfico, RLS PostgreSQL, Auth/Sessions, Socket/Uploads y ExcelJS', async (t) => {
    // Asegurar arranque sobre americanpos_test
    assert.equal(DbConfigManager.getConfig().database, 'americanpos_test');
    srvHandle = await startServer([0], isolatedUserDataDir);
    const dbOk = await srvHandle.dbInitPromise;
    assert.equal(dbOk, true, 'Base de datos americanpos_test debe inicializar correctamente');
    const baseUrl = `http://127.0.0.1:${srvHandle.mainPort}`;

    const models = require('../database/models');
    const {
        sequelize,
        User,
        Product,
        StockAlert,
        ServiceOrder,
        TelecomRecharge,
        QuarantineSale,
        PurchaseOrder,
        AuditLog
    } = models;

    // Sembrar usuarios de prueba multi-tenant (CompA, CompB, Cajero CompA, SuperAdmin)
    const ts = Date.now();
    const compA = `b2_comp_a_${ts}`;
    const compB = `b2_comp_b_${ts}`;
    const testPwd = 'B2_Test_' + crypto.randomBytes(8).toString('hex');
    const testPwdHash = bcrypt.hashSync(testPwd, 8);
    const quickPinPlain = '4927';
    const quickPinHash = bcrypt.hashSync(quickPinPlain, 8);

    const superUser = await User.create({
        id: `b2-super-${ts}`,
        username: `b2_super_${ts}`,
        name: 'B2 SuperAdmin',
        email: `b2_super_${ts}@test.local`,
        password: testPwdHash,
        role: 'superadmin',
        status: 'active',
        companyId: compA,
        permissions: {}
    });
    const ownerA = await User.create({
        id: `b2-ownera-${ts}`,
        username: `b2_ownera_${ts}`,
        name: 'B2 Owner A',
        email: `b2_ownera_${ts}@test.local`,
        password: testPwdHash,
        quickPin: quickPinHash,
        role: 'owner',
        status: 'active',
        companyId: compA,
        permissions: { canManageInventory: true, canCreateProducts: true, canViewReports: true, canManageSettings: true }
    });
    const ownerB = await User.create({
        id: `b2-ownerb-${ts}`,
        username: `b2_ownerb_${ts}`,
        name: 'B2 Owner B',
        email: `b2_ownerb_${ts}@test.local`,
        password: testPwdHash,
        role: 'owner',
        status: 'active',
        companyId: compB,
        permissions: { canManageInventory: true, canCreateProducts: true, canViewReports: true, canManageSettings: true }
    });
    const cashierA = await User.create({
        id: `b2-cajeroa-${ts}`,
        username: `b2_cajeroa_${ts}`,
        name: 'B2 Cajero A',
        email: `b2_cajeroa_${ts}@test.local`,
        password: testPwdHash,
        role: 'cajero',
        status: 'active',
        companyId: compA,
        permissions: { canAccessPOS: true, canCreateSale: true, canManageSettings: false, canManageSuppliers: false }
    });
    const lockoutUser = await User.create({
        id: `b2-lock-${ts}`,
        username: `b2_lock_${ts}`,
        name: 'B2 Lockout',
        email: `b2_lock_${ts}@test.local`,
        password: testPwdHash,
        quickPin: quickPinHash,
        role: 'owner',
        status: 'active',
        companyId: compA,
        permissions: {}
    });
    createdIds.users.push(superUser.id, ownerA.id, ownerB.id, cashierA.id, lockoutUser.id);

    const superLogin = await loginAndGetToken(baseUrl, superUser.username, testPwd);
    const ownerALogin = await loginAndGetToken(baseUrl, ownerA.username, testPwd);
    const ownerBLogin = await loginAndGetToken(baseUrl, ownerB.username, testPwd);
    const cashierALogin = await loginAndGetToken(baseUrl, cashierA.username, testPwd);
    const lockoutLogin = await loginAndGetToken(baseUrl, lockoutUser.username, testPwd);

    // Activar licencia RSA v2 en esta terminal usando superadmin
    const machineId = await licenseUtils.getMachineId();
    const validV2Key = licenseUtils.generateKeyV2(machineId, 30, 'days');
    const actRes = await fetch(`${baseUrl}/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superLogin.token}` },
        body: JSON.stringify({ key: validV2Key, machineId })
    });
    const actBody = await actRes.text();
    assert.equal(actRes.status, 200, `Activación de licencia RSA v2 debe responder 200: ${actBody}`);

    await t.test('2A: Licencias RSA v2 obligatorias (cero downgrade v1), secretos separados y control en /license/activate', async () => {
        const checkV2 = await licenseUtils.validateKey(validV2Key, machineId);
        assert.equal(checkV2.valid, true);
        assert.equal(checkV2.version, 2);

        // Construir llave HMAC v1 legada
        const v1Payload = JSON.stringify({ mid: machineId, exp: Date.now() + 86400000, v: 1 });
        const v1Sig = crypto.createHmac('sha256', process.env.OWNER_SECRET_KEY).update(v1Payload).digest('hex');
        const v1Key = Buffer.from(`${v1Payload}.${v1Sig}`, 'utf8').toString('base64');

        const checkV1 = await licenseUtils.validateKey(v1Key, machineId);
        assert.equal(checkV1.valid, false, 'Licencia v1 debe ser rechazada cuando ALLOW_LEGACY_HMAC_LICENSES != true');
        assert.equal(checkV1.requiresUpgrade, true);

        // Terminal ya tiene licencia activa válida: intento sin autenticación con nueva llave debe recibir 403
        const unauthActivate = await fetch(`${baseUrl}/license/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: validV2Key, machineId })
        });
        assert.equal(unauthActivate.status, 403);

        // BackupEncryptionService exige BACKUP_ENCRYPTION_KEY independiente (prohibido reutilizar JWT_SECRET)
        const tmpIn = path.join(isolatedUserDataDir, 'bk-in.txt');
        const tmpEnc = path.join(isolatedUserDataDir, 'bk-out.enc');
        const tmpDec = path.join(isolatedUserDataDir, 'bk-dec.txt');
        fs.writeFileSync(tmpIn, 'contenido-sensible-respaldo', 'utf8');
        const prevBackupKey = process.env.BACKUP_ENCRYPTION_KEY;
        try {
            const encRes = BackupEncryptionService.encryptFile(tmpIn, tmpEnc);
            assert.equal(encRes.success, true);
            BackupEncryptionService.decryptFile(tmpEnc, tmpDec);
            assert.equal(fs.readFileSync(tmpDec, 'utf8'), 'contenido-sensible-respaldo');

            delete process.env.BACKUP_ENCRYPTION_KEY;
            assert.throws(() => BackupEncryptionService.encryptFile(tmpIn, tmpEnc), /BACKUP_ENCRYPTION_KEY/);
        } finally {
            process.env.BACKUP_ENCRYPTION_KEY = prevBackupKey;
        }

        // AuditLog exige AUDIT_HMAC_SECRET independiente (prohibido reutilizar JWT_SECRET)
        const prevAuditSecret = process.env.AUDIT_HMAC_SECRET;
        try {
            const okAudit = await AuditLog.create({
                id: `b2-aud-ok-${ts}`,
                userId: superUser.id,
                companyId: compA,
                action: 'B2_TEST_AUDIT',
                description: 'Prueba HMAC independiente',
                timestamp: new Date().toISOString()
            });
            createdIds.auditLogs.push(okAudit.id);
            assert.ok(okAudit.recordHash && okAudit.recordHash.length === 64);

            delete process.env.AUDIT_HMAC_SECRET;
            await assert.rejects(async () => {
                await AuditLog.create({
                    id: `b2-aud-fail-${ts}`,
                    userId: superUser.id,
                    companyId: compA,
                    action: 'B2_TEST_FAIL',
                    description: 'Debe fallar sin AUDIT_HMAC_SECRET',
                    timestamp: new Date().toISOString()
                });
            }, /AUDIT_HMAC_SECRET/);
        } finally {
            process.env.AUDIT_HMAC_SECRET = prevAuditSecret;
        }
    });

    await t.test('2B: Cifrado db-config.json, getPublicConfig sin password, validación dbName y HMAC UDP discovery', async () => {
        const plainSecretPwd = 'SuperPgSecret_2026!';
        const saveRes = DbConfigManager.saveConfig({
            host: '127.0.0.1',
            port: 5432,
            database: 'americanpos_test',
            user: 'postgres',
            password: plainSecretPwd
        });
        assert.equal(saveRes.success, true);

        const rawDisk = fs.readFileSync(DbConfigManager.getConfigFilePath(), 'utf8');
        assert.equal(rawDisk.includes(plainSecretPwd), false, 'db-config.json en disco NO puede guardar contraseña en texto claro');
        const parsedDisk = JSON.parse(rawDisk);
        assert.equal(parsedDisk.password, undefined);
        assert.equal(parsedDisk.passwordEncrypted, true);
        assert.ok(parsedDisk.passwordCipher);

        const pubCfg = DbConfigManager.getPublicConfig();
        assert.equal(pubCfg.password, undefined, 'getPublicConfig() nunca debe exponer password');
        assert.equal(pubCfg.hasPassword, true);
        assert.equal(pubCfg.passwordEncrypted, true);
        assert.equal(DbConfigManager.getConfig().password, plainSecretPwd);

        // Migración automática desde archivo legado en texto plano
        fs.writeFileSync(DbConfigManager.getConfigFilePath(), JSON.stringify({
            mode: 'server',
            dialect: 'postgres',
            host: '127.0.0.1',
            port: 5432,
            database: 'americanpos_test',
            user: 'postgres',
            password: plainSecretPwd
        }), 'utf8');
        const loadedCfg = DbConfigManager.getConfig();
        assert.equal(loadedCfg.password, plainSecretPwd);
        const migratedDisk = JSON.parse(fs.readFileSync(DbConfigManager.getConfigFilePath(), 'utf8'));
        assert.equal(migratedDisk.passwordEncrypted, true);
        assert.equal(migratedDisk.password, undefined);

        // Validación anti SQL Injection en dbName
        assert.throws(() => DbConfigManager.validateDatabaseName('americanpos; DROP TABLE users;--'), /inválido/);
        assert.throws(() => DbConfigManager.validateDatabaseName('bad-db-name'), /inválido/);
        assert.equal(DbConfigManager.validateDatabaseName('americanpos_test'), 'americanpos_test');

        // Verificación UDP discovery con firma HMAC y TTL
        LANClusterService.peers.clear();
        const remoteId = `remote-node-${ts}`;
        const validTs = Date.now();
        const validSig = LANClusterService.computePacketSignature({
            type: 'LAN_HEARTBEAT',
            nodeId: remoteId,
            ip: '192.168.1.55',
            httpPort: 3005,
            role: 'MASTER_CLOUD_HUB',
            timestamp: validTs
        });

        // Paquete sin firma o expirado debe ser descartado
        LANClusterService.handleIncomingPacket(Buffer.from(JSON.stringify({
            type: 'LAN_HEARTBEAT',
            nodeId: `${remoteId}-unsigned`,
            ip: '192.168.1.56',
            httpPort: 3005,
            role: 'MASTER_CLOUD_HUB',
            timestamp: validTs
        })), { address: '192.168.1.56' });
        assert.equal(LANClusterService.peers.has(`${remoteId}-unsigned`), false);

        const expiredTs = Date.now() - (6 * 60 * 1000);
        const expiredSig = LANClusterService.computePacketSignature({
            type: 'LAN_HEARTBEAT',
            nodeId: `${remoteId}-expired`,
            ip: '192.168.1.57',
            httpPort: 3005,
            role: 'MASTER_CLOUD_HUB',
            timestamp: expiredTs
        });
        LANClusterService.handleIncomingPacket(Buffer.from(JSON.stringify({
            type: 'LAN_HEARTBEAT',
            nodeId: `${remoteId}-expired`,
            ip: '192.168.1.57',
            httpPort: 3005,
            role: 'MASTER_CLOUD_HUB',
            timestamp: expiredTs,
            sig: expiredSig
        })), { address: '192.168.1.57' });
        assert.equal(LANClusterService.peers.has(`${remoteId}-expired`), false);

        // Paquete válido aceptado
        LANClusterService.handleIncomingPacket(Buffer.from(JSON.stringify({
            type: 'LAN_HEARTBEAT',
            nodeId: remoteId,
            ip: '192.168.1.55',
            httpPort: 3005,
            role: 'MASTER_CLOUD_HUB',
            timestamp: validTs,
            sig: validSig
        })), { address: '192.168.1.55' });
        assert.equal(LANClusterService.peers.has(remoteId), true);
        LANClusterService.peers.clear();

        // Verificación de endurecimiento estático en main.js (runtime Electron fuera de node --test)
        const mainSrc = fs.readFileSync(path.resolve(process.cwd(), 'main.js'), 'utf8');
        assert.match(mainSrc, /sandbox:\s*true/);
        assert.match(mainSrc, /will-attach-webview/);
        assert.match(mainSrc, /movilway\.net/);
        assert.match(mainSrc, /latest\.yml/);
        assert.match(mainSrc, /Get-AuthenticodeSignature/);
    });

    // Crear recursos de Empresa A para probar RLS e IDORs
    const prodA = await Product.create({
        id: `b2-proda-${ts}`,
        name: `Producto B2 CompA ${ts}`,
        barcode: `B2A${ts}`,
        price: 20,
        cost: 10,
        stockQuantity: 15,
        category: 'General',
        taxStatus: 'exento',
        companyId: compA
    });
    const prodB = await Product.create({
        id: `b2-prodb-${ts}`,
        name: `Producto B2 CompB ${ts}`,
        barcode: `B2B${ts}`,
        price: 30,
        cost: 15,
        stockQuantity: 15,
        category: 'General',
        taxStatus: 'exento',
        companyId: compB
    });
    const alertA = await StockAlert.create({
        id: `b2-alerta-${ts}`,
        productId: prodA.id,
        productName: prodA.name,
        saleId: `b2-sale-${ts}`,
        companyId: compA,
        expectedStock: 0,
        soldQuantity: 2,
        overdraftAmount: 2,
        resolved: false
    });
    const serviceA = await ServiceOrder.create({
        id: `b2-srv-${ts}`,
        customerName: 'Cliente A',
        assetDescription: 'POS Terminal B2',
        companyId: compA,
        status: 'RECEIVED',
        totalAmount: 50,
        balancePaid: 0
    });
    const rechargeA = await TelecomRecharge.create({
        id: `b2-rech-${ts}`,
        operator: 'Movistar',
        phoneNumber: '04141234567',
        nominalAmountBs: 100,
        serviceFeePercent: 10,
        serviceFeeBs: 10,
        totalChargedBs: 110,
        totalChargedUsd: 3,
        exchangeRate: 36.67,
        paymentMethod: 'Efectivo ($)',
        status: 'PENDIENTE',
        companyId: compA
    });
    const quarantineA = await QuarantineSale.create({
        id: `b2-q-${ts}`,
        companyId: compA,
        userId: ownerA.id,
        rawPayload: JSON.stringify({ items: [], total: 10 }),
        errorReason: 'TEST',
        status: 'quarantined'
    });
    const poA = await PurchaseOrder.create({
        id: `b2-poa-${ts}`,
        supplierId: 'b2-sup',
        status: 'pending',
        total: 100,
        companyId: compA,
        invoiceUrl: `/invoices/b2_secret_${ts}.pdf`
    });
    createdIds.products.push(prodA.id, prodB.id);
    createdIds.stockAlerts.push(alertA.id);
    createdIds.services.push(serviceA.id);
    createdIds.recharges.push(rechargeA.id);
    createdIds.quarantines.push(quarantineA.id);
    createdIds.purchaseOrders.push(poA.id);

    await t.test('2C: PostgreSQL RLS real (isaac_app NOBYPASSRLS), /logout, /quick-unlock lockout, anti-?token= y cierre de IDORs', async () => {
        // 1. Verificar rol isaac_app NOBYPASSRLS y políticas activas en PG
        const [roleRows] = await sequelize.query("SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'isaac_app'");
        assert.equal(roleRows.length, 1, 'El rol isaac_app debe existir en PostgreSQL');
        assert.equal(roleRows[0].rolbypassrls, false, 'isaac_app NO debe tener BYPASSRLS');

        const [rlsTables] = await sequelize.query(`
            SELECT relname, relrowsecurity, relforcerowsecurity
            FROM pg_class
            WHERE relname IN ('Products', 'Sales', 'CashShifts', 'ServiceOrders', 'StockAlerts')
              AND relkind = 'r'
        `);
        assert.ok(rlsTables.length >= 4);
        for (const tbl of rlsTables) {
            assert.equal(tbl.relrowsecurity, true, `${tbl.relname} debe tener ROW LEVEL SECURITY activo`);
            assert.equal(tbl.relforcerowsecurity, true, `${tbl.relname} debe tener FORCE ROW LEVEL SECURITY activo`);
        }

        // 2. Verificar aislamiento SQL real bajo tenantContext sin cláusula WHERE companyId
        const seenAsB = await runWithTenantContext({ companyId: compB, role: 'owner', userId: ownerB.id }, async () => {
            const [ctxRows] = await sequelize.query("SELECT current_user AS u, current_setting('app.current_company_id', true) AS c");
            assert.equal(ctxRows[0].u, 'isaac_app', 'La conexión con tenantContext debe ejecutar como isaac_app');
            assert.equal(ctxRows[0].c, compB);
            const [rows] = await sequelize.query('SELECT id FROM "Products" WHERE id = $1', { bind: [prodA.id] });
            return rows;
        });
        assert.equal(seenAsB.length, 0, 'RLS en PostgreSQL debe ocultar Productos de Empresa A al contexto de Empresa B');

        const seenAsA = await runWithTenantContext({ companyId: compA, role: 'owner', userId: ownerA.id }, async () => {
            const [rows] = await sequelize.query('SELECT id FROM "Products" WHERE id = $1', { bind: [prodA.id] });
            return rows;
        });
        assert.equal(seenAsA.length, 1, 'RLS en PostgreSQL debe permitir ver Productos propios de Empresa A');

        // 3. Bloqueo x-company-id a owner (no-superadmin), pero permitido a superadmin
        const crossHeaderRes = await fetch(`${baseUrl}/products`, {
            headers: {
                Authorization: `Bearer ${ownerALogin.token}`,
                'x-company-id': compB
            }
        });
        assert.equal(crossHeaderRes.status, 200);
        const ownerAProds = await crossHeaderRes.json();
        const prodListA = Array.isArray(ownerAProds) ? ownerAProds : (ownerAProds.products || []);
        assert.equal(prodListA.some(p => p.id === prodB.id), false, 'owner no puede usar x-company-id para leer otra empresa');

        const superCrossRes = await fetch(`${baseUrl}/products`, {
            headers: {
                Authorization: `Bearer ${superLogin.token}`,
                'x-company-id': compB
            }
        });
        assert.equal(superCrossRes.status, 200);
        const superProds = await superCrossRes.json();
        const superProdList = Array.isArray(superProds) ? superProds : (superProds.products || []);
        assert.equal(superProdList.some(p => p.id === prodB.id), true, 'superadmin sí puede inspeccionar otro tenant con x-company-id');

        // 4. Rechazo de ?token= y ?sync_key= en query strings
        const qTokenRes = await fetch(`${baseUrl}/products?token=${encodeURIComponent(ownerALogin.token)}`);
        assert.equal(qTokenRes.status, 401, 'No se debe aceptar JWT por query param ?token=');
        const qSyncRes = await fetch(`${baseUrl}/sync/pull?sync_key=${encodeURIComponent(process.env.SYNC_SECRET_KEY)}`);
        assert.ok([401, 403].includes(qSyncRes.status), `No se debe aceptar sync_key en query string (got ${qSyncRes.status})`);

        // 5. Ocultación de campos sensibles en /auth/login, /auth/me y /auth/public-cashiers
        assert.equal(ownerALogin.user.quickPin, undefined);
        assert.equal(ownerALogin.user.biometricTokenHash, undefined);
        assert.equal(ownerALogin.user.currentSessionId, undefined);
        const meRes = await fetch(`${baseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${ownerALogin.token}` }
        });
        assert.equal(meRes.status, 200);
        const meJson = await meRes.json();
        assert.equal(meJson.user?.quickPin, undefined);
        assert.equal(meJson.user?.biometricTokenHash, undefined);
        assert.equal(meJson.user?.currentSessionId, undefined);

        // 6. Revocación real en /auth/logout para HTTP y Socket.IO
        const revocableLogin = await loginAndGetToken(baseUrl, ownerA.username, testPwd);
        const sockBeforeLogout = await connectSocket(baseUrl, { token: revocableLogin.token });
        assert.equal(sockBeforeLogout.connected, true);
        sockBeforeLogout.socket.disconnect();

        const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${revocableLogin.token}` }
        });
        assert.equal(logoutRes.status, 200);

        const afterLogoutMe = await fetch(`${baseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${revocableLogin.token}` }
        });
        assert.equal(afterLogoutMe.status, 200);
        const afterLogoutMeJson = await afterLogoutMe.json();
        assert.equal(afterLogoutMeJson.authenticated, false, '/auth/me debe reportar authenticated: false tras /logout');

        const afterLogoutHttp = await fetch(`${baseUrl}/products`, {
            headers: { Authorization: `Bearer ${revocableLogin.token}` }
        });
        assert.equal(afterLogoutHttp.status, 401, 'Token revocado con /logout debe ser rechazado con 401 en rutas protegidas');
        const sockAfterLogout = await connectSocket(baseUrl, { token: revocableLogin.token });
        assert.equal(sockAfterLogout.connected, false, 'Token revocado con /logout debe ser rechazado en Socket.IO');

        // Re-login ownerA porque el segundo login rotó currentSessionId antes del logout
        const freshOwnerA = await loginAndGetToken(baseUrl, ownerA.username, testPwd);

        // 7. /auth/quick-unlock con PIN válido y lockout tras 5 fallos
        const unlockOk = await fetch(`${baseUrl}/auth/quick-unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshOwnerA.token}` },
            body: JSON.stringify({ pinOrPassword: quickPinPlain })
        });
        assert.equal(unlockOk.status, 200);

        for (let i = 0; i < 5; i++) {
            const failUnlock = await fetch(`${baseUrl}/auth/quick-unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lockoutLogin.token}` },
                body: JSON.stringify({ pinOrPassword: '0000_wrong' })
            });
            assert.equal(failUnlock.status, 401);
        }
        const lockedAttempt = await fetch(`${baseUrl}/auth/quick-unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lockoutLogin.token}` },
            body: JSON.stringify({ pinOrPassword: quickPinPlain })
        });
        assert.equal(lockedAttempt.status, 423, 'Tras 5 intentos fallidos en /quick-unlock debe bloquear con 423');

        // 8. Cierre de IDORs y RBAC
        const idorAlert = await fetch(`${baseUrl}/stock-alerts/${alertA.id}/resolve`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ownerBLogin.token}` }
        });
        assert.ok([403, 404].includes(idorAlert.status), `IDOR en /stock-alerts debe bloquearse por RLS o 403 (got ${idorAlert.status})`);

        const idorRecharge = await fetch(`${baseUrl}/recharges/${rechargeA.id}/complete`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerBLogin.token}` },
            body: JSON.stringify({ providerRef: 'FORGED' })
        });
        assert.ok([403, 404].includes(idorRecharge.status), `IDOR en /recharges debe bloquearse por RLS o 403 (got ${idorRecharge.status})`);

        const idorService = await fetch(`${baseUrl}/services/${serviceA.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerBLogin.token}` },
            body: JSON.stringify({ status: 'READY' })
        });
        assert.ok([403, 404].includes(idorService.status), `IDOR en /services debe bloquearse (got ${idorService.status})`);

        const rbacQuarantine = await fetch(`${baseUrl}/lan/quarantine`, {
            headers: { Authorization: `Bearer ${cashierALogin.token}` }
        });
        assert.equal(rbacQuarantine.status, 403, 'Cajero no puede acceder a /lan/quarantine');

        const idorQuarantine = await fetch(`${baseUrl}/lan/quarantine/${quarantineA.id}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerBLogin.token}` },
            body: JSON.stringify({ action: 'DISCARD' })
        });
        assert.ok([403, 404].includes(idorQuarantine.status), `IDOR en /lan/quarantine/:id/resolve debe bloquearse (got ${idorQuarantine.status})`);

        const rbacWhatsapp = await fetch(`${baseUrl}/api/whatsapp/send-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashierALogin.token}` },
            body: JSON.stringify({ phone: '04140000000', message: 'test' })
        });
        assert.equal(rbacWhatsapp.status, 403, 'Cajero sin permisos no puede invocar /whatsapp/send-order');

        // 9. Ausencia de backdoor hardcoded en schemaMigrator.js y en BD
        const migratorSrc = fs.readFileSync(path.resolve(process.cwd(), 'database/schemaMigrator.js'), 'utf8');
        assert.equal(migratorSrc.includes('mrivero105@gmail.com'), false, 'No debe existir email/backdoor hardcoded en schemaMigrator.js');
        assert.equal(migratorSrc.includes('$2b$10$C/Z5wL'), false, 'No deben existir hashes bcrypt fijos en schemaMigrator.js');
        const backdoorUser = await User.findOne({ where: { email: 'mrivero105@gmail.com' } });
        assert.equal(backdoorUser, null, 'No debe haberse sembrado cuenta mrivero105@gmail.com en americanpos_test');
    });

    await t.test('2D: Socket.IO CORS & HMAC Pairing, Path Traversal, Uploads seguros, Media Headers y ExcelJS', async () => {
        const freshOwnerA = await loginAndGetToken(baseUrl, ownerA.username, testPwd);
        const ownerAHeaders = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshOwnerA.token}`
        };

        // 1. Socket.IO rechaza Origin externo malicioso (CORS whitelist)
        const evilOriginSock = await connectSocket(
            baseUrl,
            { token: freshOwnerA.token },
            { Origin: 'https://evil.attacker.example' }
        );
        assert.equal(evilOriginSock.connected, false, 'Socket.IO debe rechazar Origin externo no autorizado');

        // 2. Visor de clientes sin displayToken o con displayToken forjado debe rechazarse
        const unauthDisplay = await connectSocket(baseUrl, {
            mode: 'customer_display',
            companyId: compA,
            registerId: '1'
        });
        assert.equal(unauthDisplay.connected, false, 'customer_display sin displayToken debe rechazarse');

        const forgedDisplay = await connectSocket(baseUrl, {
            mode: 'customer_display',
            companyId: compA,
            registerId: '1',
            displayToken: '0000deadbeef'
        });
        assert.equal(forgedDisplay.connected, false, 'customer_display con displayToken forjado debe rechazarse');

        // Obtener displayToken legítimo vía endpoint autenticado y conectar visor
        const pairingRes = await fetch(`${baseUrl}/settings/customer-display/pairing?registerId=1`, { headers: ownerAHeaders });
        assert.equal(pairingRes.status, 200);
        const pairingJson = await pairingRes.json();
        assert.ok(pairingJson.displayToken);

        const validDisplay = await connectSocket(baseUrl, {
            mode: 'customer_display',
            companyId: compA,
            registerId: '1',
            displayToken: pairingJson.displayToken
        });
        assert.equal(validDisplay.connected, true, 'customer_display con displayToken HMAC válido debe conectar');
        validDisplay.socket.disconnect();

        // 3. Path Traversal y acceso cross-tenant en facturas (/suppliers/analyze-invoice-data y /products/reparse-invoice)
        const travSupRes = await fetch(`${baseUrl}/suppliers/analyze-invoice-data`, {
            method: 'POST',
            headers: ownerAHeaders,
            body: JSON.stringify({ invoiceUrl: '../../.env' })
        });
        assert.ok([400, 403].includes(travSupRes.status), `Path traversal en /suppliers/analyze-invoice-data debe bloquearse (got ${travSupRes.status})`);

        const travProdRes = await fetch(`${baseUrl}/products/reparse-invoice`, {
            method: 'POST',
            headers: ownerAHeaders,
            body: JSON.stringify({ invoiceUrl: '../../package.json' })
        });
        assert.ok([400, 403].includes(travProdRes.status), `Path traversal en /products/reparse-invoice debe bloquearse (got ${travProdRes.status})`);

        // Archivo físico real en /invoices perteneciente a Empresa A -> bloqueado para Empresa B vía HTTP y vía /reparse-invoice
        const invoicesDir = path.join(isolatedUserDataDir, 'invoices');
        fs.mkdirSync(invoicesDir, { recursive: true });
        const invFileName = `b2_secret_${ts}.pdf`;
        const invFilePath = path.join(invoicesDir, invFileName);
        fs.writeFileSync(invFilePath, '%PDF-1.4\n%test', 'utf8');
        createdIds.files.push(invFilePath);

        const unauthInvGet = await fetch(`${baseUrl}/invoices/${invFileName}`);
        assert.equal(unauthInvGet.status, 401, 'GET /invoices sin JWT debe responder 401');

        const crossInvGet = await fetch(`${baseUrl}/invoices/${invFileName}`, {
            headers: { Authorization: `Bearer ${ownerBLogin.token}` }
        });
        assert.equal(crossInvGet.status, 403, 'GET /invoices de otra empresa debe responder 403');

        const ownInvGet = await fetch(`${baseUrl}/invoices/${invFileName}`, {
            headers: { Authorization: `Bearer ${freshOwnerA.token}` }
        });
        assert.equal(ownInvGet.status, 200);
        assert.equal(ownInvGet.headers.get('x-content-type-options'), 'nosniff');
        assert.match(String(ownInvGet.headers.get('content-security-policy') || ''), /sandbox/);

        const crossReparseRes = await fetch(`${baseUrl}/products/reparse-invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerBLogin.token}` },
            body: JSON.stringify({ invoiceUrl: `/invoices/${invFileName}` })
        });
        assert.equal(crossReparseRes.status, 403, 'POST /products/reparse-invoice cross-tenant debe responder 403');

        // 4. Bloqueo de uploads peligrosos (.svg / .html) y extensiones no multimedia en /uploads
        const badForm = new FormData();
        badForm.append('orderData', JSON.stringify({ customerName: 'XSS Test', totalAmount: 10 }));
        badForm.append('evidencia', new Blob(['<svg onload=alert(1)></svg>'], { type: 'image/svg+xml' }), 'xss.svg');
        const svgUploadRes = await fetch(`${baseUrl}/services`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${freshOwnerA.token}` },
            body: badForm
        });
        const svgUploadBody = await svgUploadRes.text();
        assert.equal(svgUploadRes.ok, false, `Upload .svg en /services debe ser rechazado (got ${svgUploadRes.status}: ${svgUploadBody})`);

        const uploadsSvgGet = await fetch(`${baseUrl}/uploads/forged_xss.svg`);
        assert.equal(uploadsSvgGet.status, 403, 'GET /uploads/*.svg debe bloquearse con 403');

        // 5. ExcelJS real: Exportación XLSX y protección contra prototype pollution en import/excel
        const exportRes = await fetch(`${baseUrl}/products/export/excel`, {
            headers: { Authorization: `Bearer ${freshOwnerA.token}` }
        });
        assert.equal(exportRes.status, 200, 'GET /products/export/excel debe responder 200 con ExcelJS');
        const exportBuf = Buffer.from(await exportRes.arrayBuffer());
        const exportedWb = new ExcelJS.Workbook();
        await exportedWb.xlsx.load(exportBuf);
        assert.ok(exportedWb.worksheets.length >= 1 && exportedWb.worksheets[0].rowCount >= 2, 'El XLSX exportado debe ser válido y contener filas');

        // Importar Excel con cabecera __proto__ debe bloquear prototype pollution y crear/actualizar el producto sano
        const impWb = new ExcelJS.Workbook();
        const impWs = impWb.addWorksheet('Productos');
        const uniqueImpBarcode = `B2IMP${ts}`;
        impWs.addRow(['__proto__', 'Nombre', 'Codigo', 'Precio', 'Costo', 'Stock', 'Categoria']);
        impWs.addRow(['{"pollutedB2":true}', `Prod ExcelJS ${ts}`, uniqueImpBarcode, 12.5, 6.0, 5, 'General']);
        const impBuf = Buffer.from(await impWb.xlsx.writeBuffer());

        const importRes = await fetch(`${baseUrl}/products/import/excel`, {
            method: 'POST',
            headers: ownerAHeaders,
            body: JSON.stringify({ base64: impBuf.toString('base64') })
        });
        assert.equal(importRes.status, 200, `POST /products/import/excel falló: status=${importRes.status}`);
        assert.equal(({}).pollutedB2, undefined, 'La importación ExcelJS no debe contaminar Object.prototype');

        const importedProd = await Product.findOne({ where: { barcode: uniqueImpBarcode, companyId: compA } });
        assert.ok(importedProd, 'Producto importado con ExcelJS debe existir en BD');
        createdIds.products.push(importedProd.id);
    });
});
