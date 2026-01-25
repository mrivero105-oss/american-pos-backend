const { Product } = require('./database/models');

async function debugImages() {
    try {
        const products = await Product.findAll({
            where: {
                name: {
                    [require('sequelize').Op.or]: [
                        { [require('sequelize').Op.like]: '%Karsell%' },
                        { [require('sequelize').Op.like]: '%BabyFinger%' }
                    ]
                },
                userId: '2'
            }
        });

        products.forEach(p => {
            console.log(`ID: ${p.id}, Name: "${p.name}", ImageUri length: ${p.imageUri ? p.imageUri.length : 0}`);
            if (p.imageUri && p.imageUri.length < 100) {
                console.log(`  Path: ${p.imageUri}`);
            }
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugImages();
