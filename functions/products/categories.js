export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        // TEMPORARY: Bypass auth check for debugging
        // const user = context.data.user;
        // if (!user) {
        //     return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        // }

        // Get distinct categories from products table
        const { results } = await context.env.DB.prepare(
            `SELECT DISTINCT category, COUNT(*) as count 
       FROM products 
       WHERE category IS NOT NULL AND category != '' 
       GROUP BY category 
       ORDER BY category ASC`
        ).all();

        // Format response to match frontend expectations: { counts: { "Cat": 10 }, total: 100 }
        const counts = {};
        let total = 0;

        results.forEach(row => {
            if (row.category) {
                counts[row.category] = row.count;
                total += row.count;
            }
        });

        // Also get total regardless of category (in case of nulls, though query filters them)
        // actually easier to just sum the counts we found.

        return new Response(JSON.stringify({
            counts,
            total
        }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
