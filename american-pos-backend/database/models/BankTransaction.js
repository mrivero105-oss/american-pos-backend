const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const BankTransaction = sequelize.define('BankTransaction', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    bankAccountId: { type: DataTypes.STRING, allowNull: false },
    type: { 
        type: DataTypes.STRING, 
        allowNull: false // INGRESO, EGRESO, TRANSFERENCIA_ENTRADA, TRANSFERENCIA_SALIDA, COMISION_BANCARIA
    },
    amount: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    currency: { type: DataTypes.STRING, defaultValue: 'VES' },
    exchangeRate: { type: DataTypes.DECIMAL(20, 6), defaultValue: 1.0 },
    referenceNumber: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, defaultValue: 'GENERAL' }, // VENTA, COBRO_CLIENTE, PAGO_PROVEEDOR, GASTO, DEPOSITO_CAJA, TRANSFERENCIA
    date: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM-DD
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'PENDIENTE' // PENDIENTE, CONCILIADO
    },
    reconciledAt: { type: DataTypes.DATE, allowNull: true },
    reconciledBy: { type: DataTypes.STRING, allowNull: true },
    relatedSaleId: { type: DataTypes.STRING, allowNull: true },
    relatedPurchaseId: { type: DataTypes.STRING, allowNull: true },
    relatedExpenseId: { type: DataTypes.STRING, allowNull: true },
    relatedCustomerId: { type: DataTypes.STRING, allowNull: true },
    relatedSupplierId: { type: DataTypes.STRING, allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true }
}, {
    timestamps: true
});

module.exports = BankTransaction;
