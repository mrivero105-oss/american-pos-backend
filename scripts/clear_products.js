const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');

try {
    const data = fs.readFileSync(dbPath, 'utf8');
    const db = JSON.parse(data);

    const count = db.products ? db.products.length : 0;
    db.products = [];

    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log(`Deleted all ${count} products.`);

} catch (err) {
    console.error('Error clearing products:', err);
}
