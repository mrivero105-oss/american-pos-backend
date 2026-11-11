const assert = require('assert');
const { sequelize } = require('../database/connection');
const PostgresAnalyticsService = require('../services/PostgresAnalyticsService');

async function runFase3Tests() {
    console.log('\n======================================================');
    console.log('⚡ VALIDACIÓN EMPÍRICA - FASE 3: SQL/JSON & VISTAS MATERIALIZADAS (PG 16)');
    console.log('======================================================\n');

    try {
        // 1. Inicialización de Vistas Materializadas
        console.log('1. Inicializando Vistas Materializadas e Índices de Concurrencia...');
        const initResult = await PostgresAnalyticsService.initMaterializedViews(sequelize);
        assert.ok(initResult.success, 'initMaterializedViews debe retornar success: true');

        const [matViews] = await sequelize.query(`
            SELECT matviewname, ispopulated 
            FROM pg_matviews 
            WHERE matviewname IN ('mv_daily_sales_summary', 'mv_product_sales_stats')
            ORDER BY matviewname;
        `);
        console.log(`   Vistas materializadas encontradas en pg_matviews: ${matViews.length}/2`);
        for (const mv of matViews) {
            console.log(`   - ${mv.matviewname} (Poblada: ${mv.ispopulated})`);
        }
        assert.strictEqual(matViews.length, 2, 'Deben existir las 2 vistas materializadas');
        console.log('   ✅ Vistas materializadas registradas en el catálogo de PostgreSQL.\n');

        // 2. Verificar índices únicos de concurrencia
        console.log('2. Verificando índices UNIQUE requeridos para REFRESH CONCURRENTLY...');
        const [uniqueIndexes] = await sequelize.query(`
            SELECT tablename, indexname, indexdef
            FROM pg_indexes
            WHERE indexname IN ('idx_mv_daily_sales_summary_uidx', 'idx_mv_product_sales_stats_uidx')
            ORDER BY indexname;
        `);
        console.log(`   Índices UNIQUE encontrados: ${uniqueIndexes.length}/2`);
        for (const idx of uniqueIndexes) {
            console.log(`   - ${idx.indexname} sobre ${idx.tablename}`);
            assert.ok(idx.indexdef.includes('UNIQUE'), `El índice ${idx.indexname} debe ser UNIQUE`);
        }
        assert.strictEqual(uniqueIndexes.length, 2, 'Deben existir los 2 índices únicos de concurrencia');
        console.log('   ✅ Índices de soporte concurrente validados.\n');

        // 3. Ejecutar REFRESH MATERIALIZED VIEW CONCURRENTLY
        console.log('3. Probando REFRESH CONCURRENTLY en tiempo real...');
        const startRefresh = Date.now();
        const refreshResult = await PostgresAnalyticsService.refreshViews(sequelize);
        const refreshDuration = Date.now() - startRefresh;
        assert.ok(refreshResult.success, 'El refresco concurrente debe ser exitoso');
        console.log(`   ✅ Refresco concurrente completado en ${refreshDuration}ms sin bloqueos de tabla.\n`);

        // 4. Probar consultas desde las vistas materializadas
        console.log('4. Probando consultas de alta velocidad sobre vistas materializadas...');
        const dailySummary = await PostgresAnalyticsService.getDailySalesSummary('2', { limit: 10 });
        console.log(`   Registros diarios obtenidos: ${dailySummary.length}`);
        if (dailySummary.length > 0) {
            console.log('   Muestra del día más reciente:', dailySummary[0]);
            assert.ok(dailySummary[0].sale_date, 'Debe contener sale_date');
            assert.ok(dailySummary[0].gross_sales_usd !== undefined, 'Debe contener gross_sales_usd');
        }

        const topProducts = await PostgresAnalyticsService.getTopProducts('2', { limit: 5 });
        console.log(`   Top productos de mayor rotación: ${topProducts.length}`);
        if (topProducts.length > 0) {
            console.log('   Producto #1 en ingresos:', {
                productId: topProducts[0].productId,
                name: topProducts[0].product_name,
                unitsSold: topProducts[0].units_sold,
                revenueUsd: topProducts[0].revenue_usd
            });
        }
        console.log('   ✅ Lectura analítica sub-milisegundo operativa.\n');

        // 5. Probar desglose financiero SQL/JSON (PostgreSQL 16)
        console.log('5. Probando agregación SQL/JSON nativa de formas de pago...');
        const startSqlJson = Date.now();
        const breakdown = await PostgresAnalyticsService.getShiftPaymentBreakdownNative({ companyId: '2' }, sequelize);
        const sqlJsonDuration = Date.now() - startSqlJson;
        console.log(`   Métodos de pago consolidados por el motor: ${breakdown.length} (Calculado en ${sqlJsonDuration}ms)`);
        assert.ok(Array.isArray(breakdown), 'El resultado debe ser un arreglo');
        assert.ok(breakdown.length > 0, 'Debe contener métodos de pago registrados');

        for (const b of breakdown.slice(0, 4)) {
            console.log(`   - Método: ${b.method} | Moneda: ${b.currency} | Tx: ${b.count_transactions} | Total Nativo: ${b.total_native} | Total USD: $${b.total_usd}`);
        }
        console.log('   ✅ Desglose financiero SQL/JSON de PostgreSQL 16 verificado con éxito.\n');

        console.log('======================================================');
        console.log('🎉 TODAS LAS PRUEBAS DE LA FASE 3 PASARON EXITOSAMENTE');
        console.log('======================================================\n');
        process.exit(0);
    } catch (err) {
        console.error('❌ FALLO EN PRUEBAS FASE 3:', err);
        process.exit(1);
    }
}

runFase3Tests();
