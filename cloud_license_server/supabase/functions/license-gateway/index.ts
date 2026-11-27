// Supabase Edge Function (Deno): Gateway de Validación y Suspensión de Licencias RSA-2048
// Variables de entorno requeridas en Supabase Secrets:
//   LICENSE_PRIVATE_KEY_PEM                 (Contenido completo PKCS#8 -----BEGIN PRIVATE KEY-----...)
//   LICENSE_PUBLIC_KEY_PEM                  (Opcional: Spki public key para verificar prueba RSA en auto-registro)
//   LICENSE_KEY_ID                          (Opcional: kid activo para rotación multi-llave, ej: "v2-primary")
//   ADMIN_EMAILS                            (Correos autorizados separados por coma)
//   ADMIN_API_SECRET                        (Opcional: secreto adicional para x-admin-secret)
//   ADMIN_ALLOWED_ORIGINS                   (Opcional: orígenes CORS separados por coma para /admin/*)
//   AUTO_REGISTER_ACTIVE                    ("true" por defecto; "false" para requerir alta previa manual)
//   REQUIRE_LICENSE_PROOF_ON_AUTOREGISTER   ("true" si LICENSE_PUBLIC_KEY_PEM está presente)
//   DEFAULT_GRACE_DAYS                      ("7" por defecto; soporta 0 para modo estrictamente online)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

function getSupabasePublicKey(): string {
    const legacy = Deno.env.get('SUPABASE_ANON_KEY');
    if (legacy) return legacy;
    try {
        const dict = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
        return String(dict['default'] || Object.values(dict)[0] || '');
    } catch {
        return '';
    }
}

function getSupabaseServiceKey(): string {
    const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (legacy) return legacy;
    try {
        const dict = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
        return String(dict['default'] || Object.values(dict)[0] || '');
    } catch {
        return '';
    }
}

function buildCorsHeaders(req: Request, isAdminRoute: boolean): Record<string, string> {
    const origin = req.headers.get('origin') || '';
    const allowedRaw = (Deno.env.get('ADMIN_ALLOWED_ORIGINS') || '').trim();
    let allowOrigin = '*';
    if (isAdminRoute) {
        if (allowedRaw) {
            const allowed = new Set(allowedRaw.split(',').map((o) => o.trim()).filter(Boolean));
            allowOrigin = origin && allowed.has(origin) ? origin : 'null';
        } else {
            // Fail-closed para /admin/* si ADMIN_ALLOWED_ORIGINS no fue definido: solo loopback local
            const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
            allowOrigin = isLocalOrigin ? origin : 'null';
        }
    }
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        ...(isAdminRoute ? { 'Cache-Control': 'no-store', 'Vary': 'Origin' } : {})
    };
}

function jsonResponse(body: unknown, status = 200, corsHeaders?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: corsHeaders || {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Content-Type': 'application/json; charset=utf-8'
        }
    });
}

function normalizeMachineId(value: unknown): string {
    return String(value ?? '').trim().toUpperCase().replace(/O/g, '0');
}

function parseGraceDays(rawValue: unknown, fallback = 7): number {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
        return fallback;
    }
    const num = Number(rawValue);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(365, Math.trunc(num)));
}

