const express = require('express');
const router = express.Router();
const cashService = require('../services/CashService');
const { isAdmin } = require('../middleware/auth');
const { CashShift, User } = require('../database/models');
const { Op } = require('sequelize');

// GET /current - Get current open shift with stats
router.get('/current', async (req, res) => {
    try {
        const registerId = req.query.registerId || '1';
        const shiftData = await cashService.getCurrentShift(req.user.id, req.user.companyId, registerId);
        res.json(shiftData);
    } catch (error) {
        console.error('Error in GET /cash/current:', error);
        res.status(500).json({ error: 'Error al obtener turno', detail: error.message });
    }
});

// GET /active-shifts - Get all active open shifts for the company (Admin monitoring)
router.get('/active-shifts', async (req, res) => {
    try {
        const activeShifts = await cashService.getActiveShifts(req.user.companyId);
        res.json(activeShifts);
    } catch (error) {
        console.error('Error in GET /cash/active-shifts:', error);
        res.status(500).json({ error: 'Error al obtener cajas activas' });
    }
});

// POST /open - Open a new shift
router.post('/open', async (req, res) => {
    try {
        const newShift = await cashService.openShift(req.user, req.body);
        res.status(201).json(newShift);
    } catch (error) {
        console.error('Error in POST /cash/open:', error);
        res.status(400).json({ error: error.message });
    }
});

// POST /close - Close the current shift
router.post('/close', async (req, res) => {
    try {
        const closedShift = await cashService.closeShift(req.user, req.body);
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
router.post('/close-blind', async (req, res) => {
    try {
        const result = await cashService.closeShiftBlind(req.user, req.body);
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

// GET /audit-summary - Summary of alerts and patterns (Admin only)
router.get('/audit-summary', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'owner' && req.user.role !== 'superadmin') {
            return res.status(403).json({ message: 'No autorizado para ver auditoría' });
        }
        const summary = await cashService.getAuditSummary(req.user);
        res.json(summary);
    } catch (error) {
        console.error('[AUDIT-SUMMARY ERROR]', error.message, error.stack);
        res.status(500).json({ message: error.message });
    }
});

// GET /audit-history - Paginated list of all audit declarations (Admin only)
router.get('/audit-history', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'owner' && req.user.role !== 'superadmin') {
            return res.status(403).json({ message: 'No autorizado para ver auditoría' });
        }
        const { page = 1, limit = 20 } = req.query;
        const history = await cashService.getAuditHistory(req.user, parseInt(page), parseInt(limit));
        res.json(history);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /alerts - Get alert inbox (Admin only)
router.get('/alerts', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'owner' && req.user.role !== 'superadmin') {
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
router.put('/alerts/:id', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'owner' && req.user.role !== 'superadmin') {
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

// GET /risk-level/:userId - Get risk assessment for a user
router.get('/risk-level/:userId', async (req, res) => {
    try {
        const risk = await require('../services/AlertService').calculateUserRisk(req.params.userId, req.user.companyId);
        res.json(risk);
    } catch (error) {
        console.error(`[CASH] Error en GET /cash/risk-level/${req.params.userId}:`, error);
        res.status(500).json({ message: error.message });
    }
});

// GET /audit-daily-report - Download daily PDF audit report (Admin only)
router.get('/audit-daily-report', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'owner' && req.user.role !== 'superadmin') {
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
router.post('/movement', async (req, res) => {
    try {
        const movement = await cashService.addMovement(req.user, req.body);
        res.json({ success: true, movement });
    } catch (error) {
        console.error('Error in POST /cash/movement:', error);
        res.status(400).json({ error: error.message });
    }
});

// GET /history - Get closed shifts history (Admin only)
router.get('/history', isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let whereClause = { companyId: req.user.companyId, status: 'closed' };

        if (startDate && endDate) {
            whereClause.closedAt = {
                [Op.between]: [new Date(startDate).toISOString(), new Date(endDate).toISOString()]
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
router.get('/x-report', async (req, res) => {
    try {
        const registerId = req.query.registerId || '1';
        const shiftData = await cashService.getCurrentShift(req.user.id, req.user.companyId, registerId);
        if (!shiftData) return res.status(200).json(null);
        
        res.json(shiftData);
    } catch (error) {
        console.error('X-Report error:', error);
        res.status(500).json({ error: 'Error al generar reporte X' });
    }
});

module.exports = router;
