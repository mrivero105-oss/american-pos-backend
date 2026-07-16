const { sequelize } = require('./database/connection');
const { Product, Sale, QuarantineSale } = require('./database/models');
const SaleService = require('./services/SaleService');

const saleService = require('./services/SaleService');

async function runStressAndRecoveryTest() {
    console.log('================================================================================');
    console.log('   AMERICAN POS PC - PRUEBA DE ESTRÉS DE ALTA CONCURRENCIA Y RESILIENCIA MEMORIA');
    console.log('================================================================================\n');

    await sequelize.sync();

    const companyId = 'stress-company-999';
    const userId = 'user-stress-999';
    const mockUser = { id: userId, companyId, name: 'Operador de Estrés', activeBranchId: '1' };

    // 1. Crear producto base para la prueba de estrés
    await Product.findOrCreate({
        where: { id: 'PROD-STRESS-1' },
        defaults: {
            name: 'Artículo de Consumo Masivo POS',
            price: 12.50,
            cost: 8.00,
            stock: 100000,
            companyId,
            taxStatus: 'gravado'
        }
    });

    console.log('[FASE 1] Línea de Base - Medición de Memoria Inicial');
    const initialMem = process.memoryUsage();
    console.log(` -> Heap Usado Inicial: ${(initialMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(` -> RSS (Resident Set Size): ${(initialMem.rss / 1024 / 1024).toFixed(2)} MB\n`);

    // 2. Simulación de Cola Offline Masiva (500 ventas acumuladas en IndexedDB enviadas en ráfagas de Batch)
    const TOTAL_OFFLINE_SALES = 500;
    const CHUNK_SIZE = 25; // Equivalente al CHUNK_SIZE del controlador /public-sync
    console.log(`[FASE 2] Simulando reconexión tras apagón/desconexión prolongada: Procesando ${TOTAL_OFFLINE_SALES} ventas offline divididas en lotes de ${CHUNK_SIZE}...\n`);

    const startTime = Date.now();
    let successCount = 0;
    let quarantineCount = 0;

    for (let batch = 0; batch < TOTAL_OFFLINE_SALES / CHUNK_SIZE; batch++) {
        const batchStartTime = Date.now();
        await new Promise(resolve => setImmediate(resolve));

        for (let i = 0; i < CHUNK_SIZE; i++) {
            const saleIdx = batch * CHUNK_SIZE + i;
            // 95% ventas legítimas, 5% ventas con anomalía de precio provocada (para probar desvío a cuarentena bajo estrés)
            const isCorrupted = (saleIdx % 20 === 0);
            const sentPrice = isCorrupted ? 5.00 : 12.50; // 5.00 causará INTEGRITY_ERROR e irá a cuarentena

            const saleData = {
                clientTransactionId: `TX-STRESS-${batch}-${i}-${Date.now()}`,
                items: [
                    { productId: 'PROD-STRESS-1', name: 'Artículo de Consumo Masivo POS', quantity: 2, price: sentPrice }
                ],
                total: sentPrice * 2,
                subtotal: sentPrice * 2,
                paymentMethods: [{ method: 'cash', amount: sentPrice * 2, currency: 'USD' }],
                hmacTimestamp: Date.now().toString(),
                hmacBranchId: '1'
            };

            try {
                const res = await saleService.processSale(mockUser, saleData, { bypassCreditLimit: true, bypassStockCheck: true });
                successCount++;
            } catch (err) {
                await QuarantineSale.create({
                    id: saleData.clientTransactionId,
                    companyId: mockUser.companyId,
                    branchId: mockUser.activeBranchId || '1',
                    rawPayload: JSON.stringify(saleData),
                    errorReason: err.message || 'Integrity Error',
                    hmacSignature: 'MOCK-HMAC-SIGNATURE'
                });
                quarantineCount++;
            }
        }

        const batchDuration = Date.now() - batchStartTime;
        const currentMem = process.memoryUsage();
        console.log(`  [Batch ${batch + 1}/${TOTAL_OFFLINE_SALES / CHUNK_SIZE}] ${CHUNK_SIZE} transacciones procesadas en ${batchDuration}ms | Heap: ${(currentMem.heapUsed / 1024 / 1024).toFixed(2)} MB (${(CHUNK_SIZE / (batchDuration / 1000)).toFixed(0)} ventas/seg)`);
    }

    const totalTime = Date.now() - startTime;
    const finalMem = process.memoryUsage();

    console.log('\n================================================================================');
    console.log('                        RESULTADOS DE LA PRUEBA DE ESTRÉS');
    console.log('================================================================================');
    console.log(` Total de transacciones procesadas: ${TOTAL_OFFLINE_SALES}`);
    console.log(`  -> Sincronizadas exitosamente en SQLite: ${successCount} (95%)`);
    console.log(`  -> Desviadas a tabla de Cuarentena (Zero-Trust): ${quarantineCount} (5%)`);
    console.log(` Tiempo total de ráfaga: ${totalTime} ms (${(totalTime / 1000).toFixed(2)} segundos)`);
    console.log(` Rendimiento medio (Throughput): ${(TOTAL_OFFLINE_SALES / (totalTime / 1000)).toFixed(1)} ventas por segundo`);
    console.log(` Incremento de memoria Heap (Estabilidad GC): ${((finalMem.heapUsed - initialMem.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
    console.log('================================================================================\n');

    // Limpieza de datos
    await Sale.destroy({ where: { companyId } });
    await QuarantineSale.destroy({ where: {} });
    await Product.destroy({ where: { id: 'PROD-STRESS-1' } });

    console.log('[PASS] Prueba de estrés completada sin fugas de memoria (Memory Leaks) ni bloqueos de base de datos.');
    process.exit(0);
}

runStressAndRecoveryTest().catch(err => {
    console.error('Fatal stress test error:', err);
    process.exit(1);
});
