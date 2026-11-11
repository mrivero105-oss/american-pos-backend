const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testProductSync() {
    try {
        const payload = [{
            id: '1772071374412-qwr3dp7fc',
            sucursal_id: 'principal',
            codigo_barra: '7591664000046',
            nombre: 'Pega Loca',
            categoria: 'Víveres',
            precio_venta: 0.45,
            stock_actual: 76.0
        }];

        const res = await axios.post(
            `${process.env.SUPABASE_URL}/rest/v1/cloud_productos`,
            payload,
            {
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                }
            }
        );
        console.log('SUCCESS_PRODUCT_SYNC:', res.status);
    } catch (e) {
        console.log('ERROR_PRODUCT_SYNC:', e.response?.data || e.message);
    }
    process.exit(0);
}

testProductSync();
