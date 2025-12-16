export async function onRequestPut(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const id = context.params.id;
        const updates = await context.request.json();

        // Construct dynamic update query
        const keys = Object.keys(updates).filter(k => k !== 'id' && k !== 'userId');
        if (keys.length === 0) return new Response("No updates provided", { status: 400 });

        const setClause = keys.map(k => `${k} = ?`).join(", ");
        const values = keys.map(k => {
            if (k === 'isCustom' || k === 'isSoldByWeight') return updates[k] ? 1 : 0;
            return updates[k];
        });
        values.push(id);
        values.push(user.id); // Add userId for ownership check

        const query = `UPDATE products SET ${setClause} WHERE id = ? AND userId = ?`;

        const info = await context.env.DB.prepare(query).bind(...values).run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Product updated" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Product not found or unauthorized" }), { status: 404 });
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
        // Verify ownership
        const info = await context.env.DB.prepare("DELETE FROM products WHERE id = ? AND userId = ?")
            .bind(id, user.id)
            .run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Product deleted" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Product not found or unauthorized" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
