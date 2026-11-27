const path = require('path');
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}
}

const PRODUCT_BUCKET = 'product-images';

function getActiveCloudStorageConfig() {
    try {
        const SupabaseSyncService = require('./SupabaseSyncService');
        if (typeof SupabaseSyncService.refreshCredentials === 'function') {
            SupabaseSyncService.refreshCredentials();
        }
        return {
            supabaseUrl: String(SupabaseSyncService.supabaseUrl || '').trim().replace(/\/+$/, ''),
            serviceKey: String(SupabaseSyncService.serviceKey || '').trim()
        };
    } catch {
        return {
            supabaseUrl: String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
            serviceKey: String(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '').trim()
        };
    }
}

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
 * Sube una imagen de producto al Supabase propio del comercio en segundo plano (non-blocking).
 * Si el comercio no tiene Supabase configurado, omite silenciosamente (operación 100% local).
 * @param {string} filename Nombre del archivo (ej: product_123.jpg)
 * @param {Buffer} buffer Contenido binario de la imagen
 */
function uploadProductImageToSupabase(filename, buffer) {
    if (!filename || !buffer) return;
    const { supabaseUrl, serviceKey } = getActiveCloudStorageConfig();
    if (!supabaseUrl || !serviceKey) return;

    const cleanFilename = path.basename(filename);
    const mime = getMimeType(cleanFilename);
    const url = `${supabaseUrl}/storage/v1/object/${PRODUCT_BUCKET}/${encodeURIComponent(cleanFilename)}`;

    // Ejecución asíncrona desacoplada del ciclo de vida de la petición HTTP
    setImmediate(async () => {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'apikey': serviceKey,
                    'Authorization': `Bearer ${serviceKey}`,
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
    getActiveCloudStorageConfig,
    get SUPABASE_URL() {
        return getActiveCloudStorageConfig().supabaseUrl;
    },
    PRODUCT_BUCKET
};
