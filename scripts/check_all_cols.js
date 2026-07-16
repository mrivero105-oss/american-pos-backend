
const { sequelize } = require('./database/connection');

async function checkAll() {
    try {
        const [tables] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table'");
        for (const table of tables) {
            const [cols] = await sequelize.query(`PRAGMA table_info(${table.name})`);
            console.log(`Table: ${table.name}`);
            console.log(cols.map(c => `${c.name} (${c.type}) ${c.notnull ? 'NOT NULL' : ''}`));
            console.log('---');
        }
    } catch (e) {
        console.error(e);
    }
}

checkAll();
