const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const PayrollReceipt = sequelize.define('PayrollReceipt', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    payrollPeriodId: { type: DataTypes.STRING, allowNull: false },
    employeeId: { type: DataTypes.STRING, allowNull: false },
    daysWorked: { type: DataTypes.INTEGER, defaultValue: 15 },
    baseEarnings: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('baseEarnings');
            return val === null ? 0 : parseFloat(val);
        }
    },
    foodAllowance: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('foodAllowance');
            return val === null ? 0 : parseFloat(val);
        }
    },
    overtimeAmount: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('overtimeAmount');
            return val === null ? 0 : parseFloat(val);
        }
    },
    commissionsAmount: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('commissionsAmount');
            return val === null ? 0 : parseFloat(val);
        }
    },
    otherBonuses: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('otherBonuses');
            return val === null ? 0 : parseFloat(val);
        }
    },
    deductionIvss: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('deductionIvss');
            return val === null ? 0 : parseFloat(val);
        }
    },
    deductionFaov: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('deductionFaov');
            return val === null ? 0 : parseFloat(val);
        }
    },
    deductionRpe: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('deductionRpe');
            return val === null ? 0 : parseFloat(val);
        }
    },
    deductionAdvances: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('deductionAdvances');
            return val === null ? 0 : parseFloat(val);
        }
    },
    netAmount: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('netAmount');
            return val === null ? 0 : parseFloat(val);
        }
    },
    currency: { type: DataTypes.STRING, defaultValue: 'USD' },
    receiptHash: { type: DataTypes.STRING, defaultValue: '' }
}, {
    timestamps: true,
    tableName: 'PayrollReceipts'
});

module.exports = PayrollReceipt;
