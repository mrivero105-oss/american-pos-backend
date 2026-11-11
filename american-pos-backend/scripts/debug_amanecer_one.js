const { Product } = require('./database/models');

async function debugAmanecerOne() {
    try {
        const p = await Product.findOne({
            where: { id: '1768824714092-vmwha65p7' }
        });

        if (p) {
            console.log(`ID: ${p.id}`);
            console.log(`Name: "${p.name}"`);
            console.log(`ImageUri: "${p.imageUri}"`);
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugAmanecerOne();
