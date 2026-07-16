const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Expense = sequelize.define('Expense', {
    id: { type: DataTypes.STRING, primaryKey: true },
    description: { type: DataTypes.STRING },
    category: { type: DataTypes.STRING },
    amount: { type: DataTypes.DECIMAL(20, 6) },
    currency: { type: DataTypes.STRING, defaultValue: 'USD' },
    date: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING }
});

module.exports = Expense;
