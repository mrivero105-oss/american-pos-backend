const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { PurchaseOrder, Product, StockMovement, BranchStock, Supplier, ProductPresentation } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { verifyToken, isSuperAdmin, isAdmin, requirePermission } = require('../middleware/auth');
const InvoiceService = require('../services/InvoiceService');
const ScannerService = require('../services/ScannerService');
const PDFService = require('../services/PDFService');
const ProductService = require('../services/ProductService');
const VortexMathEngine = require('../utils/VortexMathEngine');
const precision = require('../utils/precision');

router.use(requirePermission(['canManagePurchases', 'canManageSuppliers']));

// Multer setup for invoice uploads
const invoiceUpload = multer({
    dest: path.join(os.tmpdir(), 'isaac_pos_inv_uploads'),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext) || file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato no válido. Solo se admiten archivos PDF o imágenes (JPG, PNG, WEBP).'));
        }
    }
});

router.get('/', async (req, res) => {
    try {
        const { page, limit } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;
        const offset = (pageNum - 1) * limitNum;

        const totalItems = await PurchaseOrder.count({ where: { companyId: req.user.companyId } });
        const totalPages = Math.ceil(totalItems / limitNum);

        const orders = await PurchaseOrder.findAll({
            where: { companyId: req.user.companyId },
            limit: limitNum,
            offset: offset,
            order: [['createdAt', 'DESC']]
        });

        if (page) {
            return res.json({
                data: orders,
                pagination: {
                    totalItems,
                    totalPages,
                    currentPage: pageNum,
                    limit: limitNum
                }
            });
        } else {
            return res.json(orders);
        }
    } catch (error) {
        console.error('Get purchase orders error:', error);
        res.status(500).json({ error: 'Error al obtener órdenes de compra' });
    }
});

