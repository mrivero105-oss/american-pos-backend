export async function onRequestPost(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        const body = await context.request.json();
        const actualCash = parseFloat(body.actualCash) || 0;

        // Get userId from authenticated user (use id from JWT)
        const user = context.data?.user;
        const userId = user?.id || user?.email || 'admin';

        // Get current open shift for THIS USER ONLY
        const currentShift = await context.env.DB.prepare(
            "SELECT * FROM cash_shifts WHERE status = 'open' AND userId = ? LIMIT 1"
        ).bind(userId).first();

        if (!currentShift) {
            return new Response(JSON.stringify({ message: 'No hay caja abierta para cerrar' }), { status: 400 });
        }

        // Calculate totals
        const salesQuery = await context.env.DB.prepare(
            "SELECT SUM(total) as totalSales FROM sales WHERE timestamp >= ?"
        ).bind(currentShift.openedAt).first();

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
        const closedAt = new Date().toISOString();
        const difference = actualCash - expectedCash;

        await context.env.DB.prepare(
            `UPDATE cash_shifts 
         SET status = 'closed', closedAt = ?, actualCash = ?, expectedCash = ?, difference = ?
         WHERE id = ?`
        ).bind(
            closedAt,
            actualCash,
            expectedCash,
            difference,
            currentShift.id
        ).run();

        return new Response(JSON.stringify({
            ...currentShift,
            status: 'closed',
            closedAt,
            actualCash,
            expectedCash,
            difference
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
