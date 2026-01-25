export async function onRequest(context) {
    const { request, env, params } = context;
    const db = env.DB;
    const id = params.id;

    // PUT /suppliers/:id
    if (request.method === "PUT") {
        try {
            const data = await request.json();
            const { name, contact, phone, email, address } = data;

            await db.prepare(
                "UPDATE suppliers SET name = ?, contact = ?, phone = ?, email = ?, address = ? WHERE id = ?"
            ).bind(name, contact, phone, email, address, id).run();

            return new Response(JSON.stringify({ id, ...data }), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // DELETE /suppliers/:id
    if (request.method === "DELETE") {
        try {
            await db.prepare("DELETE FROM suppliers WHERE id = ?").bind(id).run();
            return new Response(JSON.stringify({ message: "Deleted" }), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    return new Response("Method not allowed", { status: 405 });
}