// Logic for receiving an order (updating stock, costs, audit, and supplier balance)
async function processOrderReception(orderId, userId, activeBranchId, t, companyId = null, receptionPayload = null) {
    const whereOrder = { id: orderId };
    if (companyId) whereOrder.companyId = companyId;

    const order = await PurchaseOrder.findOne({
        where: whereOrder,
        transaction: t
    });

    if (!order || (order.status !== 'pending' && order.status !== 'received')) {
        throw new Error('Orden no encontrada o cancelada');
    }

    const isAlreadyReceived = order.status === 'received';
    const finalCompanyId = order.companyId || companyId || 'default';
    const originalItems = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : (order.items || []);
    
    // Si viene una lista detallada de recepción enviada por el usuario desde el modal
    const itemsToProcess = Array.isArray(receptionPayload?.receivedItems) && receptionPayload.receivedItems.length > 0
        ? receptionPayload.receivedItems
        : originalItems;

    let computedTotal = 0;
    const finalStoredItems = [];

    for (const item of itemsToProcess) {
        const isReceived = item.isReceived !== undefined ? item.isReceived : true;
        const qtyToReceive = isReceived ? Number(item.receivedQuantity !== undefined ? item.receivedQuantity : (item.quantity || 0)) : 0;
        const unitCost = Number(item.cost !== undefined ? item.cost : (item.unitPrice || 0));
        const itemTotal = precision.round(qtyToReceive * unitCost, 2);
        
        if (isReceived && qtyToReceive > 0) {
            computedTotal = precision.round(computedTotal + itemTotal, 2);
        }

        // Buscar si ya se había recibido una cantidad previamente en este albarán
        const prevItem = originalItems.find(p => String(p.productId) === String(item.productId));
        const prevReceivedQty = isAlreadyReceived && prevItem ? Number(prevItem.receivedQuantity !== undefined ? prevItem.receivedQuantity : (prevItem.quantity || 0)) : 0;
        const deltaQty = isAlreadyReceived ? (qtyToReceive - prevReceivedQty) : qtyToReceive;

        const product = await Product.findOne({
            where: { id: item.productId, companyId: finalCompanyId },
            transaction: t
        });

        if (product) {
            // Verificar si el ítem de la orden vino expresado en una presentación
            let itemPresentation = null;
            if (item.presentationId) {
                itemPresentation = await ProductPresentation.findOne({
                    where: { id: item.presentationId, productId: product.id },
                    transaction: t
                });
            }
            if (!itemPresentation && item.isDefaultPurchase) {
                itemPresentation = await ProductPresentation.findOne({
                    where: { productId: product.id, isDefaultPurchase: true },
                    transaction: t
                });
            }

            // Factor de conversión si vino en presentación
            const hasPresentationPurchase = Boolean(itemPresentation || (item.factorConversion && Number(item.factorConversion) > 1 && item.isPresentation));
            const factorConversion = itemPresentation 
                ? Number(itemPresentation.factorConversion) 
                : (hasPresentationPurchase ? Number(item.factorConversion) : 1);

            // Multiplicar por factorConversion ÚNICAMENTE si vino en presentación (no si ya venía en unidades base)
            const effectiveDeltaQty = hasPresentationPurchase 
                ? precision.round(deltaQty * factorConversion, 6) 
                : deltaQty;

            // Determinar el costo base unitario (si vino en empaque, dividir entre el factor)
            const baseCost = hasPresentationPurchase && factorConversion > 1 && unitCost > 0
                ? precision.round(unitCost / factorConversion, 4)
                : unitCost;

            const currentProdStock = Number(product.stockQuantity || product.stock || 0);
            const newProdStock = effectiveDeltaQty !== 0 
                ? precision.round(precision.add([currentProdStock, effectiveDeltaQty]), 6)
                : currentProdStock;
            
            const updateFields = {};
            if (effectiveDeltaQty !== 0) {
                updateFields.stockQuantity = String(newProdStock);
                updateFields.stock = newProdStock;
            }

            // Actualizar régimen de IVA según la factura física o selección del usuario
            if (item.taxStatus) {
                updateFields.taxStatus = item.taxStatus;
            } else if (item.isExempt !== undefined) {
                updateFields.taxStatus = item.isExempt ? 'exento' : 'gravable';
            }

            // Actualizar costo si es > 0
            if (baseCost > 0) {
                updateFields.cost = baseCost;
            }

            // Actualizar precio de venta y margen en el inventario si fueron provistos
            if (item.price && Number(item.price) > 0) {
                updateFields.price = Number(item.price);
            }
            // Actualizar empaque y costo al mayor si fueron provistos
            if (item.unitsPerBulk && Number(item.unitsPerBulk) > 0) {
                updateFields.unitsPerBulk = Number(item.unitsPerBulk);
            }
            if (item.bulkUnitName) {
                updateFields.bulkUnitName = item.bulkUnitName;
            }
            const effUnitsPerBulk = Number(item.unitsPerBulk || product.unitsPerBulk || 1);
            if (item.bulkCost && Number(item.bulkCost) > 0) {
                updateFields.bulkCost = Number(item.bulkCost);
            } else if (baseCost > 0 && effUnitsPerBulk > 1) {
                updateFields.bulkCost = precision.round(baseCost * effUnitsPerBulk, 2);
            }
            const effUnitsPerMid = Number(product.unitsPerMidBulk || 0);
            if (baseCost > 0 && effUnitsPerMid > 0) {
                updateFields.midBulkCost = precision.round(baseCost * effUnitsPerMid, 2);
            }

            if (Object.keys(updateFields).length > 0) {
                await product.update(updateFields, { transaction: t });
            }

            // ACTUALIZACIÓN EN CASCADA DE PRESENTACIONES DINÁMICAS (ProductPresentation)
            if (baseCost > 0) {
                const presentations = await ProductPresentation.findAll({
                    where: { productId: product.id },
                    transaction: t
                });
                for (const pres of presentations) {
                    const presFactor = Number(pres.factorConversion) || 1;
                    const presNewCost = precision.round(baseCost * presFactor, 4);
                    const presUpdates = { cost: presNewCost };

                    // Si la presentación tiene margen configurado, actualizar precio usando Markup (cost * (1 + margin / 100))
                    if (pres.marginTarget !== null && pres.marginTarget !== undefined && !isNaN(Number(pres.marginTarget))) {
                        const mTarget = Number(pres.marginTarget);
                        if (mTarget > 0) {
                            presUpdates.price = precision.round(presNewCost * (1 + mTarget / 100), 2);
                        }
                    }
                    await pres.update(presUpdates, { transaction: t });
                }
            }

            // Actualizar stock de la sucursal si aplica y hubo cambio
            if (activeBranchId && effectiveDeltaQty !== 0) {
                let [branchStock] = await BranchStock.findOrCreate({
                    where: { productId: item.productId, branchId: activeBranchId, companyId: finalCompanyId },
                    defaults: { quantity: 0 },
                    transaction: t
                });
                const currentBranchStock = Number(branchStock.quantity) || 0;
                const newBranchStock = precision.round(precision.add([currentBranchStock, effectiveDeltaQty]), 6);
                await branchStock.update({ 
                    quantity: newBranchStock 
                }, { transaction: t });
            }

            // Registrar movimiento de inventario en Kardex si hubo variación
            if (effectiveDeltaQty !== 0) {
                await StockMovement.create({
                    id: generateRobustId(),
                    productId: item.productId,
                    userId: userId,
                    companyId: finalCompanyId,
                    type: effectiveDeltaQty > 0 ? 'IN' : 'OUT',
                    quantity: Math.abs(effectiveDeltaQty),
                    stockBefore: String(currentProdStock),
                    stockAfter: String(newProdStock),
                    reason: isAlreadyReceived 
                        ? `Corrección Albarán #${order.referenceNumber || order.id}` 
                        : (activeBranchId ? `Recepción Albarán #${order.referenceNumber || order.id} (Sucursal ${activeBranchId})` : `Recepción Albarán #${order.referenceNumber || order.id}`),
                    referenceId: order.id,
                    date: new Date().toISOString()
                }, { transaction: t });
            }
        }

        finalStoredItems.push({
            productId: item.productId,
            name: item.name || product?.name || 'Producto',
            barcode: item.barcode || product?.barcode || '',
            quantityOrdered: Number(item.quantityOrdered || item.quantity || (prevItem ? prevItem.quantityOrdered : 0) || 0),
            quantity: Number(item.quantityOrdered || item.quantity || (prevItem ? prevItem.quantity : 0) || 0),
            receivedQuantity: qtyToReceive,
            isReceived: isReceived,
            presentationId: item.presentationId || prevItem?.presentationId || null,
            isPresentation: Boolean(item.isPresentation || prevItem?.isPresentation || item.presentationId),
            factorConversion: Number(item.factorConversion || prevItem?.factorConversion || 1),
            cost: unitCost,
            price: Number(item.price || product?.price || 0),
            margin: Number(item.margin || product?.margin || 0),
            total: itemTotal
        });
    }

    const effectiveTotal = computedTotal > 0 ? computedTotal : Number(order.total || 0);
    const targetPaymentStatus = receptionPayload?.paymentStatus || order.paymentStatus || 'unpaid';

    const orderUpdates = {
        status: 'received',
        receivedAt: order.receivedAt || new Date().toISOString(),
        items: JSON.stringify(finalStoredItems),
        total: effectiveTotal,
        paymentStatus: targetPaymentStatus
    };

    if (receptionPayload?.referenceNumber !== undefined) orderUpdates.referenceNumber = receptionPayload.referenceNumber;
    if (receptionPayload?.invoiceUrl !== undefined) orderUpdates.invoiceUrl = receptionPayload.invoiceUrl;
    if (receptionPayload?.notes !== undefined) orderUpdates.notes = receptionPayload.notes;

    const oldTotal = Number(order.total || 0);
    const deltaTotal = effectiveTotal - oldTotal;

    await order.update(orderUpdates, { transaction: t });

    // Audit Log
    const { AuditLog } = require('../database/models');
    await AuditLog.create({
        id: generateRobustId(),
        userId: userId,
        companyId: finalCompanyId,
        action: isAlreadyReceived ? 'PURCHASE_UPDATE' : 'PURCHASE_RECEIVE',
        description: isAlreadyReceived 
            ? `Corregida/Actualizada recepción albarán #${order.id}. Ref: ${orderUpdates.referenceNumber || order.referenceNumber || 'N/A'}. Total: $${effectiveTotal}`
            : `Recibida orden/albarán #${order.id}. Ref: ${orderUpdates.referenceNumber || order.referenceNumber || 'N/A'}. Total: $${effectiveTotal}`,
        timestamp: new Date().toISOString()
    }, { transaction: t });

    // Actualizar balance de crédito con el proveedor si aplica
    const effectivePaymentMethod = receptionPayload?.paymentMethod || order.paymentMethod;
    if (effectivePaymentMethod === 'credit' || targetPaymentStatus === 'unpaid') {
        const supplier = await require('../database/models').Supplier.findOne({ 
            where: { id: order.supplierId, companyId: finalCompanyId }, 
            transaction: t 
        });
        if (supplier) {
            const amountToAdjust = isAlreadyReceived ? deltaTotal : effectiveTotal;
            if (amountToAdjust !== 0) {
                const newBalance = VortexMathEngine.add(supplier.creditBalance || 0, amountToAdjust);
                await supplier.update({ creditBalance: newBalance }, { transaction: t });

                await require('../database/models').SupplierCreditHistory.create({
                    id: generateRobustId(),
                    supplierId: order.supplierId,
                    userId: userId,
                    companyId: finalCompanyId,
                    timestamp: new Date().toISOString(),
                    type: amountToAdjust > 0 ? 'charge' : 'adjustment',
                    amount: Math.abs(amountToAdjust),
                    balanceAfter: newBalance,
                    description: isAlreadyReceived 
                        ? `Ajuste/Corrección Albarán #${orderUpdates.referenceNumber || order.referenceNumber || order.id}`
                        : `Recepción Albarán #${orderUpdates.referenceNumber || order.referenceNumber || order.id}`,
                    purchaseOrderId: order.id
                }, { transaction: t });
            }
        }
    } else {
        // Pago contado deducido de turno de caja abierto (en edición solo se deduce el delta si aumentó)
        const cashOutAmount = isAlreadyReceived ? deltaTotal : effectiveTotal;
        if (parseFloat(cashOutAmount) > 0) {
            const { CashShift, CashMovement } = require('../database/models');
            const currentShift = await CashShift.findOne({
                where: { companyId: finalCompanyId, status: 'open' },
                order: [['openedAt', 'DESC']],
                transaction: t
            });
            if (currentShift) {
                await CashMovement.create({
                    id: generateRobustId(),
                    shiftId: currentShift.id,
                    userId: userId,
                    companyId: finalCompanyId,
                    type: 'out',
                    amount: parseFloat(cashOutAmount),
                    currency: 'USD',
                    paymentMethodId: 'cash',
                    category: 'PURCHASE',
                    reason: isAlreadyReceived
                        ? `Ajuste pago contado Albarán #${orderUpdates.referenceNumber || order.referenceNumber || order.id}`
                        : `Pago contado Albarán #${orderUpdates.referenceNumber || order.referenceNumber || order.id}`,
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            }
        }
    }
}

/**
 * POST /scan-invoice - Escanea directamente la factura física desde la impresora/escáner y la guarda permanentemente
 */
router.post('/scan-invoice', verifyToken, async (req, res) => {
    const { deviceId, dpi, colorMode, supplierId } = req.body || {};

    let scannedFilePath = null;
    try {
        console.log(`[PURCHASE INVOICE SCAN] Adquiriendo factura física con escáner: ${deviceId || 'DEFAULT_WIA_SCANNER'}`);

        const scanResult = await ScannerService.scanDocument({ deviceId, dpi, colorMode });
        scannedFilePath = scanResult?.path || scanResult;

        if (!scannedFilePath || !fs.existsSync(scannedFilePath)) {
            return res.status(400).json({ error: 'No se pudo adquirir la imagen del escáner.' });
        }

        // 1. Guardar permanentemente la factura digitalizada
        const invoiceUrl = await InvoiceService.saveInvoiceFromPath(scannedFilePath, 'factura_escaneada.jpg');

        // 2. Extraer productos, precios y datos fiscales mediante Visión IA / OCR
        let rawList = [];
        let currency = 'USD';
        try {
            const extractedData = await PDFService.parseCatalog(scannedFilePath);
            rawList = Array.isArray(extractedData) ? extractedData : (extractedData?.items || []);
            currency = Array.isArray(extractedData) ? 'USD' : (extractedData?.currency || 'USD');
        } catch (parseErr) {
            console.warn('[PURCHASE INVOICE SCAN] Advertencia al extraer datos OCR:', parseErr.message);
        }

        // 3. Cruzar productos con el inventario del usuario
        let finalItems = [];
        let finalCurrency = currency;
        let finalRate = null;
        if (rawList.length > 0) {
            const processed = await ProductService.processCatalogImport(req.user, rawList, supplierId);
            finalItems = Array.isArray(processed) ? processed : (processed?.items || []);
            if (processed?.currency) finalCurrency = processed.currency;
            if (processed?.rate) finalRate = processed.rate;
        }

        res.json({
            success: true,
            invoiceUrl,
            items: finalItems,
            rawItems: rawList,
            currency: finalCurrency,
            rate: finalRate,
            message: 'Factura escaneada y almacenada con éxito'
        });
    } catch (err) {
        console.error('[PURCHASE INVOICE SCAN] Error:', err);
        res.status(400).json({ 
            error: err.message || 'Error al escanear la factura. Verifica la conexión con el escáner.' 
        });
    } finally {
        if (scannedFilePath && fs.existsSync(scannedFilePath)) {
            try { fs.unlinkSync(scannedFilePath); } catch (e) {}
        }
    }
});

/**
 * POST /upload-invoice - Carga una factura física (PDF o Imagen) y la guarda permanentemente
 */
router.post('/upload-invoice', verifyToken, invoiceUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo de factura' });
        }

        const { supplierId } = req.body || {};

        // 1. Guardar permanentemente la factura
        const invoiceUrl = await InvoiceService.saveInvoiceFromPath(req.file.path, req.file.originalname);

        // 2. Extraer datos con OCR/IA
        let rawList = [];
        let currency = 'USD';
        try {
            const extractedData = await PDFService.parseCatalog(req.file.path);
            rawList = Array.isArray(extractedData) ? extractedData : (extractedData?.items || []);
            currency = Array.isArray(extractedData) ? 'USD' : (extractedData?.currency || 'USD');
        } catch (parseErr) {
            console.warn('[PURCHASE INVOICE UPLOAD] Advertencia al extraer datos OCR:', parseErr.message);
        }

        // 3. Cruzar con el catálogo
        let finalItems = [];
        let finalCurrency = currency;
        let finalRate = null;
        if (rawList.length > 0) {
            const processed = await ProductService.processCatalogImport(req.user, rawList, supplierId);
            finalItems = Array.isArray(processed) ? processed : (processed?.items || []);
            if (processed?.currency) finalCurrency = processed.currency;
            if (processed?.rate) finalRate = processed.rate;
        }

        // Limpiar archivo temporal
        if (fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }

        res.json({
            success: true,
            invoiceUrl,
            items: finalItems,
            rawItems: rawList,
            currency: finalCurrency,
            rate: finalRate,
            originalName: req.file.originalname,
            message: 'Factura cargada y almacenada con éxito'
        });
    } catch (err) {
        console.error('[PURCHASE INVOICE UPLOAD] Error:', err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        res.status(500).json({ error: 'Error al procesar la factura: ' + err.message });
    }
});

