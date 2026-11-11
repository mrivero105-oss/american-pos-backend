const express = require('express');
const router = express.Router();
const fiscalService = require('../services/FiscalService');
const { FiscalBookRecord, TaxRetention, CreditNote } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

// GET /sales-book - Libro de Ventas mensual
router.get('/sales-book', async (req, res) => {
    try {
        const currentDate = new Date();
        const year = req.query.year || currentDate.getFullYear();
        const month = req.query.month || (currentDate.getMonth() + 1);

        const data = await fiscalService.getSalesBook(req.user.companyId, year, month);
        res.json(data);
    } catch (error) {
        console.error('Error in GET /fiscal/sales-book:', error);
        res.status(500).json({ error: error.message || 'Error al generar Libro de Ventas' });
    }
});

// GET /purchases-book - Libro de Compras mensual
router.get('/purchases-book', async (req, res) => {
    try {
        const currentDate = new Date();
        const year = req.query.year || currentDate.getFullYear();
        const month = req.query.month || (currentDate.getMonth() + 1);

        const data = await fiscalService.getPurchasesBook(req.user.companyId, year, month);
        res.json(data);
    } catch (error) {
        console.error('Error in GET /fiscal/purchases-book:', error);
        res.status(500).json({ error: error.message || 'Error al generar Libro de Compras' });
    }
});

// GET /tax-summary - Resumen Impositivo (Débito vs Crédito Fiscal vs IGTF)
router.get('/tax-summary', async (req, res) => {
    try {
        const currentDate = new Date();
        const year = req.query.year || currentDate.getFullYear();
        const month = req.query.month || (currentDate.getMonth() + 1);

        const summary = await fiscalService.getTaxSummary(req.user.companyId, year, month);
        res.json(summary);
    } catch (error) {
        console.error('Error in GET /fiscal/tax-summary:', error);
        res.status(500).json({ error: error.message || 'Error al obtener resumen de impuestos' });
    }
});

// POST /records - Agregar registro manual al libro fiscal
router.post('/records', async (req, res) => {
    try {
        const {
            bookType,
            recordDate,
            documentType,
            documentNumber,
            controlNumber,
            entityRif,
            entityName,
            affectedInvoiceNumber,
            totalAmount,
            exemptAmount,
            taxableBase,
            taxRate,
            taxAmount,
            retainedIvaAmount,
            igtfAmount,
            currency,
            exchangeRate,
            notes
        } = req.body;

        if (!bookType || !recordDate || !documentNumber) {
            return res.status(400).json({ error: 'Tipo de libro, fecha y número de documento son obligatorios' });
        }

        const dateObj = new Date(recordDate);
        const record = await FiscalBookRecord.create({
            id: generateRobustId(),
            companyId: req.user.companyId,
            bookType,
            recordDate,
            documentType: documentType || 'FACTURA',
            documentNumber,
            controlNumber: controlNumber || '',
            entityRif: entityRif || 'V-00000000',
            entityName: entityName || 'Consumidor Final',
            affectedInvoiceNumber: affectedInvoiceNumber || '',
            totalAmount: Number(totalAmount) || 0,
            exemptAmount: Number(exemptAmount) || 0,
            taxableBase: Number(taxableBase) || 0,
            taxRate: Number(taxRate) || 16.00,
            taxAmount: Number(taxAmount) || 0,
            retainedIvaAmount: Number(retainedIvaAmount) || 0,
            igtfAmount: Number(igtfAmount) || 0,
            currency: currency || 'VES',
            exchangeRate: Number(exchangeRate) || 1.0,
            periodYear: dateObj.getFullYear(),
            periodMonth: dateObj.getMonth() + 1,
            userId: req.user.id,
            notes: notes || ''
        });

        res.status(201).json(record);
    } catch (error) {
        console.error('Error in POST /fiscal/records:', error);
        res.status(500).json({ error: error.message || 'Error al registrar asiento fiscal' });
    }
});

// GET /retentions - Listar comprobantes de retención
router.get('/retentions', async (req, res) => {
    try {
        const { periodYear, periodMonth, retentionCategory } = req.query;
        const whereClause = { companyId: req.user.companyId };

        if (periodYear) whereClause.periodYear = parseInt(periodYear);
        if (periodMonth) whereClause.periodMonth = parseInt(periodMonth);
        if (retentionCategory) whereClause.retentionCategory = retentionCategory;

        const retentions = await TaxRetention.findAll({
            where: whereClause,
            order: [['recordDate', 'DESC'], ['voucherNumber', 'DESC']]
        });

        res.json(retentions);
    } catch (error) {
        console.error('Error in GET /fiscal/retentions:', error);
        res.status(500).json({ error: error.message || 'Error al obtener retenciones' });
    }
});

// POST /retentions - Emitir comprobante de retención
router.post('/retentions', async (req, res) => {
    try {
        const retention = await fiscalService.createTaxRetention(req.user.companyId, req.user.id, req.body);
        res.status(201).json(retention);
    } catch (error) {
        console.error('Error in POST /fiscal/retentions:', error);
        res.status(500).json({ error: error.message || 'Error al emitir comprobante de retención' });
    }
});

// GET /credit-notes - Listar notas de crédito emitidas
router.get('/credit-notes', async (req, res) => {
    try {
        const creditNotes = await CreditNote.findAll({
            where: { companyId: req.user.companyId },
            order: [['date', 'DESC'], ['creditNoteNumber', 'DESC']],
            limit: 100
        });
        res.json(creditNotes);
    } catch (error) {
        console.error('Error in GET /fiscal/credit-notes:', error);
        res.status(500).json({ error: error.message || 'Error al obtener notas de crédito' });
    }
});

// POST /credit-notes - Emitir nueva Nota de Crédito (afecta inventario, deuda y libros fiscales)
router.post('/credit-notes', async (req, res) => {
    try {
        const creditNote = await fiscalService.issueCreditNote(req.user.companyId, req.user.id, req.body);
        res.status(201).json(creditNote);
    } catch (error) {
        console.error('Error in POST /fiscal/credit-notes:', error);
        res.status(500).json({ error: error.message || 'Error al emitir la nota de crédito' });
    }
});

// GET /devices - Obtener puertos COM e impresoras disponibles para conexión fiscal
router.get('/devices', async (req, res) => {
    try {
        const FiscalSpoolerService = require('../services/FiscalSpoolerService');
        const devices = await FiscalSpoolerService.getAvailableFiscalDevices();
        res.json({ success: true, ...devices });
    } catch (error) {
        console.error('Error in GET /fiscal/devices:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /action - Despachar comando fiscal (Reporte X, Reporte Z, Factura Fiscal, Cancelar)
router.post('/action', async (req, res) => {
    try {
        const FiscalSpoolerService = require('../services/FiscalSpoolerService');
        const {
            action,
            saleId,
            targetType,
            targetPort,
            baudRate,
            targetPrinter,
            spoolerPath
        } = req.body;

        const result = await FiscalSpoolerService.executeFiscalAction({
            action,
            saleId,
            targetType,
            targetPort,
            baudRate,
            targetPrinter,
            spoolerPath,
            companyId: req.user?.companyId || 'company_default',
            userId: req.user?.id
        });

        res.json(result);
    } catch (error) {
        console.error('Error in POST /fiscal/action:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
