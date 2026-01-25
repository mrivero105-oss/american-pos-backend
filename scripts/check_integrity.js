const { sequelize } = require('./database/connection');
const { Product, Customer, Sale, User, Supplier } = require('./database/models');

async function checkIntegrity() {
    try {
        await sequelize.authenticate();
        console.log('--- Integrity Check Started ---');

        // Check 1: Sales without Customers
        const orphanSales = await Sale.findAll({
            where: { customerId: null } // Simplified check, ideally check against Customer IDs
        });
        console.log(`Sales without Customer ID: ${orphanSales.length}`);

        // Check 2: Sales with Non-Existent Customers
        // Requires raw query or fetching all IDs. For speed, checking count.
        const [results] = await sequelize.query(`
            SELECT count(*) as count FROM Sales 
            WHERE customerId IS NOT NULL 
            AND customerId NOT IN (SELECT id FROM Customers)
        `);
        console.log(`Sales pointing to non-existent Customers: ${results[0].count}`);

        // Check 3: Products with Invalid Price (Negative)
        const invalidProducts = await Product.count({
            where: sequelize.literal('price < 0 OR stock < 0')
        });
        console.log(`Products with negative price or stock: ${invalidProducts}`);

        // Check 4: Users without Roles
        const invalidUsers = await User.count({
            where: { role: null }
        });
        console.log(`Users without role: ${invalidUsers}`);

        console.log('--- Integrity Check Complete ---');

    } catch (e) {
        console.error('Integrity Check Error:', e);
    } finally {
        await sequelize.close();
    }
}

checkIntegrity();
