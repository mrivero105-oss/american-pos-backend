const path = require('path');
const fs = require('fs');
const { BASE_PATH } = require('../config/paths');

const BLOAT_SESSION_ROOT_DIRS = [
    'component_crx_cache',
    'WasmTtsEngine',
    'CertificateRevocation',
    'OnDeviceHeadSuggestModel',
    'ActorSafetyLists',
    'hyphen-data',
    'ZxcvbnData',
    'GrShaderCache',
    'ShaderCache',
    'Subresource Filter',
    'PKIMetadata',
    'Crowd Deny',
    'SafetyTips',
    'OptimizationGuideModelsManifest',
    'segmentation_platform',
    'Crashpad'
];

const BLOAT_DEFAULT_PROFILE_DIRS = [
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Segmentation Platform'
];

/**
 * Elimina archivos de bloqueo huérfanos de Chromium dentro del perfil de WhatsApp.
 */
function cleanLockFiles(dir) {
    try {
        if (!dir || !fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                cleanLockFiles(fullPath);
            } else if (entry.isFile() && (entry.name === 'LOCK' || entry.name.toLowerCase().includes('singletonlock'))) {
                try {
                    fs.unlinkSync(fullPath);
                    console.log(`[WHATSAPP] Removed stale lock: ${fullPath}`);
                } catch (_e) {}
            }
        }
    } catch (_e) {}
}

/**
 * Elimina cachés regenerables pesados de Chromium preservando IndexedDB, Local Storage y cookies.
 */
function pruneChromeBloatCache(authDataPath, { includeServiceWorkerCache = false } = {}) {
    const safeRemoveDir = (targetDir) => {
        try {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
        } catch (_e) {}
    };

    try {
        if (!authDataPath || !fs.existsSync(authDataPath)) return;
        const sessionEntries = fs.readdirSync(authDataPath, { withFileTypes: true })
            .filter(e => e.isDirectory() && e.name.startsWith('session'));

        for (const sessEntry of sessionEntries) {
            const sessionRoot = path.join(authDataPath, sessEntry.name);
            for (const dirName of BLOAT_SESSION_ROOT_DIRS) {
                safeRemoveDir(path.join(sessionRoot, dirName));
            }
            const defaultProfile = path.join(sessionRoot, 'Default');
            if (fs.existsSync(defaultProfile)) {
                for (const dirName of BLOAT_DEFAULT_PROFILE_DIRS) {
                    safeRemoveDir(path.join(defaultProfile, dirName));
                }
                if (includeServiceWorkerCache) {
                    safeRemoveDir(path.join(defaultProfile, 'Cache'));
                    safeRemoveDir(path.join(defaultProfile, 'Service Worker', 'CacheStorage'));
                    safeRemoveDir(path.join(defaultProfile, 'Service Worker', 'ScriptCache'));
                }
            }
        }
    } catch (_e) {}
}

/**
 * Detecta Google Chrome o Microsoft Edge instalado en el sistema Windows o vía CHROME_BIN.
 */
function getExecutablePath() {
    const localAppData = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const possiblePaths = [
        path.join(progFiles, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(progFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(progFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(progFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe'),
        process.env.CHROME_BIN
    ].filter(Boolean);

    for (const p of possiblePaths) {
        try {
            if (fs.existsSync(p)) return p;
        } catch (_e) {}
    }
    return undefined;
}

function getAuthDataPath() {
    return process.env.USER_DATA_PATH
        ? path.join(process.env.USER_DATA_PATH, '.wwebjs_auth')
        : path.join(BASE_PATH, '.wwebjs_auth');
}

function getSessionStatePath(authDataPath) {
    return path.join(authDataPath, '.session_state.json');
}

function readSessionState(authDataPath) {
    try {
        const statePath = getSessionStatePath(authDataPath);
        if (!fs.existsSync(statePath)) return null;
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_e) {
        return null;
    }
}

function writeSessionState(authDataPath, patch) {
    try {
        if (!fs.existsSync(authDataPath)) {
            fs.mkdirSync(authDataPath, { recursive: true });
        }
        const prev = readSessionState(authDataPath) || {};
        const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
        fs.writeFileSync(getSessionStatePath(authDataPath), JSON.stringify(next, null, 2), 'utf8');
    } catch (_e) {}
}

/**
 * Limpia y formatea un número telefónico para WhatsApp (ej: 04121234567 -> 584121234567)
 */
function cleanPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned) return '';

    if (cleaned.startsWith('0') && cleaned.length >= 10) {
        cleaned = '58' + cleaned.substring(1);
    }
    if (cleaned.length === 10 && (
        cleaned.startsWith('412') ||
        cleaned.startsWith('414') ||
        cleaned.startsWith('424') ||
        cleaned.startsWith('416') ||
        cleaned.startsWith('426')
    )) {
        cleaned = '58' + cleaned;
    }
    return cleaned;
}

/**
 * Formatea una orden de compra en un mensaje profesional de WhatsApp.
 */
function formatPurchaseOrderMessage({ orderId, businessName, supplierName, supplierContact, orderDate, items, total, notes, referenceNumber }) {
    const orderShort = orderId ? `#${orderId.slice(0, 8).toUpperCase()}` : '#NUEVO';
    const dateStr = orderDate || new Date().toLocaleDateString('es-VE');
    const store = businessName || 'Isaac POS';

    let itemsList = '';
    if (Array.isArray(items)) {
        itemsList = items.map((item, idx) => {
            const qty = item.quantity || 1;
            const unitName = item.bulkUnitName ? ` (${item.bulkUnitName})` : '';
            const costStr = item.cost ? ` | Est: $${Number(item.cost).toFixed(2)}` : '';
            return `  ${idx + 1}. *${qty}* x ${item.name}${unitName}${costStr}`;
        }).join('\n');
    } else {
        itemsList = '  • Sin items especificados';
    }

    const totalFormatted = total ? `\n💵 *TOTAL ESTIMADO:* $${Number(total).toFixed(2)}` : '';
    const refFormatted = referenceNumber ? `\n🔖 *REFERENCIA / CONTROL:* ${referenceNumber}` : '';
    const notesFormatted = notes ? `\n📌 *NOTAS:* ${notes}` : '\n📌 *INDICACIONES:* Por favor confirmar disponibilidad, recepción y tiempo estimado de entrega.';

    return `📦 *ORDEN DE COMPRA - ${store.toUpperCase()}*\n` +
           `🔢 *Nº ORDEN:* ${orderShort}\n` +
           `👤 *PROVEEDOR:* ${supplierName || 'Proveedor'}${supplierContact ? ` (Atenc: ${supplierContact})` : ''}\n` +
           `📅 *FECHA:* ${dateStr}` +
           `${refFormatted}\n\n` +
           `🛒 *DETALLE DE PRODUCTOS:* \n${itemsList}\n` +
           `${totalFormatted}\n` +
           `${notesFormatted}\n\n` +
           `_Mensaje generado automáticamente desde Isaac POS_`;
}

module.exports = {
    cleanLockFiles,
    pruneChromeBloatCache,
    getExecutablePath,
    getAuthDataPath,
    getSessionStatePath,
    readSessionState,
    writeSessionState,
    cleanPhoneNumber,
    formatPurchaseOrderMessage
};
