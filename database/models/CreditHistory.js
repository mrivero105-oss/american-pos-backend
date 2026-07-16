const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const CreditHistory = sequelize.define('CreditHistory', {
    id: { type: DataTypes.STRING, primaryKey: true },
    customerId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    timestamp: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING },
    amount: { type: DataTypes.DECIMAL(20, 6) },
    balanceAfter: { type: DataTypes.DECIMAL(20, 6) },
    description: { type: DataTypes.STRING },
    paymentMethod: { type: DataTypes.STRING },
    saleId: { type: DataTypes.STRING }
});

module.exports = CreditHistory;
