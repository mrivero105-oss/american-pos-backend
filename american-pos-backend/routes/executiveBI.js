const express = require('express');
const router = express.Router();
const biService = require('../services/ExecutiveBIService');
const { isAdmin, requirePermission } = require('../middleware/auth');

// ==========================================
// 1. ESTADO DE RESULTADOS (P&L)
// ==========================================
router.get('/profit-loss', requirePermission('canViewReports'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const pnl = await biService.getProfitAndLoss(companyId, req.query);
        res.json(pnl);
    } catch (error) {
        console.error('Error in GET /bi/profit-loss:', error);
        res.status(500).json({ error: error.message || 'Error al generar Estado de Resultados' });
    }
});

// ==========================================
// 2. CIERRES DE PERÍODO CONTABLE
// ==========================================
router.get('/periods', requirePermission('canViewReports'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const periods = await biService.getAccountingPeriods(companyId, req.query.year);
        res.json(periods);
    } catch (error) {
        console.error('Error in GET /bi/periods:', error);
        res.status(500).json({ error: error.message || 'Error al obtener períodos contables' });
    }
});

router.post('/periods/close', isAdmin, async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.username || req.user?.id || 'admin';
        const { year, month, notes } = req.body;
        if (!year || !month) return res.status(400).json({ error: 'Año y mes son requeridos' });

        const period = await biService.closePeriod(companyId, year, month, userId, notes);
        res.json({ success: true, message: `Período ${month}/${year} cerrado exitosamente`, period });
    } catch (error) {
        console.error('Error in POST /bi/periods/close:', error);
        res.status(400).json({ error: error.message || 'Error al cerrar período' });
    }
});

router.post('/periods/reopen', isAdmin, async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.username || req.user?.id || 'supervisor';
        const { year, month, reason } = req.body;
        if (!year || !month) return res.status(400).json({ error: 'Año y mes son requeridos' });

        const period = await biService.reopenPeriod(companyId, year, month, userId, reason);
        res.json({ success: true, message: `Período ${month}/${year} reabierto`, period });
    } catch (error) {
        console.error('Error in POST /bi/periods/reopen:', error);
        res.status(400).json({ error: error.message || 'Error al reabrir período' });
    }
});

router.get('/check-date-lock', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const isLocked = await biService.isDateInClosedPeriod(companyId, req.query.date);
        res.json({ isLocked });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 3. COMISIONES DE VENDEDORES
// ==========================================
router.get('/commissions', requirePermission('canViewReports'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const commissions = await biService.getSellerCommissions(companyId, req.query.year, req.query.month);
        res.json(commissions);
    } catch (error) {
        console.error('Error in GET /bi/commissions:', error);
        res.status(500).json({ error: error.message || 'Error al obtener comisiones' });
    }
});

router.post('/commissions/rate', isAdmin, async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { userId, year, month, rate, notes } = req.body;
        if (!userId || !year || !month) return res.status(400).json({ error: 'Parámetros incompletos' });

        const result = await biService.setCommissionRate(companyId, userId, year, month, rate, notes);
        res.json(result);
    } catch (error) {
        console.error('Error in POST /bi/commissions/rate:', error);
        res.status(400).json({ error: error.message || 'Error al actualizar tasa de comisión' });
    }
});

router.post('/commissions/:id/settle', isAdmin, async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const result = await biService.settleCommission(req.params.id, companyId, req.body.notes);
        res.json({ success: true, message: 'Comisión liquidada y marcada como pagada', commission: result });
    } catch (error) {
        console.error('Error in POST /bi/commissions/:id/settle:', error);
        res.status(400).json({ error: error.message || 'Error al liquidar comisión' });
    }
});

module.exports = router;
