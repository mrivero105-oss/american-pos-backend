import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const VortexMathEngine = require('../utils/VortexMathEngine');
const { evaluateCartPromotions } = require('../utils/promotionsEngineCore');
const ScaleService = require('../services/ScaleService');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const AutoMaintenanceService = require('../services/AutoMaintenanceService');
const { sequelize } = require('../database/connection');
const axios = require('axios');

test('4A. VortexMathEngine redondea half-up en multiply/divide y promotionsEngineCore evita falso positivo por prefijo en COMBO', () => {
    // 20 / 3 = 6.66666667 (con truncamiento daba 6.66666666)
    assert.equal(VortexMathEngine.divide(20, 3), 6.66666667);
    assert.equal(VortexMathEngine.multiply(1.00005, 1.00005), 1.0001);

    // Promoción COMBO que requiere productos "1" y "2"
    const comboPromo = {
        id: 'promo-combo-1',
        name: 'Combo Exacto',
        type: 'COMBO',
        isActive: true,
        discountPercentage: 20,
        targetProductIds: ['1', '2']
    };

    // Carrito con producto "10" y "2" NO debe activar el combo de "1" y "2"
    const cartFalsePositive = [
        { id: '10', productId: '10', name: 'Prod 10', price: 10, quantity: 1 },
        { id: '2', productId: '2', name: 'Prod 2', price: 10, quantity: 1 }
    ];
    const resFalse = evaluateCartPromotions(cartFalsePositive, [comboPromo]);
    assert.equal(resFalse.totalPromoSavings, 0, 'Producto "10" no debe hacer match con reqId "1"');

    // Carrito con producto "1" y "2" SÍ debe activar el combo
    const cartValid = [
        { id: '1', productId: '1', name: 'Prod 1', price: 10, quantity: 1 },
        { id: '2', productId: '2', name: 'Prod 2', price: 10, quantity: 1 }
    ];
    const resValid = evaluateCartPromotions(cartValid, [comboPromo]);
    assert.equal(resValid.totalPromoSavings, 4);
});

test('4B. ScaleService.parseScaleFrame no invierte el signo por guiones en el encabezado de la trama', () => {
    const framePositiveWithHyphenHeader = 'ST-GS,+ 1.250kg';
    const parsedPos = ScaleService.parseScaleFrame(framePositiveWithHyphenHeader);
    assert.equal(parsedPos.success, true);
    assert.equal(parsedPos.weight, 1.25);

    const frameNegative = 'ST,GS,- 0.450kg';
    const parsedNeg = ScaleService.parseScaleFrame(frameNegative);
    assert.equal(parsedNeg.success, true);
    assert.equal(parsedNeg.weight, -0.45);
});

test('4C. SupabaseSyncService prioriza stockQuantity y aísla fallos por fila cuando falla un lote', async () => {
    let queuedPayload = null;
    const origQueueEvent = SupabaseSyncService.queueEvent;
    SupabaseSyncService.queueEvent = async (_entity, _id, _op, payload) => {
        queuedPayload = payload;
    };

    try {
        await SupabaseSyncService.queueProduct({
            id: 'prod-99',
            name: 'Arroz Premium',
            price: 1.5,
            stock: 0,
            stockQuantity: 42
        });
        assert.equal(queuedPayload.stock_actual, 42, 'Debe priorizar stockQuantity sobre stock');
    } finally {
        SupabaseSyncService.queueEvent = origQueueEvent;
    }

    // Probar aislamiento de fallo en processBatch
    const origServiceKey = SupabaseSyncService.serviceKey;
    const origSupabaseUrl = SupabaseSyncService.supabaseUrl;
    const origTransaction = sequelize.transaction;
    const origQuery = sequelize.query;
    const origAxiosPost = axios.post;

    SupabaseSyncService.serviceKey = 'test-key';
    SupabaseSyncService.supabaseUrl = 'https://example.supabase.co';
    SupabaseSyncService.isSyncing = false;

    const statusUpdates = [];
    sequelize.transaction = async () => ({
        commit: async () => {},
        rollback: async () => {}
    });

    sequelize.query = async (sql, options) => {
        if (sql.includes('SELECT id, entity_name')) {
            assert.ok(
                sql.includes("status = 'PROCESSING'"),
                'La consulta debe rescatar registros estancados en PROCESSING'
            );
            return [[
                { id: 'row-ok', entity_name: 'products', payload: { id: 'p-ok', nombre: 'Bueno' }, retry_count: 0 },
                { id: 'row-bad', entity_name: 'products', payload: { id: 'p-bad', nombre: 'Malo' }, retry_count: 4 }
            ]];
        }
        if (sql.includes("SET status = 'SYNCED'") && options?.replacements?.itemId) {
            statusUpdates.push({ id: options.replacements.itemId, status: 'SYNCED' });
        }
        if (sql.includes('SET status = :newStatus')) {
            statusUpdates.push({
                id: options.replacements.itemId,
                status: options.replacements.newStatus,
                retry: options.replacements.newRetry
            });
        }
        return [[], { rowCount: 1 }];
    };

    axios.post = async (_url, body) => {
        if (Array.isArray(body) && body.length > 1) {
            throw new Error('Batch failure due to 1 bad row');
        }
        if (body[0]?.id === 'p-bad') {
            throw new Error('Invalid row constraint');
        }
        return { status: 201, data: {} };
    };

    try {
        const res = await SupabaseSyncService.processBatch(10);
        assert.equal(res.success, true);
        const okUpdate = statusUpdates.find(u => u.id === 'row-ok');
        const badUpdate = statusUpdates.find(u => u.id === 'row-bad');
        assert.equal(okUpdate?.status, 'SYNCED', 'La fila válida debe sincronizarse en el fallback individual');
        assert.equal(badUpdate?.status, 'FAILED', 'La fila con 5 fallos debe pasar a FAILED sin bloquear a las demás');
    } finally {
        SupabaseSyncService.serviceKey = origServiceKey;
        SupabaseSyncService.supabaseUrl = origSupabaseUrl;
        sequelize.transaction = origTransaction;
        sequelize.query = origQuery;
        axios.post = origAxiosPost;
    }
});

