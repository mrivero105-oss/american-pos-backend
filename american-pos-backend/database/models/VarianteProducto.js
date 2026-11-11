const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const VarianteProducto = sequelize.define('VarianteProducto', {
    id: { type: DataTypes.STRING, primaryKey: true },
    producto_id: { type: DataTypes.STRING, allowNull: false },
    talla: { type: DataTypes.STRING, allowNull: false },
    color: { type: DataTypes.STRING, allowNull: false },
    sku_variante: { type: DataTypes.STRING, allowNull: true },
    stock: { 
        type: DataTypes.DECIMAL(20, 6),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('stock');
            return value === null ? 0 : parseFloat(value);
        }
    },
    precio_adicional: { 
        type: DataTypes.DECIMAL(20, 6),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('precio_adicional');
            return value === null ? 0 : parseFloat(value);
        }
    }
}, {
    tableName: 'variante_productos'
});

module.exports = VarianteProducto;
