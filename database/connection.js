const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Initialize Sequelize with SQLite
// Priority: 
// 1. USER_DATA_PATH (Electron)
// 2. Roaming AppData (Windows Dev Fallback - to sync with installed app)
// 3. Local directory (Other Dev Fallback)

let storagePath;
const fs = require('fs');

if (process.env.USER_DATA_PATH) {
    // Ensure the folder exists to prevent EACCES or EPERM errors
    if (!fs.existsSync(process.env.USER_DATA_PATH)) {
        fs.mkdirSync(process.env.USER_DATA_PATH, { recursive: true });
    }
    storagePath = path.join(process.env.USER_DATA_PATH, 'pos_v1.sqlite');

    // AUTO-MIGRATION: Detect legacy database files and rename to new format
    const legacyPath = path.join(process.env.USER_DATA_PATH, 'database.sqlite');
    const oldPath = path.join(process.env.USER_DATA_PATH, 'pos.sqlite');

    if (!fs.existsSync(storagePath)) {
        if (fs.existsSync(legacyPath)) {
            console.log('[DB-Migration] Found legacy database.sqlite. Migrating to pos_v1.sqlite...');
            fs.renameSync(legacyPath, storagePath);
        } else if (fs.existsSync(oldPath)) {
            console.log('[DB-Migration] Found legacy pos.sqlite. Migrating to pos_v1.sqlite...');
            fs.renameSync(oldPath, storagePath);
        }
    }
} else if (process.platform === 'win32' && process.env.APPDATA) {
    let appDataPath = path.join(process.env.APPDATA, 'americanpos');
    if (!fs.existsSync(appDataPath)) {
        appDataPath = path.join(process.env.APPDATA, 'american-pos-backend');
        if (!fs.existsSync(appDataPath)) {
            fs.mkdirSync(appDataPath, { recursive: true });
        }
    }
    storagePath = path.join(appDataPath, 'pos_v1.sqlite');

    // AUTO-MIGRATION (Windows AppData)
    const legacyPath = path.join(appDataPath, 'database.sqlite');
    const oldPath = path.join(appDataPath, 'pos.sqlite');
    if (!fs.existsSync(storagePath)) {
        if (fs.existsSync(legacyPath)) {
            console.log('[DB-Migration] Found legacy Windows database.sqlite. Migrating...');
            fs.renameSync(legacyPath, storagePath);
        } else if (fs.existsSync(oldPath)) {
            console.log('[DB-Migration] Found legacy Windows pos.sqlite. Migrating...');
            fs.renameSync(oldPath, storagePath);
        }
    }
} else if (process.env.NODE_ENV === 'development') {
    storagePath = path.join(__dirname, 'pos_v1.sqlite');
} else {
    storagePath = path.join(__dirname, 'pos_v1.sqlite');
}

try {
    console.log('\n--- DATABASE CONNECTION DEBUG ---');
    console.log('Dialect:', process.env.DB_DIALECT || 'sqlite');
    if ((process.env.DB_DIALECT || 'sqlite') === 'sqlite') {
        console.log('Final Storage Path:', storagePath);
    } else {
        console.log('Host/DB:', `${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'americanpos'}`);
    }
    console.log('---------------------------------\n');
} catch (e) { /* ignore console errors in packaged app */ }

let sequelize;

// DETERMINAR EL DIALECTO: Respetar .env en lugar de forzar SQLite en producción
let dialect = (process.env.DB_DIALECT || 'sqlite').toLowerCase();

console.log(`[DB] Current Mode: ${!!process.env.USER_DATA_PATH ? 'Packaged/Production' : 'Development'}`);
console.log(`[DB] Database Connection Dialect: ${dialect}`);

if (dialect === 'postgres') {
    sequelize = new Sequelize(
        process.env.DB_NAME || 'americanpos',
        process.env.DB_USER || 'postgres',
        process.env.DB_PASSWORD,
        {
            host: process.env.DB_HOST || '127.0.0.1',
            port: process.env.DB_PORT || 5432,
            dialect: 'postgres',
            logging: false,
            pool: {
                max: 5,
                min: 0,
                acquire: 5000,
                idle: 10000
            },
            dialectOptions: {
                connectTimeout: 5000
            }
        }
    );
} else {
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: storagePath,
        logging: false,
        dialectOptions: {
            busy_timeout: 10000
        }
    });
}

