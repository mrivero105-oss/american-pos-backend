
const https = require('https');

const API_URL = 'https://american-pos-backend.pages.dev';

function request(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_URL + path);
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (e) => reject(e));

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function test() {
    console.log('1. Logging in...');
    const loginRes = await request('POST', '/auth/login', {
        email: 'mrivero105@gmail.com',
        password: 'admin'
    });

    if (loginRes.status !== 200 || !loginRes.data.token) {
        console.error('Login Failed:', loginRes);
        return;
    }
    const token = loginRes.data.token;
    console.log('Login Success.');

    console.log('2. Creating Test User with Dual Currency...');
    const testEmail = `currencytest_${Date.now()}@example.com`;
    const createRes = await request('POST', '/users', {
        email: testEmail,
        password: 'password123',
        role: 'user',
        businessInfo: {
            currencies: ['USD', 'VES'],
            currency: 'USD'
        }
    }, token);

    console.log('Create Response:', createRes.status);
    if (createRes.status !== 201) {
        console.error('Creation failed', createRes.data);
    }

    console.log('3. Fetching User to Verify Data...');
    const listRes = await request('GET', '/users', null, token);
    const user = listRes.data.find(u => u.email === testEmail);

    if (user) {
        console.log('User Found. BusinessInfo:', user.businessInfo);

        // Handle if businessInfo is string or object (backend might store as object but earlier logic suggested string parsing?)
        // The backend _worker.js stores it as object in the array usually.
        // Wait, the frontend code had `typeof user.businessInfo === 'string' ? JSON.parse...`
        // Let's see what we got.
        let info = user.businessInfo;
        if (typeof info === 'string') info = JSON.parse(info);

        if (info && info.currencies && info.currencies.includes('VES') && info.currencies.includes('USD')) {
            console.log('SUCCESS: Currencies persisted correctly.');
        } else {
            console.error('FAILURE: Currencies missing or incorrect.', info);
        }

        console.log('4. Cleaning up...');
        await request('DELETE', `/users/${user.id}`, null, token);
    } else {
        console.error('User not found in list.');
    }
}

test().catch(console.error);