/**
 * POST /reconcile-invoice - Procesa una factura escaneada/adjuntada con IA Multimodal
 * y reconcilia automáticamente las cantidades recibidas, costos con/sin IVA, tasa BCV y desmarca lo no llegado.
 */
router.post('/reconcile-invoice', verifyToken, invoiceUpload.single('file'), async (req, res) => {
    let tempPath = req.file ? req.file.path : null;
    try {
        let buffer = null;
        let invoiceUrl = req.body?.invoiceUrl || null;

        if (req.file) {
            invoiceUrl = await InvoiceService.saveInvoiceFromPath(req.file.path, req.file.originalname);
            buffer = fs.readFileSync(req.file.path);
        } else if (invoiceUrl) {
            const fullPath = path.join(InvoiceService.getInvoicesDir(), path.basename(invoiceUrl));
            if (fs.existsSync(fullPath)) {
                buffer = fs.readFileSync(fullPath);
            }
        }

        if (!buffer) {
            return res.status(400).json({ error: 'No se encontró la imagen o archivo de la factura para analizar' });
        }

        let currentItems = [];
        try {
            currentItems = typeof req.body?.currentItems === 'string' 
                ? JSON.parse(req.body.currentItems || '[]') 
                : (req.body?.currentItems || []);
        } catch (e) {
            currentItems = [];
        }

        const AIService = require('../services/AIService');
        const reconciliationResult = await AIService.reconcilePurchaseOrderWithInvoice(
            buffer, 
            currentItems, 
            req.user.companyId
        );

        res.json({
            success: true,
            invoiceUrl: invoiceUrl,
            ...reconciliationResult
        });
    } catch (err) {
        console.error('[RECONCILE INVOICE] Error:', err);
        res.status(500).json({ error: 'Error al conciliar factura con IA: ' + err.message });
    } finally {
        if (tempPath && fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch (e) {}
        }
    }
});

