const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const SupervisorApproval = sequelize.define('SupervisorApproval', {
    id: { type: DataTypes.STRING, primaryKey: true },
    actionType: { 
        type: DataTypes.ENUM('CLOSE_SHIFT', 'VOID_SALE', 'MANUAL_DISCOUNT', 'OPEN_DRAWER'),
        allowNull: false
    },
    performedBy: { type: DataTypes.STRING, allowNull: false }, // User ID (Cashier)
    approvedBy: { type: DataTypes.STRING, allowNull: false },  // User ID (Supervisor/Admin)
    referenceId: { type: DataTypes.STRING }, // ID of shift, sale, etc.
    companyId: { type: DataTypes.STRING, allowNull: false },
    metadata: { type: DataTypes.JSON, defaultValue: {} },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    timestamps: false
});

module.exports = SupervisorApproval;
