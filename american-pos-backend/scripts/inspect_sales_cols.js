const { sequelize } = require('../database/connection');

async function inspectSalesColumns() {
    const [cols] = await sequelize.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'Sales'
    `);
    console.log('SALES_COLUMNS:', cols);
    const [sample] = await sequelize.query('SELECT * FROM "Sales" LIMIT 1');
    console.log('SAMPLE_SALE:', sample[0]);
    process.exit(0);
}

inspectSalesColumns();
