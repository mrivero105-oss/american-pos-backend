// Allowed origins for CORS
const ALLOWED_ORIGINS = [
    'https://american-pos.pages.dev',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:3000'
];

function getAllowedOrigin(request) {
    const origin = request.headers.get('Origin');
    if (ALLOWED_ORIGINS.includes(origin)) {
        return origin;
    }
    // For requests without Origin header (same-origin or non-browser)
    return ALLOWED_ORIGINS[0];
}

export async function onRequest(context) {
    const { request, next } = context;

    // Get JWT_SECRET from environment variable (CRITICAL: Set this in Cloudflare Dashboard)
    const JWT_SECRET = context.env.JWT_SECRET || "dev-fallback-key-change-in-prod";

    const allowedOrigin = getAllowedOrigin(request);

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": allowedOrigin,
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "86400",
            },
        });
    }

    // AUTHENTICATION
    // Skip auth for public endpoints and restoration tools
    const url = new URL(request.url);

    // Define truly public routes (no auth required at all)
    const isPublicRoute =
        // Root and HTML pages - frontend routes
        url.pathname === '/' ||
        url.pathname === '/login' ||
        url.pathname === '/dashboard' ||
        url.pathname === '/pos' ||
        url.pathname === '/history' ||
        url.pathname === '/recibo' ||
        url.pathname.startsWith('/reset-password') ||
        url.pathname.endsWith('.html') ||
        url.pathname.startsWith('/#') ||
        // Auth endpoints
        url.pathname.startsWith('/auth/login') ||
        url.pathname.startsWith('/auth/register') ||
        url.pathname.startsWith('/auth/reset-password') ||
        url.pathname.startsWith('/hello') ||
        url.pathname === '/inspect-schema' ||
        // Static resources - no auth required
        url.pathname === '/favicon.ico' ||
        url.pathname === '/manifest.json' ||
        url.pathname.startsWith('/assets/') ||
        url.pathname.startsWith('/css/') ||
        url.pathname.startsWith('/js/') ||
        url.pathname.startsWith('/product_images/') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.png') ||
        url.pathname.endsWith('.jpg') ||
        url.pathname.endsWith('.webp') ||
        url.pathname.endsWith('.svg') ||
        url.pathname.endsWith('.woff') ||
        url.pathname.endsWith('.woff2') ||
        url.pathname.endsWith('.ttf') ||
        url.pathname.endsWith('.otf') ||
        // Only GET requests to /products are public (listing products)
        (url.pathname === '/products' && request.method === 'GET') ||
        (url.pathname.startsWith('/products') && url.pathname.includes('categories') && request.method === 'GET');

    if (isPublicRoute) {
        return handleCors(await next(), allowedOrigin);
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: "Unauthorized: No token provided" }), {
            status: 401,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": allowedOrigin
            }
        });
    }

    const token = authHeader.split(' ')[1];

    // JWT Signature verification using HMAC SHA-256
    try {
        const [header, payload, signature] = token.split('.');
        if (!header || !payload || !signature) throw new Error("Invalid token format");

        const decodedPayload = JSON.parse(atob(payload));

        // Check token expiration
        if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error("Token expired");
        }

        // Verify signature
        const expectedSignature = await sign(header + "." + payload, JWT_SECRET);
        if (signature !== expectedSignature) {
            throw new Error("Invalid signature");
        }

        // Token valid, inject user into context
        context.data.user = decodedPayload;

    } catch (e) {
        return new Response(JSON.stringify({ error: "Unauthorized: " + e.message }), {
            status: 401,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": allowedOrigin
            }
        });
    }

    // Process request
    try {
        const response = await next();
        return handleCors(response, allowedOrigin);
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": allowedOrigin,
            },
        });
    }
}

function handleCors(response, allowedOrigin) {
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return newResponse;
}

// HMAC SHA-256 signing function
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
