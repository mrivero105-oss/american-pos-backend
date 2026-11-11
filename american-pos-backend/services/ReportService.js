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
                    [sequelize.fn('SUM', sequelize.col('SaleItem.subtotal')), 'totalRevenue'],
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
            const notServiceSql = "LOWER(TRIM(COALESCE(\"category\", ''))) <> 'servicios'";
            const valuationStats = await Product.findOne({
                where: { companyId, isCustom: false },
                attributes: [
                    [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} THEN "stockQuantity" * COALESCE(NULLIF("cost", 0), "price" * 0.7) ELSE 0 END`)), 'totalValue'],
                    [sequelize.fn('COUNT', sequelize.literal('"id"')), 'count']
                ],
                raw: true
            });
            
            inventoryValuation = Number(valuationStats.totalValue) || 0;
            itemCount = Number(valuationStats.count) || 0;

            const stockCol = sequelize.col('stockQuantity');
            const minStockCol = sequelize.col('minStock');
            const orderCol = 'stockQuantity';

            lowStockItems = await Product.findAll({
                where: {
                    companyId,
                    [Op.and]: [
                        sequelize.where(stockCol, Op.lte, minStockCol),
                        sequelize.literal(notServiceSql)
                    ]
                },
                attributes: ['id', 'name', 'stockQuantity', 'minStock', 'stockUnit'],
                order: [[orderCol, 'ASC']],
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
        const stockCol = sequelize.col('stockQuantity');
        const minStockCol = sequelize.col('minStock');
        const orderCol = 'stockQuantity';
        const notServiceSql = "LOWER(TRIM(COALESCE(\"category\", ''))) <> 'servicios'";

        const { rows, count } = await Product.findAndCountAll({
            where: {
                companyId,
                [Op.and]: [
                    sequelize.where(stockCol, Op.lte, minStockCol),
                    sequelize.literal(notServiceSql)
                ]
            },
            limit, offset, order: [[orderCol, 'ASC']],
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

        const expenseWhere = {
            companyId,
            date: { [Op.gte]: startDateStr.substring(0, 10), [Op.lte]: endDateStr.substring(0, 10) }
        };
        if (role === 'user') expenseWhere.userId = userId;

        // 1. Métricas Globales vía SQL (costo real de renglón sin inventar 70% ficticio)
        const [stats, refundsResult, totalExpensesRaw] = await Promise.all([
            SaleItem.findOne({
                attributes: [
                    [sequelize.fn('SUM', sequelize.literal('quantity * price')), 'totalSales'],
                    [sequelize.fn('SUM', sequelize.literal('quantity * COALESCE(cost, 0)')), 'totalCost'],
                    [sequelize.fn('SUM', sequelize.literal('quantity * (price - COALESCE(cost, 0))')), 'grossProfit'],
                    [sequelize.fn('COUNT', sequelize.literal('DISTINCT "saleId"')), 'numberOfSales']
                ],
                include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
                raw: true
            }),
            Refund.findAll({
                where: refundWhere,
                attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']]
            }),
            Expense.sum('amount', { where: expenseWhere })
        ]);

        const isPg = sequelize.getDialect() === 'postgres';
        const dateExpr = isPg 
            ? sequelize.literal('SUBSTRING("Sale"."date", 1, 10)')
            : sequelize.fn('strftime', '%Y-%m-%d', sequelize.col('Sale.date'), 'localtime');

        // 2. Tendencias Diarias vía SQL (incluye utilidad bruta por día)
        const rawTrends = await SaleItem.findAll({
            attributes: [
                [dateExpr, 'date'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * "SaleItem".price')), 'sales'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * ("SaleItem".price - COALESCE("SaleItem".cost, 0))')), 'profit'],
                [sequelize.fn('COUNT', sequelize.literal('DISTINCT "SaleItem"."saleId"')), 'count']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: [dateExpr],
            order: [[dateExpr, 'ASC']],
            raw: true
        });

        // Crear mapa para indexar ventas por fecha
        const trendMap = {};
        rawTrends.forEach(t => {
            if (t.date) {
                const key = String(t.date).substring(0, 10);
                trendMap[key] = {
                    date: key,
                    sales: Number(t.sales) || 0,
                    profit: Number(t.profit) || 0,
                    count: Number(t.count) || 0
                };
            }
        });

        // Generar todos los días del período para asegurar continuidad perfecta en las gráficas
        const trends = [];
        const iterDate = new Date(startDateStr);
        const targetEndDate = new Date(endDateStr);
        iterDate.setUTCHours(0, 0, 0, 0);

        while (iterDate <= targetEndDate) {
            const y = iterDate.getUTCFullYear();
            const m = String(iterDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(iterDate.getUTCDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            
            if (trendMap[dateStr]) {
                trends.push(trendMap[dateStr]);
            } else {
                trends.push({ date: dateStr, sales: 0, profit: 0, count: 0 });
            }
            iterDate.setUTCDate(iterDate.getUTCDate() + 1);
        }

        // 3. Top Productos por Volumen (Cantidad) vía SQL
        const topProductsQty = await SaleItem.findAll({
            attributes: [
                [sequelize.col('name'), 'name'],
                [sequelize.fn('SUM', sequelize.col('quantity')), 'quantity'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * "SaleItem".price')), 'total'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * ("SaleItem".price - COALESCE("SaleItem".cost, 0))')), 'totalProfit']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: ['name'],
            order: [[sequelize.literal('"quantity"'), 'DESC']],
            limit: 100,
            raw: true
        });

        // 3b. Top Productos por Utilidad vía SQL
        const topProductsProfit = await SaleItem.findAll({
            attributes: [
                [sequelize.col('name'), 'name'],
                [sequelize.fn('SUM', sequelize.col('quantity')), 'quantity'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * "SaleItem".price')), 'total'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * ("SaleItem".price - COALESCE("SaleItem".cost, 0))')), 'totalProfit']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: ['name'],
            order: [[sequelize.literal('"totalProfit"'), 'DESC']],
            limit: 100,
            raw: true
        });

        // 4. Ventas por Categoría vía SQL
        const byCategory = await SaleItem.findAll({
            attributes: [
                [sequelize.literal("COALESCE(\"SaleItem\".category, 'General')"), 'category'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * "SaleItem".price')), 'total'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * ("SaleItem".price - COALESCE("SaleItem".cost, 0))')), 'profit']
            ],
            include: [{ model: Sale, as: 'Sale', attributes: [], where: saleWhere }],
            group: [sequelize.literal("COALESCE(\"SaleItem\".category, 'General')")],
            order: [[sequelize.literal('"total"'), 'DESC']],
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
        const hourExpr = isPg
            ? sequelize.literal('SUBSTRING("Sale"."date", 12, 2)')
            : sequelize.fn('strftime', '%H', sequelize.col('date'), 'localtime');

        const hourlySalesRaw = await Sale.findAll({
            where: saleWhere,
            attributes: [
                [hourExpr, 'hourStr'],
                [sequelize.fn('SUM', sequelize.col('total')), 'totalSales'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: [hourExpr],
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
        const avgTicket = numberOfSales > 0 ? precision.round(totalRevenue / numberOfSales, 6) : 0;
        const totalExpenses = precision.round(Number(totalExpensesRaw) || 0, 2);
        const netProfit = precision.round(grossProfit - totalExpenses, 2);

        return {
            summary: {
                totalSales: totalRevenue,
                numberOfSales,
                totalRefunds,
                totalCost: Number(stats.totalCost) || 0,
                totalExpenses,
                grossProfit: grossProfit,
                netProfit,
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
    async getCategoryInventoryValuation(companyId) {
        const notServiceSql = "LOWER(TRIM(COALESCE(\"category\", ''))) <> 'servicios'";
        const byCategory = await Product.findAll({
            where: {
                companyId,
                isCustom: false,
                [Op.and]: [sequelize.literal(notServiceSql)]
            },
            attributes: [
                [sequelize.literal("COALESCE(\"category\", 'General')"), 'category'],
                [sequelize.fn('SUM', sequelize.literal('"stockQuantity" * COALESCE(NULLIF("cost", 0), "price" * 0.7)')), 'valueAtCost'],
                [sequelize.fn('SUM', sequelize.literal('"stockQuantity" * "price"')), 'valueAtPrice'],
                [sequelize.fn('COUNT', sequelize.literal('CASE WHEN "stockQuantity" > 0 THEN 1 END')), 'items']
            ],
            group: [sequelize.literal("COALESCE(\"category\", 'General')")],
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
     * Get accounts receivable (customers with pending credit & aging analysis).
     */
    async getAccountsReceivable(companyId) {
        const { Customer, CreditHistory } = require('../database/models');

        const customers = await Customer.findAll({
            where: { companyId, creditBalance: { [Op.gt]: 0 } },
            order: [['creditBalance', 'DESC']],
            raw: true
        });

        let totalAmount = 0;
        let currentTotal = 0;   // 0-7 days
        let warningTotal = 0;   // 8-15 days
        let overdueTotal = 0;   // 16-30 days
        let criticalTotal = 0;  // 30+ days

        const now = Date.now();

        const enrichedCustomers = await Promise.all(customers.map(async (c) => {
            const balance = Number(c.creditBalance) || 0;
            totalAmount += balance;

            // Conciliación FIFO exacta de cuentas por cobrar:
            // Obtenemos todos los cargos y abonos del cliente en orden cronológico
            const allCharges = await CreditHistory.findAll({
                where: { customerId: c.id, companyId, type: { [Op.in]: ['charge', 'debit'] } },
                order: [['timestamp', 'ASC']],
                raw: true
            });
            const allPayments = await CreditHistory.findAll({
                where: { customerId: c.id, companyId, type: { [Op.in]: ['payment', 'credit'] } },
                order: [['timestamp', 'ASC']],
                raw: true
            });

            let availablePayments = allPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            let oldestDate = null;

            if (allCharges.length > 0) {
                for (const ch of allCharges) {
                    const amt = Number(ch.amount) || 0;
                    if (availablePayments >= (amt - 0.005)) {
                        // Cargo saldado por abonos previos
                        availablePayments = Math.max(0, availablePayments - amt);
                    } else {
                        // Cargo pendiente actual (el más antiguo de la deuda viva)
                        oldestDate = ch.timestamp || ch.createdAt;
                        break;
                    }
                }
            }

            // Si no se encontró en CreditHistory pero el cliente tiene saldo deudor, verificar ventas a crédito
            if (!oldestDate) {
                const { Sale } = require('../database/models');
                const creditSales = await Sale.findAll({
                    where: {
                        customerId: c.id,
                        companyId,
                        status: { [Op.ne]: 'cancelled' },
                        [Op.or]: [
                            { paymentStatus: { [Op.in]: ['unpaid', 'partial', 'pending'] } },
                            { paymentMethod: { [Op.in]: ['credit', 'fiado'] } }
                        ]
                    },
                    order: [['createdAt', 'DESC']],
                    raw: true
                });

                let remainingToAllocate = balance;
                for (const sale of creditSales) {
                    if (remainingToAllocate <= 0.005) break;
                    const saleTotal = Number(sale.total) || 0;
                    const paid = Number(sale.amountPaid) || 0;
                    const remaining = Math.max(0, saleTotal - paid);
                    if (remaining > 0) {
                        remainingToAllocate = Math.max(0, remainingToAllocate - remaining);
                        oldestDate = sale.createdAt || sale.date;
                    }
                }
            }

            if (!oldestDate) {
                oldestDate = c.updatedAt || c.createdAt;
            }

            let daysOverdue = 0;
            if (oldestDate) {
                const diffMs = now - new Date(oldestDate).getTime();
                daysOverdue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
            }

            let agingBracket = 'CURRENT';
            let agingLabel = '0-7 Días';

            if (daysOverdue > 30) {
                agingBracket = 'CRITICAL';
                agingLabel = '+30 Días (Crítico)';
                criticalTotal += balance;
            } else if (daysOverdue > 15) {
                agingBracket = 'OVERDUE';
                agingLabel = '16-30 Días (Vencido)';
                overdueTotal += balance;
            } else if (daysOverdue > 7) {
                agingBracket = 'WARNING';
                agingLabel = '8-15 Días (Preventivo)';
                warningTotal += balance;
            } else {
                agingBracket = 'CURRENT';
                agingLabel = '0-7 Días (Al día)';
                currentTotal += balance;
            }

            return {
                ...c,
                creditLimit: Number(c.creditLimit) || 0,
                creditBalance: balance,
                loyaltyPoints: Number(c.loyaltyPoints) || 0,
                daysOverdue,
                oldestDate,
                agingBracket,
                agingLabel
            };
        }));

        return {
            summary: {
                totalCustomers: customers.length,
                totalAmount: precision.round(totalAmount, 2),
                averageExposure: customers.length > 0 ? precision.round(totalAmount / customers.length, 2) : 0,
                aging: {
                    current: precision.round(currentTotal, 2),
                    warning: precision.round(warningTotal, 2),
                    overdue: precision.round(overdueTotal, 2),
                    critical: precision.round(criticalTotal, 2)
                }
            },
            customers: enrichedCustomers
        };
    }

    /**
     * Get accounts payable (suppliers with pending credit and invoice details).
     */
    async getAccountsPayable(companyId) {
        const { Supplier, SupplierCreditHistory, PurchaseOrder } = require('../database/models');
        const suppliers = await Supplier.findAll({
            where: { companyId, creditBalance: { [Op.gt]: 0 } },
            order: [['creditBalance', 'DESC']]
        });

        const enrichedSuppliers = await Promise.all(suppliers.map(async (supplier) => {
            const sData = supplier.toJSON();
            
            // Obtener todos los cargos y abonos históricos del proveedor para cálculo FIFO exacto
            const allCharges = await SupplierCreditHistory.findAll({
                where: { supplierId: supplier.id, companyId, type: 'charge' },
                order: [['timestamp', 'ASC']]
            });
            const allPayments = await SupplierCreditHistory.findAll({
                where: { supplierId: supplier.id, companyId, type: 'payment' },
                order: [['timestamp', 'ASC']]
            });

            // Enriquecer cargos con PurchaseOrder
            const pOrderIds = allCharges.map(i => i.purchaseOrderId).filter(Boolean);
            let orderMap = new Map();
            if (pOrderIds.length > 0) {
                const orders = await PurchaseOrder.findAll({
                    where: { id: pOrderIds, companyId },
                    attributes: ['id', 'invoiceUrl', 'referenceNumber', 'arrivalDate', 'dueDate', 'exchangeRate', 'total', 'totalVes']
                });
                orderMap = new Map(orders.map(o => [o.id, o]));
            }

            let availablePayments = allPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const pendingInvoices = [];

            for (const ch of allCharges) {
                const po = ch.purchaseOrderId ? orderMap.get(ch.purchaseOrderId) : null;
                const amt = Number(ch.amount || po?.total || 0);

                if (availablePayments >= (amt - 0.005)) {
                    availablePayments = Math.max(0, availablePayments - amt);
                } else if (availablePayments > 0.01) {
                    const remaining = precision.round(amt - availablePayments, 2);
                    availablePayments = 0;
                    pendingInvoices.push({
                        id: ch.id,
                        referenceNumber: ch.referenceNumber || po?.referenceNumber || 'N/A',
                        invoiceUrl: ch.invoiceUrl || po?.invoiceUrl || null,
                        amount: amt,
                        balanceRemaining: remaining,
                        status: 'PARTIAL',
                        timestamp: ch.timestamp,
                        arrivalDate: ch.arrivalDate || po?.arrivalDate || (ch.timestamp ? ch.timestamp.split('T')[0] : null),
                        dueDate: ch.dueDate || po?.dueDate || null,
                        exchangeRate: ch.exchangeRate || po?.exchangeRate || 1.0,
                        description: ch.description
                    });
                } else {
                    pendingInvoices.push({
                        id: ch.id,
                        referenceNumber: ch.referenceNumber || po?.referenceNumber || 'N/A',
                        invoiceUrl: ch.invoiceUrl || po?.invoiceUrl || null,
                        amount: amt,
                        balanceRemaining: amt,
                        status: 'PENDING',
                        timestamp: ch.timestamp,
                        arrivalDate: ch.arrivalDate || po?.arrivalDate || (ch.timestamp ? ch.timestamp.split('T')[0] : null),
                        dueDate: ch.dueDate || po?.dueDate || null,
                        exchangeRate: ch.exchangeRate || po?.exchangeRate || 1.0,
                        description: ch.description
                    });
                }
            }

            // Ordenar facturas pendientes por fecha descendente (más reciente primero para la visualización de última factura)
            pendingInvoices.sort((a, b) => new Date(b.arrivalDate || b.timestamp) - new Date(a.arrivalDate || a.timestamp));
            sData.invoices = pendingInvoices;

            // Determinar próxima fecha de vencimiento únicamente entre las facturas realmente pendientes
            const upcomingDueDates = pendingInvoices.map(i => i.dueDate).filter(Boolean).sort();
            sData.nextDueDate = upcomingDueDates.length > 0 ? upcomingDueDates[0] : null;

            return sData;
        }));

        const totalBalance = enrichedSuppliers.reduce((sum, s) => sum + (Number(s.creditBalance) || 0), 0);
        return {
            summary: { 
                totalSuppliers: enrichedSuppliers.length, 
                totalAmount: precision.round(totalBalance, 2) 
            },
            suppliers: enrichedSuppliers
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

    /**
     * Get inventory valuation (total inventory value at cost, total retail value, margins and stock health).
     */
    async getInventoryValuation(companyId) {
        if (!companyId || companyId === 'default' || companyId === 'admin') {
            companyId = '2';
        }
        const { Product } = require('../database/models');
        if (companyId !== '2') {
            const prodCount = await Product.count({ where: { companyId } }).catch(() => 0);
            if (prodCount === 0) companyId = '2';
        }
        const companyCondition = (companyId === '2' || companyId === 'default')
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }] }
            : { companyId };

        const notServiceSql = "LOWER(TRIM(COALESCE(\"category\", ''))) <> 'servicios'";
        const valuationStats = await Product.findOne({
            where: { 
                ...companyCondition, 
                isCustom: { [Op.or]: [false, null] }, 
                status: 'active' 
            },
            attributes: [
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} THEN "stockQuantity" * COALESCE(NULLIF("cost", 0), "price" * 0.7) ELSE 0 END`)), 'totalValueAtCost'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} THEN "stockQuantity" * COALESCE("price", 0) ELSE 0 END`)), 'totalRetailValue'],
                [sequelize.fn('COUNT', sequelize.literal('"id"')), 'itemCount'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND "stockQuantity" <= "minStock" AND "stockQuantity" > 0 THEN 1 ELSE 0 END`)), 'lowStockCount'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND "stockQuantity" <= 0 THEN 1 ELSE 0 END`)), 'outOfStockCount']
            ],
            raw: true
        });

        const totalValueAtCost = precision.round(Number(valuationStats?.totalValueAtCost) || 0, 2);
        const totalRetailValue = precision.round(Number(valuationStats?.totalRetailValue) || 0, 2);
        const projectedMarginProfit = precision.round(Math.max(0, totalRetailValue - totalValueAtCost), 2);
        const projectedMarginPercent = totalRetailValue > 0 ? precision.round((projectedMarginProfit / totalRetailValue) * 100, 1) : 0;
        const itemCount = Number(valuationStats?.itemCount) || 0;
        const lowStockCount = Number(valuationStats?.lowStockCount) || 0;
        const outOfStockCount = Number(valuationStats?.outOfStockCount) || 0;

        return {
            totalValueAtCost,
            totalRetailValue,
            itemCount,
            lowStockCount,
            outOfStockCount,
            projectedMarginProfit,
            projectedMarginPercent,
            summary: {
                totalValueAtCost,
                totalValueAtPrice: totalRetailValue,
                potentialProfit: projectedMarginProfit,
                margin: projectedMarginPercent,
                itemCount
            }
        };
    }
}

module.exports = new ReportService();
