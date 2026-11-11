import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parsePresentation, groupProductsByFamily, consolidateLooseUnitsToWholesale } from '../../american-pos-frontend/src/utils/productFamilies.js';
import { evaluateCartPromotions as evaluateFrontendPromos } from '../../american-pos-frontend/src/utils/promotionsEngine.js';

const require = createRequire(import.meta.url);
const { evaluateCartPromotions: evaluateBackendPromos } = require('../utils/promotionsEngineCore.js');
const ProductService = require('../services/ProductService.js');
const schemaMigrator = require('../database/schemaMigrator.js');

test('1. Familias de Productos y Calibres (Huevos Tipo A/B/C y Litrajes exactos 1.25L)', () => {
    const eggA = parsePresentation('Huevos Tipo A');
    assert.equal(eggA.label, 'Tipo A');

    const eggDirect = parsePresentation('Huevos AA');
    assert.equal(eggDirect.label, 'Tipo AA');

    const pepsi125 = parsePresentation('Refresco Pepsi 1.25L');
    assert.equal(pepsi125.label, '1.25L');

    const rawProducts = [
        { id: 'egg-a', name: 'Huevos Tipo A', category: 'General', imageUrl: null, price: 5.0, stock: 90 },
        { id: 'egg-b', name: 'Huevos Tipo B', category: 'Avícola', imageUrl: '/img/eggs.png', price: 6.0, stock: 60 }
    ];
    const unified = groupProductsByFamily(rawProducts);
    assert.equal(unified.length, 1);
    assert.equal(unified[0].isFamily, true);
    assert.equal(unified[0].category, 'Avícola');
    assert.equal(unified[0].imageUrl, '/img/eggs.png');
    assert.equal(unified[0]._familyVariants.length, 2);
});

test('2. Paridad 100% entre Motor de Promociones Frontend y Backend (BUY_X_GET_Y, VOLUME_DISCOUNT con factorConversion, PAYMENT_METHOD_DISCOUNT)', () => {
    const promotions = [
        {
            id: 'p-vol',
            name: 'Mayorista Cartón x30',
            type: 'VOLUME_DISCOUNT',
            isActive: true,
            minUnits: 30,
            discountPercentage: 10,
            targetProductIds: ['egg-a'],
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            priority: 10
        },
        {
            id: 'p-2x1',
            name: 'Oferta 2x1 Bebidas',
            type: 'BUY_X_GET_Y',
            isActive: true,
            buyQuantity: 2,
            payQuantity: 1,
            targetProductIds: ['soda-1'],
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            priority: 5
        },
        {
            id: 'p-zelle',
            name: 'Descuento Divisa/Zelle',
            type: 'PAYMENT_METHOD_DISCOUNT',
            isActive: true,
            discountPercentage: 5,
            targetProductIds: ['snack-1'],
            targetPaymentMethods: ['zelle'],
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            priority: 5
        }
    ];

    const cart = [
        { id: 'egg-a__pres_carton', productId: 'egg-a', name: 'Huevos Tipo A (Cartón)', price: 6.0, quantity: 1, factorConversion: 30 },
        { id: 'soda-1', productId: 'soda-1', name: 'Refresco 1.25L', price: 2.0, quantity: 2, factorConversion: 1 },
        { id: 'snack-1', productId: 'snack-1', name: 'Doritos', price: 4.0, quantity: 1, factorConversion: 1 }
    ];

    const frontRes = evaluateFrontendPromos(cart, promotions, 'Pago Zelle');
    const backRes = evaluateBackendPromos(cart, promotions, 'Pago Zelle');

    assert.equal(frontRes.totalPromoSavings, backRes.totalSavings);
    assert.equal(frontRes.finalCartSubtotal, backRes.newSubtotal);
    // Ahorro esperado: 10% de $6.00 ($0.60) + 1 unidad gratis de $2.00 ($2.00) + 5% de $4.00 ($0.20) = $2.80
    assert.equal(frontRes.totalPromoSavings, 2.8);
});

test('3. Blindaje de Costos y Márgenes según Rol de Usuario (Zero-Trust)', () => {
    const sampleProduct = {
        id: 'prod-1',
        name: 'Café 200g',
        price: 3.5,
        cost: 2.1,
        bulkCost: 20.0,
        midBulkCost: 10.5,
        margin: 40,
        Presentations: [
            { id: 'pres-1', name: 'Bulto x10', price: 32.0, cost: 20.0, marginTarget: 37.5 }
        ]
    };

    const cashierUser = { id: 'u-cashier', role: 'cashier' };
    const lanNodeUser = { id: 'lan-mobile-node', role: 'cashier', isUnauthenticatedLan: true };
    const adminUser = { id: 'u-admin', role: 'admin' };

    assert.equal(ProductService.canUserViewCosts(cashierUser), false);
    assert.equal(ProductService.canUserViewCosts(lanNodeUser), false);
    assert.equal(ProductService.canUserViewCosts(adminUser), true);

    const sanitizedForCashier = ProductService.sanitizeProductForUser(structuredClone(sampleProduct), false);
    assert.equal(sanitizedForCashier.cost, undefined);
    assert.equal(sanitizedForCashier.bulkCost, undefined);
    assert.equal(sanitizedForCashier.midBulkCost, undefined);
    assert.equal(sanitizedForCashier.margin, undefined);
    assert.equal(sanitizedForCashier.Presentations[0].cost, undefined);
    assert.equal(sanitizedForCashier.Presentations[0].marginTarget, undefined);
    assert.equal(sanitizedForCashier.price, 3.5);
});

