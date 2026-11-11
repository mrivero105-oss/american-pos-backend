const express = require('express');
const router = express.Router();
const ProductionService = require('../services/ProductionService');
const { BillOfMaterials, BillOfMaterialsItem, ProductionOrder, Product, Warehouse } = require('../database/models');

// Listar recetas (BOM)
router.get('/recipes', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const recipes = await BillOfMaterials.findAll({
            where: { companyId },
            include: [
                {
                    model: BillOfMaterialsItem,
                    as: 'Items',
                    include: [{ model: Product, as: 'ComponentProduct' }]
                },
                { model: Product, as: 'TargetProduct' }
            ],
            order: [['createdAt', 'DESC']]
        });
        res.json({ success: true, recipes });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Crear nueva receta
router.post('/recipes', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const recipe = await ProductionService.createRecipe({
            companyId,
            ...req.body
        });
        res.json({ success: true, recipe });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Simular costo de receta
router.get('/recipes/:id/cost', async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || 'default';
        const costData = await ProductionService.calculateRecipeCost(id, companyId);
        res.json({ success: true, ...costData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Listar órdenes de producción
router.get('/orders', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const orders = await ProductionOrder.findAll({
            where: { companyId },
            include: [
                {
                    model: BillOfMaterials,
                    as: 'BOM',
                    include: [{ model: Product, as: 'TargetProduct' }]
                },
                { model: Warehouse, as: 'SourceWarehouse' },
                { model: Warehouse, as: 'DestWarehouse' }
            ],
            order: [['createdAt', 'DESC']]
        });
        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Iniciar orden de producción
router.post('/orders', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || 'admin';
        const order = await ProductionService.createProductionOrder({
            companyId,
            userId,
            ...req.body
        });
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Completar orden de producción
router.post('/orders/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || 'admin';
        const { quantityActual, notes } = req.body;

        const result = await ProductionService.completeProductionOrder(id, {
            quantityActual,
            notes,
            userId,
            companyId
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = router;
