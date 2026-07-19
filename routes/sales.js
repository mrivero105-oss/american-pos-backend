const express = require('express');
const router = express.Router();
const SaleService = require('../services/SaleService');
const { Sale, SaleItem } = require('../database/models');
const { Op } = require('sequelize');
const { sequelize } = require('../database/connection');
const validate = require('../middleware/validate');
const { saleSchema } = require('../schemas/saleSchema');

/**
 * POST /public-sync - Sync local mobile sales to server (Protected)
 */
router.post('/public-sync', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { sales } = req.body;
        if (!Array.isArray(sales)) return res.status(400).json({ error: 'Formato de ventas inválido' });

        console.log(`[SYNC] Recibidas ${sales.length} ventas del móvil (Usuario: ${req.user.name})`);
        const { Sale } = require('../database/models');
        const { Op } = require('sequelize');
        const results = { success: [], errors: [] };
        const CHUNK_SIZE = 25;

        for (let i = 0; i < sales.length; i += CHUNK_SIZE) {
            // Ceder control al Event Loop entre lotes para no saturar RAM ni bloquear Express
            await new Promise(resolve => setImmediate(resolve));
            const chunk = sales.slice(i, i + CHUNK_SIZE);
            const chunkIds = chunk.map(s => String(s.id));
            
            // Optimización I/O: Consulta masiva por lote de IDs existentes en lugar de N consultas findOne
            const existingSales = await Sale.findAll({
                where: { id: { [Op.in]: chunkIds }, companyId: String(req.user.companyId) }
            });
            const existingMap = new Map(existingSales.map(s => [String(s.id), s]));

            for (let saleData of chunk) {
                try {
                    // EXTREME TYPE SANITIZATION: Postgres strict type matching
                    saleData.id = String(saleData.id);
                    if (saleData.customerId) saleData.customerId = String(saleData.customerId);
                    if (saleData.items) {
                        saleData.items = saleData.items.map(item => ({
                            ...item,
                            id: String(item.id),
                            productId: item.productId ? String(item.productId) : String(item.id)
                        }));
                    }

                    const saleId = saleData.id;
                    const existing = existingMap.get(String(saleId));

                    if (existing) {
                        if (!existing.customerId || existing.customerId === '') {
                            console.log(`[SYNC] Vinculando venta huérfana existente: ${saleData.id} -> ${saleData.customerName}`);
                            await SaleService.updateOrphanSaleCustomer(saleData.id, saleData.customerId, saleData.customerName);
                            results.success.push({ id: saleData.id, message: 'Vinculado' });
                        } else {
                            console.log(`[SYNC] Salteando venta duplicada (ya vinculada): ${saleData.id}`);
                            results.success.push({ id: saleData.id, message: 'Ya existe' });
                        }
                        continue;
                    }

                console.log(`[SYNC] Procesando venta: ${saleData.id} - Cliente: ${saleData.customerName || 'N/A'}`);
                const processed = await SaleService.processSale(req.user, saleData, { bypassCreditLimit: true, bypassStockCheck: true });
                console.log(`[SYNC] Éxito: Venta ${saleData.id} registrada en DB con ID ${processed.id}`);
                results.success.push({ id: saleData.id, dbId: processed.id });

                const io = req.app.get('io');
                if (io) {
                    io.to(req.user.companyId).emit('sale_completed', processed);
                    io.to(req.user.companyId).emit('inventory_changed');
                }
            } catch (err) {
                console.error(`[SYNC] !!! ERROR CRÍTICO en venta ${saleData.id}:`, err.message);
                results.errors.push({ id: saleData.id, error: err.message });
            }
        }
        }
        res.json({ success: true, synced: results.success.length, errors: results.errors.length, details: results });
    } catch (error) {
        console.error('Mobile sales sync error:', error);
        res.status(500).json({ error: 'Error interno en sincronización de ventas' });
    }
});

/**
 * GET /public-list - Get sales history for mobile (Protected)
 */
