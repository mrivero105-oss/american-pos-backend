export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.DB;
    const id = params.id;

    // PUT /purchase-orders/:id (General Update)
    if (request.method === "PUT") {
        try {
            const data = await request.json();
            const { supplierId, date, status, total, items } = data;

            await db.prepare(
                "UPDATE purchase_orders SET supplierId = ?, date = ?, status = ?, total = ?, items = ? WHERE id = ?"
            ).bind(supplierId, date, status, total, JSON.stringify(items), id).run();

            return new Response(JSON.stringify({ id, ...data }), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // Custom Actions via path not widely supported in pure REST without sub-resource, 
    // but typically we might use different method or path. 
    // However, for this simple [id].js, we handle basic CRUD. 
    // Specialized actions (receive, cancel) usually go to specialized endpoints 
    // like /purchase-orders/[id]/receive.js if using file-based routing strictly,
    // OR we inspect the URL if we capture specific paths.
    // Given Cloudflare Pages Functions routing:
    // functions/purchase-orders/[id].js handles /purchase-orders/:id

    // To handle /purchase-orders/:id/receive, we need a directory `functions/purchase-orders/[id]/receive.js`

    return new Response("Method not allowed", { status: 405 });
}
