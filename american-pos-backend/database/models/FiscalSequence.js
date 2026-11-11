const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const FiscalSequence = sequelize.define('FiscalSequence', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    companyId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    branchId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    documentType: {
        type: DataTypes.STRING(32), // 'CREDIT_NOTE', 'INVOICE', 'DEBIT_NOTE'
        allowNull: false
    },
    prefix: {
        type: DataTypes.STRING(16), // 'NC-', '00-', etc.
        defaultValue: ''
    },
    lastNumber: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0
    },
    lastControlNumber: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0
    }
}, {
    tableName: 'FiscalSequences',
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['companyId', 'documentType', 'branchId']
        }
    ]
});

module.exports = FiscalSequence;
