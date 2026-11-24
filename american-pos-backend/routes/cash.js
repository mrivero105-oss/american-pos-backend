const express = require('express');
const router = express.Router();
const cashService = require('../services/CashService');
const { isAdmin, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
    openShiftSchema,
    closeShiftSchema,
    cashMovementSchema,
    forceCloseShiftSchema,
    registerNameSchema,
    stationCategoriesSchema,
    drawerOpenEventSchema,
    alertStatusUpdateSchema
} = require('../schemas/cashSchema');
const { CashShift, User } = require('../database/models');
const { Op } = require('sequelize');

const applyBlindClosureFilter = (req, shiftData) => {
    if (!shiftData) return shiftData;
    const { readJson, getUserSettings } = require('../utils/helpers');
    const { SETTINGS_FILE } = require('../config/paths');
    const allSettings = readJson(SETTINGS_FILE);
    const userSettings = getUserSettings(allSettings, req.user.companyId);
    const isBlindClosureMode = userSettings?.cashClosureMode === 'BLIND';
    const isSupervisorOrAdmin = ['admin', 'superadmin', 'owner', 'dueño', 'supervisor'].includes(String(req.user.role || '').toLowerCase());

    if (isBlindClosureMode && !isSupervisorOrAdmin) {
        shiftData.expectedAmount = null;
        shiftData.theoreticalTotalUsd = null;
        shiftData.expectedCashUsd = null;
        shiftData.expectedCashBs = null;
        shiftData.expectedBreakdown = null;
        shiftData.isBlindClose = true;
    } else {
        shiftData.isBlindClose = false;
    }
    return shiftData;
};

// GET /current - Get current open shift with stats
router.get('/current', async (req, res) => {
    try {
        const registerId = req.query.registerId || '1';
        const shiftData = await cashService.getCurrentShift(req.user.id, req.user.companyId, registerId);
        applyBlindClosureFilter(req, shiftData);
        res.json(shiftData);
    } catch (error) {
        console.error('Error in GET /cash/current:', error);
        res.status(500).json({ error: 'Error al obtener turno', detail: error.message });
    }
});

// GET /last-closed - Get last closed shift summary for suggestions
router.get('/last-closed', async (req, res) => {
    try {
        const registerId = req.query.registerId || '1';
        const lastShift = await cashService.getLastClosedShift(req.user.companyId, registerId);
        res.json(lastShift);
    } catch (error) {
        console.error('Error in GET /cash/last-closed:', error);
        res.status(500).json({ error: 'Error al obtener último turno' });
    }
});

// GET /admin/dashboard - Live multi-terminal command center (Admin or canMonitorCashiers)
router.get('/admin/dashboard', requirePermission('canMonitorCashiers'), async (req, res) => {
    try {
        const dashboardData = await cashService.getAdminLiveCashDashboard(req.user.companyId, req.user);
        res.json(dashboardData);
    } catch (error) {
        console.error('Error in GET /cash/admin/dashboard:', error);
        res.status(500).json({ error: 'Error al obtener dashboard de cajas', detail: error.message });
    }
});

// GET /admin/cashier-audit/:userId - 360° Cashier Audit File (Admin only)
router.get('/admin/cashier-audit/:userId', isAdmin, async (req, res) => {
    try {
        const auditFile = await cashService.getCashierAuditFile(req.params.userId, req.user.companyId);
        res.json(auditFile);
    } catch (error) {
        console.error('Error in GET /cash/admin/cashier-audit:', error);
        res.status(500).json({ error: 'Error al obtener expediente de auditoría', detail: error.message });
    }
});

// POST /admin/force-close/:shiftId - Remote force close of shift (Admin only)
router.post('/admin/force-close/:shiftId', isAdmin, validate(forceCloseShiftSchema), async (req, res) => {
    try {
        const closedShift = await cashService.forceCloseShift(req.user, req.params.shiftId, req.body.reason);
        
        // Emit Real-Time event
        const io = req.app?.get('io') || global.io;
        if (io) {
            io.to(req.user.companyId).emit('cash_register_activity', {
                type: 'shift_force_closed',
                shiftId: closedShift.id,
                registerId: closedShift.registerId,
                registerName: closedShift.registerName,
                userId: closedShift.userId,
                userName: closedShift.userName,
                forcedBy: req.user.name || req.user.username,
                timestamp: closedShift.closedAt
            });
        }

        res.json({ success: true, message: 'Turno cerrado forzosamente por administrador', shift: closedShift });
    } catch (error) {
        console.error('Error in POST /cash/admin/force-close:', error);
        res.status(400).json({ error: error.message });
    }
});

