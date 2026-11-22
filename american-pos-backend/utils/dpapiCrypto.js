const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const dpapiKeyCache = new Map();
const dpapiProbeFailed = new Set();
const localAesKeyCache = new Map();

function getElectronSafeStorage() {
    try {
        if (process.versions && process.versions.electron) {
            const electron = require('electron');
            if (electron && electron.safeStorage && typeof electron.safeStorage.isEncryptionAvailable === 'function') {
                if (electron.safeStorage.isEncryptionAvailable()) {
                    return electron.safeStorage;
                }
            }
        }
    } catch (_) {}
    return null;
}

function runWindowsDpapiPs(psScript, inputStr = null) {
    if (process.platform !== 'win32') return null;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    return execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        {
            input: inputStr || undefined,
            encoding: 'utf8',
            timeout: 12000,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        }
    ).trim();
}

function writeElectronDpapiSidecar(resolvedKeyPath, protectedB64, keyBuf, safeStorage) {
    if (!safeStorage || !resolvedKeyPath || !protectedB64 || !Buffer.isBuffer(keyBuf) || keyBuf.length !== 32) {
        return;
    }
    try {
        const dpapiSha256 = crypto.createHash('sha256').update(String(protectedB64), 'utf8').digest('hex');
        const essBuf = safeStorage.encryptString(keyBuf.toString('hex'));
        const payload = JSON.stringify({
            v: 1,
            dpapiSha256,
            essB64: Buffer.from(essBuf).toString('base64')
        });
        const sidecarPath = `${resolvedKeyPath}.ess`;
        const tmpSidecar = `${sidecarPath}.tmp`;
        fs.writeFileSync(tmpSidecar, payload, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmpSidecar, sidecarPath);
    } catch (_) {}
}

function readElectronDpapiSidecar(resolvedKeyPath, protectedB64, safeStorage) {
    if (!safeStorage || !resolvedKeyPath || !protectedB64) return null;
    const sidecarPath = `${resolvedKeyPath}.ess`;
    try {
        if (!fs.existsSync(sidecarPath)) return null;
        const parsed = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
        if (!parsed || !parsed.dpapiSha256 || !parsed.essB64) return null;
        const currentSha = crypto.createHash('sha256').update(String(protectedB64), 'utf8').digest('hex');
        if (parsed.dpapiSha256 !== currentSha) return null;
        const hexKey = safeStorage.decryptString(Buffer.from(String(parsed.essB64), 'base64'));
        const keyBuf = Buffer.from(String(hexKey || '').trim(), 'hex');
        return keyBuf.length === 32 ? keyBuf : null;
    } catch (_) {
        return null;
    }
}

/**
 * Obtiene o genera una clave AES-256 de 32 bytes protegida en disco mediante Windows DPAPI (CurrentUser),
 * completamente interoperable entre Electron (main.js) y Node puro (Edición Ultra / CLI).
 * En Electron, acelera arranques posteriores mediante un sidecar cifrado con safeStorage nativo (< 1 ms)
 * sin lanzar procesos PowerShell síncronos.
 */
