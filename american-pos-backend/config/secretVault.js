const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BASE_PATH } = require('./paths');
const {
    defaultMachineMaterial,
    protectString,
    unprotectString
} = require('../utils/dpapiCrypto');

const VAULT_FILE_NAME = 'secrets.vault.json';
const VAULT_DPAPI_KEY_NAME = '.secrets.key.dpapi';
const MIGRATION_BANNER = '# Secretos cifrados migrados a secrets.vault.json (DPAPI)';

// Caché en memoria por baseDir para evitar re-leer/descifrar en arranque duplicado (main.js -> index.js)
const vaultReadCache = new Map(); // vaultPath -> { mtimeMs, secrets }
const provisionFastPathCache = new Map(); // baseDir -> { vaultMtimeMs, envSignature, secrets, totalSecrets }

const SECRET_ENV_KEYS = new Set([
    'JWT_SECRET',
    'SYNC_SECRET_KEY',
    'BACKUP_ENCRYPTION_KEY',
    'AUDIT_HMAC_SECRET',
    'OWNER_SECRET_KEY',
    'LEGACY_HMAC_SECRET',
    'LICENSE_LEGACY_SECRET',
    'LICENSE_PUBLIC_KEY_PEM',
    'LICENSE_PRIVATE_KEY_PEM',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_KEY',
    'POS_BRANCH_ID',
    'EMAIL_PASS',
    'DB_PASSWORD',
    'DB_PASS',
    'INITIAL_ADMIN_PASSWORD',
    'LAN_CLUSTER_SECRET'
]);

function resolveVaultDir(options = {}) {
    return path.resolve(options.baseDir || BASE_PATH);
}

function getVaultPaths(options = {}) {
    const baseDir = resolveVaultDir(options);
    return {
        baseDir,
        vaultPath: path.join(baseDir, VAULT_FILE_NAME),
        keyFilePath: path.join(baseDir, VAULT_DPAPI_KEY_NAME)
    };
}

function getVaultCryptoOptions(options = {}) {
    const { baseDir, keyFilePath } = getVaultPaths(options);
    const explicitKey = process.env.SECRET_VAULT_KEY ? String(process.env.SECRET_VAULT_KEY).trim() : '';
    return {
        keyFilePath,
        fallbackMaterial: explicitKey || defaultMachineMaterial(baseDir, 'isaac-secret-vault-v1'),
        fallbackSalt: 'isaac-pos-secrets-salt-2026',
        skipIfEnvKey: false,
        allowSafeStorageFallback: true
    };
}

function parseEnvContent(rawContent) {
    const parsed = {};
    if (!rawContent || typeof rawContent !== 'string') return parsed;

    const lines = rawContent.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
            (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
        ) {
            val = val.slice(1, -1);
        }
        parsed[key] = val;
    }
    return parsed;
}

function stripKeysFromEnvContent(rawContent, keysToRemove) {
    if (!rawContent || typeof rawContent !== 'string' || !keysToRemove || keysToRemove.size === 0) {
        return { content: rawContent || '', removedKeys: [] };
    }
    const eol = rawContent.includes('\r\n') ? '\r\n' : '\n';
    const lines = rawContent.split(/\r?\n/);
    const keptLines = [];
    const removedKeys = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx).trim();
                if (keysToRemove.has(key)) {
                    removedKeys.push(key);
                    continue;
                }
            }
        }
        keptLines.push(line);
    }

    if (removedKeys.length === 0) {
        return { content: rawContent, removedKeys: [] };
    }

    const cleaned = keptLines
        .filter((line, idx, arr) => !(line.trim() === '' && idx > 0 && arr[idx - 1].trim() === ''))
        .join(eol)
        .trimEnd();

    const hasBanner = cleaned.includes(MIGRATION_BANNER);
    const body = hasBanner ? cleaned : (cleaned ? `${MIGRATION_BANNER}${eol}${cleaned}` : MIGRATION_BANNER);
    return {
        content: body + eol,
        removedKeys
    };
}

