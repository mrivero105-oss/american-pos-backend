const { Sale, SaleItem, Product, StockMovement, Customer, Expense, AuditLog, User } = require('../database/models');
const { sequelize } = require('../database/connection');
const { Op } = require('sequelize');
const { processSalesAnalysis } = require('../utils/salesAnalytics');
const precision = require('../utils/precision');

class ReportService {
    /**
     * Get audit logs with user info.
     */
    async getAuditLogs(companyId, limit = 200) {
        return await AuditLog.findAll({
            where: { companyId },
            include: [{ model: User, as: 'User', attributes: ['name', 'username'] }],
            order: [['timestamp', 'DESC']],
            limit
        });
    }

    /**
     * Get comprehensive dashboard summary metrics and trends.
     */
    async getDashboardSummary(reqUser, query) {
        const { companyId, role, id: userId } = reqUser;
        const anchorDate = query.start ? new Date(query.start) : new Date();
        const isLocalAnchor = !!query.start;
        let queryStart, queryEnd, daysToFetch;

        if (query.startDate && query.endDate) {
            queryStart = new Date(query.startDate);
            if (isNaN(queryStart.getTime())) queryStart = new Date();
            queryStart.setUTCHours(0, 0, 0, 0);
            
            const endD = new Date(query.endDate);
            if (isNaN(endD.getTime())) endD = new Date();
            endD.setUTCHours(23, 59, 59, 999);
            queryEnd = endD;
            daysToFetch = Math.max(1, Math.ceil((queryEnd - queryStart) / (1000 * 60 * 60 * 24)));
        } else {
            daysToFetch = parseInt(query.days) || 7;
            
            // If from frontend, anchorDate is already local 00:00:00 in UTC format
            const startOfWindow = new Date(anchorDate);
            if (!isLocalAnchor) startOfWindow.setUTCHours(0, 0, 0, 0);
            
            // Go back N days from the anchor
            startOfWindow.setUTCDate(startOfWindow.getUTCDate() - (daysToFetch - 1));
            
            // End of window is exactly N days from the startOfWindow
            const endOfWindow = new Date(startOfWindow.getTime() + (daysToFetch * 24 * 60 * 60 * 1000) - 1);
            
            queryStart = startOfWindow;
            queryEnd = endOfWindow;
        }

        const saleWhere = {
            companyId,
            status: { [Op.notIn]: ['cancelled'] }, // Incluimos 'refunded' y 'partially_refunded' en las ventas brutas
            date: { [Op.gte]: queryStart.toISOString(), [Op.lte]: queryEnd.toISOString() }
        };
        if (role === 'user') saleWhere.userId = userId;

        const { Refund } = require('../database/models');
        const refundWhere = {
            companyId,
            date: { [Op.gte]: queryStart.toISOString(), [Op.lte]: queryEnd.toISOString() }
        };
        if (role === 'user') refundWhere.userId = userId;

        const [summaryMetrics, expensesResult, itemMetrics, salesWindow, expensesWindow, refundsResult] = await Promise.all([
            Sale.findOne({
                attributes: [[sequelize.fn('COUNT', sequelize.col('Sale.id')), 'numberOfSales']],
                where: saleWhere,
                raw: true
            }),
            role !== 'user' ? Expense.findAll({
                where: { companyId, date: { [Op.gte]: queryStart.toISOString(), [Op.lte]: queryEnd.toISOString() } },
                attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']]
            }) : Promise.resolve([{ dataValues: { total: 0 } }]),
            SaleItem.findOne({
                attributes: [
                    [sequelize.literal('SUM("SaleItem"."subtotal")'), 'totalRevenue'],
                    [sequelize.literal('SUM(("SaleItem"."price" - COALESCE("SaleItem"."cost", 0)) * "SaleItem"."quantity")'), 'grossProfit']
                ],
                include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
                raw: true
            }),
            Sale.findAll({
                where: saleWhere,
                include: [{ model: SaleItem, as: 'SaleItems' }],
                order: [['date', 'DESC']],
                limit: 500
            }),
            role !== 'user' ? Expense.findAll({
                where: { companyId, date: { [Op.gte]: queryStart.toISOString(), [Op.lte]: queryEnd.toISOString() } }
            }) : Promise.resolve([]),
            Refund.findAll({
                where: refundWhere,
                attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']]
            })
        ]);

        const totalExpenses = Number(expensesResult[0]?.dataValues?.total) || 0;
        const totalRefunds = Number(refundsResult[0]?.dataValues?.total) || 0;
        const rawRevenue = Number(itemMetrics.totalRevenue) || 0;
        const rawGrossProfit = Number(itemMetrics.grossProfit) || 0;
        
        // Ventas Netas = Ventas Brutas - Devoluciones
        const totalRevenue = Math.max(0, rawRevenue - totalRefunds);
        // Aproximación del costo de las devoluciones (asumiendo margen uniforme)
        const marginRatio = rawRevenue > 0 ? (rawGrossProfit / rawRevenue) : 0;
        const grossProfit = Math.max(0, rawGrossProfit - (totalRefunds * marginRatio));
        
        const numberOfSales = Number(summaryMetrics.numberOfSales) || 0;
        const netProfit = grossProfit - totalExpenses;

        const analytics = processSalesAnalysis(salesWindow, expensesWindow, queryStart.toISOString());
        analytics.summary = {
            totalSales: totalRevenue,
            numberOfSales,
            totalExpenses,
            totalRefunds,
            grossProfit,
            netProfit,
            margin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
            avgTicket: numberOfSales > 0 ? (totalRevenue / numberOfSales) : 0
        };

        // Inventory Valuation & Alerts (Optimized for Large Inventories)
        let inventoryValuation = 0, itemCount = 0, lowStockItems = [];
        if (role !== 'user') {
            const valuationStats = await Product.findOne({
                where: { companyId, isCustom: false },
                attributes: [
                    [sequelize.fn('SUM', sequelize.literal('stockQuantity * COALESCE(NULLIF(cost, 0), price * 0.7)')), 'totalValue'],
                    [sequelize.fn('COUNT', sequelize.literal('id')), 'count']
                ],
                raw: true
            });
            
            inventoryValuation = Number(valuationStats.totalValue) || 0;
            itemCount = Number(valuationStats.count) || 0;

            lowStockItems = await Product.findAll({
                where: {
                    companyId,
                    [Op.and]: [sequelize.where(sequelize.col('stockQuantity'), Op.lte, sequelize.col('minStock'))]
                },
                attributes: ['id', 'name', 'stockQuantity', 'minStock', 'stockUnit'],
                order: [['stockQuantity', 'ASC']],
                limit: 8,
                raw: true
            });
        }

        // Charts
        const salesChart = { labels: [], sales: [], expenses: [] };
        for (let i = 0; i < daysToFetch; i++) {
            const d = new Date(queryStart);
            d.setUTCDate(queryStart.getUTCDate() + i);
            const dStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('es-ES', { weekday: 'short' });
            salesChart.labels.push(dayName.charAt(0).toUpperCase() + dayName.slice(1));
            const trend = analytics.trends.find(t => t.date === dStr);
            salesChart.sales.push(trend ? trend.sales : 0);
            salesChart.expenses.push(trend ? trend.expenses : 0);
        }

        const [recentSales, auditLogs] = await Promise.all([
            Sale.findAll({ where: { companyId }, limit: 10, order: [['date', 'DESC']], attributes: ['id', 'total', 'customerName', 'date', 'paymentMethod'] }),
            AuditLog.findAll({ where: { companyId }, include: [{ model: User, as: 'User', attributes: ['name', 'username'] }], limit: 10, order: [['timestamp', 'DESC']] })
        ]);

        return {
            debugRange: { queryStart: queryStart.toISOString(), queryEnd: queryEnd.toISOString(), daysToFetch },
            rangeSummary: {
                totalRevenue: analytics.summary.totalSales,
                numberOfSales: analytics.summary.numberOfSales,
                totalProfit: analytics.summary.grossProfit,
                totalExpenses: analytics.summary.totalExpenses,
                netProfit: analytics.summary.netProfit,
                avgMargin: analytics.summary.margin,
                ticketPromedio: analytics.summary.avgTicket
            },
            ranking: {
                topProducts: analytics.topProducts,
                categorySales: analytics.byCategory.map(c => ({ category: c.category, total: c.total })),
                paymentMethods: analytics.paymentMethods
            },
            charts: { salesChart, hourlySales: analytics.hourlySales },
            inventory: { lowStockItems, lowStockCount: lowStockItems.length, totalValueAtCost: inventoryValuation, itemCount },
            activity: {
                recentSales,
                auditLogs: auditLogs.map(l => ({ id: l.id, action: l.action, userEmail: l.User ? (l.User.name || l.User.username) : 'Sistema', timestamp: l.timestamp }))
            }
        };
    }

