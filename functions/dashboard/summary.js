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

        return new Response(JSON.stringify({
            totalRevenue,
            numberOfSales,
            lowStockItems,
            salesLast7Days,
            debug: {
                userId: user.id
            }
        }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
