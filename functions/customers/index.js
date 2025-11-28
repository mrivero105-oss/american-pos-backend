export async function onRequestGet(context) {
    try {
        const { results } = await context.env.DB.prepare(
            "SELECT * FROM customers ORDER BY name ASC"
        ).all();

        return new Response(JSON.stringify(results), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestPost(context) {
    try {
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

        return new Response(JSON.stringify({ ...customer, id }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
