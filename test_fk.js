const { sequelize } = require('./database/connection');
sequelize.query("SELECT m.name AS table_name, p.* FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) p ON m.type = 'table'").then(([results]) => {
    console.log(results);
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
