class CacheService {
    constructor() {
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
        this.maxEntries = 500;
    }

    set(key, value, ttlSeconds = 3600) {
        if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) this.cache.delete(oldestKey);
        }
        const expiresAt = Date.now() + (ttlSeconds * 1000);
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
            hitRatioPct: total > 0 ? Number(((this.hits / total) * 100).toFixed(2)) : 0
        };
    }
}

module.exports = new CacheService();
