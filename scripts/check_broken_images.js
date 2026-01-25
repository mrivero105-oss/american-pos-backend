const { Product } = require('./database/models');

async function checkBrokenImages() {
    try {
        const brokenProducts = await Product.findAll({
            where: {
                imageUri: 'data:image/png;base64',
                userId: '2'
            }
        });

        console.log(`Found ${brokenProducts.length} broken images for User 2:`);
        brokenProducts.forEach(p => {
            console.log(`- ${p.name} (ID: ${p.id})`);
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkBrokenImages();
