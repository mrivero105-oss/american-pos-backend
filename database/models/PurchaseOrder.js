const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const PurchaseOrder = sequelize.define('PurchaseOrder', {
    id: { type: DataTypes.STRING, primaryKey: true },
    supplierId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING },
    expectedDate: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING },
    total: { type: DataTypes.DECIMAL(20, 6) },
    items: { type: DataTypes.JSON },
    notes: { type: DataTypes.TEXT },
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'unpaid' },
    referenceNumber: { type: DataTypes.STRING },
    receivedAt: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING }
});

module.exports = PurchaseOrder;
