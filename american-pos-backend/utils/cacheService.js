class CacheService {
    constructor(maxEntries = 500) {
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
        this.maxEntries = maxEntries;
    }

    purgeExpired(now = Date.now()) {
        let removed = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                removed++;
            }
        }
        return removed;
    }

    set(key, value, ttlSeconds = 3600) {
        const now = Date.now();
        if (this.cache.has(key)) {
            // Refrescar posición MRU (más reciente) en Map O(1)
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxEntries) {
            // Primero liberar entradas expiradas antes de evictar una clave activa
            this.purgeExpired(now);
            while (this.cache.size >= this.maxEntries) {
                const lruKey = this.cache.keys().next().value;
                if (lruKey === undefined) break;
                this.cache.delete(lruKey);
                this.evictions++;
            }
        }
        const expiresAt = now + (ttlSeconds * 1000);
        this.cache.set(key, { value, expiresAt });
    }

    get(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            this.misses++;
            return null;
        }

        if (Date.now() > cached.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }

        // Promoción LRU O(1): mover al final del Map para que las claves calientes (ej. catálogo) no se evicten
        this.cache.delete(key);
        this.cache.set(key, cached);
        this.hits++;
        return cached.value;
    }

    del(key) {
        this.cache.delete(key);
    }

    delPrefix(prefix) {
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }

    clear() {
        this.cache.clear();
    }

    getStats() {
        const total = this.hits + this.misses;
        return {
            entries: this.cache.size,
            maxEntries: this.maxEntries,
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            hitRatioPct: total > 0 ? Number(((this.hits / total) * 100).toFixed(2)) : 0
        };
    }
}

const instance = new CacheService();
instance.CacheService = CacheService;
module.exports = instance;
