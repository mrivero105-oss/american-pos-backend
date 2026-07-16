const { Product } = require('./database/models');

async function debugAmanecer() {
    try {
        const products = await Product.findAll({
            where: {
                name: {
                    [require('sequelize').Op.like]: '%Amanecer%'
                },
                userId: '2'
            }
        });

        console.log(`Found ${products.length} Amanecer products for User 2:`);
        products.forEach(p => {
            console.log('\n---');
            console.log(`ID: ${p.id}`);
            console.log(`Name: "${p.name}"`);
            console.log(`ImageUri length: ${p.imageUri ? p.imageUri.length : 0}`);
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugAmanecer();
