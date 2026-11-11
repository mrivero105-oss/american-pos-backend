const { 
    sequelize, BillOfMaterials, BillOfMaterialsItem, ProductionOrder, 
    Product, WarehouseStock, StockMovement, Warehouse, BranchStock, Branch 
} = require('../database/models');
const AccountingEngineService = require('./AccountingEngineService');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');

class ProductionService {
    /**
     * Crea o actualiza una receta / lista de materiales (BOM)
     */
    static async createRecipe({
        companyId = 'default',
        recipeName,
        targetProductId,
        yieldQuantity = 1,
        laborCost = 0,
        overheadCost = 0,
        isKit = false,
        instructions = '',
        items = []
    }) {
        if (!recipeName || !targetProductId) {
            throw new Error('El nombre de la receta y el producto terminado son obligatorios.');
        }

        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('La receta debe contener al menos un insumo o componente.');
        }

        return await sequelize.transaction(async (t) => {
            const bomId = generateRobustId();
            const bom = await BillOfMaterials.create({
                id: bomId,
                companyId,
                recipeName,
                targetProductId,
                yieldQuantity: parseFloat(yieldQuantity) || 1,
                laborCost: parseFloat(laborCost) || 0,
                overheadCost: parseFloat(overheadCost) || 0,
                isKit: Boolean(isKit),
                instructions: instructions || '',
                isActive: true
            }, { transaction: t });

            for (const item of items) {
                await BillOfMaterialsItem.create({
                    id: generateRobustId(),
                    bomId,
                    componentProductId: item.componentProductId,
                    quantityRequired: parseFloat(item.quantityRequired) || 1,
                    unit: item.unit || 'und',
                    wastePercentage: parseFloat(item.wastePercentage) || 0
                }, { transaction: t });
            }

            return bom;
        });
    }

    /**
     * Calcula el costo unitario de una receta en base a los costos actuales de los insumos
     */
    static async calculateRecipeCost(bomId, companyId = null) {
        const whereClause = { id: bomId };
        if (companyId) whereClause.companyId = companyId;
        const bom = await BillOfMaterials.findOne({
            where: whereClause,
            include: [
                {
                    model: BillOfMaterialsItem,
                    as: 'Items',
                    include: [{ model: Product, as: 'ComponentProduct' }]
                },
                { model: Product, as: 'TargetProduct' }
            ]
        });

        if (!bom) throw new Error('Receta no encontrada');

        let totalRawCost = 0;
        const breakdown = [];

        for (const item of bom.Items) {
            const prod = item.ComponentProduct;
            const unitCost = prod ? (parseFloat(prod.cost) || 0) : 0;
            const wasteMult = 1 + ((parseFloat(item.wastePercentage) || 0) / 100);
            const effQty = (parseFloat(item.quantityRequired) || 0) * wasteMult;
            const lineCost = effQty * unitCost;

            totalRawCost += lineCost;
            breakdown.push({
                productId: prod?.id,
                productName: prod?.name || 'Insumo',
                quantity: item.quantityRequired,
                unit: item.unit,
                wastePercentage: item.wastePercentage,
                unitCost,
                lineCost
            });
        }

        const labor = parseFloat(bom.laborCost) || 0;
        const overhead = parseFloat(bom.overheadCost) || 0;
        const totalBatchCost = totalRawCost + labor + overhead;
        const yieldQty = parseFloat(bom.yieldQuantity) || 1;
        const unitCost = totalBatchCost / (yieldQty > 0 ? yieldQty : 1);

        return {
            bomId: bom.id,
            recipeName: bom.recipeName,
            yieldQuantity: yieldQty,
            totalRawCost,
            laborCost: labor,
            overheadCost: overhead,
            totalBatchCost,
            unitCost,
            breakdown
        };
    }

    /**
     * Inicia una orden de producción
     */
    static async createProductionOrder({
        companyId = 'default',
        bomId,
        warehouseSourceId = null,
        warehouseDestId = null,
        quantityPlanned = 1,
        userId = null,
        notes = ''
    }) {
        const bom = await BillOfMaterials.findByPk(bomId, {
            include: [{ model: BillOfMaterialsItem, as: 'Items' }]
        });

        if (!bom) throw new Error('Receta BOM no encontrada');

        const year = new Date().getFullYear();
        const count = await ProductionOrder.count({
            where: {
                companyId,
                createdAt: { [Op.gte]: new Date(`${year}-01-01`) }
            }
        });
        const orderNumber = `OP-${year}-${String(count + 1).padStart(5, '0')}`;

        const costCalc = await this.calculateRecipeCost(bomId);
        const mult = (parseFloat(quantityPlanned) || 1) / (parseFloat(bom.yieldQuantity) || 1);
        const estTotalCost = costCalc.totalBatchCost * mult;

        // Sanitizar y validar almacenes para evitar violaciones de clave foránea en Postgres
        let validSourceId = (warehouseSourceId && typeof warehouseSourceId === 'string' && warehouseSourceId.trim()) ? warehouseSourceId.trim() : null;
        let validDestId = (warehouseDestId && typeof warehouseDestId === 'string' && warehouseDestId.trim()) ? warehouseDestId.trim() : null;

        if (validSourceId) {
            const whSource = await Warehouse.findByPk(validSourceId);
            if (!whSource) validSourceId = null;
        }
        if (!validSourceId) {
            const defSource = await Warehouse.findOne({
                where: { [Op.or]: [{ companyId }, { companyId: 'default' }] },
                order: [['isDefaultSaleWarehouse', 'DESC'], ['createdAt', 'ASC']]
            });
            if (defSource) validSourceId = defSource.id;
        }

        if (validDestId) {
            const whDest = await Warehouse.findByPk(validDestId);
            if (!whDest) validDestId = null;
        }
        if (!validDestId) {
            const defDest = await Warehouse.findOne({
                where: { [Op.or]: [{ companyId }, { companyId: 'default' }] },
                order: [['isDefaultSaleWarehouse', 'DESC'], ['createdAt', 'ASC']]
            });
            if (defDest) validDestId = defDest.id;
        }

        return await ProductionOrder.create({
            id: generateRobustId(),
            companyId,
            orderNumber,
            bomId,
            warehouseSourceId: validSourceId,
            warehouseDestId: validDestId,
            quantityPlanned: parseFloat(quantityPlanned) || 1,
            quantityActual: 0,
            totalRawCost: costCalc.totalRawCost * mult,
            totalProductionCost: estTotalCost,
            unitFinalCost: costCalc.unitCost,
            status: 'IN_PROGRESS',
            userId,
            notes: notes || ''
        });
    }

    /**
     * Completa la orden de producción: rebaja insumos, carga producto terminado y contabiliza
     */
    static async completeProductionOrder(orderId, { quantityActual, userId = null, companyId = 'default', notes = '' }) {
        return await sequelize.transaction(async (t) => {
            const order = await ProductionOrder.findOne({
                where: { id: orderId, companyId },
                include: [
                    {
                        model: BillOfMaterials,
                        as: 'BOM',
                        include: [
                            {
                                model: BillOfMaterialsItem,
                                as: 'Items',
                                include: [{ model: Product, as: 'ComponentProduct' }]
                            },
                            { model: Product, as: 'TargetProduct' }
                        ]
                    }
                ],
                transaction: t,
                lock: t.LOCK ? t.LOCK.UPDATE : undefined
            });

            if (!order) throw new Error('Orden de producción no encontrada');
            if (order.status === 'COMPLETED') throw new Error('Esta orden ya fue completada previamente.');

            const bom = order.BOM;
            if (!bom) throw new Error('Receta asociada no encontrada');

            const actualQty = parseFloat(quantityActual) || parseFloat(order.quantityPlanned) || 1;
            const targetProduct = bom.TargetProduct;
            if (!targetProduct) throw new Error('Producto terminado no encontrado en el catálogo');

            const mult = actualQty / (parseFloat(bom.yieldQuantity) || 1);
            let actualRawCost = 0;

            const whSource = order.warehouseSourceId ? await Warehouse.findByPk(order.warehouseSourceId, { transaction: t }) : null;
            const whDest = order.warehouseDestId ? await Warehouse.findByPk(order.warehouseDestId, { transaction: t }) : null;
            const defaultBranch = (!whSource?.branchId || !whDest?.branchId) && Branch
                ? await Branch.findOne({ where: { companyId }, order: [['isMain', 'DESC'], ['createdAt', 'ASC']], transaction: t })
                : null;
            const sourceBranchId = whSource?.branchId || defaultBranch?.id || null;
            const destBranchId = whDest?.branchId || defaultBranch?.id || null;
            const nowIso = new Date().toISOString();

            // 1. Rebajar materias primas
            for (const item of bom.Items) {
                const compProduct = item.ComponentProduct;
                if (!compProduct) continue;

                const wasteMult = 1 + ((parseFloat(item.wastePercentage) || 0) / 100);
                const qtyToDeduct = (parseFloat(item.quantityRequired) || 0) * mult * wasteMult;
                const unitCost = parseFloat(compProduct.cost) || 0;
                actualRawCost += (qtyToDeduct * unitCost);

                // Rebajar stock global
                const currentStock = parseFloat(compProduct.stockQuantity) || 0;
                const nextCompStock = currentStock - qtyToDeduct;
                await compProduct.update({
                    stockQuantity: String(nextCompStock),
                    stock: nextCompStock
                }, { transaction: t });

                // Rebajar stock de almacén específico si se especificó
                if (order.warehouseSourceId) {
                    const ws = await WarehouseStock.findOne({
                        where: { warehouseId: order.warehouseSourceId, productId: compProduct.id },
                        transaction: t
                    });
                    if (ws) {
                        const wsQty = parseFloat(ws.quantity) || 0;
                        await ws.update({ quantity: wsQty - qtyToDeduct }, { transaction: t });
                    }
                }

                // Sincronizar BranchStock origen
                if (sourceBranchId && BranchStock) {
                    const bs = await BranchStock.findOne({
                        where: { branchId: sourceBranchId, productId: compProduct.id, companyId },
                        transaction: t
                    });
                    if (bs) {
                        await bs.update({ quantity: (parseFloat(bs.quantity) || 0) - qtyToDeduct }, { transaction: t });
                    }
                }

                // Kardex Insumo (columnas reales de StockMovement)
                await StockMovement.create({
                    id: generateRobustId(),
                    productId: compProduct.id,
                    userId: userId || 'admin',
                    type: 'OUT',
                    quantity: qtyToDeduct,
                    stockBefore: String(currentStock),
                    stockAfter: String(nextCompStock),
                    referenceId: order.id,
                    reason: `Consumo producción ${order.orderNumber} (${bom.recipeName})`,
                    date: nowIso,
                    companyId
                }, { transaction: t });
            }

            // 2. Cargar Producto Terminado
            const labor = (parseFloat(bom.laborCost) || 0) * mult;
            const overhead = (parseFloat(bom.overheadCost) || 0) * mult;
            const totalCost = actualRawCost + labor + overhead;
            const unitFinalCost = totalCost / actualQty;

            const targetCurrentStock = parseFloat(targetProduct.stockQuantity) || 0;
            const newTargetStock = targetCurrentStock + actualQty;

            // Actualizar costo ponderado del producto terminado
            let newTargetCost = unitFinalCost;
            if (targetCurrentStock > 0) {
                const prevCost = parseFloat(targetProduct.cost) || 0;
                newTargetCost = ((targetCurrentStock * prevCost) + totalCost) / newTargetStock;
            }

            await targetProduct.update({
                stockQuantity: String(newTargetStock),
                stock: newTargetStock,
                cost: newTargetCost
            }, { transaction: t });

            // Almacén destino si aplica
            if (order.warehouseDestId) {
                let wsDest = await WarehouseStock.findOne({
                    where: { warehouseId: order.warehouseDestId, productId: targetProduct.id },
                    transaction: t
                });
                if (wsDest) {
                    await wsDest.update({ quantity: (parseFloat(wsDest.quantity) || 0) + actualQty }, { transaction: t });
                } else {
                    await WarehouseStock.create({
                        id: generateRobustId(),
                        warehouseId: order.warehouseDestId,
                        productId: targetProduct.id,
                        quantity: actualQty,
                        companyId
                    }, { transaction: t });
                }
            }

            // Sincronizar BranchStock destino
            if (destBranchId && BranchStock) {
                const [bsDest] = await BranchStock.findOrCreate({
                    where: { branchId: destBranchId, productId: targetProduct.id, companyId },
                    defaults: { quantity: 0 },
                    transaction: t
                });
                await bsDest.update({ quantity: (parseFloat(bsDest.quantity) || 0) + actualQty }, { transaction: t });
            }

            // Kardex Producto Terminado (columnas reales de StockMovement)
            await StockMovement.create({
                id: generateRobustId(),
                productId: targetProduct.id,
                userId: userId || 'admin',
                type: 'IN',
                quantity: actualQty,
                stockBefore: String(targetCurrentStock),
                stockAfter: String(newTargetStock),
                referenceId: order.id,
                reason: `Entrada por Producción ${order.orderNumber} (${bom.recipeName})`,
                date: nowIso,
                companyId
            }, { transaction: t });

            // 3. Generar Asiento Contable de Transformación
            let journalEntry = null;
            try {
                const accProdTerminado = await AccountingEngineService.findAccountByCode('1.1.3.03.001', companyId) ||
                    await AccountingEngineService.findAccountByCode('1.1.3.01.001', companyId);
                const accMateriaPrima = await AccountingEngineService.findAccountByCode('1.1.3.02.001', companyId) ||
                    await AccountingEngineService.findAccountByCode('1.1.3.01.001', companyId);
                const accCostosFab = await AccountingEngineService.findAccountByCode('5.1.2.01.001', companyId);

                if (accProdTerminado && accMateriaPrima) {
                    const lines = [
                        // Cargo a Producto Terminado
                        {
                            accountId: accProdTerminado.id,
                            description: `Entrada Producción ${order.orderNumber} - ${bom.recipeName}`,
                            debit: totalCost,
                            credit: 0
                        },
                        // Abono a Materias Primas
                        {
                            accountId: accMateriaPrima.id,
                            description: `Descargo de Insumos ${order.orderNumber}`,
                            debit: 0,
                            credit: actualRawCost
                        }
                    ];

                    // Si hay mano de obra o costos indirectos, abonar
                    const laborAndOverhead = labor + overhead;
                    if (laborAndOverhead > 0 && accCostosFab) {
                        lines.push({
                            accountId: accCostosFab.id,
                            description: `Mano de Obra & Costos Fab ${order.orderNumber}`,
                            debit: 0,
                            credit: laborAndOverhead
                        });
                    }

                    journalEntry = await AccountingEngineService.createEntry({
                        companyId,
                        entryDate: new Date().toISOString().split('T')[0],
                        description: `Contabilización Producción: ${order.orderNumber} (${bom.recipeName})`,
                        entryType: 'AUTOMATIC',
                        currency: 'USD',
                        referenceType: 'PRODUCTION',
                        referenceId: order.id,
                        userId,
                        lines,
                        transaction: t
                    });
                }
            } catch (accErr) {
                console.warn('[Production] Aviso al generar asiento contable de producción:', accErr.message);
            }

            // 4. Actualizar estado de la orden
            await order.update({
                quantityActual: actualQty,
                totalRawCost: actualRawCost,
                totalProductionCost: totalCost,
                unitFinalCost,
                status: 'COMPLETED',
                completedAt: new Date(),
                journalEntryId: journalEntry?.id || null,
                notes: notes || order.notes
            }, { transaction: t });

            return {
                success: true,
                status: 'COMPLETED',
                orderNumber: order.orderNumber,
                quantityProduced: actualQty,
                unitCost: unitFinalCost,
                totalCost,
                journalEntryId: journalEntry?.id || null,
                journalEntryNumber: journalEntry?.entryNumber || null
            };
        });
    }

    /**
     * Hook para ventas de Kits / Combos en el mostrador del POS:
     * Si el producto vendido es un combo rápido (`isKit === true`), rebaja sus componentes.
     */
    static async processKitSaleDeduction(saleItem, transaction, companyId = 'default') {
        try {
            const bom = await BillOfMaterials.findOne({
                where: { targetProductId: saleItem.productId, isKit: true, isActive: true, companyId },
                include: [{ model: BillOfMaterialsItem, as: 'Items' }],
                transaction
            });

            if (!bom || !bom.Items || bom.Items.length === 0) return false;

            const saleQty = parseFloat(saleItem.quantity) || 1;
            const yieldQty = parseFloat(bom.yieldQuantity) || 1;
            const mult = saleQty / yieldQty;

            for (const item of bom.Items) {
                const compProduct = await Product.findByPk(item.componentProductId, { transaction });
                if (!compProduct) continue;

                const qtyToDeduct = (parseFloat(item.quantityRequired) || 0) * mult;
                const currentStock = parseFloat(compProduct.stockQuantity) || 0;

                await compProduct.update({
                    stockQuantity: currentStock - qtyToDeduct
                }, { transaction });

                await StockMovement.create({
                    id: generateRobustId(),
                    productId: compProduct.id,
                    type: 'OUT',
                    quantity: qtyToDeduct,
                    stockBefore: String(currentStock),
                    stockAfter: String(currentStock - qtyToDeduct),
                    referenceId: saleItem.id,
                    reason: `Descuento automático por combo POS: ${bom.recipeName}`,
                    date: new Date().toISOString(),
                    companyId
                }, { transaction });
            }

            return true;
        } catch (err) {
            console.error('[Production] Error al procesar descuento de Kit en POS:', err.message);
            return false;
        }
    }
}

module.exports = ProductionService;
