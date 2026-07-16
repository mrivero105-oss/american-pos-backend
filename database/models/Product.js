const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Product = sequelize.define('Product', {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING },
    price: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('price');
            return value === null ? null : parseFloat(value);
        }
    },
    stock: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('stock');
            return value === null ? null : parseFloat(value);
        }
    },
    category: { type: DataTypes.STRING },
    barcode: { type: DataTypes.STRING },
    imageUri: { type: DataTypes.TEXT },
    isSoldByWeight: { type: DataTypes.BOOLEAN, defaultValue: false },
    isFractional: { type: DataTypes.BOOLEAN, defaultValue: false },
    cost: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('cost');
            return value === null ? null : parseFloat(value);
        }
    },
    priceBs: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('priceBs');
            return value === null ? null : parseFloat(value);
        }
    },
    stockQuantity: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('stockQuantity');
            return value === null ? null : parseFloat(value);
        }
    },
    minStock: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const value = this.getDataValue('minStock');
            return value === null ? null : parseFloat(value);
        }
    },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    isCustom: { type: DataTypes.BOOLEAN, defaultValue: false },
    stockUnit: { type: DataTypes.STRING, defaultValue: 'kg' },
    taxStatus: { type: DataTypes.STRING, defaultValue: 'gravable' }, // 'gravable' o 'exento'
    supplierId: { type: DataTypes.STRING },
    bulkUnitName: { type: DataTypes.STRING, defaultValue: 'Bulto' },
    unitsPerBulk: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const value = this.getDataValue('unitsPerBulk');
            return value === null ? null : parseFloat(value);
        }
    },
    margin: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const value = this.getDataValue('margin');
            return value === null ? null : parseFloat(value);
        }
    },
    bulkCost: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const value = this.getDataValue('bulkCost');
            return value === null ? null : parseFloat(value);
        }
    },
    status: { type: DataTypes.STRING, defaultValue: 'active' }, // 'active' o 'inactive'
    allowNegative: { type: DataTypes.BOOLEAN, defaultValue: false },
    batchNumber: { type: DataTypes.STRING },
    expirationDate: { type: DataTypes.STRING },
    es_controlado: { type: DataTypes.BOOLEAN, defaultValue: false },
    principio_activo: { type: DataTypes.STRING, allowNull: true }
});

module.exports = Product;
