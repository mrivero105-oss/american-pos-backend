
const { sequelize } = require('./database/connection');

async function checkColumns() {
    try {
        const [results] = await sequelize.query("PRAGMA table_info(Customers)");
        console.log('Customers Columns:', results.map(r => r.name));
    } catch (e) {
        console.error(e);
    }
}

checkColumns();
