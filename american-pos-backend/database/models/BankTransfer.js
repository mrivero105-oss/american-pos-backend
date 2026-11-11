const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const BankTransfer = sequelize.define('BankTransfer', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    fromType: { type: DataTypes.STRING, allowNull: false }, // BANK, CASH_DRAWER
    fromId: { type: DataTypes.STRING, allowNull: false }, // bankAccountId o cashShiftId
    toType: { type: DataTypes.STRING, allowNull: false }, // BANK, CASH_DRAWER
    toId: { type: DataTypes.STRING, allowNull: false }, // bankAccountId o cashShiftId
    amountSent: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    currencySent: { type: DataTypes.STRING, defaultValue: 'VES' },
    amountReceived: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    currencyReceived: { type: DataTypes.STRING, defaultValue: 'VES' },
    exchangeRate: { type: DataTypes.DECIMAL(20, 6), defaultValue: 1.0 },
    referenceNumber: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.STRING, allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: true },
    date: { type: DataTypes.STRING, allowNull: false }
}, {
    timestamps: true
});

module.exports = BankTransfer;
