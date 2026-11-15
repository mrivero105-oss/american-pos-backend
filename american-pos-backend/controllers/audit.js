const { AuditLog, Alert, User } = require('../database/models');
const { Op } = require('sequelize');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');

const CATEGORY_ACTIONS = {
    CRITICAL: ['REFUND', 'DISCOUNT', 'DELETE_PRODUCT', 'CASH_DROP', 'FORCE_CLOSE_SHIFT', 'EXPENSE_DELETE'],
    PRICES: ['PRICE_CHANGE', 'COST_CHANGE', 'COST_UPDATE_IMPORT'],
    INVENTORY: ['CREATE_PRODUCT', 'PRODUCT_UPDATE', 'DELETE_PRODUCT', 'STOCK_ADJUST', 'INVENTORY_ADJUST', 'STOCK_TRANSFER'],
    CASH: ['CASH_OPEN', 'CASH_CLOSE', 'CASH_CLOSE_BLIND', 'CASH_DROP', 'FORCE_CLOSE_SHIFT', 'EXPENSE_CREATE', 'EXPENSE_DELETE'],
    SALES: ['CREATE_SALE', 'REFUND', 'DISCOUNT', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT'],
    SESSIONS: ['LOGIN', 'LOGOUT']
};

const auditController = {
    getLogs: async (req, res) => {
        try {
            const { limit = 50, offset, page, search, category, action, userId, startDate, endDate } = req.query;
            
            const whereClause = {};
            
            // IDOR FIX: Always enforce companyId
            whereClause.companyId = req.user.companyId;
            
            const role = (req.user?.role || '').toLowerCase();
            if (role === 'user') {
                whereClause.userId = req.user?.id;
            } else if (userId) {
                whereClause.userId = userId;
            }
            
            // Filter by Category
            if (category) {
                const cat = category.toUpperCase();
                if (cat === 'PRICES') {
                    whereClause[Op.or] = [
                        { action: { [Op.in]: ['PRICE_CHANGE', 'COST_CHANGE', 'COST_UPDATE_IMPORT'] } },
                        {
                            [Op.and]: [
                                { action: 'PRODUCT_UPDATE' },
                                {
                                    [Op.or]: [
                                        { description: { [Op.like]: '%price:%' } },
                                        { description: { [Op.like]: '%cost:%' } },
                                        { description: { [Op.like]: '%bulkPrice:%' } },
                                        { description: { [Op.like]: '%bulkCost:%' } }
                                    ]
                                }
                            ]
                        }
                    ];
                } else if (CATEGORY_ACTIONS[cat]) {
                    whereClause.action = { [Op.in]: CATEGORY_ACTIONS[cat] };
                }
            }

            // Direct action filter overrides or refines category
            if (action) {
                whereClause.action = action;
            }

            // Universal Search filter
            if (search && search.trim()) {
                const term = `%${search.trim()}%`;
                const searchConditions = [
                    { description: { [Op.like]: term } },
                    { action: { [Op.like]: term } },
                    { entityId: { [Op.like]: term } }
                ];
                if (whereClause[Op.or]) {
                    whereClause[Op.and] = [
                        { [Op.or]: whereClause[Op.or] },
                        { [Op.or]: searchConditions }
                    ];
                    delete whereClause[Op.or];
                } else {
                    whereClause[Op.or] = searchConditions;
                }
            }
            
            if (startDate || endDate) {
                whereClause.createdAt = {};
                if (startDate) {
                    const start = new Date(startDate);
                    if (String(startDate).length === 10) start.setHours(0, 0, 0, 0);
                    whereClause.createdAt[Op.gte] = start;
                }
                if (endDate) {
                    const end = new Date(endDate);
                    if (String(endDate).length === 10) end.setHours(23, 59, 59, 999);
                    whereClause.createdAt[Op.lte] = end;
                }
            }

            const pageNum = parseInt(page) > 0 ? parseInt(page) : 1;
            const limitNum = parseInt(limit) > 0 ? Math.min(parseInt(limit), 500) : 50;
            const offsetNum = page !== undefined ? (pageNum - 1) * limitNum : (parseInt(offset) || 0);

            const logs = await AuditLog.findAndCountAll({
                where: whereClause,
                limit: limitNum,
                offset: offsetNum,
                order: [['createdAt', 'DESC']],
                include: [{
                    model: User,
                    as: 'User',
                    attributes: ['id', 'username', 'name', 'role']
                }]
            });

            res.json({
                total: logs.count,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(logs.count / limitNum) || 1,
                data: logs.rows
            });
        } catch (error) {
            console.error('[Audit] Error fetching logs:', error);
            res.status(500).json({ error: 'Error al obtener registros de auditoría' });
        }
    },

    getStats: async (req, res) => {
        try {
            const { userId, startDate, endDate } = req.query;
            const whereClause = { companyId: req.user.companyId };

            const role = (req.user?.role || '').toLowerCase();
            if (role === 'user') {
                whereClause.userId = req.user?.id;
            } else if (userId) {
                whereClause.userId = userId;
            }

            if (startDate || endDate) {
                whereClause.createdAt = {};
                if (startDate) {
                    const start = new Date(startDate);
                    if (String(startDate).length === 10) start.setHours(0, 0, 0, 0);
                    whereClause.createdAt[Op.gte] = start;
                }
                if (endDate) {
                    const end = new Date(endDate);
                    if (String(endDate).length === 10) end.setHours(23, 59, 59, 999);
                    whereClause.createdAt[Op.lte] = end;
                }
            }

            const totalLogs = await AuditLog.count({ where: whereClause });

            const actionCounts = await AuditLog.findAll({
                attributes: ['action', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
                where: whereClause,
                group: ['action'],
                raw: true
            });

            const countsMap = {};
            actionCounts.forEach(item => {
                countsMap[item.action] = parseInt(item.count) || 0;
            });

            const priceUpdateCount = await AuditLog.count({
                where: {
                    ...whereClause,
                    action: 'PRODUCT_UPDATE',
                    [Op.or]: [
                        { description: { [Op.like]: '%price:%' } },
                        { description: { [Op.like]: '%cost:%' } }
                    ]
                }
            });

            const priceChanges = (countsMap['PRICE_CHANGE'] || 0) + 
                                 (countsMap['COST_CHANGE'] || 0) + 
                                 (countsMap['COST_UPDATE_IMPORT'] || 0) + 
                                 priceUpdateCount;

            const refundsAndDiscounts = (countsMap['REFUND'] || 0) + (countsMap['DISCOUNT'] || 0);

            const cashOperations = (countsMap['CASH_DROP'] || 0) + 
                                   (countsMap['CASH_OPEN'] || 0) + 
                                   (countsMap['CASH_CLOSE'] || 0) + 
                                   (countsMap['CASH_CLOSE_BLIND'] || 0) + 
                                   (countsMap['FORCE_CLOSE_SHIFT'] || 0) + 
                                   (countsMap['EXPENSE_CREATE'] || 0);

            const criticalEvents = (countsMap['REFUND'] || 0) + 
                                   (countsMap['DISCOUNT'] || 0) + 
                                   (countsMap['DELETE_PRODUCT'] || 0) + 
                                   (countsMap['CASH_DROP'] || 0) + 
                                   (countsMap['FORCE_CLOSE_SHIFT'] || 0) + 
                                   (countsMap['EXPENSE_DELETE'] || 0);

            res.json({
                totalLogs,
                priceChanges,
                refundsAndDiscounts,
                cashOperations,
                criticalEvents,
                actionCounts: countsMap
            });
        } catch (error) {
            console.error('[Audit] Error fetching stats:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas de auditoría' });
        }
    },

    getAlerts: async (req, res) => {
        try {
            const { status } = req.query; // e.g., 'OPEN', 'RESOLVED'
            
            const whereClause = {};
            if (status) whereClause.status = status;

            // IDOR FIX: Always enforce companyId
            whereClause.companyId = req.user.companyId;

            const role = (req.user?.role || '').toLowerCase();
            if (role === 'user') {
                whereClause.userId = req.user?.id;
            }

            const alerts = await Alert.findAll({
                where: whereClause,
                order: [['createdAt', 'DESC']],
                include: [{
                    model: User,
                    as: 'user',
                    attributes: ['id', 'username', 'name', 'role']
                }]
            });

            res.json(alerts);
        } catch (error) {
            console.error('[Audit] Error fetching alerts:', error);
            res.status(500).json({ error: 'Error al obtener alertas' });
        }
    },

    resolveAlert: async (req, res) => {
        try {
            const { id } = req.params;
            const { status, resolutionNotes } = req.body;

            const alert = await Alert.findByPk(id);
            if (!alert) {
                return res.status(404).json({ error: 'Alerta no encontrada' });
            }

            if (alert.companyId !== req.user.companyId) {
                return res.status(403).json({ error: 'Acceso denegado: Esta alerta pertenece a otra compañía.' });
            }

            const allowedStatuses = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED'];
            alert.status = allowedStatuses.includes(status) ? status : 'RESOLVED';
            alert.resolvedBy = req.user.id;
            alert.resolvedAt = new Date();
            if (resolutionNotes !== undefined) {
                alert.resolutionNotes = resolutionNotes;
            }

            await alert.save();

            res.json({ message: 'Alerta actualizada', alert });
        } catch (error) {
            console.error('[Audit] Error resolving alert:', error);
            res.status(500).json({ error: 'Error al resolver la alerta' });
        }
    },

    resolveAllAlerts: async (req, res) => {
        try {
            const { resolutionNotes = 'Resolución masiva por supervisor' } = req.body;
            const [updatedCount] = await Alert.update({
                status: 'RESOLVED',
                resolvedBy: req.user.id,
                resolvedAt: new Date(),
                resolutionNotes
            }, {
                where: {
                    companyId: req.user.companyId,
                    status: 'OPEN'
                }
            });

            res.json({ message: `${updatedCount} alertas resueltas con éxito`, count: updatedCount });
        } catch (error) {
            console.error('[Audit] Error resolving all alerts:', error);
            res.status(500).json({ error: 'Error al resolver alertas en lote' });
        }
    },

    logAction: async (userId, companyId, action, description, entityId = null, oldValue = null, newValue = null) => {
        try {
            await AuditLog.create({
                id: generateRobustId(),
                userId,
                companyId: companyId || 'default',
                action,
                description,
                entityId,
                oldValue: oldValue ? JSON.stringify(oldValue) : null,
                newValue: newValue ? JSON.stringify(newValue) : null,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Audit] Failed to log action:', error);
        }
    },

    createAlert: async (type, severity, message, userId, companyId, metadata = {}) => {
        try {
            await Alert.create({
                id: generateRobustId(),
                type,
                severity,
                message,
                userId,
                companyId: companyId || 'default',
                metadata,
                status: 'OPEN'
            });
        } catch (error) {
            console.error('[Audit] Failed to create alert:', error);
        }
    },

    verifyChain: async (req, res) => {
        try {
            const crypto = require('crypto');
            const companyId = req.user?.companyId || 'default';
            const secret = process.env.AUDIT_HMAC_SECRET ? String(process.env.AUDIT_HMAC_SECRET).trim() : '';
            if (!secret) {
                return res.status(500).json({ error: 'AUDIT_HMAC_SECRET no configurado en el servidor (prohibido reutilizar JWT_SECRET).' });
            }
            
            const logs = await AuditLog.findAll({
                where: { companyId },
                order: [['createdAt', 'ASC']]
            });

            if (logs.length === 0) {
                return res.json({
                    success: true,
                    chainValid: true,
                    totalLogsVerified: 0,
                    message: 'No existen registros de auditoría aún para esta empresa.'
                });
            }

            let expectedPrevHash = 'GENESIS_BLOCK_0000000000000000';
            let seenSignedBlock = false;
            const tamperedLogs = [];

            for (const log of logs) {
                if (log.recordHash) {
                    seenSignedBlock = true;
                    if (log.previousHash !== expectedPrevHash) {
                        tamperedLogs.push({
                            id: log.id,
                            action: log.action,
                            createdAt: log.createdAt,
                            reason: `Ruptura de enlace en la cadena. Hash previo esperado: ${expectedPrevHash}, encontrado: ${log.previousHash}`
                        });
                    }

                    const payload = `${log.previousHash}|${log.userId || ''}|${companyId}|${log.action || ''}|${log.description || ''}|${log.entityId || ''}|${log.oldValue || ''}|${log.newValue || ''}|${log.timestamp || ''}`;
                    const recalculated = crypto.createHmac('sha256', secret).update(payload).digest('hex');

                    if (recalculated !== log.recordHash) {
                        tamperedLogs.push({
                            id: log.id,
                            action: log.action,
                            createdAt: log.createdAt,
                            reason: 'Firma criptográfica HMAC no coincide. El registro fue manipulado o alterado directamente en la base de datos.'
                        });
                    }

                    expectedPrevHash = log.recordHash;
                } else if (seenSignedBlock) {
                    // Si ya existían bloques firmados en la cadena y aparece un registro con recordHash NULL, fue borrado/alterado maliciosamente
                    tamperedLogs.push({
                        id: log.id,
                        action: log.action,
                        createdAt: log.createdAt,
                        reason: 'TAMPERED_NULL_HASH: Firma criptográfica eliminada (recordHash es NULL después del inicio de la cadena firmada).'
                    });
                } else {
                    expectedPrevHash = 'GENESIS_BLOCK_0000000000000000';
                }
            }

            const isValid = tamperedLogs.length === 0;
            return res.json({
                success: true,
                chainValid: isValid,
                totalLogsVerified: logs.length,
                tamperedCount: tamperedLogs.length,
                tamperedLogs,
                status: isValid ? 'INTEGRITY_VERIFIED_100_PERCENT' : 'TAMPERING_DETECTED',
                latestLedgerHash: expectedPrevHash
            });
        } catch (error) {
            console.error('[Audit] Error verifying chain:', error);
            res.status(500).json({ error: 'Error al verificar la cadena de auditoría criptográfica: ' + error.message });
        }
    }
};

module.exports = auditController;
