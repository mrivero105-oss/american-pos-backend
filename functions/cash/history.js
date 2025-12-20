export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        // Extract userId from JWT token (set by middleware)
        const userId = context.data?.user?.uid || context.data?.user?.email || 'admin';

        console.log('🔍 History request - User from JWT:', context.data?.user);
        console.log('🔍 Extracted userId:', userId);

        // TEMPORARY: Get ALL shifts to debug userId mismatch
        const { results: allShifts } = await context.env.DB.prepare(
            `SELECT * FROM cash_shifts 
             WHERE status = 'closed'
             ORDER BY closedAt DESC
             LIMIT 100`
        ).all();

        console.log('🔍 Sample userIds in database:', allShifts.slice(0, 5).map(s => s.userId));

        // Get filtered shifts for this user
        const { results: shifts } = await context.env.DB.prepare(
            `SELECT * FROM cash_shifts 
             WHERE status = 'closed' AND userId = ?
             ORDER BY closedAt DESC
             LIMIT 100`
        ).bind(userId).all();

        console.log(`🔍 Found ${shifts.length} shifts for userId: ${userId}`);
        console.log(`🔍 Total shifts in DB: ${allShifts.length}`);

        // TEMPORARY: Return debug info
        return new Response(JSON.stringify({
            debug: {
                requestedUserId: userId,
                jwtUser: context.data?.user,
                totalShiftsInDB: allShifts.length,
                shiftsForThisUser: shifts.length,
                sampleUserIdsInDB: allShifts.slice(0, 10).map(s => ({ id: s.id, userId: s.userId, date: s.closedAt }))
            },
            shifts: shifts
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error('Error fetching cash history:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
