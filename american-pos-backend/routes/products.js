const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { isAdmin, requirePermission } = require('../middleware/auth');
const ProductService = require('../services/ProductService');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const validate = require('../middleware/validate');
const { productSchema } = require('../schemas/productSchema');
const InvoiceService = require('../services/InvoiceService');
let ExcelJSRef = null;
const getExcelJS = () => (ExcelJSRef || (ExcelJSRef = require('exceljs')));
let PDFServiceRef = null;
const getPDFService = () => (PDFServiceRef || (PDFServiceRef = require('../services/PDFService')));
const precision = require('../utils/precision');
const { generateRobustId } = require('../utils/helpers');
const multer = require('multer');
const os = require('os');

// Ensure upload directory in a writable path for Electron
const getUploadPath = () => {
    const baseDir = process.env.USER_DATA_PATH || os.tmpdir();
    const uploadDir = path.join(baseDir, 'uploads');
    if (!fs.existsSync(uploadDir)) {
        try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) {}
    }
    return uploadDir;
};

const PRODUCT_UPLOAD_ALLOWED_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.xlsx', '.xls', '.csv']);
const PRODUCT_UPLOAD_ALLOWED_MIMES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'text/plain'
]);

const upload = multer({
    dest: getUploadPath(),
    limits: {
        fileSize: 25 * 1024 * 1024 // 25 MB max limit to protect against DoS
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const mime = String(file.mimetype || '').toLowerCase();
        if (PRODUCT_UPLOAD_ALLOWED_EXTS.has(ext) && (!mime || mime === 'application/octet-stream' || PRODUCT_UPLOAD_ALLOWED_MIMES.has(mime))) {
            return cb(null, true);
        }
        return cb(new Error('Tipo de archivo no permitido para importación de productos/catálogo.'));
    }
});

const cache = require('../utils/cacheService');

// --- PRODUCT ROUTES (v3.0.0 - Service Oriented) ---

/**
 * GET /categories - List all unique product categories (solo productos activos, sin categorías virtuales)
 */
