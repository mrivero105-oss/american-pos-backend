/**
 * Validador Criptográfico Local de Licencias (Isaac POS Mobile & Desktop)
 * 
 * Permite que los terminales y cajeros móviles activen su licencia de forma 
 * 100% autónoma y OFFLINE mediante WebCrypto (HMAC-SHA256), sin depender de
 * que la PC Servidor esté encendida o alcanzable en la red en ese instante.
 */

const _d = (arr) => arr.map((c) => String.fromCharCode(c ^ 0x5A)).join('');
const KNOWN_SECRETS = [
    _d([23, 59, 41, 46, 63, 40, 21, 45, 52, 63, 40, 9, 63, 57, 40, 63, 46, 104, 106, 104, 108]),
    '4d0e0ed5b2e25fb26c0ce829cd8135a9e04c4eefdc881a2bb258d4aa98747ffe',
    'ISAAC_POS_DEFAULT_LEGACY_SECRET',
    'AMERICAN_POS_DEFAULT_LEGACY_SECRET'
];

/**
 * Genera HMAC-SHA256 usando WebCrypto nativo del navegador / Android WebView
 */
async function hmacSha256(secret, message) {
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
        throw new Error('WebCrypto API no disponible en este entorno.');
    }
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signatureBuffer = await window.crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        encoder.encode(message)
    );
    return Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Normaliza los identificadores de terminal para evitar la confusión 
 * recurrente entre el número '0' y la letra 'O'.
 */
export function normalizeTerminalId(id) {
    if (!id || typeof id !== 'string') return '';
    return id.trim().toUpperCase().replace(/O/g, '0');
}

/**
 * Limpia y extrae la llave de activación de cualquier texto copiado
 * (mensajes de WhatsApp, comillas, bloques de código, espacios).
 */
export function extractAndCleanLicenseKey(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return '';
    let text = rawInput.trim();

    // Remover bloques de código markdown y backticks
    text = text.replace(/```+/g, '').replace(/`/g, '').trim();

    // Caso 1: Token raw con JSON explícito {"mid":...}.firma
    const rawJsonMatch = text.match(/(\{[\s\S]*?\})\.([a-fA-F0-9]{32,64})/);
    if (rawJsonMatch) {
        return rawJsonMatch[1] + '.' + rawJsonMatch[2];
    }

    // Caso 2: Buscar línea directa de Base64 o JWT
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const lineTrimmed = line.trim();
        if (lineTrimmed.startsWith('eyJ') && lineTrimmed.length >= 30) {
            return lineTrimmed;
        }
    }

    // Caso 3: Llave Base64 o estilo JWT incrustada en un mensaje
    const keyMatch = text.match(/([A-Za-z0-9+/=_-]{20,}\.[A-Za-z0-9+/=_-]{20,}|eyJ[A-Za-z0-9+/=_-]{30,})/);
    if (keyMatch) {
        return keyMatch[1].trim();
    }

    // Caso 4: Remover espacios si todo el texto es un token
    const stripped = text.replace(/\s+/g, '');
    if (stripped.startsWith('eyJ') || stripped.includes('.')) {
        return stripped;
    }

    return text.trim();
}

/**
 * Decodificación Base64 segura que tolera caracteres URL-safe y UTF-8.
 */
function safeBase64Decode(str) {
    if (!str || typeof str !== 'string') return null;
    try {
        let clean = str.trim().replace(/-/g, '+').replace(/_/g, '/');
        while (clean.length % 4 !== 0) {
            clean += '=';
        }
        const binary = atob(clean);
        try {
            return decodeURIComponent(escape(binary));
        } catch (_) {
            return binary;
        }
    } catch (_) {
        return null;
    }
}

/**
 * Valida criptográficamente una llave de activación para una terminal específica.
 * Compatible con:
 * - Full Base64 (base64 de payload.firma)
 * - JWT style (base64(payload).firma)
 * - Raw token (payload.firma)
 * - MasterOwnerSecret2026 (bypass maestro)
 * 
 * @param {string} licenseKeyString - Llave introducida por el usuario
 * @param {string} targetTerminalId - ID de la terminal actual (ej: TERM-3E1Z-7SGD-UEJS)
 * @returns {Promise<{valid: boolean, isMaster?: boolean, expiresAt?: string|null, message: string, data?: object}>}
 */
