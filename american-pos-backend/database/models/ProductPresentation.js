const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');
const precision = require('../../utils/precision');

const ProductPresentation = sequelize.define('ProductPresentation', {
    id: { 
        type: DataTypes.STRING, 
        primaryKey: true 
    },
    productId: { 
        type: DataTypes.STRING, 
        allowNull: false 
    },
    name: { 
        type: DataTypes.STRING, 
        allowNull: false 
    },
    factorConversion: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        defaultValue: 1,
        validate: {
            min: 0.001
        },
        get() {
            const val = this.getDataValue('factorConversion');
            return val === null ? 1 : precision.cleanDecimal(val);
        }
    },
    price: { 
        type: DataTypes.DECIMAL(20, 6), 
        allowNull: false,
        defaultValue: 0,
        get() {
            const val = this.getDataValue('price');
            return val === null ? 0 : precision.cleanDecimal(val);
        }
    },
    cost: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('cost');
            return val === null ? 0 : precision.cleanDecimal(val);
        }
    },
    marginTarget: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: null
    },
    barcode: { 
        type: DataTypes.STRING, 
        allowNull: true,
        unique: true,
        set(val) {
            const clean = typeof val === 'string' ? val.trim() : null;
            this.setDataValue('barcode', clean ? clean : null);
        }
    },
    isDefaultPurchase: { 
        type: DataTypes.BOOLEAN, 
        defaultValue: false 
    },
    isDefaultSale: { 
        type: DataTypes.BOOLEAN, 
        defaultValue: false 
    },
    orderIndex: { 
        type: DataTypes.INTEGER, 
        defaultValue: 0 
    },
    companyId: { 
        type: DataTypes.STRING, 
        allowNull: true 
    }
}, {
    timestamps: true,
    tableName: 'product_presentaciones',
    indexes: [
        {
            fields: ['productId']
        },
        {
            unique: true,
            fields: ['barcode'],
            where: {
                barcode: { [require('sequelize').Op.ne]: null }
            }
        }
    ]
});

module.exports = ProductPresentation;
