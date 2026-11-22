const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { LicenseStore, normalizeMachineId } = require('./licenseStore');

function loadEnvFileIfPresent() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
            process.env[key] = val;
        }
    }
}

function resolvePrivateKeyPem(explicitPem) {
    if (explicitPem && String(explicitPem).includes('PRIVATE KEY')) {
        return String(explicitPem).replace(/\\n/g, '\n');
    }
    if (process.env.LICENSE_PRIVATE_KEY_PEM && process.env.LICENSE_PRIVATE_KEY_PEM.includes('PRIVATE KEY')) {
        return process.env.LICENSE_PRIVATE_KEY_PEM.replace(/\\n/g, '\n');
    }
    const keyFile = process.env.LICENSE_PRIVATE_KEY_FILE;
    if (keyFile && fs.existsSync(keyFile)) {
        return fs.readFileSync(keyFile, 'utf8');
    }
    throw new Error('Falta clave privada RSA (LICENSE_PRIVATE_KEY_PEM o LICENSE_PRIVATE_KEY_FILE).');
}

function resolvePublicKeyPem(explicitPem, privateKeyPem) {
    if (explicitPem && String(explicitPem).includes('PUBLIC KEY')) {
        return String(explicitPem).replace(/\\n/g, '\n');
    }
    if (process.env.LICENSE_PUBLIC_KEY_PEM && process.env.LICENSE_PUBLIC_KEY_PEM.includes('PUBLIC KEY')) {
        return process.env.LICENSE_PUBLIC_KEY_PEM.replace(/\\n/g, '\n');
    }
    const pubFile = process.env.LICENSE_PUBLIC_KEY_FILE;
    if (pubFile && fs.existsSync(pubFile)) {
        return fs.readFileSync(pubFile, 'utf8');
    }
    try {
        return crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });
    } catch (_) {
        return null;
    }
}

function parseGraceDays(rawValue, fallback = 7) {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
        return fallback;
    }
    const num = Number(rawValue);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(365, Math.trunc(num)));
}

function parseExpirationMs(expValue) {
    if (!expValue || expValue === 'never') return null;
    if (typeof expValue === 'number') return Number.isFinite(expValue) ? expValue : null;
    const num = Number(expValue);
    if (Number.isFinite(num)) return num;
    const parsedIso = Date.parse(String(expValue));
    return Number.isFinite(parsedIso) ? parsedIso : null;
}

function signRemoteLease({ machineId, status, reason = null, graceDays = 7, expiresAt = null, kid = null }, privateKeyPem) {
    const now = Date.now();
    const cleanGrace = parseGraceDays(graceDays, 7);
    // Modo online estricto (graceDays = 0) mientras la licencia está activa recibe ventana operativa de sesión online (5 min).
    const graceUntilMs = status === 'active'
        ? (cleanGrace > 0 ? now + cleanGrace * 86400000 : now + 5 * 60 * 1000)
        : now;

    const payloadObj = {
        typ: 'license_lease',
        v: 2,
        kid: String(kid || process.env.LICENSE_KEY_ID || 'v2-primary'),
        mid: String(machineId).trim(),
        status: String(status || 'active').toLowerCase(),
        reason: reason ? String(reason).slice(0, 300) : null,
        graceDays: cleanGrace,
        iat: now,
        serverTime: now,
        graceUntil: graceUntilMs,
        exp: expiresAt || 'never'
    };

    const payloadStr = JSON.stringify(payloadObj);
    const signatureB64 = crypto.sign('RSA-SHA256', Buffer.from(payloadStr, 'utf8'), privateKeyPem).toString('base64');
    return {
        leaseToken: Buffer.from(`${payloadStr}.${signatureB64}`, 'utf8').toString('base64'),
        graceUntilIso: new Date(graceUntilMs).toISOString(),
        serverTimeMs: now
    };
}

/**
 * Comparación en tiempo constante con SHA-256 previo para evitar filtración de longitud.
 */
