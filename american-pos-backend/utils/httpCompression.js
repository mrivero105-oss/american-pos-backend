const compression = require('compression');

/**
 * Prefijos/tipos MIME ya comprimidos o streams que no deben pasar por gzip/deflate:
 * recomprimir JPEG/PNG/WebP/PDF/ZIP/APK desperdicia CPU sin reducir tamaño,
 * y comprimir text/event-stream retiene chunks en buffer rompiendo SSE en tiempo real.
 */
const INCOMPRESSIBLE_CONTENT_TYPES = [
    'text/event-stream',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'application/pdf',
    'application/zip',
    'application/gzip',
    'application/x-gzip',
    'application/vnd.android.package-archive',
    'font/woff2',
    'video/',
    'audio/'
];

function shouldCompressResponse(req, res) {
    if (req && req.headers) {
        if (req.headers['x-no-compression']) return false;
        const accept = String(req.headers.accept || '').toLowerCase();
        if (accept.includes('text/event-stream')) return false;
    }

    const contentType = String(res && typeof res.getHeader === 'function' ? (res.getHeader('Content-Type') || '') : '').toLowerCase();
    if (contentType) {
        for (const blocked of INCOMPRESSIBLE_CONTENT_TYPES) {
            if (contentType.includes(blocked)) return false;
        }
    }

    return compression.filter(req, res);
}

function createCompressionOptions() {
    return {
        threshold: 1024,
        level: 6,
        filter: shouldCompressResponse
    };
}

module.exports = {
    shouldCompressResponse,
    createCompressionOptions
};
