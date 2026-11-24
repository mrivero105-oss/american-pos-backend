import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';

const express = require('express');
const {
    isVersionedMediaFilename,
    createPublicMediaStaticOptions,
    createPrivateMediaStaticOptions
} = require('../utils/staticMediaCache');
const { sequelize } = require('../database/connection');
const schemaMigrator = require('../database/schemaMigrator');

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { headers }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks)
                });
            });
        });
        req.on('error', reject);
    });
}

test('staticMediaCache — clasificación de nombres versionados y cabeceras HTTP 200/304', async (t) => {
    await t.test('1. Identifica archivos versionados por timestamp/hash vs archivos heredados', () => {
        assert.equal(isVersionedMediaFilename('/product_images/product_1732365432123_456.jpg'), true);
        assert.equal(isVersionedMediaFilename('ai_product_abc-123_1732365432123.jpg'), true);
        assert.equal(isVersionedMediaFilename('supplier-1732365432123-987654321.png'), true);
        assert.equal(isVersionedMediaFilename('ad_1732365432123_x8k2m1.webp'), true);
        assert.equal(isVersionedMediaFilename('logo_2_a1b2c3d4e5.png'), true);

        assert.equal(isVersionedMediaFilename('company_logo.png'), false);
        assert.equal(isVersionedMediaFilename('promo-banner.jpg'), false);
        assert.equal(isVersionedMediaFilename(''), false);
    });

    await t.test('2. Sirve Cache-Control diferenciado, ETag y responde 304 con If-None-Match', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-media-cache-'));
        const publicDir = path.join(tmpDir, 'public');
        const privateDir = path.join(tmpDir, 'private');
        fs.mkdirSync(publicDir, { recursive: true });
        fs.mkdirSync(privateDir, { recursive: true });

        fs.writeFileSync(path.join(publicDir, 'product_1732365432123_42.jpg'), Buffer.from('fake-jpeg-data'));
        fs.writeFileSync(path.join(publicDir, 'legacy_logo.png'), Buffer.from('fake-png-data'));
        fs.writeFileSync(path.join(privateDir, 'factura_001.pdf'), Buffer.from('%PDF-1.4\n'));

        const app = express();
        app.use('/product_images', express.static(publicDir, createPublicMediaStaticOptions()));
        app.use('/invoices', express.static(privateDir, createPrivateMediaStaticOptions()));

        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });

        try {
            const { port } = server.address();
            const base = `http://127.0.0.1:${port}`;

            // Archivo versionado -> caché larga + stale-while-revalidate
            const res1 = await httpGet(`${base}/product_images/product_1732365432123_42.jpg`);
            assert.equal(res1.statusCode, 200);
            assert.equal(res1.headers['cache-control'], 'public, max-age=604800, stale-while-revalidate=86400');
            assert.ok(res1.headers.etag, 'Debe incluir ETag');
            assert.ok(res1.headers['last-modified'], 'Debe incluir Last-Modified');

            // Revalidación condicional -> 304 Not Modified sin reenviar bytes
            const res304 = await httpGet(`${base}/product_images/product_1732365432123_42.jpg`, {
                'If-None-Match': res1.headers.etag
            });
            assert.equal(res304.statusCode, 304);
            assert.equal(res304.body.length, 0);

            // Archivo heredado sin versión -> 1 hora + must-revalidate
            const resLegacy = await httpGet(`${base}/product_images/legacy_logo.png`);
            assert.equal(resLegacy.statusCode, 200);
            assert.equal(resLegacy.headers['cache-control'], 'public, max-age=3600, must-revalidate');
            assert.ok(resLegacy.headers.etag);

            // Factura privada -> private, no-cache, must-revalidate + soporta 304
            const resInv = await httpGet(`${base}/invoices/factura_001.pdf`);
            assert.equal(resInv.statusCode, 200);
            assert.equal(resInv.headers['cache-control'], 'private, no-cache, must-revalidate');
            assert.ok(resInv.headers.etag);

            const resInv304 = await httpGet(`${base}/invoices/factura_001.pdf`, {
                'If-None-Match': resInv.headers.etag
            });
            assert.equal(resInv304.statusCode, 304);
        } finally {
            await new Promise((resolve) => server.close(resolve));
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

test('PostgreSQL 16 — índices de rendimiento delta sync, categorías y covering BranchStocks', async (t) => {
    let dbAvailable = false;
    try {
        await sequelize.authenticate();
        dbAvailable = true;
    } catch {
        dbAvailable = false;
    }

    if (!dbAvailable) {
        t.skip('PostgreSQL aislado (americanpos_test) no está disponible en este entorno');
        return;
    }

    // Cargar modelos antes de ejecutar migración post-connect
    require('../database/models');

    await schemaMigrator.runPostConnectMigrations(sequelize, { force: true });

    const expectedIndexes = [
        'idx_products_company_updated',
        'idx_products_company_status_name',
        'idx_products_active_cat_lower',
        'idx_products_active_categories_list',
        'idx_branchstocks_company_updated',
        'idx_branchstocks_product_branch',
        'idx_variante_productos_producto_id',
        'idx_product_presentaciones_product_id'
    ];

    const rows = await sequelize.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (:expectedIndexes);
    `, {
        replacements: { expectedIndexes },
        type: sequelize.QueryTypes.SELECT
    });

    const foundNames = new Set(rows.map((r) => r.indexname));
    for (const idxName of expectedIndexes) {
        assert.ok(foundNames.has(idxName), `Falta el índice esperado en PostgreSQL 16: ${idxName}`);
    }

    const branchCover = rows.find((r) => r.indexname === 'idx_branchstocks_product_branch');
    assert.ok(
        branchCover && /INCLUDE\s*\(\s*quantity\s*\)/i.test(branchCover.indexdef),
        `idx_branchstocks_product_branch debe ser covering index con INCLUDE (quantity), obtenido: ${branchCover?.indexdef}`
    );

    // Verificar que la consulta optimizada raw:true de categorías funciona sin errores sobre PostgreSQL real
    const { Product } = require('../database/models');
    const { Op } = require('sequelize');
    const catRows = await Product.findAll({
        attributes: [[sequelize.fn('DISTINCT', sequelize.col('category')), 'category']],
        where: {
            companyId: 'default',
            status: 'active',
            isCustom: { [Op.or]: [false, null] }
        },
        raw: true
    });
    assert.ok(Array.isArray(catRows), 'La consulta raw:true de categorías debe devolver un arreglo plano');

    await sequelize.close();
});
