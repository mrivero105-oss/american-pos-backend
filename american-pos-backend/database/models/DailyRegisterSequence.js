const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const DailyRegisterSequence = sequelize.define('DailyRegisterSequence', {
    companyId: {
        type: DataTypes.STRING(64),
        primaryKey: true,
        allowNull: false
    },
    registerId: {
        type: DataTypes.STRING(64),
        primaryKey: true,
        allowNull: false
    },
    dateKey: {
        type: DataTypes.STRING(10), // 'YYYY-MM-DD'
        primaryKey: true,
        allowNull: false
    },
    currentNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    }
}, {
    tableName: 'DailyRegisterSequences',
    timestamps: false
});

module.exports = DailyRegisterSequence;
