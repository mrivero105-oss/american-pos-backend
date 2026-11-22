import { describe, it, expect, vi, beforeEach } from 'vitest';

const keyState = {
    publicPem: '',
    privateKey: null
};

vi.mock('../../src/config/licensePublicKey.pem?raw', () => ({
    default: ''
}));

function bufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

describe('clientLicenseValidator (RSA-SHA256 Offline + Normalización HWID)', () => {
    beforeEach(async () => {
        if (!keyState.privateKey) {
            const pair = await window.crypto.subtle.generateKey(
                {
                    name: 'RSASSA-PKCS1-v1_5',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256'
                },
                true,
                ['sign', 'verify']
            );
            const spki = await window.crypto.subtle.exportKey('spki', pair.publicKey);
            const b64 = bufferToBase64(spki);
            const lines = b64.match(/.{1,64}/g).join('\n');
            keyState.publicPem = `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
            keyState.privateKey = pair.privateKey;
        }
    });

    it('normaliza IDs confundiendo letra O con dígito 0 y limpia texto de WhatsApp', async () => {
        const { normalizeTerminalId, extractAndCleanLicenseKey } = await import('../../src/utils/clientLicenseValidator');

        expect(normalizeTerminalId(' term-ab0o-cd1o ')).toBe('TERM-AB00-CD10');
        const extracted = extractAndCleanLicenseKey('Hola aquí tienes tu clave:\n```\neyJhbGciOiJub25lIn0.ABCD1234EFGH5678IJKL\n```');
        expect(extracted).toBe('eyJhbGciOiJub25lIn0.ABCD1234EFGH5678IJKL');
    });

    it('rechaza llaves v1 para validación local (exige servidor), expiradas, manipuladas o de otro HWID', async () => {
        const { validateLicenseKeyLocally } = await import('../../src/utils/clientLicenseValidator');

        const v1Payload = JSON.stringify({ v: 1, mid: 'TERM-1111-2222', exp: 'never' });
        const v1Token = `${btoa(v1Payload)}.${'a'.repeat(64)}`;
        const v1Res = await validateLicenseKeyLocally(v1Token, 'TERM-1111-2222');
        expect(v1Res.valid).toBe(false);
        expect(v1Res.requiresServerValidation).toBe(true);

        const expPayload = JSON.stringify({ v: 2, mid: 'TERM-1111-2222', exp: Date.now() - 60000 });
        const expToken = `${btoa(expPayload)}.${'a'.repeat(64)}`;
        const expRes = await validateLicenseKeyLocally(expToken, 'TERM-1111-2222');
        expect(expRes.valid).toBe(false);
        expect(expRes.message).toMatch(/expirado/i);

        const wrongMidPayload = JSON.stringify({ v: 2, mid: 'TERM-OTRO-9999', exp: 'never' });
        const wrongToken = `${btoa(wrongMidPayload)}.${'a'.repeat(64)}`;
        const wrongRes = await validateLicenseKeyLocally(wrongToken, 'TERM-1111-2222');
        expect(wrongRes.valid).toBe(false);
        expect(wrongRes.message).toMatch(/pertenece a la terminal/i);
    });

    it('verifica criptográficamente una licencia v2 firmada con RSA-SHA256 real y rechaza adulteración', async () => {
        vi.resetModules();
        vi.doMock('../../src/config/licensePublicKey.pem?raw', () => ({
            default: keyState.publicPem
        }));
        const { validateLicenseKeyLocally } = await import('../../src/utils/clientLicenseValidator');

        const payloadJson = JSON.stringify({
            v: 2,
            mid: 'TERM-TEST-0001',
            exp: Date.now() + 86400_000,
            master: false
        });
        const sigBuf = await window.crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            keyState.privateKey,
            new TextEncoder().encode(payloadJson)
        );
        const token = `${btoa(payloadJson)}.${bufferToBase64(sigBuf)}`;

        const okRes = await validateLicenseKeyLocally(token, 'TERM-TEST-0O01');
        expect(okRes.valid).toBe(true);
        expect(okRes.isMaster).toBe(false);

        // Alterar payload invalida firma RSA
        const tamperedPayload = btoa(JSON.stringify({ v: 2, mid: 'TERM-TEST-0001', exp: 'never', master: true }));
        const badRes = await validateLicenseKeyLocally(`${tamperedPayload}.${bufferToBase64(sigBuf)}`, 'TERM-TEST-0001');
        expect(badRes.valid).toBe(false);
        expect(badRes.message).toMatch(/inválida/i);
    });

    it('verifica licencias RSA v2 en formato Full Base64 (552 chars) usando fallback BigInt JS puro cuando WebCrypto no está disponible (HTTP LAN / WebView)', async () => {
        vi.resetModules();
        vi.doMock('../../src/config/licensePublicKey.pem?raw', () => ({
            default: keyState.publicPem
        }));

        const payloadJson = JSON.stringify({
            kid: 'v2-primary',
            mid: 'TERM-X6FF-77PZ-LPB4',
            exp: 'never',
            v: 2,
            iat: Date.now()
        });
        const sigBuf = await window.crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            keyState.privateKey,
            new TextEncoder().encode(payloadJson)
        );
        // Formato exacto emitido por Generador-Licencias.apk y licenseUtils.generateKeyV2
        const fullBase64Key = btoa(`${payloadJson}.${bufferToBase64(sigBuf)}`);

        // Simular entorno HTTP no seguro donde window.crypto.subtle es undefined
        const originalCrypto = window.crypto;
        Object.defineProperty(window, 'crypto', {
            configurable: true,
            value: { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) }
        });

        try {
            const { validateLicenseKeyLocally } = await import('../../src/utils/clientLicenseValidator');

            const validRes = await validateLicenseKeyLocally(fullBase64Key, 'TERM-X6FF-77PZ-LPB4');
            expect(validRes.valid).toBe(true);
            expect(validRes.isMaster).toBe(false);

            // Adulterar 1 byte de la firma debe fallar estrictamente en el fallback JS puro
            const badSigBytes = new Uint8Array(sigBuf.slice(0));
            badSigBytes[badSigBytes.length - 1] ^= 0x01;
            const tamperedKey = btoa(`${payloadJson}.${bufferToBase64(badSigBytes.buffer)}`);
            const invalidRes = await validateLicenseKeyLocally(tamperedKey, 'TERM-X6FF-77PZ-LPB4');
            expect(invalidRes.valid).toBe(false);
            expect(invalidRes.message).toMatch(/inválida/i);
        } finally {
            Object.defineProperty(window, 'crypto', {
                configurable: true,
                value: originalCrypto
            });
        }
    });
});
