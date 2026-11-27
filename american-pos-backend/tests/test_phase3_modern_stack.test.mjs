import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';

const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { createGeminiClient } = require('../services/ai/geminiClientAdapter');
const PDFService = require('../services/PDFService');
const { createLicenseGatewayApp } = require('../../cloud_license_server/node-server/server');
const { LicenseStore } = require('../../cloud_license_server/node-server/licenseStore');

/**
 * Construye un archivo PDF 1.4 válido en memoria con líneas de texto reales
 * para probar extracción determinista con pdf-parse v2 sin dependencias externas.
 */
function buildMinimalPdf(lines = []) {
    const escaped = lines.map((line) => String(line).replace(/([()\\])/g, '\\$1'));
    const textOps = [
        'BT',
        '/F1 12 Tf',
        '50 750 Td',
        ...escaped.map((line, i) => (i === 0 ? `(${line}) Tj` : `0 -20 Td (${line}) Tj`)),
        'ET'
    ].join('\n');

    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
        `4 0 obj\n<< /Length ${Buffer.byteLength(textOps, 'utf8')} >>\nstream\n${textOps}\nendstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const obj of objects) {
        offsets.push(Buffer.byteLength(pdf, 'utf8'));
        pdf += obj;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i++) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'utf8');
}

test('Fase 3 — Stack Modern Node 24 (Express 5 + @google/genai 3 + pdf-parse 2)', async (t) => {
    await t.test('1. geminiClientAdapter usa Interactions API v1beta (store:false, PDF/imagen, JSON, step_list) y remapea modelos deprecados', async () => {
        const calls = { ctor: [], interactions: [] };

        class MockGoogleGenAI {
            constructor(opts) {
                calls.ctor.push(opts);
                this.interactions = {
                    create: async (params) => {
                        calls.interactions.push(params);
                        return { output_text: '{"ok":true,"source":"interactions-v1beta"}' };
                    }
                };
            }
        }

        const client = createGeminiClient('test-api-key-123', {
            GoogleGenAIClass: MockGoogleGenAI,
            defaultModel: 'gemini-2.5-flash-lite'
        });

        assert.equal(calls.ctor[0].apiVersion, 'v1beta');
        assert.equal(client.defaultModel, 'gemini-3.5-flash-lite');

        // Texto + PDF + JSON mode + systemInstruction + eliminación automática de temperature deprecado
        const genRes = await client.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                'Analiza la factura',
                { inlineData: { data: 'QUJD', mimeType: 'application/pdf' } }
            ],
            systemInstruction: 'Responde en JSON',
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
        });

        assert.equal(genRes.text, '{"ok":true,"source":"interactions-v1beta"}');
        assert.equal(genRes.response.text(), '{"ok":true,"source":"interactions-v1beta"}');
        assert.equal(calls.interactions.length, 1);
        assert.equal(calls.interactions[0].model, 'gemini-3.5-flash-lite');
        assert.equal(calls.interactions[0].store, false);
        assert.equal(calls.interactions[0].system_instruction, 'Responde en JSON');
        assert.deepEqual(calls.interactions[0].response_format, { type: 'text', mime_type: 'application/json' });
        assert.equal(calls.interactions[0].generation_config, undefined);
        assert.deepEqual(calls.interactions[0].input, [
            { type: 'text', text: 'Analiza la factura' },
            { type: 'document', data: 'QUJD', mime_type: 'application/pdf' }
        ]);

        // Chat multi-turno vía step_list + imagen
        const chat = client.createChat({
            model: 'gemini-3.5-flash-lite',
            systemInstruction: 'Asistente POS',
            history: [{ role: 'user', parts: [{ text: 'Hola' }] }],
            generationConfig: { maxOutputTokens: 512 }
        });
        const chatRes = await chat.sendMessage(['Dame el precio', { inlineData: { data: 'XYZ', mimeType: 'image/jpeg' } }]);
        assert.equal(chatRes.text, '{"ok":true,"source":"interactions-v1beta"}');
        assert.equal(calls.interactions.length, 2);
        assert.deepEqual(calls.interactions[1].input, [
            { type: 'user_input', content: [{ type: 'text', text: 'Hola' }] },
            {
                type: 'user_input',
                content: [
                    { type: 'text', text: 'Dame el precio' },
                    { type: 'image', data: 'XYZ', mime_type: 'image/jpeg' }
                ]
            }
        ]);
        assert.deepEqual(calls.interactions[1].generation_config, { max_output_tokens: 512 });

        // Compatibilidad getGenerativeModel
        const model = client.getGenerativeModel({ model: 'gemini-4-hydrogen' });
        const compatRes = await model.generateContent('Prompt simple');
        assert.equal(compatRes.response.text(), '{"ok":true,"source":"interactions-v1beta"}');
        assert.equal(calls.interactions[2].model, 'gemini-4-hydrogen');
    });

    await t.test('2. PDFService.parseCatalog extrae catálogo real usando pdf-parse@2.4.5 sin fallback IA', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pdf2-'));
        const pdfPath = path.join(tmpDir, 'catalogo_prueba.pdf');
        try {
            const pdfBuffer = buildMinimalPdf([
                'LISTA DE PRECIOS DISTRIBUIDORA USD',
                'HARINA PAN 1KG UND 1.45',
                'ARROZ MARY 1KG UND 1.30',
                'ACEITE MAZEITE 1L UND 3.80'
            ]);
            fs.writeFileSync(pdfPath, pdfBuffer);

            const parsed = await PDFService.parseCatalog(pdfPath);
            assert.equal(parsed.documentType, 'CATALOG');
            assert.equal(parsed.currency, 'USD');
            assert.ok(Array.isArray(parsed.items) && parsed.items.length >= 3, `Esperados >= 3 ítems, obtenidos ${parsed.items?.length}`);
            const names = parsed.items.map((it) => it.externalName.toUpperCase());
            assert.ok(names.some((n) => n.includes('HARINA PAN')));
            assert.ok(names.some((n) => n.includes('ARROZ MARY')));
            assert.ok(names.some((n) => n.includes('ACEITE MAZEITE')));
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    await t.test('3. Express 5: middleware validate.js muta req.query (getter read-only) y rutas /store{*splat} + 404 funcionan', async () => {
        const pkg = require('../package.json');
        assert.match(pkg.dependencies.express, /^\^?5\./, 'Backend debe usar Express 5');

        const app = express();
        app.use(express.json());

        const querySchema = z.object({
            query: z.object({
                page: z.coerce.number().int().positive().default(1),
                search: z.string().trim().optional()
            }).passthrough()
        });

        app.get('/test-query', validate(querySchema), (req, res) => {
            res.json({ page: req.query.page, pageType: typeof req.query.page, search: req.query.search });
        });

        app.get('/store{*splat}', (req, res) => {
            res.json({ matchedStore: true, path: req.path });
        });

        app.use((req, res) => {
            res.status(404).json({ error: 'Endpoint no encontrado', path: req.path });
        });

        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const base = `http://127.0.0.1:${port}`;

        try {
            const qRes = await fetch(`${base}/test-query?page=3&search=%20harina%20`);
            assert.equal(qRes.status, 200, 'validate(querySchema) no debe fallar con getter read-only en Express 5');
            const qData = await qRes.json();
            assert.equal(qData.page, 3);
            assert.equal(qData.pageType, 'number');
            assert.equal(qData.search, 'harina');

            const storeRoot = await fetch(`${base}/store`);
            assert.equal(storeRoot.status, 200);
            const storeNested = await fetch(`${base}/store/mi-bodega/producto-1`);
            assert.equal(storeNested.status, 200);

            const notFound = await fetch(`${base}/api/no-existe`);
            assert.equal(notFound.status, 404);
        } finally {
            await new Promise((resolve) => server.close(() => resolve()));
        }
    });

    await t.test('4. Cloud License Gateway arranca y responde correctamente bajo Express 5', async () => {
        const gwPkg = require('../../cloud_license_server/node-server/package.json');
        assert.match(gwPkg.dependencies.express, /^\^?5\./, 'Cloud License Gateway debe usar Express 5');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-gw-e5-'));
        const { privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        const store = new LicenseStore({ jsonPath: path.join(tmpDir, 'gw.json') });
        const { app } = await createLicenseGatewayApp({
            store,
            privateKeyPem: privateKey,
            adminEmail: 'admin@test.local',
            adminPassword: 'TestPassword123!',
            adminJwtSecret: crypto.randomBytes(32).toString('hex'),
            adminApiSecret: 'e5-secret-' + crypto.randomBytes(8).toString('hex')
        });

        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        try {
            const health = await fetch(`http://127.0.0.1:${port}/health`);
            assert.equal(health.status, 200);
            const json = await health.json();
            assert.equal(json.ok, true);
        } finally {
            await new Promise((resolve) => server.close(() => resolve()));
            await store.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
