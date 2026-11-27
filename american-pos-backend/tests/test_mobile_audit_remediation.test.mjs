import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const models = require('../database/models');
const { productSchema, productUpdateSchema, stockCountSchema } = require('../schemas/productSchema');
const SaleService = require('../services/SaleService');
const CashService = require('../services/CashService');
const PromotionService = require('../services/PromotionService');
const AlertService = require('../services/AlertService');
const AccountingEngineService = require('../services/AccountingEngineService');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const LANClusterService = require('../services/LANClusterService');
const { evaluateCartPromotions } = require('../utils/promotionsEngineCore');

after(async () => {
    try {
        await models.sequelize.close();
    } catch (_) {}
});

test('Fase 1.2 — productSchema, productUpdateSchema y stockCountSchema aceptan imageUri null y conteo físico parcial', () => {
    const parsedCreate = productSchema.parse({
        body: {
            name: 'Harina Pan',
            price: 1.5,
            cost: 1.1,
            imageUri: null
        }
    });
    assert.equal(parsedCreate.body.imageUri, null);

    const parsedUpdate = productUpdateSchema.parse({
        body: {
            stockQuantity: 42,
            imageUri: null
        }
    });
    assert.equal(parsedUpdate.body.stockQuantity, 42);
    assert.equal(parsedUpdate.body.imageUri, null);

    const parsedCount = stockCountSchema.parse({
        body: {
            stockQuantity: 15,
            reason: 'Conteo físico móvil'
        }
    });
    assert.equal(parsedCount.body.stockQuantity, 15);

    assert.throws(() => stockCountSchema.parse({ body: { reason: 'Sin stock ni delta' } }));
});

