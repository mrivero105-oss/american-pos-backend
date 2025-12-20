export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        // AUTH CHECK
        const user = context.data.user;
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        // Get distinct categories from products table
        const { results } = await context.env.DB.prepare(
            `SELECT DISTINCT category, COUNT(*) as count 
       FROM products 
       WHERE category IS NOT NULL AND category != '' 
       GROUP BY category 
       ORDER BY category ASC`
        ).all();

        // Format response
        const categories = results.map(row => ({
            name: row.category,
            count: row.count
        }));

        return new Response(JSON.stringify(categories), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
