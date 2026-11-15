const express = require('express');
const router = express.Router();
const customerService = require('../services/CustomerService');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const { Sale, CreditHistory } = require('../database/models');
const { customerSchema } = require('../schemas/customerSchema');
const validate = require('../middleware/validate');
const { isAdmin, requirePermission } = require('../middleware/auth');

const emitCustomersChanged = (req, payload = {}) => {
    try {
        const io = req.app?.get('io');
        if (io) {
            const companyId = String(req.user?.companyId || '2');
            const eventData = { companyId, timestamp: Date.now(), ...payload };
            io.to(companyId).emit('customers_changed', eventData);
        }
    } catch (emitErr) {
        console.warn('[Customers] Error emitiendo evento Socket.IO customers_changed:', emitErr.message);
    }
};

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

        emitCustomersChanged(req, { action: 'payment', customerId: payment.customerId });
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
        const syncedCustomers = [];
        const idMap = {};

        for (const custData of customers) {
            const rawId = String(custData.id || '');
            const isTempId = !rawId || rawId.startsWith('CUST-') || rawId.startsWith('cust_off_');
            let cust = null;

            // 1. First attempt to match by ID (if it's not a temporary mobile ID)
            if (!isTempId) {
                cust = await Customer.findOne({ where: { id: rawId, companyId: req.user.companyId } });
            }

            // 2. Fallback to idDocument match (if non-default document is provided)
            const cleanDoc = String(custData.idDocument || custData.identification || '').trim();
            if (!cust && cleanDoc && !/^([VEJPG]-?)?0+$/i.test(cleanDoc)) {
                cust = await Customer.findOne({ where: { idDocument: cleanDoc, companyId: req.user.companyId } });
            }

            // 3. Fallback to name match (classic sync)
            if (!cust && custData.name) {
                cust = await Customer.findOne({ where: { name: custData.name, companyId: req.user.companyId } });
            }

            if (cust) {
                // Update authoritative fields from mobile
                await cust.update({ 
                    phone: custData.phone || cust.phone, 
                    email: custData.email || cust.email,
                    address: custData.address || cust.address,
                    idDocument: cleanDoc || cust.idDocument,
                    creditLimit: custData.creditLimit !== undefined ? (Number(custData.creditLimit) || 0) : cust.creditLimit
                });
            } else {
                // Register as new customer
                const finalId = !isTempId ? rawId : `CUST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                cust = await Customer.create({
                    ...custData,
                    id: finalId,
                    idDocument: cleanDoc || custData.idDocument || 'V-00000000',
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    creditLimit: Number(custData.creditLimit) || 0
                });
            }

            const plainCust = cust.get ? cust.get({ plain: true }) : cust;
            syncedCustomers.push(plainCust);
            if (rawId) {
                idMap[rawId] = plainCust.id;
            }
        }

        if (syncedCustomers.length > 0) {
            emitCustomersChanged(req, { action: 'public-sync', count: syncedCustomers.length });
        }

        res.json({ success: true, customers: syncedCustomers, idMap });
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

// GET /export - Export customer database to CSV
router.get('/export', requirePermission(['canManageCustomers', 'canViewReports']), async (req, res) => {
    try {
        const { Customer } = require('../database/models');
        const customers = await Customer.findAll({
            where: { companyId: req.user.companyId },
            order: [['name', 'ASC']],
            raw: true
        });

        const BOM = '\ufeff';
        const SEP = ';';
        let csv = BOM + `Nombre${SEP}Documento / RIF${SEP}Telefono${SEP}Email${SEP}Direccion${SEP}Limite Credito ($)${SEP}Deuda Pendiente ($)${SEP}Puntos${SEP}Estado${SEP}Es VIP\n`;

        customers.forEach(c => {
            const name = (c.name || '').replace(/"/g, '""');
            const doc = (c.idDocument || '---').replace(/"/g, '""');
            const phone = (c.phone || '').replace(/"/g, '""');
            const email = (c.email || '').replace(/"/g, '""');
            const address = (c.address || '').replace(/"/g, '""');
            const limit = Number(c.creditLimit || 0).toFixed(2);
            const balance = Number(c.creditBalance || 0).toFixed(2);
            const points = Number(c.loyaltyPoints || 0).toFixed(2);
            const status = c.isActive !== false ? 'ACTIVO' : 'INACTIVO';
            const isVIP = c.isVIP ? 'SI' : 'NO';

            csv += `"${name}"${SEP}"${doc}"${SEP}"${phone}"${SEP}"${email}"${SEP}"${address}"${SEP}${limit}${SEP}${balance}${SEP}${points}${SEP}${status}${SEP}${isVIP}\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=clientes_${new Date().toISOString().slice(0, 10)}.csv`);
        res.status(200).send(csv);
    } catch (error) {
        console.error('Export customers error:', error);
        res.status(500).json({ error: 'Error al exportar clientes' });
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
        emitCustomersChanged(req, { action: 'created', customer: newCustomer });
        SupabaseSyncService.queueCustomer(newCustomer).catch(() => {});
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
            emitCustomersChanged(req, { action: 'updated', customer: updatedCustomer });
            SupabaseSyncService.queueCustomer(updatedCustomer).catch(() => {});
            res.json({ message: 'Cliente actualizado', customer: updatedCustomer });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

// DELETE /:id - Delete customer (Admin only)
router.delete('/:id', isAdmin, async (req, res) => {
    try {
        const success = await customerService.deleteCustomer(req.user, req.params.id);
        if (success) {
            emitCustomersChanged(req, { action: 'deleted', customerId: req.params.id });
            res.json({ success: true, message: 'Cliente eliminado' });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        if (error.code === 'ENTITY_HAS_DEPENDENCIES' || error.status === 409) {
            return res.status(409).json({ 
                error: error.message, 
                code: 'ENTITY_HAS_DEPENDENCIES',
                message: error.message 
            });
        }
        res.status(400).json({ error: error.message || 'Error al eliminar cliente' });
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
        emitCustomersChanged(req, { action: 'payment', customerId: req.params.id });
        res.json(result);
    } catch (error) {
        console.error('Register payment error:', error);
        res.status(error.message === 'Cliente no encontrado' ? 404 : 400).json({ error: error.message });
    }
});

// GET /:id/profile360 - Customer 360 Analytics Profile
router.get('/:id/profile360', async (req, res) => {
    try {
        const profile = await customerService.getCustomerProfile360(req.user, req.params.id);
        res.json(profile);
    } catch (error) {
        console.error('Customer 360 error:', error);
        res.status(error.message === 'Cliente no encontrado' ? 404 : 500).json({ error: error.message || 'Error al obtener perfil 360' });
    }
});

// POST /:id/redeem-points - Redeem Loyalty Points
router.post('/:id/redeem-points', async (req, res) => {
    try {
        const result = await customerService.redeemLoyaltyPoints(req.user, req.params.id, req.body);
        emitCustomersChanged(req, { action: 'redeem-points', customerId: req.params.id });
        res.json(result);
    } catch (error) {
        console.error('Redeem points error:', error);
        res.status(400).json({ error: error.message || 'Error al canjear puntos' });
    }
});

// POST /import - Bulk Import Customers
router.post('/import', requirePermission('canManageCustomers'), async (req, res) => {
    try {
        const { customers } = req.body;
        const result = await customerService.importCustomersBulk(req.user, customers);
        emitCustomersChanged(req, { action: 'import' });
        res.json(result);
    } catch (error) {
        console.error('Bulk import error:', error);
        res.status(400).json({ error: error.message || 'Error en importación masiva de clientes' });
    }
});

// GET /:id/statement - Customer Account Statement Data
router.get('/:id/statement', async (req, res) => {
    try {
        const statement = await customerService.getCustomerStatement(req.user, req.params.id);
        res.json(statement);
    } catch (error) {
        console.error('Customer statement error:', error);
        res.status(error.message === 'Cliente no encontrado' ? 404 : 500).json({ error: error.message || 'Error al obtener estado de cuenta' });
    }
});

module.exports = router;
