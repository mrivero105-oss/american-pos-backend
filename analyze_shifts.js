const { Product } = require('./database/models');

async function analyzeShifts() {
    try {
        const products = await Product.findAll({ where: { userId: '2' } }); // User in the screenshot
        let total = products.length;
        let numericCats = 0;
        let stats = {
            cat_is_price: 0,
            cat_is_stock: 0
        };

        const examples = [];
        const uniqueCats = new Set();

        products.forEach(p => {
            if (p.category) uniqueCats.add(p.category);
            const isNumericCat = p.category && /^[0-9.]+$/.test(p.category);
            if (isNumericCat) {
                numericCats++;

                // Pattern A: Category is price, ImageUri is Category
                if (p.price === 0 && p.imageUri && !p.imageUri.startsWith('data:') && !p.imageUri.includes('.')) {
                    stats.cat_is_price++;
                }

                // Pattern B: Category is stock, Barcode is Category, Stock is Price
                if (p.price === 0 && p.stock > 0 && p.barcode && isNaN(parseFloat(p.barcode))) {
                    stats.cat_is_stock++;
                }

                examples.push({
                    name: p.name,
                    cat: p.category,
                    price: p.price,
                    stock: p.stock,
                    barcode: p.barcode,
                    image: p.imageUri
                });
            }
        });

        console.log('--- DATA ANALYSIS (User 2) ---');
        console.log(`Total Products: ${total}`);
        console.log(`Unique Categories: ${uniqueCats.size}`);
        console.log(`Products with numeric categories: ${numericCats}`);
        console.log(`Detected shifts:`, stats);
        console.log('\n--- ALL NUMERIC EXAMPLES ---');
        console.log(JSON.stringify(examples, null, 2));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

analyzeShifts();
