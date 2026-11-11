const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Promotion = sequelize.define('Promotion', {
    id: { 
        type: DataTypes.STRING, 
        primaryKey: true 
    },
    companyId: { 
        type: DataTypes.STRING, 
        allowNull: false, 
        defaultValue: 'default' 
    },
    name: { 
        type: DataTypes.STRING, 
        allowNull: false 
    },
    code: { 
        type: DataTypes.STRING, 
        allowNull: true 
    },
    description: { 
        type: DataTypes.STRING, 
        defaultValue: '' 
    },
    type: { 
        type: DataTypes.STRING, 
        allowNull: false,
        defaultValue: 'BUY_X_GET_Y' 
        // BUY_X_GET_Y, VOLUME_DISCOUNT, COMBO, CATEGORY_DISCOUNT, PAYMENT_METHOD_DISCOUNT
    },
    buyQuantity: { 
        type: DataTypes.DECIMAL(10, 2), 
        defaultValue: 2 
    },
    payQuantity: { 
        type: DataTypes.DECIMAL(10, 2), 
        defaultValue: 1 
    },
    discountPercentage: { 
        type: DataTypes.DECIMAL(10, 2), 
        defaultValue: 0 
    },
    fixedPrice: { 
        type: DataTypes.DECIMAL(15, 4), 
        defaultValue: null,
        allowNull: true
    },
    targetProductIds: { 
        type: DataTypes.JSONB, 
        defaultValue: [] 
    },
    targetCategories: { 
        type: DataTypes.JSONB, 
        defaultValue: [] 
    },
    targetPaymentMethods: { 
        type: DataTypes.JSONB, 
        defaultValue: [] 
    },
    minQuantity: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 1
    },
    minQuantityUnit: {
        type: DataTypes.STRING,
        defaultValue: 'UNITS'
    },
    minUnits: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 1
    },
    comboItems: { 
        type: DataTypes.JSONB, 
        defaultValue: [] 
    },
    minCartTotal: { 
        type: DataTypes.DECIMAL(15, 2), 
        defaultValue: 0 
    },
    daysOfWeek: { 
        type: DataTypes.JSONB, 
        defaultValue: [0, 1, 2, 3, 4, 5, 6] 
    },
    startDate: { 
        type: DataTypes.DATE, 
        allowNull: true 
    },
    endDate: { 
        type: DataTypes.DATE, 
        allowNull: true 
    },
    startTime: { 
        type: DataTypes.STRING, 
        allowNull: true 
    },
    endTime: { 
        type: DataTypes.STRING, 
        allowNull: true 
    },
    priority: { 
        type: DataTypes.INTEGER, 
        defaultValue: 1 
    },
    isActive: { 
        type: DataTypes.BOOLEAN, 
        defaultValue: true 
    },
    allowStacking: { 
        type: DataTypes.BOOLEAN, 
        defaultValue: false 
    },
    applyAutomatically: { 
        type: DataTypes.BOOLEAN, 
        defaultValue: true 
    }
}, {
    timestamps: true,
    tableName: 'Promotions'
});

module.exports = Promotion;
