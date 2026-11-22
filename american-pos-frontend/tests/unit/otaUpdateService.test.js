import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const mocks = vi.hoisted(() => ({
    isNative: true,
    current: vi.fn(),
    download: vi.fn(),
    set: vi.fn(),
    reload: vi.fn(),
    notifyAppReady: vi.fn(),
    addListener: vi.fn(),
    axiosGet: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mocks.isNative
    }
}));

vi.mock('@capgo/capacitor-updater', () => ({
    CapacitorUpdater: {
        current: mocks.current,
        download: mocks.download,
        set: mocks.set,
        reload: mocks.reload,
        notifyAppReady: mocks.notifyAppReady,
        addListener: mocks.addListener
    }
}));

vi.mock('axios', () => ({
    default: {
        get: mocks.axiosGet
    }
}));

vi.mock('react-hot-toast', () => ({
    default: Object.assign(vi.fn(), {
        loading: vi.fn(() => 'toast-1'),
        success: vi.fn(),
        error: vi.fn(),
        dismiss: vi.fn()
    })
}));

vi.mock('../../src/services/api', () => ({
    getBaseUrl: () => 'http://192.168.1.2:3005'
}));

vi.mock('../../src/config/supabaseConfig', () => ({
    getSupabaseStoragePublicUrl: () => null
}));

import { otaUpdateService, verifyOtaPackageIntegrity } from '../../src/services/otaUpdateService';

describe('Fase 2 — OTA Update Service (Verificación Híbrida RSA-SHA256 + SHA-256)', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const sampleZipBytes = Buffer.from('PK\x03\x04isaac-pos-ota-bundle-payload-2026-test');
    const validSha256 = crypto.createHash('sha256').update(sampleZipBytes).digest('hex');
    const validSignature = crypto.sign('sha256', sampleZipBytes, privateKey).toString('base64');

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isNative = true;
        mocks.current.mockResolvedValue({ bundle: { version: '24.4.0.100' } });
        mocks.download.mockResolvedValue({ id: 'bundle-new-200', version: '24.4.0.200' });
        mocks.set.mockResolvedValue();
        localStorage.clear();
    });

    it('acepta paquete OTA firmado con RSA-SHA256 válida y checksum SHA-256 correcto', async () => {
        const res = await verifyOtaPackageIntegrity(
            sampleZipBytes,
            { checksum: validSha256, otaSignature: validSignature },
            { publicKeyPem: publicKey }
        );
        expect(res).toEqual({ verified: true, mode: 'rsa-sha256' });

        mocks.axiosGet
            .mockResolvedValueOnce({
                data: {
                    version: '24.4.0.200',
                    bundleUrl: '/dist.zip',
                    checksum: validSha256,
                    otaSignature: validSignature
                }
            })
            .mockResolvedValueOnce({
                data: sampleZipBytes.buffer.slice(sampleZipBytes.byteOffset, sampleZipBytes.byteOffset + sampleZipBytes.byteLength)
            });

        const updateRes = await otaUpdateService.checkForUpdates({
            silent: true,
            immediate: false,
            publicKeyPem: publicKey
        });

        expect(updateRes.updateAvailable).toBe(true);
        expect(updateRes.verificationMode).toBe('rsa-sha256');
        expect(mocks.download).toHaveBeenCalledTimes(1);
        expect(mocks.set).toHaveBeenCalledWith({ id: 'bundle-new-200', version: '24.4.0.200' });
    });

    it('rechaza paquete OTA si la firma RSA-SHA256 está adulterada y bloquea CapacitorUpdater', async () => {
        const tamperedSig = Buffer.from(validSignature, 'base64');
        tamperedSig[0] ^= 0xff;
        const badSignature = tamperedSig.toString('base64');

        mocks.axiosGet
            .mockResolvedValueOnce({
                data: {
                    version: '24.4.0.201',
                    bundleUrl: '/dist.zip',
                    checksum: validSha256,
                    otaSignature: badSignature
                }
            })
            .mockResolvedValueOnce({
                data: sampleZipBytes.buffer.slice(sampleZipBytes.byteOffset, sampleZipBytes.byteOffset + sampleZipBytes.byteLength)
            });

        const updateRes = await otaUpdateService.checkForUpdates({
            silent: true,
            immediate: false,
            publicKeyPem: publicKey
        });

        expect(updateRes.updateAvailable).toBe(false);
        expect(updateRes.error?.message).toMatch(/Firma criptográfica RSA-SHA256/i);
        expect(mocks.download).not.toHaveBeenCalled();
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('rechaza paquete OTA si los bytes no coinciden con el checksum SHA-256 declarado', async () => {
        const corruptedBytes = Buffer.from('PK\x03\x04corrupted-zip-data');
        await expect(
            verifyOtaPackageIntegrity(
                corruptedBytes,
                { checksum: validSha256, otaSignature: validSignature },
                { publicKeyPem: publicKey }
            )
        ).rejects.toThrow(/SHA-256/i);
    });

    it('mantiene el fallback LAN por SHA-256 cuando version.json no incluye otaSignature', async () => {
        mocks.axiosGet.mockResolvedValueOnce({
            data: {
                version: '24.4.0.202',
                bundleUrl: '/dist.zip',
                checksum: validSha256
            }
        });

        const updateRes = await otaUpdateService.checkForUpdates({
            silent: true,
            immediate: false
        });

        expect(updateRes.updateAvailable).toBe(true);
        expect(updateRes.verificationMode).toBe('sha256-only');
        // No descarga doble en LAN sin firma RSA: delega directo a CapacitorUpdater con checksum SHA-256
        expect(mocks.axiosGet).toHaveBeenCalledTimes(1);
        expect(mocks.download).toHaveBeenCalledWith({
            url: 'http://192.168.1.2:3005/dist.zip',
            version: '24.4.0.202',
            checksum: validSha256
        });
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });
});
