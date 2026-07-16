const { AuditLog, Alert, User } = require('../database/models');
const { Op } = require('sequelize');
const { generateRobustId } = require('../utils/helpers');

const auditController = {
    getLogs: async (req, res) => {
        try {
            const { limit = 100, offset = 0, action, userId, startDate, endDate } = req.query;
            
            const whereClause = {};
            if (action) whereClause.action = action;
            
            // IDOR FIX: Always enforce companyId
            whereClause.companyId = req.user.companyId;
            
            const role = (req.user?.role || '').toLowerCase();
            if (role === 'user') {
                whereClause.userId = req.user?.id;
            } else if (userId) {
                whereClause.userId = userId;
            }
            
            if (startDate || endDate) {
                whereClause.createdAt = {};
                if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
                if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
            }

            const logs = await AuditLog.findAndCountAll({
                where: whereClause,
                limit: parseInt(limit),
                offset: parseInt(offset),
                order: [['createdAt', 'DESC']],
                include: [{
                    model: User,
                    as: 'User',
                    attributes: ['id', 'username', 'name', 'role']
                }]
            });

            res.json({
                total: logs.count,
                data: logs.rows,
                pages: Math.ceil(logs.count / limit)
            });
        } catch (error) {
            console.error('[Audit] Error fetching logs:', error);
            res.status(500).json({ error: 'Error al obtener registros de auditoría' });
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
            const { resolutionNotes } = req.body;

            const alert = await Alert.findByPk(id);
            if (!alert) {
                return res.status(404).json({ error: 'Alerta no encontrada' });
            }

            if (alert.companyId !== req.user.companyId) {
                return res.status(403).json({ error: 'Acceso denegado: Esta alerta pertenece a otra compañía.' });
            }

            alert.status = 'RESOLVED';
            alert.resolvedBy = req.user.id;
            alert.resolvedAt = new Date();
            if (resolutionNotes) {
                alert.resolutionNotes = resolutionNotes;
            }

            await alert.save();

            res.json({ message: 'Alerta resuelta', alert });
        } catch (error) {
            console.error('[Audit] Error resolving alert:', error);
            res.status(500).json({ error: 'Error al resolver la alerta' });
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
    }
};

module.exports = auditController;
