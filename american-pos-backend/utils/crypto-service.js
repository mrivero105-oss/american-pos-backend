const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function normalizePem(raw) {
    return String(raw || '').replace(/\\n/g, '\n').trim();
}

class CryptoService {
    constructor() {
        this.publicKey = null;
        this.keyRing = {};
        try {
            const keysDir = path.join(__dirname, 'keys');
            const defaultPubPath = path.join(keysDir, 'public.pem');
            if (fs.existsSync(defaultPubPath)) {
                this.publicKey = fs.readFileSync(defaultPubPath, 'utf8');
                this.keyRing.default = this.publicKey;
                this.keyRing['v2-primary'] = this.publicKey;
            }
            if (fs.existsSync(keysDir)) {
                for (const file of fs.readdirSync(keysDir)) {
                    const m = file.match(/^public\.([a-zA-Z0-9_-]+)\.pem$/);
                    if (m) {
                        this.keyRing[m[1]] = fs.readFileSync(path.join(keysDir, file), 'utf8');
                    }
                }
            }
        } catch (e) {
            console.warn('[Security] Llave publica no encontrada en utils/keys/public.pem. Validación RSA fallará en clientes que no la instalen.');
        }
    }

    getPublicKey(kid = null) {
        const ring = this.getPublicKeyRing();
        if (kid && ring[kid]) {
            return ring[kid];
        }
        const envPem = normalizePem(process.env.LICENSE_PUBLIC_KEY_PEM);
        return envPem || this.publicKey || Object.values(ring)[0] || null;
    }

    getPublicKeyRing() {
        const ring = { ...this.keyRing };
        const envJson = process.env.LICENSE_PUBLIC_KEYS_JSON;
        if (envJson && typeof envJson === 'string') {
            try {
                const parsed = JSON.parse(envJson);
                if (parsed && typeof parsed === 'object') {
                    for (const [kid, pem] of Object.entries(parsed)) {
                        const clean = normalizePem(pem);
                        if (clean.includes('PUBLIC KEY')) {
                            ring[kid] = clean;
                        }
                    }
                }
            } catch (_) {}
        }
        const envPem = normalizePem(process.env.LICENSE_PUBLIC_KEY_PEM);
        if (envPem) {
            const activeKid = String(process.env.LICENSE_KEY_ID || 'v2-primary').trim();
            ring.default = envPem;
            ring[activeKid] = envPem;
        }
        return ring;
    }

    /**
     * Valida la firma del payload de la licencia.
     * Soporta rotación multi-llave vía kid y bloquea downgrade a HMAC v1 por defecto.
     */
    verifyLicenseSignature(payload, signature, version = 2, kid = null) {
        try {
            const parsedVersion = Number(version);
            if (parsedVersion === 2) {
                const ring = this.getPublicKeyRing();
                const candidatePems = [];
                if (kid && ring[kid]) {
                    candidatePems.push(ring[kid]);
                }
                const primary = this.getPublicKey();
                if (primary && !candidatePems.includes(primary)) {
                    candidatePems.push(primary);
                }
                for (const pem of Object.values(ring)) {
                    if (pem && !candidatePems.includes(pem)) {
                        candidatePems.push(pem);
                    }
                }

                if (candidatePems.length === 0) throw new Error('PUBLIC_KEY_MISSING');
                if (!signature || typeof signature !== 'string') {
                    return { isValid: false, requiresUpgrade: false };
                }

                const payloadBuf = Buffer.from(payload, 'utf8');
                const sigBuf = Buffer.from(signature, 'base64');
                for (const publicKey of candidatePems) {
                    try {
                        const isVerified = crypto.verify('RSA-SHA256', payloadBuf, publicKey, sigBuf);
                        if (isVerified) {
                            return { isValid: true, requiresUpgrade: false };
                        }
                    } catch (_) {}
                }
                return { isValid: false, requiresUpgrade: false };
            }

            if (parsedVersion === 1) {
                if (process.env.ALLOW_LEGACY_HMAC_LICENSES !== 'true') {
                    return { isValid: false, requiresUpgrade: true, legacyRejected: true };
                }

                const possibleSecrets = [
                    process.env.OWNER_SECRET_KEY,
                    process.env.LICENSE_SECRET,
                    process.env.LICENSE_LEGACY_SECRET,
                    process.env.LEGACY_HMAC_SECRET
                ].filter((s) => typeof s === 'string' && s.trim().length > 0);

                if (possibleSecrets.length === 0) {
                    return { isValid: false, requiresUpgrade: true, legacyRejected: true };
                }

                let isVerified = false;
                for (const sec of possibleSecrets) {
                    const expectedSig = crypto.createHmac('sha256', sec).update(payload).digest('hex');
                    if (typeof signature === 'string' && signature.length === expectedSig.length) {
                        if (crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
                            isVerified = true;
                            break;
                        }
                    }
                }

                return { isValid: isVerified, requiresUpgrade: true };
            }

            throw new Error('VERSION_CRIPTOGRAFICA_DESCONOCIDA');
        } catch (error) {
            console.error('[Security] Fallo en la verificación criptográfica:', error.message);
            return { isValid: false, requiresUpgrade: false };
        }
    }
}

module.exports = new CryptoService();
