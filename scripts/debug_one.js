const { Product } = require('./database/models');

async function debugProduct() {
    try {
        const p = await Product.findOne({
            where: { name: 'Dorito Normal' }
        });

        if (p) {
            console.log('--- FULL PRODUCT DATA ---');
            console.log(JSON.stringify(p.toJSON(), null, 2));
        } else {
            console.log('Product not found');
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugProduct();