/**
 * POST /:id/attach-invoice - Adjunta o actualiza la factura digital de una orden existente
 */
router.post('/:id/attach-invoice', verifyToken, invoiceUpload.single('file'), async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, companyId: req.user.companyId }
        });

        if (!order) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        let newInvoiceUrl = req.body?.invoiceUrl;

        if (req.file) {
            newInvoiceUrl = await InvoiceService.saveInvoiceFromPath(req.file.path, req.file.originalname);
            if (fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (e) {}
            }
        }

        if (!newInvoiceUrl) {
            return res.status(400).json({ error: 'No se especificó la factura a adjuntar' });
        }

        await order.update({ invoiceUrl: newInvoiceUrl });
        res.json({ success: true, invoiceUrl: newInvoiceUrl, message: 'Factura adjuntada correctamente' });
    } catch (err) {
        console.error('Attach invoice error:', err);
        res.status(500).json({ error: 'Error al adjuntar factura: ' + err.message });
    }
});

router.post('/', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { supplierId, items, expectedDate, notes, total, referenceNumber, status, paymentStatus, invoiceUrl } = req.body;
        const newOrder = await PurchaseOrder.create({
            id: generateRobustId(),
            userId: req.user.id,
            companyId: req.user.companyId,
            status: 'pending', // Create as pending first to allow processOrderReception to work
            supplierId,
            items,
            expectedDate,
            notes,
            total,
            referenceNumber,
            invoiceUrl: invoiceUrl || null,
            paymentStatus: paymentStatus || 'unpaid'
        }, { transaction: t });

        if (status === 'received') {
            await processOrderReception(newOrder.id, req.user.id, req.user.activeBranchId, t, req.user.companyId);
        }

        await t.commit();
        res.status(201).json(newOrder);
    } catch (error) {
        if (t) await t.rollback();
        console.error('Create purchase order error:', error);
        res.status(500).json({ error: 'Error al crear orden de compra/albarán: ' + error.message });
    }
});

