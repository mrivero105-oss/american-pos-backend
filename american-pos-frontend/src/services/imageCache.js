import { db } from './db';
import localDb from '../db/localDb';
import { getImageUrl } from '../utils/imageUtils';

// In-Memory Bounded Fast Lookup Cache (Max 400 items for zero-flicker virtual grid recycling)
const MAX_MEMORY_CACHE_ITEMS = 400;
const memoryCache = new Map();

export const getMemoryCachedImage = (uri) => {
    if (!uri) return null;
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;
    return memoryCache.get(uri) || null;
};

const setMemoryCache = (key, val) => {
    if (memoryCache.has(key)) {
        memoryCache.delete(key);
    } else if (memoryCache.size >= MAX_MEMORY_CACHE_ITEMS) {
        const firstKey = memoryCache.keys().next().value;
        memoryCache.delete(firstKey);
    }
    memoryCache.set(key, val);
};

// Native Browser Cache Storage API Singleton
const CACHE_NAME = 'isaac-pos-img-v1';
let cacheInstance = null;

async function getBrowserCache() {
    if (typeof window === 'undefined' || !('caches' in window)) return null;
    if (!cacheInstance) {
        try {
            cacheInstance = await window.caches.open(CACHE_NAME);
        } catch (_e) {
            cacheInstance = null;
        }
    }
    return cacheInstance;
}

// Helper to convert Blob to Base64 Data URL
const blobToDataUrl = (blob) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/**
 * Get cached image DataURL / Blob URL from Memory, Cache Storage API, or IndexedDB.
 */
export const getCachedImage = async (uri) => {
    if (!uri) return null;

    // 1. Direct Base64 or inline data URL
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;

    // 2. Memory Cache (Instant 0 ms)
    if (memoryCache.has(uri)) {
        return memoryCache.get(uri);
    }

    const fullUrl = getImageUrl(uri);

    // 3. Native Browser Cache Storage API (Binary zero-serialization cache)
    try {
        const cache = await getBrowserCache();
        if (cache && fullUrl) {
            const cachedResponse = await cache.match(fullUrl);
            if (cachedResponse && cachedResponse.ok) {
                const blob = await cachedResponse.blob();
                if (blob && blob.size > 0) {
                    const objectUrl = URL.createObjectURL(blob);
                    setMemoryCache(uri, objectUrl);
                    return objectUrl;
                }
            }
        }
    } catch (_cacheErr) {
        // Fallback to IndexedDB
    }

    // 4. IndexedDB Cache (services/db)
    try {
        const doc = await db.getById('imageCache', uri);
        if (doc && doc.data) {
            setMemoryCache(uri, doc.data);
            return doc.data;
        }
    } catch (_err) {
        // Fallback silently if IndexedDB is busy
    }

    // 5. Fallback IndexedDB Cache (localDb Dexie)
    try {
        if (localDb && localDb.imageCache) {
            const dexDoc = await localDb.imageCache.get(uri);
            if (dexDoc && dexDoc.data) {
                setMemoryCache(uri, dexDoc.data);
                return dexDoc.data;
            }
        }
    } catch (_dexErr) {
        // Fallback silently
    }

    return null;
};

/**
 * Fetch an image over network, store binary response in Cache Storage API & IndexedDB fallback.
 */
export const cacheImage = async (uri) => {
    if (!uri) return null;
    if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;

    // Check if already cached
    const existing = await getCachedImage(uri);
    if (existing) return existing;

    const fullUrl = getImageUrl(uri);
    if (!fullUrl) return null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

        const response = await fetch(fullUrl, { credentials: 'omit', signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) return null;

        // Clone response to put one in Cache Storage and read the other
        const cache = await getBrowserCache();
        if (cache) {
            try {
                await cache.put(fullUrl, response.clone());
            } catch (_putErr) {}
        }

        const blob = await response.blob();
        if (!blob || blob.size === 0) return null;

        const objectUrl = URL.createObjectURL(blob);
        setMemoryCache(uri, objectUrl);

        return objectUrl;
    } catch (_err) {
        // Failed network fetch (expected when offline)
    }

    return null;
};

/**
 * Batch pre-cacher for product catalog images with live progress callback.
 */
let isBatchCaching = false;

export const cacheAllProductImages = async (products, options = {}) => {
    if (!products || !Array.isArray(products) || products.length === 0) {
        return { total: 0, cached: 0, failed: 0, alreadyCached: 0 };
    }

    const { concurrency = 4, onProgress = null } = typeof options === 'number' ? { concurrency: options } : options;

    if (isBatchCaching) {
        return { total: 0, cached: 0, failed: 0, alreadyCached: 0, busy: true };
    }
    isBatchCaching = true;

    try {
        const urisToCache = [];
        const seen = new Set();

        for (const p of products) {
            const uri = p.imageUrl || p.imageUri || p.image;
            if (uri && typeof uri === 'string' && !uri.startsWith('data:') && !seen.has(uri)) {
                seen.add(uri);
                urisToCache.push(uri);
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

        let index = 0;
        const worker = async () => {
            while (index < urisToCache.length) {
                const currentUri = urisToCache[index++];
                let success = false;
                try {
                    const cached = await getCachedImage(currentUri);
                    if (cached) {
                        alreadyCachedCount++;
                        success = true;
                    } else if (navigator.onLine) {
                        const newUrl = await cacheImage(currentUri);
                        if (newUrl) {
                            cachedCount++;
                            success = true;
                        } else {
                            failedCount++;
                        }
                    } else {
                        failedCount++;
                    }
                } catch (_e) {
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
