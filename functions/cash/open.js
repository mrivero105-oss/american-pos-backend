export async function onRequestPost(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        const body = await context.request.json();

        // Get userId from authenticated user (use id from JWT)
        const user = context.data?.user;
        const userId = user?.id || user?.email || 'admin';

        console.log('🔍 Opening cash for userId:', userId, 'from JWT:', user);

        // Check if THIS USER already has an open shift
        const { results: openShifts } = await context.env.DB.prepare(
            "SELECT id FROM cash_shifts WHERE status = 'open' AND userId = ?"
        ).bind(userId).all();

        if (openShifts.length > 0) {
            return new Response(JSON.stringify({
                message: `Ya tienes una caja abierta (userId: ${userId})`
            }), { status: 400 });
        }

        const newShift = {
            id: Date.now().toString(),
            openedAt: new Date().toISOString(),
            startingCash: parseFloat(body.amount) || 0,
            userId: userId,
            status: 'open'
        };

        await context.env.DB.prepare(
            `INSERT INTO cash_shifts (id, openedAt, startingCash, userId, status, expectedCash, actualCash) 
         VALUES (?, ?, ?, ?, 'open', 0, 0)`
        ).bind(
            newShift.id,
            newShift.openedAt,
            newShift.startingCash,
            newShift.userId
        ).run();

        return new Response(JSON.stringify(newShift), {
            status: 201,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
