const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Product, Customer, StockMovement, BranchStock, CashShift, CashMovement, CreditHistory } = require('../database/models');
const { sequelize } = require('../database/connection');
const { Op } = require('sequelize');
const { generateRobustId, readJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const precision = require('../utils/precision');
const AccountingEngineService = require('../services/AccountingEngineService');
const { requirePermission } = require('../middleware/auth');

router.use(requirePermission(['canViewSalesHistory', 'canAccessPOS']));

// GET all delivery notes (Albaranes)
router.get('/', async (req, res) => {
    try {
        const whereClause = {
            companyId: req.user.companyId,
            documentType: 'nota_entrega',
            status: { [Op.ne]: 'cancelled' }
        };

        if (req.user.role === 'user') {
            whereClause.userId = req.user.id;
        }

        const deliveryNotes = await Sale.findAll({
            where: whereClause,
            order: [['date', 'DESC']],
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });
        res.json(deliveryNotes);
    } catch (error) {
        console.error('Get delivery notes error:', error);
        res.status(500).json({ error: 'Error al obtener albaranes: ' + error.message });
    }
});

// GET delivery note by ID
router.get('/:id', async (req, res) => {
    try {
        const note = await Sale.findOne({
            where: {
                id: req.params.id,
                companyId: req.user.companyId,
                documentType: 'nota_entrega'
            },
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });

        if (!note) {
            return res.status(404).json({ error: 'Albarán no encontrado' });
        }

        res.json(note);
    } catch (error) {
        console.error('Get delivery note by ID error:', error);
        res.status(500).json({ error: 'Error al obtener el albarán: ' + error.message });
    }
});

// POST Create Delivery Note (Albarán)
// Similar to sale, but documentType is fixed to 'nota_entrega'
router.post('/', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { total, items } = req.body;
        const noteId = generateRobustId();
        const now = new Date().toISOString();

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.companyId);
        const currentExchangeRate = userSettings.exchangeRate || 1.0;

        const noteData = {
            ...req.body,
            id: noteId,
            userId: req.user.id,
            companyId: req.user.companyId,
            date: now,
            timestamp: now,
            createdAt: now,
            updatedAt: now,
            customerName: req.body.customerName || (req.body.customer ? req.body.customer.name : 'Cliente Ocasional'),
            exchangeRate: currentExchangeRate,
            documentType: 'nota_entrega',
            status: 'pending',
            total: precision.round(total),
            subtotal: precision.round(req.body.subtotal || total),
            tax: precision.round(req.body.tax || 0)
        };

        // Sanitize
        const { data: sanitizedArray } = await require('../utils/helpers').sanitizeForModel(Sale, [noteData], t);
        const finalNoteData = sanitizedArray[0];
        if (finalNoteData.items) delete finalNoteData.items;

        const newNote = await Sale.create(finalNoteData, { transaction: t });
        const activeBranchId = req.user.activeBranchId;

        // Stock Deduction (An albarán confirms delivery, so it SHOULD deduct stock)
        for (const item of items) {
            const pId = item.productId || item.id;
            if (!pId) continue;

            const product = await Product.findOne({ where: { id: pId, companyId: req.user.companyId }, transaction: t });
            if (product) {
                const factor = Number(item.factorConversion) > 0 ? Number(item.factorConversion) : 1;
                const itemQty = precision.round((Number(item.quantity) || 0) * factor, 6);
                // Descontar inventario global del producto
                const currentProdStock = Number(product.stockQuantity || product.stock || 0);
                const newProdStock = precision.round(precision.subtract(currentProdStock, itemQty), 6);
                await product.update({ stockQuantity: String(newProdStock), stock: newProdStock }, { transaction: t });

                // Descontar inventario específico de sucursal
                if (activeBranchId) {
                    let [branchStock] = await BranchStock.findOrCreate({
                        where: { productId: pId, branchId: activeBranchId, companyId: req.user.companyId },
                        defaults: { quantity: 0 },
                        transaction: t
                    });
                    const currentBranchStock = Number(branchStock.quantity) || 0;
                    await branchStock.update({ quantity: precision.round(precision.subtract(currentBranchStock, itemQty), 6) }, { transaction: t });
                }

                // Kardex
                await StockMovement.create({
                    id: generateRobustId(),
                    productId: pId,
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    type: 'OUT',
                    quantity: itemQty,
                    reason: activeBranchId ? `Delivery Note (Branch ${activeBranchId})` : 'Delivery Note',
                    referenceId: noteId,
                    date: now
                }, { transaction: t });
            }
        }

        //Relational Items
        if (items && items.length > 0) {
            const itemsToInsert = items.map(item => {
                const factor = Number(item.factorConversion) > 0 ? Number(item.factorConversion) : 1;
                const itemQty = precision.round((Number(item.quantity) || 1) * factor, 6);
                const itemPrice = precision.round((Number(item.price) || 0) / factor, 4);
                const itemSub = precision.round(Number(item.subtotal) || precision.multiply(Number(item.price) || 0, Number(item.quantity) || 1), 2);
                return {
                    saleId: noteId,
                    productId: item.productId || item.id,
                    companyId: req.user.companyId,
                    name: item.name || 'Producto Desconocido',
                    quantity: itemQty,
                    price: itemPrice,
                    subtotal: itemSub,
                    category: item.category || 'General'
                };
            });
            await SaleItem.bulkCreate(itemsToInsert, { transaction: t });
        }

        await t.commit();

        const completedNote = await Sale.findOne({
            where: { id: noteId, companyId: req.user.companyId },
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });

        res.status(201).json(completedNote);
    } catch (error) {
        if (t) await t.rollback();
        console.error('Create delivery note error:', error);
        res.status(500).json({ error: 'Error al registrar albarán: ' + error.message });
    }
});

