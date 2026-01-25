const { Sequelize } = require('sequelize');
const path = require('path');

// Initialize Sequelize with SQLite
// Use USER_DATA_PATH env var if available (set by Electron main process)
// Otherwise fallback to local directory (dev mode)
const storagePath = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'pos.sqlite')
    : path.join(__dirname, 'pos.sqlite');

console.log('Database storage path:', storagePath);

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: storagePath,
    logging: false // Disable logging for cleaner output
});

const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('Connection to SQLite has been established successfully.');

        // Sync models with database
        // alter: true updates tables if models change (safe for dev, cautious for prod)
        await sequelize.sync({ alter: true });
        console.log('Database synced successfully.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
};

module.exports = { sequelize, connectDB };
