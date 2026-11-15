const { Op } = require('sequelize');
const { 
    ProductLot, Product, Supplier, StockMovement, 
    SaleItem, Sale, Promotion, AuditLog, BranchStock, sequelize 
} = require('../database/models');

class BatchTraceabilityService {
    /**
     * Calcula los días restantes para una fecha dada (YYYY-MM-DD)
     */
    static calculateDaysRemaining(expDate) {
        if (!expDate) return 999999;
        const target = new Date(expDate + 'T00:00:00');
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const diffMs = target.getTime() - now.getTime();
        return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    /**
     * Dashboard analítico FEFO con indicadores de capital en riesgo y semáforo
     */
    static async getDashboard(companyId = 'default', { search = '', status = 'all', supplierId = '' } = {}) {
        const whereClause = { companyId };

        if (status === 'active') {
            whereClause.quantity = { [Op.gt]: 0 };
            whereClause.status = 'active';
        }

        if (supplierId) {
            whereClause.supplierId = supplierId;
        }

        const includeProduct = {
            model: Product,
            as: 'Product',
            attributes: ['id', 'name', 'barcode', 'category', 'price', 'cost', 'stock', 'stockQuantity', 'stockUnit', 'imageUri']
        };

        if (search && search.trim()) {
            const cleanSearch = `%${search.trim().toLowerCase()}%`;
            includeProduct.where = {
                [Op.or]: [
                    sequelize.where(sequelize.fn('LOWER', sequelize.col('Product.name')), { [Op.like]: cleanSearch }),
                    sequelize.where(sequelize.fn('LOWER', sequelize.col('Product.barcode')), { [Op.like]: cleanSearch }),
                    sequelize.where(sequelize.fn('LOWER', sequelize.col('ProductLot.lotNumber')), { [Op.like]: cleanSearch })
                ]
            };
        }

        const rawLots = await ProductLot.findAll({
            where: whereClause,
            include: [
                includeProduct,
                {
                    model: Supplier,
                    as: 'Supplier',
                    attributes: ['id', 'name', 'contact', 'phone', 'rif'],
                    required: false
                }
            ],
            order: [
                [sequelize.fn('COALESCE', sequelize.col('ProductLot.expirationDate'), '9999-12-31'), 'ASC'],
                [sequelize.col('ProductLot.createdAt'), 'ASC']
            ]
        });

        // Agrupación y semaforización
        let totalActiveLots = 0;
        let totalUnits = 0;
        let totalCostValue = 0;
        let totalRetailValue = 0;

        let expiredCount = 0;
        let expiredCost = 0;

        let criticalCount = 0; // <= 30 días
        let criticalCost = 0;

        let warningCount = 0; // 31 a 60 días
        let warningCost = 0;

        let healthyCount = 0; // > 60 días
        let healthyCost = 0;

        const processedLots = rawLots.map(lot => {
            const daysRemaining = this.calculateDaysRemaining(lot.expirationDate);
            const qty = Number(lot.quantity) || 0;
            const unitCost = Number(lot.cost || lot.Product?.cost || 0);
            const unitPrice = Number(lot.Product?.price || 0);

            const totalCost = qty * unitCost;
            const totalRetail = qty * unitPrice;

            let healthCategory = 'HEALTHY';
            if (daysRemaining < 0) {
                healthCategory = 'EXPIRED';
            } else if (daysRemaining <= 30) {
                healthCategory = 'CRITICAL';
            } else if (daysRemaining <= 60) {
                healthCategory = 'WARNING';
            }

            if (qty > 0) {
                totalActiveLots++;
                totalUnits += qty;
                totalCostValue += totalCost;
                totalRetailValue += totalRetail;

                if (healthCategory === 'EXPIRED') {
                    expiredCount++;
                    expiredCost += totalCost;
                } else if (healthCategory === 'CRITICAL') {
                    criticalCount++;
                    criticalCost += totalCost;
                } else if (healthCategory === 'WARNING') {
                    warningCount++;
                    warningCost += totalCost;
                } else {
                    healthyCount++;
                    healthyCost += totalCost;
                }
            }

            return {
                id: lot.id,
                lotNumber: lot.lotNumber,
                quantity: qty,
                cost: unitCost,
                totalCost,
                totalRetail,
                expirationDate: lot.expirationDate,
                daysRemaining,
                healthCategory,
                status: lot.status,
                createdAt: lot.createdAt,
                product: lot.Product ? {
                    id: lot.Product.id,
                    name: lot.Product.name,
                    code: lot.Product.barcode || '',
                    barcode: lot.Product.barcode,
                    category: lot.Product.category,
                    price: unitPrice,
                    cost: unitCost,
                    stock: Number(lot.Product.stockQuantity ?? lot.Product.stock ?? 0),
                    stockUnit: lot.Product.stockUnit || 'UND',
                    image: lot.Product.imageUri
                } : null,
                supplier: lot.Supplier ? {
                    id: lot.Supplier.id,
                    name: lot.Supplier.name,
                    contactName: lot.Supplier.contact || '',
                    phone: lot.Supplier.phone
                } : null
            };
        });

        // Filtrado por tab de estado si aplica
        let filteredLots = processedLots;
        if (status === 'expired') {
            filteredLots = processedLots.filter(l => l.healthCategory === 'EXPIRED');
        } else if (status === 'critical') {
            filteredLots = processedLots.filter(l => l.healthCategory === 'CRITICAL');
        } else if (status === 'warning') {
            filteredLots = processedLots.filter(l => l.healthCategory === 'WARNING');
        } else if (status === 'healthy') {
            filteredLots = processedLots.filter(l => l.healthCategory === 'HEALTHY');
        }

        return {
            summary: {
                totalActiveLots,
                totalUnits: Math.round(totalUnits * 100) / 100,
                totalCostValue: Math.round(totalCostValue * 100) / 100,
                totalRetailValue: Math.round(totalRetailValue * 100) / 100,
                expired: {
                    count: expiredCount,
                    capitalRisk: Math.round(expiredCost * 100) / 100
                },
                critical: {
                    count: criticalCount,
                    capitalRisk: Math.round(criticalCost * 100) / 100
                },
                warning: {
                    count: warningCount,
                    capitalRisk: Math.round(warningCost * 100) / 100
                },
                healthy: {
                    count: healthyCount,
                    capitalRisk: Math.round(healthyCost * 100) / 100
                }
            },
            lots: filteredLots
        };
    }

    /**
     * Registra o actualiza un lote individual
     */
    static async createOrUpdateLot(lotData, companyId = 'default') {
        const {
            id,
            productId,
            lotNumber,
            quantity,
            expirationDate,
            cost,
            supplierId,
            status = 'active'
        } = lotData;

        if (!productId) throw new Error('El ID de producto es obligatorio.');
        if (!lotNumber || !lotNumber.trim()) throw new Error('El número de lote es obligatorio.');

        const numQty = parseFloat(quantity);
        if (isNaN(numQty) || numQty < 0) throw new Error('La cantidad debe ser un número válido.');

        const product = await Product.findByPk(productId);
        if (!product) throw new Error('El producto asociado no existe.');

        let lot;
        if (id) {
            lot = await ProductLot.findOne({ where: { id, companyId } });
            if (!lot) throw new Error('Lote no encontrado.');
            await lot.update({
                lotNumber: lotNumber.trim(),
                quantity: numQty,
                expirationDate: expirationDate || null,
                cost: cost !== undefined ? parseFloat(cost) : lot.cost,
                supplierId: supplierId || lot.supplierId,
                status: numQty <= 0 ? 'exhausted' : status
            });
        } else {
            const lotId = `lot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            lot = await ProductLot.create({
                id: lotId,
                companyId,
                productId,
                lotNumber: lotNumber.trim(),
                quantity: numQty,
                expirationDate: expirationDate || null,
                cost: cost !== undefined ? parseFloat(cost) : (product.cost || 0),
                supplierId: supplierId || product.supplierId || null,
                status: numQty <= 0 ? 'exhausted' : 'active'
            });
        }

        // Actualizar la fecha de vencimiento del producto si este lote vence antes (FEFO)
        if (expirationDate) {
            const earliestLot = await ProductLot.findOne({
                where: { productId, companyId, quantity: { [Op.gt]: 0 }, expirationDate: { [Op.ne]: null } },
                order: [['expirationDate', 'ASC']]
            });
            if (earliestLot && earliestLot.expirationDate) {
                await product.update({ expirationDate: earliestLot.expirationDate });
            }
        }

        return lot;
    }

    /**
     * Da de baja un lote (Merma / Caducidad / Retiro Sanitario) con trazabilidad contable
     */
    static async writeOffLot(lotId, { companyId = 'default', userId = null, responsibleName = 'Supervisor', reason = 'Caducidad vencida', notes = '', quantity = null } = {}) {
        return await sequelize.transaction(async (t) => {
            const lot = await ProductLot.findOne({
                where: { id: lotId, companyId },
                include: [{ model: Product, as: 'Product' }],
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (!lot) throw new Error('El lote especificado no existe.');
            const currentQty = Number(lot.quantity) || 0;
            if (currentQty <= 0) throw new Error('El lote ya no cuenta con existencias para dar de baja.');

            const deductQty = quantity !== null ? Math.min(Number(quantity), currentQty) : currentQty;
            const newLotQty = currentQty - deductQty;

            await lot.update({
                quantity: newLotQty,
                status: newLotQty <= 0 ? 'exhausted' : lot.status
            }, { transaction: t });

            const product = lot.Product;
            if (product) {
                await product.decrement(['stockQuantity', 'stock'], { by: deductQty, transaction: t });

                // Sincronizar también BranchStock si existen registros multi-sede para este producto
                if (BranchStock) {
                    const branchStocks = await BranchStock.findAll({
                        where: { productId: product.id, companyId },
                        order: [['stockQuantity', 'DESC']],
                        transaction: t,
                        lock: t.LOCK.UPDATE
                    });
                    let pendingBranchDeduct = deductQty;
                    for (const bs of branchStocks) {
                        if (pendingBranchDeduct <= 0) break;
                        const avail = Math.max(0, Number(bs.stockQuantity) || 0);
                        if (avail <= 0) continue;
                        const take = Math.min(avail, pendingBranchDeduct);
                        await bs.update({ stockQuantity: Number((avail - take).toFixed(4)) }, { transaction: t });
                        pendingBranchDeduct -= take;
                    }
                }

                // Registrar movimiento formal en StockMovement
                const movementId = `waste_lot_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                const unitCost = Number(lot.cost || product.cost || 0);

                await StockMovement.create({
                    id: movementId,
                    productId: product.id,
                    userId: userId || null,
                    companyId,
                    type: 'WASTE',
                    category: 'caducidad',
                    quantity: deductQty,
                    costPrice: unitCost,
                    totalCost: deductQty * unitCost,
                    responsibleName: responsibleName || 'Control de Lotes',
                    date: new Date().toISOString(),
                    notes: `Baja de lote por caducidad: Lote #${lot.lotNumber} (Vence: ${lot.expirationDate || 'N/A'}). Motivo: ${reason}. ${notes}`.trim()
                }, { transaction: t });
            }

            // Registrar en auditoría
            await AuditLog.create({
                id: `audit_lot_${Date.now()}`,
                companyId,
                userId: userId || null,
                action: 'BAJA_LOTE_CADUCIDAD',
                entity: 'ProductLot',
                entityId: lot.id,
                details: {
                    lotNumber: lot.lotNumber,
                    productId: lot.productId,
                    productName: product?.name,
                    deductedQuantity: deductQty,
                    remainingQuantity: newLotQty,
                    reason,
                    notes
                }
            }, { transaction: t });

            return {
                success: true,
                lotId: lot.id,
                deductedQuantity: deductQty,
                remainingQuantity: newLotQty,
                message: `Se dieron de baja ${deductQty} unidades del lote #${lot.lotNumber} por caducidad.`
            };
        });
    }

    /**
     * Convierte un lote próximo a vencer en una Oferta/Promoción rápida en 1 clic
     */
    static async createPromoFromLot(lotId, { companyId = 'default', discountPercentage = 20, promoDays = 15, customName = null } = {}) {
        const lot = await ProductLot.findOne({
            where: { id: lotId, companyId },
            include: [{ model: Product, as: 'Product' }]
        });

        if (!lot) throw new Error('Lote no encontrado.');
        if (!lot.Product) throw new Error('El producto del lote no existe.');

        const disc = Math.min(Math.max(Number(discountPercentage) || 20, 5), 90);
        const days = Math.min(Math.max(Number(promoDays) || 15, 1), 90);

        const startDate = new Date();
        const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        const promoId = `promo_fefo_${Date.now()}`;
        const promoName = customName || `Liquidación FEFO - Lote #${lot.lotNumber} (${lot.Product.name})`;

        const promo = await Promotion.create({
            id: promoId,
            companyId,
            name: promoName,
            description: `Promoción preventiva para lote #${lot.lotNumber} con caducidad el ${lot.expirationDate || 'próxima'}. Descuento del ${disc}%.`,
            type: 'VOLUME_DISCOUNT',
            buyQuantity: 1,
            payQuantity: 1,
            discountPercentage: disc,
            targetProductIds: [lot.productId],
            startDate,
            endDate,
            isActive: true,
            status: 'ACTIVE'
        });

        return {
            success: true,
            promotion: promo,
            message: `¡Oferta creada exitosamente! Descuento del ${disc}% activo para ${lot.Product.name} por ${days} días.`
        };
    }

    /**
     * Trazabilidad completa de un lote: ingreso, existencias y salidas/tickets
     */
    static async getLotTraceability(lotId, companyId = 'default') {
        const lot = await ProductLot.findOne({
            where: { id: lotId, companyId },
            include: [
                { model: Product, as: 'Product' },
                { model: Supplier, as: 'Supplier' }
            ]
        });

        if (!lot) throw new Error('Lote no encontrado.');

        // Salidas asociadas a este lote en ventas (por batchNumber)
        let saleItems = [];
        try {
            saleItems = await SaleItem.findAll({
                where: {
                    productId: lot.productId,
                    batchNumber: lot.lotNumber,
                    companyId
                },
                order: [['createdAt', 'DESC']],
                limit: 50
            });
        } catch (e) {
            saleItems = [];
        }

        // Movimientos de merma o ajustes de este producto y lote
        const stockMovements = await StockMovement.findAll({
            where: {
                productId: lot.productId,
                companyId,
                notes: { [Op.like]: `%${lot.lotNumber}%` }
            },
            order: [['createdAt', 'DESC']],
            limit: 20
        });

        return {
            lot: {
                id: lot.id,
                lotNumber: lot.lotNumber,
                quantity: Number(lot.quantity),
                cost: Number(lot.cost),
                expirationDate: lot.expirationDate,
                daysRemaining: this.calculateDaysRemaining(lot.expirationDate),
                status: lot.status,
                createdAt: lot.createdAt
            },
            product: lot.Product ? {
                id: lot.Product.id,
                name: lot.Product.name,
                code: lot.Product.barcode || '',
                barcode: lot.Product.barcode,
                category: lot.Product.category,
                price: Number(lot.Product.price)
            } : null,
            supplier: lot.Supplier ? {
                id: lot.Supplier.id,
                name: lot.Supplier.name,
                phone: lot.Supplier.phone
            } : null,
            salesHistory: saleItems.map(si => ({
                saleId: si.saleId,
                quantity: Number(si.quantity),
                price: Number(si.price),
                subtotal: Number(si.subtotal),
                date: si.createdAt
            })),
            wasteHistory: stockMovements.map(sm => ({
                id: sm.id,
                type: sm.type,
                category: sm.category,
                quantity: Number(sm.quantity),
                cost: Number(sm.totalCost),
                responsible: sm.responsibleName,
                notes: sm.notes,
                date: sm.createdAt
            }))
        };
    }
}

module.exports = BatchTraceabilityService;
