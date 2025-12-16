export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const result = await context.env.DB.prepare(
            "SELECT businessInfo FROM users WHERE id = ?"
        ).bind(user.id).first();

        // Check if result.businessInfo is string stringified JSON or object. 
        // D1 usually returns it as stored string unless parsed layer exists. 
        // Based on restore-script it is stored as JSON string.
        let info = {};
        if (result && result.businessInfo) {
            try {
                info = JSON.parse(result.businessInfo);
            } catch (e) {
                info = result.businessInfo; // Fallback
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
            "UPDATE users SET businessInfo = ? WHERE id = ?"
        ).bind(JSON.stringify(info), user.id).run();

        return new Response(JSON.stringify({ message: "Business info updated" }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
