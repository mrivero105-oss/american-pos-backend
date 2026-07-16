const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const SupplierProductMapping = sequelize.define('SupplierProductMapping', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    externalName: { type: DataTypes.STRING, allowNull: false }, // Nombre tal cual viene en el PDF
    localProductId: { 
        type: DataTypes.STRING, 
        allowNull: false,
        references: {
            model: 'Products',
            key: 'id'
        }
    },
    supplierId: { type: DataTypes.STRING, allowNull: true },
    lastUpdated: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    indexes: [
        { unique: true, fields: ['externalName', 'supplierId'] }
    ]
});

module.exports = SupplierProductMapping;