router.get('/categories', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const cacheKey = `categories_v2_${companyId}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const { Op } = require('sequelize');
        const { sequelize } = require('../database/connection');
        const { Product } = require('../database/models');
        const companyCondition = (companyId === '2' || companyId === 'default')
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }] }
            : { companyId };

        const categories = await Product.findAll({
            attributes: [
                [sequelize.fn('DISTINCT', sequelize.col('category')), 'category']
            ],
            where: {
                ...companyCondition,
                status: 'active',
                isCustom: { [Op.or]: [false, null] }
            }
        });
        const rawCategories = categories.map(c => c.category).filter(Boolean);

        // Helper to normalize: "golosinas" -> "Golosinas"
        const normalize = (str) => str.trim().charAt(0).toUpperCase() + str.trim().slice(1).toLowerCase();

        const uniqueCats = [...new Set(rawCategories.map(normalize))].sort((a, b) => a.localeCompare(b, 'es'));

        cache.set(cacheKey, uniqueCats, 300); // 5 min cache
        res.json(uniqueCats);
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

const ScannerService = require('../services/ScannerService');

/**
 * GET /scanners - Enumerate connected WIA scanner devices and multifunction printers
 */
router.get('/scanners', isAdmin, async (req, res) => {
    try {
        const scanners = await ScannerService.listScanners();
        res.json({ scanners });
    } catch (err) {
        console.error('[SCANNER ROUTE] Error listing scanners:', err);
        res.json({ 
            scanners: [
                {
                    id: 'DEFAULT_WIA_SCANNER',
                    name: 'Selección Automática (Escáner o Impresora Predeterminada)',
                    manufacturer: 'Windows WIA',
                    type: 'GENERIC',
                    status: 'Listo'
                }
            ] 
        });
    }
});

// Middleware para autorizar escaneo/importación de facturas (Dueño, Admin, Supervisor o con permisos)
const canImportCatalog = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autorizado' });
    const role = (req.user.role || '').toLowerCase();
    const permissions = req.user.permissions || {};
    if (['admin', 'superadmin', 'owner', 'dueño', 'supervisor'].includes(role) || 
        permissions.canCreateProducts === true || 
        permissions.canManageInventory === true) {
        return next();
    }
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos para escanear e importar facturas' });
};

/**
 * POST /scan-from-printer - Acquire scanned invoice directly from connected scanner/printer via Windows WIA or eSCL
 */
router.post('/scan-from-printer', canImportCatalog, async (req, res) => {
    if (req.setTimeout) req.setTimeout(360000);
    if (res.setTimeout) res.setTimeout(360000);
    const { deviceId, dpi, colorMode, supplierId } = req.body || {};

    let scannedFilePath = null;
    try {
        console.log(`[SCANNER ROUTE] Iniciando escaneo con dispositivo: ${deviceId || 'DEFAULT_WIA_SCANNER'} (DPI: ${dpi || 300})`);

        const scanResult = await ScannerService.scanDocument({ deviceId, dpi, colorMode });
        scannedFilePath = scanResult?.path || scanResult;

        if (!scannedFilePath || typeof scannedFilePath !== 'string' || !fs.existsSync(scannedFilePath)) {
            return res.status(400).json({ error: 'No se generó el archivo de imagen escaneada correctamente.' });
        }

        console.log(`[SCANNER ROUTE] Documento escaneado exitosamente en: ${scannedFilePath}`);

        // 1. Guardar permanentemente la factura digital
        const invoiceUrl = await InvoiceService.saveInvoiceFromPath(scannedFilePath, 'factura_escaneada.jpg');

        // 2. Extraer datos del catálogo / factura con IA / OCR (timeout de seguridad 180s para permitir análisis multimodal a 600 DPI)
        let extractedData = null;
        try {
            const aiPromise = getPDFService().parseCatalog(scannedFilePath);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Tiempo de espera de IA agotado')), 180000)
            );
            extractedData = await Promise.race([aiPromise, timeoutPromise]);
        } catch (parseErr) {
            console.warn('[SCANNER ROUTE] Advertencia al procesar OCR de factura escaneada:', parseErr.message);
            extractedData = { items: [], currency: 'USD' };
        }

        const rawList = Array.isArray(extractedData) ? extractedData : (extractedData?.items || []);
        const currency = Array.isArray(extractedData) ? 'USD' : (extractedData?.currency || 'USD');

        // 3. Vincular con productos existentes utilizando tasa BCV histórica por fecha si aplica
        let processed = { items: [], currency, rate: extractedData?.exchangeRate || null };
        try {
            processed = await ProductService.processCatalogImport(req.user, extractedData, supplierId);
        } catch (procErr) {
            console.warn('[SCANNER ROUTE] Advertencia en processCatalogImport:', procErr.message);
        }

        const finalItems = Array.isArray(processed?.items) && processed.items.length > 0 
            ? processed.items 
            : (Array.isArray(processed) && processed.length > 0 ? processed : rawList);
        const finalCurrency = processed?.currency || currency || 'USD';
        const finalRate = processed?.rate || extractedData?.exchangeRate || null;

        console.log(`[SCANNER ROUTE] Resultado final: ${finalItems.length} renglones detectados (Moneda: ${finalCurrency}, Tasa: ${finalRate || 'N/A'})`);

        res.json({
            success: true,
            invoiceUrl,
            items: finalItems,
            rawItems: rawList,
            currency: finalCurrency,
            rate: finalRate,
            posExchangeRate: processed?.posExchangeRate || 1,
            invoiceDate: processed?.invoiceDate || extractedData?.invoiceDate,
            rateSource: processed?.rateSource || extractedData?.rateSource,
            documentType: processed?.documentType || extractedData?.documentType || 'INVOICE',
            referenceNumber: processed?.referenceNumber || extractedData?.referenceNumber || null,
            detectedSupplierId: processed?.detectedSupplierId || null,
            detectedSupplierName: processed?.detectedSupplierName || extractedData?.supplierName || null,
            docSubtotal: processed?.docSubtotal ?? extractedData?.docSubtotal ?? null,
            docTaxAmount: processed?.docTaxAmount ?? extractedData?.docTaxAmount ?? null,
            docTotal: processed?.docTotal ?? extractedData?.docTotal ?? null
        });
    } catch (err) {
        console.error('[SCANNER ROUTE] Error procesando imagen escaneada:', err);
        res.status(400).json({ 
            error: err.message || 'No se pudo adquirir la imagen del escáner. Verifica que la impresora/escáner esté encendida y conectada.' 
        });
    } finally {
        if (scannedFilePath && typeof scannedFilePath === 'string' && fs.existsSync(scannedFilePath)) {
            try { fs.unlinkSync(scannedFilePath); } catch (e) {}
        }
    }
});

/**
 * GET /public-catalog - Lightweight catalog for mobile sync (Protected)
 */
router.get('/public-catalog', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { products } = await ProductService.getAllProducts(req.user, { minimal: 'true' });
        
        const mapped = products.map(p => ({
            ...p,
            stockQuantity: p.stockQuantity || p.stock || 0
        }));
        
        res.json(mapped);
    } catch (error) {
        console.error('Public catalog error:', error);
        res.status(500).json({ error: 'Error al obtener catálogo' });
    }
});

/**
 * POST /public-sync - Sync local mobile products to server (Protected)
 */
router.post('/public-sync', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { products } = req.body;
        if (!Array.isArray(products)) return res.status(400).json({ error: 'Formato inválido' });

        const { Product } = require('../database/models');
        const results = { success: [], errors: [] };

        for (const prodData of products) {
            try {
                let product = null;
                if (prodData.barcode) {
                    product = await Product.findOne({ 
                        where: { barcode: prodData.barcode, companyId: req.user.companyId } 
                    });
                }
                
                if (!product && prodData.id && !prodData.id.toString().startsWith('local-')) {
                    product = await Product.findOne({
                        where: { id: prodData.id, companyId: req.user.companyId }
                    });
                }

                if (product) {
                    await ProductService.updateProduct(req.user, product.id, {
                        name: prodData.name, 
                        price: prodData.price, 
                        cost: prodData.cost,
                        stockQuantity: prodData.stock !== undefined ? prodData.stock : product.stockQuantity,
                        category: prodData.category,
                        barcode: prodData.barcode,
                        taxStatus: prodData.taxStatus,
                        supplierId: prodData.supplierId,
                        minStock: prodData.minStock,
                        stockUnit: prodData.stockUnit,
                        bulkUnitName: prodData.bulkUnitName,
                        unitsPerBulk: prodData.unitsPerBulk,
                        allowNegative: prodData.allowNegative !== undefined ? (prodData.allowNegative === true || prodData.allowNegative === 1 || prodData.allowNegative === 'true' || prodData.allowNegative === '1') : product.allowNegative,
                        isSoldByWeight: prodData.isSoldByWeight !== undefined ? (prodData.isSoldByWeight === true || prodData.isSoldByWeight === 1 || prodData.isSoldByWeight === 'true' || prodData.isSoldByWeight === '1') : product.isSoldByWeight
                    });
                    results.success.push({ id: prodData.id, action: 'updated' });
                } else {
                    const newId = prodData.id.toString().startsWith('local-') ? `MOB-${Date.now()}-${Math.floor(Math.random()*1000)}` : prodData.id;
                    const newProd = await ProductService.createProduct(req.user, {
                        ...prodData,
                        id: newId,
                        stockQuantity: prodData.stock || 0
                    });
                    results.success.push({ id: prodData.id, action: 'created', newId: newProd.id });
                }
            } catch (err) { 
                results.errors.push({ id: prodData.id, error: err.message }); 
            }
        }
        if (results.success.length > 0) {
            const io = req.app.get('io');
            if (io) io.to(req.user.companyId).emit('inventory_changed');
        }
        res.json({ success: true, results });
    } catch (error) {
        console.error('Product sync error:', error);
        res.status(500).json({ error: 'Error al sincronizar productos' });
    }
});

/**
 * GET /master - Full catalog for mobile sync
 */
router.get('/master', async (req, res) => {
    try {
        const result = await ProductService.getAllProducts(req.user, { limit: 0 });
        res.json(result);
    } catch (error) {
        console.error('Get master products error:', error);
        res.status(500).json({ error: 'Error al obtener catálogo maestro' });
    }
});

/**
 * GET / - List products with filtering and pagination
 */
router.get('/', async (req, res) => {
    try {
        // Intercept the virtual category for the out-of-stock list
        if (req.query.category === '🚫 Productos sin stock' || (typeof req.query.category === 'string' && req.query.category.toLowerCase().includes('sin stock'))) {
            req.query.stockFilter = 'out';
            delete req.query.category;
        }

        const result = await ProductService.getAllProducts(req.user, req.query);
        if (req.query.since || req.query.delta === 'true' || req.query.limit > 0 || req.query.page) {
            res.json(result);
        } else {
            res.json(result.products);
        }
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ error: 'Error al obtener productos: ' + error.message });
    }
});



/**
 * POST / - Create a new product
 */
router.post('/', requirePermission('canCreateProducts'), validate(productSchema), async (req, res) => {
    try {
        const product = await ProductService.createProduct(req.user, req.body);
        const io = req.app.get('io');
        if (io) io.to(req.user.companyId).emit('inventory_changed');
        SupabaseSyncService.queueProduct(product).catch(() => {});
        res.status(201).json(product);
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Error al crear producto: ' + error.message });
    }
});

/**
 * PUT /:id - Update an existing product
 */
router.put('/:id', requirePermission('canCreateProducts'), validate(productSchema), async (req, res) => {
    try {
        const updatedProduct = await ProductService.updateProduct(req.user, req.params.id, req.body);
        const io = req.app.get('io');
        if (io) {
            const compId = String(req.user.companyId || '2');
            io.to(compId).emit('inventory_changed');
            io.to(compId).emit('product_updated', updatedProduct);
        }
        SupabaseSyncService.queueProduct(updatedProduct).catch(() => {});
        res.json({ message: 'Producto actualizado exitosamente', product: updatedProduct });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Error al actualizar producto: ' + error.message });
    }
});

/**
 * DELETE /:id - Delete a product
 */
router.delete('/:id', requirePermission('canCreateProducts'), async (req, res, next) => {
    try {
        await ProductService.deleteProduct(req.user.companyId, req.params.id);
        const io = req.app.get('io');
        if (io) io.to(req.user.companyId).emit('inventory_changed');
        res.json({ success: true, message: 'Producto eliminado exitosamente' });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /bulk-delete - Delete multiple products
 */
router.post('/bulk-delete', requirePermission('canCreateProducts'), async (req, res) => {
    try {
        const { productIds } = req.body;
        if (!productIds || !Array.isArray(productIds)) {
            return res.status(400).json({ error: 'Se requiere una lista de IDs' });
        }
        
        let deletedCount = 0;
        for (const id of productIds) {
            try {
                await ProductService.deleteProduct(req.user.companyId, id);
                deletedCount++;
            } catch (e) {}
        }
        const io = req.app.get('io');
        if (io && deletedCount > 0) io.to(req.user.companyId).emit('inventory_changed');
        res.json({ success: true, count: deletedCount });
    } catch (error) {
        console.error('Bulk delete error:', error);
        res.status(500).json({ error: 'Error al eliminar productos' });
    }
});

/**
 * POST /bulk-stock-increase - Increase stock for multiple products
 */
router.post('/bulk-stock-increase', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ error: 'Se requiere una lista de items' });
        }
        
        const { Product, BranchStock, StockMovement, Branch } = require('../database/models');
        const { generateRobustId } = require('../utils/helpers');
        const { sequelize } = require('../database/connection');
        
        await sequelize.transaction(async (t) => {
            let activeBranchId = null;
            if (req.user.activeBranchId && req.user.activeBranchId !== '1' && req.user.activeBranchId !== 'null' && req.user.activeBranchId !== 'undefined') {
                activeBranchId = req.user.activeBranchId;
            } else {
                const dbBranch = await Branch.findOne({ where: { companyId: req.user.companyId }, transaction: t });
                if (dbBranch) activeBranchId = dbBranch.id;
            }
            
            for (const item of items) {
                const product = await Product.findOne({ where: { id: item.productId, companyId: req.user.companyId }, transaction: t });
                if (!product) continue;
                
                let quantityToAdd = Number(item.quantity) || 0;
                if (item.type === 'bulks') {
                    quantityToAdd = precision.multiply(quantityToAdd, Number(product.unitsPerBulk || 1));
                }
                
                if (quantityToAdd <= 0) continue;
                
                // Always update global product catalog stock
                let updates = {};
                if (item.batchNumber) updates.batchNumber = item.batchNumber;
                if (item.expirationDate) updates.expirationDate = item.expirationDate;

                const currentProdStock = Number(product.stockQuantity || product.stock || 0);
                const newProdStock = precision.round(precision.add([currentProdStock, quantityToAdd]), 6);
                updates.stockQuantity = String(newProdStock);
                updates.stock = String(newProdStock);

                await product.update(updates, { transaction: t });

                // Sincronizar con ProductLot si se especificó número de lote o fecha de vencimiento (FEFO)
                if (item.batchNumber || item.expirationDate) {
                    const { ProductLot } = require('../database/models');
                    const lotNum = String(item.batchNumber || `LOTE-${new Date().toISOString().slice(0, 10)}`).trim();
                    let existingLot = await ProductLot.findOne({
                        where: { productId: product.id, companyId: req.user.companyId, lotNumber: lotNum, status: 'active' },
                        transaction: t
                    });
                    if (existingLot) {
                        const newLotQty = precision.round(precision.add([Number(existingLot.quantity) || 0, quantityToAdd]), 6);
                        await existingLot.update({
                            quantity: newLotQty,
                            expirationDate: item.expirationDate || existingLot.expirationDate
                        }, { transaction: t });
                    } else {
                        await ProductLot.create({
                            id: generateRobustId(),
                            companyId: req.user.companyId,
                            productId: product.id,
                            lotNumber: lotNum,
                            quantity: quantityToAdd,
                            expirationDate: item.expirationDate || null,
                            cost: Number(product.cost) || 0,
                            status: 'active'
                        }, { transaction: t });
                    }
                }
                
                if (activeBranchId) {
                    const bs = await BranchStock.findOne({ where: { productId: product.id, branchId: activeBranchId }, transaction: t });
                    const branchStockBefore = bs ? Number(bs.quantity) : 0;
                    const branchStockAfter = precision.round(precision.add([branchStockBefore, quantityToAdd]), 6);
                    
                    if (bs) {
                        await bs.update({ quantity: branchStockAfter }, { transaction: t });
                    } else {
                        await BranchStock.create({
                            productId: product.id,
                            branchId: activeBranchId,
                            quantity: branchStockAfter,
                            companyId: req.user.companyId
                        }, { transaction: t });
                    }
                }
                
                // Kardex movement (siempre registrado para trazabilidad y auditoría total)
                await StockMovement.create({
                    id: generateRobustId(),
                    productId: product.id,
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    type: 'IN',
                    quantity: quantityToAdd,
                    stockBefore: currentProdStock,
                    stockAfter: newProdStock,
                    reason: `Ingreso Rápido (${item.type === 'bulks' ? 'Bulto: ' + (product.bulkUnitName || 'Bulto') : 'Unidades'})${item.batchNumber ? ' Lote: ' + item.batchNumber : ''}`,
                    referenceId: 'bulk-stock',
                    date: new Date().toISOString()
                }, { transaction: t });
            }
        });
        ProductService.invalidateCatalogCache();
        
        const io = req.app.get('io');
        if (io) io.to(req.user.companyId).emit('inventory_changed');
        
        res.json({ success: true });
    } catch (error) {
        console.error('Bulk stock increase error:', error);
        res.status(500).json({ error: 'Error al ingresar mercancía: ' + error.message });
    }
});

/**
 * POST /:id/generate-image - Generate a product image using AI
 */
router.post('/:id/generate-image', requirePermission('canCreateProducts'), async (req, res) => {
    try {
        const result = await ProductService.generateImageIA(req.params.id, req.user);
        const io = req.app.get('io');
        if (io) io.to(req.user.companyId).emit('inventory_changed');
        res.json(result);
    } catch (error) {
        console.error('IA Image generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /:id/search-images-ia - Busca imágenes candidatas con IA
 */
router.post('/:id/search-images-ia', requirePermission('canCreateProducts'), async (req, res) => {
    try {
        const { name, category } = req.body || {};
        const result = await ProductService.searchImagesIA(req.params.id, name, category, req.user);
        res.json(result);
    } catch (error) {
        console.warn('[IA IMAGE SEARCH] Aviso:', error.message);
        res.json({ images: [], error: error.message });
    }
});

/**
 * POST /:id/select-image-ia - Descarga y asocia la imagen seleccionada
 */
router.post('/:id/select-image-ia', requirePermission('canCreateProducts'), async (req, res) => {
    try {
        const { imageUrl, name, category } = req.body || {};
        if (!imageUrl) return res.status(400).json({ error: 'Falta la URL de la imagen' });
        
        const result = await ProductService.downloadAndSetImage(req.params.id, imageUrl, name, category, req.user);
        const io = req.app.get('io');
        if (io && req.user?.companyId) io.to(req.user.companyId).emit('inventory_changed');
        res.json(result);
    } catch (error) {
        console.error('IA Image download error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generar código de barras con IA
const generateBarcodeHandler = async (req, res) => {
    try {
        const result = await ProductService.updateBarcodeIA(req.params.id, req.user);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

router.post('/:id/generate-barcode', requirePermission('canCreateProducts'), generateBarcodeHandler);
router.post('/:id/generate_barcode', requirePermission('canCreateProducts'), generateBarcodeHandler);

/**
 * GET /semantic-search - Búsqueda semántica híbrida con IA y Trigramas (PostgreSQL 16)
 */
router.get('/semantic-search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query || req.query.search;
        const companyId = req.user?.companyId || '2';
        const limit = parseInt(req.query.limit, 10) || 15;
        const SemanticSearchService = require('../services/SemanticSearchService');
        const results = await SemanticSearchService.searchProducts(query, companyId, limit);
        res.json({ success: true, count: results.length, data: results });
    } catch (error) {
        console.error('Semantic search error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /search-for-link - Quick search for linking products
 */
router.get('/search-for-link', async (req, res) => {
    try {
        const { search } = req.query;
        const products = await ProductService.searchProductsForLink(req.user, search);
        res.json(products);
    } catch (error) {
        console.error('Search for link error:', error);
        res.status(500).json({ error: 'Error al buscar productos' });
    }
});

/**
 * GET /low-stock - Get products with low stock alerts
 */
router.get('/low-stock', async (req, res) => {
    try {
        const products = await ProductService.getLowStockAlerts(req.user.companyId);
        res.json(products);
    } catch (error) {
        console.error('Low stock error:', error);
        res.status(500).json({ error: 'Error al obtener alertas de stock' });
    }
});

/**
 * POST /bulk-edit and POST /bulk-price-adjustment - Adjust prices for multiple products
 */
const handleBulkEdit = async (req, res) => {
    try {
        const count = await ProductService.bulkEdit(req.user, req.body);
        cache.delPrefix('categories_');
        const io = req.app.get('io');
        if (io && count > 0) io.to(req.user.companyId).emit('inventory_changed');
        res.json({ success: true, count });
    } catch (error) {
        console.error('Bulk price adjust error:', error);
        res.status(500).json({ error: 'Error al ajustar precios: ' + error.message });
    }
};

router.post('/bulk-edit', requirePermission('canCreateProducts'), handleBulkEdit);
router.post('/bulk-price-adjustment', requirePermission('canCreateProducts'), handleBulkEdit);

/**
 * GET /export/excel - Export products to XLSX
 */
router.get('/export/excel', requirePermission(['canManageInventory', 'canCreateProducts', 'canViewReports', 'canViewCosts']), async (req, res) => {
    try {
        const result = await ProductService.getAllProducts(req.user, {});
        const data = result.products.map(p => ({
            ID: p.id,
            Nombre: p.name,
            Categoria: p.category || 'General',
            Costo: p.cost || 0,
            Precio: p.price || 0,
            Stock: p.stockQuantity || 0,
            Unidad: p.stockUnit || 'unidad',
            Min_Stock: p.minStock || 0
        }));

        const ExcelJS = getExcelJS();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Productos');
        worksheet.columns = [
            { header: 'ID', key: 'ID', width: 22 },
            { header: 'Nombre', key: 'Nombre', width: 34 },
            { header: 'Categoria', key: 'Categoria', width: 18 },
            { header: 'Costo', key: 'Costo', width: 14 },
            { header: 'Precio', key: 'Precio', width: 14 },
            { header: 'Stock', key: 'Stock', width: 14 },
            { header: 'Unidad', key: 'Unidad', width: 14 },
            { header: 'Min_Stock', key: 'Min_Stock', width: 14 }
        ];
        worksheet.addRows(data);
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=productos.xlsx');
        res.send(buffer);
    } catch (error) {
        console.error('Excel export error:', error);
        res.status(500).json({ error: 'Error al exportar a Excel' });
    }
});

/**
 * GET /waste/history - Historial y Auditoría de Mermas y Ajustes de Stock
 */
router.get('/waste/history', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const result = await ProductService.getWasteHistory(req.user, req.query);
        res.json(result);
    } catch (error) {
        console.error('Error fetching waste history:', error);
        res.status(500).json({ error: error.message || 'Error al obtener historial de mermas' });
    }
});

/**
 * GET /waste/export - Exportar Reporte de Mermas a Excel (XLSX)
 */
router.get('/waste/export', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const buffer = await ProductService.exportWasteExcel(req.user, req.query);
        const fileName = `auditoria_mermas_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(buffer);
    } catch (error) {
        console.error('Error exporting waste excel:', error);
        res.status(500).json({ error: 'Error al exportar reporte de mermas' });
    }
});

