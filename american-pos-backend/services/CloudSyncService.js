const SecurityHelper = require('./SecurityHelper');

class CloudSyncService {
    /**
     * Valida la firma HMAC de una petición de sincronización móvil.
     */
    static verifySignature(payload, companyId, branchId, timestamp, signature) {
        return SecurityHelper.verifySignature(payload, companyId, branchId, timestamp, signature);
    }
}

module.exports = CloudSyncService;
