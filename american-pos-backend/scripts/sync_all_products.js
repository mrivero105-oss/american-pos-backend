const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../database/connection');

async function syncAllProducts() {
    console.log('[CATALOG SYNC] Iniciando subida inicial de productos a Supabase...');
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    const branchId = process.env.POS_BRANCH_ID || 'principal';

    if (!supabaseUrl || !serviceKey) {
        console.error('Faltan credenciales de Supabase en .env');
        process.exit(1);
    }

    try {
        const [products] = await sequelize.query(`
            SELECT id, name, price, stock, barcode, category 
            FROM "Products"
        `);

        console.log(`[CATALOG SYNC] ${products.length} productos locales encontrados en PostgreSQL.`);

        const BATCH_SIZE = 100;
        let uploaded = 0;

        for (let i = 0; i < products.length; i += BATCH_SIZE) {
            const chunk = products.slice(i, i + BATCH_SIZE);
            const payloads = chunk.map(p => ({
                id: String(p.id),
                sucursal_id: branchId,
                codigo_barra: p.barcode ? String(p.barcode).trim() : null,
                nombre: p.name || 'Sin Nombre',
                categoria: p.category || 'General',
                precio_venta: Number(p.price) || 0,
                stock_actual: Number(p.stock) || 0,
                actualizado_el: new Date().toISOString()
            }));

            await axios.post(
                `${supabaseUrl}/rest/v1/cloud_productos`,
                payloads,
                {
                    headers: {
                        'apikey': serviceKey,
                        'Authorization': `Bearer ${serviceKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    timeout: 20000
                }
            );

            uploaded += chunk.length;
            console.log(`[CATALOG SYNC] Subidos ${uploaded}/${products.length} productos...`);
        }

        console.log('🎉 TODOS_LOS_PRODUCTOS_SINCRONIZADOS_CON_EXITO');
        process.exit(0);
    } catch (error) {
        console.error('❌ ERROR_SYNC_CATALOG:', error.response?.data || error.message);
        process.exit(1);
    }
}

syncAllProducts();
