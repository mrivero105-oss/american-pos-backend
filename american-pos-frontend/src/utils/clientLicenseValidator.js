/**
 * Validador Criptográfico Local de Licencias (Isaac POS Mobile & Desktop)
 * 
 * Permite que los terminales y cajeros móviles activen y validen su licencia
 * de forma 100% autónoma y OFFLINE mediante RSA-SHA256 (WebCrypto con fallback
 * determinista en JS puro BigInt para entornos HTTP LAN / Android WebView),
 * sin depender de que la PC Servidor esté encendida o alcanzable en la red.
 */

import PUBLIC_RSA_KEY_PEM from '../config/licensePublicKey';

let cachedRsaPublicKey = null;
let cachedParsedRsaKey = null;

// Prefijo ASN.1 DER DigestInfo para SHA-256 (RFC 8017 §9.2)
const SHA256_DIGEST_INFO_PREFIX = new Uint8Array([
    0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86,
    0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
    0x00, 0x04, 0x20
]);

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function base64ToUint8Array(base64Str) {
    let clean = String(base64Str || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4 !== 0) {
        clean += '=';
    }
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function getSpkiBytes() {
    const pemBody = String(PUBLIC_RSA_KEY_PEM || '')
        .replace(/-----BEGIN PUBLIC KEY-----/g, '')
        .replace(/-----END PUBLIC KEY-----/g, '')
        .replace(/\s+/g, '');
    if (!pemBody) {
        throw new Error('Clave pública RSA SPKI no configurada.');
    }
    return base64ToUint8Array(pemBody);
}

function readDerTlv(bytes, offset) {
    if (offset + 2 > bytes.length) {
        throw new Error('ASN.1 DER truncado.');
    }
    const tag = bytes[offset];
    const lenByte = bytes[offset + 1];
    let length = 0;
    let valueStart = offset + 2;
    if ((lenByte & 0x80) === 0) {
        length = lenByte;
    } else {
        const numLenBytes = lenByte & 0x7f;
        if (numLenBytes === 0 || numLenBytes > 4 || valueStart + numLenBytes > bytes.length) {
            throw new Error('Longitud ASN.1 DER inválida.');
        }
        for (let i = 0; i < numLenBytes; i++) {
            length = (length << 8) | bytes[valueStart + i];
        }
        valueStart += numLenBytes;
    }
    const valueEnd = valueStart + length;
    if (valueEnd > bytes.length) {
        throw new Error('Valor ASN.1 DER fuera de rango.');
    }
    return { tag, valueStart, valueEnd, nextOffset: valueEnd };
}

function bytesToBigInt(bytes, start = 0, end = bytes.length) {
    let result = 0n;
    for (let i = start; i < end; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}

function bigIntToFixedBytes(value, byteLength) {
    const out = new Uint8Array(byteLength);
    let v = value;
    for (let i = byteLength - 1; i >= 0; i--) {
        out[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    if (v !== 0n) return null;
    return out;
}

function modPow(base, exp, mod) {
    if (mod === 1n) return 0n;
    let result = 1n;
    let b = base % mod;
    let e = exp;
    while (e > 0n) {
        if ((e & 1n) === 1n) {
            result = (result * b) % mod;
        }
        e >>= 1n;
        if (e > 0n) {
            b = (b * b) % mod;
        }
    }
    return result;
}

function sha256Bytes(bytes) {
    const rotr = (v, n) => (v >>> n) | (v << (32 - n));
    const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const view = new DataView(padded.buffer);
    const bitLenBig = BigInt(bytes.length) * 8n;
    view.setUint32(paddedLen - 8, Number((bitLenBig >> 32n) & 0xffffffffn), false);
    view.setUint32(paddedLen - 4, Number(bitLenBig & 0xffffffffn), false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let i = 0; i < paddedLen; i += 64) {
        for (let t = 0; t < 16; t++) {
            w[t] = view.getUint32(i + t * 4, false);
        }
        for (let t = 16; t < 64; t++) {
            const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let hh = h7;

        for (let t = 0; t < 64; t++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ ((~e) & g);
            const temp1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            hh = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + hh) >>> 0;
    }

    const digest = new Uint8Array(32);
    const outView = new DataView(digest.buffer);
    outView.setUint32(0, h0, false);
    outView.setUint32(4, h1, false);
    outView.setUint32(8, h2, false);
    outView.setUint32(12, h3, false);
    outView.setUint32(16, h4, false);
    outView.setUint32(20, h5, false);
    outView.setUint32(24, h6, false);
    outView.setUint32(28, h7, false);
    return digest;
}

function getParsedRsaPublicKey() {
    if (cachedParsedRsaKey) return cachedParsedRsaKey;
    const spki = getSpkiBytes();
    const outerSeq = readDerTlv(spki, 0);
    if (outerSeq.tag !== 0x30) throw new Error('SPKI raíz no es SEQUENCE.');

    const algSeq = readDerTlv(spki, outerSeq.valueStart);
    if (algSeq.tag !== 0x30) throw new Error('AlgorithmIdentifier inválido.');

    const bitStr = readDerTlv(spki, algSeq.nextOffset);
    if (bitStr.tag !== 0x03 || spki[bitStr.valueStart] !== 0x00) {
        throw new Error('BIT STRING SPKI inválido.');
    }

    const rsaSeq = readDerTlv(spki, bitStr.valueStart + 1);
    if (rsaSeq.tag !== 0x30) throw new Error('RSAPublicKey no es SEQUENCE.');

    const modTlv = readDerTlv(spki, rsaSeq.valueStart);
    if (modTlv.tag !== 0x02) throw new Error('Módulo RSA inválido.');

    const expTlv = readDerTlv(spki, modTlv.nextOffset);
    if (expTlv.tag !== 0x02) throw new Error('Exponente RSA inválido.');

    let modStart = modTlv.valueStart;
    while (modStart < modTlv.valueEnd && spki[modStart] === 0x00) {
        modStart++;
    }
    const modulusByteLength = modTlv.valueEnd - modStart;
    const n = bytesToBigInt(spki, modStart, modTlv.valueEnd);
    const e = bytesToBigInt(spki, expTlv.valueStart, expTlv.valueEnd);

    if (modulusByteLength < 128 || n <= 0n || e <= 1n) {
        throw new Error('Parámetros de clave pública RSA inválidos.');
    }

    cachedParsedRsaKey = { n, e, k: modulusByteLength };
    return cachedParsedRsaKey;
}

function verifyRsaSha256PureJs(payload, base64Signature) {
    try {
        const { n, e, k } = getParsedRsaPublicKey();
        const sigBytes = base64ToUint8Array(base64Signature);
        if (sigBytes.length !== k) return false;

        const s = bytesToBigInt(sigBytes);
        if (s < 0n || s >= n) return false;

        const m = modPow(s, e, n);
        const em = bigIntToFixedBytes(m, k);
        if (!em) return false;

        const hash = sha256Bytes(new TextEncoder().encode(payload));
        const tLen = SHA256_DIGEST_INFO_PREFIX.length + hash.length;
        const psLen = k - tLen - 3;
        if (psLen < 8) return false;

        let diff = (em[0] ^ 0x00) | (em[1] ^ 0x01) | (em[2 + psLen] ^ 0x00);
        for (let i = 0; i < psLen; i++) {
            diff |= em[2 + i] ^ 0xff;
        }
        const digestStart = 3 + psLen;
        for (let i = 0; i < SHA256_DIGEST_INFO_PREFIX.length; i++) {
            diff |= em[digestStart + i] ^ SHA256_DIGEST_INFO_PREFIX[i];
        }
        const hashStart = digestStart + SHA256_DIGEST_INFO_PREFIX.length;
        for (let i = 0; i < hash.length; i++) {
            diff |= em[hashStart + i] ^ hash[i];
        }
        return diff === 0;
    } catch (_) {
        return false;
    }
}

async function getRsaPublicKey() {
    if (cachedRsaPublicKey) return cachedRsaPublicKey;
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
        throw new Error('WebCrypto API no disponible en este entorno.');
    }
    const spkiBytes = getSpkiBytes();
    cachedRsaPublicKey = await window.crypto.subtle.importKey(
        'spki',
        spkiBytes.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );
    return cachedRsaPublicKey;
}

/**
 * Verifica firma digital RSA-SHA256 (licencias v2) usando únicamente clave pública SPKI.
 * Usa WebCrypto nativo cuando está disponible y cae automáticamente a BigInt JS puro
 * en contextos HTTP no seguros (LAN) o WebViews Android sin crypto.subtle.
 */
async function verifyRsaSha256Signature(payload, base64Signature) {
    if (!base64Signature || typeof base64Signature !== 'string') return false;
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
        try {
            const publicKey = await getRsaPublicKey();
            const sigBytes = base64ToUint8Array(base64Signature);
            const payloadBytes = new TextEncoder().encode(payload);
            return await window.crypto.subtle.verify(
                { name: 'RSASSA-PKCS1-v1_5' },
                publicKey,
                sigBytes.buffer,
                payloadBytes
            );
        } catch (_) {
            // Fallback determinista en JS puro si WebCrypto falla o está restringido
        }
    }
    return verifyRsaSha256PureJs(payload, base64Signature);
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
 * - Verificación asimétrica RSA-SHA256 (v2)
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
            return { valid: false, expired: true, message: 'Esta licencia ya ha expirado' };
        }

        // 4. Validar Identidad de Terminal (con tolerancia a 0 vs O y mayúsculas/minúsculas)
        const keyMid = (data.mid || data.hwid || '').toString();
        const normKeyMid = normalizeTerminalId(keyMid);
        const normTargetMid = normalizeTerminalId(targetTerminalId);

        const licenseVersion = Number(data.v || 1);
        const isMasterKey = (data.master === true || keyMid === 'MASTER-UNLOCK') && licenseVersion >= 2;

        if (!isMasterKey && normKeyMid !== normTargetMid) {
            return {
                valid: false,
                message: `Esta llave pertenece a la terminal "${keyMid}", pero este equipo es "${targetTerminalId}"`
            };
        }

        // 5. Validar Firma Criptográfica:
        //    - Licencias v2: verificación asimétrica offline RSA-SHA256 con clave pública SPKI.
        //    - Licencias v1 (HMAC): no exponen secretos en el cliente; requieren validación en el servidor (/license/activate).
        if (licenseVersion < 2) {
            return {
                valid: false,
                requiresServerValidation: true,
                message: 'Llave de licencia heredada (v1): requiere validación directa con el servidor.'
            };
        }

        let isSignatureValid = false;
        const candidates = [payloadStr, JSON.stringify(data)];
        if (cleanKey.includes('.')) {
            candidates.push(cleanKey.substring(0, cleanKey.lastIndexOf('.')));
        }

        for (const cand of candidates) {
            if (await verifyRsaSha256Signature(cand, signature)) {
                isSignatureValid = true;
                break;
            }
        }

        if (!isSignatureValid) {
            return {
                valid: false,
                message: 'Firma criptográfica RSA inválida.'
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
