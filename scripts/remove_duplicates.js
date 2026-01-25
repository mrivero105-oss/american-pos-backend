const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');

try {
    const data = fs.readFileSync(dbPath, 'utf8');
    const db = JSON.parse(data);

    if (!db.products || !Array.isArray(db.products)) {
        console.error('No products array found in db.json');
        process.exit(1);
    }

    const products = db.products;
    console.log(`Total products before cleanup: ${products.length}`);

    const uniqueProducts = [];
    const seen = new Set();
    let duplicatesCount = 0;

    // Process products in reverse order to keep the latest ones (assuming higher IDs are newer)
    // Or just process normally and keep first. Let's keep the first occurrence as "original" 
    // but usually users want the latest data. 
    // Let's assume the user wants to keep one instance. 
    // We will use name + barcode as unique key.

    products.forEach(product => {
        // Create a unique key based on name and barcode (if available)
        // If barcode is missing, use name only.
        const key = `${product.name?.trim().toLowerCase()}|${product.barcode?.trim() || ''}`;

        if (!seen.has(key)) {
            seen.add(key);
            uniqueProducts.push(product);
        } else {
            duplicatesCount++;
        }
    });

    db.products = uniqueProducts;

    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log(`Cleanup complete.`);
    console.log(`Removed ${duplicatesCount} duplicates.`);
    console.log(`Total products after cleanup: ${uniqueProducts.length}`);

} catch (err) {
    console.error('Error processing db.json:', err);
}