function timingSafeEqualStr(a, b) {
    if (!a || !b) return false;
    const hashA = crypto.createHash('sha256').update(String(a), 'utf8').digest();
    const hashB = crypto.createHash('sha256').update(String(b), 'utf8').digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Crea un hash scrypt portable (`scrypt$<saltHex>$<hashHex>`).
 */
function hashAdminPasswordScrypt(plainPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(plainPassword), salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
}

function verifyAdminPassword(candidatePassword, configuredHash, configuredPlain, allowPlaintext = true) {
    const candidate = String(candidatePassword || '');
    if (!candidate) return false;

    if (configuredHash && String(configuredHash).startsWith('scrypt$')) {
        const parts = String(configuredHash).split('$');
        if (parts.length !== 3) return false;
        const [, saltHex, expectedHex] = parts;
        if (!saltHex || !expectedHex) return false;
        try {
            const derived = crypto.scryptSync(candidate, saltHex, 64);
            const expectedBuf = Buffer.from(expectedHex, 'hex');
            if (derived.length !== expectedBuf.length) return false;
            return crypto.timingSafeEqual(derived, expectedBuf);
        } catch (_) {
            return false;
        }
    }

    if (allowPlaintext && configuredPlain) {
        return timingSafeEqualStr(candidate, configuredPlain);
    }

    return false;
}

function verifyLicenseKeyProof(licenseKey, expectedMachineId, publicKeyPem) {
    if (!licenseKey || typeof licenseKey !== 'string' || !publicKeyPem) {
        return { valid: false, reason: 'Licencia local RSA requerida para auto-registro.' };
    }
    try {
        let payloadStr = null;
        let signatureB64 = null;
        const clean = licenseKey.trim();
        const decodedFull = Buffer.from(clean, 'base64').toString('utf8');
        if (decodedFull.includes('.') && decodedFull.trim().startsWith('{')) {
            const idx = decodedFull.lastIndexOf('.');
            payloadStr = decodedFull.slice(0, idx);
            signatureB64 = decodedFull.slice(idx + 1);
        } else if (clean.includes('.')) {
            const idx = clean.lastIndexOf('.');
            const p0 = clean.slice(0, idx);
            signatureB64 = clean.slice(idx + 1);
            payloadStr = p0.startsWith('{') ? p0 : Buffer.from(p0, 'base64').toString('utf8');
        }

        if (!payloadStr || !signatureB64) {
            return { valid: false, reason: 'Formato de licenseKey inválido.' };
        }

        const verified = crypto.verify(
            'RSA-SHA256',
            Buffer.from(payloadStr, 'utf8'),
            publicKeyPem,
            Buffer.from(signatureB64, 'base64')
        );
        if (!verified) {
            return { valid: false, reason: 'Firma RSA de licenseKey inválida.' };
        }

        const parsed = JSON.parse(payloadStr);
        if (Number(parsed.v || 1) !== 2) {
            return { valid: false, reason: 'Solo se aceptan licencias RSA v2.' };
        }

        const normExpected = normalizeMachineId(expectedMachineId);
        const normKeyMid = normalizeMachineId(parsed.mid || parsed.hwid || '');
        const isMaster = parsed.master === true || normKeyMid === 'MASTER-UNLOCK';
        if (!isMaster && normKeyMid !== normExpected) {
            return { valid: false, reason: 'El machineId de la licenseKey no coincide.' };
        }

        const expMs = parseExpirationMs(parsed.exp);
        if (expMs && Date.now() > expMs) {
            return { valid: false, reason: 'La licenseKey proporcionada ya expiró.' };
        }

        return {
            valid: true,
            expiresAtIso: expMs ? new Date(expMs).toISOString() : null
        };
    } catch (_) {
        return { valid: false, reason: 'No se pudo verificar la licenseKey RSA.' };
    }
}

function createMemoryRateLimiter({ windowMs, maxRequests }) {
    const hits = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, rec] of hits.entries()) {
            if (rec.resetAt <= now) hits.delete(k);
        }
    }, Math.min(windowMs, 60000));
    if (typeof timer.unref === 'function') timer.unref();

    return (key) => {
        const now = Date.now();
        const existing = hits.get(key);
        if (!existing || existing.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return { allowed: true, remaining: maxRequests - 1 };
        }
        existing.count += 1;
        if (existing.count > maxRequests) {
            return { allowed: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
        }
        return { allowed: true, remaining: maxRequests - existing.count };
    };
}

