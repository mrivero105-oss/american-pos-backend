const express = require('express');
const router = express.Router();

/**
 * GET /stats - Get background cloud synchronization statistics
 * Since this is the central desktop node, local state is always synced.
 */
router.get('/stats', async (req, res) => {
    try {
        res.json({
            success: true,
            stats: {
                PENDING: 0,
                SYNCED: 0,
                RETRYING: 0,
                FAILED: 0
            },
            isOnline: true
        });
    } catch (error) {
        console.error('Get sync stats error:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas de sincronización' });
    }
});

const syncController = require('../controllers/syncController');

router.post('/offline-sales', syncController.syncOfflineSales);

module.exports = router;
