const { monitorEventLoopDelay } = require('perf_hooks');

const MAX_GLOBAL_SAMPLES = 1000;
const MAX_ROUTE_SAMPLES = 200;
const MAX_TRACKED_ROUTES = 80;
const MAX_SLOW_QUERIES = 50;
const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_THRESHOLD_MS || 200);

function percentile(sortedArr, p) {
    if (!sortedArr || sortedArr.length === 0) return 0;
    const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.ceil((p / 100) * sortedArr.length) - 1));
    return Number(sortedArr[idx].toFixed(2));
}

function summarizeSamples(samples) {
    if (!samples || samples.length === 0) {
        return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) sum += sorted[i];
    return {
        count: sorted.length,
        avgMs: Number((sum / sorted.length).toFixed(2)),
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
        maxMs: Number(sorted[sorted.length - 1].toFixed(2))
    };
}

function normalizeRouteKey(method, rawUrl) {
    const cleanPath = String(rawUrl || '/').split('?')[0];
    const normalized = cleanPath
        // UUIDs estándar
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
        // IDs compuestos tipo SALE-179... o MOB-179... o hex largos
        .replace(/\/[A-Z]{2,8}-[0-9A-Za-z_-]{6,}/g, '/:id')
        .replace(/\/[0-9a-f]{16,}/gi, '/:id')
        // IDs puramente numéricos
        .replace(/\/\d+(?=\/|$)/g, '/:id');
    return `${String(method || 'GET').toUpperCase()} ${normalized}`;
}

function sanitizeSqlForLog(sql) {
    return String(sql || '')
        .replace(/\s+/g, ' ')
        .replace(/'[^']*'/g, "'?'")
        .trim()
        .slice(0, 240);
}

class RingBuffer {
    constructor(capacity) {
        this.capacity = Math.max(1, capacity);
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.size = 0;
    }

    push(value) {
        this.buffer[this.head] = value;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) {
            this.size++;
        }
    }

    toArray() {
        if (this.size === 0) return [];
        const out = new Array(this.size);
        const start = this.size === this.capacity ? this.head : 0;
        for (let i = 0; i < this.size; i++) {
            out[i] = this.buffer[(start + i) % this.capacity];
        }
        return out;
    }

    clear() {
        this.head = 0;
        this.size = 0;
    }
}

class TelemetryCollector {
    constructor() {
        this.startedAt = Date.now();
        this.totalRequests = 0;
        this.totalErrors5xx = 0;
        this.totalErrors4xx = 0;
        this.globalSamples = new RingBuffer(MAX_GLOBAL_SAMPLES);
        this.routeStats = new Map();
        this.slowQueries = new RingBuffer(MAX_SLOW_QUERIES);
        this.totalDbQueries = 0;
        this.totalSlowDbQueries = 0;

        this.eld = null;
        try {
            if (typeof monitorEventLoopDelay === 'function') {
                this.eld = monitorEventLoopDelay({ resolution: 20 });
                this.eld.enable();
            }
        } catch (_) {
            this.eld = null;
        }
    }

    recordHttp(method, url, statusCode, durationMs) {
        const ms = Number(durationMs) || 0;
        this.totalRequests++;
        if (statusCode >= 500) this.totalErrors5xx++;
        else if (statusCode >= 400) this.totalErrors4xx++;

        this.globalSamples.push(ms);

        const routeKey = normalizeRouteKey(method, url);
        let entry = this.routeStats.get(routeKey);
        if (!entry) {
            if (this.routeStats.size >= MAX_TRACKED_ROUTES) {
                // Evict least-recently-used key (primera entrada del Map)
                const oldestKey = this.routeStats.keys().next().value;
                if (oldestKey) this.routeStats.delete(oldestKey);
            }
            entry = { count: 0, errors5xx: 0, samples: new RingBuffer(MAX_ROUTE_SAMPLES), lastSeenAt: 0 };
            this.routeStats.set(routeKey, entry);
        } else {
            // Promoción LRU O(1) para conservar las rutas activas
            this.routeStats.delete(routeKey);
            this.routeStats.set(routeKey, entry);
        }
        entry.count++;
        if (statusCode >= 500) entry.errors5xx++;
        entry.lastSeenAt = Date.now();
        entry.samples.push(ms);
    }

