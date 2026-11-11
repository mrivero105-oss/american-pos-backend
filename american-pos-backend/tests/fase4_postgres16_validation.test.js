const assert = require('assert');
const SemanticSearchService = require('../services/SemanticSearchService');

async function runFase4Tests() {
    console.log('\n======================================================');
    console.log('🧠 VALIDACIÓN EMPÍRICA - FASE 4: BÚSQUEDA SEMÁNTICA HÍBRIDA');
    console.log('======================================================\n');

    try {
        // 1. Verificar estado de pgvector en PostgreSQL
        console.log('1. Verificando disponibilidad de pgvector en PostgreSQL 16...');
        const hasVector = await SemanticSearchService.checkVectorSupport();
        console.log(`   Soporte nativo pgvector en base de datos: ${hasVector ? 'ACTIVO (Modo Vectorial HNSW)' : 'PENDIENTE INSTALACIÓN DLL (Modo Trigramas Activo)'}`);

        // 2. Probar búsqueda híbrida con términos cotidianos de productos
        console.log('2. Probando motor de búsqueda híbrido con datos reales del catálogo...');
        const testQueries = ['huevo', 'harina', 'arroz', 'leche', 'aceite'];

        for (const q of testQueries) {
            const start = Date.now();
            const results = await SemanticSearchService.searchProducts(q, '2', 5);
            const duration = Date.now() - start;

            console.log(`   Búsqueda: "${q}" -> ${results.length} resultados en ${duration}ms (Estrategia: ${results[0]?.matchType || 'N/A'})`);
            if (results.length > 0) {
                console.log(`     Top match: ${results[0].name} (Score: ${results[0].score}, Stock: ${results[0].stockQuantity})`);
                assert.ok(results[0].name, 'El resultado debe contener el nombre del producto');
                assert.ok(typeof results[0].score === 'string' || typeof results[0].score === 'number', 'Debe contener score de similitud');
            }
        }

        // 3. Probar insensibilidad a acentos y mayúsculas/minúsculas
        console.log('3. Probando normalización (unaccent + case-insensitive)...');
        const resSinAcento = await SemanticSearchService.searchProducts('cafe', '2', 3);
        const resConAcento = await SemanticSearchService.searchProducts('café', '2', 3);
        console.log(`   Resultados para "cafe": ${resSinAcento.length} | para "café": ${resConAcento.length}`);
        assert.strictEqual(resSinAcento.length, resConAcento.length, 'Debe devolver la misma cantidad de resultados sin importar tildes');
        console.log('   ✅ Normalización fonética y de acentos comprobada.');

        console.log('\n======================================================');
        console.log('🎉 TODAS LAS PRUEBAS DE LA FASE 4 PASARON EXITOSAMENTE');
        console.log('======================================================\n');
        process.exit(0);
    } catch (err) {
        console.error('❌ FALLO EN PRUEBAS FASE 4:', err);
        process.exit(1);
    }
}

runFase4Tests();
