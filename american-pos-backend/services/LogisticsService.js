const { 
    Warehouse, 
    WarehouseStock, 
    StockTransfer, 
    StockTransferItem, 
    PhysicalInventoryCount, 
    PriceList, 
    ProductPrice, 
    Product, 
    StockMovement, 
    BranchStock,
    sequelize 
} = require('../database/models');
const { Op } = require('sequelize');
const crypto = require('crypto');
const precision = require('../utils/precision');

class LogisticsService {
    // ==========================================
    // 1. ALMACENES (WAREHOUSES)
    // ==========================================
    static async getWarehouses(companyId = 'default', branchId = null) {
        const where = { companyId: companyId || 'default' };
        if (branchId) where.branchId = branchId;

        let warehouses = await Warehouse.findAll({
            where,
            include: [{
                model: WarehouseStock,
                as: 'Stocks',
                attributes: ['id', 'quantity', 'reservedQuantity', 'productId']
            }],
            order: [['isDefaultSaleWarehouse', 'DESC'], ['createdAt', 'ASC']]
        });

        // Auto-crear Almacén por Defecto si no existe ninguno
        if (warehouses.length === 0) {
            const defaultWh = await Warehouse.create({
                id: 'wh_' + Date.now(),
                companyId: companyId || 'default',
                branchId: branchId || null,
                name: 'Piso de Venta Principal',
                code: 'ALM-01',
                description: 'Almacén predeterminado para ventas en mostrador',
                isDefaultSaleWarehouse: true,
                isActive: true,
                status: 'ACTIVO'
            });
            warehouses = [defaultWh];
        }

        return warehouses.map(w => {
            const json = w.toJSON();
            const totalItems = (json.Stocks || []).reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0);
            const distinctProducts = (json.Stocks || []).length;
            return {
                ...json,
                totalItems,
                distinctProducts
            };
        });
    }

    static async createWarehouse(data, companyId = 'default') {
        const id = 'wh_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        let code = data.code ? data.code.toUpperCase().trim() : '';
        if (!code) {
            const count = await Warehouse.count({ where: { companyId: companyId || 'default' } });
            code = `ALM-${String(count + 1).padStart(2, '0')}`;
        }

        if (data.isDefaultSaleWarehouse) {
            // Desmarcar anteriores almacenes por defecto
            await Warehouse.update(
                { isDefaultSaleWarehouse: false },
                { where: { companyId: companyId || 'default', isDefaultSaleWarehouse: true } }
            );
        }

        const warehouse = await Warehouse.create({
            id,
            companyId: companyId || 'default',
            branchId: data.branchId || null,
            name: data.name,
            code,
            description: data.description || '',
            location: data.location || '',
            isDefaultSaleWarehouse: Boolean(data.isDefaultSaleWarehouse),
            isActive: true,
            status: 'ACTIVO'
        });

        return warehouse;
    }

    static async updateWarehouse(id, data, companyId = 'default') {
        const warehouse = await Warehouse.findOne({ where: { id, companyId: companyId || 'default' } });
        if (!warehouse) throw new Error('Almacén no encontrado');

        if (data.isDefaultSaleWarehouse && !warehouse.isDefaultSaleWarehouse) {
            await Warehouse.update(
                { isDefaultSaleWarehouse: false },
                { where: { companyId: companyId || 'default', isDefaultSaleWarehouse: true } }
            );
        }

        await warehouse.update({
            name: data.name ?? warehouse.name,
            code: data.code ? data.code.toUpperCase().trim() : warehouse.code,
            description: data.description ?? warehouse.description,
            location: data.location ?? warehouse.location,
            isDefaultSaleWarehouse: data.isDefaultSaleWarehouse !== undefined ? Boolean(data.isDefaultSaleWarehouse) : warehouse.isDefaultSaleWarehouse,
            isActive: data.isActive !== undefined ? Boolean(data.isActive) : warehouse.isActive,
            status: data.status ?? warehouse.status
        });

        return warehouse;
    }

    static async deleteWarehouse(id, companyId = 'default') {
        const warehouse = await Warehouse.findOne({ where: { id, companyId: companyId || 'default' } });
        if (!warehouse) throw new Error('Almacén no encontrado');

        // Validar que no tenga existencias con stock > 0
        const totalStock = await WarehouseStock.sum('quantity', { where: { warehouseId: id } });
        if (totalStock > 0) {
            throw new Error(`No se puede eliminar el almacén porque contiene ${totalStock} unidades en stock.`);
        }

        await warehouse.destroy();
        return { success: true, message: 'Almacén eliminado correctamente' };
    }

    // ==========================================
    // 2. STOCK DESAGREGADO POR ALMACÉN
    // ==========================================
    static async getWarehouseStock(warehouseId, query = '', companyId = 'default') {
        const whereStock = { warehouseId };
        const whereProduct = { companyId: companyId || 'default' };

        if (query) {
            whereProduct[Op.or] = [
                { name: { [Op.like]: `%${query}%` } },
                { barcode: { [Op.like]: `%${query}%` } }
            ];
        }

        const stocks = await WarehouseStock.findAll({
            where: whereStock,
            include: [{
                model: Product,
                as: 'Product',
                where: whereProduct,
                attributes: ['id', 'name', 'barcode', 'price', 'cost', 'category', 'stockUnit']
            }],
            order: [['createdAt', 'DESC']]
        });

        return stocks.map(s => {
            const p = s.Product || {};
            const qty = parseFloat(s.quantity) || 0;
            const cost = parseFloat(p.cost) || 0;
            return {
                id: s.id,
                warehouseId: s.warehouseId,
                productId: s.productId,
                quantity: qty,
                reservedQuantity: parseFloat(s.reservedQuantity) || 0,
                locationInWarehouse: s.locationInWarehouse,
                productName: p.name || 'Producto sin nombre',
                barcode: p.barcode,
                sku: p.barcode,
                price: parseFloat(p.price) || 0,
                cost: cost,
                valuation: qty * cost,
                unit: p.stockUnit || 'UND'
            };
        });
    }

    static async adjustStock(warehouseId, productId, newQuantity, reason, userId = 'admin', companyId = 'default') {
        const t = await sequelize.transaction();
        try {
            const warehouse = await Warehouse.findByPk(warehouseId, { transaction: t });
            if (!warehouse) throw new Error('Almacén no encontrado');

            const product = await Product.findByPk(productId, { transaction: t });
            if (!product) throw new Error('Producto no encontrado');

            let whStock = await WarehouseStock.findOne({
                where: { warehouseId, productId },
                transaction: t
            });

            const qtyTarget = parseFloat(newQuantity) || 0;
            const previousQty = whStock ? parseFloat(whStock.quantity) || 0 : 0;
            const diff = qtyTarget - previousQty;

            if (!whStock) {
                whStock = await WarehouseStock.create({
                    id: 'ws_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    warehouseId,
                    productId,
                    quantity: qtyTarget,
                    reservedQuantity: 0,
                    companyId: companyId || 'default'
                }, { transaction: t });
            } else {
                await whStock.update({ quantity: qtyTarget }, { transaction: t });
            }

            // Ajustar también el stock global del producto
            const currentGlobalStock = parseFloat(product.stockQuantity || product.stock) || 0;
            const newGlobalStock = Math.max(0, currentGlobalStock + diff);
            await product.update({ stock: newGlobalStock, stockQuantity: String(newGlobalStock) }, { transaction: t });

            // Sincronizar también BranchStock si el almacén pertenece a una sucursal
            if (warehouse.branchId && BranchStock) {
                const [bs] = await BranchStock.findOrCreate({
                    where: { branchId: warehouse.branchId, productId, companyId: companyId || 'default' },
                    defaults: { quantity: 0 },
                    transaction: t
                });
                const nextBs = Math.max(0, (parseFloat(bs.quantity) || 0) + diff);
                await bs.update({ quantity: nextBs }, { transaction: t });
            }

            // Registrar movimiento de auditoría
            await StockMovement.create({
                id: 'mov_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                productId,
                userId: userId || 'admin',
                companyId: companyId || 'default',
                type: diff >= 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO',
                quantity: Math.abs(diff),
                stockBefore: previousQty,
                stockAfter: qtyTarget,
                reason: `Ajuste manual en ${warehouse.name}: ${reason || 'Ajuste de inventario'}`,
                referenceId: warehouseId,
                date: new Date().toISOString()
            }, { transaction: t });

            await t.commit();
            return {
                success: true,
                productId,
                warehouseId,
                previousQuantity: previousQty,
                newQuantity: qtyTarget,
                difference: diff
            };
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    // ==========================================
    // 3. GUÍAS DE TRASLADO (STOCK TRANSFERS)
    // ==========================================
    static async getTransfers(companyId = 'default', filters = {}) {
        const where = { companyId: companyId || 'default' };
        if (filters.status) where.status = filters.status;
        if (filters.fromWarehouseId) where.fromWarehouseId = filters.fromWarehouseId;
        if (filters.toWarehouseId) where.toWarehouseId = filters.toWarehouseId;

        const transfers = await StockTransfer.findAll({
            where,
            include: [
                { model: Warehouse, as: 'FromWarehouse', attributes: ['id', 'name', 'code'] },
                { model: Warehouse, as: 'ToWarehouse', attributes: ['id', 'name', 'code'] },
                { model: StockTransferItem, as: 'Items' }
            ],
            order: [['createdAt', 'DESC']]
        });

        return transfers;
    }

    static async getTransferById(id, companyId = 'default') {
        const transfer = await StockTransfer.findOne({
            where: { id, companyId: companyId || 'default' },
            include: [
                { model: Warehouse, as: 'FromWarehouse' },
                { model: Warehouse, as: 'ToWarehouse' },
                { model: StockTransferItem, as: 'Items' }
            ]
        });
        if (!transfer) throw new Error('Guía de traslado no encontrada');
        return transfer;
    }

    static async createTransfer(data, userId = 'admin', companyId = 'default') {
        if (!data.fromWarehouseId || !data.toWarehouseId) {
            throw new Error('Debe especificar almacén origen y destino');
        }
        if (data.fromWarehouseId === data.toWarehouseId) {
            throw new Error('El almacén origen y destino no pueden ser iguales');
        }
        if (!data.items || data.items.length === 0) {
            throw new Error('Debe incluir al menos un producto a transferir');
        }

        const t = await sequelize.transaction();
        try {
            const count = await StockTransfer.count({ where: { companyId: companyId || 'default' } });
            const transferNumber = `TRF-${String(count + 1).padStart(6, '0')}`;
            const id = 'trf_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

            let totalUnits = 0;
            const itemsData = [];

            for (const item of data.items) {
                const qty = parseFloat(item.quantity) || 0;
                if (qty <= 0) continue;

                totalUnits += qty;
                itemsData.push({
                    id: 'tri_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                    stockTransferId: id,
                    productId: item.productId,
                    productName: item.productName || '',
                    productSku: item.productSku || '',
                    quantityDispatched: qty,
                    quantityReceived: 0,
                    discrepancy: 0,
                    status: 'PENDIENTE'
                });
            }

            const transfer = await StockTransfer.create({
                id,
                companyId: companyId || 'default',
                transferNumber,
                fromWarehouseId: data.fromWarehouseId,
                toWarehouseId: data.toWarehouseId,
                status: data.status === 'EN_TRANSITO' ? 'EN_TRANSITO' : 'BORRADOR',
                driverName: data.driverName || '',
                vehiclePlate: data.vehiclePlate || '',
                notes: data.notes || '',
                dispatchedBy: userId || 'admin',
                dispatchDate: data.status === 'EN_TRANSITO' ? new Date() : null,
                itemsCount: itemsData.length,
                totalUnits
            }, { transaction: t });

            await StockTransferItem.bulkCreate(itemsData, { transaction: t });

            // Si se crea directo como EN_TRANSITO, descontar de origen con validación estricta
            if (data.status === 'EN_TRANSITO') {
                for (const it of itemsData) {
                    let whStock = await WarehouseStock.findOne({
                        where: { warehouseId: data.fromWarehouseId, productId: it.productId },
                        transaction: t,
                        lock: t.LOCK ? t.LOCK.UPDATE : undefined
                    });
                    const currentQty = whStock ? parseFloat(whStock.quantity) || 0 : 0;
                    if (!whStock || currentQty < it.quantityDispatched) {
                        throw new Error(`INSUFFICIENT_WAREHOUSE_STOCK: Stock insuficiente en almacén origen para "${it.productName || it.productId}". Disponible: ${currentQty}, Requerido: ${it.quantityDispatched}`);
                    }
                    const newQty = precision.subtract(currentQty, it.quantityDispatched);
                    await whStock.update({ quantity: newQty }, { transaction: t });
                }
            }

            await t.commit();
            return await this.getTransferById(id, companyId);
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    static async dispatchTransfer(id, userId = 'admin', companyId = 'default') {
        const t = await sequelize.transaction();
        try {
            const transfer = await StockTransfer.findOne({
                where: { id, companyId: companyId || 'default' },
                include: [{ model: StockTransferItem, as: 'Items' }],
                transaction: t
            });

            if (!transfer) throw new Error('Guía de traslado no encontrada');
            if (transfer.status !== 'BORRADOR') {
                throw new Error(`La guía no está en BORRADOR (estado actual: ${transfer.status})`);
            }

            // Descontar inventario del almacén origen con validación estricta
            for (const item of transfer.Items) {
                let whStock = await WarehouseStock.findOne({
                    where: { warehouseId: transfer.fromWarehouseId, productId: item.productId },
                    transaction: t,
                    lock: t.LOCK ? t.LOCK.UPDATE : undefined
                });
                const currentQty = whStock ? parseFloat(whStock.quantity) || 0 : 0;
                const dispatched = parseFloat(item.quantityDispatched) || 0;
                if (!whStock || currentQty < dispatched) {
                    throw new Error(`INSUFFICIENT_WAREHOUSE_STOCK: Stock insuficiente en almacén origen para "${item.productName || item.productId}". Disponible: ${currentQty}, Requerido: ${dispatched}`);
                }
                const newQty = precision.subtract(currentQty, dispatched);
                await whStock.update({ quantity: newQty }, { transaction: t });
            }

            await transfer.update({
                status: 'EN_TRANSITO',
                dispatchedBy: userId || 'admin',
                dispatchDate: new Date()
            }, { transaction: t });

            await t.commit();
            return await this.getTransferById(id, companyId);
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    static async receiveTransfer(id, receivedItems = [], userId = 'admin', notes = '', companyId = 'default') {
        const t = await sequelize.transaction();
        try {
            const transfer = await StockTransfer.findOne({
                where: { id, companyId: companyId || 'default' },
                include: [{ model: StockTransferItem, as: 'Items' }],
                transaction: t
            });

            if (!transfer) throw new Error('Guía de traslado no encontrada');
            if (transfer.status !== 'EN_TRANSITO') {
                throw new Error(`Solo se pueden recibir guías que estén EN_TRANSITO (estado actual: ${transfer.status})`);
            }

            let hasDiscrepancy = false;
            const fromWh = await Warehouse.findByPk(transfer.fromWarehouseId, { transaction: t });
            const toWh = await Warehouse.findByPk(transfer.toWarehouseId, { transaction: t });

            for (const item of transfer.Items) {
                const clientInput = receivedItems.find(r => r.id === item.id || r.productId === item.productId);
                const qtyRec = clientInput !== undefined ? (parseFloat(clientInput.quantityReceived) || 0) : parseFloat(item.quantityDispatched);
                const dispatched = parseFloat(item.quantityDispatched) || 0;
                const disc = qtyRec - dispatched;

                if (disc !== 0) hasDiscrepancy = true;

                await item.update({
                    quantityReceived: qtyRec,
                    discrepancy: disc,
                    discrepancyReason: clientInput?.discrepancyReason || '',
                    status: disc === 0 ? 'CONFORME' : 'DISCREPANCIA'
                }, { transaction: t });

                // Sumar al almacén destino
                let destStock = await WarehouseStock.findOne({
                    where: { warehouseId: transfer.toWarehouseId, productId: item.productId },
                    transaction: t
                });

                if (!destStock) {
                    destStock = await WarehouseStock.create({
                        id: 'ws_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        warehouseId: transfer.toWarehouseId,
                        productId: item.productId,
                        quantity: qtyRec,
                        reservedQuantity: 0,
                        companyId: companyId || 'default'
                    }, { transaction: t });
                } else {
                    const curr = parseFloat(destStock.quantity) || 0;
                    await destStock.update({ quantity: curr + qtyRec }, { transaction: t });
                }

                // Sincronizar BranchStock si el traslado es entre sucursales distintas
                if (BranchStock && fromWh?.branchId && toWh?.branchId && fromWh.branchId !== toWh.branchId) {
                    const bsOrigin = await BranchStock.findOne({
                        where: { branchId: fromWh.branchId, productId: item.productId, companyId: companyId || 'default' },
                        transaction: t
                    });
                    if (bsOrigin) {
                        await bsOrigin.update({ quantity: Math.max(0, (parseFloat(bsOrigin.quantity) || 0) - dispatched) }, { transaction: t });
                    }
                    const [bsDest] = await BranchStock.findOrCreate({
                        where: { branchId: toWh.branchId, productId: item.productId, companyId: companyId || 'default' },
                        defaults: { quantity: 0 },
                        transaction: t
                    });
                    await bsDest.update({ quantity: (parseFloat(bsDest.quantity) || 0) + qtyRec }, { transaction: t });
                }

                // Si hubo discrepancia en tránsito (merma/faltante o sobrante), ajustar el stock global y Kardex
                if (disc !== 0) {
                    const product = await Product.findByPk(item.productId, { transaction: t });
                    if (product) {
                        const prevGlobal = parseFloat(product.stockQuantity || product.stock) || 0;
                        const nextGlobal = Math.max(0, prevGlobal + disc);
                        await product.update({ stock: nextGlobal, stockQuantity: String(nextGlobal) }, { transaction: t });
                        await StockMovement.create({
                            id: 'mov_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                            productId: item.productId,
                            userId: userId || 'admin',
                            companyId: companyId || 'default',
                            type: disc < 0 ? 'OUT' : 'IN',
                            quantity: Math.abs(disc),
                            stockBefore: String(prevGlobal),
                            stockAfter: String(nextGlobal),
                            reason: `Discrepancia en recepción de guía ${transfer.transferNumber}: ${clientInput?.discrepancyReason || (disc < 0 ? 'Merma en tránsito' : 'Sobrante en recepción')}`,
                            referenceId: transfer.id,
                            date: new Date().toISOString()
                        }, { transaction: t });
                    }
                }
            }

            await transfer.update({
                status: hasDiscrepancy ? 'RECIBIDO_DISCREPANCIA' : 'RECIBIDO_TOTAL',
                receivedBy: userId || 'admin',
                receptionDate: new Date(),
                notes: notes ? (transfer.notes ? `${transfer.notes} | ${notes}` : notes) : transfer.notes
            }, { transaction: t });

            await t.commit();
            return await this.getTransferById(id, companyId);
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    // ==========================================
    // 4. TOMAS FÍSICAS DE INVENTARIO (CONTEOS CIEGOS)
    // ==========================================
    static async getInventoryCounts(warehouseId = null, companyId = 'default') {
        const where = { companyId: companyId || 'default' };
        if (warehouseId) where.warehouseId = warehouseId;

        const counts = await PhysicalInventoryCount.findAll({
            where,
            include: [{ model: Warehouse, as: 'Warehouse', attributes: ['id', 'name', 'code'] }],
            order: [['createdAt', 'DESC']]
        });

        return counts;
    }

    static async createInventoryCount(warehouseId, countedBy = '', blindCount = true, companyId = 'default') {
        const warehouse = await Warehouse.findByPk(warehouseId);
        if (!warehouse) throw new Error('Almacén no encontrado');

        // Capturar snapshot de todos los productos y su stock actual en este almacén
        const stocks = await WarehouseStock.findAll({
            where: { warehouseId },
            include: [{
                model: Product,
                as: 'Product',
                attributes: ['id', 'name', 'barcode', 'cost', 'price']
            }]
        });

        const items = stocks.map(s => {
            const p = s.Product || {};
            const sysQty = parseFloat(s.quantity) || 0;
            return {
                productId: s.productId,
                productName: p.name || 'Producto',
                barcode: p.barcode || '',
                sku: p.barcode || '',
                costPrice: parseFloat(p.cost) || 0,
                systemStock: sysQty,
                countedStock: 0, // Inicia en 0 para conteo ciego
                difference: -sysQty,
                differenceCost: -sysQty * (parseFloat(p.cost) || 0),
                counted: false
            };
        });

        const countNumberSequence = await PhysicalInventoryCount.count({ where: { companyId: companyId || 'default' } });
        const countNumber = `CNT-${String(countNumberSequence + 1).padStart(6, '0')}`;
        const id = 'cnt_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

        const count = await PhysicalInventoryCount.create({
            id,
            companyId: companyId || 'default',
            warehouseId,
            countNumber,
            status: 'EN_PROGRESO',
            countedBy: countedBy || '',
            approvedBy: '',
            blindCount: Boolean(blindCount),
            totalDiscrepancyUnits: 0,
            totalDiscrepancyCost: 0,
            notes: '',
            items: items
        });

        return count;
    }

    static async saveCountProgress(id, items, notes = '', companyId = 'default') {
        const count = await PhysicalInventoryCount.findOne({ where: { id, companyId: companyId || 'default' } });
        if (!count) throw new Error('Conteo de inventario no encontrado');
        if (count.status !== 'EN_PROGRESO') throw new Error('El conteo no está en progreso');

        let totalUnitsDiff = 0;
        let totalCostDiff = 0;

        const updatedItems = items.map(it => {
            const sys = parseFloat(it.systemStock) || 0;
            const counted = parseFloat(it.countedStock) || 0;
            const diff = counted - sys;
            const cost = parseFloat(it.costPrice) || 0;
            const diffCost = diff * cost;

            totalUnitsDiff += Math.abs(diff);
            totalCostDiff += diffCost;

            return {
                ...it,
                systemStock: sys,
                countedStock: counted,
                difference: diff,
                differenceCost: diffCost,
                counted: true
            };
        });

        await count.update({
            items: updatedItems,
            totalDiscrepancyUnits: totalUnitsDiff,
            totalDiscrepancyCost: totalCostDiff,
            notes: notes || count.notes
        });

        return count;
    }

    static async applyInventoryCount(id, approvedBy = 'supervisor', notes = '', companyId = 'default') {
        const t = await sequelize.transaction();
        try {
            const count = await PhysicalInventoryCount.findOne({
                where: { id, companyId: companyId || 'default' },
                transaction: t
            });

            if (!count) throw new Error('Conteo no encontrado');
            if (count.status !== 'EN_PROGRESO') throw new Error('Solo se pueden aplicar conteos en progreso');

            const items = count.items || [];
            const warehouseId = count.warehouseId;
            const warehouse = await Warehouse.findByPk(warehouseId, { transaction: t });

            for (const it of items) {
                const targetQty = parseFloat(it.countedStock) || 0;
                const sysQty = parseFloat(it.systemStock) || 0;
                const diff = targetQty - sysQty;

                if (diff === 0) continue; // Sin discrepancia

                // 1. Actualizar WarehouseStock
                let whStock = await WarehouseStock.findOne({
                    where: { warehouseId, productId: it.productId },
                    transaction: t
                });

                if (whStock) {
                    await whStock.update({ quantity: targetQty }, { transaction: t });
                } else {
                    await WarehouseStock.create({
                        id: 'ws_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        warehouseId,
                        productId: it.productId,
                        quantity: targetQty,
                        reservedQuantity: 0,
                        companyId: companyId || 'default'
                    }, { transaction: t });
                }

                // 2. Actualizar Stock global del producto
                const product = await Product.findByPk(it.productId, { transaction: t });
                if (product) {
                    const currentProductStock = parseFloat(product.stockQuantity || product.stock) || 0;
                    const newProdStock = Math.max(0, currentProductStock + diff);
                    await product.update({ stock: newProdStock, stockQuantity: String(newProdStock) }, { transaction: t });
                }

                // 2b. Sincronizar BranchStock si el almacén está asociado a una sucursal
                if (warehouse?.branchId && BranchStock) {
                    const [bs] = await BranchStock.findOrCreate({
                        where: { branchId: warehouse.branchId, productId: it.productId, companyId: companyId || 'default' },
                        defaults: { quantity: 0 },
                        transaction: t
                    });
                    const nextBs = Math.max(0, (parseFloat(bs.quantity) || 0) + diff);
                    await bs.update({ quantity: nextBs }, { transaction: t });
                }

                // 3. Movimiento de auditoría
                await StockMovement.create({
                    id: 'mov_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    productId: it.productId,
                    userId: approvedBy || 'supervisor',
                    companyId: companyId || 'default',
                    type: diff > 0 ? 'CONTEO_FISICO_SOBRANTE' : 'CONTEO_FISICO_FALTANTE',
                    quantity: Math.abs(diff),
                    stockBefore: sysQty,
                    stockAfter: targetQty,
                    reason: `Ajuste por Conteo Físico ${count.countNumber}: ${diff > 0 ? 'Sobrante' : 'Faltante'} de ${Math.abs(diff)} uds.`,
                    referenceId: count.id,
                    date: new Date().toISOString()
                }, { transaction: t });
            }

            await count.update({
                status: 'APLICADO',
                approvedBy: approvedBy || 'supervisor',
                notes: notes ? `${count.notes} | ${notes}` : count.notes
            }, { transaction: t });

            await t.commit();
            return count;
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    // ==========================================
    // 5. LISTAS DE PRECIOS MULTINIVEL
    // ==========================================
    static async getPriceLists(companyId = 'default') {
        let lists = await PriceList.findAll({
            where: { companyId: companyId || 'default' },
            include: [{ model: ProductPrice, as: 'ProductPrices' }],
            order: [['isDefault', 'DESC'], ['createdAt', 'ASC']]
        });

        // Sembrar lista base si no existe ninguna
        if (lists.length === 0) {
            const defaultList = await PriceList.create({
                id: 'pl_' + Date.now(),
                companyId: companyId || 'default',
                name: 'Precio Detal (PVP)',
                code: 'DETAL',
                description: 'Precio de venta al público en mostrador',
                type: 'PERCENTAGE',
                percentageAdjustment: 0,
                currency: 'USD',
                isDefault: true,
                isActive: true
            });

            const mayorList = await PriceList.create({
                id: 'pl_' + (Date.now() + 1),
                companyId: companyId || 'default',
                name: 'Precio Mayorista (-10%)',
                code: 'MAYORISTA',
                description: 'Descuento del 10% para compras al mayor',
                type: 'PERCENTAGE',
                percentageAdjustment: -10,
                currency: 'USD',
                isDefault: false,
                isActive: true
            });

            lists = [defaultList, mayorList];
        }

        return lists;
    }

    static async createPriceList(data, companyId = 'default') {
        const id = 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        let code = data.code ? data.code.toUpperCase().trim() : '';
        if (!code) {
            const count = await PriceList.count({ where: { companyId: companyId || 'default' } });
            code = `PL-${String(count + 1).padStart(2, '0')}`;
        }

        if (data.isDefault) {
            await PriceList.update({ isDefault: false }, { where: { companyId: companyId || 'default' } });
        }

        const priceList = await PriceList.create({
            id,
            companyId: companyId || 'default',
            name: data.name,
            code,
            description: data.description || '',
            type: data.type || 'PERCENTAGE',
            percentageAdjustment: parseFloat(data.percentageAdjustment) || 0,
            currency: data.currency || 'USD',
            isDefault: Boolean(data.isDefault),
            isActive: true
        });

        return priceList;
    }

    static async updatePriceList(id, data, companyId = 'default') {
        const priceList = await PriceList.findOne({ where: { id, companyId: companyId || 'default' } });
        if (!priceList) throw new Error('Lista de precios no encontrada');

        if (data.isDefault && !priceList.isDefault) {
            await PriceList.update({ isDefault: false }, { where: { companyId: companyId || 'default' } });
        }

        await priceList.update({
            name: data.name ?? priceList.name,
            code: data.code ? data.code.toUpperCase().trim() : priceList.code,
            description: data.description ?? priceList.description,
            type: data.type ?? priceList.type,
            percentageAdjustment: data.percentageAdjustment !== undefined ? parseFloat(data.percentageAdjustment) : priceList.percentageAdjustment,
            currency: data.currency ?? priceList.currency,
            isDefault: data.isDefault !== undefined ? Boolean(data.isDefault) : priceList.isDefault,
            isActive: data.isActive !== undefined ? Boolean(data.isActive) : priceList.isActive
        });

        return priceList;
    }

    static async deletePriceList(id, companyId = 'default') {
        const priceList = await PriceList.findOne({ where: { id, companyId: companyId || 'default' } });
        if (!priceList) throw new Error('Lista de precios no encontrada');
        if (priceList.isDefault) throw new Error('No se puede eliminar la lista de precios predeterminada');

        await ProductPrice.destroy({ where: { priceListId: id } });
        await priceList.destroy();
        return { success: true, message: 'Lista de precios eliminada' };
    }

    static async setProductPrice(priceListId, productId, price, minQuantity = 1) {
        let pp = await ProductPrice.findOne({ where: { priceListId, productId } });
        if (pp) {
            await pp.update({ price: parseFloat(price) || 0, minQuantity: parseFloat(minQuantity) || 1 });
        } else {
            pp = await ProductPrice.create({
                id: 'pp_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                priceListId,
                productId,
                price: parseFloat(price) || 0,
                minQuantity: parseFloat(minQuantity) || 1
            });
        }
        return pp;
    }

    static async calculatePriceForProduct(productId, priceListId = null, quantity = 1) {
        const product = await Product.findByPk(productId);
        if (!product) return 0;
        const basePrice = parseFloat(product.price) || 0;

        if (!priceListId) return basePrice;

        const priceList = await PriceList.findByPk(priceListId);
        if (!priceList || !priceList.isActive) return basePrice;

        if (priceList.type === 'FIXED') {
            const customPrice = await ProductPrice.findOne({
                where: { 
                    priceListId, 
                    productId,
                    minQuantity: { [Op.lte]: quantity }
                },
                order: [['minQuantity', 'DESC']]
            });
            if (customPrice) return parseFloat(customPrice.price) || basePrice;
        }

        // Porcentaje sobre base
        const adj = parseFloat(priceList.percentageAdjustment) || 0;
        const finalPrice = basePrice * (1 + (adj / 100));
        return Math.max(0, parseFloat(finalPrice.toFixed(4)));
    }
}

module.exports = LogisticsService;