function readVaultSecrets(options = {}) {
    const { vaultPath } = getVaultPaths(options);
    if (!fs.existsSync(vaultPath)) return {};

    let statMtime = 0;
    try {
        statMtime = fs.statSync(vaultPath).mtimeMs || 0;
        const cached = vaultReadCache.get(vaultPath);
        if (cached && cached.mtimeMs === statMtime) {
            return { ...cached.secrets };
        }
    } catch (_) {}

    const raw = fs.readFileSync(vaultPath, 'utf8');
    if (!raw.trim()) return {};

    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object') return {};

    let result = {};
    if (doc.encrypted && doc.cipher && doc.scheme) {
        const plainJson = unprotectString(doc.cipher, doc.scheme, getVaultCryptoOptions(options));
        if (!plainJson) return {};
        const parsed = JSON.parse(plainJson);
        result = parsed && typeof parsed === 'object' ? parsed : {};
    } else if (doc.secrets && typeof doc.secrets === 'object') {
        result = { ...doc.secrets };
    }

    if (Object.keys(result).length > 0 && statMtime) {
        vaultReadCache.set(vaultPath, { mtimeMs: statMtime, secrets: { ...result } });
    }
    return result;
}

function writeVaultSecrets(secretsObj = {}, options = {}) {
    const { baseDir, vaultPath } = getVaultPaths(options);
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    const sanitized = {};
    for (const [key, val] of Object.entries(secretsObj || {})) {
        if (typeof val === 'string' && val.trim().length > 0) {
            sanitized[key] = val;
        }
    }

    const cryptoMeta = protectString(JSON.stringify(sanitized), getVaultCryptoOptions(options));
    const diskPayload = {
        version: 1,
        encrypted: true,
        scheme: cryptoMeta.scheme,
        cipher: cryptoMeta.cipher,
        keys: Object.keys(sanitized).sort(),
        updatedAt: new Date().toISOString()
    };

    const tempPath = `${vaultPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(diskPayload, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, vaultPath);
    try {
        const st = fs.statSync(vaultPath);
        vaultReadCache.set(vaultPath, { mtimeMs: st.mtimeMs || 0, secrets: { ...sanitized } });
    } catch (_) {
        vaultReadCache.delete(vaultPath);
    }
    provisionFastPathCache.delete(baseDir);
    return { vaultPath, scheme: cryptoMeta.scheme, keys: diskPayload.keys };
}

function getSecret(key, options = {}) {
    if (!key) return null;
    if (process.env[key] && String(process.env[key]).trim().length > 0) {
        return String(process.env[key]);
    }
    try {
        const vault = readVaultSecrets(options);
        if (vault[key] && String(vault[key]).trim().length > 0) {
            return String(vault[key]);
        }
    } catch (_) {}
    return null;
}

function setSecret(key, value, options = {}) {
    if (!key) throw new Error('Nombre de secreto requerido');
    let current = {};
    try {
        current = readVaultSecrets(options);
    } catch (_) {
        current = {};
    }
    const next = { ...current };
    if (value === null || value === undefined || String(value).trim().length === 0) {
        delete next[key];
    } else {
        next[key] = String(value);
    }
    const writeRes = writeVaultSecrets(next, options);
    if (next[key]) {
        process.env[key] = next[key];
    } else {
        delete process.env[key];
    }
    return writeRes;
}

/**
 * Carga la bóveda DPAPI, migra secretos presentes en archivos .env autorizados (p.ej. AppData),
 * verifica la lectura cifrada antes de limpiar líneas sensibles de esos .env,
 * y provisiona cualquier secreto requerido faltante directamente en la bóveda DPAPI.
 */
function provisionAndLoadSecrets(options = {}) {
    const {
        baseDir = BASE_PATH,
        requiredKeys = ['JWT_SECRET', 'SYNC_SECRET_KEY', 'BACKUP_ENCRYPTION_KEY', 'AUDIT_HMAC_SECRET'],
        candidateEnvPaths = [],
        migrateEnvPaths = [],
        stripMigratedEnv = true,
        overwriteProcessEnv = false
    } = options;

    const vaultOpts = { baseDir };
    const resolvedBaseDir = resolveVaultDir(vaultOpts);
    const { vaultPath } = getVaultPaths(vaultOpts);

    // Fast-path: si este mismo proceso ya aprovisionó esta bóveda, los archivos no cambiaron y todas las claves siguen en process.env
    try {
        const cachedProv = provisionFastPathCache.get(resolvedBaseDir);
        if (cachedProv && !overwriteProcessEnv && fs.existsSync(vaultPath)) {
            const currentVaultMtime = fs.statSync(vaultPath).mtimeMs || 0;
            const envSig = (candidateEnvPaths || [])
                .filter(Boolean)
                .map((p) => {
                    const abs = path.resolve(p);
                    return fs.existsSync(abs) ? `${abs}:${fs.statSync(abs).mtimeMs}` : `${abs}:0`;
                })
                .join('|');
            const allRequiredInEnv = (requiredKeys || []).every((k) => process.env[k] && String(process.env[k]).trim().length > 0);
            const allVaultSecretsInEnv = cachedProv.secretKeys.every((k) => process.env[k] && String(process.env[k]).trim().length > 0);
            if (currentVaultMtime === cachedProv.vaultMtimeMs && envSig === cachedProv.envSignature && allRequiredInEnv && allVaultSecretsInEnv) {
                return {
                    baseDir: resolvedBaseDir,
                    vaultPath,
                    scheme: null,
                    generatedKeys: [],
                    strippedFiles: [],
                    totalSecrets: cachedProv.totalSecrets
                };
            }
        }
    } catch (_) {}
    const migrateSet = new Set(
        (migrateEnvPaths || [])
            .filter(Boolean)
            .map((p) => path.resolve(p).toLowerCase())
    );

    let vaultExistsWithCipher = false;
    try {
        if (fs.existsSync(vaultPath)) {
            const rawExisting = fs.readFileSync(vaultPath, 'utf8').trim();
            if (rawExisting) {
                const parsedDoc = JSON.parse(rawExisting);
                vaultExistsWithCipher = Boolean(parsedDoc && parsedDoc.encrypted && parsedDoc.cipher);
            }
        }
    } catch (_) {}

    let vaultData = {};
    let vaultDirty = false;
    let vaultReadFailed = false;
    try {
        vaultData = readVaultSecrets(vaultOpts);
        if (vaultExistsWithCipher && Object.keys(vaultData).length === 0) {
            vaultReadFailed = true;
        }
    } catch (err) {
        console.warn('[SecretVault] Aviso leyendo bóveda DPAPI:', err.message);
        vaultData = {};
        if (vaultExistsWithCipher) {
            vaultReadFailed = true;
        }
    }

    const envSnapshots = [];
    const seenPaths = new Set();
    for (const rawEnvPath of candidateEnvPaths || []) {
        if (!rawEnvPath) continue;
        const absPath = path.resolve(rawEnvPath);
        const normKey = absPath.toLowerCase();
        if (seenPaths.has(normKey)) continue;
        seenPaths.add(normKey);
        if (!fs.existsSync(absPath)) continue;

        try {
            const rawContent = fs.readFileSync(absPath, 'utf8');
            const parsed = parseEnvContent(rawContent);
            const isMigratable = migrateSet.has(normKey);
            const migratedFromFile = new Set();

            for (const [k, v] of Object.entries(parsed)) {
                if (!v || String(v).trim().length === 0) continue;
                if (SECRET_ENV_KEYS.has(k)) {
                    if (!vaultData[k]) {
                        vaultData[k] = v;
                        vaultDirty = true;
                    }
                    if (isMigratable) {
                        migratedFromFile.add(k);
                    }
                    if (overwriteProcessEnv || !process.env[k]) {
                        process.env[k] = v;
                    }
                } else if (overwriteProcessEnv || !process.env[k]) {
                    process.env[k] = v;
                }
            }

            if (isMigratable && migratedFromFile.size > 0) {
                envSnapshots.push({ absPath, rawContent, migratedFromFile });
            }
        } catch (err) {
            console.warn(`[SecretVault] Aviso procesando .env (${absPath}):`, err.message);
        }
    }

    for (const [k, v] of Object.entries(vaultData)) {
        if (typeof v === 'string' && v.trim().length > 0 && (overwriteProcessEnv || !process.env[k])) {
            process.env[k] = v;
        }
    }

    const generatedKeys = [];
    for (const reqKey of requiredKeys || []) {
        if (process.env[reqKey] && String(process.env[reqKey]).trim().length > 0) {
            continue;
        }
        const generated = crypto.randomBytes(32).toString('hex');
        process.env[reqKey] = generated;
        vaultData[reqKey] = generated;
        vaultDirty = true;
        generatedKeys.push(reqKey);
    }

    let writeResult = null;
    let verifiedClean = !vaultReadFailed;
    if (vaultDirty && !vaultReadFailed) {
        writeResult = writeVaultSecrets(vaultData, vaultOpts);
        const verifyRead = readVaultSecrets(vaultOpts);
        for (const [k, expectedVal] of Object.entries(vaultData)) {
            if (verifyRead[k] !== expectedVal) {
                verifiedClean = false;
                throw new Error(`Fallo verificación de integridad al escribir secrets.vault.json para clave ${k}`);
            }
        }
    }

    const strippedFiles = [];
    if (stripMigratedEnv && verifiedClean && !vaultReadFailed && envSnapshots.length > 0) {
        const verifiedVault = readVaultSecrets(vaultOpts);
        for (const snap of envSnapshots) {
            const safeToStrip = new Set();
            for (const keyName of snap.migratedFromFile) {
                if (typeof verifiedVault[keyName] === 'string' && verifiedVault[keyName].length > 0) {
                    safeToStrip.add(keyName);
                }
            }
            if (safeToStrip.size === 0) continue;

            const { content: strippedContent, removedKeys } = stripKeysFromEnvContent(snap.rawContent, safeToStrip);
            if (removedKeys.length > 0) {
                const tmpEnv = `${snap.absPath}.tmp`;
                fs.writeFileSync(tmpEnv, strippedContent, { encoding: 'utf8', mode: 0o600 });
                fs.renameSync(tmpEnv, snap.absPath);
                strippedFiles.push({ path: snap.absPath, removedKeys });
            }
        }
    }

    try {
        const finalVaultMtime = fs.existsSync(vaultPath) ? (fs.statSync(vaultPath).mtimeMs || 0) : 0;
        const finalEnvSig = (candidateEnvPaths || [])
            .filter(Boolean)
            .map((p) => {
                const abs = path.resolve(p);
                return fs.existsSync(abs) ? `${abs}:${fs.statSync(abs).mtimeMs}` : `${abs}:0`;
            })
            .join('|');
        const secretKeys = Object.entries(vaultData)
            .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
            .map(([k]) => k);
        provisionFastPathCache.set(resolvedBaseDir, {
            vaultMtimeMs: finalVaultMtime,
            envSignature: finalEnvSig,
            secretKeys,
            totalSecrets: Object.keys(vaultData).length
        });
    } catch (_) {}

    return {
        baseDir: resolvedBaseDir,
        vaultPath,
        scheme: writeResult ? writeResult.scheme : null,
        generatedKeys,
        strippedFiles,
        totalSecrets: Object.keys(vaultData).length
    };
}

module.exports = {
    SECRET_ENV_KEYS,
    VAULT_FILE_NAME,
    VAULT_DPAPI_KEY_NAME,
    parseEnvContent,
    stripKeysFromEnvContent,
    getVaultPaths,
    readVaultSecrets,
    writeVaultSecrets,
    getSecret,
    setSecret,
    provisionAndLoadSecrets
};
