// X-Report (Corte X) - Current shift summary without closing
export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        // Get userId from authenticated user
        const user = context.data?.user;
        const userId = user?.id || user?.email || 'admin';

        // 1. Get Open Shift for THIS USER ONLY
        const { results: shifts } = await context.env.DB.prepare(
            "SELECT * FROM cash_shifts WHERE status = 'open' AND userId = ? LIMIT 1"
        ).bind(userId).all();

        const currentShift = shifts[0];

        if (!currentShift) {
            return new Response(JSON.stringify({ error: "No hay caja abierta" }), {
                status: 404,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2. Sum Sales since shift opened
        const salesQuery = await context.env.DB.prepare(
            "SELECT SUM(total) as totalSales, COUNT(*) as numSales FROM sales WHERE timestamp >= ? AND userId = ?"
        ).bind(currentShift.openedAt, userId).first();

        // 3. Sum Movements (In/Out)
        const movementsIn = await context.env.DB.prepare(
            "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'in'"
        ).bind(currentShift.id).first();

        const movementsOut = await context.env.DB.prepare(
            "SELECT SUM(amount) as total FROM cash_movements WHERE shiftId = ? AND type = 'out'"
        ).bind(currentShift.id).first();

        // 4. Get payment method breakdown
        const { results: paymentResults } = await context.env.DB.prepare(
            "SELECT paymentMethod, SUM(total) as total, COUNT(*) as count FROM sales WHERE timestamp >= ? AND userId = ? GROUP BY paymentMethod"
        ).bind(currentShift.openedAt, userId).all();

        // Transform array to object {method: amount} that frontend expects
        const paymentBreakdown = {};
        for (const row of paymentResults) {
            paymentBreakdown[row.paymentMethod || 'cash'] = row.total || 0;
        }

        const totalSales = salesQuery?.totalSales || 0;
        const numSales = salesQuery?.numSales || 0;
        const totalIn = movementsIn?.total || 0;
        const totalOut = movementsOut?.total || 0;
        const startingCash = currentShift.startingCash || 0;
        const expectedCash = startingCash + totalSales + totalIn - totalOut;

        return new Response(JSON.stringify({
            shiftId: currentShift.id,
            openedAt: currentShift.openedAt,
            openedBy: currentShift.userId,
            startingCash,
            totalSales,
            numSales,
            totalIn,
            totalOut,
            expectedCash,
            paymentBreakdown,
            generatedAt: new Date().toISOString()
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
