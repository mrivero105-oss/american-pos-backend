
const { sequelize } = require('./database/connection');

async function clean() {
    try {
        await sequelize.query("PRAGMA foreign_keys = OFF");
        const legacyTables = ['sale_items', 'sales', 'products', 'customers', 'suppliers', 'cash_shifts', 'purchase_orders', 'refunds', 'credit_history', 'password_resets'];
        for (const table of legacyTables) {
            try {
                await sequelize.query(`DROP TABLE IF EXISTS "${table}"`);
                console.log(`Dropped legacy table: ${table}`);
            } catch (e) {
                console.log(`Error dropping ${table}:`, e.message);
            }
        }
        await sequelize.query("PRAGMA foreign_keys = ON");

        // Final check of current tables
        const [tables] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table'");
        console.log('Remaining Tables:', tables.map(t => t.name));
    } catch (e) {
        console.error(e);
    }
}

clean();
