const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const PurchaseOrder = sequelize.define('PurchaseOrder', {
    id: { type: DataTypes.STRING, primaryKey: true },
    supplierId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING },
    expectedDate: { type: DataTypes.STRING },
    arrivalDate: { type: DataTypes.STRING },
    dueDate: { type: DataTypes.STRING },
    exchangeRate: { type: DataTypes.DECIMAL(20, 6), defaultValue: 1.0 },
    status: { type: DataTypes.STRING },
    total: { type: DataTypes.DECIMAL(20, 6) },
    totalVes: { type: DataTypes.DECIMAL(20, 6) },
    items: { type: DataTypes.JSONB },
    notes: { type: DataTypes.TEXT },
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'unpaid' },
    referenceNumber: { type: DataTypes.STRING },
    invoiceUrl: { type: DataTypes.TEXT },
    receivedAt: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING }
});

module.exports = PurchaseOrder;
