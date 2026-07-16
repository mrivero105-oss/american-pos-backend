const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const CashShift = sequelize.define('CashShift', {
    id: { type: DataTypes.STRING, primaryKey: true },
    openedAt: { type: DataTypes.STRING },
    closedAt: { type: DataTypes.STRING },
    initialAmount: { type: DataTypes.DECIMAL(20, 6) },
    initialBreakdown: { type: DataTypes.JSON, defaultValue: {} },
    finalAmount: { type: DataTypes.DECIMAL(20, 6) },
    expectedAmount: { type: DataTypes.DECIMAL(20, 6) },
    expectedBreakdown: { type: DataTypes.JSON, defaultValue: {} },
    difference: { type: DataTypes.DECIMAL(20, 6) },
    status: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    userName: { type: DataTypes.STRING },
    openingNotes: { type: DataTypes.TEXT },
    closingNotes: { type: DataTypes.TEXT },
    movements: { type: DataTypes.JSON },
    salesSummary: { type: DataTypes.JSON },
    registerId: { type: DataTypes.STRING, defaultValue: '1' },
    registerName: { type: DataTypes.STRING, defaultValue: 'Caja Principal' },
    exchangeRateAtClose: { type: DataTypes.DECIMAL(20, 6) }
});

module.exports = CashShift;
