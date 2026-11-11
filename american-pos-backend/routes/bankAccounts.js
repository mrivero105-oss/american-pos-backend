const express = require('express');
const router = express.Router();
const bankingService = require('../services/BankingService');
const { ExchangeDifferenceLog } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

// GET /accounts - List all bank accounts
router.get('/accounts', async (req, res) => {
    try {
        const accounts = await bankingService.getAccounts(req.user.companyId);
        res.json(accounts);
    } catch (error) {
        console.error('Error fetching bank accounts:', error);
        res.status(500).json({ error: error.message || 'Error al obtener cuentas bancarias' });
    }
});

// POST /accounts - Create new bank account
router.post('/accounts', async (req, res) => {
    try {
        const { bankName } = req.body;
        if (!bankName) return res.status(400).json({ error: 'El nombre del banco es obligatorio' });

        const account = await bankingService.createAccount(req.user.companyId, req.user.id, req.body);
        res.status(201).json(account);
    } catch (error) {
        console.error('Error creating bank account:', error);
        res.status(500).json({ error: error.message || 'Error al registrar cuenta bancaria' });
    }
});

// PUT /accounts/:id - Update bank account
router.put('/accounts/:id', async (req, res) => {
    try {
        const updated = await bankingService.updateAccount(req.user.companyId, req.user.id, req.params.id, req.body);
        res.json(updated);
    } catch (error) {
        console.error('Error updating bank account:', error);
        res.status(500).json({ error: error.message || 'Error al actualizar cuenta bancaria' });
    }
});

// DELETE /accounts/:id - Deactivate account
router.delete('/accounts/:id', async (req, res) => {
    try {
        const result = await bankingService.deleteAccount(req.user.companyId, req.user.id, req.params.id);
        res.json(result);
    } catch (error) {
        console.error('Error deleting bank account:', error);
        res.status(500).json({ error: error.message || 'Error al desactivar cuenta bancaria' });
    }
});

// GET /transactions - List transactions with filters
router.get('/transactions', async (req, res) => {
    try {
        const transactions = await bankingService.getTransactions(req.user.companyId, req.query);
        res.json(transactions);
    } catch (error) {
        console.error('Error fetching bank transactions:', error);
        res.status(500).json({ error: error.message || 'Error al obtener transacciones bancarias' });
    }
});

// POST /transactions - Manual bank movement
router.post('/transactions', async (req, res) => {
    try {
        const { bankAccountId, type, amount } = req.body;
        if (!bankAccountId || !type || !amount) {
            return res.status(400).json({ error: 'Cuenta, tipo y monto son obligatorios' });
        }
        const tx = await bankingService.createManualTransaction(req.user.companyId, req.user.id, req.body);
        res.status(201).json(tx);
    } catch (error) {
        console.error('Error creating manual bank transaction:', error);
        res.status(500).json({ error: error.message || 'Error al registrar movimiento bancario' });
    }
});

// POST /transfer - Transfer funds
router.post('/transfer', async (req, res) => {
    try {
        const { fromId, toId, amountSent } = req.body;
        if (!fromId || !toId || !amountSent) {
            return res.status(400).json({ error: 'Origen, destino y monto son obligatorios' });
        }
        const transfer = await bankingService.createTransfer(req.user.companyId, req.user.id, req.body);
        res.status(201).json(transfer);
    } catch (error) {
        console.error('Error executing transfer:', error);
        res.status(500).json({ error: error.message || 'Error al procesar transferencia' });
    }
});

// POST /transactions/:id/reconcile - Toggle reconciliation
router.post('/transactions/:id/reconcile', async (req, res) => {
    try {
        const { reconciled } = req.body;
        const tx = await bankingService.reconcileTransaction(req.user.companyId, req.user.id, req.params.id, reconciled !== false);
        res.json(tx);
    } catch (error) {
        console.error('Error reconciling transaction:', error);
        res.status(500).json({ error: error.message || 'Error al conciliar transacción' });
    }
});

// GET /cashflow - Consolidated cash flow
router.get('/cashflow', async (req, res) => {
    try {
        const summary = await bankingService.getCashFlowSummary(req.user.companyId);
        res.json(summary);
    } catch (error) {
        console.error('Error fetching cash flow summary:', error);
        res.status(500).json({ error: error.message || 'Error al obtener resumen de flujo de caja' });
    }
});

// GET /exchange-differences - Get differential logs
router.get('/exchange-differences', async (req, res) => {
    try {
        const logs = await ExchangeDifferenceLog.findAll({
            where: { companyId: req.user.companyId },
            order: [['date', 'DESC'], ['createdAt', 'DESC']],
            limit: 100
        });
        res.json(logs);
    } catch (error) {
        console.error('Error fetching exchange differences:', error);
        res.status(500).json({ error: error.message || 'Error al obtener registros de diferencial cambiario' });
    }
});

// POST /exchange-differences - Create differential log
router.post('/exchange-differences', async (req, res) => {
    try {
        const { transactionType, documentId, originalAmountUsd, originalRate, settlementRate, differenceAmountVes, classification, date, notes } = req.body;
        const log = await ExchangeDifferenceLog.create({
            id: generateRobustId(),
            companyId: req.user.companyId,
            transactionType: transactionType || 'COBRO_CLIENTE',
            documentId: documentId || 'S/N',
            originalAmountUsd: Number(originalAmountUsd) || 0,
            originalRate: Number(originalRate) || 1,
            settlementRate: Number(settlementRate) || 1,
            differenceAmountVes: Number(differenceAmountVes) || 0,
            classification: classification || (Number(differenceAmountVes) >= 0 ? 'GANANCIA' : 'PERDIDA'),
            date: date || new Date().toISOString().split('T')[0],
            userId: req.user.id,
            notes: notes || ''
        });
        res.status(201).json(log);
    } catch (error) {
        console.error('Error saving exchange difference:', error);
        res.status(500).json({ error: error.message || 'Error al registrar diferencial cambiario' });
    }
});

module.exports = router;
