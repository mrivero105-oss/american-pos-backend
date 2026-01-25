export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // GET /suppliers
    if (request.method === "GET") {
        try {
            const { results } = await db.prepare("SELECT * FROM suppliers ORDER BY name ASC").all();
            return new Response(JSON.stringify(results), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // POST /suppliers
    if (request.method === "POST") {
        try {
            const data = await request.json();
            const { name, contact, phone, email, address, userId } = data;

            if (!name) {
                return new Response(JSON.stringify({ error: "Name is required" }), { status: 400 });
            }

            const id = crypto.randomUUID();
            await db.prepare(
                "INSERT INTO suppliers (id, name, contact, phone, email, address, userId) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).bind(id, name, contact || null, phone || null, email || null, address || null, userId || null).run();

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
