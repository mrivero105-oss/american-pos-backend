const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Refund = sequelize.define('Refund', {
    id: { type: DataTypes.STRING, primaryKey: true },
    saleId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    reason: { type: DataTypes.STRING },
    amount: { type: DataTypes.DECIMAL(20, 6) },
    items: { type: DataTypes.JSON },
    paymentMethods: { type: DataTypes.JSON }, // Cómo se devolvió el dinero
    status: { type: DataTypes.STRING, defaultValue: 'completed' },
    supervisorApprovalId: { type: DataTypes.STRING }
});

module.exports = Refund;
