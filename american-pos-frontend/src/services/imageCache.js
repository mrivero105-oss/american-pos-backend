import { db } from './db';
import localDb from '../db/localDb';
import { getImageCandidateUrls, normalizeImageCacheKey } from '../utils/imageUtils';

// In-Memory Bounded Fast Lookup Cache (Max 300 items for zero-flicker virtual grid recycling)
const MAX_MEMORY_CACHE_ITEMS = 300;
const memoryCache = new Map();

// Deduplicación de descargas en vuelo y cola acotada en segundo plano
const inFlightFetches = new Map();
const failedFetchCooldown = new Map();
const FAILED_COOLDOWN_MS = 60 * 1000;
const MAX_SQLITE_DATAURL_CHARS = 750 * 1024; // ~550 KB binarios máx por fila en SQLite
const COMPACT_THRESHOLD_BYTES = 48 * 1024; // Redimensionar si supera 48 KB
const COMPACT_MAX_DIMENSION = 380;

let backgroundQueue = [];
const backgroundQueuedKeys = new Set();
let backgroundActiveWorkers = 0;
const MAX_BG_CONCURRENCY = 2;
let networkBackoffUntil = 0;

// Native Browser Cache Storage API Singleton
const CACHE_NAME = 'isaac-pos-img-v1';
let cacheInstance = null;
let legacyCacheIndexPromise = null;

const getCanonicalKey = (uri) => {
    const norm = normalizeImageCacheKey(uri);
    return norm || (typeof uri === 'string' ? uri.trim() : '');
};

const buildCanonicalCacheUrl = (canonicalKey) => {
    return `http://localhost/__isaac_img_cache__/${encodeURIComponent(canonicalKey)}`;
};

export const getMemoryCachedImage = (uri) => {
    if (!uri || typeof uri !== 'string') return null;
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;
    const key = getCanonicalKey(uri);
    return memoryCache.get(key) || memoryCache.get(uri) || null;
};

const revokeBlobUrlSafe = (val) => {
    if (typeof val === 'string' && val.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
            URL.revokeObjectURL(val);
        } catch {
            // Blob URL ya revocada o inválida
        }
    }
};

const setMemoryCache = (key, val) => {
    if (!key || !val) return;
    if (memoryCache.has(key)) {
        const prev = memoryCache.get(key);
        if (prev && prev !== val) {
            revokeBlobUrlSafe(prev);
        }
        memoryCache.delete(key);
    } else if (memoryCache.size >= MAX_MEMORY_CACHE_ITEMS) {
        const firstKey = memoryCache.keys().next().value;
        const evicted = memoryCache.get(firstKey);
        revokeBlobUrlSafe(evicted);
        memoryCache.delete(firstKey);
    }
    memoryCache.set(key, val);
};

async function getBrowserCache() {
    if (typeof window === 'undefined' || !('caches' in window)) return null;
    if (!cacheInstance) {
        try {
            cacheInstance = await window.caches.open(CACHE_NAME);
        } catch (_) {
            cacheInstance = null;
        }
    }
    return cacheInstance;
}

async function getLegacyCacheIndex(cache) {
    if (!cache) return null;
    if (!legacyCacheIndexPromise) {
        legacyCacheIndexPromise = (async () => {
            const index = new Map();
            try {
                const requests = await cache.keys();
                for (let i = 0; i < requests.length; i++) {
                    const req = requests[i];
                    const reqUrl = req?.url || '';
                    if (!reqUrl || reqUrl.includes('/__isaac_img_cache__/')) continue;
                    const norm = normalizeImageCacheKey(reqUrl);
                    if (norm && !index.has(norm)) {
                        index.set(norm, req);
                    }
                }
            } catch (_) {
                // Ignorar si Cache.keys() no está soportado
            }
            return index;
        })();
    }
    return legacyCacheIndexPromise;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        if (typeof FileReader === 'undefined') {
            reject(new Error('FileReader no disponible'));
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
                resolve(reader.result);
            } else {
                reject(new Error('DataURL inválido'));
            }
        };
        reader.onerror = () => reject(reader.error || new Error('Error leyendo blob'));
        reader.readAsDataURL(blob);
    });
}

