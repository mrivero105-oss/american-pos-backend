const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const AssetDepreciationLog = sequelize.define('AssetDepreciationLog', {
    id: { type: DataTypes.STRING, primaryKey: true },
    assetId: { type: DataTypes.STRING, allowNull: false },
    period: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM
    depreciationAmount: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    accumulatedAfter: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    bookValueAfter: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    journalEntryId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING, defaultValue: 'default' }
});

module.exports = AssetDepreciationLog;
