const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const supabaseSync = require('../services/SupabaseSyncService');
const { randomUUID } = require('crypto');

async function testSync() {
    console.log('[TEST SYNC] Iniciando prueba de sincronización a Supabase...');
    console.log('[TEST SYNC] URL:', process.env.SUPABASE_URL);

    const testSaleId = randomUUID();
    const testPayload = {
        id: testSaleId,
        sucursal_id: 'principal',
        numero_factura: 'TEST-0001',
        cliente_nombre: 'Cliente de Prueba Supabase',
        subtotal: 100.50,
        impuesto: 16.08,
        total: 116.58,
        metodo_pago: 'PAGO_MOVIL',
        items_detalle: [
            { nombre: 'Producto Prueba A', cantidad: 2, precio: 50.25, total: 100.50 }
        ],
        fecha_hora: new Date().toISOString()
    };

    console.log('[TEST SYNC] 1. Encolando venta de prueba en tabla local sync_outbox...');
    await supabaseSync.queueEvent('ventas', testSaleId, 'INSERT', testPayload);
    console.log('[TEST SYNC] Venta encolada exitosamente.');

    console.log('[TEST SYNC] 2. Procesando lote hacia Supabase en la nube...');
    const result = await supabaseSync.processBatch(10);
    console.log('[TEST SYNC] Resultado del envío:', JSON.stringify(result, null, 2));

    if (result.success && result.count > 0) {
        console.log('🎉 SINCRONIZACION_NUBE_EXITOSA: El registro ya vive en Supabase.');
        process.exit(0);
    } else {
        console.error('❌ ERROR_EN_SINCRONIZACION:', result);
        process.exit(1);
    }
}

testSync();
