
const { sequelize } = require('./database/connection');

async function checkSchema() {
    try {
        const [results] = await sequelize.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='Customers'");
        console.log('Customers Schema:', results[0]?.sql);
    } catch (e) {
        console.error(e);
    }
}

checkSchema();
