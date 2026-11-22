const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 4;

/**
 * Comprueba si una dirección IPv4/IPv6 pertenece a un rango privado, loopback,
 * link-local, metadata cloud o reservado (protección anti-SSRF estricta).
 */
function isPrivateOrReservedIp(rawIp) {
    if (!rawIp || typeof rawIp !== 'string') return true;
    let ip = rawIp.trim().toLowerCase();

    // Desempaquetar IPv6 mapeado a IPv4 (::ffff:127.0.0.1 o ::ffff:7f00:1)
    if (ip.startsWith('::ffff:')) {
        const mapped = ip.slice(7);
        if (net.isIPv4(mapped)) {
            ip = mapped;
        } else if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(mapped)) {
            const [hi, lo] = mapped.split(':').map((h) => parseInt(h, 16));
            ip = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
        }
    }

    if (net.isIPv4(ip)) {
        const parts = ip.split('.').map((n) => parseInt(n, 10));
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
        const [a, b] = parts;
        if (a === 0) return true;                              // 0.0.0.0/8 ("this" network)
        if (a === 10) return true;                             // 10.0.0.0/8 RFC1918
        if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64.0.0/10 CGNAT
        if (a === 127) return true;                            // 127.0.0.0/8 loopback
        if (a === 169 && b === 254) return true;               // 169.254.0.0/16 link-local & cloud metadata
        if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12 RFC1918
        if (a === 192 && b === 0 && parts[2] === 0) return true;
        if (a === 192 && b === 0 && parts[2] === 2) return true;
        if (a === 192 && b === 168) return true;               // 192.168.0.0/16 RFC1918
        if (a === 198 && (b === 18 || b === 19)) return true;  // benchmark
        if (a >= 224) return true;                             // multicast & reserved
        return false;
    }

    if (net.isIPv6(ip)) {
        if (ip === '::' || ip === '::1') return true;
        if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // Unique local fc00::/7
        if (/^fe[89ab]/.test(ip)) return true;                       // Link-local fe80::/10
        if (ip.startsWith('ff')) return true;                        // Multicast
        if (ip.startsWith('2001:db8')) return true;                  // Documentation
        return false;
    }

    return true;
}

/**
 * Valida magic bytes reales de imágenes raster seguras (PNG, JPEG, GIF, WebP, AVIF).
 * Bloquea explícitamente SVG, HTML, scripts y cualquier payload no-imagen.
 */
function detectSafeRasterImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
    ) {
        return { ext: '.png', mime: 'image/png' };
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { ext: '.jpg', mime: 'image/jpeg' };
    }

    // GIF: GIF87a / GIF89a
    const gifSig = buffer.subarray(0, 6).toString('ascii');
    if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
        return { ext: '.gif', mime: 'image/gif' };
    }

    // WebP: RIFF....WEBP
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return { ext: '.webp', mime: 'image/webp' };
    }

    // AVIF / HEIF: ....ftypavif / ftypmif1
    if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = buffer.subarray(8, 12).toString('ascii');
        if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
            return { ext: '.avif', mime: 'image/avif' };
        }
    }

    return null;
}

async function resolvePublicTargetIp(hostname) {
    const cleanHost = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!cleanHost) throw new Error('Host de imagen vacío.');
    if (
        cleanHost === 'localhost' ||
        cleanHost.endsWith('.localhost') ||
        cleanHost.endsWith('.local') ||
        cleanHost.endsWith('.internal') ||
        cleanHost.endsWith('.lan')
    ) {
        throw new Error('URL restringida por políticas de seguridad anti-SSRF.');
    }

    if (net.isIP(cleanHost)) {
        if (isPrivateOrReservedIp(cleanHost)) {
            throw new Error('Acceso a direcciones IP privadas o internas bloqueado (anti-SSRF).');
        }
        return { address: cleanHost, family: net.isIPv6(cleanHost) ? 6 : 4 };
    }

    const records = await dns.lookup(cleanHost, { all: true, verbatim: true });
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('No se pudo resolver el host de la imagen.');
    }
    for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
            throw new Error('El host de la imagen resuelve a una dirección IP privada o interna bloqueada (anti-SSRF).');
        }
    }
    return records[0];
}

