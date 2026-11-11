const { sequelize, User, Product, Sale, Customer, Expense, Supplier, PurchaseOrder, CashShift, CashMovement, Refund, CreditHistory, StockMovement, AuditLog, Branch } = require('./models');

async function runMigration() {
    try {
        console.log('--- Iniciando Migración Multi-Tenant ---');
        await sequelize.authenticate();

        // 1. Manually add companyId column to all tables
        console.log('1. Añadiendo columna companyId a las tablas...');
        const tables = [
            'Users', 'Products', 'Sales', 'Customers', 'Expenses', 'Suppliers',
            'PurchaseOrders', 'CashShifts', 'CashMovements', 'Refunds',
            'CreditHistories', 'StockMovements', 'AuditLogs', 'Branches'
        ];

        for (const table of tables) {
            try {
                await sequelize.query(`ALTER TABLE ${table} ADD COLUMN companyId TEXT`);
                console.log(`[Schema] Added companyId to ${table}`);
            } catch (err) {
                // Ignore if column already exists
                if (err.message && err.message.includes('duplicate column name')) {
                    // It's fine
                } else if (err.message && err.message.includes('no such table')) {
                    console.log(`[Schema] Table ${table} does not exist yet.`);
                } else {
                    console.log(`[Schema] (Ignored) ${table}: ${err.message}`);
                }
            }
        }

        // 2. Find all Superadmins to set as Tenants
        console.log('2. Asignando companyId a usuarios Superadmin...');
        const superadmins = await User.findAll({ where: { role: 'superadmin' } });

        let defaultTenantId = null;
        if (superadmins.length > 0) {
            defaultTenantId = superadmins[0].id;
            console.log(`Se encontró al menos un superadmin. Se usará ${defaultTenantId} como Tenant por defecto si hay huérfanos.`);
        } else {
            console.log('⚠️ No se encontraron superadmins. La migración podría dejar registros huérfanos.');
        }

        // 3. Update all Users
        const users = await User.findAll();
        for (const user of users) {
            if (!user.companyId) {
                // If the user has a master user (superadmin), they should ideally get their ID.
                // Since there was no hierarchy before, we assume ALL existing users belong to the first Superadmin
                // OR if they are superadmin, they are their own company.
                const newCompanyId = user.role === 'superadmin' ? user.id : defaultTenantId;
                if (newCompanyId) {
                    await user.update({ companyId: newCompanyId });
                    console.log(`Usuario ${user.email} asignado a companyId: ${newCompanyId}`);
                }
            }
        }

        // 4. Update all other entities to inherit companyId from their creator (userId)
        // Helper function to migrate a model
        const migrateModel = async (Model, modelName) => {
            console.log(`3. Migrando tabla ${modelName}...`);
            const records = await Model.findAll();
            let updated = 0;
            for (const record of records) {
                if (!record.companyId) {
                    // Try to find the user who created this to get their companyId
                    let cId = defaultTenantId;
                    if (record.userId) {
                        const creator = users.find(u => u.id === record.userId);
                        if (creator && creator.companyId) {
                            cId = creator.companyId;
                        } else if (creator && creator.role === 'superadmin') {
                            cId = creator.id;
                        }
                    }

                    if (cId) {
                        await record.update({ companyId: cId });
                        updated++;
                    }
                }
            }
            console.log(`   -> ${updated} registros actualizados en ${modelName}.`);
        };

        const modelsToMigrate = [
            { model: Product, name: 'Products' },
            { model: Sale, name: 'Sales' },
            { model: Customer, name: 'Customers' },
            { model: Expense, name: 'Expenses' },
            { model: Supplier, name: 'Suppliers' },
            { model: PurchaseOrder, name: 'PurchaseOrders' },
            { model: CashShift, name: 'CashShifts' },
            { model: CashMovement, name: 'CashMovements' },
            { model: Refund, name: 'Refunds' },
            { model: CreditHistory, name: 'CreditHistories' },
            { model: StockMovement, name: 'StockMovements' },
            { model: AuditLog, name: 'AuditLogs' },
            { model: Branch, name: 'Branches' }
        ];

        for (const item of modelsToMigrate) {
            await migrateModel(item.model, item.name);
        }

        console.log('--- Migración Multi-Tenant Completada Exitosamente ---');
        process.exit(0);
    } catch (error) {
        console.error('ERROR CRÍTICO en la migración:', error);
        process.exit(1);
    }
}

runMigration();
