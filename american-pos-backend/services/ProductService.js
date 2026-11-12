
function saveAndReplicateProductImage(filename, buffer) {
    const path = require('path');
    const fs = require('fs');
    const candidates = [
        path.join(__dirname, '..', 'product_images'),
        process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'american-pos-backend', 'product_images') : null,
    ].filter(Boolean);

    const uniqueDirs = [...new Set(candidates)];
    uniqueDirs.forEach(dir => {
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, filename), buffer);
        } catch (e) {
            console.warn(`[IMAGE SAVE] Error guardando copia en ${dir}:`, e.message);
        }
    });

    // Replicar automáticamente a Supabase Storage en segundo plano
    try {
        const { uploadProductImageToSupabase } = require('./CloudStorageService');
        uploadProductImageToSupabase(filename, buffer);
    } catch (e) {
        console.warn('[IMAGE SAVE] No se pudo invocar CloudStorageService:', e.message);
    }

    return `/product_images/${filename}`;
}

const { Product, BranchStock, Supplier, AuditLog, StockMovement, SupplierProductMapping, Branch, VarianteProducto, ProductPresentation, WarehouseStock } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, readJson, readJsonAsync, getUserSettings } = require('../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../utils/precision');
const cacheService = require('../utils/cacheService');
const { SETTINGS_FILE } = require('../config/paths');
const AIService = require('./AIService');
const ImageSearchService = require('./ImageSearchService');
const BarcodeSearchService = require('./BarcodeSearchService');
// Native fetch is available in Node 18+ which is used in this project
const fs = require('fs');
const path = require('path');


class ProductService {
    /**
     * Evalúa si el usuario solicitante tiene autorización para visualizar costos de compra y márgenes.
     */
    canUserViewCosts(reqUser) {
        if (!reqUser || reqUser.id === 'lan-mobile-node' || reqUser.isUnauthenticatedLan === true) {
            return false;
        }
        if (reqUser.permissions && reqUser.permissions.canViewCosts !== undefined) {
            return Boolean(reqUser.permissions.canViewCosts);
        }
        const role = String(reqUser.role || '').toLowerCase();
        return ['admin', 'superadmin', 'owner', 'dueño', 'master', 'supervisor', 'inventory'].includes(role);
    }

    /**
     * Remueve campos financieros sensibles (costos y márgenes) para roles sin permiso o nodos LAN no autenticados.
     */
    sanitizeProductForUser(p, allowCosts) {
        if (!allowCosts && p) {
            delete p.cost;
            delete p.bulkCost;
            delete p.midBulkCost;
            delete p.margin;
            if (Array.isArray(p.Presentations)) {
                p.Presentations.forEach(pres => {
                    delete pres.cost;
                    delete pres.marginTarget;
                });
            }
        }
        return p;
    }

    /**
     * Get all products with filtering and branch stock mapping.
     */
    async getAllProducts(reqUser, queryParams) {
        const { companyId, activeBranchId } = reqUser;
        const { category, search, minimal, page = 1, limit = 0, supplierId, stockFilter, stockStatus, minPrice, maxPrice, status, es_controlado, expirationFilter } = queryParams;
        const currentStockFilter = stockFilter || stockStatus; 
        const isMinimal = minimal === 'true';

        const whereClause = { companyId };

        // Handle Status filtering (keep out-of-stock products active and visible in catalog)
        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = 'active';
        }

        if (category && category !== 'Todas') {
            whereClause.category = category;
        }

        if (supplierId) {
            whereClause.supplierId = supplierId;
        }

        if (es_controlado === 'true' || es_controlado === true) {
            whereClause.es_controlado = true;
        }

        if (expirationFilter === 'expiring') {
            const sixtyDaysFromNow = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            whereClause.expirationDate = {
                [Op.and]: [
                    { [Op.ne]: null },
                    { [Op.ne]: '' },
                    { [Op.lte]: sixtyDaysFromNow }
                ]
            };
        } else if (expirationFilter === 'expired') {
            const today = new Date().toISOString().split('T')[0];
            whereClause.expirationDate = {
                [Op.and]: [
                    { [Op.ne]: null },
                    { [Op.ne]: '' },
                    { [Op.lt]: today }
                ]
            };
        }

