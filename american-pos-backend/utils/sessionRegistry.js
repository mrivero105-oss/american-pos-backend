const crypto = require('crypto');

const MAX_CONCURRENT_SESSIONS = 6;
const MAX_COLUMN_LENGTH = 250;

/**
 * Genera un identificador de sesión compacto (29 chars, 96 bits de entropía CSPRNG)
 * para almacenar múltiples sesiones simultáneas por dispositivo en VARCHAR(255)
 * sin requerir cambios de esquema en PostgreSQL.
 */
function generateSessionId() {
    return `SESS-${crypto.randomBytes(12).toString('hex')}`;
}

function generateRevokedMarker() {
    return `REVOKED_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Extrae las sesiones activas válidas almacenadas en `Users.currentSessionId`.
 * Retrocompatible con una única sesión `SESS-<uuid>` y con marcadores `REVOKED_*`.
 */
function parseActiveSessions(storedValue) {
    if (!storedValue) return [];
    const raw = String(storedValue).trim();
    if (!raw || raw.startsWith('REVOKED_')) return [];
    return raw
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('REVOKED_'));
}

/**
 * Registra una nueva sesión activa conservando las de otros dispositivos del mismo usuario
 * (hasta `maxSessions`, expulsando la más antigua en modo FIFO si se excede el límite).
 */
function addSession(storedValue, newSessionId, maxSessions = MAX_CONCURRENT_SESSIONS) {
    const cleanNew = String(newSessionId || '').trim();
    if (!cleanNew) return storedValue ? String(storedValue) : null;

    const existing = parseActiveSessions(storedValue).filter((s) => s !== cleanNew);
    existing.push(cleanNew);

    const cap = Math.max(1, Number(maxSessions) || MAX_CONCURRENT_SESSIONS);
    while (existing.length > cap) {
        existing.shift();
    }
    while (existing.length > 1 && existing.join('|').length > MAX_COLUMN_LENGTH) {
        existing.shift();
    }
    return existing.join('|');
}

/**
 * Revoca únicamente el `sessionIdToRevoke` (logout de un dispositivo) o todas las sesiones
 * (`allDevices: true` al cambiar contraseña / desactivar cuenta). Si no quedan sesiones activas,
 * persiste un marcador `REVOKED_*` explícito.
 */
function revokeSession(storedValue, sessionIdToRevoke, options = {}) {
    const allDevices = Boolean(options && options.allDevices);
    const target = sessionIdToRevoke ? String(sessionIdToRevoke).trim() : '';
    if (allDevices || !target) {
        return generateRevokedMarker();
    }
    const remaining = parseActiveSessions(storedValue).filter((s) => s !== target);
    if (remaining.length === 0) {
        return generateRevokedMarker();
    }
    return remaining.join('|');
}

/**
 * Verifica si el `sessionId` del JWT corresponde a alguna sesión activa del usuario.
 */
function isSessionValid(storedValue, tokenSessionId) {
    const dbStr = storedValue ? String(storedValue).trim() : '';
    const tokStr = tokenSessionId ? String(tokenSessionId).trim() : '';
    if (!dbStr) {
        return !tokStr;
    }
    if (dbStr.startsWith('REVOKED_')) {
        return false;
    }
    if (!tokStr) {
        return false;
    }
    return parseActiveSessions(dbStr).includes(tokStr);
}

module.exports = {
    MAX_CONCURRENT_SESSIONS,
    generateSessionId,
    generateRevokedMarker,
    parseActiveSessions,
    addSession,
    revokeSession,
    isSessionValid
};
