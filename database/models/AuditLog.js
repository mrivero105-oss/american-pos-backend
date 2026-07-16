const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.STRING, primaryKey: true },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    action: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    entityId: { type: DataTypes.STRING },
    oldValue: { type: DataTypes.TEXT },
    newValue: { type: DataTypes.TEXT },
    timestamp: { type: DataTypes.STRING }
});

module.exports = AuditLog;
