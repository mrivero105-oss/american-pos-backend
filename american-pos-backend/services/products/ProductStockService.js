const {
    Product,
    BranchStock,
    Branch,
    StockMovement,
    ProductPresentation,
    VarianteProducto
} = require('../../database/models');
const { sequelize } = require('../../database/connection');
const { generateRobustId, readJsonAsync, getUserSettings } = require('../../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../../utils/precision');
const cacheService = require('../../utils/cacheService');
const { SETTINGS_FILE } = require('../../config/paths');
const productWasteAndAudit = require('../product/productWasteAndAudit');

async function resolveActiveBranch(reqUser, transaction) {
    const { id: userId, companyId } = reqUser;
    let dbBranch = null;
    if (
        reqUser.activeBranchId &&
        reqUser.activeBranchId !== '1' &&
        reqUser.activeBranchId !== 'null' &&
        reqUser.activeBranchId !== 'undefined'
    ) {
        dbBranch = await Branch.findOne({
            where: { id: reqUser.activeBranchId, companyId },
            transaction
        });
    }
    if (!dbBranch) {
        dbBranch = await Branch.findOne({ where: { companyId }, transaction });
    }
    if (!dbBranch) {
        dbBranch = await Branch.create({
            id: generateRobustId(),
            userId,
            companyId,
            name: 'Principal',
            isMain: true,
            isActive: true
        }, { transaction });
    }
    return dbBranch.id;
}

async function syncPresentations(productId, companyId, primaryBarcode, presentationsToSync, transaction, { replaceExisting = false } = {}) {
    if (presentationsToSync === null || presentationsToSync === undefined) return;
    if (replaceExisting) {
        await ProductPresentation.destroy({ where: { productId }, transaction });
    }
    if (!Array.isArray(presentationsToSync) || presentationsToSync.length === 0) return;

    const usedPresBarcodes = new Set();
    if (primaryBarcode) {
        usedPresBarcodes.add(String(primaryBarcode).trim());
    }
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
                    { where: { barcode: cleanBarcode }, transaction }
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
        }, { transaction });
    }
}

async function syncVariants(productId, variantsToSync, transaction) {
    if (!Array.isArray(variantsToSync) || !VarianteProducto) return;
    await VarianteProducto.destroy({ where: { producto_id: productId }, transaction });
    for (const v of variantsToSync) {
        if (!v || (!v.talla && !v.color && !v.sku_variante)) continue;
        await VarianteProducto.create({
            id: v.id || generateRobustId(),
            producto_id: productId,
            talla: v.talla || null,
            color: v.color || null,
            sku_variante: v.sku_variante || null,
            stock_actual: Number(v.stock_actual ?? v.stock ?? 0)
        }, { transaction });
    }
}

async function applyBranchStockAdjustment({
    oldProduct,
    updateData,
    activeBranchId,
    productId,
    userId,
    companyId,
    transaction
}) {
    if (updateData.stockQuantity === undefined) return;

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
                    { where: { id: branchStockRecord.id }, transaction }
                );
            } else {
                await BranchStock.create(
                    { branchId: activeBranchId, productId, quantity: stockAfter, companyId },
                    { transaction }
                );
            }
        } else if (oldProduct.BranchStocks && oldProduct.BranchStocks.length > 0) {
            const firstRecord = oldProduct.BranchStocks[0];
            await BranchStock.update(
                { quantity: stockAfter },
                { where: { id: firstRecord.id }, transaction }
            );
            if (oldProduct.BranchStocks.length > 1) {
                const otherIds = oldProduct.BranchStocks.slice(1).map(s => s.id);
                await BranchStock.update(
                    { quantity: 0 },
                    { where: { id: { [Op.in]: otherIds } }, transaction }
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
        }, { transaction });
    }

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

