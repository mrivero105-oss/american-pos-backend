import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';

const express = require('express');
const { sequelize } = require('../database/connection');
const { runPostConnectMigrations } = require('../database/schemaMigrator');
const {
    User,
    Customer,
    Product,
    Sale,
    SaleItem,
    StockMovement,
    AuditLog,
    CreditHistory,
    CollectionActionLog,
    SupervisorApproval
} = require('../database/models');
const CollectionIntelligenceService = require('../services/CollectionIntelligenceService');
const SaleService = require('../services/SaleService');
const collectionsRouter = require('../routes/collections');

function httpJson(url, { method = 'GET', body = null } = {}) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
                } catch {
                    resolve({ statusCode: res.statusCode, body: raw });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

test('Desbloqueo de clientes con deudas viejas — Perfil, Cobranza, PIN Supervisor y Facturación', async () => {
    await sequelize.authenticate();
    await runPostConnectMigrations(sequelize);

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const companyId = 'test_overdue_comp';
    const adminUserId = `USR_ADM_${suffix}`;
    const cashierUserId = `USR_CSH_${suffix}`;
    const customerId = `CUST_OVERDUE_${suffix}`;
    const productId = `PROD_OVERDUE_${suffix}`;
    const oldSaleId = `SALE_OLD_${suffix}`;
    const newSaleBlockedId = `SALE_BLK_${suffix}`;
    const newSaleUnlockedId = `SALE_UNL_${suffix}`;
    const newSaleReblockedId = `SALE_RBLK_${suffix}`;
    const newSaleOverrideOnceId = `SALE_OVR_${suffix}`;
    const approvalUnlockId = `SUP_UNL_${suffix}`;
    const approvalOnceId = `SUP_ONCE_${suffix}`;

    let currentMockUser = {
        id: adminUserId,
        companyId,
        role: 'admin',
        name: 'Admin Test',
        permissions: { canAccessCollections: true, canManageCustomers: true }
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = currentMockUser;
        next();
    });
    app.use('/collections', collectionsRouter);

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
        const { port } = server.address();
        const base = `http://127.0.0.1:${port}/collections`;

        // Crear usuarios temporales reales para cumplir FK de StockMovements/Sales
        await User.create({
            id: adminUserId,
            companyId,
            username: `adm_${suffix}`,
            name: 'Admin Test',
            email: `adm_${suffix}@test.local`,
            password: 'hashed_test_password',
            role: 'admin',
            isActive: true
        });
        await User.create({
            id: cashierUserId,
            companyId,
            username: `csh_${suffix}`,
            name: 'Cajero Test',
            email: `csh_${suffix}@test.local`,
            password: 'hashed_test_password',
            role: 'cashier',
            isActive: true
        });

        // Crear producto y cliente con deuda de hace 45 días (plazo 30 días)
        await Product.create({
            id: productId,
            companyId,
            name: 'Producto Prueba Mora',
            price: 20,
            cost: 10,
            stock: 50,
            taxStatus: 'exento',
            isActive: true
        });

        await Customer.create({
            id: customerId,
            companyId,
            userId: adminUserId,
            name: 'Cliente Con Deuda Vieja',
            idDocument: 'V-19000111',
            creditLimit: 500,
            creditBalance: 100,
            creditLimitDays: 30,
            isCreditBlocked: false,
            allowOverdueCredit: false,
            isActive: true
        });

        const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
        await Sale.create({
            id: oldSaleId,
            companyId,
            userId: adminUserId,
            customerId,
            customerName: 'Cliente Con Deuda Vieja',
            total: 100,
            subtotal: 100,
            tax: 0,
            amountPaid: 0,
            paymentMethod: 'fiado',
            paymentStatus: 'unpaid',
            status: 'completed',
            date: oldDate.toISOString(),
            createdAt: oldDate,
            updatedAt: oldDate
        });
        await CreditHistory.create({
            id: `CH_OLD_${suffix}`,
            companyId,
            userId: adminUserId,
            customerId,
            type: 'charge',
            amount: 100,
            balanceAfter: 100,
            description: 'Factura antigua 45 días',
            paymentMethod: 'fiado',
            saleId: oldSaleId,
            timestamp: oldDate.toISOString(),
            createdAt: oldDate,
            updatedAt: oldDate
        });

        // 1. Por defecto, debe bloquearse por deuda vieja (>30d)
        const profileBefore = await CollectionIntelligenceService.getCustomerCreditProfile(customerId, companyId);
        assert.equal(profileBefore.trafficLight, 'RED');
        assert.equal(profileBefore.canSellCredit, false);
        assert.equal(profileBefore.blockType, 'OVERDUE_DEBT');
        assert.equal(profileBefore.allowOverdueCredit, false);

        const buildCreditSalePayload = (txId, extra = {}) => ({
            clientTransactionId: txId,
            customerId,
            customerName: 'Cliente Con Deuda Vieja',
            items: [{ productId, id: productId, name: 'Producto Prueba Mora', quantity: 1, price: 20 }],
            paymentMethod: 'fiado',
            paymentMethods: [{ method: 'fiado', amount: 20, currency: 'USD' }],
            subtotal: 20,
            tax: 0,
            total: 20,
            exchangeRate: 1,
            ...extra
        });

        await assert.rejects(
            () => SaleService.processSale(currentMockUser, buildCreditSalePayload(newSaleBlockedId), { bypassShiftCheck: true }),
            /CREDIT_ERROR.*días de vencimiento/i,
            'Debe rechazar factura a crédito mientras tenga deuda vieja sin desbloqueo'
        );

        // 2. Desbloquear cliente desde /collections/toggle-block (permite facturar con deudas viejas)
        const unlockRes = await httpJson(`${base}/toggle-block/${customerId}`, {
            method: 'POST',
            body: { isBlocked: false, allowOverdueCredit: true }
        });
        assert.equal(unlockRes.statusCode, 200);
        assert.equal(unlockRes.body.isCreditBlocked, false);
        assert.equal(unlockRes.body.allowOverdueCredit, true);

        const profileAfter = await CollectionIntelligenceService.getCustomerCreditProfile(customerId, companyId);
        assert.equal(profileAfter.canSellCredit, true);
        assert.equal(profileAfter.allowOverdueCredit, true);
        assert.equal(profileAfter.overdueBypassActive, true);
        assert.equal(profileAfter.trafficLight, 'YELLOW');

        // 3. Ahora SÍ debe permitir registrar nuevas facturas a crédito pese a la deuda vieja
        const saleOk = await SaleService.processSale(
            currentMockUser,
            buildCreditSalePayload(newSaleUnlockedId),
            { bypassShiftCheck: true }
        );
        assert.ok(saleOk && saleOk.id === newSaleUnlockedId, 'La venta a crédito debe registrarse exitosamente');

        const updatedCustomer = await Customer.findByPk(customerId);
        assert.equal(Number(updatedCustomer.creditBalance), 120, 'El saldo debe acumular la nueva factura ($100 + $20)');

        // 4. Volver a bloquearlo administrativamente -> debe quitar allowOverdueCredit y volver a rechazar
        const reblockRes = await httpJson(`${base}/toggle-block/${customerId}`, {
            method: 'POST',
            body: { isBlocked: true }
        });
        assert.equal(reblockRes.statusCode, 200);
        assert.equal(reblockRes.body.isCreditBlocked, true);
        assert.equal(reblockRes.body.allowOverdueCredit, false);

        await assert.rejects(
            () => SaleService.processSale(currentMockUser, buildCreditSalePayload(newSaleReblockedId), { bypassShiftCheck: true }),
            /CREDIT_ERROR.*suspendido o bloqueado/i
        );

        // 5. Autorización puntual de 1 sola factura con PIN Supervisor (sin desbloquear permanentemente)
        await SupervisorApproval.create({
            id: approvalOnceId,
            companyId,
            performedBy: adminUserId,
            approvedBy: adminUserId,
            actionType: 'CREDIT_LIMIT_OVERRIDE',
            used: false,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        const saleOverride = await SaleService.processSale(
            currentMockUser,
            buildCreditSalePayload(newSaleOverrideOnceId, { supervisorApprovalId: approvalOnceId }),
            { bypassShiftCheck: true }
        );
        assert.equal(saleOverride.id, newSaleOverrideOnceId);
        const consumedOnce = await SupervisorApproval.findByPk(approvalOnceId);
        assert.equal(consumedOnce.used, true, 'El approval puntual debe quedar consumido (anti-replay)');

        // 6. Cajero sin permiso de cobranza: denegado sin PIN, permitido con PIN Supervisor y anti-replay
        currentMockUser = {
            id: cashierUserId,
            companyId,
            role: 'cashier',
            name: 'Cajero Test',
            permissions: {}
        };

        const deniedCashier = await httpJson(`${base}/toggle-block/${customerId}`, {
            method: 'POST',
            body: { isBlocked: false, allowOverdueCredit: true }
        });
        assert.equal(deniedCashier.statusCode, 403);

        // El cajero SÍ puede consultar /customer-profile en caja
        const cashierProfileRes = await httpJson(`${base}/customer-profile/${customerId}`);
        assert.equal(cashierProfileRes.statusCode, 200);
        assert.equal(cashierProfileRes.body.profile.isCreditBlocked, true);

        await SupervisorApproval.create({
            id: approvalUnlockId,
            companyId,
            performedBy: cashierUserId,
            approvedBy: adminUserId,
            actionType: 'CREDIT_LIMIT_OVERRIDE',
            used: false,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        const allowedWithPin = await httpJson(`${base}/toggle-block/${customerId}`, {
            method: 'POST',
            body: { isBlocked: false, allowOverdueCredit: true, supervisorApprovalId: approvalUnlockId }
        });
        assert.equal(allowedWithPin.statusCode, 200);
        assert.equal(allowedWithPin.body.allowOverdueCredit, true);

        // Reuso del mismo approvalId debe ser rechazado (403)
        const replayAttempt = await httpJson(`${base}/toggle-block/${customerId}`, {
            method: 'POST',
            body: { isBlocked: false, allowOverdueCredit: true, supervisorApprovalId: approvalUnlockId }
        });
        assert.equal(replayAttempt.statusCode, 403);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await SaleItem.destroy({ where: { saleId: [oldSaleId, newSaleBlockedId, newSaleUnlockedId, newSaleReblockedId, newSaleOverrideOnceId] } }).catch(() => {});
        await StockMovement.destroy({ where: { productId } }).catch(() => {});
        await Sale.destroy({ where: { id: [oldSaleId, newSaleBlockedId, newSaleUnlockedId, newSaleReblockedId, newSaleOverrideOnceId] } }).catch(() => {});
        await CreditHistory.destroy({ where: { customerId } }).catch(() => {});
        await CollectionActionLog.destroy({ where: { customerId } }).catch(() => {});
        await AuditLog.destroy({ where: { companyId } }).catch(() => {});
        await SupervisorApproval.destroy({ where: { id: [approvalUnlockId, approvalOnceId] } }).catch(() => {});
        await Customer.destroy({ where: { id: customerId } }).catch(() => {});
        await Product.destroy({ where: { id: productId } }).catch(() => {});
        await User.destroy({ where: { id: [adminUserId, cashierUserId] } }).catch(() => {});
        await sequelize.close().catch(() => {});
    }
});