test('Fase 1.3 — promotionsEngineCore evalúa vigencia contra fecha histórica (venta offline)', () => {
    const expiredPromo = {
        id: 'promo-hist-1',
        name: 'Promo Ayer 20%',
        type: 'CATEGORY_DISCOUNT',
        discountPercentage: 20,
        isActive: true,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-05T23:59:59.000Z',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    };
    const items = [{ id: 'p1', productId: 'p1', name: 'Café', category: 'Bebidas', price: 10, quantity: 1 }];

    // Hoy (fuera de vigencia): 0 descuento
    const evalNow = evaluateCartPromotions(items, [expiredPromo], 'cash_usd', new Date('2026-02-01T12:00:00.000Z'));
    assert.equal(evalNow.totalPromoSavings, 0);

    // En la fecha histórica de la venta offline (dentro de vigencia): $2.00 descuento
    const evalHistorical = evaluateCartPromotions(items, [expiredPromo], 'cash_usd', new Date('2026-01-03T12:00:00.000Z'));
    assert.equal(evalHistorical.totalPromoSavings, 2);
});

test('Fase 1.3 (A3) — SaleService isOfflineSync acepta precio/tasa históricos válidos, registra alertas/auditoría y recalcula changeAmount', async () => {
    const origGetSettings = SaleService._getSettings;
    const origLogAudit = SaleService._logAudit;
    const origSaleFindByPk = models.Sale.findByPk;
    const origSaleFindOne = models.Sale.findOne;
    const origSaleCreate = models.Sale.create;
    const origSaleItemCreate = models.SaleItem.create;
    const origProductFindAll = models.Product.findAll;
    const origProductFindOne = models.Product.findOne;
    const origProductUpdate = models.Product.update;
    const origProductLotFindAll = models.ProductLot.findAll;
    const origBomFindAll = models.BillOfMaterials?.findAll;
    const origSequelizeQuery = models.sequelize.query;
    const origBranchFindOne = models.Branch.findOne;
    const origBranchStockCount = models.BranchStock.count;
    const origBranchStockFindOrCreate = models.BranchStock.findOrCreate;
    const origStockMovBulkCreate = models.StockMovement.bulkCreate;
    const origTransaction = models.sequelize.transaction;
    const origTriggerAlert = AlertService.triggerAlert;
    const origGenAccounting = AccountingEngineService.generateSaleEntry;
    const origQueueEvent = SupabaseSyncService.queueEvent;
    const origBroadcastLan = LANClusterService.broadcastLANEvent;
    const origPromoEval = PromotionService.evaluateCart;

    const auditLogs = [];
    const triggeredAlerts = [];
    let createdSaleData = null;
    let lanBroadcastPayload = null;

    try {
        SaleService._getSettings = async () => ({
            exchangeRate: 100, // Tasa vigente hoy = 100 Bs/$
            businessInfo: { country: 'Venezuela' },
            taxConfig: { ivaEnabled: false, igtfEnabled: false }
        });
        SaleService._logAudit = async (_u, action, desc, entityId, oldVal, newVal) => {
            auditLogs.push({ action, desc, entityId, oldVal, newVal });
        };
        AlertService.triggerAlert = async (alertData) => {
            triggeredAlerts.push(alertData);
            return alertData;
        };
        AccountingEngineService.generateSaleEntry = async () => ({ id: 'je-1' });
        SupabaseSyncService.queueEvent = async () => {};
        LANClusterService.broadcastLANEvent = (evt, payload) => {
            if (evt === 'lan_stock_update') lanBroadcastPayload = payload;
        };
        PromotionService.evaluateCart = async () => ({ totalDiscount: 0, appliedPromotions: [] });

        const mockProduct = {
            id: 'prod-harina',
            name: 'Harina',
            price: 12.00, // Precio actual en catálogo subió a $12
            cost: 7.00,
            category: 'Alimentos',
            companyId: 'default',
            taxStatus: 'exento',
            stockQuantity: 50,
            stock: 50,
            allowNegative: true,
            Presentations: [],
            decrement: async () => {},
            update: async () => {}
        };

        models.Sale.findByPk = async () => null;
        models.Sale.findOne = async () => ({
            id: createdSaleData?.id,
            ...createdSaleData,
            setDataValue: () => {}
        });
        models.Sale.create = async (data) => {
            createdSaleData = { ...data };
            return {
                ...data,
                update: async (patch) => Object.assign(createdSaleData, patch),
                toJSON: () => ({ ...createdSaleData })
            };
        };
        models.SaleItem.create = async (data) => ({ ...data });
        models.Product.findAll = async () => [mockProduct];
        models.Product.findOne = async () => mockProduct;
        models.Product.update = async () => [1];
        models.ProductLot.findAll = async () => [];
        if (models.BillOfMaterials) models.BillOfMaterials.findAll = async () => [];
        models.sequelize.query = async () => [{ nextval: 1 }];
        models.Branch.findOne = async () => ({ id: 'branch-main' });
        models.BranchStock.count = async () => 1;
        models.BranchStock.findOrCreate = async () => [{ quantity: 50, decrement: async () => {} }, false];
        models.StockMovement.bulkCreate = async () => [];
        models.sequelize.transaction = async () => ({
            LOCK: { UPDATE: 'UPDATE' },
            commit: async () => {},
            rollback: async () => {},
            finished: false
        });

        const cashierUser = { id: 'u-cajero-1', companyId: 'default', role: 'user', name: 'Cajero Móvil', permissions: {} };
        const twoHoursAgoIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

        // Venta offline con precio histórico $10 (vs $12 actual), tasa histórica 90 Bs/$ (dentro de ±35% de 100),
        // pagada con 1080 Bs (= $12 a tasa 90 => vuelto real $2.00, aunque el cliente mande changeAmount fraudulento 999)
        const result = await SaleService.processSale(cashierUser, {
            id: 'tx-offline-drift-001',
            date: twoHoursAgoIso,
            terminalId: 'TERM-MOB-TEST',
            exchangeRate: 90,
            total: 10.00,
            changeAmount: 999.00,
            paymentMethod: 'cash_bs',
            paymentMethods: [{ method: 'cash_bs', amount: 1080, currency: 'VES' }],
            items: [{ productId: 'prod-harina', name: 'Harina', quantity: 1, price: 10.00 }]
        }, { isOfflineSync: true, bypassShiftCheck: true, bypassStockCheck: true });

        assert.ok(result, 'La venta offline con drift histórico razonable debe aceptarse sin cuarentena');
        assert.equal(createdSaleData.total, 10);
        assert.equal(createdSaleData.exchangeRate, 90);
        assert.equal(createdSaleData.changeAmount, 2, 'El vuelto debe recalcularse en el servidor ($12 - $10 = $2), ignorando 999');
        assert.ok(auditLogs.some(l => l.action === 'OFFLINE_PRICE_DRIFT'), 'Debe registrar AuditLog OFFLINE_PRICE_DRIFT');
        assert.ok(auditLogs.some(l => l.action === 'OFFLINE_RATE_DRIFT'), 'Debe registrar AuditLog OFFLINE_RATE_DRIFT');
        assert.ok(triggeredAlerts.some(a => a.type === 'financial_mismatch' && a.metadata?.subtype === 'OFFLINE_PRICE_DRIFT'), 'Debe disparar Alert financial_mismatch/OFFLINE_PRICE_DRIFT');
        assert.ok(triggeredAlerts.some(a => a.type === 'financial_mismatch' && a.metadata?.subtype === 'OFFLINE_RATE_DRIFT'), 'Debe disparar Alert financial_mismatch/OFFLINE_RATE_DRIFT');
        assert.equal(lanBroadcastPayload?.sourceTerminalId, 'TERM-MOB-TEST', 'Debe propagar sourceTerminalId en lan_stock_update');

        // Validar rechazo si la tasa offline supera ±35% (ej. 50 Bs vs 100 Bs = -50%)
        await assert.rejects(
            () => SaleService.processSale(cashierUser, {
                id: 'tx-offline-bad-rate',
                date: twoHoursAgoIso,
                exchangeRate: 50,
                total: 10.00,
                paymentMethod: 'cash_bs',
                paymentMethods: [{ method: 'cash_bs', amount: 500, currency: 'VES' }],
                items: [{ productId: 'prod-harina', name: 'Harina', quantity: 1, price: 10.00 }]
            }, { isOfflineSync: true, bypassShiftCheck: true, bypassStockCheck: true }),
            /±35%/
        );

        // Validar rechazo si la venta offline tiene más de 7 días de antigüedad
        const tenDaysAgoIso = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
        await assert.rejects(
            () => SaleService.processSale(cashierUser, {
                id: 'tx-offline-too-old',
                date: tenDaysAgoIso,
                exchangeRate: 100,
                total: 12.00,
                paymentMethod: 'cash_usd',
                paymentMethods: [{ method: 'cash_usd', amount: 12, currency: 'USD' }],
                items: [{ productId: 'prod-harina', name: 'Harina', quantity: 1, price: 12.00 }]
            }, { isOfflineSync: true, bypassShiftCheck: true, bypassStockCheck: true }),
            /7 días/
        );
    } finally {
        SaleService._getSettings = origGetSettings;
        SaleService._logAudit = origLogAudit;
        models.Sale.findByPk = origSaleFindByPk;
        models.Sale.findOne = origSaleFindOne;
        models.Sale.create = origSaleCreate;
        models.SaleItem.create = origSaleItemCreate;
        models.Product.findAll = origProductFindAll;
        models.Product.findOne = origProductFindOne;
        models.Product.update = origProductUpdate;
        models.ProductLot.findAll = origProductLotFindAll;
        if (models.BillOfMaterials && origBomFindAll) models.BillOfMaterials.findAll = origBomFindAll;
        models.sequelize.query = origSequelizeQuery;
        models.Branch.findOne = origBranchFindOne;
        models.BranchStock.count = origBranchStockCount;
        models.BranchStock.findOrCreate = origBranchStockFindOrCreate;
        models.StockMovement.bulkCreate = origStockMovBulkCreate;
        models.sequelize.transaction = origTransaction;
        AlertService.triggerAlert = origTriggerAlert;
        AccountingEngineService.generateSaleEntry = origGenAccounting;
        SupabaseSyncService.queueEvent = origQueueEvent;
        LANClusterService.broadcastLANEvent = origBroadcastLan;
        PromotionService.evaluateCart = origPromoEval;
    }
});

test('Fase 1.3 — CashService.closeShiftBlind acepta declaración numérica plana (móvil) además de denominaciones', async () => {
    const OwnerNotificationService = require('../services/OwnerNotificationService');
    const origTransaction = models.sequelize.transaction;
    const origShiftFindOne = models.CashShift.findOne;
    const origMovFindAll = models.CashMovement.findAll;
    const origMovCreate = models.CashMovement.create;
    const origDeclCreate = models.CashDeclaration.create;
    const origQueueEvent = SupabaseSyncService.queueEvent;
    const origNotifyShiftClose = OwnerNotificationService.notifyShiftClose;
    const origGetStats = CashService.getShiftStats;
    const origGetProdSummary = CashService.getShiftProductsSummary;
    const origLogAudit = CashService._logAudit;

    let savedDeclaration = null;

    try {
        const mockShift = {
            id: 'shift-blind-mob-1',
            userId: 'u-1',
            companyId: 'default',
            registerId: 'MOB-ABC123',
            status: 'open',
            openedAt: new Date().toISOString(),
            initialAmount: 10,
            initialBreakdown: { cash: 10 },
            update: async () => {},
            toJSON: () => ({ id: 'shift-blind-mob-1', status: 'closed', registerId: 'MOB-ABC123' })
        };

        models.sequelize.transaction = async (cb) => cb({ LOCK: { UPDATE: 'UPDATE' } });
        models.CashShift.findOne = async () => mockShift;
        models.CashMovement.findAll = async () => [];
        models.CashMovement.create = async (data) => data;
        models.CashDeclaration.create = async (data) => {
            savedDeclaration = data;
            return data;
        };
        SupabaseSyncService.queueEvent = async () => {};
        OwnerNotificationService.notifyShiftClose = async () => {};
        CashService.getShiftStats = async () => ({
            totalSalesAmount: 35,
            cashSalesTotal: 35,
            salesCount: 2,
            paymentBreakdownNative: { cash: 35 }
        });
        CashService.getShiftProductsSummary = async () => [];
        CashService._logAudit = async () => {};

        const res = await CashService.closeShiftBlind(
            { id: 'u-1', companyId: 'default', role: 'user', name: 'Cajero Ciego' },
            {
                shiftId: 'shift-blind-mob-1',
                registerId: 'MOB-ABC123',
                declaration: { usd: 45, ves: 0, card: 0, zelle: 0, mobile: 0 },
                notes: 'Cierre ciego móvil exacto'
            }
        );

        assert.ok(res, 'closeShiftBlind debe completarse correctamente');
        assert.equal(savedDeclaration.declaredCashUSD, 45);
        assert.equal(savedDeclaration.differenceUSD, 0);
    } finally {
        models.sequelize.transaction = origTransaction;
        models.CashShift.findOne = origShiftFindOne;
        models.CashMovement.findAll = origMovFindAll;
        models.CashMovement.create = origMovCreate;
        models.CashDeclaration.create = origDeclCreate;
        SupabaseSyncService.queueEvent = origQueueEvent;
        OwnerNotificationService.notifyShiftClose = origNotifyShiftClose;
        CashService.getShiftStats = origGetStats;
        CashService.getShiftProductsSummary = origGetProdSummary;
        CashService._logAudit = origLogAudit;
    }
});

// ============================================================================
// FASE 2 — SEGURIDAD, RBAC, BIOMETRÍA ECDSA v2, LICENCIAS Y ANTI-SSRF
// ============================================================================

const invokeExpressRouter = (router, reqOverrides = {}) => new Promise((resolve, reject) => {
    const out = { handled: false, statusCode: 200, body: null };
    const urlPath = (reqOverrides.url || '/').split('?')[0];
    const req = {
        method: 'GET',
        url: '/',
        path: urlPath,
        originalUrl: reqOverrides.url || '/',
        headers: {},
        query: {},
        body: {},
        params: {},
        app: { get: () => null },
        ...reqOverrides
    };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; out.statusCode = code; return this; },
        json(payload) { out.handled = true; out.body = payload; resolve(out); return this; },
        send(payload) { out.handled = true; out.body = payload; resolve(out); return this; },
        setHeader() { return this; },
        getHeader() { return undefined; }
    };
    router.handle(req, res, (err) => {
        if (err) return reject(err);
        resolve(out);
    });
});

