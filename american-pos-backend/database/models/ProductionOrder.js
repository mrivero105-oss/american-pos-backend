const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const ProductionOrder = sequelize.define('ProductionOrder', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    orderNumber: { type: DataTypes.STRING, allowNull: false }, // Ej: OP-2026-0001
    bomId: { type: DataTypes.STRING, allowNull: false },
    warehouseSourceId: { type: DataTypes.STRING, allowNull: true },
    warehouseDestId: { type: DataTypes.STRING, allowNull: true },
    quantityPlanned: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const val = this.getDataValue('quantityPlanned');
            return val === null ? 1 : parseFloat(val);
        }
    },
    quantityActual: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('quantityActual');
            return val === null ? 0 : parseFloat(val);
        }
    },
    totalRawCost: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalRawCost');
            return val === null ? 0 : parseFloat(val);
        }
    },
    totalProductionCost: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalProductionCost');
            return val === null ? 0 : parseFloat(val);
        }
    },
    unitFinalCost: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('unitFinalCost');
            return val === null ? 0 : parseFloat(val);
        }
    },
    status: { type: DataTypes.STRING, defaultValue: 'DRAFT' }, // 'DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
    completedAt: { type: DataTypes.DATE, allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: true },
    journalEntryId: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, defaultValue: '' }
}, {
    timestamps: true,
    tableName: 'ProductionOrders'
});

module.exports = ProductionOrder;
