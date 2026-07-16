const { sequelize } = require('./database/connection');
const SaleService = require('./services/SaleService');
const { Product } = require('./database/models');

async function testSale() {
    try {
        const prod = await Product.findOne();
        if (!prod) { console.log("NO PRODUCTS"); process.exit(0); }

        const reqUser = {
            id: '1772926944495-kmafj2z7d',
            companyId: prod.companyId, 
            role: 'superadmin',
            activeBranchId: undefined
        };

        const roundedPrice = Number(Number(prod.price).toFixed(2));
        const payload = {
            clientTransactionId: `SALE-TEST-${Date.now()}`,
            items: [
                { id: prod.id, productId: prod.id, name: prod.name, quantity: 1, price: roundedPrice, cost: Number(prod.cost) }
            ],
            total: roundedPrice,
            subtotal: roundedPrice,
            tax: 0,
            discount: 0,
            receivedAmount: roundedPrice,
            changeAmount: 0,
            paymentMethods: [
                { method: 'cash_bs', amount: roundedPrice, currency: 'VES' }
            ],
            customerId: '',
            customerName: 'Cliente Ocasional',
            documentType: 'factura'
        };

        const res = await SaleService.processSale(reqUser, payload);
        console.log("SUCCESS:", res.id);
        process.exit(0);
    } catch (e) {
        console.error("ERROR CAUGHT:");
        console.error(e);
        process.exit(1);
    }
}

testSale();
