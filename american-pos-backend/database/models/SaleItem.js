const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');
const precision = require('../../utils/precision');

const SaleItem = sequelize.define('SaleItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    saleId: { type: DataTypes.STRING, allowNull: false },
    productId: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    quantity: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        get() {
            const value = this.getDataValue('quantity');
            return value === null ? null : precision.cleanDecimal(value);
        }
    },
    price: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        get() {
            const value = this.getDataValue('price');
            return value === null ? null : precision.cleanDecimal(value);
        }
    },
    cost: { 
        type: DataTypes.DECIMAL(20, 6),
        get() {
            const value = this.getDataValue('cost');
            return value === null ? null : precision.cleanDecimal(value);
        }
    },
    subtotal: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        get() {
            const value = this.getDataValue('subtotal');
            return value === null ? null : precision.cleanDecimal(value);
        }
    },
    category: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    batchNumber: { type: DataTypes.STRING },
    expirationDate: { type: DataTypes.STRING },
    es_controlado: { type: DataTypes.BOOLEAN, defaultValue: false },
    recipe: { type: DataTypes.JSONB },
    isBulk: { type: DataTypes.BOOLEAN, defaultValue: false },
    unitsPerBulk: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const value = this.getDataValue('unitsPerBulk');
            return value === null ? 1 : precision.cleanDecimal(value, 1);
        }
    },
    isMidBulk: { type: DataTypes.BOOLEAN, defaultValue: false },
    unitsPerMidBulk: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const value = this.getDataValue('unitsPerMidBulk');
            return value === null ? 1 : precision.cleanDecimal(value, 1);
        }
    },
    presentationId: { type: DataTypes.STRING, allowNull: true },
    presentationName: { type: DataTypes.STRING, allowNull: true },
    factorConversion: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const value = this.getDataValue('factorConversion');
            return value === null ? 1 : precision.cleanDecimal(value, 1);
        }
    },
    promoDiscount: {
        type: DataTypes.DECIMAL(20, 6),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('promoDiscount');
            return value === null ? 0 : precision.cleanDecimal(value, 0);
        }
    },
    appliedPromoName: { type: DataTypes.STRING, allowNull: true }
});

module.exports = SaleItem;
