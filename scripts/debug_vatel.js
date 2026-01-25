const { Product } = require('./database/models');

async function debugVatel() {
    try {
        const vatelProducts = await Product.findAll({
            where: {
                name: {
                    [require('sequelize').Op.like]: '%Vatel%'
                }
            }
        });

        console.log(`Found ${vatelProducts.length} Vatel products:`);
        vatelProducts.forEach(vp => {
            console.log('\n---');
            console.log(`ID: ${vp.id}`);
            console.log(`Name: ${vp.name}`);
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

debugVatel();
