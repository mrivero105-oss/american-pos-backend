const assert = require('assert');
const { sequelize } = require('../database/connection');
const { initializeDatabaseSecurity, withTenantTransaction, setTenantContext } = require('../database/tenantContext');
const { Product, AuditLog } = require('../database/models');

async function runFase2Tests() {
    console.log('\n======================================================');
    console.log('🛡️ VALIDACIÓN EMPÍRICA - FASE 2: AUDITORÍA & RLS EN PG 16');
    console.log('======================================================\n');

    try {
        // 1. Inicializar seguridad de la base de datos
        console.log('1. Inicializando seguridad, RLS y triggers de auditoría...');
        const initResult = await initializeDatabaseSecurity(sequelize);
        assert.ok(initResult.success, 'La inicialización de seguridad debe tener éxito');
        console.log('   ✅ Seguridad e infraestructura RLS inicializada.\n');

        // 2. Verificar rol isaac_app
        console.log('2. Verificando rol de aplicación isaac_app (NOBYPASSRLS)...');
        const [roleCheck] = await sequelize.query("SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'isaac_app';");
        assert.strictEqual(roleCheck.length, 1, 'El rol isaac_app debe existir');
        assert.strictEqual(roleCheck[0].rolsuper, false, 'isaac_app no debe ser superusuario');
        assert.strictEqual(roleCheck[0].rolbypassrls, false, 'isaac_app no debe tener BYPASSRLS');
        console.log('   ✅ Rol isaac_app verificado con permisos de menor privilegio.\n');

        // 3. Verificar políticas RLS activas en catálogo
        console.log('3. Verificando políticas RLS en pg_policy...');
        const [policies] = await sequelize.query(`
            SELECT schemaname, tablename, policyname, permissive, cmd
            FROM pg_policies
            WHERE policyname LIKE 'rls_tenant_isolation_%'
            ORDER BY tablename;
        `);
        console.log(`   Políticas RLS encontradas: ${policies.length}`);
        for (const pol of policies) {
            console.log(`   - Tabla: ${pol.tablename} | Política: ${pol.policyname} (${pol.cmd})`);
        }
        assert.ok(policies.length >= 4, 'Deben existir al menos 4 políticas RLS activas');
        console.log('   ✅ Políticas RLS verificadas activas en catálogo de PostgreSQL.\n');

        // 4. Probar Auditoría Automática por Trigger con JSONB Diff
        console.log('4. Probando Trigger de Auditoría con JSONB Diff en Products...');
        const testProdId = 'prod_audit_test_' + Date.now();

        // 4.1 Inserción
        await sequelize.query(`
            INSERT INTO "Products" (id, name, price, "stockQuantity", "companyId", "createdAt", "updatedAt")
            VALUES (:id, 'Producto Auditoría PG16', 25.00, 50, '2', NOW(), NOW());
        `, { replacements: { id: testProdId } });

        const [insertLog] = await sequelize.query(`
            SELECT action, "entityId", "oldValue", "newValue", description
            FROM "AuditLogs"
            WHERE "entityId" = :id AND action = 'Products_CREATED';
        `, { replacements: { id: testProdId } });
        assert.strictEqual(insertLog.length, 1, 'Debe generarse un log Products_CREATED');
        assert.strictEqual(insertLog[0].oldValue, null, 'oldValue debe ser null en creación');
        assert.ok(insertLog[0].newValue.includes('Producto Auditoría PG16'), 'newValue debe contener los datos del producto');
        console.log('   - Evento CREATED capturado y auditado correctamente.');

        // 4.2 Modificación de precio y stock (Diff selectivo)
        await sequelize.query(`
            UPDATE "Products"
            SET price = 29.99, "stockQuantity" = 45, "updatedAt" = NOW()
            WHERE id = :id;
        `, { replacements: { id: testProdId } });

        const [updateLog] = await sequelize.query(`
            SELECT action, "entityId", "oldValue", "newValue"
            FROM "AuditLogs"
            WHERE "entityId" = :id AND action = 'Products_UPDATED';
        `, { replacements: { id: testProdId } });
        assert.strictEqual(updateLog.length, 1, 'Debe generarse un log Products_UPDATED');

        const oldDiff = JSON.parse(updateLog[0].oldValue);
        const newDiff = JSON.parse(updateLog[0].newValue);
        console.log('   - Diferencial anterior (oldValue):', oldDiff);
        console.log('   - Diferencial nuevo (newValue):', newDiff);

        assert.strictEqual(Number(oldDiff.price), 25, 'oldDiff.price debe ser 25');
        assert.strictEqual(Number(newDiff.price), 29.99, 'newDiff.price debe ser 29.99');
        assert.strictEqual(oldDiff.name, undefined, 'Campos no modificados NO deben aparecer en el diff');
        assert.strictEqual(oldDiff.updatedAt, undefined, 'updatedAt NO debe aparecer en el diff');
        console.log('   - Evento UPDATED auditó exactamente los campos modificados.');

        // 4.3 Falso UPDATE (solo cambia updatedAt, no debe generar log)
        const [logsBefore] = await sequelize.query('SELECT count(*) as cnt FROM "AuditLogs" WHERE "entityId" = :id;', {
            replacements: { id: testProdId }
        });
        await sequelize.query(`UPDATE "Products" SET "updatedAt" = NOW() WHERE id = :id;`, { replacements: { id: testProdId } });
        const [logsAfter] = await sequelize.query('SELECT count(*) as cnt FROM "AuditLogs" WHERE "entityId" = :id;', {
            replacements: { id: testProdId }
        });
        assert.strictEqual(logsBefore[0].cnt, logsAfter[0].cnt, 'No debe generarse log si los datos de negocio no cambiaron');
        console.log('   - Falso update ignorado con éxito (cero ruido en auditoría).');

        // 4.4 Eliminación
        await sequelize.query(`DELETE FROM "Products" WHERE id = :id;`, { replacements: { id: testProdId } });
        const [deleteLog] = await sequelize.query(`
            SELECT action, "entityId", "oldValue", "newValue"
            FROM "AuditLogs"
            WHERE "entityId" = :id AND action = 'Products_DELETED';
        `, { replacements: { id: testProdId } });
        assert.strictEqual(deleteLog.length, 1, 'Debe generarse un log Products_DELETED');
        assert.ok(deleteLog[0].oldValue.includes('29.99'), 'oldValue debe contener el snapshot previo al borrado');
        assert.strictEqual(deleteLog[0].newValue, null, 'newValue debe ser null en borrado');
        console.log('   - Evento DELETED capturado y respaldado correctamente.');

        // Limpieza de logs de prueba
        await sequelize.query('DELETE FROM "AuditLogs" WHERE "entityId" = :id;', { replacements: { id: testProdId } });
        console.log('   ✅ Trigger de auditoría con JSONB Diff validado al 100%.\n');

        // 5. Probar Row-Level Security (RLS) gradual
        console.log('5. Probando Row-Level Security (RLS) con rol isaac_app...');

        // 5.1 Modo permisivo sin tenant (conexión normal de mantenimiento o fondo)
        const [totalPermissive] = await sequelize.query('SELECT count(*) as total FROM "Products";');
        const countPermissive = parseInt(totalPermissive[0].total, 10);
        console.log(`   Conteo sin tenant especificado (modo global/sistema): ${countPermissive} productos.`);
        assert.ok(countPermissive > 0, 'El modo global debe devolver registros sin bloqueos.');

        // 5.2 Aislamiento de tenant inexistente
        await withTenantTransaction(sequelize, { companyId: 'empresa_fantasma_9999' }, async (t) => {
            const [isolatedRows] = await sequelize.query('SELECT count(*) as total FROM "Products";', { transaction: t });
            const countIsolated = parseInt(isolatedRows[0].total, 10);
            console.log(`   Conteo para 'empresa_fantasma_9999': ${countIsolated} productos.`);
            assert.strictEqual(countIsolated, 0, 'Un tenant inexistente no debe ver ningún registro de otra empresa');
        });
        console.log('   - Aislamiento estricto confirmado: 0 fugas de datos entre inquilinos.');

        // 5.3 Acceso a tenant legítimo '2'
        await withTenantTransaction(sequelize, { companyId: '2' }, async (t) => {
            const [tenantRows] = await sequelize.query('SELECT count(*) as total FROM "Products";', { transaction: t });
            const countTenant2 = parseInt(tenantRows[0].total, 10);
            console.log(`   Conteo para companyId '2': ${countTenant2} productos.`);
            assert.ok(countTenant2 > 0, 'La empresa 2 debe ver sus propios productos.');
        });
        console.log('   - Acceso legítimo a tenant verificado.');

        // 5.4 Superadministrador
        await withTenantTransaction(sequelize, { isSuperAdmin: true }, async (t) => {
            const [superRows] = await sequelize.query('SELECT count(*) as total FROM "Products";', { transaction: t });
            const countSuper = parseInt(superRows[0].total, 10);
            console.log(`   Conteo con isSuperAdmin: ${countSuper} productos.`);
            assert.strictEqual(countSuper, countPermissive, 'Superadmin debe poder ver la totalidad consolidada');
        });
        console.log('   - Bypass seguro para rol superadmin verificado.');

        console.log('   ✅ Row-Level Security (RLS) verificado con éxito.\n');

        console.log('======================================================');
        console.log('🎉 TODAS LAS PRUEBAS DE LA FASE 2 PASARON EXITOSAMENTE');
        console.log('======================================================\n');
        process.exit(0);
    } catch (err) {
        console.error('❌ FALLO EN PRUEBAS FASE 2:', err);
        process.exit(1);
    }
}

runFase2Tests();
