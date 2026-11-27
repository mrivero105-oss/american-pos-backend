const express = require('express');
const router = express.Router();
const { sequelize } = require('../database/connection');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const { requirePermission } = require('../middleware/auth');

/**
 * GET /stats - Get real background cloud synchronization outbox statistics
 */
router.get('/stats', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const counts = {
            PENDING: 0,
            PROCESSING: 0,
            SYNCED: 0,
            RETRYING: 0,
            FAILED: 0
        };
        const companyId = req.user?.companyId ? String(req.user.companyId) : null;

        try {
            let rows = [];
            if (companyId) {
                try {
                    const [tenantRows] = await sequelize.query(`
                        SELECT status, COUNT(*)::int AS cnt
                        FROM sync_outbox
                        WHERE payload->>'companyId' = :companyId
                        GROUP BY status;
                    `, { replacements: { companyId } });
                    rows = tenantRows;
                } catch (_tenantQueryErr) {
                    const [fallbackRows] = await sequelize.query(`
                        SELECT status, COUNT(*)::int AS cnt
                        FROM sync_outbox
                        GROUP BY status;
                    `);
                    rows = fallbackRows;
                }
            } else {
                const [allRows] = await sequelize.query(`
                    SELECT status, COUNT(*)::int AS cnt
                    FROM sync_outbox
                    GROUP BY status;
                `);
                rows = allRows;
            }
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const key = String(row.status || '').toUpperCase();
                    if (key in counts) {
                        counts[key] = Number(row.cnt) || 0;
                    }
                }
            }
        } catch (_queryErr) {
            // La tabla sync_outbox puede no estar creada todavía en instancias sin sync cloud
        }

        if (typeof SupabaseSyncService.refreshCredentials === 'function' && !SupabaseSyncService._isIsolatedEnv()) {
            SupabaseSyncService.refreshCredentials();
        }
        const isCloudConfigured = Boolean(SupabaseSyncService.supabaseUrl && SupabaseSyncService.serviceKey);
        res.json({
            success: true,
            stats: counts,
            isOnline: true,
            cloudConfigured: isCloudConfigured,
            isSyncing: Boolean(SupabaseSyncService.isSyncing)
        });
    } catch (error) {
        console.error('Get sync stats error:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas de sincronización' });
    }
});

/**
 * GET /cloud-client-config - Configuración pública (solo URL + Anon Key, NUNCA serviceKey)
 * para que Desktop y Android APK descubran en tiempo de ejecución el Supabase propio de esta PC.
 */
router.get('/cloud-client-config', (_req, res) => {
    try {
        return res.json(SupabaseSyncService.getPublicClientConfig());
    } catch (error) {
        console.error('Get cloud client config error:', error);
        return res.status(500).json({ configured: false, supabaseUrl: '', anonKey: '', branchId: 'principal' });
    }
});

/**
 * GET /cloud-config - Configuración administrativa del proyecto Supabase propio del comercio.
 */
router.get('/cloud-config', requirePermission('canManageSettings'), (_req, res) => {
    try {
        return res.json({
            success: true,
            ...SupabaseSyncService.getAdminConfig()
        });
    } catch (error) {
        console.error('Get cloud admin config error:', error);
        return res.status(500).json({ error: 'Error leyendo configuración de nube Supabase' });
    }
});

/**
 * PUT /cloud-config - Guarda URL, Anon Key, Service Role Key y Branch ID cifrados en SecretVault (DPAPI).
 * Recarga la sincronización en caliente y notifica a los terminales conectados vía Socket.IO.
 */
router.put('/cloud-config', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const { supabaseUrl, anonKey, serviceKey, branchId } = req.body || {};
        const saved = SupabaseSyncService.saveClientConfig({
            supabaseUrl,
            anonKey,
            serviceKey,
            branchId
        });

        // Sincronizar configuración inicial al Supabase del cliente en segundo plano (sin bloquear en entorno aislado)
        if (!SupabaseSyncService._isIsolatedEnv()) {
            SupabaseSyncService.syncConfig(true).catch((syncErr) => {
                console.warn('[CloudConfig] Aviso sincronizando configuración inicial:', syncErr?.message);
            });
        }

        const io = req.app?.get('io');
        if (io && typeof io.emit === 'function') {
            io.emit('cloud_config_updated', saved.client);
        }

        return res.json({
            success: true,
            message: 'Configuración de nube Supabase guardada y cifrada en esta PC.',
            ...saved.admin,
            clientConfig: saved.client
        });
    } catch (error) {
        return res.status(400).json({
            error: error?.message || 'Error guardando configuración de nube Supabase'
        });
    }
});

/**
 * POST /cloud-config/test - Verifica conectividad HTTPS, tablas cloud_* y bucket product-images.
 */
router.post('/cloud-config/test', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const { supabaseUrl, serviceKey, anonKey } = req.body || {};
        const result = await SupabaseSyncService.testConnection({
            supabaseUrl,
            serviceKey,
            anonKey
        });
        return res.json({
            success: result.ok,
            ...result
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error?.message || 'Error probando conexión con Supabase'
        });
    }
});

/**
 * DELETE /cloud-config - Desconecta la nube Supabase de este comercio (vuelve a operación 100% local).
 */
router.delete('/cloud-config', requirePermission('canManageSettings'), (req, res) => {
    try {
        const cleared = SupabaseSyncService.clearClientConfig();
        const io = req.app?.get('io');
        if (io && typeof io.emit === 'function') {
            io.emit('cloud_config_updated', cleared.client);
        }
        return res.json({
            success: true,
            message: 'Nube Supabase desconectada. El sistema operará en modo local independiente.',
            ...cleared.admin,
            clientConfig: cleared.client
        });
    } catch (error) {
        return res.status(500).json({
            error: error?.message || 'Error desconectando configuración de nube Supabase'
        });
    }
});

/**
 * GET /cloud-schema-sql - Entrega el script SQL idempotente para inicializar un proyecto Supabase nuevo.
 */
router.get('/cloud-schema-sql', requirePermission('canManageSettings'), (_req, res) => {
    try {
        const sql = SupabaseSyncService.getSchemaSql();
        return res.json({ success: true, sql });
    } catch (error) {
        console.error('Get cloud schema SQL error:', error);
        return res.status(500).json({ error: 'No se pudo cargar el script SQL de Supabase' });
    }
});

const syncController = require('../controllers/syncController');

router.post('/offline-sales', syncController.syncOfflineSales);

module.exports = router;