function parseExpirationMs(expValue: unknown): number | null {
    if (!expValue || expValue === 'never') return null;
    if (typeof expValue === 'number') return Number.isFinite(expValue) ? expValue : null;
    const numeric = Number(expValue);
    if (Number.isFinite(numeric)) return numeric;
    const parsedIso = Date.parse(String(expValue));
    return Number.isFinite(parsedIso) ? parsedIso : null;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const slice = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
    let clean = b64.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4 !== 0) clean += '=';
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function pemToDer(pemRaw: string, label: string): ArrayBuffer {
    const normalized = pemRaw.replace(/\\n/g, '\n');
    const clean = normalized
        .replace(new RegExp(`-----BEGIN ${label}-----`, 'g'), '')
        .replace(new RegExp(`-----END ${label}-----`, 'g'), '')
        .replace(/\s+/g, '');
    if (!clean) {
        throw new Error(`PEM inválido: se requiere ${label}.`);
    }
    const bytes = base64ToBytes(clean);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function importRsaSigningKey(): Promise<CryptoKey> {
    const pem = Deno.env.get('LICENSE_PRIVATE_KEY_PEM') || '';
    if (!pem.trim()) {
        throw new Error('Falta secret LICENSE_PRIVATE_KEY_PEM en la Edge Function.');
    }
    const der = pemToDer(pem, 'PRIVATE KEY');
    return crypto.subtle.importKey(
        'pkcs8',
        der,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
}

async function importRsaVerifyKey(): Promise<CryptoKey | null> {
    const pem = (Deno.env.get('LICENSE_PUBLIC_KEY_PEM') || '').trim();
    if (!pem) return null;
    const der = pemToDer(pem, 'PUBLIC KEY');
    return crypto.subtle.importKey(
        'spki',
        der,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );
}

async function verifyLicenseKeyProof(licenseKey: unknown, expectedMachineId: string): Promise<{ valid: boolean; expiresAtIso?: string | null; reason?: string }> {
    const verifyKey = await importRsaVerifyKey();
    if (!verifyKey) return { valid: true, expiresAtIso: null };
    if (!licenseKey || typeof licenseKey !== 'string') {
        return { valid: false, reason: 'Licencia RSA v2 requerida para auto-registrar este terminal.' };
    }
    try {
        const clean = licenseKey.trim();
        let payloadStr: string | null = null;
        let signatureB64: string | null = null;

        const fullDecoded = new TextDecoder().decode(base64ToBytes(clean));
        if (fullDecoded.includes('.') && fullDecoded.trim().startsWith('{')) {
            const idx = fullDecoded.lastIndexOf('.');
            payloadStr = fullDecoded.slice(0, idx);
            signatureB64 = fullDecoded.slice(idx + 1);
        } else if (clean.includes('.')) {
            const idx = clean.lastIndexOf('.');
            const p0 = clean.slice(0, idx);
            signatureB64 = clean.slice(idx + 1);
            payloadStr = p0.startsWith('{') ? p0 : new TextDecoder().decode(base64ToBytes(p0));
        }

        if (!payloadStr || !signatureB64) {
            return { valid: false, reason: 'Formato de licenseKey inválido.' };
        }

        const sigBytes = base64ToBytes(signatureB64);
        const ok = await crypto.subtle.verify(
            { name: 'RSASSA-PKCS1-v1_5' },
            verifyKey,
            sigBytes,
            new TextEncoder().encode(payloadStr)
        );
        if (!ok) {
            return { valid: false, reason: 'Firma RSA de licenseKey inválida.' };
        }

        const parsed = JSON.parse(payloadStr);
        if (Number(parsed.v || 1) !== 2) {
            return { valid: false, reason: 'Solo se permiten licencias RSA v2.' };
        }

        const normExpected = normalizeMachineId(expectedMachineId);
        const normKeyMid = normalizeMachineId(parsed.mid || parsed.hwid || '');
        const isMaster = parsed.master === true || normKeyMid === 'MASTER-UNLOCK';
        if (!isMaster && normKeyMid !== normExpected) {
            return { valid: false, reason: 'La licenseKey pertenece a otro terminal.' };
        }

        const expMs = parseExpirationMs(parsed.exp);
        if (expMs && Date.now() > expMs) {
            return { valid: false, reason: 'La licenseKey proporcionada ya expiró.' };
        }

        return { valid: true, expiresAtIso: expMs ? new Date(expMs).toISOString() : null };
    } catch {
        return { valid: false, reason: 'No se pudo validar la licenseKey RSA.' };
    }
}

async function signRemoteLease(params: {
    machineId: string;
    status: string;
    reason?: string | null;
    graceDays?: number;
    expiresAt?: string | null;
}): Promise<{ leaseToken: string; graceUntilIso: string; serverTimeMs: number }> {
    const signingKey = await importRsaSigningKey();
    const now = Date.now();
    const graceDays = parseGraceDays(params.graceDays, 7);
    const graceUntilMs = params.status === 'active'
        ? now + graceDays * 86400000
        : now;

    const payloadObj = {
        typ: 'license_lease',
        v: 2,
        kid: Deno.env.get('LICENSE_KEY_ID') || 'v2-primary',
        mid: String(params.machineId).trim(),
        status: String(params.status || 'active').toLowerCase(),
        reason: params.reason ? String(params.reason).slice(0, 300) : null,
        graceDays,
        iat: now,
        serverTime: now,
        graceUntil: graceUntilMs,
        exp: params.expiresAt || 'never'
    };

    const encoder = new TextEncoder();
    const payloadStr = JSON.stringify(payloadObj);
    const sigBuf = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        signingKey,
        encoder.encode(payloadStr)
    );
    const sigB64 = bytesToBase64(new Uint8Array(sigBuf));
    const envelopeBytes = encoder.encode(`${payloadStr}.${sigB64}`);
    return {
        leaseToken: bytesToBase64(envelopeBytes),
        graceUntilIso: new Date(graceUntilMs).toISOString(),
        serverTimeMs: now
    };
}

/**
 * Comparación en tiempo constante con digest SHA-256 previo para no filtrar longitud del secreto.
 */
async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
    if (!a || !b) return false;
    const encoder = new TextEncoder();
    const [hashA, hashB] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(a)),
        crypto.subtle.digest('SHA-256', encoder.encode(b))
    ]);
    const viewA = new Uint8Array(hashA);
    const viewB = new Uint8Array(hashB);
    let diff = 0;
    for (let i = 0; i < viewA.length; i++) {
        diff |= viewA[i] ^ viewB[i];
    }
    return diff === 0;
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxReq: number, windowMs: number): boolean {
    const now = Date.now();
    if (rateBuckets.size > 5000) {
        for (const [k, v] of rateBuckets.entries()) {
            if (v.resetAt <= now) rateBuckets.delete(k);
        }
    }
    const existing = rateBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
        rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }
    existing.count += 1;
    return existing.count <= maxReq;
}

