export async function onRequestPut(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const id = context.params.id;
        const updates = await context.request.json();

        const keys = Object.keys(updates).filter(k => k !== 'id' && k !== 'userId'); // Prevent editing userId
        if (keys.length === 0) return new Response("No updates provided", { status: 400 });

        const setClause = keys.map(k => `${k} = ?`).join(", ");
        const values = keys.map(k => updates[k]);
        values.push(id);
        values.push(user.id); // Check ownership

        const query = `UPDATE customers SET ${setClause} WHERE id = ? AND userId = ?`;

        const info = await context.env.DB.prepare(query).bind(...values).run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Customer updated" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Customer not found or unauthorized" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestDelete(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const id = context.params.id;
        // Only delete if belongs to user
        const info = await context.env.DB.prepare("DELETE FROM customers WHERE id = ? AND userId = ?")
            .bind(id, user.id)
            .run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Customer deleted" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Customer not found or unauthorized" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
