const { Sale, SaleItem, Product, Customer, Expense, CashShift } = require('../database/models');
const { sequelize } = require('../database/connection');
const { Op } = require('sequelize');
const precision = require('../utils/precision');
const cache = require('../utils/cacheService');

class AnalyticsService {
    /**
     * Get master dashboard statistics.
     * Includes revenue, profit, debt, and sales trends.
     */
    async getDashboardStats(companyId) {
        const cacheKey = `dashboard_stats_${companyId}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();
        const startOfWeek = new Date(now.setDate(now.getDate() - 7)).toISOString();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        // 1. Core KPIs (USD focus)
        const dailySales = await Sale.sum('total', { 
            where: { companyId, date: { [Op.gte]: startOfDay } } 
        }) || 0;

        const monthlySales = await Sale.sum('total', { 
            where: { companyId, date: { [Op.gte]: startOfMonth } } 
        }) || 0;

        const totalCustomerDebt = await Customer.sum('creditBalance', { 
            where: { companyId } 
        }) || 0;

        const isPg = sequelize.getDialect() === 'postgres';

        // 2. Profit Calculation (Revenue - Cost of Goods Sold)
        // We calculate this from SaleItems to get accurate cost tracking
        const monthlyProfitData = await SaleItem.findAll({
            where: { companyId, createdAt: { [Op.gte]: startOfMonth } },
            attributes: [
                [sequelize.fn('SUM', sequelize.literal(isPg ? '"quantity" * "price"' : 'quantity * price')), 'revenue'],
                [sequelize.fn('SUM', sequelize.literal(isPg ? '"quantity" * "cost"' : 'quantity * cost')), 'cost']
            ],
            raw: true
        });

        const revenue = Number(monthlyProfitData[0]?.revenue || 0);
        const cost = Number(monthlyProfitData[0]?.cost || 0);
        const monthlyProfit = precision.round(revenue - cost, 2);

        // 3. Sales Trend (Last 7 Days)
        const dayExpr = isPg
            ? sequelize.literal('SUBSTRING("date", 1, 10)')
            : sequelize.fn('strftime', '%Y-%m-%d', sequelize.col('date'));

        const weeklyTrends = await Sale.findAll({
            where: { 
                companyId, 
                date: { [Op.gte]: startOfWeek } 
            },
            attributes: [
                [dayExpr, 'day'],
                [sequelize.fn('SUM', sequelize.col('total')), 'total']
            ],
            group: [dayExpr],
            order: [[dayExpr, 'ASC']],
            raw: true
        });

        // 4. Low Stock Critical Alerts
        const criticalStock = await Product.count({
            where: {
                companyId,
                stockQuantity: { [Op.lte]: sequelize.col('minStock') },
                status: 'active'
            }
        });

        const stats = {
            kpis: {
                dailySales: precision.round(dailySales, 2),
                monthlySales: precision.round(monthlySales, 2),
                monthlyProfit: precision.round(monthlyProfit, 2),
                totalCustomerDebt: precision.round(totalCustomerDebt, 2),
                criticalStock
            },
            trends: weeklyTrends.map(t => ({
                day: t.day.split('-').slice(1).reverse().join('/'), // Format DD/MM
                total: precision.round(Number(t.total), 2)
            })),
            generatedAt: new Date().toISOString()
        };

        // Cache for 5 minutes (Dashboard doesn't need to be real-time to the millisecond)
        cache.set(cacheKey, stats, 300);
        return stats;
    }
}

module.exports = new AnalyticsService();