router.post('/:id/receive', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        await processOrderReception(req.params.id, req.user.id, req.user.activeBranchId, t, req.user.companyId, req.body);
        await t.commit();
        res.json({ success: true, message: 'Mercancía recibida: Stock y precios actualizados en inventario' });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Receive purchase order error:', error);
        res.status(500).json({ error: 'Error al recibir orden: ' + error.message });
    }
});

router.post('/:id/cancel', async (req, res) => {
    try {
        const [updated] = await PurchaseOrder.update(
            { status: 'cancelled' },
            { where: { id: req.params.id, companyId: req.user.companyId, status: 'pending' } }
        );
        if (updated) {
            res.json({ success: true, message: 'Orden cancelada' });
        } else {
            res.status(404).json({ error: 'Orden no encontrada o no es cancelable' });
        }
    } catch (error) {
        console.error('Cancel purchase order error:', error);
        res.status(500).json({ error: 'Error al cancelar orden' });
    }
});

router.post('/:id/pay', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, companyId: req.user.companyId, paymentStatus: 'unpaid' },
            transaction: t
        });
        
        if (!order) {
            await t.rollback();
            return res.status(404).json({ error: 'Orden no encontrada o ya estaba pagada' });
        }

        await order.update({ paymentStatus: 'paid' }, { transaction: t });

        // If received, it's on credit, so reduce supplier balance and log payment
        if (order.status === 'received') {
            const supplier = await require('../database/models').Supplier.findOne({ 
                where: { id: order.supplierId, companyId: req.user.companyId }, 
                transaction: t 
            });
            if (supplier) {
                const newBalance = Math.max(0, VortexMathEngine.subtract(supplier.creditBalance || 0, order.total));
                await supplier.update({ creditBalance: newBalance }, { transaction: t });
                
                await require('../database/models').SupplierCreditHistory.create({
                    id: generateRobustId(),
                    supplierId: order.supplierId,
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    timestamp: new Date().toISOString(),
                    type: 'payment',
                    amount: order.total,
                    balanceAfter: newBalance,
                    description: `Pago Albarán #${order.referenceNumber || order.id}`,
                    purchaseOrderId: order.id,
                    paymentMethod: 'cash'
                }, { transaction: t });
            }
        }

        // Deduct from open cash shift
        const { CashShift, CashMovement } = require('../database/models');
        const currentShift = await CashShift.findOne({
            where: { companyId: req.user.companyId, status: 'open' },
            order: [['openedAt', 'DESC']],
            transaction: t
        });
        
        if (currentShift) {
            await CashMovement.create({
                id: generateRobustId(),
                shiftId: currentShift.id,
                userId: String(req.user.id),
                companyId: req.user.companyId,
                type: 'out',
                amount: parseFloat(order.total),
                currency: 'USD',
                paymentMethodId: 'cash',
                category: 'PURCHASE',
                reason: `Pago Albarán #${order.referenceNumber || order.id}`,
                timestamp: new Date().toISOString()
            }, { transaction: t });
        }

        await t.commit();
        res.json({ success: true, message: 'Pago registrado correctamente' });
    } catch (error) {
        if (t && !t.finished) await t.rollback();
        console.error('Pay purchase order error:', error);
        res.status(500).json({ error: 'Error al registrar el pago: ' + error.message });
    }
});

