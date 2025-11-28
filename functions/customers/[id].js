export async function onRequestPut(context) {
    try {
        const id = context.params.id;
        const updates = await context.request.json();

        const keys = Object.keys(updates).filter(k => k !== 'id');
        if (keys.length === 0) return new Response("No updates provided", { status: 400 });

        const setClause = keys.map(k => `${k} = ?`).join(", ");
        const values = keys.map(k => updates[k]);
        values.push(id);

        const query = `UPDATE customers SET ${setClause} WHERE id = ?`;

        const info = await context.env.DB.prepare(query).bind(...values).run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Customer updated" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestDelete(context) {
    try {
        const id = context.params.id;
        const info = await context.env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(id).run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Customer deleted" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
