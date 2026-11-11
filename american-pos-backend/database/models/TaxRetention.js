const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const TaxRetention = sequelize.define('TaxRetention', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    retentionType: { 
        type: DataTypes.ENUM('IVA_75', 'IVA_100', 'ISLR'), 
        allowNull: false 
    },
    retentionCategory: { 
        type: DataTypes.ENUM('EMITIDA_A_PROVEEDOR', 'RECIBIDA_DE_CLIENTE'), 
        defaultValue: 'EMITIDA_A_PROVEEDOR' 
    },
    voucherNumber: { type: DataTypes.STRING, allowNull: false }, // Ej: 20260900000001
    periodYear: { type: DataTypes.INTEGER, allowNull: false },
    periodMonth: { type: DataTypes.INTEGER, allowNull: false },
    recordDate: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD
    
    // Entity info
    entityRif: { type: DataTypes.STRING, allowNull: false },
    entityName: { type: DataTypes.STRING, allowNull: false },
    
    // Document affected
    invoiceNumber: { type: DataTypes.STRING, allowNull: false },
    controlNumber: { type: DataTypes.STRING, defaultValue: '' },
    invoiceDate: { type: DataTypes.STRING, defaultValue: '' },
    invoiceTotalAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    
    // Calculation
    baseAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    taxAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    retentionPercentage: { type: DataTypes.DECIMAL(6, 2), defaultValue: 75.00 }, // 75%, 100%, 1%, etc.
    retainedAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    
    currency: { type: DataTypes.STRING, defaultValue: 'VES' },
    exchangeRate: { type: DataTypes.DECIMAL(20, 6), defaultValue: 1.0 },
    
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'EMITIDO' // EMITIDO, ANULADO, DECLARADO
    },
    
    // Associations
    purchaseOrderId: { type: DataTypes.STRING, allowNull: true },
    saleId: { type: DataTypes.STRING, allowNull: true },
    fiscalBookRecordId: { type: DataTypes.STRING, allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, defaultValue: '' }
}, {
    tableName: 'TaxRetentions',
    indexes: [
        { fields: ['companyId', 'periodYear', 'periodMonth'] },
        { fields: ['voucherNumber'] },
        { fields: ['entityRif'] }
    ]
});

module.exports = TaxRetention;
