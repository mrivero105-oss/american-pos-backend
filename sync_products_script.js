// Script para sincronizar productos faltantes de db.json a D1
const fs = require('fs');

// Leer productos del db.json local
const dbLocal = JSON.parse(fs.readFileSync('db.json', 'utf8'));
const localProducts = dbLocal.products || [];

console.log(`Productos en db.json: ${localProducts.length}`);

// Necesitamos comparar con los IDs que están en D1
// Por ahora, generamos SQL para insertar todos los productos
// Usaremos INSERT OR IGNORE para evitar duplicados

const insertStatements = [];

localProducts.forEach(p => {
    const id = p.id || '';
    const name = (p.name || '').replace(/'/g, "''");
    const price = p.price || 0;
    const priceBs = p.priceBs || 'NULL';
    const stockQuantity = p.stockQuantity !== undefined ? p.stockQuantity : (p.stock || 0);
    const category = (p.category || 'General').replace(/'/g, "''");
    const barcode = (p.barcode || '').replace(/'/g, "''");
    const imageUri = (p.imageUri || '').replace(/'/g, "''");
    const isCustom = p.isCustom ? 1 : 0;
    const isSoldByWeight = p.isSoldByWeight ? 1 : 0;
    const userId = p.userId || 'user-1';

    const priceBsStr = priceBs === 'NULL' ? 'NULL' : priceBs;

    insertStatements.push(
        `INSERT OR IGNORE INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, isCustom, isSoldByWeight, userId) ` +
        `VALUES ('${id}', '${name}', ${price}, ${priceBsStr}, ${stockQuantity}, '${category}', '${barcode}', '${imageUri}', ${isCustom}, ${isSoldByWeight}, '${userId}');`
    );
});

// Escribir a archivo SQL
fs.writeFileSync('sync_products.sql', insertStatements.join('\n'));
console.log(`Generados ${insertStatements.length} INSERT statements en sync_products.sql`);