/**
 * PUT /:id/payment-status - Cambia el estado de pago (paid / unpaid) de una orden de compra
 */
router.put('/:id/payment-status', verifyToken, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { paymentStatus, updateSupplierBalance = true } = req.body;
        const targetStatus = paymentStatus === 'paid' ? 'paid' : 'unpaid';

        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            transaction: t
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        const oldStatus = order.paymentStatus;
        if (oldStatus === targetStatus) {
            await t.rollback();
            return res.json({ success: true, paymentStatus: targetStatus, message: `La orden ya está marcada como ${targetStatus === 'paid' ? 'PAGADA' : 'POR PAGAR'}` });
        }

        await order.update({ paymentStatus: targetStatus }, { transaction: t });

        // Update supplier balance if requested and order is received
        if (updateSupplierBalance && order.supplierId) {
            const supplier = await Supplier.findOne({
                where: { id: order.supplierId, companyId: req.user.companyId },
                transaction: t
            });

            if (supplier) {
                let newBalance = Number(supplier.creditBalance || 0);
                if (targetStatus === 'paid') {
                    newBalance = Math.max(0, VortexMathEngine.subtract(newBalance, order.total));
                    await supplier.update({ creditBalance: newBalance }, { transaction: t });

                    await require('../database/models').SupplierCreditHistory.create({
                        id: generateRobustId(),
                        supplierId: order.supplierId,
                        userId: req.user.id,
                        companyId: req.user.companyId,
                        timestamp: new Date().toISOString(),
                        type: 'payment',
                        amount: order.total,
                        balanceAfter: newBalance,
                        description: `Factura/Albarán #${order.referenceNumber || order.id} marcado como Pagado`,
                        purchaseOrderId: order.id
                    }, { transaction: t });
                } else {
                    newBalance = VortexMathEngine.add(newBalance, order.total);
                    await supplier.update({ creditBalance: newBalance }, { transaction: t });

                    await require('../database/models').SupplierCreditHistory.create({
                        id: generateRobustId(),
                        supplierId: order.supplierId,
                        userId: req.user.id,
                        companyId: req.user.companyId,
                        timestamp: new Date().toISOString(),
                        type: 'charge',
                        amount: order.total,
                        balanceAfter: newBalance,
                        description: `Factura/Albarán #${order.referenceNumber || order.id} marcado como Por Pagar`,
                        purchaseOrderId: order.id
                    }, { transaction: t });
                }
            }
        }

        await t.commit();
        res.json({ 
            success: true, 
            paymentStatus: targetStatus, 
            message: `Orden marcada como ${targetStatus === 'paid' ? 'PAGADA' : 'POR PAGAR'}` 
        });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Update payment status error:', error);
        res.status(500).json({ error: 'Error al actualizar estado de pago: ' + error.message });
    }
});

