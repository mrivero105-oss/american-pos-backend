const { sequelize } = require('../database/connection');

async function inspectSaleItems() {
    const [cols] = await sequelize.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'SaleItems'
    `);
    console.log('SALE_ITEMS_COLUMNS:', cols);
    const [sample] = await sequelize.query('SELECT * FROM "SaleItems" LIMIT 1');
    console.log('SAMPLE_SALE_ITEM:', sample[0]);
    process.exit(0);
}

inspectSaleItems();
