// Native fetch used


async function test() {
    try {
        // 1. Login
        const loginRes = await fetch('http://localhost:3000/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'mrivero105@gmail.com', password: 'admin' })
        });

        if (!loginRes.ok) {
            console.error('Login failed:', await loginRes.text());
            return;
        }

        const loginData = await loginRes.json();
        const token = loginData.token;
        console.log('Got token:', token);

        // 2. Fetch Business Info
        const businessRes = await fetch('http://localhost:3000/settings/business', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!businessRes.ok) console.error('Business Info failed:', await businessRes.text());
        else console.log('Business Info success');

        // 3. Fetch Sales
        const salesRes = await fetch('http://localhost:3000/sales?limit=50', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!salesRes.ok) console.error('Sales failed:', await salesRes.text());
        else console.log('Sales success');

        // 4. Fetch Summary
        const summaryRes = await fetch('http://localhost:3000/dashboard/summary', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!summaryRes.ok) console.error('Summary failed:', await summaryRes.text());
        else console.log('Summary success');

    } catch (e) {
        console.error('Script error:', e);
    }
}

test();
