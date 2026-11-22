const { Sale, SaleItem, Product, StockMovement, Customer, Expense, AuditLog, User } = require('../database/models');
const { sequelize } = require('../database/connection');
const { Op } = require('sequelize');
const { processSalesAnalysis } = require('../utils/salesAnalytics');
const precision = require('../utils/precision');
const cacheService = require('../utils/cacheService');
const DailyRollupService = require('./DailyRollupService');

class ReportService {
    /**
     * Get audit logs with user info.
     */
    async getAuditLogs(companyId, limit = 200, offset = 0) {
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
        return await AuditLog.findAll({
            where: { companyId },
            include: [{ model: User, as: 'User', attributes: ['name', 'username'] }],
            order: [['createdAt', 'DESC']],
            limit: safeLimit,
            offset: safeOffset
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

        const startIso = queryStart.toISOString();
        const endIso = queryEnd.toISOString();
        const dashCacheKey = process.env.ISAAC_TEST_ISOLATED !== '1'
            ? `dashboard_summary_${companyId}_${role}_${role === 'user' ? userId : 'all'}_${startIso}_${endIso}`
            : null;
        if (dashCacheKey) {
            const cachedDash = cacheService.get(dashCacheKey);
            if (cachedDash) return cachedDash;
        }

        const saleWhere = {
            companyId,
            status: { [Op.notIn]: ['cancelled'] }, // Incluimos 'refunded' y 'partially_refunded' en las ventas brutas
            date: { [Op.gte]: startIso, [Op.lte]: endIso }
        };
        if (role === 'user') saleWhere.userId = userId;

        const { Refund } = require('../database/models');
        const refundWhere = {
            companyId,
            date: { [Op.gte]: startIso, [Op.lte]: endIso }
        };
        if (role === 'user') refundWhere.userId = userId;

        let analytics = null;
        const isPostgres = typeof sequelize.getDialect === 'function' && sequelize.getDialect() === 'postgres';

        // Fast-Path Rollup Incremental (< 5 ms incluso en reportes anuales 365 días)
        if (isPostgres && role !== 'user') {
            try {
                analytics = await DailyRollupService.tryGetDashboardAnalytics(companyId, startIso, endIso);
            } catch (_rollupErr) {
                analytics = null;
            }
        }

        if (!analytics && isPostgres) {
            const userSqlFilter = role === 'user' ? 'AND s."userId" = :userId' : '';
            const sqlReplacements = { companyId: String(companyId), startIso, endIso, ...(role === 'user' ? { userId: String(userId) } : {}) };

            const [
                dailySalesRows,
                hourlyRows,
                itemAggRows,
                topProductsRows,
                categoryRows,
                paymentSalesRows,
                dailyExpensesRows,
                refundsRows
            ] = await Promise.all([
                sequelize.query(`
                    SELECT LEFT(COALESCE(s."date", s."createdAt"::text), 10) AS day,
                           COUNT(*)::int AS cnt,
                           COALESCE(SUM(s."total"), 0)::float AS total,
                           COALESCE(SUM(COALESCE(s."discount", 0) + COALESCE(s."promoDiscount", 0)), 0)::float AS discounts
                    FROM "Sales" s
                    WHERE s."companyId" = :companyId
                      AND s."status" <> 'cancelled'
                      AND s."date" >= :startIso AND s."date" <= :endIso
                      ${userSqlFilter}
                    GROUP BY 1
                    ORDER BY 1 ASC
                `, { replacements: sqlReplacements, type: sequelize.QueryTypes.SELECT }),
                sequelize.query(`
                    SELECT EXTRACT(HOUR FROM s."createdAt")::int AS hour,
                           COUNT(*)::int AS cnt,
                           COALESCE(SUM(s."total"), 0)::float AS total
                    FROM "Sales" s
                    WHERE s."companyId" = :companyId
                      AND s."status" <> 'cancelled'
                      AND s."date" >= :startIso AND s."date" <= :endIso
                      ${userSqlFilter}
                    GROUP BY 1
                `, { replacements: sqlReplacements, type: sequelize.QueryTypes.SELECT }),
                sequelize.query(`
                    SELECT COALESCE(SUM(si."subtotal"), 0)::float AS "totalRevenue",
                           COALESCE(SUM(COALESCE(si."quantity", 0) * COALESCE(si."cost", 0)), 0)::float AS "totalCost"
                    FROM "SaleItems" si
                    INNER JOIN "Sales" s ON s."id" = si."saleId"
                    WHERE s."companyId" = :companyId
                      AND s."status" <> 'cancelled'
                      AND s."date" >= :startIso AND s."date" <= :endIso
                      ${userSqlFilter}
                `, { replacements: sqlReplacements, type: sequelize.QueryTypes.SELECT }),
                sequelize.query(`
                    SELECT COALESCE(si."name", 'Desconocido') AS name,
                           COALESCE(SUM(si."quantity"), 0)::float AS quantity,
                           COALESCE(SUM(si."subtotal"), 0)::float AS total
                    FROM "SaleItems" si
                    INNER JOIN "Sales" s ON s."id" = si."saleId"
                    WHERE s."companyId" = :companyId
                      AND s."status" <> 'cancelled'
                      AND s."date" >= :startIso AND s."date" <= :endIso
                      ${userSqlFilter}
                    GROUP BY 1
                    ORDER BY quantity DESC
                    LIMIT 5
                `, { replacements: sqlReplacements, type: sequelize.QueryTypes.SELECT }),
                sequelize.query(`
                    SELECT COALESCE(NULLIF(TRIM(si."category"), ''), 'General') AS category,
                           COALESCE(SUM(si."subtotal"), 0)::float AS total,
                           COALESCE(SUM(si."quantity"), 0)::float AS quantity
                    FROM "SaleItems" si
                    INNER JOIN "Sales" s ON s."id" = si."saleId"
                    WHERE s."companyId" = :companyId
                      AND s."status" <> 'cancelled'
                      AND s."date" >= :startIso AND s."date" <= :endIso
                      ${userSqlFilter}
                    GROUP BY 1
                    ORDER BY total DESC
                `, { replacements: sqlReplacements, type: sequelize.QueryTypes.SELECT }),
                Sale.findAll({
                    where: saleWhere,
                    attributes: ['total', 'paymentMethod', 'paymentMethods', 'exchangeRate'],
                    raw: true
                }),
                role !== 'user' ? sequelize.query(`
                    SELECT LEFT(COALESCE("date", "createdAt"::text), 10) AS day,
                           COALESCE(SUM("amount"), 0)::float AS total
                    FROM "Expenses"
                    WHERE "companyId" = :companyId
                      AND "date" >= :startIso AND "date" <= :endIso
                    GROUP BY 1
                `, { replacements: sqlReplacements, type: sequelize.QueryTypes.SELECT }) : Promise.resolve([]),
                Refund.findAll({
                    where: refundWhere,
                    attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']],
                    raw: true
                })
            ]);

            let numberOfSales = 0;
            let totalDiscounts = 0;
            const dailyTrendMap = {};
            for (const r of (dailySalesRows || [])) {
                const cnt = Number(r.cnt) || 0;
                const tot = precision.round(Number(r.total) || 0, 2);
                const disc = precision.round(Number(r.discounts) || 0, 2);
                numberOfSales += cnt;
                totalDiscounts = precision.add([totalDiscounts, disc]);
                if (r.day) {
                    dailyTrendMap[r.day] = { date: r.day, sales: tot, profit: 0, expenses: 0, count: cnt };
                }
            }

            let totalExpenses = 0;
            for (const e of (dailyExpensesRows || [])) {
                const amt = precision.round(Number(e.total) || 0, 2);
                totalExpenses = precision.round(precision.add([totalExpenses, amt]), 2);
                if (e.day) {
                    if (!dailyTrendMap[e.day]) dailyTrendMap[e.day] = { date: e.day, sales: 0, profit: 0, expenses: 0, count: 0 };
                    dailyTrendMap[e.day].expenses = amt;
                }
            }

            const totalRefunds = precision.parseNumericInput(refundsRows[0]?.total);
            const grossItemsRevenue = precision.parseNumericInput(itemAggRows[0]?.totalRevenue);
            const rawCost = precision.parseNumericInput(itemAggRows[0]?.totalCost);
            const rawRevenue = Math.max(0, precision.subtract(grossItemsRevenue, totalDiscounts));
            const rawGrossProfit = precision.subtract(rawRevenue, rawCost);

            const totalRevenue = Math.max(0, precision.subtract(rawRevenue, totalRefunds));
            const refundRatio = rawRevenue > 0 ? Math.min(1, totalRefunds / rawRevenue) : 0;
            const grossProfit = precision.subtract(rawGrossProfit, rawGrossProfit * refundRatio);
            const netCostAfterRefunds = Math.max(0, precision.subtract(rawCost, rawCost * refundRatio));
            const netProfit = precision.subtract(grossProfit, totalExpenses);

            const hourlySales = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, total: 0 }));
            for (const h of (hourlyRows || [])) {
                const hr = Number(h.hour);
                if (hr >= 0 && hr < 24) {
                    hourlySales[hr] = { hour: hr, count: Number(h.cnt) || 0, total: precision.round(Number(h.total) || 0, 2) };
                }
            }

            const paymentMap = {};
            for (const s of (paymentSalesRows || [])) {
                const saleTotal = precision.round(Number(s.total) || 0, 2);
                const saleRate = Number(s.exchangeRate) > 0 ? Number(s.exchangeRate) : 1.0;
                let parsedPms = [];
                if (Array.isArray(s.paymentMethods)) parsedPms = s.paymentMethods;
                else if (typeof s.paymentMethods === 'string') {
                    try { const p = JSON.parse(s.paymentMethods); if (Array.isArray(p)) parsedPms = p; } catch (_) {}
                }
                if (parsedPms.length > 0) {
                    for (const pm of parsedPms) {
                        if (!pm) continue;
                        const mKey = String(pm.method || pm.id || s.paymentMethod || 'Efectivo').trim() || 'Efectivo';
                        const pmCur = String(pm.currency || '').toUpperCase().trim();
                        const isVesPm = pmCur === 'VES' || pmCur === 'BS' || ['ves', '_bs', 'pago_movil', 'pagomovil', 'biopago', 'punto', 'debit'].some(t => mKey.toLowerCase().includes(t));
                        const rawAmt = Number(pm.amount) || 0;
                        const eqUsd = Number(pm.convertedAmountUsd) > 0
                            ? Number(pm.convertedAmountUsd)
                            : (isVesPm && saleRate > 0 ? precision.divide(rawAmt, saleRate) : rawAmt);
                        paymentMap[mKey] = precision.round(precision.add([paymentMap[mKey] || 0, eqUsd]), 2);
                    }
                } else {
                    const method = String(s.paymentMethod || '').trim() || 'Efectivo';
                    paymentMap[method] = precision.round(precision.add([paymentMap[method] || 0, saleTotal]), 2);
                }
            }

            analytics = {
                summary: {
                    totalSales: totalRevenue,
                    numberOfSales,
                    totalExpenses,
                    totalRefunds,
                    grossProfit,
                    netProfit,
                    margin: netCostAfterRefunds > 0 ? precision.round((grossProfit / netCostAfterRefunds) * 100, 2) : 0,
                    avgTicket: numberOfSales > 0 ? precision.round(totalRevenue / numberOfSales, 2) : 0
                },
                topProducts: (topProductsRows || []).map(p => ({
                    name: p.name,
                    quantity: precision.round(Number(p.quantity) || 0, 4),
                    total: precision.round(Number(p.total) || 0, 2),
                    unit: 'und'
                })),
                byCategory: (categoryRows || []).map(c => ({
                    name: c.category,
                    category: c.category,
                    total: precision.round(Number(c.total) || 0, 2),
                    quantity: precision.round(Number(c.quantity) || 0, 4)
                })),
                paymentMethods: Object.entries(paymentMap)
                    .map(([method, total]) => ({ method, total }))
                    .sort((a, b) => b.total - a.total),
                trends: Object.values(dailyTrendMap).sort((a, b) => a.date.localeCompare(b.date)),
                hourlySales
            };
        } else if (!analytics) {
            const [summaryMetrics, expensesResult, itemMetrics, salesWindow, expensesWindow, refundsResult] = await Promise.all([
                Sale.findOne({
                    attributes: [
                        [sequelize.fn('COUNT', sequelize.col('Sale.id')), 'numberOfSales'],
                        [sequelize.fn('SUM', sequelize.literal('COALESCE("Sale"."discount", 0) + COALESCE("Sale"."promoDiscount", 0)')), 'totalDiscounts']
                    ],
                    where: saleWhere,
                    raw: true
                }),
                role !== 'user' ? Expense.findAll({
                    where: { companyId, date: { [Op.gte]: startIso, [Op.lte]: endIso } },
                    attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']]
                }) : Promise.resolve([{ dataValues: { total: 0 } }]),
                SaleItem.findOne({
                    attributes: [
                        [sequelize.fn('SUM', sequelize.col('SaleItem.subtotal')), 'totalRevenue'],
                        [sequelize.fn('SUM', sequelize.literal('COALESCE("SaleItem"."quantity", 0) * COALESCE("SaleItem"."cost", 0)')), 'totalCost']
                    ],
                    include: [{ model: Sale, attributes: [], where: saleWhere }],
                    raw: true
                }),
                Sale.findAll({
                    where: saleWhere,
                    include: [{ model: SaleItem, as: 'SaleItems' }],
                    order: [['date', 'DESC']]
                }),
                role !== 'user' ? Expense.findAll({
                    where: { companyId, date: { [Op.gte]: startIso, [Op.lte]: endIso } }
                }) : Promise.resolve([]),
                Refund.findAll({
                    where: refundWhere,
                    attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']]
                })
            ]);

            const totalExpenses = precision.parseNumericInput(expensesResult[0]?.dataValues?.total);
            const totalRefunds = precision.parseNumericInput(refundsResult[0]?.dataValues?.total);
            const totalDiscounts = precision.parseNumericInput(summaryMetrics?.totalDiscounts);
            const grossItemsRevenue = precision.parseNumericInput(itemMetrics?.totalRevenue);
            const rawCost = precision.parseNumericInput(itemMetrics?.totalCost);
            const rawRevenue = Math.max(0, precision.subtract(grossItemsRevenue, totalDiscounts));
            const rawGrossProfit = precision.subtract(rawRevenue, rawCost);

            const totalRevenue = Math.max(0, precision.subtract(rawRevenue, totalRefunds));
            const refundRatio = rawRevenue > 0 ? Math.min(1, totalRefunds / rawRevenue) : 0;
            const grossProfit = precision.subtract(rawGrossProfit, rawGrossProfit * refundRatio);
            const netCostAfterRefunds = Math.max(0, precision.subtract(rawCost, rawCost * refundRatio));

            const numberOfSales = Number(summaryMetrics?.numberOfSales) || 0;
            const netProfit = precision.subtract(grossProfit, totalExpenses);

            analytics = processSalesAnalysis(salesWindow, expensesWindow, startIso);
            analytics.summary = {
                totalSales: totalRevenue,
                numberOfSales,
                totalExpenses,
                totalRefunds,
                grossProfit,
                netProfit,
                margin: netCostAfterRefunds > 0 ? precision.round((grossProfit / netCostAfterRefunds) * 100, 2) : 0,
                avgTicket: numberOfSales > 0 ? precision.round(totalRevenue / numberOfSales, 2) : 0
            };
        }

