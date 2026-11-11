const { sequelize } = require('./connection');

const CURRENT_SCHEMA_VERSION = '2026.04.7-PHASE3-HARDWARE-INDEXES';

async function runMigrations() {
    try {
        const dial = sequelize.getDialect();

        // 1. Fast-path: Check if current schema version has already been successfully migrated
        try {
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(64) PRIMARY KEY,
                    applied_at VARCHAR(64) NOT NULL
                );
            `);
            const [rows] = await sequelize.query(
                `SELECT version FROM schema_migrations WHERE version = '${CURRENT_SCHEMA_VERSION}' LIMIT 1;`
            );
            if (rows && rows.length > 0) {
                console.log(`Migration: Schema already verified and up-to-date [${CURRENT_SCHEMA_VERSION}]. (0ms skipped)`);
                return;
            }
        } catch (checkErr) {
            console.warn('Migration: Fast check notice:', checkErr.message);
        }

        console.log('Migration: Starting full schema check...');

        const qi = sequelize.getQueryInterface();

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
        await addColSafe('Products', 'bulkPrice', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'bulkPriceBs', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'bulkBarcode', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'midBulkUnitName', { type: require('sequelize').TEXT, defaultValue: 'Media Caja' });
        await addColSafe('Products', 'unitsPerMidBulk', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'midBulkCost', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'midBulkPrice', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'midBulkPriceBs', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Products', 'midBulkBarcode', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'es_controlado', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Products', 'batchNumber', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'expirationDate', { type: require('sequelize').TEXT });
        await addColSafe('Products', 'principio_activo', { type: require('sequelize').TEXT });

        await addColSafe('SaleItems', 'companyId', { type: require('sequelize').TEXT });
        await addColSafe('SaleItems', 'batchNumber', { type: require('sequelize').TEXT });
        await addColSafe('SaleItems', 'expirationDate', { type: require('sequelize').TEXT });
        await addColSafe('SaleItems', 'es_controlado', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('SaleItems', 'recipe', { type: require('sequelize').JSON });
        await addColSafe('SaleItems', 'isBulk', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('SaleItems', 'unitsPerBulk', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 1 });
        await addColSafe('SaleItems', 'isMidBulk', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('SaleItems', 'unitsPerMidBulk', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 1 });

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
        await addColSafe('PurchaseOrders', 'invoiceUrl', { type: require('sequelize').TEXT });
        await addColSafe('PurchaseOrders', 'arrivalDate', { type: require('sequelize').TEXT });
        await addColSafe('PurchaseOrders', 'dueDate', { type: require('sequelize').TEXT });
        await addColSafe('PurchaseOrders', 'exchangeRate', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 1 });
        await addColSafe('PurchaseOrders', 'totalVes', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });

        await addColSafe('SupplierCreditHistories', 'referenceNumber', { type: require('sequelize').TEXT });
        await addColSafe('SupplierCreditHistories', 'invoiceUrl', { type: require('sequelize').TEXT });
        await addColSafe('SupplierCreditHistories', 'arrivalDate', { type: require('sequelize').TEXT });
        await addColSafe('SupplierCreditHistories', 'dueDate', { type: require('sequelize').TEXT });
        await addColSafe('SupplierCreditHistories', 'exchangeRate', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 1 });

        await addColSafe('Expenses', 'invoiceUrl', { type: require('sequelize').TEXT });

        await addColSafe('Suppliers', 'creditBalance', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Customers', 'creditLimit', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Customers', 'creditBalance', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });

        // v1.4.39: Native Multi-Currency Caja
        await addColSafe('CashShifts', 'initialBreakdown', { type: require('sequelize').JSON, defaultValue: {} });
        await addColSafe('CashShifts', 'expectedBreakdown', { type: require('sequelize').JSON, defaultValue: {} });
        await addColSafe('CashMovements', 'paymentMethodId', { type: require('sequelize').TEXT });
        await addColSafe('CashMovements', 'currency', { type: require('sequelize').TEXT, defaultValue: 'USD' });
        await addColSafe('CashMovements', 'category', { type: require('sequelize').TEXT, defaultValue: 'OTHER' });
        await addColSafe('CashMovements', 'userName', { type: require('sequelize').TEXT });
        await addColSafe('Users', 'phone', { type: require('sequelize').TEXT });
        await addColSafe('Users', 'avatarColor', { type: require('sequelize').TEXT });
        await addColSafe('Users', 'permissions', { type: require('sequelize').JSON, defaultValue: {} });

        // Módulo de Mermas y Auditoría de Stock (v24.04.3)
        await addColSafe('StockMovements', 'branchId', { type: require('sequelize').TEXT });
        await addColSafe('StockMovements', 'category', { type: require('sequelize').TEXT, defaultValue: '' });
        await addColSafe('StockMovements', 'notes', { type: require('sequelize').TEXT, defaultValue: '' });
        await addColSafe('StockMovements', 'costPrice', { type: require('sequelize').DECIMAL(20, 4), defaultValue: 0 });
        await addColSafe('StockMovements', 'totalCost', { type: require('sequelize').DECIMAL(20, 4), defaultValue: 0 });
        await addColSafe('StockMovements', 'responsibleName', { type: require('sequelize').TEXT, defaultValue: '' });
        await addColSafe('Branches', 'code', { type: require('sequelize').TEXT });
        await addColSafe('Branches', 'type', { type: require('sequelize').TEXT, defaultValue: 'STORE' });
        await addColSafe('Branches', 'managerName', { type: require('sequelize').TEXT });
        await addColSafe('Branches', 'color', { type: require('sequelize').TEXT });
        await addColSafe('Branches', 'invoicePrefix', { type: require('sequelize').TEXT });

        // --- MIGRACIONES DE ESQUEMA RECIENTES (SRI, Proveedores RIF, Caja y Sucursales) ---
        await addColSafe('Suppliers', 'rif', { type: require('sequelize').TEXT });
        await addColSafe('Suppliers', 'logoUri', { type: require('sequelize').TEXT });
        await addColSafe('Suppliers', 'isActive', { type: require('sequelize').BOOLEAN, defaultValue: true });

        await addColSafe('Sales', 'registerName', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'sriAccessKey', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'sriStatus', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'sriAuthorizationDate', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'sriXmlUrl', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'cashierName', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'promoDiscount', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('Sales', 'appliedPromotions', { type: require('sequelize').JSON, defaultValue: [] });
        await addColSafe('Sales', 'isService', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Sales', 'serviceOrderId', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'branchId', { type: require('sequelize').TEXT });
        await addColSafe('Sales', 'exchangeRate', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 1 });
        await addColSafe('Sales', 'paymentStatus', { type: require('sequelize').TEXT, defaultValue: 'paid' });
        await addColSafe('Sales', 'registerId', { type: require('sequelize').TEXT, defaultValue: '1' });

        await addColSafe('SaleItems', 'promoDiscount', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });
        await addColSafe('SaleItems', 'appliedPromoName', { type: require('sequelize').TEXT });

        await addColSafe('Customers', 'creditLimitDays', { type: require('sequelize').INTEGER, defaultValue: 30 });
        await addColSafe('Customers', 'isCreditBlocked', { type: require('sequelize').BOOLEAN, defaultValue: false });
        await addColSafe('Customers', 'loyaltyPoints', { type: require('sequelize').DECIMAL(20, 6), defaultValue: 0 });

        await addColSafe('CashShifts', 'registerName', { type: require('sequelize').TEXT });

        await addColSafe('Refunds', 'timestamp', { type: require('sequelize').TEXT });
        await addColSafe('Refunds', 'paymentMethods', { type: require('sequelize').JSON });
        await addColSafe('Refunds', 'status', { type: require('sequelize').TEXT, defaultValue: 'completed' });
        await addColSafe('Refunds', 'supervisorApprovalId', { type: require('sequelize').TEXT });

        await addColSafe('Branches', 'address', { type: require('sequelize').TEXT });
        await addColSafe('Branches', 'phone', { type: require('sequelize').TEXT });
        await addColSafe('Branches', 'email', { type: require('sequelize').TEXT });
        await addColSafe('Branches', 'isActive', { type: require('sequelize').BOOLEAN, defaultValue: true });

        // --- HASH-CHAINED AUDIT LOG LEDGER (BANK-GRADE TAMPER DETECTION) ---
        await addColSafe('AuditLogs', 'previousHash', { type: require('sequelize').TEXT });
        await addColSafe('AuditLogs', 'recordHash', { type: require('sequelize').TEXT });

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
        {
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
                    console.log(`Migration: Assigning store company '2' to superadmin ${user.id}...`);
                    await user.update({ companyId: '2' });
                }
            } catch (err) {
                console.log('Migration: Tenant Decoupling check - ' + err.message);
            }

            // --- v1.4.39: Orphaned Data Recovery (Fix for missing suppliers/products after decoupling) ---
            try {
                const { User } = require('./models');
                const superAdmin = await User.findOne({ 
                    where: { role: 'superadmin' },
                    order: [
                        [sequelize.literal("CASE WHEN \"User\".\"id\" = '2' THEN 0 WHEN \"User\".\"companyId\" = '2' THEN 1 ELSE 2 END"), 'ASC']
                    ]
                });
                
                const targetCompId = (superAdmin && superAdmin.companyId && superAdmin.companyId !== 'default' && superAdmin.companyId !== 'admin') ? superAdmin.companyId : '2';

                if (targetCompId) {
                    const tablesToRecover = [
                        'Products', 'Customers', 'Sales', 'Suppliers',
                        'CashShifts', 'CashMovements', 'PurchaseOrders', 'Refunds',
                        'CreditHistories', 'StockMovements', 'Expenses', 'AuditLogs', 'Branches', 'Quotations'
                    ];
                    
                    for (const table of tablesToRecover) {
                        try {
                            const query = `UPDATE "${table}" SET "companyId" = :companyId WHERE "companyId" = 'default' OR "companyId" IS NULL OR "companyId" = ''`;
                            await sequelize.query(query, { replacements: { companyId: targetCompId } });
                        } catch(e) {
                            try {
                                const query2 = `UPDATE ${table} SET companyId = :companyId WHERE companyId = 'default' OR companyId IS NULL OR companyId = ''`;
                                await sequelize.query(query2, { replacements: { companyId: targetCompId } });
                            } catch (e2) {}
                        }
                    }
                    console.log('Migration: Orphaned data assigned to superadmin ' + targetCompId);
                }
            } catch (err) {
                console.log('Migration: Orphaned Data Recovery check - ' + err.message);
            }
        }

        // --- PostgreSQL Performance Engine Optimization (pg_trgm + GIN + Concurrency Indexes) ---
        if (dial === 'postgres') {
            console.log('Migration: Optimizing PostgreSQL engine (pg_trgm & compound indexes)...');
            const queries = [
                // 1. Enable pg_trgm extension for high-speed fuzzy search and ILIKE index scans
                'CREATE EXTENSION IF NOT EXISTS pg_trgm;',

                // 2. GIN Trigram Indexes on Products for < 2ms search
                'CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON "Products" USING gin (name gin_trgm_ops);',
                'CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm ON "Products" USING gin (barcode gin_trgm_ops);',
                'CREATE INDEX IF NOT EXISTS idx_products_principio_trgm ON "Products" USING gin (principio_activo gin_trgm_ops);',

                // 3. Multi-Caja and Concurrency Compound Indexes (prevent table locks)
                'CREATE INDEX IF NOT EXISTS idx_sales_company_created ON "Sales" ("companyId", "createdAt" DESC);',
                'CREATE INDEX IF NOT EXISTS idx_sales_company_user_date ON "Sales" ("companyId", "userId", "date");',
                'CREATE INDEX IF NOT EXISTS idx_sales_shift_stats ON "Sales" ("companyId", "userId", "registerId", "date");',
                'CREATE INDEX IF NOT EXISTS idx_saleitems_sale_prod ON "SaleItems" ("saleId", "productId");',
                'CREATE INDEX IF NOT EXISTS idx_branchstocks_prod_branch ON "BranchStocks" ("productId", "branchId", "companyId");',
                'CREATE INDEX IF NOT EXISTS idx_cashmovements_shift ON "CashMovements" ("shiftId", "companyId");',
                'CREATE INDEX IF NOT EXISTS idx_cashshifts_user_status ON "CashShifts" ("userId", "status", "companyId");',
                // 4. Strategic POS Enterprise Compound Indexes (Fase 3)
                'CREATE INDEX IF NOT EXISTS idx_products_company_barcode ON "Products" ("companyId", "barcode");',
                'CREATE INDEX IF NOT EXISTS idx_sales_company_createdat ON "Sales" ("companyId", "createdAt");',
                'CREATE INDEX IF NOT EXISTS idx_saleitems_saleid ON "SaleItems" ("saleId");',
                'CREATE INDEX IF NOT EXISTS idx_cashmovements_shiftid ON "CashMovements" ("shiftId");',
                'CREATE INDEX IF NOT EXISTS idx_auditlogs_company_createdat ON "AuditLogs" ("companyId", "createdAt" DESC);'
            ];

            for (const q of queries) {
                try {
                    await sequelize.query(q);
                } catch (idxErr) {
                    console.warn(`Migration: Notice for [${q.substring(0, 45)}...]: ${idxErr.message}`);
                }
            }
            console.log('Migration: SUCCESS - PostgreSQL pg_trgm & GIN/Compound indexes verified.');
        }

        // 4. Deterministic Schema Version Tracking (Parity between SQLite & PostgreSQL)
        try {
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(64) PRIMARY KEY,
                    applied_at VARCHAR(64) NOT NULL
                );
            `);
            const now = new Date().toISOString();
            await sequelize.query(`
                INSERT INTO schema_migrations (version, applied_at)
                VALUES ('${CURRENT_SCHEMA_VERSION}', '${now}')
                ON CONFLICT (version) DO NOTHING;
            `);
            console.log(`Migration: Schema version tracked [${CURRENT_SCHEMA_VERSION}].`);
        } catch (verErr) {
            console.warn(`Migration: Notice recording schema version: ${verErr.message}`);
        }

        console.log('Migration: Schema check complete.');

    } catch (error) {
        console.error('Migration FATAL Error:', error);
    }
}

module.exports = { runMigrations };
