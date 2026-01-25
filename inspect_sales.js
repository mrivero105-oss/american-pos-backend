const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database', 'pos.sqlite'),
    logging: false
});

async function inspectSales() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        const [sales] = await sequelize.query("SELECT id, date, items, paymentMethod, userId FROM Sales LIMIT 5");
        console.log('Sample Sales:', JSON.stringify(sales, null, 2));

        // Check for null dates
        const [nullDates] = await sequelize.query("SELECT COUNT(*) as count FROM Sales WHERE date IS NULL");
        console.log('Sales with NULL date:', nullDates[0].count);

        // Check for invalid JSON in items?
        // just printing them is a good start.

    } catch (error) {
        console.error('Error:', error);
    }
}

inspectSales();
