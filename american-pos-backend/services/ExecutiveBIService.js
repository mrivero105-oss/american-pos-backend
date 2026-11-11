const { 
    Sale, 
    SaleItem, 
    Expense, 
    ExchangeDifferenceLog, 
    AccountingPeriod, 
    SellerCommission, 
    User, 
    Product, 
    sequelize 
} = require('../database/models');
const { Op } = require('sequelize');

class ExecutiveBIService {
    // ==========================================
    // 1. ESTADO DE RESULTADOS (P&L) EJECUTIVO
    // ==========================================
    static async getProfitAndLoss(companyId = 'default', options = {}) {
        const currentDate = new Date();
        const year = parseInt(options.year) || currentDate.getFullYear();
        const month = options.month ? parseInt(options.month) : null;

        let startDateStr, endDateStr;
        if (options.startDate && options.endDate) {
            startDateStr = options.startDate;
            endDateStr = options.endDate;
        } else if (month) {
            const mStr = String(month).padStart(2, '0');
            const lastDay = new Date(year, month, 0).getDate();
            startDateStr = `${year}-${mStr}-01`;
            endDateStr = `${year}-${mStr}-${String(lastDay).padStart(2, '0')} 23:59:59`;
        } else {
            startDateStr = `${year}-01-01`;
            endDateStr = `${year}-12-31 23:59:59`;
        }

        const isPg = sequelize.getDialect() === 'postgres';

        let totalGrossSalesUsd = 0;
        let totalCostOfGoodsSoldUsd = 0;
        let totalSalesCount = 0;
        let topProducts = [];
        let sellerSalesMap = {};
        let expensesByCategory = {};
        let totalExpensesUsd = 0;

        if (isPg) {
            // 1. HIGH-PERFORMANCE POSTGRESQL NATIVE ANALYTICAL AGGREGATION
            const [salesAgg] = await sequelize.query(`
                SELECT 
                    COUNT(s.id)::int as "totalSalesCount",
                    COALESCE(SUM(s.total), 0)::float as "totalGrossSalesUsd"
                FROM "Sales" s
                WHERE s."companyId" = :companyId AND s.status = 'completed' AND s.date BETWEEN :startDateStr AND :endDateStr
            `, { replacements: { companyId: companyId || 'default', startDateStr, endDateStr }, type: sequelize.QueryTypes.SELECT });

            totalSalesCount = salesAgg?.totalSalesCount || 0;
            totalGrossSalesUsd = salesAgg?.totalGrossSalesUsd || 0;

            const [cogsAgg] = await sequelize.query(`
                SELECT 
                    COALESCE(SUM(si.quantity * COALESCE(si.cost, 0)), 0)::float as "totalCostOfGoodsSoldUsd"
                FROM "SaleItems" si
                INNER JOIN "Sales" s ON s.id = si."saleId"
                WHERE s."companyId" = :companyId AND s.status = 'completed' AND s.date BETWEEN :startDateStr AND :endDateStr
            `, { replacements: { companyId: companyId || 'default', startDateStr, endDateStr }, type: sequelize.QueryTypes.SELECT });

            totalCostOfGoodsSoldUsd = cogsAgg?.totalCostOfGoodsSoldUsd || 0;

            // Top 10 Productos Más Rentables directamente en PostgreSQL
            const dbTopProducts = await sequelize.query(`
                SELECT 
                    si."productId",
                    si.name as "productName",
                    COALESCE(SUM(si.quantity), 0)::float as "unitsSold",
                    COALESCE(SUM(si.quantity * si.price), 0)::float as "revenue",
                    COALESCE(SUM(si.quantity * COALESCE(si.cost, 0)), 0)::float as "cost",
                    COALESCE(SUM(si.quantity * (si.price - COALESCE(si.cost, 0))), 0)::float as "grossProfit"
                FROM "SaleItems" si
                INNER JOIN "Sales" s ON s.id = si."saleId"
                WHERE s."companyId" = :companyId AND s.status = 'completed' AND s.date BETWEEN :startDateStr AND :endDateStr
                GROUP BY si."productId", si.name
                ORDER BY "grossProfit" DESC
                LIMIT 10
            `, { replacements: { companyId: companyId || 'default', startDateStr, endDateStr }, type: sequelize.QueryTypes.SELECT });

            topProducts = dbTopProducts || [];

            // Desglose de Vendedores con Join de Usuarios
            const dbSellers = await sequelize.query(`
                SELECT 
                    s."userId" as "sellerId",
                    COALESCE(u.name, u.username, s."userId", 'admin') as "sellerName",
                    COALESCE(SUM(s.total), 0)::float as "totalSales",
                    COUNT(s.id)::int as "salesCount"
                FROM "Sales" s
                LEFT JOIN "Users" u ON u.id = s."userId"
                WHERE s."companyId" = :companyId AND s.status = 'completed' AND s.date BETWEEN :startDateStr AND :endDateStr
                GROUP BY s."userId", u.name, u.username
            `, { replacements: { companyId: companyId || 'default', startDateStr, endDateStr }, type: sequelize.QueryTypes.SELECT });

            (dbSellers || []).forEach(sel => {
                sellerSalesMap[sel.sellerId] = sel;
            });

            // Gastos agrupados en PostgreSQL
            const dbExpenses = await sequelize.query(`
                SELECT 
                    COALESCE(category, 'Otros') as category,
                    COALESCE(SUM(amount), 0)::float as amount
                FROM "Expenses"
                WHERE "companyId" = :companyId AND date BETWEEN :startDateStr AND :endDateStr
                GROUP BY category
                ORDER BY amount DESC
            `, { replacements: { companyId: companyId || 'default', startDateStr, endDateStr }, type: sequelize.QueryTypes.SELECT });

            (dbExpenses || []).forEach(e => {
                expensesByCategory[e.category] = e.amount;
                totalExpensesUsd += e.amount;
            });

        } else {
            // 1. Fallback SQLite: Obtener Ventas Completadas en el período
            const sales = await Sale.findAll({
                where: {
                    companyId: companyId || 'default',
                    status: 'completed',
                    date: { [Op.between]: [startDateStr, endDateStr] }
                },
                include: [{
                    model: SaleItem,
                    as: 'SaleItems'
                }]
            });

            totalSalesCount = sales.length;
            const productProfitMap = {};

            for (const s of sales) {
                const saleTotal = parseFloat(s.total) || 0;
                const saleTotalUsd = saleTotal; 
                totalGrossSalesUsd += saleTotalUsd;

                // Vendedor
                const sellerId = s.userId || 'admin';
                if (!sellerSalesMap[sellerId]) {
                    sellerSalesMap[sellerId] = {
                        sellerId,
                        sellerName: sellerId,
                        totalSales: 0,
                        salesCount: 0
                    };
                }
                sellerSalesMap[sellerId].totalSales += saleTotalUsd;
                sellerSalesMap[sellerId].salesCount += 1;

                // Items para Costo de Mercancía Vendida (CMV)
                const items = s.SaleItems || [];
                for (const item of items) {
                    const qty = parseFloat(item.quantity) || 0;
                    const cost = parseFloat(item.cost) || 0;
                    const price = parseFloat(item.price) || 0;
                    const itemTotalCost = qty * cost;
                    const itemTotalRev = qty * price;
                    const itemGrossProfit = itemTotalRev - itemTotalCost;

                    totalCostOfGoodsSoldUsd += itemTotalCost;

                    const prodKey = item.productId || item.name;
                    if (!productProfitMap[prodKey]) {
                        productProfitMap[prodKey] = {
                            productId: item.productId,
                            productName: item.name,
                            unitsSold: 0,
                            revenue: 0,
                            cost: 0,
                            grossProfit: 0
                        };
                    }
                    productProfitMap[prodKey].unitsSold += qty;
                    productProfitMap[prodKey].revenue += itemTotalRev;
                    productProfitMap[prodKey].cost += itemTotalCost;
                    productProfitMap[prodKey].grossProfit += itemGrossProfit;
                }
            }

            topProducts = Object.values(productProfitMap)
                .sort((a, b) => b.grossProfit - a.grossProfit)
                .slice(0, 10);

            // 2. Gastos Operativos SQLite
            const expenses = await Expense.findAll({
                where: {
                    companyId: companyId || 'default',
                    date: { [Op.between]: [startDateStr, endDateStr] }
                }
            });

            for (const exp of expenses) {
                const amount = parseFloat(exp.amount) || 0;
                totalExpensesUsd += amount;
                const cat = exp.category || 'Otros';
                expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amount;
            }

            // Hidratar nombres reales de vendedores SQLite
            const sellerIds = Object.keys(sellerSalesMap);
            if (sellerIds.length > 0) {
                try {
                    const dbUsers = await User.findAll({
                        where: { id: sellerIds },
                        attributes: ['id', 'name', 'username']
                    });
                    for (const u of dbUsers) {
                        if (sellerSalesMap[u.id]) {
                            sellerSalesMap[u.id].sellerName = u.name || u.username || u.id;
                        }
                    }
                } catch (uErr) {
                    console.warn('[ExecutiveBI] Warning hydrating seller names:', uErr.message);
                }
            }
        }

        const grossProfitUsd = totalGrossSalesUsd - totalCostOfGoodsSoldUsd;
        const grossMarginPercent = totalGrossSalesUsd > 0 ? (grossProfitUsd / totalGrossSalesUsd) * 100 : 0;

        // 3. Diferencial Cambiario Neto
        const diffLogs = await ExchangeDifferenceLog.findAll({
            where: {
                companyId: companyId || 'default',
                date: { [Op.between]: [startDateStr, endDateStr] }
            }
        });

        let exchangeGainsVes = 0;
        let exchangeLossesVes = 0;
        for (const log of diffLogs) {
            const diffAmount = parseFloat(log.differenceAmountVes) || 0;
            if (diffAmount >= 0) exchangeGainsVes += diffAmount;
            else exchangeLossesVes += Math.abs(diffAmount);
        }
        const netExchangeDiffVes = exchangeGainsVes - exchangeLossesVes;

        // 4. Utilidad Neta (EBITDA / Ganancia Real)
        const netProfitUsd = grossProfitUsd - totalExpensesUsd;
        const netMarginPercent = totalGrossSalesUsd > 0 ? (netProfitUsd / totalGrossSalesUsd) * 100 : 0;

        // Desglose de Gastos Formateado
        const expenseBreakdown = Object.entries(expensesByCategory).map(([category, amount]) => ({
            category,
            amount,
            percentage: totalExpensesUsd > 0 ? (amount / totalExpensesUsd) * 100 : 0
        })).sort((a, b) => b.amount - a.amount);

        return {
            period: {
                year,
                month,
                startDate: startDateStr,
                endDate: endDateStr
            },
            summary: {
                grossSales: parseFloat(totalGrossSalesUsd.toFixed(2)),
                salesCount: totalSalesCount,
                costOfGoodsSold: parseFloat(totalCostOfGoodsSoldUsd.toFixed(2)),
                grossProfit: parseFloat(grossProfitUsd.toFixed(2)),
                grossMarginPercent: parseFloat(grossMarginPercent.toFixed(2)),
                totalOperatingExpenses: parseFloat(totalExpensesUsd.toFixed(2)),
                netExchangeDifferenceVes: parseFloat(netExchangeDiffVes.toFixed(2)),
                exchangeGainsVes: parseFloat(exchangeGainsVes.toFixed(2)),
                exchangeLossesVes: parseFloat(exchangeLossesVes.toFixed(2)),
                netProfit: parseFloat(netProfitUsd.toFixed(2)),
                netMarginPercent: parseFloat(netMarginPercent.toFixed(2))
            },
            expenseBreakdown,
            topProducts,
            sellers: Object.values(sellerSalesMap)
        };
    }

