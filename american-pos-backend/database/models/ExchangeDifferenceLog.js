const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const ExchangeDifferenceLog = sequelize.define('ExchangeDifferenceLog', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    transactionType: { type: DataTypes.STRING, allowNull: false }, // COBRO_CLIENTE, PAGO_PROVEEDOR
    documentId: { type: DataTypes.STRING, allowNull: false }, // saleId o purchaseOrderId
    documentType: { type: DataTypes.STRING, defaultValue: 'FACTURA' },
    originalAmountUsd: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    originalRate: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    settlementRate: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
    differenceAmountVes: { type: DataTypes.DECIMAL(20, 6), allowNull: false }, // Positivo = Ganancia cambiaria, Negativo = Pérdida cambiaria
    classification: { type: DataTypes.STRING, defaultValue: 'GANANCIA' }, // GANANCIA_CAMBIARIA, PERDIDA_CAMBIARIA
    date: { type: DataTypes.STRING, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true }
}, {
    timestamps: true
});

module.exports = ExchangeDifferenceLog;