function getOrCreateSharedDpapiAesKey(keyFilePath, { allowCreate = true, skipIfEnvKey = false } = {}) {
    if (!keyFilePath) return null;
    const resolvedKeyPath = path.resolve(keyFilePath);
    if (dpapiKeyCache.has(resolvedKeyPath)) {
        return dpapiKeyCache.get(resolvedKeyPath);
    }

    const isTestMode = process.env.ISAAC_TEST_ISOLATED === '1' || process.env.NODE_ENV === 'test';
    const hasExistingDpapiKeyFile = !allowCreate && fs.existsSync(resolvedKeyPath);
    if (
        process.platform !== 'win32' ||
        (skipIfEnvKey && process.env.DB_CONFIG_KEY) ||
        (isTestMode && process.env.FORCE_DPAPI_IN_TEST !== '1' && !hasExistingDpapiKeyFile)
    ) {
        return null;
    }

    if (dpapiProbeFailed.has(resolvedKeyPath) && !fs.existsSync(resolvedKeyPath)) {
        return null;
    }

    const safeStorage = getElectronSafeStorage();

    try {
        if (fs.existsSync(resolvedKeyPath)) {
            const protectedB64 = fs.readFileSync(resolvedKeyPath, 'utf8').trim();
            if (protectedB64) {
                // Fast-path en Electron: usar safeStorage nativo en C++ si existe sidecar sincronizado
                const fastKeyBuf = readElectronDpapiSidecar(resolvedKeyPath, protectedB64, safeStorage);
                if (fastKeyBuf) {
                    dpapiKeyCache.set(resolvedKeyPath, fastKeyBuf);
                    return fastKeyBuf;
                }

                const unprotectScript = `
                    Add-Type -AssemblyName System.Security;
                    $in = [Console]::In.ReadToEnd().Trim();
                    $enc = [Convert]::FromBase64String($in);
                    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
                    [Console]::Out.Write([Convert]::ToBase64String($dec));
                `;
                const rawB64 = runWindowsDpapiPs(unprotectScript, protectedB64);
                const keyBuf = Buffer.from(rawB64, 'base64');
                if (keyBuf.length === 32) {
                    dpapiKeyCache.set(resolvedKeyPath, keyBuf);
                    writeElectronDpapiSidecar(resolvedKeyPath, protectedB64, keyBuf, safeStorage);
                    return keyBuf;
                }
            }
        }

        if (!allowCreate) return null;

        const parentDir = path.dirname(resolvedKeyPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        const newKey = crypto.randomBytes(32);
        const protectScript = `
            Add-Type -AssemblyName System.Security;
            $in = [Console]::In.ReadToEnd().Trim();
            $raw = [Convert]::FromBase64String($in);
            $enc = [System.Security.Cryptography.ProtectedData]::Protect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
            [Console]::Out.Write([Convert]::ToBase64String($enc));
        `;
        const encB64 = runWindowsDpapiPs(protectScript, newKey.toString('base64'));
        if (encB64) {
            const tmpKeyPath = `${resolvedKeyPath}.tmp`;
            fs.writeFileSync(tmpKeyPath, encB64, { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(tmpKeyPath, resolvedKeyPath);
            dpapiKeyCache.set(resolvedKeyPath, newKey);
            writeElectronDpapiSidecar(resolvedKeyPath, encB64, newKey, safeStorage);
            return newKey;
        }
    } catch (_) {
        dpapiProbeFailed.add(resolvedKeyPath);
    }
    dpapiProbeFailed.add(resolvedKeyPath);
    return null;
}

function getLocalDerivedAesKey(materialInput, salt = 'isaac-pos-dpapi-salt-2026') {
    const cacheKey = `${salt}|${materialInput}`;
    if (localAesKeyCache.has(cacheKey)) {
        return localAesKeyCache.get(cacheKey);
    }
    const derived = crypto.scryptSync(String(materialInput), String(salt), 32);
    localAesKeyCache.set(cacheKey, derived);
    return derived;
}

function defaultMachineMaterial(baseDir, tag = 'isaac-cfg-v1') {
    return `${os.hostname()}|${process.platform}|${process.arch}|${baseDir}|${tag}`;
}

function encryptAes256GcmRaw(plainText, keyBuf, schemeName = 'aes256gcm') {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        encrypted: true,
        scheme: schemeName,
        cipher: `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
    };
}

function decryptAes256GcmRaw(cipherStr, keyBuf) {
    const parts = String(cipherStr || '').split(':');
    if (parts.length !== 3) {
        throw new Error('Formato de cifra AES-256-GCM inválido');
    }
    const [ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
}

function protectString(plainText, options = {}) {
    const {
        keyFilePath,
        fallbackMaterial,
        fallbackSalt = 'isaac-pos-dpapi-salt-2026',
        skipIfEnvKey = false,
        allowSafeStorageFallback = true,
        allowInsecureFallback = false
    } = options;

    const raw = plainText === undefined || plainText === null ? '' : String(plainText);
    if (!raw) {
        return { encrypted: true, scheme: 'empty', cipher: '' };
    }

    const sharedDpapiKey = getOrCreateSharedDpapiAesKey(keyFilePath, { allowCreate: true, skipIfEnvKey });
    if (sharedDpapiKey) {
        return encryptAes256GcmRaw(raw, sharedDpapiKey, 'aes256gcm_dpapi');
    }

    if (allowSafeStorageFallback) {
        const safeStorage = getElectronSafeStorage();
        if (safeStorage) {
            const encBuf = safeStorage.encryptString(raw);
            return {
                encrypted: true,
                scheme: 'dpapi',
                cipher: encBuf.toString('base64')
            };
        }
    }

    const isTestMode = (options.forceNonTest !== true) && (process.env.ISAAC_TEST_ISOLATED === '1' || process.env.NODE_ENV === 'test');
    const envInsecureOptIn = process.env.DPAPI_ALLOW_INSECURE_FALLBACK === 'true';
    const hasExplicitDbKey = Boolean(skipIfEnvKey && process.env.DB_CONFIG_KEY);
    if (process.platform === 'win32' && !isTestMode && !allowInsecureFallback && !envInsecureOptIn && !hasExplicitDbKey) {
        throw new Error('WINDOWS_DPAPI_UNAVAILABLE: No fue posible proteger los secretos locales con Windows DPAPI.');
    }

    const material = fallbackMaterial || defaultMachineMaterial(path.dirname(keyFilePath || process.cwd()));
    return encryptAes256GcmRaw(raw, getLocalDerivedAesKey(material, fallbackSalt), 'aes256gcm');
}

function unprotectString(cipherStr, scheme, options = {}) {
    const {
        keyFilePath,
        fallbackMaterial,
        fallbackSalt = 'isaac-pos-dpapi-salt-2026',
        skipIfEnvKey = false
    } = options;

    if (scheme === 'empty') return '';
    if (!cipherStr) return undefined;

    if (scheme === 'aes256gcm_dpapi') {
        const sharedDpapiKey = getOrCreateSharedDpapiAesKey(keyFilePath, { allowCreate: false, skipIfEnvKey });
        if (!sharedDpapiKey) {
            throw new Error(`Clave maestra DPAPI (${path.basename(keyFilePath || 'dpapi.key')}) no disponible`);
        }
        return decryptAes256GcmRaw(cipherStr, sharedDpapiKey);
    }

    if (scheme === 'dpapi') {
        const safeStorage = getElectronSafeStorage();
        if (!safeStorage) {
            throw new Error('safeStorage DPAPI (solo Electron) no disponible para descifrar formato legado');
        }
        return safeStorage.decryptString(Buffer.from(String(cipherStr), 'base64'));
    }

    if (scheme === 'aes256gcm') {
        const material = fallbackMaterial || defaultMachineMaterial(path.dirname(keyFilePath || process.cwd()));
        return decryptAes256GcmRaw(cipherStr, getLocalDerivedAesKey(material, fallbackSalt));
    }

    throw new Error(`Esquema de cifrado desconocido: ${scheme}`);
}

function resetDpapiCacheForTests() {
    dpapiKeyCache.clear();
    dpapiProbeFailed.clear();
    localAesKeyCache.clear();
}

module.exports = {
    getElectronSafeStorage,
    getOrCreateSharedDpapiAesKey,
    getLocalDerivedAesKey,
    defaultMachineMaterial,
    encryptAes256GcmRaw,
    decryptAes256GcmRaw,
    protectString,
    unprotectString,
    resetDpapiCacheForTests
};
