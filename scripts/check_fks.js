
const { sequelize } = require('./database/connection');

async function check() {
    try {
        const [tables] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table'");
        for (const table of tables) {
            const [fks] = await sequelize.query(`PRAGMA foreign_key_list("${table.name}")`);
            if (fks.length > 0) {
                console.log(`Foreign Keys for ${table.name}:`);
                console.log(fks.map(f => `To ${f.table}: ${f.from} -> ${f.to}`));
            }
        }
    } catch (e) {
        console.error(e);
    }
}

check();
