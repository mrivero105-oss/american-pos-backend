const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const QuarantineSale = sequelize.define('QuarantineSale', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    companyId: {
        type: DataTypes.STRING,
        allowNull: false,
        index: true
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    rawPayload: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    errorReason: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'quarantined' // quarantined, resolved, discarded
    }
}, {
    tableName: 'quarantine_sales',
    timestamps: true
});

module.exports = QuarantineSale;
