export async function onRequestGet(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Fetch top 10 selling products based on quantity in sale_items
        // We join sale_items with products to get product details
        const { results } = await context.env.DB.prepare(`
            SELECT 
                p.id, 
                p.name, 
                p.price, 
                p.priceBs, 
                p.imageUri, 
                p.stockQuantity as stock,
                SUM(si.quantity) as sold_count 
            FROM sale_items si
            JOIN products p ON si.productId = p.id
            GROUP BY p.id 
            ORDER BY sold_count DESC 
            LIMIT 10
        `).all();

        return new Response(JSON.stringify(results), {
            headers: {
                "Content-Type": "application/json",
                // Cache for 5 minutes since this data doesn't change rapidly and is heavy
                "Cache-Control": "public, max-age=300"
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
