import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Aislamiento estricto antes de cargar cualquier módulo del backend
const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-hardening10-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'h10-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || 'h10-owner-' + crypto.randomBytes(16).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'h10-bkp-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'h10-aud-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'h10-sync-' + crypto.randomBytes(24).toString('hex');
process.env.LAN_CLUSTER_SECRET = process.env.LAN_CLUSTER_SECRET || 'h10-lan-' + crypto.randomBytes(24).toString('hex');

const { publicKey: testRsaPub, privateKey: testRsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env.LICENSE_PUBLIC_KEY_PEM = testRsaPub;
process.env.LICENSE_PRIVATE_KEY_PEM = testRsaPriv;
delete process.env.ALLOW_LEGACY_HMAC_LICENSES;

const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { startServer } = require('../index');
const validate = require('../middleware/validate');
const safeHttpImage = require('../utils/safeHttpImage');
const VortexMathEngine = require('../utils/VortexMathEngine');
const CloudMirrorService = require('../services/CloudMirrorService');
const NetworkPrinterService = require('../services/NetworkPrinterService');
const CashShiftService = require('../services/CashService');
const SaleService = require('../services/SaleService');
const licenseUtils = require('../utils/licenseUtils');
const { clearLicenseCache } = require('../middleware/licenseMiddleware');
const { createLicenseGatewayApp } = require('../../cloud_license_server/node-server/server');
const { LicenseStore } = require('../../cloud_license_server/node-server/licenseStore');

let srvHandle = null;
let gwServer = null;
let gwStore = null;
const cleanupIds = {
    users: [],
    products: [],
    licenses: [],
    shifts: [],
    auditLogs: []
};
let priorActiveLicenseIds = [];

test.after(async () => {
    try {
        const models = require('../database/models');
        if (cleanupIds.products.length && models.VarianteProducto) {
            await models.VarianteProducto.destroy({ where: { producto_id: cleanupIds.products } }).catch(() => {});
        }
        if (cleanupIds.products.length && models.Product) {
            await models.Product.destroy({ where: { id: cleanupIds.products } }).catch(() => {});
        }
        if (cleanupIds.shifts.length && models.CashShift) {
            await models.CashShift.destroy({ where: { id: cleanupIds.shifts } }).catch(() => {});
        }
        if (cleanupIds.auditLogs.length && models.AuditLog) {
            await models.AuditLog.destroy({ where: { id: cleanupIds.auditLogs } }).catch(() => {});
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
    if (gwServer) await new Promise((r) => gwServer.close(() => r()));
    if (gwStore) await gwStore.close();
    try { fs.rmSync(isolatedUserDataDir, { recursive: true, force: true }); } catch (_) {}
});

test('Suite Integral de Hardening 10/10 (Seguridad, Finanzas, Licencias, Variantes y Gateway)', async (t) => {
    await t.test('1. Anti-SSRF safeHttpImage bloquea IPs privadas/loopback/metadata y payloads SVG/HTML', async () => {
        assert.equal(safeHttpImage.isPrivateOrReservedIp('127.0.0.1'), true);
        assert.equal(safeHttpImage.isPrivateOrReservedIp('169.254.169.254'), true);
        assert.equal(safeHttpImage.isPrivateOrReservedIp('10.0.0.5'), true);
        assert.equal(safeHttpImage.isPrivateOrReservedIp('192.168.1.30'), true);
        assert.equal(safeHttpImage.isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
        assert.equal(safeHttpImage.isPrivateOrReservedIp('8.8.8.8'), false);

        await assert.rejects(() => safeHttpImage.fetchSafeImageBuffer('http://127.0.0.1:3005/secret'), /bloquead|privad|red local|inválid|loopback|prohibid/i);
        await assert.rejects(() => safeHttpImage.fetchSafeImageBuffer('http://169.254.169.254/latest/meta-data'), /bloquead|privad|red local|inválid|prohibid/i);
        await assert.rejects(() => safeHttpImage.fetchSafeImageBuffer('file:///etc/passwd'), /http|protocolo/i);

        // Magic bytes: rechaza SVG/HTML y acepta PNG/JPEG reales
        assert.equal(safeHttpImage.detectSafeRasterImage(Buffer.from('<svg onload="alert(1)"></svg>')), null);
        assert.equal(safeHttpImage.detectSafeRasterImage(Buffer.from('<html><body>xss</body></html>')), null);
        const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
        const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
        assert.equal(safeHttpImage.detectSafeRasterImage(pngHeader)?.ext, '.png');
        assert.equal(safeHttpImage.detectSafeRasterImage(jpegHeader)?.ext, '.jpg');
    });

    await t.test('2. CloudMirrorService.validateMirrorPath rechaza UNC, raíces de disco y carpetas del sistema', () => {
        assert.throws(() => CloudMirrorService.validateMirrorPath('\\\\evil-server\\share'), /UNC|inválida|red/i);
        assert.throws(() => CloudMirrorService.validateMirrorPath('C:\\'), /raíz|sistema|inválida/i);
        assert.throws(() => CloudMirrorService.validateMirrorPath('C:\\Windows\\System32'), /sistema|protegida|inválida/i);
        const safeSubDir = path.join(isolatedUserDataDir, 'mirror_ok');
        const validated = CloudMirrorService.validateMirrorPath(safeSubDir);
        assert.equal(path.resolve(validated), path.resolve(safeSubDir));
    });

    await t.test('3. Middleware validate.js soporta Zod v4 (.issues) sin filtrar JSON crudo de error.message', () => {
        const schema = z.object({
            body: z.object({
                name: z.string().min(3, 'Nombre muy corto'),
                price: z.number().positive('Precio debe ser positivo')
            })
        });
        const mw = validate(schema);
        let statusCode = 200;
        let payload = null;
        const res = {
            status(code) { statusCode = code; return this; },
            json(obj) { payload = obj; return this; }
        };
        mw({ body: { name: 'A', price: -5 }, query: {}, params: {} }, res, () => {
            throw new Error('next() no debía ejecutarse con body inválido');
        });
        assert.equal(statusCode, 400);
        assert.ok(Array.isArray(payload.details) && payload.details.length >= 2);
        assert.ok(payload.details.some((d) => Array.isArray(d.path) && d.path.includes('name') && d.message.includes('Nombre muy corto')));
        assert.equal(payload.message, undefined, 'No debe exponer error.message crudo en payload');
    });

    await t.test('4. VortexMathEngine.toBigInt soporta notación científica y sanitiza strings corruptos sin SyntaxError', () => {
        assert.equal(VortexMathEngine.fromBigInt(VortexMathEngine.toBigInt('1e-5')), 0.00001);
        assert.equal(VortexMathEngine.fromBigInt(VortexMathEngine.toBigInt('2.5e3')), 2500);
        assert.equal(VortexMathEngine.toBigInt('not-a-number'), 0n);
        assert.equal(VortexMathEngine.toBigInt('NaN'), 0n);
        assert.equal(VortexMathEngine.toBigInt('1..2..3'), 0n);
    });

    await t.test('5. NetworkPrinterService.printSale renderiza artículos leyendo sale.SaleItems (alias Sequelize)', async () => {
        let capturedBuffer = '';
        const origPrintNetwork = NetworkPrinterService.printNetwork;
        NetworkPrinterService.printNetwork = async (_host, _port, buf) => {
            capturedBuffer = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
            return { success: true };
        };
        try {
            const saleObj = {
                id: 'SALE-NET-1',
                createdAt: new Date().toISOString(),
                total: 15,
                subtotal: 15,
                exchangeRate: 50,
                paymentMethod: 'cash',
                SaleItems: [
                    { productName: 'Harina PAN 1Kg', quantity: 3, price: 5 }
                ]
            };
            await NetworkPrinterService.printSale('192.168.1.99', 9100, saleObj, { name: 'Bodega Isaac' });
            assert.ok(capturedBuffer.includes('Harina PAN 1Kg'), 'El ticket de red debe renderizar los artículos de SaleItems');
        } finally {
            NetworkPrinterService.printNetwork = origPrintNetwork;
        }
    });

    // Iniciar servidor Express + PostgreSQL 16 real (americanpos_test) para pruebas integrales
    srvHandle = await startServer([0], isolatedUserDataDir);
    const dbOk = await srvHandle.dbInitPromise;
    assert.equal(dbOk, true);
    const posUrl = `http://127.0.0.1:${srvHandle.mainPort}`;
    const models = require('../database/models');
    const { User, License, Product, CashShift, AuditLog } = models;

    const serverMachineId = await licenseUtils.getMachineId();
    const existingActives = await License.findAll({ where: { machineId: serverMachineId, status: 'active' } });
    priorActiveLicenseIds = existingActives.map((l) => l.id);

    const ts = Date.now();
    const companyId = `h10_comp_${ts}`;
    const pwd = 'H10_Password_' + crypto.randomBytes(6).toString('hex');
    const pwdHash = bcrypt.hashSync(pwd, 8);

    const adminUser = await User.create({
        id: `h10-admin-${ts}`,
        username: `h10_admin_${ts}`,
        name: 'Hardening Admin',
        email: `h10_admin_${ts}@test.local`,
        password: pwdHash,
        role: 'master',
        status: 'active',
        companyId,
        permissions: { canManageInventory: true, canCreateProducts: true, canManageSettings: true, canViewReports: true }
    });
    cleanupIds.users.push(adminUser.id);

    const loginRes = await fetch(`${posUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUser.username, password: pwd })
    });
    assert.equal(loginRes.status, 200);
    const { token: adminToken } = await loginRes.json();

    // Verificar cabecera CSP activa en respuesta HTTP
    const helloRes = await fetch(`${posUrl}/hello`);
    assert.equal(helloRes.status, 200);
    assert.ok(helloRes.headers.get('content-security-policy'), 'Content-Security-Policy debe estar habilitado');

    // Activar licencia estándar primero
    const baseKey = licenseUtils.generateKeyV2(serverMachineId, 365);
    const act1 = await fetch(`${posUrl}/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ key: baseKey, machineId: serverMachineId })
    });
    assert.equal(act1.status, 200);
    const act1Body = await act1.json();
    cleanupIds.licenses.push(act1Body.license.id);

    await t.test('6. CRUD real de VarianteProducto (/products/:id/variants) actualiza stock agregado en transacción', async () => {
        const prod = await Product.create({
            id: `h10-prod-${ts}`,
            name: 'Camisa Polo Algodón',
            barcode: `POLO-${ts}`,
            price: 25,
            cost: 12,
            stock: 0,
            stockQuantity: 0,
            companyId,
            status: 'active'
        });
        cleanupIds.products.push(prod.id);

        // Crear variante 1
        const c1 = await fetch(`${posUrl}/products/${prod.id}/variants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ talla: 'M', color: 'Azul', stock: 7, precio_adicional: 0 })
        });
        assert.equal(c1.status, 201);
        const c1Body = await c1.json();
        assert.equal(c1Body.totalStock, 7);

        // Crear variante 2
        const c2 = await fetch(`${posUrl}/products/${prod.id}/variants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ talla: 'L', color: 'Negro', stock: 5, precio_adicional: 2.5 })
        });
        assert.equal(c2.status, 201);
        const c2Body = await c2.json();
        assert.equal(c2Body.totalStock, 12);

        // Listar variantes
        const listRes = await fetch(`${posUrl}/products/${prod.id}/variants`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(listRes.status, 200);
        const listBody = await listRes.json();
        assert.equal(listBody.length, 2);

        // Actualizar stock de variante 1 (7 -> 10 => total 15)
        const updRes = await fetch(`${posUrl}/products/${prod.id}/variants/${c1Body.variant.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ stock: 10 })
        });
        assert.equal(updRes.status, 200);
        const updBody = await updRes.json();
        assert.equal(updBody.totalStock, 15);

        // Eliminar variante 2 => quedan 10
        const delRes = await fetch(`${posUrl}/products/${prod.id}/variants/${c2Body.variant.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(delRes.status, 200);
        const reloaded = await Product.findByPk(prod.id);
        assert.equal(Number(reloaded.stockQuantity), 10);
    });

    await t.test('7. SaleService Zero-Trust rechaza promoDiscount inventado por el cliente', async () => {
        const ztProd = await Product.create({
            id: `h10-zt-prod-${ts}`,
            name: 'Producto Promo ZeroTrust',
            barcode: `ZT-${ts}`,
            price: 20,
            cost: 10,
            stock: 50,
            stockQuantity: 50,
            companyId,
            status: 'active',
            taxStatus: 'exento'
        });
        cleanupIds.products.push(ztProd.id);

        await assert.rejects(
            () => SaleService.processSale(
                { id: adminUser.id, companyId, name: adminUser.name, role: 'master' },
                {
                    clientTransactionId: `TX-FAKE-PROMO-${ts}`,
                    items: [{ productId: ztProd.id, quantity: 1, price: 20 }],
                    promoDiscount: 15, // Descuento ficticio sin promoción activa en BD
                    subtotal: 20,
                    total: 5,
                    paymentMethods: [{ method: 'cash', amount: 5, currency: 'USD' }]
                },
                { bypassShiftCheck: true, bypassCreditLimit: true }
            ),
            /AUTH_REQUIRED|excede las promociones activas|INTEGRITY_ERROR/i
        );
    });

    await t.test('8. CashShiftService.closeShiftBlind convierte diffCard de VES a USD sin inflar por tasa', async () => {
        // Configurar SETTINGS_FILE aislado con tasa 50 Bs/$ y método debit en VES
        const { SETTINGS_FILE } = require('../config/paths');
        fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
            [companyId]: {
                exchangeRate: 50,
                currencyMode: 'BOTH',
                paymentMethods: [{ id: 'debit', name: 'Punto de Venta', defaultCurrency: 'VES', type: 'DIGITAL' }]
            }
        }), 'utf8');

        const shift = await CashShift.create({
            id: `h10-shift-${ts}`,
            companyId,
            userId: adminUser.id,
            userName: adminUser.name,
            status: 'open',
            startTime: new Date().toISOString(),
            openingCashUSD: 0,
            openingCashVES: 0,
            exchangeRate: 50
        });
        cleanupIds.shifts.push(shift.id);

        // Declarar 500 Bs en tarjeta cuando el sistema espera 0 Bs => diferencia neta debe dividirse por exchangeRateAtClose (NO quedar en +500 USD)
        const result = await CashShiftService.closeShiftBlind(
            { id: adminUser.id, companyId, name: adminUser.name, role: 'master' },
            {
                shiftId: shift.id,
                declaration: {
                    usd: 0,
                    ves: 0,
                    card: 500,
                    zelle: 0,
                    mobile: 0
                },
                notes: 'Test conversión VES tarjeta'
            }
        );
        const totalDiffUsd = Number(result?.netDifferenceUsd ?? NaN);
        const rateUsed = Number(result?.shift?.exchangeRateAtClose || 0);
        assert.ok(Number.isFinite(totalDiffUsd), 'Debe retornar netDifferenceUsd numérico');
        assert.ok(rateUsed > 1, `exchangeRateAtClose debe ser > 1, obtenido: ${rateUsed}`);
        const expectedUsd = Number((500 / rateUsed).toFixed(2));
        assert.ok(Math.abs(totalDiffUsd - expectedUsd) < 0.05, `diffCard 500 Bs @ tasa ${rateUsed} debe ser +${expectedUsd} USD (nunca 500 USD), obtenido: ${totalDiffUsd}`);
    });

    await t.test('9. Cadena HMAC de AuditLog permanece íntegra coexistiendo con filas DB_TRIGGER_ROW_AUDIT', async () => {
        const log1 = await AuditLog.create({
            id: `h10-aud-1-${ts}`,
            companyId,
            userId: adminUser.id,
            action: 'TEST_CHAIN_1',
            description: 'Primer registro app HMAC'
        });
        cleanupIds.auditLogs.push(log1.id);
        assert.ok(log1.recordHash && log1.recordHash.length === 64);

        // Simular fila insertada por trigger de PostgreSQL (recordHash = null, previousHash = 'DB_TRIGGER_ROW_AUDIT')
        await models.sequelize.query(
            `INSERT INTO "AuditLogs" ("id", "companyId", "userId", "action", "description", "previousHash", "recordHash", "createdAt", "updatedAt")
             VALUES (:id, :companyId, :userId, 'DB_TRIGGER_TEST', 'Fila trigger simulada', 'DB_TRIGGER_ROW_AUDIT', NULL, NOW(), NOW())`,
            { replacements: { id: `h10-aud-trig-${ts}`, companyId, userId: adminUser.id } }
        );
        cleanupIds.auditLogs.push(`h10-aud-trig-${ts}`);

        const log2 = await AuditLog.create({
            id: `h10-aud-2-${ts}`,
            companyId,
            userId: adminUser.id,
            action: 'TEST_CHAIN_2',
            description: 'Segundo registro app HMAC'
        });
        cleanupIds.auditLogs.push(log2.id);
        assert.equal(log2.previousHash, log1.recordHash, 'log2 debe encadenar directamente con log1 ignorando la fila de trigger sin recordHash');
    });

    await t.test('10. Enforcement de plan pc_only bloquea terminales móviles y anti-reuso bloquea clave suspendida', async () => {
        // Emitir llave RSA v2 con claim plan: pc_only, allowMobile: false
        const pcOnlyKey = licenseUtils.generateKeyV2(serverMachineId, 365, 'days', null, {
            plan: 'pc_only',
            allowMobile: false
        });
        const actPc = await fetch(`${posUrl}/license/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ key: pcOnlyKey, machineId: serverMachineId })
        });
        assert.equal(actPc.status, 200);
        const actPcBody = await actPc.json();
        cleanupIds.licenses.push(actPcBody.license.id);
        clearLicenseCache();

        // El servidor principal opera normal (200)
        const serverReq = await fetch(`${posUrl}/products`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(serverReq.status, 200);

        // Una terminal móvil remota recibe 403 plan_no_permite_terminales
        const mobReq = await fetch(`${posUrl}/products`, {
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'x-terminal-id': 'TERM-MOB-BLOCKED-1'
            }
        });
        assert.equal(mobReq.status, 403);
        const mobBody = await mobReq.json();
        assert.equal(mobBody.error, 'plan_no_permite_terminales');

        // Suspender la licencia en BD y verificar que re-pegar la misma llave en /license/activate se rechaza con 403
        await License.update(
            {
                status: 'suspended',
                meta: { onlineLease: { status: 'suspended', serverTime: Date.now() + 1000, reason: 'Mora' } }
            },
            { where: { id: actPcBody.license.id } }
        );
        clearLicenseCache();

        const reuseRes = await fetch(`${posUrl}/license/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ key: pcOnlyKey, machineId: serverMachineId })
        });
        assert.equal(reuseRes.status, 403);
        const reuseBody = await reuseRes.json();
        assert.equal(reuseBody.code, 'licencia_suspendida_reuso');
    });

    await t.test('11. Cloud License Gateway CORS fail-closed rechaza orígenes externos en /admin/* cuando ADMIN_ALLOWED_ORIGINS está vacío', async () => {
        const apiSecret = 'h10-gw-secret-' + crypto.randomBytes(8).toString('hex');
        gwStore = new LicenseStore({ jsonPath: path.join(isolatedUserDataDir, 'gw_cors.db.json') });
        const { app: gwApp } = await createLicenseGatewayApp({
            store: gwStore,
            privateKeyPem: testRsaPriv,
            adminEmail: 'admin@test.local',
            adminPassword: 'TestPassword123!',
            adminJwtSecret: crypto.randomBytes(32).toString('hex'),
            adminApiSecret: apiSecret,
            adminAllowedOrigins: ''
        });
        gwServer = await new Promise((r) => { const s = gwApp.listen(0, '127.0.0.1', () => r(s)); });
        const gwUrl = `http://127.0.0.1:${gwServer.address().port}`;

        const evilOriginRes = await fetch(`${gwUrl}/admin/licenses`, {
            headers: { 'x-admin-secret': apiSecret, Origin: 'https://evil-attacker.example' }
        });
        assert.equal(evilOriginRes.status, 403, 'Debe rechazar orígenes externos en /admin/* sin whitelist');

        const localOriginRes = await fetch(`${gwUrl}/admin/licenses`, {
            headers: { 'x-admin-secret': apiSecret, Origin: 'http://localhost:5173' }
        });
        assert.equal(localOriginRes.status, 200, 'Debe aceptar origen localhost por defecto en desarrollo');
    });

    await t.test('12. Distribución LAN de OTA (/dist.zip, /version.json) y APK (/Isaac-POS-Mobile.apk) resuelve extraResources y overrides', async () => {
        const { resolveMobileDistributionFile } = require('../utils/mobileDistributionPaths');
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-ota-resolve-'));
        const userOtaDir = path.join(tmpRoot, 'userdata', 'mobile-ota');
        const resOtaDir = path.join(tmpRoot, 'resources', 'mobile-ota');
        fs.mkdirSync(userOtaDir, { recursive: true });
        fs.mkdirSync(resOtaDir, { recursive: true });

        const resZip = path.join(resOtaDir, 'dist.zip');
        const userZip = path.join(userOtaDir, 'dist.zip');
        fs.writeFileSync(resZip, 'res-zip');
        assert.equal(
            resolveMobileDistributionFile('dist.zip', {
                userDataPath: path.join(tmpRoot, 'userdata'),
                appDataPath: '',
                resourcesPath: path.join(tmpRoot, 'resources'),
                staticPath: path.join(tmpRoot, 'missing'),
                baseDir: path.join(tmpRoot, 'missing'),
                execPath: path.join(tmpRoot, 'missing', 'app.exe')
            }),
            resZip,
            'Debe resolver dist.zip desde resources/mobile-ota (extraResources) cuando no hay override en userData'
        );

        fs.writeFileSync(userZip, 'user-zip');
        assert.equal(
            resolveMobileDistributionFile('dist.zip', {
                userDataPath: path.join(tmpRoot, 'userdata'),
                appDataPath: '',
                resourcesPath: path.join(tmpRoot, 'resources'),
                staticPath: path.join(tmpRoot, 'missing'),
                baseDir: path.join(tmpRoot, 'missing'),
                execPath: path.join(tmpRoot, 'missing', 'app.exe')
            }),
            userZip,
            'Override en USER_DATA_PATH/mobile-ota debe tener prioridad sobre resources/mobile-ota'
        );
        fs.rmSync(tmpRoot, { recursive: true, force: true });

        const zipRes = await fetch(`${posUrl}/dist.zip`, { method: 'HEAD' });
        assert.equal(zipRes.status, 200, 'GET/HEAD /dist.zip debe responder 200');
        assert.match(zipRes.headers.get('content-type') || '', /zip/i);

        const apkRes = await fetch(`${posUrl}/Isaac-POS-Mobile.apk`, { method: 'HEAD' });
        assert.equal(apkRes.status, 200, 'GET/HEAD /Isaac-POS-Mobile.apk debe responder 200 y no caer al HTML SPA');
        assert.match(apkRes.headers.get('content-type') || '', /vnd\.android\.package-archive/i);
    });

    await t.test('13. Sesiones simultáneas PC + móvil para el mismo usuario con revocación individual por dispositivo', async () => {
        const loginPc = await fetch(`${posUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: adminUser.username, password: pwd })
        });
        assert.equal(loginPc.status, 200);
        const pcData = await loginPc.json();

        const loginMob = await fetch(`${posUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: adminUser.username, password: pwd })
        });
        assert.equal(loginMob.status, 200);
        const mobData = await loginMob.json();

        // Ambos dispositivos deben seguir autenticados simultáneamente
        const pcMe = await fetch(`${posUrl}/auth/me`, { headers: { Authorization: `Bearer ${pcData.token}` } });
        const mobMe = await fetch(`${posUrl}/auth/me`, { headers: { Authorization: `Bearer ${mobData.token}` } });
        assert.equal((await pcMe.json()).authenticated, true, 'PC debe seguir autenticado tras login del teléfono');
        assert.equal((await mobMe.json()).authenticated, true, 'Teléfono debe estar autenticado simultáneamente');

        // Cerrar sesión solo en el teléfono revoca al teléfono pero mantiene viva la sesión de la PC
        const logoutMob = await fetch(`${posUrl}/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${mobData.token}` }
        });
        assert.equal(logoutMob.status, 200);

        const mobAfterLogout = await fetch(`${posUrl}/products`, { headers: { Authorization: `Bearer ${mobData.token}` } });
        assert.equal(mobAfterLogout.status, 401, 'Token del teléfono tras logout debe quedar revocado');

        const pcAfterMobLogout = await fetch(`${posUrl}/auth/me`, { headers: { Authorization: `Bearer ${pcData.token}` } });
        assert.equal((await pcAfterMobLogout.json()).authenticated, true, 'La PC debe seguir activa tras logout del teléfono');

        // Cerrar en todos los dispositivos revoca también la PC
        const logoutAll = await fetch(`${posUrl}/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pcData.token}` },
            body: JSON.stringify({ allDevices: true })
        });
        assert.equal(logoutAll.status, 200);
        const pcAfterAllLogout = await fetch(`${posUrl}/products`, { headers: { Authorization: `Bearer ${pcData.token}` } });
        assert.equal(pcAfterAllLogout.status, 401, 'Logout allDevices debe revocar todos los equipos');
    });

    await t.test('14. Validación Zod con .passthrough() en las 10 rutas financieras, fiscales y administrativas críticas', async () => {
        // Reactivar una licencia limpia tras la prueba de suspensión del paso 10
        const freshKey = licenseUtils.generateKeyV2(serverMachineId, 365, 'days', null, {
            plan: 'ultra',
            allowMobile: true
        });
        await License.update({ status: 'revoked' }, { where: { machineId: serverMachineId, status: { [require('sequelize').Op.in]: ['active', 'suspended'] } } });
        const freshLic = await License.create({
            id: `h10-zod-lic-${Date.now()}`,
            machineId: serverMachineId,
            licenseKey: freshKey,
            activatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            status: 'active',
            meta: { source: 'test_zod_14' }
        });
        cleanupIds.licenses.push(freshLic.id);
        clearLicenseCache();

        const loginRes = await fetch(`${posUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: adminUser.username, password: pwd })
        });
        assert.equal(loginRes.status, 200);
        const { token: zodToken } = await loginRes.json();
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${zodToken}`
        };

        // 1) Rechazos 400 obligatorios en las 10 rutas ante payloads inválidos
        const invalidCases = [
            { path: '/accounting/accounts', body: { code: '', name: '' } },
            { path: '/accounting/entries', body: { description: 'Solo 1 linea', lines: [{ accountCode: '1101', debit: 10 }] } },
            { path: '/fiscal/records', body: { bookType: 'VENTAS', recordDate: '', documentNumber: '' } },
            { path: '/fiscal/credit-notes', body: { totalAmount: -10 } },
            { path: '/expenses', body: { description: 'Gasto invalido', amount: -50 } },
            { path: '/payroll/employees', body: { idCard: '', firstName: 'SinCedula', lastName: '' } },
            { path: '/branches', body: { name: '' } },
            { path: '/license/activate', body: { key: '' } },
            { path: '/lots', body: { productId: 'p1', lotNumber: 'L1', quantity: -5 } },
            { path: '/collections/log', body: { customerId: '', promisedAmount: -1 } },
            { path: '/delivery-notes', body: { items: [], total: 0 } },
            { path: '/assets', body: { name: 'Equipo', purchaseDate: '2026-01-01', purchaseCost: 0 } },
            { path: '/assets/depreciate', body: { period: '2026/11' } }
        ];

        for (const c of invalidCases) {
            const res = await fetch(`${posUrl}${c.path}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(c.body)
            });
            assert.equal(res.status, 400, `POST ${c.path} debía rechazar payload inválido con 400 (recibió ${res.status})`);
            const data = await res.json();
            assert.equal(data.error, 'Error de validación', `POST ${c.path} debía retornar error Zod`);
        }

        // 2) Aceptación 200/201 con campos extra (.passthrough()) para no romper apps móviles previas
        const models = require('../database/models');
        const createdIds = { expenses: [], branches: [], accounts: [], employees: [], assets: [], fiscalRecords: [] };
        const suffix = Date.now().toString(36);
        try {
            const expRes = await fetch(`${posUrl}/expenses`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    description: `Gasto Zod Test ${suffix}`,
                    amount: 12.5,
                    currency: 'USD',
                    legacyMobileExtraField: 'v24.3-compat'
                })
            });
            assert.equal(expRes.status, 201, 'POST /expenses válido con campo extra debe aceptar 201');
            const expJson = await expRes.json();
            if (expJson?.id) createdIds.expenses.push(expJson.id);

            const branchRes = await fetch(`${posUrl}/branches`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: `Sucursal Zod ${suffix}`,
                    legacyAppFlag: true
                })
            });
            assert.equal(branchRes.status, 201, 'POST /branches válido con campo extra debe aceptar 201');
            const branchJson = await branchRes.json();
            if (branchJson?.id) createdIds.branches.push(branchJson.id);

            const accRes = await fetch(`${posUrl}/accounting/accounts`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    code: `9.9.${suffix.slice(-4)}`,
                    name: `Cuenta Zod ${suffix}`,
                    accountType: 'ASSET',
                    legacyAppMeta: { origin: 'mobile' }
                })
            });
            assert.equal(accRes.status, 200, 'POST /accounting/accounts válido con campo extra debe aceptar 200');
            const accJson = await accRes.json();
            if (accJson?.account?.id) createdIds.accounts.push(accJson.account.id);

            const empRes = await fetch(`${posUrl}/payroll/employees`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    idCard: `V-99${suffix.slice(-5)}`,
                    firstName: 'Ana',
                    lastName: 'Prueba',
                    baseSalary: 350,
                    extraLegacyField: 'ok'
                })
            });
            assert.equal(empRes.status, 200, 'POST /payroll/employees válido con campo extra debe aceptar 200');
            const empJson = await empRes.json();
            if (empJson?.employee?.id) createdIds.employees.push(empJson.employee.id);

            const assetRes = await fetch(`${posUrl}/assets`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: `Impresora Fiscal Zod ${suffix}`,
                    purchaseDate: '2026-11-22',
                    purchaseCost: 420,
                    legacyDeviceTag: 'caja-1'
                })
            });
            assert.equal(assetRes.status, 200, 'POST /assets válido con campo extra debe aceptar 200');
            const assetJson = await assetRes.json();
            if (assetJson?.asset?.id) createdIds.assets.push(assetJson.asset.id);

            const fiscalRes = await fetch(`${posUrl}/fiscal/records`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    bookType: 'VENTAS',
                    recordDate: '2026-11-22',
                    documentNumber: `FAC-${suffix}`,
                    totalAmount: 116,
                    taxableBase: 100,
                    taxAmount: 16,
                    legacyTerminalVersion: '24.3.0'
                })
            });
            assert.equal(fiscalRes.status, 201, 'POST /fiscal/records válido con campo extra debe aceptar 201');
            const fiscalJson = await fiscalRes.json();
            if (fiscalJson?.id) createdIds.fiscalRecords.push(fiscalJson.id);
        } finally {
            if (createdIds.expenses.length && models.Expense) await models.Expense.destroy({ where: { id: createdIds.expenses } }).catch(() => {});
            if (createdIds.branches.length && models.Branch) await models.Branch.destroy({ where: { id: createdIds.branches } }).catch(() => {});
            if (createdIds.accounts.length && models.AccountCatalog) await models.AccountCatalog.destroy({ where: { id: createdIds.accounts } }).catch(() => {});
            if (createdIds.employees.length && models.Employee) await models.Employee.destroy({ where: { id: createdIds.employees } }).catch(() => {});
            if (createdIds.assets.length && models.FixedAsset) await models.FixedAsset.destroy({ where: { id: createdIds.assets } }).catch(() => {});
            if (createdIds.fiscalRecords.length && models.FiscalBookRecord) await models.FiscalBookRecord.destroy({ where: { id: createdIds.fiscalRecords } }).catch(() => {});
        }
    });
});