function getAllowedAdminEmails(): Set<string> {
    const raw = Deno.env.get('ADMIN_EMAILS') || Deno.env.get('ADMIN_EMAIL') || '';
    return new Set(
        raw
            .split(',')
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
    );
}

function extractRoutePath(reqUrl: string): string {
    const pathname = new URL(reqUrl).pathname.replace(/\/+$/, '');
    const fnMarker = '/license-gateway';
    const idx = pathname.indexOf(fnMarker);
    if (idx !== -1) {
        const tail = pathname.slice(idx + fnMarker.length);
        return tail || '/';
    }
    return pathname || '/';
}

async function authorizeAdmin(req: Request, supabaseAdmin: ReturnType<typeof createClient>): Promise<{ ok: boolean; actor?: string; error?: string }> {
    const configuredSecret = (Deno.env.get('ADMIN_API_SECRET') || '').trim();
    const incomingSecret = (req.headers.get('x-admin-secret') || '').trim();
    if (configuredSecret && incomingSecret && (await timingSafeEqualStr(incomingSecret, configuredSecret))) {
        return { ok: true, actor: 'api_secret' };
    }

    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
        return { ok: false, error: 'Autenticación de proveedor requerida.' };
    }

    const jwt = authHeader.slice(7).trim();
    const { data, error } = await supabaseAdmin.auth.getUser(jwt);
    if (error || !data?.user?.email) {
        return { ok: false, error: 'Sesión inválida o expirada.' };
    }

    const email = data.user.email.toLowerCase();
    const allowed = getAllowedAdminEmails();
    if (allowed.size === 0 || !allowed.has(email)) {
        return { ok: false, error: 'Tu usuario no está autorizado en ADMIN_EMAILS para administrar licencias.' };
    }

    return { ok: true, actor: email };
}

