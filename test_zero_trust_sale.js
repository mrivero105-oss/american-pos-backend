const { sequelize } = require('./database/connection');
const { Product, Sale, QuarantineSale } = require('./database/models');
const saleService = require('./services/SaleService');

async function runZeroTrustTest() {
    console.log('=== ZERO-TRUST BACKEND FINANCIAL AUDIT TEST ===\n');
    await sequelize.sync();

    const companyId = 'test-company-100';
    const userId = 'user-100';
    const mockUser = { id: userId, companyId, name: 'Cajero de Prueba', activeBranchId: '1' };

    // 1. Create a product with exact DB price of $25.00
    const prod = await Product.create({
        id: 'PROD-ZT-1',
        name: 'Producto Auditado Enterprise',
        price: 25.00,
        cost: 15.00,
        stock: 100,
        companyId,
        taxStatus: 'gravado'
    });
    console.log(`[SETUP] Producto creado en DB: "${prod.name}" a precio oficial $${prod.price.toFixed(2)}`);

    // 2. TEST CASE 1: Attack attempt - Frontend sends item with manipulated price $10.00 and total $10.00
    console.log('\n--- CASO 1: Intento de Manipulación de Precio por el Frontend ($10 en vez de $25) ---');
    const manipulatedSaleData = {
        clientTransactionId: `TX-ATTACK-${Date.now()}`,
        items: [
            { productId: 'PROD-ZT-1', name: 'Producto Auditado Enterprise', quantity: 1, price: 10.00 }
        ],
        total: 10.00,
        subtotal: 10.00,
        paymentMethods: [{ method: 'cash', amount: 10.00, currency: 'USD' }]
    };

    try {
        await saleService.processSale(mockUser, manipulatedSaleData, { bypassCreditLimit: true, bypassStockCheck: true });
        console.error('[FAIL] El servidor aceptó la venta manipulada indebidamente.');
        process.exit(1);
    } catch (err) {
        if (err.message.includes('INTEGRITY_ERROR') && err.message.includes('no coincide con el recibido')) {
            console.log(`[PASS] Bloqueado exitosamente por Zero-Trust Engine -> Mensaje: "${err.message}"`);
        } else {
            console.error('[FAIL] Error inesperado:', err.message);
            process.exit(1);
        }
    }

    // 3. TEST CASE 2: Valid Sale with exact 10^8 computed math ($25.00)
    console.log('\n--- CASO 2: Venta Legítima con Cálculo Exacto de Servidor ($25.00) ---');
    const validSaleData = {
        clientTransactionId: `TX-VALID-${Date.now()}`,
        items: [
            { productId: 'PROD-ZT-1', name: 'Producto Auditado Enterprise', quantity: 1, price: 25.00 }
        ],
        total: 25.00,
        subtotal: 25.00,
        paymentMethods: [{ method: 'cash', amount: 25.00, currency: 'USD' }]
    };

    try {
        const processed = await saleService.processSale(mockUser, validSaleData, { bypassCreditLimit: true, bypassStockCheck: true });
        console.log(`[PASS] Venta legítima verificada y guardada exitosamente con ID SQLite: ${processed.id}`);
    } catch (err) {
        console.error('[FAIL] La venta legítima fue rechazada erróneamente:', err.message);
        process.exit(1);
    }

    // Cleanup test data
    await Sale.destroy({ where: { id: [manipulatedSaleData.clientTransactionId, validSaleData.clientTransactionId] } });
    await Product.destroy({ where: { id: 'PROD-ZT-1' } });

    console.log('\n=== SUITE ZERO-TRUST SUPERADA EXITOSAMENTE (TOLERANCIA CERO VERIFICADA) ===');
    process.exit(0);
}

runZeroTrustTest().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
