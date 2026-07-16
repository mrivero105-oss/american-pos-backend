const express = require('express');
const router = express.Router();
const customerService = require('../services/CustomerService');
const { Sale, CreditHistory } = require('../database/models');
const { customerSchema } = require('../schemas/customerSchema');
const validate = require('../middleware/validate');

/**
 * GET /public-list - Search and list active customers (Protected)
 */
router.get('/public-list', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { Customer } = require('../database/models');
        const customers = await Customer.findAll({
            where: { isActive: true, companyId: req.user.companyId },
            attributes: ['id', 'name', 'phone', 'email', 'address', 'creditBalance', 'creditLimit']
        });
        res.json(customers);
    } catch (error) {
        console.error('Public customers list error:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

/**
 * POST /public-payment - Register a payment (Abono) from mobile (Protected)
 */
router.post('/public-payment', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { payment } = req.body;
        if (!payment || !payment.customerId || !payment.amount) {
            return res.status(400).json({ error: 'Datos de pago incompletos' });
        }

        const result = await customerService.registerPayment(req.user, payment.customerId, {
            amount: payment.amount,
            method: payment.method || 'Efectivo',
            reference: payment.reference || 'Abono desde Móvil',
            date: payment.date || new Date().toISOString()
        });

        res.json({ success: true, result });
    } catch (error) {
        console.error('Payment sync error:', error);
        res.status(500).json({ error: error.message || 'Error al procesar pago' });
    }
});

/**
 * POST /public-sync - Sync local mobile customers to server (Protected)
 */
router.post('/public-sync', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { customers } = req.body;
        if (!Array.isArray(customers)) return res.status(400).json({ error: 'Formato inválido' });

        const { Customer } = require('../database/models');
        for (const custData of customers) {
            let cust;
            // 1. First attempt to match by ID (if it's not a temporary mobile ID)
            if (custData.id && !custData.id.startsWith('CUST-')) {
                cust = await Customer.findOne({ where: { id: custData.id, companyId: req.user.companyId } });
            }
            
            // 2. Fallback to name match (classic sync)
            if (!cust) {
                cust = await Customer.findOne({ where: { name: custData.name, companyId: req.user.companyId } });
            }

            if (cust) {
                // Update authoritative fields from mobile
                await cust.update({ 
                    phone: custData.phone, 
                    email: custData.email,
                    address: custData.address,
                    creditLimit: Number(custData.creditLimit) || 0
                });
            } else {
                // Register as new customer
                await Customer.create({
                    ...custData,
                    id: custData.id && !custData.id.startsWith('CUST-') ? custData.id : `CUST-${Date.now()}`,
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    creditLimit: Number(custData.creditLimit) || 0
                });
            }
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Public customers sync error:', error);
        res.status(500).json({ error: 'Error al sincronizar clientes' });
    }
});

// GET / - Search and list customers
router.get('/', async (req, res) => {
    try {
        const result = await customerService.getAllCustomers(req.user, req.query);
        res.json(result);
    } catch (error) {
        console.error('Error in GET /customers:', error);
        try {
            require('fs').appendFileSync(require('path').join(require('os').homedir(), 'Desktop', 'customer_error.txt'), `\n[${new Date().toISOString()}] SEARCH ERROR: ${error.message}\n${error.stack}\n`);
        } catch(e){}
        res.status(500).json({ error: 'Error al cargar clientes: ' + error.message, stack: error.stack });
    }
});

// GET /:id - Single customer
router.get('/:id', async (req, res) => {
    try {
        const customer = await customerService.getCustomerById(req.params.id, req.user.companyId);
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

// POST / - Create customer
router.post('/', async (req, res) => {
    try {
        const newCustomer = await customerService.createCustomer(req.user, req.body);
        res.status(201).json(newCustomer);
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

// PUT /:id - Update customer
router.put('/:id', async (req, res) => {
    try {
        const updatedCustomer = await customerService.updateCustomer(req.user, req.params.id, req.body);
        if (updatedCustomer) {
            res.json({ message: 'Cliente actualizado', customer: updatedCustomer });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

// DELETE /:id - Delete customer
router.delete('/:id', async (req, res, next) => {
    try {
        const success = await customerService.deleteCustomer(req.user, req.params.id);
        if (success) {
            res.json({ success: true, message: 'Cliente eliminado' });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        next(error);
    }
});

// GET /:id/sales - Customer sales history
router.get('/:id/sales', async (req, res) => {
    try {
        const sales = await Sale.findAll({
            where: { customerId: req.params.id, companyId: req.user.companyId },
            order: [['date', 'DESC']]
        });
        res.json(sales);
    } catch (error) {
        console.error('Get customer sales error:', error);
        res.status(500).json({ error: 'Error al obtener ventas del cliente' });
    }
});

// GET /:id/credit-history - Customer credit history
router.get('/:id/credit-history', async (req, res) => {
    try {
        const customer = await customerService.getCustomerById(req.params.id, req.user.companyId);
        if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

        const history = await CreditHistory.findAll({
            where: { 
                customerId: req.params.id, 
                companyId: { [require('sequelize').Op.or]: [req.user.companyId, null] }
            },
            order: [['timestamp', 'DESC']]
        });

        res.json({
            customer: {
                name: customer.name,
                creditLimit: customer.creditLimit,
                creditBalance: customer.creditBalance
            },
            history: history
        });
    } catch (error) {
        console.error('Get credit history error:', error);
        res.status(500).json({ error: 'Error al obtener historial de crédito' });
    }
});

// POST /:id/payment - Register a payment (Abono)
router.post('/:id/payment', async (req, res) => {
    try {
        const result = await customerService.registerPayment(req.user, req.params.id, req.body);
        res.json(result);
    } catch (error) {
        console.error('Register payment error:', error);
        res.status(error.message === 'Cliente no encontrado' ? 404 : 400).json({ error: error.message });
    }
});
module.exports = router;
