
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
    console.log('Login Success. Token:', token.substring(0, 20) + '...');

    console.log('2. Creating Test User...');
    const testEmail = `testuser_${Date.now()}@example.com`;
    const createRes = await request('POST', '/users', {
        email: testEmail,
        password: 'password123',
        role: 'user',
        businessInfo: { currency: 'USD' }
    }, token);

    console.log('Create Response:', createRes);

    if (createRes.status === 201 || createRes.status === 200) {
        console.log('User Created Successfully.');
    } else {
        console.error('User Creation Failed.');
    }

    console.log('3. Fetching Users...');
    const listRes = await request('GET', '/users', null, token);
    console.log('Users List Count:', Array.isArray(listRes.data) ? listRes.data.length : 'Not Array');

    if (Array.isArray(listRes.data)) {
        const found = listRes.data.find(u => u.email === testEmail);
        console.log('Test User Found in List:', !!found);

        // Cleanup
        if (found) {
            console.log('4. Deleting Test User...');
            await request('DELETE', `/users/${found.id}`, null, token);
        }
    }
}

test().catch(console.error);
