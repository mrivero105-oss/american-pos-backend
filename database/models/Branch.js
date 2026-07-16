const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Branch = sequelize.define('Branch', {
    id: { type: DataTypes.STRING, primaryKey: true },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    name: { type: DataTypes.STRING },
    location: { type: DataTypes.STRING },
    address: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    isMain: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

module.exports = Branch;
