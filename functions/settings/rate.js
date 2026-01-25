export async function onRequestGet(context) {
    try {
        const result = await context.env.DB.prepare(
            "SELECT value FROM settings WHERE key = 'exchangeRate'"
        ).first();

        return new Response(JSON.stringify({ rate: parseFloat(result?.value || 1.0) }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestPost(context) {
    try {
        const { rate } = await context.request.json();

        await context.env.DB.prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('exchangeRate', ?)"
        ).bind(String(rate)).run();

        return new Response(JSON.stringify({ message: "Rate updated" }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