test('Fase 2.1 — licenseMiddleware exige licencia en endpoints public-sync y solo exime GET /products/public-catalog', async () => {
    const { verifyLicense, clearLicenseCache } = require('../middleware/licenseMiddleware');
    const origLicenseFindOne = models.License.findOne;
    clearLicenseCache();
    models.License.findOne = async () => null;

    const runMiddleware = (method, path) => new Promise((resolve) => {
        let calledNext = false;
        let statusCode = 200;
        let body = null;
        const req = {
            method,
            path,
            originalUrl: path,
            headers: { 'x-terminal-id': 'TERM-PHASE2-UNLICENSED' },
            query: {},
            ip: '192.168.1.99'
        };
        const res = {
            status(code) { statusCode = code; return this; },
            json(payload) { body = payload; resolve({ calledNext, statusCode, body }); return this; }
        };
        verifyLicense(req, res, () => {
            calledNext = true;
            resolve({ calledNext, statusCode, body });
        });
    });

    try {
        const catalogRes = await runMiddleware('GET', '/products/public-catalog');
        assert.equal(catalogRes.calledNext, true, 'GET /products/public-catalog debe mantenerse exento');

        for (const blockedPath of ['/sales/public-sync', '/products/public-sync', '/customers/public-sync', '/customers/public-payment']) {
            const res = await runMiddleware('POST', blockedPath);
            assert.equal(res.calledNext, false, `${blockedPath} debe bloquearse sin licencia activa`);
            assert.equal(res.statusCode, 403, `${blockedPath} debe responder 403 sin licencia activa`);
        }
    } finally {
        models.License.findOne = origLicenseFindOne;
        clearLicenseCache();
    }
});

