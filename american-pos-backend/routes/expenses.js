const express = require('express');
const router = express.Router();
const expenseService = require('../services/ExpenseService');
const { requirePermission } = require('../middleware/auth');

const emitExpensesChanged = (req, payload = {}) => {
    try {
        const companyId = String(req.user?.companyId || '2');
        try {
            const DailyRollupService = require('../services/DailyRollupService');
            const targetDate = payload?.expense?.date || req.body?.date || new Date();
            DailyRollupService.scheduleDayRefresh(companyId, targetDate);
        } catch (_) {}
        const io = req.app?.get('io');
        if (io) {
            const eventData = { companyId, timestamp: Date.now(), ...payload };
            io.to(companyId).emit('expenses_changed', eventData);
        }
    } catch (emitErr) {
        console.warn('[Expenses] Error emitiendo evento Socket.IO expenses_changed:', emitErr.message);
    }
};

// GET / - Search and list expenses
router.get('/', requirePermission('canManageExpenses', 'canViewReports', 'canManageCashShift'), async (req, res) => {
    try {
        const expenses = await expenseService.getAllExpenses(req.user.companyId, req.query);
        res.json(expenses);
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({ error: 'Error al obtener gastos' });
    }
});

// GET /summary - Get total expenses amount
router.get('/summary', requirePermission('canManageExpenses', 'canViewReports', 'canManageCashShift'), async (req, res) => {
    try {
        const result = await expenseService.getSummary(req.user.companyId, req.query);
        res.json(result);
    } catch (error) {
        console.error('Error in GET /expenses/summary:', error);
        res.status(500).json({ error: 'Error al obtener resumen de gastos' });
    }
});

// POST / - Create a new expense
router.post('/', requirePermission('canManageExpenses'), async (req, res) => {
    try {
        const { description, amount } = req.body;
        if (!description || !amount) {
            return res.status(400).json({ error: 'Descripción y monto son obligatorios' });
        }

        const expense = await expenseService.createExpense(req.user, req.body);
        emitExpensesChanged(req, { action: 'created', expense });
        res.status(201).json(expense);
    } catch (error) {
        console.error('Error in POST /expenses:', error);
        res.status(500).json({ error: 'Error al registrar el gasto' });
    }
});

// PUT /:id - Update an existing expense
router.put('/:id', requirePermission('canManageExpenses'), async (req, res) => {
    try {
        const updated = await expenseService.updateExpense(req.user, req.params.id, req.body);
        if (updated) {
            emitExpensesChanged(req, { action: 'updated', expense: updated });
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Gasto no encontrado' });
        }
    } catch (error) {
        console.error('Error in PUT /expenses/:id:', error);
        res.status(500).json({ error: 'Error al actualizar el gasto: ' + error.message });
    }
});

// DELETE /:id - Delete an expense
router.delete('/:id', requirePermission('canManageExpenses'), async (req, res) => {
    try {
        const success = await expenseService.deleteExpense(req.user, req.params.id);
        if (success) {
            emitExpensesChanged(req, { action: 'deleted', expenseId: req.params.id });
            res.json({ message: 'Gasto eliminado exitosamente' });
        } else {
            res.status(404).json({ error: 'Gasto no encontrado' });
        }
    } catch (error) {
        console.error('Error in DELETE /expenses:', error);
        res.status(500).json({ error: 'Error al eliminar el gasto' });
    }
});

/**
 * POST /public-sync - Sync local mobile expenses to server
 */
router.post('/public-sync', require('../middleware/auth').verifyToken, requirePermission('canManageExpenses'), async (req, res) => {
    try {
        const { expenses } = req.body;
        if (!expenses) return res.status(400).json({ error: 'Data required' });

        console.log(`[SYNC] Expenses: Receiving ${expenses.length} expenses for company ${req.user.companyId}`);
        const result = await expenseService.syncExpenses(req.user, expenses);
        emitExpensesChanged(req, { action: 'public-sync' });
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Expenses Sync Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
