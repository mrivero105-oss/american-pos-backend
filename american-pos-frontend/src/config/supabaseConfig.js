/**
 * Configuración centralizada de Supabase para el frontend (Vite).
 * Lee exclusivamente desde variables de entorno import.meta.env.VITE_*
 * sin incrustar URLs ni credenciales en el código fuente.
 */
export const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export function hasSupabaseConfig() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabaseHeaders(extra = {}) {
    if (!SUPABASE_ANON_KEY) return { ...extra };
    return {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        ...extra
    };
}

export function getSupabaseRestUrl(tableAndQuery) {
    if (!SUPABASE_URL) return '';
    return `${SUPABASE_URL}/rest/v1/${String(tableAndQuery || '').replace(/^\/+/, '')}`;
}

export function getSupabaseRealtimeWsUrl() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return '';
    const wsBase = SUPABASE_URL.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
    return `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
}

export function getSupabaseStoragePublicUrl(bucket, filename = '') {
    if (!SUPABASE_URL) return '';
    const cleanFile = filename ? `/${encodeURIComponent(filename)}` : '';
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}${cleanFile}`;
}
