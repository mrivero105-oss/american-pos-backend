const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const SupplierCreditHistory = sequelize.define('SupplierCreditHistory', {
    id: { type: DataTypes.STRING, primaryKey: true },
    supplierId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    timestamp: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING },
    amount: { type: DataTypes.DECIMAL(20, 6) },
    balanceAfter: { type: DataTypes.DECIMAL(20, 6) },
    description: { type: DataTypes.STRING },
    paymentMethod: { type: DataTypes.STRING },
    purchaseOrderId: { type: DataTypes.STRING }
});

module.exports = SupplierCreditHistory;
