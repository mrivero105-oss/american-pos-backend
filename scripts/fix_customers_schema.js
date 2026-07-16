const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const { app } = require('electron'); // This might not work in a standalone script without electron context if pulled directly. 
// Better to use the existing database connection logic or standalone sequelize.

// Standalone script configuration
const dbPath = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'pos.sqlite')
    : path.join(__dirname, '..', '..', 'database', 'pos.sqlite'); // Fallback for dev

console.log('Targeting DB Path:', dbPath);

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: console.log
});

async function migrate() {
    try {
        const queryInterface = sequelize.getQueryInterface();
        const tableDescription = await queryInterface.describeTable('Customers');

        if (!tableDescription.isActive) {
            console.log('Adding isActive column to Customers table...');
            await queryInterface.addColumn('Customers', 'isActive', {
                type: DataTypes.BOOLEAN,
                defaultValue: true
            });
            console.log('Column isActive added successfully.');
        } else {
            console.log('Column isActive already exists.');
        }
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await sequelize.close();
    }
}

migrate();
