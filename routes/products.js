const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { isAdmin } = require('../middleware/auth');
const ProductService = require('../services/ProductService');
const XLSX = require('xlsx');
const validate = require('../middleware/validate');
const { productSchema } = require('../schemas/productSchema');
const PDFService = require('../services/PDFService');
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

const upload = multer({ dest: getUploadPath() });

// --- PRODUCT ROUTES (v3.0.0 - Service Oriented) ---

/**
 * GET /categories - List all unique product categories
 */
router.get('/categories', async (req, res) => {
    try {
        const { Product } = require('../database/models');
        const categories = await Product.findAll({
            attributes: [
                [require('../database/connection').sequelize.fn('DISTINCT', require('../database/connection').sequelize.col('category')), 'category']
            ],
            where: { companyId: req.user?.companyId || 'default' }
        });
        const rawCategories = categories.map(c => c.category).filter(Boolean);
        
        // Helper to normalize: "golosinas" -> "Golosinas"
        const normalize = (str) => str.trim().charAt(0).toUpperCase() + str.trim().slice(1).toLowerCase();
        
        const uniqueCats = [...new Set(rawCategories.map(normalize))].sort();
        
        // Expert Bonus: Add the virtual category for the Master
        uniqueCats.push('🚫 Productos sin stock');
        res.json(uniqueCats);
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
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
        // Intercept the virtual category for the Master's out-of-stock list
        if (req.query.category === '🚫 Productos sin stock') {
            req.query.status = 'inactive';
            delete req.query.category;
        }

        const result = await ProductService.getAllProducts(req.user, req.query);
        if (req.query.limit > 0 || req.query.page) {
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
router.post('/', isAdmin, validate(productSchema), async (req, res) => {
    try {
        const product = await ProductService.createProduct(req.user, req.body);
        const io = req.app.get('io');
        if (io) io.to(req.user.companyId).emit('inventory_changed');
        res.status(201).json(product);
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Error al crear producto: ' + error.message });
    }
});

/**
 * PUT /:id - Update an existing product
 */
router.put('/:id', isAdmin, validate(productSchema), async (req, res) => {
    try {
        const updatedProduct = await ProductService.updateProduct(req.user, req.params.id, req.body);
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('inventory_changed');
            io.to(req.user.companyId).emit('product_updated', updatedProduct);
        }
        res.json({ message: 'Producto actualizado exitosamente' });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Error al actualizar producto: ' + error.message });
    }
});

/**
 * DELETE /:id - Delete a product
 */
router.delete('/:id', isAdmin, async (req, res, next) => {
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
router.post('/bulk-delete', isAdmin, async (req, res) => {
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
router.post('/bulk-stock-increase', isAdmin, async (req, res) => {
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
                    quantityToAdd = quantityToAdd * Number(product.unitsPerBulk || 1);
                }
                
                if (quantityToAdd <= 0) continue;
                
                // Update batch and expiration
                let updates = {};
                if (item.batchNumber) updates.batchNumber = item.batchNumber;
                if (item.expirationDate) updates.expirationDate = item.expirationDate;
                
                if (Object.keys(updates).length > 0) {
                    await product.update(updates, { transaction: t });
                }
                
                if (activeBranchId) {
                    const bs = await BranchStock.findOne({ where: { productId: product.id, branchId: activeBranchId }, transaction: t });
                    const stockBefore = bs ? Number(bs.quantity) : 0;
                    const stockAfter = stockBefore + quantityToAdd;
                    
                    if (bs) {
                        await bs.update({ quantity: stockAfter }, { transaction: t });
                    } else {
                        await BranchStock.create({
                            productId: product.id,
                            branchId: activeBranchId,
                            quantity: stockAfter,
                            companyId: req.user.companyId
                        }, { transaction: t });
                    }
                    
                    await StockMovement.create({
                        id: generateRobustId(),
                        productId: product.id,
                        userId: req.user.id,
                        companyId: req.user.companyId,
                        type: 'IN',
                        quantity: quantityToAdd,
                        stockBefore,
                        stockAfter,
                        reason: `Ingreso Masivo${item.batchNumber ? ' Lote: ' + item.batchNumber : ''}`,
                        referenceId: 'bulk-stock',
                        date: new Date().toISOString()
                    }, { transaction: t });
                }
            }
        });
        
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
router.post('/:id/generate-image', isAdmin, async (req, res) => {
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
router.post('/:id/search-images-ia', isAdmin, async (req, res) => {
    try {
        const result = await ProductService.searchImagesIA(req.params.id);
        res.json(result);
    } catch (error) {
        console.error('IA Image search error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /:id/select-image-ia - Descarga y asocia la imagen seleccionada
 */
router.post('/:id/select-image-ia', isAdmin, async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'Falta la URL de la imagen' });
        
        const result = await ProductService.downloadAndSetImage(req.params.id, imageUrl);
        const io = req.app.get('io');
        if (io) io.to(req.user.companyId).emit('inventory_changed');
        res.json(result);
    } catch (error) {
        console.error('IA Image download error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generar código de barras con IA
const generateBarcodeHandler = async (req, res) => {
    try {
        const result = await ProductService.updateBarcodeIA(req.params.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

router.post('/:id/generate-barcode', isAdmin, generateBarcodeHandler);
router.post('/:id/generate_barcode', isAdmin, generateBarcodeHandler);

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
 * POST /bulk-price-adjustment - Adjust prices for multiple products
 */
router.post('/bulk-price-adjustment', isAdmin, async (req, res) => {
    try {
        const count = await ProductService.bulkPriceAdjustment(req.user, req.body);
        res.json({ success: true, count });
    } catch (error) {
        console.error('Bulk price adjust error:', error);
        res.status(500).json({ error: 'Error al ajustar precios' });
    }
});

/**
 * GET /export/excel - Export products to XLSX
 */
router.get('/export/excel', async (req, res) => {
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

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=productos.xlsx');
        res.send(buffer);
    } catch (error) {
        console.error('Excel export error:', error);
        res.status(500).json({ error: 'Error al exportar a Excel' });
    }
});

/**
 * GET /:id - Get a single product with full details
 */
router.get('/:id', async (req, res) => {
    try {
        const { Product, Supplier, BranchStock, VarianteProducto } = require('../database/models');
        const product = await Product.findOne({
            where: { id: req.params.id, companyId: req.user.companyId },
            include: [
                { model: Supplier, attributes: ['name'] },
                { model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] },
                { model: VarianteProducto, as: 'Variantes' }
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
 * POST /upload-image - Upload a product image from a base64 string
 */
const getUploadDir = () => {
    let userDataPath = process.env.USER_DATA_PATH;
    if (!userDataPath && process.platform === 'win32') {
        let appData = path.join(process.env.APPDATA, 'americanpos');
        if (!fs.existsSync(appData)) appData = path.join(process.env.APPDATA, 'american-pos-backend');
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

router.post('/upload-image', async (req, res) => {
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

        res.json({ imageUri: `/product_images/${filename}` });
    } catch (error) {
        console.error('Upload product image error:', error);
        res.status(500).json({ error: 'Error al procesar la imagen' });
    }
});

/**
 * POST /import-catalog - Extract data from a supplier PDF (Supports both hyphen and underscore)
 */
const importCatalogHandler = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
        
        console.log(`[IMPORT] Iniciando proceso para archivo: ${req.file.originalname} (${req.file.size} bytes)`);
        
        const { supplierId } = req.body;
        const extractedItems = await PDFService.parseCatalog(req.file.path);
        
        console.log(`[IMPORT] Extraídos ${extractedItems.length} registros del PDF`);
        
        const results = await ProductService.processCatalogImport(req.user, extractedItems, supplierId);
        
        console.log(`[IMPORT] Pre-vinculación completada: ${results.length} sugerencias listas`);
        
        // Limpiamos el archivo temporal
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        
        res.json(results);
    } catch (error) {
        console.error('Import catalog error:', error);
        if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch (e) {}
        res.status(500).json({ error: 'Error al procesar el catálogo: ' + error.message });
    }
};

router.post('/import-catalog', isAdmin, upload.single('catalog'), importCatalogHandler);
router.post('/import_catalog', isAdmin, upload.single('catalog'), importCatalogHandler);


/**
 * POST /apply-mapping - Save mappings and update costs
 */
router.post('/apply-mapping', isAdmin, async (req, res) => {
    try {
        const { mappings } = req.body;
        if (!Array.isArray(mappings)) return res.status(400).json({ error: 'Mapeos inválidos' });
        
        const updateCount = await ProductService.applySupplierMapping(req.user, mappings);
        
        const io = req.app.get('io');
        if (io && updateCount > 0) io.to(req.user.companyId).emit('inventory_changed');
        
        res.json({ success: true, updateCount });
    } catch (error) {
        console.error('Apply mapping error:', error);
        res.status(500).json({ error: 'Error al aplicar actualización: ' + error.message });
    }
});

/**
 * POST /import/excel - Import products from an Excel sheet (Base64)
 */
router.post('/import/excel', isAdmin, async (req, res) => {
    try {
        const { base64 } = req.body;
        if (!base64) return res.status(400).json({ error: 'No se proporcionaron datos del archivo Excel' });

        const buffer = Buffer.from(base64, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

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
                        status: row.stock > 0 || product.status === 'active' ? 'active' : 'inactive'
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
                        status: row.stock > 0 ? 'active' : 'inactive'
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
router.post('/:id/lots', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { ProductLot, Product, BranchStock, StockMovement } = require('../database/models');
        const { generateRobustId } = require('../utils/helpers');
        
        const productId = req.params.id;
        const companyId = req.user.companyId;
        const { lotNumber, quantity, expirationDate, cost, branchId } = req.body;

        const product = await Product.findOne({ where: { id: productId, companyId } });
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

        const lot = await ProductLot.create({
            id: generateRobustId(),
            companyId,
            productId,
            lotNumber,
            quantity: Number(quantity) || 0,
            expirationDate: expirationDate || null,
            cost: Number(cost) || 0,
            status: 'active'
        });

        // Add stock to product branch stock if branchId is provided
        if (branchId) {
            let bs = await BranchStock.findOne({ where: { productId, branchId } });
            if (bs) {
                await bs.update({ quantity: bs.quantity + Number(quantity) });
            } else {
                await BranchStock.create({
                    productId,
                    branchId,
                    quantity: Number(quantity)
                });
            }
            
            await StockMovement.create({
                id: generateRobustId(),
                productId,
                companyId,
                userId: req.user.id,
                branchId,
                type: 'IN',
                quantity: Number(quantity),
                reason: `Nuevo lote agregado: ${lotNumber}`,
                date: new Date().toISOString()
            });
            
            // Sync product stock to total branch stock
            const allBs = await BranchStock.findAll({ where: { productId } });
            const totalStock = allBs.reduce((acc, curr) => acc + Number(curr.quantity), 0);
            await product.update({ stock: totalStock, stockQuantity: totalStock });
        }

        res.status(201).json(lot);
    } catch (error) {
        console.error('Create lot error:', error);
        res.status(500).json({ error: 'Error al crear lote' });
    }
});

module.exports = router;
