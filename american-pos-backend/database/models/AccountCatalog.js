const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const AccountCatalog = sequelize.define('AccountCatalog', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    accountType: { 
        type: DataTypes.STRING, 
        allowNull: false,
        defaultValue: 'ASSET' // 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE'
    },
    nature: { 
        type: DataTypes.STRING, 
        allowNull: false,
        defaultValue: 'DEBIT' // 'DEBIT' | 'CREDIT'
    },
    level: { type: DataTypes.INTEGER, defaultValue: 1 },
    parentId: { type: DataTypes.STRING, allowNull: true },
    isSelectable: { type: DataTypes.BOOLEAN, defaultValue: true },
    balanceUSD: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('balanceUSD');
            return val === null ? 0 : parseFloat(val);
        }
    },
    balanceVES: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('balanceVES');
            return val === null ? 0 : parseFloat(val);
        }
    },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    description: { type: DataTypes.TEXT, defaultValue: '' }
}, {
    timestamps: true,
    tableName: 'AccountCatalogs'
});

module.exports = AccountCatalog;
