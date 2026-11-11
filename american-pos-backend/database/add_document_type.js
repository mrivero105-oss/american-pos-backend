const { sequelize } = require('./connection');

async function run() {
    try {
        await sequelize.query("ALTER TABLE Sales ADD COLUMN documentType VARCHAR(255) DEFAULT 'factura';");
        console.log('Column documentType added locally to Sales table.');
    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            console.log('Column documentType already exists. Skipping...');
        } else {
            console.error('Migration error:', error);
        }
    } finally {
        await sequelize.close();
    }
}

run();
