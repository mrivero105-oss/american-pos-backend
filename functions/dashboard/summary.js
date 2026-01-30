export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        // 1. Total Revenue
        // 1. Total Revenue
        const revenueResult = await context.env.DB.prepare(
            "SELECT SUM(total) as totalRevenue FROM sales"
        ).first();
        const totalRevenue = revenueResult?.totalRevenue || 0;

        // 2. Number of Sales
        const countResult = await context.env.DB.prepare(
            "SELECT COUNT(*) as count FROM sales"
        ).first();
        const numberOfSales = countResult?.count || 0;

        // 3. Low Stock Items
        const { results: lowStockItems } = await context.env.DB.prepare(
            "SELECT name, stockQuantity as stock FROM products WHERE stockQuantity <= 5"
        ).all();

        // 4. Sales Last 7 Days
        const { results: salesTrend } = await context.env.DB.prepare(
            `SELECT date(timestamp) as date, SUM(total) as total 
         FROM sales 
         WHERE timestamp >= date('now', '-7 days')
         GROUP BY date(timestamp) 
         ORDER BY date ASC`
        ).all();

        const salesLast7Days = {
            labels: salesTrend.map(s => s.date),
            data: salesTrend.map(s => s.total)
        };

        // 5. Total Profit & Avg Margin
        const profitResult = await context.env.DB.prepare(
            "SELECT SUM(profit) as totalProfit, AVG(profitMargin) as avgMargin FROM sales WHERE profit IS NOT NULL"
        ).first();
        const totalProfit = profitResult?.totalProfit || 0;
        const avgMargin = profitResult?.avgMargin || 0;

        // 6. Top Products
        const { results: topProducts } = await context.env.DB.prepare(
            `SELECT p.name, SUM(si.quantity) as quantity 
             FROM sale_items si 
             JOIN products p ON si.productId = p.id 
             GROUP BY si.productId 
             ORDER BY quantity DESC 
             LIMIT 5`
        ).all();

        // 7. Payment Methods
        const { results: paymentMethods } = await context.env.DB.prepare(
            `SELECT paymentMethod as method, SUM(total) as total 
             FROM sales 
             GROUP BY paymentMethod`
        ).all();

        // 8. Category Sales
        const { results: categorySales } = await context.env.DB.prepare(
            `SELECT p.category, SUM(si.quantity * si.price) as total
             FROM sale_items si
             JOIN products p ON si.productId = p.id
             GROUP BY p.category
             ORDER BY total DESC
             LIMIT 5`
        ).all();

        return new Response(JSON.stringify({
            totalRevenue,
            numberOfSales,
            totalProfit,
            avgMargin,
            lowStockItems,
            salesLast7Days,
            topProducts: topProducts || [],
            paymentMethods: paymentMethods || [],
            categorySales: categorySales || []
        }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
