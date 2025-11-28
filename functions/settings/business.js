export async function onRequestGet(context) {
    try {
        const result = await context.env.DB.prepare(
            "SELECT value FROM settings WHERE key = 'businessInfo'"
        ).first();

        return new Response(result?.value || '{}', {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestPost(context) {
    try {
        const info = await context.request.json();

        await context.env.DB.prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('businessInfo', ?)"
        ).bind(JSON.stringify(info)).run();

        return new Response(JSON.stringify({ message: "Business info updated" }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
