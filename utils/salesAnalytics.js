const { Op } = require('sequelize');
const precision = require('./precision');

/**
 * Procesa un arreglo de ventas y gastos para generar métricas unificadas de BI y Dashboard.
 * 
 * @param {Array} sales - Arreglo de instancias de venta (models/Sale)
 * @param {Array} expenses - Arreglo opcional de instancias de gasto (models/Expense)
 * @param {Date} startDate - Fecha desde la cual contar (opcional, extraida de las ventas o usada para inicializar tendencias)
 * @returns {Object} - Objeto con todas las métricas procesadas
 */
function processSalesAnalysis(sales = [], expenses = [], startDate = null) {
    let totalSales = 0;
    let totalCost = 0;

    // Para tendencias (Agrupado por día)
    const dailyTrendMap = {}; // { date: { sales, profit, expenses, count } }

    // Para top de productos
    const productMap = {}; // by ID o Name
    // Para categorías
    const categoryMap = {};
    // Para clientes
    const customerMap = {};
    // Para métodos de pago
    const paymentMap = {};

    // Horarios
    const hourlySales = Array(24).fill(0).map((_, i) => ({ hour: i, count: 0, total: 0 }));

    sales.forEach(sale => {
        // Date normalizada YYYY-MM-DD
        let saleDate = '';
        const rawDate = sale.date || sale.createdAt || '';
        if (rawDate instanceof Date) {
            saleDate = rawDate.toISOString().split('T')[0];
        } else if (typeof rawDate === 'string' && rawDate.includes('T')) {
            saleDate = rawDate.split('T')[0];
        } else if (rawDate && typeof rawDate === 'string') {
            saleDate = rawDate.substring(0, 10);
        }

        let saleTotal = precision.round(Number(sale.total) || 0);

        // Fallback: If total is zero but there are items, calculate it from items
        // This is crucial for Postgres or migrations where the header total might be missing
        let itemsSum = 0;
        let itemsToProcess = [];
        if (sale.SaleItems && sale.SaleItems.length > 0) {
            itemsToProcess = sale.SaleItems;
        } else if (sale.items && Array.isArray(sale.items)) {
            itemsToProcess = sale.items;
        } else if (typeof sale.items === 'string') {
            try { itemsToProcess = JSON.parse(sale.items); } catch (e) { }
        }

        if (itemsToProcess.length > 0) {
            itemsToProcess.forEach(item => {
                itemsSum = precision.round(itemsSum + (precision.round(Number(item.price) || 0) * precision.round(Number(item.quantity) || 0, 3)));
            });
        }

        // If saleTotal is zero but we have an itemsSum, use it
        if (saleTotal === 0 && itemsSum > 0) {
            saleTotal = itemsSum;
        }

        totalSales = precision.round(totalSales + saleTotal);

        // Tendencias
        if (saleDate) {
            if (!dailyTrendMap[saleDate]) dailyTrendMap[saleDate] = { sales: 0, profit: 0, expenses: 0, count: 0 };
            dailyTrendMap[saleDate].sales = precision.round(dailyTrendMap[saleDate].sales + saleTotal);
            dailyTrendMap[saleDate].count += 1;
        }

        // Clientes
        if (sale.customerId || sale.customerName) {
            const cId = sale.customerId || 'CF'; // 'CF' Consumidor final
            if (!customerMap[cId]) {
                customerMap[cId] = { name: sale.customerName || 'Cliente General', totalSales: 0, saleCount: 0 };
            }
            customerMap[cId].totalSales = precision.round(customerMap[cId].totalSales + saleTotal);
            customerMap[cId].saleCount += 1;
        }

        // Métodos de pago
        const validMethods = ['cash', 'cash_bs', 'card', 'zelle', 'pago_movil', 'transfer'];
        const method = validMethods.includes(sale.paymentMethod) ? sale.paymentMethod : 'Otros';
        if (!paymentMap[method]) paymentMap[method] = 0;
        paymentMap[method] = precision.round(paymentMap[method] + saleTotal);

        // Horarios
        const timestamp = sale.createdAt || sale.date;
        if (timestamp) {
            const hour = new Date(timestamp).getHours();
            if (hour >= 0 && hour < 24) {
                hourlySales[hour].count += 1;
                hourlySales[hour].total = precision.round(hourlySales[hour].total + saleTotal);
            }
        }

        // Items (Costo, Ganancia, Productos, Categorías)
        let saleCost = 0;

        // NEW: Prefer eager-loaded SaleItems (Relational API) over parsed JSON blob (Legacy)
        // itemsToProcess was already extracted for the totalSales fallback above

        if (itemsToProcess.length > 0) {
            itemsToProcess.forEach(item => {
                const name = item.name || 'Desconocido';
                const category = item.category || 'General';
                const price = precision.round(Number(item.price) || 0);

                // If using Relational DB but Product model wasn't included to fetch cost, fallback to 0. 
                // Legacy JSON had 'cost' stored inside the blob.
                const cost = precision.round(Number(item.cost) || 0);

                const qty = precision.round(Number(item.quantity) || 0, 3);

                const itemTotal = precision.round(price * qty);
                const itemCost = precision.round(cost * qty);
                const itemProfit = precision.round(itemTotal - itemCost);

                saleCost = precision.round(saleCost + itemCost);

                // Añadir a tendencia
                if (saleDate && dailyTrendMap[saleDate]) {
                    dailyTrendMap[saleDate].profit = precision.round(dailyTrendMap[saleDate].profit + itemProfit);
                }

                // Producto
                if (!productMap[name]) {
                    productMap[name] = {
                        name,
                        category,
                        totalProfit: 0,
                        quantity: 0,
                        totalRevenue: 0,
                        unit: item.stockUnit || (item.isSoldByWeight ? 'kg' : 'und')
                    };
                }
                productMap[name].totalProfit = precision.round(productMap[name].totalProfit + itemProfit);
                productMap[name].quantity = precision.round(productMap[name].quantity + qty, 3);
                productMap[name].totalRevenue = precision.round(productMap[name].totalRevenue + itemTotal);

                // Categoría
                if (!categoryMap[category]) categoryMap[category] = { category, totalRevenue: 0, totalProfit: 0, quantity: 0 };
                categoryMap[category].totalProfit = precision.round(categoryMap[category].totalProfit + itemProfit);
                categoryMap[category].totalRevenue = precision.round(categoryMap[category].totalRevenue + itemTotal);
                categoryMap[category].quantity = precision.round(categoryMap[category].quantity + qty, 3);
            });
        }

        totalCost = precision.round(totalCost + saleCost);
    });

    // Gastos
    let totalExpenses = 0;
    expenses.forEach(e => {
        const amt = precision.round(Number(e.amount) || 0);
        totalExpenses = precision.round(totalExpenses + amt);

        let eDate = '';
        const rawDate = e.date || e.createdAt || '';
        if (rawDate instanceof Date) {
            eDate = rawDate.toISOString().split('T')[0];
        } else if (typeof rawDate === 'string' && rawDate.includes('T')) {
            eDate = rawDate.split('T')[0];
        } else if (rawDate && typeof rawDate === 'string') {
            eDate = rawDate.substring(0, 10);
        }

        if (eDate) {
            if (!dailyTrendMap[eDate]) dailyTrendMap[eDate] = { sales: 0, profit: 0, expenses: 0, count: 0 };
            dailyTrendMap[eDate].expenses = precision.round(dailyTrendMap[eDate].expenses + amt);
        }
    });

    // Formatear salidas de objetos a arreglos ordenados

    // Top Productos por Ganancia (Top 10)
    const topProductsByProfit = Object.values(productMap)
        .map(p => ({
            ...p,
            margin: p.totalRevenue > 0 ? precision.round((p.totalProfit / p.totalRevenue) * 100) : 0
        }))
        .sort((a, b) => b.totalProfit - a.totalProfit)
        .slice(0, 10);

    // Top Productos por Cantidad (Top 5) para el Dashboard normal
    const topProductsByQuantity = Object.values(productMap)
        .map(p => ({
            name: p.name,
            quantity: p.quantity,
            total: p.totalRevenue,
            unit: p.unit
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);

    // Tendencias
    const trends = Object.entries(dailyTrendMap)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // Categorías (Por utilidad/ventas)
    const categorySales = Object.values(categoryMap)
        .map(c => ({
            name: c.category,
            category: c.category,
            profit: c.totalProfit,
            total: c.totalRevenue,
            quantity: c.quantity
        }))
        .sort((a, b) => b.total - a.total);

    // Clientes
    const topCustomers = Object.values(customerMap)
        .sort((a, b) => b.totalSales - a.totalSales)
        .slice(0, 10);

    // Métodos de pago
    const paymentMethodsList = Object.entries(paymentMap)
        .map(([method, total]) => ({ method, total }))
        .sort((a, b) => b.total - a.total);

    if (paymentMethodsList.length === 0) {
        paymentMethodsList.push({ method: 'Sin Ventas', total: 0 }); // Placeholder
    }

    const grossProfit = precision.round(totalSales - totalCost);
    const netProfit = precision.round(grossProfit - totalExpenses);

    return {
        summary: {
            totalSales,
            numberOfSales: sales.length,
            totalCost,
            totalExpenses,
            grossProfit,
            netProfit,
            margin: totalSales > 0 ? precision.round((grossProfit / totalSales) * 100) : 0,
            avgTicket: sales.length > 0 ? precision.round(totalSales / sales.length) : 0,
            hasEstimations: sales.some(s => s.SaleItems?.some(i => !i.cost || Number(i.cost) === 0))
        },
        topProducts: topProductsByQuantity,
        topProductsByProfit,
        trends,
        byCategory: categorySales, // Array de {name, profit, total, category}
        hourlySales,
        paymentMethods: paymentMethodsList,
        topCustomers
    };
}

module.exports = {
    processSalesAnalysis
};
