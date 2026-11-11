const assert = require('assert');
const { sequelize } = require('../database/connection');
const autoMaintenance = require('../services/AutoMaintenanceService');
const SyncOutbox = require('../database/models/SyncOutbox');

async function runFase1Tests() {
    console.log('\n======================================================');
    console.log('🧪 VALIDACIÓN EMPÍRICA - FASE 1: POSTGRESQL 16');
    console.log('======================================================\n');

    try {
        // 1. Verificar versión del motor
        console.log('1. Verificando versión de PostgreSQL...');
        const [verRes] = await sequelize.query('SELECT version();');
        const verStr = verRes[0].version;
        console.log(`   Versión detectada: ${verStr}`);
        assert.ok(verStr.includes('PostgreSQL 16'), 'El motor debe ser PostgreSQL 16');
        console.log('   ✅ Motor validado como PostgreSQL 16 nativo.\n');

        // 2. Verificar índices BRIN
        console.log('2. Verificando índices BRIN para series temporales...');
        await autoMaintenance.ensureIndexes();

        const [brinIdx] = await sequelize.query(`
            SELECT c.relname AS indexname, am.amname AS access_method
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_am am ON am.oid = c.relam
            WHERE c.relname IN (
                'idx_brin_audit_logs_created',
                'idx_brin_stock_movements_created',
                'idx_brin_cash_movements_created'
            )
            ORDER BY c.relname;
        `);

        console.log(`   Índices BRIN encontrados: ${brinIdx.length}/3`);
        for (const idx of brinIdx) {
            console.log(`   - ${idx.indexname} (método: ${idx.access_method})`);
            assert.strictEqual(idx.access_method, 'brin', `El índice ${idx.indexname} debe usar método brin`);
        }
        assert.strictEqual(brinIdx.length, 3, 'Deben existir los 3 índices BRIN');
        console.log('   ✅ Índices BRIN verificados e hiper-compactos.\n');

        // 3. Verificar telemetría pg_stat_io
        console.log('3. Verificando telemetría de I/O (pg_stat_io)...');
        const ioStats = await autoMaintenance.getPostgresIoStats();
        assert.ok(ioStats.available, 'pg_stat_io debe estar disponible');
        console.log(`   Ratio de aciertos en memoria (ioHitRatio): ${ioStats.ioHitRatio}%`);
        console.log(`   Total buffer hits (RAM): ${ioStats.summary.totalBufferHits}`);
        console.log(`   Total lecturas físicas (Disco): ${ioStats.summary.totalDiskReads}`);
        console.log(`   Total escrituras físicas (Disco): ${ioStats.summary.totalDiskWrites}`);
        assert.ok(typeof ioStats.ioHitRatio === 'number', 'ioHitRatio debe ser numérico');
        console.log('   ✅ Telemetría pg_stat_io operativa.\n');

        // 4. Verificar métricas globales
        console.log('4. Verificando getDatabaseMetrics()...');
        const metrics = await autoMaintenance.getDatabaseMetrics();
        assert.ok(metrics.ioStats && metrics.ioStats.available, 'Las métricas deben incluir ioStats');
        console.log(`   Tamaño de la BD: ${metrics.databaseSize}`);
        console.log(`   Columnas JSONB: ${metrics.jsonbColumns}`);
        console.log('   ✅ getDatabaseMetrics() incluye telemetría de I/O completa.\n');

        // 5. Verificar SKIP LOCKED en SyncOutbox
        console.log('5. Verificando comportamiento de SKIP LOCKED en SyncOutbox...');
        const testEntityId = 'test_fase1_' + Date.now();
        const testEvent = await SyncOutbox.create({
            entity_name: 'test_phase1',
            entity_id: testEntityId,
            operation: 'INSERT',
            payload: { test: true, timestamp: Date.now() },
            status: 'PENDING'
        });
        assert.ok(testEvent.id, 'El evento de prueba debe crearse en sync_outbox');

        // Simular Worker 1 adquiriendo el lock con FOR UPDATE SKIP LOCKED
        const tx1 = await sequelize.transaction();
        const [lockedRows] = await sequelize.query(`
            SELECT id, entity_name, entity_id, status
            FROM sync_outbox
            WHERE id = :id AND status = 'PENDING'
            FOR UPDATE SKIP LOCKED;
        `, {
            replacements: { id: testEvent.id },
            transaction: tx1
        });

        assert.strictEqual(lockedRows.length, 1, 'Worker 1 debe adquirir la fila');
        assert.strictEqual(lockedRows[0].id, testEvent.id);

        // Simular Worker 2 concurrente intentando adquirir el mismo evento con SKIP LOCKED
        const tx2 = await sequelize.transaction();
        const [worker2Rows] = await sequelize.query(`
            SELECT id, entity_name, entity_id, status
            FROM sync_outbox
            WHERE id = :id AND status = 'PENDING'
            FOR UPDATE SKIP LOCKED;
        `, {
            replacements: { id: testEvent.id },
            transaction: tx2
        });

        assert.strictEqual(worker2Rows.length, 0, 'Worker 2 NO debe ver ni bloquear la fila porque Worker 1 la tiene reservada');
        console.log('   Worker 2 respetó SKIP LOCKED y saltó la fila sin bloquearse (0 colisiones).');

        // Completar Worker 1 y limpiar
        await sequelize.query(`
            UPDATE sync_outbox
            SET status = 'SYNCED', synced_at = NOW()
            WHERE id = :id;
        `, {
            replacements: { id: testEvent.id },
            transaction: tx1
        });
        await tx1.commit();
        await tx2.commit();

        // Borrar registro de prueba
        await SyncOutbox.destroy({ where: { id: testEvent.id } });
        console.log('   ✅ Concurrencia con SKIP LOCKED validada con éxito.\n');

        console.log('======================================================');
        console.log('🎉 TODAS LAS PRUEBAS DE LA FASE 1 PASARON EXITOSAMENTE');
        console.log('======================================================\n');
        process.exit(0);
    } catch (err) {
        console.error('❌ FALLO EN PRUEBAS FASE 1:', err);
        process.exit(1);
    }
}

runFase1Tests();
