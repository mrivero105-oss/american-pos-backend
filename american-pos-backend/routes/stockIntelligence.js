const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Product, SaleItem, Sale } = require('../database/models');
const { sequelize } = require('../database/connection');
const StockIntelligenceService = require('../services/StockIntelligenceService');

const precision = require('../utils/precision');

// GET /api/stock-intelligence/suggestions
router.get('/suggestions', async (req, res) => {
    try {
        const userRole = String(req.user?.role || '').toLowerCase();
        const companyId = (userRole === 'superadmin' && req.query.companyId)
            ? String(req.query.companyId)
            : String(req.user?.companyId || '2');

        // 1. Get all products
        const products = await Product.findAll({
            where: { companyId },
            attributes: ['id', 'name', 'stockQuantity', 'stock', 'minStock'],
            raw: true
        });

        // 2. Define timeframe (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const startDate = thirtyDaysAgo.toISOString();

        // 3. Get aggregated sales data for the last 30 days in ONE query
        const salesData = await SaleItem.findAll({
            attributes: [
                'productId',
                [sequelize.fn('SUM', sequelize.cast(sequelize.col('quantity'), 'REAL')), 'totalSold']
            ],
            include: [{
                model: Sale,
                attributes: [],
                where: {
                    companyId,
                    date: { [Op.gte]: startDate },
                    status: { [Op.in]: ['completed', 'paid', 'partially_refunded'] }
                }
            }],
            group: ['productId'],
            raw: true
        });

        // 4. Map sales data for O(1) lookup
        const salesMap = {};
        salesData.forEach(item => {
            salesMap[item.productId] = parseFloat(item.totalSold) || 0;
        });

        // 5. Calculate suggestions
        const suggestions = products.map((product) => {
            const totalSold = salesMap[product.id] || 0;
            const dailyVelocity = precision.divide(totalSold, 30); // Average units per day

            const rawStock = product.stockQuantity !== undefined && product.stockQuantity !== null ? product.stockQuantity : product.stock;
            const stockQty = parseFloat(rawStock) || 0;
            const minStock = parseFloat(product.minStock) || 0;

            let daysRemaining;
            let status = 'OK';
            let suggestedQty = 0;

            if (stockQty <= 0) {
                // Producto totalmente agotado
                daysRemaining = 0;
                status = 'CRITICAL';
                // Si tenía rotación, reponer para 30 días. Si no tenía rotación, reponer stock mínimo o lote base sugerido
                const neededByVelocity = precision.multiply(dailyVelocity, 30);
                suggestedQty = neededByVelocity > 0 ? neededByVelocity : (minStock > 0 ? minStock : 10);
            } else if (dailyVelocity > 0) {
                // Producto con ventas activas
                daysRemaining = precision.divide(stockQty, dailyVelocity);
                if (daysRemaining <= 3 || stockQty <= minStock) {
                    status = 'CRITICAL';
                    const targetStock = Math.max(precision.multiply(dailyVelocity, 30), minStock);
                    suggestedQty = Math.max(0, precision.subtract(targetStock, stockQty));
                } else if (daysRemaining <= 7) {
                    status = 'WARNING';
                    const targetStock = precision.multiply(dailyVelocity, 30);
                    suggestedQty = Math.max(0, precision.subtract(targetStock, stockQty));
                } else {
                    status = 'OK';
                    suggestedQty = 0;
                }
            } else {
                // Stock > 0 pero 0 ventas en los últimos 30 días
                daysRemaining = 999; // Indica stock disponible sin rotación reciente
                if (stockQty <= minStock && minStock > 0) {
                    status = 'WARNING';
                    suggestedQty = Math.max(0, precision.subtract(minStock, stockQty));
                } else {
                    status = 'OK';
                    suggestedQty = 0;
                }
            }

            return {
                id: product.id,
                name: product.name,
                currentStock: precision.round(stockQty, 3),
                minStock: precision.round(minStock, 3),
                totalSold30d: precision.round(totalSold, 3),
                dailyVelocity: dailyVelocity.toFixed(2),
                daysRemaining: daysRemaining === 999 ? '∞' : Math.floor(daysRemaining),
                suggestedPurchase: Math.ceil(suggestedQty),
                status
            };
        });

        // Ordenar primero productos críticos (agotados o casi agotados), luego advertencias y luego óptimos
        suggestions.sort((a, b) => {
            const rank = { 'CRITICAL': 1, 'WARNING': 2, 'OK': 3 };
            if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
            return a.currentStock - b.currentStock;
        });

        res.json(suggestions);
    } catch (error) {
        console.error('Error calculating stock intelligence:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/stock-intelligence/status
router.get('/status', async (req, res) => {
    try {
        const userRole = String(req.user?.role || '').toLowerCase();
        const companyId = (userRole === 'superadmin' && req.query.companyId)
            ? String(req.query.companyId)
            : String(req.user?.companyId || '2');

        const predictions = await StockIntelligenceService.getStockPredictions(companyId);
        res.json(predictions);
    } catch (error) {
        console.error('Error in /status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
