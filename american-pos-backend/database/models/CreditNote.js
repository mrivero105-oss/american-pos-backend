const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const CreditNote = sequelize.define('CreditNote', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    creditNoteNumber: { type: DataTypes.STRING, allowNull: false }, // Correlativo NC-000001
    controlNumber: { type: DataTypes.STRING, defaultValue: '' },
    
    // Affected invoice & Customer
    saleId: { type: DataTypes.STRING, allowNull: true },
    affectedInvoiceNumber: { type: DataTypes.STRING, defaultValue: '' },
    customerId: { type: DataTypes.STRING, allowNull: true },
    customerName: { type: DataTypes.STRING, defaultValue: 'Consumidor Final' },
    customerRif: { type: DataTypes.STRING, defaultValue: '' },
    
    // Financial Breakdown
    subtotal: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    taxAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    exemptAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    totalAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    
    currency: { type: DataTypes.STRING, defaultValue: 'VES' },
    exchangeRate: { type: DataTypes.DECIMAL(20, 6), defaultValue: 1.0 },
    totalAmountUsd: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    
    reason: { 
        type: DataTypes.STRING, 
        defaultValue: 'DEVOLUCION_MERCANCIA' // DEVOLUCION_MERCANCIA, DESCUENTO_POST_VENTA, ERROR_FACTURACION, OTRO
    },
    reenterStock: { type: DataTypes.BOOLEAN, defaultValue: true },
    items: { type: DataTypes.JSONB, defaultValue: [] }, // Array de items devueltos con cantidad y precio
    
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'APLICADA' // APLICADA, ANULADA
    },
    date: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD
    userId: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, defaultValue: '' }
}, {
    tableName: 'CreditNotes',
    indexes: [
        { fields: ['companyId', 'creditNoteNumber'] },
        { fields: ['saleId'] },
        { fields: ['customerId'] }
    ]
});

module.exports = CreditNote;
