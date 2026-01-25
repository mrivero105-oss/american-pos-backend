
const { sequelize } = require('./database/connection');

async function findReferences() {
    try {
        const [results] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%REFERENCES%Users%'");
        console.log('Tables referencing Users:', results.map(r => r.name));
    } catch (e) {
        console.error(e);
    }
}

findReferences();
