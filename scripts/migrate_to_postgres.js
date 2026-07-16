const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 1. Setup Source (SQLite)
const sqlitePath = path.join(__dirname, '..', 'database', 'pos_v1.sqlite');
const sourceDB = new Sequelize({
    dialect: 'sqlite',
    storage: sqlitePath,
    logging: false
});

// 2. Setup Destination (Postgres)
const destDB = new Sequelize(
    process.env.DB_NAME || 'americanpos',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false
    }
);

// Import Models for both
const models = require('../database/models');

async function migrateTable(modelName) {
    console.log(`Migrando tabla: ${modelName}...`);
    const Model = models[modelName];
    
    // We need to redefine the model for the source DB to use its connection
    const SourceModel = sourceDB.define(Model.name, Model.rawAttributes, { 
        tableName: Model.tableName,
        timestamps: Model.options.timestamps 
    });
    
    // Fetch all from source
    const rows = await SourceModel.findAll({ raw: true });
    if (rows.length === 0) {
        console.log(`  -> Sin datos para ${modelName}.`);
        return;
    }

    // Insert into destination (Model already uses destDB because we changed .env)
    // Bulk create with chunks to avoid huge memory usage
    const CHUNK_SIZE = 100;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        await Model.bulkCreate(chunk, { 
            ignoreDuplicates: true, // Safety
            validate: false,
            hooks: false
        });
    }
    console.log(`  -> OK: ${rows.length} registros migrados.`);
}

async function start() {
    try {
        console.log('--- INICIANDO MIGRACION SQLITE -> POSTGRES ---');
        await sourceDB.authenticate();
        await destDB.authenticate();
        console.log('Ambas bases de datos conectadas.');

        // Order matters if there are strict foreign keys (though we aren't enforcing them strictly in sync)
        const tables = [
            'User', 'Branch', 'Supplier', 'Customer', 'Product', 
            'BranchStock', 'Sale', 'SaleItem', 'CashShift', 'CashMovement', 
            'PurchaseOrder', 'Refund', 'CreditHistory', 'SupplierCreditHistory', 
            'Quotation', 'StockMovement', 'License', 'Expense', 'AuditLog'
        ];

        for (const table of tables) {
            await migrateTable(table);
        }

        console.log('\n--- MIGRACION COMPLETADA CON EXITO ---');
        process.exit(0);
    } catch (error) {
        console.error('\nFATAL: Error durante la migración:', error);
        process.exit(1);
    }
}

start();
