const crypto = require('crypto');

function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys);
    }
    return Object.keys(obj)
        .sort()
        .reduce((result, key) => {
            result[key] = sortObjectKeys(obj[key]);
            return result;
        }, {});
}

// SECURITY: SYNC_SECRET_KEY must be defined in environment variables
// File-based key loading removed for security (no hardcoded keys in repository)
let SECRET_KEY = process.env.SYNC_SECRET_KEY;

if (!SECRET_KEY || SECRET_KEY === 'american-pos-default-secret-2026' || SECRET_KEY === 'dev-sync-secret-change-before-production') {
    throw new Error('FATAL SECURITY ERROR: SYNC_SECRET_KEY must be defined securely in environment variables. Refusing to start.');
}

/**
 * SecurityHelper - Handles HMAC signing of payloads to ensure data integrity
 * and authenticity between the branch (POS) and the central server.
 */
class SecurityHelper {
    /**
     * Creates a unique HMAC signature for a data payload.
     * @param {object} payload - The data to be signed.
     * @param {string} branchId - The unique identifier of the branch.
     * @param {string} [companyId] - Optional companyId for stricter signing.
     * @returns {object} { signature, timestamp, branchId }
     */
    static signPayload(payload, branchId, companyId = '') {
        const timestamp = Date.now().toString();
        
        // Canonical data string for signing.
        // If companyId is provided, we use the strict format.
        const prefix = companyId ? `${companyId}.${branchId}` : `${branchId}`;
        const dataToSign = `${prefix}.${timestamp}.${JSON.stringify(payload)}`;
        
        const signature = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(dataToSign)
            .digest('hex');

        return {
            signature,
            timestamp,
            branchId: String(branchId)
        };
    }

    /**
     * Method to verify a signature from remote branches.
     * Includes backward compatibility for older clients that don't sign with companyId.
     */
    static verifySignature(payload, companyId, branchId, timestamp, signature) {
        // 1. Protección contra Replay Attack (TTL de 5 minutos)
        const now = Date.now();
        const requestTime = parseInt(timestamp, 10);
        if (isNaN(requestTime) || now - requestTime > 5 * 60 * 1000) {
            console.warn(`[SecurityHelper] HMAC Replay Attack o Timestamp caducado para la sucursal ${branchId}`);
            return false;
        }

        const providedSignatureBuffer = Buffer.from(signature, 'hex');
        const sortedPayload = sortObjectKeys(payload);

        // 2. Intento 1: Formato Estricto y Seguro (con companyId)
        const strictData = `${companyId}.${branchId}.${timestamp}.${JSON.stringify(sortedPayload)}`;
        const strictSignature = crypto.createHmac('sha256', SECRET_KEY).update(strictData).digest('hex');
        const strictSignatureBuffer = Buffer.from(strictSignature, 'hex');

        if (providedSignatureBuffer.length === strictSignatureBuffer.length && 
            crypto.timingSafeEqual(providedSignatureBuffer, strictSignatureBuffer)) {
            return true;
        }

        console.warn(`[SecurityHelper] HMAC verification failed for branch ${branchId} (company ${companyId})`);
        return false;
    }
}

module.exports = SecurityHelper;
