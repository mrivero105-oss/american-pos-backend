const { Client } = require('../american-pos-backend/node_modules/pg');
const axios = require('../american-pos-backend/node_modules/axios');
const dotenv = require('../american-pos-backend/node_modules/dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../american-pos-backend/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://puvqiipussyktfmgafgv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const pgClient = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/americanpos' });

async function uploadInBatches(table, items, batchSize = 100) {
    console.log(`[HISTORICAL SYNC] Subiendo ${items.length} registros a ${table}...`);
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        try {
            const res = await axios.post(
                `${SUPABASE_URL}/rest/v1/${table}`,
                batch,
                {
                    headers: {
                        'apikey': SERVICE_KEY,
                        'Authorization': `Bearer ${SERVICE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    timeout: 30000
                }
            );
            console.log(`  -> Lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${batch.length} registros) subido con éxito.`);
        } catch (err) {
            console.error(`  -> Error en lote ${i} - ${i + batchSize}:`, err.response?.data || err.message);
        }
    }
}

async function run() {
    await pgClient.connect();
    console.log('[HISTORICAL SYNC] Conectado a PostgreSQL local.');

    // 1. Obtener todas las ventas con sus items agrupados
    console.log('[HISTORICAL SYNC] Leyendo ventas locales...');
    const salesRes = await pgClient.query(`
        SELECT 
            s.id,
            COALESCE(s."branchId", 'principal') as sucursal_id,
            COALESCE(s."documentType", 'factura') as numero_factura,
            COALESCE(s."customerName", 'Consumidor Final') as cliente_nombre,
            COALESCE(s.subtotal, 0) as subtotal,
            COALESCE(s.tax, 0) as impuesto,
            COALESCE(s.total, 0) as total,
            COALESCE(s."paymentMethod", 'EFECTIVO') as metodo_pago,
            COALESCE(s."createdAt", NOW()) as fecha_hora,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', si."productId",
                        'nombre', COALESCE(si.name, 'Producto'),
                        'cantidad', COALESCE(si.quantity, 1),
                        'precio', COALESCE(si.price, 0),
                        'total', COALESCE(si.subtotal, 0)
                    )
                ) FILTER (WHERE si.id IS NOT NULL),
                '[]'::json
            ) as items_detalle
        FROM "Sales" s
        LEFT JOIN "SaleItems" si ON s.id = si."saleId"
        GROUP BY s.id
        ORDER BY s."createdAt" ASC
    `);

    const formattedSales = salesRes.rows.map(r => ({
        id: String(r.id),
        sucursal_id: String(r.sucursal_id),
        numero_factura: String(r.numero_factura || r.id),
        cliente_nombre: String(r.cliente_nombre).substring(0, 150),
        subtotal: Number(Number(r.subtotal).toFixed(2)),
        impuesto: Number(Number(r.impuesto).toFixed(2)),
        total: Number(Number(r.total).toFixed(2)),
        metodo_pago: String(r.metodo_pago).substring(0, 50),
        items_detalle: r.items_detalle || [],
        fecha_hora: r.fecha_hora,
        sincronizado_el: new Date().toISOString()
    }));

    await uploadInBatches('cloud_ventas', formattedSales, 100);

    // 2. Obtener todos los cierres de caja
    console.log('[HISTORICAL SYNC] Leyendo cierres de caja locales...');
    const shiftsRes = await pgClient.query(`
        SELECT 
            id,
            COALESCE("userName", 'Cajero') as cajero_nombre,
            COALESCE("initialAmount", 0) as monto_apertura,
            COALESCE("finalAmount", 0) as total_ventas,
            COALESCE(difference, 0) as diferencia,
            COALESCE("openedAt"::timestamptz, "createdAt") as fecha_apertura,
            COALESCE("closedAt"::timestamptz, "updatedAt") as fecha_cierre
        FROM "CashShifts"
        WHERE status = 'closed' OR "closedAt" IS NOT NULL
        ORDER BY "createdAt" ASC
    `);

    const formattedShifts = shiftsRes.rows.map(r => ({
        id: String(r.id),
        sucursal_id: 'principal',
        cajero_nombre: String(r.cajero_nombre).substring(0, 100),
        monto_apertura: Number(Number(r.monto_apertura || 0).toFixed(2)),
        total_ventas: Number(Number(r.total_ventas || 0).toFixed(2)),
        total_efectivo: Number(Number(r.total_ventas || 0).toFixed(2)),
        total_electronico: 0.00,
        diferencia: Number(Number(r.diferencia || 0).toFixed(2)),
        fecha_apertura: r.fecha_apertura,
        fecha_cierre: r.fecha_cierre,
        sincronizado_el: new Date().toISOString()
    }));

    if (formattedShifts.length > 0) {
        await uploadInBatches('cloud_cierres_caja', formattedShifts, 100);
    }

    await pgClient.end();
    console.log('[HISTORICAL SYNC] 🎉 Sincronización histórica completada con éxito.');
}

run().catch(console.error);
