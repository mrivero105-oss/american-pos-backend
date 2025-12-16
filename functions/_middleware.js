const JWT_SECRET = "american-pos-secret-key-change-in-prod"; // In prod use env var

export async function onRequest(context) {
    const { request, next } = context;

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "86400",
            },
        });
    }

    // AUTHENTICATION
    // Skip auth for public endpoints and restoration tools
    const url = new URL(request.url);
    if (url.pathname.startsWith('/auth/') ||
        url.pathname.startsWith('/restore-settings')) {
        return handleCors(await next());
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: "Unauthorized: No token provided" }), {
            status: 401,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }

    const token = authHeader.split(' ')[1];

    // Simple signature verification (Simulated for this environment without crypto libs)
    // In production, use jose or jsonwebtoken
    try {
        const [header, payload, signature] = token.split('.');
        if (!header || !payload || !signature) throw new Error("Invalid token format");

        const decodedPayload = JSON.parse(atob(payload));

        // Verify signature (Simulated match with login.js)
        const expectedSignature = await sign(header + "." + payload, JWT_SECRET);
        if (signature !== expectedSignature) {
            throw new Error("Invalid signature");
        }

        // Token valid, inject user into context
        context.data.user = decodedPayload;

    } catch (e) {
        return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
            status: 401,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }

    // Process request
    try {
        const response = await next();
        return handleCors(response);
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }
}

function handleCors(response) {
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Access-Control-Allow-Origin", "*");
    newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return newResponse;
}

// Simple HMAC SHA-256 for basic signature simulation
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
