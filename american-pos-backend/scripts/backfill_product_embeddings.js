/**
 * backfill_product_embeddings.js
 * Generación masiva y auto-regulada de vectores semánticos (pgvector 768d)
 * para el catálogo existente de productos en PostgreSQL 16 utilizando Gemini API.
 * 
 * Auto-regula a 20 productos cada 13s (~92 req/min) para operar 100% dentro
 * del Free Tier de Google AI (límite de 100 req/min) con cero caídas por 429.
 */

const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../database/connection');

const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const MODEL_NAME = 'models/gemini-embedding-001';
const BATCH_SIZE = 20;
const DELAY_BETWEEN_BATCHES_MS = 13000; // 13 segundos entre lotes de 20 = 92 items/min (dentro de los 100/min de cuota)

if (!API_KEY) {
    console.error('❌ Error: Ni GOOGLE_API_KEY ni GEMINI_API_KEY están definidas en .env');
    process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Llama al endpoint batchEmbedContents de Gemini vía HTTPS IPv4 nativo
 */
function requestBatchEmbeddings(texts) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            requests: texts.map(text => ({
                model: MODEL_NAME,
                content: { parts: [{ text: text.slice(0, 500) }] },
                outputDimensionality: 768
            }))
        });

        const url = new URL(`https://generativelanguage.googleapis.com/v1beta/${MODEL_NAME}:batchEmbedContents?key=${API_KEY}`);

        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            family: 4, // Obligatorio para estabilidad IPv4 en Windows
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 20000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(data);
                        resolve({ success: true, embeddings: json.embeddings || [] });
                    } catch (parseErr) {
                        reject(new Error(`JSON Parse Error: ${parseErr.message}`));
                    }
                } else {
                    let retrySeconds = 60;
                    try {
                        const errJson = JSON.parse(data);
                        const retryInfo = errJson.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
                        if (retryInfo?.retryDelay) {
                            const parsed = parseInt(retryInfo.retryDelay.replace('s', ''), 10);
                            if (parsed > 0) retrySeconds = parsed + 2;
                        }
                    } catch (_e) {}
                    resolve({ success: false, statusCode: res.statusCode, retrySeconds, rawError: data.slice(0, 200) });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout de 20s al contactar Gemini API'));
        });

        req.write(payload);
        req.end();
    });
}

async function main() {
    console.log('======================================================');
    console.log('🚀 INICIANDO BACKFILL DE EMBEDDINGS (pgvector 768d)');
    console.log('======================================================');

    // 1. Verificar estado actual
    const [stats] = await sequelize.query(`
        SELECT 
            count(*) as total, 
            count(embedding) as con_embedding, 
            count(*) - count(embedding) as pendientes 
        FROM "Products";
    `);
    
    console.log(`📊 Total en catálogo: ${stats[0].total}`);
    console.log(`✔ Ya vectorizados: ${stats[0].con_embedding}`);
    console.log(`⏳ Pendientes: ${stats[0].pendientes}`);

    if (parseInt(stats[0].pendientes, 10) === 0) {
        console.log('🎉 ¡Todos los productos ya cuentan con embeddings vectoriales generados!');
        await testSearch();
        process.exit(0);
    }

    // 2. Obtener productos pendientes
    const [pendingProducts] = await sequelize.query(`
        SELECT id, name, category, principio_activo, "stockUnit"
        FROM "Products"
        WHERE embedding IS NULL
          AND name IS NOT NULL
          AND trim(name) != ''
        ORDER BY id ASC;
    `);

    const total = pendingProducts.length;
    const totalBatches = Math.ceil(total / BATCH_SIZE);
    let processed = 0;
    let successful = 0;
    let failed = 0;

    const startTime = Date.now();
    console.log(`⚡ Procesando ${total} productos en ${totalBatches} lotes auto-regulados de ${BATCH_SIZE}...`);

    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const currentBatch = pendingProducts.slice(i, i + BATCH_SIZE);

        const texts = currentBatch.map(p => {
            const parts = [p.name.trim()];
            if (p.category) parts.push(`Categoría: ${p.category.trim()}`);
            if (p.principio_activo) parts.push(`Principio Activo: ${p.principio_activo.trim()}`);
            if (p.stockUnit) parts.push(`Unidad: ${p.stockUnit.trim()}`);
            return parts.join(' | ');
        });

        let success = false;
        while (!success) {
            try {
                const response = await requestBatchEmbeddings(texts);
                if (response.success && response.embeddings?.length === currentBatch.length) {
                    for (let j = 0; j < currentBatch.length; j++) {
                        const prod = currentBatch[j];
                        const embValues = response.embeddings[j]?.values;

                        if (embValues && embValues.length === 768) {
                            const vectorStr = `[${embValues.join(',')}]`;
                            await sequelize.query(`
                                UPDATE "Products"
                                SET embedding = :vectorStr::vector
                                WHERE id = :id;
                            `, {
                                replacements: { vectorStr, id: prod.id }
                            });
                            successful++;
                        } else {
                            failed++;
                        }
                    }
                    success = true;
                } else if (response.statusCode === 429) {
                    console.log(`⏸️  Límite de tasa temporal (429). Enfriando por ${response.retrySeconds}s para respetar ventana de Gemini...`);
                    await sleep(response.retrySeconds * 1000);
                } else {
                    console.warn(`⚠️ Error HTTP ${response.statusCode}: ${response.rawError}. Reintentando en 5s...`);
                    await sleep(5000);
                }
            } catch (netErr) {
                console.warn(`⚠️ Error de red (${netErr.message}). Reintentando lote ${batchNum} en 5s...`);
                await sleep(5000);
            }
        }

        processed += currentBatch.length;
        const percent = Math.round((processed / total) * 100);
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        console.log(`✔ Lote [${batchNum}/${totalBatches}] guardado exitosamente. Total: ${processed}/${total} (${percent}%) - Guardados: ${successful} (${elapsedSec}s)`);

        if (i + BATCH_SIZE < total) {
            await sleep(DELAY_BETWEEN_BATCHES_MS);
        }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('======================================================');
    console.log(`🎉 BACKFILL COMPLETADO EN ${totalTime}s`);
    console.log(`✔ Exitosos guardados en PostgreSQL 16: ${successful}`);
    console.log('======================================================');

    await testSearch();
    await sequelize.close();
    process.exit(0);
}

async function testSearch() {
    console.log('\n🔎 Probando búsqueda vectorial semántica en PostgreSQL 16...');
    const SemanticSearchService = require('../services/SemanticSearchService');
    const testQueries = ['analgésico para dolor de cabeza', 'desayuno o arepas', 'lácteos para merendar'];

    for (const q of testQueries) {
        const results = await SemanticSearchService.searchProducts(q, '2', 3);
        console.log(`\nConsulta: "${q}" -> Estrategia: ${results[0]?.matchType || 'N/A'}`);
        results.forEach((r, idx) => {
            console.log(`  ${idx + 1}. ${r.name} (Similitud Coseno: ${r.score}) [Categoría: ${r.category || 'N/A'}]`);
        });
    }
}

main().catch(err => {
    console.error('Fatal error en backfill:', err);
    process.exit(1);
});
