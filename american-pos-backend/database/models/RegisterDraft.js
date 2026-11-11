const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

/**
 * RegisterDraft Model
 * Almacena de forma persistente y transaccional en PostgreSQL:
 * 1. Borradores automáticos en caliente de cada caja (Resiliencia ante apagones súbitos).
 * 2. Ventas en espera manuales (F5 Pausar).
 * 3. Preventas y comandas móviles tomadas desde teléfonos celulares.
 */
const RegisterDraft = sequelize.define('RegisterDraft', {
    id: {
        type: DataTypes.STRING(64),
        primaryKey: true,
        allowNull: false
    },
    registerId: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    companyId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: '2'
    },
    userId: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    userName: {
        type: DataTypes.STRING(128),
        allowNull: true
    },
    code: {
        type: DataTypes.STRING(32),
        allowNull: true
    },
    type: {
        type: DataTypes.STRING(32), // 'auto_draft' | 'presale' | 'manual_held'
        allowNull: false,
        defaultValue: 'auto_draft'
    },
    customer: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    },
    totals: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    itemCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    totalUSD: {
        type: DataTypes.DECIMAL(12, 4),
        defaultValue: 0.0000
    },
    totalVES: {
        type: DataTypes.DECIMAL(16, 4),
        defaultValue: 0.0000
    },
    status: {
        type: DataTypes.STRING(20), // 'active' | 'claimed' | 'discarded'
        defaultValue: 'active'
    }
}, {
    tableName: 'RegisterDrafts',
    timestamps: true,
    indexes: [
        {
            fields: ['companyId', 'registerId', 'type', 'status']
        },
        {
            fields: ['companyId', 'status', 'updatedAt']
        }
    ]
});

module.exports = RegisterDraft;
