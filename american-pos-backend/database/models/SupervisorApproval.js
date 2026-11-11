const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const SupervisorApproval = sequelize.define('SupervisorApproval', {
    id: { type: DataTypes.STRING, primaryKey: true },
    actionType: { 
        type: DataTypes.STRING,
        allowNull: false
    },
    performedBy: { type: DataTypes.STRING, allowNull: false }, // User ID (Cashier)
    approvedBy: { type: DataTypes.STRING, allowNull: false },  // User ID (Supervisor/Admin)
    referenceId: { type: DataTypes.STRING }, // ID of shift, sale, etc.
    companyId: { type: DataTypes.STRING, allowNull: false },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
    used: { type: DataTypes.BOOLEAN, defaultValue: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    timestamps: false
});

module.exports = SupervisorApproval;
