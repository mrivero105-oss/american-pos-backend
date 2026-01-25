const { Product } = require('./database/models');

async function debugVatelOne() {
    try {
        const p = await Product.findOne({
            where: { id: '1768824714092-r52rx9yiv' }
        });

        if (p) {
            console.log('--- CORRUPTED VATEL DATA ---');
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

debugVatelOne();
