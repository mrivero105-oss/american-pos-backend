const { Product } = require('./database/models');

async function debugVatelAll() {
    try {
        const vatelProducts = await Product.findAll({
            where: {
                name: 'Aceite Vatel 250 ml ', // Note the trailing space in the corrupted one
                userId: '2'
            }
        });

        console.log(`Found ${vatelProducts.length} Vatel products for User 2:`);
        vatelProducts.forEach(vp => {
            console.log('\n---');
            console.log(`ID: ${vp.id}`);
            console.log(`Name: "${vp.name}"`);
            console.log(`Category: ${vp.category}`);
            console.log(`ImageUri length: ${vp.imageUri ? vp.imageUri.length : 0}`);
            if (vp.imageUri) {
                console.log(`ImageUri starts with: ${vp.imageUri.substring(0, 50)}...`);
            }
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugVatelAll();
