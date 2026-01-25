const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database', 'pos.sqlite'),
    logging: console.log
});

async function fixAccess() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        const email = 'mrivero105@gmail.com';
        const password = 'admin';

        // 1. Get the user ID
        const [users] = await sequelize.query(`SELECT id FROM Users WHERE email = '${email}'`);

        if (users.length === 0) {
            console.error('User not found!');
            return;
        }

        const userId = users[0].id;
        console.log(`Found User ID: ${userId} for ${email}`);

        // 2. Reset Password
        await sequelize.query(`UPDATE Users SET password = '${password}' WHERE id = '${userId}'`);
        console.log(`Password for ${email} reset to '${password}'`);

        // 3. Reassign Data to this user (Undo previous assignment to admin@test.com)
        const tables = ['Products', 'Sales', 'Customers', 'Suppliers'];
        for (const table of tables) {
            console.log(`Assigning ${table} to ${userId}...`);
            await sequelize.query(`UPDATE ${table} SET userId = '${userId}'`);
        }

        console.log('Access fixed completely.');

    } catch (error) {
        console.error('Error:', error);
    }
}

fixAccess();
