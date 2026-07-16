const express = require('express');
const router = express.Router();
const expenseService = require('../services/ExpenseService');

// GET / - Search and list expenses
router.get('/', async (req, res) => {
    try {
        const expenses = await expenseService.getAllExpenses(req.user.companyId, req.query);
        res.json(expenses);
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({ error: 'Error al obtener gastos' });
    }
});

// GET /summary - Get total expenses amount
router.get('/summary', async (req, res) => {
    try {
        const result = await expenseService.getSummary(req.user.companyId, req.query);
        res.json(result);
    } catch (error) {
        console.error('Error in GET /expenses/summary:', error);
        res.status(500).json({ error: 'Error al obtener resumen de gastos' });
    }
});

// POST / - Create a new expense
router.post('/', async (req, res) => {
    try {
        const { description, amount } = req.body;
        if (!description || !amount) {
            return res.status(400).json({ error: 'Descripción y monto son obligatorios' });
        }

        const expense = await expenseService.createExpense(req.user, req.body);
        res.status(201).json(expense);
    } catch (error) {
        console.error('Error in POST /expenses:', error);
        res.status(500).json({ error: 'Error al registrar el gasto' });
    }
});

// DELETE /:id - Delete an expense
router.delete('/:id', async (req, res) => {
    try {
        const success = await expenseService.deleteExpense(req.user, req.params.id);
        if (success) {
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
router.post('/public-sync', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { expenses } = req.body;
        if (!expenses) return res.status(400).json({ error: 'Data required' });

        console.log(`[SYNC] Expenses: Receiving ${expenses.length} expenses for company ${req.user.companyId}`);
        const result = await expenseService.syncExpenses(req.user, expenses);
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Expenses Sync Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
