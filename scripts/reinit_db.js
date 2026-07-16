const { connectDB } = require('../database/connection');
const { Product, User, Supplier, Sale, StockMovement, Category, Branch, BranchStock, Customer, AuditLog, CashShift, Expense, Quotation, Refund } = require('../database/models');

async function init() {
    console.log('Iniciando sincronización de esquema en PostgreSQL...');
    try {
        await connectDB();
        console.log('Esquema sincronizado correctamente.');
        process.exit(0);
    } catch (error) {
        console.error('Error sincronizando esquema:', error);
        process.exit(1);
    }
}

init();
