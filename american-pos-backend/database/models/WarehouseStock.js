const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const WarehouseStock = sequelize.define('WarehouseStock', {
    id: { type: DataTypes.STRING, primaryKey: true },
    warehouseId: { type: DataTypes.STRING, allowNull: false },
    productId: { type: DataTypes.STRING, allowNull: false },
    quantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('quantity');
            return val === null ? 0 : parseFloat(val);
        }
    },
    reservedQuantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('reservedQuantity');
            return val === null ? 0 : parseFloat(val);
        }
    },
    locationInWarehouse: { type: DataTypes.STRING, defaultValue: '' }, // Ej: Pasillo 2, Estante 4
    companyId: { type: DataTypes.STRING, defaultValue: 'default' }
}, {
    timestamps: true,
    tableName: 'WarehouseStocks'
});

module.exports = WarehouseStock;
