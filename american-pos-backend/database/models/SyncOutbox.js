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
        allowNull: false
    },
    synced_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'sync_outbox',
    timestamps: false,
    hooks: {
        beforeValidate(instance) {
            if (!instance.created_at) {
                instance.created_at = nextMonotonicTimestamp();
            }
        },
        beforeBulkCreate(instances) {
            for (const inst of instances) {
                if (!inst.created_at) {
                    inst.created_at = nextMonotonicTimestamp();
                }
            }
        }
    }
});

let _lastOutboxMs = 0;
function nextMonotonicTimestamp() {
    const now = Date.now();
    _lastOutboxMs = now > _lastOutboxMs ? now : _lastOutboxMs + 1;
    return new Date(_lastOutboxMs);
}

module.exports = SyncOutbox;
