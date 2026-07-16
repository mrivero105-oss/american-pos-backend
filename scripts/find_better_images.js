const { Product } = require('./database/models');

async function findBetterImages() {
    try {
        const brokenProducts = await Product.findAll({
            where: {
                imageUri: 'data:image/png;base64',
                userId: '2'
            }
        });

        console.log(`Searching for better images for ${brokenProducts.length} items...`);

        for (const p of brokenProducts) {
            const betterOne = await Product.findOne({
                where: {
                    name: p.name,
                    imageUri: {
                        [require('sequelize').Op.notIn]: ['', 'data:image/png;base64']
                    }
                }
            });

            if (betterOne) {
                console.log(`[FOUND] Better image for "${p.name}" from ID ${betterOne.id} (User ${betterOne.userId})`);
            }
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

findBetterImages();
