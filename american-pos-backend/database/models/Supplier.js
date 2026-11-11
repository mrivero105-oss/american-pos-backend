const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Supplier = sequelize.define('Supplier', {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING },
    rif: { type: DataTypes.STRING },
    contact: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    address: { type: DataTypes.TEXT },
    notes: { type: DataTypes.TEXT },
    logoUri: { type: DataTypes.TEXT }, 
    creditBalance: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

module.exports = Supplier;
