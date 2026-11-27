/**
 * Gestor del ciclo de vida de workers en segundo plano (LAN Cluster, WhatsApp,
 * mantenimiento nocturno, bus Realtime PG16, BCV AutoSync, Supabase Outbox y
 * verificación de licencia online).
 */

const logInfo = (logger, msg) => {
    if (typeof logger?.info === 'function') return logger.info(msg);
    if (typeof logger?.log === 'function') return logger.log(msg);
    return console.log(msg);
};

class WorkerManager {
    constructor() {
        this.standaloneAutoBackupTimer = null;
    }

    /**
     * Inicia los workers secundarios fuera del hilo crítico de arranque HTTP.
     */
    async startAll({ virtualIo, primaryPort, dbInitPromise, shouldAbort = () => false, logger = console }) {
        if (shouldAbort() || process.env.DISABLE_BACKGROUND_WORKERS === 'true') {
            if (process.env.DISABLE_BACKGROUND_WORKERS === 'true') {
                logInfo(logger, '🧪 [Startup] Workers en segundo plano desactivados (DISABLE_BACKGROUND_WORKERS=true).');
            }
            return;
        }

        // 1. LAN Cluster Service (P2P Discovery & Sync)
        try {
            const LANClusterService = require('./LANClusterService');
            LANClusterService.init(virtualIo, Number(primaryPort));
        } catch (lanErr) {
            logger.warn('⚠️ Error al iniciar LAN Cluster Service:', lanErr.message);
        }

        // 2. WhatsApp Bot (espera conexión BD para resolver empresa principal)
        try {
            await dbInitPromise;
            if (shouldAbort()) return;
            const WhatsappBotService = require('./WhatsappBotService');
            const { User } = require('../database/models');
            const firstUser = await User.findOne({ where: { role: ['superadmin', 'admin'] } }) || await User.findOne();
            const companyId = firstUser?.companyId || 'default';
            WhatsappBotService.init(companyId, { autoStart: true });
            logInfo(logger, `✅ WhatsApp Bot background init completed (Company: ${companyId}).`);
        } catch (err) {
            logger.warn('⚠️ WhatsApp Bot background init notice:', err.message);
        }

        if (shouldAbort()) return;

        // 3. Auto-Maintenance Service (Vacuum, Tuning & Rotación)
        try {
            const AutoMaintenanceService = require('./AutoMaintenanceService');
            AutoMaintenanceService.init();
        } catch (maintErr) {
            logger.warn('⚠️ Error al iniciar AutoMaintenanceService:', maintErr.message);
        }

        // 4. PostgreSQL 16 Native Realtime Bus (LISTEN / NOTIFY)
        try {
            const PostgresRealtimeService = require('./PostgresRealtimeService');
            await PostgresRealtimeService.init(virtualIo);
        } catch (pgRtErr) {
            logger.warn('⚠️ Error al iniciar PostgresRealtimeService:', pgRtErr.message);
        }

        if (shouldAbort()) return;

        // 5. BCV Auto-Sync Service
        try {
            const BCVAutoSyncService = require('./BCVAutoSyncService');
            BCVAutoSyncService.init(virtualIo);
        } catch (bcvErr) {
            logger.warn('⚠️ Error al iniciar BCVAutoSyncService:', bcvErr.message);
        }

        // 6. Supabase Cloud Sync Worker (Outbox 24/7)
        try {
            const SupabaseSyncService = require('./SupabaseSyncService');
            SupabaseSyncService.start(15000);
            logInfo(logger, '✅ Supabase Cloud Sync Worker iniciado (24/7).');
        } catch (syncWorkerErr) {
            logger.warn('⚠️ Error al iniciar SupabaseSyncService:', syncWorkerErr.message);
        }

        // 7. Online License Heartbeat Worker
        try {
            const OnlineLicenseService = require('./OnlineLicenseService');
            OnlineLicenseService.start(virtualIo);
        } catch (onlineLicErr) {
            logger.warn('⚠️ Error al iniciar OnlineLicenseService:', onlineLicErr.message);
        }

        // 8. Auto-backup periódico cada 4 horas cuando corre autónomo (fuera de Electron)
        if (!process.versions.electron) {
            if (this.standaloneAutoBackupTimer) {
                clearInterval(this.standaloneAutoBackupTimer);
            }
            const runStandaloneBackup = async () => {
                if (shouldAbort()) return;
                try {
                    const { BASE_PATH } = require('../config/paths');
                    const dataRoot = process.env.USER_DATA_PATH || BASE_PATH;
                    const { performPostgresBackup } = require('../utils/sqliteBackupHelper');
                    const { createPostgresBackup } = require('../utils/backupHelper');
                    await performPostgresBackup(dataRoot).catch((e) => logger.warn('[AutoBackup Ultra] sqliteBackupHelper:', e.message));
                    await createPostgresBackup().catch((e) => logger.warn('[AutoBackup Ultra] backupHelper:', e.message));
                } catch (bkErr) {
                    logger.warn('[AutoBackup Ultra] Aviso:', bkErr.message);
                }
            };
            this.standaloneAutoBackupTimer = setInterval(runStandaloneBackup, 4 * 60 * 60 * 1000);
            if (typeof this.standaloneAutoBackupTimer.unref === 'function') {
                this.standaloneAutoBackupTimer.unref();
            }
            logInfo(logger, '✅ Auto-backup periódico (4h) activado para modo autónomo.');
        }
    }

    /**
     * Detiene ordenadamente todos los timers y workers activos.
     */
    async stopAll({ logger = console } = {}) {
        if (this.standaloneAutoBackupTimer) {
            clearInterval(this.standaloneAutoBackupTimer);
            this.standaloneAutoBackupTimer = null;
        }

        if (process.env.DISABLE_BACKGROUND_WORKERS === 'true') {
            return;
        }

        const stopServiceSafe = async (label, fn) => {
            try {
                await fn();
            } catch (err) {
                logger.warn(`[Server Shutdown] Error cerrando ${label}:`, err.message);
            }
        };

        await stopServiceSafe('LANClusterService', () => require('./LANClusterService').stop());
        await stopServiceSafe('PostgresRealtimeService', () => require('./PostgresRealtimeService').stop());
        await stopServiceSafe('SupabaseSyncService', () => require('./SupabaseSyncService').stop());
        await stopServiceSafe('BCVAutoSyncService', () => require('./BCVAutoSyncService').stop());
        await stopServiceSafe('AutoMaintenanceService', () => require('./AutoMaintenanceService').stop());
        await stopServiceSafe('WhatsappBotService', () => require('./WhatsappBotService').shutdown());
        await stopServiceSafe('OnlineLicenseService', () => require('./OnlineLicenseService').stop());
    }
}

module.exports = new WorkerManager();
