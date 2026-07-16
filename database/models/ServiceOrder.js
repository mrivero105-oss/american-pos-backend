const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const ServiceOrder = sequelize.define('ServiceOrder', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    customerId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    customerName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    assetDescription: {
        type: DataTypes.STRING,
        allowNull: true
    },
    technicalNotes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    totalAmount: {
        type: DataTypes.DECIMAL(20, 6),
        allowNull: true
    },
    balancePaid: {
        type: DataTypes.DECIMAL(20, 6),
        allowNull: true
    },
    status: {
        type: DataTypes.STRING,
        allowNull: true
    },
    photos: {
        type: DataTypes.JSON,
        allowNull: true
    },
    colorCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    serialNumber: {
        type: DataTypes.STRING,
        allowNull: true
    },
    storageLocation: {
        type: DataTypes.STRING,
        allowNull: true
    },
    companyId: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'ServiceOrders',
    timestamps: true
});

module.exports = ServiceOrder;
