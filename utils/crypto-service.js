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

        this.legacySecret = process.env.LICENSE_LEGACY_SECRET || process.env.JWT_SECRET || 'AMERICAN_POS_DEFAULT_LEGACY_SECRET';
        if (!process.env.LICENSE_LEGACY_SECRET && process.env.NODE_ENV === 'production') {
            console.warn('[Security] LICENSE_LEGACY_SECRET not set. Legacy license keys (v1) will use fallback secret.');
        }
    }

    /**
     * Valida la firma del payload de la licencia.
     * @param {string} payload - Los datos de la licencia en string
     * @param {string} signature - La firma criptográfica
     * @param {number} version - Versión del algoritmo (1 = HMAC, 2 = RSA)
     * @returns {Object} { isValid: boolean, requiresUpgrade: boolean }
     */
    verifyLicenseSignature(payload, signature, version = 1) {
        try {
            if (version === 2) {
                if (!this.publicKey) throw new Error('PUBLIC_KEY_MISSING');

                const isVerified = crypto.verify(
                    'RSA-SHA256',
                    Buffer.from(payload),
                    this.publicKey,
                    Buffer.from(signature, 'base64')
                );
                return { isValid: isVerified, requiresUpgrade: false };
            }

            if (version === 1) {
                const possibleSecrets = [
                    this.legacySecret,
                    process.env.JWT_SECRET,
                    process.env.LICENSE_LEGACY_SECRET,
                    process.env.LEGACY_HMAC_SECRET
                ].filter(Boolean);

                let isVerified = false;
                for (const sec of possibleSecrets) {
                    const expectedSig = crypto.createHmac('sha256', sec).update(payload).digest('hex');
                    if (signature === expectedSig) {
                        isVerified = true;
                        break;
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
