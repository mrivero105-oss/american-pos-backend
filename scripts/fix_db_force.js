const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Target the actual production DB path explicitly
const appDataPath = path.join('C:', 'Users', 'mrive', 'AppData', 'Roaming', 'american-pos-backend');
const dbPath = path.join(appDataPath, 'pos.sqlite');

console.log('Force Fix: Targeting DB at:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.error('Force Fix: DB file NOT FOUND at expected path.');
    process.exit(1);
}

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: console.log
});

async function forceFix() {
    try {
        await sequelize.authenticate();
        console.log('Force Fix: Connection successful.');

        try {
            console.log('Force Fix: Attempting to add isActive column...');
            await sequelize.query('ALTER TABLE Customers ADD COLUMN isActive BOOLEAN DEFAULT 1;');
            console.log('Force Fix: SUCCESS - Added isActive column.');
        } catch (err) {
            if (err.message && err.message.includes('duplicate column')) {
                console.log('Force Fix: Column already exists.');
            } else {
                console.log('Force Fix: Error adding column (might be okay if exists):', err.message);
            }
        }
    } catch (error) {
        console.error('Force Fix: Fatal error:', error);
    } finally {
        await sequelize.close();
    }
}

forceFix();
