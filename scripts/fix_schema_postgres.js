const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = new Sequelize(
    process.env.DB_NAME || 'americanpos',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: console.log
    }
);

async function fixSchema() {
    try {
        await sequelize.authenticate();
        console.log('Connected to Postgres.');

        const tables = await sequelize.getQueryInterface().showAllTables();
        console.log('Tables:', tables);

        if (tables.includes('Customers')) {
            console.log('Fixing Customers table...');
            
            // Function to add column if not exists
            const addColumn = async (col, type) => {
                try {
                    await sequelize.query(`ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "${col}" ${type}`);
                    console.log(`Added/Checked column: ${col}`);
                } catch (e) {
                    console.error(`Error adding column ${col}:`, e.message);
                }
            };

            await addColumn('idDocument', 'VARCHAR(255)');
            await addColumn('companyId', 'VARCHAR(255)');
            await addColumn('loyaltyPoints', 'DECIMAL(20,6) DEFAULT 0');
            await addColumn('isVIP', 'BOOLEAN DEFAULT FALSE');
            await addColumn('isActive', 'BOOLEAN DEFAULT TRUE');
            
            console.log('Customers table fix completed.');
        } else {
            console.log('Customers table not found.');
        }

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

fixSchema();
