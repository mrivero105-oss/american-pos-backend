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
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    code: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING, defaultValue: 'STORE' }, // 'STORE' | 'WAREHOUSE' | 'EXPRESS' | 'PHARMACY'
    managerName: { type: DataTypes.STRING },
    color: { type: DataTypes.STRING },
    invoicePrefix: { type: DataTypes.STRING }
});

module.exports = Branch;