        const notServiceSql = "LOWER(TRIM(COALESCE(\"Product\".\"category\", ''))) <> 'servicios'";
        const isServiceSql = "LOWER(TRIM(COALESCE(\"Product\".\"category\", ''))) = 'servicios'";
        if (currentStockFilter === 'low') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.literal(notServiceSql),
                sequelize.literal('"Product"."stockQuantity" <= COALESCE("Product"."minStock", 0) AND "Product"."stockQuantity" > 0')
            ];
        } else if (currentStockFilter === 'out') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.literal(notServiceSql),
                { stockQuantity: { [Op.lte]: 0 } }
            ];
        } else if (currentStockFilter === 'in') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                {
                    [Op.or]: [
                        sequelize.literal(isServiceSql),
                        sequelize.literal('"Product"."stockQuantity" > COALESCE("Product"."minStock", 0)')
                    ]
                }
            ];
        }

        if (minPrice || maxPrice) {
            const priceCond = {};
            if (minPrice) priceCond[Op.gte] = parseFloat(minPrice);
            if (maxPrice) priceCond[Op.lte] = parseFloat(maxPrice);
            whereClause.price = priceCond;
        }

        if (search) {
            const searchTerm = String(search).trim();
            const safePattern = sequelize.escape(`%${searchTerm}%`);
            whereClause[Op.or] = [
                sequelize.literal(`public.immutable_unaccent(lower("Product"."name")) ILIKE public.immutable_unaccent(lower(${safePattern}))`),
                sequelize.literal(`COALESCE("Product"."barcode", '') ILIKE ${safePattern}`),
                sequelize.literal(`COALESCE("Product"."bulkBarcode", '') ILIKE ${safePattern}`),
                sequelize.literal(`COALESCE("Product"."midBulkBarcode", '') ILIKE ${safePattern}`),
                sequelize.literal(`public.immutable_unaccent(lower(COALESCE("Product"."principio_activo", ''))) ILIKE public.immutable_unaccent(lower(${safePattern}))`),
                sequelize.literal(`EXISTS (SELECT 1 FROM "product_presentaciones" pp WHERE pp."productId" = "Product"."id" AND COALESCE(pp."barcode", '') ILIKE ${safePattern})`)
            ];
        }

        // Master Performance Optimization: Lean payload for high-count inventory loading
        const isMasterFullView = queryParams.fullCatalog === 'true';
        
        const options = {
            where: whereClause,
            attributes: isMinimal ? [
                'id', 'name', 'price', 'cost', 'stockQuantity', 'stockUnits', 'imageUri', 'category', 'barcode', 'supplierId', 'isSoldByWeight', 'isFractional',
                'taxStatus', 'stockUnit', 'minStock', 'bulkUnitName', 'unitsPerBulk', 'bulkPrice', 'bulkPriceBs', 'bulkBarcode', 'midBulkUnitName', 'unitsPerMidBulk', 'midBulkCost', 'midBulkPrice', 'midBulkPriceBs', 'midBulkBarcode', 'allowNegative', 'batchNumber', 'expirationDate', 'es_controlado', 'principio_activo'
            ] : [
                'id', 'name', 'price', 'priceBs', 'barcode', 'imageUri',
                'stockQuantity', 'stockUnits', 'stockUnit', 'isSoldByWeight', 'category', 'status',
                'supplierId', 'cost', 'minStock', 'bulkUnitName', 'unitsPerBulk', 'bulkPrice', 'bulkPriceBs', 'bulkBarcode', 'midBulkUnitName', 'unitsPerMidBulk', 'midBulkCost', 'midBulkPrice', 'midBulkPriceBs', 'midBulkBarcode',
                'margin', 'bulkCost', 'taxStatus', 'allowNegative', 'batchNumber', 'expirationDate', 'es_controlado', 'principio_activo'
            ],
            include: [
                { model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] },
                { model: VarianteProducto, as: 'Variantes' },
                { model: ProductPresentation, as: 'Presentations' },
                ...(isMinimal ? [] : [{ model: Supplier, attributes: ['name'] }])
            ],
            order: [['name', 'ASC']],
            distinct: true
        };

        // Master Bypass: If fullCatalog is explicitly requested, we ignore limit/offset limits.
        if (limit > 0 && !isMasterFullView) {
            options.limit = parseInt(limit);
            options.offset = (parseInt(page) - 1) * parseInt(limit);
        }

        const { count, rows: productInstances } = await Product.findAndCountAll(options);
        const allowCosts = this.canUserViewCosts(reqUser);
        const products = productInstances.map(p => p.get({ plain: true }));

        // Precise Stock Aggregation (Crucial for Mobile Sync accuracy)
        products.forEach(p => {
            let totalPhysicalStock = 0;
            
            // Sum all branch records
            if (p.BranchStocks && p.BranchStocks.length > 0) {
                totalPhysicalStock = precision.add(p.BranchStocks.map(s => Number(s.quantity) || 0));
            }

            const masterStock = Number(p.stockQuantity || p.stock || 0);
            const hasBranchStocks = p.BranchStocks && p.BranchStocks.length > 0;
            
            // CRITICAL: Ensure stockQuantity is ALWAYS a number and correctly named for the mobile client
            p.stockQuantity = Number(hasBranchStocks ? totalPhysicalStock : (p.stockQuantity || p.stock || 0));
            if (String(p.category || '').trim().toLowerCase() === 'servicios') {
                p.isService = true;
                p.isSoldByWeight = false;
                p.isFractional = false;
                p.stockUnit = 'un';
                p.allowNegative = true;
                p.stockQuantity = 0;
                p.minStock = 0;
            }
            this.sanitizeProductForUser(p, allowCosts);
        });

        // Debug Log (will be visible in backend console)
        if (products.length > 0) {
            console.log(`[SYNC DEBUG] Sample Product: ${products[0].name} | Stock: ${products[0].stockQuantity}`);
        }

        return { products, total: count, page: parseInt(page), totalPages: limit > 0 ? Math.ceil(count / limit) : 1 };
    }

    /**
     * Create a product and log the audit.
     */
    async createProduct(reqUser, productData) {
        const { id: userId, companyId } = reqUser;
        const productId = generateRobustId();
        const presentationsToSync = Array.isArray(productData?.presentations) ? [...productData.presentations] : null;
        if (productData) delete productData.presentations;
        
        const t = await sequelize.transaction();
        try {
            // Find or create default branch if none exists for the company to prevent foreign key errors
            let dbBranch = null;
            if (reqUser.activeBranchId && reqUser.activeBranchId !== '1' && reqUser.activeBranchId !== 'null' && reqUser.activeBranchId !== 'undefined') {
                dbBranch = await Branch.findOne({ where: { id: reqUser.activeBranchId, companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.findOne({ where: { companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.create({
                    id: generateRobustId(),
                    userId,
                    companyId,
                    name: 'Principal',
                    isMain: true,
                    isActive: true
                }, { transaction: t });
            }
            const activeBranchId = dbBranch.id;

            if (productData) {
                if (typeof productData.barcode === 'string') productData.barcode = productData.barcode.trim() || null;
                if (typeof productData.bulkBarcode === 'string') productData.bulkBarcode = productData.bulkBarcode.trim() || null;
                if (typeof productData.midBulkBarcode === 'string') productData.midBulkBarcode = productData.midBulkBarcode.trim() || null;
                if (productData.bulkBarcode && productData.bulkBarcode === productData.barcode) productData.bulkBarcode = null;
                if (productData.midBulkBarcode && (productData.midBulkBarcode === productData.barcode || productData.midBulkBarcode === productData.bulkBarcode)) {
                    productData.midBulkBarcode = null;
                }
            }

            const newProduct = await Product.create({
                ...productData,
                id: productId,
                userId,
                companyId
            }, { transaction: t });

            const initialStock = Number(productData.stockQuantity) || 0;
            if (initialStock > 0) {
                await BranchStock.create({
                    productId,
                    branchId: activeBranchId,
                    quantity: initialStock,
                    companyId
                }, { transaction: t });

                await StockMovement.create({
                    id: generateRobustId(),
                    productId,
                    userId,
                    companyId,
                    type: 'IN',
                    quantity: initialStock,
                    stockBefore: 0,
                    stockAfter: initialStock,
                    reason: 'Carga Inicial (Creación)',
                    referenceId: productId,
                    date: new Date().toISOString()
                }, { transaction: t });
            }

            if (presentationsToSync && presentationsToSync.length > 0) {
                const usedPresBarcodes = new Set();
                if (newProduct.barcode) usedPresBarcodes.add(String(newProduct.barcode).trim());
                for (let idx = 0; idx < presentationsToSync.length; idx++) {
                    const pres = presentationsToSync[idx];
                    const factor = parseFloat(pres.factorConversion);
                    if (!factor || factor <= 0 || !pres.name) continue;
                    let cleanBarcode = typeof pres.barcode === 'string' && pres.barcode.trim() ? pres.barcode.trim() : null;
                    if (cleanBarcode) {
                        if (usedPresBarcodes.has(cleanBarcode)) {
                            cleanBarcode = null;
                        } else {
                            usedPresBarcodes.add(cleanBarcode);
                            await ProductPresentation.update(
                                { barcode: null },
                                { where: { barcode: cleanBarcode }, transaction: t }
                            );
                        }
                    }
                    await ProductPresentation.create({
                        id: pres.id || generateRobustId(),
                        productId,
                        name: pres.name.trim(),
                        factorConversion: factor,
                        price: Number(pres.price) || 0,
                        cost: Number(pres.cost) || 0,
                        barcode: cleanBarcode,
                        isDefaultPurchase: Boolean(pres.isDefaultPurchase),
                        isDefaultSale: Boolean(pres.isDefaultSale),
                        orderIndex: pres.orderIndex !== undefined ? pres.orderIndex : idx,
                        companyId
                    }, { transaction: t });
                }
            }

            await t.commit();
            const plainProduct = newProduct.get({ plain: true });
            await this._logAudit(reqUser, 'CREATE_PRODUCT', `Creado producto: ${plainProduct.name}`, productId, null, plainProduct);
            return plainProduct;
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * Update product with branch stock logic and audit.
     */
    async updateProduct(reqUser, productId, updateData) {
        const { companyId, id: userId } = reqUser;
        
        // Iniciamos transacción ACID
        const t = await sequelize.transaction();

        let presentationsToSync = null;
        if (updateData && updateData.presentations !== undefined) {
            presentationsToSync = Array.isArray(updateData.presentations) ? [...updateData.presentations] : [];
            delete updateData.presentations;
        }

        // Prevención de Mass Assignment: eliminar campos protegidos
        delete updateData.id;
        delete updateData.companyId;
        delete updateData.userId;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        try {
            // Find or create default branch if none exists for the company
            let dbBranch = null;
            if (reqUser.activeBranchId && reqUser.activeBranchId !== '1' && reqUser.activeBranchId !== 'null' && reqUser.activeBranchId !== 'undefined') {
                dbBranch = await Branch.findOne({ where: { id: reqUser.activeBranchId, companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.findOne({ where: { companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.create({
                    id: generateRobustId(),
                    userId,
                    companyId,
                    name: 'Principal',
                    isMain: true,
                    isActive: true
                }, { transaction: t });
            }
            const activeBranchId = dbBranch.id;

            const oldProduct = await Product.findOne({ 
                where: { id: productId, companyId },
                lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                transaction: t
            });
            
            if (!oldProduct) throw new Error('Producto no encontrado');

            oldProduct.BranchStocks = await BranchStock.findAll({
                where: { productId, companyId },
                transaction: t
            });

            // Handle Stock Adjustments
            if (updateData.stockQuantity !== undefined) {
                const totalBranchStock = oldProduct.BranchStocks && oldProduct.BranchStocks.length > 0
                    ? precision.add(oldProduct.BranchStocks.map(s => Number(s.quantity) || 0))
                    : 0;

                const currentStock = activeBranchId 
                    ? (oldProduct.BranchStocks?.find(s => s.branchId === activeBranchId)?.quantity || 0)
                    : (totalBranchStock > 0 ? totalBranchStock : (oldProduct.stockQuantity || 0));
                
                const diff = precision.subtract(updateData.stockQuantity, currentStock);

                if (diff !== 0) {
                    const stockBefore = Number(currentStock) || 0;
                    const stockAfter = Number(updateData.stockQuantity);

                    if (activeBranchId) {
                        const branchStockRecord = oldProduct.BranchStocks?.find(s => s.branchId === activeBranchId);
                        if (branchStockRecord) {
                            await BranchStock.update(
                                { quantity: stockAfter }, 
                                { where: { id: branchStockRecord.id }, transaction: t }
                            );
                        } else {
                            await BranchStock.create(
                                { branchId: activeBranchId, productId, quantity: stockAfter, companyId },
                                { transaction: t }
                            );
                        }
                    } else if (oldProduct.BranchStocks && oldProduct.BranchStocks.length > 0) {
                        // Global adjustment: keep the branch stocks in sync with the new total stock
                        const firstRecord = oldProduct.BranchStocks[0];
                        await BranchStock.update(
                            { quantity: stockAfter },
                            { where: { id: firstRecord.id }, transaction: t }
                        );
                        if (oldProduct.BranchStocks.length > 1) {
                            const otherIds = oldProduct.BranchStocks.slice(1).map(s => s.id);
                            await BranchStock.update(
                                { quantity: 0 },
                                { where: { id: { [Op.in]: otherIds } }, transaction: t }
                            );
                        }
                    }

                    await StockMovement.create({
                        id: generateRobustId(),
                        productId,
                        userId,
                        companyId,
                        type: 'ADJUSTMENT',
                        quantity: Math.abs(diff),
                        stockBefore,
                        stockAfter,
                        reason: activeBranchId ? `Ajuste Manual (Sucursal ${activeBranchId})` : 'Ajuste Manual',
                        referenceId: productId,
                        date: new Date().toISOString()
                    }, { transaction: t });
                }

                // Keep product active in catalog even when stock reaches 0
                const finalStock = Number(updateData.stockQuantity);
                if (finalStock <= 0 && !oldProduct.allowNegative) {
                    if (oldProduct.stockUnits !== null && oldProduct.stockUnits !== undefined && updateData.stockUnits === undefined) {
                        updateData.stockUnits = 0;
                    }
                }
                if (!updateData.status || updateData.status === 'inactive') {
                    updateData.status = 'active';
                }
            }

            // Logic for Audit diff
            const changes = this._getDiff(oldProduct, updateData);
            if (changes.length > 0) {
                // Not passing transaction to audit log to avoid failing the whole process just for a log, 
                // but wait, it's better to pass it so it rolls back if the main fails.
                await AuditLog.create({
                    id: generateRobustId(),
                    userId: reqUser.id,
                    companyId: reqUser.companyId,
                    action: 'PRODUCT_UPDATE',
                    description: `Actualizado ${oldProduct.name}: ${changes.join(', ')}`,
                    entityId: productId,
                    oldValue: JSON.stringify(oldProduct),
                    newValue: JSON.stringify(updateData),
                    timestamp: new Date().toISOString()
                }, { transaction: t }).catch(e => console.warn('AuditLog failed:', e.message));
            }

            if (updateData) {
                if (typeof updateData.barcode === 'string') updateData.barcode = updateData.barcode.trim() || null;
                if (typeof updateData.bulkBarcode === 'string') updateData.bulkBarcode = updateData.bulkBarcode.trim() || null;
                if (typeof updateData.midBulkBarcode === 'string') updateData.midBulkBarcode = updateData.midBulkBarcode.trim() || null;
                const effectiveBarcode = updateData.barcode !== undefined ? updateData.barcode : oldProduct.barcode;
                const effectiveBulkBarcode = updateData.bulkBarcode !== undefined ? updateData.bulkBarcode : oldProduct.bulkBarcode;
                if (effectiveBulkBarcode && effectiveBulkBarcode === effectiveBarcode) {
                    updateData.bulkBarcode = null;
                }
                if (updateData.midBulkBarcode && (updateData.midBulkBarcode === effectiveBarcode || updateData.midBulkBarcode === (updateData.bulkBarcode !== undefined ? updateData.bulkBarcode : oldProduct.bulkBarcode))) {
                    updateData.midBulkBarcode = null;
                }
            }

            const updatedProduct = await oldProduct.update(updateData, { transaction: t });

            if (presentationsToSync !== null) {
                await ProductPresentation.destroy({ where: { productId }, transaction: t });
                const usedPresBarcodes = new Set();
                if (updatedProduct.barcode) usedPresBarcodes.add(String(updatedProduct.barcode).trim());
                for (let idx = 0; idx < presentationsToSync.length; idx++) {
                    const pres = presentationsToSync[idx];
                    const factor = parseFloat(pres.factorConversion);
                    if (!factor || factor <= 0 || !pres.name) continue;
                    let cleanBarcode = typeof pres.barcode === 'string' && pres.barcode.trim() ? pres.barcode.trim() : null;
                    if (cleanBarcode) {
                        if (usedPresBarcodes.has(cleanBarcode)) {
                            cleanBarcode = null;
                        } else {
                            usedPresBarcodes.add(cleanBarcode);
                            await ProductPresentation.update(
                                { barcode: null },
                                { where: { barcode: cleanBarcode }, transaction: t }
                            );
                        }
                    }
                    await ProductPresentation.create({
                        id: pres.id || generateRobustId(),
                        productId,
                        name: pres.name.trim(),
                        factorConversion: factor,
                        price: Number(pres.price) || 0,
                        cost: Number(pres.cost) || 0,
                        barcode: cleanBarcode,
                        isDefaultPurchase: Boolean(pres.isDefaultPurchase),
                        isDefaultSale: Boolean(pres.isDefaultSale),
                        orderIndex: pres.orderIndex !== undefined ? pres.orderIndex : idx,
                        companyId
                    }, { transaction: t });
                }
            }
            
            await t.commit();
            return updatedProduct.get({ plain: true });

        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * Alias for bulk price adjustment (called by POST /products/bulk-edit)
     */
    async bulkEdit(reqUser, params) {
        return await this.bulkPriceAdjustment(reqUser, params);
    }

    /**
     * Bulk price adjustment.
     */
    async bulkPriceAdjustment(reqUser, params) {
        const { target, productIds, adjustmentType, direction, value } = params;
        const whereClause = { companyId: reqUser.companyId };

        if (target === 'selected' && productIds?.length > 0) {
            whereClause.id = { [Op.in]: productIds };
        }

        const products = await Product.findAll({ where: whereClause });
        const updates = products.map(p => {
            let newPrice = p.price || 0;
            
            if (adjustmentType === 'percentage') {
                const percentVal = precision.divide(value, 100);
                if (direction === 'increase') {
                    const multiplier = precision.add([1, percentVal]);
                    newPrice = precision.multiply(p.price || 0, multiplier);
                } else {
                    const multiplier = precision.subtract(1, percentVal);
                    newPrice = precision.multiply(p.price || 0, multiplier);
                }
            } else {
                newPrice = direction === 'increase' 
                    ? precision.add([p.price || 0, value]) 
                    : precision.subtract(p.price || 0, value);
            }
            
            newPrice = Math.max(0, precision.round(newPrice, 6));
            return p.update({ price: newPrice });
        });

        await Promise.all(updates);
        await this._logAudit(reqUser, 'PRODUCT_BULK_PRICE_ADJUST', `Ajuste masivo: ${direction} de ${value}${adjustmentType === 'percentage' ? '%' : '$'} para ${products.length} productos.`, 'BULK', null, null);
        
        return products.length;
    }

    /**
     * Get low stock with caching.
     */
    async getLowStockAlerts(companyId) {
        const cacheKey = `low_stock_${companyId}`;
        const cached = cacheService.get(cacheKey);
        if (cached) return cached;

        const products = await Product.findAll({
            where: {
                companyId,
                stockQuantity: { [Op.lte]: sequelize.col('minStock') },
                minStock: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'stockQuantity', 'minStock']
        });

        cacheService.set(cacheKey, products, 60);
        return products;
    }

    // Helper: Log Audit (protegido con SAVEPOINT para no abortar transacciones activas en PostgreSQL si el actor es Employee)
    async _logAudit(reqUser, action, description, entityId, oldVal, newVal, transaction = null) {
        const basePayload = {
            id: generateRobustId(),
            userId: reqUser?.id || null,
            companyId: reqUser?.companyId || null,
            action,
            description,
            entityId,
            oldValue: oldVal ? JSON.stringify(oldVal) : null,
            newValue: newVal ? JSON.stringify(newVal) : null,
            timestamp: new Date().toISOString()
        };

        try {
            if (transaction) {
                await sequelize.transaction({ transaction }, async (sp) => {
                    await AuditLog.create(basePayload, { transaction: sp });
                });
            } else {
                await AuditLog.create(basePayload);
            }
        } catch (e) {
            try {
                const fallbackPayload = { ...basePayload, id: generateRobustId(), userId: null };
                if (transaction) {
                    await sequelize.transaction({ transaction }, async (sp2) => {
                        await AuditLog.create(fallbackPayload, { transaction: sp2 });
                    });
                } else {
                    await AuditLog.create(fallbackPayload);
                }
            } catch (fallbackErr) {
                console.warn('AuditLog failed:', fallbackErr.message);
            }
        }
    }

    // Helper: Get field differences
    _getDiff(oldObj, newObj) {
        const fields = [
            'name', 'price', 'cost', 'category', 'barcode', 'stockQuantity', 'stockUnits', 'minStock', 
            'supplierId', 'taxStatus', 'bulkUnitName', 'unitsPerBulk', 'margin', 'bulkCost'
        ];
        const changes = [];
        fields.forEach(f => {
            if (newObj[f] !== undefined && String(newObj[f]) !== String(oldObj[f] || '')) {
                changes.push(`${f}: ${oldObj[f] || 'N/A'} -> ${newObj[f]}`);
            }
        });
        return changes;
    }

    /**
     * Delete a product and its associated stock.
     */
    async deleteProduct(companyId, productId) {
        const product = await Product.findOne({ where: { id: productId, companyId } });
        if (!product) throw new Error('Producto no encontrado');

        const t = await sequelize.transaction();
        try {
            // 1. Intentar borrar registros de inventario y mapeos vinculados
            await BranchStock.destroy({ where: { productId }, transaction: t });
            await StockMovement.destroy({ where: { productId }, transaction: t });
            await SupplierProductMapping.destroy({ where: { localProductId: productId }, transaction: t });
            
            // 2. Intentar borrar el producto principal
            await product.destroy({ transaction: t });
            
            await t.commit();
            return true;
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * Normaliza nombres de productos y extrae tokens y medidas (kg, g, l, ml, oz) para vinculación de alta precisión.
     */
    _tokenizeForCatalogMatch(rawName) {
        const normalized = String(rawName || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/(\d+),(\d+)/g, '$1.$2')
            .replace(/\b1000\s*(?:grs?|gr|g)\b/g, '1kg')
            .replace(/\b1000\s*(?:ml|cc)\b/g, '1l')
            .replace(/\b(\d+(?:\.\d+)?)\s*(?:kilos?|kgs?|kg)\b/g, '$1kg')
            .replace(/\b(\d+(?:\.\d+)?)\s*(?:gramos?|grs?|gr|g)\b/g, '$1g')
            .replace(/\b(\d+(?:\.\d+)?)\s*(?:litros?|lts?|lt|l)\b/g, '$1l')
            .replace(/\b(\d+(?:\.\d+)?)\s*(?:mililitros?|ml|cc)\b/g, '$1ml')
            .replace(/\b(\d+(?:\.\d+)?)\s*(?:onzas?|oz)\b/g, '$1oz')
            .replace(/\b1?\s*x\s*\d{1,4}\b/g, ' ')
            .replace(/[^a-z0-9.]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const stopWords = new Set([
            'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'para', 'por', 'en', 'un', 'una',
            'caja', 'bulto', 'bult', 'und', 'unid', 'unidad', 'unidades', 'paq', 'paquete', 'pac',
            'display', 'disp', 'dis', 'tira', 'fardo', 'fdo', 'pack', 'pcs', 'ctn', 'pet', 'env',
            'gravable', 'exento'
        ]);

        const measureRegex = /^\d+(?:\.\d+)?(?:kg|g|l|ml|oz)$/;
        const rawTokens = normalized.split(' ').filter(Boolean);
        const measures = [];
        const tokens = [];

        for (const tk of rawTokens) {
            if (measureRegex.test(tk)) {
                measures.push(tk);
                continue;
            }
            if (stopWords.has(tk)) continue;
            if (/^\d+$/.test(tk) && tk.length <= 2) continue;
            if (tk.length >= 2) tokens.push(tk);
        }

        return { normalized, tokens, measures };
    }

    /**
     * Process an imported catalog or invoice of products from a vendor.
     * Matches external names with existing mappings or suggests high-precision matches in O(N) memory.
     */
    async processCatalogImport(reqUser, extractedItems, supplierId = null) {
        const { companyId } = reqUser;
        const results = [];

        // 1. Extraer lista real de ítems y metadatos fiscales/contables
        const itemsList = Array.isArray(extractedItems) 
            ? extractedItems 
            : (Array.isArray(extractedItems?.items) ? extractedItems.items : []);
        
        const docCurrency = (Array.isArray(extractedItems) 
            ? 'USD' 
            : (extractedItems?.currency || 'USD')).toUpperCase().includes('BS') ? 'BS' : 'USD';
        
        const detectedDate = !Array.isArray(extractedItems) 
            ? (extractedItems?.invoiceDate || extractedItems?.date || null) 
            : null;

        const documentType = !Array.isArray(extractedItems) && extractedItems?.documentType
            ? String(extractedItems.documentType).toUpperCase()
            : 'INVOICE';

        const referenceNumber = !Array.isArray(extractedItems) ? (extractedItems?.referenceNumber || null) : null;
        const docSubtotal = !Array.isArray(extractedItems) && extractedItems?.docSubtotal != null ? Number(extractedItems.docSubtotal) : null;
        const docTaxAmount = !Array.isArray(extractedItems) && extractedItems?.docTaxAmount != null ? Number(extractedItems.docTaxAmount) : null;
        const docTotal = !Array.isArray(extractedItems) && extractedItems?.docTotal != null ? Number(extractedItems.docTotal) : null;
        
        let rate = !Array.isArray(extractedItems) && extractedItems?.exchangeRate 
            ? Number(extractedItems.exchangeRate) 
            : null;
        
        let rateSource = !Array.isArray(extractedItems) && extractedItems?.rateSource 
            ? extractedItems.rateSource 
            : 'BCV';

        // Obtener tasa activa de venta del POS desde settings
        let posExchangeRate = 1;
        try {
            const allSettings = await readJsonAsync(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            posExchangeRate = parseFloat(userSettings.exchangeRate || 1) || 1;
        } catch (e) {
            posExchangeRate = 1;
        }

        // Si la moneda es Bolívares y no vino tasa impresa, obtenerla del BCV histórico/actual o ajustes
        if (docCurrency === 'BS' && (!rate || rate <= 0)) {
            try {
                const BCVRateService = require('./BCVRateService');
                const bcvRes = await BCVRateService.getOfficialRate(detectedDate);
                if (bcvRes?.rate && bcvRes.rate > 0) {
                    rate = Number(bcvRes.rate);
                    rateSource = bcvRes.source || 'BCV';
                }
            } catch (rateErr) {
                console.warn('[processCatalogImport] No se pudo obtener tasa oficial BCV:', rateErr.message);
            }

            if (!rate || rate <= 0) {
                rate = posExchangeRate;
                rateSource = 'Ajustes';
            }
        } else if (docCurrency === 'USD' && (!rate || rate <= 0)) {
            rate = posExchangeRate > 1 ? posExchangeRate : 1;
        }

        // 2. Auto-detectar Proveedor por RIF o Razón Social si no fue preseleccionado
        let effectiveSupplierId = (supplierId && supplierId !== 'null' && supplierId !== '') ? String(supplierId) : null;
        let detectedSupplierName = !Array.isArray(extractedItems) ? (extractedItems?.supplierName || null) : null;

        if (!effectiveSupplierId && !Array.isArray(extractedItems) && (extractedItems?.supplierRif || extractedItems?.supplierName)) {
            try {
                const companySuppliers = await Supplier.findAll({
                    where: { companyId },
                    attributes: ['id', 'name', 'rif'],
                    raw: true
                });
                if (extractedItems.supplierRif) {
                    const cleanTargetRif = String(extractedItems.supplierRif).replace(/[^A-Z0-9]/gi, '').toUpperCase();
                    const byRif = companySuppliers.find(s => {
                        const sRif = String(s.rif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                        return sRif && cleanTargetRif && (sRif.includes(cleanTargetRif) || cleanTargetRif.includes(sRif));
                    });
                    if (byRif) {
                        effectiveSupplierId = byRif.id;
                        detectedSupplierName = byRif.name;
                    }
                }
                if (!effectiveSupplierId && extractedItems.supplierName) {
                    const cleanTargetName = String(extractedItems.supplierName).toLowerCase().trim();
                    const byName = companySuppliers.find(s => {
                        const sName = String(s.name || '').toLowerCase().trim();
                        return sName && sName.length >= 4 && (sName.includes(cleanTargetName) || cleanTargetName.includes(sName));
                    });
                    if (byName) {
                        effectiveSupplierId = byName.id;
                        detectedSupplierName = byName.name;
                    }
                }
            } catch (supErr) {
                console.warn('[processCatalogImport] Aviso buscando proveedor automático:', supErr.message);
            }
        }

        // 3. Cargar mapeos previos de la empresa y catálogo activo en 2 consultas únicas (cero N+1)
        const [existingMappings, companyProducts] = await Promise.all([
            SupplierProductMapping.findAll({
                include: [{ 
                    model: Product, 
                    as: 'Product',
                    where: { companyId },
                    required: true,
                    attributes: ['id', 'name', 'cost', 'price', 'barcode', 'unitsPerBulk', 'margin', 'taxStatus', 'stockQuantity']
                }]
            }),
            Product.findAll({
                where: { companyId },
                attributes: ['id', 'name', 'cost', 'price', 'barcode', 'unitsPerBulk', 'margin', 'taxStatus', 'stockQuantity'],
                raw: true
            })
        ]);

        const specificMappingMap = new Map();
        const globalMappingMap = new Map();
        existingMappings.forEach(m => {
            if (!m.Product) return;
            const key = String(m.externalName || '').trim().toLowerCase();
            if (!key) return;
            if (effectiveSupplierId && String(m.supplierId || '') === effectiveSupplierId) {
                specificMappingMap.set(key, m.Product);
            }
            if (!globalMappingMap.has(key)) {
                globalMappingMap.set(key, m.Product);
            }
        });

        // Pre-indexar catálogo de la empresa para matching instantáneo y exacto
        const barcodeIndex = new Map();
        const exactNormIndex = new Map();
        const indexedCatalog = companyProducts.map(prod => {
            const parsed = this._tokenizeForCatalogMatch(prod.name);
            if (prod.barcode) {
                barcodeIndex.set(String(prod.barcode).trim(), prod);
            }
            if (parsed.normalized && !exactNormIndex.has(parsed.normalized)) {
                exactNormIndex.set(parsed.normalized, prod);
            }
            return {
                prod,
                normalized: parsed.normalized,
                tokenSet: new Set(parsed.tokens),
                tokens: parsed.tokens,
                measures: parsed.measures
            };
        });

        const buildMatchedDto = (p) => ({
            id: p.id,
            name: p.name,
            cost: Number(p.cost || 0),
            currentCost: Number(p.cost || 0),
            price: Number(p.price || 0),
            barcode: p.barcode || null,
            unitsPerBulk: Number(p.unitsPerBulk || 1),
            margin: Number(p.margin || 0),
            taxStatus: p.taxStatus || 'gravable',
            stockQuantity: Number(p.stockQuantity || 0)
        });

        for (const item of itemsList) {
            if (!item.externalName || typeof item.externalName !== 'string') continue;

            const nameToMatch = item.externalName.trim();
            const lowerKey = nameToMatch.toLowerCase();

            const rawPrice = precision.parseNumericInput(item.price ?? item.cost ?? 0);
            const isExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
            const taxRate = item.taxRate !== undefined ? Number(item.taxRate) : (isExempt ? 0 : 16);
            const taxStatus = isExempt ? 'exento' : 'gravable';
            const suggestedQuantity = Math.max(1, parseInt(item.suggestedQuantity || 1, 10) || 1);
            const purchasedQuantity = Math.max(0, precision.parseNumericInput(item.purchasedQuantity ?? (documentType === 'CATALOG' ? 0 : 1)));

            // Precisión de 6 decimales en costos base USD y 2 decimales en Bolívares
            const basePriceBs = docCurrency === 'BS'
                ? precision.round(rawPrice, 2)
                : (rate > 0 ? precision.round(precision.multiply(rawPrice, rate), 2) : 0);
            const basePriceUsd = docCurrency === 'BS' 
                ? (rate > 0 ? precision.round(precision.divide(rawPrice, rate), 6) : rawPrice) 
                : precision.round(rawPrice, 6);

            const baseItemData = {
                externalName: nameToMatch,
                barcode: item.barcode || null,
                purchasedQuantity,
                price: basePriceUsd,
                basePrice: basePriceUsd,
                basePriceBs,
                rawPriceBs: basePriceBs,
                suggestedQuantity,
                isExempt,
                taxRate,
                taxStatus
            };

            // Nivel 1: Mapeo histórico aprendido del proveedor o de la empresa
            const matchedFromSupplierMap = specificMappingMap.get(lowerKey);
            const matchedFromGlobalMap = !matchedFromSupplierMap ? globalMappingMap.get(lowerKey) : null;
            if (matchedFromSupplierMap || matchedFromGlobalMap) {
                const targetProd = matchedFromSupplierMap || matchedFromGlobalMap;
                results.push({
                    ...baseItemData,
                    matchedProduct: buildMatchedDto(targetProd),
                    confidence: matchedFromSupplierMap ? 100 : 98
                });
                continue;
            }

            // Nivel 2: Código de barras exacto o nombre normalizado idéntico
            const itemTokens = this._tokenizeForCatalogMatch(nameToMatch);
            const byBarcode = item.barcode ? barcodeIndex.get(String(item.barcode).trim()) : null;
            const byExactNorm = !byBarcode && itemTokens.normalized ? exactNormIndex.get(itemTokens.normalized) : null;
            if (byBarcode || byExactNorm) {
                results.push({
                    ...baseItemData,
                    matchedProduct: buildMatchedDto(byBarcode || byExactNorm),
                    confidence: byBarcode ? 99 : 95
                });
                continue;
            }

            // Nivel 3: Similitud inteligente por tokens y verificación estricta de medida/gramaje
            let bestCandidate = null;
            let bestScore = 0;

            if (itemTokens.tokens.length > 0) {
                for (const entry of indexedCatalog) {
                    if (entry.tokens.length === 0) continue;

                    // Si ambos especifican gramaje/volumen (ej. 2L vs 1.5L) y ninguno coincide, descartar para evitar falsos cruces
                    if (itemTokens.measures.length > 0 && entry.measures.length > 0) {
                        const sharesMeasure = itemTokens.measures.some(m => entry.measures.includes(m));
                        if (!sharesMeasure) continue;
                    }

                    let matchedCount = 0;
                    for (const tk of itemTokens.tokens) {
                        if (entry.tokenSet.has(tk)) {
                            matchedCount += 1;
                        } else if (tk.length >= 4) {
                            const partialHit = entry.tokens.some(et => et.length >= 4 && (et.startsWith(tk) || tk.startsWith(et)));
                            if (partialHit) matchedCount += 0.8;
                        }
                    }

                    if (matchedCount === 0) continue;

                    const unionSize = new Set([...itemTokens.tokens, ...entry.tokens]).size || 1;
                    const jaccard = matchedCount / unionSize;
                    const coverageExternal = matchedCount / itemTokens.tokens.length;
                    const coverageLocal = matchedCount / entry.tokens.length;
                    let score = (jaccard * 0.45) + (Math.max(coverageExternal, coverageLocal) * 0.35) + (Math.min(coverageExternal, coverageLocal) * 0.20);

                    if (itemTokens.measures.length > 0 && entry.measures.some(m => itemTokens.measures.includes(m))) {
                        score += 0.12;
                    }

                    // Requerir al menos 2 tokens coincidentes si el nombre tiene varias palabras y el único match es genérico
                    if (matchedCount < 1.5 && (itemTokens.tokens.length >= 2 && entry.tokens.length >= 2) && score < 0.65) {
                        continue;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        bestCandidate = entry.prod;
                    }
                }
            }

            if (bestCandidate && bestScore >= 0.56) {
                results.push({
                    ...baseItemData,
                    matchedProduct: buildMatchedDto(bestCandidate),
                    confidence: bestScore >= 0.88 ? 92 : 70
                });
            } else {
                results.push({
                    ...baseItemData,
                    matchedProduct: null,
                    confidence: 0
                });
            }
        }

        // Estructura híbrida compatible con consumidores legacy y modernos
        results.items = results;
        results.currency = docCurrency;
        results.rate = rate;
        results.posExchangeRate = posExchangeRate;
        results.invoiceDate = detectedDate;
        results.rateSource = rateSource;
        results.documentType = documentType;
        results.referenceNumber = referenceNumber;
        results.detectedSupplierId = effectiveSupplierId;
        results.detectedSupplierName = detectedSupplierName;
        results.docSubtotal = docSubtotal;
        results.docTaxAmount = docTaxAmount;
        results.docTotal = docTotal;

        return results;
    }

    /**
     * Search products for manual linking (compatible with PostgreSQL and SQLite)
     */
    async searchProductsForLink(reqUser, search) {
        const { companyId } = reqUser;
        const searchTerm = (search || '').trim();
        if (!searchTerm) return [];

        const isPostgres = sequelize.getDialect() === 'postgres';
        const searchCondition = isPostgres
            ? {
                [Op.or]: [
                    { name: { [Op.iLike]: `%${searchTerm}%` } },
                    { barcode: { [Op.iLike]: `%${searchTerm}%` } }
                ]
            }
            : {
                [Op.or]: [
                    sequelize.where(sequelize.fn('LOWER', sequelize.col('name')), { [Op.like]: `%${searchTerm.toLowerCase()}%` }),
                    sequelize.where(sequelize.fn('LOWER', sequelize.fn('COALESCE', sequelize.col('barcode'), '')), { [Op.like]: `%${searchTerm.toLowerCase()}%` })
                ]
            };
        
        const products = await Product.findAll({
            where: {
                companyId,
                ...searchCondition
            },
            attributes: ['id', 'name', 'cost', 'price', 'barcode', 'unitsPerBulk', 'margin', 'taxStatus', 'stockQuantity'],
            limit: 25
        });

        return products.map(p => {
            const plain = p.get({ plain: true });
            const cleanCost = Number(plain.cost || 0);
            return {
                ...plain,
                cost: cleanCost,
                currentCost: cleanCost,
                price: Number(plain.price || 0),
                unitsPerBulk: Number(plain.unitsPerBulk || 1),
                margin: Number(plain.margin || 0),
                stockQuantity: Number(plain.stockQuantity || 0)
            };
        });
    }

    /**
     * Registra o actualiza de forma idempotente el vínculo Nombre Proveedor -> Producto Local
     * sin disparar choques ON CONFLICT en PostgreSQL ni duplicar filas con supplierId NULL.
     */
    async _saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, transaction) {
        const whereClause = {
            externalName: cleanExternalName,
            supplierId: finalSupplierId
        };
        const existing = await SupplierProductMapping.findOne({
            where: whereClause,
            transaction
        });
        if (existing) {
            await existing.update({
                localProductId: finalLocalProductId,
                lastUpdated: new Date()
            }, { transaction });
        } else {
            await SupplierProductMapping.create({
                externalName: cleanExternalName,
                localProductId: finalLocalProductId,
                supplierId: finalSupplierId,
                lastUpdated: new Date()
            }, { transaction });
        }
    }

    /**
     * Apply the approved mappings, update product costs/IVA/stock, and optionally close PurchaseOrder + Accounts Payable atomically.
     */
    async applySupplierMapping(reqUser, mappings, invoiceOptions = {}) {
        const { companyId, id: userId } = reqUser;
        let updateCount = 0;
        const resolvedOrderItems = [];

        const t = await sequelize.transaction();
        try {
            // 1. Resolver sucursal activa para Kardex y BranchStock
            let dbBranch = null;
            if (reqUser.activeBranchId && reqUser.activeBranchId !== '1' && reqUser.activeBranchId !== 'null' && reqUser.activeBranchId !== 'undefined') {
                dbBranch = await Branch.findOne({ where: { id: reqUser.activeBranchId, companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.findOne({ where: { companyId }, transaction: t });
            }
            if (!dbBranch) {
                dbBranch = await Branch.create({
                    id: generateRobustId(),
                    userId,
                    companyId,
                    name: 'Principal',
                    isMain: true,
                    isActive: true
                }, { transaction: t });
            }
            const activeBranchId = dbBranch.id;

            // 2. Obtener tasa de cambio activa del POS para el PVP en Bs
            const allSettings = await readJsonAsync(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const posRate = parseFloat(userSettings.exchangeRate || 1) || 1;

            let headerSupplierId = (invoiceOptions?.supplierId && invoiceOptions.supplierId !== 'null' && invoiceOptions.supplierId !== '')
                ? String(invoiceOptions.supplierId)
                : null;

            // Auto-crear proveedor si fue detectado por OCR y aprobado por el usuario
            if (!headerSupplierId && invoiceOptions?.newSupplier?.name) {
                const cleanName = String(invoiceOptions.newSupplier.name).trim();
                const cleanRif = invoiceOptions.newSupplier.rif ? String(invoiceOptions.newSupplier.rif).trim() : null;

                let existing = null;
                if (cleanRif) {
                    existing = await Supplier.findOne({ where: { companyId, rif: cleanRif }, transaction: t });
                }
                if (!existing && cleanName) {
                    existing = await Supplier.findOne({ where: { companyId, name: cleanName }, transaction: t });
                }

                if (existing) {
                    headerSupplierId = existing.id;
                } else {
                    const newSup = await Supplier.create({
                        id: generateRobustId(),
                        name: cleanName,
                        rif: cleanRif,
                        phone: invoiceOptions.newSupplier.phone ? String(invoiceOptions.newSupplier.phone).trim() : null,
                        contact: invoiceOptions.newSupplier.contact ? String(invoiceOptions.newSupplier.contact).trim() : null,
                        companyId,
                        userId,
                        creditBalance: 0,
                        isActive: true
                    }, { transaction: t });
                    headerSupplierId = newSup.id;
                }
            }
            const isInvoiceMode = invoiceOptions?.importMode === 'INVOICE' || invoiceOptions?.createPurchaseOrder === true;
            const refLabel = invoiceOptions?.referenceNumber ? `Factura ${invoiceOptions.referenceNumber}` : 'Importador';

            for (const map of mappings) {
                try {
                    const {
                        externalName,
                        localProductId,
                        price,
                        supplierId,
                        quantity = 1,
                        purchasedQuantity,
                        margin,
                        newPrice,
                        isNew,
                        initialStock,
                        imageUri,
                        barcode,
                        taxStatus,
                        isExempt,
                        taxRate
                    } = map;

                    const isNewProduct = isNew === true || String(isNew) === 'true';
                    const finalSupplierId = (supplierId && supplierId !== 'null' && supplierId !== '')
                        ? String(supplierId)
                        : headerSupplierId;
                    const cleanExternalName = String(externalName || 'DESCONOCIDO').trim();
                    let finalLocalProductId = (localProductId && localProductId !== 'null') ? String(localProductId) : null;

                    // Precisión exacta de 6 decimales con VortexMathEngine
                    const safeBulkCost = Math.max(0, precision.round(precision.parseNumericInput(price), 6));
                    const unitQuantity = Math.max(1, precision.parseNumericInput(quantity) || 1);
                    const unitCost = precision.round(precision.divide(safeBulkCost, unitQuantity), 6);

                    const itemIsExempt = isExempt === true || taxStatus === 'exento' || (taxRate !== undefined && Number(taxRate) === 0);
                    const resolvedTaxStatus = itemIsExempt ? 'exento' : 'gravable';
                    const stockToAdd = isInvoiceMode ? Math.max(0, precision.round(precision.parseNumericInput(initialStock), 6)) : 0;
                    const packsPurchased = Math.max(0, precision.parseNumericInput(purchasedQuantity ?? (isInvoiceMode ? 1 : 0)));

                    const computeSalesPrice = (effMargin, fallbackPrice = 0) => {
                        if (newPrice !== undefined && newPrice !== null && precision.parseNumericInput(newPrice) > 0) {
                            const explicitPvp = precision.parseNumericInput(newPrice);
                            return explicitPvp < 0.10 ? precision.round(explicitPvp, 4) : precision.round(explicitPvp, 2);
                        }
                        if (unitCost > 0) {
                            const multiplier = precision.add([1, precision.divide(effMargin, 100)]);
                            const rawPvp = precision.multiply(unitCost, multiplier);
                            return rawPvp < 0.10 ? precision.round(rawPvp, 4) : precision.round(rawPvp, 2);
                        }
                        return fallbackPrice;
                    };

                    // RAMA A: Producto Nuevo (creación limpia sin doble suma de stock)
                    if (isNewProduct) {
                        const newId = generateRobustId();
                        const updatedMargin = (margin !== undefined && margin !== null && !isNaN(parseFloat(margin)))
                            ? precision.round(parseFloat(margin), 4)
                            : 30;
                        const updatedPrice = computeSalesPrice(updatedMargin, 0);
                        const updatedPriceBs = precision.round(precision.multiply(updatedPrice, posRate), 2);

                        const newProduct = await Product.create({
                            id: newId,
                            name: cleanExternalName,
                            barcode: barcode ? String(barcode).trim() : null,
                            cost: unitCost,
                            price: updatedPrice,
                            priceBs: updatedPriceBs,
                            bulkCost: safeBulkCost,
                            unitsPerBulk: unitQuantity,
                            margin: updatedMargin,
                            companyId,
                            userId,
                            category: 'General',
                            stockUnit: 'unidad',
                            taxStatus: resolvedTaxStatus,
                            supplierId: finalSupplierId,
                            imageUri: imageUri || null,
                            status: 'active',
                            stockQuantity: stockToAdd,
                            stock: stockToAdd
                        }, { transaction: t });
                        
                        finalLocalProductId = newProduct.id;

                        if (stockToAdd > 0 && activeBranchId) {
                            await BranchStock.create({
                                productId: newId,
                                branchId: activeBranchId,
                                quantity: stockToAdd,
                                companyId
                            }, { transaction: t });
                            
                            await StockMovement.create({
                                id: generateRobustId(),
                                productId: newId,
                                userId,
                                companyId,
                                type: 'IN',
                                quantity: stockToAdd,
                                stockBefore: 0,
                                stockAfter: stockToAdd,
                                reason: `Carga Inicial (${refLabel})`,
                                referenceId: invoiceOptions?.referenceNumber || newId,
                                date: new Date().toISOString()
                            }, { transaction: t });
                        }

                        await this._saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, t);

                        await this._logAudit(
                            reqUser,
                            'PRODUCT_CREATED_IMPORT',
                            `Nuevo por Importación: ${cleanExternalName}`,
                            finalLocalProductId,
                            { cost: 0, price: 0, stock: 0, taxStatus: null },
                            { cost: unitCost, margin: updatedMargin, price: updatedPrice, priceBs: updatedPriceBs, stock: stockToAdd, taxStatus: resolvedTaxStatus },
                            t
                        );

                        resolvedOrderItems.push({
                            productId: finalLocalProductId,
                            name: cleanExternalName,
                            purchasedQuantity: packsPurchased > 0 ? packsPurchased : (stockToAdd > 0 ? precision.round(precision.divide(stockToAdd, unitQuantity), 4) : 1),
                            unitsPerBulk: unitQuantity,
                            quantity: stockToAdd > 0 ? stockToAdd : unitQuantity,
                            bulkCost: safeBulkCost,
                            cost: unitCost,
                            taxStatus: resolvedTaxStatus,
                            subtotal: precision.round(precision.multiply(safeBulkCost, packsPurchased > 0 ? packsPurchased : 1), 2)
                        });

                        updateCount++;
                        continue;
                    }

                    // RAMA B: Producto Existente
                    if (!finalLocalProductId) continue;

                    await this._saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, t);

                    const product = await Product.findOne({ 
                        where: { id: finalLocalProductId, companyId },
                        include: [{ model: BranchStock, as: 'BranchStocks' }],
                        transaction: t
                    });

                    if (product) {
                        const oldCost = product.cost;
                        const oldPrice = product.price;
                        const oldPriceBs = product.priceBs;
                        const oldMargin = product.margin;
                        const oldTaxStatus = product.taxStatus;

                        const updatedMargin = (margin !== undefined && margin !== null && !isNaN(parseFloat(margin)))
                            ? precision.round(parseFloat(margin), 4)
                            : Number(product.margin || 0);
                        const updatedPrice = computeSalesPrice(updatedMargin, Number(product.price || 0));
                        const updatedPriceBs = precision.round(precision.multiply(updatedPrice, posRate), 2);

                        const updateData = { 
                            bulkCost: safeBulkCost, 
                            unitsPerBulk: unitQuantity,
                            cost: unitCost,
                            margin: updatedMargin,
                            price: updatedPrice,
                            priceBs: updatedPriceBs,
                            taxStatus: resolvedTaxStatus
                        };

                        if (finalSupplierId) {
                            updateData.supplierId = finalSupplierId;
                        }
                        if (imageUri) {
                            updateData.imageUri = imageUri;
                        }

                        if (stockToAdd > 0) {
                            const currentGlobalStock = Number(product.stockQuantity ?? product.stock ?? 0);
                            const newGlobalStock = precision.round(precision.add([currentGlobalStock, stockToAdd]), 6);
                            updateData.status = 'active';
                            updateData.stockQuantity = String(newGlobalStock);
                            updateData.stock = String(newGlobalStock);
                            
                            if (activeBranchId) {
                                const branchStock = product.BranchStocks?.find(s => s.branchId === activeBranchId);
                                const stockBefore = branchStock ? Number(branchStock.quantity) : 0;
                                const stockAfter = precision.round(precision.add([stockBefore, stockToAdd]), 6);

                                if (branchStock) {
                                    await branchStock.update({ quantity: stockAfter }, { transaction: t });
                                } else {
                                    await BranchStock.create({
                                        productId: finalLocalProductId,
                                        branchId: activeBranchId,
                                        quantity: stockAfter,
                                        companyId
                                    }, { transaction: t });
                                }

                                await StockMovement.create({
                                    id: generateRobustId(),
                                    productId: finalLocalProductId,
                                    userId,
                                    companyId,
                                    type: 'IN',
                                    quantity: stockToAdd,
                                    stockBefore: currentGlobalStock,
                                    stockAfter: newGlobalStock,
                                    reason: `Recepción Mercancía (${refLabel})`,
                                    referenceId: invoiceOptions?.referenceNumber || finalLocalProductId,
                                    date: new Date().toISOString()
                                }, { transaction: t });
                            }
                        }

                        await product.update(updateData, { transaction: t });
                        updateCount++;

                        resolvedOrderItems.push({
                            productId: finalLocalProductId,
                            name: product.name || cleanExternalName,
                            purchasedQuantity: packsPurchased > 0 ? packsPurchased : (stockToAdd > 0 ? precision.round(precision.divide(stockToAdd, unitQuantity), 4) : 1),
                            unitsPerBulk: unitQuantity,
                            quantity: stockToAdd > 0 ? stockToAdd : unitQuantity,
                            bulkCost: safeBulkCost,
                            cost: unitCost,
                            taxStatus: resolvedTaxStatus,
                            subtotal: precision.round(precision.multiply(safeBulkCost, packsPurchased > 0 ? packsPurchased : 1), 2)
                        });

                        await this._logAudit(
                            reqUser,
                            'COST_UPDATE_IMPORT',
                            `Importación (${refLabel}): ${product.name}`,
                            finalLocalProductId,
                            { cost: oldCost, margin: oldMargin, price: oldPrice, priceBs: oldPriceBs, taxStatus: oldTaxStatus },
                            { cost: unitCost, margin: updatedMargin, price: updatedPrice, priceBs: updatedPriceBs, taxStatus: resolvedTaxStatus },
                            t
                        );
                    }
                } catch (error) {
                    console.error('[IMPORT ERROR] Falla en item:', map.externalName, error);
                    throw error;
                }
            }

            // 3. Cierre Contable Atómico: Orden de Compra Recibida + Cuentas por Pagar (si aplica)
            let createdPurchaseOrderId = null;
            let creditCharged = false;
            let newSupplierBalance = null;

            if (isInvoiceMode && invoiceOptions?.createPurchaseOrder && resolvedOrderItems.length > 0) {
                const { PurchaseOrder, SupplierCreditHistory } = require('../database/models');
                const paymentStatus = invoiceOptions.paymentStatus === 'unpaid' ? 'unpaid' : 'paid';

                if (paymentStatus === 'unpaid' && !headerSupplierId) {
                    throw new Error('Debes seleccionar un Proveedor para registrar la factura a Crédito (Cuentas por Pagar).');
                }

                const calculatedTotalUsd = resolvedOrderItems.reduce(
                    (acc, it) => precision.round(precision.add([acc, it.subtotal || 0]), 2),
                    0
                );
                const explicitTotalUsd = precision.parseNumericInput(invoiceOptions.totalUsd);
                const finalTotalUsd = explicitTotalUsd > 0 ? precision.round(explicitTotalUsd, 2) : calculatedTotalUsd;

                const invRate = precision.parseNumericInput(invoiceOptions.exchangeRate) > 0
                    ? precision.round(precision.parseNumericInput(invoiceOptions.exchangeRate), 6)
                    : posRate;
                const explicitTotalVes = precision.parseNumericInput(invoiceOptions.totalVes);
                const finalTotalVes = explicitTotalVes > 0
                    ? precision.round(explicitTotalVes, 2)
                    : precision.round(precision.multiply(finalTotalUsd, invRate), 2);

                const arrivalDate = invoiceOptions.invoiceDate || new Date().toISOString().split('T')[0];
                const dueDate = paymentStatus === 'unpaid' ? (invoiceOptions.dueDate || null) : null;
                const refNo = String(invoiceOptions.referenceNumber || '').trim() || `IMP-${Date.now().toString().slice(-6)}`;
                const orderId = generateRobustId();

                await PurchaseOrder.create({
                    id: orderId,
                    userId,
                    companyId,
                    supplierId: headerSupplierId,
                    date: arrivalDate,
                    arrivalDate,
                    expectedDate: dueDate || arrivalDate,
                    dueDate,
                    exchangeRate: invRate,
                    status: 'received',
                    receivedAt: new Date().toISOString(),
                    referenceNumber: refNo,
                    invoiceUrl: invoiceOptions.invoiceUrl || null,
                    paymentStatus,
                    items: resolvedOrderItems,
                    notes: invoiceOptions.notes || `Recepción procesada desde Importador (${resolvedOrderItems.length} renglones)`,
                    total: finalTotalUsd,
                    totalVes: finalTotalVes
                }, { transaction: t });

                createdPurchaseOrderId = orderId;

                // Si la factura es a Crédito ("unpaid"), cargar automáticamente la Cuenta por Pagar al Proveedor
                if (paymentStatus === 'unpaid' && headerSupplierId && finalTotalUsd > 0) {
                    const supplier = await Supplier.findOne({
                        where: { id: headerSupplierId, companyId },
                        transaction: t
                    });
                    if (!supplier) {
                        throw new Error('El proveedor seleccionado no existe o no pertenece a esta empresa.');
                    }

                    const oldBalance = Number(supplier.creditBalance) || 0;
                    newSupplierBalance = precision.round(precision.add([oldBalance, finalTotalUsd]), 2);
                    await supplier.update({ creditBalance: newSupplierBalance }, { transaction: t });

                    await SupplierCreditHistory.create({
                        id: generateRobustId(),
                        supplierId: headerSupplierId,
                        userId,
                        companyId,
                        timestamp: new Date().toISOString(),
                        type: 'charge',
                        amount: finalTotalUsd,
                        balanceAfter: newSupplierBalance,
                        description: `Factura ${refNo} (Tasa: ${invRate} Bs/$) - Recepción Importador (${resolvedOrderItems.length} ítems)`,
                        paymentMethod: 'credit',
                        purchaseOrderId: orderId,
                        referenceNumber: refNo,
                        invoiceUrl: invoiceOptions.invoiceUrl || null,
                        arrivalDate,
                        dueDate,
                        exchangeRate: invRate
                    }, { transaction: t });

                    creditCharged = true;
                } else if (paymentStatus === 'paid' && headerSupplierId && finalTotalUsd > 0) {
                    // Si la factura fue pagada de Contado, registrar en el historial de compras solventes del proveedor
                    const supplier = await Supplier.findOne({
                        where: { id: headerSupplierId, companyId },
                        transaction: t
                    });
                    const currentBalance = Number(supplier?.creditBalance || 0);
                    const payMethod = invoiceOptions.paymentMethod || 'cash';
                    const chargeId = generateRobustId();

                    await SupplierCreditHistory.create({
                        id: chargeId,
                        supplierId: headerSupplierId,
                        userId,
                        companyId,
                        timestamp: new Date().toISOString(),
                        type: 'charge',
                        amount: finalTotalUsd,
                        balanceAfter: currentBalance,
                        description: `Factura ${refNo} (Contado / Tasa: ${invRate} Bs/$) - Recepción (${resolvedOrderItems.length} ítems)`,
                        paymentMethod: payMethod,
                        purchaseOrderId: orderId,
                        referenceNumber: refNo,
                        invoiceUrl: invoiceOptions.invoiceUrl || null,
                        arrivalDate,
                        dueDate: arrivalDate,
                        exchangeRate: invRate
                    }, { transaction: t });

                    await SupplierCreditHistory.create({
                        id: generateRobustId(),
                        supplierId: headerSupplierId,
                        userId,
                        companyId,
                        timestamp: new Date().toISOString(),
                        type: 'payment',
                        amount: finalTotalUsd,
                        balanceAfter: currentBalance,
                        description: `Liquidación Contado (${payMethod}) Factura ${refNo}`,
                        paymentMethod: payMethod,
                        purchaseOrderId: orderId,
                        referenceNumber: refNo,
                        invoiceUrl: invoiceOptions.invoiceUrl || null,
                        arrivalDate,
                        dueDate: arrivalDate,
                        exchangeRate: invRate
                    }, { transaction: t });
                }
            }

            await t.commit();

            // Invalidar cachés de catálogo y categorías tras confirmar transacción
            cacheService.delPrefix('categories_');
            cacheService.delPrefix('ai_catalog_');

            if (invoiceOptions && Object.keys(invoiceOptions).length > 0) {
                return {
                    updateCount,
                    updatedCount: updateCount,
                    purchaseOrderId: createdPurchaseOrderId,
                    creditCharged,
                    newSupplierBalance
                };
            }
            return updateCount;
        } catch (error) {
            await t.rollback();
            console.error('[IMPORT TRANSACTION ROLLBACK] La importación fue revertida debido a un error:', error.message);
            throw error;
        }
    }

    /**
     * Genera una imagen para un producto usando el buscador de Bing.
     */
    async generateImageIA(productId) {
        try {
            const product = await Product.findByPk(productId);
            if (!product) throw new Error('Producto no encontrado');

            console.log(`[IA IMAGE] Buscando imagen real para: ${product.name}`);
            
            // 1. Generar query optimizado con Gemini (pasamos también la categoría si existe)
            const searchQuery = await AIService.generateProductSearchQuery(product.name, product.category);
            
            // 2. Buscar URL real usando el servicio de búsqueda robótica (ahora retorna un array de candidatas)
            const imageUrls = await ImageSearchService.findProductImageUrl(searchQuery);
            
            if (!imageUrls || imageUrls.length === 0) {
                throw new Error('No se encontró ninguna imagen válida en la búsqueda');
            }

            let buffer = null;
            let successUrl = null;

            for (const imageUrl of imageUrls) {
                try {
                    console.log(`[IA IMAGE] Intentando descargar imagen desde: ${imageUrl}`);
                    const response = await fetch(imageUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                        }
                    });
                    
                    if (response.ok) {
                        const contentType = response.headers.get('content-type') || '';
                        if (!contentType.toLowerCase().startsWith('image/')) {
                            console.warn(`[IA IMAGE] URL devolvió un tipo no válido (${contentType}), omitiendo: ${imageUrl}`);
                            continue;
                        }
                        
                        const arrayBuffer = await response.arrayBuffer();
                        buffer = Buffer.from(arrayBuffer);
                        successUrl = imageUrl;
                        break; // Stop trying if successful
                    } else {
                        console.warn(`[IA IMAGE] Error ${response.status} al descargar: ${imageUrl}`);
                    }
                } catch (err) {
                    console.warn(`[IA IMAGE] Excepción al descargar ${imageUrl}:`, err.message);
                }
            }

            if (!buffer) {
                throw new Error(`Las restricciones del servidor (ej. Error 403) bloquearon la descarga de todas las imágenes candidatas.`);
            }
            
            // Prepare storage & replicate to all active image directories
            const filename = `ai_product_${productId}_${Date.now()}.jpg`;
            const imageUri = saveAndReplicateProductImage(filename, buffer);
            await product.update({ imageUri, imageUrl: null });

            return { imageUri };
        } catch (error) {
            console.error('[IA IMAGE] Error fatal:', error.message);
            throw new Error('No se pudo generar la imagen con la IA: ' + error.message);
        }
    }

    /**
     * Busca imágenes candidatas con IA y las devuelve sin descargar.
     */
    async searchImagesIA(productId, fallbackName = '', fallbackCategory = '') {
        try {
            let name = (fallbackName || '').trim();
            let category = (fallbackCategory || '').trim();

            if (productId && productId !== 'new' && !productId.toString().startsWith('local-')) {
                const product = await Product.findByPk(productId);
                if (product) {
                    name = name || product.name;
                    category = category || product.category;
                }
            }

            if (!name) {
                throw new Error('Ingresa el nombre del producto primero para buscar su imagen con IA');
            }

            console.log(`[IA IMAGE] Buscando imágenes candidatas para: "${name}" (${category || 'General'})`);
            
            let imageUrls = null;

            // 1. Búsqueda Directa por Nombre del Producto (Infalible y Ultra-rápida)
            try {
                imageUrls = await ImageSearchService.findProductImageUrl(name);
            } catch (e) {
                console.warn('[IA IMAGE] Fallo búsqueda por nombre directo:', e.message);
            }

            // 2. Fallback: Query Generado por IA
            if (!imageUrls || imageUrls.length === 0) {
                let searchQuery = name;
                try {
                    searchQuery = await AIService.generateProductSearchQuery(name, category);
                    if (searchQuery && searchQuery !== name) {
                        console.log(`[IA IMAGE] Reintentando con query IA: "${searchQuery}"`);
                        imageUrls = await ImageSearchService.findProductImageUrl(searchQuery);
                    }
                } catch (e) {}
            }
            
            // 3. Fallback: Nombre Simplificado (Removiendo medidas o variantes)
            if (!imageUrls || imageUrls.length === 0) {
                const cleanName = name.replace(/lata|roja|azul|verde|paquete|caja|\b\d+(g|gr|kg|ml|l|oz)\b/gi, '').trim();
                if (cleanName && cleanName.length >= 3 && cleanName !== name) {
                    console.log(`[IA IMAGE] Reintentando búsqueda simplificada: "${cleanName}"`);
                    try {
                        imageUrls = await ImageSearchService.findProductImageUrl(cleanName);
                    } catch (e) {}
                }
            }
            
            if (!imageUrls || imageUrls.length === 0) {
                throw new Error('No se encontraron imágenes candidatas para este producto en la web. Puedes subir una manualmente o colocar su URL.');
            }

            return { images: imageUrls };
        } catch (error) {
            console.error('[IA IMAGE SEARCH] Error:', error.message);
            throw new Error(error.message);
        }
    }

    /**
     * Descarga la imagen seleccionada y la asigna al producto.
     */
    async downloadAndSetImage(productId, imageUrl, fallbackName = '', fallbackCategory = '') {
        try {
            let product = null;
            if (productId && productId !== 'new' && !productId.toString().startsWith('local-')) {
                product = await Product.findByPk(productId);
            }

            console.log(`[IA IMAGE] Intentando descargar imagen seleccionada desde: ${imageUrl}`);
            
            const axios = require('axios');
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                },
                timeout: 15000
            });
            
            const buffer = Buffer.from(response.data);

            const filename = `ai_product_${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
            const imageUri = saveAndReplicateProductImage(filename, buffer);
            if (product) {
                await product.update({ imageUri, imageUrl: imageUri });
            }

            return { imageUri, imageUrl: imageUri };
        } catch (error) {
            console.error('[IA IMAGE DOWNLOAD] Error:', error.message);
            throw new Error('Fallo al descargar la imagen elegida: ' + error.message);
        }
    }

    /**
     * Busca y actualiza el código de barras de un producto usando IA.
     */
    async updateBarcodeIA(productId) {
        try {
            const product = await Product.findByPk(productId);
            if (!product) throw new Error('Producto no encontrado');

            console.log(`[IA BARCODE] Buscando código para: ${product.name}`);

            // 1. Generar query optimizado con Gemini
            const searchQuery = await AIService.generateBarcodeSearchQuery(product.name, product.category);

            // 2. Buscar código real usando el servicio de búsqueda robótica
            let barcode = await BarcodeSearchService.findProductBarcode(searchQuery);

            // 3. Contingencia: Si falla, usamos Visión Computacional + IA (Gemini 3.1 Pro)
            if (!barcode) {
                console.log(`[IA BARCODE] Búsqueda robótica falló. Intentando análisis visual e inferencia experta...`);
                
                let imageData = null;
                if (product.imageUri) {
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        
                        let userDataPath = process.env.USER_DATA_PATH;
                        if (!userDataPath && process.platform === 'win32') {
                             let appData = path.join(process.env.APPDATA, 'americanpos');
                             if (!fs.existsSync(appData)) appData = path.join(process.env.APPDATA, 'american-pos-backend');
                             if (fs.existsSync(appData)) userDataPath = appData;
                        }
                        const uploadDir = userDataPath ? path.join(userDataPath, 'product_images') : path.join(__dirname, '..', 'product_images');
                        const filename = product.imageUri.split('/').pop();
                        const filePath = path.join(uploadDir, filename);
                        
                        if (fs.existsSync(filePath)) {
                            const buffer = fs.readFileSync(filePath);
                            const extension = filename.split('.').pop().toLowerCase();
                            let mimeType = 'image/jpeg';
                            if (extension === 'png') mimeType = 'image/png';
                            if (extension === 'webp') mimeType = 'image/webp';
                            
                            imageData = {
                                 data: buffer.toString('base64'),
                                 mimeType
                            };
                            console.log(`[IA BARCODE] Imagen cargada para análisis visual (${mimeType}).`);
                        }
                    } catch (err) {
                        console.error('[IA BARCODE] Ignorando error al cargar imagen:', err.message);
                    }
                }

                barcode = await AIService.estimateBarcode(product.name, imageData);
            }

            if (!barcode) {
                throw new Error('No se encontró ningún código de barras válido en la búsqueda ni en la estimación');
            }

            console.log(`[IA BARCODE] Código encontrado/estimado: ${barcode}`);

            // 4. Actualizar producto en DB
            await product.update({ barcode });

            return { barcode };
        } catch (error) {
            console.error('[IA BARCODE] Error:', error.message);
            throw new Error('No se pudo encontrar el código de barras: ' + error.message);
        }
    }


    /**
     * Registrar baja / merma / avería / ajuste de stock con trazabilidad,
     * soporte de N-Presentaciones (factorConversion) y asiento contable automático.
     */
    async recordWaste(reqUser, productId, body) {
        const { companyId, activeBranchId } = reqUser;
        const { 
            quantity, 
            reason = 'rotura', 
            notes = '', 
            responsibleName = '', 
            presentationId = null,
            warehouseId = null 
        } = body;

        const qtyNum = parseFloat(quantity);
        if (isNaN(qtyNum) || qtyNum <= 0) {
            throw new Error('La cantidad de merma debe ser un número mayor a 0');
        }

        return await sequelize.transaction(async (t) => {
            const product = await Product.findOne({
                where: { id: productId, companyId },
                transaction: t,
                lock: true
            });

            if (!product) {
                throw new Error('Producto no encontrado');
            }

            // Factor de conversión si viene de una presentación
            let factor = 1;
            let presentation = null;
            if (presentationId) {
                presentation = await ProductPresentation.findOne({
                    where: { id: presentationId, productId, companyId },
                    transaction: t
                });
                if (presentation && presentation.factorConversion) {
                    factor = parseFloat(presentation.factorConversion) || 1;
                }
            } else if (body.factorConversion) {
                factor = parseFloat(body.factorConversion) || 1;
            }

            const baseUnits = qtyNum * factor;
            const currentStock = parseFloat(product.stockQuantity ?? product.stock ?? 0);
            const isPositive = reason === 'ajuste_positivo';
            const newStock = isPositive ? (currentStock + baseUnits) : Math.max(-999999, currentStock - baseUnits);

            // 1. Actualizar Producto maestro
            await product.update({
                stock: newStock,
                stockQuantity: newStock
            }, { transaction: t });

            // 2. Actualizar BranchStock si aplica
            const branchToUpdate = body.branchId || activeBranchId;
            if (branchToUpdate) {
                const branchExists = await Branch.findByPk(branchToUpdate, { transaction: t });
                if (branchExists) {
                    const [bStock] = await BranchStock.findOrCreate({
                        where: { productId, branchId: branchToUpdate, companyId },
                        defaults: {
                            productId,
                            branchId: branchToUpdate,
                            companyId,
                            quantity: currentStock
                        },
                        transaction: t
                    });
                    const currBranchQty = parseFloat(bStock.quantity || 0);
                    const nextBranchQty = isPositive ? (currBranchQty + baseUnits) : (currBranchQty - baseUnits);
                    await bStock.update({ quantity: nextBranchQty }, { transaction: t });
                }
            }

            // 3. Actualizar WarehouseStock si aplica
            if (warehouseId && WarehouseStock) {
                const [wStock] = await WarehouseStock.findOrCreate({
                    where: { productId, warehouseId, companyId },
                    defaults: {
                        id: generateRobustId(),
                        productId,
                        warehouseId,
                        companyId,
                        quantity: currentStock
                    },
                    transaction: t
                });
                const currWQty = parseFloat(wStock.quantity || 0);
                const nextWQty = isPositive ? (currWQty + baseUnits) : (currWQty - baseUnits);
                await wStock.update({ quantity: nextWQty }, { transaction: t });
            }

            // 4. Registrar StockMovement
            const unitCost = parseFloat(product.cost || 0);
            const totalCost = parseFloat((unitCost * baseUnits).toFixed(4));
            const presentationTag = factor > 1 ? ` [Empaque: ${presentation?.name || body.presentationName || 'Presentación'} x${factor}]` : '';
            const fullNotes = `${notes || ''}${presentationTag}`.trim();

            const movement = await StockMovement.create({
                id: generateRobustId(),
                productId,
                userId: reqUser.id,
                companyId,
                branchId: branchToUpdate || null,
                type: isPositive ? 'ADJUSTMENT_IN' : 'WASTE',
                category: reason,
                quantity: baseUnits,
                stockBefore: currentStock,
                stockAfter: newStock,
                costPrice: unitCost,
                totalCost,
                responsibleName: responsibleName || reqUser.name || reqUser.username || 'Admin',
                notes: fullNotes,
                reason,
                date: new Date().toISOString()
            }, { transaction: t });

            // 5. Asiento Contable Automático (PUC) para mermas reales
            let accountingEntry = null;
            if (!isPositive && totalCost > 0) {
                try {
                    const AccountingEngineService = require('./AccountingEngineService');
                    accountingEntry = await AccountingEngineService.recordWasteMovement({
                        companyId,
                        product,
                        quantityBaseUnits: baseUnits,
                        reason,
                        notes: fullNotes,
                        responsibleName,
                        userId: reqUser.id,
                        movementId: movement.id,
                        transaction: t
                    });
                } catch (accErr) {
                    console.error('[Accounting Engine] Error generando asiento de merma:', accErr.message);
                }
            }

            return {
                success: true,
                movement,
                product: product.get({ plain: true }),
                baseUnits,
                factorConversion: factor,
                accountingEntryId: accountingEntry?.id || null
            };
        });
    }

    /**
     * Obtener historial y auditoría de mermas y ajustes de inventario
     */
    async getWasteHistory(reqUser, queryParams = {}) {
        const { companyId } = reqUser;
        const { startDate, endDate, reason, search, productId, limit = 100, page = 1 } = queryParams;

        const where = {
            companyId,
            type: { [Op.in]: ['WASTE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] }
        };

        if (startDate && endDate) {
            where.date = { [Op.between]: [startDate, endDate + 'T23:59:59.999Z'] };
        } else if (startDate) {
            where.date = { [Op.gte]: startDate };
        } else if (endDate) {
            where.date = { [Op.lte]: endDate + 'T23:59:59.999Z' };
        }

        if (reason && reason !== 'all') {
            where.category = reason;
        }

        if (productId) {
            where.productId = productId;
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        const { count, rows } = await StockMovement.findAndCountAll({
            where,
            include: [
                {
                    model: Product,
                    attributes: ['id', 'name', 'barcode', 'sku', 'cost', 'price', 'imageUri', 'stockUnit']
                }
            ],
            order: [['date', 'DESC'], ['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        let totalUnits = 0;
        let totalCostUSD = 0;
        const byCategory = {};

        rows.forEach(mov => {
            const q = parseFloat(mov.quantity || 0);
            const c = parseFloat(mov.totalCost || 0);
            totalUnits += q;
            totalCostUSD += c;
            const cat = mov.category || 'otros';
            byCategory[cat] = (byCategory[cat] || 0) + c;
        });

        return {
            movements: rows,
            summary: {
                totalUnits,
                totalCostUSD,
                totalRecords: count,
                byCategory
            }
        };
    }

    /**
     * Exportar reporte de auditoría de mermas a Excel
     */
    async exportWasteExcel(reqUser, queryParams = {}) {
        const { movements } = await this.getWasteHistory(reqUser, { ...queryParams, limit: 10000 });
        const XLSX = require('xlsx');

        const rows = movements.map(m => ({
            'Fecha y Hora': m.date ? new Date(m.date).toLocaleString('es-VE') : '',
            'Producto': m.Product?.name || 'N/A',
            'Código de Barras': m.Product?.barcode || '',
            'SKU': m.Product?.sku || '',
            'Motivo / Categoría': m.category || m.reason || '',
            'Tipo de Movimiento': m.type || '',
            'Unidades Base Dadas de Baja': parseFloat(m.quantity || 0),
            'Stock Antes': parseFloat(m.stockBefore || 0),
            'Stock Resultante': parseFloat(m.stockAfter || 0),
            'Costo Unitario ($)': parseFloat(m.costPrice || 0),
            'Pérdida Total ($)': parseFloat(m.totalCost || 0),
            'Responsable': m.responsibleName || '',
            'Justificación / Notas': m.notes || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Mermas y Ajustes');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    /**
     * Ajuste rápido de inventario físico (conteo/kardex) - Soporta { newStock } o { type: 'add'|'subtract'|'set', quantity }
     */
    async quickStockAdjust(reqUser, productId, body) {
        const { companyId, activeBranchId } = reqUser;
        const { newStock, type, quantity, reason = 'conteo_fisico', notes = '' } = body;

        return await sequelize.transaction(async (t) => {
            const product = await Product.findOne({
                where: { id: productId, companyId },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (!product) throw new Error('Producto no encontrado');

            const currentStock = parseFloat(product.stockQuantity ?? product.stock ?? 0);
            let targetStock = parseFloat(newStock);

            if (isNaN(targetStock)) {
                const qtyVal = parseFloat(quantity);
                if (isNaN(qtyVal)) {
                    throw new Error('El nuevo stock o cantidad de ajuste debe ser un número válido');
                }
                if (type === 'add') {
                    targetStock = precision.round(precision.add([currentStock, qtyVal]), 6);
                } else if (type === 'subtract') {
                    targetStock = Math.max(0, precision.round(precision.subtract(currentStock, qtyVal), 6));
                } else {
                    targetStock = precision.round(qtyVal, 6);
                }
            }

            const delta = precision.round(precision.subtract(targetStock, currentStock), 6);
            if (delta === 0) {
                return {
                    success: true,
                    message: 'El stock no requirió cambios',
                    currentStock,
                    newStock: targetStock,
                    stockBefore: currentStock,
                    stockAfter: targetStock,
                    delta: 0,
                    product: product.get({ plain: true })
                };
            }

            await product.update({ stock: targetStock, stockQuantity: String(targetStock) }, { transaction: t });

            if (activeBranchId) {
                const branchExists = await Branch.findByPk(activeBranchId, { transaction: t });
                if (branchExists) {
                    const [bStock] = await BranchStock.findOrCreate({
                        where: { productId, branchId: activeBranchId, companyId },
                        defaults: { productId, branchId: activeBranchId, companyId, quantity: targetStock },
                        transaction: t
                    });
                    await bStock.update({ quantity: targetStock }, { transaction: t });
                }
            }

            const unitCost = parseFloat(product.cost || 0);
            const movementType = delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';

            await StockMovement.create({
                id: generateRobustId(),
                productId,
                userId: reqUser.id,
                companyId,
                branchId: activeBranchId || null,
                type: movementType,
                category: reason,
                quantity: Math.abs(delta),
                stockBefore: currentStock,
                stockAfter: targetStock,
                costPrice: unitCost,
                totalCost: parseFloat((unitCost * Math.abs(delta)).toFixed(4)),
                responsibleName: reqUser.name || reqUser.username || 'Admin',
                notes: notes || `Ajuste rápido de inventario de ${currentStock} a ${targetStock}`,
                reason,
                date: new Date().toISOString()
            }, { transaction: t });

            return {
                success: true,
                currentStock,
                newStock: targetStock,
                stockBefore: currentStock,
                stockAfter: targetStock,
                delta,
                product: product.get({ plain: true })
            };
        });
    }

    /**
     * Ajuste masivo por Toma Física / Auditoría de Inventario
     * Cuadra en una transacción atómica el stock físico de múltiples productos,
     * generando sus respectivos asientos de Kardex (ADJUSTMENT_IN / ADJUSTMENT_OUT).
     */
    async bulkAuditAdjust(reqUser, body = {}) {
        const { companyId, activeBranchId, id: userId } = reqUser;
        const { auditSessionId, reason = 'toma_fisica', notes = '', adjustments = [] } = body;

        if (!Array.isArray(adjustments) || adjustments.length === 0) {
            throw new Error('No se recibieron ajustes para procesar.');
        }

        const sessionRef = auditSessionId || `AUD-${Date.now().toString().slice(-6)}`;

        return await sequelize.transaction(async (t) => {
            let updatedCount = 0;
            let totalFaltantesQty = 0;
            let totalSobrantesQty = 0;
            let totalFaltantesUsd = 0;
            let totalSobrantesUsd = 0;
            const movementsToInsert = [];

            let branchExists = null;
            if (activeBranchId) {
                branchExists = await Branch.findByPk(activeBranchId, { transaction: t });
            }

            for (const adj of adjustments) {
                const { productId, countedStock } = adj;
                if (!productId || countedStock === undefined || countedStock === null || isNaN(Number(countedStock))) {
                    continue;
                }

                const product = await Product.findOne({
                    where: { id: productId, companyId },
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });

                if (!product) continue;

                const currentStock = parseFloat(product.stockQuantity ?? product.stock ?? 0);
                const targetStock = precision.round(Math.max(0, parseFloat(countedStock)), 4);
                const delta = precision.round(precision.subtract(targetStock, currentStock), 4);

                if (delta === 0) continue;

                await product.update({
                    stock: targetStock,
                    stockQuantity: String(targetStock)
                }, { transaction: t });

                if (branchExists) {
                    const [bStock] = await BranchStock.findOrCreate({
                        where: { productId, branchId: activeBranchId, companyId },
                        defaults: { productId, branchId: activeBranchId, companyId, quantity: targetStock },
                        transaction: t
                    });
                    await bStock.update({ quantity: targetStock }, { transaction: t });
                }

                const unitCost = parseFloat(product.cost || 0);
                const movementType = delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
                const movementQty = Math.abs(delta);
                const impactUsd = precision.round(movementQty * unitCost, 2);

                if (delta < 0) {
                    totalFaltantesQty = precision.round(totalFaltantesQty + movementQty, 4);
                    totalFaltantesUsd = precision.round(totalFaltantesUsd + impactUsd, 2);
                } else {
                    totalSobrantesQty = precision.round(totalSobrantesQty + movementQty, 4);
                    totalSobrantesUsd = precision.round(totalSobrantesUsd + impactUsd, 2);
                }

                movementsToInsert.push({
                    id: generateRobustId(),
                    productId,
                    userId,
                    companyId,
                    branchId: activeBranchId || null,
                    type: movementType,
                    category: reason,
                    quantity: movementQty,
                    stockBefore: currentStock,
                    stockAfter: targetStock,
                    costPrice: unitCost,
                    totalCost: impactUsd,
                    responsibleName: reqUser.name || reqUser.username || 'Admin',
                    reason: `Toma Física (${sessionRef}): ${delta > 0 ? '+' : ''}${delta} unidades. ${notes}`.trim(),
                    notes: notes || `Auditoría física de inventario: de ${currentStock} a ${targetStock}`,
                    referenceId: sessionRef,
                    date: new Date().toISOString()
                });

                updatedCount++;
            }

            if (movementsToInsert.length > 0) {
                await StockMovement.bulkCreate(movementsToInsert, { transaction: t });
            }

            const netDiffUsd = precision.round(totalSobrantesUsd - totalFaltantesUsd, 2);

            return {
                success: true,
                auditSessionId: sessionRef,
                updatedCount,
                totalFaltantesQty,
                totalSobrantesQty,
                totalFaltantesUsd,
                totalSobrantesUsd,
                netDiffUsd,
                timestamp: new Date().toISOString()
            };
        });
    }

}

module.exports = new ProductService();
