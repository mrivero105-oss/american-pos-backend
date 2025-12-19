import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

export async function onRequestPost(context) {
    // Get JWT_SECRET from environment variable
    const JWT_SECRET = context.env.JWT_SECRET || "dev-fallback-key-change-in-prod";

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
            // Anti-timing attack: same delay as password verification
            await bcrypt.hash("dummy", BCRYPT_ROUNDS);
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
        }

        // Determine hash type and verify password
        const storedPassword = user.password;
        let isValidPassword = false;
        let needsMigration = false;

        if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$')) {
            // Bcrypt hash - verify directly
            isValidPassword = await bcrypt.compare(password, storedPassword);
        } else {
            // SHA-256 hash (legacy) - verify and mark for migration
            const hashHex = await sha256Hash(password);
            isValidPassword = hashHex === storedPassword;
            needsMigration = isValidPassword; // Only migrate if password is correct
        }

        if (!isValidPassword) {
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
        }

        // Migrate SHA-256 password to bcrypt if needed
        if (needsMigration) {
            const bcryptHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
            await context.env.DB.prepare(
                "UPDATE users SET password = ? WHERE id = ?"
            ).bind(bcryptHash, user.id).run();
            console.log(`Password migrated to bcrypt for user: ${email}`);
        }

        // Check account status
        if (user.status === 'blocked') {
            return new Response(JSON.stringify({ error: "Cuenta bloqueada. Contacte al administrador." }), { status: 403 });
        }

        // Check trial expiration
        if (user.trial_expires_at) {
            const now = Date.now();
            if (now > user.trial_expires_at) {
                return new Response(JSON.stringify({ error: "El periodo de prueba ha expirado." }), { status: 403 });
            }
        }

        const { password: _, ...userWithoutPassword } = user;

        // CREATE SIGNED JWT TOKEN
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
        console.error("Login error:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

// SHA-256 hash function (for legacy password verification)
async function sha256Hash(password) {
    const myText = new TextEncoder().encode(password);
    const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
    const hashArray = Array.from(new Uint8Array(myDigest));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// HMAC SHA-256 signing function for JWT
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
