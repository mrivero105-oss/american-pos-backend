const express = require('express');
const router = express.Router();
const logisticsService = require('../services/LogisticsService');
const { isAdmin, requirePermission } = require('../middleware/auth');

// ==========================================
// 1. ALMACENES
// ==========================================
router.get('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const branchId = req.query.branchId || null;
        const warehouses = await logisticsService.getWarehouses(companyId, branchId);
        res.json(warehouses);
    } catch (error) {
        console.error('Error in GET /warehouses:', error);
        res.status(500).json({ error: error.message || 'Error al obtener almacenes' });
    }
});

router.post('/', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const warehouse = await logisticsService.createWarehouse(req.body, companyId);
        res.status(201).json(warehouse);
    } catch (error) {
        console.error('Error in POST /warehouses:', error);
        res.status(400).json({ error: error.message || 'Error al crear almacén' });
    }
});

router.put('/:id', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const warehouse = await logisticsService.updateWarehouse(req.params.id, req.body, companyId);
        res.json(warehouse);
    } catch (error) {
        console.error('Error in PUT /warehouses/:id:', error);
        res.status(400).json({ error: error.message || 'Error al actualizar almacén' });
    }
});

router.delete('/:id', isAdmin, async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const result = await logisticsService.deleteWarehouse(req.params.id, companyId);
        res.json(result);
    } catch (error) {
        console.error('Error in DELETE /warehouses/:id:', error);
        res.status(400).json({ error: error.message || 'Error al eliminar almacén' });
    }
});

// ==========================================
// 2. STOCK POR ALMACÉN
// ==========================================
router.get('/:id/stock', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const query = req.query.query || '';
        const stocks = await logisticsService.getWarehouseStock(req.params.id, query, companyId);
        res.json(stocks);
    } catch (error) {
        console.error('Error in GET /warehouses/:id/stock:', error);
        res.status(500).json({ error: error.message || 'Error al obtener stock del almacén' });
    }
});

router.post('/:id/adjust-stock', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.username || req.user?.id || 'admin';
        const { productId, newQuantity, reason } = req.body;
        
        if (!productId || newQuantity === undefined) {
            return res.status(400).json({ error: 'productId y newQuantity son requeridos' });
        }

        const result = await logisticsService.adjustStock(
            req.params.id,
            productId,
            newQuantity,
            reason,
            userId,
            companyId
        );
        res.json(result);
    } catch (error) {
        console.error('Error in POST /warehouses/:id/adjust-stock:', error);
        res.status(400).json({ error: error.message || 'Error al ajustar stock' });
    }
});

// ==========================================
// 3. GUÍAS DE TRASLADO (STOCK TRANSFERS)
// ==========================================
router.get('/transfers/list', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const filters = {
            status: req.query.status,
            fromWarehouseId: req.query.fromWarehouseId,
            toWarehouseId: req.query.toWarehouseId
        };
        const transfers = await logisticsService.getTransfers(companyId, filters);
        res.json(transfers);
    } catch (error) {
        console.error('Error in GET /warehouses/transfers/list:', error);
        res.status(500).json({ error: error.message || 'Error al obtener guías de traslado' });
    }
});

router.get('/transfers/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const transfer = await logisticsService.getTransferById(req.params.id, companyId);
        res.json(transfer);
    } catch (error) {
        console.error('Error in GET /warehouses/transfers/:id:', error);
        res.status(404).json({ error: error.message || 'Guía de traslado no encontrada' });
    }
});

router.post('/transfers', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.username || req.user?.id || 'admin';
        const transfer = await logisticsService.createTransfer(req.body, userId, companyId);
        res.status(201).json(transfer);
    } catch (error) {
        console.error('Error in POST /warehouses/transfers:', error);
        res.status(400).json({ error: error.message || 'Error al crear guía de traslado' });
    }
});

router.post('/transfers/:id/dispatch', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.username || req.user?.id || 'admin';
        const transfer = await logisticsService.dispatchTransfer(req.params.id, userId, companyId);
        res.json(transfer);
    } catch (error) {
        console.error('Error in POST /warehouses/transfers/:id/dispatch:', error);
        res.status(400).json({ error: error.message || 'Error al despachar guía' });
    }
});

router.post('/transfers/:id/receive', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.username || req.user?.id || 'admin';
        const { receivedItems, notes } = req.body;
        const transfer = await logisticsService.receiveTransfer(req.params.id, receivedItems, userId, notes, companyId);
        res.json(transfer);
    } catch (error) {
        console.error('Error in POST /warehouses/transfers/:id/receive:', error);
        res.status(400).json({ error: error.message || 'Error al recibir guía' });
    }
});

