import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'isaac_pos_mobile_diagnostics_v1';
const MAX_EVENTS = 300;
const MAX_MESSAGE_LEN = 500;
const MAX_STRING_LEN = 320;
const PERSIST_DEBOUNCE_MS = 600;

const SENSITIVE_KEY_PATTERN = /(pass(word|wd)?|token|auth(orization)?|secret|pin|cookie|private[_-]?key|api[_-]?key|sync[_-]?key|license[_-]?key|jwt|session[_-]?id|signature|credential|bearer|biometric|rif|cedula|dni|document[_-]?id|phone|telefono|email|correo)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const BASIC_AUTH_PATTERN = /\bBasic\s+[A-Za-z0-9+/=]{6,}/gi;
const COOKIE_HEADER_PATTERN = /\b((?:set-)?cookie\s*[:=]\s*)[^\r\n;\s]+/gi;
const HEADER_OR_ASSIGN_SECRET_PATTERN = /\b((?:x-sync-key|sync[_-]?key|license[_-]?key|password|passwd|pin|secret|api[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi;
const PEM_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g;
const QUERY_SECRET_PATTERN = /([?&](?:token|key|apikey|password|pin|secret|auth|sync_?key|license_?key)=)[^&\s]+/gi;
const EMAIL_PII_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RIF_CEDULA_PII_PATTERN = /\b[VEJPGvejpg]-?\d{6,9}(?:-\d)?\b/g;
const PHONE_PII_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?0?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|\b0?(?:412|414|416|424|426|2\d{2})[\s.-]?\d{7}\b)/g;

let ringBuffer = [];
let initializedFromStorage = false;
let globalHooksInstalled = false;
let persistTimer = null;
const subscribers = new Set();
let lastNetworkLatency = null;
const latencySubscribers = new Set();
const DEDUPE_WINDOW_MS = 120000;

export function recordNetworkLatency(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  lastNetworkLatency = {
    latencyMs: Math.max(1, Math.round(numeric)),
    updatedAt: Date.now()
  };
  for (const fn of latencySubscribers) {
    try {
      fn(lastNetworkLatency);
    } catch {
      // Ignorar errores de listeners UI
    }
  }
  return lastNetworkLatency;
}

export function getLastNetworkLatency() {
  return lastNetworkLatency ? { ...lastNetworkLatency } : null;
}

export function subscribeNetworkLatency(listener) {
  if (typeof listener !== 'function') return () => {};
  latencySubscribers.add(listener);
  return () => {
    latencySubscribers.delete(listener);
  };
}

export function redactSensitiveText(rawText) {
  if (rawText === null || rawText === undefined) return '';
  let out = String(rawText);
  out = out.replace(PEM_BLOCK_PATTERN, '[REDACTED_PEM_KEY]');
  out = out.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
  out = out.replace(BASIC_AUTH_PATTERN, 'Basic [REDACTED]');
  out = out.replace(COOKIE_HEADER_PATTERN, '$1[REDACTED]');
  out = out.replace(JWT_PATTERN, '[REDACTED_JWT]');
  out = out.replace(QUERY_SECRET_PATTERN, '$1[REDACTED]');
  out = out.replace(HEADER_OR_ASSIGN_SECRET_PATTERN, '$1[REDACTED]');
  out = out.replace(EMAIL_PII_PATTERN, '[REDACTED_EMAIL]');
  out = out.replace(RIF_CEDULA_PII_PATTERN, '[REDACTED_ID]');
  out = out.replace(PHONE_PII_PATTERN, '[REDACTED_PHONE]');
  if (out.length > MAX_MESSAGE_LEN) {
    out = `${out.slice(0, MAX_MESSAGE_LEN)}...`;
  }
  return out;
}

export function redactSensitiveData(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const clean = redactSensitiveText(value);
    return clean.length > MAX_STRING_LEN ? `${clean.slice(0, MAX_STRING_LEN)}...` : clean;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: redactSensitiveText(value.message || ''),
      code: value.code ? String(value.code) : undefined
    };
  }
  if (depth >= 4) {
    return '[MAX_DEPTH]';
  }
  if (typeof value !== 'object') {
    return redactSensitiveText(String(value));
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactSensitiveData(item, depth + 1, seen));
  }

  const sanitized = {};
  const entries = Object.entries(value).slice(0, 30);
  for (const [k, v] of entries) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = redactSensitiveData(v, depth + 1, seen);
    }
  }
  return sanitized;
}

function loadPersistedBuffer() {
  if (initializedFromStorage) return;
  initializedFromStorage = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      ringBuffer = parsed.slice(-MAX_EVENTS);
    }
  } catch {
    ringBuffer = [];
  }
}

