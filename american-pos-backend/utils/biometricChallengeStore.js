const crypto = require('crypto');

const BIOMETRIC_V2_PREFIX = 'v2:ecdsa:';
const BIOMETRIC_CHALLENGE_TTL_MS = 60 * 1000;
const MAX_ACTIVE_CHALLENGES = 1000;

// challengeId -> { challenge, userId, username, ip, expiresAt }
const biometricChallenges = new Map();

const bioChallengeCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of biometricChallenges.entries()) {
        if (!entry || entry.expiresAt <= now) {
            biometricChallenges.delete(id);
        }
    }
}, 60 * 1000);
if (typeof bioChallengeCleanupTimer.unref === 'function') {
    bioChallengeCleanupTimer.unref();
}

function parseEcdsaP256SpkiPublicKey(spkiBase64) {
    if (!spkiBase64 || typeof spkiBase64 !== 'string') return null;
    const cleanB64 = spkiBase64.trim();
    if (cleanB64.length < 64 || cleanB64.length > 240) return null;
    try {
        const derBuf = Buffer.from(cleanB64, 'base64');
        if (!derBuf.length) return null;
        const pubKey = crypto.createPublicKey({ key: derBuf, format: 'der', type: 'spki' });
        if (pubKey.asymmetricKeyType !== 'ec') return null;
        const curve = pubKey.asymmetricKeyDetails?.namedCurve;
        if (curve && curve !== 'prime256v1' && curve !== 'P-256') return null;
        return { pubKey, canonicalBase64: derBuf.toString('base64') };
    } catch (_err) {
        return null;
    }
}

function issueBiometricChallenge({ userId = null, username = null, ip = '127.0.0.1' } = {}) {
    if (biometricChallenges.size >= MAX_ACTIVE_CHALLENGES) {
        const oldestKey = biometricChallenges.keys().next().value;
        if (oldestKey) biometricChallenges.delete(oldestKey);
    }

    const challengeId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex');
    const challenge = crypto.randomBytes(32).toString('base64');
    const expiresAt = Date.now() + BIOMETRIC_CHALLENGE_TTL_MS;

    biometricChallenges.set(challengeId, {
        challenge,
        userId: userId ? String(userId).trim() : null,
        username: username ? String(username).trim().toLowerCase() : null,
        ip: String(ip || '127.0.0.1'),
        expiresAt
    });

    return {
        challengeId,
        challenge,
        expiresInMs: BIOMETRIC_CHALLENGE_TTL_MS
    };
}

function consumeBiometricChallenge(challengeId) {
    if (!challengeId) return null;
    const key = String(challengeId).trim();
    if (!key) return null;
    const entry = biometricChallenges.get(key) || null;
    biometricChallenges.delete(key);
    if (!entry || entry.expiresAt <= Date.now()) {
        return null;
    }
    return entry;
}

/**
 * Consume de forma atómica un reto one-time y verifica su firma ECDSA P-256 SHA-256
 * contra el campo `biometricTokenHash` (`v2:ecdsa:<spki_base64>`) del usuario/supervisor.
 */
function verifyEcdsaBiometricChallenge({ challengeId, userId, signature, storedBiometricTokenHash }) {
    const challengeEntry = consumeBiometricChallenge(challengeId);
    if (!challengeEntry) {
        return {
            valid: false,
            code: 'BIOMETRIC_CHALLENGE_EXPIRED',
            error: 'El reto criptográfico biométrico expiró o ya fue utilizado. Intente nuevamente.'
        };
    }

    if (challengeEntry.userId && userId && String(challengeEntry.userId) !== String(userId)) {
        return {
            valid: false,
            code: 'BIOMETRIC_CHALLENGE_MISMATCH',
            error: 'El reto biométrico no corresponde a este usuario.'
        };
    }

    const storedKeyRaw = String(storedBiometricTokenHash || '');
    if (!storedKeyRaw) {
        return {
            valid: false,
            code: 'BIOMETRIC_NOT_ENROLLED',
            error: 'Este usuario no tiene huella dactilar registrada en el sistema.'
        };
    }
    if (!storedKeyRaw.startsWith(BIOMETRIC_V2_PREFIX)) {
        return {
            valid: false,
            code: 'BIOMETRIC_V2_REQUIRED',
            error: 'El registro biométrico anterior (v1) caducó por seguridad. Vuelve a vincular tu huella ECDSA v2.'
        };
    }

    const parsedPubKey = parseEcdsaP256SpkiPublicKey(storedKeyRaw.slice(BIOMETRIC_V2_PREFIX.length));
    if (!parsedPubKey || !signature || typeof signature !== 'string') {
        return {
            valid: false,
            code: 'BIOMETRIC_SIGNATURE_INVALID',
            error: 'Firma biométrica de hardware inválida o rechazada.'
        };
    }

    try {
        const sigBuf = Buffer.from(signature.trim(), 'base64');
        const challengeBuf = Buffer.from(String(challengeEntry.challenge), 'utf8');
        const isMatch = crypto.verify('sha256', challengeBuf, parsedPubKey.pubKey, sigBuf);
        if (!isMatch) {
            return {
                valid: false,
                code: 'BIOMETRIC_SIGNATURE_INVALID',
                error: 'Firma biométrica de hardware inválida o rechazada.'
            };
        }
        return { valid: true, challengeEntry };
    } catch (_verifyErr) {
        return {
            valid: false,
            code: 'BIOMETRIC_SIGNATURE_INVALID',
            error: 'Firma biométrica de hardware inválida o rechazada.'
        };
    }
}

module.exports = {
    BIOMETRIC_V2_PREFIX,
    BIOMETRIC_CHALLENGE_TTL_MS,
    parseEcdsaP256SpkiPublicKey,
    issueBiometricChallenge,
    consumeBiometricChallenge,
    verifyEcdsaBiometricChallenge
};
