const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const categoryImages = {
    'General': 'assets/categories/general.png',
    'Víveres': 'assets/categories/viveres.png',
    'Higiene Personal': 'assets/categories/higiene.png',
    'Farmacia': 'assets/categories/farmacia.png',
    'Alimentos': 'assets/categories/alimentos.png',
    'Charcutería': 'assets/categories/charcuteria.png',
    'Bebidas': 'assets/categories/bebidas.png',
    'Quicalleria': 'assets/categories/quicalleria.png'
};

let updatedCount = 0;

db.products = db.products.map(product => {
    if (categoryImages[product.category]) {
        product.imageUri = categoryImages[product.category];
        updatedCount++;
    }
    return product;
});

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log(`Updated ${updatedCount} products with new 4D images.`);
