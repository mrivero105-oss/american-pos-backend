const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
    id: { type: DataTypes.STRING, primaryKey: true },
    username: { type: DataTypes.STRING },
    password: { type: DataTypes.STRING },
    role: { type: DataTypes.STRING },
    name: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING, defaultValue: 'active' },
    trial_expires_at: { type: DataTypes.STRING },
    defaultCurrency: { type: DataTypes.STRING, defaultValue: 'BOTH' },
    activeBranchId: { type: DataTypes.STRING },
    supervisorPin: { type: DataTypes.STRING }, // PIN hasheado para autorizaciones
    phone: { type: DataTypes.STRING },
    avatarColor: { type: DataTypes.STRING },
    permissions: { type: DataTypes.JSONB, defaultValue: {} },
    failedLoginAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    lockUntil: { type: DataTypes.DATE, allowNull: true },
    currentSessionId: { type: DataTypes.STRING, allowNull: true },
    quickPin: { type: DataTypes.STRING, allowNull: true },
    biometricTokenHash: { type: DataTypes.STRING, allowNull: true },
    biometricEnrolledAt: { type: DataTypes.DATE, allowNull: true },
    biometricDeviceName: { type: DataTypes.STRING, allowNull: true }
}, {
    hooks: {
        beforeCreate: async (user) => {
            if (user.password && !user.password.startsWith('$2')) {
                user.password = await bcrypt.hash(user.password, 10);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password') && user.password && !user.password.startsWith('$2')) {
                user.password = await bcrypt.hash(user.password, 10);
            }
        }
    }
});

module.exports = User;