async function blobToCompactDataUrl(blob) {
    if (!blob || blob.size === 0) return null;

    // Si es pequeña o estamos en entorno sin canvas/DOM de imagen, serializar directo
    if (
        blob.size <= COMPACT_THRESHOLD_BYTES ||
        typeof document === 'undefined' ||
        typeof Image === 'undefined' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
    ) {
        try {
            return await blobToDataUrl(blob);
        } catch (_) {
            return null;
        }
    }

    // Comprimir suavemente para SQLite / IndexedDB (380px máx -> ~15-25 KB por producto)
    try {
        const tempUrl = URL.createObjectURL(blob);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('No se pudo decodificar imagen'));
                el.src = tempUrl;
            });

            const w = img.naturalWidth || img.width || 0;
            const h = img.naturalHeight || img.height || 0;
            if (w > 0 && h > 0) {
                const scale = Math.min(1, COMPACT_MAX_DIMENSION / Math.max(w, h));
                const targetW = Math.max(1, Math.round(w * scale));
                const targetH = Math.max(1, Math.round(h * scale));

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0, targetW, targetH);
                    let compressed = '';
                    try {
                        compressed = canvas.toDataURL('image/webp', 0.80);
                    } catch (_) {
                        compressed = '';
                    }
                    if (!compressed || !compressed.startsWith('data:image/webp')) {
                        compressed = canvas.toDataURL('image/jpeg', 0.80);
                    }
                    if (compressed && compressed.startsWith('data:image/')) {
                        return compressed;
                    }
                }
            }
        } finally {
            try {
                URL.revokeObjectURL(tempUrl);
            } catch (_) {
                // noop
            }
        }
    } catch (_) {
        // Fallback a serialización directa del blob original
    }

    try {
        return await blobToDataUrl(blob);
    } catch (_) {
        return null;
    }
}

async function persistDataUrlToDb(canonicalKey, dataUrl) {
    if (!canonicalKey || !dataUrl || dataUrl.length > MAX_SQLITE_DATAURL_CHARS) return;
    try {
        await db.put('imageCache', {
            uri: canonicalKey,
            data: dataUrl,
            updatedAt: Date.now()
        });
    } catch (dbErr) {
        console.warn('[ImageCache] Error persistiendo imagen en DB local:', dbErr?.message);
    }
}

async function readFromLocalDb(canonicalKey, rawUri) {
    const keysToTry = canonicalKey && canonicalKey !== rawUri ? [canonicalKey, rawUri] : [canonicalKey || rawUri];

    for (const k of keysToTry) {
        if (!k) continue;
        try {
            const doc = await db.getById('imageCache', k);
            if (doc && typeof doc.data === 'string' && doc.data.startsWith('data:')) {
                return doc.data;
            }
        } catch (_) {
            // Continuar fallback
        }
    }

    for (const k of keysToTry) {
        if (!k) continue;
        try {
            if (localDb && localDb.imageCache) {
                const dexDoc = await localDb.imageCache.get(k);
                if (dexDoc && typeof dexDoc.data === 'string' && dexDoc.data.startsWith('data:')) {
                    return dexDoc.data;
                }
            }
        } catch (_) {
            // Continuar fallback
        }
    }

    return null;
}

/**
 * Get cached image DataURL / Blob URL from Memory, SQLite/IndexedDB, or Cache Storage API.
 */