// PUT Convert Albarán to Factura
router.put('/:id/convert', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const note = await Sale.findOne({
            where: {
                id: req.params.id,
                companyId: req.user.companyId,
                documentType: 'nota_entrega'
            },
            include: [{ model: SaleItem, as: 'SaleItems' }],
            transaction: t,
            lock: t.LOCK ? t.LOCK.UPDATE : undefined
        });

        if (!note) {
            await t.rollback();
            return res.status(404).json({ error: 'Albarán no encontrado' });
        }

        const nowIso = new Date().toISOString();
        const paymentMethod = String(req.body?.paymentMethod || note.paymentMethod || 'cash').toLowerCase();
        const isCreditSale = paymentMethod === 'fiado' || paymentMethod === 'credito' || paymentMethod === 'credit' || note.paymentStatus === 'pending';

        // Update document type and status
        await note.update({
            documentType: 'factura',
            status: 'completed',
            paymentMethod: req.body?.paymentMethod || note.paymentMethod || 'cash',
            paymentStatus: isCreditSale ? 'pending' : 'paid',
            updatedAt: nowIso
        }, { transaction: t });

        const noteTotal = precision.round(Number(note.total) || 0, 2);

        // Si se factura a crédito, registrar cuenta por cobrar (CxC) al cliente
        if (isCreditSale && note.customerId && Customer) {
            const customer = await Customer.findOne({
                where: { id: note.customerId, companyId: req.user.companyId },
                transaction: t,
                lock: t.LOCK ? t.LOCK.UPDATE : undefined
            });
            if (customer) {
                const nextDebt = precision.round((Number(customer.creditBalance) || 0) + noteTotal, 2);
                await customer.update({ creditBalance: nextDebt }, { transaction: t });
                if (CreditHistory) {
                    await CreditHistory.create({
                        id: generateRobustId(),
                        customerId: customer.id,
                        saleId: note.id,
                        amount: noteTotal,
                        type: 'debt',
                        date: nowIso,
                        notes: `Conversión de Albarán #${note.id.slice(0, 8)} a Factura`,
                        companyId: req.user.companyId
                    }, { transaction: t });
                }
            }
        } else if (!isCreditSale && CashShift && CashMovement) {
            // Si se cobra de contado y hay un turno de caja abierto, registrar ingreso en caja
            const openShift = await CashShift.findOne({
                where: { companyId: req.user.companyId, status: 'open' },
                order: [['openedAt', 'DESC']],
                transaction: t
            });
            if (openShift) {
                const isVesMethod = ['efectivo_bs', 'pago_movil', 'punto_venta', 'biopago', 'transferencia'].includes(paymentMethod);
                await CashMovement.create({
                    id: generateRobustId(),
                    shiftId: openShift.id,
                    type: 'in',
                    amount: noteTotal,
                    currency: isVesMethod ? 'VES' : 'USD',
                    paymentMethod,
                    reason: `Cobro por conversión de Albarán #${note.id.slice(0, 8)} a Factura`,
                    date: nowIso,
                    userId: req.user.id,
                    companyId: req.user.companyId
                }, { transaction: t });
            }
        }

        await t.commit();

        // Disparar asiento contable NIIF de forma asíncrona tras el commit
        setImmediate(async () => {
            try {
                if (AccountingEngineService && typeof AccountingEngineService.generateSaleEntry === 'function') {
                    await AccountingEngineService.generateSaleEntry(note.toJSON(), req.user.companyId);
                }
            } catch (accErr) {
                console.warn('[DeliveryNotes] Advertencia al generar asiento contable al convertir albarán:', accErr.message);
            }
        });

        res.json({ message: 'Albarán convertido en factura exitosamente', id: note.id });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Convert delivery note error:', error);
        res.status(500).json({ error: 'Error al convertir albarán: ' + error.message });
    }
});

