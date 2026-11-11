const axios = require('axios');

async function testAnonRead() {
    const url = 'https://puvqiipussyktfmgafgv.supabase.co';
    const anonKey = 'sb_publishable_qphH7VeJGgcTsgMp6NZjDw_zmGnOAi6';

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