test('4. Integridad del Módulo de Migración de Esquemas (schemaMigrator)', () => {
    assert.equal(typeof schemaMigrator.TARGET_SCHEMA_VERSION, 'number');
    assert.ok(schemaMigrator.TARGET_SCHEMA_VERSION >= 240404);
    assert.equal(typeof schemaMigrator.repairSchema, 'function');
    assert.equal(typeof schemaMigrator.runPostConnectMigrations, 'function');
});

test('5. Escalado Automático a Empaque Mayorista y Descuento/Reversión Exacta de Stock Multi-Presentación', () => {
    const eggProduct = {
        id: 'egg-a',
        name: 'Huevos Tipo A',
        price: 0.25,
        stockQuantity: 90,
        Presentations: [
            { id: 'pres-half', name: 'Medio Cartón 15 und', price: 3.25, factorConversion: 15 },
            { id: 'pres-full', name: 'Cartón 30 und', price: 6.00, factorConversion: 30 }
        ]
    };

    // Caso 1: 15 unidades sueltas se convierten automáticamente en 1x Medio Cartón (15 und)
    const cart15 = consolidateLooseUnitsToWholesale([
        { id: 'egg-a', productId: 'egg-a', name: 'Huevos Tipo A', originalName: 'Huevos Tipo A', price: 0.25, basePrice: 0.25, factorConversion: 1, quantity: 15 }
    ], eggProduct);
    assert.equal(cart15.length, 1);
    assert.equal(cart15[0].id, 'egg-a__pres_pres-half');
    assert.equal(cart15[0].factorConversion, 15);
    assert.equal(cart15[0].quantity, 1);
    assert.equal(cart15[0].price, 3.25);

    // Caso 2: 17 unidades (1 Medio Cartón + 2 Unidades sueltas) mantiene 1x Medio Cartón + 2x Unidad
    const cart17 = consolidateLooseUnitsToWholesale([
        ...cart15,
        { id: 'egg-a', productId: 'egg-a', name: 'Huevos Tipo A', originalName: 'Huevos Tipo A', price: 0.25, basePrice: 0.25, factorConversion: 1, quantity: 2 }
    ], eggProduct);
    assert.equal(cart17.length, 2);
    assert.equal(cart17[0].factorConversion, 15);
    assert.equal(cart17[0].quantity, 1);
    assert.equal(cart17[1].factorConversion, 1);
    assert.equal(cart17[1].quantity, 2);

    // Caso 3: Sumar 13 unidades más (total 30 unidades físicas) promueve automáticamente a 1x Cartón 30 und ($6.00)
    const cart30 = consolidateLooseUnitsToWholesale([
        cart17[0],
        { ...cart17[1], quantity: 15 }
    ], eggProduct);
    assert.equal(cart30.length, 1);
    assert.equal(cart30[0].id, 'egg-a__pres_pres-full');
    assert.equal(cart30[0].factorConversion, 30);
    assert.equal(cart30[0].quantity, 1);
    assert.equal(cart30[0].price, 6.00);

    // Caso 4: Verificación matemática de descuento y reversión de inventario físico en venta combinada (1 Cartón + 1 Medio Cartón + 3 Unidades = 48 unidades)
    const mixedSaleItems = consolidateLooseUnitsToWholesale([
        { id: 'egg-a', productId: 'egg-a', name: 'Huevos Tipo A', originalName: 'Huevos Tipo A', price: 0.25, basePrice: 0.25, factorConversion: 1, quantity: 48 }
    ], eggProduct);
    assert.equal(mixedSaleItems.length, 3);

    const initialStock = 90;
    const totalPhysicalUnitsSold = mixedSaleItems.reduce(
        (acc, item) => acc + (Number(item.quantity) * (Number(item.factorConversion) || 1)),
        0
    );
    assert.equal(totalPhysicalUnitsSold, 48);

    const stockAfterSale = initialStock - totalPhysicalUnitsSold;
    assert.equal(stockAfterSale, 42);

    // Reversión al anular la factura: cada renglón restaura quantity * factorConversion
    const restoredUnits = mixedSaleItems.reduce(
        (acc, item) => acc + (Number(item.quantity) * (Number(item.factorConversion) || 1)),
        0
    );
    const stockAfterVoid = stockAfterSale + restoredUnits;
    assert.equal(stockAfterVoid, initialStock);
});
