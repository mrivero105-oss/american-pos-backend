const { Sale, SaleItem, Product } = require('../database/models');
const { Op, fn, col, literal } = require('sequelize');
const cache = require('../utils/cacheService');

class StockIntelligenceService {
    /**
     * Calculates stock intelligence (velocity and prediction) for all products
     * based on a specified rolling window (default 14 days).
     */
    static async getStockPredictions(companyId, daysWindow = 14) {
        const cacheKey = `stock_predictions_${companyId}_${daysWindow}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysWindow);

            // 1. Get total units sold per product in the window
            const salesStats = await SaleItem.findAll({
                attributes: [
                    'productId',
                    [fn('SUM', col('quantity')), 'totalSold'],
                    [fn('COUNT', fn('DISTINCT', fn('date', col('SaleItem.createdAt')))), 'activeDays']
                ],
                include: [{
                    model: Sale,
                    as: 'Sale',
                    attributes: [],
                    where: {
                        companyId,
                        status: 'completed',
                        createdAt: { [Op.gte]: startDate }
                    }
                }],
                group: ['productId'],
                raw: true
            });

            // 2. Fetch current stock levels for products that had sales
            const productIds = salesStats.map(s => s.productId).filter(Boolean);
            const products = await Product.findAll({
                where: { id: { [Op.in]: productIds }, companyId },
                attributes: ['id', 'name', 'stock', 'minStock'],
                raw: true
            });

            // 3. Calculate Intelligence
            const predictions = salesStats.map(stat => {
                const product = products.find(p => p.id === stat.productId);
                if (!product) return null;

                const totalSold = parseFloat(stat.totalSold) || 0;
                // Stability factor: use either daysWindow or activeDays?
                // For a prediction engine, we use the full window to flatten spikes.
                const velocity = totalSold / daysWindow; 
                
                const stock = parseFloat(product.stock) || 0;
                let daysRemaining = velocity > 0 ? (stock / velocity) : 999;

                // Determine Status
                let status = 'stable';
                if (daysRemaining < 3) status = 'critical';
                else if (daysRemaining < 7) status = 'warning';
                else if (velocity > (stock * 0.2)) status = 'high_rotation'; // 20% of stock sold in 1 day

                return {
                    productId: product.id,
                    name: product.name,
                    velocity: velocity.toFixed(4),
                    totalSoldInWindow: totalSold,
                    stock: stock,
                    daysRemaining: Math.ceil(daysRemaining),
                    status
                };
            }).filter(Boolean);

            // Cache for 5 minutes
            cache.set(cacheKey, predictions, 300);

            return predictions;
        } catch (error) {
            console.error('Error in StockIntelligenceService:', error);
            throw error;
        }
    }
}

module.exports = StockIntelligenceService;
