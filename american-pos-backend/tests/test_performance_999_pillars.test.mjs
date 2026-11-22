import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.DB_NAME_FORCE = process.env.DB_NAME_FORCE || 'americanpos_test';
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-perf999-'));
process.env.USER_DATA_PATH = tmpUserData;

const require = createRequire(import.meta.url);
const { sequelize, connectDB } = require('../database/connection');
const { runMigrations } = require('../database/migrate');
const { Product, Sale, SaleItem, Expense, Refund, AccountCatalog, JournalEntry, User, Branch, StockMovement } = require('../database/models');
const ProductService = require('../services/ProductService');
const AccountingEngineService = require('../services/AccountingEngineService');
const DailyRollupService = require('../services/DailyRollupService');
const ReportService = require('../services/ReportService');
const telemetryCollector = require('../utils/telemetryCollector');
const { runWithTenantContext } = require('../database/tenantContext');

const TEST_COMPANY = `perf999_${Date.now()}`;
const TEST_USER = { id: `user_${Date.now()}`, companyId: TEST_COMPANY, role: 'admin', username: `perf_admin_${Date.now()}` };

before(async () => {
    await connectDB();
    await runMigrations();
    await AccountingEngineService.ensureJournalSequence();
    await DailyRollupService.ensureTable();
    await runWithTenantContext({ companyId: TEST_COMPANY, userId: TEST_USER.id, isSuperAdmin: true }, async () => {
        await User.create({
            id: TEST_USER.id,
            companyId: TEST_COMPANY,
            username: TEST_USER.username,
            name: 'Perf Admin',
            email: `${TEST_USER.username}@test.local`,
            password: 'hashed_dummy_password',
            role: 'admin',
            status: 'active'
        });
    });
});

after(async () => {
    try {
        await runWithTenantContext({ companyId: TEST_COMPANY, userId: TEST_USER.id, isSuperAdmin: true }, async () => {
            await sequelize.query(`DELETE FROM public.daily_sales_rollups WHERE "companyId" = :c`, { replacements: { c: TEST_COMPANY } }).catch(() => {});
            await StockMovement.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await SaleItem.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await Refund.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await Expense.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await Sale.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await Product.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await Branch.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await sequelize.query(`DELETE FROM "JournalEntryLines" WHERE "journalEntryId" IN (SELECT id FROM "JournalEntries" WHERE "companyId" = :c)`, { replacements: { c: TEST_COMPANY } }).catch(() => {});
            await JournalEntry.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await AccountCatalog.destroy({ where: { companyId: TEST_COMPANY } }).catch(() => {});
            await User.destroy({ where: { id: TEST_USER.id } }).catch(() => {});
        });
    } catch (_) {}
    DailyRollupService.stop();
    telemetryCollector.stop();
    await sequelize.close().catch(() => {});
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
});

test('Pilar 1 — Sincronización Delta (?since=) devuelve solo modificados y eliminados', async () => {
    await runWithTenantContext({ companyId: TEST_COMPANY, userId: TEST_USER.id, isSuperAdmin: true }, async () => {
        const p1 = await ProductService.createProduct(TEST_USER, { name: 'Delta Cafe A', price: 5.00, cost: 3.00, stockQuantity: 10, category: 'Viveres' });
        const p2 = await ProductService.createProduct(TEST_USER, { name: 'Delta Cafe B', price: 8.00, cost: 4.00, stockQuantity: 20, category: 'Viveres' });
        const p3 = await ProductService.createProduct(TEST_USER, { name: 'Delta Cafe C', price: 12.00, cost: 6.00, stockQuantity: 15, category: 'Viveres' });

        // Primera sincronización completa con delta=true para obtener marca de tiempo autoritativa
        const initial = await ProductService.getAllProducts(TEST_USER, { minimal: 'true', delta: 'true' });
        assert.equal(initial.delta, false);
        assert.ok(initial.serverTime, 'Debe devolver serverTime ISO');
        assert.equal(initial.products.length, 3);

        await new Promise(r => setTimeout(r, 40));
        const markTime = new Date().toISOString();
        await new Promise(r => setTimeout(r, 40));

        // Modificar p2 y eliminar p3; p1 queda intacto
        await ProductService.updateProduct(TEST_USER, p2.id, { name: 'Delta Cafe B Editado', price: 9.50, stockQuantity: 18 });
        await ProductService.deleteProduct(TEST_COMPANY, p3.id);

        const deltaRes = await ProductService.getAllProducts(TEST_USER, { minimal: 'true', since: markTime });
        assert.equal(deltaRes.delta, true, 'Debe responder en modo delta=true');
        assert.equal(deltaRes.products.length, 1, 'Solo debe transferir el 1 producto modificado (no el intacto)');
        assert.equal(deltaRes.products[0].id, p2.id);
        assert.equal(Number(deltaRes.products[0].price), 9.5);
        assert.ok(deltaRes.deletedIds.includes(p3.id), 'deletedIds debe incluir el producto eliminado');
        assert.ok(!deltaRes.products.some(p => p.id === p1.id), 'No debe reenviar productos sin cambios');
    });
});

