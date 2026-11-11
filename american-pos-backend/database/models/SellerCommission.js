const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const SellerCommission = sequelize.define('SellerCommission', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    userId: { type: DataTypes.STRING, allowNull: false },
    userName: { type: DataTypes.STRING, defaultValue: '' },
    periodMonth: { type: DataTypes.INTEGER, allowNull: false },
    periodYear: { type: DataTypes.INTEGER, allowNull: false },
    commissionRate: { 
        type: DataTypes.DECIMAL(10, 2), 
        defaultValue: 3.0, // Porcentaje de comisión ej: 3.0%
        get() {
            const val = this.getDataValue('commissionRate');
            return val === null ? 3.0 : parseFloat(val);
        }
    },
    calculationBasis: { 
        type: DataTypes.STRING, 
        defaultValue: 'VENTAS_TOTALES' // 'VENTAS_TOTALES', 'UTILIDAD_BRUTA', 'COBROS_EFECTIVOS'
    },
    totalSales: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('totalSales');
            return val === null ? 0 : parseFloat(val);
        }
    },
    salesCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    commissionAmount: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('commissionAmount');
            return val === null ? 0 : parseFloat(val);
        }
    },
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'CALCULADO' // CALCULADO, LIQUIDADO, PAGADO
    },
    liquidatedAt: { type: DataTypes.DATE, allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    notes: { type: DataTypes.TEXT, defaultValue: '' }
}, {
    timestamps: true,
    tableName: 'SellerCommissions'
});

module.exports = SellerCommission;
