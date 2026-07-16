const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const StockMovement = sequelize.define('StockMovement', {
    id: { type: DataTypes.STRING, primaryKey: true },
    productId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING },
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
    reason: { type: DataTypes.STRING },
    referenceId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING }
});

module.exports = StockMovement;
