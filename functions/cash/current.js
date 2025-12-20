export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        // Get userId from authenticated user (use id from JWT)
        const user = context.data?.user;
        const userId = user?.id || user?.email || 'admin';

        // 1. Get Open Shift for THIS USER ONLY
        const { results: shifts } = await context.env.DB.prepare(
            "SELECT * FROM cash_shifts WHERE status = 'open' AND userId = ? LIMIT 1"
        ).bind(userId).all();

        const currentShift = shifts[0];

        if (!currentShift) {
            return new Response(JSON.stringify(null), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2. Calculate Totals (Sales, In, Out)
        // For sales, we need to sum up sales that happened after openedAt
        // Note: This is an approximation. Ideally we link sales to shiftId if possible, 
        // or rely on timestamp.

        // Sum Sales
        const salesQuery = await context.env.DB.prepare(
            "SELECT SUM(total) as totalSales FROM sales WHERE timestamp >= ?"
        ).bind(currentShift.openedAt).first();

        // Sum Movements (In/Out)
        const movementsIn = await context.env.DB.prepare(
            "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'in'"
        ).bind(currentShift.id).first();

        const movementsOut = await context.env.DB.prepare(
            "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'out'"
        ).bind(currentShift.id).first();

        const totalSales = salesQuery.totalSales || 0;
        const totalIn = movementsIn.total || 0;
        const totalOut = movementsOut.total || 0;

        const expectedCash = (currentShift.startingCash || 0) + totalSales + totalIn - totalOut;

        return new Response(JSON.stringify({
            ...currentShift,
            totalSales,
            totalIn,
            totalOut,
            expectedCash
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