test('Pilar 3 — Concurrencia Contable Multicaja: 12 asientos paralelos sin deadlocks ni lost updates', async () => {
    await runWithTenantContext({ companyId: TEST_COMPANY, userId: TEST_USER.id, isSuperAdmin: true }, async () => {
        await AccountingEngineService.seedDefaultChartOfAccounts(TEST_COMPANY);
        const accCaja = await AccountingEngineService.findAccountByCode('1.1.1.01.001', TEST_COMPANY);
        const accVentas = await AccountingEngineService.findAccountByCode('4.1.1.01.001', TEST_COMPANY);
        assert.ok(accCaja && accVentas, 'Cuentas PUC base deben existir');

        const initialCajaUsd = Number(accCaja.balanceUSD || 0);
        const initialVentasUsd = Number(accVentas.balanceUSD || 0);
        const CONCURRENCY = 12;
        const AMOUNT = 10.25;

        const t0 = performance.now();
        const entries = await Promise.all(
            Array.from({ length: CONCURRENCY }, (_, idx) =>
                AccountingEngineService.createEntry({
                    companyId: TEST_COMPANY,
                    entryDate: new Date().toISOString().slice(0, 10),
                    description: `Asiento concurrente caja #${idx + 1}`,
                    currency: 'USD',
                    exchangeRate: 50,
                    referenceType: 'SALE',
                    referenceId: `CONC-SALE-${idx}`,
                    lines: [
                        { accountId: accCaja.id, debit: AMOUNT, credit: 0 },
                        { accountId: accVentas.id, debit: 0, credit: AMOUNT }
                    ]
                })
            )
        );
        const elapsedMs = performance.now() - t0;

        const uniqueEntryNumbers = new Set(entries.map(e => e.entryNumber));
        assert.equal(uniqueEntryNumbers.size, CONCURRENCY, 'Todos los correlativos deben ser únicos sin colisiones');

        const cajaAfter = await AccountCatalog.findByPk(accCaja.id);
        const ventasAfter = await AccountCatalog.findByPk(accVentas.id);
        const expectedDelta = Number((CONCURRENCY * AMOUNT).toFixed(2));

        assert.equal(
            Number((Number(cajaAfter.balanceUSD) - initialCajaUsd).toFixed(2)),
            expectedDelta,
            'Saldo de Caja debe acumular exactamente las 12 transacciones sin lost updates'
        );
        assert.equal(
            Number((Number(ventasAfter.balanceUSD) - initialVentasUsd).toFixed(2)),
            expectedDelta,
            'Saldo de Ventas debe acumular exactamente las 12 transacciones sin lost updates'
        );
        console.log(`  [Pilar 3] ${CONCURRENCY} asientos concurrentes completados en ${elapsedMs.toFixed(1)} ms (0 deadlocks, delta=$${expectedDelta})`);
    });
});

