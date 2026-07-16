const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Product, Customer, StockMovement, BranchStock } = require('../database/models');
const { sequelize } = require('../database/connection');
const { Op } = require('sequelize');
const { generateRobustId, readJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const precision = require('../utils/precision');

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
        const userSettings = getUserSettings(allSettings, req.user.id);
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

            const product = await Product.findOne({ where: { id: pId }, transaction: t });
            if (product) {
                const itemQty = precision.round(Number(item.quantity) || 0, 3);
                if (activeBranchId) {
                    let branchStock = await BranchStock.findOne({ where: { productId: pId, branchId: activeBranchId }, transaction: t });
                    if (branchStock) {
                        await branchStock.update({ quantity: precision.round(branchStock.quantity - itemQty, 3) }, { transaction: t });
                    } else {
                        await BranchStock.create({ branchId: activeBranchId, productId: pId, quantity: -itemQty }, { transaction: t });
                    }
                } else {
                    const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                    await product.update({ stockQuantity: precision.round(currentStock - itemQty, 3) }, { transaction: t });
                }

                // Kardex
                await StockMovement.create({
                    id: generateRobustId(),
                    productId: pId,
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    type: 'OUT',
                    quantity: precision.round(Number(item.quantity) || 0, 3),
                    reason: activeBranchId ? `Delivery Note (Branch ${activeBranchId})` : 'Delivery Note',
                    referenceId: noteId,
                    date: now
                }, { transaction: t });
            }
        }

        // Relational Items
        if (items && items.length > 0) {
            const itemsToInsert = items.map(item => ({
                saleId: noteId,
                productId: item.productId || item.id,
                name: item.name || 'Producto Desconocido',
                quantity: precision.round(item.quantity || 1, 3),
                price: precision.round(item.price || 0),
                subtotal: precision.round(item.subtotal || ((item.price || 0) * (item.quantity || 1))),
                category: item.category || 'General'
            }));
            await SaleItem.bulkCreate(itemsToInsert, { transaction: t });
        }

        await t.commit();

        const completedNote = await Sale.findOne({
            where: { id: noteId },
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
            transaction: t
        });

        if (!note) {
            await t.rollback();
            return res.status(404).json({ error: 'Albarán no encontrado' });
        }

        // Update document type and status
        // We don't deduct stock again because it was already deducted when creating the albarán
        await note.update({
            documentType: 'factura',
            status: 'completed',
            updatedAt: new Date().toISOString()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Albarán convertido en factura exitosamente', id: note.id });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Convert delivery note error:', error);
        res.status(500).json({ error: 'Error al convertir albarán: ' + error.message });
    }
});

// DELETE Cancel Delivery Note (Reverts Stock)
router.delete('/:id', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const note = await Sale.findOne({
            where: {
                id: req.params.id,
                companyId: req.user.companyId,
                documentType: 'nota_entrega'
            },
            include: [{ model: SaleItem, as: 'SaleItems' }],
            transaction: t
        });

        if (!note) {
            await t.rollback();
            return res.status(404).json({ error: 'Albarán no encontrado' });
        }

        const activeBranchId = req.user.activeBranchId;

        // Revert Stock
        for (const item of note.SaleItems) {
            const pId = item.productId;
            const qty = item.quantity;

            if (activeBranchId) {
                let branchStock = await BranchStock.findOne({ where: { productId: pId, branchId: activeBranchId }, transaction: t });
                if (branchStock) {
                    await branchStock.update({ quantity: branchStock.quantity + Number(qty) }, { transaction: t });
                }
            } else {
                const product = await Product.findOne({ where: { id: pId }, transaction: t });
                if (product) {
                    const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                    await product.update({ stockQuantity: currentStock + Number(qty) }, { transaction: t });
                }
            }

            // Kardex Movement for cancellation
            await StockMovement.create({
                id: generateRobustId(),
                productId: pId,
                userId: req.user.id,
                companyId: req.user.companyId,
                type: 'IN',
                quantity: Number(qty),
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