export async function validateLicenseKeyLocally(licenseKeyString, targetTerminalId) {
    if (!licenseKeyString || typeof licenseKeyString !== 'string') {
        return { valid: false, message: 'La llave de activación no puede estar vacía' };
    }

    const cleanKey = extractAndCleanLicenseKey(licenseKeyString);

    if (!cleanKey) {
        return { valid: false, message: 'La llave de activación no puede estar vacía' };
    }

    if (cleanKey.length < 40) {
        return { 
            valid: false, 
            message: `Llave incompleta (${cleanKey.length} caracteres). Una llave válida contiene más de 100 caracteres. Asegúrate de copiarla completa.` 
        };
    }

    try {
        let payloadStr = null;
        let signature = null;

        // Estrategia A: Llave completa en Base64 (Pocket Generator / Legacy V1)
        const decodedFromB64 = safeBase64Decode(cleanKey);
        if (decodedFromB64 && decodedFromB64.includes('.')) {
            const lastDot = decodedFromB64.lastIndexOf('.');
            const p0 = decodedFromB64.substring(0, lastDot);
            const p1 = decodedFromB64.substring(lastDot + 1);
            if (p0.startsWith('{')) {
                payloadStr = p0;
                signature = p1;
            }
        }

        // Estrategia B: Llave con punto separator (JWT style o Raw JSON token)
        if (!payloadStr && cleanKey.includes('.')) {
            const lastDot = cleanKey.lastIndexOf('.');
            const p0 = cleanKey.substring(0, lastDot);
            const p1 = cleanKey.substring(lastDot + 1);
            signature = p1;

            if (p0.startsWith('{')) {
                payloadStr = p0;
            } else {
                const decodedP0 = safeBase64Decode(p0);
                if (decodedP0 && decodedP0.startsWith('{')) {
                    payloadStr = decodedP0;
                }
            }
        }

        if (!payloadStr || !signature) {
            return { 
                valid: false, 
                message: `Formato de llave irreconocible (${cleanKey.length} caracteres). Verifica haber copiado la llave completa sin cortes.` 
            };
        }

        let data;
        try {
            data = JSON.parse(payloadStr);
        } catch (_) {
            return { valid: false, message: 'Estructura interna no legible (datos de licencia corruptos)' };
        }

        // 3. Validar Expiración
        if (data.exp && data.exp !== 'never' && Date.now() > Number(data.exp)) {
            return { valid: false, message: 'Esta licencia ya ha expirado' };
        }

        // 4. Validar Identidad de Terminal (con tolerancia a 0 vs O y mayúsculas/minúsculas)
        const keyMid = (data.mid || data.hwid || '').toString();
        const normKeyMid = normalizeTerminalId(keyMid);
        const normTargetMid = normalizeTerminalId(targetTerminalId);

        const isMasterKey = data.master === true || keyMid === 'MASTER-UNLOCK';

        if (!isMasterKey && normKeyMid !== normTargetMid) {
            return {
                valid: false,
                message: `Esta llave pertenece a la terminal "${keyMid}", pero este equipo es "${targetTerminalId}"`
            };
        }

        // 5. Validar Firma Criptográfica contra los secretos reconocidos
        let isSignatureValid = false;
        const candidates = [payloadStr, JSON.stringify(data)];
        if (cleanKey.includes('.')) {
            candidates.push(cleanKey.substring(0, cleanKey.lastIndexOf('.')));
        }

        for (const secret of KNOWN_SECRETS) {
            for (const cand of candidates) {
                try {
                    const expectedSig = await hmacSha256(secret, cand);
                    if (expectedSig.toLowerCase() === signature.toLowerCase()) {
                        isSignatureValid = true;
                        break;
                    }
                } catch (_) {}
            }
            if (isSignatureValid) break;
        }

        if (!isSignatureValid) {
            return { 
                valid: false, 
                message: 'Firma criptográfica inválida (La clave de dueño en el generador no coincide)' 
            };
        }

        return {
            valid: true,
            isMaster: isMasterKey,
            expiresAt: data.exp === 'never' ? null : new Date(Number(data.exp)).toISOString(),
            message: isMasterKey ? '¡Licencia Maestra aceptada con éxito!' : '¡Licencia de Cajero válida y activada!',
            data
        };
    } catch (error) {
        return { valid: false, message: 'Error al verificar llave: ' + (error.message || 'token no reconocido') };
    }
}
