const { Alert, User } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const NotificationService = require('./NotificationService');

class AlertService {
    /**
     * Dispara una nueva alerta en el sistema.
     * @param {Object} alertData { type, severity, message, userId, companyId, metadata }
     */
    async triggerAlert(alertData) {
        try {
            const { type, severity, message, userId, companyId, metadata } = alertData;

            const alert = await Alert.create({
                id: generateRobustId(),
                type,
                severity: severity || 'medium',
                message,
                userId,
                companyId,
                metadata: metadata || {},
                isRead: false
            });

            console.log(`[ALERT] [${severity.toUpperCase()}] ${message}`);

            // NOTIFICACIÓN EXTERNA (Capas 1 y 2)
            if (severity === 'critical' || severity === 'high') {
                await NotificationService.sendImmediateAlert(alert, companyId);
                // Marcar que se envió notificación en la metadata
                await alert.update({
                    metadata: { ...metadata, notificationSent: true }
                });
            }

            return alert;
        } catch (error) {
            console.error('[AlertService] Error al disparar alerta:', error);
        }
    }

    /**
     * Obtiene el Inbox de alertas con filtros.
     */
    async getAlertInbox(companyId, filters = {}) {
        const { Op } = require('sequelize');
        const where = { companyId };

        if (filters.status) where.status = filters.status;
        if (filters.severity) where.severity = filters.severity;
        if (filters.type) where.type = filters.type;

        return await Alert.findAll({
            where,
            order: [
                ['status', 'ASC'], // OPEN first
                ['severity', 'DESC'], // Critical first
                ['createdAt', 'DESC']
            ],
            include: [{ model: User, attributes: ['name', 'username'], as: 'user' }]
        });
    }

    /**
     * Actualiza el estado y resolución de una alerta.
     */
    async updateAlertStatus(alertId, companyId, updateData) {
        const { status, resolutionNotes, userId } = updateData;

        const updatePayload = { status, resolutionNotes };
        if (status === 'RESOLVED' || status === 'IGNORED') {
            updatePayload.resolvedBy = userId;
            updatePayload.resolvedAt = new Date();
        }

        return await Alert.update(updatePayload, {
            where: { id: alertId, companyId }
        });
    }

    /**
     * Marca una alerta como leída.
     */
    async markAsRead(alertId, companyId) {
        return await Alert.update({ isRead: true }, {
            where: { id: alertId, companyId }
        });
    }

    /**
     * Motor de Evaluación de Riesgo (Risk Score Engine)
     * Evalúa la integridad de un cajero basándose en su historial reciente.
     */
    async calculateUserRisk(userId, companyId) {
        try {
            const { CashDeclaration, CashShift } = require('../database/models');
            const { Op } = require('sequelize');

            // 1. Obtener los últimos 10 turnos auditados
            const recentDeclarations = await CashDeclaration.findAll({
                where: { userId, companyId },
                include: [{ model: CashShift, as: 'Shift', attributes: ['status'] }],
                attributes: ['differenceUSD', 'differenceVES'],
                order: [['createdAt', 'DESC']],
                limit: 10
            });

            if (recentDeclarations.length === 0) return { level: 'SAFE', score: 0 };

            let score = 0;
            const totalShifts = recentDeclarations.length;
            const mismatches = recentDeclarations.filter(d => Number(d.differenceUSD) !== 0 || Number(d.differenceVES) !== 0);
            const forcedClosures = recentDeclarations.filter(d => d.Shift?.status === 'forced_closed');
            const totalLossUSD = Math.abs(recentDeclarations.reduce((s, d) => s + (Number(d.differenceUSD) < 0 ? Number(d.differenceUSD) : 0), 0));

            // Factor 1: Frecuencia (hasta 40 pts)
            const frequencyRate = mismatches.length / totalShifts;
            score += (frequencyRate * 40);

            // Factor 2: Pérdida Acumulada (hasta 30 pts)
            // $50 de pérdida acumulada en 10 turnos es considerado grave
            score += Math.min((totalLossUSD / 50) * 30, 30);

            // Factor 3: Gravedad/Forzados (hasta 30 pts)
            if (forcedClosures.length > 0) {
                score += Math.min(forcedClosures.length * 15, 30);
            }

            // Determinar Nivel
            let level = 'SAFE';
            if (score >= 70) level = 'CRITICAL';
            else if (score >= 40) level = 'RISK';
            else if (score >= 20) level = 'WATCHLIST';

            return {
                level,
                score: Math.round(score),
                stats: {
                    totalShifts,
                    mismatchRate: Math.round(frequencyRate * 100),
                    totalLossUSD
                }
            };
        } catch (error) {
            console.error(`[AlertService] Error calculating risk for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Procesa y envía el Digest Diario de Auditoría.
     */
    async processDailyDigest(companyId) {
        const { CashDeclaration, Alert } = require('../database/models');
        const { Op } = require('sequelize');

        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

        // 1. Calcular pérdida total del día
        const declarations = await CashDeclaration.findAll({
            where: { companyId, createdAt: { [Op.between]: [startOfDay, endOfDay] } }
        });
        const totalLossUSD = declarations.reduce((s, d) => s + (Number(d.differenceUSD) < 0 ? Number(d.differenceUSD) : 0), 0);

        // 2. Obtener alertas pendientes
        const openAlerts = await Alert.findAll({
            where: { companyId, status: 'OPEN', createdAt: { [Op.between]: [startOfDay, endOfDay] } },
            limit: 5
        });

        // 3. Solo enviar si hay algo relevante
        if (totalLossUSD < 0 || openAlerts.length > 0) {
            await NotificationService.sendDailyDigest({
                totalLossUSD,
                openAlertsCount: openAlerts.length,
                alerts: openAlerts
            }, companyId);
        }
    }
}

module.exports = new AlertService();
