const { Product, BranchStock, Supplier, AuditLog, StockMovement, SupplierProductMapping, Branch, VarianteProducto } = require('../database/models');
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
     * Get all products with filtering and branch stock mapping.
     */
    async getAllProducts(reqUser, queryParams) {
        const { companyId, activeBranchId } = reqUser;
        const { category, search, minimal, page = 1, limit = 0, supplierId, stockFilter, stockStatus, minPrice, maxPrice, status, es_controlado, expirationFilter } = queryParams;
        const currentStockFilter = stockFilter || stockStatus; 
        const isMinimal = minimal === 'true';

        const whereClause = { companyId };

        // Handle Status filtering (Intelligently synced with Stock Filter)
        if (status) {
            whereClause.status = status;
        } else if (currentStockFilter === 'out') {
            // If Master clicks "AGOTADO", we MUST look into the inactive list
            whereClause.status = 'inactive';
        } else {
            // By default, hide inactive products
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

        if (currentStockFilter === 'low') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.where(sequelize.cast(sequelize.col('Product.stockQuantity'), 'REAL'), { [Op.lte]: sequelize.cast(sequelize.col('Product.minStock'), 'REAL') }),
                sequelize.where(sequelize.cast(sequelize.col('Product.stockQuantity'), 'REAL'), { [Op.gt]: 0 })
            ];
        } else if (currentStockFilter === 'out') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.where(sequelize.cast(sequelize.col('Product.stockQuantity'), 'REAL'), { [Op.lte]: 0 })
            ];
        } else if (currentStockFilter === 'in') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.where(sequelize.cast(sequelize.col('Product.stockQuantity'), 'REAL'), { [Op.gt]: sequelize.cast(sequelize.col('Product.minStock'), 'REAL') })
            ];
        }

        if (minPrice || maxPrice) {
            const priceCond = {};
            if (minPrice) priceCond[Op.gte] = parseFloat(minPrice);
            if (maxPrice) priceCond[Op.lte] = parseFloat(maxPrice);
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.where(sequelize.cast(sequelize.col('Product.price'), 'REAL'), priceCond)
            ];
        }

        if (search) {
            const searchTerm = search.trim();
            if (sequelize.getDialect() === 'postgres') {
                whereClause[Op.or] = [
                    { name: { [Op.iLike]: `%${searchTerm}%` } },
                    { barcode: { [Op.iLike]: `%${searchTerm}%` } },
                    { principio_activo: { [Op.iLike]: `%${searchTerm}%` } }
                ];
            } else {
                whereClause[Op.or] = [
                    { name: { [Op.like]: `%${searchTerm}%` } },
                    { barcode: { [Op.like]: `%${searchTerm}%` } },
                    { principio_activo: { [Op.like]: `%${searchTerm}%` } }
                ];
            }
        }

        // Master Performance Optimization: Lean payload for high-count inventory loading
        const isMasterFullView = queryParams.fullCatalog === 'true';
        
        const options = {
            where: whereClause,
            attributes: isMinimal ? [
                'id', 'name', 'price', 'cost', 'stockQuantity', 'imageUri', 'category', 'barcode', 'supplierId', 'isSoldByWeight', 'isFractional',
                'taxStatus', 'stockUnit', 'minStock', 'bulkUnitName', 'unitsPerBulk', 'allowNegative', 'batchNumber', 'expirationDate', 'es_controlado', 'principio_activo'
            ] : [
                'id', 'name', 'price', 'priceBs', 'barcode', 'imageUri',
                'stockQuantity', 'stockUnit', 'isSoldByWeight', 'category', 'status',
                'supplierId', 'cost', 'minStock', 'bulkUnitName', 'unitsPerBulk',
                'margin', 'bulkCost', 'taxStatus', 'allowNegative', 'batchNumber', 'expirationDate', 'es_controlado', 'principio_activo'
            ],
            include: [
                { model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] },
                { model: VarianteProducto, as: 'Variantes' },
                ...(isMinimal ? [] : [{ model: Supplier, attributes: ['name'] }])
            ],
            order: [['name', 'ASC']],
            subQuery: false
        };

        // Master Bypass: If fullCatalog is explicitly requested, we ignore limit/offset limits.
        if (limit > 0 && !isMasterFullView) {
            options.limit = parseInt(limit);
            options.offset = (parseInt(page) - 1) * parseInt(limit);
        }

        const { count, rows: productInstances } = await Product.findAndCountAll(options);
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
                include: [{ model: BranchStock, as: 'BranchStocks' }],
                lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                transaction: t
            });
            
            if (!oldProduct) throw new Error('Producto no encontrado');

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

                // Automatic Status Management
                const finalStock = Number(updateData.stockQuantity);
                if (finalStock <= 0 && !oldProduct.allowNegative) {
                    updateData.status = 'inactive';
                } else {
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

            const updatedProduct = await oldProduct.update(updateData, { transaction: t });
            
            await t.commit();
            return updatedProduct.get({ plain: true });

        } catch (error) {
            await t.rollback();
            throw error;
        }
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

    // Helper: Log Audit
    async _logAudit(reqUser, action, description, entityId, oldVal, newVal, transaction = null) {
        try {
            await AuditLog.create({
                id: generateRobustId(),
                userId: reqUser.id,
                companyId: reqUser.companyId,
                action,
                description,
                entityId,
                oldValue: oldVal ? JSON.stringify(oldVal) : null,
                newValue: newVal ? JSON.stringify(newVal) : null,
                timestamp: new Date().toISOString()
            }, { transaction });
        } catch (e) {
            console.warn('AuditLog failed:', e.message);
        }
    }

    // Helper: Get field differences
    _getDiff(oldObj, newObj) {
        const fields = [
            'name', 'price', 'cost', 'category', 'barcode', 'stockQuantity', 'minStock', 
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
     * Process an imported catalog of products from a vendor.
     * Matches external names with existing mappings or suggests new ones.
     */
    async processCatalogImport(reqUser, extractedItems, supplierId = null) {
        const { companyId } = reqUser;
        const results = [];

        // Optimizamos: Obtenemos todos los mapeos de una vez para evitar N consultas
        const existingMappings = await SupplierProductMapping.findAll({
            where: { supplierId: supplierId || null },
            include: [{ 
                model: Product, 
                as: 'Product',
                attributes: ['id', 'name', 'cost', 'barcode', 'unitsPerBulk', 'margin']
            }]
        });

        const mappingMap = new Map();
        existingMappings.forEach(m => {
            if (m.Product) mappingMap.set(m.externalName, m.Product);
        });

        for (const item of extractedItems) {
            if (!item.externalName || typeof item.externalName !== 'string') continue;

            const nameToMatch = item.externalName.trim();
            const matchedFromMap = mappingMap.get(nameToMatch);

            if (matchedFromMap) {
                results.push({
                    externalName: nameToMatch,
                    price: item.price,
                    suggestedQuantity: item.suggestedQuantity || 1,
                    matchedProduct: {
                        id: matchedFromMap.id,
                        name: matchedFromMap.name,
                        currentCost: matchedFromMap.cost,
                        barcode: matchedFromMap.barcode,
                        unitsPerBulk: Number(matchedFromMap.unitsPerBulk || 1),
                        margin: Number(matchedFromMap.margin || 0)
                    },
                    confidence: 100
                });
            } else {
                // Mejora: Búsqueda limitada para sugerir
                const firstPart = nameToMatch.split(' ')[0];
                const similarProduct = await Product.findOne({
                    where: {
                        companyId,
                        name: { [Op.like]: `%${firstPart}%` }
                    },
                    attributes: ['id', 'name', 'cost', 'barcode', 'unitsPerBulk', 'margin']
                });

                results.push({
                    externalName: nameToMatch,
                    price: item.price,
                    suggestedQuantity: item.suggestedQuantity || 1,
                    matchedProduct: similarProduct ? {
                        id: similarProduct.id,
                        name: similarProduct.name,
                        currentCost: similarProduct.cost,
                        barcode: similarProduct.barcode,
                        unitsPerBulk: Number(similarProduct.unitsPerBulk || 1),
                        margin: Number(similarProduct.margin || 0)
                    } : null,
                    confidence: similarProduct ? 60 : 0
                });
            }
        }

        return results;
    }

    /**
     * Search products for manual linking (paginated/limited)
     */
    async searchProductsForLink(reqUser, search) {
        const { companyId } = reqUser;
        const searchTerm = (search || '').trim();
        
        const products = await Product.findAll({
            where: {
                companyId,
                [Op.or]: [
                    { name: { [Op.iLike]: `%${searchTerm}%` } },
                    { barcode: { [Op.iLike]: `%${searchTerm}%` } }
                ]
            },
            attributes: ['id', 'name', 'cost', 'barcode', 'unitsPerBulk', 'margin'],
            limit: 20
        });

        return products.map(p => ({
            ...p.get({ plain: true }),
            unitsPerBulk: Number(p.unitsPerBulk || 1),
            margin: Number(p.margin || 0)
        }));
    }

    /**
     * Apply the approved mappings and update product costs.
     */
    async applySupplierMapping(reqUser, mappings) {
        const { companyId, id: userId } = reqUser;
        let updateCount = 0;

        const t = await sequelize.transaction();
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

            // Obtener tasa de cambio para cálculos en Bs
            const allSettings = await readJsonAsync(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const rate = parseFloat(userSettings.exchangeRate || 1);

            for (const map of mappings) {
                try {
                    let { externalName, localProductId, price, supplierId, quantity = 1, margin, newPrice, isNew, initialStock, imageUri } = map;
                    const isNewProduct = String(isNew) === 'true';
                    const finalSupplierId = (supplierId && supplierId !== 'null') ? String(supplierId) : null;
                    const cleanExternalName = String(externalName || 'DESCONOCIDO').trim();

                    let finalLocalProductId = (localProductId && localProductId !== 'null') ? String(localProductId) : null;

                    // 0. Si es un producto nuevo, lo creamos
                    if (isNewProduct) {
                        const newId = generateRobustId();
                        const unitQuantity = parseFloat(quantity) || 1;
                        const unitCost = precision.round(precision.divide(price, unitQuantity), 6);
                        const updatedMargin = margin !== undefined ? parseFloat(margin) : 30;
                        let updatedPrice;
                        if (newPrice !== undefined) {
                            updatedPrice = parseFloat(newPrice);
                        } else {
                            const marginPercent = precision.divide(updatedMargin, 100);
                            const multiplier = precision.add([1, marginPercent]);
                            updatedPrice = precision.round(precision.multiply(unitCost, multiplier), 2);
                        }
                        const updatedPriceBs = precision.round(precision.multiply(updatedPrice, rate), 6);

                        const newProduct = await Product.create({
                            id: newId,
                            name: cleanExternalName,
                            cost: unitCost,
                            price: updatedPrice,
                            priceBs: updatedPriceBs,
                            bulkCost: price,
                            unitsPerBulk: unitQuantity,
                            margin: updatedMargin,
                            companyId,
                            userId,
                            category: 'General',
                            stockUnit: 'unidad',
                            taxStatus: 'exento',
                            supplierId: finalSupplierId,
                            imageUri: imageUri || null,
                            stockQuantity: Number(initialStock) || 0
                        }, { transaction: t });
                        
                        finalLocalProductId = newProduct.id;

                        if (Number(initialStock) > 0 && activeBranchId) {
                            await BranchStock.create({
                                productId: newId,
                                branchId: activeBranchId,
                                quantity: Number(initialStock),
                                companyId
                            }, { transaction: t });
                            
                            await StockMovement.create({
                                id: generateRobustId(),
                                productId: newId,
                                userId,
                                companyId,
                                type: 'IN',
                                quantity: Number(initialStock),
                                stockBefore: 0,
                                stockAfter: Number(initialStock),
                                reason: 'Carga Inicial (Importación PDF)',
                                referenceId: newId,
                                date: new Date().toISOString()
                            }, { transaction: t });
                        }
                    }

                    if (!finalLocalProductId) continue;

                    // 1. Guardar o actualizar el mapeo
                    await SupplierProductMapping.upsert({
                        externalName: cleanExternalName,
                        localProductId: finalLocalProductId,
                        supplierId: finalSupplierId,
                        lastUpdated: new Date()
                    }, { transaction: t });

                    // 2. Actualizar el producto real
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

                        const unitQuantity = parseFloat(quantity) || 1;
                        const unitCost = precision.round(precision.divide(price, unitQuantity), 6);
                        const updatedMargin = margin !== undefined ? parseFloat(margin) : (product.margin || 0);
                        const updatedPrice = newPrice !== undefined ? parseFloat(newPrice) : product.price;
                        const updatedPriceBs = precision.round(precision.multiply(updatedPrice, rate), 6);

                        const updateData = { 
                            bulkCost: price, 
                            unitsPerBulk: unitQuantity,
                            cost: unitCost,
                            margin: updatedMargin,
                            price: updatedPrice,
                            priceBs: updatedPriceBs
                        };

                        if (Number(initialStock) > 0) {
                            updateData.status = 'active';
                            
                            if (activeBranchId) {
                                let branchStock = product.BranchStocks?.find(s => s.branchId === activeBranchId);
                                const stockBefore = branchStock ? Number(branchStock.quantity) : 0;
                                const stockAfter = precision.add([stockBefore, Number(initialStock)]);

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
                                    quantity: Number(initialStock),
                                    stockBefore,
                                    stockAfter,
                                    reason: 'Aumento de Stock (Importación PDF)',
                                    referenceId: finalLocalProductId,
                                    date: new Date().toISOString()
                                }, { transaction: t });
                            }
                        }

                        if (imageUri) updateData.imageUri = imageUri;

                        await product.update(updateData, { transaction: t });
                        updateCount++;

                        await this._logAudit(reqUser, 'COST_UPDATE_IMPORT', `Importación: ${product.name}`, finalLocalProductId, 
                            { cost: oldCost, margin: oldMargin, price: oldPrice, priceBs: oldPriceBs }, 
                            { cost: unitCost, margin: updatedMargin, price: updatedPrice, priceBs: updatedPriceBs }, t);
                    }
                } catch (error) {
                    console.error('[IMPORT ERROR] Falla en item:', map.externalName, error);
                    throw error; // Re-throw para abortar la transacción de manera atómica
                }
            }

            await t.commit();
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
            
            // Prepare storage
            const filename = `ai_product_${productId}_${Date.now()}.jpg`;
            
            // Lógica de rutas para Windows AppData
            let userDataPath = process.env.USER_DATA_PATH;
            if (!userDataPath && process.platform === 'win32') {
                let appData = path.join(process.env.APPDATA, 'americanpos');
                if (!fs.existsSync(appData)) appData = path.join(process.env.APPDATA, 'american-pos-backend');
                if (fs.existsSync(appData)) userDataPath = appData;
            }
            const uploadDir = userDataPath ? path.join(userDataPath, 'product_images') : path.join(__dirname, '..', 'product_images');

            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const filePath = path.join(uploadDir, filename);
            fs.writeFileSync(filePath, buffer);

            // Update product in DB
            const imageUri = `/product_images/${filename}`;
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
    async searchImagesIA(productId) {
        try {
            const product = await Product.findByPk(productId);
            if (!product) throw new Error('Producto no encontrado');

            console.log(`[IA IMAGE] Buscando imágenes candidatas para: ${product.name}`);
            const searchQuery = await AIService.generateProductSearchQuery(product.name, product.category);
            const imageUrls = await ImageSearchService.findProductImageUrl(searchQuery);
            
            if (!imageUrls || imageUrls.length === 0) {
                throw new Error('No se encontró ninguna imagen en la búsqueda');
            }

            return { images: imageUrls };
        } catch (error) {
            console.error('[IA IMAGE SEARCH] Error:', error.message);
            throw new Error('No se pudo buscar la imagen: ' + error.message);
        }
    }

    /**
     * Descarga la imagen seleccionada y la asigna al producto.
     */
    async downloadAndSetImage(productId, imageUrl) {
        try {
            const product = await Product.findByPk(productId);
            if (!product) throw new Error('Producto no encontrado');

            console.log(`[IA IMAGE] Intentando descargar imagen seleccionada desde: ${imageUrl}`);
            
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status} al descargar imagen.`);
            }

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.toLowerCase().startsWith('image/')) {
                throw new Error(`URL devolvió un tipo no válido (${contentType}).`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Prepare storage
            const filename = `ai_product_${productId}_${Date.now()}.jpg`;
            
            // Lógica de rutas para Windows AppData
            let userDataPath = process.env.USER_DATA_PATH;
            if (!userDataPath && process.platform === 'win32') {
                const path = require('path');
                const fs = require('fs');
                let appData = path.join(process.env.APPDATA, 'americanpos');
                if (!fs.existsSync(appData)) appData = path.join(process.env.APPDATA, 'american-pos-backend');
                if (fs.existsSync(appData)) userDataPath = appData;
            }
            const path = require('path');
            const fs = require('fs');
            const uploadDir = userDataPath ? path.join(userDataPath, 'product_images') : path.join(__dirname, '..', 'product_images');

            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const filePath = path.join(uploadDir, filename);
            fs.writeFileSync(filePath, buffer);

            const imageUri = `/product_images/${filename}`;
            await product.update({ imageUri, imageUrl: null });

            return { imageUri };
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
}

module.exports = new ProductService();
