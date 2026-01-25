export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const url = new URL(context.request.url);
        const range = url.searchParams.get('range');
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');

        let dateCondition = "";
        let params = [];

        if (startDate && endDate) {
            dateCondition = "AND date(s.timestamp) BETWEEN ? AND ?";
            params.push(startDate, endDate);
        } else if (range) {
            const now = new Date();
            if (range === 'day') {
                const today = now.toISOString().split('T')[0];
                dateCondition = "AND date(s.timestamp) = ?";
                params.push(today);
            } else if (range === 'week') {
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                dateCondition = "AND date(s.timestamp) >= ?";
                params.push(weekAgo.toISOString().split('T')[0]);
            } else if (range === 'month') {
                const monthStr = now.toISOString().slice(0, 7);
                dateCondition = "AND strftime('%Y-%m', s.timestamp) = ?";
                params.push(monthStr);
            } else {
                // Default to today if range is weird
                const today = now.toISOString().split('T')[0];
                dateCondition = "AND date(s.timestamp) = ?";
                params.push(today);
            }
        } else {
            // Default to today
            const today = new Date().toISOString().split('T')[0];
            dateCondition = "AND date(s.timestamp) = ?";
            params.push(today);
        }

        // 1. Calculate Revenue (Sum of sales totals)
        // We do this separately because joining items might multiply sale totals if we aren't careful, 
        // OR we can trust the 'total' column in sales.
        const revenueQuery = `SELECT COUNT(*) as count, SUM(total) as revenue FROM sales s WHERE 1=1 ${dateCondition}`;
        const revenueResult = await context.env.DB.prepare(revenueQuery).bind(...params).first();

        const salesCount = revenueResult?.count || 0;
        const totalRevenue = revenueResult?.revenue || 0;

        // 2. Calculate Cost (Sum of item quantity * product cost)
        // We join sales -> sale_items -> products
        // Note: products table has 'cost' column
        // We reuse the same dateCondition on table 's'
        const costQuery = `
            SELECT SUM(si.quantity * COALESCE(p.cost, 0)) as totalCost, COUNT(si.id) as productCount
            FROM sales s
            JOIN sale_items si ON s.id = si.saleId
            LEFT JOIN products p ON si.productId = p.id
            WHERE 1=1 ${dateCondition}
        `;

        const costResult = await context.env.DB.prepare(costQuery).bind(...params).first();
        const totalCost = costResult?.totalCost || 0;
        const productCount = costResult?.productCount || 0;

        const totalProfit = totalRevenue - totalCost;
        // Markup: (Profit / Cost) * 100
        const margin = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

        return new Response(JSON.stringify({
            profit: parseFloat(totalProfit.toFixed(2)),
            revenue: parseFloat(totalRevenue.toFixed(2)),
            cost: parseFloat(totalCost.toFixed(2)),
            margin: parseFloat(margin.toFixed(2)),
            productCount: productCount,
            salesCount: salesCount
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