test('4D. AutoMaintenanceService lee rowCount desde metadata de sequelize.query y purga ventas archivadas', async () => {
    const origTransaction = sequelize.transaction;
    const origQuery = sequelize.query;
    let deleteExecuted = false;

    sequelize.transaction = async () => ({
        commit: async () => {},
        rollback: async () => {}
    });

    sequelize.query = async (sql) => {
        if (sql.includes('INSERT INTO "SalesHistory"')) {
            return [[], { rowCount: 7 }];
        }
        if (sql.includes('INSERT INTO "SaleItemsHistory"')) {
            return [[], { rowCount: 19 }];
        }
        if (sql.includes('DELETE FROM "Sales"')) {
            deleteExecuted = true;
            return [[], { rowCount: 7 }];
        }
        if (sql.includes('DELETE FROM "AuditLogs"')) {
            return [[], { rowCount: 12 }];
        }
        return [[], { rowCount: 0 }];
    };

    try {
        const archiveRes = await AutoMaintenanceService.archiveHistoricalData(180);
        assert.equal(archiveRes.archivedSales, 7);
        assert.equal(archiveRes.archivedItems, 19);
        assert.equal(deleteExecuted, true, 'Debe ejecutar DELETE FROM "Sales" cuando metadata.rowCount > 0');

        const purgeRes = await AutoMaintenanceService.purgeAuditLogs(90);
        assert.equal(purgeRes.purgedLogs, 12);
    } finally {
        sequelize.transaction = origTransaction;
        sequelize.query = origQuery;
    }
});

test('4E. Verificación estática de resiliencia en frontend (db.js, localDb.js, usePOSData.js) y backup atómico (.tmp)', () => {
    const frontendDbSrc = fs.readFileSync(
        path.resolve(process.cwd(), '../american-pos-frontend/src/services/db.js'),
        'utf8'
    );
    assert.ok(
        frontendDbSrc.includes('get: async (storeName, id) => db.getById(storeName, id)'),
        'db.js debe exponer el alias db.get delegando a db.getById'
    );

    const localDbSrc = fs.readFileSync(
        path.resolve(process.cwd(), '../american-pos-frontend/src/db/localDb.js'),
        'utf8'
    );
    assert.ok(
        localDbSrc.includes('unifiedDb.replaceAllAtomic(snap.storeName, snap.items)'),
        'localDb.transaction debe restaurar snapshots atómicamente en caso de error (rollback)'
    );

    const usePosDataSrc = fs.readFileSync(
        path.resolve(process.cwd(), '../american-pos-frontend/src/hooks/usePOSData.js'),
        'utf8'
    );
    assert.ok(
        usePosDataSrc.includes("await db.replaceAllAtomic('products', sortedServer)"),
        'usePOSData debe sincronizar productos con replaceAllAtomic'
    );

    const backupHelperSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'utils/sqliteBackupHelper.js'),
        'utf8'
    );
    assert.ok(
        backupHelperSrc.includes('fs.renameSync(tmpBackupPath, backupPath)'),
        'sqliteBackupHelper debe usar archivo temporal .tmp y renameSync atómico'
    );
});
