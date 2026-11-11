const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const SyncOutbox = require('../database/models/SyncOutbox');

class SupabaseSyncService {
    constructor() {
        this.supabaseUrl = process.env.SUPABASE_URL || 'https://puvqiipussyktfmgafgv.supabase.co';
        this.serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
        this.branchId = process.env.POS_BRANCH_ID || 'principal';
        this.isSyncing = false;
        this.timer = null;
    }

    /**
     * Registra un cambio en la bandeja de salida (Outbox).
     * Puede ejecutarse dentro de la misma transacción de Sequelize.
     */
    async queueEvent(entityName, entityId, operation, payload, transaction = null) {
        try {
            return await SyncOutbox.create({
                entity_name: entityName,
                entity_id: String(entityId),
                operation: operation || 'INSERT',
                payload: payload,
                status: 'PENDING'
            }, transaction ? { transaction } : {});
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
        if (!this.serviceKey || !this.supabaseUrl) {
            return { success: false, message: 'Faltan credenciales de Supabase en el .env' };
        }

        if (this.isSyncing) return { success: false, message: 'Sincronización en curso' };
        this.isSyncing = true;

        try {
            const pending = await SyncOutbox.findAll({
                where: {
                    status: 'PENDING'
                },
                order: [['created_at', 'ASC']],
                limit: limit
            });

            if (pending.length === 0) {
                this.isSyncing = false;
                return { success: true, count: 0 };
            }

            // Agrupar por tabla de destino
            const grouped = {};
            for (const item of pending) {
                const table = this._getCloudTable(item.entity_name);
                if (!table) continue;
                if (!grouped[table]) grouped[table] = [];
                grouped[table].push(item);
            }

            for (const [table, items] of Object.entries(grouped)) {
                const payloads = items.map(i => {
                    const data = { ...i.payload };
                    if (!data.sucursal_id) data.sucursal_id = this.branchId;
                    return data;
                });

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

                    // Marcar registros como sincronizados
                    const syncedIds = items.map(i => i.id);
                    await SyncOutbox.update({
                        status: 'SYNCED',
                        synced_at: new Date(),
                        last_error: null
                    }, {
                        where: { id: syncedIds }
                    });

                } catch (tableError) {
                    console.error(`[SYNC ERROR TABLE ${table}]:`, tableError.response?.data || tableError.message);
                    const failedIds = items.map(i => i.id);
                    for (const fItem of items) {
                        await fItem.update({
                            status: fItem.retry_count >= 5 ? 'FAILED' : 'PENDING',
                            retry_count: fItem.retry_count + 1,
                            last_error: tableError.response?.data?.message || tableError.message
                        });
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
    }

    /**
     * Inicia el proceso en segundo plano periódico
     */
    
    /**
     * Sincroniza la tasa de cambio y datos del negocio a Supabase periódicamente
     */
    async syncConfig(force = false) {
        if (!this.serviceKey || !this.supabaseUrl) return;
        try {
            const fs = require('fs');
            const paths = require('../config/paths');
            const settingsFile = paths.SETTINGS_FILE;
            if (!fs.existsSync(settingsFile)) return;
            const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            const comp = settings['2'] || settings['default'] || {};
            const rate = Number(comp.exchangeRate || 1000);
            
            if (!force && this._lastSyncedRate === rate && (Date.now() - (this._lastConfigSync || 0)) < 60000) {
                return;
            }

            const payload = {
                id: 'general',
                tasa_cambio: rate,
                ultima_actualizacion_tasa: comp.lastRateSyncAt || new Date().toISOString(),
                nombre_negocio: comp.businessInfo?.name || comp.businessName || 'Bodega Sigfrido',
                rif_cedula: comp.businessInfo?.taxId || 'R-123456789-0',
                direccion: comp.businessInfo?.address || 'Boca de Uchire, Anzoategui',
                modo_moneda: comp.currencyMode || 'BOTH',
                iva_porcentaje: Number(comp.taxConfig?.ivaRate || 16.0),
                igtf_porcentaje: Number(comp.taxConfig?.igtfRate || 3.0),
                actualizado_el: new Date().toISOString()
            };

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
                    timeout: 8000
                }
            );
            this._lastSyncedRate = rate;
            this._lastConfigSync = Date.now();
            console.log(`[SUPABASE CONFIG SYNC] 💱 Tasa y configuración sincronizadas a la nube: ${rate} Bs/$`);
        } catch (err) {
            console.warn('[SUPABASE CONFIG SYNC] Error sincronizando config:', err.message);
        }
    }

    /**
     * Encola la sincronización de un producto creado o actualizado
     */
    async queueProduct(product) {
        if (!product) return;
        try {
            const payload = {
                id: String(product.id),
                sucursal_id: this.branchId,
                codigo_barra: String(product.barcode || product.codigo_barra || ''),
                nombre: String(product.name || product.nombre || ''),
                categoria: String(product.category || product.categoria || 'General'),
                precio_venta: Number(Number(product.price || product.precio_venta || 0).toFixed(2)),
                stock_actual: Number(product.stock !== undefined ? product.stock : (product.stock_actual || 0)),
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
    }

    start(intervalMs = 15000) {
        if (this.timer) return;
        console.log(`[SUPABASE SYNC] Worker iniciado (Intervalo: ${intervalMs / 1000}s)`);
        this.timer = setInterval(async () => { 
            await this.processBatch(); 
            await this.syncConfig(); 
        }, intervalMs);

        // Purga periódica cada 24 horas
        this.purgeTimer = setInterval(async () => {
            await this.purgeOldSyncedRecords(30);
        }, 24 * 60 * 60 * 1000);
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
