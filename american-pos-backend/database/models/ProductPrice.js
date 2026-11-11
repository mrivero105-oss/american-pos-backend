const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const ProductPrice = sequelize.define('ProductPrice', {
    id: { type: DataTypes.STRING, primaryKey: true },
    priceListId: { type: DataTypes.STRING, allowNull: false },
    productId: { type: DataTypes.STRING, allowNull: false },
    price: { 
        type: DataTypes.DECIMAL(20, 4), 
        allowNull: false,
        get() {
            const val = this.getDataValue('price');
            return val === null ? 0 : parseFloat(val);
        }
    },
    minQuantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1, // Cantidad mínima para aplicar precio especial (ej: a partir de 6 unidades)
        get() {
            const val = this.getDataValue('minQuantity');
            return val === null ? 1 : parseFloat(val);
        }
    }
}, {
    timestamps: true,
    tableName: 'ProductPrices'
});

module.exports = ProductPrice;
