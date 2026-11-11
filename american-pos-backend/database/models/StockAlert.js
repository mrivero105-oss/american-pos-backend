const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const StockAlert = sequelize.define('StockAlert', {
    id: { type: DataTypes.STRING, primaryKey: true },
    productId: { type: DataTypes.STRING, allowNull: false },
    productName: { type: DataTypes.STRING, allowNull: false },
    saleId: { type: DataTypes.STRING, allowNull: false },
    companyId: { type: DataTypes.STRING, allowNull: true },
    cashierName: { type: DataTypes.STRING, allowNull: true },
    registerName: { type: DataTypes.STRING, allowNull: true },
    expectedStock: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const v = this.getDataValue('expectedStock');
            return v === null ? 0 : parseFloat(v);
        }
    },
    soldQuantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const v = this.getDataValue('soldQuantity');
            return v === null ? 0 : parseFloat(v);
        }
    },
    overdraftAmount: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const v = this.getDataValue('overdraftAmount');
            return v === null ? 0 : parseFloat(v);
        }
    },
    resolved: { type: DataTypes.BOOLEAN, defaultValue: false }
}, {
    timestamps: true
});

module.exports = StockAlert;
