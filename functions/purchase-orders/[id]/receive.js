export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.DB;
    const id = params.id;

    if (request.method === "POST") {
        try {
            // Transaction: Update Order Status -> Add Stock
            // Note: D1 doesn't support full transactions in the same way, but batching helps.
            // Simplified logic:

            // 1. Get Order
            const order = await db.prepare("SELECT * FROM purchase_orders WHERE id = ?").bind(id).first();
            if (!order) return new Response("Order not found", { status: 404 });

            if (order.status === 'completed') {
                return new Response(JSON.stringify({ message: "Order already received" }), { status: 400 });
            }

            const items = JSON.parse(order.items || "[]");

            // 2. Update Products Stock
            const stmts = [];
            for (const item of items) {
                // Assuming item has productId and quantity
                if (item.productId && item.quantity) {
                    stmts.push(
                        db.prepare("UPDATE products SET stockQuantity = stockQuantity + ? WHERE id = ?")
                            .bind(item.quantity, item.productId)
                    );
                }
            }

            // 3. Update Order Status
            stmts.push(
                db.prepare("UPDATE purchase_orders SET status = 'completed' WHERE id = ?").bind(id)
            );

            await db.batch(stmts);

            return new Response(JSON.stringify({ message: "Order received and stock updated" }), {
                headers: { "Content-Type": "application/json" }
            });

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }
    return new Response("Method not allowed", { status: 405 });
}
