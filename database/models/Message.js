const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Message = sequelize.define('Message', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    senderId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    targetRole: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'all' // e.g. 'all', 'admin', 'cajero', or specific userId
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    readBy: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'text'
    },
    fileUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false
});

module.exports = Message;
