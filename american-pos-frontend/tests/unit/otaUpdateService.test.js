import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import capCfg from '../../capacitor.config.json';

const mockUpdater = vi.hoisted(() => ({
  notifyAppReady: vi.fn().mockResolvedValue(undefined),
  current: vi.fn().mockResolvedValue({ bundle: { id: 'bundle-100', version: '24.4.0.100' }, native: '24.4.0' }),
  getNextBundle: vi.fn().mockResolvedValue(null),
  download: vi.fn().mockResolvedValue({ id: 'bundle-new-200', version: '24.4.0.200' }),
  next: vi.fn().mockResolvedValue({ id: 'bundle-new-200', version: '24.4.0.200' }),
  set: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn().mockResolvedValue(undefined),
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() })
}));

const mockAxiosGet = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true
  },
  registerPlugin: vi.fn(() => ({}))
}));

vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: mockUpdater
}));

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
    create: vi.fn(() => ({
      defaults: { baseURL: '', headers: { common: {} } },
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      },
      get: mockAxiosGet,
      post: vi.fn()
    }))
  }
}));

vi.mock('react-hot-toast', () => {
  const fn = vi.fn();
  fn.loading = vi.fn(() => 'toast-1');
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.dismiss = vi.fn();
  return { default: fn };
});

vi.mock('../../src/services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getBaseUrl: () => 'http://192.168.1.2:3005'
  };
});

vi.mock('../../src/config/supabaseConfig', () => ({
  getSupabaseStoragePublicUrl: () => null
}));

import {
  otaUpdateService,
  verifyOtaPackageIntegrity,
  compareOtaVersions,
  selectBestOtaCandidate,
  assertSafeOtaDownloadUrl
} from '../../src/services/otaUpdateService';

