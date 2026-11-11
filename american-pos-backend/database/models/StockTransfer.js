const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const StockTransfer = sequelize.define('StockTransfer', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    transferNumber: { type: DataTypes.STRING, allowNull: false }, // Ej: TRF-000001
    fromWarehouseId: { type: DataTypes.STRING, allowNull: false },
    toWarehouseId: { type: DataTypes.STRING, allowNull: false },
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'BORRADOR' // BORRADOR, EN_TRANSITO, RECIBIDO_TOTAL, RECIBIDO_DISCREPANCIA, CANCELADO
    },
    driverName: { type: DataTypes.STRING, defaultValue: '' },
    vehiclePlate: { type: DataTypes.STRING, defaultValue: '' },
    notes: { type: DataTypes.TEXT, defaultValue: '' },
    dispatchedBy: { type: DataTypes.STRING, defaultValue: '' },
    receivedBy: { type: DataTypes.STRING, defaultValue: '' },
    dispatchDate: { type: DataTypes.DATE, allowNull: true },
    receptionDate: { type: DataTypes.DATE, allowNull: true },
    itemsCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    totalUnits: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalUnits');
            return val === null ? 0 : parseFloat(val);
        }
    }
}, {
    timestamps: true,
    tableName: 'StockTransfers'
});

module.exports = StockTransfer;