// PUT /admin/register-name/:shiftId - Rename register on the fly (Admin only)
router.put('/admin/register-name/:shiftId', isAdmin, validate(registerNameSchema), async (req, res) => {
    try {
        const { shiftId } = req.params;
        const { registerName } = req.body;
        if (!registerName || !registerName.trim()) {
            return res.status(400).json({ error: 'Nombre de caja requerido' });
        }
        const shift = await CashShift.findOne({
            where: { id: shiftId, companyId: req.user.companyId }
        });
        if (!shift) {
            return res.status(404).json({ error: 'Turno de caja no encontrado' });
        }
        await shift.update({ registerName: registerName.trim() });
        
        const io = req.app?.get('io') || global.io;
        if (io) {
            io.to(req.user.companyId).emit('cash_register_activity', {
                type: 'register_renamed',
                shiftId: shift.id,
                registerId: shift.registerId,
                registerName: registerName.trim(),
                timestamp: new Date().toISOString()
            });
        }

        res.json({ success: true, registerName: registerName.trim() });
    } catch (error) {
        console.error('Error in PUT /cash/admin/register-name:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /active-shifts - Get all active open shifts for the company (Admin monitoring)
// PUT /station-categories - Update station categories and products for active shift in real-time
router.put('/station-categories', requirePermission('canManageSettings'), validate(stationCategoriesSchema), async (req, res) => {
    try {
        const { shiftId, registerId, allowedCategories, allowedProducts } = req.body;
        const { CashShift } = require('../database/models');
        const companyId = req.user?.companyId || '2';
        let shift = null;
        if (shiftId) {
            shift = await CashShift.findOne({ where: { id: shiftId, companyId } });
        } else if (registerId) {
            shift = await CashShift.findOne({ where: { registerId: String(registerId), status: 'open', companyId } });
        }
        if (shift) {
            const updatePayload = {};
            if (allowedCategories !== undefined) {
                let sanitizedCats = [];
                if (Array.isArray(allowedCategories)) {
                    sanitizedCats = allowedCategories.map(c => String(c).trim()).filter(Boolean);
                }
                updatePayload.allowedCategories = sanitizedCats;
            }
            if (allowedProducts !== undefined) {
                let sanitizedProds = [];
                if (Array.isArray(allowedProducts)) {
                    sanitizedProds = allowedProducts;
                }
                updatePayload.allowedProducts = sanitizedProds;
            }
            await shift.update(updatePayload);
        }
        res.json({ success: true, allowedCategories, allowedProducts });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/active-shifts', isAdmin, async (req, res) => {
    try {
        const activeShifts = await cashService.getActiveShifts(req.user.companyId);
        res.json(activeShifts);
    } catch (error) {
        console.error('Error in GET /cash/active-shifts:', error);
        res.status(500).json({ error: 'Error al obtener cajas activas' });
    }
});

// POST /open - Open a new shift
router.post('/open', requirePermission('canManageCashShift'), validate(openShiftSchema), async (req, res) => {
    try {
        const newShift = await cashService.openShift(req.user, req.body);
        
        const io = req.app?.get('io') || global.io;
        if (io) {
            io.to(req.user.companyId).emit('cash_register_activity', {
                type: 'shift_open',
                shiftId: newShift.id,
                registerId: newShift.registerId || '1',
                registerName: newShift.registerName || `Caja ${newShift.registerId || '1'}`,
                userId: newShift.userId || req.user.id,
                userName: newShift.userName || req.user.name || req.user.username,
                amount: Number(newShift.initialAmount) || 0,
                timestamp: newShift.openedAt || new Date().toISOString()
            });
        }

        res.status(201).json(newShift);
    } catch (error) {
        console.error('Error in POST /cash/open:', error);
        res.status(400).json({ error: error.message });
    }
});

// POST /close - Close the current shift
router.post('/close', requirePermission('canManageCashShift'), validate(closeShiftSchema), async (req, res) => {
    try {
        const closedShift = await cashService.closeShift(req.user, req.body);
        
        const io = req.app?.get('io') || global.io;
        if (io) {
            io.to(req.user.companyId).emit('cash_register_activity', {
                type: 'shift_close',
                shiftId: closedShift.id,
                registerId: closedShift.registerId || req.body?.registerId || '1',
                registerName: closedShift.registerName || `Caja ${closedShift.registerId || req.body?.registerId || '1'}`,
                userId: req.user.id,
                userName: req.user.name || req.user.username,
                difference: closedShift.difference,
                timestamp: closedShift.closedAt || new Date().toISOString()
            });
        }

        res.json(closedShift);
    } catch (error) {
        console.error(`[CASH] Error in POST /cash/close (User: ${req.user.id}):`, error.message);
        const isAuthReq = error.code === 'SUPERVISOR_AUTH_REQUIRED';
        res.status(isAuthReq ? 403 : 400).json({ 
            error: error.message || 'No se pudo cerrar la caja', 
            message: error.message,
            code: error.code || 'SHIFT_CLOSE_ERROR',
            difference: error.difference,
            tolerance: error.tolerance
        });
    }
});

// POST /close-blind - Cierre Ciego de Turno (Auditoría Antifraude)
router.post('/close-blind', requirePermission('canManageCashShift'), validate(closeShiftSchema), async (req, res) => {
    try {
        const result = await cashService.closeShiftBlind(req.user, req.body);
        
        const io = req.app?.get('io') || global.io;
        if (io) {
            io.to(req.user.companyId).emit('cash_register_activity', {
                type: 'shift_close',
                shiftId: result?.shift?.id,
                registerId: result?.shift?.registerId || req.body?.registerId || '1',
                registerName: result?.shift?.registerName || `Caja ${result?.shift?.registerId || req.body?.registerId || '1'}`,
                userId: req.user.id,
                userName: req.user.name || req.user.username,
                difference: result?.shift?.difference,
                timestamp: new Date().toISOString()
            });
        }

        res.json(result);
    } catch (error) {
        console.error(`[CASH] Error en POST /cash/close-blind (User: ${req.user.id}):`, error.message);
        const isAuthReq = error.code === 'SUPERVISOR_AUTH_REQUIRED';
        res.status(isAuthReq ? 403 : 400).json({ 
            error: error.message || 'No se pudo procesar la declaración de cierre', 
            message: error.message,
            code: error.code || 'BLIND_CLOSE_ERROR',
            difference: error.difference,
            tolerance: error.tolerance
        });
    }
});

// Helper to verify audit access for Dueño, Admin, Supervisor, or users with canAccessAudit
const isAuditAuthorized = (user) => {
    if (!user) return false;
    const role = (user.role || '').toLowerCase();
    const permissions = user.permissions || {};
    return ['admin', 'owner', 'dueño', 'superadmin', 'supervisor'].includes(role) || permissions.canAccessAudit === true;
};

// GET /audit-summary - Summary of alerts and patterns (Dueño, Admin, Supervisor)
router.get('/audit-summary', async (req, res) => {
    try {
        if (!isAuditAuthorized(req.user)) {
            return res.status(403).json({ message: 'No autorizado para ver auditoría' });
        }
        const summary = await cashService.getAuditSummary(req.user);
        res.json(summary);
    } catch (error) {
        console.error('[AUDIT-SUMMARY ERROR]', error.message, error.stack);
        res.status(500).json({ message: error.message });
    }
});

// GET /audit-history - Paginated list of all audit declarations (Dueño, Admin, Supervisor)
router.get('/audit-history', async (req, res) => {
    try {
        if (!isAuditAuthorized(req.user)) {
            return res.status(403).json({ message: 'No autorizado para ver auditoría' });
        }
        const { page = 1, limit = 20 } = req.query;
        const history = await cashService.getAuditHistory(req.user, parseInt(page), parseInt(limit));
        res.json(history);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /alerts - Get alert inbox (Dueño, Admin, Supervisor)
router.get('/alerts', async (req, res) => {
    try {
        if (!isAuditAuthorized(req.user)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const filters = {
            status: req.query.status,
            severity: req.query.severity,
            type: req.query.type
        };
        const alerts = await require('../services/AlertService').getAlertInbox(req.user.companyId, filters);
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// PUT /alerts/:id - Update alert status/resolution
router.put('/alerts/:id', validate(alertStatusUpdateSchema), async (req, res) => {
    try {
        if (!isAuditAuthorized(req.user)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        await require('../services/AlertService').updateAlertStatus(req.params.id, req.user.companyId, {
            ...req.body,
            userId: req.user.id
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /risk-level/:userId - Get risk assessment for a user (Dueño, Admin, Supervisor)
router.get('/risk-level/:userId', async (req, res) => {
    try {
        if (!isAuditAuthorized(req.user)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const risk = await require('../services/AlertService').calculateUserRisk(req.params.userId, req.user.companyId);
        res.json(risk);
    } catch (error) {
        console.error(`[CASH] Error en GET /cash/risk-level/${req.params.userId}:`, error);
        res.status(500).json({ message: error.message });
    }
});

// GET /audit-daily-report - Download daily PDF audit report (Dueño, Admin, Supervisor)
router.get('/audit-daily-report', async (req, res) => {
    try {
        if (!isAuditAuthorized(req.user)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const { date } = req.query;
        const pdfBuffer = await cashService.generateDailyAuditReport(req.user, date);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_Auditoria_${date || 'hoy'}.pdf`);
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Daily Report Error:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /movement - Add a cash movement (in/out/expense)
router.post('/movement', requirePermission('canManageCashShift'), validate(cashMovementSchema), async (req, res) => {
    try {
        const movement = await cashService.addMovement(req.user, req.body);
        
        const io = req.app?.get('io') || global.io;
        if (io) {
            io.to(req.user.companyId).emit('cash_register_activity', {
                type: 'movement',
                movementType: movement.type,
                registerId: req.body?.registerId || movement.registerId || '1',
                registerName: req.body?.registerName || (req.body?.registerId ? `Caja ${req.body.registerId}` : 'Caja Principal'),
                userId: req.user.id,
                userName: req.user.name || req.user.username,
                amount: Number(movement.amount) || 0,
                currency: movement.currency || 'USD',
                reason: movement.reason,
                timestamp: movement.timestamp || new Date().toISOString()
            });
        }

        res.json({ success: true, movement });
    } catch (error) {
        console.error('Error in POST /cash/movement:', error);
        res.status(400).json({ error: error.message });
    }
});

// GET /history - Get closed shifts history
router.get('/history', requirePermission(['canManageCashShift', 'canViewReports', 'canAccessAudit']), async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let whereClause = {
            companyId: req.user.companyId,
            status: { [Op.in]: ['closed', 'forced_closed'] },
            closedAt: { [Op.ne]: null }
        };

        if (startDate && endDate) {
            const startIso = startDate.includes('T') ? new Date(startDate).toISOString() : new Date(`${startDate}T00:00:00.000Z`).toISOString();
            const endIso = endDate.includes('T') ? new Date(endDate).toISOString() : new Date(`${endDate}T23:59:59.999Z`).toISOString();
            whereClause.closedAt = {
                [Op.ne]: null,
                [Op.between]: [startIso, endIso]
            };
        }

        const shifts = await CashShift.findAll({
            where: whereClause,
            limit: 50,
            order: [['closedAt', 'DESC']],
            include: [{ model: User, as: 'user', attributes: ['id', 'name', 'username'] }]
        });
        res.json(shifts);
    } catch (error) {
        console.error('Get cash history error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// GET /x-report - Quick X Report for current shift
router.get('/x-report', requirePermission(['canManageCashShift', 'canViewReports', 'canAccessAudit']), async (req, res) => {
    try {
        const registerId = req.query.registerId || '1';
        const shiftData = await cashService.getCurrentShift(req.user.id, req.user.companyId, registerId);
        if (!shiftData) return res.status(200).json(null);
        applyBlindClosureFilter(req, shiftData);
        res.json(shiftData);
    } catch (error) {
        console.error('X-Report error:', error);
        res.status(500).json({ error: 'Error al generar reporte X' });
    }
});

// POST /drawer-open-event - Log and notify manual cash drawer opening without sale
router.post('/drawer-open-event', validate(drawerOpenEventSchema), async (req, res) => {
    try {
        const { reason = 'Apertura manual de gaveta', registerId = '1' } = req.body || {};
        const { AuditLog } = require('../database/models');
        const { generateRobustId } = require('../utils/helpers');
        const OwnerNotificationService = require('../services/OwnerNotificationService');

        await AuditLog.create({
            id: generateRobustId(),
            userId: req.user.id,
            companyId: req.user.companyId,
            action: 'DRAWER_OPENED_NO_SALE',
            description: `Apertura manual de gaveta en Caja ${registerId}. Motivo: ${reason}`,
            entityId: registerId,
            timestamp: new Date().toISOString()
        });

        // Alerta al Dueño por WhatsApp
        OwnerNotificationService.notifySecurityAlert(req.user.companyId, 'DRAWER_OPEN_NO_SALE', {
            userName: req.user.name || req.user.username,
            registerId,
            reason
        });

        res.json({ success: true, message: 'Evento de gaveta registrado' });
    } catch (err) {
        console.error('Error logging drawer open event:', err);
        res.status(500).json({ error: 'Error al registrar evento de gaveta' });
    }
});

// GET /shift-products-summary/:shiftId - Resumen de mercancía vendida y stock remanente
router.get('/shift-products-summary/:shiftId', requirePermission(['canManageCashShift', 'canViewReports', 'canAccessAudit']), async (req, res) => {
    try {
        const { shiftId } = req.params;
        const items = await cashService.getShiftProductsSummary(shiftId, req.user.companyId);
        res.json({ success: true, items });
    } catch (error) {
        console.error('Error in GET /cash/shift-products-summary/:shiftId:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
