const { sequelize, Product, Sale, SaleItem, VarianteProducto } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const LANClusterService = require('../services/LANClusterService');

exports.syncOfflineSales = async (req, res) => {
    const { sales } = req.body;
    if (!sales || !Array.isArray(sales) || sales.length === 0) {
        return res.status(400).json({ error: 'Lista de ventas para sincronización vacía o inválida.' });
    }

    const t = await sequelize.transaction();
    const syncedIds = [];
    const errors = [];

    try {
        for (const localSale of sales) {
            try {
                // Deduct stock with row-level locking to prevent concurrency anomalies between instances
                for (const item of localSale.items) {
                    const prodId = String(item.producto_id || item.id);
                    const product = await Product.findOne({
                        where: { id: prodId },
                        transaction: t,
                        lock: t.LOCK.UPDATE
                    });

                    if (product) {
                        const rawStock = Number(product.stockQuantity || 0) - Number(item.quantity);
                        const newStock = Math.round(rawStock * 1000) / 1000;
                        await product.update({
                            stockQuantity: String(newStock),
                            stock: null
                        }, { transaction: t });
                    }

                    if (item.variante_id) {
                        const variant = await VarianteProducto.findOne({
                            where: { id: String(item.variante_id) },
                            transaction: t,
                            lock: t.LOCK.UPDATE
                        });
                        if (variant) {
                            const rawVarStock = Number(variant.stock || 0) - Number(item.quantity);
                            const newVarStock = Math.round(rawVarStock * 1000) / 1000;
                            await variant.update({ stock: newVarStock }, { transaction: t });
                        }
                    }
                }

                // Create Sale record in backend
                const saleId = localSale.id ? String(localSale.id) : generateRobustId();
                const saleDate = localSale.created_at || new Date().toISOString();
                const cleanTotal = Math.round(Number(localSale.total || 0) * 100) / 100;
                const newSale = await Sale.create({
                    id: saleId,
                    companyId: req.user?.companyId || '1',
                    userId: req.user?.id || '1',
                    branchId: req.user?.activeBranchId || '1',
                    registerId: '1',
                    total: cleanTotal,
                    subtotal: cleanTotal,
                    tax: 0,
                    discount: 0,
                    receivedAmount: cleanTotal,
                    changeAmount: 0,
                    customerName: 'Cliente Ocasional',
                    date: saleDate,
                    timestamp: saleDate,
                    status: 'completed',
                    paymentMethod: 'cash',
                    offlineId: localSale.id
                }, { transaction: t });

                // Create SaleItems
                if (localSale.items && localSale.items.length > 0) {
                    const itemsData = localSale.items.map(i => ({
                        saleId: newSale.id,
                        productId: String(i.producto_id || i.id),
                        quantity: Number(i.quantity || 1),
                        price: Math.round(Number(i.precio || 0) * 100) / 100,
                        subtotal: Math.round((Number(i.precio || 0) * Number(i.quantity || 1)) * 100) / 100,
                        name: i.nombre
                    }));
                    await SaleItem.bulkCreate(itemsData, { transaction: t });
                }

                syncedIds.push(localSale.id);
            } catch (itemErr) {
                console.error(`Error procesando venta offline ID ${localSale.id}:`, itemErr);
                errors.push({ id: localSale.id, error: itemErr.message });
            }
        }

        await t.commit();

        // Propagate stock deduction events to all LAN peers instantly
        try {
            const allSyncedItems = [];
            sales.forEach(localSale => {
                if (syncedIds.includes(localSale.id) && Array.isArray(localSale.items)) {
                    allSyncedItems.push(...localSale.items);
                }
            });
            if (allSyncedItems.length > 0) {
                LANClusterService.broadcastLANEvent('lan_stock_update', { items: allSyncedItems, timestamp: Date.now() });
            }
        } catch (lanErr) {}

        return res.json({ success: true, syncedIds, errors });
    } catch (error) {
        await t.rollback();
        console.error('Error global en syncOfflineSales:', error);
        return res.status(500).json({ error: 'Error al procesar lote de transacciones en servidor.' });
    }
};