test('Fase 2.2 — routes/customers bloquea mass-assignment financiero en /public-sync y exige RBAC en /public-payment', async () => {
    const jwt = require('jsonwebtoken');
    const customersRouter = require('../routes/customers');
    const { invalidateUserAuthCache } = require('../middleware/auth');
    const origFindByPk = models.Customer.findByPk;
    const origFindOne = models.Customer.findOne;
    const origCreate = models.Customer.create;
    const origUserFindByPk = models.User.findByPk;
    let createdPayload = null;

    const cashier = {
        id: 'u-cashier-p22',
        username: 'cajero_p22',
        role: 'cashier',
        status: 'active',
        companyId: 'comp-sec',
        currentSessionId: 'SESS-P22',
        permissions: { canAccessPOS: true, canManageReceivables: false, canManageCustomers: false }
    };
    const token = jwt.sign(
        { id: cashier.id, role: cashier.role, companyId: cashier.companyId, sessionId: 'SESS-P22', permissions: cashier.permissions },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    invalidateUserAuthCache(cashier.id);
    models.User.findByPk = async (id) => (String(id) === cashier.id ? cashier : null);
    models.Customer.findByPk = async () => null;
    models.Customer.findOne = async () => null;
    models.Customer.create = async (payload) => {
        createdPayload = payload;
        return { ...payload, toJSON: () => ({ ...payload }) };
    };

    try {
        const syncRes = await invokeExpressRouter(customersRouter, {
            method: 'POST',
            url: '/public-sync',
            headers: { authorization: `Bearer ${token}` },
            body: {
                customers: [{
                    id: 'cust-ma-1',
                    name: 'Cliente Prueba',
                    cedula: 'V-12345678',
                    creditLimit: 99999,
                    creditBalance: 50000,
                    isCreditBlocked: false,
                    loyaltyPoints: 50000
                }]
            }
        });
        assert.equal(syncRes.statusCode, 200);
        assert.ok(createdPayload, 'Debe crear el cliente permitido');
        assert.equal(createdPayload.creditLimit, 0, 'Un cajero sin canManageReceivables no puede elevar creditLimit');
        assert.equal(createdPayload.creditBalance, 0, 'creditBalance jamás debe ser asignable desde public-sync (siempre inicia en 0)');
        assert.equal(createdPayload.loyaltyPoints, 0, 'loyaltyPoints jamás debe ser asignable desde public-sync (siempre inicia en 0)');

        const payDenied = await invokeExpressRouter(customersRouter, {
            method: 'POST',
            url: '/public-payment',
            headers: { authorization: `Bearer ${token}` },
            body: { customerId: 'cust-ma-1', amount: 10 }
        });
        assert.equal(payDenied.statusCode, 403, '/customers/public-payment debe exigir canManageReceivables o canManageCustomers');
    } finally {
        models.User.findByPk = origUserFindByPk;
        models.Customer.findByPk = origFindByPk;
        models.Customer.findOne = origFindOne;
        models.Customer.create = origCreate;
        invalidateUserAuthCache(cashier.id);
    }
});

test('Fase 2.3 — Fugas de costos y ventas ajenas selladas en ProductImportService, /products/:id/lots y /sales/public-list', async () => {
    const ProductImportService = require('../services/products/ProductImportService');
    const productsRouter = require('../routes/products');
    const salesRouter = require('../routes/sales');

    const origProductFindAll = models.Product.findAll;
    const origLotFindAll = models.ProductLot.findAll;
    const origSaleFindAll = models.Sale.findAll;

    const rawProd = {
        id: 'p-1',
        name: 'Café',
        sku: 'CAF-1',
        barcode: '7591234',
        price: 10,
        cost: 4.5,
        margin: 122,
        stockQuantity: 20,
        unitsPerBulk: 1,
        category: 'Bebidas',
        unit: 'unidad',
        imageUri: null
    };
    models.Product.findAll = async () => [{
        ...rawProd,
        get: () => ({ ...rawProd })
    }];
    models.ProductLot.findAll = async () => [{
        id: 'lot-1',
        lotNumber: 'L001',
        quantity: 10,
        cost: 4.5,
        toJSON() { return { id: 'lot-1', lotNumber: 'L001', quantity: 10, cost: 4.5 }; }
    }];
    let capturedSaleWhere = null;
    models.Sale.findAll = async (opts) => {
        capturedSaleWhere = opts?.where || null;
        return [{
            id: 'sale-1',
            userId: 'u-cashier-1',
            total: 10,
            SaleItems: [{ id: 'si-1', name: 'Café', price: 10, cost: 4.5, quantity: 1 }],
            toJSON() {
                return {
                    id: 'sale-1',
                    userId: 'u-cashier-1',
                    total: 10,
                    SaleItems: [{ id: 'si-1', name: 'Café', price: 10, cost: 4.5, quantity: 1 }]
                };
            }
        }];
    };

    const jwt = require('jsonwebtoken');
    const { invalidateUserAuthCache } = require('../middleware/auth');
    const origUserFindByPk = models.User.findByPk;
    const cashier = {
        id: 'u-cashier-1',
        username: 'cajero_p23',
        role: 'cashier',
        status: 'active',
        companyId: 'comp-sec',
        currentSessionId: 'SESS-P23',
        permissions: { canAccessPOS: true, canViewCosts: false, canViewSalesHistory: false }
    };
    const token = jwt.sign(
        { id: cashier.id, role: cashier.role, companyId: cashier.companyId, sessionId: 'SESS-P23', permissions: cashier.permissions },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    invalidateUserAuthCache(cashier.id);
    models.User.findByPk = async (id) => (String(id) === cashier.id ? cashier : null);

    try {
        const linked = await ProductImportService.searchProductsForLink('comp-sec', 'Café', cashier);
        assert.equal(linked.length, 1);
        assert.equal(linked[0].cost, undefined, 'searchProductsForLink no debe exponer cost a cajeros');
        assert.equal(linked[0].currentCost, undefined, 'searchProductsForLink no debe exponer currentCost a cajeros');

        const lotsRes = await invokeExpressRouter(productsRouter, {
            method: 'GET',
            url: '/p-1/lots',
            headers: { authorization: `Bearer ${token}` }
        });
        assert.equal(lotsRes.statusCode, 200);
        assert.equal(lotsRes.body[0].cost, undefined, 'GET /products/:id/lots no debe exponer cost a cajeros');

        const salesRes = await invokeExpressRouter(salesRouter, {
            method: 'GET',
            url: '/public-list',
            headers: { authorization: `Bearer ${token}` }
        });
        assert.equal(salesRes.statusCode, 200);
        assert.equal(capturedSaleWhere.userId, 'u-cashier-1', 'GET /sales/public-list debe aislar ventas por userId para cajeros');
        assert.equal(salesRes.body[0].SaleItems[0].cost, undefined, 'GET /sales/public-list no debe exponer cost en SaleItems');
    } finally {
        models.User.findByPk = origUserFindByPk;
        models.Product.findAll = origProductFindAll;
        models.ProductLot.findAll = origLotFindAll;
        models.Sale.findAll = origSaleFindAll;
        invalidateUserAuthCache(cashier.id);
    }
});

test('Fase 2.4 — AuthorizationService valida firma biométrica ECDSA P-256 v2 con reto one-time y rechaza replay y suplantación', async () => {
    const crypto = require('crypto');
    const AuthorizationService = require('../services/AuthorizationService');
    const { BIOMETRIC_V2_PREFIX, issueBiometricChallenge } = require('../utils/biometricChallengeStore');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    const origUserFindOne = models.User.findOne;
    const origApprovalCreate = models.SupervisorApproval.create;

    const supervisorUser = {
        id: 'sup-ecdsa-1',
        username: 'super1',
        name: 'Supervisor Uno',
        role: 'supervisor',
        status: 'active',
        companyId: 'comp-sec',
        biometricTokenHash: `${BIOMETRIC_V2_PREFIX}${spkiB64}`,
        failedLoginAttempts: 0,
        lockUntil: null,
        update: async (patch) => Object.assign(supervisorUser, patch)
    };

    models.User.findOne = async () => supervisorUser;
    models.SupervisorApproval.create = async (data) => ({ ...data });

    try {
        // 1. Reto válido firmado por el propio supervisor
        const issued = issueBiometricChallenge({ userId: supervisorUser.id, username: supervisorUser.username });
        const sig = crypto.sign('sha256', Buffer.from(issued.challenge, 'utf8'), privateKey).toString('base64');

        const approval = await AuthorizationService.authorizeAction(
            { id: supervisorUser.id, role: 'supervisor', username: 'super1', companyId: 'comp-sec' },
            {
                supervisorId: supervisorUser.id,
                isBiometric: true,
                challengeId: issued.challengeId,
                signature: sig,
                actionType: 'VOID_SALE',
                referenceId: 'sale-99'
            }
        );
        assert.equal(approval.approvedBy, supervisorUser.id);
        assert.equal(approval.metadata.authMethod, 'BIOMETRIC_HARDWARE_ECDSA_V2');

        // 2. Replay del mismo challengeId debe rechazarse
        await assert.rejects(
            () => AuthorizationService.authorizeAction(
                { id: supervisorUser.id, role: 'supervisor', username: 'super1', companyId: 'comp-sec' },
                {
                    supervisorId: supervisorUser.id,
                    isBiometric: true,
                    challengeId: issued.challengeId,
                    signature: sig,
                    actionType: 'VOID_SALE'
                }
            ),
            /expiró o ya fue utilizado/i
        );

        // 3. Un cajero nunca puede autorizar con biometría en nombre de un supervisor
        const issued2 = issueBiometricChallenge({ userId: supervisorUser.id });
        const sig2 = crypto.sign('sha256', Buffer.from(issued2.challenge, 'utf8'), privateKey).toString('base64');
        await assert.rejects(
            () => AuthorizationService.authorizeAction(
                { id: 'cajero-99', role: 'cashier', username: 'cajero99', companyId: 'comp-sec' },
                {
                    supervisorId: supervisorUser.id,
                    isBiometric: true,
                    challengeId: issued2.challengeId,
                    signature: sig2,
                    actionType: 'VOID_SALE'
                }
            ),
            /PIN secreto/i
        );
    } finally {
        models.User.findOne = origUserFindOne;
        models.SupervisorApproval.create = origApprovalCreate;
    }
});

test('Fase 2.5 — Anti-SSRF en settings/test-network-printer y desconexión inmediata de sockets en disconnectUserSockets', async () => {
    const settingsRouter = require('../routes/settings');
    const { disconnectUserSockets } = require('../services/SocketGateway');

    const adminUser = { id: 'u-admin', role: 'admin', companyId: 'comp-sec', permissions: { canManageSettings: true } };

    // Loopback bloqueado
    const loopbackRes = await invokeExpressRouter(settingsRouter, {
        method: 'POST',
        url: '/test-network-printer',
        user: adminUser,
        body: { ip: '127.0.0.1', port: 9100 }
    });
    assert.equal(loopbackRes.statusCode, 400, 'Debe bloquear loopback 127.0.0.1 en test-network-printer');

    // Link-local metadata AWS/GCP bloqueada
    const metaRes = await invokeExpressRouter(settingsRouter, {
        method: 'POST',
        url: '/test-network-printer',
        user: adminUser,
        body: { ip: '169.254.169.254', port: 9100 }
    });
    assert.equal(metaRes.statusCode, 400, 'Debe bloquear link-local 169.254.169.254');

    // Puerto no permitido (PostgreSQL 5432) bloqueado
    const portRes = await invokeExpressRouter(settingsRouter, {
        method: 'POST',
        url: '/test-network-printer',
        user: adminUser,
        body: { ip: '192.168.1.50', port: 5432 }
    });
    assert.equal(portRes.statusCode, 400, 'Debe bloquear puertos fuera de la allowlist de impresión (5432)');

    // disconnectUserSockets emite force_logout + session_revoked y cierra el socket
    const emitted = [];
    let disconnected = false;
    const mockIo = {
        to(room) {
            return {
                emit(ev, payload) { emitted.push({ room, ev, payload }); }
            };
        },
        in(room) {
            return {
                disconnectSockets(close) { if (room === 'user:u-revoked' && close) disconnected = true; }
            };
        }
    };
    disconnectUserSockets(mockIo, 'u-revoked', 'Cuenta desactivada');
    assert.equal(disconnected, true);
    assert.ok(emitted.some(e => e.room === 'user:u-revoked' && e.ev === 'force_logout'));
    assert.ok(emitted.some(e => e.room === 'user:u-revoked' && e.ev === 'session_revoked'));
});
