const { sequelize } = require('./connection');

async function runMigrations() {
    try {
        console.log('Migration: Starting schema check...');

        const qi = sequelize.getQueryInterface();
        const dial = sequelize.getDialect();

        // Table describe cache to avoid repeated SQLite pragma queries on every startup
        const tableDescCache = new Map();

        // Helper to add column if it doesn't exist
        const addColSafe = async (table, col, def) => {
            try {
                let desc = tableDescCache.get(table);
                if (!desc) {
                    try {
                        desc = await qi.describeTable(table);
                    } catch (e) {
                        // Fallback to lowercase for Postgres/Linux consistency
                        desc = await qi.describeTable(table.toLowerCase());
                    }
                    if (desc) tableDescCache.set(table, desc);
                }

                if (desc && !desc[col]) {
                    console.log(`Migration: Adding column ${col} to ${table}...`);
                    try {
                        await qi.addColumn(table, col, def);
                    } catch (err) {
                        await qi.addColumn(table.toLowerCase(), col, def);
                    }
                    console.log(`Migration: SUCCESS - Added ${col} to ${table}.`);
                    tableDescCache.delete(table); // Invalidate cache if table changed
                }
            } catch (err) {
                console.log(`Migration: Info - ${col} in ${table} check: ${err.message}`);
            }
        };

        await addColSafe('Customers', 'isActive', { type: require('sequelize').BOOLEAN, defaultValue: true });
        await addColSafe('Customers', 'isVIP', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Products', 'stockUnit', { type: require('sequelize').TEXT, defaultValue: 'unidad' });
        await addColSafe('Products', 'isSoldByWeight', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Products', 'isFractional', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Products', 'cost', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'priceBs', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'stockQuantity', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'userId', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'isCustom', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Products', 'status', { type: require('sequelize').TEXT, defaultValue: 'active' });
        await addColSafe('Products', 'allowNegative', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Products', 'bulkUnitName', { type: require('sequelize').TEXT, defaultValue: 'Bulto' });
        await addColSafe('Products', 'unitsPerBulk', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 1 });
        await addColSafe('Products', 'taxStatus', { type: require('sequelize').TEXT, defaultValue: 'gravable' });
        await addColSafe('Products', 'supplierId', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'minStock', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'margin', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'bulkCost', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'es_controlado', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Products', 'batchNumber', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'expirationDate', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'principio_activo', { type: require('sequelize').TEXT });

        await addColSafe('SaleItems', 'companyId', { type: require('sequelize').TEXT });
        await addColSafe('SaleItems', 'batchNumber', { type: require('sequelize').TEXT });
        await addColSafe('SaleItems', 'expirationDate', { type: require('sequelize').TEXT });
        await addColSafe('SaleItems', 'es_controlado', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('SaleItems', 'recipe', { type: require('sequelize').JSON });

        await addColSafe('Sales', 'paymentMethods', { type: require('sequelize').JSON });
        await addColSafe('Sales', 'igtfAmount', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Sales', 'userId', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'customerId', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'status', { type: require('sequelize').TEXT, defaultValue: 'completed' });
        await addColSafe('Sales', 'taxInfo', { type: require('sequelize').JSON });
        await addColSafe('Sales', 'documentType', { type: require('sequelize').TEXT, defaultValue: 'factura' });

        await addColSafe('Messages', 'readBy', { type: require('sequelize').JSON, defaultValue: [] });
        await addColSafe('Messages', 'type', { type: require('sequelize').TEXT, defaultValue: 'text' });
        await addColSafe('Messages', 'fileUrl', { type: require('sequelize').TEXT });

        await addColSafe('Users', 'email', { type: require('sequelize').TEXT });
        await addColSafe('Users', 'username', { type: require('sequelize').TEXT }); // CRITICAL: Required by login query
        await addColSafe('Users', 'defaultCurrency', { type: require('sequelize').TEXT, defaultValue: 'BOTH' });
        await addColSafe('Users', 'activeBranchId', { type: require('sequelize').TEXT });
        await addColSafe('Users', 'supervisorPin', { type: require('sequelize').TEXT });

        await addColSafe('Refunds', 'date', { type: require('sequelize').TEXT });
        await addColSafe('Refunds', 'userId', { type: require('sequelize').TEXT });
        await addColSafe('Refunds', 'amount', { type: require('sequelize').DECIMAL(20, 6) });
        await addColSafe('Refunds', 'createdAt', { type: require('sequelize').DATE });
        await addColSafe('Refunds', 'updatedAt', { type: require('sequelize').DATE });

        await addColSafe('SaleItems', 'cost', { type: require('sequelize').DECIMAL(20, 6) });
        
        if (dial === 'postgres') {
            try {
                await sequelize.query('ALTER TABLE "SaleItems" ALTER COLUMN "productId" DROP NOT NULL');
                console.log('Migration: SUCCESS - Dropped NOT NULL from SaleItems.productId');
            } catch (err) {
                // If it already allows null or table doesn't exist yet, omit
            }
        }
        await addColSafe('PurchaseOrders', 'referenceNumber', { type: require('sequelize').TEXT });
        await addColSafe('PurchaseOrders', 'receivedAt', { type: require('sequelize').TEXT });

        await addColSafe('Suppliers', 'creditBalance', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Customers', 'creditLimit', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Customers', 'creditBalance', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });

        // v1.4.39: Native Multi-Currency Caja
        await addColSafe('CashShifts', 'initialBreakdown', { type: require('sequelize').JSON, defaultValue: {} });
        await addColSafe('CashShifts', 'expectedBreakdown', { type: require('sequelize').JSON, defaultValue: {} });
        await addColSafe('CashMovements', 'paymentMethodId', { type: require('sequelize').TEXT });
        await addColSafe('CashMovements', 'currency', { type: require('sequelize').TEXT, defaultValue: 'USD' });

        // Redundant raw migrations removed - handled by addColSafe above

        // --- MULTI-TENANT (COMPANY ID) MIGRATIONS ---
        const tablesWithCompanyId = [
            'Products', 'Customers', 'Sales', 'Users', 'Suppliers',
            'CashShifts', 'CashMovements', 'PurchaseOrders', 'Refunds',
            'CreditHistories', 'StockMovements', 'Expenses', 'AuditLogs', 'Branches', 'Quotations'
        ];

        for (const table of tablesWithCompanyId) {
            let defaultValue = table === 'Users' ? null : 'default';
            await addColSafe(table, 'companyId', { type: require('sequelize').TEXT, defaultValue });
        }

        // Table creations are generally handled by sequelize.sync() in index.js
        // If specific manual creations are needed, they should be done via QueryInterface

        // v1.4.36 already handled by addColSafe at top

        // --- v1.4.38: Tenant Decoupling (Isolation Fix) ---
        if (dial !== 'sqlite') {
            try {
                const { User } = require('./models');
                const stuckUsers = await User.findAll({
                    where: {
                        role: 'superadmin',
                        [require('sequelize').Op.or]: [
                            { companyId: 'default' },
                            { companyId: null },
                            { companyId: '' }
                        ]
                    }
                });

                for (const user of stuckUsers) {
                    console.log(`Migration: Decoupling account ${user.id}...`);
                    await user.update({ companyId: user.id });
                }
            } catch (err) {
                console.log('Migration: Tenant Decoupling check - ' + err.message);
            }

            // --- v1.4.39: Orphaned Data Recovery (Fix for missing suppliers/products after decoupling) ---
            try {
                const { User } = require('./models');
                const superAdmin = await User.findOne({ where: { role: 'superadmin' } });
                
                if (superAdmin && superAdmin.companyId && superAdmin.companyId !== 'default') {
                    const tablesToRecover = [
                        'Products', 'Customers', 'Sales', 'Suppliers',
                        'CashShifts', 'CashMovements', 'PurchaseOrders', 'Refunds',
                        'CreditHistories', 'StockMovements', 'Expenses', 'AuditLogs', 'Branches', 'Quotations'
                    ];
                    
                    for (const table of tablesToRecover) {
                        try {
                            const query = `UPDATE "${table}" SET "companyId" = :companyId WHERE "companyId" = 'default' OR "companyId" IS NULL OR "companyId" = ''`;
                            await sequelize.query(query, { replacements: { companyId: superAdmin.companyId } });
                        } catch(e) {
                            try {
                                const query2 = `UPDATE ${table} SET companyId = :companyId WHERE companyId = 'default' OR companyId IS NULL OR companyId = ''`;
                                await sequelize.query(query2, { replacements: { companyId: superAdmin.companyId } });
                            } catch (e2) {}
                        }
                    }
                    console.log('Migration: Orphaned data assigned to superadmin ' + superAdmin.companyId);
                }
            } catch (err) {
                console.log('Migration: Orphaned Data Recovery check - ' + err.message);
            }
        }

        console.log('Migration: Schema check complete.');

    } catch (error) {
        console.error('Migration FATAL Error:', error);
    }
}

module.exports = { runMigrations };