function schedulePersist() {
  if (typeof localStorage === 'undefined') return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const payload = JSON.stringify(ringBuffer.slice(-MAX_EVENTS));
      // Limite preventivo ~240 KB para nunca saturar cuota localStorage
      if (payload.length <= 245000) {
        localStorage.setItem(STORAGE_KEY, payload);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ringBuffer.slice(-Math.floor(MAX_EVENTS / 2))));
      }
    } catch {
      // Ignorar errores de cuota en storage restringido
    }
  }, PERSIST_DEBOUNCE_MS);
}

function notifySubscribers() {
  const snapshot = ringBuffer.slice();
  for (const fn of subscribers) {
    try {
      fn(snapshot);
    } catch {
      // Ignorar errores de listeners UI
    }
  }
}

/**
 * Registra un evento diagnóstico sanitizado en la Caja Negra local.
 * @param {'info'|'warn'|'error'} level
 * @param {string} category Ej: 'ota' | 'network' | 'runtime' | 'printer' | 'sync' | 'auth'
 * @param {string} message
 * @param {unknown} [meta]
 */
export function recordDiagnosticEvent(level, category, message, meta = undefined) {
  loadPersistedBuffer();
  const normalizedLevel = level === 'error' || level === 'warn' ? level : 'info';
  const normalizedCategory = String(category || 'general').slice(0, 32);
  const cleanMessage = redactSensitiveText(message);
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const lastEntry = ringBuffer.length > 0 ? ringBuffer[ringBuffer.length - 1] : null;
  const lastEntryMs = lastEntry ? Date.parse(lastEntry.ts) : 0;
  if (
    lastEntry &&
    lastEntry.level === normalizedLevel &&
    lastEntry.category === normalizedCategory &&
    lastEntry.message === cleanMessage &&
    Number.isFinite(lastEntryMs) &&
    nowMs - lastEntryMs <= DEDUPE_WINDOW_MS
  ) {
    const prevCount = Number(lastEntry.meta?.repeatCount) || 1;
    const mergedMeta = {
      ...(lastEntry.meta && typeof lastEntry.meta === 'object' ? lastEntry.meta : {}),
      ...(meta !== undefined && typeof meta === 'object' && meta !== null ? redactSensitiveData(meta) : {}),
      repeatCount: prevCount + 1
    };
    const updatedEntry = {
      ...lastEntry,
      ts: nowIso,
      meta: mergedMeta
    };
    ringBuffer[ringBuffer.length - 1] = updatedEntry;
    schedulePersist();
    notifySubscribers();
    return updatedEntry;
  }

  const entry = {
    id: `${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ts: nowIso,
    level: normalizedLevel,
    category: normalizedCategory,
    message: cleanMessage,
    ...(meta !== undefined ? { meta: redactSensitiveData(meta) } : {})
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > MAX_EVENTS) {
    ringBuffer = ringBuffer.slice(-MAX_EVENTS);
  }
  schedulePersist();
  notifySubscribers();
  return entry;
}

export function getDiagnosticEvents(filter = {}) {
  loadPersistedBuffer();
  const { level = 'all', category = 'all', limit = MAX_EVENTS } = filter || {};
  let list = ringBuffer;
  if (level && level !== 'all') {
    list = list.filter((e) => e.level === level);
  }
  if (category && category !== 'all') {
    list = list.filter((e) => e.category === category);
  }
  return list.slice(-Math.max(1, limit)).reverse();
}

export function clearDiagnosticEvents() {
  ringBuffer = [];
  initializedFromStorage = true;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignorar error de storage
  }
  notifySubscribers();
}

export function subscribeDiagnosticEvents(listener) {
  loadPersistedBuffer();
  if (typeof listener !== 'function') return () => {};
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * Instala captura pasiva global (window.onerror, unhandledrejection, console.error/warn)
 * de forma idempotente y segura contra recursión.
 */
export function installGlobalErrorHooks() {
  loadPersistedBuffer();
  if (globalHooksInstalled || typeof window === 'undefined') {
    return false;
  }
  globalHooksInstalled = true;

  window.addEventListener('error', (event) => {
    const msg = event?.message || event?.error?.message || 'Error de ejecución no controlado';
    recordDiagnosticEvent('error', 'runtime', msg, {
      source: event?.filename ? String(event.filename).split('/').slice(-2).join('/') : undefined,
      line: event?.lineno,
      col: event?.colno
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const msg = reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : 'Promesa rechazada sin capturar';
    recordDiagnosticEvent('error', 'runtime', msg, {
      code: reason?.code,
      status: reason?.response?.status
    });
  });

  // Interceptar console.error y console.warn sin perder salida original ni entrar en recursión
  let insideConsoleHook = false;
  const origError = console.error?.bind(console);
  const origWarn = console.warn?.bind(console);

  if (origError) {
    console.error = (...args) => {
      origError(...args);
      if (insideConsoleHook) return;
      insideConsoleHook = true;
      try {
        const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? JSON.stringify(redactSensitiveData(a)) : String(a))).join(' ');
        const cat = /\[OTA_UPDATE\]|\[CapgoUpdater\]|CapacitorUpdater/i.test(text) ? 'ota'
          : /\[SyncManager\]|\[LAN_SYNC\]/i.test(text) ? 'sync'
            : /printer|bluetooth|escpos/i.test(text) ? 'printer'
              : /\[Auth\]|biometric/i.test(text) ? 'auth'
                : 'runtime';
        recordDiagnosticEvent('error', cat, text);
      } catch {
        // Nunca romper console.error
      } finally {
        insideConsoleHook = false;
      }
    };
  }

  if (origWarn) {
    console.warn = (...args) => {
      origWarn(...args);
      if (insideConsoleHook) return;
      insideConsoleHook = true;
      try {
        const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? JSON.stringify(redactSensitiveData(a)) : String(a))).join(' ');
        const cat = /\[OTA_UPDATE\]|\[CapgoUpdater\]|CapacitorUpdater/i.test(text) ? 'ota'
          : /\[SyncManager\]|\[LAN_SYNC\]/i.test(text) ? 'sync'
            : /printer|bluetooth/i.test(text) ? 'printer'
              : 'runtime';
        recordDiagnosticEvent('warn', cat, text);
      } catch {
        // Nunca romper console.warn
      } finally {
        insideConsoleHook = false;
      }
    };
  }

  recordDiagnosticEvent('info', 'runtime', 'Caja Negra de diagnóstico inicializada', {
    platform: Capacitor.getPlatform?.() || 'web',
    native: Boolean(Capacitor.isNativePlatform?.())
  });
  return true;
}

export async function collectDeviceHealthSnapshot(extra = {}) {
  let storageQuota = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      storageQuota = {
        usedMB: Number(((est.usage || 0) / 1048576).toFixed(2)),
        quotaMB: Number(((est.quota || 0) / 1048576).toFixed(1))
      };
    }
  } catch {
    storageQuota = null;
  }

  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
  const androidMatch = ua.match(/Android\s([\d.]+)/);

  const sanitizedExtra = redactSensitiveData(extra) || {};
  const resolvedLatencyMs = (
    typeof sanitizedExtra.latencyMs === 'number' && Number.isFinite(sanitizedExtra.latencyMs)
  )
    ? sanitizedExtra.latencyMs
    : (lastNetworkLatency?.latencyMs ?? (sanitizedExtra.latencyMs ?? null));

  return {
    generatedAt: new Date().toISOString(),
    platform: Capacitor.getPlatform?.() || 'web',
    isNative: Boolean(Capacitor.isNativePlatform?.()),
    apkVersionCode: typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_APK_VERSION_CODE || 'web') : 'web',
    embeddedBuildVersion: typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_MOBILE_BUILD_VERSION || 'web') : 'web',
    androidVersion: androidMatch ? androidMatch[1] : null,
    webViewVersion: chromeMatch ? chromeMatch[1] : null,
    online: typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true,
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown',
    storage: storageQuota,
    ...sanitizedExtra,
    latencyMs: resolvedLatencyMs
  };
}

export async function buildDiagnosticReportText(extra = {}) {
  const health = await collectDeviceHealthSnapshot(extra);
  const events = getDiagnosticEvents({ limit: 150 });
  const payload = {
    schema: 'isaac-pos-mobile-diagnostics/v1',
    health,
    summary: {
      totalEvents: ringBuffer.length,
      errors: ringBuffer.filter((e) => e.level === 'error').length,
      warnings: ringBuffer.filter((e) => e.level === 'warn').length
    },
    events
  };
  return JSON.stringify(payload, null, 2);
}

export const mobileDiagnosticsService = {
  record: recordDiagnosticEvent,
  getEvents: getDiagnosticEvents,
  clear: clearDiagnosticEvents,
  subscribe: subscribeDiagnosticEvents,
  recordNetworkLatency,
  getLastNetworkLatency,
  subscribeNetworkLatency,
  installGlobalErrorHooks,
  collectDeviceHealthSnapshot,
  buildDiagnosticReportText,
  redactSensitiveData,
  redactSensitiveText
};

export default mobileDiagnosticsService;
