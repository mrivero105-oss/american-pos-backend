const { sequelize } = require('./database/connection');
const { CashShift } = require('./database/models');

async function checkSchema() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        const [results] = await sequelize.query("PRAGMA table_info(CashShifts)");
        console.log('SCHEMA_JSON_START');
        console.log(JSON.stringify(results, null, 2));
        console.log('SCHEMA_JSON_END');

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkSchema();