/**
 * POST /:id/send-whatsapp - Envía la orden de compra existente directamente al WhatsApp del proveedor
 */
router.post('/:id/send-whatsapp', verifyToken, async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, companyId: req.user.companyId }
        });

        if (!order) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        const supplier = await Supplier.findOne({
            where: { id: order.supplierId, companyId: req.user.companyId }
        });

        const targetPhone = req.body?.phone || supplier?.phone;
        if (!targetPhone) {
            return res.status(400).json({ error: 'El proveedor no tiene un número telefónico de WhatsApp registrado.' });
        }

        const WhatsappBotService = require('../services/WhatsappBotService');
        const { getUserSettings } = require('../utils/helpers');
        const settings = getUserSettings();
        const businessName = settings?.business?.name || 'Isaac POS';

        let parsedItems = [];
        try {
            parsedItems = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        } catch (e) {
            parsedItems = [];
        }

        const formattedText = WhatsappBotService.formatPurchaseOrderMessage({
            orderId: order.id,
            businessName,
            supplierName: supplier?.name || 'Proveedor',
            supplierContact: supplier?.contact || '',
            orderDate: order.expectedDate || new Date(order.createdAt).toLocaleDateString('es-VE'),
            items: parsedItems,
            total: order.total,
            notes: order.notes,
            referenceNumber: order.referenceNumber
        });

        const sendResult = await WhatsappBotService.sendDirectMessage(targetPhone, formattedText);

        res.json({
            ...sendResult,
            formattedText,
            supplierName: supplier?.name || 'Proveedor',
            businessName
        });
    } catch (error) {
        console.error('Send WhatsApp purchase order error:', error);
        res.status(500).json({ error: 'Error al enviar orden por WhatsApp: ' + error.message });
    }
});

