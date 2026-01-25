const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const PAYMENT_METHODS_FILE = path.join(__dirname, 'payment_methods.json');

function escapeString(str) {
    if (str === null || str === undefined) return 'NULL';
    return "'" + String(str).replace(/'/g, "''") + "'";
}

function generateInserts() {
    let sql = '';

    // 1. Products
    const productIds = new Set();
    if (fs.existsSync(DB_FILE)) {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (db.products) {
            db.products.forEach(p => {
                productIds.add(p.id);
                sql += `INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, isCustom) VALUES (${escapeString(p.id)}, ${escapeString(p.name)}, ${p.price}, ${p.priceBs || 'NULL'}, ${p.stock || p.stockQuantity || 0}, ${escapeString(p.category)}, ${escapeString(p.barcode)}, ${escapeString(p.imageUri)}, ${p.isCustom ? 1 : 0});\n`;
            });
        }

        // 2. Customers
        if (db.customers) {
            db.customers.forEach(c => {
                sql += `INSERT INTO customers (id, name, idDocument, phone, email, address) VALUES (${escapeString(c.id)}, ${escapeString(c.name)}, ${escapeString(c.idDocument)}, ${escapeString(c.phone)}, ${escapeString(c.email)}, ${escapeString(c.address)});\n`;
            });
        }

        // 3. Sales & Sale Items
        if (db.sales) {
            db.sales.forEach(s => {
                // Check if sale has items with valid products
                let validItems = [];
                if (s.items) {
                    validItems = s.items.filter(item => productIds.has(item.productId || item.id));
                }

                if (validItems.length > 0) {
                    sql += `INSERT INTO sales (id, timestamp, total, exchangeRate, paymentMethod, customerId) VALUES (${escapeString(s.id)}, ${escapeString(s.timestamp)}, ${s.total}, ${s.exchangeRate || 1.0}, ${escapeString(s.paymentMethod)}, ${escapeString(s.customerId)});\n`;
                    validItems.forEach(item => {
                        sql += `INSERT INTO sale_items (saleId, productId, name, price, quantity) VALUES (${escapeString(s.id)}, ${escapeString(item.productId || item.id)}, ${escapeString(item.name)}, ${item.price}, ${item.quantity});\n`;
                    });
                }
            });
        }
    }

    // 4. Settings
    if (fs.existsSync(SETTINGS_FILE)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        if (settings.exchangeRate) {
            sql += `INSERT OR REPLACE INTO settings (key, value) VALUES ('exchangeRate', ${escapeString(settings.exchangeRate)});\n`;
        }
        if (settings.businessInfo) {
            sql += `INSERT OR REPLACE INTO settings (key, value) VALUES ('businessInfo', ${escapeString(JSON.stringify(settings.businessInfo))});\n`;
        }
    }

    // 5. Payment Methods
    if (fs.existsSync(PAYMENT_METHODS_FILE)) {
        const methods = JSON.parse(fs.readFileSync(PAYMENT_METHODS_FILE, 'utf8'));
        methods.forEach(pm => {
            sql += `INSERT INTO payment_methods (id, name, type) VALUES (${escapeString(pm.id)}, ${escapeString(pm.name)}, ${escapeString(pm.type || 'other')});\n`;
        });
    }

    fs.writeFileSync('migration.sql', sql);
    console.log('migration.sql created successfully!');
}

generateInserts();
