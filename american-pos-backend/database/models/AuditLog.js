const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');
const crypto = require('crypto');

const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.STRING, primaryKey: true },
    userId: { type: DataTypes.STRING },
    companyId: { type: DataTypes.STRING },
    action: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    entityId: { type: DataTypes.STRING },
    oldValue: { type: DataTypes.TEXT },
    newValue: { type: DataTypes.TEXT },
    timestamp: { type: DataTypes.STRING },
    previousHash: { type: DataTypes.STRING, allowNull: true },
    recordHash: { type: DataTypes.STRING, allowNull: true }
}, {
    hooks: {
        beforeCreate: async (instance, options = {}) => {
            try {
                const companyId = String(instance.companyId || 'default');
                const lastLog = await AuditLog.findOne({
                    where: { companyId },
                    order: [['createdAt', 'DESC']],
                    attributes: ['recordHash'],
                    transaction: options.transaction || null,
                    lock: options.transaction ? options.transaction.LOCK.UPDATE : undefined
                });
                const prevHash = lastLog?.recordHash || 'GENESIS_BLOCK_0000000000000000';
                instance.previousHash = prevHash;
                
                const secret = process.env.AUDIT_HMAC_SECRET || process.env.JWT_SECRET || 'isaac_secure_audit_ledger_2026';
                const payload = `${prevHash}|${instance.userId || ''}|${companyId}|${instance.action || ''}|${instance.description || ''}|${instance.entityId || ''}|${instance.oldValue || ''}|${instance.newValue || ''}|${instance.timestamp || ''}`;
                instance.recordHash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
            } catch (err) {
                console.warn('[AuditLog] Error computing hash chain:', err.message);
            }
        }
    }
});

module.exports = AuditLog;
