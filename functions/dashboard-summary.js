export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        // 1. Total Revenue
        const revenueResult = await context.env.DB.prepare(
            "SELECT SUM(total) as totalRevenue FROM sales WHERE userId = ?"
        ).bind(user.id).first();
        const totalRevenue = revenueResult?.totalRevenue || 0;

        // 2. Number of Sales
        const countResult = await context.env.DB.prepare(
            "SELECT COUNT(*) as count FROM sales WHERE userId = ?"
        ).bind(user.id).first();
        const numberOfSales = countResult?.count || 0;

        // 3. Low Stock Items
        const { results: lowStockItems } = await context.env.DB.prepare(
            "SELECT name, stock FROM products WHERE stock <= 5 AND userId = ?"
        ).bind(user.id).all();

        // 4. Sales Last 7 Days
        const { results: salesTrend } = await context.env.DB.prepare(
            `SELECT date(timestamp) as date, SUM(total) as total 
         FROM sales 
         WHERE timestamp >= date('now', '-7 days') AND userId = ?
         GROUP BY date(timestamp) 
         ORDER BY date ASC`
        ).bind(user.id).all();

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
