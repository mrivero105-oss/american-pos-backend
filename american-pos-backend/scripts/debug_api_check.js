const fetch = require('node-fetch'); // Assuming node-fetch is available or using built-in fetch in newer node

// Polyfill fetch if needed (Node 18+ has it)
const doFetch = global.fetch || require('node-fetch');

const API_URL = 'http://localhost:3000/products';
const USER_ID = 'admin-1';
const TOKEN = `user:${USER_ID}:${Date.now()}`;

async function checkProducts() {
    console.log(`Checking API: ${API_URL}`);
    console.log(`Using Token: ${TOKEN}`);

    try {
        const response = await doFetch(API_URL, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`
            }
        });

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(text);
            return;
        }

        const products = await response.json();
        console.log(`Total Products Fetched: ${products.length}`);

        const vitafer = products.find(p => p.name.includes('Vitafer'));

        if (vitafer) {
            console.log('SUCCESS: "Vitafer" found in API response!');
            console.log(JSON.stringify(vitafer, null, 2));
        } else {
            console.error('FAILURE: "Vitafer" NOT found in API response.');
            console.log('Sample of first 3 products:', products.slice(0, 3));
        }

    } catch (error) {
        console.error('Fetch failed:', error);
    }
}

checkProducts();
