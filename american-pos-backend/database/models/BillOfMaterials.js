const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const BillOfMaterials = sequelize.define('BillOfMaterials', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    recipeName: { type: DataTypes.STRING, allowNull: false }, // Ej: Combo Hamburguesa Especial
    targetProductId: { type: DataTypes.STRING, allowNull: false }, // Producto Terminado / Combo
    yieldQuantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const val = this.getDataValue('yieldQuantity');
            return val === null ? 1 : parseFloat(val);
        }
    },
    laborCost: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('laborCost');
            return val === null ? 0 : parseFloat(val);
        }
    },
    overheadCost: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('overheadCost');
            return val === null ? 0 : parseFloat(val);
        }
    },
    isKit: { type: DataTypes.BOOLEAN, defaultValue: false }, // true = combo POS en tiempo real
    instructions: { type: DataTypes.TEXT, defaultValue: '' },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
    timestamps: true,
    tableName: 'BillOfMaterials'
});

module.exports = BillOfMaterials;
