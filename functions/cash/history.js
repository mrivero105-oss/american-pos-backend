export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        // Extract userId from JWT token (use id field)
        const user = context.data?.user;
        const userId = user?.id || user?.email || 'admin';

        console.log('🔍 Cash history for userId:', userId, 'from JWT:', user);

        // Get closed shifts for this specific user ONLY
        const { results: shifts } = await context.env.DB.prepare(
            `SELECT * FROM cash_shifts 
             WHERE status = 'closed' AND userId = ?
             ORDER BY closedAt DESC
             LIMIT 100`
        ).bind(userId).all();

        console.log(`✅ Returning ${shifts.length} shifts for user: ${userId}`);

        // Return plain array (NO debug wrapper to avoid cache issues)
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
