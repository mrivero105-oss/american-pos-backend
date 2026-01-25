
const https = require('https');

const API_URL = 'https://american-pos-backend.pages.dev';

function request(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_URL + path);
        const options = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (token) options.headers['Authorization'] = `Bearer ${token}`;

        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function test() {
    console.log('--- Testing Multi-Tenancy ---');

    // 1. Login Admin
    const loginRes = await request('POST', '/auth/login', { email: 'mrivero105@gmail.com', password: 'admin' });
    if (!loginRes.data.token) throw new Error('Admin login failed');
    const adminToken = loginRes.data.token;
    console.log('1. Admin Logged In');

    // 2. Check Admin Products
    const adminProducts = await request('GET', '/products', null, adminToken);
    console.log(`2. Admin sees ${adminProducts.data.length} products.`);

    // 3. Create Shared User
    const timestamp = Date.now();
    const sharedEmail = `shared_${timestamp}@test.com`;
    const sharedRes = await request('POST', '/users', {
        email: sharedEmail, password: 'password', role: 'user', dataScope: 'shared'
    }, adminToken);
    console.log('3. Created Shared User:', sharedRes.status);

    // 4. Create Isolated User
    const isolatedEmail = `isolated_${timestamp}@test.com`;
    const isolatedRes = await request('POST', '/users', {
        email: isolatedEmail, password: 'password', role: 'user', dataScope: 'isolated'
    }, adminToken);
    console.log('4. Created Isolated User:', isolatedRes.status);

    // 5. Login Shared
    const sharedLogin = await request('POST', '/auth/login', { email: sharedEmail, password: 'password' });
    const sharedToken = sharedLogin.data.token;

    // 6. Login Isolated
    const isolatedLogin = await request('POST', '/auth/login', { email: isolatedEmail, password: 'password' });
    const isolatedToken = isolatedLogin.data.token;

    // 7. Verify Shared View
    const sharedProducts = await request('GET', '/products', null, sharedToken);
    console.log(`7. Shared User sees ${sharedProducts.data.length} products (Expected: ${adminProducts.data.length})`);

    // 8. Verify Isolated View
    const isolatedProducts = await request('GET', '/products', null, isolatedToken);
    console.log(`8. Isolated User sees ${isolatedProducts.data.length} products (Expected: 0)`);

    if (sharedProducts.data.length !== adminProducts.data.length) console.error('FAIL: Shared user count mismatch');
    if (isolatedProducts.data.length !== 0) console.error('FAIL: Isolated user see products!');
    if (isolatedProducts.data.length === 0 && sharedProducts.data.length > 0) console.log('SUCCESS: Isolation confirmed.');

    // 9. Cleanup
    await request('DELETE', `/users/${sharedRes.data.id}`, null, adminToken);
    await request('DELETE', `/users/${isolatedRes.data.id}`, null, adminToken);
    console.log('9. Cleanup complete');
}

test().catch(console.error);
