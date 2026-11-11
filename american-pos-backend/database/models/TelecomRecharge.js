const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const TelecomRecharge = sequelize.define('TelecomRecharge', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    operator: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'MOVISTAR'
    },
    phoneNumber: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    nominalAmountBs: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0
    },
    serviceFeePercent: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 20
    },
    serviceFeeBs: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0
    },
    totalChargedBs: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0
    },
    totalChargedUsd: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0
    },
    exchangeRate: {
        type: DataTypes.DECIMAL(20, 6),
        allowNull: false,
        defaultValue: 1
    },
    paymentMethod: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: 'pago_movil'
    },
    customerPaymentRef: {
        type: DataTypes.STRING(80),
        allowNull: true
    },
    providerRef: {
        type: DataTypes.STRING(80),
        allowNull: true
    },
    remainingWalletBalanceBs: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true
    },
    status: {
        type: DataTypes.STRING(25),
        allowNull: false,
        defaultValue: 'PENDIENTE' // PENDIENTE, COMPLETADA, FALLIDA, ANULADA
    },
    shiftId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    registerId: {
        type: DataTypes.STRING,
        defaultValue: '1'
    },
    registerName: {
        type: DataTypes.STRING,
        defaultValue: 'Caja 1'
    },
    cashMovementId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    userName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    companyId: {
        type: DataTypes.STRING,
        defaultValue: '2'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'pos_recargas_movilway',
    timestamps: true,
    indexes: [
        { fields: ['companyId', 'createdAt'] },
        { fields: ['phoneNumber'] },
        { fields: ['status'] }
    ]
});

module.exports = TelecomRecharge;
