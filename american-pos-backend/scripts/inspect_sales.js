const { sequelize } = require('../database/connection');

async function inspectSales() {
    const [res] = await sequelize.query('SELECT id, "invoiceNumber", "customerName", total FROM "Sales" LIMIT 3');
    console.log('SALES_SAMPLE:', res);
    process.exit(0);
}

inspectSales();
