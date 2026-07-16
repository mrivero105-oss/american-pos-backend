const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const ProductLot = sequelize.define('ProductLot', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false },
    productId: { type: DataTypes.STRING, allowNull: false },
    lotNumber: { type: DataTypes.STRING, allowNull: false },
    quantity: { 
        type: DataTypes.DECIMAL(20, 6),
        allowNull: false,
        defaultValue: 0,
        get() {
            const value = this.getDataValue('quantity');
            return value === null ? null : parseFloat(value);
        }
    },
    expirationDate: { type: DataTypes.DATEONLY, allowNull: true },
    cost: { 
        type: DataTypes.DECIMAL(20, 6),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('cost');
            return value === null ? null : parseFloat(value);
        }
    },
    supplierId: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, defaultValue: 'active' } // active, exhausted, expired
});

module.exports = ProductLot;
