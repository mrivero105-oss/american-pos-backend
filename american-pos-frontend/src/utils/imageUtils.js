import api from '../services/api';
import { getSupabaseStoragePublicUrl } from '../config/supabaseConfig';

export const SUPABASE_STORAGE_URL = getSupabaseStoragePublicUrl('product-images');

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

export const getImageUrl = (uri) => {
    if (!uri) return '';
    // Already a valid external HTTP URL or full data URL
    if (uri.startsWith('http') || uri.startsWith('data:')) return uri;

    // If it's a massive string missing the data prefix, it's a raw base64 string
    if (uri.length > 200 && !uri.includes('/')) {
        return `data:image/jpeg;base64,${uri}`;
    }

    // Normalize path by removing leading slash
    let cleanPath = uri.startsWith('/') ? uri.substring(1) : uri;

    // Si es una imagen de producto (product_images/ o sin prefijo de logos/invoices/etc.)
    const isProductImage = cleanPath.startsWith('product_images/') || 
        (!cleanPath.startsWith('supplier_logos/') && 
         !cleanPath.startsWith('invoices/') && 
         !cleanPath.startsWith('uploads/') && 
         !cleanPath.startsWith('display_ads/'));

    if (isProductImage) {
        const filename = cleanPath.replace(/^product_images\//, '');
        // Si estamos en entorno móvil (Android APK / Navegador de celular) o no hay servidor local configurado:
        // Cargar directamente desde Supabase Storage CDN (funciona 24/7 en WiFi y datos móviles LTE)
        if (isMobileClient() || !api?.defaults?.baseURL) {
            return SUPABASE_STORAGE_URL ? `${SUPABASE_STORAGE_URL}/${encodeURIComponent(filename)}` : '';
        }
    }

    const baseUrl = api?.defaults?.baseURL || '';
    const origin = baseUrl.replace(/\/api$/, '');

    // If the database already saved it with the full known prefix
    if (
        cleanPath.startsWith('product_images/') ||
        cleanPath.startsWith('supplier_logos/') ||
        cleanPath.startsWith('invoices/') ||
        cleanPath.startsWith('uploads/') ||
        cleanPath.startsWith('display_ads/')
    ) {
        return `${origin}/${cleanPath}`;
    }

    // Otherwise, assume it's just a filename and default to product_images
    return `${origin}/product_images/${cleanPath}`;
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