        // Inventory Valuation & Alerts (Optimized for Large Inventories + L1 Cache invalidated on sales/edits)
        let inventoryValuation = 0, itemCount = 0, lowStockItems = [], lowStockCount = 0;
        if (role !== 'user') {
            const invCacheKey = process.env.ISAAC_TEST_ISOLATED !== '1' ? `low_stock_valuation_${companyId}` : null;
            const cachedInv = invCacheKey ? cacheService.get(invCacheKey) : null;
            if (cachedInv) {
                inventoryValuation = cachedInv.inventoryValuation;
                itemCount = cachedInv.itemCount;
                lowStockItems = cachedInv.lowStockItems;
                lowStockCount = cachedInv.lowStockCount;
            } else {
                const notServiceSql = "LOWER(TRIM(COALESCE(\"category\", ''))) <> 'servicios'";
                const stockCol = sequelize.col('stockQuantity');
                const minStockCol = sequelize.col('minStock');
                const orderCol = 'stockQuantity';
                const lowStockWhere = {
                    companyId,
                    [Op.and]: [
                        sequelize.where(stockCol, Op.lte, minStockCol),
                        sequelize.literal(notServiceSql)
                    ]
                };

                const [valuationStats, lowStockRows, totalLowCount] = await Promise.all([
                    Product.findOne({
                        where: { companyId, isCustom: false },
                        attributes: [
                            [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} THEN "stockQuantity" * COALESCE("cost", 0) ELSE 0 END`)), 'totalValue'],
                            [sequelize.fn('COUNT', sequelize.literal('"id"')), 'count']
                        ],
                        raw: true
                    }),
                    Product.findAll({
                        where: lowStockWhere,
                        attributes: ['id', 'name', 'stockQuantity', 'minStock', 'stockUnit'],
                        order: [[orderCol, 'ASC']],
                        limit: 50,
                        raw: true
                    }),
                    Product.count({ where: lowStockWhere })
                ]);

                inventoryValuation = precision.parseNumericInput(valuationStats?.totalValue);
                itemCount = Number(valuationStats?.count) || 0;
                lowStockItems = lowStockRows;
                lowStockCount = Number(totalLowCount) || lowStockItems.length;

                if (invCacheKey) {
                    cacheService.set(invCacheKey, { inventoryValuation, itemCount, lowStockItems, lowStockCount }, 20);
                }
            }
        }

        // Charts (O(D) lookup vía Map y arreglo estático de días — elimina 365x Intl.DateTimeFormat por reporte anual)
        const ES_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const trendByDate = new Map((analytics.trends || []).map(t => [t.date, t]));
        const salesChart = { labels: [], sales: [], expenses: [] };
        for (let i = 0; i < daysToFetch; i++) {
            const d = new Date(queryStart);
            d.setUTCDate(queryStart.getUTCDate() + i);
            const dStr = d.toISOString().split('T')[0];
            salesChart.labels.push(ES_WEEKDAYS[d.getUTCDay()]);
            const trend = trendByDate.get(dStr);
            salesChart.sales.push(trend ? trend.sales : 0);
            salesChart.expenses.push(trend ? trend.expenses : 0);
        }

        const [recentSales, auditLogs] = await Promise.all([
            Sale.findAll({ where: { companyId }, limit: 10, order: [['date', 'DESC']], attributes: ['id', 'total', 'customerName', 'date', 'paymentMethod'] }),
            AuditLog.findAll({ where: { companyId }, include: [{ model: User, as: 'User', attributes: ['name', 'username'] }], limit: 10, order: [['createdAt', 'DESC']] })
        ]);

        const resultPayload = {
            debugRange: {
                queryStart: queryStart.toISOString(),
                queryEnd: queryEnd.toISOString(),
                daysToFetch,
                rollupAccelerated: Boolean(analytics?._rollupAccelerated)
            },
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
            inventory: { lowStockItems, lowStockCount, lowStockTotalCount: lowStockCount, totalValueAtCost: inventoryValuation, itemCount },
            activity: {
                recentSales,
                auditLogs: auditLogs.map(l => ({ id: l.id, action: l.action, userEmail: l.User ? (l.User.name || l.User.username) : 'Sistema', timestamp: l.timestamp }))
            }
        };
        if (dashCacheKey) {
            cacheService.set(dashCacheKey, resultPayload, 20);
        }
        return resultPayload;
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

        const netFactorSql = '(CASE WHEN COALESCE("Sale"."subtotal", 0) > (COALESCE("Sale"."discount", 0) + COALESCE("Sale"."promoDiscount", 0)) THEN (COALESCE("Sale"."subtotal", 0) - COALESCE("Sale"."discount", 0) - COALESCE("Sale"."promoDiscount", 0)) / "Sale"."subtotal" WHEN COALESCE("Sale"."subtotal", 0) > 0 THEN 0 ELSE 1 END)';

        // 1. Métricas Globales vía SQL (costo real de renglón y descuentos de factura reales)
        const [stats, discountsResult, refundsResult, totalExpensesRaw] = await Promise.all([
            SaleItem.findOne({
                attributes: [
                    [sequelize.fn('SUM', sequelize.literal('quantity * price')), 'totalSales'],
                    [sequelize.fn('SUM', sequelize.literal('quantity * COALESCE(cost, 0)')), 'totalCost'],
                    [sequelize.fn('COUNT', sequelize.literal('DISTINCT "saleId"')), 'numberOfSales']
                ],
                include: [{ model: Sale, attributes: [], where: saleWhere }],
                raw: true
            }),
            Sale.findOne({
                where: saleWhere,
                attributes: [[sequelize.fn('SUM', sequelize.literal('COALESCE("discount", 0) + COALESCE("promoDiscount", 0)')), 'totalDiscounts']],
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

        // 2. Tendencias Diarias vía SQL (ingresos netos post-descuento y utilidad bruta real)
        const rawTrends = await SaleItem.findAll({
            attributes: [
                [dateExpr, 'date'],
                [sequelize.fn('SUM', sequelize.literal(`("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}`)), 'sales'],
                [sequelize.fn('SUM', sequelize.literal(`(("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}) - ("SaleItem".quantity * COALESCE("SaleItem".cost, 0))`)), 'profit'],
                [sequelize.fn('COUNT', sequelize.literal('DISTINCT "SaleItem"."saleId"')), 'count']
            ],
            include: [{ model: Sale, attributes: [], where: saleWhere }],
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
                [sequelize.fn('SUM', sequelize.literal(`("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}`)), 'total'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * COALESCE("SaleItem".cost, 0)')), 'totalCost'],
                [sequelize.fn('SUM', sequelize.literal(`(("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}) - ("SaleItem".quantity * COALESCE("SaleItem".cost, 0))`)), 'totalProfit']
            ],
            include: [{ model: Sale, attributes: [], where: saleWhere }],
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
                [sequelize.fn('SUM', sequelize.literal(`("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}`)), 'total'],
                [sequelize.fn('SUM', sequelize.literal('"SaleItem".quantity * COALESCE("SaleItem".cost, 0)')), 'totalCost'],
                [sequelize.fn('SUM', sequelize.literal(`(("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}) - ("SaleItem".quantity * COALESCE("SaleItem".cost, 0))`)), 'totalProfit']
            ],
            include: [{ model: Sale, attributes: [], where: saleWhere }],
            group: ['name'],
            order: [[sequelize.literal('"totalProfit"'), 'DESC']],
            limit: 100,
            raw: true
        });

        // 4. Ventas por Categoría vía SQL
        const byCategory = await SaleItem.findAll({
            attributes: [
                [sequelize.literal("COALESCE(\"SaleItem\".category, 'General')"), 'category'],
                [sequelize.fn('SUM', sequelize.literal(`("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}`)), 'total'],
                [sequelize.fn('SUM', sequelize.literal(`(("SaleItem".quantity * "SaleItem".price) * ${netFactorSql}) - ("SaleItem".quantity * COALESCE("SaleItem".cost, 0))`)), 'profit']
            ],
            include: [{ model: Sale, attributes: [], where: saleWhere }],
            group: [sequelize.literal("COALESCE(\"SaleItem\".category, 'General')")],
            order: [[sequelize.literal('"total"'), 'DESC']],
            raw: true
        });

        const totalDiscounts = precision.parseNumericInput(discountsResult?.totalDiscounts);
        const grossItemsSales = precision.parseNumericInput(stats?.totalSales);
        const rawTotalCost = precision.parseNumericInput(stats?.totalCost);
        const rawTotalRevenue = Math.max(0, precision.subtract(grossItemsSales, totalDiscounts));
        const rawGrossProfit = precision.subtract(rawTotalRevenue, rawTotalCost);
        const totalRefunds = precision.parseNumericInput(refundsResult[0]?.dataValues?.total);

        const totalRevenue = Math.max(0, precision.subtract(rawTotalRevenue, totalRefunds));
        const refundRatio = rawTotalRevenue > 0 ? Math.min(1, totalRefunds / rawTotalRevenue) : 0;
        const grossProfit = precision.subtract(rawGrossProfit, rawGrossProfit * refundRatio);
        const netTotalCost = Math.max(0, precision.subtract(rawTotalCost, rawTotalCost * refundRatio));

        const formatProduct = (p) => {
            const total = precision.round(precision.parseNumericInput(p.total), 2);
            const totalCost = precision.round(precision.parseNumericInput(p.totalCost), 2);
            const totalProfit = precision.round(precision.parseNumericInput(p.totalProfit), 2);
            const quantity = precision.parseNumericInput(p.quantity);
            // Estandarizado a Markup sobre Costo ((Utilidad / Costo) * 100)
            const margin = totalCost > 0 ? precision.round((totalProfit / totalCost) * 100) : 0;
            return {
                name: p.name,
                quantity,
                total,
                totalCost,
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
                [sequelize.fn('SUM', sequelize.literal('(CASE WHEN COALESCE("subtotal", 0) > 0 THEN (CASE WHEN "subtotal" > (COALESCE("discount", 0) + COALESCE("promoDiscount", 0)) THEN "subtotal" - COALESCE("discount", 0) - COALESCE("promoDiscount", 0) ELSE 0 END) ELSE COALESCE("total", 0) END)')), 'totalSales'],
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

        const numberOfSales = Number(stats?.numberOfSales) || 0;
        const avgTicket = numberOfSales > 0 ? precision.round(totalRevenue / numberOfSales, 6) : 0;
        const totalExpenses = precision.round(Number(totalExpensesRaw) || 0, 2);
        const netProfit = precision.round(grossProfit - totalExpenses, 2);

        return {
            summary: {
                totalSales: totalRevenue,
                numberOfSales,
                totalRefunds,
                totalCost: precision.round(netTotalCost, 2),
                totalExpenses,
                grossProfit: precision.round(grossProfit, 2),
                netProfit,
                margin: netTotalCost > 0 ? precision.round((grossProfit / netTotalCost) * 100) : 0,
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
                [sequelize.fn('SUM', sequelize.literal('"stockQuantity" * COALESCE("cost", 0)')), 'valueAtCost'],
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
                margin: totalCost > 0 ? precision.round(((totalValue - totalCost) / totalCost) * 100) : 0,
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
        const date = String(dateQuery || new Date(Date.now() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0]).trim();
        let dateCondition;
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const nextDay = new Date(`${date}T00:00:00.000Z`);
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            const nextDateStr = nextDay.toISOString().slice(0, 10);
            dateCondition = { [Op.gte]: date, [Op.lt]: nextDateStr };
        } else {
            const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
            dateCondition = { [likeOp]: `${date}%` };
        }
        const saleWhere = { companyId, date: dateCondition };
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

        const rows = await Sale.findAll({
            where: saleWhere,
            attributes: [
                'customerId',
                [sequelize.fn('MAX', sequelize.col('customerName')), 'name'],
                [sequelize.fn('SUM', sequelize.literal('COALESCE("total", 0)')), 'totalSales'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'saleCount']
            ],
            group: ['customerId'],
            order: [[sequelize.literal('"totalSales"'), 'DESC']],
            limit: 10,
            raw: true
        });

        return (rows || []).map((r) => ({
            name: r.name || 'Cliente General',
            totalSales: precision.round(Number(r.totalSales) || 0, 2),
            saleCount: Number(r.saleCount) || 0
        }));
    }

    /**
     * Get accounts receivable (customers with pending credit & aging analysis).
     * Optimizado O(1) queries batch (elimina patrón N+1 3*N -> máximo 3 consultas).
     */
    async getAccountsReceivable(companyId) {
        const { Customer, CreditHistory, Sale: SaleModel } = require('../database/models');

        const customers = await Customer.findAll({
            where: { companyId, creditBalance: { [Op.gt]: 0 } },
            order: [['creditBalance', 'DESC']],
            raw: true
        });

        if (!customers || customers.length === 0) {
            return {
                summary: {
                    totalCustomers: 0,
                    totalAmount: 0,
                    averageExposure: 0,
                    aging: { current: 0, warning: 0, overdue: 0, critical: 0 }
                },
                customers: []
            };
        }

        const customerIds = customers.map((c) => c.id).filter(Boolean);
        const allHistories = customerIds.length > 0
            ? await CreditHistory.findAll({
                where: {
                    companyId,
                    customerId: { [Op.in]: customerIds },
                    type: { [Op.in]: ['charge', 'debit', 'payment', 'credit'] }
                },
                order: [['timestamp', 'ASC']],
                raw: true
            })
            : [];

        const chargesByCust = new Map();
        const paymentsSumByCust = new Map();
        for (const h of allHistories) {
            const cId = h.customerId;
            if (!cId) continue;
            if (h.type === 'charge' || h.type === 'debit') {
                if (!chargesByCust.has(cId)) chargesByCust.set(cId, []);
                chargesByCust.get(cId).push(h);
            } else {
                paymentsSumByCust.set(cId, (paymentsSumByCust.get(cId) || 0) + (Number(h.amount) || 0));
            }
        }

        const oldestDateByCust = new Map();
        const fallbackCustomerIds = [];
        for (const c of customers) {
            const allCharges = chargesByCust.get(c.id) || [];
            let availablePayments = paymentsSumByCust.get(c.id) || 0;
            let oldestDate = null;

            for (const ch of allCharges) {
                const amt = Number(ch.amount) || 0;
                if (availablePayments >= (amt - 0.005)) {
                    availablePayments = Math.max(0, availablePayments - amt);
                } else {
                    oldestDate = ch.timestamp || ch.createdAt;
                    break;
                }
            }

            if (oldestDate) {
                oldestDateByCust.set(c.id, oldestDate);
            } else {
                fallbackCustomerIds.push(c.id);
            }
        }

        const fallbackSalesByCust = new Map();
        if (fallbackCustomerIds.length > 0) {
            const creditSales = await SaleModel.findAll({
                where: {
                    companyId,
                    customerId: { [Op.in]: fallbackCustomerIds },
                    status: { [Op.ne]: 'cancelled' },
                    [Op.or]: [
                        { paymentStatus: { [Op.in]: ['unpaid', 'partial', 'pending'] } },
                        { paymentMethod: { [Op.in]: ['credit', 'fiado'] } }
                    ]
                },
                order: [['createdAt', 'DESC']],
                raw: true
            });
            for (const s of creditSales) {
                if (!s.customerId) continue;
                if (!fallbackSalesByCust.has(s.customerId)) fallbackSalesByCust.set(s.customerId, []);
                fallbackSalesByCust.get(s.customerId).push(s);
            }
        }

        let totalAmount = 0;
        let currentTotal = 0;   // 0-7 days
        let warningTotal = 0;   // 8-15 days
        let overdueTotal = 0;   // 16-30 days
        let criticalTotal = 0;  // 30+ days

        const now = Date.now();

        const enrichedCustomers = customers.map((c) => {
            const balance = Number(c.creditBalance) || 0;
            totalAmount += balance;

            let oldestDate = oldestDateByCust.get(c.id) || null;
            if (!oldestDate) {
                const creditSales = fallbackSalesByCust.get(c.id) || [];
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
        });

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
     * Optimizado O(1) queries batch (elimina patrón N+1 3*M -> máximo 3 consultas).
     */
    async getAccountsPayable(companyId) {
        const { Supplier, SupplierCreditHistory, PurchaseOrder } = require('../database/models');
        const suppliers = await Supplier.findAll({
            where: { companyId, creditBalance: { [Op.gt]: 0 } },
            order: [['creditBalance', 'DESC']],
            raw: true
        });

        if (!suppliers || suppliers.length === 0) {
            return {
                summary: { totalSuppliers: 0, totalAmount: 0 },
                suppliers: []
            };
        }

        const supplierIds = suppliers.map((s) => s.id).filter(Boolean);
        const allHistories = supplierIds.length > 0
            ? await SupplierCreditHistory.findAll({
                where: {
                    companyId,
                    supplierId: { [Op.in]: supplierIds },
                    type: { [Op.in]: ['charge', 'payment'] }
                },
                order: [['timestamp', 'ASC']],
                raw: true
            })
            : [];

        const chargesBySupplier = new Map();
        const paymentsSumBySupplier = new Map();
        const allPOrderIdSet = new Set();

        for (const row of allHistories) {
            const sId = row.supplierId;
            if (!sId) continue;
            if (row.type === 'charge') {
                if (!chargesBySupplier.has(sId)) chargesBySupplier.set(sId, []);
                chargesBySupplier.get(sId).push(row);
                if (row.purchaseOrderId) allPOrderIdSet.add(row.purchaseOrderId);
            } else {
                paymentsSumBySupplier.set(sId, (paymentsSumBySupplier.get(sId) || 0) + (Number(row.amount) || 0));
            }
        }

        const allPOrderIds = Array.from(allPOrderIdSet);
        let orderMap = new Map();
        if (allPOrderIds.length > 0) {
            const orders = await PurchaseOrder.findAll({
                where: { id: { [Op.in]: allPOrderIds }, companyId },
                attributes: ['id', 'invoiceUrl', 'referenceNumber', 'arrivalDate', 'dueDate', 'exchangeRate', 'total', 'totalVes'],
                raw: true
            });
            orderMap = new Map(orders.map((o) => [o.id, o]));
        }

        const enrichedSuppliers = suppliers.map((sData) => {
            const allCharges = chargesBySupplier.get(sData.id) || [];
            let availablePayments = paymentsSumBySupplier.get(sData.id) || 0;
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
            const upcomingDueDates = pendingInvoices.map(i => i.dueDate).filter(Boolean).sort();

            return {
                ...sData,
                invoices: pendingInvoices,
                nextDueDate: upcomingDueDates.length > 0 ? upcomingDueDates[0] : null
            };
        });

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

        const isPg = sequelize.getDialect() === 'postgres';
        const dayExpr = isPg
            ? sequelize.literal('SUBSTRING("date", 1, 10)')
            : sequelize.fn('strftime', '%Y-%m-%d', sequelize.col('date'), 'localtime');

        const aggregated = await Sale.findAll({
            where: saleWhere,
            attributes: [
                [dayExpr, 'day'],
                [sequelize.fn('SUM', sequelize.literal('COALESCE("total", 0)')), 'total']
            ],
            group: [dayExpr],
            order: [[dayExpr, 'ASC']],
            raw: true
        });

        const dailyData = {};
        for (let i = 0; i < days; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            dailyData[d.toISOString().split('T')[0]] = 0;
        }

        for (const row of (aggregated || [])) {
            const dStr = row.day ? String(row.day).substring(0, 10) : null;
            if (dStr && dailyData[dStr] !== undefined) {
                dailyData[dStr] = precision.round(Number(row.total) || 0, 2);
            }
        }

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
     * Soporta filtrado por sucursal (BranchStocks) o vista consolidada global.
     */
    async getInventoryValuation(companyId, branchId = null) {
        if (!companyId || companyId === 'default' || companyId === 'admin') {
            companyId = '2';
        }
        const { Product, Branch } = require('../database/models');
        if (companyId !== '2') {
            const prodCount = await Product.count({ where: { companyId } }).catch(() => 0);
            if (prodCount === 0) companyId = '2';
        }
        const companyCondition = (companyId === '2' || companyId === 'default')
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }] }
            : { companyId };

        let activeBranch = null;
        const rawBranch = branchId ? String(branchId).trim() : '';
        if (rawBranch && !['1', 'null', 'undefined', 'global'].includes(rawBranch.toLowerCase())) {
            const branchCompanyCond = (companyId === '2' || companyId === 'default')
                ? { [Op.or]: ['2', 'default', null] }
                : companyId;
            activeBranch = await Branch.findOne({
                where: { id: rawBranch, companyId: branchCompanyCond },
                attributes: ['id', 'name'],
                raw: true
            }).catch(() => null);
        }

        const stockExpr = activeBranch
            ? `COALESCE((SELECT bs."quantity" FROM "BranchStocks" bs WHERE bs."productId" = "Product"."id" AND bs."branchId" = ${sequelize.escape(activeBranch.id)} LIMIT 1), 0)`
            : `COALESCE((SELECT SUM(bs."quantity") FROM "BranchStocks" bs WHERE bs."productId" = "Product"."id"), "Product"."stockQuantity", 0)`;

        const safeStockExpr = `GREATEST(${stockExpr}, 0)`;
        const notServiceSql = `LOWER(TRIM(COALESCE("Product"."category", ''))) <> 'servicios'`;
        const isServiceSql = `LOWER(TRIM(COALESCE("Product"."category", ''))) = 'servicios'`;

        const valuationStats = await Product.findOne({
            where: {
                ...companyCondition,
                isCustom: { [Op.or]: [false, null] },
                status: 'active'
            },
            attributes: [
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} THEN ${safeStockExpr} * COALESCE("Product"."cost", 0) ELSE 0 END`)), 'totalValueAtCost'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} THEN ${safeStockExpr} * COALESCE("Product"."price", 0) ELSE 0 END`)), 'totalRetailValue'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND ${stockExpr} > 0 AND COALESCE("Product"."cost", 0) > 0 AND COALESCE("Product"."price", 0) > 0 THEN ${safeStockExpr} * "Product"."cost" ELSE 0 END`)), 'marginCostBase'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND ${stockExpr} > 0 AND COALESCE("Product"."cost", 0) > 0 AND COALESCE("Product"."price", 0) > 0 THEN ${safeStockExpr} * "Product"."price" ELSE 0 END`)), 'marginRetailBase'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND ${stockExpr} > 0 AND COALESCE("Product"."cost", 0) <= 0 THEN 1 ELSE 0 END`)), 'missingCostCount'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND ${stockExpr} > 0 AND COALESCE("Product"."cost", 0) <= 0 THEN ${safeStockExpr} * COALESCE("Product"."price", 0) ELSE 0 END`)), 'missingCostRetailValue'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND ${stockExpr} > 0 AND COALESCE("Product"."price", 0) <= 0 THEN 1 ELSE 0 END`)), 'zeroPriceCount'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} THEN 1 ELSE 0 END`)), 'itemCount'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${isServiceSql} THEN 1 ELSE 0 END`)), 'serviceCount'],
                [sequelize.fn('COUNT', sequelize.literal('"Product"."id"')), 'totalCatalogCount'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND ${stockExpr} <= COALESCE("Product"."minStock", 0) AND ${stockExpr} > 0 THEN 1 ELSE 0 END`)), 'lowStockCount'],
                [sequelize.fn('SUM', sequelize.literal(`CASE WHEN ${notServiceSql} AND ${stockExpr} <= 0 THEN 1 ELSE 0 END`)), 'outOfStockCount']
            ],
            raw: true
        });

        const totalValueAtCost = precision.round(Number(valuationStats?.totalValueAtCost) || 0, 2);
        const totalRetailValue = precision.round(Number(valuationStats?.totalRetailValue) || 0, 2);
        const marginCostBase = Number(valuationStats?.marginCostBase) || 0;
        const marginRetailBase = Number(valuationStats?.marginRetailBase) || 0;
        const projectedMarginProfit = precision.round(marginRetailBase - marginCostBase, 2);
        const projectedMarginPercent = marginCostBase > 0 ? precision.round((projectedMarginProfit / marginCostBase) * 100, 1) : 0;
        const itemCount = Number(valuationStats?.itemCount) || 0;
        const serviceCount = Number(valuationStats?.serviceCount) || 0;
        const totalCatalogCount = Number(valuationStats?.totalCatalogCount) || 0;
        const lowStockCount = Number(valuationStats?.lowStockCount) || 0;
        const outOfStockCount = Number(valuationStats?.outOfStockCount) || 0;
        const missingCostCount = Number(valuationStats?.missingCostCount) || 0;
        const missingCostRetailValue = precision.round(Number(valuationStats?.missingCostRetailValue) || 0, 2);
        const zeroPriceCount = Number(valuationStats?.zeroPriceCount) || 0;

        return {
            totalValueAtCost,
            totalRetailValue,
            itemCount,
            serviceCount,
            totalCatalogCount,
            lowStockCount,
            outOfStockCount,
            projectedMarginProfit,
            projectedMarginPercent,
            missingCostCount,
            missingCostRetailValue,
            zeroPriceCount,
            branchId: activeBranch?.id || null,
            branchName: activeBranch?.name || null,
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
