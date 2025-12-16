const JWT_SECRET = "american-pos-secret-key-change-in-prod"; // In prod use env var

export async function onRequestPost(context) {
    try {
        const { email, password } = await context.request.json();

        if (!email || !password) {
            return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400 });
        }

        // Fetch user from D1
        const { results } = await context.env.DB.prepare(
            "SELECT * FROM users WHERE email = ?"
        ).bind(email).all();

        const user = results[0];

        if (!user) {
            // Anti-timing attack check
            await new Promise(r => setTimeout(r, 100));
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
        }

        // Verify password
        const myText = new TextEncoder().encode(password);
        const myDigest = await crypto.subtle.digest(
            { name: 'SHA-256' },
            myText
        );
        const hashArray = Array.from(new Uint8Array(myDigest));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (hashHex !== user.password) {
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
        }

        // Check Status
        if (user.status === 'blocked') {
            return new Response(JSON.stringify({ error: "Cuenta bloqueada. Contacte al administrador." }), { status: 403 });
        }

        // Check Trial
        if (user.trial_expires_at) {
            const now = Date.now();
            if (now > user.trial_expires_at) {
                return new Response(JSON.stringify({ error: "El periodo de prueba ha expirado." }), { status: 403 });
            }
        }

        const { password: _, ...userWithoutPassword } = user;

        // CREATE SIGNED TOKEN
        const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const payload = btoa(JSON.stringify({
            id: user.id,
            email: user.email,
            role: user.role || 'user',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
        })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

        const signature = await sign(header + "." + payload, JWT_SECRET);
        const token = `${header}.${payload}.${signature}`;

        return new Response(JSON.stringify({
            success: true,
            user: userWithoutPassword,
            token: token
        }), {
            headers: { "Content-Type": "application/json" },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

// Same simulated signing function as middleware
async function sign(message, secret) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(message)
    );
    return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
