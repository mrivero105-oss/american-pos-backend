const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
const OUTPUT_FILE = path.join(__dirname, 'import_data.sql');

if (!fs.existsSync(DB_FILE)) {
    console.error('db.json not found!');
    process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
let sql = 'PRAGMA foreign_keys = OFF;\n';

// Products
if (db.products && db.products.length > 0) {
    console.log(`Migrating ${db.products.length} products...`);
    sql += '-- Products\n';
    db.products.forEach(p => {
        const isCustom = p.isCustom ? 1 : 0;
        const name = (p.name || '').replace(/'/g, "''");
        const category = (p.category || 'General').replace(/'/g, "''");
        const barcode = (p.barcode || '').replace(/'/g, "''");
        const imageUri = (p.imageUri || '').replace(/'/g, "''");

        const stock = p.stock !== undefined ? p.stock : (p.stockQuantity || 0);
        sql += `INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, isCustom) VALUES ('${p.id}', '${name}', ${p.price || 0}, ${p.priceBs || 'NULL'}, ${stock}, '${category}', '${barcode}', '${imageUri}', ${isCustom});\n`;
    });
    sql += '\n';
}

// Customers
if (db.customers && db.customers.length > 0) {
    console.log(`Migrating ${db.customers.length} customers...`);
    sql += '-- Customers\n';
    db.customers.forEach(c => {
        const name = (c.name || '').replace(/'/g, "''");
        const idDocument = (c.idDocument || '').replace(/'/g, "''");
        const phone = (c.phone || '').replace(/'/g, "''");
        const email = (c.email || '').replace(/'/g, "''");
        const address = (c.address || '').replace(/'/g, "''");

        sql += `INSERT INTO customers (id, name, idDocument, phone, email, address) VALUES ('${c.id}', '${name}', '${idDocument}', '${phone}', '${email}', '${address}');\n`;
    });
    sql += '\n';
}

// Sales
if (db.sales && db.sales.length > 0) {
    console.log(`Migrating ${db.sales.length} sales...`);
    sql += '-- Sales\n';
    db.sales.forEach(s => {
        const paymentMethod = (s.paymentMethod || '').replace(/'/g, "''");
        const customerId = s.customerId ? `'${s.customerId}'` : 'NULL';

        sql += `INSERT INTO sales (id, timestamp, total, exchangeRate, paymentMethod, customerId) VALUES ('${s.id}', '${s.timestamp}', ${s.total || 0}, ${s.exchangeRate || 1}, '${paymentMethod}', ${customerId});\n`;

        if (s.items && s.items.length > 0) {
            s.items.forEach(item => {
                const itemName = (item.name || '').replace(/'/g, "''");
                const productId = item.productId || item.id; // Handle legacy format
                const finalProductId = productId ? `'${productId}'` : 'NULL';

                sql += `INSERT INTO sale_items (saleId, productId, name, price, quantity) VALUES ('${s.id}', ${finalProductId}, '${itemName}', ${item.price || 0}, ${item.quantity || 1});\n`;
            });
        }
    });
    sql += '\n';
}

fs.writeFileSync(OUTPUT_FILE, sql);
console.log(`Migration script generated at ${OUTPUT_FILE}`);
