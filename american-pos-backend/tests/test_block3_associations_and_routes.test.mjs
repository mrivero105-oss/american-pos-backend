import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const models = require('../database/models');
const ReportService = require('../services/ReportService');
const StockIntelligenceService = require('../services/StockIntelligenceService');
const ProductService = require('../services/ProductService');
const BatchTraceabilityService = require('../services/BatchTraceabilityService');
const ProductionService = require('../services/ProductionService');

test('3A. ProductService.getWasteHistory usa alias as: Product y no solicita columna inexistente sku', async () => {
    const origFindAndCountAll = models.StockMovement.findAndCountAll;
    let capturedOptions = null;

    models.StockMovement.findAndCountAll = async (options) => {
        capturedOptions = options;
        return { count: 1, rows: [{ quantity: 3, totalCost: 15, category: 'caducidad' }] };
    };

    try {
        const res = await ProductService.getWasteHistory({ companyId: 'comp-1' }, { page: 1, limit: 10 });
        assert.ok(capturedOptions, 'Debe invocar StockMovement.findAndCountAll');
        const prodInclude = capturedOptions.include?.[0];
        assert.equal(prodInclude?.as, 'Product', 'El include de Product en StockMovement debe tener as: "Product"');
        assert.equal(
            prodInclude?.attributes?.includes('sku'),
            false,
            'No debe solicitar la columna inexistente "sku" en Product'
        );
        assert.equal(res.summary.totalUnits, 3);
        assert.equal(res.summary.totalCostUSD, 15);
    } finally {
        models.StockMovement.findAndCountAll = origFindAndCountAll;
    }
});

test('3B. StockIntelligenceService.getPredictions incluye Sale sin alias inválido y excluye ventas refunded', async () => {
    const origSaleItemFindAll = models.SaleItem.findAll;
    const origProductFindAll = models.Product.findAll;
    let capturedInclude = null;

    models.SaleItem.findAll = async (options) => {
        capturedInclude = options.include?.[0];
        return [{ productId: 'p1', totalSold: 10, activeDays: 5 }];
    };
    models.Product.findAll = async () => [
        { id: 'p1', name: 'Harina PAN', stockQuantity: 8, stock: 8, minStock: 5 }
    ];

    try {
        const predictions = await StockIntelligenceService.getStockPredictions('comp-1', 30);
        assert.ok(capturedInclude, 'Debe incluir el modelo Sale');
        assert.equal(capturedInclude.as, undefined, 'SaleItem.belongsTo(Sale) no usa alias as: "Sale"');
        const allowedStatuses = Object.values(capturedInclude.where.status)[0] || [];
        assert.equal(
            allowedStatuses.includes('refunded'),
            false,
            'Las ventas totalmente reembolsadas (refunded) no deben inflar la velocidad de venta'
        );
        assert.equal(predictions.length, 1);
        assert.equal(predictions[0].daysRemaining, 24);
    } finally {
        models.SaleItem.findAll = origSaleItemFindAll;
        models.Product.findAll = origProductFindAll;
    }
});

test('3C. BatchTraceabilityService.createPromoFromLot activa la promoción (isActive: true)', async () => {
    const origLotFindOne = models.ProductLot.findOne;
    const origPromoCreate = models.Promotion.create;
    let createdPromoPayload = null;

    models.ProductLot.findOne = async () => ({
        id: 'lot-1',
        lotNumber: 'L-2026',
        productId: 'prod-1',
        expirationDate: '2026-12-01',
        Product: { id: 'prod-1', name: 'Yogurt Griego' }
    });
    models.Promotion.create = async (payload) => {
        createdPromoPayload = payload;
        return payload;
    };

    try {
        const res = await BatchTraceabilityService.createPromoFromLot('lot-1', {
            companyId: 'comp-1',
            discountPercentage: 25,
            promoDays: 10
        });
        assert.equal(res.success, true);
        assert.equal(createdPromoPayload.isActive, true, 'La promoción FEFO debe crearse con isActive: true');
        assert.equal(createdPromoPayload.discountPercentage, 25);
    } finally {
        models.ProductLot.findOne = origLotFindOne;
        models.Promotion.create = origPromoCreate;
    }
});

test('3D. ProductionService.processKitSaleDeduction bloquea fila y sincroniza stock y stockQuantity', async () => {
    const origBomFindOne = models.BillOfMaterials.findOne;
    const origProductFindByPk = models.Product.findByPk;
    const origMovementCreate = models.StockMovement.create;

    let capturedFindOptions = null;
    let updatedFields = null;

    models.BillOfMaterials.findOne = async () => ({
        id: 'bom-1',
        recipeName: 'Combo Desayuno',
        yieldQuantity: 1,
        Items: [{ componentProductId: 'comp-prod-1', quantityRequired: 2 }]
    });

    models.Product.findByPk = async (id, options) => {
        capturedFindOptions = options;
        return {
            id,
            stockQuantity: 10,
            stock: 10,
            update: async (fields) => {
                updatedFields = fields;
            }
        };
    };

    models.StockMovement.create = async () => ({});

    try {
        const fakeTx = { LOCK: { UPDATE: 'UPDATE' } };
        const ok = await ProductionService.processKitSaleDeduction(
            { id: 'si-1', productId: 'kit-1', quantity: 3 },
            fakeTx,
            'comp-1'
        );
        assert.equal(ok, true);
        assert.equal(capturedFindOptions?.lock, 'UPDATE', 'Debe bloquear el componente con LOCK.UPDATE');
        assert.equal(updatedFields?.stockQuantity, 4, 'Debe descontar 3 * 2 = 6 unidades de stockQuantity');
        assert.equal(updatedFields?.stock, 4, 'Debe mantener sincronizado el campo stock con stockQuantity');
    } finally {
        models.BillOfMaterials.findOne = origBomFindOne;
        models.Product.findByPk = origProductFindByPk;
        models.StockMovement.create = origMovementCreate;
    }
});

test('3E. ReportService no usa alias inválido as: Sale en consultas de SaleItem', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const reportServiceSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'services/ReportService.js'),
        'utf8'
    );
    assert.equal(
        reportServiceSrc.includes("model: Sale, as: 'Sale'"),
        false,
        'ReportService.js no debe incluir { model: Sale, as: "Sale" } que rompe Sequelize'
    );
});
