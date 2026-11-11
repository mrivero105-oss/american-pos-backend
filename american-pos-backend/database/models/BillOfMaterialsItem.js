const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const BillOfMaterialsItem = sequelize.define('BillOfMaterialsItem', {
    id: { type: DataTypes.STRING, primaryKey: true },
    bomId: { type: DataTypes.STRING, allowNull: false },
    componentProductId: { type: DataTypes.STRING, allowNull: false }, // Insumo / Materia Prima
    quantityRequired: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        defaultValue: 1,
        get() {
            const val = this.getDataValue('quantityRequired');
            return val === null ? 0 : parseFloat(val);
        }
    },
    unit: { type: DataTypes.STRING, defaultValue: 'und' },
    wastePercentage: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('wastePercentage');
            return val === null ? 0 : parseFloat(val);
        }
    }
}, {
    timestamps: true,
    tableName: 'BillOfMaterialsItems'
});

module.exports = BillOfMaterialsItem;