/**
 * DELETE /:id - Elimina una orden de compra, revirtiendo stock, movimientos e historial de deuda con proveedor si fue recibida
 */
router.delete('/:id', verifyToken, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            transaction: t
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        const items = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : (order.items || []);

        if (order.status === 'received') {
            // Revertir inventario (incluyendo factorConversion si se recibió por empaque/bulto)
            const targetBranchId = order.branchId || req.user.activeBranchId || null;
            for (const item of items) {
                if (item.isReceived && item.receivedQuantity > 0) {
                    const prod = await Product.findOne({
                        where: { id: item.productId, companyId: req.user.companyId },
                        transaction: t
                    });
                    if (prod) {
                        const factor = (item.isPresentation || item.presentationId) && Number(item.factorConversion) > 1
                            ? Number(item.factorConversion)
                            : 1;
                        const revertQty = precision.round(Number(item.receivedQuantity) * factor, 6);
                        const oldStock = Number(prod.stockQuantity !== null && prod.stockQuantity !== undefined ? prod.stockQuantity : (prod.stock || 0));
                        const newStock = Math.max(0, precision.subtract(oldStock, revertQty));
                        await prod.update({ stock: newStock, stockQuantity: String(newStock) }, { transaction: t });

                        if (targetBranchId) {
                            const bs = await BranchStock.findOne({
                                where: { productId: prod.id, branchId: targetBranchId, companyId: req.user.companyId },
                                transaction: t
                            });
                            if (bs) {
                                const nextBs = Math.max(0, precision.subtract(Number(bs.quantity) || 0, revertQty));
                                await bs.update({ quantity: nextBs }, { transaction: t });
                            }
                        }

                        await StockMovement.create({
                            id: 'sm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                            productId: prod.id,
                            userId: req.user.id,
                            quantity: revertQty,
                            stockBefore: String(oldStock),
                            stockAfter: String(newStock),
                            type: 'OUT',
                            referenceId: order.id,
                            reason: `Eliminación de orden #${order.referenceNumber || order.id.slice(0, 8)}`,
                            date: new Date().toISOString(),
                            companyId: req.user.companyId
                        }, { transaction: t });
                    }
                }
            }

            // Revertir deuda con proveedor si estaba pendiente de pago
            if (order.paymentStatus === 'unpaid' && order.supplierId) {
                const supp = await Supplier.findOne({
                    where: { id: order.supplierId, companyId: req.user.companyId },
                    transaction: t
                });
                if (supp) {
                    const oldBal = supp.creditBalance || 0;
                    const newBal = Math.max(0, parseFloat((oldBal - (order.total || 0)).toFixed(2)));
                    await supp.update({ creditBalance: newBal }, { transaction: t });
                }
            }
        }

        if (order.invoiceUrl) {
            await InvoiceService.deleteInvoice(order.invoiceUrl);
        }

        await order.destroy({ transaction: t });
        await t.commit();

        res.json({ success: true, message: 'Orden de compra eliminada correctamente' });
    } catch (err) {
        await t.rollback();
        console.error('Delete purchase order error:', err);
        res.status(500).json({ error: 'Error al eliminar orden de compra: ' + err.message });
    }
});

module.exports = router;
