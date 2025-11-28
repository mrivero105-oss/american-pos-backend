export async function onRequestPut(context) {
    try {
        const id = context.params.id;
        const updates = await context.request.json();

        // Construct dynamic update query
        const keys = Object.keys(updates).filter(k => k !== 'id');
        if (keys.length === 0) return new Response("No updates provided", { status: 400 });

        const setClause = keys.map(k => `${k} = ?`).join(", ");
        const values = keys.map(k => {
            if (k === 'isCustom') return updates[k] ? 1 : 0;
            return updates[k];
        });
        values.push(id);

        const query = `UPDATE products SET ${setClause} WHERE id = ?`;

        const info = await context.env.DB.prepare(query).bind(...values).run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Product updated" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Product not found" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestDelete(context) {
    try {
        const id = context.params.id;
        const info = await context.env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Product deleted" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Product not found" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