    /**
     * Get products with low stock.
     */
    async getLowStock(companyId, page = 1, limit = 20) {
        const offset = (page - 1) * limit;
        const { rows, count } = await Product.findAndCountAll({
            where: {
                companyId,
                [Op.and]: [sequelize.where(sequelize.col('stockQuantity'), Op.lte, sequelize.col('minStock'))]
            },
            limit, offset, order: [['stockQuantity', 'ASC']],
            attributes: ['id', 'name', 'stockQuantity', 'minStock', 'stockUnit', 'category']
        });
        return { items: rows, total: count, page, totalPages: Math.ceil(count / limit) };
    }

    /**
     * Get profitability report.
     */
    async getProfitability(reqUser, query) {
        const { companyId, role, id: userId } = reqUser;
        const range = query.range || '30d';
        
        let startDateStr, endDateStr;
        if (query.startDate && query.endDate) {
            startDateStr = query.startDate.includes('T') ? query.startDate : `${query.startDate}T00:00:00.000Z`;
            endDateStr = query.endDate.includes('T') ? query.endDate : `${query.endDate}T23:59:59.999Z`;
        } else {
            let startDate = new Date();
            if (range === 'today' || range === '1d') startDate.setHours(0,0,0,0);
            else if (range === '7d') startDate.setDate(startDate.getDate() - 7);
            else if (range === '90d') startDate.setDate(startDate.getDate() - 90);
            else startDate.setDate(startDate.getDate() - 30);
            startDateStr = startDate.toISOString();
            endDateStr = new Date().toISOString();
        }

        const saleWhere = {
            companyId,
            date: { [Op.gte]: startDateStr, [Op.lte]: endDateStr },
            status: { [Op.notIn]: ['cancelled'] } // Incluimos reembolsadas para contarlas y luego deducir el refund
        };
        if (role === 'user') saleWhere.userId = userId;

        const { Refund } = require('../database/models');
        const refundWhere = {
            companyId,
            date: { [Op.gte]: startDateStr, [Op.lte]: endDateStr }
        };
        if (role === 'user') refundWhere.userId = userId;

        // 1. Métricas Globales vía SQL
        const [stats, refundsResult] = await Promise.all([
            SaleItem.findOne({
                attributes: [
                    [sequelize.fn('SUM', sequelize.literal('quantity * price')), 'totalSales'],
                    [sequelize.fn('SUM', sequelize.literal('quantity * COALESCE(NULLIF(cost, 0), price * 0.7)')), 'totalCost'],
                    [sequelize.fn('SUM', sequelize.literal('quantity * (price - COALESCE(NULLIF(cost, 0), price * 0.7))')), 'grossProfit'],
                    [sequelize.fn('COUNT', sequelize.literal('DISTINCT "SaleId"')), 'numberOfSales']
                ],
                include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
                raw: true
            }),
            Refund.findAll({
                where: refundWhere,
                attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']]
            })
        ]);

        // 2. Tendencias Diarias vía SQL (incluye utilidad bruta por día)
        const trends = await SaleItem.findAll({
            attributes: [
                [sequelize.fn('strftime', '%Y-%m-%d', sequelize.col('Sale.date'), 'localtime'), 'date'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * "SaleItem".price')), 'sales'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * ("SaleItem".price - COALESCE(NULLIF("SaleItem".cost, 0), "SaleItem".price * 0.7))')), 'profit'],
                [sequelize.fn('COUNT', sequelize.literal('DISTINCT "SaleItem"."SaleId"')), 'count']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: [sequelize.fn('strftime', '%Y-%m-%d', sequelize.col('Sale.date'), 'localtime')],
            order: [[sequelize.fn('strftime', '%Y-%m-%d', sequelize.col('Sale.date'), 'localtime'), 'ASC']],
            raw: true
        });

