const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const CashMovement = sequelize.define('CashMovement', {
    id: { type: DataTypes.STRING, primaryKey: true },
    shiftId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING },
    amount: { type: DataTypes.DECIMAL(20, 6) },
    currency: { type: DataTypes.STRING, defaultValue: 'USD' },
    paymentMethodId: { type: DataTypes.STRING },
    reason: { type: DataTypes.STRING },
    timestamp: { type: DataTypes.STRING }
});

module.exports = CashMovement;
