/**
 * Configuración centralizada de Supabase para el frontend (Desktop + Android APK).
 *
 * Aislamiento Multi-Cliente (Nivel 2A):
 * - OTA_PUBLIC_BASE_URL (VITE_OTA_PUBLIC_BASE_URL): único origen compartido opcional para
 *   descargar actualizaciones de software firmadas RSA-SHA256 (bucket `app-updates`).
 * - Datos del negocio (tasa 24/7, Realtime, imágenes): se descubren EN TIEMPO DE EJECUCIÓN
 *   desde el servidor PC propio de cada comercio (`GET /sync/cloud-client-config`), sin quemar
 *   credenciales de un negocio en el APK/instalador comercial.
 */

const RUNTIME_CLOUD_STORAGE_KEY = 'isaac_pos_runtime_cloud_config';

const BUILD_SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const BUILD_SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const OTA_PUBLIC_BASE_URL = String(import.meta.env.VITE_OTA_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

// Exportaciones legacy mantenidas solo por compatibilidad de imports (en builds comerciales son vacías)
export const SUPABASE_URL = BUILD_SUPABASE_URL;
export const SUPABASE_ANON_KEY = BUILD_SUPABASE_ANON_KEY;

const cloudConfigListeners = new Set();
let runtimeCloudConfig = null;
let runtimeHydrated = false;

function normalizeOrigin(rawUrl) {
    const clean = String(rawUrl || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
    return clean;
}

function hydrateRuntimeCloudConfig() {
    if (runtimeHydrated) return runtimeCloudConfig;
    runtimeHydrated = true;
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(RUNTIME_CLOUD_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            runtimeCloudConfig = {
                configured: Boolean(parsed.configured && parsed.supabaseUrl && parsed.anonKey),
                supabaseUrl: String(parsed.supabaseUrl || '').trim().replace(/\/+$/, ''),
                anonKey: String(parsed.anonKey || '').trim(),
                branchId: String(parsed.branchId || 'principal').trim() || 'principal',
                serverOrigin: normalizeOrigin(parsed.serverOrigin || ''),
                updatedAt: Number(parsed.updatedAt) || 0
            };
        }
    } catch {
        runtimeCloudConfig = null;
    }
    return runtimeCloudConfig;
}

function notifyCloudConfigListeners(nextConfig) {
    for (const listener of cloudConfigListeners) {
        try {
            listener(nextConfig);
        } catch (err) {
            console.warn('[SupabaseConfig] Error en listener de cambio cloud:', err?.message);
        }
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('isaac-cloud-config-changed', { detail: nextConfig }));
        } catch {
            // Entornos sin CustomEvent
        }
    }
}

export function getRuntimeCloudConfig() {
    return hydrateRuntimeCloudConfig();
}

export function setRuntimeCloudConfig(config, serverOrigin = '') {
    const normalizedOrigin = normalizeOrigin(serverOrigin);
    const prev = hydrateRuntimeCloudConfig();
    const cleanUrl = String(config?.supabaseUrl || '').trim().replace(/\/+$/, '');
    const cleanAnon = String(config?.anonKey || '').trim();
    const configured = Boolean(config?.configured !== false && cleanUrl && cleanAnon);

    const next = {
        configured,
        supabaseUrl: configured ? cleanUrl : '',
        anonKey: configured ? cleanAnon : '',
        branchId: String(config?.branchId || 'principal').trim() || 'principal',
        serverOrigin: normalizedOrigin || prev?.serverOrigin || '',
        updatedAt: Date.now()
    };

    const changed =
        !prev ||
        prev.configured !== next.configured ||
        prev.supabaseUrl !== next.supabaseUrl ||
        prev.anonKey !== next.anonKey ||
        prev.branchId !== next.branchId ||
        prev.serverOrigin !== next.serverOrigin;

    runtimeCloudConfig = next;
    runtimeHydrated = true;

    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(RUNTIME_CLOUD_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Ignorar cuota de storage
        }
    }

    if (changed) {
        notifyCloudConfigListeners(next);
    }
    return next;
}