export const getCachedImage = async (uri) => {
    if (!uri || typeof uri !== 'string') return null;

    // 1. Direct Base64 or inline data URL
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;

    const canonicalKey = getCanonicalKey(uri);
    if (!canonicalKey) return null;
    if (canonicalKey.startsWith('data:') || canonicalKey.startsWith('blob:')) return canonicalKey;

    // 2. Memory Cache (Instant 0 ms)
    const memHit = memoryCache.get(canonicalKey) || memoryCache.get(uri);
    if (memHit) {
        return memHit;
    }

    // 3. Persistent SQLite WAL (Android) / IndexedDB Cache (Sobrevive reinicios, cambios de IP y modo avión)
    const dbDataUrl = await readFromLocalDb(canonicalKey, uri);
    if (dbDataUrl) {
        setMemoryCache(canonicalKey, dbDataUrl);
        return dbDataUrl;
    }

    // 4. Native Browser Cache Storage API (Clave canónica + URLs candidatas + rescate de URLs previas)
    try {
        const cache = await getBrowserCache();
        if (cache) {
            const canonicalUrl = buildCanonicalCacheUrl(canonicalKey);
            let cachedResponse = await cache.match(canonicalUrl);
            let matchedFromLegacy = false;

            if (!cachedResponse || !cachedResponse.ok) {
                const candidates = getImageCandidateUrls(uri);
                for (const candidateUrl of candidates) {
                    if (!candidateUrl || candidateUrl.startsWith('data:')) continue;
                    const res = await cache.match(candidateUrl);
                    if (res && res.ok) {
                        cachedResponse = res;
                        matchedFromLegacy = true;
                        break;
                    }
                }
            }

            // Rescate automático de imágenes cacheadas previamente bajo otra IP o dominio Supabase
            if (!cachedResponse || !cachedResponse.ok) {
                const legacyIndex = await getLegacyCacheIndex(cache);
                const legacyReq = legacyIndex?.get(canonicalKey);
                if (legacyReq) {
                    const res = await cache.match(legacyReq);
                    if (res && res.ok) {
                        cachedResponse = res;
                        matchedFromLegacy = true;
                    }
                }
            }

            if (cachedResponse && cachedResponse.ok) {
                const contentType = (cachedResponse.headers?.get?.('content-type') || '').toLowerCase();
                if (!contentType.includes('text/html')) {
                    const blob = await cachedResponse.blob();
                    if (blob && blob.size > 0) {
                        const dataUrl = await blobToCompactDataUrl(blob);
                        const resolvedSrc = dataUrl || (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : null);
                        if (resolvedSrc) {
                            setMemoryCache(canonicalKey, resolvedSrc);
                            // Auto-migrar en segundo plano a clave canónica + SQLite permanente
                            if (dataUrl) {
                                persistDataUrlToDb(canonicalKey, dataUrl).catch(() => {});
                            }
                            if (matchedFromLegacy) {
                                cache.put(canonicalUrl, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } })).catch(() => {});
                            }
                            return resolvedSrc;
                        }
                    }
                }
            }
        }
    } catch (_) {
        // Fallback silencioso
    }

    return null;
};

/**
 * Fetch an image over network (trying LAN / Cloud candidate URLs),
 * persist to SQLite/IndexedDB + Cache Storage API under canonical key.
 */
