const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const FixedAsset = sequelize.define('FixedAsset', {
    id: { type: DataTypes.STRING, primaryKey: true },
    code: { type: DataTypes.STRING, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, defaultValue: 'MACHINERY' }, // VEHICLE, MACHINERY, FURNITURE, IT_EQUIPMENT, BUILDING, OTHER
    purchaseDate: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD
    purchaseCost: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    salvageValue: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    usefulLifeMonths: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
    accumulatedDepreciation: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    currentBookValue: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    location: { type: DataTypes.STRING },
    serialNumber: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING, defaultValue: 'ACTIVE' }, // ACTIVE, FULLY_DEPRECIATED, DISPOSED
    companyId: { type: DataTypes.STRING, defaultValue: 'default' }
});

module.exports = FixedAsset;
