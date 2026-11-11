const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const PayrollPeriod = sequelize.define('PayrollPeriod', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    periodName: { type: DataTypes.STRING, allowNull: false }, // Ej: 1era Quincena - Septiembre 2026
    frequency: { type: DataTypes.STRING, defaultValue: 'QUINCENAL' }, // 'QUINCENAL', 'MENSUAL', 'SEMANAL'
    startDate: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD
    endDate: { type: DataTypes.STRING, allowNull: false },
    paymentDate: { type: DataTypes.STRING, allowNull: false },
    exchangeRate: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 1,
        get() {
            const val = this.getDataValue('exchangeRate');
            return val === null ? 1 : parseFloat(val);
        }
    },
    totalEarnings: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalEarnings');
            return val === null ? 0 : parseFloat(val);
        }
    },
    totalDeductions: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalDeductions');
            return val === null ? 0 : parseFloat(val);
        }
    },
    totalNet: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalNet');
            return val === null ? 0 : parseFloat(val);
        }
    },
    status: { type: DataTypes.STRING, defaultValue: 'OPEN' }, // 'OPEN', 'CALCULATED', 'CLOSED'
    journalEntryId: { type: DataTypes.STRING, allowNull: true },
    closedAt: { type: DataTypes.DATE, allowNull: true },
    closedBy: { type: DataTypes.STRING, defaultValue: '' }
}, {
    timestamps: true,
    tableName: 'PayrollPeriods'
});

module.exports = PayrollPeriod;
