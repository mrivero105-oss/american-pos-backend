export async function onRequestGet(context) {
    try {
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

        // 4. Sales Last 7 Days (Simplified)
        // In a real app, we'd do a GROUP BY query here.
        // For now, let's return empty structure to match frontend expectation
        // or implement a basic query.

        // Let's try a basic GROUP BY if D1 supports it well (it uses SQLite, so yes)
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

        return new Response(JSON.stringify({
            totalRevenue,
            numberOfSales,
            lowStockItems,
            salesLast7Days
        }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
