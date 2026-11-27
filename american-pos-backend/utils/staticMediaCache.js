const path = require('path');

/**
 * Detecta nombres de archivos multimedia generados con timestamp o hash de contenido
 * por Isaac POS (product_images, supplier_logos, display_ads, logos externalizados).
 * Estos archivos no se sobrescriben in-place, por lo que admiten ventanas de caché largas.
 */
const VERSIONED_MEDIA_PATTERNS = [
    /^product_\d{10,}_\d+\.[a-z0-9]+$/i,
    /^ai_product_.+_\d{10,}\.[a-z0-9]+$/i,
    /^supplier-\d{10,}-\d+\.[a-z0-9]+$/i,
    /^ad_\d{10,}_[a-z0-9]+\.[a-z0-9]+$/i,
    /^[a-z0-9_-]+_[a-z0-9_-]+_[a-f0-9]{10}\.[a-z0-9]+$/i
];

function isVersionedMediaFilename(filePath) {
    const fileName = path.basename(String(filePath || ''));
    if (!fileName) return false;
    return VERSIONED_MEDIA_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * Opciones de express.static para media pública del POS (/product_images, /supplier_logos,
 * /display_ads, /uploads): habilita ETag + Last-Modified y aplica Cache-Control diferenciado
 * para evitar revalidaciones innecesarias en cajas LAN y terminales Android Capacitor.
 */
function createPublicMediaStaticOptions() {
    return {
        etag: true,
        lastModified: true,
        setHeaders: (res, filePath) => {
            if (isVersionedMediaFilename(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
            } else {
                res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
            }
        }
    };
}

/**
 * Opciones de express.static para documentos privados/fiscales (/invoices):
 * permite revalidación condicional (304 Not Modified vía ETag) sin almacenar en cachés públicas.
 */
function createPrivateMediaStaticOptions() {
    return {
        etag: true,
        lastModified: true,
        setHeaders: (res) => {
            res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
        }
    };
}

module.exports = {
    isVersionedMediaFilename,
    createPublicMediaStaticOptions,
    createPrivateMediaStaticOptions
};