function signHs256Jwt(payloadObj, secret, expiresInSeconds = 12 * 3600) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const nowSec = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({
        ...payloadObj,
        iat: nowSec,
        exp: nowSec + expiresInSeconds
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function verifyHs256Jwt(token, secret) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    if (!timingSafeEqualStr(sig, expectedSig)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!parsed.exp || Math.floor(Date.now() / 1000) > parsed.exp) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

async function createLicenseGatewayApp(options = {}) {
    const store = options.store || new LicenseStore({
        databaseUrl: options.databaseUrl,
        jsonPath: options.jsonPath
    });
    if (!options.skipInit) {
        await store.init();
    }

    const privateKeyPem = resolvePrivateKeyPem(options.privateKeyPem);
    const publicKeyPem = resolvePublicKeyPem(options.publicKeyPem, privateKeyPem);
    const adminEmail = String(options.adminEmail ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    const adminPasswordHash = String(options.adminPasswordHash ?? process.env.ADMIN_PASSWORD_HASH ?? '').trim();
    const adminPasswordPlain = String(options.adminPassword ?? process.env.ADMIN_PASSWORD ?? '');
    const isProd = process.env.NODE_ENV === 'production';
    const allowPlaintextPassword = options.allowPlaintextPassword !== undefined
        ? Boolean(options.allowPlaintextPassword)
        : (!isProd || process.env.ALLOW_PLAINTEXT_ADMIN_PASSWORD === 'true');

    const rawJwtSecret = options.adminJwtSecret || process.env.ADMIN_JWT_SECRET || '';
    if (isProd && String(rawJwtSecret).trim().length < 32) {
        throw new Error('FATAL: ADMIN_JWT_SECRET (>=32 caracteres) es obligatorio en NODE_ENV=production.');
    }
    const jwtSecret = String(rawJwtSecret || crypto.randomBytes(32).toString('hex'));

    const adminApiSecret = String(options.adminApiSecret ?? process.env.ADMIN_API_SECRET ?? '').trim();
    const defaultGraceDays = parseGraceDays(options.defaultGraceDays ?? process.env.DEFAULT_GRACE_DAYS, 7);
    const autoRegisterActive = options.autoRegisterActive !== undefined
        ? Boolean(options.autoRegisterActive)
        : String(process.env.AUTO_REGISTER_ACTIVE || 'true').toLowerCase() !== 'false';
    const requireLicenseProofOnAutoRegister = options.requireLicenseProofOnAutoRegister !== undefined
        ? Boolean(options.requireLicenseProofOnAutoRegister)
        : String(process.env.REQUIRE_LICENSE_PROOF_ON_AUTOREGISTER || (publicKeyPem ? 'true' : 'false')).toLowerCase() === 'true';

    const allowedAdminOrigins = String(options.adminAllowedOrigins ?? process.env.ADMIN_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

    const heartbeatRateLimiter = createMemoryRateLimiter({
        windowMs: 60 * 1000,
        maxRequests: Math.max(5, Number(options.heartbeatRateLimitMax || process.env.HEARTBEAT_RATE_LIMIT_MAX || 60))
    });
    const loginRateLimiter = createMemoryRateLimiter({
        windowMs: 15 * 60 * 1000,
        maxRequests: Math.max(3, Number(options.adminLoginRateLimitMax || process.env.ADMIN_LOGIN_RATE_LIMIT_MAX || 10))
    });

    const app = express();
    app.set('trust proxy', 1);

    // Cabeceras defensivas (equivalente a helmet)
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-DNS-Prefetch-Control', 'off');
        if (req.path.startsWith('/admin')) {
            res.setHeader('Cache-Control', 'no-store');
        }
        next();
    });

    app.use('/admin', cors((req, cb) => {
        const origin = req.headers.origin;
        if (!origin) {
            return cb(null, { origin: false });
        }
        if (allowedAdminOrigins.length > 0) {
            if (allowedAdminOrigins.includes(origin)) {
                return cb(null, { origin: true, credentials: true });
            }
            return cb(new Error('CORS_ADMIN_ORIGIN_DENIED'));
        }
        // Fail-closed: si ADMIN_ALLOWED_ORIGINS no fue definido, aceptar solo loopback local (nunca cualquier origen de internet con credentials)
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
            return cb(null, { origin: true, credentials: true });
        }
        return cb(new Error('CORS_ADMIN_ORIGIN_DENIED'));
    }));
    app.use(['/', '/health', '/heartbeat'], cors());
    app.use(express.json({ limit: '256kb' }));

    const requireAdmin = (req, res, next) => {
        const incomingSecret = String(req.headers['x-admin-secret'] || '').trim();
        if (adminApiSecret && incomingSecret && timingSafeEqualStr(incomingSecret, adminApiSecret)) {
            req.adminActor = 'api_secret';
            return next();
        }

        const authHeader = String(req.headers.authorization || '');
        if (!authHeader.toLowerCase().startsWith('bearer ')) {
            return res.status(401).json({ error: 'Autenticación de proveedor requerida.' });
        }

        const token = authHeader.slice(7).trim();
        const decoded = verifyHs256Jwt(token, jwtSecret);
        if (!decoded || decoded.role !== 'license_provider') {
            return res.status(401).json({ error: 'Token de proveedor inválido o expirado.' });
        }

        req.adminActor = decoded.email || 'provider';
        next();
    };

    app.get(['/', '/health'], (req, res) => {
        res.json({
            ok: true,
            service: 'isaac-pos-license-gateway',
            runtime: 'node-express',
            timestamp: new Date().toISOString()
        });
    });

    app.post('/heartbeat', async (req, res) => {
        try {
            const rawMachineId = String(req.body?.machineId || '').trim().slice(0, 128);
            if (!rawMachineId) {
                return res.status(400).json({ error: 'machineId requerido.' });
            }

            const clientIp = (req.ip || req.connection?.remoteAddress || 'unknown').replace('::ffff:', '');
            const normRateMid = normalizeMachineId(rawMachineId);
            const ipRateCheck = heartbeatRateLimiter(`ip:${clientIp}`);
            if (!ipRateCheck.allowed) {
                res.setHeader('Retry-After', String(ipRateCheck.retryAfterSec));
                return res.status(429).json({ error: 'Límite de heartbeats por IP excedido. Intenta más tarde.' });
            }
            const rateCheck = heartbeatRateLimiter(`${clientIp}:${normRateMid}`);
            if (!rateCheck.allowed) {
                res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
                return res.status(429).json({ error: 'Límite de heartbeats excedido. Intenta más tarde.' });
            }

            let record = await store.findByMachineId(rawMachineId);

            if (!record) {
                if (!autoRegisterActive) {
                    const denied = signRemoteLease({
                        machineId: rawMachineId,
                        status: 'suspended',
                        reason: 'Terminal no autorizada en el servidor central de licencias.',
                        graceDays: 0
                    }, privateKeyPem);
                    return res.json({
                        success: true,
                        registered: false,
                        status: 'suspended',
                        leaseToken: denied.leaseToken
                    });
                }

                let verifiedExpiresAt = null;
                if (requireLicenseProofOnAutoRegister) {
                    if (!publicKeyPem) {
                        return res.status(503).json({
                            error: 'Configuración incompleta del Gateway: se requiere clave pública RSA para auto-registro.'
                        });
                    }
                    const proof = verifyLicenseKeyProof(req.body?.licenseKey, rawMachineId, publicKeyPem);
                    if (!proof.valid) {
                        return res.status(403).json({
                            error: proof.reason || 'Se requiere una licencia RSA v2 válida para auto-registrar este terminal.'
                        });
                    }
                    verifiedExpiresAt = proof.expiresAtIso;
                }

                // Seguridad: nunca aceptar body.expiresAt arbitrario del cliente en auto-registro
                const initialGraceUntil = new Date(Date.now() + defaultGraceDays * 86400000).toISOString();
                record = await store.upsertLicense({
                    machineId: rawMachineId,
                    customerName: req.body?.businessName ? String(req.body.businessName).slice(0, 120) : null,
                    status: 'active',
                    graceDays: defaultGraceDays,
                    expiresAt: verifiedExpiresAt,
                    appVersion: req.body?.appVersion ? String(req.body.appVersion).slice(0, 40) : null,
                    serverMachineId: req.body?.serverMachineId ? String(req.body.serverMachineId).slice(0, 128) : null,
                    lastIp: clientIp,
                    lastSeenAt: new Date().toISOString(),
                    graceUntil: initialGraceUntil
                });
                await store.appendEvent({
                    machineId: rawMachineId,
                    eventType: 'auto_registered',
                    newStatus: 'active',
                    actor: 'heartbeat',
                    ipAddress: clientIp
                });
            }

            // Validar expiración en servidor (expires_at) antes de emitir lease
            let effectiveStatus = String(record.status || 'active').toLowerCase();
            let effectiveReason = record.suspend_reason;
            let graceDays = parseGraceDays(record.grace_days, defaultGraceDays);
            const expMs = parseExpirationMs(record.expires_at);
            if (expMs && Date.now() > expMs && effectiveStatus === 'active') {
                effectiveStatus = 'suspended';
                effectiveReason = 'Licencia expirada.';
                graceDays = 0;
                await store.appendEvent({
                    machineId: rawMachineId,
                    eventType: 'auto_expired',
                    previousStatus: record.status,
                    newStatus: 'suspended',
                    reason: effectiveReason,
                    actor: 'gateway',
                    ipAddress: clientIp
                });
            }

            const signed = signRemoteLease({
                machineId: rawMachineId,
                status: effectiveStatus,
                reason: effectiveReason,
                graceDays,
                expiresAt: record.expires_at
            }, privateKeyPem);

            await store.upsertLicense({
                machineId: rawMachineId,
                customerName: record.customer_name || (req.body?.businessName ? String(req.body.businessName).slice(0, 120) : undefined),
                status: effectiveStatus,
                suspendReason: effectiveReason,
                graceDays,
                appVersion: req.body?.appVersion ? String(req.body.appVersion).slice(0, 40) : undefined,
                serverMachineId: req.body?.serverMachineId ? String(req.body.serverMachineId).slice(0, 128) : undefined,
                lastIp: clientIp,
                lastSeenAt: new Date().toISOString(),
                graceUntil: signed.graceUntilIso
            });

            res.json({
                success: true,
                machineId: record.machine_id,
                status: effectiveStatus,
                reason: effectiveReason,
                graceDays,
                graceUntil: signed.graceUntilIso,
                leaseToken: signed.leaseToken
            });
        } catch (err) {
            console.error('[LicenseGateway] Error interno:', err.message);
            res.status(500).json({ error: 'Error interno en License Gateway.' });
        }
    });

    app.post('/admin/login', (req, res) => {
        const clientIp = (req.ip || req.connection?.remoteAddress || 'unknown').replace('::ffff:', '');
        const loginRate = loginRateLimiter(clientIp);
        if (!loginRate.allowed) {
            res.setHeader('Retry-After', String(loginRate.retryAfterSec));
            return res.status(429).json({ error: 'Demasiados intentos de inicio de sesión. Intenta más tarde.' });
        }

        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');

        if (!adminEmail || (!adminPasswordHash && (!allowPlaintextPassword || !adminPasswordPlain))) {
            return res.status(503).json({
                error: 'ADMIN_EMAIL / ADMIN_PASSWORD_HASH no configurados correctamente en el Gateway.'
            });
        }
        if (
            !timingSafeEqualStr(email, adminEmail) ||
            !verifyAdminPassword(password, adminPasswordHash, adminPasswordPlain, allowPlaintextPassword)
        ) {
            return res.status(401).json({ error: 'Credenciales de proveedor inválidas.' });
        }

        const token = signHs256Jwt({ role: 'license_provider', email: adminEmail }, jwtSecret);
        res.json({ success: true, token, email: adminEmail });
    });

    app.get('/admin/licenses', requireAdmin, async (req, res) => {
        try {
            const licenses = await store.listAll({
                search: req.query.q || req.query.search,
                status: req.query.status,
                limit: req.query.limit,
                offset: req.query.offset
            });
            res.json({ success: true, licenses });
        } catch (err) {
            console.error('[LicenseGateway] Error interno:', err.message);
            res.status(500).json({ error: 'Error interno en License Gateway.' });
        }
    });

    app.get('/admin/licenses/:machineId/events', requireAdmin, async (req, res) => {
        try {
            const rawMachineId = String(req.params.machineId || '').trim().slice(0, 128);
            if (!rawMachineId) {
                return res.status(400).json({ error: 'machineId requerido.' });
            }
            const events = await store.listEvents(rawMachineId, req.query.limit);
            res.json({ success: true, events });
        } catch (err) {
            console.error('[LicenseGateway] Error interno:', err.message);
            res.status(500).json({ error: 'Error interno en License Gateway.' });
        }
    });

    app.post('/admin/licenses', requireAdmin, async (req, res) => {
        try {
            const rawMachineId = String(req.body?.machineId || '').trim().slice(0, 128);
            if (!rawMachineId) {
                return res.status(400).json({ error: 'machineId requerido.' });
            }
            const statusRaw = String(req.body?.status || 'active').toLowerCase();
            const status = ['active', 'suspended', 'revoked'].includes(statusRaw) ? statusRaw : 'active';
            const graceDays = parseGraceDays(req.body?.graceDays, defaultGraceDays);

            const saved = await store.upsertLicense({
                machineId: rawMachineId,
                customerName: req.body?.customerName ? String(req.body.customerName).slice(0, 120) : null,
                status,
                suspendReason: status === 'active' ? null : (req.body?.reason ? String(req.body.reason).slice(0, 300) : null),
                graceDays,
                expiresAt: req.body?.expiresAt || null,
                notes: req.body?.notes ? String(req.body.notes).slice(0, 500) : null
            });

            await store.appendEvent({
                machineId: rawMachineId,
                eventType: 'admin_upsert',
                newStatus: status,
                reason: req.body?.reason || null,
                actor: req.adminActor,
                ipAddress: req.ip
            });

            res.json({ success: true, license: saved });
        } catch (err) {
            console.error('[LicenseGateway] Error interno:', err.message);
            res.status(500).json({ error: 'Error interno en License Gateway.' });
        }
    });

    app.post('/admin/licenses/:machineId/status', requireAdmin, async (req, res) => {
        try {
            const rawMachineId = String(req.params.machineId || '').trim().slice(0, 128);
            if (!rawMachineId) {
                return res.status(400).json({ error: 'machineId requerido.' });
            }
            const nextStatus = String(req.body?.status || '').toLowerCase();
            if (!['active', 'suspended', 'revoked'].includes(nextStatus)) {
                return res.status(400).json({ error: 'Estado inválido. Use active, suspended o revoked.' });
            }

            const existing = await store.findByMachineId(rawMachineId);
            const cleanReason = nextStatus === 'active'
                ? null
                : (req.body?.reason
                    ? String(req.body.reason).slice(0, 300)
                    : (nextStatus === 'revoked' ? 'Licencia revocada por el proveedor.' : 'Licencia suspendida por el proveedor.'));

            const updated = await store.upsertLicense({
                machineId: existing?.machine_id || rawMachineId,
                status: nextStatus,
                suspendReason: cleanReason,
                graceDays: existing?.grace_days !== undefined ? existing.grace_days : defaultGraceDays
            });

            await store.appendEvent({
                machineId: rawMachineId,
                eventType: 'status_change',
                previousStatus: existing?.status || null,
                newStatus: nextStatus,
                reason: cleanReason,
                actor: req.adminActor,
                ipAddress: req.ip
            });

            res.json({ success: true, license: updated });
        } catch (err) {
            console.error('[LicenseGateway] Error interno:', err.message);
            res.status(500).json({ error: 'Error interno en License Gateway.' });
        }
    });

    app.use((err, req, res, _next) => {
        if (err && err.message === 'CORS_ADMIN_ORIGIN_DENIED') {
            return res.status(403).json({ error: 'Origen no autorizado para administración.' });
        }
        res.status(500).json({ error: 'Error interno en License Gateway.' });
    });

    return { app, store, normalizeMachineId };
}

if (require.main === module) {
    loadEnvFileIfPresent();
    const port = Number(process.env.PORT || 8787);
    createLicenseGatewayApp()
        .then(({ app }) => {
            app.listen(port, () => {
                console.log(`✅ Isaac POS License Gateway escuchando en http://0.0.0.0:${port}`);
            });
        })
        .catch((err) => {
            console.error('❌ Error fatal iniciando License Gateway:', err.message);
            process.exit(1);
        });
}

module.exports = {
    createLicenseGatewayApp,
    signRemoteLease,
    hashAdminPasswordScrypt,
    verifyAdminPassword,
    parseGraceDays
};
