
const fs = require('fs');
const path = require('path');

const BACKEND_URL = 'https://american-pos-backend.pages.dev/admin/restore';
// const BACKEND_URL = 'http://localhost:8788/admin/restore'; // Debug

const restore = async (key, file) => {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${key}: file not found`);
        return;
    }

    console.log(`Reading ${file}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    console.log(`Uploading ${key} to ${BACKEND_URL}...`);
    try {
        const res = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: data })
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed: ${res.status} ${text}`);
        }

        const json = await res.json();
        console.log(`Success ${key}:`, json);
    } catch (e) {
        console.error(`Error uploading ${key}:`, e.message);
    }
};

const verify = async (key) => {
    console.log(`Verifying ${key}...`);
    // Note: The worker doesn't explicitly expose a GET /admin/restore or direct key read for admin without auth.
    // However, we can check /auth/login for 'db' implicitly by trying to login.
    // OR we can add a temporary GET endpoint or just trust the previous success message if we trust the code.
    // Actually, let's just re-upload cautiously or check the worker logs.
    // Better yet, let's add a debug read endpoint to _worker.js? No, let's keep it simple.
    // We will just re-upload and logging the payload size to ensure we aren't uploading empty data.
};

const run = async () => {
    // Debugging: Log what we are reading
    const dbPath = path.join(__dirname, '..', 'db.json');
    const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log(`DB User Count: ${dbData.users ? dbData.users.length : 0}`);
    if (dbData.users) console.log('Users:', dbData.users.map(u => u.email));

    await restore('db', 'db.json');
    await restore('settings', 'settings.json');
    await restore('payment_methods', 'payment_methods.json');
};

run().catch(console.error);
