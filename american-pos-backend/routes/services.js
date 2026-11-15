const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ServiceOrder, Sale, SaleItem } = require('../database/models');

// Configure storage for service evidence photos
const SERVICE_ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const SERVICE_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const safeExt = SERVICE_ALLOWED_EXTS.has(rawExt) ? rawExt : '.jpg';
    cb(null, 'SO-' + uniqueSuffix + safeExt);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit per photo
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimeOk = SERVICE_ALLOWED_MIMES.has(String(file.mimetype || '').toLowerCase());
    const extOk = !ext || SERVICE_ALLOWED_EXTS.has(ext);
    if (mimeOk && extOk) {
      return cb(null, true);
    }
    const filterErr = new Error('Tipo de archivo no permitido para evidencia de servicio (solo imágenes JPG, PNG, WEBP, GIF).');
    filterErr.statusCode = 400;
    return cb(filterErr);
  }
});

const getServiceTenantScope = (req) => {
  const role = String(req.user?.role || '').toLowerCase();
  const isSuperAdmin = role === 'superadmin';
  const companyId = String(req.user?.companyId || '2');
  return { isSuperAdmin, companyId, whereCompany: isSuperAdmin ? {} : { companyId } };
};

/**
 * GET /api/services
 * List all service orders isolated by tenant
 */
router.get('/', async (req, res) => {
  try {
    const { whereCompany } = getServiceTenantScope(req);
    const orders = await ServiceOrder.findAll({
      where: whereCompany,
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
    let orderData;
    try {
      orderData = typeof req.body.orderData === 'string'
        ? JSON.parse(req.body.orderData)
        : (req.body.orderData || {});
    } catch (_) {
      return res.status(400).json({ error: 'Formato JSON inválido en orderData' });
    }
    const { companyId } = getServiceTenantScope(req);
    const { companyId: _ignoreComp, id: _ignoreId, status: _ignoreStatus, ...safeOrderData } = orderData || {};
    
    // Process uploaded files to get URLs
    const photoUrls = (req.files || []).map(file => `/uploads/services/${file.filename}`);

    const newOrder = await ServiceOrder.create({
      ...safeOrderData,
      companyId,
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
    const allowedStatuses = ['RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'];
    if (!status || !allowedStatuses.includes(String(status))) {
      return res.status(400).json({ error: 'Estado de servicio inválido' });
    }
    const { whereCompany } = getServiceTenantScope(req);
    
    const order = await ServiceOrder.findOne({ where: { id, ...whereCompany } });
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
    const { amount } = req.body;
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Monto de pago inválido' });
    }
    const { whereCompany } = getServiceTenantScope(req);
    
    const order = await ServiceOrder.findOne({ where: { id, ...whereCompany } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Update order balance
    order.balancePaid = Number(((Number(order.balancePaid) || 0) + parsedAmount).toFixed(2));
    await order.save();

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
    const { whereCompany } = getServiceTenantScope(req);
    
    const order = await ServiceOrder.findOne({ where: { id, ...whereCompany }, transaction: t });
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
