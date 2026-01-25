export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const { results } = await context.env.DB.prepare(
            "SELECT * FROM sales ORDER BY timestamp DESC"
        ).all();

        const sales = [];
        for (const sale of results) {
            const { results: items } = await context.env.DB.prepare(
                "SELECT * FROM sale_items WHERE saleId = ?"
            ).bind(sale.id).all();
            sales.push({ ...sale, items });
        }

        return new Response(JSON.stringify(sales), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestPost(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const sale = await context.request.json();
        const id = sale.id || Date.now().toString();
        const timestamp = new Date().toISOString();

        const statements = [];

        // 1. Insert Sale 
        statements.push(context.env.DB.prepare(
            `INSERT INTO sales (id, timestamp, total, exchangeRate, paymentMethod, customerId) 
       VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
            id,
            timestamp,
            sale.total,
            sale.exchangeRate || 1.0,
            sale.paymentMethod || 'Efectivo',
            sale.customerId || null
        ));

        // 2. Insert Items and Update Stock
        for (const item of sale.items) {
            statements.push(context.env.DB.prepare(
                `INSERT INTO sale_items (saleId, productId, name, price, quantity) 
             VALUES (?, ?, ?, ?, ?)`
            ).bind(
                id,
                item.productId || item.id,
                item.name,
                item.price,
                item.quantity
            ));

            // Update Stock
            statements.push(context.env.DB.prepare(
                `UPDATE products SET stockQuantity = stockQuantity - ? WHERE id = ?`
            ).bind(item.quantity, item.productId || item.id));
        }

        // Execute all in batch
        await context.env.DB.batch(statements);

        return new Response(JSON.stringify({ ...sale, id, timestamp, userId: user.id }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
