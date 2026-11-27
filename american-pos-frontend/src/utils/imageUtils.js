import api, { getBaseUrl } from '../services/api';
import { getSupabaseStoragePublicUrl } from '../config/supabaseConfig';

export const getSupabaseProductStorageUrl = () => getSupabaseStoragePublicUrl('product-images');
export const SUPABASE_STORAGE_URL = getSupabaseProductStorageUrl();

/**
 * Detecta si el entorno de ejecución actual es un dispositivo móvil (Capacitor nativo o navegador móvil)
 */
export const isMobileClient = () => {
    if (typeof window === 'undefined') return false;
    const isCapacitor = Boolean(window.Capacitor?.isNativePlatform?.()) || window.location.protocol === 'capacitor:';
    const isMobileUA = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isSmallScreen = window.innerWidth <= 768;
    const isNotElectron = !window.electronAPI;
    return Boolean(isCapacitor || (isMobileUA && isNotElectron) || (isSmallScreen && isNotElectron));
};

const KNOWN_MEDIA_PREFIXES = [
    'product_images/',
    'supplier_logos/',
    'invoices/',
    'uploads/',
    'display_ads/'
];

const getServerOrigin = () => {
    const rawBase = api?.defaults?.baseURL || (typeof getBaseUrl === 'function' ? getBaseUrl() : '') || '';
    return String(rawBase).trim().replace(/\/+$/, '').replace(/\/api$/, '');
};

/**
 * Normaliza cualquier URI o URL de imagen a una clave canónica estable,
 * independiente de la IP del servidor LAN, protocolo o dominio CDN.
 * Ejemplo:
 * - "http://192.168.1.30:3005/product_images/agua.jpg" -> "product_images/agua.jpg"
 * - "https://xxx.supabase.co/storage/v1/object/public/product-images/agua.jpg" -> "product_images/agua.jpg"
 * - "agua.jpg" -> "product_images/agua.jpg"
 */
export const normalizeImageCacheKey = (uri) => {
    if (!uri || typeof uri !== 'string') return '';
    const trimmed = uri.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
    if (trimmed.length > 200 && !trimmed.includes('/') && !trimmed.startsWith('http')) {
        return `data:image/jpeg;base64,${trimmed}`;
    }

    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const parsed = new URL(trimmed);
            const cleanPathname = decodeURIComponent(parsed.pathname || '').replace(/^\/+/, '');
            const supaMatch = cleanPathname.match(/(?:^|\/)storage\/v1\/object\/public\/product-images\/(.+)$/i);
            if (supaMatch && supaMatch[1]) {
                return `product_images/${supaMatch[1]}`;
            }
            for (const prefix of KNOWN_MEDIA_PREFIXES) {
                const idx = cleanPathname.indexOf(prefix);
                if (idx >= 0) {
                    return cleanPathname.slice(idx);
                }
            }
            return trimmed;
        } catch (_) {
            return trimmed;
        }
    }

    const withoutQuery = trimmed.split('?')[0].split('#')[0];
    let cleanPath = withoutQuery.replace(/^\/+/, '');
    try {
        cleanPath = decodeURIComponent(cleanPath);
    } catch (_) {
        // Mantener tal cual si contiene secuencias % no escapadas
    }

    if (KNOWN_MEDIA_PREFIXES.some((prefix) => cleanPath.startsWith(prefix))) {
        return cleanPath;
    }
    return `product_images/${cleanPath}`;
};

/**
 * Devuelve la lista ordenada de URLs candidatas (CDN nube y/o Servidor PC LAN)
 * para cargar y cachear una imagen sin fallos cuando falta Supabase o cambia la red.
 */
export const getImageCandidateUrls = (uri) => {
    if (!uri || typeof uri !== 'string') return [];
    const trimmed = uri.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
        return [trimmed];
    }

    if (trimmed.length > 200 && !trimmed.includes('/') && !trimmed.startsWith('http')) {
        return [`data:image/jpeg;base64,${trimmed}`];
    }

    const origin = getServerOrigin();

    if (/^https?:\/\//i.test(trimmed)) {
        const candidates = [trimmed];
        const canonical = normalizeImageCacheKey(trimmed);
        if (canonical.startsWith('product_images/')) {
            const filename = canonical.replace(/^product_images\//, '');
            const encodedName = filename.split('/').map((seg) => encodeURIComponent(seg)).join('/');
            const lanUrl = origin ? `${origin}/product_images/${encodedName}` : '';
            const dynamicCloudStorage = getSupabaseProductStorageUrl();
            const cloudUrl = dynamicCloudStorage ? `${dynamicCloudStorage}/${encodeURIComponent(filename)}` : '';
            if (lanUrl && !candidates.includes(lanUrl)) candidates.push(lanUrl);
            if (cloudUrl && !candidates.includes(cloudUrl)) candidates.push(cloudUrl);
        }
        return candidates;
    }

    const cleanPath = trimmed.replace(/^\/+/, '');
    const isProductImage = cleanPath.startsWith('product_images/') ||
        !KNOWN_MEDIA_PREFIXES.some((prefix) => prefix !== 'product_images/' && cleanPath.startsWith(prefix));

    if (isProductImage) {
        const filename = cleanPath.replace(/^product_images\//, '');
        const encodedPath = filename.split('/').map((seg) => encodeURIComponent(seg)).join('/');
        const dynamicCloudStorage = getSupabaseProductStorageUrl();
        const cloudUrl = dynamicCloudStorage ? `${dynamicCloudStorage}/${encodeURIComponent(filename)}` : '';
        const lanUrl = origin ? `${origin}/product_images/${encodedPath}` : '';

        const ordered = [];
        if (isMobileClient()) {
            // Priorizar servidor PC LAN en móvil cuando no hay Supabase embebido (builds comerciales)
            // o intentar Supabase + fallback automático a PC LAN cuando Supabase sí está configurado.
            if (cloudUrl) ordered.push(cloudUrl);
            if (lanUrl) ordered.push(lanUrl);
        } else {
            if (lanUrl) ordered.push(lanUrl);
            if (cloudUrl) ordered.push(cloudUrl);
        }
        return [...new Set(ordered.filter(Boolean))];
    }

    if (!origin) return [];
    const encodedClean = cleanPath.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    return [`${origin}/${encodedClean}`];
};

export const getImageUrl = (uri) => {
    const candidates = getImageCandidateUrls(uri);
    return candidates[0] || '';
};

export const getInvoiceUrl = (uri) => {
    if (!uri) return '';
    if (uri.startsWith('http') || uri.startsWith('data:') || uri.startsWith('blob:')) return uri;
    const baseUrl = api?.defaults?.baseURL || '';
    const origin = baseUrl.replace(/\/api$/, '');
    let cleanPath = uri.startsWith('/') ? uri.substring(1) : uri;
    return (cleanPath.startsWith('invoices/') || cleanPath.startsWith('uploads/'))
        ? `${origin}/${cleanPath}`
        : `${origin}/invoices/${cleanPath}`;
};