/**
 * POST /waste - Registrar baja/merma/ajuste de stock con justificación de auditoría
 */
router.post('/waste', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const { productId } = req.body;
        if (!productId) return res.status(400).json({ error: 'Se requiere productId' });
        const result = await ProductService.recordWaste(req.user, productId, req.body);
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('inventory_changed');
            io.to(req.user.companyId).emit('product_updated', result.product);
            io.to(req.user.companyId).emit('waste_registered', result);
        }
        res.json(result);
    } catch (error) {
        console.error('Waste recording error:', error);
        res.status(400).json({ error: error.message || 'Error al registrar merma' });
    }
});

/**
 * GET /:id - Get a single product with full details
 */
router.get('/:id', async (req, res) => {
    try {
        const { Product, Supplier, BranchStock, VarianteProducto, ProductPresentation } = require('../database/models');
        const product = await Product.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            include: [
                { model: Supplier, attributes: ['name'] },
                { model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] },
                { model: VarianteProducto, as: 'Variantes' },
                { model: ProductPresentation, as: 'Presentations' }
            ]
        });
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
        
        const p = product.get({ plain: true });
        let totalPhysicalStock = 0;
        if (p.BranchStocks && p.BranchStocks.length > 0) {
            totalPhysicalStock = p.BranchStocks.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
        }
        p.stockQuantity = Number(totalPhysicalStock > 0 ? totalPhysicalStock : (p.stockQuantity || p.stock || 0));
        
        res.json(p);
    } catch (error) {
        console.error('Get product by ID error:', error);
        res.status(500).json({ error: 'Error al obtener el producto' });
    }
});

