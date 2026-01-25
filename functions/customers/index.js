export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const { results } = await context.env.DB.prepare(
            "SELECT * FROM customers WHERE userId = ? ORDER BY name ASC"
        ).bind(user.id).all();

        const customers = results.map(c => ({
            ...c,
            isActive: c.isActive === 1 || c.isActive === true || c.isActive === undefined // Handle legacy null as active
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
            `INSERT INTO customers (id, name, idDocument, phone, email, address, userId, isActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            id,
            customer.name,
            customer.idDocument || '',
            customer.phone || '',
            customer.email || '',
            customer.address || '',
            user.id,
            customer.isActive !== false ? 1 : 0
        ).run();

        return new Response(JSON.stringify({ ...customer, id, userId: user.id, isActive: true }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
