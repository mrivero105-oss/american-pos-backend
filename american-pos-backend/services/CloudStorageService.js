const path = require('path');
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}
}

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SECRET_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const PRODUCT_BUCKET = 'product-images';

const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Sube una imagen de producto a Supabase Storage en segundo plano (non-blocking).
 * @param {string} filename Nombre del archivo (ej: product_123.jpg)
 * @param {Buffer} buffer Contenido binario de la imagen
 */
function uploadProductImageToSupabase(filename, buffer) {
    if (!filename || !buffer) return;
    const cleanFilename = path.basename(filename);
    const mime = getMimeType(cleanFilename);
    const url = `${SUPABASE_URL}/storage/v1/object/${PRODUCT_BUCKET}/${encodeURIComponent(cleanFilename)}`;

    // Ejecución asíncrona desacoplada del ciclo de vida de la petición HTTP
    setImmediate(async () => {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'apikey': SECRET_KEY,
                    'Authorization': `Bearer ${SECRET_KEY}`,
                    'Content-Type': mime,
                    'x-upsert': 'true',
                    'User-Agent': 'IsaacPOS-PC-Server/1.0'
                },
                body: buffer
            });

            if (!res.ok) {
                const errText = await res.text();
                console.warn(`[SUPABASE STORAGE] Error al sincronizar imagen ${cleanFilename} (${res.status}): ${errText}`);
            } else {
                console.log(`[SUPABASE STORAGE] ✅ Imagen ${cleanFilename} sincronizada exitosamente con la nube.`);
            }
        } catch (err) {
            console.warn(`[SUPABASE STORAGE] Error de red subiendo ${cleanFilename}:`, err.message);
        }
    });
}

module.exports = {
    uploadProductImageToSupabase,
    SUPABASE_URL,
    PRODUCT_BUCKET
};
