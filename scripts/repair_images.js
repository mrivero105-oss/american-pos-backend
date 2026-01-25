const { Product } = require('./database/models');

async function fixBrokenImages() {
    try {
        console.log('--- STARTING IMAGE REPAIR ---');
        const brokenProducts = await Product.findAll({
            where: {
                imageUri: 'data:image/png;base64',
                userId: '2'
            }
        });

        console.log(`Analyzing ${brokenProducts.length} broken images...`);
        let fixedCount = 0;

        for (const p of brokenProducts) {
            // Precise name match, look for ANY product that has a real image
            const betterOne = await Product.findOne({
                where: {
                    name: p.name,
                    imageUri: {
                        [require('sequelize').Op.notIn]: ['', 'data:image/png;base64']
                    }
                }
            });

            if (betterOne) {
                p.imageUri = betterOne.imageUri;
                await p.save();
                console.log(`[REPAIRED] "${p.name}" (Used image from ID ${betterOne.id})`);
                fixedCount++;
            } else {
                // Try fuzzy match if exact fails
                const fuzzyOne = await Product.findOne({
                    where: {
                        name: { [require('sequelize').Op.like]: `%${p.name.trim()}%` },
                        imageUri: {
                            [require('sequelize').Op.notIn]: ['', 'data:image/png;base64']
                        }
                    }
                });
                if (fuzzyOne) {
                    p.imageUri = fuzzyOne.imageUri;
                    await p.save();
                    console.log(`[REPAIRED FUZZY] "${p.name}" (Used image from "${fuzzyOne.name}")`);
                    fixedCount++;
                }
            }
        }

        console.log(`\n--- FINISHED ---`);
        console.log(`Total repaired: ${fixedCount} of ${brokenProducts.length}`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

fixBrokenImages();
