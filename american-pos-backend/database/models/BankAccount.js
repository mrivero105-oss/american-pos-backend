const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const BankAccount = sequelize.define('BankAccount', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    bankName: { type: DataTypes.STRING, allowNull: false },
    accountNumber: { type: DataTypes.STRING, allowNull: true },
    accountType: { 
        type: DataTypes.STRING, 
        defaultValue: 'CORRIENTE' // CORRIENTE, AHORRO, CUSTODIA_USD, DIGITAL, PAGO_MOVIL
    },
    currency: { type: DataTypes.STRING, defaultValue: 'VES' }, // VES, USD, EUR
    initialBalance: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    currentBalance: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    accountHolder: { type: DataTypes.STRING, allowNull: true },
    holderIdDoc: { type: DataTypes.STRING, allowNull: true }, // RIF o Cédula
    phone: { type: DataTypes.STRING, allowNull: true }, // Para Pago Móvil
    color: { type: DataTypes.STRING, defaultValue: '#0284c7' },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
    timestamps: true
});

module.exports = BankAccount;
