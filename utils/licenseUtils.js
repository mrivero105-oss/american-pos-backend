/**
 * REFACTORIZACIÓN SOLID (Agente Antigravity y User)
 * Este módulo actúa como el Orquestador/Facade "LicenseManager".
 * Mantiene la interfaz (validateKey y getMachineId) para no quebrar el resto de la App.
 */
const cryptoService = require('./crypto-service');
const hardwareIdentity = require('./hardware-id');
const os = require('os');

class LicenseManager {
    
    // Adaptador para el API utilizado en todo el sistema
    async getMachineId() {
        return await hardwareIdentity.getStableNetId();
    }
    
    // Adaptador Legacy por compatibilidad interna de tests y rutas viejas
    async getAllPossibleIds() {
        return [await this.getMachineId()];
    }

    /**
     * Validador robusto. Intercepta tanto tokens Legacy (HMAC Base64) 
     * como el eventual Nuevo Formato (RSA).
     */
    async validateKey(licenseKeyString) {
        if (!licenseKeyString) return { valid: false, message: 'Llave no proporcionada' };

        try {
            // Decodificar Base64 asumiendo formato "Payload.Firma"
            const decoded = Buffer.from(licenseKeyString, 'base64').toString('utf8');
            const parts = decoded.split('.');
            
            let payloadStr, signature, version;

            if (parts.length === 2) {
                payloadStr = parts[0];
                signature = parts[1];
                // Inferencia: Podría ser una licencia RSA si definimos un formato estricto,
                // Pero por ahora, asumiremos que "version" lo extraemos del JSON interno,
                // o si no existe, es HMAC (1).
                const testData = JSON.parse(payloadStr);
                version = testData.v || 1; 
            } else {
                return { valid: false, message: 'Formato inválido (Tokens corruptos)' };
            }

            // 1. Validar la Firma Criptográfica
            const cryptoCheck = cryptoService.verifyLicenseSignature(
                payloadStr, 
                signature, 
                version
            );

            if (!cryptoCheck.isValid) {
                return { valid: false, message: 'Firma corrupta o falsificada' };
            }

            // 2. Parsear el payload validado
            const data = JSON.parse(payloadStr);

            // 3. Validar Expiración
            if (data.exp !== 'never' && Date.now() > data.exp) {
                return { valid: false, message: 'Licencia expirada' };
            }

            // 4. Validar Identidad de Hardware (HWID / mid legacy bypass temporal para migración)
            const requiredHwid = data.mid || data.hwid;
            const currentHwid = await hardwareIdentity.getStableNetId();
            
            // Lógica de migración legacy: si el ID que demanda es NET-XXX o UUID-XXX (antes de la actualización),
            // y la firma era real, en un escenario estricto de seguridad debería bloquearse para un re-registro manual.
            // Para mantener estabilidad en esta fase, vamos a ser estrictos pero el usuario del POS deberá
            // reingresar una llave válida si el ID antiguo no coincide con nuestro nuevo estricto "POS-UUID".
            if (requiredHwid !== currentHwid && !data.master && data.mid !== 'MASTER-UNLOCK') {
                // Bloqueo directo por inyección o colisión
                return { valid: false, message: 'Llave asignada a otra máquina (Error de Asignación / Cambio Físico)' };
            }

            // 5. Retorno Exitoso
            return { 
                valid: true, 
                requiresUpgrade: cryptoCheck.requiresUpgrade,
                expiresAt: data.exp === 'never' ? null : new Date(data.exp).toISOString()
            };

        } catch (error) {
            console.error('[LicenseManager] Critical Validation Error:', error);
            return { valid: false, message: 'Error de validación interna' };
        }
    }

    // Funcionalidad remanente de tests para generar llaves Legacy V1
    generateKey(machineId, duration = 365, unit = 'days') {
        const crypto = require('crypto');
        let exp = duration === -1 ? 'never' : Date.now() + (unit === 'minutes' ? duration * 60000 : duration * 86400000);
        const data = JSON.stringify({ mid: machineId, exp: exp, v: 1 });
        const sig = crypto.createHmac('sha256', cryptoService.legacySecret).update(data).digest('hex');
        return Buffer.from(data + '.' + sig).toString('base64');
    }
}

module.exports = new LicenseManager();
