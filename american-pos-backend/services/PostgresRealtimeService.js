const { Client: PgClient } = require('pg');
const os = require('os');
const DbConfigManager = require('../config/dbConfigManager');
const cacheService = require('../utils/cacheService');

/**
 * PostgresRealtimeService
 * Bus reactivo nativo sobre PostgreSQL 16 (LISTEN / NOTIFY).
 * Permite sincronización instantánea entre múltiples cajas/terminales e invalidación
 * inmediata de caché en memoria sin necesidad de polling.
 */
class PostgresRealtimeService {
    constructor() {
        this.client = null;
        this.io = null;
        this.channel = 'isaac_pos_events';
        this.isListening = false;
        this.isStopping = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.debounceTimers = new Map();
        this.backendPid = null;
        this.eventsReceived = 0;
        this.lastEventAt = null;
        this.lastTable = null;
    }

    resolveConnectionConfig() {
        const cfg = DbConfigManager.getConfig();
        let host = cfg.host || process.env.DB_HOST || '127.0.0.1';
        if (host.toLowerCase() === os.hostname().toLowerCase() || host.toLowerCase() === 'localhost') {
            host = '127.0.0.1';
        }
        return {
            host,
            port: parseInt(cfg.port || process.env.DB_PORT || '5432', 10),
            user: cfg.user || process.env.DB_USER || 'postgres',
            password: cfg.password || process.env.DB_PASSWORD || 'postgres',
            database: cfg.database || process.env.DB_NAME || 'americanpos',
            keepAlive: true,
            connectionTimeoutMillis: 8000,
            application_name: `isaac_pos_realtime_${os.hostname()}`
        };
    }

    async init(io = null) {
        if (io) this.io = io;
        this.isStopping = false;
        if (this.isListening && this.client) {
            return this.getStatus();
        }
        await this.connectAndListen();
        return this.getStatus();
    }

    async connectAndListen() {
        if (this.isStopping) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.client) {
            try {
                this.client.removeAllListeners();
                await this.client.end().catch(() => {});
            } catch (_e) { /* ignore cleanup error */ }
            this.client = null;
        }

        const connConfig = this.resolveConnectionConfig();
        const client = new PgClient(connConfig);

        client.on('error', (err) => {
            this.isListening = false;
            console.warn(`[PG-Realtime] Aviso en canal LISTEN (${err.message}). Reintentando conexión...`);
            this.scheduleReconnect();
        });

        client.on('end', () => {
            this.isListening = false;
            if (!this.isStopping) {
                this.scheduleReconnect();
            }
        });

        client.on('notification', (msg) => {
            if (!msg || msg.channel !== this.channel) return;
            this.handleNotification(msg.payload);
        });

        try {
            await client.connect();
            const pidRes = await client.query('SELECT pg_backend_pid() AS pid;');
            this.backendPid = pidRes.rows?.[0]?.pid || null;
            await client.query(`LISTEN ${this.channel};`);

            this.client = client;
            this.isListening = true;
            this.reconnectAttempts = 0;
            console.log(`⚡ [PG-Realtime] Canal nativo PostgreSQL LISTEN '${this.channel}' activo (PID: ${this.backendPid}).`);
        } catch (err) {
            this.isListening = false;
            try { await client.end().catch(() => {}); } catch (_e) { /* ignore */ }
            console.warn(`[PG-Realtime] No se pudo enlazar LISTEN '${this.channel}': ${err.message}`);
            this.scheduleReconnect();
        }
    }

    handleNotification(rawPayload) {
        try {
            const payload = rawPayload ? JSON.parse(rawPayload) : {};
            const table = String(payload.table || 'unknown');
            const op = String(payload.op || 'CHANGE');

            this.eventsReceived += 1;
            this.lastEventAt = new Date().toISOString();
            this.lastTable = table;

            // Invalidación inmediata de cachés locales afectadas
            if (table === 'Products' || table === 'BranchStocks' || table === 'product_presentaciones') {
                cacheService.delPrefix('categories_');
                cacheService.delPrefix('ai_catalog_');
            }

            // Propagación con anti-rebote (200ms) hacia clientes WebSocket / terminales locales
            const targetIo = this.io || global.io;
            if (targetIo && typeof targetIo.emit === 'function') {
                const debounceKey = `emit_${table}`;
                if (this.debounceTimers.has(debounceKey)) {
                    clearTimeout(this.debounceTimers.get(debounceKey));
                }
                const timer = setTimeout(() => {
                    this.debounceTimers.delete(debounceKey);
                    const eventData = {
                        source: 'pg_notify',
                        table,
                        op,
                        timestamp: Date.now()
                    };
                    if (table === 'Products' || table === 'BranchStocks' || table === 'Sales') {
                        targetIo.emit('inventory_changed', eventData);
                    }
                    if (table === 'Customers' || table === 'CreditHistories') {
                        targetIo.emit('customers_changed', eventData);
                    }
                    if (table === 'Promotions') {
                        targetIo.emit('promotions_updated', eventData);
                    }
                    if (table === 'Expenses') {
                        targetIo.emit('expenses_changed', eventData);
                    }
                    if (table === 'CashShifts' || table === 'CashMovements') {
                        targetIo.emit('cash_updated', eventData);
                    }
                    targetIo.emit('pg_realtime_sync', eventData);
                }, 200);
                if (typeof timer.unref === 'function') timer.unref();
                this.debounceTimers.set(debounceKey, timer);
            }
        } catch (err) {
            console.warn('[PG-Realtime] Error procesando payload NOTIFY:', err.message);
        }
    }

    scheduleReconnect() {
        if (this.isStopping || this.reconnectTimer) return;
        this.reconnectAttempts += 1;
        const delayMs = Math.min(30000, 2000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 6)));
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectAndListen();
        }, delayMs);
        if (typeof this.reconnectTimer.unref === 'function') {
            this.reconnectTimer.unref();
        }
    }

    getStatus() {
        return {
            listening: this.isListening,
            channel: this.channel,
            backendPid: this.backendPid,
            eventsReceived: this.eventsReceived,
            lastEventAt: this.lastEventAt,
            lastTable: this.lastTable
        };
    }

    async stop() {
        this.isStopping = true;
        this.isListening = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        for (const t of this.debounceTimers.values()) {
            clearTimeout(t);
        }
        this.debounceTimers.clear();
        if (this.client) {
            try {
                this.client.removeAllListeners();
                await this.client.query(`UNLISTEN ${this.channel};`).catch(() => {});
                await this.client.end().catch(() => {});
            } catch (_e) { /* ignore */ }
            this.client = null;
        }
    }
}

module.exports = new PostgresRealtimeService();
