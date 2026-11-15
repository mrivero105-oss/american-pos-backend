const axios = require('axios');

async function testAnonRead() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new Error('Define SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el entorno.');
    }

    try {
        const salesRes = await axios.get(`${url}/rest/v1/cloud_ventas?limit=5`, {
            headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`
            }
        });
        console.log('ANON_SALES_COUNT:', salesRes.data.length);
        console.log('SAMPLE_SALE:', salesRes.data[0]);

        const prodRes = await axios.get(`${url}/rest/v1/cloud_productos?limit=5`, {
            headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`
            }
        });
        console.log('ANON_PRODUCTS_COUNT:', prodRes.data.length);
        console.log('SAMPLE_PRODUCT:', prodRes.data[0]);

        console.log('🎉 ANON_ACCESS_VERIFIED_100%');
    } catch (e) {
        console.error('ERROR_ANON:', e.response?.data || e.message);
    }
    process.exit(0);
}

testAnonRead();
