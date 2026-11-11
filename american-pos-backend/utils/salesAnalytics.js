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
                const itemP = Number(item.price) || 0;
                const itemQ = Number(item.quantity) || 0;
                const sub = precision.multiply(itemP, itemQ);
                itemsSum = precision.round(precision.add([itemsSum, sub]), 2);
            });
        }

        // If saleTotal is zero but we have an itemsSum, use it
        if (saleTotal === 0 && itemsSum > 0) {
            saleTotal = itemsSum;
        }

        totalSales = precision.round(precision.add([totalSales, saleTotal]), 2);

        // Tendencias
        if (saleDate) {
            if (!dailyTrendMap[saleDate]) dailyTrendMap[saleDate] = { sales: 0, profit: 0, expenses: 0, count: 0 };
            dailyTrendMap[saleDate].sales = precision.round(precision.add([dailyTrendMap[saleDate].sales, saleTotal]), 2);
            dailyTrendMap[saleDate].count += 1;
        }

        // Clientes
        if (sale.customerId || sale.customerName) {
            const cId = sale.customerId || 'CF'; // 'CF' Consumidor final
            if (!customerMap[cId]) {
                customerMap[cId] = { name: sale.customerName || 'Cliente General', totalSales: 0, saleCount: 0 };
            }
            customerMap[cId].totalSales = precision.round(precision.add([customerMap[cId].totalSales, saleTotal]), 2);
            customerMap[cId].saleCount += 1;
        }

        // Métodos de pago
        const validMethods = ['cash', 'cash_bs', 'card', 'zelle', 'pago_movil', 'transfer'];
        const method = validMethods.includes(sale.paymentMethod) ? sale.paymentMethod : 'Otros';
        if (!paymentMap[method]) paymentMap[method] = 0;
        paymentMap[method] = precision.round(precision.add([paymentMap[method], saleTotal]), 2);

        // Horarios
        const timestamp = sale.createdAt || sale.date;
        if (timestamp) {
            const hour = new Date(timestamp).getHours();
            if (hour >= 0 && hour < 24) {
                hourlySales[hour].count += 1;
                hourlySales[hour].total = precision.round(precision.add([hourlySales[hour].total, saleTotal]), 2);
            }
        }

        // Items (Costo, Ganancia, Productos, Categorías)
        let saleCost = 0;

        if (itemsToProcess.length > 0) {
            itemsToProcess.forEach(item => {
                const name = item.name || 'Desconocido';
                const category = item.category || 'General';
                const price = Number(item.price) || 0;
                const cost = Number(item.cost) || 0;
                const qty = Number(item.quantity) || 0;

                const itemTotal = precision.round(precision.multiply(price, qty), 2);
                const itemCost = precision.round(precision.multiply(cost, qty), 2);
                const itemProfit = precision.round(precision.subtract(itemTotal, itemCost), 2);

                saleCost = precision.round(precision.add([saleCost, itemCost]), 2);

                // Añadir a tendencia
                if (saleDate && dailyTrendMap[saleDate]) {
                    dailyTrendMap[saleDate].profit = precision.round(precision.add([dailyTrendMap[saleDate].profit, itemProfit]), 2);
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
                productMap[name].totalProfit = precision.round(precision.add([productMap[name].totalProfit, itemProfit]), 2);
                productMap[name].quantity = precision.round(precision.add([productMap[name].quantity, qty]), 4);
                productMap[name].totalRevenue = precision.round(precision.add([productMap[name].totalRevenue, itemTotal]), 2);

                // Categoría
                if (!categoryMap[category]) categoryMap[category] = { category, totalRevenue: 0, totalProfit: 0, quantity: 0 };
                categoryMap[category].totalProfit = precision.round(precision.add([categoryMap[category].totalProfit, itemProfit]), 2);
                categoryMap[category].totalRevenue = precision.round(precision.add([categoryMap[category].totalRevenue, itemTotal]), 2);
                categoryMap[category].quantity = precision.round(precision.add([categoryMap[category].quantity, qty]), 4);
            });
        }

        totalCost = precision.round(precision.add([totalCost, saleCost]), 2);
    });

    // Gastos
    let totalExpenses = 0;
    expenses.forEach(e => {
        const amt = precision.round(Number(e.amount) || 0, 2);
        totalExpenses = precision.round(precision.add([totalExpenses, amt]), 2);

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
            dailyTrendMap[eDate].expenses = precision.round(precision.add([dailyTrendMap[eDate].expenses, amt]), 2);
        }
    });

    // Formatear salidas de objetos a arreglos ordenados

    // Top Productos por Ganancia (Top 10)
    const topProductsByProfit = Object.values(productMap)
        .map(p => ({
            ...p,
            margin: p.totalRevenue > 0 ? precision.round(precision.multiply(precision.divide(p.totalProfit, p.totalRevenue), 100), 2) : 0
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

    const grossProfit = precision.round(precision.subtract(totalSales, totalCost), 2);
    const netProfit = precision.round(precision.subtract(grossProfit, totalExpenses), 2);

    return {
        summary: {
            totalSales,
            numberOfSales: sales.length,
            totalCost,
            totalExpenses,
            grossProfit,
            netProfit,
            margin: totalSales > 0 ? precision.round(precision.multiply(precision.divide(grossProfit, totalSales), 100), 2) : 0,
            avgTicket: sales.length > 0 ? precision.round(precision.divide(totalSales, sales.length), 2) : 0,
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