/**
 * POST /bulk-audit-adjust - Ajuste masivo por Toma Física / Auditoría de Inventario
 */
router.post('/bulk-audit-adjust', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const result = await ProductService.bulkAuditAdjust(req.user, req.body);
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('inventory_changed');
            io.to(req.user.companyId).emit('audit_completed', result);
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Bulk audit adjust error:', error);
        res.status(400).json({ error: error.message || 'Error al procesar la auditoría física' });
    }
});

/**
 * POST /:id/quick-stock-adjust - Fast 1-Click stock adjust with Kardex (Admin only)
 */
router.post('/:id/quick-stock-adjust', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const result = await ProductService.quickStockAdjust(req.user, req.params.id, req.body);
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('inventory_changed');
            io.to(req.user.companyId).emit('product_updated', result.product);
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Quick stock adjust error:', error);
        res.status(400).json({ error: error.message || 'Error al ajustar stock' });
    }
});

/**
 * POST /:id/waste - Registrar baja/merma/ajuste para un producto específico
 */
router.post('/:id/waste', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const result = await ProductService.recordWaste(req.user, req.params.id, req.body);
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('inventory_changed');
            io.to(req.user.companyId).emit('product_updated', result.product);
            io.to(req.user.companyId).emit('waste_registered', result);
        }
        res.json(result);
    } catch (error) {
        console.error('Waste recording error for product:', error);
        res.status(400).json({ error: error.message || 'Error al registrar merma' });
    }
});

/**
 * POST /upload-image - Upload a product image from a base64 string
 */
const getUploadDir = () => {
    let userDataPath = process.env.USER_DATA_PATH;
    if (!userDataPath && process.platform === 'win32') {
        let appData = path.join(process.env.APPDATA, 'isaac-pos');
        if (!fs.existsSync(appData)) {
            if (fs.existsSync(path.join(process.env.APPDATA, 'Isaac POS'))) appData = path.join(process.env.APPDATA, 'Isaac POS');
            else if (fs.existsSync(path.join(process.env.APPDATA, 'isaacpos'))) appData = path.join(process.env.APPDATA, 'isaacpos');
            else if (fs.existsSync(path.join(process.env.APPDATA, 'americanpos'))) appData = path.join(process.env.APPDATA, 'americanpos');
            else if (fs.existsSync(path.join(process.env.APPDATA, 'american-pos-backend'))) appData = path.join(process.env.APPDATA, 'american-pos-backend');
        }
        if (fs.existsSync(appData)) {
            userDataPath = appData;
        }
    }
    // Note: __dirname is the routes folder, so we go up to the root
    const dir = userDataPath ? path.join(userDataPath, 'product_images') : path.join(__dirname, '..', 'product_images');

    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
};