Deno.serve(async (req: Request) => {
    const routePath = extractRoutePath(req.url);
    const isAdminRoute = routePath.startsWith('/admin/');
    const corsHeaders = buildCorsHeaders(req, isAdminRoute);

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = getSupabaseServiceKey();
    const anonKey = getSupabasePublicKey();

    if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: 'Configuración incompleta de Supabase en la Edge Function.' }, 500, corsHeaders);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false }
    });

    const clientIp = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

    try {
        // 1. Healthcheck público
        if (req.method === 'GET' && (routePath === '/' || routePath === '/health')) {
            return jsonResponse({
                ok: true,
                service: 'isaac-pos-license-gateway',
                runtime: 'supabase-edge',
                timestamp: new Date().toISOString()
            }, 200, corsHeaders);
        }

        // 2. Heartbeat público de terminales POS
        if (req.method === 'POST' && routePath === '/heartbeat') {
            const body = await req.json().catch(() => ({}));
            const rawMachineId = String(body?.machineId || '').trim().slice(0, 128);
            if (!rawMachineId) {
                return jsonResponse({ error: 'machineId requerido.' }, 400, corsHeaders);
            }

            const normId = normalizeMachineId(rawMachineId);
            const hbMax = parseGraceDays(Deno.env.get('HEARTBEAT_RATE_LIMIT_MAX'), 60) || 60;
            if (!checkRateLimit(`hb-ip:${clientIp}`, hbMax * 2, 60000) || !checkRateLimit(`hb:${clientIp}:${normId}`, hbMax, 60000)) {
                return jsonResponse({ error: 'Límite de heartbeats excedido. Intenta más tarde.' }, 429, corsHeaders);
            }

            const defaultGraceDays = parseGraceDays(Deno.env.get('DEFAULT_GRACE_DAYS'), 7);
            const autoRegister = (Deno.env.get('AUTO_REGISTER_ACTIVE') || 'true').toLowerCase() !== 'false';
            const requireProof = (Deno.env.get('REQUIRE_LICENSE_PROOF_ON_AUTOREGISTER') || 'true').toLowerCase() !== 'false';

            const { data: existing, error: fetchErr } = await supabaseAdmin
                .from('cloud_licenses')
                .select('*')
                .eq('machine_id_norm', normId)
                .maybeSingle();

            if (fetchErr) throw fetchErr;

            const nowIso = new Date().toISOString();
            let record = existing;

            if (!record) {
                if (!autoRegister) {
                    const deniedLease = await signRemoteLease({
                        machineId: rawMachineId,
                        status: 'suspended',
                        reason: 'Terminal no autorizada en el servidor central de licencias.',
                        graceDays: 0
                    });
                    return jsonResponse({
                        success: true,
                        registered: false,
                        status: 'suspended',
                        leaseToken: deniedLease.leaseToken
                    }, 200, corsHeaders);
                }

                let verifiedExpiresAt: string | null = null;
                if (requireProof) {
                    if (!(Deno.env.get('LICENSE_PUBLIC_KEY_PEM') || '').trim()) {
                        return jsonResponse({
                            error: 'Configuración incompleta del Gateway: LICENSE_PUBLIC_KEY_PEM es obligatorio cuando REQUIRE_LICENSE_PROOF_ON_AUTOREGISTER está habilitado.'
                        }, 503, corsHeaders);
                    }
                    const proof = await verifyLicenseKeyProof(body?.licenseKey, rawMachineId);
                    if (!proof.valid) {
                        return jsonResponse({
                            error: proof.reason || 'Licencia RSA v2 válida requerida para auto-registro.'
                        }, 403, corsHeaders);
                    }
                    verifiedExpiresAt = proof.expiresAtIso || null;
                }

                // Ignorar body.expiresAt arbitrario del cliente en auto-registro
                const initialGraceUntil = new Date(Date.now() + defaultGraceDays * 86400000).toISOString();
                const { data: inserted, error: insertErr } = await supabaseAdmin
                    .from('cloud_licenses')
                    .insert({
                        machine_id: rawMachineId,
                        machine_id_norm: normId,
                        customer_name: body?.businessName ? String(body.businessName).slice(0, 120) : null,
                        status: 'active',
                        grace_days: defaultGraceDays,
                        expires_at: verifiedExpiresAt,
                        app_version: body?.appVersion ? String(body.appVersion).slice(0, 40) : null,
                        server_machine_id: body?.serverMachineId ? String(body.serverMachineId).slice(0, 128) : null,
                        last_ip: clientIp,
                        last_seen_at: nowIso,
                        grace_until: initialGraceUntil
                    })
                    .select('*')
                    .single();

                if (insertErr) throw insertErr;
                record = inserted;

                await supabaseAdmin.from('cloud_license_events').insert({
                    machine_id_norm: normId,
                    event_type: 'auto_registered',
                    previous_status: null,
                    new_status: 'active',
                    actor: 'heartbeat',
                    ip_address: clientIp,
                    metadata: { appVersion: body?.appVersion || null, businessName: body?.businessName || null }
                });
            }

            let effectiveStatus = String(record.status || 'active').toLowerCase();
            let effectiveReason = record.suspend_reason;
            let graceDays = parseGraceDays(record.grace_days, defaultGraceDays);
            const expMs = parseExpirationMs(record.expires_at);
            if (expMs && Date.now() > expMs && effectiveStatus === 'active') {
                effectiveStatus = 'suspended';
                effectiveReason = 'Licencia expirada.';
                graceDays = 0;
                await supabaseAdmin.from('cloud_license_events').insert({
                    machine_id_norm: normId,
                    event_type: 'auto_expired',
                    previous_status: record.status,
                    new_status: 'suspended',
                    reason: effectiveReason,
                    actor: 'gateway',
                    ip_address: clientIp
                });
            }

            const signed = await signRemoteLease({
                machineId: rawMachineId,
                status: effectiveStatus,
                reason: effectiveReason,
                graceDays,
                expiresAt: record.expires_at
            });

            await supabaseAdmin
                .from('cloud_licenses')
                .update({
                    status: effectiveStatus,
                    suspend_reason: effectiveReason,
                    grace_days: graceDays,
                    last_seen_at: nowIso,
                    last_ip: clientIp || record.last_ip,
                    app_version: body?.appVersion ? String(body.appVersion).slice(0, 40) : record.app_version,
                    server_machine_id: body?.serverMachineId ? String(body.serverMachineId).slice(0, 128) : record.server_machine_id,
                    customer_name: record.customer_name || (body?.businessName ? String(body.businessName).slice(0, 120) : null),
                    grace_until: signed.graceUntilIso
                })
                .eq('machine_id_norm', normId);

            return jsonResponse({
                success: true,
                machineId: record.machine_id,
                status: effectiveStatus,
                reason: effectiveReason,
                graceDays,
                graceUntil: signed.graceUntilIso,
                leaseToken: signed.leaseToken
            }, 200, corsHeaders);
        }

        // 3. Login del Proveedor contra Supabase Auth
        if (req.method === 'POST' && routePath === '/admin/login') {
            if (!checkRateLimit(`login:${clientIp}`, 10, 15 * 60 * 1000)) {
                return jsonResponse({ error: 'Demasiados intentos de inicio de sesión. Intenta más tarde.' }, 429, corsHeaders);
            }
            if (!anonKey) {
                return jsonResponse({ error: 'Falta SUPABASE_ANON_KEY para autenticar usuarios.' }, 500, corsHeaders);
            }
            const body = await req.json().catch(() => ({}));
            const email = String(body?.email || '').trim().toLowerCase();
            const password = String(body?.password || '');

            if (!email || !password) {
                return jsonResponse({ error: 'Correo y contraseña requeridos.' }, 400, corsHeaders);
            }

            const allowed = getAllowedAdminEmails();
            if (allowed.size === 0 || !allowed.has(email)) {
                return jsonResponse({ error: 'Usuario no autorizado como proveedor de licencias.' }, 403, corsHeaders);
            }

            const supabaseAuth = createClient(supabaseUrl, anonKey, {
                auth: { persistSession: false }
            });
            const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
            if (error || !data?.session?.access_token) {
                return jsonResponse({ error: error?.message || 'Credenciales inválidas.' }, 401, corsHeaders);
            }

            return jsonResponse({
                success: true,
                token: data.session.access_token,
                email: data.user?.email || email
            }, 200, corsHeaders);
        }

        // 4. Rutas administrativas protegidas
        if (routePath.startsWith('/admin/')) {
            const auth = await authorizeAdmin(req, supabaseAdmin);
            if (!auth.ok) {
                return jsonResponse({ error: auth.error || 'No autorizado.' }, 401, corsHeaders);
            }

            if (req.method === 'GET' && routePath === '/admin/licenses') {
                const reqUrl = new URL(req.url);
                const statusParam = String(reqUrl.searchParams.get('status') || '').trim().toLowerCase();
                const searchParam = String(reqUrl.searchParams.get('q') || reqUrl.searchParams.get('search') || '').trim();
                const limit = Math.max(1, Math.min(500, Number.parseInt(reqUrl.searchParams.get('limit') || '200', 10) || 200));
                const offset = Math.max(0, Number.parseInt(reqUrl.searchParams.get('offset') || '0', 10) || 0);

                let query = supabaseAdmin
                    .from('cloud_licenses')
                    .select('*')
                    .order('updated_at', { ascending: false })
                    .range(offset, offset + limit - 1);

                if (statusParam && ['active', 'suspended', 'revoked'].includes(statusParam)) {
                    query = query.eq('status', statusParam);
                }
                if (searchParam) {
                    const safeSearch = searchParam.replace(/[,%()]/g, '');
                    if (safeSearch) {
                        query = query.or(`machine_id.ilike.%${safeSearch}%,customer_name.ilike.%${safeSearch}%`);
                    }
                }

                const { data, error } = await query;
                if (error) throw error;
                return jsonResponse({ success: true, licenses: data || [] }, 200, corsHeaders);
            }

            const eventsMatch = routePath.match(/^\/admin\/licenses\/([^/]+)\/events$/);
            if (req.method === 'GET' && eventsMatch) {
                const rawParamId = decodeURIComponent(eventsMatch[1]);
                const normId = normalizeMachineId(rawParamId);
                const { data, error } = await supabaseAdmin
                    .from('cloud_license_events')
                    .select('*')
                    .eq('machine_id_norm', normId)
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (error) throw error;
                return jsonResponse({ success: true, events: data || [] }, 200, corsHeaders);
            }

            if (req.method === 'POST' && routePath === '/admin/licenses') {
                const body = await req.json().catch(() => ({}));
                const rawMachineId = String(body?.machineId || '').trim().slice(0, 128);
                if (!rawMachineId) {
                    return jsonResponse({ error: 'machineId requerido.' }, 400, corsHeaders);
                }

                const normId = normalizeMachineId(rawMachineId);
                const status = ['active', 'suspended', 'revoked'].includes(String(body?.status || 'active').toLowerCase())
                    ? String(body.status).toLowerCase()
                    : 'active';
                const defaultGraceDays = parseGraceDays(Deno.env.get('DEFAULT_GRACE_DAYS'), 7);
                const graceDays = parseGraceDays(body?.graceDays, defaultGraceDays);

                const { data: upserted, error } = await supabaseAdmin
                    .from('cloud_licenses')
                    .upsert({
                        machine_id: rawMachineId,
                        machine_id_norm: normId,
                        customer_name: body?.customerName ? String(body.customerName).slice(0, 120) : null,
                        status,
                        suspend_reason: status === 'active' ? null : (body?.reason ? String(body.reason).slice(0, 300) : null),
                        grace_days: graceDays,
                        expires_at: body?.expiresAt || null,
                        notes: body?.notes ? String(body.notes).slice(0, 500) : null
                    }, { onConflict: 'machine_id_norm' })
                    .select('*')
                    .single();

                if (error) throw error;

                await supabaseAdmin.from('cloud_license_events').insert({
                    machine_id_norm: normId,
                    event_type: 'admin_upsert',
                    new_status: status,
                    reason: body?.reason || null,
                    actor: auth.actor,
                    ip_address: clientIp
                });

                return jsonResponse({ success: true, license: upserted }, 200, corsHeaders);
            }

            const statusMatch = routePath.match(/^\/admin\/licenses\/([^/]+)\/status$/);
            if (req.method === 'POST' && statusMatch) {
                const rawParamId = decodeURIComponent(statusMatch[1]);
                const normId = normalizeMachineId(rawParamId);
                const body = await req.json().catch(() => ({}));
                const nextStatus = String(body?.status || '').toLowerCase();

                if (!['active', 'suspended', 'revoked'].includes(nextStatus)) {
                    return jsonResponse({ error: 'Estado inválido. Use active, suspended o revoked.' }, 400, corsHeaders);
                }

                const { data: existing, error: findErr } = await supabaseAdmin
                    .from('cloud_licenses')
                    .select('*')
                    .eq('machine_id_norm', normId)
                    .maybeSingle();

                if (findErr) throw findErr;

                const cleanReason = nextStatus === 'active'
                    ? null
                    : (body?.reason
                        ? String(body.reason).slice(0, 300)
                        : (nextStatus === 'revoked' ? 'Licencia revocada por el proveedor.' : 'Licencia suspendida por el proveedor.'));

                let updated;
                if (!existing) {
                    const { data: created, error: createErr } = await supabaseAdmin
                        .from('cloud_licenses')
                        .insert({
                            machine_id: rawParamId,
                            machine_id_norm: normId,
                            status: nextStatus,
                            suspend_reason: cleanReason,
                            grace_days: parseGraceDays(Deno.env.get('DEFAULT_GRACE_DAYS'), 7)
                        })
                        .select('*')
                        .single();
                    if (createErr) throw createErr;
                    updated = created;
                } else {
                    const { data: saved, error: updErr } = await supabaseAdmin
                        .from('cloud_licenses')
                        .update({
                            status: nextStatus,
                            suspend_reason: cleanReason
                        })
                        .eq('machine_id_norm', normId)
                        .select('*')
                        .single();
                    if (updErr) throw updErr;
                    updated = saved;
                }

                await supabaseAdmin.from('cloud_license_events').insert({
                    machine_id_norm: normId,
                    event_type: 'status_change',
                    previous_status: existing?.status || null,
                    new_status: nextStatus,
                    reason: cleanReason,
                    actor: auth.actor,
                    ip_address: clientIp
                });

                return jsonResponse({ success: true, license: updated }, 200, corsHeaders);
            }
        }

        return jsonResponse({ error: 'Endpoint no encontrado en license-gateway.' }, 404, corsHeaders);
    } catch (err) {
        console.error('[license-gateway] Error:', err);
        return jsonResponse({ error: err instanceof Error ? err.message : 'Error interno del Gateway.' }, 500, corsHeaders);
    }
});
