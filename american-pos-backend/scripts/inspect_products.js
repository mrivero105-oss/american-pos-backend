const { sequelize } = require('../database/connection');

async function inspect() {
    const [res] = await sequelize.query('SELECT id, name, price, stock, barcode, category FROM "Products" LIMIT 5');
    console.log('PRODUCTS_SAMPLE:', res);
    process.exit(0);
}

inspect();
