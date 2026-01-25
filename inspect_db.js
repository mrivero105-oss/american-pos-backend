const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database', 'pos.sqlite'),
    logging: false
});

async function inspect() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        const tables = ['Products', 'Users', 'Sales', 'Customers', 'Suppliers'];

        for (const table of tables) {
            try {
                const [columns] = await sequelize.query(`PRAGMA table_info(${table});`);
                console.log(`Columns in ${table} table:`, columns.map(c => c.name));
            } catch (e) {
                console.log(`Error inspecting ${table}:`, e.message);
            }
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

inspect();
