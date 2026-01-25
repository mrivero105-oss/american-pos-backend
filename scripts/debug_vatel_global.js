const { Product } = require('./database/models');

async function debugVatelGlobal() {
    try {
        const vatelProducts = await Product.findAll({
            where: {
                name: {
                    [require('sequelize').Op.like]: '%Vatel%'
                }
            }
        });

        console.log(`Found ${vatelProducts.length} Vatel products in total:`);
        vatelProducts.forEach(vp => {
            console.log('\n---');
            console.log(`ID: ${vp.id}`);
            console.log(`User ID: ${vp.userId}`);
            console.log(`Name: "${vp.name}"`);
            console.log(`Category: ${vp.category}`);
            console.log(`ImageUri length: ${vp.imageUri ? vp.imageUri.length : 0}`);
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugVatelGlobal();
