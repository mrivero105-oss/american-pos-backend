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
        assert.ok(triggeredAlerts.some(a => a.type === 'OFFLINE_PRICE_DRIFT'), 'Debe disparar Alert OFFLINE_PRICE_DRIFT');
        assert.ok(triggeredAlerts.some(a => a.type === 'OFFLINE_RATE_DRIFT'), 'Debe disparar Alert OFFLINE_RATE_DRIFT');
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
