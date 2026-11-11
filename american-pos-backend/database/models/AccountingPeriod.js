const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const AccountingPeriod = sequelize.define('AccountingPeriod', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    periodMonth: { type: DataTypes.INTEGER, allowNull: false }, // 1 - 12
    periodYear: { type: DataTypes.INTEGER, allowNull: false }, // Ej: 2026
    isClosed: { type: DataTypes.BOOLEAN, defaultValue: false },
    closedAt: { type: DataTypes.DATE, allowNull: true },
    closedBy: { type: DataTypes.STRING, defaultValue: '' },
    closureNotes: { type: DataTypes.TEXT, defaultValue: '' },
    reopenedAt: { type: DataTypes.DATE, allowNull: true },
    reopenedBy: { type: DataTypes.STRING, defaultValue: '' },
    reopenReason: { type: DataTypes.TEXT, defaultValue: '' },
    
    // Snapshots al momento del cierre
    salesTotal: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('salesTotal');
            return val === null ? 0 : parseFloat(val);
        }
    },
    costTotal: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('costTotal');
            return val === null ? 0 : parseFloat(val);
        }
    },
    grossProfit: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('grossProfit');
            return val === null ? 0 : parseFloat(val);
        }
    },
    expensesTotal: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('expensesTotal');
            return val === null ? 0 : parseFloat(val);
        }
    },
    netProfit: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('netProfit');
            return val === null ? 0 : parseFloat(val);
        }
    }
}, {
    timestamps: true,
    tableName: 'AccountingPeriods'
});

module.exports = AccountingPeriod;
