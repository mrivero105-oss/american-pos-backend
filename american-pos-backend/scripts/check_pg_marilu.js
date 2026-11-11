const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require(path.join(__dirname, '..', 'database', 'connection'));

async function check() {
    try {
        const [rows] = await sequelize.query('SELECT name, "createdAt" FROM "Products" ORDER BY "createdAt" ASC LIMIT 5');
        const [total] = await sequelize.query('SELECT count(*) as total FROM "Products"');
        console.log('TOTAL PRODUCTS IN PG:', total[0].total);
        console.log('PG FIRST 5:', rows);
    } catch (e) {
        console.error(e.message);
    } finally {
        await sequelize.close();
    }
}
check();