router.post('/upload-image', requirePermission('canCreateProducts'), async (req, res) => {
    try {
        const { base64 } = req.body;
        if (!base64) return res.status(400).json({ error: 'No se proporcionaron datos de imagen' });

        // Extract mime type and base64 data
        const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return res.status(400).json({ error: 'Formato de imagen inválido' });
        }

        const type = matches[1];
        
        // Validación estricta de seguridad: solo permitir imágenes
        if (!type.startsWith('image/')) {
            return res.status(403).json({ error: 'Solo se permiten imágenes.' });
        }
        
        const data = Buffer.from(matches[2], 'base64');
        let extension = type.split('/')[1] || 'jpg';
        
        // Bloquear extensiones que no sean imágenes (por si intentan saltarse el filtro)
        const safeExtensions = ['jpeg', 'jpg', 'png', 'webp', 'gif'];
        if (!safeExtensions.includes(extension.toLowerCase())) {
            return res.status(403).json({ error: 'Formato de imagen no permitido.' });
        }
        
        const filename = `product_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
        
        const uploadDir = getUploadDir();
        const filePath = path.join(uploadDir, filename);

        fs.writeFileSync(filePath, data);

        // Replicar en todas las rutas candidatas para garantizar cero 404
        const replicationDirs = [
            path.join(__dirname, '..', 'product_images'),
            process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', 'product_images') : null,
            process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', 'product_images') : null,
            process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', 'product_images') : null
        ].filter(Boolean);
        replicationDirs.forEach(dir => {
            try {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, filename), data);
            } catch (e) {}
        });

        // Replicar automáticamente a Supabase Storage en segundo plano
        try {
            const { uploadProductImageToSupabase } = require('../services/CloudStorageService');
            uploadProductImageToSupabase(filename, data);
        } catch (e) {
            console.warn('[UPLOAD-IMAGE] No se pudo invocar CloudStorageService:', e.message);
        }

        const publicImageUri = `/product_images/${filename}`;
        res.json({ imageUri: publicImageUri, filename: publicImageUri });
    } catch (error) {
        console.error('Upload product image error:', error);
        res.status(500).json({ error: 'Error al procesar la imagen' });
    }
});

const buildCatalogImportResponse = (invoiceUrl, extractedData, processed) => {
    const rawList = Array.isArray(extractedData) ? extractedData : (extractedData?.items || []);
    const currency = Array.isArray(extractedData) ? 'USD' : (extractedData?.currency || 'USD');
    const finalItems = Array.isArray(processed?.items) && processed.items.length > 0
        ? processed.items
        : (Array.isArray(processed) && processed.length > 0 ? processed : rawList);
    const finalCurrency = processed?.currency || currency || 'USD';
    const finalRate = processed?.rate || extractedData?.exchangeRate || null;

    return {
        success: true,
        invoiceUrl,
        items: finalItems,
        rawItems: rawList,
        currency: finalCurrency,
        rate: finalRate,
        posExchangeRate: processed?.posExchangeRate || 1,
        invoiceDate: processed?.invoiceDate || extractedData?.invoiceDate || null,
        rateSource: processed?.rateSource || extractedData?.rateSource || null,
        documentType: processed?.documentType || extractedData?.documentType || 'INVOICE',
        referenceNumber: processed?.referenceNumber || extractedData?.referenceNumber || null,
        detectedSupplierId: processed?.detectedSupplierId || null,
        detectedSupplierName: processed?.detectedSupplierName || extractedData?.supplierName || null,
        docSubtotal: processed?.docSubtotal ?? extractedData?.docSubtotal ?? null,
        docTaxAmount: processed?.docTaxAmount ?? extractedData?.docTaxAmount ?? null,
        docTotal: processed?.docTotal ?? extractedData?.docTotal ?? null
    };
};

const importCatalogHandler = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
        
        console.log(`[IMPORT] Iniciando proceso para archivo: ${req.file.originalname} (${req.file.size} bytes)`);
        
        const { supplierId } = req.body;

        // 1. Guardar permanentemente la factura digitalizada
        const invoiceUrl = await InvoiceService.saveInvoiceFromPath(req.file.path, req.file.originalname);

        // 2. Extraer datos con OCR / IA
        const extractedItems = await getPDFService().parseCatalog(req.file.path);
        const rawList = Array.isArray(extractedItems) ? extractedItems : (extractedItems?.items || []);
        
        console.log(`[IMPORT] Extraídos ${rawList.length} registros del documento (Factura guardada en ${invoiceUrl})`);
        
        // 3. Vincular con productos
        const processed = await ProductService.processCatalogImport(req.user, extractedItems, supplierId);
        const payload = buildCatalogImportResponse(invoiceUrl, extractedItems, processed);
        
        // Limpiamos el archivo temporal
        if (fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch (e) {}
        
        console.log(`[IMPORT] Procesados exitosamente ${payload.items.length} renglones para el usuario`);

        res.json(payload);
    } catch (error) {
        console.error('Import catalog error:', error);
        if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch (e) {}
        res.status(500).json({ error: 'Error al procesar el documento: ' + error.message });
    }
};


/**
 * GET /imported-invoices - Lista el historial de facturas cargadas con respaldo digitalizado y detalle contable
 */
router.get('/imported-invoices', canImportCatalog, async (req, res) => {
    try {
        const { PurchaseOrder, Supplier } = require('../database/models');
        const { Op } = require('sequelize');
        const { companyId } = req.user;
        const { search, limit = 50, page = 1 } = req.query;
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limitNum;

        const whereCondition = {
            companyId,
            [Op.or]: [
                { invoiceUrl: { [Op.ne]: null } },
                { status: 'received' }
            ]
        };

        const { count, rows } = await PurchaseOrder.findAndCountAll({
            where: whereCondition,
            include: [{
                model: Supplier,
                as: 'Supplier',
                attributes: ['id', 'name', 'rif', 'phone']
            }],
            order: [['createdAt', 'DESC']],
            limit: limitNum,
            offset
        });

        let filteredRows = rows;
        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filteredRows = rows.filter(r => 
                (r.referenceNumber && r.referenceNumber.toLowerCase().includes(q)) ||
                (r.Supplier?.name && r.Supplier.name.toLowerCase().includes(q)) ||
                (r.Supplier?.rif && r.Supplier.rif.toLowerCase().includes(q))
            );
        }

        res.json({
            success: true,
            total: count,
            invoices: filteredRows.map(o => ({
                id: o.id,
                referenceNumber: o.referenceNumber || 'S/N',
                supplierName: o.Supplier?.name || 'Proveedor General',
                supplierRif: o.Supplier?.rif || null,
                supplierId: o.supplierId,
                date: o.arrivalDate || o.date || (o.createdAt ? o.createdAt.toISOString().split('T')[0] : null),
                totalUsd: Number(o.total || 0),
                totalVes: Number(o.totalVes || 0),
                exchangeRate: Number(o.exchangeRate || 1),
                paymentStatus: o.paymentStatus || 'paid',
                status: o.status,
                itemsCount: Array.isArray(o.items) ? o.items.length : 0,
                items: Array.isArray(o.items) ? o.items : [],
                invoiceUrl: o.invoiceUrl,
                notes: o.notes,
                createdAt: o.createdAt
            }))
        });
    } catch (err) {
        console.error('[IMPORTED INVOICES] Error:', err);
        res.status(500).json({ error: 'Error al consultar historial de facturas: ' + err.message });
    }
});

/**
 * POST /reparse-invoice - Re-extraer renglones y precios con IA desde una factura ya digitalizada
 */
router.post('/reparse-invoice', canImportCatalog, async (req, res) => {
    try {
        const { invoiceUrl, supplierId } = req.body || {};
        if (!invoiceUrl || typeof invoiceUrl !== 'string') {
            return res.status(400).json({ error: 'URL de factura inválida' });
        }

        const rawName = String(invoiceUrl || '').trim();
        if (!rawName || rawName.includes('\0') || rawName.includes('..')) {
            return res.status(400).json({ error: 'URL de factura inválida' });
        }
        const filename = path.basename(rawName);
        const invoicesDir = path.resolve(InvoiceService.getInvoicesDir());
        const fullPath = path.resolve(invoicesDir, filename);
        const rel = path.relative(invoicesDir, fullPath);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
            return res.status(403).json({ error: 'Ruta de factura fuera de directorio permitido' });
        }
        const accessCheck = await InvoiceService.assertInvoiceAccess(req.user, invoiceUrl);
        if (!accessCheck.allowed) {
            return res.status(accessCheck.status || 403).json({ error: accessCheck.error || 'Acceso denegado: la factura pertenece a otra empresa' });
        }

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'El archivo físico de la factura no existe en el servidor' });
        }

        console.log(`[REPARSE INVOICE] Re-procesando factura digitalizada: ${fullPath}`);
        const extractedData = await getPDFService().parseCatalog(fullPath);
        const processed = await ProductService.processCatalogImport(req.user, extractedData, supplierId);
        const payload = buildCatalogImportResponse(invoiceUrl, extractedData, processed);

        res.json(payload);
    } catch (err) {
        console.error('[REPARSE INVOICE] Error re-procesando factura:', err);
        res.status(500).json({ error: 'Error al extraer renglones de la factura: ' + err.message });
    }
});

router.post('/import-catalog', requirePermission('canCreateProducts'), upload.single('catalog'), importCatalogHandler);
router.post('/import_catalog', requirePermission('canCreateProducts'), upload.single('catalog'), importCatalogHandler);

/**
 * POST /apply-mapping - Transacción atómica: Costos, IVA, Stock, Kardex, Orden de Compra y Cuentas por Pagar
 */
router.post('/apply-mapping', requirePermission('canCreateProducts'), async (req, res) => {
    try {
        const {
            mappings,
            invoiceUrl,
            referenceNumber,
            supplierId,
            newSupplier,
            financialAction,
            paymentMethod,
            createPurchaseOrder,
            importMode,
            paymentStatus,
            invoiceDate,
            dueDate,
            exchangeRate,
            totalUsd,
            totalVes,
            notes
        } = req.body || {};

        if (!Array.isArray(mappings) || mappings.length === 0) {
            return res.status(400).json({ error: 'No se recibieron renglones aprobados para procesar' });
        }

        const isInventoryOnly = financialAction === 'INVENTORY_ONLY';
        const shouldCreateOrder = (importMode === 'CATALOG' || isInventoryOnly)
            ? false
            : Boolean(createPurchaseOrder || invoiceUrl);

        const resolvedPaymentStatus = financialAction === 'CREDIT' 
            ? 'unpaid' 
            : (financialAction === 'PAID' ? 'paid' : (paymentStatus || 'paid'));

        const result = await ProductService.applySupplierMapping(req.user, mappings, {
            returnDetails: true,
            importMode: importMode || (shouldCreateOrder ? 'INVOICE' : 'CATALOG'),
            createPurchaseOrder: shouldCreateOrder,
            invoiceUrl: invoiceUrl || null,
            referenceNumber: referenceNumber || null,
            supplierId: supplierId || null,
            newSupplier: newSupplier || null,
            paymentStatus: resolvedPaymentStatus,
            paymentMethod: paymentMethod || null,
            invoiceDate: invoiceDate || null,
            dueDate: dueDate || null,
            exchangeRate: exchangeRate || null,
            totalUsd: totalUsd || null,
            totalVes: totalVes || null,
            notes: notes || null
        });

        const io = req.app.get('io');
        if (io && result.updateCount > 0) {
            const compRoom = String(req.user.companyId || 'default');
            io.to(compRoom).emit('inventory_changed');
            if (result.creditCharged) {
                io.to(compRoom).emit('suppliers_updated');
            }
        }
        
        res.json({
            success: true,
            updateCount: result.updateCount,
            purchaseOrderId: result.purchaseOrderId,
            creditCharged: result.creditCharged,
            newSupplierBalance: result.newSupplierBalance
        });
    } catch (error) {
        console.error('Apply mapping error:', error);
        res.status(400).json({ error: error.message || 'Error al aplicar actualización' });
    }
});

/**
 * POST /import/excel - Import products from an Excel sheet (Base64)
 */
router.post('/import/excel', requirePermission('canCreateProducts'), async (req, res) => {
    try {
        const { base64 } = req.body;
        if (!base64) return res.status(400).json({ error: 'No se proporcionaron datos del archivo Excel' });

        const buffer = Buffer.from(base64, 'base64');
        const ExcelJS = getExcelJS();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet || sheet.rowCount < 2) {
            return res.status(400).json({ error: 'El archivo Excel está vacío o es inválido' });
        }

        const forbiddenHeaderKeys = new Set(['__proto__', 'constructor', 'prototype']);
        const headers = [];
        const headerRow = sheet.getRow(1);
        headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const rawHeader = String(cell?.text ?? cell?.value ?? '').trim();
            headers[colNumber] = (!rawHeader || forbiddenHeaderKeys.has(rawHeader)) ? null : rawHeader;
        });

        const data = [];
        const maxRows = Math.min(sheet.rowCount, 25000);
        for (let r = 2; r <= maxRows; r++) {
            const row = sheet.getRow(r);
            const rowObj = {};
            let hasValue = false;
            row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                const headerName = headers[colNumber];
                if (!headerName) return;
                let val = cell.value;
                if (val && typeof val === 'object') {
                    if (Object.prototype.hasOwnProperty.call(val, 'result')) val = val.result;
                    else if (Object.prototype.hasOwnProperty.call(val, 'text')) val = val.text;
                    else if (Array.isArray(val.richText)) val = val.richText.map(rt => rt.text || '').join('');
                }
                if (val !== null && val !== undefined && val !== '') {
                    rowObj[headerName] = val;
                    hasValue = true;
                }
            });
            if (hasValue) data.push(rowObj);
        }

        if (!data || data.length === 0) {
            return res.status(400).json({ error: 'El archivo Excel está vacío o es inválido' });
        }

        const { Product, BranchStock, StockMovement } = require('../database/models');
        const { sequelize } = require('../database/connection');
        const { generateRobustId } = require('../utils/helpers');

        let createdCount = 0;
        let updatedCount = 0;

        // Wrap the entire import inside a transaction for atomic and ultra-fast speed
        await sequelize.transaction(async (t) => {
            const { Branch } = require('../database/models');
            let dbBranch = null;
            if (req.user.activeBranchId && req.user.activeBranchId !== '1' && req.user.activeBranchId !== 'null' && req.user.activeBranchId !== 'undefined') {
                dbBranch = await Branch.findOne({ where: { id: req.user.activeBranchId, companyId: req.user.companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.findOne({ where: { companyId: req.user.companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.findOne({ where: { isMain: true }, transaction: t }) || await Branch.findOne({ transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.create({
                    id: generateRobustId(),
                    userId: req.user.id,
                    companyId: req.user.companyId,
                    name: 'Principal',
                    isMain: true,
                    isActive: true
                }, { transaction: t });
            }
            const activeBranchId = dbBranch.id;

            // 1. Extraer identificadores del Excel para búsqueda masiva
            const excelBarcodes = [];
            const excelNames = [];
            
            const processedRows = data.map(row => {
                const getVal = (possibleKeys) => {
                    for (const key of possibleKeys) {
                        const matchedKey = Object.keys(row).find(k => k.toLowerCase().trim() === key.toLowerCase().trim());
                        if (matchedKey) return row[matchedKey];
                    }
                    return null;
                };

                const id = getVal(['id', 'ID']);
                const name = getVal(['nombre', 'Nombre', 'name', 'Name']);
                const category = getVal(['categoria', 'Categoría', 'category', 'Category']) || 'General';
                const cost = parseFloat(getVal(['costo', 'Costo', 'cost', 'Cost'])) || 0;
                const price = parseFloat(getVal(['precio', 'Precio', 'price', 'Price'])) || 0;
                const stock = parseFloat(getVal(['stock', 'Stock', 'cantidad', 'Cantidad'])) || 0;
                const unit = getVal(['unidad', 'Unidad', 'unit', 'Unit']) || 'unidad';
                const minStock = parseFloat(getVal(['min_stock', 'Min_Stock', 'minStock', 'MinStock', 'mínimo', 'Minimo'])) || 0;
                const barcode = getVal(['barcode', 'Código de barras', 'Codigo', 'Código', 'barras']);

                if (name) excelNames.push(name);
                if (barcode) excelBarcodes.push(barcode);

                return { id, name, category, cost, price, stock, unit, minStock, barcode };
            }).filter(row => row.name);

            if (processedRows.length === 0) return;

            // 2. Buscar productos existentes de una sola vez
            const { Op } = require('sequelize');
            const existingProducts = await Product.findAll({
                where: {
                    companyId: req.user.companyId,
                    [Op.or]: [
                        { name: { [Op.in]: excelNames } },
                        ...(excelBarcodes.length > 0 ? [{ barcode: { [Op.in]: excelBarcodes } }] : [])
                    ]
                },
                include: [{ model: BranchStock, as: 'BranchStocks' }],
                transaction: t
            });

            const productMapByName = new Map();
            const productMapByBarcode = new Map();
            existingProducts.forEach(p => {
                productMapByName.set(p.name, p);
                if (p.barcode) productMapByBarcode.set(p.barcode, p);
            });

            // 3. Preparar arrays para BulkCreate
            const productsToUpsert = [];
            const branchStocksToUpsert = [];
            const stockMovementsToInsert = [];

            for (const row of processedRows) {
                let product = null;
                if (row.barcode && productMapByBarcode.has(row.barcode)) {
                    product = productMapByBarcode.get(row.barcode);
                } else if (productMapByName.has(row.name)) {
                    product = productMapByName.get(row.name);
                }

                if (product) {
                    // Update existing
                    productsToUpsert.push({
                        id: product.id,
                        name: row.name,
                        category: row.category,
                        cost: row.cost,
                        price: row.price,
                        stockUnit: row.unit,
                        minStock: row.minStock,
                        barcode: row.barcode || product.barcode,
                        companyId: req.user.companyId,
                        userId: req.user.id,
                        status: 'active'
                    });
                    
                    const branchStock = product.BranchStocks?.find(bs => bs.branchId === activeBranchId);
                    const stockBefore = branchStock ? Number(branchStock.quantity) : 0;
                    
                    branchStocksToUpsert.push({
                        productId: product.id,
                        branchId: activeBranchId,
                        quantity: row.stock,
                        companyId: req.user.companyId
                    });

                    if (row.stock !== stockBefore) {
                        stockMovementsToInsert.push({
                            id: generateRobustId(),
                            productId: product.id,
                            userId: req.user.id,
                            companyId: req.user.companyId,
                            type: 'ADJUSTMENT',
                            quantity: Math.abs(row.stock - stockBefore),
                            stockBefore,
                            stockAfter: row.stock,
                            reason: 'Actualización Masiva (Excel)',
                            referenceId: product.id,
                            date: new Date().toISOString()
                        });
                    }
                    updatedCount++;
                } else {
                    // Create new
                    const newId = row.id || generateRobustId();
                    productsToUpsert.push({
                        id: newId,
                        name: row.name,
                        category: row.category,
                        cost: row.cost,
                        price: row.price,
                        stockUnit: row.unit,
                        minStock: row.minStock,
                        barcode: row.barcode || null,
                        companyId: req.user.companyId,
                        userId: req.user.id,
                        status: 'active'
                    });

                    branchStocksToUpsert.push({
                        productId: newId,
                        branchId: activeBranchId,
                        quantity: row.stock,
                        companyId: req.user.companyId
                    });

                    if (row.stock > 0) {
                        stockMovementsToInsert.push({
                            id: generateRobustId(),
                            productId: newId,
                            userId: req.user.id,
                            companyId: req.user.companyId,
                            type: 'IN',
                            quantity: row.stock,
                            stockBefore: 0,
                            stockAfter: row.stock,
                            reason: 'Carga Inicial (Excel)',
                            referenceId: newId,
                            date: new Date().toISOString()
                        });
                    }
                    createdCount++;
                }
            }

            // 4. Ejecutar BulkCreates
            if (productsToUpsert.length > 0) {
                await Product.bulkCreate(productsToUpsert, {
                    updateOnDuplicate: ['name', 'category', 'cost', 'price', 'stockUnit', 'minStock', 'barcode', 'status'],
                    transaction: t
                });
            }

            if (branchStocksToUpsert.length > 0) {
                // SQLite require manual loop if bulk upsert is not fully supported with composite keys without unique indexes
                // But Sequelize handles updateOnDuplicate for sqlite natively via INSERT ON CONFLICT since SQLite 3.24
                for (const bs of branchStocksToUpsert) {
                    const existing = await BranchStock.findOne({ where: { productId: bs.productId, branchId: bs.branchId }, transaction: t });
                    if (existing) {
                        await existing.update({ quantity: bs.quantity }, { transaction: t });
                    } else {
                        await BranchStock.create(bs, { transaction: t });
                    }
                }
            }

            if (stockMovementsToInsert.length > 0) {
                await StockMovement.bulkCreate(stockMovementsToInsert, { transaction: t });
            }
        });

        const io = req.app.get('io');
        if (io && (createdCount > 0 || updatedCount > 0)) {
            cache.delPrefix('categories_');
            io.to(req.user.companyId).emit('inventory_changed');
        }

        res.json({ success: true, createdCount, updatedCount });
    } catch (error) {
        console.error('Excel import endpoint error:', error);
        res.status(500).json({ error: 'Error al importar datos de Excel: ' + error.message });
    }
});

/**
 * GET /:id/lots - List all lots for a product
 */
router.get('/:id/lots', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { ProductLot } = require('../database/models');
        const lots = await ProductLot.findAll({
            where: { productId: req.params.id, companyId: req.user.companyId },
            order: [['expirationDate', 'ASC']]
        });
        res.json(lots);
    } catch (error) {
        console.error('Get lots error:', error);
        res.status(500).json({ error: 'Error al obtener lotes' });
    }
});

/**
 * POST /:id/lots - Create a new lot for a product
 */
router.post('/:id/lots', requirePermission(['canManageInventory', 'canAdjustStock', 'canCreateProducts']), async (req, res) => {
    const { sequelize } = require('../database/connection');
    const t = await sequelize.transaction();
    try {
        const { ProductLot, Product, BranchStock, StockMovement } = require('../database/models');
        const { generateRobustId } = require('../utils/helpers');
        const precision = require('../utils/precision');
        
        const productId = req.params.id;
        const companyId = req.user.companyId;
        const { lotNumber, quantity, expirationDate, cost, branchId } = req.body;
        const lotQty = precision.round(Number(quantity) || 0, 3);
        const lotCost = precision.round(Number(cost) || 0);
        if (!Number.isFinite(lotQty) || lotQty <= 0) {
            await t.rollback();
            return res.status(400).json({ error: 'La cantidad del lote debe ser mayor a 0.' });
        }

        const product = await Product.findOne({ where: { id: productId, companyId }, lock: t.LOCK.UPDATE, transaction: t });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const lot = await ProductLot.create({
            id: generateRobustId(),
            companyId,
            productId,
            lotNumber: String(lotNumber || 'LOTE-' + Date.now()).trim(),
            quantity: lotQty,
            expirationDate: expirationDate || null,
            cost: lotCost,
            status: 'active'
        }, { transaction: t });

        const currentStock = precision.round(Number(product.stockQuantity || product.stock || 0), 3);
        const newTotalStock = precision.round(precision.add([currentStock, lotQty]), 3);

        // Add stock to product branch stock if branchId is provided
        const targetBranchId = branchId || req.user.activeBranchId || null;
        if (targetBranchId) {
            let bs = await BranchStock.findOne({ 
                where: { productId, branchId: targetBranchId, companyId },
                lock: t.LOCK.UPDATE,
                transaction: t 
            });
            if (bs) {
                const newBranchQty = precision.round(precision.add([Number(bs.quantity) || 0, lotQty]), 3);
                await bs.update({ quantity: newBranchQty }, { transaction: t });
            } else {
                await BranchStock.create({
                    productId,
                    branchId: targetBranchId,
                    companyId,
                    quantity: lotQty
                }, { transaction: t });
            }
        }

        // Kardex inmutable
        await StockMovement.create({
            id: generateRobustId(),
            productId,
            companyId,
            userId: req.user.id,
            branchId: targetBranchId,
            type: 'IN',
            quantity: lotQty,
            stockBefore: String(currentStock),
            stockAfter: String(newTotalStock),
            reason: `Nuevo lote agregado: ${lot.lotNumber}`,
            date: new Date().toISOString()
        }, { transaction: t });

        await product.update({ stock: String(newTotalStock), stockQuantity: String(newTotalStock) }, { transaction: t });

        await t.commit();
        res.status(201).json(lot);
    } catch (error) {
        if (t && !t.finished) await t.rollback();
        console.error('Create lot error:', error);
        res.status(500).json({ error: 'Error al crear lote: ' + error.message });
    }
});

// POST /products/transfer - Transferir stock entre sucursales
router.post('/transfer', requirePermission('canManageInventory'), async (req, res) => {
    const { sequelize, Product, BranchStock, StockMovement } = require('../database/models');
    const t = await sequelize.transaction();
    try {
        const companyId = req.user.companyId || 'default';
        const { productId, fromBranchId, toBranchId, quantity, reason } = req.body;
        const qty = Number(quantity);

        if (!productId || !fromBranchId || !toBranchId) {
            await t.rollback();
            return res.status(400).json({ error: 'Faltan parámetros obligatorios (productId, fromBranchId, toBranchId).' });
        }
        if (String(fromBranchId) === String(toBranchId)) {
            await t.rollback();
            return res.status(400).json({ error: 'La sucursal de origen y destino no pueden ser la misma.' });
        }
        if (!Number.isFinite(qty) || qty <= 0) {
            await t.rollback();
            return res.status(400).json({ error: 'La cantidad a transferir debe ser mayor a cero.' });
        }

        const product = await Product.findOne({ where: { id: productId, companyId }, transaction: t, lock: t.LOCK.UPDATE });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ error: 'Producto no encontrado.' });
        }

        let originStock = await BranchStock.findOne({
            where: { productId, branchId: fromBranchId, companyId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const currentOriginQty = Number(originStock ? originStock.quantity : 0);
        if (!originStock || currentOriginQty < qty) {
            await t.rollback();
            return res.status(400).json({ error: `Stock insuficiente en la sucursal origen (${currentOriginQty} disponibles).` });
        }

        const newOriginQty = Number((currentOriginQty - qty).toFixed(4));
        await originStock.update({ quantity: newOriginQty }, { transaction: t });

        let destStock = await BranchStock.findOne({
            where: { productId, branchId: toBranchId, companyId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const currentDestQty = Number(destStock ? destStock.quantity : 0);
        const newDestQty = Number((currentDestQty + qty).toFixed(4));

        if (destStock) {
            await destStock.update({ quantity: newDestQty }, { transaction: t });
        } else {
            destStock = await BranchStock.create({
                productId,
                branchId: toBranchId,
                companyId,
                quantity: newDestQty
            }, { transaction: t });
        }

        const nowIso = new Date().toISOString();
        const noteText = reason || 'Transferencia entre sucursales';

        await StockMovement.create({
            id: generateRobustId(),
            productId,
            companyId,
            userId: req.user.id,
            branchId: fromBranchId,
            type: 'OUT',
            category: 'transferencia',
            quantity: qty,
            stockBefore: String(currentOriginQty),
            stockAfter: String(newOriginQty),
            reason: `${noteText} (Hacia sucursal ${toBranchId})`,
            date: nowIso
        }, { transaction: t });

        await StockMovement.create({
            id: generateRobustId(),
            productId,
            companyId,
            userId: req.user.id,
            branchId: toBranchId,
            type: 'IN',
            category: 'transferencia',
            quantity: qty,
            stockBefore: String(currentDestQty),
            stockAfter: String(newDestQty),
            reason: `${noteText} (Desde sucursal ${fromBranchId})`,
            date: nowIso
        }, { transaction: t });

        await t.commit();
        res.json({
            success: true,
            message: 'Transferencia completada exitosamente.',
            fromBranchStock: newOriginQty,
            toBranchStock: newDestQty
        });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Transfer stock error:', error);
        res.status(500).json({ error: 'Error al transferir stock: ' + error.message });
    }
});

/**
 * CRUD de Variantes (Talla / Color / SKU) para vertical Boutique y Calzado
 */
router.get('/:id/variants', async (req, res) => {
    try {
        const { Product, VarianteProducto } = require('../database/models');
        const product = await Product.findOne({
            where: { id: req.params.id, companyId: req.user.companyId }
        });
        if (!product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        const variants = await VarianteProducto.findAll({
            where: { producto_id: product.id },
            order: [['talla', 'ASC'], ['color', 'ASC']]
        });
        res.json(variants);
    } catch (error) {
        console.error('Get product variants error:', error);
        res.status(500).json({ error: 'Error al obtener variantes del producto' });
    }
});

router.post('/:id/variants', requirePermission('canManageInventory', 'canCreateProducts'), async (req, res) => {
    const { Product, VarianteProducto } = require('../database/models');
    const { sequelize } = require('../database/connection');
    const { generateRobustId } = require('../utils/helpers');
    const t = await sequelize.transaction();
    try {
        const product = await Product.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const talla = String(req.body?.talla || '').trim().slice(0, 60);
        const color = String(req.body?.color || '').trim().slice(0, 60);
        if (!talla || !color) {
            await t.rollback();
            return res.status(400).json({ error: 'Talla y color son obligatorios' });
        }

        const stockNum = Number(req.body?.stock ?? 0);
        const extraPriceNum = Number(req.body?.precio_adicional ?? 0);
        if (!Number.isFinite(stockNum) || stockNum < 0) {
            await t.rollback();
            return res.status(400).json({ error: 'El stock de la variante debe ser un número mayor o igual a cero' });
        }
        if (!Number.isFinite(extraPriceNum) || extraPriceNum < 0) {
            await t.rollback();
            return res.status(400).json({ error: 'El precio adicional debe ser un número mayor o igual a cero' });
        }

        const skuVariante = req.body?.sku_variante
            ? String(req.body.sku_variante).trim().slice(0, 120)
            : `${product.barcode || product.id}-${talla}-${color}`.replace(/\s+/g, '-').toUpperCase();

        const created = await VarianteProducto.create({
            id: `var_${generateRobustId()}`,
            producto_id: product.id,
            talla,
            color,
            sku_variante: skuVariante,
            stock: precision.round(stockNum, 6),
            precio_adicional: precision.round(extraPriceNum, 6)
        }, { transaction: t });

        const allVariants = await VarianteProducto.findAll({
            where: { producto_id: product.id },
            transaction: t
        });
        const totalVariantStock = precision.round(
            precision.add(allVariants.map(v => Number(v.stock || 0))),
            6
        );
        await product.update({
            stockQuantity: String(totalVariantStock),
            stock: String(totalVariantStock)
        }, { transaction: t });

        await t.commit();
        const io = req.app.get('io');
        if (io) io.to(String(req.user.companyId)).emit('inventory_changed');
        res.status(201).json({ variant: created, totalStock: totalVariantStock });
    } catch (error) {
        await t.rollback();
        console.error('Create product variant error:', error);
        res.status(500).json({ error: 'Error al crear variante del producto' });
    }
});

router.put('/:id/variants/:variantId', requirePermission('canManageInventory', 'canCreateProducts'), async (req, res) => {
    const { Product, VarianteProducto } = require('../database/models');
    const { sequelize } = require('../database/connection');
    const t = await sequelize.transaction();
    try {
        const product = await Product.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const variant = await VarianteProducto.findOne({
            where: { id: req.params.variantId, producto_id: product.id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!variant) {
            await t.rollback();
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        const updates = {};
        if (req.body?.talla !== undefined) {
            const cleanTalla = String(req.body.talla).trim().slice(0, 60);
            if (!cleanTalla) {
                await t.rollback();
                return res.status(400).json({ error: 'La talla no puede quedar vacía' });
            }
            updates.talla = cleanTalla;
        }
        if (req.body?.color !== undefined) {
            const cleanColor = String(req.body.color).trim().slice(0, 60);
            if (!cleanColor) {
                await t.rollback();
                return res.status(400).json({ error: 'El color no puede quedar vacío' });
            }
            updates.color = cleanColor;
        }
        if (req.body?.sku_variante !== undefined) {
            updates.sku_variante = String(req.body.sku_variante).trim().slice(0, 120) || null;
        }
        if (req.body?.stock !== undefined) {
            const stockNum = Number(req.body.stock);
            if (!Number.isFinite(stockNum) || stockNum < 0) {
                await t.rollback();
                return res.status(400).json({ error: 'El stock de la variante debe ser mayor o igual a cero' });
            }
            updates.stock = precision.round(stockNum, 6);
        }
        if (req.body?.precio_adicional !== undefined) {
            const extraNum = Number(req.body.precio_adicional);
            if (!Number.isFinite(extraNum) || extraNum < 0) {
                await t.rollback();
                return res.status(400).json({ error: 'El precio adicional debe ser mayor o igual a cero' });
            }
            updates.precio_adicional = precision.round(extraNum, 6);
        }

        await variant.update(updates, { transaction: t });

        const allVariants = await VarianteProducto.findAll({
            where: { producto_id: product.id },
            transaction: t
        });
        const totalVariantStock = precision.round(
            precision.add(allVariants.map(v => Number(v.stock || 0))),
            6
        );
        await product.update({
            stockQuantity: String(totalVariantStock),
            stock: String(totalVariantStock)
        }, { transaction: t });

        await t.commit();
        const io = req.app.get('io');
        if (io) io.to(String(req.user.companyId)).emit('inventory_changed');
        res.json({ variant, totalStock: totalVariantStock });
    } catch (error) {
        await t.rollback();
        console.error('Update product variant error:', error);
        res.status(500).json({ error: 'Error al actualizar variante del producto' });
    }
});

router.delete('/:id/variants/:variantId', requirePermission('canManageInventory', 'canCreateProducts'), async (req, res) => {
    const { Product, VarianteProducto } = require('../database/models');
    const { sequelize } = require('../database/connection');
    const t = await sequelize.transaction();
    try {
        const product = await Product.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const variant = await VarianteProducto.findOne({
            where: { id: req.params.variantId, producto_id: product.id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!variant) {
            await t.rollback();
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        await variant.destroy({ transaction: t });

        const remaining = await VarianteProducto.findAll({
            where: { producto_id: product.id },
            transaction: t
        });
        if (remaining.length > 0) {
            const totalVariantStock = precision.round(
                precision.add(remaining.map(v => Number(v.stock || 0))),
                6
            );
            await product.update({
                stockQuantity: String(totalVariantStock),
                stock: String(totalVariantStock)
            }, { transaction: t });
        }

        await t.commit();
        const io = req.app.get('io');
        if (io) io.to(String(req.user.companyId)).emit('inventory_changed');
        res.json({ success: true, remainingCount: remaining.length });
    } catch (error) {
        await t.rollback();
        console.error('Delete product variant error:', error);
        res.status(500).json({ error: 'Error al eliminar variante del producto' });
    }
});

module.exports = router;
