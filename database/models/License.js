const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const License = sequelize.define('License', {
    id: { type: DataTypes.STRING, primaryKey: true },
    machineId: { type: DataTypes.STRING },
    licenseKey: { type: DataTypes.STRING },
    activatedAt: { type: DataTypes.STRING },
    expiresAt: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING, defaultValue: 'trial' },
    meta: { type: DataTypes.JSON }
});

module.exports = License;