async function fetchSafeImageBuffer(rawUrl, options = {}) {
    const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_BYTES;
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const maxRedirects = Number(options.maxRedirects ?? MAX_REDIRECTS);

    const requestWithDepth = async (targetUrl, depth) => {
        if (depth > maxRedirects) {
            throw new Error('Demasiadas redirecciones al descargar la imagen.');
        }

        let parsed;
        try {
            parsed = new URL(String(targetUrl || '').trim());
        } catch (_) {
            throw new Error('URL de imagen inválida.');
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Solo se permiten URLs HTTP/HTTPS para imágenes.');
        }
        if (parsed.username || parsed.password) {
            throw new Error('No se permiten credenciales embebidas en la URL.');
        }

        const resolved = await resolvePublicTargetIp(parsed.hostname);
        const client = parsed.protocol === 'https:' ? https : http;

        return await new Promise((resolve, reject) => {
            let settled = false;
            const finishErr = (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            };
            const finishOk = (val) => {
                if (settled) return;
                settled = true;
                resolve(val);
            };

            const req = client.request({
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                method: 'GET',
                lookup: (_h, _opts, cb) => cb(null, resolved.address, resolved.family),
                servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
                headers: {
                    'User-Agent': 'IsaacPOS-SafeMediaFetcher/2.0',
                    'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8',
                    'Referer': parsed.origin
                },
                timeout: timeoutMs
            }, (resp) => {
                if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                    resp.resume();
                    let nextUrl;
                    try {
                        nextUrl = new URL(resp.headers.location, parsed.href).href;
                    } catch (_) {
                        return finishErr(new Error('Redirección inválida al descargar la imagen.'));
                    }
                    return requestWithDepth(nextUrl, depth + 1).then(finishOk).catch(finishErr);
                }

                if (resp.statusCode !== 200) {
                    resp.resume();
                    return finishErr(new Error(`El servidor de la imagen respondió con HTTP ${resp.statusCode}`));
                }

                const contentType = String(resp.headers['content-type'] || '').toLowerCase();
                if (contentType && contentType.includes('svg')) {
                    resp.destroy();
                    return finishErr(new Error('El formato SVG está bloqueado por seguridad. Use PNG, JPG o WebP.'));
                }

                const declaredLen = parseInt(resp.headers['content-length'] || '0', 10);
                if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
                    resp.destroy();
                    return finishErr(new Error(`La imagen excede el tamaño máximo permitido (${Math.round(maxBytes / (1024 * 1024))} MB).`));
                }

                const chunks = [];
                let totalBytes = 0;
                resp.on('data', (chunk) => {
                    totalBytes += chunk.length;
                    if (totalBytes > maxBytes) {
                        resp.destroy();
                        return finishErr(new Error(`La imagen excede el tamaño máximo permitido (${Math.round(maxBytes / (1024 * 1024))} MB).`));
                    }
                    chunks.push(chunk);
                });
                resp.on('end', () => {
                    const buffer = Buffer.concat(chunks, totalBytes);
                    const detected = detectSafeRasterImage(buffer);
                    if (!detected) {
                        return finishErr(new Error('El archivo descargado no es una imagen raster válida (PNG, JPG, GIF, WebP o AVIF).'));
                    }
                    finishOk({
                        buffer,
                        ext: detected.ext,
                        mime: detected.mime,
                        contentType
                    });
                });
                resp.on('error', finishErr);
            });

            req.on('error', finishErr);
            req.on('timeout', () => {
                req.destroy();
                finishErr(new Error('Tiempo de espera agotado al descargar la imagen.'));
            });
            req.end();
        });
    };

    return await requestWithDepth(rawUrl, 0);
}

module.exports = {
    isPrivateOrReservedIp,
    detectSafeRasterImage,
    resolvePublicTargetIp,
    fetchSafeImageBuffer
};
