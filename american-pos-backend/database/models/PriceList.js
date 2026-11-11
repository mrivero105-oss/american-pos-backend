const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const PriceList = sequelize.define('PriceList', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    name: { type: DataTypes.STRING, allowNull: false }, // Ej: "Precio Detal", "Mayorista", "Distribuidor", "VIP"
    code: { type: DataTypes.STRING, allowNull: false }, // Ej: "DETAL", "MAYOR", "DISTRIB", "VIP"
    description: { type: DataTypes.STRING, defaultValue: '' },
    type: { 
        type: DataTypes.STRING, 
        defaultValue: 'PERCENTAGE' // 'PERCENTAGE' (descuento o recargo sobre precio base) o 'FIXED' (precios fijos por producto)
    },
    percentageAdjustment: { 
        type: DataTypes.DECIMAL(10, 2), 
        defaultValue: 0, // Ej: -15 (15% descuento) o 10 (10% recargo)
        get() {
            const val = this.getDataValue('percentageAdjustment');
            return val === null ? 0 : parseFloat(val);
        }
    },
    currency: { type: DataTypes.STRING, defaultValue: 'USD' },
    isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
    timestamps: true,
    tableName: 'PriceLists'
});

module.exports = PriceList;
