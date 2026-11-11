const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const FiscalBookRecord = sequelize.define('FiscalBookRecord', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    bookType: { 
        type: DataTypes.ENUM('VENTAS', 'COMPRAS'), 
        allowNull: false 
    },
    recordDate: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD
    documentType: { 
        type: DataTypes.STRING, 
        defaultValue: 'FACTURA' // FACTURA, NOTA_CREDITO, NOTA_DEBITO, RESUMEN_DIARIO
    },
    documentNumber: { type: DataTypes.STRING, allowNull: false },
    controlNumber: { type: DataTypes.STRING, defaultValue: '' },
    entityRif: { type: DataTypes.STRING, defaultValue: '' },
    entityName: { type: DataTypes.STRING, defaultValue: 'Consumidor Final' },
    affectedInvoiceNumber: { type: DataTypes.STRING, defaultValue: '' },
    
    // Financial and Tax breakdown (Stored in VES for SENIAT compliance)
    totalAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    exemptAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    taxableBase: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    taxRate: { type: DataTypes.DECIMAL(6, 2), defaultValue: 16.00 },
    taxAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    retainedIvaAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    igtfAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    
    // Original Transaction details
    currency: { type: DataTypes.STRING, defaultValue: 'VES' },
    exchangeRate: { type: DataTypes.DECIMAL(20, 6), defaultValue: 1.0 },
    originalTotalUsd: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    
    // Fiscal Period
    periodYear: { type: DataTypes.INTEGER, allowNull: false },
    periodMonth: { type: DataTypes.INTEGER, allowNull: false }, // 1 - 12
    
    // Linkages
    saleId: { type: DataTypes.STRING, allowNull: true },
    purchaseOrderId: { type: DataTypes.STRING, allowNull: true },
    creditNoteId: { type: DataTypes.STRING, allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, defaultValue: '' }
}, {
    tableName: 'FiscalBookRecords',
    indexes: [
        { name: 'idx_fiscal_books_period', fields: ['companyId', 'bookType', 'periodYear', 'periodMonth'] },
        { fields: ['documentNumber'] },
        { fields: ['entityRif'] }
    ]
});

module.exports = FiscalBookRecord;
