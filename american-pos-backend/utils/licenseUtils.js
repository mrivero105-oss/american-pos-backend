/**
 * REFACTORIZACIÓN SOLID (Agente Antigravity y User)
 * Este módulo actúa como el Orquestador/Facade "LicenseManager".
 * Mantiene la interfaz (validateKey y getMachineId) para no quebrar el resto de la App.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cryptoService = require('./crypto-service');
const hardwareIdentity = require('./hardware-id');
const os = require('os');

function extractAndCleanLicenseKey(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return '';
    let text = rawInput.trim();

    text = text.replace(/```+/g, '').replace(/`/g, '').trim();

    const rawJsonMatch = text.match(/(\{[\s\S]*?\})\.([a-fA-F0-9]{32,64})/);
    if (rawJsonMatch) {
        return rawJsonMatch[1] + '.' + rawJsonMatch[2];
    }

    const keyMatch = text.match(/([A-Za-z0-9+/=_-]{20,}\.[A-Za-z0-9+/=_-]{20,}|eyJ[A-Za-z0-9+/=_-]{40,})/);
    if (keyMatch) {
        return keyMatch[1].trim();
    }

    return text.trim();
}

function safeBase64Decode(str) {
    if (!str || typeof str !== 'string') return null;
    try {
        let clean = str.trim().replace(/-/g, '+').replace(/_/g, '/');
        while (clean.length % 4 !== 0) clean += '=';
        return Buffer.from(clean, 'base64').toString('utf8');
    } catch (_) {
        return null;
    }
}

class LicenseManager {
    
    async getMachineId() {
        return await hardwareIdentity.getStableNetId();
    }
    
    async getAllPossibleIds() {
        return [await this.getMachineId()];
    }

    /**
     * Validador robusto universal. Soporta Full Base64, JWT-style, y Raw tokens.
     */
    async validateKey(licenseKeyString, targetMachineId = null) {
        if (!licenseKeyString) return { valid: false, message: 'Llave no proporcionada' };

        const cleanKey = extractAndCleanLicenseKey(licenseKeyString);

        if (!cleanKey) {
            return { valid: false, message: 'Llave de activación vacía' };
        }

        try {
            let payloadStr = null;
            let signature = null;
            let rawPayloadForSig = null;

            // 1. Probar decodificar toda la llave como Base64 (solo cuando no trae separador '.' externo)
            if (!cleanKey.includes('.')) {
                const decodedFromB64 = safeBase64Decode(cleanKey);
                if (decodedFromB64 && decodedFromB64.includes('.')) {
                    const lastDot = decodedFromB64.lastIndexOf('.');
                    const p0 = decodedFromB64.substring(0, lastDot);
                    const p1 = decodedFromB64.substring(lastDot + 1);
                    if (p0.startsWith('{')) {
                        payloadStr = p0;
                        signature = p1;
                        rawPayloadForSig = p0;
                    }
                }
            }

            // 2. Probar token con punto (JWT style o Raw JSON token)
            if (!payloadStr && cleanKey.includes('.')) {
                const lastDot = cleanKey.lastIndexOf('.');
                const p0 = cleanKey.substring(0, lastDot);
                const p1 = cleanKey.substring(lastDot + 1);
                signature = p1;

                if (p0.startsWith('{')) {
                    payloadStr = p0;
                    rawPayloadForSig = p0;
                } else {
                    const decodedP0 = safeBase64Decode(p0);
                    if (decodedP0 && decodedP0.startsWith('{')) {
                        payloadStr = decodedP0;
                        rawPayloadForSig = p0;
                    }
                }
            }

            if (!payloadStr || !signature) {
                return { valid: false, message: 'Formato de llave inválido (token corrupto o incompleto)' };
            }

            const data = JSON.parse(payloadStr);
            const version = Number(data.v || 1);

            if (version !== 2 && process.env.ALLOW_LEGACY_HMAC_LICENSES !== 'true') {
                return {
                    valid: false,
                    requiresUpgrade: true,
                    message: 'Licencia heredada (v1) rechazada por política criptográfica RSA v2.'
                };
            }

            // 1. Validar la Firma Criptográfica
            let cryptoCheck = cryptoService.verifyLicenseSignature(
                payloadStr, 
                signature, 
                version
            );

            // Si falló y tenemos payload crudo alternativo (p. ej. en JWT)
            if (!cryptoCheck.isValid && rawPayloadForSig && rawPayloadForSig !== payloadStr) {
                cryptoCheck = cryptoService.verifyLicenseSignature(
                    rawPayloadForSig,
                    signature,
                    version
                );
            }

            if (!cryptoCheck.isValid) {
                return {
                    valid: false,
                    requiresUpgrade: Boolean(cryptoCheck.requiresUpgrade),
                    message: cryptoCheck.legacyRejected
                        ? 'Licencia heredada (v1) rechazada por política criptográfica RSA v2.'
                        : 'Firma corrupta o falsificada'
                };
            }

            // 3. Validar Expiración
            if (data.exp && data.exp !== 'never' && Date.now() > Number(data.exp)) {
                return { valid: false, message: 'Licencia expirada' };
            }

            // 4. Validar Identidad de Hardware / Terminal
            const requiredHwid = (data.mid || data.hwid || '').toString().trim();
            const expectedHwid = (targetMachineId || await hardwareIdentity.getStableNetId() || '').toString().trim();
            
            // Restringir llaves maestras universales exclusivamente a firmas RSA v2 (cero downgrade)
            const isMasterKey = (data.master === true || data.mid === 'MASTER-UNLOCK') && version >= 2;

            const normRequired = requiredHwid.toUpperCase().replace(/O/g, '0');
            const normExpected = expectedHwid.toUpperCase().replace(/O/g, '0');

            if (normRequired !== normExpected && !isMasterKey) {
                return { valid: false, message: `Llave asignada a terminal ${requiredHwid}, no coincide con ${expectedHwid}` };
            }

            // 5. Retorno Exitoso
            return { 
                valid: true, 
                version,
                requiresUpgrade: cryptoCheck.requiresUpgrade,
                expiresAt: data.exp === 'never' ? null : new Date(Number(data.exp)).toISOString()
            };

        } catch (error) {
            console.error('[LicenseManager] Critical Validation Error:', error);
            return { valid: false, message: 'Error de validación interna: ' + error.message };
        }
    }

    getPrivateKey(explicitPem = null) {
        if (explicitPem && typeof explicitPem === 'string' && explicitPem.trim()) {
            return explicitPem.replace(/\\n/g, '\n').trim();
        }
        const envPem = process.env.LICENSE_PRIVATE_KEY_PEM
            ? String(process.env.LICENSE_PRIVATE_KEY_PEM).replace(/\\n/g, '\n').trim()
            : '';
        if (envPem) return envPem;

        const keyPath = path.join(__dirname, 'keys', 'private.pem');
        if (fs.existsSync(keyPath)) {
            return fs.readFileSync(keyPath, 'utf8');
        }
        return null;
    }

    generateKeyV2(machineId, duration = 365, unit = 'days', privateKeyPem = null, extraClaims = {}) {
        const privKey = this.getPrivateKey(privateKeyPem);
        if (!privKey) {
            throw new Error('Se requiere clave privada RSA (LICENSE_PRIVATE_KEY_PEM o keys/private.pem) para emitir licencias v2.');
        }
        const exp = duration === -1
            ? 'never'
            : Date.now() + (unit === 'minutes' ? duration * 60000 : duration * 86400000);
        const payloadObj = {
            ...extraClaims,
            mid: machineId,
            exp,
            v: 2,
            iat: Date.now()
        };
        const payloadStr = JSON.stringify(payloadObj);
        const signatureB64 = crypto.sign('RSA-SHA256', Buffer.from(payloadStr, 'utf8'), privKey).toString('base64');
        return Buffer.from(`${payloadStr}.${signatureB64}`, 'utf8').toString('base64');
    }

    generateKey(machineId, duration = 365, unit = 'days') {
        if (this.getPrivateKey()) {
            return this.generateKeyV2(machineId, duration, unit);
        }
        if (process.env.ALLOW_LEGACY_HMAC_LICENSES === 'true') {
            const secret = process.env.OWNER_SECRET_KEY
                || process.env.LICENSE_SECRET
                || process.env.LICENSE_LEGACY_SECRET
                || process.env.LEGACY_HMAC_SECRET;
            if (!secret) {
                throw new Error('OWNER_SECRET_KEY o LICENSE_LEGACY_SECRET requerido para emitir licencias v1 heredadas.');
            }
            const exp = duration === -1 ? 'never' : Date.now() + (unit === 'minutes' ? duration * 60000 : duration * 86400000);
            const data = JSON.stringify({ mid: machineId, exp, v: 1 });
            const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
            return Buffer.from(`${data}.${sig}`, 'utf8').toString('base64');
        }
        throw new Error('No se permite emitir licencias HMAC v1 sin clave privada RSA (LICENSE_PRIVATE_KEY_PEM).');
    }
}

module.exports = new LicenseManager();