// DELETE Cancel Delivery Note (Reverts Stock)
router.delete('/:id', requirePermission('canVoidSales'), async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const note = await Sale.findOne({
            where: {
                id: req.params.id,
                companyId: req.user.companyId,
                documentType: 'nota_entrega'
            },
            lock: t.LOCK.UPDATE,
            transaction: t
        });

        if (!note) {
            await t.rollback();
            return res.status(404).json({ error: 'Albarán no encontrado' });
        }

        if (note.status === 'cancelled' || note.status === 'invoiced') {
            await t.rollback();
            return res.status(400).json({ error: `El albarán ya se encuentra en estado "${note.status}" y no puede anularse nuevamente.` });
        }

        const noteItems = await SaleItem.findAll({
            where: { saleId: note.id },
            transaction: t
        });

        const activeBranchId = note.branchId || req.user.activeBranchId;

        // Revert Stock
        for (const item of noteItems) {
            const pId = item.productId;
            const product = await Product.findOne({ where: { id: pId, companyId: req.user.companyId }, lock: t.LOCK.UPDATE, transaction: t });
            const factor = Number(item.factorConversion) > 0
                ? Number(item.factorConversion)
                : (item.isBulk ? (Number(product?.unitsPerBulk) || 1) : (item.isMidBulk ? (Number(product?.unitsPerMidBulk) || 1) : 1));
            const unitsToRestore = precision.round(precision.multiply(Number(item.quantity) || 0, factor), 6);

            const currentProdStock = Number(product?.stockQuantity || product?.stock || 0);
            const newProdStock = precision.round(precision.add([currentProdStock, unitsToRestore]), 6);
            if (product) {
                await product.update({ stockQuantity: String(newProdStock), stock: newProdStock }, { transaction: t });
            }

            if (activeBranchId) {
                let branchStock = await BranchStock.findOne({ where: { productId: pId, branchId: activeBranchId, companyId: req.user.companyId }, lock: t.LOCK.UPDATE, transaction: t });
                if (branchStock) {
                    const currentBsStock = Number(branchStock.quantity) || 0;
                    await branchStock.update({ quantity: precision.round(precision.add([currentBsStock, unitsToRestore]), 6) }, { transaction: t });
                }
            }

            // Kardex Movement for cancellation
            await StockMovement.create({
                id: generateRobustId(),
                productId: pId,
                userId: req.user.id,
                companyId: req.user.companyId,
                type: 'IN',
                quantity: unitsToRestore,
                stockBefore: String(currentProdStock),
                stockAfter: String(newProdStock),
                reason: 'Albarán Cancelado',
                referenceId: note.id,
                date: new Date().toISOString()
            }, { transaction: t });
        }

        // We use status 'cancelled' instead of deleting to keep track
        await note.update({ status: 'cancelled', updatedAt: new Date().toISOString() }, { transaction: t });

        await t.commit();
        res.json({ message: 'Albarán cancelado y stock revertido' });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Delete delivery note error:', error);
        res.status(500).json({ error: 'Error al cancelar albarán: ' + error.message });
    }
});

module.exports = router;
