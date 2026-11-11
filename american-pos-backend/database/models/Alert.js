const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Alert = sequelize.define('Alert', {
    id: { type: DataTypes.STRING, primaryKey: true },
    type: { 
        type: DataTypes.ENUM('mismatch', 'financial_mismatch', 'operational_error', 'forced_closed', 'security_risk', 'system_error'),
        allowNull: false
    },
    severity: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        defaultValue: 'medium'
    },
    status: {
        type: DataTypes.ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED'),
        defaultValue: 'OPEN'
    },
    message: { type: DataTypes.TEXT, allowNull: false },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    userId: { type: DataTypes.STRING }, // Cajero involucrado
    companyId: { type: DataTypes.STRING, allowNull: false },
    resolvedBy: { type: DataTypes.STRING }, // Admin/Owner ID
    resolvedAt: { type: DataTypes.DATE },
    resolutionNotes: { type: DataTypes.TEXT }
}, {
    timestamps: true
});

module.exports = Alert;
