const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Target the production DB path
const appDataPath = path.join('C:', 'Users', 'mrive', 'AppData', 'Roaming', 'american-pos-backend');
const dbPath = path.join(appDataPath, 'pos.sqlite');

console.log('Diagnostic: Checking DB at:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.error('Diagnostic: DB file NOT FOUND at expected path.');
    // Check fallback/dev path
    const devDbPath = path.join(__dirname, '..', 'database', 'pos.sqlite');
    console.log('Diagnostic: Checking dev DB at:', devDbPath);
    if (fs.existsSync(devDbPath)) {
        console.log('Diagnostic: Dev DB found.');
    }
} else {
    console.log('Diagnostic: DB file exists.');
}

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false
});

async function inspect() {
    try {
        await sequelize.authenticate();
        console.log('Diagnostic: Connection successful.');

        const [results, metadata] = await sequelize.query("PRAGMA table_info(Customers);");
        console.log('Diagnostic: Columns in Customers table:');
        const columns = results.map(c => c.name);
        console.log(columns);

        if (columns.includes('isActive')) {
            console.log('Diagnostic: SUCCESS - isActive column IS present.');
        } else {
            console.log('Diagnostic: FAILURE - isActive column is MISSING.');
        }

    } catch (error) {
        console.error('Diagnostic: Error during inspection:', error);
    } finally {
        await sequelize.close();
    }
}

inspect();
