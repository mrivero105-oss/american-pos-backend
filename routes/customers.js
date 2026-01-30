const express = require('express');
const router = express.Router();
const { Customer, Sale, CreditHistory } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

router.get('/', async (req, res) => {
    try {
        const customers = await Customer.findAll({ where: { userId: req.user.id } });
        res.json(customers);
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const customer = await Customer.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (customer) {
            res.json(customer);
        } else {
            res.status(404).json({ error: 'Cliente no encontrado' });
        }
    } catch (error) {
        console.error('Get customer error:', error);
        res.status(500).json({ error: 'Error al obtener cliente' });
    }
});

router.post('/', async (req, res) => {
    try {
        const newCustomer = await Customer.create({
            id: generateRobustId(),
            userId: req.user.id,
            ...req.body,
            creditBalance: 0
        });
        res.status(201).json(newCustomer);
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const [updated] = await Customer.update(req.body, {
            where: { id: req.params.id, userId: req.user.id }
        });
        if (updated) {
            res.json({ message: 'Cliente actualizado' });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const deleted = await Customer.destroy({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (deleted) {
            res.json({ message: 'Cliente eliminado' });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

router.get('/:id/sales', async (req, res) => {
    try {
        const sales = await Sale.findAll({
            where: { customerId: req.params.id, userId: req.user.id },
            order: [['date', 'DESC']]
        });
        res.json(sales);
    } catch (error) {
        console.error('Get customer sales error:', error);
        res.status(500).json({ error: 'Error al obtener ventas del cliente' });
    }
});

router.get('/:id/credit-history', async (req, res) => {
    try {
        const history = await CreditHistory.findAll({
            where: { customerId: req.params.id, userId: req.user.id },
            order: [['timestamp', 'DESC']]
        });
        res.json(history);
    } catch (error) {
        console.error('Get credit history error:', error);
        res.status(500).json({ error: 'Error al obtener historial de crédito' });
    }
});

module.exports = router;
