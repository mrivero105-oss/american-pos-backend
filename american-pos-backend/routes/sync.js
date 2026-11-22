const express = require('express');
const router = express.Router();
const { sequelize } = require('../database/connection');
const SupabaseSyncService = require('../services/SupabaseSyncService');

/**
 * GET /stats - Get real background cloud synchronization outbox statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const counts = {
            PENDING: 0,
            PROCESSING: 0,
            SYNCED: 0,
            RETRYING: 0,
            FAILED: 0
        };

        try {
            const [rows] = await sequelize.query(`
                SELECT status, COUNT(*)::int AS cnt
                FROM sync_outbox
                GROUP BY status;
            `);
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

const syncController = require('../controllers/syncController');

router.post('/offline-sales', syncController.syncOfflineSales);

module.exports = router;
