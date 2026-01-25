const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database', 'pos.sqlite'),
    logging: console.log
});

async function reassignData() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        // Target User: admin@test.com (ID: 1764206702166 found in previous step)
        // Or we can dynamically find the admin user.
        const [users] = await sequelize.query("SELECT id FROM Users WHERE username = 'admin@test.com' OR email = 'admin@test.com' LIMIT 1");

        let targetId;
        if (users.length > 0) {
            targetId = users[0].id;
            console.log(`Found target user (admin): ${targetId}`);
        } else {
            console.log("Admin user not found, defaulting to finding ANY user that is not user-1");
            // Fallback logic could go here, but let's stick to the known ID fromlogs if needed, 
            // or just use the one we saw: '1764206702166'
            targetId = '1764206702166';
        }

        const tables = ['Products', 'Sales', 'Customers', 'Suppliers', 'CashShifts'];

        for (const table of tables) {
            console.log(`Reassigning ${table} to ${targetId}...`);
            try {
                // Update everything that is NOT the target ID (e.g. user-1) to the target ID
                await sequelize.query(`UPDATE ${table} SET userId = '${targetId}' WHERE userId != '${targetId}' OR userId IS NULL;`);
            } catch (e) {
                console.log(`Error updating ${table} (might not exist or have userId): ${e.message}`);
            }
        }

        console.log('Data reassignment complete.');

    } catch (error) {
        console.error('Error:', error);
    }
}

reassignData();
