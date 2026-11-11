const { sequelize, Sale, SaleItem, Product } = require('../database/models');
const { v4: uuidv4 } = require('uuid');

async function generateTestSales() {
    try {
        await sequelize.sync();
        console.log('Fetching products...');
        const products = await Product.findAll({ limit: 20 });

        if (products.length === 0) {
            console.log('No products found in the database. Creating some dummy products first...');
            for (let i = 1; i <= 5; i++) {
                await Product.create({
                    id: uuidv4(),
                    name: `Producto Prueba ${i}`,
                    price: Math.floor(Math.random() * 50) + 10,
                    stock: 100,
                    category: 'Generales',
                    barcode: `1234567890${i}`
                });
            }
            // Fetch again
            products.push(...(await Product.findAll({ limit: 5 })));
        }

        console.log(`Using ${products.length} products to generate sales.`);

        const paymentMethodsArr = ['EFECTIVO', 'PAGO_MOVIL', 'TARJETA', 'ZELLE'];

        // Generate sales for the last 7 days
        for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
            const date = new Date();
            date.setDate(date.getDate() - dayOffset);

            // Random number of sales per day (5 to 15)
            const salesCount = Math.floor(Math.random() * 11) + 5;
            console.log(`Generating ${salesCount} sales for ${date.toISOString().split('T')[0]}`);

            for (let s = 0; s < salesCount; s++) {
                const saleId = uuidv4();

                // Random items (1 to 4)
                const itemsCount = Math.floor(Math.random() * 4) + 1;
                const items = [];
                let total = 0;

                for (let i = 0; i < itemsCount; i++) {
                    const product = products[Math.floor(Math.random() * products.length)];
                    const quantity = Math.floor(Math.random() * 3) + 1;
                    const subtotal = product.price * quantity;
                    total += subtotal;

                    items.push({
                        productId: product.id,
                        name: product.name,
                        quantity: quantity,
                        price: product.price,
                        subtotal: subtotal,
                        category: product.category || 'Generales'
                    });
                }

                // Construct the timestamp matching the historical date
                const hours = Math.floor(Math.random() * 12) + 8; // 8 AM to 8 PM
                const minutes = Math.floor(Math.random() * 60);
                date.setHours(hours, minutes, 0, 0);
                const isoDate = date.toISOString();

                const method = paymentMethodsArr[Math.floor(Math.random() * paymentMethodsArr.length)];

                await Sale.create({
                    id: saleId,
                    date: isoDate, // legacy string format
                    timestamp: isoDate,
                    total: total,
                    subtotal: total, // simplified
                    tax: 0,
                    discount: 0,
                    paymentMethod: method,
                    items: items, // Legacy format
                    status: 'completed',
                    userId: 'admin'
                });

                // New relational format
                for (const item of items) {
                    await SaleItem.create({
                        saleId: saleId,
                        productId: item.productId,
                        name: item.name,
                        quantity: item.quantity,
                        price: item.price || 1, // Fallback
                        subtotal: item.subtotal || 1, // Fallback
                        category: item.category
                    });
                }
            }
        }

        console.log('✅ Test sales generated successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error generating test sales:', error);
        process.exit(1);
    }
}

generateTestSales();