        // 3. Top Productos por Volumen (Cantidad) vía SQL
        const topProductsQty = await SaleItem.findAll({
            attributes: [
                [sequelize.col('name'), 'name'],
                [sequelize.fn('SUM', sequelize.col('quantity')), 'quantity'],
                [sequelize.fn('SUM', sequelize.literal('quantity * price')), 'total'],
                [sequelize.fn('SUM', sequelize.literal('quantity * (price - COALESCE(NULLIF(cost, 0), price * 0.7))')), 'totalProfit']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: ['name'],
            order: [[sequelize.literal('quantity'), 'DESC']],
            limit: 100,
            raw: true
        });

        // 3b. Top Productos por Utilidad vía SQL
        const topProductsProfit = await SaleItem.findAll({
            attributes: [
                [sequelize.col('name'), 'name'],
                [sequelize.fn('SUM', sequelize.col('quantity')), 'quantity'],
                [sequelize.fn('SUM', sequelize.literal('quantity * price')), 'total'],
                [sequelize.fn('SUM', sequelize.literal('quantity * (price - COALESCE(NULLIF(cost, 0), price * 0.7))')), 'totalProfit']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: ['name'],
            order: [[sequelize.literal('totalProfit'), 'DESC']],
            limit: 100,
            raw: true
        });

        // 4. Ventas por Categoría vía SQL
        const byCategory = await SaleItem.findAll({
            attributes: [
                [sequelize.literal("COALESCE(\"SaleItem\".category, 'General')"), 'category'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * "SaleItem".price')), 'total'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * ("SaleItem".price - COALESCE(NULLIF("SaleItem".cost, 0), "SaleItem".price * 0.7))')), 'profit']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: [sequelize.literal("COALESCE(\"SaleItem\".category, 'General')")],
            order: [[sequelize.literal('total'), 'DESC']],
            raw: true
        });

        const rawTotalRevenue = Number(stats.totalSales) || 0;
        const rawGrossProfit = Number(stats.grossProfit) || 0;
        const totalRefunds = Number(refundsResult[0]?.dataValues?.total) || 0;

        const totalRevenue = Math.max(0, rawTotalRevenue - totalRefunds);
        const marginRatio = rawTotalRevenue > 0 ? (rawGrossProfit / rawTotalRevenue) : 0;
        const grossProfit = Math.max(0, rawGrossProfit - (totalRefunds * marginRatio));

        const formatProduct = (p) => {
            const total = Number(p.total) || 0;
            const totalProfit = Number(p.totalProfit) || 0;
            const quantity = Number(p.quantity) || 0;
            const margin = total > 0 ? precision.round((totalProfit / total) * 100) : 0;
            return {
                name: p.name,
                quantity,
                total,
                totalProfit,
                margin
            };
        };

        const formattedTopProducts = topProductsQty.map(formatProduct);
        const formattedTopProductsByProfit = topProductsProfit.map(formatProduct);

        // 5. Intensidad Horaria vía SQL
        const hourlySalesRaw = await Sale.findAll({
            where: saleWhere,
            attributes: [
                [sequelize.fn('strftime', '%H', sequelize.col('date'), 'localtime'), 'hourStr'],
                [sequelize.fn('SUM', sequelize.col('total')), 'totalSales'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: [sequelize.fn('strftime', '%H', sequelize.col('date'), 'localtime')],
            raw: true
        });

        // Inicializar las 24 horas para garantizar consistencia
        const hourlySalesMap = Array(24).fill(0).map((_, i) => ({
            hour: i,
            count: 0,
            total: 0
        }));

        hourlySalesRaw.forEach(h => {
            const hour = parseInt(h.hourStr, 10);
            if (hour >= 0 && hour < 24) {
                hourlySalesMap[hour].count = Number(h.count) || 0;
                hourlySalesMap[hour].total = Number(h.totalSales) || 0;
            }
        });

        const numberOfSales = Number(stats.numberOfSales) || 0;
        const avgTicket = numberOfSales > 0 ? precision.round(totalRevenue / numberOfSales) : 0;

        return {
            summary: {
                totalSales: totalRevenue,
                numberOfSales,
                totalRefunds,
                totalCost: Number(stats.totalCost) || 0,
                grossProfit: grossProfit,
                netProfit: grossProfit, // Simplificado, descontar gastos si se requiere
                margin: totalRevenue > 0 ? precision.round((grossProfit / totalRevenue) * 100) : 0,
                avgTicket
            },
            topProducts: formattedTopProducts,
            topProductsByProfit: formattedTopProductsByProfit,
            trends: trends.map(t => ({ ...t, sales: Number(t.sales), profit: Number(t.profit) || 0, count: Number(t.count) })),
            byCategory: byCategory.map(c => ({ ...c, category: c.category || 'General', total: Number(c.total), profit: Number(c.profit) })),
            hourlySales: hourlySalesMap
        };
    }

    /**
     * Get inventory valuation.
     */
    async getInventoryValuation(companyId) {
        const byCategory = await Product.findAll({
            where: { companyId, isCustom: false },
            attributes: [
                [sequelize.literal("COALESCE(category, 'General')"), 'category'],
                [sequelize.fn('SUM', sequelize.literal('stockQuantity * COALESCE(NULLIF(cost, 0), price * 0.7)')), 'valueAtCost'],
                [sequelize.fn('SUM', sequelize.literal('stockQuantity * price')), 'valueAtPrice'],
                [sequelize.fn('COUNT', sequelize.literal('CASE WHEN stockQuantity > 0 THEN 1 END')), 'items']
            ],
            group: [sequelize.literal("COALESCE(category, 'General')")],
            raw: true
        });

        let totalCost = 0, totalValue = 0, itemCount = 0;
        byCategory.forEach(cat => {
            totalCost = precision.add([totalCost, Number(cat.valueAtCost) || 0]);
            totalValue = precision.add([totalValue, Number(cat.valueAtPrice) || 0]);
            itemCount += Number(cat.items) || 0;
        });

        return {
            summary: {
                totalValueAtCost: precision.round(totalCost),
                totalValueAtPrice: precision.round(totalValue),
                potentialProfit: precision.round(totalValue - totalCost),
                margin: totalValue > 0 ? precision.round(((totalValue - totalCost) / totalValue) * 100) : 0,
                itemCount
            },
            byCategory: byCategory.sort((a,b) => b.valueAtCost - a.valueAtCost)
        };
    }

    /**
     * Get product movement history (Kardex).
     */
    async getKardex(productId, companyId, limit = 100) {
        return await StockMovement.findAll({
            where: { productId, companyId },
            order: [['date', 'DESC']],
            limit
        });
    }

    /**
     * Get local daily report (sales).
     */
    async getDailyReport(reqUser, dateQuery) {
        const { companyId, role, id: userId } = reqUser;
        const date = dateQuery || new Date(Date.now() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
        const saleWhere = { companyId, date: { [likeOp]: `${date}%` } };
        if (role === 'user') saleWhere.userId = userId;

        return await Sale.findAll({ where: saleWhere, order: [['date', 'DESC']] });
    }

    /**
     * Get customer ranking by total sales.
     */
    async getCustomerRanking(reqUser, range = '30d') {
        const { companyId, role, id: userId } = reqUser;
        const now = new Date();
        let startDate = new Date();
        if (range === '7d') startDate.setDate(now.getDate() - 7);
        else startDate.setDate(now.getDate() - 30);

        const saleWhere = {
            companyId,
            customerId: { [Op.ne]: null },
            date: { [Op.gte]: startDate.toISOString().split('T')[0] }
        };
        if (role === 'user') saleWhere.userId = userId;

        const sales = await Sale.findAll({ where: saleWhere, attributes: ['customerId', 'customerName', 'total'] });
        const analytics = processSalesAnalysis(sales, [], startDate.toISOString().split('T')[0]);
        return analytics.topCustomers;
    }

    /**
     * Get accounts receivable (customers with pending credit).
     */
    async getAccountsReceivable(companyId) {
        const stats = await Customer.findOne({
            where: { companyId, creditBalance: { [Op.gt]: 0 } },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalCustomers'],
                [sequelize.fn('SUM', sequelize.col('creditBalance')), 'totalAmount']
            ],
            raw: true
        });

        const customers = await Customer.findAll({
            where: { companyId, creditBalance: { [Op.gt]: 0 } },
            order: [['creditBalance', 'DESC']],
            attributes: ['id', 'name', 'creditBalance', 'phone'],
            limit: 100, // No cargar miles de clientes deudores de una vez
            raw: true
        });

        return {
            summary: { 
                totalCustomers: Number(stats.totalCustomers) || 0, 
                totalAmount: precision.round(Number(stats.totalAmount) || 0, 2) 
            },
            customers
        };
    }

    /**
     * Get accounts payable (suppliers with pending credit).
     */
    async getAccountsPayable(companyId) {
        const { Supplier } = require('../database/models');
        const suppliers = await Supplier.findAll({
            where: { companyId, creditBalance: { [Op.gt]: 0 } },
            order: [['creditBalance', 'DESC']]
        });
        const totalBalance = suppliers.reduce((sum, s) => sum + (Number(s.creditBalance) || 0), 0);
        return {
            summary: { totalSuppliers: suppliers.length, totalAmount: precision.round(totalBalance, 2) },
            suppliers
        };
    }

    /**
     * Get time-series sales data.
     */
    async getTimeSeries(reqUser, days = 30) {
        const { companyId, role, id: userId } = reqUser;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (days - 1));
        startDate.setHours(0, 0, 0, 0);

        const saleWhere = {
            companyId,
            date: { [Op.gte]: startDate.toISOString().split('T')[0] },
            status: { [Op.notIn]: ['cancelled', 'refunded'] }
        };
        if (role === 'user') saleWhere.userId = userId;

        const sales = await Sale.findAll({ where: saleWhere, attributes: ['date', 'total'], order: [['date', 'ASC']] });
        const dailyData = {};
        for (let i = 0; i < days; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            dailyData[d.toISOString().split('T')[0]] = 0;
        }

        sales.forEach(s => {
            const dStr = s.date ? s.date.substring(0, 10) : null;
            if (dStr && dailyData[dStr] !== undefined) {
                dailyData[dStr] = precision.round(dailyData[dStr] + (Number(s.total) || 0), 2);
            }
        });

        return Object.keys(dailyData).map(date => ({ date, total: dailyData[date] }));
    }

    /**
     * Get detailed data for CSV export.
     */
    async getDetailedExportData(companyId, query) {
        const range = query.range || '30d';
        
        let dateFilter;
        if (query.startDate && query.endDate) {
            const sDate = query.startDate.includes('T') ? query.startDate : `${query.startDate}T00:00:00.000Z`;
            const eDate = query.endDate.includes('T') ? query.endDate : `${query.endDate}T23:59:59.999Z`;
            dateFilter = { [Op.gte]: sDate, [Op.lte]: eDate };
        } else {
            const startDate = new Date();
            if (range === 'today') startDate.setHours(0, 0, 0, 0);
            else if (range.endsWith('d')) {
                const days = parseInt(range.replace('d', '')) || 30;
                startDate.setDate(startDate.getDate() - days);
            }
            dateFilter = { [Op.gte]: startDate.toISOString().split('T')[0] };
        }

        const sales = await Sale.findAll({
            where: { companyId, date: dateFilter },
            include: [{ model: SaleItem, as: 'SaleItems' }],
            order: [['date', 'DESC']],
            limit: 10000 // OOM Prevention: Cap maximum export batch to prevent V8 Garbage Collector crash
        });

        const products = await Product.findAll({ where: { companyId }, attributes: ['id', 'cost', 'price'] });
        const productCostMap = {};
        products.forEach(p => productCostMap[p.id] = { cost: Number(p.cost) || 0 });

        return { sales, productCostMap };
    }
}

module.exports = new ReportService();