// Helper to safely add columns if they don't exist (SQLite doesn't support IF NOT EXISTS in ALTER TABLE)
const repairSchema = async () => {
    try {
        // Repair Refunds Table
        try {
            const [results] = await sequelize.query("PRAGMA table_info(Refunds)");
            const columns = results.map(r => r.name);

            if (columns.length > 0) {
                if (!columns.includes('date')) {
                    console.log('[Schema] Adding missing column: date to Refunds');
                    await sequelize.query("ALTER TABLE Refunds ADD COLUMN date TEXT");
                }
                if (!columns.includes('userId')) {
                    console.log('[Schema] Adding missing column: userId to Refunds');
                    await sequelize.query("ALTER TABLE Refunds ADD COLUMN userId TEXT");
                }
            }
        } catch (rErr) {
            console.warn('[Schema] Refunds table not ready for repair yet.');
        }

        // Repair Users Table
        try {
            const [userCols] = await sequelize.query("PRAGMA table_info(Users)");
            const userColumnNames = userCols.map(r => r.name);
            if (userColumnNames.length > 0) {
                if (!userColumnNames.includes('defaultCurrency')) {
                    console.log('[Schema] Adding missing column: defaultCurrency to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN defaultCurrency TEXT DEFAULT 'BOTH'");
                }
                if (!userColumnNames.includes('email')) {
                    console.log('[Schema] Adding missing column: email to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN email TEXT");
                }
                if (!userColumnNames.includes('username')) {
                    console.log('[Schema] Adding missing column: username to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN username TEXT");
                }
                if (!userColumnNames.includes('companyId')) {
                    console.log('[Schema] Adding missing column: companyId to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN companyId TEXT");
                }
                if (!userColumnNames.includes('role')) {
                    console.log('[Schema] Adding missing column: role to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN role TEXT DEFAULT 'admin'");
                }
                if (!userColumnNames.includes('status')) {
                    console.log('[Schema] Adding missing column: status to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN status TEXT DEFAULT 'active'");
                }
                if (!userColumnNames.includes('supervisorPin')) {
                    console.log('[Schema] Adding missing column: supervisorPin to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN supervisorPin TEXT");
                }
                if (!userColumnNames.includes('activeBranchId')) {
                    console.log('[Schema] Adding missing column: activeBranchId to Users');
                    await sequelize.query("ALTER TABLE Users ADD COLUMN activeBranchId TEXT");
                }
                // Data Integrity
                await sequelize.query("UPDATE Users SET companyId = 'default' WHERE companyId IS NULL OR companyId = ''");
            }
        } catch (uErr) {
            console.warn('[Schema] Users table not ready for repair yet.', uErr.message);
        }

        // Repair Sales Table
        try {
            const [saleCols] = await sequelize.query("PRAGMA table_info(Sales)");
            const saleColumnNames = saleCols.map(r => r.name);
            if (saleColumnNames.length > 0) {
                if (!saleColumnNames.includes('documentType')) {
                    console.log('[Schema] Adding missing column: documentType to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN documentType TEXT DEFAULT 'factura'");
                }
                if (!saleColumnNames.includes('paymentStatus')) {
                    console.log('[Schema] Adding missing column: paymentStatus to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN paymentStatus TEXT DEFAULT 'paid'");
                }
                if (!saleColumnNames.includes('igtfAmount')) {
                    console.log('[Schema] Adding missing column: igtfAmount to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN igtfAmount TEXT DEFAULT 0");
                }
                if (!saleColumnNames.includes('registerId')) {
                    console.log('[Schema] Adding missing column: registerId to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN registerId TEXT DEFAULT '1'");
                }
                if (!saleColumnNames.includes('registerName')) {
                    console.log('[Schema] Adding missing column: registerName to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN registerName TEXT DEFAULT 'Caja Principal'");
                }
                if (!saleColumnNames.includes('paymentMethods')) {
                    console.log('[Schema] Adding missing column: paymentMethods to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN paymentMethods TEXT"); // SQLite JSON is TEXT
                }
                if (!saleColumnNames.includes('taxInfo')) {
                    console.log('[Schema] Adding missing column: taxInfo to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN taxInfo TEXT");
                }
                if (!saleColumnNames.includes('companyId')) {
                    console.log('[Schema] Adding missing column: companyId to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN companyId TEXT");
                }
                if (!saleColumnNames.includes('exchangeRate')) {
                    console.log('[Schema] Adding missing column: exchangeRate to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN exchangeRate TEXT DEFAULT 1");
                }
                if (!saleColumnNames.includes('timestamp')) {
                    console.log('[Schema] Adding missing column: timestamp to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN timestamp TEXT");
                }
                if (!saleColumnNames.includes('subtotal')) {
                    console.log('[Schema] Adding missing column: subtotal to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN subtotal TEXT DEFAULT 0");
                }
                if (!saleColumnNames.includes('tax')) {
                    console.log('[Schema] Adding missing column: tax to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN tax TEXT DEFAULT 0");
                }
                if (!saleColumnNames.includes('discount')) {
                    console.log('[Schema] Adding missing column: discount to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN discount TEXT DEFAULT 0");
                }
                if (!saleColumnNames.includes('customerId')) {
                    console.log('[Schema] Adding missing column: customerId to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN customerId TEXT");
                }
                if (!saleColumnNames.includes('customerName')) {
                    console.log('[Schema] Adding missing column: customerName to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN customerName TEXT");
                }
                if (!saleColumnNames.includes('userId')) {
                    console.log('[Schema] Adding missing column: userId to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN userId TEXT");
                }
                if (!saleColumnNames.includes('sriAccessKey')) {
                    console.log('[Schema] Adding missing column: sriAccessKey to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN sriAccessKey TEXT NULL");
                }
                if (!saleColumnNames.includes('sriStatus')) {
                    console.log('[Schema] Adding missing column: sriStatus to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN sriStatus TEXT DEFAULT 'none'");
                }
                if (!saleColumnNames.includes('sriAuthorizationDate')) {
                    console.log('[Schema] Adding missing column: sriAuthorizationDate to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN sriAuthorizationDate TEXT NULL");
                }
                if (!saleColumnNames.includes('sriXmlUrl')) {
                    console.log('[Schema] Adding missing column: sriXmlUrl to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN sriXmlUrl TEXT NULL");
                }
                // Data Integrity
                await sequelize.query("UPDATE Sales SET companyId = 'default' WHERE companyId IS NULL OR companyId = ''");
            }
        } catch (sErr) {
            console.warn('[Schema] Sales table not ready for repair yet.');
        }

        // Repair SaleItems Table
        try {
            const [saleItemCols] = await sequelize.query("PRAGMA table_info(SaleItems)");
            const saleItemColumnNames = saleItemCols.map(r => r.name);
            if (saleItemColumnNames.length > 0) {
                if (!saleItemColumnNames.includes('companyId')) {
                    console.log('[Schema] Adding missing column: companyId to SaleItems');
                    await sequelize.query("ALTER TABLE SaleItems ADD COLUMN companyId TEXT");
                }
                if (!saleItemColumnNames.includes('cost')) {
                    console.log('[Schema] Adding missing column: cost to SaleItems');
                    await sequelize.query("ALTER TABLE SaleItems ADD COLUMN cost TEXT DEFAULT 0");
                }
            }
        } catch (siErr) {
            console.warn('[Schema] SaleItems table not ready for repair yet.');
        }

        // Repair Products Table (Full Audit)
        try {
            const [productCols] = await sequelize.query("PRAGMA table_info(Products)");
            const productColumnNames = productCols.map(r => r.name);
            if (productColumnNames.length > 0) {
                if (!productColumnNames.includes('taxStatus')) {
                    console.log('[Schema] Adding missing column: taxStatus to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN taxStatus TEXT DEFAULT 'gravable'");
                }
                if (!productColumnNames.includes('bulkUnitName')) {
                    console.log('[Schema] Adding missing column: bulkUnitName to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN bulkUnitName TEXT DEFAULT 'Bulto'");
                }
                if (!productColumnNames.includes('unitsPerBulk')) {
                    console.log('[Schema] Adding missing column: unitsPerBulk to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN unitsPerBulk TEXT DEFAULT 1");
                }
                if (!productColumnNames.includes('margin')) {
                    console.log('[Schema] Adding missing column: margin to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN margin TEXT DEFAULT 0");
                }
                if (!productColumnNames.includes('bulkCost')) {
                    console.log('[Schema] Adding missing column: bulkCost to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN bulkCost TEXT DEFAULT 0");
                }
                if (!productColumnNames.includes('isCustom')) {
                    console.log('[Schema] Adding missing column: isCustom to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN isCustom BOOLEAN DEFAULT 0");
                }
                if (!productColumnNames.includes('stockUnit')) {
                    console.log('[Schema] Adding missing column: stockUnit to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN stockUnit TEXT DEFAULT 'und'");
                }
                if (!productColumnNames.includes('supplierId')) {
                    console.log('[Schema] Adding missing column: supplierId to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN supplierId TEXT");
                }
                if (!productColumnNames.includes('companyId')) {
                    console.log('[Schema] Adding missing column: companyId to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN companyId TEXT");
                }
                if (!productColumnNames.includes('allowNegative')) {
                    console.log('[Schema] Adding missing column: allowNegative to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN allowNegative BOOLEAN DEFAULT 0");
                }
                if (!productColumnNames.includes('stockQuantity')) {
                    console.log('[Schema] Adding missing column: stockQuantity to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN stockQuantity TEXT DEFAULT 0");
                }
                if (productColumnNames.includes('stock')) {
                    console.log('[Schema] Migrating and neutralizing legacy stock column...');
                    await sequelize.query("UPDATE Products SET stockQuantity = CAST(stock AS TEXT), stock = NULL WHERE stock IS NOT NULL");
                }
                if (!productColumnNames.includes('priceBs')) {
                    console.log('[Schema] Adding missing column: priceBs to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN priceBs TEXT DEFAULT 0");
                }
                if (!productColumnNames.includes('status')) {
                    console.log('[Schema] Adding missing column: status to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN status TEXT DEFAULT 'active'");
                }
                if (!productColumnNames.includes('isSoldByWeight')) {
                    console.log('[Schema] Adding missing column: isSoldByWeight to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN isSoldByWeight BOOLEAN DEFAULT 0");
                }
                if (!productColumnNames.includes('isFractional')) {
                    console.log('[Schema] Adding missing column: isFractional to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN isFractional BOOLEAN DEFAULT 0");
                }
                if (!productColumnNames.includes('batchNumber')) {
                    console.log('[Schema] Adding missing column: batchNumber to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN batchNumber TEXT");
                }
                if (!productColumnNames.includes('expirationDate')) {
                    console.log('[Schema] Adding missing column: expirationDate to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN expirationDate TEXT");
                }
                if (!productColumnNames.includes('es_controlado')) {
                    console.log('[Schema] Adding missing column: es_controlado to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN es_controlado BOOLEAN DEFAULT 0");
                }
                if (!productColumnNames.includes('principio_activo')) {
                    console.log('[Schema] Adding missing column: principio_activo to Products');
                    await sequelize.query("ALTER TABLE Products ADD COLUMN principio_activo TEXT");
                }

                // Data Integrity: Ensure companyId is never null for legacy data visibility
                await sequelize.query("UPDATE Products SET companyId = 'default' WHERE companyId IS NULL OR companyId = ''");
            }
        } catch (pErr) {
            console.warn('[Schema] Products table not ready for repair yet.');
        }

        // Repair BranchStocks Table
        try {
            const [bsCols] = await sequelize.query("PRAGMA table_info(BranchStocks)");
            const bsColumnNames = bsCols.map(r => r.name);
            if (bsColumnNames.length > 0) {
                if (!bsColumnNames.includes('companyId')) {
                    console.log('[Schema] Adding missing column: companyId to BranchStocks');
                    await sequelize.query("ALTER TABLE BranchStocks ADD COLUMN companyId TEXT");
                }
            }
        } catch (bsErr) {
            console.warn('[Schema] BranchStocks table not ready for repair yet.');
        }

        // Repair Customers Table
        try {
            const [customerCols] = await sequelize.query("PRAGMA table_info(Customers)");
            const customerColumnNames = customerCols.map(r => r.name);
            if (customerColumnNames.length > 0) {
                if (!customerColumnNames.includes('creditLimit')) {
                    console.log('[Schema] Adding missing column: creditLimit to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN creditLimit TEXT DEFAULT 0");
                }
                if (!customerColumnNames.includes('creditBalance')) {
                    console.log('[Schema] Adding missing column: creditBalance to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN creditBalance TEXT DEFAULT 0");
                }
                if (!customerColumnNames.includes('companyId')) {
                    console.log('[Schema] Adding missing column: companyId to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN companyId TEXT");
                }
                // Data Integrity
                await sequelize.query("UPDATE Customers SET companyId = 'default' WHERE companyId IS NULL OR companyId = ''");
                if (!customerColumnNames.includes('isVIP')) {
                    console.log('[Schema] Adding missing column: isVIP to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN isVIP BOOLEAN DEFAULT 0");
                }
                if (!customerColumnNames.includes('isActive')) {
                    console.log('[Schema] Adding missing column: isActive to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN isActive BOOLEAN DEFAULT 1");
                }
                if (!customerColumnNames.includes('phone')) {
                    console.log('[Schema] Adding missing column: phone to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN phone TEXT");
                }
                if (!customerColumnNames.includes('email')) {
                    console.log('[Schema] Adding missing column: email to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN email TEXT");
                }
                if (!customerColumnNames.includes('idDocument')) {
                    console.log('[Schema] Adding missing column: idDocument to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN idDocument TEXT");
                }
                if (!customerColumnNames.includes('loyaltyPoints')) {
                    console.log('[Schema] Adding missing column: loyaltyPoints to Customers');
                    await sequelize.query("ALTER TABLE Customers ADD COLUMN loyaltyPoints TEXT DEFAULT 0");
                }
            }
        } catch (cErr) {
            console.warn('[Schema] Customers table not ready for repair yet.');
        }

        // Ensure Quotations Table exists (Manually for SQLite robustness)
        try {
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS Quotations (
                    id TEXT PRIMARY KEY,
                    customerId TEXT,
                    customerName TEXT,
                    userId TEXT,
                    companyId TEXT,
                    date TEXT,
                    total TEXT,
                    items TEXT,
                    notes TEXT,
                    status TEXT DEFAULT 'pending',
                    validUntil TEXT,
                    customerDocument TEXT,
                    createdAt DATETIME,
                    updatedAt DATETIME
                )
            `);
            try {
                console.log('[Schema] Verified Quotations table existence.');
            } catch (e) { }
        } catch (qErr) {
            console.error('[Schema] Error ensuring Quotations table:', qErr.message);
        }

        // Ensure ServiceOrders Table exists
        try {
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS ServiceOrders (
                    id TEXT PRIMARY KEY,
                    customerId TEXT,
                    customerName TEXT,
                    assetDescription TEXT,
                    technicalNotes TEXT,
                    totalAmount TEXT,
                    balancePaid TEXT,
                    status TEXT,
                    photos TEXT,
                    colorCode TEXT,
                    serialNumber TEXT,
                    storageLocation TEXT,
                    companyId TEXT,
                    createdAt DATETIME,
                    updatedAt DATETIME
                );
            `);
        } catch (soErr) { }

        // Repair Sales Table (Add isService and serviceOrderId)
        try {
            const [saleCols] = await sequelize.query("PRAGMA table_info(Sales)");
            const saleColumnNames = saleCols.map(r => r.name);
            if (saleColumnNames.length > 0) {
                if (!saleColumnNames.includes('isService')) {
                    console.log('[Schema] Adding missing column: isService to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN isService BOOLEAN DEFAULT 0");
                }
                if (!saleColumnNames.includes('serviceOrderId')) {
                    console.log('[Schema] Adding missing column: serviceOrderId to Sales');
                    await sequelize.query("ALTER TABLE Sales ADD COLUMN serviceOrderId TEXT");
                }
            }
        } catch (sErr) { }

        // Add customerDocument column if missing (for existing tables)
        try {
            const [quoteCols] = await sequelize.query("PRAGMA table_info(Quotations)");
            const quoteColumnNames = quoteCols.map(r => r.name);
            if (quoteColumnNames.length > 0 && !quoteColumnNames.includes('customerDocument')) {
                console.log('[Schema] Adding missing column: customerDocument to Quotations');
                await sequelize.query("ALTER TABLE Quotations ADD COLUMN customerDocument TEXT");
            }
        } catch (qdErr) {
            console.warn('[Schema] Quotations table not ready for customerDocument repair.');
        }

        // Repair CashShifts Table
        try {
            const [cashShiftCols] = await sequelize.query("PRAGMA table_info(CashShifts)");
            const cashShiftColumnNames = cashShiftCols.map(r => r.name);
            if (cashShiftColumnNames.length > 0) {
                if (!cashShiftColumnNames.includes('openingNotes')) {
                    console.log('[Schema] Adding missing column: openingNotes to CashShifts');
                    await sequelize.query("ALTER TABLE CashShifts ADD COLUMN openingNotes TEXT");
                }
                if (!cashShiftColumnNames.includes('closingNotes')) {
                    console.log('[Schema] Adding missing column: closingNotes to CashShifts');
                    await sequelize.query("ALTER TABLE CashShifts ADD COLUMN closingNotes TEXT");
                }
                if (!cashShiftColumnNames.includes('registerId')) {
                    console.log('[Schema] Adding missing column: registerId to CashShifts');
                    await sequelize.query("ALTER TABLE CashShifts ADD COLUMN registerId TEXT DEFAULT '1'");
                }
                if (!cashShiftColumnNames.includes('registerName')) {
                    console.log('[Schema] Adding missing column: registerName to CashShifts');
                    await sequelize.query("ALTER TABLE CashShifts ADD COLUMN registerName TEXT DEFAULT 'Caja Principal'");
                }
                if (!cashShiftColumnNames.includes('exchangeRateAtClose')) {
                    console.log('[Schema] Adding missing column: exchangeRateAtClose to CashShifts');
                    await sequelize.query("ALTER TABLE CashShifts ADD COLUMN exchangeRateAtClose TEXT");
                }
            }
        } catch (csErr) {
            console.warn('[Schema] CashShifts table not ready for repair yet.');
        }

        // Repair Suppliers Table (Full audit)
        try {
            const [supplierCols] = await sequelize.query("PRAGMA table_info(Suppliers)");
            const supplierColumnNames = supplierCols.map(r => r.name);
            if (supplierColumnNames.length > 0) {
                if (!supplierColumnNames.includes('logoUri')) {
                    console.log('[Schema] Adding missing column: logoUri to Suppliers');
                    await sequelize.query("ALTER TABLE Suppliers ADD COLUMN logoUri TEXT");
                }
                if (!supplierColumnNames.includes('isActive')) {
                    console.log('[Schema] Adding missing column: isActive to Suppliers');
                    await sequelize.query("ALTER TABLE Suppliers ADD COLUMN isActive BOOLEAN DEFAULT 1");
                }
                if (!supplierColumnNames.includes('creditBalance')) {
                    console.log('[Schema] Adding missing column: creditBalance to Suppliers');
                    await sequelize.query("ALTER TABLE Suppliers ADD COLUMN creditBalance TEXT DEFAULT 0");
                }
                if (!supplierColumnNames.includes('companyId')) {
                    console.log('[Schema] Adding missing column: companyId to Suppliers');
                    await sequelize.query("ALTER TABLE Suppliers ADD COLUMN companyId TEXT");
                }
                if (!supplierColumnNames.includes('userId')) {
                    console.log('[Schema] Adding missing column: userId to Suppliers');
                    await sequelize.query("ALTER TABLE Suppliers ADD COLUMN userId TEXT");
                }

                // Data Integrity
                await sequelize.query("UPDATE Suppliers SET companyId = 'default' WHERE companyId IS NULL OR companyId = ''");
            }
        } catch (supErr) {
            console.warn('[Schema] Suppliers table not ready for repair yet.');
        }

        // Repair Branches Table
        try {
            const [branchCols] = await sequelize.query("PRAGMA table_info(Branches)");
            const branchColumnNames = branchCols.map(r => r.name);
            if (branchColumnNames.length > 0) {
                if (!branchColumnNames.includes('address')) {
                    console.log('[Schema] Adding missing column: address to Branches');
                    await sequelize.query("ALTER TABLE Branches ADD COLUMN address TEXT");
                }
                if (!branchColumnNames.includes('phone')) {
                    console.log('[Schema] Adding missing column: phone to Branches');
                    await sequelize.query("ALTER TABLE Branches ADD COLUMN phone TEXT");
                }
                if (!branchColumnNames.includes('email')) {
                    console.log('[Schema] Adding missing column: email to Branches');
                    await sequelize.query("ALTER TABLE Branches ADD COLUMN email TEXT");
                }
                if (!branchColumnNames.includes('isActive')) {
                    console.log('[Schema] Adding missing column: isActive to Branches');
                    await sequelize.query("ALTER TABLE Branches ADD COLUMN isActive BOOLEAN DEFAULT 1");
                }
            }
        } catch (brErr) {
            console.warn('[Schema] Branches table not ready for repair yet.');
        }

        // --- PERFORMANCE INDEXES ---
        try {
            console.log('[Schema] Verifying performance indexes...');
            const indexes = [
                "CREATE INDEX IF NOT EXISTS idx_products_company ON Products(companyId)",
                "CREATE INDEX IF NOT EXISTS idx_products_category ON Products(category)",
                "CREATE INDEX IF NOT EXISTS idx_products_barcode ON Products(barcode)",
                "CREATE INDEX IF NOT EXISTS idx_saleitems_product ON SaleItems(productId)",
                "CREATE INDEX IF NOT EXISTS idx_saleitems_company ON SaleItems(companyId)",
                "CREATE INDEX IF NOT EXISTS idx_branchstocks_product ON BranchStocks(productId)",
                "CREATE INDEX IF NOT EXISTS idx_branchstocks_company ON BranchStocks(companyId)",
                "CREATE INDEX IF NOT EXISTS idx_customers_company ON Customers(companyId)",
                "CREATE INDEX IF NOT EXISTS idx_sales_company_status ON Sales(companyId, status)",
                "CREATE INDEX IF NOT EXISTS idx_sales_company_date ON Sales(companyId, date)",
                "CREATE INDEX IF NOT EXISTS idx_saleitems_createdat ON SaleItems(createdAt)",
                "CREATE INDEX IF NOT EXISTS idx_refunds_company_date ON Refunds(companyId, date)",
                "CREATE INDEX IF NOT EXISTS idx_cashmovements_shift ON CashMovements(shiftId)",
                "CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON StockMovements(productId)"
            ];

            for (const sql of indexes) {
                await sequelize.query(sql);
            }
            // Repair StockMovements (Kardex)
            try {
                const [stockMoveCols] = await sequelize.query("PRAGMA table_info(StockMovements)");
                const stockMoveColumnNames = stockMoveCols.map(r => r.name);
                if (stockMoveColumnNames.length > 0) {
                    if (!stockMoveColumnNames.includes('stockBefore')) {
                        console.log('[Schema] Adding missing column: stockBefore to StockMovements');
                        await sequelize.query("ALTER TABLE StockMovements ADD COLUMN stockBefore TEXT");
                    }
                    if (!stockMoveColumnNames.includes('stockAfter')) {
                        console.log('[Schema] Adding missing column: stockAfter to StockMovements');
                        await sequelize.query("ALTER TABLE StockMovements ADD COLUMN stockAfter TEXT");
                    }
                    if (!stockMoveColumnNames.includes('companyId')) {
                        console.log('[Schema] Adding missing column: companyId to StockMovements');
                        await sequelize.query("ALTER TABLE StockMovements ADD COLUMN companyId TEXT");
                    }
                    if (!stockMoveColumnNames.includes('date')) {
                        console.log('[Schema] Adding missing column: date to StockMovements');
                        await sequelize.query("ALTER TABLE StockMovements ADD COLUMN date TEXT");
                    }
                    if (!stockMoveColumnNames.includes('referenceId')) {
                        console.log('[Schema] Adding missing column: referenceId to StockMovements');
                        await sequelize.query("ALTER TABLE StockMovements ADD COLUMN referenceId TEXT");
                    }
                    // Data Integrity
                    await sequelize.query("UPDATE StockMovements SET companyId = 'default' WHERE companyId IS NULL OR companyId = ''");
                }
            } catch (smErr) {
                console.warn('[Schema] StockMovements table not ready for repair yet.');
            }

            console.log('[Schema] All performance indexes verified.');
        } catch (idxErr) {
            console.warn('[Schema] Index verification warning:', idxErr.message);
        }

        // Universal Admin & Data Visibility Guarantee:
        // Ensure admin user always exists/has password admin123 and superadmin role with companyId = 'default'
        try {
            const adminPassHash = '$2a$10$wO3g4tU7qB1yqG7R3P1P1u.6J/uS7U.3L1X5K.yX8Z9/zY0W.5X2C'; // hash for admin123
            await sequelize.query(`
                INSERT OR IGNORE INTO Users (id, username, name, email, password, role, status, companyId, defaultCurrency, createdAt, updatedAt) 
                VALUES ('admin', 'admin', 'Administrador Principal', 'admin@american.pos', '${adminPassHash}', 'superadmin', 'active', 'default', 'BOTH', datetime('now'), datetime('now'))
            `);
            await sequelize.query(`
                UPDATE Users SET password = '${adminPassHash}', role = 'superadmin', status = 'active', companyId = 'default' WHERE username = 'admin' OR id = 'admin'
            `);
            await sequelize.query(`
                UPDATE Users SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'
            `);
        } catch (adminSyncErr) {
            console.warn('[Schema] Could not sync admin user:', adminSyncErr.message);
        }

        // Universal Data Visibility: normalize all companyIds to 'default' for local SQLite databases
        if (sequelize.getDialect() === 'sqlite') {
            try {
                const tablesToNormalize = [
                    'Products', 'Sales', 'Customers', 'BranchStocks', 'Suppliers', 
                    'StockMovements', 'Branches', 'SaleItems', 'CashShifts', 'CashMovements', 
                    'Quotations', 'ServiceOrders', 'Users', 'Refunds', 'PurchaseOrders', 'Expenses'
                ];
                for (const table of tablesToNormalize) {
                    try {
                        await sequelize.query(`UPDATE ${table} SET companyId = 'default' WHERE companyId IS NULL OR companyId != 'default'`);
                    } catch (tableErr) { }
                }
            } catch (univErr) {
                console.warn('[Schema] Universal data normalization warning:', univErr.message);
            }
        } else {
            try {
                await sequelize.query("UPDATE Products SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
                await sequelize.query("UPDATE Sales SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
                await sequelize.query("UPDATE Customers SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
                await sequelize.query("UPDATE BranchStocks SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
                await sequelize.query("UPDATE Suppliers SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
                await sequelize.query("UPDATE StockMovements SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
                await sequelize.query("UPDATE Branches SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
                await sequelize.query("UPDATE SaleItems SET companyId = 'default' WHERE companyId IS NULL OR companyId = '' OR companyId = 'admin'");
            } catch (univErr) {
                console.warn('[Schema] Universal data normalization warning:', univErr.message);
            }
        }

        // Removed raw product status synchronization queries on startup to prevent overriding merchant's manual status choices.
        console.log('[Schema] Schema checks completed successfully.');
    } catch (error) {
        if (sequelize.getDialect() === 'sqlite') {
            console.warn('[Schema] repairSchema error (may be fine if table doesn\'t exist yet):', error.message);
        }
    }
};

async function migratePlaintextPasswords() {
    try {
        const bcrypt = require('bcryptjs');
        const { User } = require('./models');
        console.log('[Migración] Buscando contraseñas en texto plano...');
        const users = await User.findAll();
        let updatedCount = 0;
        for (const user of users) {
            if (user.password && !user.password.startsWith('$2') && user.password.length < 30) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(user.password, salt);
                await User.update({ password: hashedPassword }, { where: { id: user.id }, hooks: false });
                updatedCount++;
            }
        }
        if (updatedCount > 0) {
            console.log(`[Migración] Éxito: Se encriptaron ${updatedCount} contraseñas antiguas.`);
        } else {
            console.log(`[Migración] Todo en orden: No se encontraron contraseñas en texto plano.`);
        }
    } catch (error) {
        console.error('[Migración] Error al encriptar contraseñas antiguas:', error);
    }
}

const connectDB = async (retryWithSqlite = true) => {
    try {
        const dialectName = sequelize.getDialect();
        try {
            console.log(`[DB] Connection to ${dialectName} has been established successfully.`);
        } catch (e) { }

        await sequelize.authenticate();

        if (dialectName === 'sqlite') {
            // Activar Foreign Keys y Modo WAL para SQLite (CRÍTICO PARA INTEGRIDAD Y CONCURRENCIA)
            await sequelize.query('PRAGMA foreign_keys = ON;');
            await sequelize.query('PRAGMA journal_mode = WAL;');
            await sequelize.query('PRAGMA synchronous = FULL;');

            // Seguridad de Transacciones Concurrentes
            // Override DEFERRED default to IMMEDIATE to prevent Read-Write Race Conditions in Inventory
            const SequelizeObj = sequelize.Sequelize;
            SequelizeObj.Transaction.TYPES.DEFERRED = SequelizeObj.Transaction.TYPES.IMMEDIATE;

            // Ensure models are loaded and registered before schema repair or sync
            require('./models');

            // Manual repair only for SQLite as it lacks robust ALTER TABLE support
            await repairSchema();
            await sequelize.sync({ alter: false });

            // Auto-Checkpoint WAL Inteligente (Evita crecimiento infinito en disco)
            setInterval(async () => {
                try {
                    const walPath = `${storagePath}-wal`;
                    let isWalHuge = false;
                    if (fs.existsSync(walPath)) {
                        const stats = fs.statSync(walPath);
                        if (stats.size > 10 * 1024 * 1024) isWalHuge = true; // >10MB
                    }
                    if (isWalHuge) {
                        console.log('[SQLite] Archivo WAL supera 10MB. Ejecutando wal_checkpoint(TRUNCATE) para liberar disco...');
                        await sequelize.query('PRAGMA wal_checkpoint(TRUNCATE);');
                    } else {
                        await sequelize.query('PRAGMA wal_checkpoint(PASSIVE);');
                    }
                } catch (err) {
                    console.warn('[SQLite] Aviso en auto-checkpoint WAL:', err.message);
                }
            }, 15 * 60 * 1000);
        } else {
            // For PostgreSQL, we use Sequelize's built-in alter mechanism
            await sequelize.sync({ alter: true });
        }

        // Create or synchronize initial owner account
        try {
            const { User } = require('./models');
            const bcrypt = require('bcryptjs');
            const { generateRobustId } = require('../utils/helpers');
            const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
            const hashedPassword = await bcrypt.hash(initialPassword, 10);

            const existingAdmin = await User.findOne({ where: { username: 'admin' } });
            if (!existingAdmin) {
                const ownerId = generateRobustId();
                await User.create({
                    id: ownerId,
                    username: 'admin',
                    name: 'Administrador Principal',
                    email: 'admin@american.pos',
                    password: hashedPassword,
                    role: 'superadmin',
                    status: 'active',
                    companyId: 'default',
                    defaultCurrency: 'BOTH'
                });
                console.log('🔒 Usuario admin creado con clave admin123 en la base de datos');
            } else {
                // Ensure default admin works even if DB existed from earlier testing or imported DB
                await existingAdmin.update({ password: hashedPassword, status: 'active', role: 'superadmin' });
                console.log('🔒 Contraseña de admin sincronizada con admin123');
            }
        } catch (err) {
            console.warn('[Schema] Warning: Could not init admin account:', err.message);
        }

        // Ensure all users have a username (Migration check)
        try {
            if (dialectName === 'sqlite') {
                await sequelize.query(`
                    UPDATE Users 
                    SET username = LOWER(SUBSTR(email, 1, INSTR(email, '@') - 1))
                    WHERE (username IS NULL OR username = '') AND email LIKE '%@%'
                `);
                await sequelize.query(`UPDATE Users SET username = id WHERE (username IS NULL OR username = '')`);
            } else {
                try {
                    await sequelize.query(`
                        UPDATE "Users" 
                        SET "username" = LOWER(SPLIT_PART("email", '@', 1)) 
                        WHERE ("username" IS NULL OR "username" = '') AND "email" LIKE '%@%'
                    `);
                    await sequelize.query(`UPDATE "Users" SET "username" = "id" WHERE ("username" IS NULL OR "username" = '')`);
                } catch (pgErr) {
                    console.error('[Schema] Error in Users migration (Postgres/Quoted):', pgErr.message);
                }
            }
            console.log('[Schema] Usernames auto-populated successfully.');
        } catch (populateErr) {
            console.warn('[Schema] Warning: Could not auto-populate usernames:', populateErr.message);
        }

        console.log('✅ Database fully synchronized.');
        
        await migratePlaintextPasswords();
    } catch (error) {
        console.error('❌ DATABASE CONNECTION ERROR:', error.message);

        // Eliminado fallback automático a SQLite por seguridad de integridad
        throw error;
    }
};

module.exports = { sequelize, connectDB };