async function bulkPriceAdjustment(productService, reqUser, params) {
    const { target, category, supplierId, productIds, adjustmentType, direction, value } = params;
    const whereClause = { companyId: reqUser.companyId };
    const numericValue = precision.parseNumericInput(value);

    if (target === 'selected' && productIds?.length > 0) {
        whereClause.id = { [Op.in]: productIds };
    } else if (target === 'category' && category) {
        whereClause.category = category;
    } else if (target === 'supplier' && supplierId) {
        whereClause.supplierId = supplierId;
    }

    const allSettings = await readJsonAsync(SETTINGS_FILE);
    const userSettings = getUserSettings(allSettings, reqUser.companyId);
    const posRate = precision.parseNumericInput(userSettings?.exchangeRate || userSettings?.bcvRate || 0);

    let updatedCount = 0;
    await sequelize.transaction(async (t) => {
        const products = await Product.findAll({
            where: whereClause,
            order: [['id', 'ASC']],
            lock: t.LOCK.UPDATE,
            transaction: t
        });

        for (const p of products) {
            const currentPrice = precision.parseNumericInput(p.price || 0);
            const currentCost = precision.parseNumericInput(p.cost || 0);
            let newPrice = currentPrice;
            let nextMargin = precision.parseNumericInput(p.margin || 0);

            if (adjustmentType === 'percentage') {
                const percentVal = precision.divide(numericValue, 100);
                if (direction === 'increase') {
                    const multiplier = precision.add([1, percentVal]);
                    newPrice = precision.multiply(currentPrice, multiplier);
                } else {
                    const multiplier = precision.subtract(1, percentVal);
                    newPrice = precision.multiply(currentPrice, multiplier);
                }
                if (currentCost > 0) {
                    nextMargin = precision.round(
                        precision.multiply(precision.divide(precision.subtract(newPrice, currentCost), currentCost), 100),
                        4
                    );
                }
            } else if (adjustmentType === 'margin') {
                if (currentCost <= 0) {
                    continue;
                }
                const safeMargin = Math.max(0, numericValue);
                const multiplier = precision.add([1, precision.divide(safeMargin, 100)]);
                newPrice = precision.multiply(currentCost, multiplier);
                nextMargin = precision.round(safeMargin, 4);
            } else {
                newPrice = direction === 'increase'
                    ? precision.add([currentPrice, numericValue])
                    : precision.subtract(currentPrice, numericValue);
                if (currentCost > 0) {
                    nextMargin = precision.round(
                        precision.multiply(precision.divide(precision.subtract(newPrice, currentCost), currentCost), 100),
                        4
                    );
                }
            }

            newPrice = Math.max(0, newPrice < 0.10 ? precision.round(newPrice, 4) : precision.round(newPrice, 2));
            const patch = { price: newPrice, margin: nextMargin };
            if (posRate > 0) {
                patch.priceBs = precision.round(precision.multiply(newPrice, posRate), 2);
            }
            await p.update(patch, { transaction: t });
            updatedCount += 1;
        }
    });

    productService.invalidateCatalogCache();
    await productService._logAudit(
        reqUser,
        'PRODUCT_BULK_PRICE_ADJUST',
        `Ajuste masivo (${adjustmentType}): ${direction || 'set'} de ${numericValue}${adjustmentType === 'fixed' ? '$' : '%'} para ${updatedCount} productos.`,
        'BULK',
        null,
        null
    );

    return updatedCount;
}

async function getLowStockAlerts(companyId) {
    const cacheKey = `low_stock_${companyId}`;
    const cached = cacheService.get(cacheKey);
    if (cached) return cached;

    const products = await Product.findAll({
        where: {
            companyId,
            stockQuantity: { [Op.lte]: sequelize.col('minStock') },
            minStock: { [Op.gt]: 0 }
        },
        attributes: ['id', 'name', 'stockQuantity', 'minStock'],
        raw: true
    });

    cacheService.set(cacheKey, products, 180);
    return products;
}

module.exports = {
    resolveActiveBranch,
    syncPresentations,
    syncVariants,
    applyBranchStockAdjustment,
    bulkPriceAdjustment,
    getLowStockAlerts,
    recordWaste: productWasteAndAudit.recordWaste,
    getWasteHistory: productWasteAndAudit.getWasteHistory,
    exportWasteExcel: productWasteAndAudit.exportWasteExcel,
    quickStockAdjust: productWasteAndAudit.quickStockAdjust,
    bulkAuditAdjust: productWasteAndAudit.bulkAuditAdjust
};
