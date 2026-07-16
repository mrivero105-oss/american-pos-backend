const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../db.json');
const ADMIN_ID = 'admin-1';

try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(data);

    let updatedCount = 0;

    // Migrate Products
    if (db.products) {
        db.products = db.products.map(item => {
            if (!item.userId) {
                item.userId = ADMIN_ID;
                updatedCount++;
            }
            return item;
        });
    }

    // Migrate Customers
    if (db.customers) {
        db.customers = db.customers.map(item => {
            if (!item.userId) {
                item.userId = ADMIN_ID;
                updatedCount++;
            }
            return item;
        });
    }

    // Migrate Sales
    if (db.sales) {
        db.sales = db.sales.map(item => {
            if (!item.userId) {
                item.userId = ADMIN_ID;
                updatedCount++;
            }
            return item;
        });
    }

    if (updatedCount > 0) {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        console.log(`Successfully migrated ${updatedCount} items to userId='${ADMIN_ID}'.`);
    } else {
        console.log('No orphan items found.');
    }

} catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
}
