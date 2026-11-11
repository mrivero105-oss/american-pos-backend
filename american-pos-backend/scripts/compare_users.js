const { Product } = require('./database/models');

async function analyzeUser1() {
    try {
        const products = await Product.findAll({ where: { userId: '1' } });
        let numericCats = 0;
        products.forEach(p => {
            if (p.category && /^[0-9.]+$/.test(p.category)) numericCats++;
        });
        console.log(`User 1 has ${products.length} products, ${numericCats} with numeric categories.`);

        const products2 = await Product.findAll({ where: { userId: '2' } });
        let numericCats2 = 0;
        products2.forEach(p => {
            if (p.category && /^[0-9.]+$/.test(p.category)) numericCats2++;
        });
        console.log(`User 2 has ${products2.length} products, ${numericCats2} with numeric categories.`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

analyzeUser1();