// ==========================================
// 4. TOMAS FÍSICAS DE INVENTARIO
// ==========================================
router.get('/counts/list', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const warehouseId = req.query.warehouseId || null;
        const counts = await logisticsService.getInventoryCounts(warehouseId, companyId);
        res.json(counts);
    } catch (error) {
        console.error('Error in GET /warehouses/counts/list:', error);
        res.status(500).json({ error: error.message || 'Error al obtener conteos físicos' });
    }
});

router.post('/counts', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const countedBy = req.body.countedBy || req.user?.username || 'admin';
        const { warehouseId, blindCount } = req.body;
        if (!warehouseId) return res.status(400).json({ error: 'warehouseId es requerido' });

        const count = await logisticsService.createInventoryCount(warehouseId, countedBy, blindCount, companyId);
        res.status(201).json(count);
    } catch (error) {
        console.error('Error in POST /warehouses/counts:', error);
        res.status(400).json({ error: error.message || 'Error al iniciar conteo físico' });
    }
});

router.put('/counts/:id/progress', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { items, notes } = req.body;
        const count = await logisticsService.saveCountProgress(req.params.id, items, notes, companyId);
        res.json(count);
    } catch (error) {
        console.error('Error in PUT /warehouses/counts/:id/progress:', error);
        res.status(400).json({ error: error.message || 'Error al guardar progreso de conteo' });
    }
});

router.post('/counts/:id/apply', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const approvedBy = req.user?.username || req.user?.id || 'supervisor';
        const { notes } = req.body;
        const count = await logisticsService.applyInventoryCount(req.params.id, approvedBy, notes, companyId);
        res.json(count);
    } catch (error) {
        console.error('Error in POST /warehouses/counts/:id/apply:', error);
        res.status(400).json({ error: error.message || 'Error al aplicar ajuste de inventario' });
    }
});

// ==========================================
// 5. LISTAS DE PRECIOS
// ==========================================
router.get('/price-lists/list', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const lists = await logisticsService.getPriceLists(companyId);
        res.json(lists);
    } catch (error) {
        console.error('Error in GET /warehouses/price-lists/list:', error);
        res.status(500).json({ error: error.message || 'Error al obtener listas de precios' });
    }
});

router.post('/price-lists', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const list = await logisticsService.createPriceList(req.body, companyId);
        res.status(201).json(list);
    } catch (error) {
        console.error('Error in POST /warehouses/price-lists:', error);
        res.status(400).json({ error: error.message || 'Error al crear lista de precios' });
    }
});

router.put('/price-lists/:id', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const list = await logisticsService.updatePriceList(req.params.id, req.body, companyId);
        res.json(list);
    } catch (error) {
        console.error('Error in PUT /warehouses/price-lists/:id:', error);
        res.status(400).json({ error: error.message || 'Error al actualizar lista de precios' });
    }
});

router.delete('/price-lists/:id', isAdmin, async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const result = await logisticsService.deletePriceList(req.params.id, companyId);
        res.json(result);
    } catch (error) {
        console.error('Error in DELETE /warehouses/price-lists/:id:', error);
        res.status(400).json({ error: error.message || 'Error al eliminar lista de precios' });
    }
});

router.post('/price-lists/:id/prices', requirePermission('canManageInventory'), async (req, res) => {
    try {
        const { productId, price, minQuantity } = req.body;
        const pp = await logisticsService.setProductPrice(req.params.id, productId, price, minQuantity);
        res.json(pp);
    } catch (error) {
        console.error('Error in POST /warehouses/price-lists/:id/prices:', error);
        res.status(400).json({ error: error.message || 'Error al fijar precio de producto' });
    }
});

router.get('/calculate-price', async (req, res) => {
    try {
        const { productId, priceListId, quantity } = req.query;
        if (!productId) return res.status(400).json({ error: 'productId es requerido' });
        const finalPrice = await logisticsService.calculatePriceForProduct(
            productId,
            priceListId || null,
            parseFloat(quantity) || 1
        );
        res.json({ productId, priceListId, quantity, finalPrice });
    } catch (error) {
        console.error('Error in GET /warehouses/calculate-price:', error);
        res.status(500).json({ error: error.message || 'Error al calcular precio' });
    }
});

module.exports = router;
