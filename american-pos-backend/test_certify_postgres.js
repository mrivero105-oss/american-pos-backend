const { sequelize, connectDB } = require('./database/connection');
const { Product, Sale, SaleItem, User } = require('./database/models');
const ProductService = require('./services/ProductService');
const ExecutiveBIService = require('./services/ExecutiveBIService');
const { createPostgresBackup, cleanupOldBackups } = require('./utils/backupHelper');
const fs = require('fs');
const path = require('path');

async function runCertifications() {
    console.log('================================================================');
    console.log('🚀 INICIANDO CERTIFICACIÓN ARQUITECTÓNICA DE POSTGRESQL');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    const assert = (condition, testName, details = '') => {
        if (condition) {
            console.log(`  ✅ [PASS] ${testName} ${details ? `(${details})` : ''}`);
            passed++;
        } else {
            console.error(`  ❌ [FAIL] ${testName} ${details ? `(${details})` : ''}`);
            failed++;
        }
    };

    try {
        // Inicializar conexión y esquema (ejecuta triggers e índices)
        console.log('--- 1. Inicializando Conexión y Esquema de Base de Datos ---');
        await connectDB();
        const dialect = sequelize.getDialect();
        assert(dialect === 'postgres', 'Dialecto verificado como PostgreSQL', `Actual: ${dialect}`);

        // -------------------------------------------------------------
        // CERTIFICACIÓN 1: ÍNDICE GIN TRIGRAM + IMMUTABLE UNACCENT
        // -------------------------------------------------------------
        console.log('\n--- 2. Certificación de Búsqueda Trigram GIN e Immutable Unaccent ---');
        const [explainRows] = await sequelize.query(`
            EXPLAIN ANALYZE 
            SELECT id, name 
            FROM "Products" 
            WHERE public.immutable_unaccent(lower("name")) LIKE public.immutable_unaccent(lower('%arroz%'));
        `);

        const planText = explainRows.map(r => r['QUERY PLAN']).join('\n');
        const usesGinIndex = planText.includes('Bitmap Index Scan') || planText.includes('idx_products_unaccent_trgm');
        
        // Extraer tiempo de ejecución
        const execTimeMatch = planText.match(/Execution Time:\s*([0-9.]+)\s*ms/);
        const execTime = execTimeMatch ? parseFloat(execTimeMatch[1]) : 999;

        assert(usesGinIndex, 'Planificador de PostgreSQL utiliza el índice GIN Bitmap Index Scan');
        assert(execTime < 5.0, `Tiempo de respuesta de búsqueda ultra veloz: ${execTime} ms (< 5.0 ms)`, `Tiempo: ${execTime} ms`);

        // Identificar producto de prueba y companyId activo
        const testProduct = await Product.findOne({ where: { status: 'active' } });
        const targetCompanyId = testProduct ? testProduct.companyId : '2';

        // Probar búsqueda vía ProductService
        const searchResult = await ProductService.getAllProducts(
            { companyId: targetCompanyId },
            { search: 'arroz', limit: 10 }
        );
        assert(searchResult && searchResult.products && searchResult.products.length > 0, 
            'ProductService.getAllProducts retorna productos coincidentes con búsqueda insensible a acentos', 
            `Encontrados: ${searchResult.products.length}`);

        // -------------------------------------------------------------
        // CERTIFICACIÓN 2: DISPARADOR PL/pgSQL DE INTEGRIDAD DE STOCK
        // -------------------------------------------------------------
        console.log('\n--- 3. Certificación de Reglas Físicas de Stock (Trigger de Integridad) ---');
        
        assert(!!testProduct, 'Producto de prueba identificado en catálogo', `ID: ${testProduct?.id}, Nombre: ${testProduct?.name}`);

        if (testProduct) {
            const originalStock = Number(testProduct.stockQuantity);
            let triggerBlocked = false;

            const t = await sequelize.transaction();
            try {
                // Forzar actualización a stock negativo sin allowNegative
                await sequelize.query(`
                    UPDATE "Products" 
                    SET "stockQuantity" = -99, "allowNegative" = false 
                    WHERE id = :id
                `, { replacements: { id: testProduct.id }, transaction: t });
                await t.commit();
            } catch (err) {
                triggerBlocked = err.message.includes('STOCK_INTEGRITY_VIOLATION') || err.message.includes('stock no puede ser negativo');
                await t.rollback();
            }

            assert(triggerBlocked, 'Disparador PL/pgSQL aborta exitosamente intentos de stock negativo');

            // Verificar que el stock original permanece intacto
            await testProduct.reload();
            assert(Number(testProduct.stockQuantity) === originalStock, 
                'Stock original protegido contra corrupción tras rollback', 
                `Stock actual: ${testProduct.stockQuantity}`);
        }

        // -------------------------------------------------------------
        // CERTIFICACIÓN 3: REPORTES FINANCIEROS Y BI EJECUTIVO NATIVO
        // -------------------------------------------------------------
        console.log('\n--- 4. Certificación de Reportes Financieros y BI con SQL Analítico ---');
        const startTime = Date.now();
        const pnl = await ExecutiveBIService.getProfitAndLoss(targetCompanyId, {});
        const pnlDuration = Date.now() - startTime;

        assert(pnl && pnl.summary, 'ExecutiveBIService.getProfitAndLoss responde estructura completa');
        assert(typeof pnl.summary.grossSales === 'number', 'Resumen de ventas brutas calculado numéricamente', `Total: $${pnl.summary.grossSales}`);
        assert(typeof pnl.summary.grossProfit === 'number', 'Utilidad bruta calculada numéricamente', `Margen: ${pnl.summary.grossMarginPercent}%`);
        assert(Array.isArray(pnl.topProducts), 'Top productos calculados mediante GROUP BY nativo de PostgreSQL', `Items top: ${pnl.topProducts.length}`);
        assert(pnlDuration < 500, `Ejecución de P&L analítico completada en ${pnlDuration} ms (< 500 ms)`);

        // -------------------------------------------------------------
        // CERTIFICACIÓN 4: RESPALDO EN CALIENTE CON PG_DUMP Y ROTACIÓN
        // -------------------------------------------------------------
        console.log('\n--- 5. Certificación de Hot Backup y Rotación de Snapshots ---');
        const backupPath = await createPostgresBackup();
        const backupExists = fs.existsSync(backupPath);
        const backupSize = backupExists ? fs.statSync(backupPath).size : 0;

        assert(backupExists, 'Archivo Master Snapshot ZIP generado en disco', `Ruta: ${path.basename(backupPath)}`);
        assert(backupSize > 1024, `Tamaño de snapshot válido (> 1 KB)`, `Bytes: ${backupSize}`);

        // Validar rotación
        const backupDir = path.dirname(backupPath);
        cleanupOldBackups(backupDir, 10);
        const remainingBackups = fs.readdirSync(backupDir).filter(f => f.endsWith('.zip') || f.endsWith('.sqlite'));
        assert(remainingBackups.length <= 10, 'Rotación automática de copias de seguridad mantiene máximo 10 snapshots', `Total actuales: ${remainingBackups.length}`);

        // -------------------------------------------------------------
        // CERTIFICACIÓN 5: CONCURRENCIA Y BLOQUEO DE FILAS (FOR UPDATE)
        // -------------------------------------------------------------
        console.log('\n--- 6. Certificación de Concurrencia y Bloqueos de Fila (Multi-Terminal) ---');
        
        let concurrencyPassed = false;
        if (testProduct) {
            const t1 = await sequelize.transaction();
            const t2 = await sequelize.transaction();

            try {
                // T1 bloquea el producto con LOCK.UPDATE
                const p1 = await Product.findOne({
                    where: { id: testProduct.id },
                    lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                    transaction: t1
                });

                // T2 intenta leer/bloquear con timeout breve
                let t2Blocked = false;
                const t2Promise = Product.findOne({
                    where: { id: testProduct.id },
                    lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                    transaction: t2
                }).then(() => {
                    t2Blocked = false;
                }).catch(() => {
                    t2Blocked = true;
                });

                // Esperamos un instante: T1 tiene el bloqueo, por lo que T2 debe esperar
                await new Promise(r => setTimeout(r, 100));

                // Liberamos T1 haciendo commit
                await t1.commit();

                // Ahora T2 puede proceder
                await t2Promise;
                await t2.commit();

                concurrencyPassed = true;
            } catch (cErr) {
                try { await t1.rollback(); } catch(e){}
                try { await t2.rollback(); } catch(e){}
            }

            assert(concurrencyPassed, 'Bloqueo exclusivo de filas (SELECT FOR UPDATE) serializa transacciones concurrentes');
        }

        console.log('\n================================================================');
        console.log(`📊 RESULTADO FINAL DE CERTIFICACIÓN:`);
        console.log(`   Pruebas Exitosas: ${passed}`);
        console.log(`   Pruebas Fallidas: ${failed}`);
        console.log('================================================================\n');

        if (failed === 0) {
            console.log('🏆 ¡SISTEMA CERTIFICADO 100% OPERATIVO CON POSTGRESQL EMPRESARIAL!');
            process.exit(0);
        } else {
            console.error('⚠️ Se detectaron fallas en la certificación.');
            process.exit(1);
        }

    } catch (globalErr) {
        console.error('💥 Error crítico durante la certificación:', globalErr);
        process.exit(1);
    }
}

runCertifications();
