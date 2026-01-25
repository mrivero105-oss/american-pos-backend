
const { sequelize } = require('./database/connection');

async function clean() {
    try {
        const legacyTables = ['sales', 'products', 'customers', 'suppliers', 'cash_shifts', 'purchase_orders', 'refunds', 'credit_history'];
        for (const table of legacyTables) {
            try {
                await sequelize.query(`DROP TABLE IF EXISTS "${table}"`);
                console.log(`Dropped legacy table (if existed): ${table}`);
            } catch (e) {
                console.log(`Error dropping ${table}:`, e.message);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

clean();