    // ==========================================
    // 2. CIERRES DE PERÍODO CONTABLE
    // ==========================================
    static async getAccountingPeriods(companyId = 'default', year = null) {
        const targetYear = parseInt(year) || new Date().getFullYear();
        const savedPeriods = await AccountingPeriod.findAll({
            where: {
                companyId: companyId || 'default',
                periodYear: targetYear
            },
            order: [['periodMonth', 'ASC']]
        });

        const periodMap = {};
        savedPeriods.forEach(p => { periodMap[p.periodMonth] = p; });

        const monthsNames = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];

        return monthsNames.map((name, idx) => {
            const m = idx + 1;
            const existing = periodMap[m];
            return existing ? existing.toJSON() : {
                id: `period_${targetYear}_${String(m).padStart(2, '0')}`,
                companyId: companyId || 'default',
                periodMonth: m,
                periodYear: targetYear,
                monthName: name,
                isClosed: false,
                closedAt: null,
                closedBy: '',
                closureNotes: '',
                salesTotal: 0,
                costTotal: 0,
                grossProfit: 0,
                expensesTotal: 0,
                netProfit: 0
            };
        });
    }

    static async closePeriod(companyId = 'default', year, month, userId = 'admin', notes = '') {
        const y = parseInt(year);
        const m = parseInt(month);
        const id = `period_${y}_${String(m).padStart(2, '0')}_${companyId || 'default'}`;

        let period = await AccountingPeriod.findOne({
            where: { companyId: companyId || 'default', periodYear: y, periodMonth: m }
        });

        if (period && period.isClosed) {
            throw new Error(`El período ${m}/${y} ya se encuentra cerrado formalmente.`);
        }

        // Calcular snapshot P&L del mes
        const pnl = await this.getProfitAndLoss(companyId, { year: y, month: m });

        if (!period) {
            period = await AccountingPeriod.create({
                id,
                companyId: companyId || 'default',
                periodMonth: m,
                periodYear: y,
                isClosed: true,
                closedAt: new Date(),
                closedBy: userId || 'admin',
                closureNotes: notes || 'Cierre mensual de ejercicio contable',
                salesTotal: pnl.summary.grossSales,
                costTotal: pnl.summary.costOfGoodsSold,
                grossProfit: pnl.summary.grossProfit,
                expensesTotal: pnl.summary.totalOperatingExpenses,
                netProfit: pnl.summary.netProfit
            });
        } else {
            await period.update({
                isClosed: true,
                closedAt: new Date(),
                closedBy: userId || 'admin',
                closureNotes: notes || period.closureNotes,
                salesTotal: pnl.summary.grossSales,
                costTotal: pnl.summary.costOfGoodsSold,
                grossProfit: pnl.summary.grossProfit,
                expensesTotal: pnl.summary.totalOperatingExpenses,
                netProfit: pnl.summary.netProfit
            });
        }

        return period;
    }

    static async reopenPeriod(companyId = 'default', year, month, userId = 'supervisor', reason = '') {
        const y = parseInt(year);
        const m = parseInt(month);

        const period = await AccountingPeriod.findOne({
            where: { companyId: companyId || 'default', periodYear: y, periodMonth: m }
        });

        if (!period) throw new Error('Período no encontrado');
        if (!period.isClosed) throw new Error('El período ya está abierto');

        await period.update({
            isClosed: false,
            reopenedAt: new Date(),
            reopenedBy: userId || 'supervisor',
            reopenReason: reason || 'Reapertura autorizada por auditoría'
        });

        return period;
    }

    static async isDateInClosedPeriod(companyId = 'default', dateStr) {
        if (!dateStr) return false;
        try {
            const d = new Date(dateStr);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const period = await AccountingPeriod.findOne({
                where: { companyId: companyId || 'default', periodYear: y, periodMonth: m, isClosed: true }
            });
            return Boolean(period);
        } catch (e) {
            return false;
        }
    }

    // ==========================================
    // 3. COMISIONES DE VENDEDORES
    // ==========================================
    static async getSellerCommissions(companyId = 'default', year, month) {
        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);

        const mStr = String(m).padStart(2, '0');
        const lastDay = new Date(y, m, 0).getDate();
        const startDateStr = `${y}-${mStr}-01`;
        const endDateStr = `${y}-${mStr}-${String(lastDay).padStart(2, '0')} 23:59:59`;

        // Obtener todos los usuarios del sistema
        const users = await User.findAll({
            where: { companyId: companyId || 'default' },
            attributes: ['id', 'username', 'name', 'role']
        });

        // Obtener ventas del mes agrupadas por userId
        const sales = await Sale.findAll({
            where: {
                companyId: companyId || 'default',
                status: 'completed',
                date: { [Op.between]: [startDateStr, endDateStr] }
            },
            attributes: ['id', 'userId', 'total', 'subtotal']
        });

        const salesByUser = {};
        sales.forEach(s => {
            const uid = s.userId || 'admin';
            if (!salesByUser[uid]) {
                salesByUser[uid] = { total: 0, count: 0 };
            }
            salesByUser[uid].total += parseFloat(s.total) || 0;
            salesByUser[uid].count += 1;
        });

        // Obtener registros ya guardados de comisiones
        const existingCommissions = await SellerCommission.findAll({
            where: { companyId: companyId || 'default', periodYear: y, periodMonth: m }
        });
        const existingMap = {};
        existingCommissions.forEach(c => { existingMap[c.userId] = c; });

        const result = [];
        for (const u of users) {
            const stats = salesByUser[u.id] || { total: 0, count: 0 };
            const existing = existingMap[u.id];

            const rate = existing ? parseFloat(existing.commissionRate) : 3.0; // 3% default
            const commissionAmt = (stats.total * rate) / 100;

            result.push({
                id: existing ? existing.id : `comm_${y}_${m}_${u.id}`,
                userId: u.id,
                userName: u.name || u.username,
                role: u.role,
                periodMonth: m,
                periodYear: y,
                commissionRate: rate,
                calculationBasis: existing ? existing.calculationBasis : 'VENTAS_TOTALES',
                totalSales: parseFloat(stats.total.toFixed(2)),
                salesCount: stats.count,
                commissionAmount: parseFloat(commissionAmt.toFixed(2)),
                status: existing ? existing.status : 'CALCULADO',
                liquidatedAt: existing ? existing.liquidatedAt : null,
                paidAt: existing ? existing.paidAt : null,
                notes: existing ? existing.notes : ''
            });
        }

        return result;
    }

    static async setCommissionRate(companyId = 'default', userId, year, month, rate, notes = '') {
        const y = parseInt(year);
        const m = parseInt(month);
        const id = `comm_${y}_${m}_${userId}_${companyId || 'default'}`;

        const mStr = String(m).padStart(2, '0');
        const lastDay = new Date(y, m, 0).getDate();
        const startDateStr = `${y}-${mStr}-01`;
        const endDateStr = `${y}-${mStr}-${String(lastDay).padStart(2, '0')} 23:59:59`;

        const userSales = await Sale.findAll({
            where: {
                companyId: companyId || 'default',
                userId: String(userId),
                status: 'completed',
                date: { [Op.between]: [startDateStr, endDateStr] }
            },
            attributes: ['total']
        });
        const totalSales = Math.round(userSales.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0) * 100) / 100;
        const salesCount = userSales.length;

        let comm = await SellerCommission.findOne({
            where: { companyId: companyId || 'default', userId: String(userId), periodYear: y, periodMonth: m }
        });

        const r = parseFloat(rate) || 0;
        const newAmount = Math.round(((totalSales * r) / 100) * 100) / 100;

        if (comm) {
            await comm.update({
                commissionRate: r,
                totalSales,
                salesCount,
                commissionAmount: newAmount,
                notes: notes || comm.notes
            });
        } else {
            comm = await SellerCommission.create({
                id,
                companyId: companyId || 'default',
                userId: String(userId),
                periodMonth: m,
                periodYear: y,
                commissionRate: r,
                totalSales,
                salesCount,
                commissionAmount: newAmount,
                notes
            });
        }

        return comm;
    }

    static async settleCommission(id, companyId = 'default', notes = '') {
        const comm = await SellerCommission.findOne({
            where: { id, companyId: companyId || 'default' }
        });
        if (!comm) throw new Error('Registro de comisión no encontrado');

        await comm.update({
            status: 'PAGADO',
            paidAt: new Date(),
            notes: notes ? `${comm.notes} | ${notes}` : comm.notes
        });

        return comm;
    }
}

module.exports = ExecutiveBIService;
