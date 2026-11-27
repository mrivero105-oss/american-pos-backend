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
const compression = require('compression');
const {
    createGeminiClient,
    getCandidateModels,
    withTimeout
} = require('../services/ai/geminiClientAdapter');
const { createCompressionOptions, shouldCompressResponse } = require('../utils/httpCompression');
const cacheSingleton = require('../utils/cacheService');
const telemetry = require('../utils/telemetryCollector');

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks)
            }));
        });
        req.on('error', reject);
    });
}

test('IA — getCandidateModels, withTimeout y generateContentStream', async (t) => {
    await t.test('1. getCandidateModels elimina duplicados, remapea modelos deprecados y prioriza gemini-3.5-flash-lite + gemini-4-hydrogen', () => {
        const textModels = getCandidateModels({ preferred: 'gemini-2.5-flash-lite' });
        assert.equal(textModels[0], 'gemini-3.5-flash-lite');
        assert.ok(textModels.includes('gemini-4-hydrogen'));
        assert.equal(new Set(textModels).size, textModels.length, 'No debe haber duplicados');
        assert.ok(!textModels.some((m) => /gemini-(?:1\.5|2\.0|2\.5)-/.test(m)), 'Nunca debe devolver modelos legacy/deprecados');

        const visionModels = getCandidateModels({ vision: true });
        assert.equal(visionModels[0], 'gemini-3.5-flash-lite');
        assert.ok(visionModels.includes('gemini-4-hydrogen'));
        assert.ok(!visionModels.some((m) => /gemini-(?:1\.5|2\.0|2\.5)-/.test(m)));
    });

    await t.test('2. withTimeout resuelve a tiempo y rechaza al vencer el límite', async () => {
        const okVal = await withTimeout(Promise.resolve('listo'), 500, 'TestOK');
        assert.equal(okVal, 'listo');

        await assert.rejects(
            () => withTimeout(new Promise((r) => setTimeout(() => r('tarde'), 200)), 25, 'TestTimeout'),
            /TestTimeout \(25ms\)/
        );
    });

    await t.test('3. generateContentStream entrega chunks progresivos con Interactions API (step.delta)', async () => {
        class FakeGenAI {
            constructor() {
                this.interactions = {
                    async create(params) {
                        if (params.stream) {
                            return (async function* () {
                                yield { event_type: 'step.delta', delta: { type: 'text', text: 'Hola ' } };
                                yield { event_type: 'step.delta', delta: { type: 'text', text: 'Isaac ' } };
                                yield { event_type: 'step.delta', delta: { type: 'text', text: 'POS' } };
                            })();
                        }
                        return { output_text: 'fallback' };
                    }
                };
            }
        }

        const client = createGeminiClient('test-key', { GoogleGenAIClass: FakeGenAI });
        const received = [];
        for await (const chunk of client.generateContentStream({ contents: 'ping' })) {
            received.push(chunk);
        }
        assert.deepEqual(received, ['Hola ', 'Isaac ', 'POS']);
    });
});

test('Servidor — compression selectiva, CacheService LRU real y TelemetryCollector RingBuffer O(1)', async (t) => {
    await t.test('1. shouldCompressResponse omite binarios/SSE y comprime JSON > 1KB', async () => {
        const app = express();
        app.use(compression(createCompressionOptions()));

        app.get('/big-json', (_req, res) => {
            res.json({ items: Array.from({ length: 80 }, (_, i) => ({ id: i, name: `Producto ${i}` })) });
        });
        app.get('/small-json', (_req, res) => {
            res.json({ ok: true });
        });
        app.get('/fake-webp', (_req, res) => {
            res.setHeader('Content-Type', 'image/webp');
            res.send(Buffer.alloc(4096, 0x41));
        });
        app.get('/fake-sse', (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${'x'.repeat(2048)}\n\n`);
            res.end();
        });

        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });

        try {
            const { port } = server.address();
            const base = `http://127.0.0.1:${port}`;
            const enc = { 'Accept-Encoding': 'gzip' };

            const big = await httpGet(`${base}/big-json`, enc);
            assert.equal(big.statusCode, 200);
            assert.equal(big.headers['content-encoding'], 'gzip', 'JSON > 1KB debe comprimirse');

            const small = await httpGet(`${base}/small-json`, enc);
            assert.equal(small.statusCode, 200);
            assert.equal(small.headers['content-encoding'], undefined, 'JSON < 1KB no debe comprimirse');

            const webp = await httpGet(`${base}/fake-webp`, enc);
            assert.equal(webp.statusCode, 200);
            assert.equal(webp.headers['content-encoding'], undefined, 'WebP no debe recomprimirse');

            const sse = await httpGet(`${base}/fake-sse`, enc);
            assert.equal(sse.statusCode, 200);
            assert.equal(sse.headers['content-encoding'], undefined, 'SSE no debe comprimirse');
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }

        // Verificación directa del filtro
        const fakeRes = (ct) => ({ getHeader: () => ct });
        assert.equal(shouldCompressResponse({ headers: { 'x-no-compression': '1' } }, fakeRes('application/json')), false);
        assert.equal(shouldCompressResponse({ headers: {} }, fakeRes('application/pdf')), false);
    });

    await t.test('2. CacheService promueve claves en get() (LRU real) y purga expiradas antes de evictar', () => {
        const lru = new cacheSingleton.CacheService(3);
        lru.set('catalogo', 'hot', 60);
        lru.set('k2', 'v2', 60);
        lru.set('k3', 'v3', 60);

        // Acceder a 'catalogo' lo promueve a MRU -> el LRU pasa a ser 'k2'
        assert.equal(lru.get('catalogo'), 'hot');

        // Insertar 'k4' debe evictar 'k2', conservando 'catalogo'
        lru.set('k4', 'v4', 60);
        assert.equal(lru.get('k2'), null);
        assert.equal(lru.get('catalogo'), 'hot');
        assert.equal(lru.get('k3'), 'v3');
        assert.equal(lru.get('k4'), 'v4');
        assert.equal(lru.getStats().evictions, 1);

        // Entradas expiradas se purgan antes de evictar claves vivas
        const lruExp = new cacheSingleton.CacheService(2);
        lruExp.set('exp', 'old', -1); // ya expirada
        lruExp.set('alive', 'ok', 60);
        lruExp.set('new', 'fresh', 60);
        assert.equal(lruExp.get('alive'), 'ok');
        assert.equal(lruExp.get('new'), 'fresh');
        assert.equal(lruExp.getStats().evictions, 0);
    });

    await t.test('3. TelemetryCollector mantiene ventana acotada con RingBuffer O(1)', () => {
        telemetry.reset();
        for (let i = 1; i <= 1500; i++) {
            telemetry.recordHttp('GET', '/products', 200, i % 100);
        }
        telemetry.recordDbQuery('SELECT * FROM "Products"', 350);

        const snap = telemetry.getSnapshot();
        assert.equal(snap.http.totalRequests, 1500);
        assert.equal(snap.http.latency.count, 1000, 'Ventana global acotada a 1000 muestras');
        assert.equal(snap.http.busiestRoutes[0].route, 'GET /products');
        assert.equal(snap.http.busiestRoutes[0].totalCalls, 1500);
        assert.equal(snap.database.totalSlowQueries, 1);
        assert.equal(snap.database.recentSlowQueries.length, 1);
        telemetry.reset();
    });
});
