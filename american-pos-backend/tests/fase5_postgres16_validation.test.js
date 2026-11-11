const assert = require('assert');
const { sequelize } = require('../database/connection');
const autoMaintenance = require('../services/AutoMaintenanceService');

async function runFase5Tests() {
    console.log('\n======================================================');
    console.log('📦 VALIDACIÓN EMPÍRICA - FASE 5: PARTICIONAMIENTO DECLARATIVO (PG 16)');
    console.log('======================================================\n');

    try {
        // 1. Inicialización de Tablas y Particiones Declarativas
        console.log('1. Inicializando particiones declarativas de histórico...');
        const partResult = await autoMaintenance.ensurePartitionTables();
        assert.ok(partResult.success, 'ensurePartitionTables debe retornar success: true');

        // 2. Comprobar que están en el catálogo de tablas particionadas de PG 16
        console.log('2. Verificando pg_partitioned_table en catálogo...');
        const [partTables] = await sequelize.query(`
            SELECT relname, partstrat 
            FROM pg_partitioned_table pt
            JOIN pg_class c ON c.oid = pt.partrelid
            WHERE c.relname IN ('SalesHistory', 'SaleItemsHistory')
            ORDER BY c.relname;
        `);
        console.log(`   Tablas particionadas encontradas: ${partTables.length}/2`);
        for (const pt of partTables) {
            console.log(`   - ${pt.relname} (Estrategia: ${pt.partstrat === 'r' ? 'RANGE' : pt.partstrat})`);
            assert.strictEqual(pt.partstrat, 'r', `La estrategia de ${pt.relname} debe ser RANGE ('r')`);
        }
        assert.strictEqual(partTables.length, 2, 'Deben existir SalesHistory y SaleItemsHistory como particionadas');
        console.log('   ✅ Tablas declarativamente particionadas validadas en el motor.\n');

        // 3. Comprobar particiones físicas anuales vinculadas
        console.log('3. Verificando particiones físicas anuales vinculadas (pg_inherits)...');
        const [partitions] = await sequelize.query(`
            SELECT parent.relname AS parent_table, child.relname AS partition_name
            FROM pg_inherits
            JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
            JOIN pg_class child ON pg_inherits.inhrelid = child.oid
            WHERE parent.relname IN ('SalesHistory', 'SaleItemsHistory')
            ORDER BY parent.relname, child.relname;
        `);
        console.log(`   Particiones vinculadas encontradas: ${partitions.length}`);
        assert.ok(partitions.length >= 6, 'Deben existir al menos 6 particiones anuales vinculadas');
        partitions.forEach(p => console.log(`   - ${p.parent_table} -> ${p.partition_name}`));
        console.log('   ✅ Árbol de particiones verificado.\n');

        // 4. Probar enrutamiento automático de inserciones por fecha
        console.log('4. Probando enrutamiento automático de inserciones por rango de fechas...');
        const sale2024Id = 'test_p_2024_' + Date.now();
        const sale2025Id = 'test_p_2025_' + Date.now();
        const sale2026Id = 'test_p_2026_' + Date.now();

        await sequelize.query(`
            INSERT INTO "SalesHistory" ("id", "createdAt", "total", "companyId")
            VALUES 
                (:id24, '2024-05-10 10:00:00+00', 10.00, '2'),
                (:id25, '2025-08-15 15:00:00+00', 20.00, '2'),
                (:id26, '2026-02-20 18:00:00+00', 30.00, '2');
        `, { replacements: { id24: sale2024Id, id25: sale2025Id, id26: sale2026Id } });

        // Comprobar que cada registro cayó físicamente en su partición correspondiente
        const [r24] = await sequelize.query(`SELECT id, "createdAt" FROM "SalesHistory_2024" WHERE id = :id;`, { replacements: { id: sale2024Id } });
        const [r25] = await sequelize.query(`SELECT id, "createdAt" FROM "SalesHistory_2025" WHERE id = :id;`, { replacements: { id: sale2025Id } });
        const [r26] = await sequelize.query(`SELECT id, "createdAt" FROM "SalesHistory_2026" WHERE id = :id;`, { replacements: { id: sale2026Id } });

        assert.strictEqual(r24.length, 1, 'Venta 2024 debe estar en SalesHistory_2024');
        assert.strictEqual(r25.length, 1, 'Venta 2025 debe estar en SalesHistory_2025');
        assert.strictEqual(r26.length, 1, 'Venta 2026 debe estar en SalesHistory_2026');
        console.log('   - Venta 2024 enrutada a SalesHistory_2024.');
        console.log('   - Venta 2025 enrutada a SalesHistory_2025.');
        console.log('   - Venta 2026 enrutada a SalesHistory_2026.');
        console.log('   ✅ Enrutamiento automático por motor validado.\n');

        // 5. Probar Partition Pruning en tiempo de ejecución (PG 16)
        console.log('5. Validando Partition Pruning del optimizador de PostgreSQL 16...');
        const [plan] = await sequelize.query(`
            EXPLAIN (COSTS OFF)
            SELECT * FROM "SalesHistory"
            WHERE "createdAt" >= '2026-01-01' AND "createdAt" < '2026-12-31';
        `);
        const planText = plan.map(r => r['QUERY PLAN']).join('\n');
        console.log('   Plan generado:\n' + planText.split('\n').map(l => '     ' + l).join('\n'));

        assert.ok(planText.includes('SalesHistory_2026'), 'El plan debe escanear exclusivamente SalesHistory_2026');
        assert.ok(!planText.includes('SalesHistory_2024'), 'El plan NO debe tocar la partición 2024');
        assert.ok(!planText.includes('SalesHistory_2025'), 'El plan NO debe tocar la partición 2025');
        console.log('   ✅ Partition Pruning verificado: escaneo 100% aislado de particiones irrelevantes.\n');

        // 6. Limpieza de datos de prueba
        await sequelize.query(`DELETE FROM "SalesHistory" WHERE id IN (:id24, :id25, :id26);`, {
            replacements: { id24: sale2024Id, id25: sale2025Id, id26: sale2026Id }
        });

        console.log('======================================================');
        console.log('🎉 TODAS LAS PRUEBAS DE LA FASE 5 PASARON EXITOSAMENTE');
        console.log('======================================================\n');
        process.exit(0);
    } catch (err) {
        console.error('❌ FALLO EN PRUEBAS FASE 5:', err);
        process.exit(1);
    }
}

runFase5Tests();
