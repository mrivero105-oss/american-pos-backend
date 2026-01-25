
export async function onRequest(context) {
    const db = context.env.DB;

    try {
        const users = await db.prepare("SELECT id, email, name, role FROM users").all();

        const salesStats = await db.prepare(`
            SELECT userId, COUNT(*) as count 
            FROM sales 
            GROUP BY userId
        `).all();

        const salesNull = await db.prepare("SELECT COUNT(*) as count FROM sales WHERE userId IS NULL").first();

        const customersStats = await db.prepare(`
            SELECT userId, COUNT(*) as count 
            FROM customers 
            GROUP BY userId
        `).all();

        // INSPECT SCHEMA
        const { results: productSchema } = await db.prepare("PRAGMA table_info(products)").all();
        const { results: categorySample } = await db.prepare("SELECT DISTINCT category FROM products LIMIT 10").all();
        const purchaseOrdersSchema = await db.prepare("PRAGMA table_info(purchase_orders)").all();

        return new Response(JSON.stringify({
            users: users.results,
            schema: {
                products: productSchema,
                categorySample: categorySample,
                purchaseOrders: purchaseOrdersSchema.results
            },
            sales: {
                byUser: salesStats.results,
                nullCount: salesNull.count
            },
            customers: {
                byUser: customersStats.results
            }
        }, null, 2), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
    }
}
