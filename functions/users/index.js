import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user || user.role !== 'admin') {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
        }

        const { results } = await context.env.DB.prepare(
            "SELECT id, email, role, businessInfo FROM users ORDER BY email ASC"
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
        const user = context.data.user;
        if (!user || user.role !== 'admin') {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
        }

        const newUser = await context.request.json();

        if (!newUser.email || !newUser.password) {
            return new Response(JSON.stringify({ error: "Email and password required" }), { status: 400 });
        }

        // Hash password with bcrypt (secure)
        const hashedPassword = await bcrypt.hash(newUser.password, BCRYPT_ROUNDS);

        const id = crypto.randomUUID();

        await context.env.DB.prepare(
            `INSERT INTO users (id, email, password, role, businessInfo) 
             VALUES (?, ?, ?, ?, ?)`
        ).bind(
            id,
            newUser.email,
            hashedPassword,
            newUser.role || 'user',
            JSON.stringify(newUser.businessInfo || { currency: 'USD' })
        ).run();

        return new Response(JSON.stringify({ success: true, id }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
