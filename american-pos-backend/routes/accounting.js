const express = require('express');
const router = express.Router();
const AccountingEngineService = require('../services/AccountingEngineService');
const { AccountCatalog } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const { requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createAccountSchema, createEntrySchema } = require('../schemas/accountingSchema');

// Todas las rutas contables requieren permiso financiero o rango administrativo
router.use(requirePermission('canAccessFinance'));

// Obtener todas las cuentas del catálogo
router.get('/accounts', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        let accounts = await AccountCatalog.findAll({
            where: { companyId },
            order: [['code', 'ASC']]
        });

        if (accounts.length === 0) {
            // Auto-sembrar PUC por conveniencia en primera apertura
            await AccountingEngineService.seedDefaultChartOfAccounts(companyId);
            accounts = await AccountCatalog.findAll({
                where: { companyId },
                order: [['code', 'ASC']]
            });
        }

        res.json({ success: true, accounts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sembrar o resetear PUC estándar
router.post('/seed-catalog', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const result = await AccountingEngineService.seedDefaultChartOfAccounts(companyId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Crear nueva cuenta contable
router.post('/accounts', validate(createAccountSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { code, name, accountType, nature, parentId, isSelectable, description } = req.body;

        if (!code || !name || !accountType) {
            return res.status(400).json({ success: false, error: 'Código, nombre y tipo de cuenta son obligatorios.' });
        }

        const existing = await AccountCatalog.findOne({ where: { code, companyId } });
        if (existing) {
            return res.status(400).json({ success: false, error: `Ya existe una cuenta con el código ${code}.` });
        }

        const account = await AccountCatalog.create({
            id: generateRobustId(),
            companyId,
            code,
            name,
            accountType,
            nature: nature || 'DEBIT',
            parentId: parentId || null,
            isSelectable: isSelectable !== false,
            description: description || ''
        });

        res.json({ success: true, account });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Listar asientos de Diario
router.get('/entries', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { startDate, endDate, entryType, limit, offset } = req.query;
        const result = await AccountingEngineService.getJournalEntries({
            companyId,
            startDate,
            endDate,
            entryType,
            limit,
            offset
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Crear asiento contable manual
router.post('/entries', validate(createEntrySchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || null;
        const { entryDate, description, currency, exchangeRate, lines } = req.body;

        if (!Array.isArray(lines) || lines.length < 2) {
            return res.status(400).json({ success: false, error: 'Se requieren al menos 2 líneas para registrar el asiento contable.' });
        }

        const entry = await AccountingEngineService.createEntry({
            companyId,
            entryDate,
            description,
            entryType: 'MANUAL',
            currency: currency || 'USD',
            exchangeRate: exchangeRate || 1,
            referenceType: 'MANUAL',
            userId,
            lines
        });

        res.json({ success: true, entry });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Libro Mayor de una cuenta
router.get('/ledger/:accountId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { accountId } = req.params;
        const { startDate, endDate } = req.query;
        const result = await AccountingEngineService.getGeneralLedger(accountId, { companyId, startDate, endDate });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Balance de Comprobación
router.get('/trial-balance', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { asOfDate } = req.query;
        const result = await AccountingEngineService.getTrialBalance({ companyId, asOfDate });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Balance General / Situación Financiera
router.get('/balance-sheet', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { asOfDate } = req.query;
        const result = await AccountingEngineService.getBalanceSheet({ companyId, asOfDate });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
