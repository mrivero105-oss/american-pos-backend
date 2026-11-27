const { Op } = require('sequelize');
const {
    Product,
    BranchStock,
    StockMovement,
    Branch,
    ProductPresentation,
    WarehouseStock
} = require('../../database/models');
const { sequelize } = require('../../database/connection');
const { generateRobustId } = require('../../utils/helpers');
const precision = require('../../utils/precision');

/**
 * Registra baja / merma / avería / ajuste de stock con trazabilidad,
 * soporte de N-Presentaciones (factorConversion) y asiento contable automático.
 */
async function recordWaste(reqUser, productId, body) {
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

        const baseUnits = precision.round(precision.multiply(qtyNum, factor), 4);
        const currentStock = precision.parseNumericInput(product.stockQuantity ?? product.stock ?? 0);
        const isPositive = reason === 'ajuste_positivo';
        const newStock = isPositive
            ? precision.round(precision.add([currentStock, baseUnits]), 4)
            : Math.max(-999999, precision.round(precision.subtract(currentStock, baseUnits), 4));

        await product.update({
            stock: newStock,
            stockQuantity: newStock
        }, { transaction: t });

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
                const currBranchQty = precision.parseNumericInput(bStock.quantity || 0);
                const nextBranchQty = isPositive
                    ? precision.round(precision.add([currBranchQty, baseUnits]), 4)
                    : precision.round(precision.subtract(currBranchQty, baseUnits), 4);
                await bStock.update({ quantity: nextBranchQty }, { transaction: t });
            }
        }

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
            const currWQty = precision.parseNumericInput(wStock.quantity || 0);
            const nextWQty = isPositive
                ? precision.round(precision.add([currWQty, baseUnits]), 4)
                : precision.round(precision.subtract(currWQty, baseUnits), 4);
            await wStock.update({ quantity: nextWQty }, { transaction: t });
        }

        const unitCost = precision.parseNumericInput(product.cost || 0);
        const totalCost = precision.round(precision.multiply(unitCost, baseUnits), 4);
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

        let accountingEntry = null;
        if (!isPositive && totalCost > 0) {
            const AccountingEngineService = require('../AccountingEngineService');
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
            if (!accountingEntry) {
                throw new Error(`No se pudo generar el asiento contable obligatorio para la merma del producto ${product.name}.`);
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
 * Obtiene historial y auditoría de mermas y ajustes de inventario.
 */
async function getWasteHistory(reqUser, queryParams = {}) {
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

    const cleanSearch = search && typeof search === 'string' ? search.trim() : '';
    if (cleanSearch) {
        const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
        const pattern = `%${cleanSearch}%`;
        where[Op.or] = [
            { notes: { [likeOp]: pattern } },
            { responsibleName: { [likeOp]: pattern } },
            { reason: { [likeOp]: pattern } },
            { '$Product.name$': { [likeOp]: pattern } },
            { '$Product.barcode$': { [likeOp]: pattern } }
        ];
    }

    const parsedLimit = Math.max(1, parseInt(limit, 10) || 100);
    const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * parsedLimit;

    const includeProduct = [
        {
            model: Product,
            as: 'Product',
            attributes: ['id', 'name', 'barcode', 'cost', 'price', 'imageUri', 'stockUnit'],
            required: false
        }
    ];

    const { count, rows } = await StockMovement.findAndCountAll({
        where,
        include: includeProduct,
        order: [['date', 'DESC'], ['createdAt', 'DESC']],
        limit: parsedLimit,
        offset,
        ...(cleanSearch ? { subQuery: false } : {})
    });

    let totalUnits = 0;
    let totalCostUSD = 0;
    const byCategory = {};

    let summaryRows = rows;
    if (count > rows.length || offset > 0) {
        summaryRows = await StockMovement.findAll({
            where,
            include: cleanSearch ? [{ model: Product, as: 'Product', attributes: [], required: false }] : [],
            attributes: ['quantity', 'totalCost', 'category'],
            raw: true,
            ...(cleanSearch ? { subQuery: false } : {})
        });
    }

    summaryRows.forEach((mov) => {
        const q = precision.parseNumericInput(mov.quantity || 0);
        const c = precision.parseNumericInput(mov.totalCost || 0);
        totalUnits = precision.add([totalUnits, q]);
        totalCostUSD = precision.add([totalCostUSD, c]);
        const cat = mov.category || 'otros';
        byCategory[cat] = precision.round(precision.add([byCategory[cat] || 0, c]), 4);
    });

    return {
        movements: rows,
        summary: {
            totalUnits: precision.round(totalUnits, 4),
            totalCostUSD: precision.round(totalCostUSD, 4),
            totalRecords: count,
            byCategory
        }
    };
}

/**
 * Exporta reporte de auditoría de mermas a Excel.
 */
async function exportWasteExcel(reqUser, queryParams = {}) {
    const { movements } = await getWasteHistory(reqUser, { ...queryParams, limit: 10000 });
    const ExcelJS = require('exceljs');

    const rows = movements.map((m) => ({
        fecha: m.date ? new Date(m.date).toLocaleString('es-VE') : '',
        producto: m.Product?.name || 'N/A',
        barcode: m.Product?.barcode || '',
        sku: m.Product?.sku || '',
        motivo: m.category || m.reason || '',
        tipo: m.type || '',
        cantidad: parseFloat(m.quantity || 0),
        stockAntes: parseFloat(m.stockBefore || 0),
        stockResultante: parseFloat(m.stockAfter || 0),
        costoUnitario: parseFloat(m.costPrice || 0),
        perdidaTotal: parseFloat(m.totalCost || 0),
        responsable: m.responsibleName || '',
        notas: m.notes || ''
    }));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Mermas y Ajustes');
    ws.columns = [
        { header: 'Fecha y Hora', key: 'fecha', width: 22 },
        { header: 'Producto', key: 'producto', width: 32 },
        { header: 'Código de Barras', key: 'barcode', width: 18 },
        { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Motivo / Categoría', key: 'motivo', width: 24 },
        { header: 'Tipo de Movimiento', key: 'tipo', width: 18 },
        { header: 'Unidades Base Dadas de Baja', key: 'cantidad', width: 24 },
        { header: 'Stock Antes', key: 'stockAntes', width: 14 },
        { header: 'Stock Resultante', key: 'stockResultante', width: 16 },
        { header: 'Costo Unitario ($)', key: 'costoUnitario', width: 18 },
        { header: 'Pérdida Total ($)', key: 'perdidaTotal', width: 16 },
        { header: 'Responsable', key: 'responsable', width: 22 },
        { header: 'Justificación / Notas', key: 'notas', width: 32 }
    ];
    ws.addRows(rows);
    return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Ajuste rápido de inventario físico (conteo/kardex).
 */
async function quickStockAdjust(reqUser, productId, body) {
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
 * Ajuste masivo por Toma Física / Auditoría de Inventario.
 */
async function bulkAuditAdjust(reqUser, body = {}) {
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

module.exports = {
    recordWaste,
    getWasteHistory,
    exportWasteExcel,
    quickStockAdjust,
    bulkAuditAdjust
};
