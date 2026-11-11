const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const JournalEntryLine = sequelize.define('JournalEntryLine', {
    id: { type: DataTypes.STRING, primaryKey: true },
    journalEntryId: { type: DataTypes.STRING, allowNull: false },
    accountId: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, defaultValue: '' },
    debit: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('debit');
            return val === null ? 0 : parseFloat(val);
        }
    },
    credit: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('credit');
            return val === null ? 0 : parseFloat(val);
        }
    },
    lineOrder: { type: DataTypes.INTEGER, defaultValue: 0 }
}, {
    timestamps: true,
    tableName: 'JournalEntryLines'
});

module.exports = JournalEntryLine;
