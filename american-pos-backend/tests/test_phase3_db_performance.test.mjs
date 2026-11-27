import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-phase3-test-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'p3-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'p3-sync-' + crypto.randomBytes(24).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'p3-bk-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'p3-aud-' + crypto.randomBytes(24).toString('hex');

const require = createRequire(import.meta.url);
const { sequelize, connectDB } = require('../database/connection');
const { runPostConnectMigrations } = require('../database/schemaMigrator');
const { runMigrations } = require('../database/migrate');
const AutoMaintenanceService = require('../services/AutoMaintenanceService');
const ReportService = require('../services/ReportService');
const ProductService = require('../services/ProductService');
const StockIntelligenceService = require('../services/StockIntelligenceService');
const {
    Customer,
    CreditHistory,
    Supplier,
    SupplierCreditHistory,
    PurchaseOrder,
    Sale,
    Product
} = require('../database/models');

after(async () => {
    try {
        await sequelize.close();
    } catch (_) {}
    try {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('Fase 3.1 — schemaMigrator, migrate y AutoMaintenanceService convergen en índices sin conflictos', async () => {
    await connectDB();

    await runMigrations();
    await runPostConnectMigrations(sequelize, 'postgres');
    const idxRes = await AutoMaintenanceService.ensureIndexes();
    assert.ok(idxRes && idxRes.indexesChecked > 0);
    assert.equal(idxRes.createdCount, idxRes.indexesChecked, 'Todos los índices/estadísticas de AutoMaintenance deben aplicarse sin fallos');

    const rows = await sequelize.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
        { type: sequelize.QueryTypes.SELECT }
    );
    const indexNames = new Set(rows.map((r) => r.indexname));

    const expectedIndexes = [
        'idx_sales_company_created',
        'idx_sales_company_status_date',
        'idx_sales_company_cust_created',
        'idx_saleitems_sale_prod',
        'idx_cashmovements_shift',
        'idx_audit_logs_company_created',
        'idx_expenses_company_date',
        'idx_stock_movements_company_prod_date',
        'idx_stock_alerts_company_resolved',
        'idx_credit_history_comp_cust_type',
        'idx_supplier_credit_history_sup',
        'idx_customers_company_credit',
        'idx_suppliers_company_credit'
    ];
    for (const idx of expectedIndexes) {
        assert.ok(indexNames.has(idx), `Falta el índice estratégico ${idx}`);
    }

    const redundantIndexes = [
        'idx_saleitems_saleid',
        'idx_stockmovements_product',
        'idx_products_name',
        'idx_products_name_trgm',
        'idx_products_principio_trgm',
        'idx_cashmovements_shiftid',
        'idx_stock_alerts_resolved'
    ];
    for (const red of redundantIndexes) {
        assert.equal(indexNames.has(red), false, `El índice redundante ${red} no debería permanecer activo`);
    }
});

test('Fase 3.2 — ReportService elimina N+1 (CxC y CxP) con paridad FIFO y ejecuta rankings/series en SQL', async () => {
    await connectDB();

    const compId = `comp-p3-${Date.now()}`;
    const todayStr = new Date().toISOString().slice(0, 10);
    const oldTs = new Date(Date.now() - 40 * 86400000).toISOString();
    const recentTs = new Date(Date.now() - 5 * 86400000).toISOString();

    const custIds = Array.from({ length: 4 }, (_, i) => `${compId}-c${i}`);
    const supIds = Array.from({ length: 4 }, (_, i) => `${compId}-s${i}`);
    const poId = `${compId}-po-0`;

    try {
        await Customer.bulkCreate(custIds.map((id, i) => ({
            id,
            name: `Cliente Moroso ${i}`,
            companyId: compId,
            creditLimit: 500,
            creditBalance: 100 + i * 10
        })));

        await CreditHistory.bulkCreate([
            { id: `${compId}-ch1`, customerId: custIds[0], companyId: compId, type: 'charge', amount: 100, timestamp: oldTs },
            { id: `${compId}-ch2`, customerId: custIds[1], companyId: compId, type: 'charge', amount: 50, timestamp: oldTs },
            { id: `${compId}-ch3`, customerId: custIds[1], companyId: compId, type: 'charge', amount: 110, timestamp: recentTs },
            { id: `${compId}-ch4`, customerId: custIds[1], companyId: compId, type: 'payment', amount: 50, timestamp: recentTs }
        ]);

        await Supplier.bulkCreate(supIds.map((id, i) => ({
            id,
            name: `Proveedor ${i}`,
            companyId: compId,
            creditBalance: 200 + i * 25
        })));

        await PurchaseOrder.create({
            id: poId,
            supplierId: supIds[0],
            date: todayStr,
            arrivalDate: todayStr,
            dueDate: '2026-12-31',
            exchangeRate: 50,
            status: 'received',
            total: 200,
            totalVes: 10000,
            companyId: compId
        });

        await SupplierCreditHistory.bulkCreate([
            { id: `${compId}-sh1`, supplierId: supIds[0], companyId: compId, type: 'charge', amount: 250, purchaseOrderId: poId, referenceNumber: 'FAC-100', timestamp: oldTs },
            { id: `${compId}-sh2`, supplierId: supIds[0], companyId: compId, type: 'payment', amount: 50, timestamp: recentTs },
            { id: `${compId}-sh3`, supplierId: supIds[1], companyId: compId, type: 'charge', amount: 225, referenceNumber: 'FAC-200', timestamp: recentTs }
        ]);

        await Sale.bulkCreate([
            {
                id: `${compId}-sale-0`,
                companyId: compId,
                customerId: custIds[2],
                customerName: 'Cliente Moroso 2',
                userId: 'u-p3',
                date: `${todayStr}T10:15:00.000Z`,
                total: 120,
                subtotal: 120,
                paymentMethod: 'credit',
                paymentStatus: 'unpaid',
                status: 'completed'
            },
            {
                id: `${compId}-sale-1`,
                companyId: compId,
                customerId: custIds[3],
                customerName: 'Cliente Moroso 3',
                userId: 'u-p3',
                date: `${todayStr}T11:30:00.000Z`,
                total: 130,
                subtotal: 130,
                paymentMethod: 'cash',
                paymentStatus: 'paid',
                status: 'completed'
            }
        ]);

        const origQuery = sequelize.query.bind(sequelize);
        let queryCount = 0;
        sequelize.query = (...args) => {
            queryCount += 1;
            return origQuery(...args);
        };

        let arResult;
        let apResult;
        let arQueries = 0;
        let apQueries = 0;
        try {
            queryCount = 0;
            arResult = await ReportService.getAccountsReceivable(compId);
            arQueries = queryCount;

            queryCount = 0;
            apResult = await ReportService.getAccountsPayable(compId);
            apQueries = queryCount;
        } finally {
            sequelize.query = origQuery;
        }

        assert.equal(arResult.summary.totalCustomers, 4);
        assert.equal(arResult.summary.totalAmount, 460);
        assert.ok(arQueries <= 3, `getAccountsReceivable debe resolver en <= 3 queries batch sin N+1 (ejecutó ${arQueries})`);

        const cust1 = arResult.customers.find((c) => c.id === custIds[1]);
        assert.equal(cust1.agingBracket, 'CURRENT', 'El cargo viejo fue pagado FIFO y solo queda el reciente');

        assert.equal(apResult.summary.totalSuppliers, 4);
        assert.equal(apResult.summary.totalAmount, 950);
        assert.ok(apQueries <= 3, `getAccountsPayable debe resolver en <= 3 queries batch sin N+1 (ejecutó ${apQueries})`);

        const sup0 = apResult.suppliers.find((s) => s.id === supIds[0]);
        assert.equal(sup0.invoices.length, 1);
        assert.equal(sup0.invoices[0].status, 'PARTIAL');
        assert.equal(sup0.invoices[0].balanceRemaining, 200);
        assert.equal(sup0.nextDueDate, '2026-12-31');

        const ranking = await ReportService.getCustomerRanking({ companyId: compId, role: 'superadmin', id: 'u-p3' }, '30d');
        assert.equal(ranking.length, 2);
        assert.equal(ranking[0].totalSales, 130);

        const dailySales = await ReportService.getDailyReport({ companyId: compId, role: 'superadmin', id: 'u-p3' }, todayStr);
        assert.equal(dailySales.length, 2);

        const ts = await ReportService.getTimeSeries({ companyId: compId, role: 'superadmin', id: 'u-p3' }, 7);
        const todayBucket = ts.find((d) => d.date === todayStr);
        assert.ok(todayBucket);
        assert.equal(todayBucket.total, 250);

        const logs = await ReportService.getAuditLogs(compId, 10, 0);
        assert.ok(Array.isArray(logs));
    } finally {
        await SupplierCreditHistory.destroy({ where: { companyId: compId } }).catch(() => {});
        await PurchaseOrder.destroy({ where: { companyId: compId } }).catch(() => {});
        await Supplier.destroy({ where: { companyId: compId } }).catch(() => {});
        await CreditHistory.destroy({ where: { companyId: compId } }).catch(() => {});
        await Sale.destroy({ where: { companyId: compId } }).catch(() => {});
        await Customer.destroy({ where: { companyId: compId } }).catch(() => {});
    }
});

test('Fase 3.3 — ProductService.searchProductsForLink usa unaccent ILIKE y StockIntelligenceService maneja catálogo vacío sin fallos', async () => {
    await connectDB();
    const compId = `comp-p3-prod-${Date.now()}`;
    const prodId = `${compId}-p1`;
    try {
        await Product.create({
            id: prodId,
            name: 'Azúcar Refinada 1Kg',
            barcode: '759000123456',
            cost: 1.0,
            price: 1.5,
            stockQuantity: 10,
            companyId: compId,
            status: 'active'
        });

        const found = await ProductService.searchProductsForLink({ companyId: compId }, 'azucar');
        assert.equal(found.length, 1);
        assert.equal(found[0].id, prodId);

        const preds = await StockIntelligenceService.getStockPredictions(compId, 14);
        assert.deepEqual(preds, []);
    } finally {
        await Product.destroy({ where: { companyId: compId } }).catch(() => {});
    }
});
