export async function onRequestPost(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        const body = await context.request.json();

        // Check if already open
        const { results: openShifts } = await context.env.DB.prepare(
            "SELECT id FROM cash_shifts WHERE status = 'open'"
        ).all();

        if (openShifts.length > 0) {
            return new Response(JSON.stringify({ message: 'Ya hay una caja abierta' }), { status: 400 });
        }

        // Get userId from authenticated user - prioritize email for consistency
        const user = context.data?.user;
        const userId = user?.email || user?.uid || user?.sub || 'admin';

        console.log('🔍 Opening cash for userId:', userId, 'from JWT:', user);

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

export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        // Extract userId from JWT token - prioritize email for consistency
        const user = context.data?.user;
        const userId = user?.email || user?.uid || user?.sub || 'admin';

        console.log('🔍 Cash history for userId:', userId, 'from JWT:', user);

        // Get closed shifts for this specific user ONLY
        const { results: shifts } = await context.env.DB.prepare(
            `SELECT * FROM cash_shifts 
             WHERE status = 'closed' AND userId = ?
             ORDER BY closedAt DESC
             LIMIT 100`
        ).bind(userId).all();

        console.log(`✅ Returning ${shifts.length} shifts for user: ${userId}`);

        // Return plain array (remove debug wrapper to avoid cache issues)
        return new Response(JSON.stringify(shifts || []), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            }
        });

    } catch (err) {
        console.error('Error fetching cash history:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
