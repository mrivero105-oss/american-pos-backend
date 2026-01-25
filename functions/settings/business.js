export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const result = await context.env.DB.prepare(
            "SELECT value FROM settings WHERE key = 'businessInfo'"
        ).first();

        let info = {};
        if (result && result.value) {
            try {
                info = JSON.parse(result.value);
            } catch (e) {
                info = {};
            }
        }

        return new Response(JSON.stringify(info), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestPost(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response("Unauthorized", { status: 401 });

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
