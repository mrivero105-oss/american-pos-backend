import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const frontendRequire = createRequire(path.resolve(process.cwd(), '../american-pos-frontend/package.json'));

// Aislamiento estricto antes de cargar cualquier módulo del backend
const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-e2e-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || crypto.randomBytes(16).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || crypto.randomBytes(32).toString('hex');
const { publicKey: testRsaPub, privateKey: testRsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env.LICENSE_PUBLIC_KEY_PEM = testRsaPub;
process.env.LICENSE_PRIVATE_KEY_PEM = testRsaPriv;

const DbConfigManager = require('../config/dbConfigManager');
const { startServer } = require('../index');
const bcrypt = require('bcryptjs');
const licenseUtils = require('../utils/licenseUtils');
const { io: ioClient } = frontendRequire('socket.io-client');

let srvHandle = null;
let validSocket = null;
let e2eTenantToCleanup = null;

test.after(async () => {
    try {
        if (validSocket) validSocket.disconnect();
    } catch (_) {}
    if (e2eTenantToCleanup) {
        try {
            const { BusinessSetting } = require('../database/models');
            await BusinessSetting.destroy({ where: { companyId: e2eTenantToCleanup } });
        } catch (_) {}
    }
    if (srvHandle && typeof srvHandle.stopServer === 'function') {
        await srvHandle.stopServer();
    }
    try {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('E2E Backend Real (Express + PostgreSQL americanpos_test + Socket.IO JWT)', async () => {
    // 1. Verificar guardia estricto de base de datos de pruebas
    assert.equal(DbConfigManager.getConfig().database, 'americanpos_test');
    process.env.DB_NAME_FORCE = 'americanpos';
    assert.throws(() => DbConfigManager.getConfig(), /Bloqueado.*americanpos/);
    process.env.DB_NAME_FORCE = 'americanpos_test';

    // 2. Iniciar servidor real en puerto efímero sobre americanpos_test
    srvHandle = await startServer([0], isolatedUserDataDir);
    assert.ok(srvHandle.mainPort > 0, 'Debe asignar puerto HTTP efímero');
    const dbOk = await srvHandle.dbInitPromise;
    assert.equal(dbOk, true, 'El pipeline de PostgreSQL y migraciones debe iniciar en true');

    const baseUrl = `http://127.0.0.1:${srvHandle.mainPort}`;
    const {
        sequelize,
        User,
        CashShift,
        Product,
        JournalEntry,
        JournalEntryLine,
        StockMovement
    } = require('../database/models');

    const dbNameRow = await sequelize.query('SELECT current_database() AS db', { type: sequelize.QueryTypes.SELECT });
    assert.equal(dbNameRow[0].db, 'americanpos_test', 'La conexión activa de Sequelize debe apuntar únicamente a americanpos_test');

    // Limpiar turnos abiertos previos en americanpos_test para idempotencia
    await CashShift.update(
        { status: 'closed', closedAt: new Date().toISOString() },
        { where: { status: 'open' } }
    );

    // 3. Crear usuario administrador temporal con tenant aislado para la corrida E2E
    const tempPassword = 'E2E_' + crypto.randomBytes(10).toString('hex');
    const passwordHash = bcrypt.hashSync(tempPassword, 8);
    const e2eUsername = 'e2e_superadmin';
    const e2eCompanyId = `e2e_comp_${Date.now()}`;
    e2eTenantToCleanup = e2eCompanyId;
    let e2eUser = await User.findOne({ where: { username: e2eUsername } });
    if (!e2eUser) {
        e2eUser = await User.create({
            id: 'e2e-admin-' + Date.now(),
            username: e2eUsername,
            name: 'E2E Admin',
            email: 'e2e_admin@test.local',
            password: passwordHash,
            role: 'superadmin',
            status: 'active',
            companyId: e2eCompanyId,
            defaultCurrency: 'BOTH',
            permissions: {}
        });
    } else {
        await e2eUser.update({
            password: passwordHash,
            role: 'superadmin',
            status: 'active',
            companyId: e2eCompanyId,
            failedLoginAttempts: 0,
            lockUntil: null
        });
    }

    // 4. Seguridad HTTP: peticiones sin token deben recibir 401
    const unauthRes = await fetch(`${baseUrl}/products`);
    assert.equal(unauthRes.status, 401);

    // 5. Login real inválido y válido
    const badLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: e2eUsername, password: 'WrongPassword123!' })
    });
    assert.equal(badLoginRes.status, 401);

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: e2eUsername, password: tempPassword })
    });
    assert.equal(loginRes.status, 200, 'Login E2E válido debe responder 200');
    const loginJson = await loginRes.json();
    assert.ok(loginJson.token, 'Login debe retornar JWT token');

    // 6. Activar licencia RSA v2 real en americanpos_test vía /license/activate autenticado
    const machineId = await licenseUtils.getMachineId();
    const generatedLicenseKey = licenseUtils.generateKeyV2(machineId, 30, 'days');
    const licRes = await fetch(`${baseUrl}/license/activate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${loginJson.token}`
        },
        body: JSON.stringify({ key: generatedLicenseKey, machineId })
    });
    assert.equal(licRes.status, 200, 'La activación de licencia RSA v2 en BD de test debe responder 200');
    const licJson = await licRes.json();
    assert.equal(licJson.success, true);
    const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`
    };

    // Fijar configuración fiscal determinista para el tenant E2E (sin IGTF sobre $50.00 exento)
    const taxCfgRes = await fetch(`${baseUrl}/settings/taxes`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            ivaEnabled: true,
            ivaRate: 16,
            igtfEnabled: false,
            igtfRate: 0
        })
    });
    assert.equal(taxCfgRes.status, 200, `POST /settings/taxes falló: status=${taxCfgRes.status}`);

    // Verificar que el módulo de bancos eliminado ya no existe en las rutas (/api/banks y POST /banks -> 404)
    const banksApiRes = await fetch(`${baseUrl}/api/banks`, { headers: authHeaders });
    assert.equal(banksApiRes.status, 404, 'GET /api/banks no debe existir tras eliminar módulo');
    const banksPostRes = await fetch(`${baseUrl}/banks`, { method: 'POST', headers: authHeaders, body: '{}' });
    assert.equal(banksPostRes.status, 404, 'POST /banks no debe existir tras eliminar módulo');

    // 7. Socket.IO autenticado con JWT real (prueba en caliente de verifyJwtResilient)
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout esperando conexión Socket.IO con JWT')), 5000);
        validSocket = ioClient(baseUrl, {
            auth: { token: loginJson.token },
            transports: ['websocket']
        });
        validSocket.on('connect', () => {
            clearTimeout(timer);
            resolve();
        });
        validSocket.on('connect_error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Socket.IO rechazó token JWT válido: ${err.message}`));
        });
    });
    assert.equal(validSocket.connected, true);

    // Token JWT inválido en Socket.IO debe fallar con connect_error
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            try { badSocket.disconnect(); } catch (_) {}
            reject(new Error('Socket.IO permitió conexión con JWT inválido'));
        }, 5000);
        const badSocket = ioClient(baseUrl, {
            auth: { token: 'invalid.jwt.signature' },
            transports: ['websocket'],
            reconnection: false
        });
        badSocket.on('connect', () => {
            clearTimeout(timer);
            badSocket.disconnect();
            reject(new Error('Socket.IO conectó con token inválido'));
        });
        badSocket.on('connect_error', () => {
            clearTimeout(timer);
            badSocket.disconnect();
            resolve();
        });
    });

    // 8. Crear producto en inventario
    const uniqueSuffix = Date.now();
    const prodRes = await fetch(`${baseUrl}/products`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            name: `Producto E2E ${uniqueSuffix}`,
            barcode: `E2E${uniqueSuffix}`,
            price: 25,
            cost: 15,
            stockQuantity: 10,
            minStock: 2,
            category: 'General',
            taxStatus: 'exento'
        })
    });
    assert.equal(prodRes.status, 201, `POST /products falló: status=${prodRes.status}`);
    const createdProduct = await prodRes.json();
    assert.ok(createdProduct.id);
    assert.equal(Number(createdProduct.stockQuantity), 10);

    // 9. Abrir caja
    const openShiftRes = await fetch(`${baseUrl}/cash/open`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            amount: 50,
            registerId: '1',
            initialBreakdown: { cash: 50 }
        })
    });
    assert.equal(openShiftRes.status, 201, `POST /cash/open falló: status=${openShiftRes.status}`);
    const openedShift = await openShiftRes.json();
    assert.equal(openedShift.status, 'open');

    // 10. Procesar venta real de 2 unidades ($50)
    const saleRes = await fetch(`${baseUrl}/sales`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            items: [{
                productId: createdProduct.id,
                name: createdProduct.name,
                quantity: 2,
                price: 25,
                cost: 15,
                category: 'General',
                taxStatus: 'exento'
            }],
            paymentMethod: 'Efectivo ($)',
            paymentMethods: [{ id: 'cash', name: 'Efectivo ($)', amount: 50, currency: 'USD' }],
            subtotal: 50,
            tax: 0,
            discount: 0,
            igtfAmount: 0,
            total: 50,
            receivedAmount: 50,
            changeAmount: 0,
            documentType: 'factura',
            registerId: '1'
        })
    });
    assert.equal(saleRes.status, 201, `POST /sales falló: status=${saleRes.status}`);
    const createdSale = await saleRes.json();
    assert.ok(createdSale.id);

    // Verificar descuento de stock tras venta (10 -> 8)
    const prodAfterSale = await Product.findByPk(createdProduct.id);
    assert.equal(Number(prodAfterSale.stockQuantity), 8, 'El stock debe descontarse de 10 a 8');

    // Verificar asiento contable balanceado en JournalEntry (espera breve porque se dispara en setImmediate post-commit)
    let jEntry = null;
    for (let i = 0; i < 30; i++) {
        jEntry = await JournalEntry.findOne({ where: { referenceId: createdSale.id } });
        if (jEntry) break;
        await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(jEntry, 'Debe generarse un JournalEntry automático para la venta');
    const jLines = await JournalEntryLine.findAll({ where: { journalEntryId: jEntry.id } });
    assert.ok(jLines.length >= 2, 'El asiento debe tener al menos 2 líneas');
    const sumDebit = jLines.reduce((acc, l) => acc + Number(l.debit || 0), 0);
    const sumCredit = jLines.reduce((acc, l) => acc + Number(l.credit || 0), 0);
    assert.ok(sumDebit > 0, 'El débito contable debe ser > 0');
    assert.ok(Math.abs(sumDebit - sumCredit) < 0.01, `El asiento debe estar cuadrado (${sumDebit} vs ${sumCredit})`);

    // Verificar Libro de Ventas Fiscal
    const now = new Date();
    const fiscalRes = await fetch(`${baseUrl}/fiscal/sales-book?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, {
        headers: authHeaders
    });
    assert.equal(fiscalRes.status, 200);
    const fiscalBook = await fiscalRes.json();
    const bookRows = Array.isArray(fiscalBook) ? fiscalBook : (fiscalBook.records || fiscalBook.rows || []);
    assert.ok(
        bookRows.some(r => r.saleId === createdSale.id || r.documentNumber === createdSale.invoiceNumber),
        'La venta debe reflejarse en el Libro de Ventas fiscal'
    );

    // 11. Procesar devolución parcial (1 unidad) y verificar reversión de stock (8 -> 9)
    const refundRes = await fetch(`${baseUrl}/refunds`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            saleId: createdSale.id,
            reason: 'Prueba E2E devolución',
            items: [{
                productId: createdProduct.id,
                name: createdProduct.name,
                quantity: 1,
                price: 25
            }],
            paymentMethods: [{ id: 'cash', amount: 25, currency: 'USD' }]
        })
    });
    assert.equal(refundRes.status, 201, `POST /refunds falló: status=${refundRes.status}`);

    const prodAfterRefund = await Product.findByPk(createdProduct.id);
    assert.equal(Number(prodAfterRefund.stockQuantity), 9, 'El stock debe revertirse de 8 a 9 tras devolución de 1 unidad');

    // 12. Consultar turno actual y cerrar caja con saldo esperado
    const currentShiftRes = await fetch(`${baseUrl}/cash/current?registerId=1`, { headers: authHeaders });
    assert.equal(currentShiftRes.status, 200);
    const currentShift = await currentShiftRes.json();
    const expectedBreakdown = currentShift?.stats?.expectedBreakdown || { cash: 75 };

    const closeShiftRes = await fetch(`${baseUrl}/cash/close`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            shiftId: openedShift.id,
            registerId: '1',
            finalBreakdown: expectedBreakdown,
            notes: 'Cierre E2E'
        })
    });
    assert.equal(closeShiftRes.status, 200, `POST /cash/close falló: status=${closeShiftRes.status}`);
    const closedShift = await closeShiftRes.json();
    assert.equal(closedShift.status, 'match');
    assert.equal(Number(closedShift.difference), 0);
    assert.equal(closedShift.shift?.status, 'closed');

    // Limpieza ordenada de movimientos/producto temporal para mantener ligera americanpos_test
    try {
        await StockMovement.destroy({ where: { productId: createdProduct.id } });
    } catch (_) {}
});
