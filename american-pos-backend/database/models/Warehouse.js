const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Warehouse = sequelize.define('Warehouse', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    branchId: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false }, // Ej: "Piso de Venta Principal", "Depósito Central", "Almacén de Merma"
    code: { type: DataTypes.STRING, allowNull: false }, // Ej: "ALM-01", "DEP-01", "MERMA"
    description: { type: DataTypes.STRING, defaultValue: '' },
    location: { type: DataTypes.STRING, defaultValue: '' },
    isDefaultSaleWarehouse: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    status: { type: DataTypes.STRING, defaultValue: 'ACTIVO' }
}, {
    timestamps: true,
    tableName: 'Warehouses'
});

module.exports = Warehouse;
