export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.DB;
    const id = params.id;

    if (request.method === "POST") {
        try {
            await db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").bind(id).run();
            return new Response(JSON.stringify({ message: "Order cancelled" }), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }
    return new Response("Method not allowed", { status: 405 });
}
