const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ServiceOrder, Sale, SaleItem } = require('../database/models');

// Configure storage for service evidence photos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const baseDir = process.env.USER_DATA_PATH || require('os').tmpdir();
    const dir = path.join(baseDir, 'public', 'uploads', 'services');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'SO-' + uniqueSuffix + path.extname(file.originalname || '.jpg'));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit per photo
});

/**
 * GET /api/services
 * List all service orders
 */
router.get('/', async (req, res) => {
  try {
    const orders = await ServiceOrder.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching service orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/services
 * Create a new service order with optional photos
 */
router.post('/', upload.array('evidencia', 4), async (req, res) => {
  try {
    const orderData = JSON.parse(req.body.orderData);
    
    // Process uploaded files to get URLs
    const photoUrls = req.files.map(file => `/uploads/services/${file.filename}`);

    const newOrder = await ServiceOrder.create({
      ...orderData,
      photos: photoUrls,
      status: 'RECEIVED'
    });

    res.status(201).json({ success: true, order: newOrder });
  } catch (error) {
    console.error('Error creating service order:', error);
    res.status(500).json({ error: 'Error procesando la orden de servicio' });
  }
});

/**
 * PATCH /api/services/:id/status
 * Update order status
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const order = await ServiceOrder.findByPk(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.status = status;
    await order.save();

    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: 'Error updating status' });
  }
});

/**
 * POST /api/services/:id/payments
 * Register a payment for a service order
 */
router.post('/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, method, reference } = req.body;
    
    const order = await ServiceOrder.findByPk(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Update order balance
    order.balancePaid = (order.balancePaid || 0) + parseFloat(amount);
    await order.save();

    // In a real system, we'd also create a record in ServiceOrderPayments table
    // For now, we update the main record to maintain the "Single Ledger" goal.

    res.json({ success: true, order });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Error processing payment' });
  }
});


/**
 * POST /api/services/:id/finalize
 * Finalize a service order with ACID transactions and mirroring
 */
router.post('/:id/finalize', async (req, res) => {
  const { sequelize } = require('../database/connection');
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { paymentData, customerName, seller } = req.body;
    
    const order = await ServiceOrder.findByPk(id, { transaction: t });
    if (!order) {
      await t.rollback();
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    // CLÁUSULA DE GUARDA: Evitar cobros dobles si hay fallos de red
    if (order.status === 'DELIVERED') {
      await t.rollback();
      return res.status(400).json({ error: 'Esta orden ya fue entregada y facturada' });
    }

    // 1. Registrar el pago final en la orden de servicio
    order.balancePaid = order.totalAmount; 
    order.status = 'DELIVERED';
    await order.save({ transaction: t });

    // 2. ESPEJO CONTABLE: Crear la Venta en el Libro Mayor
    const newSale = await Sale.create({
      id: `SRV-${order.id.split('-')[0]}-${Date.now().toString().slice(-4)}`,
      date: new Date().toISOString(),
      total: order.totalAmount,
      subtotal: order.totalAmount,
      customerId: order.customerId,
      customerName: customerName || 'Cliente de Servicio',
      paymentMethod: paymentData.payments.map(p => p.methodName).join(' + '),
      paymentMethods: paymentData.payments,
      seller: seller || 'Sistema',
      isService: true,
      serviceOrderId: order.id,
      status: 'completed',
      companyId: order.companyId,
      exchangeRate: paymentData.exchangeRateAtSale || 1
    }, { transaction: t });

    // 3. Crear el ítem de venta
    await SaleItem.create({
      saleId: newSale.id,
      productId: 'SERVICE_ITEM',
      name: `SERVICIO: ${order.assetDescription}`,
      price: order.totalAmount,
      quantity: 1,
      total: order.totalAmount,
      companyId: order.companyId
    }, { transaction: t });

    await t.commit();
    res.json({ success: true, sale: newSale });

  } catch (error) {
    if (t) await t.rollback();
    console.error('Error finalizando servicio:', error);
    res.status(500).json({ error: 'Error en el espejado contable' });
  }
});

module.exports = router;