router.get('/public-list', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const where = {};
        // IDOR FIX: Always enforce companyId
        where.companyId = req.user.companyId;
        if (req.user.role?.toLowerCase() === 'user') {
            where.userId = req.user.id;
        }

        const sales = await Sale.findAll({
            where,
            limit: 50,
            order: [['date', 'DESC']],
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });
        res.json(sales);
    } catch (error) {
        console.error('Public sales list error:', error);
        res.status(500).json({ error: 'Error al obtener historial de ventas' });
    }
});
router.get('/', async (req, res) => {
    try {
        const {
            date, startDate, endDate, documentType, paymentMethod,
            status, minAmount, maxAmount, customerId, userId, registerId, page = 1, limit = 50
        } = req.query;

        const whereClause = {};
        const userRole = req.user.role?.toLowerCase();

        // IDOR FIX: Always enforce companyId
        whereClause.companyId = req.user.companyId;
        
        if (userRole === 'user') {
            whereClause.userId = req.user.id;
        } else if (userId) {
            whereClause.userId = userId;
        }
        if (registerId) {
            whereClause.registerId = registerId;
        }

        const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
        if (date) whereClause.date = { [likeOp]: `${date}%` };
        else if (startDate && endDate) whereClause.date = { [Op.between]: [startDate, endDate + 'T23:59:59.999Z'] };

        if (documentType) whereClause.documentType = documentType;
        if (paymentMethod) whereClause.paymentMethod = paymentMethod;
        if (status) whereClause.status = status;
        if (customerId) whereClause.customerId = customerId;

        if (minAmount || maxAmount) {
            whereClause.total = {};
            if (minAmount) whereClause.total[Op.gte] = parseFloat(minAmount);
            if (maxAmount) whereClause.total[Op.lte] = parseFloat(maxAmount);
        }

        const { count, rows } = await Sale.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
            order: [['date', 'DESC']]
        });

        res.json({
            data: rows,
            pagination: {
                totalItems: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({ error: 'Error al obtener ventas: ' + error.message });
    }
});

/**
 * GET /:id - Get sale details
 */
router.get('/:id', async (req, res) => {
    try {
        const sale = await SaleService.getSaleDetails(req.user.companyId, req.params.id, req.user.role);
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
        res.json(sale);
    } catch (error) {
        console.error('Get sale by ID error:', error);
        res.status(500).json({ error: 'Error al obtener la venta' });
    }
});

/**
 * GET /:id/items - Obtiene los items de una venta especifica
 */
router.get('/:id/items', async (req, res) => {
    try {
        const whereClause = {
            saleId: req.params.id,
            companyId: req.user.companyId
        };
        const items = await SaleItem.findAll({ where: whereClause });
        res.json(items);
    } catch (error) {
        console.error('Get sale items error:', error);
        res.status(500).json({ error: 'Error al obtener items de la venta' });
    }
});

/**
 * POST /:id/email - Enviar factura por correo electrónico
 */
router.post('/:id/email', async (req, res) => {
    try {
        const { recipientEmail, recipientName } = req.body;
        
        // Validate email format
        if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
            return res.status(400).json({ error: 'Email del destinatario inválido' });
        }

        // Load sale with items
        const sale = await Sale.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

        // Load business settings
        const { readJson, getUserSettings } = require('../utils/helpers');
        const { SETTINGS_FILE } = require('../config/paths');
        const settings = getUserSettings(readJson(SETTINGS_FILE), req.user.companyId);
        const businessInfo = settings.businessInfo || {};

        // Send email
        const InvoiceEmailService = require('../services/InvoiceEmailService');
        await InvoiceEmailService.sendInvoiceEmail(
            sale.toJSON(),
            sale.SaleItems.map(i => i.toJSON()),
            businessInfo,
            recipientEmail,
            recipientName
        );

        res.json({ success: true, message: 'Factura enviada exitosamente' });
    } catch (error) {
        console.error('Email invoice error:', error);
        res.status(500).json({ error: 'Error al enviar la factura: ' + error.message });
    }
});

/**
 * POST / - Register a new sale
 */
router.post('/', validate(saleSchema), async (req, res) => {
    try {
        const sale = await SaleService.processSale(req.user, req.body);

        // Emit Real-Time Events
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('sale_completed', sale);
            io.to(req.user.companyId).emit('inventory_changed');
        }

        // Safe serialization to prevent BigInt or Circular JSON crashes in SQLite
        let safeSale;
        try {
            safeSale = sale.get ? sale.get({ plain: true }) : sale;
        } catch (e) { safeSale = sale; }

        res.status(201).json(safeSale);
    } catch (error) {
        console.error('Create sale error:', error);
        try {
            const logDir = process.env.USER_DATA_PATH || require('path').join(__dirname, '..', 'logs');
            if (!require('fs').existsSync(logDir)) require('fs').mkdirSync(logDir, { recursive: true });
            require('fs').appendFileSync(require('path').join(logDir, 'zod_error_sales.txt'), `\n[${new Date().toISOString()}] SALE ERROR: ${error.message}\n${error.stack}\n`);
        } catch (e) { }
        const lowerMsg = error.message.toLowerCase();
        const isBusinessError = lowerMsg.includes('crédito') || 
                                lowerMsg.includes('cliente') || 
                                lowerMsg.includes('stock') || 
                                error.message.includes('INTEGRITY_ERROR') || 
                                error.message.includes('AUTH_REQUIRED');
        res.status(isBusinessError ? 400 : 500).json({ error: error.message, message: error.message });
    }
});

/**
 * GET /reports/controlled-meds - Official Controlled Medications Report (Libro Psicotrópicos)
 */
router.get('/reports/controlled-meds', async (req, res) => {
    try {
        const items = await SaleItem.findAll({
            where: {
                [Op.or]: [
                    { es_controlado: true },
                    { recipe: { [Op.ne]: null } }
                ]
            },
            include: [
                { model: Sale, attributes: ['date', 'id', 'customerName', 'userId', 'registerName', 'status'] }
            ],
            order: [['createdAt', 'DESC']],
            limit: 500
        });

        const report = items.map(item => {
            let recipeData = {};
            if (typeof item.recipe === 'string') {
                try { recipeData = JSON.parse(item.recipe); } catch(e) {}
            } else if (item.recipe) {
                recipeData = item.recipe;
            }

            return {
                id: item.id,
                date: item.Sale?.date || item.createdAt,
                saleId: item.saleId,
                productName: item.name,
                quantity: item.quantity,
                batchNumber: item.batchNumber || 'N/A',
                expirationDate: item.expirationDate || 'N/A',
                status: item.Sale?.status || 'completed',
                patientName: recipeData.patientName || item.Sale?.customerName || 'Consumidor Final',
                patientId: recipeData.patientId || 'S/D',
                doctorName: recipeData.doctorName || 'Médico S/D',
                doctorLicense: recipeData.doctorLicense || 'MPPS S/D',
                recipeNumber: recipeData.recipeNumber || 'S/N',
                dispensedBy: item.Sale?.registerName || item.Sale?.userId || 'Cajero'
            };
        });

        res.json(report);
    } catch (error) {
        console.error('Error fetching controlled meds report:', error);
        res.status(500).json({ error: 'Error al obtener el libro de controlados: ' + error.message });
    }
});

module.exports = router;
