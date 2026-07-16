const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Product, SaleItem, Sale } = require('../database/models');
const { sequelize } = require('../database/connection');
const StockIntelligenceService = require('../services/StockIntelligenceService');

// GET /api/stock-intelligence/suggestions
router.get('/suggestions', async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) return res.status(400).json({ error: 'companyId is required' });

        // 1. Get all products
        const products = await Product.findAll({
            where: { companyId },
            attributes: ['id', 'name', 'stockQuantity', 'minStock'],
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
                    status: 'completed'
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
            const dailyVelocity = totalSold / 30; // Average units per day

            // Days of stock remaining
            const stockQty = parseFloat(product.stockQuantity) || 0;
            const minStock = parseFloat(product.minStock) || 0;
            const daysRemaining = dailyVelocity > 0 ? stockQty / dailyVelocity : 999;

            // Suggestion: enough to cover 30 days
            let suggestedQty = 0;
            let status = 'OK';

            if (daysRemaining < 7 || stockQty <= minStock) {
                suggestedQty = (dailyVelocity * 30) - stockQty;
                if (suggestedQty < 0) suggestedQty = 0;
                status = daysRemaining < 3 ? 'CRITICAL' : 'WARNING';
            }

            return {
                id: product.id,
                name: product.name,
                currentStock: stockQty,
                minStock: minStock,
                totalSold30d: totalSold,
                dailyVelocity: dailyVelocity.toFixed(2),
                daysRemaining: daysRemaining === 999 ? '∞' : daysRemaining.toFixed(0),
                suggestedPurchase: Math.ceil(suggestedQty),
                status
            };
        });

        res.json(suggestions.filter(s => s.suggestedPurchase > 0 || s.status !== 'OK'));
    } catch (error) {
        console.error('Error calculating stock intelligence:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/stock-intelligence/status
router.get('/status', async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) return res.status(400).json({ error: 'companyId is required' });

        const predictions = await StockIntelligenceService.getStockPredictions(companyId);
        res.json(predictions);
    } catch (error) {
        console.error('Error in /status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
