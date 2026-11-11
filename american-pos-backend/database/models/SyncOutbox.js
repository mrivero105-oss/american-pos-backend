const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const SyncOutbox = sequelize.define('SyncOutbox', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    entity_name: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    entity_id: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    operation: {
        type: DataTypes.STRING(10),
        defaultValue: 'INSERT',
        allowNull: false
    },
    payload: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'PENDING'
    },
    retry_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    last_error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    synced_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'sync_outbox',
    timestamps: false
});

module.exports = SyncOutbox;