export function clearRuntimeCloudConfig() {
    const prev = hydrateRuntimeCloudConfig();
    runtimeCloudConfig = {
        configured: false,
        supabaseUrl: '',
        anonKey: '',
        branchId: 'principal',
        serverOrigin: '',
        updatedAt: Date.now()
    };
    runtimeHydrated = true;

    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.removeItem(RUNTIME_CLOUD_STORAGE_KEY);
        } catch {
            // Ignorar storage restringido
        }
    }

    if (prev && (prev.configured || prev.supabaseUrl || prev.anonKey)) {
        notifyCloudConfigListeners(runtimeCloudConfig);
    }
    return runtimeCloudConfig;
}

export function subscribeCloudConfigChange(listener) {
    if (typeof listener !== 'function') return () => {};
    cloudConfigListeners.add(listener);
    return () => cloudConfigListeners.delete(listener);
}

/**
 * Descubre en tiempo de ejecución la configuración Supabase pública (URL + Anon Key)
 * del servidor PC conectado actualmente. Si el servidor no tiene nube configurada,
 * desactiva el acceso Supabase para garantizar aislamiento total entre clientes.
 */
export async function syncRuntimeCloudConfigFromServer(serverBaseUrl) {
    const origin = normalizeOrigin(serverBaseUrl);
    if (!origin || typeof fetch !== 'function') {
        return getRuntimeCloudConfig();
    }

    const prev = hydrateRuntimeCloudConfig();
    if (prev?.serverOrigin && prev.serverOrigin !== origin) {
        // Cambio de servidor/local: purgar inmediatamente la nube del comercio anterior
        clearRuntimeCloudConfig();
    }

    let controller = null;
    let timeoutId = null;
    try {
        if (typeof AbortController !== 'undefined') {
            controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 4500);
        }
        const res = await fetch(`${origin}/sync/cloud-client-config?_t=${Date.now()}`, {
            method: 'GET',
            signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) return getRuntimeCloudConfig();

        const data = await res.json();
        if (data && typeof data === 'object' && typeof data.configured === 'boolean') {
            return setRuntimeCloudConfig(data, origin);
        }
    } catch {
        // Si la PC está offline, conservar caché local del mismo serverOrigin para operación 24/7
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
    return getRuntimeCloudConfig();
}

export function getSupabaseUrl() {
    const rt = hydrateRuntimeCloudConfig();
    if (rt) {
        return rt.configured ? rt.supabaseUrl : '';
    }
    return BUILD_SUPABASE_URL;
}

export function getSupabaseAnonKey() {
    const rt = hydrateRuntimeCloudConfig();
    if (rt) {
        return rt.configured ? rt.anonKey : '';
    }
    return BUILD_SUPABASE_ANON_KEY;
}

export function hasSupabaseConfig() {
    return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getSupabaseHeaders(extra = {}) {
    const anonKey = getSupabaseAnonKey();
    if (!anonKey) return { ...extra };
    return {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...extra
    };
}

export function getSupabaseRestUrl(tableAndQuery) {
    const baseUrl = getSupabaseUrl();
    if (!baseUrl) return '';
    return `${baseUrl}/rest/v1/${String(tableAndQuery || '').replace(/^\/+/, '')}`;
}

export function getSupabaseRealtimeWsUrl() {
    const baseUrl = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    if (!baseUrl || !anonKey) return '';
    const wsBase = baseUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
    return `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
}

export function getSupabaseStoragePublicUrl(bucket, filename = '') {
    const cleanFile = filename ? `/${encodeURIComponent(filename)}` : '';
    if (bucket === 'app-updates') {
        if (OTA_PUBLIC_BASE_URL) {
            if (OTA_PUBLIC_BASE_URL.includes('/storage/v1/object/public/')) {
                return `${OTA_PUBLIC_BASE_URL}${cleanFile}`;
            }
            return `${OTA_PUBLIC_BASE_URL}/storage/v1/object/public/${bucket}${cleanFile}`;
        }
        // Fallback legacy solo para actualizaciones OTA si no se definió VITE_OTA_PUBLIC_BASE_URL
        const otaFallbackBase = BUILD_SUPABASE_URL || getSupabaseUrl();
        if (!otaFallbackBase) return '';
        return `${otaFallbackBase}/storage/v1/object/public/${bucket}${cleanFile}`;
    }

    const baseUrl = getSupabaseUrl();
    if (!baseUrl) return '';
    return `${baseUrl}/storage/v1/object/public/${bucket}${cleanFile}`;
}