export const cacheImage = async (uri) => {
    if (!uri || typeof uri !== 'string') return null;
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;

    const canonicalKey = getCanonicalKey(uri);
    if (!canonicalKey) return null;
    if (canonicalKey.startsWith('data:') || canonicalKey.startsWith('blob:')) return canonicalKey;

    // 1. Verificar si ya está en caché local
    const existing = await getCachedImage(canonicalKey);
    if (existing) return existing;

    // 2. Evitar descargas duplicadas simultáneas para la misma imagen
    if (inFlightFetches.has(canonicalKey)) {
        return inFlightFetches.get(canonicalKey);
    }

    const fetchTask = (async () => {
        const candidates = getImageCandidateUrls(uri);
        if (candidates.length === 0) return null;

        let hadNetworkError = false;
        for (const fullUrl of candidates) {
            if (!fullUrl) continue;
            if (fullUrl.startsWith('data:') || fullUrl.startsWith('blob:')) {
                setMemoryCache(canonicalKey, fullUrl);
                return fullUrl;
            }

            let timeoutId = null;
            try {
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), 6500);

                const response = await fetch(fullUrl, { credentials: 'omit', signal: controller.signal });
                clearTimeout(timeoutId);
                timeoutId = null;

                if (!response.ok) continue;

                const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
                if (contentType.includes('text/html') || contentType.includes('application/json')) {
                    continue;
                }

                const blob = await response.blob();
                if (!blob || blob.size === 0) continue;

                // Guardar en Cache Storage API bajo clave canónica (independiente de IP/host)
                const cache = await getBrowserCache();
                if (cache) {
                    try {
                        const canonicalUrl = buildCanonicalCacheUrl(canonicalKey);
                        const cacheResp = new Response(blob, {
                            status: 200,
                            headers: { 'Content-Type': blob.type || contentType || 'image/jpeg' }
                        });
                        await cache.put(canonicalUrl, cacheResp);
                    } catch (putErr) {
                        console.warn('[ImageCache] Error guardando imagen en Cache Storage:', putErr?.message);
                    }
                }

                // Persistir DataURL compacto en SQLite Nativo Android / IndexedDB (100% persistente offline)
                const dataUrl = await blobToCompactDataUrl(blob);
                if (dataUrl) {
                    await persistDataUrlToDb(canonicalKey, dataUrl);
                    setMemoryCache(canonicalKey, dataUrl);
                    failedFetchCooldown.delete(canonicalKey);
                    return dataUrl;
                }

                if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                    const objectUrl = URL.createObjectURL(blob);
                    setMemoryCache(canonicalKey, objectUrl);
                    failedFetchCooldown.delete(canonicalKey);
                    return objectUrl;
                }
            } catch (_) {
                hadNetworkError = true;
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }
        }

        failedFetchCooldown.set(canonicalKey, Date.now());
        if (hadNetworkError) {
            networkBackoffUntil = Date.now() + 15000;
        }
        return null;
    })();

    inFlightFetches.set(canonicalKey, fetchTask);
    try {
        return await fetchTask;
    } finally {
        inFlightFetches.delete(canonicalKey);
    }
};

function drainBackgroundQueue() {
    while (backgroundActiveWorkers < MAX_BG_CONCURRENCY && backgroundQueue.length > 0) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            backgroundQueue = [];
            backgroundQueuedKeys.clear();
            return;
        }
        if (Date.now() < networkBackoffUntil) {
            return;
        }
        const nextItem = backgroundQueue.shift();
        if (!nextItem) continue;
        backgroundActiveWorkers++;
        cacheImage(nextItem.uri)
            .catch(() => {})
            .finally(() => {
                backgroundQueuedKeys.delete(nextItem.key);
                backgroundActiveWorkers--;
                if (backgroundQueue.length > 0 && Date.now() >= networkBackoffUntil) {
                    setTimeout(drainBackgroundQueue, 20);
                }
            });
    }
}

/**
 * Encola una imagen vista online para guardarse en caché persistente en segundo plano
 * sin bloquear el render ni saturar la red.
 */
export const queueBackgroundCacheImage = (uri) => {
    if (!uri || typeof uri !== 'string') return;
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (Date.now() < networkBackoffUntil) return;

    const key = getCanonicalKey(uri);
    if (!key || memoryCache.has(key) || inFlightFetches.has(key) || backgroundQueuedKeys.has(key)) {
        return;
    }

    const lastFailedAt = failedFetchCooldown.get(key);
    if (lastFailedAt && Date.now() - lastFailedAt < FAILED_COOLDOWN_MS) {
        return;
    }

    // Limitar tamaño máximo de la cola en background para no acumular trabajo innecesario
    if (backgroundQueue.length >= 120) return;

    backgroundQueuedKeys.add(key);
    backgroundQueue.push({ key, uri });
    drainBackgroundQueue();
};

/**
 * Batch pre-cacher for product catalog images with live progress callback.
 */
