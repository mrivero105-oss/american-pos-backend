const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

/**
 * Almacenamiento transaccional en PostgreSQL para configuración operativa por empresa.
 * Protegida por RLS mediante la columna companyId.
 */
const BusinessSetting = sequelize.define('BusinessSetting', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, unique: true },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
}, {
    tableName: 'BusinessSettings'
});

module.exports = BusinessSetting;