describe('Fase M2 — OTA Update Service (Firma RSA-SHA256 Obligatoria y Anti-Downgrade)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const sampleZipBytes = new Uint8Array(Buffer.from('PK\x03\x04isaac-pos-ota-bundle-valid-payload'));
  const validSha256 = crypto.createHash('sha256').update(sampleZipBytes).digest('hex');
  const validSignature = crypto.sign('sha256', Buffer.from(sampleZipBytes), privateKey).toString('base64');

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    delete globalThis.__ISAAC_MOBILE_BUILD_VERSION__;
    mockUpdater.current.mockResolvedValue({ bundle: { id: 'bundle-100', version: '24.4.0.100' }, native: '24.4.0' });
    mockUpdater.getNextBundle.mockResolvedValue(null);
  });

  it('compara versiones monotónicamente para prevenir downgrades', () => {
    expect(compareOtaVersions('24.4.0.200', '24.4.0.100')).toBeGreaterThan(0);
    expect(compareOtaVersions('24.4.0.100', '24.4.0.100')).toBe(0);
    expect(compareOtaVersions('24.4.0.99', '24.4.0.100')).toBeLessThan(0);
    expect(compareOtaVersions('24.3.9.999', '24.4.0.1')).toBeLessThan(0);
  });

  it('acepta paquete OTA firmado con RSA-SHA256 válida, firma de manifiesto y checksum SHA-256 correcto', async () => {
    const buildTime = '2026-11-24T05:00:00.000Z';
    const manifestCanonical = `24.4.0.200|${validSha256}|${buildTime}`;
    const otaManifestSignature = crypto.sign('sha256', Buffer.from(manifestCanonical, 'utf8'), privateKey).toString('base64');

    mockAxiosGet.mockImplementation(async (url) => {
      if (String(url).includes('/version.json')) {
        return {
          data: {
            version: '24.4.0.200',
            buildTime,
            bundleUrl: '/dist.zip',
            checksum: validSha256,
            otaSignature: validSignature,
            otaManifestSignature
          }
        };
      }
      if (String(url).includes('/dist.zip')) {
        return { data: sampleZipBytes.buffer };
      }
      throw new Error(`URL inesperada: ${url}`);
    });

    const result = await otaUpdateService.checkForUpdates({
      silent: true,
      publicKeyPem: publicKey
    });

    expect(result.updateAvailable).toBe(true);
    expect(result.verificationMode).toBe('rsa-sha256');
    expect(mockUpdater.download).toHaveBeenCalledWith(expect.objectContaining({
      version: '24.4.0.200',
      checksum: validSha256
    }));
    expect(mockUpdater.next).toHaveBeenCalledWith({ id: 'bundle-new-200' });
    expect(mockUpdater.set).not.toHaveBeenCalled();
  });

  it('rechaza paquete OTA si la firma RSA-SHA256 está adulterada y bloquea CapacitorUpdater', async () => {
    const tamperedBytes = new Uint8Array(Buffer.from('PK\x03\x04paquete-modificado-por-tercero'));
    const tamperedSha256 = crypto.createHash('sha256').update(tamperedBytes).digest('hex');

    mockAxiosGet.mockImplementation(async (url) => {
      if (String(url).includes('/version.json')) {
        return {
          data: {
            version: '24.4.0.201',
            bundleUrl: '/dist.zip',
            checksum: tamperedSha256,
            otaSignature: validSignature
          }
        };
      }
      if (String(url).includes('/dist.zip')) {
        return { data: tamperedBytes.buffer };
      }
      throw new Error(`URL inesperada: ${url}`);
    });

    const result = await otaUpdateService.checkForUpdates({
      silent: true,
      publicKeyPem: publicKey
    });

    expect(result.updateAvailable).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toContain('Firma criptográfica RSA-SHA256');
    expect(mockUpdater.download).not.toHaveBeenCalled();
    expect(mockUpdater.set).not.toHaveBeenCalled();
  });

  it('falla cerrado y rechaza manifiesto sin otaSignature (cierra bypass MITM en LAN HTTP)', async () => {
    mockAxiosGet.mockImplementation(async (url) => {
      if (String(url).includes('/version.json')) {
        return {
          data: {
            version: '24.4.0.202',
            bundleUrl: '/dist.zip',
            checksum: validSha256
          }
        };
      }
      throw new Error(`No debió descargar bundle sin firma: ${url}`);
    });

    const result = await otaUpdateService.checkForUpdates({
      silent: true,
      publicKeyPem: publicKey
    });

    expect(result.updateAvailable).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toContain('sin firma digital RSA-SHA256 obligatoria');
    expect(mockUpdater.download).not.toHaveBeenCalled();
    expect(mockUpdater.set).not.toHaveBeenCalled();
  });

  it('bloquea downgrade cuando la versión remota es menor a la instalada', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        version: '24.4.0.50',
        bundleUrl: '/dist.zip',
        checksum: validSha256,
        otaSignature: validSignature
      }
    });

    const result = await otaUpdateService.checkForUpdates({
      silent: true,
      publicKeyPem: publicKey
    });

    expect(result.updateAvailable).toBe(false);
    expect(result.downgradeBlocked).toBe(true);
    expect(mockUpdater.download).not.toHaveBeenCalled();
  });

  it('verifyOtaPackageIntegrity rechaza checksum SHA-256 corrupto o ausente', async () => {
    await expect(
      verifyOtaPackageIntegrity(
        sampleZipBytes,
        { checksum: '0'.repeat(64), otaSignature: validSignature },
        { publicKeyPem: publicKey }
      )
    ).rejects.toThrow(/Integridad SHA-256/i);

    await expect(
      verifyOtaPackageIntegrity(
        sampleZipBytes,
        { checksum: '', otaSignature: validSignature },
        { publicKeyPem: publicKey }
      )
    ).rejects.toThrow(/checksum SHA-256 válido/i);
  });

  it('selectBestOtaCandidate prioriza LAN PC cuando tiene mayor versión o empate y descarta manifiesto Cloud sin firma', () => {
    const unsignedCloud = {
      source: 'cloud',
      baseUrl: '',
      manifest: {
        version: '24.4.0.999',
        bundleUrl: 'https://cloud.example/dist.zip',
        checksum: validSha256
      }
    };
    const signedLan = {
      source: 'lan',
      baseUrl: 'http://192.168.1.2:3005',
      manifest: {
        version: '24.4.0.250',
        bundleUrl: '/dist.zip',
        checksum: validSha256,
        otaSignature: validSignature
      }
    };
    const signedCloudOlder = {
      source: 'cloud',
      baseUrl: '',
      manifest: {
        version: '24.4.0.200',
        bundleUrl: 'https://cloud.example/dist.zip',
        checksum: validSha256,
        otaSignature: validSignature
      }
    };
    const signedCloudSame = {
      source: 'cloud',
      baseUrl: '',
      manifest: {
        version: '24.4.0.250',
        bundleUrl: 'https://cloud.example/dist.zip',
        checksum: validSha256,
        otaSignature: validSignature
      }
    };

    expect(selectBestOtaCandidate([unsignedCloud, signedLan]).source).toBe('lan');
    expect(selectBestOtaCandidate([signedCloudOlder, signedLan]).manifest.version).toBe('24.4.0.250');
    expect(selectBestOtaCandidate([signedCloudSame, signedLan]).source).toBe('lan');
  });

  it('reconcileBuiltinApkVersion purga bundle OTA antiguo cuando se instala un APK nativo más reciente', async () => {
    localStorage.setItem('isaac_pos_native_apk_version_code', '240400');
    localStorage.setItem('isaac_pos_ota_version', '24.4.0.100');
    mockUpdater.current.mockResolvedValueOnce({
      bundle: { id: 'old-ota-bundle-100', version: '24.4.0.100' },
      native: '24.4.0'
    });

    const result = await otaUpdateService.reconcileBuiltinApkVersion({ embeddedVersionCode: 240401 });

    expect(result.purged).toBe(true);
    expect(mockUpdater.reset).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('isaac_pos_ota_version')).toBeNull();
    expect(localStorage.getItem('isaac_pos_native_apk_version_code')).toBe('240401');
  });

  it('subscribeUpdateReady notifica a la UI para mostrar el botón Reiniciar y aplicar', async () => {
    const listener = vi.fn();
    const unsub = otaUpdateService.subscribeUpdateReady(listener);

    mockAxiosGet.mockImplementation(async (url) => {
      if (String(url).includes('/version.json')) {
        return {
          data: {
            version: '24.4.0.300',
            bundleUrl: '/dist.zip',
            checksum: validSha256,
            otaSignature: validSignature
          }
        };
      }
      if (String(url).includes('/dist.zip')) {
        return { data: sampleZipBytes.buffer };
      }
      throw new Error(`URL inesperada: ${url}`);
    });

    await otaUpdateService.checkForUpdates({ silent: true, publicKeyPem: publicKey });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      ready: true,
      version: '24.4.0.300'
    }));
    unsub();
  });

  it('assertSafeOtaDownloadUrl permite HTTP en LAN privada RFC1918 y HTTPS público, pero rechaza HTTP público', () => {
    expect(assertSafeOtaDownloadUrl('http://192.168.1.2:3005/dist.zip')).toBe('http://192.168.1.2:3005/dist.zip');
    expect(assertSafeOtaDownloadUrl('http://10.0.0.5:3005/dist.zip')).toBe('http://10.0.0.5:3005/dist.zip');
    expect(assertSafeOtaDownloadUrl('https://demo.supabase.co/storage/v1/object/public/app-updates/dist.zip'))
      .toBe('https://demo.supabase.co/storage/v1/object/public/app-updates/dist.zip');
    expect(() => assertSafeOtaDownloadUrl('http://atacante.example.com/dist.zip')).toThrow(/insegura/i);
    expect(() => assertSafeOtaDownloadUrl('javascript:alert(1)')).toThrow(/insegura/i);
  });

  it('capacitor.config.json mantiene httpsOnly=false en CapacitorUpdater para permitir OTA desde PC LAN', () => {
    expect(capCfg?.plugins?.CapacitorUpdater?.httpsOnly).toBe(false);
    expect(capCfg?.plugins?.CapacitorUpdater?.statsUrl).toBe('');
    expect(capCfg?.plugins?.CapacitorUpdater?.resetWhenUpdate).toBe(true);
  });

  it('getCurrentVersion ignora centinela builtin y evita que un APK recién instalado descargue su propio OTA', async () => {
    globalThis.__ISAAC_MOBILE_BUILD_VERSION__ = '24.4.0.1795609017';
    mockUpdater.current.mockResolvedValue({
      bundle: { id: 'builtin', version: 'builtin' },
      native: '24.4.0'
    });

    const ver = await otaUpdateService.getCurrentVersion();
    expect(ver).toBe('24.4.0.1795609017');

    mockAxiosGet.mockResolvedValueOnce({
      data: {
        version: '24.4.0.1795609017',
        bundleUrl: '/dist.zip',
        checksum: validSha256,
        otaSignature: validSignature
      }
    });

    const res = await otaUpdateService.checkForUpdates({ silent: true, publicKeyPem: publicKey });
    expect(res.updateAvailable).toBe(false);
    expect(mockUpdater.download).not.toHaveBeenCalled();
    expect(mockUpdater.next).not.toHaveBeenCalled();
    expect(mockUpdater.set).not.toHaveBeenCalled();
  });

  it('no redescarga en bucle si la versión remota ya está en cola (getNextBundle)', async () => {
    mockUpdater.getNextBundle.mockResolvedValueOnce({
      id: 'bundle-staged-301',
      version: '24.4.0.301'
    });
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        version: '24.4.0.301',
        bundleUrl: '/dist.zip',
        checksum: validSha256,
        otaSignature: validSignature
      }
    });

    const res = await otaUpdateService.checkForUpdates({ silent: true, publicKeyPem: publicKey });
    expect(res.updateAvailable).toBe(true);
    expect(res.alreadyStaged).toBe(true);
    expect(mockUpdater.download).not.toHaveBeenCalled();
    expect(mockUpdater.set).not.toHaveBeenCalled();
  });
});
