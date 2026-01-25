export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // GET /purchase-orders
    if (request.method === "GET") {
        try {
            const { results } = await db.prepare("SELECT * FROM purchase_orders ORDER BY date DESC").all();
            return new Response(JSON.stringify(results), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // POST /purchase-orders
    if (request.method === "POST") {
        try {
            const data = await request.json();
            const { supplierId, date, status, total, items, userId } = data;

            if (!supplierId || !date || !total) {
                return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
            }

            const id = crypto.randomUUID();
            await db.prepare(
                "INSERT INTO purchase_orders (id, supplierId, date, status, total, items, userId) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).bind(id, supplierId, date, status || 'pending', total, JSON.stringify(items || []), userId || null).run();

            return new Response(JSON.stringify({ id, ...data }), {
                headers: { "Content-Type": "application/json" },
                status: 201
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    return new Response("Method not allowed", { status: 405 });
}
