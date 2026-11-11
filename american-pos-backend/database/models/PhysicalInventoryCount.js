const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const PhysicalInventoryCount = sequelize.define('PhysicalInventoryCount', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    warehouseId: { type: DataTypes.STRING, allowNull: false },
    countNumber: { type: DataTypes.STRING, allowNull: false }, // Ej: CNT-000001
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'EN_PROGRESO' // EN_PROGRESO, APLICADO, CANCELADO
    },
    countedBy: { type: DataTypes.STRING, defaultValue: '' },
    approvedBy: { type: DataTypes.STRING, defaultValue: '' },
    blindCount: { type: DataTypes.BOOLEAN, defaultValue: true }, // Si es conteo ciego, el operador no ve el stock del sistema
    totalDiscrepancyUnits: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalDiscrepancyUnits');
            return val === null ? 0 : parseFloat(val);
        }
    },
    totalDiscrepancyCost: { 
        type: DataTypes.DECIMAL(20, 4), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalDiscrepancyCost');
            return val === null ? 0 : parseFloat(val);
        }
    },
    notes: { type: DataTypes.TEXT, defaultValue: '' },
    // JSON de items: [{ productId, productName, sku, systemStock, countedStock, difference, costPrice }]
    items: {
        type: DataTypes.TEXT,
        defaultValue: '[]',
        get() {
            const raw = this.getDataValue('items');
            try {
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        },
        set(val) {
            this.setDataValue('items', typeof val === 'string' ? val : JSON.stringify(val || []));
        }
    }
}, {
    timestamps: true,
    tableName: 'PhysicalInventoryCounts'
});

module.exports = PhysicalInventoryCount;
