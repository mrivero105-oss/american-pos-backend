const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const JournalEntry = sequelize.define('JournalEntry', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    entryNumber: { type: DataTypes.STRING, allowNull: false }, // Ej: AS-2026-00001
    entryDate: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD
    description: { type: DataTypes.TEXT, defaultValue: '' },
    entryType: { 
        type: DataTypes.STRING, 
        defaultValue: 'AUTOMATIC' // 'AUTOMATIC', 'MANUAL', 'ADJUSTMENT', 'CLOSING'
    },
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'POSTED' // 'POSTED', 'DRAFT', 'REVERSED'
    },
    totalDebit: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalDebit');
            return val === null ? 0 : parseFloat(val);
        }
    },
    totalCredit: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalCredit');
            return val === null ? 0 : parseFloat(val);
        }
    },
    currency: { type: DataTypes.STRING, defaultValue: 'USD' },
    exchangeRate: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const val = this.getDataValue('exchangeRate');
            return val === null ? 1 : parseFloat(val);
        }
    },
    referenceType: { 
        type: DataTypes.STRING, 
        allowNull: true // 'SALE', 'PURCHASE', 'EXPENSE', 'BANK_TRANSFER', 'PAYROLL', 'PRODUCTION', 'DEPRECIATION', 'MANUAL'
    },
    referenceId: { type: DataTypes.STRING, allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: true }
}, {
    timestamps: true,
    tableName: 'JournalEntries'
});

module.exports = JournalEntry;
