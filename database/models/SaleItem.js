const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const SaleItem = sequelize.define('SaleItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    saleId: { type: DataTypes.STRING, allowNull: false },
    productId: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    quantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        get() {
            const value = this.getDataValue('quantity');
            return value === null ? null : parseFloat(value);
        }
    },
    price: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        get() {
            const value = this.getDataValue('price');
            return value === null ? null : parseFloat(value);
        }
    },
    cost: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('cost');
            return value === null ? null : parseFloat(value);
        }
    },
    subtotal: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        get() {
            const value = this.getDataValue('subtotal');
            return value === null ? null : parseFloat(value);
        }
    },
    category: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    batchNumber: { type: DataTypes.STRING },
    expirationDate: { type: DataTypes.STRING },
    es_controlado: { type: DataTypes.BOOLEAN, defaultValue: false },
    recipe: { type: DataTypes.JSON }
});

module.exports = SaleItem;
