const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database', 'pos.sqlite'),
    logging: false
});

async function inspectData() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        const [users] = await sequelize.query("SELECT id, username, email FROM Users");
        console.log('Users found:', users);

        const [products] = await sequelize.query("SELECT id, name, userId FROM Products LIMIT 5");
        console.log('Sample Products:', products);

        const [count] = await sequelize.query("SELECT COUNT(*) as count FROM Products");
        console.log('Total Products:', count[0].count);

    } catch (error) {
        console.error('Error:', error);
    }
}

inspectData();
