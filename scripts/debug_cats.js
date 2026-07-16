const { Product } = require('./database/models');

async function checkCategories() {
    try {
        const allProducts = await Product.findAll({
            attributes: ['id', 'name', 'category', 'price', 'stock', 'barcode', 'cost'],
            limit: 5000
        });

        console.log('--- SUSPICIOUS PRODUCTS ---');
        let count = 0;
        allProducts.forEach(p => {
            if (p.category && /^[0-9]/.test(p.category)) {
                console.log(`[!] ${p.name} | Cat: ${p.category} | Price: ${p.price} | Stock: ${p.stock} | Cost: ${p.cost}`);
                count++;
            }
        });
        console.log(`Total suspicious: ${count}`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkCategories();