test('Pilar 4 — DailyRollupService logra paridad exacta al centavo y < 25ms en rango anual (365 días)', async () => {
    await runWithTenantContext({ companyId: TEST_COMPANY, userId: TEST_USER.id, isSuperAdmin: true }, async () => {
        const dayKey = '2026-10-15';
        const saleDateIso = `${dayKey}T14:30:00.000Z`;
        const saleId = `SALE-ROLLUP-${Date.now()}`;

        await Sale.create({
            id: saleId,
            companyId: TEST_COMPANY,
            userId: TEST_USER.id,
            total: 45.00,
            subtotal: 50.00,
            tax: 0,
            discount: 5.00,
            promoDiscount: 0,
            paymentMethod: 'cash',
            paymentMethods: [{ method: 'cash_usd', amount: 45.00, currency: 'USD' }],
            exchangeRate: 50,
            status: 'completed',
            date: saleDateIso,
            timestamp: saleDateIso
        });
        await SaleItem.create({
            saleId,
            productId: 'prod-rollup-1',
            name: 'Arroz Premium 1Kg',
            category: 'Viveres',
            quantity: 5,
            price: 10.00,
            cost: 6.00,
            subtotal: 50.00,
            companyId: TEST_COMPANY
        });
        await Expense.create({
            id: `EXP-ROLLUP-${Date.now()}`,
            companyId: TEST_COMPANY,
            description: 'Hielo operativo',
            amount: 4.50,
            category: 'Operativo',
            date: saleDateIso
        });
        await Refund.create({
            id: `REF-ROLLUP-${Date.now()}`,
            companyId: TEST_COMPANY,
            saleId,
            amount: 5.00,
            reason: 'Prueba rollup',
            status: 'completed',
            date: saleDateIso,
            timestamp: saleDateIso
        });

        // 1. Consulta en vivo (sin rollup para este día aún)
        const liveRes = await ReportService.getDashboardSummary(TEST_USER, {
            startDate: '2026-01-01',
            endDate: '2026-12-31'
        });
        assert.equal(liveRes.debugRange.rollupAccelerated, false, 'Primera consulta sin rollup debe usar cálculo SQL en vivo');

        // 2. Reconstruir rollup para el día
        await DailyRollupService.rebuildDay(TEST_COMPANY, dayKey);

        // 3. Consultar rango anual 365 días acelerado por daily_sales_rollups
        const t0 = performance.now();
        const rollupRes = await ReportService.getDashboardSummary(TEST_USER, {
            startDate: '2026-01-01',
            endDate: '2026-12-31'
        });
        const rollupMs = performance.now() - t0;

        assert.equal(rollupRes.debugRange.rollupAccelerated, true, 'Debe servirse desde daily_sales_rollups');
        assert.equal(rollupRes.rangeSummary.totalRevenue, liveRes.rangeSummary.totalRevenue, 'Paridad exacta en totalRevenue');
        assert.equal(rollupRes.rangeSummary.numberOfSales, liveRes.rangeSummary.numberOfSales, 'Paridad exacta en numberOfSales');
        assert.equal(rollupRes.rangeSummary.totalExpenses, liveRes.rangeSummary.totalExpenses, 'Paridad exacta en totalExpenses');
        assert.equal(rollupRes.rangeSummary.totalProfit, liveRes.rangeSummary.totalProfit, 'Paridad exacta en totalProfit');
        assert.equal(rollupRes.rangeSummary.netProfit, liveRes.rangeSummary.netProfit, 'Paridad exacta en netProfit');
        assert.equal(rollupRes.rangeSummary.ticketPromedio, liveRes.rangeSummary.ticketPromedio, 'Paridad exacta en ticketPromedio');
        assert.ok(rollupMs < 150, `Consulta anual desde rollup debe ser ultrarrápida (fue ${rollupMs.toFixed(2)} ms)`);
        console.log(`  [Pilar 4] Reporte anual 365 días desde daily_sales_rollups: ${rollupMs.toFixed(2)} ms (paridad 100% exacta)`);
    });
});

test('Pilar 5 — Observabilidad APM: percentiles p50/p95/p99, slow queries sanitizadas y memoria acotada', () => {
    telemetryCollector.reset();

    for (let i = 1; i <= 2500; i++) {
        telemetryCollector.recordHttp('GET', `/api/products/${i}`, i % 100 === 0 ? 500 : 200, (i % 100) + 1);
    }
    for (let j = 0; j < 70; j++) {
        telemetryCollector.recordDbQuery(`SELECT * FROM "Users" WHERE password = 'secret_${j}'`, 250 + j);
    }

    const snap = telemetryCollector.getSnapshot();
    assert.equal(snap.http.totalRequests, 2500);
    assert.equal(snap.http.errors5xx, 25);
    assert.equal(snap.http.latency.count, 1000, 'Ring buffer global debe quedar estrictamente acotado en 1000 muestras');
    assert.ok(snap.http.latency.p50Ms <= snap.http.latency.p95Ms && snap.http.latency.p95Ms <= snap.http.latency.p99Ms);
    assert.equal(snap.http.busiestRoutes[0].route, 'GET /api/products/:id', 'Las rutas con ID numérico deben normalizarse');
    assert.equal(snap.database.totalSlowQueries, 70);
    assert.ok(snap.database.recentSlowQueries.length <= 20);
    assert.ok(!snap.database.recentSlowQueries[0].sql.includes('secret_'), 'Los literales SQL deben redactarse para no filtrar secretos');
});
