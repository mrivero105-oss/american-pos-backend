const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Sale = sequelize.define('Sale', {
    id: { type: DataTypes.STRING, primaryKey: true },
    date: { type: DataTypes.STRING },
    total: { type: DataTypes.DECIMAL(20, 6) },
    paymentMethod: { type: DataTypes.STRING },
    paymentMethods: { type: DataTypes.JSON },
    subtotal: { type: DataTypes.DECIMAL(20, 6) },
    tax: { type: DataTypes.DECIMAL(20, 6) },
    discount: { type: DataTypes.DECIMAL(20, 6) },
    customerId: { type: DataTypes.STRING },
    customerName: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    timestamp: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING, defaultValue: 'completed' },
    exchangeRate: { type: DataTypes.DECIMAL(20, 6) },
    igtfAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    taxInfo: { type: DataTypes.JSON },
    documentType: { type: DataTypes.STRING, defaultValue: 'factura' },
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'paid' },
    registerId: { type: DataTypes.STRING, defaultValue: '1' },
    registerName: { type: DataTypes.STRING, defaultValue: 'Caja Principal' },
    isService: { type: DataTypes.BOOLEAN, defaultValue: false },
    serviceOrderId: { type: DataTypes.STRING, allowNull: true },
    sriAccessKey: { type: DataTypes.STRING(49), allowNull: true },
    sriStatus: { type: DataTypes.STRING, defaultValue: 'none' }, // 'none', 'pending', 'authorized', 'rejected'
    sriAuthorizationDate: { type: DataTypes.STRING, allowNull: true },
    sriXmlUrl: { type: DataTypes.TEXT, allowNull: true }
});

module.exports = Sale;
