const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database', 'pos.sqlite'),
    logging: console.log
});

async function fix() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        // Add the missing column
        try {
            await sequelize.query("ALTER TABLE Products ADD COLUMN stock FLOAT;");
            console.log('Column stock added.');
        } catch (e) {
            console.log('Column stock might already exist or error:', e.message);
        }

        // Sync stock from stockQuantity
        await sequelize.query("UPDATE Products SET stock = stockQuantity WHERE stock IS NULL;");
        console.log('Updated stock values from stockQuantity.');

    } catch (error) {
        console.error('Error:', error);
    }
}

fix();
