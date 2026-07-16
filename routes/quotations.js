const express = require('express');
const router = express.Router();
const { Quotation, Product, Customer } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

async function sanitizeCustomerId(customerId, companyId, customerName) {
    if (customerId && customerId !== '') {
        const customerExists = await Customer.findOne({
            where: { id: String(customerId), companyId }
        });
        if (!customerExists) {
            if (customerName) {
                const matchedCustomer = await Customer.findOne({
                    where: { name: customerName, companyId }
                });
                if (matchedCustomer) {
                    return matchedCustomer.id;
                }
            }
            return null;
        }
        return String(customerId);
    }
    return null;
}

// GET all quotations
router.get('/', async (req, res) => {
    try {
        const whereClause = { companyId: req.user.companyId };
        
        // Aislar datos si el usuario es un vendedor regular
        if (req.user.role === 'user') {
            whereClause.userId = req.user.id;
        }

        const quotes = await Quotation.findAll({
            where: whereClause,
            order: [['date', 'DESC']]
        });
        res.json(quotes);
    } catch (error) {
        console.error('Get quotations error:', error);
        res.status(500).json({ error: 'Error al obtener cotizaciones' });
    }
});

// GET quotation by ID
router.get('/:id', async (req, res) => {
    try {
        const quote = await Quotation.findOne({
            where: { id: req.params.id, companyId: req.user.companyId }
        });
        if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });
        res.json(quote);
    } catch (error) {
        console.error('Get quotation error:', error);
        res.status(500).json({ error: 'Error al obtener cotización' });
    }
});

// POST Create Quotation
router.post('/', async (req, res) => {
    try {
        const customerId = await sanitizeCustomerId(req.body.customerId, req.user.companyId, req.body.customerName);
        const quoteData = {
            ...req.body,
            id: req.body.id ? String(req.body.id) : generateRobustId(),
            customerId,
            userId: req.user.id,
            companyId: req.user.companyId,
            date: req.body.date || new Date().toISOString(),
            status: req.body.status || 'pending'
        };
        const newQuote = await Quotation.create(quoteData);
        res.status(201).json(newQuote);
    } catch (error) {
        console.error('Create quotation error:', error);
        res.status(500).json({ error: 'Error al crear cotización' });
    }
});

// PUT Update Quotation
router.put('/:id', async (req, res) => {
    try {
        const updateData = { ...req.body };
        if (updateData.customerId !== undefined) {
            updateData.customerId = await sanitizeCustomerId(updateData.customerId, req.user.companyId, updateData.customerName);
        }
        const [updated] = await Quotation.update(updateData, {
            where: { id: req.params.id, companyId: req.user.companyId }
        });
        if (updated) {
            res.json({ message: 'Cotización actualizada' });
        } else {
            res.status(404).json({ message: 'Cotización no encontrada' });
        }
    } catch (error) {
        console.error('Update quotation error:', error);
        res.status(500).json({ error: 'Error al actualizar cotización' });
    }
});

// DELETE Quotation
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await Quotation.destroy({
            where: { id: req.params.id, companyId: req.user.companyId }
        });
        if (deleted) {
            res.json({ message: 'Cotización eliminada' });
        } else {
            res.status(404).json({ message: 'Cotización no encontrada' });
        }
    } catch (error) {
        console.error('Delete quotation error:', error);
        res.status(500).json({ error: 'Error al eliminar cotización' });
    }
});

module.exports = router;
