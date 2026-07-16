const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Customer = sequelize.define('Customer', {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING },
    idDocument: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    address: { type: DataTypes.TEXT },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    creditLimit: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    creditBalance: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    loyaltyPoints: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    isVIP: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

module.exports = Customer;
