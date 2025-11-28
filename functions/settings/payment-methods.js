export async function onRequestGet(context) {
    try {
        const { results } = await context.env.DB.prepare(
            "SELECT * FROM payment_methods"
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
        const { paymentMethods } = await context.request.json();

        const statements = [
            context.env.DB.prepare("DELETE FROM payment_methods")
        ];

        for (const pm of paymentMethods) {
            statements.push(context.env.DB.prepare(
                "INSERT INTO payment_methods (id, name, type) VALUES (?, ?, ?)"
            ).bind(pm.id, pm.name, pm.type));
        }

        await context.env.DB.batch(statements);

        return new Response(JSON.stringify({ message: "Payment methods updated" }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
