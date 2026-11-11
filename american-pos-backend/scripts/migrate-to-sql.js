const fs = require('fs');
const path = require('path');
const { connectDB } = require('../database/connection');
const {
    Product,
    Customer,
    Sale,
    User,
    Supplier,
    CashShift,
    Refund,
    CreditHistory
} = require('../database/models');

const DB_FILE = path.join(__dirname, '../db.json');

const migrate = async () => {
    console.log('Starting migration...');

    // 1. Connect and Sync Database
    await connectDB();

    // 2. Read DB.json
    if (!fs.existsSync(DB_FILE)) {
        console.error('db.json not found!');
        process.exit(1);
    }

    const rawData = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(rawData);

    try {
        // 3. Migrate Products
        if (data.products && data.products.length > 0) {
            console.log(`Migrating ${data.products.length} products...`);
            await Product.bulkCreate(data.products, { ignoreDuplicates: true });
        }

        // 4. Migrate Customers
        if (data.customers && data.customers.length > 0) {
            console.log(`Migrating ${data.customers.length} customers...`);
            await Customer.bulkCreate(data.customers, { ignoreDuplicates: true });
        }

        // 5. Migrate Sales
        if (data.sales && data.sales.length > 0) {
            console.log(`Migrating ${data.sales.length} sales...`);
            // Ensure JSON fields like items/paymentMethod are passed as objects (bulkCreate handles it)
            // But db.json might have them as objects already. Sequelize handles object->JSON string automatically.
            await Sale.bulkCreate(data.sales, { ignoreDuplicates: true });
        }

        // 6. Migrate Users
        if (data.users && data.users.length > 0) {
            console.log(`Migrating ${data.users.length} users...`);
            await User.bulkCreate(data.users, { ignoreDuplicates: true });
        }

        // 7. Migrate Suppliers
        if (data.suppliers && data.suppliers.length > 0) {
            console.log(`Migrating ${data.suppliers.length} suppliers...`);
            await Supplier.bulkCreate(data.suppliers, { ignoreDuplicates: true });
        }

        // 8. Migrate CashShifts
        if (data.cash_shifts && data.cash_shifts.length > 0) {
            console.log(`Migrating ${data.cash_shifts.length} cash shifts...`);
            await CashShift.bulkCreate(data.cash_shifts, { ignoreDuplicates: true });
        }

        // 9. Migrate Refunds
        if (data.refunds && data.refunds.length > 0) {
            console.log(`Migrating ${data.refunds.length} refunds...`);
            await Refund.bulkCreate(data.refunds, { ignoreDuplicates: true });
        }

        // 10. Migrate Credit History
        if (data.credit_history && data.credit_history.length > 0) {
            console.log(`Migrating ${data.credit_history.length} credit history records...`);
            await CreditHistory.bulkCreate(data.credit_history, { ignoreDuplicates: true });
        }

        console.log('Migration completed successfully! ✅');
        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
