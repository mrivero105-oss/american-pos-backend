const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database', 'pos.sqlite'),
    logging: console.log
});

async function runMigration() {
    try {
        await sequelize.authenticate();
        console.log('Connected to database.');

        // --- USERS ---
        console.log('Fixing Users table...');
        try { await sequelize.query("ALTER TABLE Users ADD COLUMN username STRING;"); } catch (e) { }
        try { await sequelize.query("ALTER TABLE Users ADD COLUMN trial_expires_at STRING;"); } catch (e) { }
        await sequelize.query("UPDATE Users SET username = email WHERE username IS NULL OR username = '';");

        // --- SALES ---
        console.log('Fixing Sales table...');
        try { await sequelize.query("ALTER TABLE Sales ADD COLUMN items JSON;"); } catch (e) { }
        try { await sequelize.query("ALTER TABLE Sales ADD COLUMN date STRING;"); } catch (e) { }
        try { await sequelize.query("ALTER TABLE Sales ADD COLUMN customerName STRING;"); } catch (e) { }
        try { await sequelize.query("ALTER TABLE Sales ADD COLUMN status STRING DEFAULT 'completed';"); } catch (e) { }
        try { await sequelize.query("ALTER TABLE Sales ADD COLUMN subtotal FLOAT;"); } catch (e) { }
        try { await sequelize.query("ALTER TABLE Sales ADD COLUMN tax FLOAT;"); } catch (e) { }
        try { await sequelize.query("ALTER TABLE Sales ADD COLUMN discount FLOAT;"); } catch (e) { }

        await sequelize.query("UPDATE Sales SET date = timestamp WHERE date IS NULL;");
        await sequelize.query("UPDATE Sales SET items = '[]' WHERE items IS NULL;");

        // --- SUPPLIERS ---
        console.log('Fixing Suppliers table...');
        try { await sequelize.query("ALTER TABLE Suppliers ADD COLUMN notes TEXT;"); } catch (e) { }

        // --- PRODUCTS ---
        console.log('Fixing Products table...');
        try { await sequelize.query("ALTER TABLE Products ADD COLUMN cost FLOAT;"); } catch (e) { }

        // --- GLOBAL TIMESTAMPS ---
        const tablesNeedTimestamps = ['Products', 'Sales', 'Customers', 'Suppliers', 'Users'];
        for (const table of tablesNeedTimestamps) {
            console.log(`Adding timestamps to ${table}...`);
            try { await sequelize.query(`ALTER TABLE ${table} ADD COLUMN createdAt STRING;`); } catch (e) { }
            try { await sequelize.query(`ALTER TABLE ${table} ADD COLUMN updatedAt STRING;`); } catch (e) { }
            // Backfill
            const now = new Date().toISOString();
            await sequelize.query(`UPDATE ${table} SET createdAt = '${now}' WHERE createdAt IS NULL;`);
            await sequelize.query(`UPDATE ${table} SET updatedAt = '${now}' WHERE updatedAt IS NULL;`);
        }

        console.log('Migration completed successfully.');

    } catch (error) {
        console.error('Migration failed:', error);
    }
}

runMigration();
