const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class CryptoService {
    constructor() {
        this.publicKey = null;
        try {
            this.publicKey = fs.readFileSync(path.join(__dirname, 'keys', 'public.pem'), 'utf8');
        } catch (e) {
            console.warn('[Security] Llave publica no encontrada en utils/keys/public.pem. Validación RSA fallará en clientes que no la instalen.');
        }
    }

    getPublicKey() {
        const envPem = process.env.LICENSE_PUBLIC_KEY_PEM ? String(process.env.LICENSE_PUBLIC_KEY_PEM).replace(/\\n/g, '\n').trim() : '';
        return envPem || this.publicKey || null;
    }

    /**
     * Valida la firma del payload de la licencia.
     * Por seguridad, exige firmas asimétricas RSA-SHA256 (v2) por defecto y bloquea downgrade a HMAC v1
     * salvo habilitación explícita ALLOW_LEGACY_HMAC_LICENSES=true con secreto dedicado (nunca JWT_SECRET).
     * @param {string} payload - Los datos de la licencia en string
     * @param {string} signature - La firma criptográfica
     * @param {number} version - Versión del algoritmo (2 = RSA, 1 = HMAC legado)
     * @returns {Object} { isValid: boolean, requiresUpgrade: boolean, legacyRejected?: boolean }
     */
    verifyLicenseSignature(payload, signature, version = 2) {
        try {
            const parsedVersion = Number(version);
            if (parsedVersion === 2) {
                const publicKey = this.getPublicKey();
                if (!publicKey) throw new Error('PUBLIC_KEY_MISSING');
                if (!signature || typeof signature !== 'string') {
                    return { isValid: false, requiresUpgrade: false };
                }

                const isVerified = crypto.verify(
                    'RSA-SHA256',
                    Buffer.from(payload, 'utf8'),
                    publicKey,
                    Buffer.from(signature, 'base64')
                );
                return { isValid: isVerified, requiresUpgrade: false };
            }

            if (parsedVersion === 1) {
                // Bloqueo estricto de downgrade a HMAC v1 por defecto
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
