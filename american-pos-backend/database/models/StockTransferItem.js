const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const StockTransferItem = sequelize.define('StockTransferItem', {
    id: { type: DataTypes.STRING, primaryKey: true },
    stockTransferId: { type: DataTypes.STRING, allowNull: false },
    productId: { type: DataTypes.STRING, allowNull: false },
    productName: { type: DataTypes.STRING, defaultValue: '' },
    productSku: { type: DataTypes.STRING, defaultValue: '' },
    quantityDispatched: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('quantityDispatched');
            return val === null ? 0 : parseFloat(val);
        }
    },
    quantityReceived: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('quantityReceived');
            return val === null ? 0 : parseFloat(val);
        }
    },
    discrepancy: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('discrepancy');
            return val === null ? 0 : parseFloat(val);
        }
    },
    discrepancyReason: { type: DataTypes.STRING, defaultValue: '' },
    status: { type: DataTypes.STRING, defaultValue: 'PENDIENTE' } // PENDIENTE, CONFORME, DISCREPANCIA
}, {
    timestamps: true,
    tableName: 'StockTransferItems'
});

module.exports = StockTransferItem;
