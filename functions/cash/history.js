export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        // Extract userId from JWT token (set by middleware)
        const userId = context.data?.user?.uid || context.data?.user?.email || 'admin';

        // Get all closed shifts for this user, ordered by most recent first
        const { results: shifts } = await context.env.DB.prepare(
            `SELECT * FROM cash_shifts 
             WHERE status = 'closed' AND userId = ?
             ORDER BY closedAt DESC
             LIMIT 100`
        ).bind(userId).all();

        return new Response(JSON.stringify(shifts || []), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error('Error fetching cash history:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
