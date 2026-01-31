export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const { results } = await context.env.DB.prepare(
            "SELECT * FROM customers ORDER BY name ASC"
        ).all();

        const customers = results.map(c => ({
            ...c,
            // Mock isActive for frontend compatibility if needed, or just remove
            isActive: true
        }));

        return new Response(JSON.stringify(customers), {
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

        const customer = await context.request.json();
        const id = customer.id || Date.now().toString();

        await context.env.DB.prepare(
            `INSERT INTO customers (id, name, idDocument, phone, email, address) 
       VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
            id,
            customer.name,
            customer.idDocument || '',
            customer.phone || '',
            customer.email || '',
            customer.address || ''
        ).run();

        return new Response(JSON.stringify({ ...customer, id, userId: user.id, isActive: true }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
