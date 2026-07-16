const express = require('express');
const router = express.Router();
const reportService = require('../services/ReportService');
const { isAdmin } = require('../middleware/auth');

// GET /audit-logs
router.get('/audit-logs', isAdmin, async (req, res) => {
    try {
        const logs = await reportService.getAuditLogs(req.user.companyId);
        res.json(logs);
    } catch (error) {
        console.error('Audit logs error:', error);
        res.status(500).json({ error: 'Error al obtener registros de auditoría' });
    }
});

// GET /dashboard/summary
router.get('/dashboard/summary', async (req, res) => {
    try {
        const summary = await reportService.getDashboardSummary(req.user, req.query);
        res.json(summary);
    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: 'Error al obtener resumen', details: error.message });
    }
});

// GET /inventory/low-stock
router.get('/inventory/low-stock', isAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const result = await reportService.getLowStock(req.user.companyId, page, limit);
        res.json(result);
    } catch (error) {
        console.error('Low stock error:', error);
        res.status(500).json({ error: 'Error al obtener productos bajo stock' });
    }
});

// GET /daily
router.get('/daily', async (req, res) => {
    try {
        const sales = await reportService.getDailyReport(req.user, req.query.date);
        res.json(sales);
    } catch (error) {
        console.error('Daily report error:', error);
        res.status(500).json({ error: 'Error al obtener reporte diario' });
    }
});

// GET /inventory/kardex/:productId
router.get('/inventory/kardex/:productId', isAdmin, async (req, res) => {
    try {
        const movements = await reportService.getKardex(req.params.productId, req.user.companyId);
        res.json(movements);
    } catch (error) {
        console.error('Kardex error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// GET /bi/profitability
router.get('/bi/profitability', async (req, res) => {
    try {
        const report = await reportService.getProfitability(req.user, req.query);
        res.json(report);
    } catch (error) {
        console.error('Profitability error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de rentabilidad' });
    }
});

// GET /bi/customers/ranking
router.get('/bi/customers/ranking', async (req, res) => {
    try {
        const ranking = await reportService.getCustomerRanking(req.user, req.query.range);
        res.json(ranking);
    } catch (error) {
        console.error('Customer ranking error:', error);
        res.status(500).json({ error: 'Error al obtener ranking' });
    }
});

// GET /inventory/valuation
router.get('/inventory/valuation', async (req, res) => {
    try {
        const valuation = await reportService.getInventoryValuation(req.user.companyId);
        res.json(valuation);
    } catch (error) {
        console.error('Valuation error:', error);
        res.status(500).json({ error: 'Error al calcular valuación' });
    }
});

// GET /bi/accounts-receivable
router.get('/bi/accounts-receivable', async (req, res) => {
    try {
        const result = await reportService.getAccountsReceivable(req.user.companyId);
        res.json(result);
    } catch (error) {
        console.error('AR error:', error);
        res.status(500).json({ error: 'Error al obtener cuentas por cobrar' });
    }
});

// GET /bi/accounts-payable
router.get('/bi/accounts-payable', async (req, res) => {
    try {
        const result = await reportService.getAccountsPayable(req.user.companyId);
        res.json(result);
    } catch (error) {
        console.error('AP error:', error);
        res.status(500).json({ error: 'Error al obtener cuentas por pagar' });
    }
});

// GET /bi/series
router.get('/bi/series', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const series = await reportService.getTimeSeries(req.user, days);
        res.json(series);
    } catch (error) {
        console.error('Series error:', error);
        res.status(500).json({ error: 'Error al obtener serie de tiempo' });
    }
});

// GET /bi/export
router.get('/bi/export', async (req, res) => {
    try {
        const { sales, productCostMap } = await reportService.getDetailedExportData(req.user.companyId, req.query);
        
        const BOM = '\ufeff';
        const SEP = ';';
        let csv = BOM + `Fecha${SEP}Hora${SEP}Referencia${SEP}Cliente${SEP}Metodo Pago${SEP}Producto${SEP}Cant${SEP}Precio Unit${SEP}Subtotal${SEP}Costo Unit${SEP}Utilidad Item\n`;
        
        sales.forEach(sale => {
            const dateStr = sale.date ? sale.date.substring(0, 10) : 'N/A';
            const timeStr = sale.createdAt ? new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
            const customer = sale.customerName || 'General';
            
            let method = '';
            if (sale.paymentMethods && Array.isArray(sale.paymentMethods) && sale.paymentMethods.length > 0) {
                if (sale.paymentMethods.length === 1) {
                    method = (sale.paymentMethods[0].method || 'Efectivo').replace(/_/g, ' ').toUpperCase();
                } else {
                    method = sale.paymentMethods.map(m => `${(m.method ||'').replace(/_/g, ' ').toUpperCase()}: ${m.amount} ${m.currency}`).join(' | ');
                }
            } else {
                method = (sale.paymentMethod || 'Efectivo').replace(/_/g, ' ').toUpperCase();
            }

            if (sale.SaleItems && sale.SaleItems.length > 0) {
                sale.SaleItems.forEach(item => {
                    let cost = Number(item.cost) || 0;
                    if (cost === 0) {
                        const productData = productCostMap[item.productId] || {};
                        cost = productData.cost || 0;
                        if (cost === 0) cost = (Number(item.price) || 0) * 0.70;
                    }
                    const itemQty = Number(item.quantity) || 0;
                    const itemPrice = Number(item.price) || 0;
                    const itemSubtotal = itemQty * itemPrice;
                    const itemProfit = itemSubtotal - (cost * itemQty);
                    csv += `${dateStr}${SEP}${timeStr}${SEP}${sale.id}${SEP}"${customer}"${SEP}${method}${SEP}"${item.name || 'Producto'}"${SEP}${itemQty}${SEP}${itemPrice.toFixed(2)}${SEP}${itemSubtotal.toFixed(2)}${SEP}${cost.toFixed(2)}${SEP}${itemProfit.toFixed(2)}\n`;
                });
            } else {
                csv += `${dateStr}${SEP}${timeStr}${SEP}${sale.id}${SEP}"${customer}"${SEP}${method}${SEP}"RESUMEN VENTA"${SEP}1${SEP}${sale.total}${SEP}${sale.total}${SEP}0.00${SEP}${sale.total}\n`;
            }
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=report_detailed_${req.query.range || '30d'}.csv`);
        res.status(200).send(csv);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Error al generar exportación', details: error.message });
    }
});

module.exports = router;
