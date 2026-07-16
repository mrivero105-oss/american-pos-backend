const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Quotation = sequelize.define('Quotation', {
    id: { type: DataTypes.STRING, primaryKey: true },
    customerId: { type: DataTypes.STRING },
    customerName: { type: DataTypes.STRING },
    customerDocument: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING },
    total: { type: DataTypes.DECIMAL(20, 6) },
    items: { type: DataTypes.JSON },
    notes: { type: DataTypes.TEXT },
    status: { type: DataTypes.STRING, defaultValue: 'pending' },
    validUntil: { type: DataTypes.STRING }
});

module.exports = Quotation;
