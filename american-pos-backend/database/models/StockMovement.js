const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const StockMovement = sequelize.define('StockMovement', {
    id: { type: DataTypes.STRING, primaryKey: true },
    productId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    branchId: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING }, // IN, OUT, ADJUSTMENT_IN, ADJUSTMENT_OUT, WASTE
    category: { type: DataTypes.STRING, defaultValue: '' }, // rotura, caducidad, consumo_interno, merma, extravio, conteo_fisico, ajuste_positivo
    quantity: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('quantity');
            return value === null ? null : parseFloat(value);
        }
    },
    stockBefore: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('stockBefore');
            return value === null ? null : parseFloat(value);
        }
    }, // Stock antes del movimiento
    stockAfter: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('stockAfter');
            return value === null ? null : parseFloat(value);
        }
    },  // Stock después del movimiento
    costPrice: {
        type: DataTypes.DECIMAL(20, 4),
        defaultValue: 0,
        get() {
            const val = this.getDataValue('costPrice');
            return val === null ? 0 : parseFloat(val);
        }
    },
    totalCost: {
        type: DataTypes.DECIMAL(20, 4),
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalCost');
            return val === null ? 0 : parseFloat(val);
        }
    },
    responsibleName: { type: DataTypes.STRING, defaultValue: '' },
    notes: { type: DataTypes.TEXT, defaultValue: '' }, // Justificación de auditoría
    reason: { type: DataTypes.STRING },
    referenceId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING }
});

module.exports = StockMovement;
