const { Product } = require('./database/models');

async function fixData() {
    try {
        const products = await Product.findAll({ where: { userId: '2' } });
        let fixedCount = 0;

        for (const p of products) {
            let changed = false;
            const originalCat = p.category;
            const originalBarcode = p.barcode;
            const originalImage = p.imageUri;
            const originalStock = p.stock;

            // Fix encoding helper
            const fixEncoding = (str) => {
                if (!str) return str;
                return str.replace(/VÃ\xadveres/g, 'Víveres')
                    .replace(/categorÃ\xada/gi, 'categoría')
                    .replace(/Ã\xa1/g, 'á')
                    .replace(/Ã©/g, 'é')
                    .replace(/Ã\xad/g, 'í')
                    .replace(/Ã³/g, 'ó')
                    .replace(/Ãº/g, 'ú')
                    .replace(/Ã±/g, 'ñ');
            };

            const isNumericCat = originalCat && /^[0-9.]+$/.test(originalCat);

            if (isNumericCat) {
                // Pattern A: Jugo/Shampoo shift
                // Cat (Price), Barcode (Stock), Image (Category)
                if (originalImage && !originalImage.startsWith('data:') && !originalImage.includes('.')) {
                    p.category = fixEncoding(originalImage);
                    p.price = parseFloat(originalCat);
                    p.stock = parseFloat(originalBarcode) || 0;
                    p.stockQuantity = p.stock;
                    p.barcode = '';
                    p.imageUri = '';
                    changed = true;
                }
                // Pattern B: Dorito/Salsa shift
                // Cat (Stock), Barcode (Category), Stock (Price)
                else if (originalBarcode && isNaN(parseFloat(originalBarcode))) {
                    p.category = fixEncoding(originalBarcode);
                    p.price = originalStock;
                    p.stock = parseFloat(originalCat);
                    p.stockQuantity = p.stock;
                    p.barcode = '';
                    changed = true;
                }
            }

            if (changed) {
                await p.save();
                console.log(`[FIXED] ${p.name} -> Cat: ${p.category}, Price: ${p.price}, Stock: ${p.stock}`);
                fixedCount++;
            }
        }

        console.log(`\nDone! Fixed ${fixedCount} products.`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

// NOTE: This script is prepared but NOT run automatically for safety.
// We will call it after user confirmation.
fixData();
