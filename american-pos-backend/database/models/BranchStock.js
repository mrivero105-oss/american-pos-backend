const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const BranchStock = sequelize.define('BranchStock', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    branchId: { type: DataTypes.STRING, allowNull: false },
    productId: { type: DataTypes.STRING, allowNull: false },
    quantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const value = this.getDataValue('quantity');
            return value === null ? null : parseFloat(value);
        }
    },
    companyId: { type: DataTypes.STRING, allowNull: true }
});

module.exports = BranchStock;
