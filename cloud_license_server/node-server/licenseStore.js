const fs = require('fs');
const path = require('path');

function normalizeMachineId(value) {
    return String(value || '').trim().toUpperCase().replace(/O/g, '0');
}

/**
 * Almacén de licencias remotas con soporte dual:
 * - PostgreSQL (cuando DATABASE_URL está configurado, esquema alineado con supabase_licenses_schema.sql)
 * - Archivo JSON atómico local (cero dependencias externas para VPS ligeros o tests)
 */
class LicenseStore {
    constructor(options = {}) {
        this.databaseUrl = options.databaseUrl || process.env.DATABASE_URL || '';
        this.jsonPath = options.jsonPath
            || process.env.JSON_STORE_PATH
            || path.join(__dirname, 'data', 'licenses.db.json');
        this.pool = null;
        this._writeChain = Promise.resolve();
        this._memoryState = null;
    }

    async init() {
        if (this.databaseUrl) {
            const { Pool } = require('pg');
            const isLocalDb = this.databaseUrl.includes('localhost') || this.databaseUrl.includes('127.0.0.1');
            const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
            this.pool = new Pool({
                connectionString: this.databaseUrl,
                ssl: isLocalDb ? false : { rejectUnauthorized }
            });
            await this.pool.query(`
                CREATE EXTENSION IF NOT EXISTS pgcrypto;
                CREATE TABLE IF NOT EXISTS cloud_licenses (
                    id BIGSERIAL PRIMARY KEY,
                    machine_id TEXT NOT NULL,
                    machine_id_norm TEXT NOT NULL UNIQUE,
                    customer_name TEXT,
                    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
                    suspend_reason TEXT,
                    grace_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_days >= 0 AND grace_days <= 365),
                    expires_at TIMESTAMPTZ,
                    notes TEXT,
                    app_version TEXT,
                    server_machine_id TEXT,
                    last_ip TEXT,
                    last_seen_at TIMESTAMPTZ,
                    grace_until TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS cloud_license_events (
                    id BIGSERIAL PRIMARY KEY,
                    machine_id_norm TEXT NOT NULL REFERENCES cloud_licenses(machine_id_norm) ON DELETE CASCADE,
                    event_type TEXT NOT NULL,
                    previous_status TEXT,
                    new_status TEXT,
                    reason TEXT,
                    actor TEXT,
                    ip_address TEXT,
                    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_cloud_licenses_status ON cloud_licenses(status);
                CREATE INDEX IF NOT EXISTS idx_cloud_licenses_last_seen ON cloud_licenses(last_seen_at DESC);
                CREATE INDEX IF NOT EXISTS idx_cloud_license_events_mid_created ON cloud_license_events(machine_id_norm, created_at DESC);
            `);
            return;
        }

        const dir = path.dirname(this.jsonPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (fs.existsSync(this.jsonPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'));
                this._memoryState = {
                    licenses: Array.isArray(parsed.licenses) ? parsed.licenses : [],
                    events: Array.isArray(parsed.events) ? parsed.events : []
                };
            } catch (_) {
                this._memoryState = { licenses: [], events: [] };
            }
        } else {
            this._memoryState = { licenses: [], events: [] };
            this._persistJsonSync();
        }
    }

    async close() {
        if (this.pool) {
            await this.pool.end().catch(() => {});
            this.pool = null;
        }
    }

    _persistJsonSync() {
        const tmpPath = `${this.jsonPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(this._memoryState, null, 2), 'utf8');
        fs.renameSync(tmpPath, this.jsonPath);
    }

    _enqueue(fn) {
        const next = this._writeChain.then(fn, fn);
        this._writeChain = next.catch(() => {});
        return next;
    }

    async findByMachineId(machineId) {
        const normId = normalizeMachineId(machineId);
        if (this.pool) {
            const { rows } = await this.pool.query(
                'SELECT * FROM cloud_licenses WHERE machine_id_norm = $1 LIMIT 1',
                [normId]
            );
            return rows[0] || null;
        }
        return this._enqueue(() => {
            const found = this._memoryState.licenses.find((l) => l.machine_id_norm === normId);
            return found ? { ...found } : null;
        });
    }

    async listAll(filters = {}) {
        const search = String(filters.search || '').trim().toLowerCase();
        const statusFilter = String(filters.status || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(500, Number.parseInt(filters.limit ?? '200', 10) || 200));
        const offset = Math.max(0, Number.parseInt(filters.offset ?? '0', 10) || 0);

        if (this.pool) {
            const clauses = [];
            const params = [];
            if (statusFilter && ['active', 'suspended', 'revoked'].includes(statusFilter)) {
                params.push(statusFilter);
                clauses.push(`status = $${params.length}`);
            }
            if (search) {
                params.push(`%${search}%`);
                clauses.push(`(LOWER(machine_id) LIKE $${params.length} OR LOWER(COALESCE(customer_name, '')) LIKE $${params.length})`);
            }
            const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
            params.push(limit, offset);
            const { rows } = await this.pool.query(
                `SELECT * FROM cloud_licenses ${whereSql} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
                params
            );
            return rows;
        }
        return this._enqueue(() => {
            let list = [...this._memoryState.licenses];
            if (statusFilter && ['active', 'suspended', 'revoked'].includes(statusFilter)) {
                list = list.filter((l) => String(l.status || '').toLowerCase() === statusFilter);
            }
            if (search) {
                list = list.filter((l) =>
                    String(l.machine_id || '').toLowerCase().includes(search) ||
                    String(l.customer_name || '').toLowerCase().includes(search)
                );
            }
            list.sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0));
            return list.slice(offset, offset + limit);
        });
    }

    async listEvents(machineId, limit = 100) {
        const normId = normalizeMachineId(machineId);
        const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 100));
        if (this.pool) {
            const { rows } = await this.pool.query(
                'SELECT * FROM cloud_license_events WHERE machine_id_norm = $1 ORDER BY created_at DESC LIMIT $2',
                [normId, safeLimit]
            );
            return rows;
        }
        return this._enqueue(() => {
            return [...this._memoryState.events]
                .filter((e) => e.machine_id_norm === normId)
                .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
                .slice(0, safeLimit);
        });
    }

    async upsertLicense(payload) {
        const normId = normalizeMachineId(payload.machineId);
        const nowIso = new Date().toISOString();

        if (this.pool) {
            const parsedGrace = payload.graceDays !== undefined && payload.graceDays !== null
                ? Number(payload.graceDays)
                : 7;
            const { rows } = await this.pool.query(
                `INSERT INTO cloud_licenses (
                    machine_id, machine_id_norm, customer_name, status, suspend_reason,
                    grace_days, expires_at, notes, app_version, server_machine_id,
                    last_ip, last_seen_at, grace_until, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
                ON CONFLICT (machine_id_norm) DO UPDATE SET
                    customer_name = COALESCE(EXCLUDED.customer_name, cloud_licenses.customer_name),
                    status = EXCLUDED.status,
                    suspend_reason = EXCLUDED.suspend_reason,
                    grace_days = EXCLUDED.grace_days,
                    expires_at = COALESCE(EXCLUDED.expires_at, cloud_licenses.expires_at),
                    notes = COALESCE(EXCLUDED.notes, cloud_licenses.notes),
                    app_version = COALESCE(EXCLUDED.app_version, cloud_licenses.app_version),
                    server_machine_id = COALESCE(EXCLUDED.server_machine_id, cloud_licenses.server_machine_id),
                    last_ip = COALESCE(EXCLUDED.last_ip, cloud_licenses.last_ip),
                    last_seen_at = COALESCE(EXCLUDED.last_seen_at, cloud_licenses.last_seen_at),
                    grace_until = COALESCE(EXCLUDED.grace_until, cloud_licenses.grace_until),
                    updated_at = NOW()
                RETURNING *`,
                [
                    payload.machineId,
                    normId,
                    payload.customerName ?? null,
                    payload.status || 'active',
                    payload.suspendReason ?? null,
                    Number.isFinite(parsedGrace) ? Math.max(0, Math.min(365, Math.trunc(parsedGrace))) : 7,
                    payload.expiresAt ?? null,
                    payload.notes ?? null,
                    payload.appVersion ?? null,
                    payload.serverMachineId ?? null,
                    payload.lastIp ?? null,
                    payload.lastSeenAt ?? null,
                    payload.graceUntil ?? null
                ]
            );
            return rows[0];
        }

        return this._enqueue(() => {
            const idx = this._memoryState.licenses.findIndex((l) => l.machine_id_norm === normId);
            const existing = idx >= 0 ? this._memoryState.licenses[idx] : null;
            const resolvedGrace = payload.graceDays !== undefined && payload.graceDays !== null
                ? Number(payload.graceDays)
                : (existing?.grace_days !== undefined ? Number(existing.grace_days) : 7);
            const next = {
                id: existing?.id || `lic_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                machine_id: existing?.machine_id || payload.machineId,
                machine_id_norm: normId,
                customer_name: payload.customerName !== undefined ? payload.customerName : (existing?.customer_name ?? null),
                status: payload.status || existing?.status || 'active',
                suspend_reason: payload.suspendReason !== undefined ? payload.suspendReason : (existing?.suspend_reason ?? null),
                grace_days: Number.isFinite(resolvedGrace) ? Math.max(0, Math.min(365, Math.trunc(resolvedGrace))) : 7,
                expires_at: payload.expiresAt !== undefined ? payload.expiresAt : (existing?.expires_at ?? null),
                notes: payload.notes !== undefined ? payload.notes : (existing?.notes ?? null),
                app_version: payload.appVersion !== undefined ? payload.appVersion : (existing?.app_version ?? null),
                server_machine_id: payload.serverMachineId !== undefined ? payload.server_machine_id : (existing?.server_machine_id ?? null),
                last_ip: payload.lastIp !== undefined ? payload.lastIp : (existing?.last_ip ?? null),
                last_seen_at: payload.lastSeenAt !== undefined ? payload.lastSeenAt : (existing?.last_seen_at ?? null),
                grace_until: payload.graceUntil !== undefined ? payload.graceUntil : (existing?.grace_until ?? null),
                created_at: existing?.created_at || nowIso,
                updated_at: nowIso
            };
            if (idx >= 0) {
                this._memoryState.licenses[idx] = next;
            } else {
                this._memoryState.licenses.push(next);
            }
            this._persistJsonSync();
            return { ...next };
        });
    }

    async appendEvent(event) {
        const normId = normalizeMachineId(event.machineId);
        if (this.pool) {
            await this.pool.query(
                `INSERT INTO cloud_license_events (
                    machine_id_norm, event_type, previous_status, new_status,
                    reason, actor, ip_address, metadata, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
                [
                    normId,
                    event.eventType,
                    event.previousStatus ?? null,
                    event.newStatus ?? null,
                    event.reason ?? null,
                    event.actor ?? null,
                    event.ipAddress ?? null,
                    JSON.stringify(event.metadata || {})
                ]
            );
            return;
        }
        return this._enqueue(() => {
            this._memoryState.events.push({
                id: `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                machine_id_norm: normId,
                event_type: event.eventType,
                previous_status: event.previousStatus ?? null,
                new_status: event.newStatus ?? null,
                reason: event.reason ?? null,
                actor: event.actor ?? null,
                ip_address: event.ipAddress ?? null,
                metadata: event.metadata || {},
                created_at: new Date().toISOString()
            });
            if (this._memoryState.events.length > 5000) {
                this._memoryState.events = this._memoryState.events.slice(-2500);
            }
            this._persistJsonSync();
        });
    }
}

module.exports = { LicenseStore, normalizeMachineId };