    recordDbQuery(sql, durationMs) {
        this.totalDbQueries++;
        const ms = Number(durationMs) || 0;
        if (ms >= SLOW_QUERY_THRESHOLD_MS) {
            this.totalSlowDbQueries++;
            this.slowQueries.push({
                durationMs: Number(ms.toFixed(2)),
                timestamp: new Date().toISOString(),
                sql: sanitizeSqlForLog(sql)
            });
        }
    }

    middleware() {
        return (req, res, next) => {
            const startNs = process.hrtime.bigint();
            const url = req.originalUrl || req.url || '/';
            const method = req.method || 'GET';
            res.on('finish', () => {
                const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                this.recordHttp(method, url, res.statusCode || 200, elapsedMs);
            });
            next();
        };
    }

    getEventLoopStats() {
        if (!this.eld) {
            return { available: false, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
        }
        const toMs = (ns) => Number((Number(ns || 0) / 1e6).toFixed(2));
        return {
            available: true,
            p50Ms: toMs(this.eld.percentile(50)),
            p95Ms: toMs(this.eld.percentile(95)),
            p99Ms: toMs(this.eld.percentile(99)),
            maxMs: toMs(this.eld.max)
        };
    }

    getSnapshot() {
        const uptimeSec = Math.max(1, (Date.now() - this.startedAt) / 1000);
        const mem = process.memoryUsage();
        const routes = [];
        for (const [route, data] of this.routeStats.entries()) {
            const stats = summarizeSamples(data.samples.toArray());
            routes.push({
                route,
                totalCalls: data.count,
                errors5xx: data.errors5xx,
                avgMs: stats.avgMs,
                p50Ms: stats.p50Ms,
                p95Ms: stats.p95Ms,
                p99Ms: stats.p99Ms,
                maxMs: stats.maxMs
            });
        }

        const slowestRoutes = [...routes]
            .sort((a, b) => b.p95Ms - a.p95Ms)
            .slice(0, 15);
        const busiestRoutes = [...routes]
            .sort((a, b) => b.totalCalls - a.totalCalls)
            .slice(0, 15);

        return {
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(uptimeSec),
            http: {
                totalRequests: this.totalRequests,
                requestsPerSecond: Number((this.totalRequests / uptimeSec).toFixed(2)),
                errors4xx: this.totalErrors4xx,
                errors5xx: this.totalErrors5xx,
                error5xxRatePct: this.totalRequests > 0
                    ? Number(((this.totalErrors5xx / this.totalRequests) * 100).toFixed(3))
                    : 0,
                latency: summarizeSamples(this.globalSamples.toArray()),
                slowestRoutes,
                busiestRoutes
            },
            database: {
                totalTrackedQueries: this.totalDbQueries,
                slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
                totalSlowQueries: this.totalSlowDbQueries,
                recentSlowQueries: this.slowQueries.toArray().reverse().slice(0, 20)
            },
            eventLoop: this.getEventLoopStats(),
            memory: {
                heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
                heapTotalMB: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
                rssMB: Number((mem.rss / 1024 / 1024).toFixed(2)),
                externalMB: Number((mem.external / 1024 / 1024).toFixed(2))
            }
        };
    }

    reset() {
        this.totalRequests = 0;
        this.totalErrors5xx = 0;
        this.totalErrors4xx = 0;
        this.globalSamples.clear();
        this.routeStats.clear();
        this.slowQueries.clear();
        this.totalDbQueries = 0;
        this.totalSlowDbQueries = 0;
        if (this.eld && typeof this.eld.reset === 'function') {
            try { this.eld.reset(); } catch (_) {}
        }
    }

    stop() {
        if (this.eld && typeof this.eld.disable === 'function') {
            try { this.eld.disable(); } catch (_) {}
        }
    }
}

module.exports = new TelemetryCollector();
