const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const CollectionActionLog = sequelize.define('CollectionActionLog', {
    id: { type: DataTypes.STRING, primaryKey: true },
    customerId: { type: DataTypes.STRING, allowNull: false },
    actionType: { type: DataTypes.STRING, defaultValue: 'WHATSAPP_REMINDER' }, // WHATSAPP_REMINDER, PHONE_CALL, VISIT, PAYMENT_PROMISE, LEGAL_NOTICE
    promisedDate: { type: DataTypes.STRING }, // YYYY-MM-DD
    promisedAmount: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    notes: { type: DataTypes.TEXT },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING, defaultValue: 'default' }
});

module.exports = CollectionActionLog;
