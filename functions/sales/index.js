export async function onRequestGet(context) {
    try {
        const { results } = await context.env.DB.prepare(
            "SELECT * FROM sales ORDER BY timestamp DESC"
        ).all();

        // For each sale, we might want to fetch items, but for the main list 
        // usually just the summary is enough or we do a JOIN.
        // For simplicity/performance matching existing behavior, we might need to fetch items 
        // if the frontend expects them embedded.
        // The existing backend returns the full object.
        // Let's do a separate query for items if needed, or just return sales for now.
        // To match existing behavior exactly, we should probably fetch items.

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
                item.productId || item.id, // Handle both formats
                item.name,
                item.price,
                item.quantity
            ));

            // Update Stock
            if (item.productId || item.id) {
                statements.push(context.env.DB.prepare(
                    `UPDATE products SET stockQuantity = stockQuantity - ? WHERE id = ?`
                ).bind(item.quantity, item.productId || item.id));
            }
        }

        // Execute all in batch
        await context.env.DB.batch(statements);

        return new Response(JSON.stringify({ ...sale, id, timestamp }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
