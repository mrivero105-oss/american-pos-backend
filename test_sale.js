const axios = require('axios');

async function testSale() {
    try {
        const payload = {
            clientTransactionId: `SALE-TEST-${Date.now()}`,
            items: [
                { id: '160', name: 'Consul Detallado', quantity: 1, price: 70, cost: 40 }
            ],
            total: 0.25,
            subtotal: 0.25,
            tax: 0,
            discount: 0,
            receivedAmount: 140,
            changeAmount: 0,
            paymentMethods: [
                { method: 'cash_bs', amount: 140, currency: 'VES' }
            ],
            customerId: '',
            customerName: 'Cliente Ocasional',
            documentType: 'factura'
        };

        const res = await axios.post('http://localhost:5005/sales', payload, {
            headers: {
                'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjE3NzI5MjY5NDQ0OTUta21hZmoyejdkIiwiZW1haWwiOiJtcnZlcm8xMDUxQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcmFkbWluIiwiY29tcGFueUlkIjoiMTc3MjkyNjk0NDQ5NS1rbWFmajJ6N2QiLCJtaWQiOiI3NzE3ODliYmFlMzg5NTE0ZTExNTI5ZTkzZmVmYzBkOTcwMzQ4ZjJiYmFlMzg5NTE0ZTExNTI5ZTkzZmVmYzBkOTcwMzQ4ZjIiLCJpYXQiOjE3MTU5NzkxNzcsImV4cCI6MTcxNzI3NTE3N30.8G2r3R9XzH5n6v3_x8t8P2s4_k9v0g_h9n2T2t_z8s`, // Note: using a dummy/wrong token might throw 401. We can bypass it or use local function.
            }
        });
        console.log("SUCCESS:", res.data);
    } catch (e) {
        console.log("ERROR STATUS:", e.response?.status);
        console.log("ERROR DATA:", e.response?.data);
    }
}

testSale();
