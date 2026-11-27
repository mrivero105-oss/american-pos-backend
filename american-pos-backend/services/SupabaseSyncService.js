const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const SyncOutbox = require('../database/models/SyncOutbox');
const { sequelize } = require('../database/connection');
const { runWithTenantContext } = require('../database/tenantContext');
const { readJson, getUserSettings, normalizeCompanyId } = require('../utils/helpers');

class SupabaseSyncService {
    constructor() {
        this.supabaseUrl = '';
        this.serviceKey = '';
        this.branchId = process.env.POS_BRANCH_ID || 'principal';
        this.isSyncing = false;
        this.timer = null;
        this.refreshCredentials();
    }

    refreshCredentials() {
        const isIsolated = this._isIsolatedEnv();
        if (isIsolated) {
            if (!this.supabaseUrl) this.supabaseUrl = '';
            if (!this.serviceKey) this.serviceKey = '';
            return;
        }

        if (!this.supabaseUrl) {
            this.supabaseUrl = process.env.SUPABASE_URL || '';
        }
        if (!this.serviceKey) {
            this.serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
        }

        if (!this.supabaseUrl || !this.serviceKey) {
            try {
                const SecretVault = require('../config/secretVault');
                if (!this.serviceKey) {
                    this.serviceKey =
                        SecretVault.getSecret('SUPABASE_SERVICE_KEY') ||
                        SecretVault.getSecret('SUPABASE_KEY') ||
                        '';
                }
                if (!this.supabaseUrl) {
                    this.supabaseUrl = SecretVault.getSecret('SUPABASE_URL') || '';
                }
            } catch (_) {}
        }

        if (!this.supabaseUrl || !this.serviceKey) {
            try {
                const fs = require('fs');
                const envPaths = [
                    path.join(process.env.USER_DATA_PATH || '', '.env'),
                    path.join(process.env.APPDATA || '', 'isaac-pos', '.env'),
                    path.join(__dirname, '..', '.env')
                ];
                for (const p of envPaths) {
                    if (p && fs.existsSync(p)) {
                        const content = fs.readFileSync(p, 'utf8');
                        if (!this.supabaseUrl) {
                            const urlMatch = content.match(/^SUPABASE_URL=([^\r\n]+)/m);
                            if (urlMatch && urlMatch[1]?.trim()) {
                                this.supabaseUrl = urlMatch[1].trim().replace(/^["']|["']$/g, '');
                                process.env.SUPABASE_URL = this.supabaseUrl;
                            }
                        }
                        if (!this.serviceKey) {
                            const keyMatch = content.match(/^(?:SUPABASE_SERVICE_KEY|SUPABASE_KEY)=([^\r\n]+)/m);
                            if (keyMatch && keyMatch[1]?.trim()) {
                                this.serviceKey = keyMatch[1].trim().replace(/^["']|["']$/g, '');
                                process.env.SUPABASE_SERVICE_KEY = this.serviceKey;
                            }
                        }
                    }
                }
            } catch (_) {}
        }
    }

    _isIsolatedEnv() {
        return (
            process.env.ISAAC_TEST_ISOLATED === '1' ||
            process.env.NODE_ENV === 'test' ||
            process.env.DISABLE_BACKGROUND_WORKERS === 'true'
        );
    }

    _isRealCloudTargetInIsolatedEnv() {
        if (!this._isIsolatedEnv()) return false;
        if (!this.supabaseUrl || !this.serviceKey) return true;
        return Boolean(process.env.SUPABASE_URL && this.supabaseUrl === process.env.SUPABASE_URL);
    }

    /**
     * Registra un cambio en la bandeja de salida (Outbox).
     * Puede ejecutarse dentro de la misma transacción de Sequelize.
     */
    async queueEvent(entityName, entityId, operation, payload, transaction = null) {
        try {
            const recordPayload = {
                entity_name: entityName,
                entity_id: String(entityId),
                operation: operation || 'INSERT',
                payload: payload,
                status: 'PENDING'
            };

            if (transaction) {
                // Usar SAVEPOINT (transacción anidada) para que un error en sync_outbox nunca aborte la TX financiera en PostgreSQL
                return await sequelize.transaction({ transaction }, async (savepointTx) => {
                    return await SyncOutbox.create(recordPayload, { transaction: savepointTx });
                });
            }

            return await SyncOutbox.create(recordPayload);
        } catch (error) {
            console.error('[OUTBOX QUEUE ERROR]:', error.message);
            // No bloqueamos la venta local si falla la cola, pero lo registramos
        }
    }

    /**
     * Mapea el nombre de entidad interna a la tabla correspondiente en Supabase
     */
    _getCloudTable(entityName) {
        switch (entityName.toLowerCase()) {
            case 'ventas':
            case 'sale':
            case 'sales':
                return 'cloud_ventas';
            case 'productos':
            case 'product':
            case 'products':
                return 'cloud_productos';
            case 'clientes':
            case 'customer':
            case 'customers':
                return 'cloud_clientes';
            case 'cierres':
            case 'cashshift':
            case 'cashshifts':
                return 'cloud_cierres_caja';
            default:
                return null;
        }
    }

    /**
     * Procesa un lote de registros pendientes y los envía a Supabase
     */
    async processBatch(limit = 50) {
        if (!this._isIsolatedEnv()) {
            this.refreshCredentials();
        }
        if (this._isRealCloudTargetInIsolatedEnv()) {
            return { success: false, skipped: true, message: 'Desactivado en entorno aislado/test' };
        }
        if (!this.serviceKey || !this.supabaseUrl) {
            return { success: false, message: 'Faltan credenciales de Supabase en el .env' };
        }

        if (this.isSyncing) return { success: false, message: 'Sincronización en curso' };
        this.isSyncing = true;

        return await runWithTenantContext({ companyId: '', userId: 'system-supabase-sync', isSuperAdmin: true }, async () => {
            let pending = [];
            const t = await sequelize.transaction();
        try {
            // PostgreSQL 16: Selección atómica no bloqueante con SKIP LOCKED
            // Incluye rescate de registros que quedaron en PROCESSING por más de 5 minutos (p.ej. corte eléctrico)
            const [rows] = await sequelize.query(`
                SELECT id, entity_name, entity_id, operation, payload, retry_count, created_at
                FROM sync_outbox
                WHERE status = 'PENDING'
                   OR (status = 'PROCESSING' AND created_at < NOW() - INTERVAL '5 minutes')
                ORDER BY created_at ASC, ctid ASC
                LIMIT :limit
                FOR UPDATE SKIP LOCKED;
            `, {
                replacements: { limit },
                transaction: t
            });

            if (!rows || rows.length === 0) {
                await t.commit();
                this.isSyncing = false;
                return { success: true, count: 0 };
            }

            const processingIds = rows.map(r => r.id);
            await sequelize.query(`
                UPDATE sync_outbox
                SET status = 'PROCESSING'
                WHERE id IN (:processingIds);
            `, {
                replacements: { processingIds },
                transaction: t
            });

            await t.commit();
            pending = rows;
        } catch (lockErr) {
            await t.rollback().catch(() => {});
            this.isSyncing = false;
            console.error('[SYNC LOCK ERROR]:', lockErr.message);
            return { success: false, error: lockErr.message };
        }

        try {
            // Agrupar por tabla de destino; enviar a FAILED/cuarentena entidades desconocidas para evitar bucles en PROCESSING
            const grouped = {};
            const unknownEntityIds = [];
            for (const item of pending) {
                const table = this._getCloudTable(item.entity_name);
                if (!table) {
                    unknownEntityIds.push(item.id);
                    continue;
                }
                if (!grouped[table]) grouped[table] = [];
                grouped[table].push(item);
            }

            if (unknownEntityIds.length > 0) {
                await sequelize.query(`
                    UPDATE sync_outbox
                    SET status = 'FAILED', last_error = 'Entidad sin mapeo de tabla en nube', updated_at = NOW()
                    WHERE id IN (:unknownIds);
                `, { replacements: { unknownIds: unknownEntityIds } }).catch(() => {});
            }

            for (const [table, items] of Object.entries(grouped)) {
                // Consolidar múltiples mutaciones de una misma fila en el lote para evitar error PostgreSQL 21000
                // ("ON CONFLICT DO UPDATE command cannot affect row a second time")
                const dedupByEntity = new Map();
                const orderedWithoutId = [];
                for (const i of items) {
                    const data = { ...i.payload };
                    if (!data.sucursal_id) data.sucursal_id = this.branchId;
                    const entityKey = data.id !== undefined && data.id !== null
                        ? String(data.id)
                        : (i.entity_id !== undefined && i.entity_id !== null ? String(i.entity_id) : null);
                    if (entityKey) {
                        dedupByEntity.set(entityKey, { outboxItem: i, payload: data });
                    } else {
                        orderedWithoutId.push({ outboxItem: i, payload: data });
                    }
                }
                const uniqueEntries = [...dedupByEntity.values(), ...orderedWithoutId];
                const payloads = uniqueEntries.map(e => e.payload);

                try {
                    // PostgREST UPSERT directo en Supabase usando headers
                    await axios.post(
                        `${this.supabaseUrl}/rest/v1/${table}`,
                        payloads,
                        {
                            headers: {
                                'apikey': this.serviceKey,
                                'Authorization': `Bearer ${this.serviceKey}`,
                                'Content-Type': 'application/json',
                                'Prefer': 'resolution=merge-duplicates'
                            },
                            timeout: 15000
                        }
                    );

                    // Marcar todos los registros originales del lote (incluidos los consolidados) como sincronizados
                    const syncedIds = items.map(i => i.id);
                    await sequelize.query(`
                        UPDATE sync_outbox
                        SET status = 'SYNCED',
                            synced_at = NOW(),
                            last_error = NULL
                        WHERE id IN (:syncedIds);
                    `, {
                        replacements: { syncedIds }
                    });

                } catch (tableError) {
                    console.error(`[SYNC ERROR TABLE ${table}]:`, tableError.response?.data || tableError.message);
                    // Fallback fila por fila usando payloads consolidados (y marcando todos los outbox items del grupo)
                    const outboxIdsByEntity = new Map();
                    for (const i of items) {
                        const k = String(i.payload?.id ?? i.entity_id ?? i.id);
                        if (!outboxIdsByEntity.has(k)) outboxIdsByEntity.set(k, []);
                        outboxIdsByEntity.get(k).push(i);
                    }
                    for (const entry of uniqueEntries) {
                        const fItem = entry.outboxItem;
                        const singlePayload = entry.payload;
                        const groupKey = String(fItem.payload?.id ?? fItem.entity_id ?? fItem.id);
                        const matchingItems = outboxIdsByEntity.get(groupKey) || [fItem];
                        try {
                            await axios.post(
                                `${this.supabaseUrl}/rest/v1/${table}`,
                                [singlePayload],
                                {
                                    headers: {
                                        'apikey': this.serviceKey,
                                        'Authorization': `Bearer ${this.serviceKey}`,
                                        'Content-Type': 'application/json',
                                        'Prefer': 'resolution=merge-duplicates'
                                    },
                                    timeout: 10000
                                }
                            );
                            for (const m of matchingItems) {
                                await sequelize.query(`
                                    UPDATE sync_outbox
                                    SET status = 'SYNCED',
                                        synced_at = NOW(),
                                        last_error = NULL
                                    WHERE id = :itemId;
                                `, { replacements: { itemId: m.id } });
                            }
                        } catch (singleErr) {
                            const errMsg = String(singleErr.response?.data?.message || singleErr.message || 'Error desconocido').slice(0, 1000);
                            for (const m of matchingItems) {
                                const newRetry = Number(m.retry_count || 0) + 1;
                                const newStatus = newRetry >= 5 ? 'FAILED' : 'PENDING';
                                await sequelize.query(`
                                    UPDATE sync_outbox
                                    SET status = :newStatus,
                                        retry_count = :newRetry,
                                        last_error = :errMsg
                                    WHERE id = :itemId;
                                `, {
                                    replacements: { newStatus, newRetry, errMsg, itemId: m.id }
                                });
                            }
                        }
                    }
                }
            }

            this.isSyncing = false;
            return { success: true, count: pending.length };
        } catch (error) {
            this.isSyncing = false;
            console.error('[SYNC WORKER ERROR]:', error.message);
            return { success: false, error: error.message };
        }
        });
    }

    /**
     * Inicia el proceso en segundo plano periódico
     */
    
    /**
     * Sincroniza la tasa de cambio y datos del negocio a Supabase periódicamente
     */
    async syncConfig(force = false) {
        if (this._isRealCloudTargetInIsolatedEnv()) {
            return;
        }
        if (!this.serviceKey || !this.supabaseUrl) return;
        const now = Date.now();
        if (!force && this._configNextRetryAt && now < this._configNextRetryAt) {
            return;
        }
        try {
            const paths = require('../config/paths');
            const settings = readJson(paths.SETTINGS_FILE) || {};
            const companyKey = normalizeCompanyId(process.env.COMPANY_ID || '2');
            const comp = getUserSettings(settings, companyKey) || {};
            const rate = Number(comp.exchangeRate) > 0 ? Number(comp.exchangeRate) : 1.0;

            const payload = {
                id: 'general',
                tasa_cambio: rate,
                ultima_actualizacion_tasa: comp.lastRateSyncAt || new Date().toISOString(),
                nombre_negocio: comp.businessInfo?.name || comp.businessName || 'Comercio POS',
                rif_cedula: comp.businessInfo?.taxId || comp.businessInfo?.rif || '',
                direccion: comp.businessInfo?.address || '',
                modo_moneda: comp.currencyMode || 'BOTH',
                iva_porcentaje: Number(comp.taxConfig?.ivaRate ?? 16.0),
                igtf_porcentaje: Number(comp.taxConfig?.igtfRate ?? 3.0),
                actualizado_el: new Date().toISOString()
            };

            const configSignature = JSON.stringify([
                payload.tasa_cambio,
                payload.nombre_negocio,
                payload.rif_cedula,
                payload.direccion,
                payload.modo_moneda,
                payload.iva_porcentaje,
                payload.igtf_porcentaje
            ]);

            // Si no hubo cambios en tasa ni datos del negocio, solo reenviar 1 vez por hora (heartbeat)
            if (!force && this._lastConfigSignature === configSignature && (now - (this._lastConfigSync || 0)) < 3600000) {
                return;
            }

            await axios.post(
                `${this.supabaseUrl}/rest/v1/cloud_configuracion`,
                [payload],
                {
                    headers: {
                        'apikey': this.serviceKey,
                        'Authorization': `Bearer ${this.serviceKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    timeout: 15000
                }
            );
            this._lastSyncedRate = rate;
            this._lastConfigSignature = configSignature;
            this._lastConfigSync = Date.now();
            this._configFailureCount = 0;
            this._configNextRetryAt = 0;
            console.log(`[SUPABASE CONFIG SYNC] 💱 Tasa y configuración sincronizadas a la nube: ${rate} Bs/$`);
        } catch (err) {
            this._configFailureCount = (this._configFailureCount || 0) + 1;
            const backoffMs = Math.min(300000, 30000 * (2 ** Math.min(this._configFailureCount - 1, 3)));
            this._configNextRetryAt = Date.now() + backoffMs;
            console.warn(`[SUPABASE CONFIG SYNC] Error sincronizando config (reintento en ${Math.round(backoffMs / 1000)}s): ${err.message}`);
        }
    }

    /**
     * Encola la sincronización de un producto creado o actualizado
     */
    async queueProduct(product) {
        if (!product) return;
        try {
            const resolvedStock = product.stockQuantity !== undefined && product.stockQuantity !== null
                ? product.stockQuantity
                : (product.stock !== undefined && product.stock !== null ? product.stock : (product.stock_actual || 0));
            const payload = {
                id: String(product.id),
                sucursal_id: this.branchId,
                codigo_barra: String(product.barcode || product.codigo_barra || ''),
                nombre: String(product.name || product.nombre || ''),
                categoria: String(product.category || product.categoria || 'General'),
                precio_venta: Number(Number(product.price || product.precio_venta || 0).toFixed(2)),
                stock_actual: Number(resolvedStock) || 0,
                actualizado_el: new Date().toISOString()
            };
            await this.queueEvent('products', product.id, 'UPSERT', payload);
        } catch (err) {
            console.warn('[OUTBOX PRODUCT ERROR]:', err.message);
        }
    }

    /**
     * Encola la sincronización de un cliente creado o actualizado
     */
    async queueCustomer(customer) {
        if (!customer) return;
        try {
            const payload = {
                id: String(customer.id),
                nombre: String(customer.name || customer.nombre || ''),
                identificacion: String(customer.idDocument || customer.identificacion || '').substring(0, 50),
                telefono: String(customer.phone || customer.telefono || '').substring(0, 50),
                direccion: customer.address || customer.direccion || '',
                limite_credito: Number(Number(customer.creditLimit || customer.limite_credito || 0).toFixed(2)),
                saldo_pendiente: Number(Number(customer.creditBalance || customer.saldo_pendiente || 0).toFixed(2)),
                actualizado_el: new Date().toISOString()
            };
            await this.queueEvent('customers', customer.id, 'UPSERT', payload);
        } catch (err) {
            console.warn('[OUTBOX CUSTOMER ERROR]:', err.message);
        }
    }

    /**
     * Purga registros viejos ya sincronizados para mantener la BD local limpia
     */
    async purgeOldSyncedRecords(days = 30) {
        return await runWithTenantContext({ companyId: '', userId: 'system-supabase-purge', isSuperAdmin: true }, async () => {
            try {
                const { Op } = require('sequelize');
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                const deletedCount = await SyncOutbox.destroy({
                    where: {
                        status: 'SYNCED',
                        synced_at: { [Op.lt]: cutoff }
                    }
                });
                if (deletedCount > 0) {
                    console.log(`[SUPABASE PURGE] 🧹 Purgados ${deletedCount} registros antiguos (> ${days} días) de sync_outbox.`);
                }
            } catch (purgeErr) {
                console.warn('[SUPABASE PURGE] Error en purga:', purgeErr.message);
            }
        });
    }

    start(intervalMs = 15000) {
        if (this._isIsolatedEnv()) {
            console.log('🧪 [SUPABASE SYNC] Worker periódico omitido en entorno aislado/test.');
            return;
        }
        if (this.timer) return;
        console.log(`[SUPABASE SYNC] Worker iniciado (Intervalo: ${intervalMs / 1000}s)`);
        this.timer = setInterval(async () => { 
            await this.processBatch(); 
            await this.syncConfig(); 
        }, intervalMs);
        if (typeof this.timer.unref === 'function') this.timer.unref();

        // Purga periódica cada 24 horas
        this.purgeTimer = setInterval(async () => {
            await this.purgeOldSyncedRecords(30);
        }, 24 * 60 * 60 * 1000);
        if (typeof this.purgeTimer.unref === 'function') this.purgeTimer.unref();
        // Purga inicial al arrancar
        this.purgeOldSyncedRecords(30).catch(() => {});
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.purgeTimer) {
            clearInterval(this.purgeTimer);
            this.purgeTimer = null;
        }
    }
}

module.exports = new SupabaseSyncService();
