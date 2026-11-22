const { DataTypes, Op } = require('sequelize');
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
                // Encadenar estrictamente contra el último bloque firmado (ignorar filas automáticas de triggers SQL)
                const lastLog = await AuditLog.findOne({
                    where: { companyId, recordHash: { [Op.ne]: null } },
                    order: [['createdAt', 'DESC']],
                    attributes: ['recordHash'],
                    transaction: options.transaction || null,
                    lock: options.transaction ? options.transaction.LOCK.UPDATE : undefined
                });
                const prevHash = lastLog?.recordHash || 'GENESIS_BLOCK_0000000000000000';
                instance.previousHash = prevHash;
                
                const secret = process.env.AUDIT_HMAC_SECRET ? String(process.env.AUDIT_HMAC_SECRET).trim() : '';
                if (!secret) {
                    const secErr = new Error('AUDIT_HMAC_SECRET requerido en variables de entorno para firmar registros de auditoría (prohibido reutilizar JWT_SECRET).');
                    secErr.code = 'AUDIT_HMAC_MISSING';
                    throw secErr;
                }
                const payload = `${prevHash}|${instance.userId || ''}|${companyId}|${instance.action || ''}|${instance.description || ''}|${instance.entityId || ''}|${instance.oldValue || ''}|${instance.newValue || ''}|${instance.timestamp || ''}`;
                instance.recordHash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
            } catch (err) {
                console.error('[AuditLog] Error crítico calculando hash-chain de auditoría:', err.message);
                throw err;
            }
        }
    }
});

module.exports = AuditLog;