let isBatchCaching = false;

export const cacheAllProductImages = async (products, options = {}) => {
    if (!products || !Array.isArray(products) || products.length === 0) {
        return { total: 0, cached: 0, failed: 0, alreadyCached: 0 };
    }

    const { concurrency = 4, onProgress = null, yieldMs = 0 } = typeof options === 'number' ? { concurrency: options } : options;

    if (isBatchCaching) {
        return { total: 0, cached: 0, failed: 0, alreadyCached: 0, busy: true };
    }
    isBatchCaching = true;

    try {
        const urisToCache = [];
        const seen = new Set();

        for (const p of products) {
            const uri = p.imageUrl || p.imageUri || p.image;
            if (uri && typeof uri === 'string' && !uri.startsWith('data:')) {
                const key = getCanonicalKey(uri);
                if (key && !seen.has(key)) {
                    seen.add(key);
                    urisToCache.push(uri);
                }
            }
        }

        const total = urisToCache.length;
        if (total === 0) {
            isBatchCaching = false;
            if (onProgress) onProgress({ current: 0, total: 0, percent: 100, uri: null, success: true });
            return { total: 0, cached: 0, failed: 0, alreadyCached: 0 };
        }

        let current = 0;
        let cachedCount = 0;
        let alreadyCachedCount = 0;
        let failedCount = 0;
        let consecutiveNetworkFailures = 0;
        let abortedOffline = false;

        let index = 0;
        const worker = async () => {
            while (index < urisToCache.length && !abortedOffline) {
                const currentUri = urisToCache[index++];
                let success = false;
                try {
                    const cached = await getCachedImage(currentUri);
                    if (cached) {
                        alreadyCachedCount++;
                        success = true;
                        consecutiveNetworkFailures = 0;
                    } else if (typeof navigator === 'undefined' || navigator.onLine !== false) {
                        const newUrl = await cacheImage(currentUri);
                        if (newUrl) {
                            cachedCount++;
                            success = true;
                            consecutiveNetworkFailures = 0;
                        } else {
                            failedCount++;
                            consecutiveNetworkFailures++;
                            // Si fallan 8 descargas seguidas sin ningún acierto, la PC probablemente se apagó
                            if (yieldMs > 0 && consecutiveNetworkFailures >= 8) {
                                abortedOffline = true;
                            }
                        }
                    } else {
                        failedCount++;
                        abortedOffline = true;
                    }
                } catch (_) {
                    failedCount++;
                }

                current++;
                if (onProgress) {
                    const percent = Math.min(100, Math.round((current / total) * 100));
                    onProgress({
                        current,
                        total,
                        percent,
                        uri: currentUri,
                        success,
                        cached: cachedCount,
                        alreadyCached: alreadyCachedCount,
                        failed: failedCount
                    });
                }

                if (yieldMs > 0 && !abortedOffline) {
                    await new Promise((r) => setTimeout(r, yieldMs));
                }
            }
        };

        const activeWorkers = Array.from({ length: Math.min(concurrency, urisToCache.length) }, () => worker());
        await Promise.all(activeWorkers);

        return {
            total,
            cached: cachedCount,
            alreadyCached: alreadyCachedCount,
            failed: failedCount
        };
    } catch (e) {
        console.warn('🖼️ [ImageCache] Batch cache encountered error:', e);
        return { total: 0, cached: 0, failed: 0, alreadyCached: 0, error: e.message };
    } finally {
        isBatchCaching = false;
    }
};

export const resetImageCacheRuntimeForTests = () => {
    for (const val of memoryCache.values()) {
        revokeBlobUrlSafe(val);
    }
    memoryCache.clear();
    inFlightFetches.clear();
    failedFetchCooldown.clear();
    backgroundQueue = [];
    backgroundQueuedKeys.clear();
    backgroundActiveWorkers = 0;
    networkBackoffUntil = 0;
    cacheInstance = null;
    legacyCacheIndexPromise = null;
};
